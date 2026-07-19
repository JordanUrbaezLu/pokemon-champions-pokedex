// @ts-check
/**
 * Build-time competitive-layer generator.
 *
 * Pokémon Champions is a DOUBLES game, so the competitive data comes from the
 * Champions VGC (doubles) Smogon ladder — not singles. Per roster Pokémon (and
 * per Mega form) we distill: most-common ability, a typical set (top
 * moves/item/spread), usage %, common teammates, and set-up moves to watch for.
 *
 * Champions has no Terastallization, so no Tera is surfaced.
 *
 * Output: src/data/generated/competitive.json (committed, keyed by FORM key —
 * the base slug for the base form, the Mega slug for each Mega form).
 * Run with: `npm run data:comp`  (needs pokemon.json from `npm run data` first).
 */

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { calculate, Generations, Pokemon, Move, Field } from "@smogon/calc";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROSTER_PATH = resolve(ROOT, "src/data/roster.json");
const POKEMON_PATH = resolve(ROOT, "src/data/generated/pokemon.json");
const OUT_PATH = resolve(ROOT, "src/data/generated/competitive.json");
const SW_PATH = resolve(ROOT, "public/sw.js");

// Champions VGC (doubles). Both the ladder REGULATION (…regma → …regmb → …) and
// the stats MONTH are auto-detected at run time, so every run tracks the game's
// *current* regulation and the freshest published month with no code edit when
// the game rotates regulations. (The weekly refresh Action only re-bakes; this
// is what keeps it from silently serving a dead regulation.) Pin either when
// reproducing an exact snapshot:
//   STATS_FORMAT=gen9championsvgc2026regmb   STATS_MONTH=YYYY-MM
const FORMAT_OVERRIDE = process.env.STATS_FORMAT || null;
const MONTH_OVERRIDE = process.env.STATS_MONTH || null;
// The app ships TWO complete brackets and toggles between them client-side:
//  - master: Smogon's top cutoffs — 1760 primary, 1630 backfilling mons the
//    top bracket lacks (a high-rated player's games appear in both files, so
//    "primary + backfill" is the correct way to combine them — never add).
//  - all: the whole-ladder file, every rank.
const BRACKETS = {
  master: { cutoffs: ["1760", "1630"], label: "Master+ (top ladder brackets)" },
  all: { cutoffs: ["0"], label: "all ranks" },
};
const statsUrl = (format, month, cutoff) =>
  `https://www.smogon.com/stats/${month}/chaos/${format}-${cutoff}.json`;

/** "gen9championsvgc2026regmb" → "Reg M-B" (best-effort; raw id if unparseable). */
function regulationLabel(format) {
  const m = format.match(/reg([a-z])([a-z])$/);
  return m ? `Reg ${m[1].toUpperCase()}-${m[2].toUpperCase()}` : format;
}

/** Every base Champions-VGC doubles regulation id with a published all-ranks
 *  file in `month` (the …bo3 best-of-three variants are deliberately excluded). */
async function championsFormatsForMonth(month) {
  const res = await fetch(`https://www.smogon.com/stats/${month}/chaos/`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) return [];
  const text = await res.text();
  const files = new Set(
    [...text.matchAll(/(gen9championsvgc\d{4}reg[a-z]+-\d+)\.json/g)].map((m) => m[1]),
  );
  const bases = [...new Set(
    [...text.matchAll(/(gen9championsvgc\d{4}reg[a-z]+)-0\.json/g)].map((m) => m[1]),
  )];
  // Only surface a format once EVERY cutoff we bake has published. A freshly
  // rotated regulation posts its -0 (all-ranks) file first; selecting it before
  // its 1630/1760 chaos files exist would hard-fail the whole refresh when we
  // fetch those (getJson retries then throws). Waiting a run costs nothing.
  const need = [...new Set(Object.values(BRACKETS).flatMap((b) => b.cutoffs))];
  return bases.filter((f) => need.every((c) => files.has(`${f}-${c}`)));
}

/**
 * Resolve the freshest { format, month }: the newest published month, and within
 * it the newest REGULATION. Format ids sort lexically in release order
 * (…regmb > …regma; a future …regmc > …regmb; the m→n series and the year prefix
 * all sort correctly), so `.sort().at(-1)` is "the current regulation". Honors
 * STATS_FORMAT / STATS_MONTH pins.
 */
