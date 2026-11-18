// @ts-check
/**
 * One-command project context: what data is baked, how fresh it is, and
 * whether the known integrity invariants still hold. Run this at the start
 * of any working session (`npm run status`) instead of re-deriving state.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PINNED_SHOWDOWN_SHA } from "./showdown-data.mjs";
import { UNMODELED_SHOWDOWN_FORMS } from "./species-aliases.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

const dex = read("src/data/generated/pokemon.json");
const comp = read("src/data/generated/competitive.json");
let teams = null;
try {
  teams = read("src/data/generated/teams.json");
} catch {
  // teams.json is optional context; its own check below turns a miss red.
}

const rosterFile = read("src/data/roster.json");
const mons = dex.pokemon;
const byName = new Map(mons.map((p) => [p.name, p]));

console.log("Champions Pokédex — data status\n");
console.log(`  roster: ${mons.length} Pokémon · ${Object.keys(dex.moves).length} moves · generated ${dex.generatedAt ?? "?"}`);
console.log(`  game data: Showdown champions mod @ ${dex.sources?.showdown?.commit?.slice(0, 10) ?? "?"} (pinned ${PINNED_SHOWDOWN_SHA.slice(0, 10)})`);
console.log(`  ladder: ${comp.meta.format} · ${comp.meta.month} · ${comp.meta.battles.toLocaleString()} battles · generated ${comp.meta.generatedAt ?? "?"}`);
for (const [bracket, profiles] of Object.entries(comp.brackets)) {
  const benched = Object.values(profiles).filter((p) => p.benchmarks?.length).length;
  console.log(
    `  bracket ${bracket} (“${comp.meta.bracketLabels?.[bracket] ?? bracket}”): ${Object.keys(profiles).length} profiles` +
      (benched ? ` · ${benched} with KO benchmarks` : ""),
  );
}
if (teams) {
  console.log(
    `  meta teams: ${teams.teams.length} real teams · top ${teams.meta.topN} featured · ${teams.meta.regulationLabel} · generated ${teams.meta.generatedAt ?? "?"}`,
  );
}

// --- Description completeness ----------------------------------------------
// Nothing the app renders may open to a blank sheet or be un-tappable. These
// guard the "opened a move/item and there was no description" class of bug for
// CURRENT and FUTURE data — a new move/item/ability that ships without a
// description (or an item with no detail) turns this red instead of slipping by.
// "Blank" is stricter than empty: a description that's whitespace, a known junk
// stub ("null", "N/A", "-", "?"), or under 3 non-space chars is as useless to a
// trainer as none at all, so the guards treat it as a gap too.
const JUNK_DESC = /^(null|undefined|none|n\/?a|tbd|-+|\.+|\?+)$/i;
const blank = (s) => {
  const t = String(s ?? "").trim();
  return !t || t.length < 3 || JUNK_DESC.test(t);
};
const moveIndex = dex.moves ?? {};

// Moves whose sheet would render no description (both effect fields empty).
const movesNoDesc = Object.values(moveIndex).filter((m) => blank(m.effect) && blank(m.shortEffect));

// Every move slug the app references must resolve in the shared move index.
const referencedMoves = new Set();
for (const p of mons) for (const s of p.moveSlugs ?? []) referencedMoves.add(s);
for (const b of Object.values(comp.brackets ?? {})) {
  for (const pr of Object.values(b)) {
    for (const s of Object.keys(pr.moveUsage ?? {})) referencedMoves.add(s);
    for (const t of pr.setupThreats ?? []) if (t.slug) referencedMoves.add(t.slug);
    for (const bm of pr.benchmarks ?? []) if (bm.move) referencedMoves.add(bm.move);
  }
}
const orphanMoves = [...referencedMoves].filter((s) => !moveIndex[s]);

// Every ability the app shows (base + every form) must carry effect text.
const abilNoDesc = [];
for (const p of mons) {
  // A mon that ships with NO base abilities renders an empty "Abilities" section
  // — [].every() is vacuously true, so guard the length explicitly (as forms do).
  if (!(p.abilities?.length)) abilNoDesc.push(`${p.name} (no abilities)`);
  for (const a of p.abilities ?? []) if (blank(a.shortEffect)) abilNoDesc.push(`${p.name}:${a.displayName}`);
  for (const f of p.forms ?? []) {
    if (!(f.abilities?.length)) abilNoDesc.push(`${f.key}:(no abilities)`);
    for (const a of f.abilities ?? []) if (blank(a.shortEffect)) abilNoDesc.push(`${f.key}:${a.displayName}`);
  }
}

// Every item shown in "Common Items" must be tappable (non-null slug) AND
// resolve to an itemIndex entry that has a description.
const itemIndex = comp.itemIndex ?? {};
const itemGaps = new Set();
for (const b of Object.values(comp.brackets ?? {})) {
  for (const pr of Object.values(b)) {
    for (const it of pr.items ?? []) {
      if (!it.slug) itemGaps.add(`${it.displayName} (no slug → not tappable)`);
      else if (!itemIndex[it.slug]) itemGaps.add(`${it.displayName} (no detail)`);
      else if (blank(itemIndex[it.slug].effect) && blank(itemIndex[it.slug].shortEffect))
        itemGaps.add(`${it.displayName} (blank description)`);
    }
  }
}
const sample = (arr) => [...arr].slice(0, 8).join(", ") + (([...arr].length > 8) ? ` …(+${[...arr].length - 8})` : "");

// --- Coverage floors -------------------------------------------------------
// A regulation rotation can quietly change how Smogon names species (a new
// suffix, a slugify drift), collapsing the name-match so almost no profile
// attaches. The per-description checks still pass (a few profiles keep moves),
// so without a coverage floor a near-empty dataset would ship green. These turn
// a collapse — and a total KO-benchmark wipeout — red.
const hasAnyData = (p, b) =>
  [p.name, ...(p.forms ?? []).map((f) => f.key)].some((k) => b?.[k]);
// Measured over ESTABLISHED mons only. Newcomers carry no ladder data by
// definition — that's what `isNew` means — so counting them would make a
// roster expansion (29 mons for v1.2.0 / Reg M-C) look like a data collapse,
// and the honest fix would get mistaken for "just lower the floor".
const established = mons.filter((p) => !p.isNew);
const coveredAll = established.filter((p) => hasAnyData(p, comp.brackets.all)).length;
const coverageFloor = established.length - 25; // ~full today; trips on a match collapse
const benchedMaster = Object.values(comp.brackets.master ?? {}).filter(
  (p) => p.benchmarks?.length,
).length;

// --- Meta teams ------------------------------------------------------------
// Real tournament teams baked from Smogon's sample-teams thread. Guard the
// "team card renders a blank tile / dead link" class of bug: every member must
// resolve to a roster mon and carry a full set, and every team must be complete.
const teamIssues = new Set();
// A LINKED member must BE the page/form its card opens: same label, an ability
// that form really has, same types. The generator once fell back to the base
// species for an unmodeled form, so the Reg M-B "Lycanroc Dusk" (Tough Claws)
// opened the Midday-only Lycanroc page (Keen Eye / Sand Rush / Steadfast) and
// every check here stayed green. Unlinked (slug null) is fine ONLY for a form
// the roster deliberately doesn't model (UNMODELED_SHOWDOWN_FORMS).
const teamLinkIssues = new Set();
const unlinkedMembers = new Set();
const sid = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
if (teams) {
  for (const t of teams.teams ?? []) {
    if ((t.members?.length ?? 0) !== 6) teamIssues.add(`${t.slug}: ${t.members?.length ?? 0}/6 mons`);
    for (const m of t.members ?? []) {
      if (!m.slug && Object.hasOwn(UNMODELED_SHOWDOWN_FORMS, sid(m.formLabel))) unlinkedMembers.add(m.formLabel);
      else if (!m.slug || !byName.has(m.slug)) teamIssues.add(`${t.slug}: ${m.formLabel ?? m.name} → no roster mon`);
      if (!m.sprite) teamIssues.add(`${t.slug}: ${m.formLabel} has no sprite`);
      else if (!m.ability) teamIssues.add(`${t.slug}: ${m.formLabel} has no ability`);
      else if (!(m.moves?.length)) teamIssues.add(`${t.slug}: ${m.formLabel} has no moves`);
      const page = m.slug ? byName.get(m.slug) : undefined;
      if (!page) continue;
      // A modeled form key must point at a real form of that species.
      const dest = m.formKey ? (page.forms ?? []).find((f) => f.key === m.formKey) : page;
      if (!dest) {
        teamIssues.add(`${t.slug}: ${m.formLabel} formKey ${m.formKey} unknown`);
        continue;
      }
      const destLabel = m.formKey ? dest.label : page.displayName;
      const at = `${t.slug}: ${m.formLabel} → ${m.slug}${m.formKey ? `?form=${m.formKey}` : ""}`;
      if (m.formLabel !== destLabel) teamLinkIssues.add(`${at} is "${destLabel}"`);
      if (m.ability && !(dest.abilities ?? []).some((a) => sid(a.displayName) === sid(m.ability) || sid(a.name) === sid(m.ability)))
        teamLinkIssues.add(`${at}: ${m.ability} isn't its ability (${(dest.abilities ?? []).map((a) => a.displayName).join(" / ")})`);
      if ((m.types ?? []).join("/") !== (dest.types ?? []).join("/"))
        teamLinkIssues.add(`${at}: types ${(m.types ?? []).join("/")} ≠ ${(dest.types ?? []).join("/")}`);
    }
  }
}

// --- Ladder species no page claims -------------------------------------------
// The generator records every ladder species (≥0.5% usage) that no roster page
// resolved to. A big one means a whole page shipped without its data and every
// teammate link to it went dead — Indeedee-F (22% of Reg M-C teams) baked blank
// on 2026-10-01 because Showdown says "Indeedee-F" where the roster says
// "indeedee-female", and the generator's warning scrolled past in a CI log.
const UNMATCHED_FAIL_PCT = 2;
const unmatchedByBracket = comp.meta.unmatched;
const unmatched = Object.entries(unmatchedByBracket ?? {}).flatMap(([bracket, list]) =>
  list.map((u) => ({ ...u, bracket })),
);
const bigUnmatched = unmatched.filter((u) => u.usagePct >= UNMATCHED_FAIL_PCT);
const smallUnmatched = [...new Set(unmatched.filter((u) => u.usagePct < UNMATCHED_FAIL_PCT).map((u) => u.key))];

// --- Champions game data (Showdown's champions mod, pinned) -------------------
// Movepools, move patches and the roster check all come from ONE pinned
// Showdown commit; a bake from any other commit (a SHOWDOWN_SHA trial left in)
// is not reproducible from the code, so it fails here.
const sources = dex.sources ?? {};
const movepoolSources = sources.movepools ?? {};
const noMovepoolSource = mons.filter((p) => !movepoolSources[p.name]).map((p) => p.name);
const rosterCheck = sources.rosterCheck;
const rosterGaps = rosterCheck ? [...rosterCheck.unclaimedLegal, ...rosterCheck.illegalForms.map((k) => `${k} (not legal)`)] : null;
// Champions' PP scale (scripts.ts): base PP capped at 20, in-battle (pp/5+1)×4.
// 1 is the one legal exception — a move that takes no PP Ups keeps its base PP
// (Revival Blessing, Pawmot's 67%-usage signature move).
const offScalePP = Object.values(moveIndex).filter((m) => ![1, 8, 12, 16, 20].includes(m.pp)).map((m) => `${m.name}=${m.pp}`);
// Calc.tsx's fixed item list vs Showdown's Champions item pool — the calc must
// never offer an item a trainer can't bring (it once offered Choice Band/Specs).
const itemPool = new Set(dex.itemPool ?? []);
const calcSrc = readFileSync(resolve(ROOT, "src/components/Calc.tsx"), "utf8");
const calcItems = [...(calcSrc.match(/const ITEMS = \[([\s\S]*?)\] as const;/)?.[1] ?? "").matchAll(/"([^"]+)"/g)]
  .map((m) => m[1])
  .filter((n) => n !== "None");
const calcItemsOutsidePool = calcItems.filter((n) => !itemPool.has(n));
const MAINLINE_ONLY_ITEMS = ["Choice Band", "Choice Specs", "Assault Vest", "Eviolite", "Safety Goggles", "Covert Cloak", "Booster Energy"];
const droppedLadderMoves = comp.meta.droppedMoves;
// Weight per page AND form (Low Kick / Grass Knot / Heavy Slam / Heat Crash).
// Forms used to carry none, so the calc gave every Mega its base's weight.
const formsWithoutWeight = mons.flatMap((p) => (p.forms ?? []).filter((f) => !(f.weightKg > 0)).map((f) => f.key));
const steelixMegaKg = (byName.get("steelix")?.forms ?? []).find((f) => f.key === "steelix-mega")?.weightKg;
// PokeAPI serves 0 where there is no number (power on SV-era status moves, Hard
// Press; accuracy on Dragon Cheer) — the move sheet printed "Power 0" / "Acc 0".
const zeroNumbers = Object.values(moveIndex)
  .filter((m) => m.power === 0 || m.accuracy === 0)
  .map((m) => `${m.name} (${m.power === 0 ? "power" : "accuracy"} 0)`);
// An item sheet with a generated placeholder although Showdown (pinned) has the
// real text — the three v1.2.0 Z stones read "Absolite Z — a held item used in
// Pokémon Champions." until 2026-11-18.
const itemTextById = new Map(Object.entries(dex.itemText ?? {}).map(([n, t]) => [n.toLowerCase().replace(/[^a-z0-9]/g, ""), t]));
const PLACEHOLDER_ITEM_TEXT = /— a held item used in Pokémon Champions\.$|^A Mega Stone\. Its holder can Mega Evolve during battle\.$/;
const placeholderItems = Object.values(itemIndex)
  .filter((it) => PLACEHOLDER_ITEM_TEXT.test(it.shortEffect ?? "") && itemTextById.has(it.slug.replace(/[^a-z0-9]/g, "")))
  .map((it) => it.displayName);
// …and every Mega Stone's sheet says so, suffixed ones included: "…ite", "…ite X/Y"
// and v1.2.0's "…ite Z" (the Z stones had no category until 2026-11-18 — the
// generator's stone pattern stopped at X/Y). Eviolite is the one non-stone "-ite".
const uncategorizedStones = Object.values(itemIndex)
  .filter((it) => /ite(?: [A-Z])?$/.test(it.displayName) && it.displayName !== "Eviolite" && it.category !== "Mega Stones")
  .map((it) => it.displayName);
// isNew is stamped from roster.json `newcomers` — exactly those, nothing else.
const newcomerList = rosterFile.newcomers ?? [];
const flaggedNew = mons.filter((p) => p.isNew).map((p) => p.name).sort();
const newcomersMatch = JSON.stringify(flaggedNew) === JSON.stringify([...newcomerList].sort());
// A newcomer with a ladder profile of its OWN (either bracket) is due for pruning
// per roster.json's note — the 29 Reg M-C mons kept the NEW badge for two months
// of ladder data because nothing said so. A soft warning: pruning is a data edit.
const newcomersWithData = newcomerList.filter((s) => comp.brackets.all?.[s] || comp.brackets.master?.[s]);

// Integrity invariants — each guards a bug this project actually hit once.
const checks = [
  ["no Tera moves anywhere (Champions has no Tera)", mons.every((p) => !p.moveSlugs.includes("tera-blast"))],
  // Movepools are Showdown's per-form Champions learnsets. These pin moves that
  // once went missing (PokeAPI's Ninetales-Alola hole; Head Smash living only on
  // the prevo in mainline data) and forms that once leaked a sibling's moves
  // (Serebii's species pages are multi-form unions).
  ["Alolan Ninetales keeps Freeze-Dry (once a PokeAPI learnset hole)", byName.get("ninetales-alola")?.moveSlugs.includes("freeze-dry") ?? false],
  ["Hisuian Arcanine keeps Head Smash (mainline data keeps it on the prevo)", byName.get("arcanine-hisui")?.moveSlugs.includes("head-smash") ?? false],
  ["Wash Rotom doesn't carry Heat Rotom's Overheat", !(byName.get("rotom-wash")?.moveSlugs.includes("overheat") ?? true)],
  [
    "per-form movepools: no sibling-form leaks (Indeedee-F, Midday Lycanroc)",
    !(byName.get("indeedee-female")?.moveSlugs.includes("expanding-force") ?? true) &&
      !(byName.get("lycanroc")?.moveSlugs.includes("counter") ?? true),
    "Indeedee-F has Indeedee-M's Expanding Force or Lycanroc has Midnight's Counter — a movepool is a multi-form union again, not the form's own Champions learnset",
  ],
  [
    "signature moves present (Aegislash King's Shield, Trevenant Forest's Curse)",
    (byName.get("aegislash")?.moveSlugs.includes("kings-shield") ?? false) &&
      (byName.get("trevenant")?.moveSlugs.includes("forests-curse") ?? false),
    "a signature move is missing — the Serebii-era tables lacked both, which also dropped them from the ladder data (89% / 44% usage)",
  ],
  [
    "movepools baked from the pinned Showdown champions mod",
    sources.showdown?.commit === PINNED_SHOWDOWN_SHA && noMovepoolSource.length === 0,
    sources.showdown?.commit !== PINNED_SHOWDOWN_SHA
      ? `pokemon.json was baked from ${sources.showdown?.commit ?? "no Showdown commit"}, pinned is ${PINNED_SHOWDOWN_SHA} — re-run \`npm run data\` (or bump PINNED_SHOWDOWN_SHA in scripts/showdown-data.mjs)`
      : `${noMovepoolSource.length} mons have no Showdown learnset recorded: ${sample(noMovepoolSource)}`,
  ],
  [
    "roster = Showdown's Champions-legal species/forms",
    !!rosterGaps && rosterGaps.length === 0,
    rosterGaps
      ? `${sample(rosterGaps)} — add to roster.json, or to UNMODELED_SHOWDOWN_FORMS / an alias in scripts/species-aliases.mjs`
      : "pokemon.json predates the roster check — run `npm run data`",
  ],
  // PokeAPI supplies stats/types; they must be the Champions species' (Floette
  // once showed mainline Red-Flower stats under a Floette-Eternal movepool).
  [
    "every page/form's base stats + types = Showdown's Champions species",
    Array.isArray(rosterCheck?.statMismatches) && rosterCheck.statMismatches.length === 0,
    Array.isArray(rosterCheck?.statMismatches)
      ? `${sample(rosterCheck.statMismatches)} — map the slug to the right PokeAPI variety (ROSTER_TO_POKEAPI_POKEMON in scripts/species-aliases.mjs)`
      : "pokemon.json predates the stat cross-check — run `npm run data`",
  ],
  // Weight moves read the FORM's weight (Mega Steelix 740 kg, Mega Sableye 161 —
  // not their base's 400 / 11); PokeAPI's per-form value is held to Showdown's.
  [
    "every page/form's weight = Showdown's Champions species (Low Kick / Grass Knot / Heavy Slam)",
    Array.isArray(rosterCheck?.weightMismatches) && rosterCheck.weightMismatches.length === 0 &&
      formsWithoutWeight.length === 0 && steelixMegaKg === 740,
    !Array.isArray(rosterCheck?.weightMismatches)
      ? "pokemon.json predates the weight cross-check — run `npm run data`"
      : formsWithoutWeight.length
        ? `${formsWithoutWeight.length} forms carry no weight: ${sample(formsWithoutWeight)} — buildForm must bake weightKg`
        : rosterCheck.weightMismatches.length
          ? `${sample(rosterCheck.weightMismatches)} — fix the PokeAPI variety, or document it in WEIGHT_CHECK_EXCEPTIONS (scripts/species-aliases.mjs)`
          : `Mega Steelix weighs ${steelixMegaKg} kg, expected 740 — a form is carrying its base's weight again`,
  ],
  ["master bracket present with usable move data", Object.values(comp.brackets.master ?? {}).some((p) => Object.keys(p.moveUsage).length > 3)],
  ["both data files agree on generation date", dex.generatedAt === comp.meta.generatedAt],
  // Every Mega/Primal form must carry its ability — PokeAPI serves some
  // Champions-original Megas ability-less, and a Mega's ability is its single
  // most battle-defining fact (Mega Mawile's Huge Power, Mega Eelektross's Eelevate).
  ["every battle form carries an ability", mons.every((p) => (p.forms ?? []).every((f) => f.abilities?.length > 0 && f.abilities.every((a) => a.shortEffect)))],
  // Newcomers (no ladder data yet) are flagged so the NEW badge + filter work —
  // exactly roster.json's list (it may be empty between regulations).
  [
    "new-to-Champions mons are flagged isNew (= roster.json newcomers)",
    newcomersMatch,
    `isNew on [${flaggedNew.join(", ")}] but roster.json lists [${newcomerList.join(", ")}] — re-run \`npm run data\``,
  ],
  // Z Mega Evolution (v1.2.0). The form matcher in generate-dataset.mjs used to
  // reject `-mega-z` as an API-only junk variant; if anyone re-tightens it, the
  // three Z Megas vanish from the dex silently. A species can carry BOTH a plain
  // Mega and a Mega Z, so assert both survive.
  [
    "Z Megas are baked alongside their plain Mega (v1.2.0)",
    ["lucario", "garchomp", "absol"].every((s) => {
      const keys = (byName.get(s)?.forms ?? []).map((f) => f.key);
      return keys.includes(`${s}-mega`) && keys.includes(`${s}-mega-z`);
    }),
    "a Z Mega (or its plain Mega) is missing — check BATTLE_FORM_RE",
  ],
  // Champions balance patches vs upstream sources. PokeAPI serves MAINLINE move
  // stats; the champions mod's moves.ts + PP rule are layered over them, so a
  // patched value only exists if that layer ran (v1.2.0: Wish/Strength Sap 12 → 8).
  [
    "Champions PP from Showdown's champions mod (Wish / Strength Sap = 8)",
    moveIndex["wish"]?.pp === 8 && moveIndex["strength-sap"]?.pp === 8,
    `wish=${moveIndex["wish"]?.pp}, strength-sap=${moveIndex["strength-sap"]?.pp} — expected 8 (applyChampionsMove in generate-dataset.mjs)`,
  ],
  [
    "every move's PP is on Champions' 8/12/16/20 scale",
    offScalePP.length === 0,
    `${offScalePP.length} moves carry mainline PP: ${sample(offScalePP)} — the Champions PP layer didn't run`,
  ],
  [
    "no move shows a placeholder 0 power / 0% accuracy (no number = —)",
    zeroNumbers.length === 0,
    `${sample(zeroNumbers)} — buildMove in generate-dataset.mjs must keep PokeAPI's 0 out (\`|| null\`)`,
  ],
  // The champions mod retargets Milk Drink to the user OR an ally, but neither
  // source's text says so (LOCAL_MOVE_OVERRIDES carries the Champions text).
  [
    "Milk Drink's text says it can heal an ally (Champions retarget)",
    moveIndex["milk-drink"]?.target === "user-or-ally" && /ally/.test(moveIndex["milk-drink"]?.shortEffect ?? ""),
    `target=${moveIndex["milk-drink"]?.target}, text="${moveIndex["milk-drink"]?.shortEffect}"`,
  ],
  // The other half of that split: MOVEPOOLS are the champions mod's learnsets,
  // so v1.2.0's legality changes need no curation. A mainline movepool would
  // bring these three removals straight back — they are the canary (the Serebii
  // era's silent 404 → mainline fallback bit 11 Reg M-C newcomers this way).
  [
    "v1.2.0 movepool removals held (Champions learnsets, not mainline)",
    !(byName.get("politoed")?.moveSlugs.includes("pound") ?? true) &&
      !(byName.get("archaludon")?.moveSlugs.includes("mirror-coat") ?? true) &&
      !(byName.get("archaludon")?.moveSlugs.includes("metal-burst") ?? true),
    "a move v1.2.0 removed is back — a movepool is not the pinned Champions learnset (mainline data, or a regressed SHA bump)",
  ],
  // Champions' held-item pool is not mainline's (Showdown's champions items.ts).
  [
    `Calc's item list is all Champions items (${calcItems.length} vs Showdown's pool of ${itemPool.size})`,
    calcItems.length > 10 && calcItemsOutsidePool.length === 0 && MAINLINE_ONLY_ITEMS.every((n) => !itemPool.has(n)),
    calcItems.length <= 10
      ? "couldn't read the ITEMS list out of src/components/Calc.tsx"
      : calcItemsOutsidePool.length
        ? `not in Champions: ${calcItemsOutsidePool.join(", ")}`
        : `Showdown's pool now has ${MAINLINE_ONLY_ITEMS.filter((n) => itemPool.has(n)).join(", ")} — revisit the Calc ITEMS note`,
  ],
  // A ladder move with no move-index entry silently vanished from its page
  // (King's Shield, 89% of Aegislash, until the Showdown switch).
  [
    "every ladder move ≥3% resolves in the move index",
    Array.isArray(droppedLadderMoves) && droppedLadderMoves.length === 0,
    Array.isArray(droppedLadderMoves)
      ? `${sample(droppedLadderMoves.map((d) => `${d.key} ${d.move} ${d.pct}%`))} — the pinned Showdown learnsets lag the ladder: bump PINNED_SHOWDOWN_SHA`
      : "competitive.json predates the dropped-move record — run `npm run data:comp`",
  ],
  // Ladder coverage floors — catch a silent name-matching collapse / benchmark wipeout.
  [
    `every ladder species ≥${UNMATCHED_FAIL_PCT}% resolves to a page (Showdown ↔ roster names)`,
    !!unmatchedByBracket && bigUnmatched.length === 0,
    unmatchedByBracket
      ? `${sample(bigUnmatched.map((u) => `${u.key} ${u.usagePct}% (${u.bracket})`))} — add to scripts/species-aliases.mjs (or roster.json if truly missing)`
      : "competitive.json predates the unmatched list — run `npm run data:comp`",
  ],
  [`ladder coverage intact (≥${coverageFloor} mons have all-ranks data)`, coveredAll >= coverageFloor, `only ${coveredAll}/${established.length} established (non-newcomer) mons have any all-ranks data`],
  ["master bracket has KO benchmarks baked", benchedMaster >= 40, `only ${benchedMaster} master profiles carry benchmarks`],
  // --- no blank/un-tappable sheets, current or future ---
  [`every move shows a description (${Object.keys(moveIndex).length} moves)`, movesNoDesc.length === 0, `${movesNoDesc.length} blank: ${sample(movesNoDesc.map((m) => m.name))}`],
  ["every referenced move resolves in the move index", orphanMoves.length === 0, `${orphanMoves.length} orphans: ${sample(orphanMoves)}`],
  ["every ability (base + form) has effect text", abilNoDesc.length === 0, `${abilNoDesc.length} blank: ${sample(abilNoDesc)}`],
  ["every shown item is tappable with a description", itemGaps.size === 0, `${itemGaps.size} gaps: ${sample(itemGaps)}`],
  [
    "no item sheet shows a generated placeholder Showdown has real text for",
    !!dex.itemText && placeholderItems.length === 0,
    dex.itemText
      ? `${sample(placeholderItems)} — synthDetail in generate-competitive.mjs should read pokemon.json's itemText (then \`npm run data:comp\`)`
      : "pokemon.json predates itemText — run `npm run data` then `npm run data:comp`",
  ],
  [
    "every Mega Stone sheet is categorized Mega Stones (Z stones too)",
    uncategorizedStones.length === 0,
    `${sample(uncategorizedStones)} — isMegaStone in generate-competitive.mjs misses a suffix`,
  ],
  // --- meta teams: real, complete, and fully resolvable ---
  [`meta teams present (≥5, from ${teams?.meta.regulationLabel ?? "?"})`, !!teams && (teams.teams?.length ?? 0) >= 5, teams ? `only ${teams.teams.length} teams` : "teams.json missing — run `npm run data:teams`"],
  ["every meta-team member resolves to a roster mon with a full set", teamIssues.size === 0, `${teamIssues.size} issues: ${sample(teamIssues)}`],
  [
    "every linked meta-team member IS the page/form it opens (label · ability · types)",
    teamLinkIssues.size === 0,
    `${teamLinkIssues.size} wrong links: ${sample(teamLinkIssues)} — fix the resolver / SHOWDOWN_TO_ROSTER / UNMODELED_SHOWDOWN_FORMS, then \`node scripts/generate-teams.mjs --relink\` (offline)`,
  ],
];

console.log("");
let failed = 0;
for (const [label, ok, detail] of checks) {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) {
    failed++;
    if (detail) console.log(`      ↳ ${detail}`);
  }
}

const ageDays = dex.generatedAt
  ? Math.floor((Date.now() - new Date(dex.generatedAt).getTime()) / 86400000)
  : null;
if (ageDays != null && ageDays > 14) {
  console.log(`\n  ⚠ data is ${ageDays} days old — consider \`npm run data:all\``);
}

if (newcomersWithData.length) {
  console.log(
    `\n  ⚠ newcomers with their own ladder data: ${newcomersWithData.join(", ")} — prune them from roster.json \`newcomers\` (its newcomersNote has the rule), then \`npm run data\``,
  );
}

if (smallUnmatched.length) {
  console.log(
    `\n  ⚠ ladder species (0.5–${UNMATCHED_FAIL_PCT}%) with no page: ${smallUnmatched.join(", ")} — unmodeled forms fall back to the base species`,
  );
}

if (unlinkedMembers.size) {
  console.log(
    `\n  ⚠ meta-team member(s) with no scouting link (form the roster doesn't model): ${sample(unlinkedMembers)}`,
  );
}

// Soft freshness note: the teams generator pins its date to the competitive
// snapshot, so a divergence means teams were salvaged (a fetch blip) and are a
// snapshot behind — worth surfacing, but not a hard failure (salvage is by design).
if (teams && teams.meta.generatedAt !== comp.meta.generatedAt) {
  console.log(
    `\n  ⚠ meta teams (${teams.meta.generatedAt}) are behind the ladder snapshot (${comp.meta.generatedAt}) — re-run \`npm run data:teams\``,
  );
}

process.exit(failed ? 1 : 0);
