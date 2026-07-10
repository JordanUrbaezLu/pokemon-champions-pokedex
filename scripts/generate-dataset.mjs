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
// Pokémon Showdown's data files — move flags (contact, sound, …) PokeAPI
// doesn't carry, per-form learnsets (a second opinion where PokeAPI has
// holes), the prevo chain (egg/pre-evolution moves live on the prevo), and a
// fallback for Champions-era moves PokeAPI can't resolve.
const SHOWDOWN_MOVES_URL = "https://play.pokemonshowdown.com/data/moves.json";
const SHOWDOWN_LEARNSETS_URL = "https://play.pokemonshowdown.com/data/learnsets.json";
const SHOWDOWN_POKEDEX_URL = "https://play.pokemonshowdown.com/data/pokedex.json";
const CONCURRENCY = 5;

// Moves that don't exist in Champions (no Terastallization), filtered out of
// every movepool no matter which source supplied them.
const EXCLUDED_MOVES = new Set(["tera-blast", "tera-starstorm"]);

/** Fetch JSON with patient retries — PokeAPI 5xx blips can last a while. */
async function getJson(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.status === 404) return { notFound: true };
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
    return { data: await res.json() };
  } catch (err) {
    if (attempt >= 8) throw err;
    await new Promise((r) => setTimeout(r, Math.min(15000, 700 * 2 ** (attempt - 1))));
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

// Variant roster entries (regional / Rotom appliance forms) have no Serebii
// Champions page of their own — their moves live on the base species' page.
const VARIANT_SUFFIX = /-(alola|galar|hisui|paldea|wash|heat|frost|mow|fan)(-.*)?$/;
const speciesPageSlug = (slug) => slug.replace(VARIANT_SUFFIX, "");

// Cache Serebii pages by species so Ninetales + Alolan Ninetales fetch once.
const serebiiCache = new Map();

/** The set of moves on a Serebii Champions pokédex page, as PokeAPI move slugs. */
async function fetchChampionsMoves(pageSlug) {
  if (serebiiCache.has(pageSlug)) return serebiiCache.get(pageSlug);
  const url = `${SEREBII_BASE}/${SEREBII_SLUG[pageSlug] ?? pageSlug}/`;
  const html = await getText(url);
  let slugs = [];
  if (html) {
    const re = /attackdex-champions\/[a-z0-9-]+\.shtml">([^<]+)</g;
    const names = new Set();
    let m;
    while ((m = re.exec(html))) names.add(m[1].trim());
    slugs = [...new Set([...names].map(slugifyMove))].filter(Boolean).sort();
  }
  serebiiCache.set(pageSlug, slugs);
  return slugs;
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

// --- Showdown move data (flags + fallback for moves PokeAPI lacks) -----------

const stripId = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Move flags the app (and future battle math) cares about, in Showdown's naming.
const FLAG_KEYS = ["contact", "punch", "sound", "bullet", "bite", "slicing", "wind", "pulse"];

/** Showdown target -> PokeAPI target naming (the shape the UI already reads). */
const SHOWDOWN_TARGET = {
  normal: "selected-pokemon",
  any: "selected-pokemon",
  adjacentFoe: "selected-pokemon",
  allAdjacentFoes: "all-opponents",
  allAdjacent: "all-other-pokemon",
  all: "entire-field",
  self: "user",
  adjacentAlly: "ally",
  adjacentAllyOrSelf: "user-or-ally",
  allies: "all-allies",
  allySide: "users-field",
  allyTeam: "users-field",
  foeSide: "opponents-field",
  randomNormal: "random-opponent",
  scripted: "specific-move",
};

const SHOWDOWN_STATUS = {
  par: "paralysis",
  brn: "burn",
  psn: "poison",
  tox: "poison",
  slp: "sleep",
  frz: "freeze",
};

const SHOWDOWN_BOOST_STAT = {
  atk: "attack",
  def: "defense",
  spa: "special-attack",
  spd: "special-defense",
  spe: "speed",
  accuracy: "accuracy",
  evasion: "evasion",
};

/** Read a move's flags off its Showdown entry, as a compact string array. */
function showdownFlags(sd) {
  return sd ? FLAG_KEYS.filter((k) => sd.flags?.[k]) : [];
}

/**
 * Build a MoveSummary from Showdown data alone — the fallback for
 * Champions-era moves PokeAPI doesn't serve yet, so they're never dropped
 * from a movepool.
 */
function buildMoveFromShowdown(slug, sd) {
  if (!sd || !sd.name) return null;
  const boosts = sd.boosts ?? sd.secondary?.boosts ?? null;
  const statChanges = boosts
    ? Object.entries(boosts).map(([stat, change]) => ({
        stat: SHOWDOWN_BOOST_STAT[stat] ?? stat,
        change,
      }))
    : [];
  const status = sd.status ?? sd.secondary?.status ?? null;
  const ratio = (pair) =>
    Array.isArray(pair) ? Math.round((pair[0] / pair[1]) * 100) : 0;
  return {
    name: slug,
    displayName: sd.name,
    type: (sd.type ?? "normal").toLowerCase(),
    damageClass: (sd.category ?? "status").toLowerCase(),
    power: sd.basePower || null,
    accuracy: sd.accuracy === true ? null : sd.accuracy ?? null,
    pp: sd.pp ?? null,
    priority: sd.priority ?? 0,
    shortEffect: sd.shortDesc || sd.desc || "",
    effect: sd.desc || sd.shortDesc || "",
    target: SHOWDOWN_TARGET[sd.target] ?? null,
    ailment: status ? SHOWDOWN_STATUS[status] ?? status : null,
    ailmentChance: status && sd.secondary?.status ? sd.secondary?.chance ?? 0 : 0,
    statChanges,
    statChance: boosts && sd.secondary?.boosts ? sd.secondary?.chance ?? 0 : 0,
    healing: ratio(sd.heal),
    drain: ratio(sd.drain) || (sd.recoil ? -ratio(sd.recoil) : 0),
    flinchChance:
      sd.secondary?.volatileStatus === "flinch" ? sd.secondary?.chance ?? 0 : 0,
    critRate: (sd.critRatio ?? 1) > 1 ? 1 : 0,
    minHits: Array.isArray(sd.multihit) ? sd.multihit[0] : sd.multihit ?? null,
    maxHits: Array.isArray(sd.multihit) ? sd.multihit[1] : sd.multihit ?? null,
    flags: showdownFlags(sd),
  };
}

/**
 * Last-resort move description, synthesized from the move's own mechanics — the
 * floor that guarantees no move ever ships with an empty effect (so the move
 * sheet is never blank), even for a brand-new move neither PokeAPI nor Showdown
 * has text for yet. Only used when both sources came up empty.
 */
function synthMoveDescription(m) {
  const type = m.type ? toDisplayName(m.type) : "Typeless";
  const kind = m.damageClass === "status" ? "status move" : `${m.damageClass} move`;
  const bits = [];
  if (m.power) bits.push(`${m.power} base power`);
  if (m.ailment) bits.push(`can inflict ${toDisplayName(m.ailment)}`);
  if (m.healing > 0) bits.push(`restores HP`);
  if (m.drain > 0) bits.push(`drains HP`);
  if (m.drain < 0) bits.push(`deals recoil`);
  for (const sc of m.statChanges ?? []) {
    bits.push(`${sc.change > 0 ? "raises" : "lowers"} ${toDisplayName(sc.stat)}`);
  }
  return `A ${type}-type ${kind}.${bits.length ? ` ${bits.join("; ")}.` : ""}`;
}

// Populated in main() before any Pokémon is built.
/** Recently-added species (from roster.json `newcomers`) — stamped `isNew` so
 * the app can flag them with a NEW badge + filter while they have no ladder data. */
let newcomers = new Set();
/** roster forms per Serebii species page, to know when a page is a multi-form union. */
let speciesFormCount = new Map();
/** every move slug PokeAPI serves, to tell "other form's move" from "Champions-new move". */
let knownPokeapiMoves = new Set();
/** Showdown learnsets keyed by stripped form id, the second form-learnset source. */
let showdownLearnsets = {};
/** Showdown pokédex keyed by stripped id — supplies the prevo chain. */
let showdownPokedex = {};

/**
 * The move ids a form can learn according to Showdown — INCLUDING its
 * pre-evolutions' learnsets, because egg and prevo-only moves (Arcanine's
 * Morning Sun, Hisuian Arcanine's Head Smash) are stored only on the prevo
 * (Growlithe) in both Showdown and PokeAPI. Without the chain walk, those
 * real Champions moves would be dropped by the form-correctness filter.
 */
function showdownLearnsetOf(slug, pageSlug) {
  const moves = new Set();
  const seen = new Set();
  let id =
    [stripId(slug.replace(/-breed$/, "")), stripId(pageSlug)].find(
      (x) => showdownLearnsets[x] || showdownPokedex[x],
    ) ?? null;
  while (id && !seen.has(id)) {
    seen.add(id);
    for (const m of Object.keys(showdownLearnsets[id]?.learnset ?? {})) moves.add(m);
    const prevo = showdownPokedex[id]?.prevo;
    id = prevo ? stripId(prevo) : null;
  }
  return moves;
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

/**
 * In-battle form changes whose alternate has a meaningfully different STAT
 * LINE — worth a toggle like Mega — but that Smogon does NOT track separately.
 * Keyed by base roster slug. Each alternate shares the base's competitive
 * profile (same Smogon entry), so its threat profile recomputes on the
 * alternate's stats. `base` is the short label for the default form's tab.
 * (Morpeko/Mimikyu are intentionally absent — their form change leaves stats
 * unchanged, so a stat toggle would show nothing.)
 */
const EXTRA_BATTLE_FORMS = {
  aegislash: {
    base: "Shield",
    forms: [{ slug: "aegislash-blade", label: "Aegislash (Blade Forme)", tab: "Blade", kind: "stance" }],
  },
  palafin: {
    base: "Zero",
    forms: [{ slug: "palafin-hero", label: "Palafin (Hero)", tab: "Hero", kind: "form" }],
  },
  basculegion: {
    base: "Male",
    forms: [{ slug: "basculegion-female", label: "Basculegion (Female)", tab: "Female", kind: "form" }],
  },
};

// Forms / whole entries from the last committed dataset, as a salvage source
// when PokeAPI serves persistent 5xxs on some endpoints (it happens — e.g.
// gardevoir-mega). Stats/types/movepools barely drift month to month, so a
// salvaged entry is strictly better than a dropped one.
let previousForms = new Map();
let previousPokemon = new Map();

/**
 * Champions Mega forms whose abilities this PokeAPI dataset serves EMPTY — the
 * Champions-original Megas (Mega Staraptor, Mega Eelektross, …) the mainline
 * games never had. Their real abilities come from Serebii's Champions pages and
 * are curated here so a Mega never ships without the single most battle-defining
 * fact about it. Abilities PokeAPI knows (tough-claws, contrary, …) get their
 * effect text fetched live; Champions-original abilities (Eelevate, Fire Mane)
 * carry their effect text inline since no PokeAPI entry exists.
 * Verified against https://www.serebii.net/pokedex-champions/<mon>/ on 2026-06-17.
 */
const MEGA_FORM_ABILITIES = {
  "barbaracle-mega": [{ name: "tough-claws" }],
  "dragalge-mega": [{ name: "regenerator" }],
  "eelektross-mega": [
    {
      name: "eelevate",
      displayName: "Eelevate",
      shortEffect:
        "Floats off the ground — immune to Ground moves, Spikes, Toxic Spikes, and Sticky Web. On knocking out a target, its highest stat rises one stage.",
    },
  ],
  "falinks-mega": [{ name: "defiant" }],
  "malamar-mega": [{ name: "contrary" }],
  "pyroar-mega": [
    {
      name: "fire-mane",
      displayName: "Fire Mane",
      shortEffect: "Boosts the power of the Pokémon's Fire-type moves by 50%.",
    },
  ],
  "scolipede-mega": [{ name: "shell-armor" }],
  "scrafty-mega": [{ name: "intimidate" }],
  "staraptor-mega": [{ name: "contrary" }],
};

/** Curated Champions ability set for a form PokeAPI serves with none. */
async function championsFormAbilities(formSlug) {
  const ov = MEGA_FORM_ABILITIES[formSlug];
  if (!ov) return [];
  return Promise.all(
    ov.map(async (a) => ({
      name: a.name,
      displayName: a.displayName ?? toDisplayName(a.name),
      isHidden: false,
      shortEffect: a.shortEffect ?? (await getAbilityEffect(a.name)),
    })),
  );
}

/**
 * Build a single battle form (Mega/Primal, or an EXTRA_BATTLE_FORMS stance/
 * form) from its /pokemon payload. `override` supplies label/tab/kind for the
 * extra forms; Megas/Primals derive those from the slug.
 */
async function buildForm(formSlug, baseDisplay, override = null) {
  let payload;
  try {
    payload = await getJson(`${API}/pokemon/${formSlug}`);
  } catch (err) {
    const salvaged = previousForms.get(formSlug);
    if (salvaged) {
      console.warn(`  ~ ${formSlug}: PokeAPI kept failing (${err.message}) — reusing the committed dataset's entry`);
      return salvaged;
    }
    throw err;
  }
  const { data, notFound } = payload;
  if (notFound || !data) return null;
  // PokeAPI serves several Champions-original Megas with NO abilities — fall back
  // to the curated Champions ability set so a form never ships ability-less.
  let abilities = await readAbilities(data);
  if (!abilities.length) {
    abilities = await championsFormAbilities(data.name);
    if (!abilities.length) {
      console.warn(`  ! ${data.name}: no abilities from PokeAPI and no curated Champions fallback`);
    }
  }
  return {
    key: data.name,
    label: override?.label ?? formLabel(data.name, baseDisplay),
    ...(override?.tab ? { tab: override.tab } : {}),
    kind: override?.kind ?? formKind(data.name),
    types: readTypes(data),
    stats: readStats(data),
    abilities,
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
  let forms = (
    await Promise.all(altSlugs.map((s) => buildForm(s, displayName)))
  ).filter(Boolean);

  // In-battle stance / form changes (Aegislash Blade, Palafin Hero, …) with
  // their own stat line, toggled like a Mega on the detail page.
  const extra = EXTRA_BATTLE_FORMS[slug];
  if (extra) {
    const built = (
      await Promise.all(extra.forms.map((f) => buildForm(f.slug, displayName, f)))
    ).filter(Boolean);
    forms.push(...built);
  }

  // PokeAPI can serve two Mega varieties for one species that are battle-
  // identical — Meowstic's male/female Megas share type, stats, ability, and
  // label ("Mega Meowstic"); only the sprite differs. Two indistinguishable
  // "Mega" tabs answer no mid-battle question, so collapse forms that match on
  // every battle-relevant field, keeping the first (default variety's sprite).
  const seenForms = new Set();
  forms = forms.filter((f) => {
    const sig = JSON.stringify([f.label, f.kind, f.types, f.stats, f.abilities]);
    if (seenForms.has(sig)) {
      console.warn(`  ~ ${f.key}: battle-identical to an earlier "${f.label}" — collapsed`);
      return false;
    }
    seenForms.add(sig);
    return true;
  });

  // The Champions movepool is the source of truth. Variant forms (Alolan
  // Ninetales, Wash Rotom, …) have no Serebii page of their own — their moves
  // live on the base species' page, which lists EVERY form's moves in one
  // union. So when a page covers multiple roster forms, intersect it with the
  // form's own learnset — PokeAPI's ∪ Showdown's incl. pre-evolutions, so one
  // source's holes (or egg moves stored on the prevo) can't drop real moves.
  // Moves PokeAPI has never heard of (Champions-new) survive the filter and
  // resolve later against Showdown's move data.
  const pageSlug = speciesPageSlug(slug);
  let moveSlugs = await fetchChampionsMoves(pageSlug === slug ? rosterSlug : pageSlug);
  if (moveSlugs.length && (speciesFormCount.get(pageSlug) ?? 1) > 1) {
    const learnset = new Set(data.moves.map((m) => m.move.name));
    const sdLearnset = showdownLearnsetOf(slug, pageSlug);
    moveSlugs = moveSlugs.filter(
      (s) =>
        learnset.has(s) || sdLearnset.has(stripId(s)) || !knownPokeapiMoves.has(s),
    );
  }
  if (!moveSlugs.length) {
    console.warn(`  ~ ${rosterSlug}: no Champions moves from Serebii — using current-gen movepool`);
    moveSlugs = readMoveSlugs(data);
  }
  // Champions has no Terastallization — Tera moves never exist there.
  moveSlugs = moveSlugs.filter((s) => !EXCLUDED_MOVES.has(s));

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
    // For stance/form mons, the default form has a real name (Shield, Zero,
    // Male) — used as the first toggle tab instead of a generic "Base".
    ...(extra ? { baseFormLabel: extra.base } : {}),
    // Recently added to Champions (no ladder data yet) — drives the NEW badge/filter.
    ...(newcomers.has(slug) ? { isNew: true } : {}),
    moveSlugs,
  };
}

async function main() {
  const rosterFile = JSON.parse(await readFile(ROSTER_PATH, "utf8"));
  const { roster } = rosterFile;
  newcomers = new Set(rosterFile.newcomers ?? []);
  console.log(
    `Generating dataset for ${roster.length} roster entries` +
      (newcomers.size ? ` (${newcomers.size} flagged new)` : "") +
      "…",
  );

  // How many roster forms share one Serebii species page (base + variants) —
  // pages covering >1 form get the learnset intersection in buildPokemon.
  speciesFormCount = new Map();
  for (const r of roster) {
    const page = speciesPageSlug(r.replace(/\./g, "-"));
    speciesFormCount.set(page, (speciesFormCount.get(page) ?? 0) + 1);
  }

  // The last committed dataset, kept as a salvage source for endpoints PokeAPI
  // persistently 5xxs on.
  try {
    const prev = JSON.parse(await readFile(OUT_PATH, "utf8"));
    for (const p of prev.pokemon ?? []) {
      previousPokemon.set(p.name, p);
      for (const f of p.forms ?? []) previousForms.set(f.key, f);
    }
  } catch {
    // First run — nothing to salvage from.
  }

  // PokeAPI's full move index + Showdown's data files, fetched once up front.
  console.log("Fetching move indexes (PokeAPI + Showdown)…");
  const [moveIndex, showdownMoves, sdLearnsets, sdPokedex] = await Promise.all([
    getJson(`${API}/move?limit=3000`),
    getJson(SHOWDOWN_MOVES_URL),
    getJson(SHOWDOWN_LEARNSETS_URL),
    getJson(SHOWDOWN_POKEDEX_URL),
  ]);
  knownPokeapiMoves = new Set(
    (moveIndex.data?.results ?? []).map((m) => m.name),
  );
  const showdown = showdownMoves.data ?? {};
  showdownLearnsets = sdLearnsets.data ?? {};
  showdownPokedex = sdPokedex.data ?? {};

  const built = (
    await pooled(roster, async (rosterSlug) => {
      try {
        return await buildPokemon(rosterSlug);
      } catch (err) {
        const salvaged = previousPokemon.get(rosterSlug.replace(/\./g, "-"));
        if (salvaged) {
          console.warn(`  ~ ${rosterSlug}: PokeAPI kept failing (${err.message}) — reusing the committed dataset's entry`);
          return salvaged;
        }
        throw err;
      }
    })
  ).filter(Boolean);
  built.sort((a, b) => a.id - b.id);

  // Fetch every move once into a shared index, keyed by slug. Each Pokémon
  // references moves by slug, so move data isn't duplicated 180+ times.
  const allMoveSlugs = [...new Set(built.flatMap((p) => p.moveSlugs))].sort();
  console.log(`Fetching ${allMoveSlugs.length} unique moves…`);
  const moveList = (await pooled(allMoveSlugs, buildMove)).filter(Boolean);
  // Flags (contact, sound, …) come from Showdown — PokeAPI has none.
  for (const m of moveList) m.flags = showdownFlags(showdown[stripId(m.name)]);
  const moves = Object.fromEntries(moveList.map((m) => [m.name, m]));

  // Moves PokeAPI couldn't resolve (Champions-new) are built from Showdown
  // data instead of being dropped; only moves missing from BOTH are dropped.
  const unresolved = allMoveSlugs.filter((s) => !moves[s]);
  const dropped = [];
  for (const slug of unresolved) {
    const recovered = buildMoveFromShowdown(slug, showdown[stripId(slug)]);
    if (recovered) moves[slug] = recovered;
    else dropped.push(slug);
  }
  if (unresolved.length - dropped.length > 0) {
    console.log(`  + recovered ${unresolved.length - dropped.length} move(s) from Showdown data: ${unresolved.filter((s) => moves[s]).join(", ")}`);
  }
  if (dropped.length) {
    console.warn(`  ! ${dropped.length} move(s) missing from PokeAPI AND Showdown (dropped): ${dropped.join(", ")}`);
  }
  for (const p of built) p.moveSlugs = p.moveSlugs.filter((s) => moves[s]);

  // Fullproof: every move the app can render must carry description text, so a
  // tapped move sheet is never blank. PokeAPI sometimes has a move but no
  // effect/flavor text — backfill from Showdown, then synthesize from the
  // move's own mechanics as the absolute floor. (`npm run status` enforces this.)
  let backfilled = 0;
  let synthed = 0;
  for (const m of Object.values(moves)) {
    if (!m.shortEffect || !m.effect) {
      const sd = showdown[stripId(m.name)];
      const sdShort = (sd?.shortDesc || sd?.desc || "").trim();
      const sdLong = (sd?.desc || sd?.shortDesc || "").trim();
      if (!m.shortEffect && sdShort) { m.shortEffect = sdShort; backfilled++; }
      if (!m.effect && sdLong) m.effect = sdLong;
    }
    if (!m.shortEffect && !m.effect) {
      const synth = synthMoveDescription(m);
      m.shortEffect = synth;
      m.effect = synth;
      synthed++;
    } else {
      // Mirror a one-sided description across both fields the UI reads.
      if (!m.effect) m.effect = m.shortEffect;
      if (!m.shortEffect) m.shortEffect = m.effect;
    }
  }
  if (backfilled || synthed) {
    console.log(`  + move descriptions: backfilled ${backfilled} from Showdown, synthesized ${synthed} from mechanics`);
  }

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(
    OUT_PATH,
    JSON.stringify(
      // generatedAt drives the home screen's "data updated" stamp.
      { generatedAt: new Date().toISOString().slice(0, 10), pokemon: built, moves },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    `✓ Wrote ${built.length} Pokémon and ${Object.keys(moves).length} moves to ${OUT_PATH.replace(ROOT + "/", "")}`,
  );
  if (built.length !== roster.length) {
    console.log(`  (${roster.length - built.length} roster entr(ies) were skipped — check slugs above)`);
  }
}

main().catch((err) => {
  console.error("Dataset generation failed:", err);
  process.exit(1);
});