async function resolveFormatAndMonth() {
  let months;
  if (MONTH_OVERRIDE) {
    months = [MONTH_OVERRIDE];
  } else {
    const index = await fetch("https://www.smogon.com/stats/", {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!index.ok) throw new Error(`stats index: HTTP ${index.status}`);
    months = [...new Set(
      [...(await index.text()).matchAll(/href="(\d{4}-\d{2})\//g)].map((m) => m[1]),
    )].sort().reverse().slice(0, 6);
  }
  // Walk newest-first; a month can exist before the format publishes into it.
  for (const month of months) {
    if (FORMAT_OVERRIDE) {
      const probe = await fetch(
        statsUrl(FORMAT_OVERRIDE, month, BRACKETS.all.cutoffs[0]),
        { method: "HEAD", headers: { "User-Agent": USER_AGENT } },
      );
      if (probe.ok) return { format: FORMAT_OVERRIDE, month };
      continue;
    }
    const formats = await championsFormatsForMonth(month);
    if (formats.length) return { format: formats.sort().at(-1), month };
  }
  throw new Error(`no published Champions VGC stats found in ${months.join(", ")}`);
}
const ITEMS_URL = "https://pokeapi.co/api/v2/item?limit=3000";

const USER_AGENT = "Mozilla/5.0 (compatible; ChampionsPokedexBuild/1.0)";

// Set-up / threat moves worth a heads-up, as lowercased-stripped ids.
const SETUP_MOVE_IDS = new Set([
  "swordsdance", "dragondance", "calmmind", "nastyplot", "bulkup", "quiverdance",
  "shellsmash", "bellydrum", "geomancy", "noretreat", "victorydance", "tidyup",
  "clangoroussoul", "tailglow", "coil", "workup", "agility", "irondefense",
  "cosmicpower", "curse", "trickroom", "honeclaws", "rockpolish", "shiftgear",
  "growth", "minimize", "acidarmor", "amnesia", "barrier", "stockpile",
]);
const SETUP_THRESHOLD = 0.05; // flag a set-up move if ≥5% of teams run it

// Descriptions for items PokeAPI has neither effect nor flavor text for. Keyed
// by slug; the synth path also matches the un-hyphenated chaos id, so both forms
// are listed for the Champions-original Mega Stones.
const ITEM_OVERRIDES = {
  "fairy-feather": "Powers up the holder's Fairy-type moves.",
  // Mega Raichu X/Y debuted in Champions (Reg M-B) — no PokeAPI item entry.
  "raichunite-x": "A Mega Stone — lets Raichu Mega Evolve into Mega Raichu X.",
  "raichunitex": "A Mega Stone — lets Raichu Mega Evolve into Mega Raichu X.",
  "raichunite-y": "A Mega Stone — lets Raichu Mega Evolve into Mega Raichu Y.",
  "raichunitey": "A Mega Stone — lets Raichu Mega Evolve into Mega Raichu Y.",
};

async function getJson(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (attempt >= 6) throw err;
    await new Promise((r) => setTimeout(r, 700 * attempt));
    return getJson(url, attempt + 1);
  }
}

const stripId = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const toDisplayName = (slug) =>
  slug.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");

/** Smogon display name -> our lowercase-hyphen slug. */
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/\. /g, "-")
    .replace(/\./g, "")
    .replace(/: /g, "-")
    .replace(/:/g, "")
    .replace(/['’]/g, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "-");
}

// In-battle STANCE/form changes (one Pokémon, one set, stats change mid-battle)
// share the base's Smogon set but need their own @smogon/calc species name for
// KO benchmarks.
const STANCE_CALC_NAME = {
  "aegislash-blade": "Aegislash-Blade",
  "palafin-hero": "Palafin-Hero",
};

// Forms that are a genuinely DIFFERENT Pokémon with their OWN Smogon profile
// (different moves/items/spreads) — built from their own chaos key, never
// copied from the base. Basculegion-M is a physical Last Respects attacker;
// Basculegion-F is a special Shadow Ball / Muddy Water attacker.
const FORM_OWN_SMOGON_KEY = {
  "basculegion-female": "Basculegion-F",
};

const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);
const cleanEntries = (obj) => Object.entries(obj).filter(([id]) => id && id !== "nothing");
const topClean = (obj, n) => cleanEntries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);

/** Parse "Nature:hp/atk/def/spa/spd/spe" (EV/8 buckets) into real, ≤508-total EVs. */
function parseSpread(spreadKey) {
  const [nature, evStr] = spreadKey.split(":");
  if (!evStr) return null;
  const raw = evStr.split("/").map(Number);
  const mult = Math.max(...raw) <= 32 ? 8 : 1; // values ≤32 are EV/8 buckets
  const keys = ["hp", "atk", "def", "spa", "spd", "spe"];
  const evs = {};
  keys.forEach((k, i) => {
    if (raw[i] > 0) evs[k] = Math.min(252, raw[i] * mult);
  });
  // Trim the smallest stats until the total is a legal ≤508 (the bucketing
  // rounds 4-EV spare stats up to ~16, pushing canonical 252/252/4 to 520).
  let total = Object.values(evs).reduce((a, b) => a + b, 0);
  while (total > 508) {
    const [k, v] = Object.entries(evs).filter(([, x]) => x > 0).sort((a, b) => a[1] - b[1])[0];
    const cut = Math.min(v, total - 508);
    evs[k] = v - cut;
    if (evs[k] <= 0) delete evs[k];
    total -= cut;
  }
  return { nature, evs };
}

