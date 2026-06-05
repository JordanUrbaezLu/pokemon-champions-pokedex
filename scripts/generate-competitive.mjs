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
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROSTER_PATH = resolve(ROOT, "src/data/roster.json");
const POKEMON_PATH = resolve(ROOT, "src/data/generated/pokemon.json");
const OUT_PATH = resolve(ROOT, "src/data/generated/competitive.json");

// Monthly snapshot — bump when a newer month publishes.
const MONTH = "2026-05";
const FORMAT = "gen9championsvgc2026regma"; // Champions VGC doubles, Reg M-A
const CUTOFF = "0"; // raw popularity; -1630 for a higher-skill picture
const STATS_URL = `https://www.smogon.com/stats/${MONTH}/chaos/${FORMAT}-${CUTOFF}.json`;
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

// Descriptions for items PokeAPI has neither effect nor flavor text for.
const ITEM_OVERRIDES = {
  "fairy-feather": "Powers up the holder's Fairy-type moves.",
};

async function getJson(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (attempt >= 3) throw err;
    await new Promise((r) => setTimeout(r, 500 * attempt));
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

async function main() {
  console.log(`Fetching Champions DOUBLES competitive stats (${FORMAT}, ${MONTH})…`);
  const [stats, itemList, pokemonData] = await Promise.all([
    getJson(STATS_URL),
    getJson(ITEMS_URL),
    readFile(POKEMON_PATH, "utf8").then(JSON.parse),
  ]);
  const { roster } = JSON.parse(await readFile(ROSTER_PATH, "utf8"));

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

  const rosterSlugs = new Set(roster.map((s) => s.replace(/\./g, "-")));
  const teammateSlug = (name) => {
    const s = slugify(name);
    if (rosterSlugs.has(s)) return s;
    const base = s.split("-")[0];
    return rosterSlugs.has(base) ? base : null;
  };

  // Index every Smogon key with its slug + usage, for form-aware resolution.
  const keyIndex = Object.keys(stats.data).map((key) => ({
    key,
    slug: slugify(key),
    usage: stats.data[key].usage ?? 0,
  }));

  // Forms that are their own roster entry (regional, Rotom appliance) or a Mega.
  // These must NOT be grabbed as a base form's fallback — only default-form
  // naming (e.g. Gourgeist-Average, Lycanroc-Midday) may fall back.
  const EXCLUDE_FALLBACK =
    /-(mega(-[xy])?|primal|alola|galar|hisui|paldea|wash|heat|frost|mow|fan)$/;

  /**
   * Resolve a roster slug to its Smogon key. Prefers an EXACT slug match (so
   * base Ninetales stays base Ninetales and Ninetales-Alola is its own entry),
   * falling back only to a default-form-named variant when no exact key exists.
   */
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

  function buildProfile(key, asForm) {
    const m = stats.data[key];
    const rawCount = m["Raw count"] || 1;
    const abilSum = sum(m.Abilities) || 1;
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
        if (c / rawCount < 0.03) continue;
        const md = moveOf(id);
        if (md.slug) moveUsage[md.slug] = pct(c, rawCount);
      }
    }

    return {
      usagePct: Math.round(m.usage * 1000) / 10,
      rawCount,
      asForm,
      abilityUsage,
      moveUsage,
      items: topClean(m.Items, 3).map(([id, c]) => ({
        displayName: itemName(id),
        slug: itemSlugOf(id),
        usagePct: pct(c, itemSum),
      })),
      spread: m.Spreads && Object.keys(m.Spreads).length
        ? parseSpread(topClean(m.Spreads, 1)[0]?.[0] ?? Object.keys(m.Spreads)[0])
        : null,
      teammates: Object.entries(m.Teammates)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, c]) => ({ displayName: name, slug: teammateSlug(name), usagePct: pct(c, rawCount) })),
      setupThreats: Object.entries(m.Moves)
        .filter(([id, c]) => SETUP_MOVE_IDS.has(id) && c / rawCount >= SETUP_THRESHOLD)
        .sort((a, b) => b[1] - a[1])
        .map(([id, c]) => ({ displayName: moveOf(id).displayName, usagePct: pct(c, rawCount) })),
    };
  }

  const profiles = {};
  const misses = [];
  for (const p of pokemonData.pokemon) {
    // asForm is set only for a genuinely different form (not a "-breed" naming
    // artifact), so the same Pokémon keeps its real ability/move usage.
    const norm = (s) => s.replace(/-breed$/, "");
    // Base form (exact key, e.g. base Ninetales — not its Alolan variant).
    const base = bestKey(p.name);
    if (base) {
      profiles[p.name] = buildProfile(base.key, base.slug !== norm(p.name) ? base.key : null);
    } else {
      misses.push(p.name);
    }
    // Each Mega/Primal form, by its exact key.
    for (const form of p.forms) {
      const mega = bestKey(form.key);
      if (mega) {
        profiles[form.key] = buildProfile(mega.key, mega.slug !== norm(form.key) ? mega.key : null);
      }
    }
  }

  // Fetch details for every item that shows up in a typical set, for the item modal.
  const itemSlugs = [
    ...new Set(
      Object.values(profiles).flatMap((p) =>
        p.items.map((it) => it.slug).filter(Boolean),
      ),
    ),
  ];
  console.log(`Fetching ${itemSlugs.length} item details…`);
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
          return null;
        }
      }),
    );
    for (const r of results) if (r) itemIndex[r[0]] = r[1];
  }

  const out = {
    meta: {
      format: FORMAT,
      formatLabel: "Champions VGC (doubles), Reg M-A",
      month: MONTH,
      battles: stats.info["number of battles"],
      source: STATS_URL,
    },
    pokemon: profiles,
    itemIndex,
  };
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");

  const baseCovered = pokemonData.pokemon.filter((p) => profiles[p.name]).length;
  console.log(`✓ Wrote ${Object.keys(profiles).length} profiles (${baseCovered}/${roster.length} base + Mega forms)`);
  console.log(`  Source: ${FORMAT} ${MONTH} (${stats.info["number of battles"].toLocaleString()} battles)`);
  if (misses.length) console.log(`  No competitive data for: ${misses.join(", ")}`);
}

main().catch((err) => {
  console.error("Competitive generation failed:", err);
  process.exit(1);
});
