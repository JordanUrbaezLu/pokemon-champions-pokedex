// @ts-check
/**
 * Build-time dataset generator.
 *
 * Reads the Champions roster (src/data/roster.json), pulls each Pokemon from
 * PokeAPI v2, normalizes it into the app's `ChampionPokemon` shape, and writes
 * a single committed JSON file. The running app imports that file directly and
 * never touches the network — which is what makes the Pokedex fast and usable
 * on flaky venue Wi-Fi during a real match.
 *
 * Run with: `npm run data`
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ROSTER_PATH = resolve(ROOT, "src/data/roster.json");
const OUT_PATH = resolve(ROOT, "src/data/generated/pokemon.json");

const API = "https://pokeapi.co/api/v2";
const CONCURRENCY = 8;

/** Fetch JSON with a few retries so one transient blip doesn't fail the build. */
async function getJson(url, attempt = 1) {
  try {
    const res = await fetch(url);
    if (res.status === 404) return { notFound: true };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { data: await res.json() };
  } catch (err) {
    if (attempt >= 3) throw err;
    await new Promise((r) => setTimeout(r, 400 * attempt));
    return getJson(url, attempt + 1);
  }
}

/** Run `worker` over `items` with a bounded number of in-flight requests. */
async function pooled(items, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function toDisplayName(slug) {
  return slug
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/** Friendly roster name: "ninetales-alola" -> "Alolan Ninetales", "rotom-wash" -> "Wash Rotom". */
function rosterDisplayName(slug) {
  const regional = { alola: "Alolan", galar: "Galarian", hisui: "Hisuian", paldea: "Paldean" };
  for (const [suffix, prefix] of Object.entries(regional)) {
    const re = new RegExp(`-${suffix}(-.*)?$`);
    if (re.test(slug)) return `${prefix} ${toDisplayName(slug.replace(re, ""))}`;
  }
  const rotom = slug.match(/^rotom-(wash|heat|frost|mow|fan)$/);
  if (rotom) return `${toDisplayName(rotom[1])} Rotom`;
  return toDisplayName(slug);
}

// --- Pokémon Champions movepool (from Serebii) --------------------------------
// PokeAPI carries a "champions" version group but it has no learnset data, so
// the actual Champions movepool comes from Serebii's per-Pokémon pages. We only
// scrape the move *names* there; each move's battle stats still come from
// PokeAPI (a move's type/power/category is consistent across games).
const SEREBII_BASE = "https://www.serebii.net/pokedex-champions";
// roster.json normalizes Serebii's dotted slugs (mr.rime) for PokeAPI; map back.
const SEREBII_SLUG = { "mr-rime": "mr.rime" };
const USER_AGENT = "Mozilla/5.0 (compatible; ChampionsPokedexBuild/1.0)";

async function getText(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch {
    if (attempt >= 3) return null;
    await new Promise((r) => setTimeout(r, 400 * attempt));
    return getText(url, attempt + 1);
  }
}

const slugifyMove = (s) =>
  s
    .toLowerCase()
    .replace(/['’]/g, "") // "King's Shield" -> "kings-shield" (not "king-s-shield")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** The set of moves a Pokémon can learn in Champions, as PokeAPI move slugs. */
async function fetchChampionsMoves(rosterSlug) {
  const url = `${SEREBII_BASE}/${SEREBII_SLUG[rosterSlug] ?? rosterSlug}/`;
  const html = await getText(url);
  if (!html) return [];
  const re = /attackdex-champions\/[a-z0-9-]+\.shtml">([^<]+)</g;
  const names = new Set();
  let m;
  while ((m = re.exec(html))) names.add(m[1].trim());
  return [...new Set([...names].map(slugifyMove))].filter(Boolean).sort();
}

const STAT_KEY = {
  hp: "hp",
  attack: "attack",
  defense: "defense",
  "special-attack": "specialAttack",
  "special-defense": "specialDefense",
  speed: "speed",
};

// Cache ability lookups — abilities like Intimidate recur across the roster.
const abilityCache = new Map();

async function getAbilityEffect(slug) {
  if (abilityCache.has(slug)) return abilityCache.get(slug);
  const { data, notFound } = await getJson(`${API}/ability/${slug}`);
  let shortEffect = "";
  if (!notFound && data) {
    const en =
      data.effect_entries?.find((e) => e.language.name === "en") ?? null;
    shortEffect = (en?.short_effect || en?.effect || "").replace(/\s+/g, " ").trim();
  }
  abilityCache.set(slug, shortEffect);
  return shortEffect;
}

function readStats(data) {
  const stats = { hp: 0, attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0, total: 0 };
  for (const s of data.stats) {
    const key = STAT_KEY[s.stat.name];
    if (key) {
      stats[key] = s.base_stat;
      stats.total += s.base_stat;
    }
  }
  return stats;
}

async function readAbilities(data) {
  return Promise.all(
    data.abilities.map(async (a) => ({
      name: a.ability.name,
      displayName: toDisplayName(a.ability.name),
      isHidden: a.is_hidden,
      shortEffect: await getAbilityEffect(a.ability.name),
    })),
  );
}

function readTypes(data) {
  return data.types.sort((a, b) => a.slot - b.slot).map((t) => t.type.name);
}

// Prefer the current-generation movepool so the moves shown match how the
// Pokémon actually plays today, and to keep the dataset lean. Falls back to the
// full legal movepool for anything not present in the latest version group.
const LATEST_VERSION_GROUP = "scarlet-violet";

function readMoveSlugs(data) {
  const latest = data.moves
    .filter((m) =>
      m.version_group_details.some(
        (d) => d.version_group.name === LATEST_VERSION_GROUP,
      ),
    )
    .map((m) => m.move.name);
  const slugs = latest.length ? latest : data.moves.map((m) => m.move.name);
  return [...new Set(slugs)].sort();
}

/** Fetch a move's full battle details for the shared move index. */
async function buildMove(slug) {
  const { data, notFound } = await getJson(`${API}/move/${slug}`);
  if (notFound || !data) return null;
  const en = data.effect_entries?.find((e) => e.language.name === "en");
  const sub = (s) =>
    (s || "")
      .replace(/\s+/g, " ")
      .replace(/\$effect_chance/g, String(data.effect_chance ?? ""))
      .trim();
  // Newer/DLC moves often have no effect_entries — fall back to flavor text.
  const flavor = (
    data.flavor_text_entries?.find((f) => f.language.name === "en")?.flavor_text ?? ""
  )
    .replace(/\s+/g, " ")
    .trim();
  const m = data.meta || {};
  return {
    name: data.name,
    displayName: toDisplayName(data.name),
    type: data.type?.name ?? "normal",
    damageClass: data.damage_class?.name ?? "status",
    power: data.power ?? null,
    accuracy: data.accuracy ?? null,
    pp: data.pp ?? null,
    priority: data.priority ?? 0,
    shortEffect: sub(en?.short_effect) || flavor,
    // Richer fields for the move modal.
    effect: sub(en?.effect) || flavor,
    target: data.target?.name ?? null,
    ailment: m.ailment?.name && m.ailment.name !== "none" ? m.ailment.name : null,
    ailmentChance: m.ailment_chance || 0,
    statChanges: (data.stat_changes || []).map((s) => ({
      stat: s.stat.name,
      change: s.change,
    })),
    /** Chance the stat change(s) happen as a secondary effect; 0 = guaranteed. */
    statChance: m.stat_chance || 0,
    healing: m.healing || 0,
    drain: m.drain || 0,
    flinchChance: m.flinch_chance || 0,
    critRate: m.crit_rate || 0,
    minHits: m.min_hits ?? null,
    maxHits: m.max_hits ?? null,
  };
}

/** Human label for a Mega/Primal form, e.g. "charizard-mega-x" -> "Mega Charizard X". */
function formLabel(formSlug, baseDisplay) {
  const megaMatch = formSlug.match(/-mega(?:-([xy]))?$/);
  if (megaMatch) {
    const suffix = megaMatch[1] ? ` ${megaMatch[1].toUpperCase()}` : "";
    return `Mega ${baseDisplay}${suffix}`;
  }
  if (formSlug.endsWith("-primal")) return `Primal ${baseDisplay}`;
  return toDisplayName(formSlug);
}

/**
 * A battle form is a Mega Evolution (`-mega`, `-mega-x`, `-mega-y`) or Primal
 * Reversion (`-primal`). We match by exact suffix rather than a hardcoded list
 * because Pokémon Champions ships its OWN Mega roster — including new ones the
 * classic games never had (Mega Dragonite, Mega Greninja, …) — and this
 * PokeAPI instance carries that Champions data.
 *
 * The strict pattern deliberately rejects junk variants like `-mega-z` that the
 * API also serves but the game does not include.
 */
const BATTLE_FORM_RE = /-(mega(-[xy])?|primal)$/;

function isBattleForm(slug) {
  return BATTLE_FORM_RE.test(slug);
}

function formKind(formSlug) {
  return formSlug.endsWith("-primal") ? "primal" : "mega";
}

/** Build a single Mega/Primal battle form from its /pokemon payload. */
async function buildForm(formSlug, baseDisplay) {
  const { data, notFound } = await getJson(`${API}/pokemon/${formSlug}`);
  if (notFound || !data) return null;
  return {
    key: data.name,
    label: formLabel(data.name, baseDisplay),
    kind: formKind(data.name),
    types: readTypes(data),
    stats: readStats(data),
    abilities: await readAbilities(data),
    sprite: data.sprites?.front_default ?? null,
    artwork: data.sprites?.other?.["official-artwork"]?.front_default ?? null,
  };
}

/** Mega/Primal variety slugs for a species (skipping the base/default form). */
function findAltForms(speciesData, baseName) {
  if (!speciesData?.varieties) return [];
  return speciesData.varieties
    .map((v) => v.pokemon.name)
    .filter((n) => n !== baseName && isBattleForm(n));
}

async function buildPokemon(rosterSlug) {
  // Serebii's "mr.rime" etc. -> PokeAPI's "mr-rime".
  const slug = rosterSlug.replace(/\./g, "-");

  let { data, notFound } = await getJson(`${API}/pokemon/${slug}`);
  let speciesData = null;

  // Some roster entries (Aegislash, Mimikyu, Lycanroc, …) have no plain
  // /pokemon/<slug>; resolve them through the species' default variety.
  if (notFound) {
    const sp = await getJson(`${API}/pokemon-species/${slug}`);
    speciesData = sp.data ?? null;
    const def =
      speciesData?.varieties?.find((v) => v.is_default) ??
      speciesData?.varieties?.[0];
    if (def) ({ data } = await getJson(`${API}/pokemon/${def.pokemon.name}`));
  }

  if (!data) {
    console.warn(`  ! skipped "${rosterSlug}" — not found on PokeAPI`);
    return null;
  }

  if (!speciesData && data.species?.url) {
    speciesData = (await getJson(data.species.url)).data ?? null;
  }

  // Keep the clean roster slug as the route + display name (so URLs stay
  // "/pokemon/aegislash", not "/pokemon/aegislash-shield"), but pull the
  // National Dex number from the species.
  const displayName = rosterDisplayName(slug);
  // Regional / Rotom-appliance forms are their own roster entries and must NOT
  // inherit the base species' Megas (e.g. Alolan Raichu can't Mega Evolve).
  const isVariant = /-(alola|galar|hisui|paldea|wash|heat|frost|mow|fan)(-.*)?$/.test(slug);
  const altSlugs = isVariant ? [] : findAltForms(speciesData, data.name);
  const forms = (
    await Promise.all(altSlugs.map((s) => buildForm(s, displayName)))
  ).filter(Boolean);

  // The Champions movepool is the source of truth; fall back to the current-gen
  // PokeAPI movepool only if the Serebii page can't be read.
  let moveSlugs = await fetchChampionsMoves(rosterSlug);
  if (!moveSlugs.length) {
    console.warn(`  ~ ${rosterSlug}: no Champions moves from Serebii — using current-gen movepool`);
    moveSlugs = readMoveSlugs(data);
  }

  return {
    id: speciesData?.id ?? data.id,
    name: slug,
    displayName,
    types: readTypes(data),
    stats: readStats(data),
    abilities: await readAbilities(data),
    heightM: data.height / 10,
    weightKg: data.weight / 10,
    sprite: data.sprites?.front_default ?? null,
    artwork: data.sprites?.other?.["official-artwork"]?.front_default ?? null,
    // Clean Pokémon HOME render — the nice, uniform list icon.
    home: data.sprites?.other?.home?.front_default ?? null,
    forms,
    moveSlugs,
  };
}

async function main() {
  const { roster } = JSON.parse(await readFile(ROSTER_PATH, "utf8"));
  console.log(`Generating dataset for ${roster.length} roster entries…`);

  const built = (await pooled(roster, buildPokemon)).filter(Boolean);
  built.sort((a, b) => a.id - b.id);

  // Fetch every move once into a shared index, keyed by slug. Each Pokémon
  // references moves by slug, so move data isn't duplicated 180+ times.
  const allMoveSlugs = [...new Set(built.flatMap((p) => p.moveSlugs))].sort();
  console.log(`Fetching ${allMoveSlugs.length} unique moves…`);
  const moveList = (await pooled(allMoveSlugs, buildMove)).filter(Boolean);
  const moves = Object.fromEntries(moveList.map((m) => [m.name, m]));

  // Drop any move slugs that failed to resolve so the app never dereferences a
  // missing entry, and report them (Champions-exclusive moves PokeAPI lacks).
  const unresolved = allMoveSlugs.filter((s) => !moves[s]);
  if (unresolved.length) {
    console.warn(`  ! ${unresolved.length} move(s) didn't resolve on PokeAPI: ${unresolved.slice(0, 25).join(", ")}${unresolved.length > 25 ? "…" : ""}`);
  }
  for (const p of built) p.moveSlugs = p.moveSlugs.filter((s) => moves[s]);

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(
    OUT_PATH,
    JSON.stringify({ pokemon: built, moves }, null, 2) + "\n",
    "utf8",
  );

  console.log(
    `✓ Wrote ${built.length} Pokémon and ${moveList.length} moves to ${OUT_PATH.replace(ROOT + "/", "")}`,
  );
  if (built.length !== roster.length) {
    console.log(`  (${roster.length - built.length} roster entr(ies) were skipped — check slugs above)`);
  }
}

main().catch((err) => {
  console.error("Dataset generation failed:", err);
  process.exit(1);
});