// Natures that lower Speed — the Trick Room tell in the spread distribution.
const SPE_MINUS_NATURES = new Set(["Brave", "Relaxed", "Quiet", "Sassy"]);

/**
 * Distill the FULL spread distribution into how this Pokémon invests in Speed —
 * catches bimodal mons (half max-Speed, half Trick-Room-min) that the single
 * top spread misrepresents. Percentages of total weighted sets.
 */
function speedInvestOf(spreads) {
  const acc = { max: 0, some: 0, none: 0, minus: 0 };
  let total = 0;
  for (const [key, weight] of Object.entries(spreads ?? {})) {
    const [nature, evStr] = key.split(":");
    const raw = (evStr ?? "").split("/").map(Number);
    if (raw.length < 6 || raw.some(Number.isNaN)) continue;
    const mult = Math.max(...raw) <= 32 ? 8 : 1; // EV/8 buckets
    const spe = Math.min(252, raw[5] * mult);
    total += weight;
    if (SPE_MINUS_NATURES.has(nature)) acc.minus += weight;
    else if (spe >= 252) acc.max += weight;
    else if (spe > 0) acc.some += weight;
    else acc.none += weight;
  }
  if (!total) return null;
  const pct = (v) => Math.round((v / total) * 100);
  return { max: pct(acc.max), some: pct(acc.some), none: pct(acc.none), minus: pct(acc.minus) };
}

// Item classes worth a tempo read mid-battle, beyond the top-3 item list.
const ITEM_CLASS = (id) => {
  if (id === "choicescarf") return ["scarf", "choice"];
  if (id === "choiceband" || id === "choicespecs") return ["choice"];
  if (id === "focussash") return ["sash"];
  if (id === "lifeorb") return ["lifeOrb"];
  if (id === "assaultvest") return ["av"];
  if (id.endsWith("berry")) return ["berry"];
  return [];
};

/** % of sets running each item class (scarf/choice/sash/…), from the FULL item table. */
function itemClassesOf(items) {
  const counts = {};
  let total = 0;
  for (const [id, c] of cleanEntries(items ?? {})) {
    total += c;
    for (const cls of ITEM_CLASS(id)) counts[cls] = (counts[cls] ?? 0) + c;
  }
  if (!total) return null;
  const out = {};
  for (const [cls, c] of Object.entries(counts)) {
    const pct = Math.round((c / total) * 100);
    if (pct > 0) out[cls] = pct;
  }
  return Object.keys(out).length ? out : null;
}

// --- Build-time KO benchmarks ----------------------------------------------------
// Champions fixes Lv 50 / 31 IVs and the ladder tells us the common spreads,
// so damage is PRECOMPUTABLE: instead of shipping a calculator that needs six
// inputs mid-battle, we bake "this move OHKOs X / 2HKOs Y" verdicts against
// the top meta at generation time. Powered by @smogon/calc (dev-only).

const GEN = Generations.get(9);
const BENCH_FIELD = new Field({ gameType: "Doubles" });
const SPREAD_TARGETS = new Set(["all-opponents", "all-other-pokemon"]);
const TOP_TARGETS = 16; // benchmark against the mons you actually face
// Items that change damage math meaningfully and that @smogon/calc models.
const DAMAGE_ITEMS = new Set([
  "Life Orb", "Choice Band", "Choice Specs", "Expert Belt", "Assault Vest",
  "Eviolite", "Sitrus Berry",
]);

/** A @smogon/calc Pokemon from a profile (common spread, top item/ability). */
function calcMon(profile, abilityNameOf) {
  const evs = {};
  for (const [k, v] of Object.entries(profile.spread?.evs ?? {})) evs[k] = v;
  const item = profile.items[0]?.displayName;
  return new Pokemon(GEN, profile.smogonName, {
    level: 50,
    nature: profile.spread?.nature ?? "Hardy",
    evs,
    ability: abilityNameOf(profile),
    item: item && DAMAGE_ITEMS.has(item) ? item : undefined,
  });
}

/**
 * For each attacker profile: its likely damaging moves vs the top meta mons,
 * condensed to OHKO / 2HKO lists. Mutates the profile with `benchmarks`.
 */
