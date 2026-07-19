// @ts-check
/**
 * Deep data-integrity audit for the baked datasets. Answers one question:
 * "is anything in src/data/generated/*.json stale, wrong, or internally
 * inconsistent?" — across pick rate, EV spreads, move %, ability %, items,
 * teammates and KO benchmarks, for EVERY Pokémon and form.
 *
 *   npm run audit            # full audit incl. live Smogon cross-checks
 *   npm run audit -- --offline   # skip the network cross-checks
 *
 * It is the correctness net that `npm run status` (integrity) and `npm run
 * refresh` (freshness) don't cover: status proves nothing is blank; this proves
 * nothing is WRONG. Findings are grouped high → low; exits non-zero on any high.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
const OFFLINE = process.argv.includes("--offline");

const dex = read("src/data/generated/pokemon.json");
const comp = read("src/data/generated/competitive.json");
const mons = dex.pokemon;
const moveIndex = dex.moves ?? {};
const itemIndex = comp.itemIndex ?? {};

const NATURES = new Set([
  "Hardy", "Lonely", "Brave", "Adamant", "Naughty", "Bold", "Docile", "Relaxed",
  "Impish", "Lax", "Timid", "Hasty", "Serious", "Jolly", "Naive", "Modest",
  "Mild", "Quiet", "Bashful", "Rash", "Calm", "Gentle", "Sassy", "Careful", "Quirky",
]);
const stripId = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

const findings = { high: [], medium: [], low: [] };
const add = (sev, mon, msg) => findings[sev].push(`${mon}: ${msg}`);

// Map every form key -> its owning pokemon record + the form's own abilities/movepool.
const abilityNames = (list) => (list ?? []).map((a) => (typeof a === "string" ? a : a.name));
const formOf = new Map();
for (const p of mons) {
  formOf.set(p.name, { p, abilities: abilityNames(p.abilities), moveSlugs: p.moveSlugs });
  for (const f of p.forms ?? []) {
    // A form's legal movepool = base ∪ form (Megas share the base's learnset).
    formOf.set(f.key, {
      p,
      abilities: f.abilities.map((a) => a.name),
      moveSlugs: p.moveSlugs,
    });
  }
}

// --- Per-profile checks over BOTH brackets -----------------------------------
for (const [bracket, profiles] of Object.entries(comp.brackets)) {
  for (const [key, pr] of Object.entries(profiles)) {
    const tag = `[${bracket}] ${key}`;
    const owner = formOf.get(key);
    if (!owner) {
      add("high", tag, "profile key has no matching Pokémon/form in pokemon.json");
      continue;
    }
    const legalAbilities = new Set(owner.abilities.map(stripId));
    const legalMoves = new Set(owner.moveSlugs);

    // Pick rate sanity. 0 is VALID: a master profile backfilled from 1630 is,
    // by design, ~0% at the 1760 cutoff — accurate, not stale. Only a negative
    // or >100 value is impossible.
    if (typeof pr.usagePct !== "number" || pr.usagePct < 0 || pr.usagePct > 100)
      add("high", tag, `usagePct out of range: ${pr.usagePct}`);

    // A profile with no ability AND no move data is a dead card — UNLESS it's an
    // `asForm` profile, where the generator deliberately blanks ability/move
    // usage (they belong to a different form) but still surfaces usage/item/spread.
    if (!pr.asForm && !Object.keys(pr.abilityUsage ?? {}).length && !Object.keys(pr.moveUsage ?? {}).length)
      add("medium", tag, "profile has no ability or move data (dead card)");

    // Ability % must reference an ability the mon can actually have, and sum ~100.
    let abilitySum = 0;
    for (const [aid, pct] of Object.entries(pr.abilityUsage ?? {})) {
      abilitySum += pct;
      if (pct < 0 || pct > 100) add("medium", tag, `ability ${aid} pct ${pct} out of range`);
      if (!legalAbilities.has(stripId(aid)))
        add("high", tag, `ability "${aid}" is NOT one of this form's abilities (${[...legalAbilities].join("/")}) — likely a wrong Smogon match`);
    }
    if (Object.keys(pr.abilityUsage ?? {}).length && Math.abs(abilitySum - 100) > 3)
      add("low", tag, `ability % sum is ${abilitySum} (expected ~100)`);

    // Move % must reference a move in the mon's Champions movepool.
    for (const [slug, pct] of Object.entries(pr.moveUsage ?? {})) {
      if (pct < 0 || pct > 100) add("medium", tag, `move ${slug} pct ${pct} out of range`);
      if (!moveIndex[slug]) add("high", tag, `move "${slug}" not in the move index`);
      else if (!legalMoves.has(slug))
        add("high", tag, `move "${slug}" is NOT in this mon's movepool — wrong Smogon match or stale movepool`);
    }

    // Spread: valid nature, EV bounds, total ≤ 508 (+2 slack for rounding).
    if (pr.spread) {
      if (!NATURES.has(pr.spread.nature))
        add("high", tag, `invalid nature "${pr.spread.nature}"`);
      let evTotal = 0;
      for (const [stat, ev] of Object.entries(pr.spread.evs ?? {})) {
        evTotal += ev;
        if (ev < 0 || ev > 252) add("high", tag, `EV ${stat}=${ev} out of 0–252`);
      }
      if (evTotal > 510) add("high", tag, `EV total ${evTotal} exceeds 508`);
    }

    // Items: valid %, sorted desc, slug resolves + described.
    let lastPct = Infinity;
    for (const it of pr.items ?? []) {
      if (it.usagePct < 0 || it.usagePct > 100) add("medium", tag, `item ${it.displayName} pct ${it.usagePct} out of range`);
      if (it.usagePct > lastPct) add("low", tag, `items not sorted by usage (${it.displayName})`);
      lastPct = it.usagePct;
      if (it.slug && !itemIndex[it.slug]) add("high", tag, `item slug "${it.slug}" missing from itemIndex`);
    }

    // Teammates: valid %, slug (when set) resolves to a roster mon.
    for (const t of pr.teammates ?? []) {
      if (t.usagePct < 0 || t.usagePct > 100) add("low", tag, `teammate ${t.displayName} pct ${t.usagePct} out of range`);
      if (t.slug && !formOf.has(t.slug)) add("medium", tag, `teammate slug "${t.slug}" is not a roster Pokémon`);
    }

    // Benchmarks: move resolves and is in the movepool; counts consistent.
    for (const b of pr.benchmarks ?? []) {
      if (!moveIndex[b.move]) add("high", tag, `benchmark move "${b.move}" not in move index`);
      else if (!legalMoves.has(b.move)) add("medium", tag, `benchmark move "${b.move}" not in movepool`);
      if (b.ohkoCount < b.ohko.length || b.twoCount < b.two.length)
        add("low", tag, `benchmark ${b.move} count < listed names`);
    }
  }
}

// --- Pokémon-layer checks ----------------------------------------------------
const POKEMON_TYPES = new Set([
  "normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison",
  "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy",
]);
for (const p of mons) {
  const forms = [{ key: p.name, types: p.types, stats: p.stats, abilities: p.abilities.map((a) => (typeof a === "string" ? a : a.name)) },
    ...(p.forms ?? []).map((f) => ({ key: f.key, types: f.types, stats: f.stats, abilities: f.abilities.map((a) => a.name) }))];
  for (const f of forms) {
    if (!f.types.length || f.types.length > 2 || !f.types.every((t) => POKEMON_TYPES.has(t)))
      add("high", f.key, `invalid types ${JSON.stringify(f.types)}`);
    const s = f.stats;
    const sum = s.hp + s.attack + s.defense + s.specialAttack + s.specialDefense + s.speed;
    if (s.total !== sum) add("high", f.key, `stat total ${s.total} ≠ sum ${sum}`);
    for (const [k, v] of Object.entries(s)) {
      if (k !== "total" && (v < 1 || v > 255)) add("high", f.key, `stat ${k}=${v} out of 1–255`);
    }
    if (!f.abilities.length) add("high", f.key, "no abilities");
  }
  for (const slug of p.moveSlugs ?? []) {
    if (!moveIndex[slug]) add("high", p.name, `movepool slug "${slug}" not in move index`);
  }
}

// --- Live freshness + usage cross-check (network) ----------------------------
async function liveChecks() {
  const UA = "Mozilla/5.0 (compatible; ChampionsPokedexAudit/1.0)";
  const get = (u) => fetch(u, { headers: { "User-Agent": UA } });
  // 1) Are we on the newest published month + regulation?
  try {
    const idx = await (await get("https://www.smogon.com/stats/")).text();
    const months = [...new Set([...idx.matchAll(/href="(\d{4}-\d{2})\//g)].map((m) => m[1]))].sort().reverse();
    for (const month of months.slice(0, 4)) {
      const dir = await get(`https://www.smogon.com/stats/${month}/chaos/`);
      if (!dir.ok) continue;
      const text = await dir.text();
      const fmts = [...new Set([...text.matchAll(/(gen9championsvgc\d{4}reg[a-z]+)-0\.json/g)].map((m) => m[1]))].sort();
      if (!fmts.length) continue;
      const newestFmt = fmts.at(-1);
      if (month > comp.meta.month || (month === comp.meta.month && newestFmt > comp.meta.format))
        add("high", "FRESHNESS", `newer source published: ${newestFmt} ${month} (baked is ${comp.meta.format} ${comp.meta.month}) — run \`npm run refresh\``);
      else if (newestFmt !== comp.meta.format || month !== comp.meta.month)
        add("low", "FRESHNESS", `newest published is ${newestFmt} ${month}; baked ${comp.meta.format} ${comp.meta.month} (baked is ahead or equal — OK)`);
      break;
    }
  } catch (e) {
    add("low", "FRESHNESS", `could not check newest published month: ${e.message}`);
  }

  // 2) Cross-check baked All-ranks usage% against Smogon's independently-produced
  //    usage .txt (a different pipeline than the chaos JSON we bake from).
  try {
    const txt = await (await get(`https://www.smogon.com/stats/${comp.meta.month}/${comp.meta.format}-0.txt`)).text();
    const usageTxt = new Map();
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*\|\s*\d+\s*\|\s*([^|]+?)\s*\|\s*([\d.]+)%/);
      if (m) usageTxt.set(m[1].trim(), parseFloat(m[2]));
    }
    let checked = 0, mism = 0;
    for (const [key, pr] of Object.entries(comp.brackets.all)) {
      const name = pr.smogonName;
      if (!name || !usageTxt.has(name)) continue;
      checked++;
      const diff = Math.abs(usageTxt.get(name) - pr.usagePct);
      if (diff > 1.5) { // >1.5pp gap between the two Smogon products = suspicious
        mism++;
        add("medium", `[all] ${key}`, `usage ${pr.usagePct}% vs Smogon usage.txt ${usageTxt.get(name)}% (Δ${diff.toFixed(1)}pp)`);
      }
    }
    console.log(`  cross-checked ${checked} all-bracket usages vs usage.txt (${mism} mismatched)`);
  } catch (e) {
    add("low", "USAGE", `could not cross-check usage.txt: ${e.message}`);
  }
}

// --- Meta teams (real teams from Smogon's sample-teams thread) ----------------
// Correctness of the baked teams: complete squads, resolvable members, and sets
// that are internally consistent with the roster (legal ability, in-movepool).
try {
  const teams = read("src/data/generated/teams.json");
  const displayToSlug = new Map(
    Object.entries(moveIndex).map(([slug, m]) => [stripId(m.displayName ?? slug), slug]),
  );
  if (teams.meta.generatedAt !== comp.meta.generatedAt)
    add("medium", "TEAMS", `teams snapshot ${teams.meta.generatedAt} ≠ ladder ${comp.meta.generatedAt} (salvaged — re-run \`npm run data:teams\`)`);

  for (const t of teams.teams ?? []) {
    const tag = `team ${t.slug}`;
    if ((t.members?.length ?? 0) !== 6) add("high", tag, `${t.members?.length ?? 0}/6 members`);
    for (const m of t.members ?? []) {
      const owner = m.formKey ? formOf.get(m.formKey) : formOf.get(m.slug);
      if (!m.slug || !owner) {
        add("high", tag, `${m.name} → no roster mon (slug ${m.slug}, form ${m.formKey})`);
        continue;
      }
      if (m.formKey && !(formOf.get(m.slug)?.p.forms ?? []).some((f) => f.key === m.formKey))
        add("high", tag, `${m.formLabel} formKey ${m.formKey} isn't a form of ${m.slug}`);
      if (!m.sprite) add("medium", tag, `${m.formLabel} has no sprite`);
      if ((m.moves?.length ?? 0) < 1 || (m.moves?.length ?? 0) > 4)
        add("medium", tag, `${m.formLabel} has ${m.moves?.length ?? 0} moves (expected 1–4)`);
      // An unmodeled form (e.g. Lycanroc-Dusk) resolves to the BASE species, whose
      // abilities/movepool describe the base, not the form — so ability/move
      // legality can't be judged and the checks below would false-positive. Skip.
      const unmodeled = !m.formKey && m.formLabel !== formOf.get(m.slug)?.p.displayName;
      // Legal ability for the resolved form (curated Mega abilities included).
      if (!unmodeled && m.ability && !new Set(owner.abilities.map(stripId)).has(stripId(m.ability)))
        add("medium", tag, `${m.formLabel} ability "${m.ability}" not in its known abilities`);
      // In-movepool moves (a miss usually flags a real PokeAPI/Showdown learnset hole).
      for (const mv of m.moves ?? []) {
        const slug = displayToSlug.get(stripId(mv));
        if (!unmodeled && slug && !owner.moveSlugs.includes(slug))
          add("low", tag, `${m.formLabel} runs ${mv} — outside the baked movepool (learnset hole?)`);
      }
    }
  }
} catch (e) {
  add("high", "TEAMS", `could not audit teams.json: ${e.message}`);
}

// --- Report ------------------------------------------------------------------
console.log(`Data audit — ${comp.meta.format} ${comp.meta.month} · generated ${comp.meta.generatedAt}\n`);
if (!OFFLINE) await liveChecks();

const total = findings.high.length + findings.medium.length + findings.low.length;
for (const sev of ["high", "medium", "low"]) {
  const list = findings[sev];
  if (!list.length) continue;
  console.log(`\n  ${sev.toUpperCase()} (${list.length}):`);
  for (const f of list.slice(0, 40)) console.log(`    • ${f}`);
  if (list.length > 40) console.log(`    …(+${list.length - 40} more)`);
}
console.log(
  total === 0
    ? "\n✓ No data-integrity issues found."
    : `\n${findings.high.length} high · ${findings.medium.length} medium · ${findings.low.length} low`,
);
process.exit(findings.high.length ? 1 : 0);