function bakeBenchmarks(profiles, moveIndex, abilityDisplayById) {
  const abilityNameOf = (profile) => {
    let best = null;
    let bestPct = -1;
    for (const [id, pct] of Object.entries(profile.abilityUsage ?? {})) {
      if (pct > bestPct) {
        best = id;
        bestPct = pct;
      }
    }
    return best ? abilityDisplayById.get(best) : undefined;
  };

  const targets = Object.values(profiles)
    .filter((p) => !p.asForm && p.spread)
    .sort((a, b) => b.usagePct - a.usagePct)
    .slice(0, TOP_TARGETS);

  let baked = 0;
  let skipped = 0;
  for (const profile of Object.values(profiles)) {
    if (profile.asForm || !profile.spread) continue;
    // Top damaging moves by usage — kept in step with the UI "Likely set" (6),
    // so a likely move that actually KOs something carries its verdict. Moves
    // that OHKO/2HKO nothing are dropped below, so weak pivots add no noise.
    const moves = Object.entries(profile.moveUsage)
      .sort((a, b) => b[1] - a[1])
      .map(([slug]) => ({ slug, meta: moveIndex[slug] }))
      .filter(({ meta }) => meta && meta.damageClass !== "status" && meta.power)
      .slice(0, 6);
    if (!moves.length) continue;

    let attacker;
    try {
      attacker = calcMon(profile, abilityNameOf);
    } catch {
      skipped++;
      continue; // species name @smogon/calc doesn't know — skip quietly
    }

    const benchmarks = [];
    for (const { slug, meta } of moves) {
      let move;
      try {
        move = new Move(GEN, meta.displayName);
      } catch {
        continue;
      }
      if (SPREAD_TARGETS.has(meta.target)) move.spreadHit = true;
      const ohko = [];
      const two = [];
      for (const target of targets) {
        if (target.smogonName === profile.smogonName) continue;
        try {
          const result = calculate(GEN, attacker, calcMon(target, abilityNameOf), move, BENCH_FIELD);
          const [min, max] = result.range();
          const hp = result.defender.maxHP();
          if (min >= hp) ohko.push(target.smogonName);
          else if (max * 2 >= hp && min * 2 >= hp) two.push(target.smogonName);
        } catch {
          // one bad target shouldn't kill the move's row
        }
      }
      if (ohko.length || two.length) {
        benchmarks.push({
          move: slug,
          ohkoCount: ohko.length,
          twoCount: two.length,
          ohko: ohko.slice(0, 3),
          two: two.slice(0, 3),
        });
      }
    }
    if (benchmarks.length) {
      profile.benchmarks = benchmarks;
      baked++;
    }
  }
  return { baked, skipped, targetCount: targets.length };
}

async function main() {
  const { format: FORMAT, month: MONTH } = await resolveFormatAndMonth();
  // Never move BACKWARDS. A transient Smogon hiccup (a pulled file, a partial
  // month republish) could make auto-detect resolve an OLDER regulation/month
  // than what's already committed; refuse to overwrite good current data with it
  // unless a pin explicitly asks. Format ids + ISO months both sort in release
  // order, so a plain string compare is the "is this a downgrade?" test.
  if (!FORMAT_OVERRIDE && !MONTH_OVERRIDE) {
    let prevMeta = null;
    try {
      prevMeta = JSON.parse(await readFile(OUT_PATH, "utf8")).meta;
    } catch {
      // No committed file yet — nothing to protect.
    }
    if (
      prevMeta?.format &&
      (FORMAT < prevMeta.format ||
        (FORMAT === prevMeta.format && MONTH < prevMeta.month))
    ) {
      throw new Error(
        `detected ${FORMAT} ${MONTH} is OLDER than committed ${prevMeta.format} ${prevMeta.month} — refusing to downgrade (pin STATS_FORMAT / STATS_MONTH to override)`,
      );
    }
  }
  const allCutoffs = [...new Set(Object.values(BRACKETS).flatMap((b) => b.cutoffs))];
  console.log(`Fetching Champions DOUBLES competitive stats (${FORMAT} = ${regulationLabel(FORMAT)}, ${MONTH}${FORMAT_OVERRIDE ? " [format pinned]" : " [latest regulation]"}${MONTH_OVERRIDE ? " [month pinned]" : ""}, cutoffs ${allCutoffs.join("/")})…`);
  const [chaosByCutoff, itemList, pokemonData] = await Promise.all([
    Promise.all(allCutoffs.map((c) => getJson(statsUrl(FORMAT, MONTH, c)))).then((files) =>
      Object.fromEntries(allCutoffs.map((c, i) => [c, files[i]])),
    ),
    getJson(ITEMS_URL),
    readFile(POKEMON_PATH, "utf8").then(JSON.parse),
  ]);
  const { roster } = JSON.parse(await readFile(ROSTER_PATH, "utf8"));

  /** Merge a bracket's cutoff files best-first: lower files only backfill. */
  function mergeCutoffs(cutoffs) {
    const data = { ...chaosByCutoff[cutoffs[0]].data };
    let backfilled = 0;
    for (const lower of cutoffs.slice(1)) {
      for (const [key, value] of Object.entries(chaosByCutoff[lower].data)) {
        if (!data[key]) {
          data[key] = value;
          backfilled++;
        }
      }
    }
    return { data, backfilled };
  }

  // Display-name lookups keyed by stripped id (to render Smogon's ids). Abilities
  // are rendered by the UI from each Pokémon's own ability list, so only moves
  // (for slug resolution) and items need a build-time lookup here.
  const moveDisplay = new Map();
  for (const [slug, m] of Object.entries(pokemonData.moves)) {
    moveDisplay.set(stripId(slug), { displayName: m.displayName, slug });
  }
  const itemDisplay = new Map();
  const itemSlugByStripped = new Map();
  for (const it of itemList.results) {
    itemDisplay.set(stripId(it.name), toDisplayName(it.name));
    itemSlugByStripped.set(stripId(it.name), it.name);
  }

  const itemName = (id) => itemDisplay.get(id) ?? toDisplayName(id);
  const itemSlugOf = (id) => itemSlugByStripped.get(id) ?? null;
  const moveOf = (id) => moveDisplay.get(id) ?? { displayName: toDisplayName(id), slug: null };

  // EVERY shown item must be tappable with a description. PokeAPI's item DB
  // lacks some Champions items — Mega Stones for mons the mainline never gave one
  // (Greninjite, Clefablite, …) today, and potentially any future Champions-
  // original item. When itemSlugOf returns null we synthesize a slug + a
  // description floor so the row is never an un-tappable dead end. Mega Stones
  // (name ends in "ite") get the Mega Stone blurb; anything else gets a generic
  // floor and is logged so a maintainer can add a curated ITEM_OVERRIDES entry.
  const MEGA_STONE_DESC = "A Mega Stone. Its holder can Mega Evolve during battle.";
  // "…ite", plus the "…ite X" / "…ite Y" pair (Raichunite X/Y, Charizardite X/Y),
  // whose trailing X/Y the old `/ite$/` missed — leaving them with a generic
  // "a held item" blurb instead of the Mega Stone one.
  const isMegaStone = (name) => /ite(?:\s*[xy])?$/i.test(name.trim());
  const genericItemDesc = (name) => `${name} — a held item used in Pokémon Champions.`;
  const synthDetail = (slug, name) => {
    const desc =
      ITEM_OVERRIDES[slug] ||
      (isMegaStone(name) ? MEGA_STONE_DESC : genericItemDesc(name));
    return {
      slug,
      displayName: name,
      shortEffect: desc,
      effect: desc,
      category: isMegaStone(name) ? "Mega Stones" : null,
      sprite: null,
      flingPower: null,
    };
  };
  const synthItems = {};
  const synthWarn = new Set();
  const resolveItemSlug = (id) => {
    const real = itemSlugOf(id);
    if (real) return real;
    const name = itemName(id);
    if (!synthItems[id]) {
      synthItems[id] = synthDetail(id, name);
      if (!isMegaStone(name)) synthWarn.add(name);
    }
    return id; // never null — the row stays tappable
  };

  const rosterSlugs = new Set(roster.map((s) => s.replace(/\./g, "-")));
  const teammateSlug = (name) => {
    const s = slugify(name);
    if (rosterSlugs.has(s)) return s;
    const base = s.split("-")[0];
    return rosterSlugs.has(base) ? base : null;
  };

  // Forms that are their own roster entry (regional, Rotom appliance) or a Mega.
  // These must NOT be grabbed as a base form's fallback — only default-form
  // naming (e.g. Gourgeist-Average, Lycanroc-Midday) may fall back.
  const EXCLUDE_FALLBACK =
    /-(mega(-[xy])?|primal|alola|galar|hisui|paldea|wash|heat|frost|mow|fan)$/;

  function buildProfile(data, key, asForm) {
    const m = data[key];
    const rawCount = m["Raw count"] || 1;
    // "Raw count" is UNWEIGHTED, but Moves/Teammates/Spreads counts are
    // weighted by the skill cutoff — at high cutoffs they're tiny fractions of
    // it. The weighted number of sets = the Abilities sum (every set has
    // exactly one ability), so that's the denominator for per-set rates.
    const abilSum = sum(m.Abilities) || 1;
    const setCount = abilSum;
    const itemSum = sum(m.Items) || 1;
    const pct = (c, denom) => Math.min(100, Math.round((c / denom) * 100));

    // Per-ability and per-move usage, keyed for the UI to annotate the displayed
    // form's own abilities/moves. Only safe when this profile IS that form: for an
    // `asForm` base (e.g. base Rotom showing Rotom-Wash data), the alt form's
    // abilities/moves differ, so we leave these empty to avoid mislabeling — the
    // usage/items/spread/teammates still inform, behind the "shown for …" note.
    const abilityUsage = {};
    const moveUsage = {};
    if (!asForm) {
      for (const [id, c] of cleanEntries(m.Abilities)) abilityUsage[id] = pct(c, abilSum);
      for (const [id, c] of cleanEntries(m.Moves)) {
        if (c / setCount < 0.03) continue;
        const md = moveOf(id);
        if (md.slug) moveUsage[md.slug] = pct(c, setCount);
      }
    }

    return {
      usagePct: Math.round(m.usage * 1000) / 10,
      rawCount,
      // The Smogon display name behind this profile — drives the build-time
      // damage benchmarks (@smogon/calc resolves species by this name).
      smogonName: key,
      asForm,
      abilityUsage,
      moveUsage,
      items: topClean(m.Items, 3).map(([id, c]) => ({
        displayName: itemName(id),
        slug: resolveItemSlug(id),
        usagePct: pct(c, itemSum),
      })),
      itemClasses: itemClassesOf(m.Items),
      spread: m.Spreads && Object.keys(m.Spreads).length
        ? parseSpread(topClean(m.Spreads, 1)[0]?.[0] ?? Object.keys(m.Spreads)[0])
        : null,
      speedInvest: speedInvestOf(m.Spreads),
      teammates: Object.entries(m.Teammates)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, c]) => ({ displayName: name, slug: teammateSlug(name), usagePct: pct(c, setCount) })),
      setupThreats: Object.entries(m.Moves)
        .filter(([id, c]) => SETUP_MOVE_IDS.has(id) && c / setCount >= SETUP_THRESHOLD)
        .sort((a, b) => b[1] - a[1])
        .map(([id, c]) => ({ displayName: moveOf(id).displayName, usagePct: pct(c, setCount) })),
    };
  }

  /** Build one bracket's complete profile map from its merged chaos data. */
  function buildBracket(data) {
    // Index every Smogon key with its slug + usage, for form-aware resolution.
    const keyIndex = Object.keys(data).map((key) => ({
      key,
      slug: slugify(key),
      usage: data[key].usage ?? 0,
    }));

    // Resolve a roster slug to its Smogon key. Prefers an EXACT slug match (so
    // base Ninetales stays base Ninetales and Ninetales-Alola is its own
    // entry), falling back only to a default-form-named variant.
    function bestKey(slug) {
      // PokeAPI's "tauros-paldea-aqua-breed" maps to Smogon's "tauros-paldea-aqua".
      for (const s of [slug, slug.replace(/-breed$/, "")]) {
        const exact = keyIndex
          .filter((c) => c.slug === s)
          .sort((a, b) => b.usage - a.usage)[0];
        if (exact) return exact;
      }
      return (
        keyIndex
          .filter((c) => c.slug.startsWith(`${slug}-`) && !EXCLUDE_FALLBACK.test(c.slug))
          .sort((a, b) => b.usage - a.usage)[0] ?? null
      );
    }

    const profiles = {};
    const misses = [];
    // Ladder keys a roster form actually claimed — for reverse coverage below.
    const consumed = new Set();
    for (const p of pokemonData.pokemon) {
      // asForm is set only for a genuinely different form (not a "-breed"
      // naming artifact), so the same Pokémon keeps its real usage tables.
      const norm = (s) => s.replace(/-breed$/, "");
      // Base form (exact key, e.g. base Ninetales — not its Alolan variant).
      const base = bestKey(p.name);
      if (base) {
        consumed.add(base.key);
        profiles[p.name] = buildProfile(data, base.key, base.slug !== norm(p.name) ? base.key : null);
      } else {
        misses.push(p.name);
      }
      for (const form of p.forms) {
        if (form.kind === "stance" || form.kind === "form") {
          // A genuinely different Pokémon (Basculegion-F) — its own Smogon set.
          const ownKey = FORM_OWN_SMOGON_KEY[form.key];
          if (ownKey && data[ownKey]) {
            consumed.add(ownKey);
            profiles[form.key] = buildProfile(data, ownKey, null);
            continue;
          }
          // An in-battle stance/form change (Aegislash Blade, Palafin Hero) —
          // Smogon doesn't split it, so it shares the base's set. The threat
          // profile (computed from the form's own stats + this set) then reads
          // correctly for the alternate stat line; smogonName is the calc
          // species so KO benchmarks use the right form.
          const baseProfile = profiles[p.name];
          if (baseProfile) {
            profiles[form.key] = {
              ...baseProfile,
              smogonName: STANCE_CALC_NAME[form.key] ?? baseProfile.smogonName,
            };
          }
          continue;
        }
        // Each Mega/Primal form, by its exact Smogon key.
        const mega = bestKey(form.key);
        if (mega) {
          consumed.add(mega.key);
          profiles[form.key] = buildProfile(data, mega.key, mega.slug !== norm(form.key) ? mega.key : null);
        }
      }
    }
    // Reverse coverage: ladder species with real usage that NO roster form
    // claimed — a page a trainer can't reach. This is how a NEW species a
    // regulation adds surfaces before roster.json catches up (the old logging
    // only reported the other direction — roster mons with no ladder data).
    const unmatched = keyIndex
      .filter((c) => c.usage >= 0.005 && !consumed.has(c.key))
      .sort((a, b) => b.usage - a.usage)
      .map((c) => `${c.key} ${(c.usage * 100).toFixed(1)}%`);
    return { profiles, misses, unmatched };
  }

  const brackets = {};
  for (const [name, def] of Object.entries(BRACKETS)) {
    const { data, backfilled } = mergeCutoffs(def.cutoffs);
    const { profiles, misses, unmatched } = buildBracket(data);
    brackets[name] = { profiles, misses };
    console.log(
      `  ${name}: ${Object.keys(profiles).length} profiles` +
        (backfilled ? ` (${backfilled} backfilled from ${def.cutoffs.slice(1).join("/")})` : "") +
        (misses.length ? ` · no data for: ${misses.join(", ")}` : ""),
    );
    if (unmatched.length) {
      console.warn(
        `  ⚠ ${name}: ${unmatched.length} ladder species (≥0.5%) with NO roster page — add to roster.json if in Champions: ${unmatched.join(", ")}`,
      );
    }
  }

  // Fold Smogon's "noability" bucket into the curated ability. A few
  // Champions-original Mega forms (Mega Raichu X/Y, Staraptor, Eelektross, …) run
  // an ability Smogon's dex doesn't recognize, so chaos files most of their sets
  // under "noability" — which would render "Electric Surge 12%" when 100% of Mega
  // Raichu X are on it. pokemon.json curates the real (single) ability per form,
  // so collapse mono-ability forms to it; renormalize the rest if a form ever has
  // several. (Found by `npm run audit`.)
  const abilityIdsByKey = new Map();
  for (const p of pokemonData.pokemon) {
    abilityIdsByKey.set(p.name, p.abilities.map((a) => stripId(a.name)));
    for (const f of p.forms ?? []) abilityIdsByKey.set(f.key, f.abilities.map((a) => stripId(a.name)));
  }
  let noAbilityFolded = 0;
  for (const b of Object.values(brackets)) {
    for (const [key, pr] of Object.entries(b.profiles)) {
      if (!pr.abilityUsage || !("noability" in pr.abilityUsage)) continue;
      const ids = abilityIdsByKey.get(key) ?? [];
      if (ids.length === 1) {
        pr.abilityUsage = { [ids[0]]: 100 };
      } else {
        const rest = Object.fromEntries(
          Object.entries(pr.abilityUsage).filter(([k]) => k !== "noability"),
        );
        const sum = Object.values(rest).reduce((s, v) => s + v, 0) || 1;
        pr.abilityUsage = Object.fromEntries(
          Object.entries(rest).map(([k, v]) => [k, Math.round((v / sum) * 100)]),
        );
      }
      noAbilityFolded++;
    }
  }
  if (noAbilityFolded) console.log(`  + folded Smogon "noability" into the curated ability for ${noAbilityFolded} form profile(s)`);

  // Bake KO benchmarks for the default (master) bracket — the answer a
  // damage calculator would give, with zero inputs, precomputed.
  {
    const abilityDisplayById = new Map();
    for (const p of pokemonData.pokemon) {
      for (const f of [p, ...(p.forms ?? [])]) {
        for (const a of f.abilities ?? []) {
          abilityDisplayById.set(stripId(a.name), a.displayName);
        }
      }
    }
    const t0 = Date.now();
    const { baked, skipped, targetCount } = bakeBenchmarks(
      brackets.master.profiles,
      pokemonData.moves,
      abilityDisplayById,
    );
    console.log(
      `  benchmarks: ${baked} attackers vs top ${targetCount} (${skipped} species unknown to @smogon/calc) in ${Date.now() - t0}ms`,
    );
  }

  // Fetch details for every item that shows up in ANY bracket's typical sets.
  const itemSlugs = [
    ...new Set(
      Object.values(brackets).flatMap(({ profiles }) =>
        Object.values(profiles).flatMap((p) =>
          // Synthesized Mega Stones aren't on PokeAPI — fetching them would 404
          // (and burn the retry budget); they're merged in from synthItems below.
          p.items.map((it) => it.slug).filter((s) => s && !synthItems[s]),
        ),
      ),
    ),
  ];
  console.log(`Fetching ${itemSlugs.length} item details…`);
  // Salvage source for items whose live PokeAPI fetch fails on every retry —
  // the committed dataset, mirroring the move/pokemon generator's salvage. An
  // item detail barely drifts, so a salvaged entry beats a dropped (un-tappable) one.
  let previousItemIndex = {};
  try {
    previousItemIndex = JSON.parse(await readFile(OUT_PATH, "utf8")).itemIndex ?? {};
  } catch {
    // First run — nothing to salvage from.
  }
  const itemIndex = {};
  for (let i = 0; i < itemSlugs.length; i += 8) {
    const chunk = itemSlugs.slice(i, i + 8);
    const results = await Promise.all(
      chunk.map(async (slug) => {
        try {
          const d = await getJson(`https://pokeapi.co/api/v2/item/${slug}`);
          const en = d.effect_entries?.find((e) => e.language.name === "en");
          const fl = d.flavor_text_entries?.find((f) => f.language.name === "en");
          const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
          // PokeAPI lacks effect AND flavor text for a few newer items — supply it.
          const short = clean(en?.short_effect) || clean(fl?.text) || ITEM_OVERRIDES[slug] || "";
          const effect = clean(en?.effect) || clean(fl?.text) || ITEM_OVERRIDES[slug] || "";
          return [slug, {
            slug,
            displayName: toDisplayName(slug),
            shortEffect: short,
            effect,
            category: d.category?.name ? toDisplayName(d.category.name) : null,
            sprite: d.sprites?.default ?? null,
            flingPower: d.fling_power ?? null,
          }];
        } catch {
          // Fetch failed for a real slug — reuse the last committed detail rather
          // than dropping it (which would render an un-tappable row).
          return previousItemIndex[slug] ? [slug, previousItemIndex[slug]] : null;
        }
      }),
    );
    for (const r of results) if (r) itemIndex[r[0]] = r[1];
  }
  // Champions-original items with no PokeAPI entry (Mega Stones today) — fold in
  // their synthesized details.
  Object.assign(itemIndex, synthItems);

  // FINAL FLOOR (by construction, independent of `npm run status`): every item
  // shown in any profile must have a non-null slug AND resolve to a detail with
  // a real (>=3 char) description. Synthesize for anything that slipped through
  // (a real slug whose fetch failed with no salvage, a one-off junk stub, …), so
  // the app can NEVER render an un-tappable or blank item sheet.
  const meaningless = (s) => !s || String(s).trim().length < 3;
  let itemFloored = 0;
  for (const b of Object.values(brackets)) {
    for (const p of Object.values(b.profiles)) {
      for (const it of p.items) {
        if (!it.slug) it.slug = slugify(it.displayName);
        const d = itemIndex[it.slug];
        if (!d || (meaningless(d.effect) && meaningless(d.shortEffect))) {
          itemIndex[it.slug] = synthDetail(it.slug, it.displayName);
          itemFloored++;
        }
      }
    }
  }
  if (synthWarn.size) {
    console.warn(`  ~ ${synthWarn.size} non-Mega-Stone item(s) had no PokeAPI entry — used a generic description floor; add a curated ITEM_OVERRIDES entry: ${[...synthWarn].join(", ")}`);
  }
  if (itemFloored) console.log(`  + floored ${itemFloored} item detail(s) so every shown item is tappable + described`);

  const battles = chaosByCutoff[BRACKETS.all.cutoffs[0]].info["number of battles"];
  const out = {
    meta: {
      format: FORMAT,
      formatLabel: `Champions VGC (doubles), ${regulationLabel(FORMAT)}`,
      month: MONTH,
      battles,
      source: statsUrl(FORMAT, MONTH, BRACKETS.master.cutoffs[0]),
      generatedAt: new Date().toISOString().slice(0, 10),
      bracketLabels: Object.fromEntries(
        Object.entries(BRACKETS).map(([name, def]) => [name, def.label]),
      ),
    },
    brackets: Object.fromEntries(
      Object.entries(brackets).map(([name, b]) => [name, b.profiles]),
    ),
    itemIndex,
  };
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");

  // Stamp the service worker's cache VERSION from a hash of BOTH baked data files
  // so a data refresh (deploy) changes sw.js → the browser installs the new
  // worker → `activate` drops the previous version's caches (no stale build/data
  // for installed-PWA users). Idempotent: identical data → identical hash.
  try {
    const hash = createHash("sha256")
      .update(JSON.stringify(out))
      .update(await readFile(POKEMON_PATH, "utf8"))
      .digest("hex")
      .slice(0, 12);
    const sw = await readFile(SW_PATH, "utf8");
    const stamped = sw.replace(/const VERSION = "[^"]*";/, `const VERSION = "cpx-${hash}";`);
    if (stamped !== sw) {
      await writeFile(SW_PATH, stamped, "utf8");
      console.log(`  + stamped service worker VERSION cpx-${hash}`);
    }
  } catch (err) {
    console.warn(`  ~ could not stamp service worker VERSION: ${err.message}`);
  }

  const champ = brackets.master.profiles;
  const baseCovered = pokemonData.pokemon.filter((p) => champ[p.name]).length;
  console.log(`✓ Wrote ${Object.keys(BRACKETS).length} brackets (master: ${Object.keys(champ).length} profiles, ${baseCovered}/${roster.length} base covered)`);
  console.log(`  Source: ${FORMAT} ${MONTH} (${battles.toLocaleString()} battles)`);
}

main().catch((err) => {
  console.error("Competitive generation failed:", err);
  process.exit(1);
});
