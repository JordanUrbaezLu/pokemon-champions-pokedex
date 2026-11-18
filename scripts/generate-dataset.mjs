// @ts-check
/**
 * Build-time dataset generator.
 *
 * Reads the Champions roster (src/data/roster.json) and builds each Pokémon
 * from two sources, then writes a single committed JSON file:
 *   • PokeAPI v2 — types, stats, abilities, sprites, Mega varieties, and each
 *     move's mainline battle data + prose.
 *   • Pokémon Showdown's `champions` mod (MIT, read at ONE pinned commit — see
 *     scripts/showdown-data.mjs) — everything about the GAME: which forms are
 *     legal (the roster check), every per-form Champions movepool, Champions'
 *     move patches (power, accuracy, PP scale, secondary chances, flags…), and
 *     the ability fallback for any Mega PokeAPI serves ability-less.
 * The running app imports the file directly and never touches the network —
 * which is what makes the Pokedex fast and usable on flaky venue Wi-Fi.
 *
 * Run with: `npm run data`
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROSTER_TO_POKEAPI_POKEMON,
  ROSTER_TO_SHOWDOWN,
  ROSTER_TO_SHOWDOWN_SPECIES,
  UNMODELED_SHOWDOWN_FORMS,
  WEIGHT_CHECK_EXCEPTIONS,
} from "./species-aliases.mjs";
import {
  PINNED_SHOWDOWN_DATE,
  PINNED_SHOWDOWN_SHA,
  SHOWDOWN_LICENSE,
  SHOWDOWN_REPO,
  championsMovePool,
  championsPP,
  getSpecies,
  isChampionsLegal,
  loadChampionsDex,
  toId,
} from "./showdown-data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ROSTER_PATH = resolve(ROOT, "src/data/roster.json");
const OUT_PATH = resolve(ROOT, "src/data/generated/pokemon.json");

const API = "https://pokeapi.co/api/v2";
const CONCURRENCY = 5;
const USER_AGENT = "Mozilla/5.0 (compatible; ChampionsPokedexBuild/1.0)";

// Moves that don't exist in Champions (no Terastallization), filtered out of
// every movepool no matter which source supplied them. (The champions mod tags
// both "Past" too — belt and braces.)
const EXCLUDED_MOVES = new Set(["tera-blast", "tera-starstorm"]);

/**
 * Champions move data — which layer owns what (get this wrong and you patch the
 * wrong layer):
 *   • MOVEPOOLS are the champions mod's per-form learnsets, so legality changes
 *     need NO code here — v1.2.0 removing Pound from Politoed and Mirror Coat /
 *     Metal Burst from Archaludon, or enabling Slash (0 → 36 movepools), all
 *     arrive with the pinned Showdown data.
 *   • Move STATS start from PokeAPI (mainline numbers + prose), then the mod's
 *     moves.ts patches win field by field (`applyChampionsMove`): power,
 *     accuracy, type, secondary chances, flags, target… plus Champions' own PP
 *     scale for EVERY move — scripts.ts caps base PP at 20 and plays
 *     (pp / 5 + 1) × 4, i.e. 8 / 12 / 16 / 20. That is why mainline-10-PP Wish
 *     read 12 before v1.2.0 and 8 after it (the mod's pp 10 → 5).
 *   • LOCAL_MOVE_OVERRIDES is ONLY for a Champions value the pinned commit is
 *     demonstrably wrong or behind on, and every entry carries its evidence.
 *     No numbers today — the mod agrees with every patch note we know of (it
 *     encodes v1.2.0's Wish / Strength Sap 12 → 8 itself). The one entry is
 *     TEXT that lags the mod's own data; `staleText` is the Showdown shortDesc
 *     it corrects, and the bake fails once that text changes (re-read, then drop
 *     the entry if Showdown now describes the Champions behaviour).
 * @type {Record<string, { reason: string, staleText?: string } & Record<string, unknown>>}
 */
const LOCAL_MOVE_OVERRIDES = {
  "milk-drink": {
    reason:
      "the champions mod retargets it to the user OR an adjacent ally (moves.ts `milkdrink: { target: \"adjacentAllyOrSelf\" }`), " +
      "but data/text/moves.ts has no champions entry, so Showdown's text (and PokeAPI's) still says it heals the user",
    staleText: "Heals the user by 50% of its max HP.",
    shortEffect: "Heals the user or an adjacent ally by 50% of its max HP.",
    effect: "The user or an adjacent ally restores 1/2 of its maximum HP, rounded half up.",
  },
};

/**
 * Movepool corrections where the pinned Showdown commit is demonstrably wrong
 * or behind the game: roster slug → `{ add?, remove?, reason }` (move slugs).
 * The 2026-11-18 switch from Serebii checked every difference and Showdown was
 * right in all of them (see CHECKLIST.md), so this starts empty.
 * @type {Record<string, { add?: string[], remove?: string[], reason: string }>}
 */
const MOVEPOOL_OVERRIDES = {};

/**
 * Roster pages that stand for MORE than one Showdown form get the union of
 * those forms' Champions learnsets. Meowstic is one page for both genders:
 * identical stats, one collapsed Mega, and Smogon pools both genders under
 * "Meowstic" (its sets include the female's Competitive — see
 * EXTRA_BASE_ABILITIES), so the page lists what EITHER gender can bring
 * (the female adds Extrasensory + Future Sight; the male has Imprison, Mean
 * Look, Misty Terrain, Quick Guard, Wish). Roster slug → extra Showdown ids.
 */
const POOLED_MOVEPOOLS = {
  meowstic: ["meowsticf"],
};

/**
 * Ability text where NEITHER source describes the Champions behaviour.
 * Run Away: Showdown's champions mod makes it block trapping (commit d849b22008,
 * "Implement Run Away's immunity to trapping", #12303), but its text still says
 * "No competitive use." and PokeAPI's describes fleeing wild battles.
 */
const LOCAL_ABILITY_TEXT = {
  "run-away": "Can't be trapped: this Pokémon can always switch out, even against Shadow Tag, Arena Trap, Mean Look or Block.",
};

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

/**
 * The SLUG RULE — split on "-", capitalise. Fine for prose words (types,
 * stats, a form suffix such as "Low Key"), but it cannot rebuild an official
 * name's punctuation: as a NAME it shipped "U Turn", "Will O Wisp", "Kings
 * Shield", "Never Melt Ice", "Good As Gold", "Kommo O", "Mr Rime". Names go
 * through `officialName` instead; this is only its last resort.
 */
function toDisplayName(slug) {
  return slug
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/** PokeAPI's English `names` entry for a move / ability / species payload. */
const pokeapiEnglishName = (data) =>
  data?.names?.find((n) => n.language?.name === "en")?.name?.trim() || null;

/** Every name the bake could NOT take from Showdown (logged by main()). */
const nameFallbacks = [];

/**
 * The official English name of a move / ability / species, at the source:
 * Showdown's `name` at the pinned commit ("U-turn", "Will-O-Wisp",
 * "King's Shield", "Good as Gold", "Kommo-o", "Mr. Rime", "Farfetch’d"), else
 * PokeAPI's English `names` entry, else the slug rule — the two fallbacks are
 * recorded in `nameFallbacks` so a bake never guesses silently.
 * @param {"moves" | "abilities" | "species"} table
 */
function officialName(table, slug, pokeapiData = null) {
  const sd = champions[table]?.[stripId(slug)]?.name;
  if (sd) return sd;
  const api = pokeapiEnglishName(pokeapiData);
  nameFallbacks.push(`${table} ${slug}: ${api ? `PokeAPI "${api}"` : `slug rule "${toDisplayName(slug)}"`}`);
  return api ?? toDisplayName(slug);
}

/**
 * Friendly roster name — the app's form conventions around the species'
 * OFFICIAL name: "ninetales-alola" -> "Alolan Ninetales", "rotom-wash" ->
 * "Wash Rotom", "toxtricity-low-key" -> "Toxtricity Low Key", "kommo-o" ->
 * "Kommo-o", "mr-rime" -> "Mr. Rime". `speciesData` (PokeAPI's species) says
 * where the species ends and the form suffix begins, and is the name fallback.
 */
function rosterDisplayName(slug, speciesData = null) {
  const name = (speciesSlug) => officialName("species", speciesSlug, speciesData);
  const regional = { alola: "Alolan", galar: "Galarian", hisui: "Hisuian", paldea: "Paldean" };
  for (const [suffix, prefix] of Object.entries(regional)) {
    const re = new RegExp(`-${suffix}(-.*)?$`);
    if (re.test(slug)) return `${prefix} ${name(slug.replace(re, ""))}`;
  }
  const rotom = slug.match(/^rotom-(wash|heat|frost|mow|fan)$/);
  if (rotom) return `${toDisplayName(rotom[1])} ${name("rotom")}`;
  const species = speciesData?.name;
  if (species && (slug === species || slug.startsWith(`${species}-`))) {
    const form = slug.slice(species.length + 1);
    return form ? `${name(species)} ${toDisplayName(form)}` : name(species);
  }
  return name(slug);
}

/** Showdown name -> PokeAPI-style slug ("King's Shield" -> "kings-shield"). */
const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/['’]/g, "") // "King's Shield" -> "kings-shield" (not "king-s-shield")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const stripId = toId;

// --- Pokémon Showdown's Champions data -------------------------------------------
// Loaded once in main(). See scripts/showdown-data.mjs for the pin + parser.
/** @type {any} */
let champions = null;
/** PokeAPI move slug by Showdown id ("kingsshield" -> "kings-shield"). */
let pokeapiMoveSlug = new Map();
/** Champions-effective Showdown move entry merged with its resolved text. */
const sdMove = (slug) => {
  const id = stripId(slug);
  const m = champions.moves[id];
  return m ? { ...m, ...champions.text.move(id) } : null;
};
const moveSlugOf = (id) => pokeapiMoveSlug.get(id) ?? slugify(champions.moves[id]?.name ?? id);

/**
 * The Showdown species whose Champions data describes a roster slug or form key.
 * Explicit mappings first (Floette = Floette-Eternal; Showdown renames such as
 * Indeedee-F / Toxtricity / Squawkabilly-Blue from species-aliases.mjs), then the
 * slug itself, then PokeAPI's "-breed" naming artifact. Only a species the
 * champions formats-data marks battle-legal counts — PokeAPI's plain `floette`
 * resolves to Showdown's mainline Red-Flower Floette, which is NOT in the game.
 */
function showdownSpeciesFor(slug) {
  const candidates = [
    ROSTER_TO_SHOWDOWN_SPECIES[slug],
    ...(ROSTER_TO_SHOWDOWN[slug] ?? []),
    slug,
    slug.replace(/-breed$/, ""),
  ]
    .filter(Boolean)
    .map(stripId);
  return candidates.find((id) => champions.species[id] && isChampionsLegal(champions, id)) ?? null;
}

/**
 * A roster mon's Champions movepool (PokeAPI move slugs) — the champions mod's
 * learnset for that exact form, looked up the way Showdown does it for this mod
 * (no prevo inheritance; see championsMovePool), plus POOLED_MOVEPOOLS siblings
 * and any documented MOVEPOOL_OVERRIDES. There is NO fallback: a slug with no
 * Champions learnset is a hard error in main(), never a mainline movepool.
 */
function championsMoveSlugs(slug) {
  const id = showdownSpeciesFor(slug);
  if (!id) throw new Error(`${slug}: no Champions-legal Showdown species`);
  const ids = new Set();
  for (const sid of [id, ...(POOLED_MOVEPOOLS[slug] ?? [])]) {
    for (const m of championsMovePool(champions, sid).moves) ids.add(m);
  }
  // An empty pool means the learnset chain dead-ended (a forme whose base the
  // mod tags nonstandard) — never bake a mon with no moves.
  if (!ids.size) throw new Error(`${slug}: Showdown's champions learnsets give ${id} no moves`);
  const slugs = new Set([...ids].map(moveSlugOf));
  const fix = MOVEPOOL_OVERRIDES[slug];
  for (const s of fix?.add ?? []) slugs.add(s);
  for (const s of fix?.remove ?? []) slugs.delete(s);
  return { id, moveSlugs: [...slugs].filter((s) => !EXCLUDED_MOVES.has(s)).sort() };
}

const STAT_KEY = {
  hp: "hp",
  attack: "attack",
  defense: "defense",
  "special-attack": "specialAttack",
  "special-defense": "specialDefense",
  speed: "speed",
};

/**
 * Showdown's own text for an ability when it describes CHAMPIONS behaviour
 * better than PokeAPI's mainline prose: a `champions`-specific entry (Healer's
 * 50%, Unseen Fist's ¼ damage), or a Champions-original ability the mod makes
 * standard (Eelevate, Fire Mane, Dragonize, Mega Sol, Piercing Drill, Spicy
 * Spray, Aura Guard). Null otherwise — PokeAPI's text stands.
 */
function championsAbilityText(slug) {
  if (LOCAL_ABILITY_TEXT[slug]) return LOCAL_ABILITY_TEXT[slug];
  const id = stripId(slug);
  const t = champions.text.ability(id);
  const patch = champions.modAbilities[id];
  const championsOriginal = !!patch && "isNonstandard" in patch && !patch.isNonstandard;
  return (t.championsSpecific || championsOriginal) && t.shortDesc ? t.shortDesc : null;
}

// Cache ability lookups — abilities like Intimidate recur across the roster.
const abilityCache = new Map();

/**
 * An ability's official name (`officialName`) and effect text: Champions-specific
 * Showdown text, else PokeAPI's, else Showdown's. PokeAPI is only fetched when
 * Showdown lacks the text or the name.
 */
async function getAbilityInfo(slug) {
  if (abilityCache.has(slug)) return abilityCache.get(slug);
  let shortEffect = championsAbilityText(slug);
  let pokeapi = null;
  if (!shortEffect || !champions.abilities[stripId(slug)]?.name) {
    const { data, notFound } = await getJson(`${API}/ability/${slug}`);
    if (!notFound && data) {
      pokeapi = data;
      const en = data.effect_entries?.find((e) => e.language.name === "en") ?? null;
      if (!shortEffect) shortEffect = (en?.short_effect || en?.effect || "").replace(/\s+/g, " ").trim();
    }
  }
  if (!shortEffect) shortEffect = champions.text.ability(stripId(slug)).shortDesc || "";
  const info = { displayName: officialName("abilities", slug, pokeapi), shortEffect };
  abilityCache.set(slug, info);
  return info;
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

// Gender-dimorphic species whose non-default gender carries an ability PokeAPI
// only lists on the alternate-gender form. Female Meowstic runs COMPETITIVE — a
// trap ability the battle helper must be able to show — but PokeAPI's default
// (male) Meowstic lists only Keen Eye / Infiltrator / Prankster. Keyed by
// species slug → extra ability slugs to union in. (Found by `npm run audit`.)
// The movepool side of the same pooled page is POOLED_MOVEPOOLS.
const EXTRA_BASE_ABILITIES = {
  meowstic: ["competitive"],
};

// speciesSlug is the ROSTER slug (e.g. "meowstic"), which differs from the
// PokeAPI variety name (`data.name` is "meowstic-male"): key the curation by the
// roster slug so it actually matches.
async function readAbilities(data, speciesSlug = data.name) {
  const own = await Promise.all(
    data.abilities.map(async (a) => {
      const info = await getAbilityInfo(a.ability.name);
      return {
        name: a.ability.name,
        displayName: info.displayName,
        isHidden: a.is_hidden,
        shortEffect: info.shortEffect,
      };
    }),
  );
  const have = new Set(own.map((a) => a.name));
  for (const slug of EXTRA_BASE_ABILITIES[speciesSlug] ?? []) {
    if (have.has(slug)) continue;
    const info = await getAbilityInfo(slug);
    own.push({
      name: slug,
      displayName: info.displayName,
      isHidden: false,
      shortEffect: info.shortEffect,
    });
  }
  return own;
}

function readTypes(data) {
  return data.types.sort((a, b) => a.slot - b.slot).map((t) => t.type.name);
}

/** Fetch a move's mainline battle details (PokeAPI) for the shared move index. */
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
    // Official, punctuation included: "U-turn", "Will-O-Wisp", "King's Shield".
    displayName: officialName("moves", data.name, data),
    type: data.type?.name ?? "normal",
    damageClass: data.damage_class?.name ?? "status",
    // `|| null`, not `?? null`: PokeAPI serves 0 where there is no number — power
    // 0 on eight SV-era status moves (Shed Tail, Tidy Up, Dragon Cheer…) and
    // variable-power Hard Press, accuracy 0 on Dragon Cheer (never misses;
    // Showdown: `accuracy: true`) — and the move sheet printed "Power 0" /
    // "Acc 0". No real move has 0 power or 0% accuracy; status holds the floor.
    power: data.power || null,
    accuracy: data.accuracy || null,
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

// --- Showdown move data (flags + Champions patches + fallback) --------------------

// Move flags the app (and the calc) cares about, in Showdown's naming.
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

const boostChanges = (boosts) =>
  Object.entries(boosts ?? {}).map(([stat, change]) => ({ stat: SHOWDOWN_BOOST_STAT[stat] ?? stat, change }));

// Targets that take the doubles ×0.75 spread reduction — kept in step with
// src/lib/spread.ts (a .mjs build tool can't import the TS module).
const SPREAD_TARGETS = new Set(["all-opponents", "all-other-pokemon"]);
const SHOWDOWN_SPREAD_TARGETS = new Set(["allAdjacentFoes", "allAdjacent"]);

/**
 * PokeAPI's `target` is occasionally wrong for newer moves — it lists Matcha
 * Gotcha as single-target when it really hits both foes, which silently cost
 * the app the ×0.75 on the format's most-used spread move. Showdown is the
 * battle-accurate source, so it wins whenever the two disagree about SPREAD
 * CLASSIFICATION specifically.
 *
 * Deliberately narrow: across the full 493-move index the two sources also
 * disagree on 9 status moves (Heal Bell, Perish Song, Howl…), where PokeAPI's
 * slug is the better UI label ("user-and-allies" reads better than
 * "users-field") and no damage math depends on it. Only the spread-affecting
 * disagreements are reconciled; everything else keeps PokeAPI's wording.
 * Returns the corrected target, or null if no correction is needed.
 */
function reconciledSpreadTarget(move, sd) {
  if (!sd?.target) return null;
  const ours = SPREAD_TARGETS.has(move.target);
  const theirs = SHOWDOWN_SPREAD_TARGETS.has(sd.target);
  if (ours === theirs) return null;
  return SHOWDOWN_TARGET[sd.target] ?? null;
}

/** The secondary-effect fields the app bakes, read off a Showdown move entry. */
function secondaryFields(sd) {
  const sec = sd.secondary ?? (Array.isArray(sd.secondaries) ? sd.secondaries[0] : null) ?? null;
  const status = sd.status ?? sec?.status ?? null;
  // A scripted status roll (Dire Claw / Tri Attack pick sleep/poison/paralysis
  // in an `onHit`) carries no `status` field, but its chance is still a status chance.
  const scriptedStatus = !!sec && !sec.status && !sec.volatileStatus && !sec.boosts && !!sec.onHit;
  return {
    ailment: status ? SHOWDOWN_STATUS[status] ?? status : null,
    ailmentChance: sec?.status || scriptedStatus ? sec.chance ?? 0 : 0,
    scriptedStatus,
    flinchChance: sec?.volatileStatus === "flinch" ? sec.chance ?? 0 : 0,
    secBoosts: sec?.boosts ?? null,
    secChance: sec?.chance ?? 0,
  };
}

/** Move-patch keys that change what a move's PROSE describes (so PokeAPI's text goes stale). */
const MECHANICS_KEYS = new Set([
  "secondary", "secondaries", "boosts", "self", "target", "condition", "volatileStatus", "drain", "heal", "recoil",
]);

/**
 * Layer Champions onto a PokeAPI-built move: Champions' PP scale for every
 * move, then each field the champions mod's moves.ts patches, then Showdown's
 * text where the mechanics changed. Returns a list of "field old→new" changes.
 */
function applyChampionsMove(m) {
  const id = stripId(m.name);
  const sd = sdMove(m.name);
  if (!sd) return null;
  const patch = champions.modMoves[id] ?? {};
  const changes = [];
  const set = (field, value) => {
    if (JSON.stringify(m[field]) === JSON.stringify(value)) return;
    changes.push(`${field} ${JSON.stringify(m[field])}→${JSON.stringify(value)}`);
    m[field] = value;
  };
  set("pp", championsPP(sd));
  if ("basePower" in patch) set("power", sd.basePower || null);
  if ("accuracy" in patch) set("accuracy", sd.accuracy === true ? null : sd.accuracy ?? null);
  if ("type" in patch) set("type", String(sd.type).toLowerCase());
  if ("category" in patch) set("damageClass", String(sd.category).toLowerCase());
  if ("priority" in patch) set("priority", sd.priority ?? 0);
  if ("target" in patch && SHOWDOWN_TARGET[sd.target]) set("target", SHOWDOWN_TARGET[sd.target]);
  if ("secondary" in patch || "secondaries" in patch) {
    const sec = secondaryFields(sd);
    if (sec.ailment) {
      set("ailment", sec.ailment);
      set("ailmentChance", sec.ailmentChance);
    } else if (sec.scriptedStatus) {
      // A random-status roll: keep PokeAPI's "unknown" ailment (Tri Attack) in
      // step; where PokeAPI models none (Dire Claw) the prose carries it.
      if (m.ailment) set("ailmentChance", sec.ailmentChance);
    } else if (!sd.status) {
      // The status secondary is gone (Freeze-Dry can't freeze in Champions).
      set("ailment", null);
      set("ailmentChance", 0);
    }
    set("flinchChance", sec.flinchChance);
    if (sec.secBoosts) {
      set("statChanges", boostChanges(sec.secBoosts));
      set("statChance", sec.secChance);
    } else if (m.statChance > 0) {
      // The secondary that carried the stat drop is gone.
      set("statChance", 0);
      set("statChanges", []);
    }
  }
  if ("boosts" in patch && sd.boosts) set("statChanges", boostChanges(sd.boosts));
  if ("self" in patch && sd.self?.boosts) set("statChanges", boostChanges(sd.self.boosts));
  // Showdown's prose wins where PokeAPI's describes mainline behaviour Champions
  // changed: Champions-specific text, a patched mechanic, or a move the mod
  // brings back from "Past" (PokeAPI's text dates from its last mainline game —
  // it still says King's Shield drops Attack by 2; it has been 1 since Gen 8).
  const reinstated = "isNonstandard" in patch && !patch.isNonstandard;
  const textChanged =
    champions.text.move(id).championsSpecific || reinstated || Object.keys(patch).some((k) => MECHANICS_KEYS.has(k));
  if (textChanged && (sd.shortDesc || sd.desc)) {
    m.shortEffect = sd.shortDesc || sd.desc;
    m.effect = sd.desc || sd.shortDesc;
    changes.push("text→Showdown champions");
  }
  const local = LOCAL_MOVE_OVERRIDES[m.name];
  if (local) {
    if (local.staleText !== undefined && (sd.shortDesc || sd.desc) !== local.staleText) {
      throw new Error(
        `LOCAL_MOVE_OVERRIDES["${m.name}"] corrects Showdown's text "${local.staleText}", but the commit now says ` +
          `"${sd.shortDesc || sd.desc}" — re-read it and drop the override if it describes Champions`,
      );
    }
    for (const [k, v] of Object.entries(local)) if (k !== "reason" && k !== "staleText") set(k, v);
  }
  return changes;
}

/**
 * Build a MoveSummary from Showdown data alone — the fallback for
 * Champions-era moves PokeAPI doesn't serve yet, so they're never dropped
 * from a movepool. `sd` is already the Champions-effective entry.
 */
function buildMoveFromShowdown(slug, sd) {
  if (!sd || !sd.name) return null;
  const sec = secondaryFields(sd);
  const boosts = sd.boosts ?? sd.self?.boosts ?? sec.secBoosts ?? null;
  const ratio = (pair) =>
    Array.isArray(pair) ? Math.round((pair[0] / pair[1]) * 100) : 0;
  return {
    name: slug,
    displayName: sd.name,
    type: (sd.type ?? "normal").toLowerCase(),
    damageClass: (sd.category ?? "status").toLowerCase(),
    power: sd.basePower || null,
    accuracy: sd.accuracy === true ? null : sd.accuracy ?? null,
    pp: championsPP(sd),
    priority: sd.priority ?? 0,
    shortEffect: sd.shortDesc || sd.desc || "",
    effect: sd.desc || sd.shortDesc || "",
    target: SHOWDOWN_TARGET[sd.target] ?? null,
    ailment: sec.ailment,
    ailmentChance: sec.ailmentChance,
    statChanges: boostChanges(boosts),
    statChance: boosts && sec.secBoosts ? sec.secChance : 0,
    healing: ratio(sd.heal),
    drain: ratio(sd.drain) || (sd.recoil ? -ratio(sd.recoil) : 0),
    flinchChance: sec.flinchChance,
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
/** Roster slug -> { id: Showdown species, moveSlugs }, resolved up front in main(). */
let movepools = new Map();

/** Human label for a Mega/Primal form, e.g. "charizard-mega-x" -> "Mega Charizard X". */
function formLabel(formSlug, baseDisplay) {
  const megaMatch = formSlug.match(/-mega(?:-([xyz]))?$/);
  if (megaMatch) {
    const suffix = megaMatch[1] ? ` ${megaMatch[1].toUpperCase()}` : "";
    return `Mega ${baseDisplay}${suffix}`;
  }
  if (formSlug.endsWith("-primal")) return `Primal ${baseDisplay}`;
  return toDisplayName(formSlug);
}

/**
 * A battle form is a Mega Evolution (`-mega`, `-mega-x`, `-mega-y`, `-mega-z`)
 * or Primal Reversion (`-primal`). We match by exact suffix rather than a
 * hardcoded list because Pokémon Champions ships its OWN Mega roster —
 * including new ones the classic games never had (Mega Dragonite, Mega
 * Greninja, …) — and this PokeAPI instance carries that Champions data.
 *
 * `-mega-z` used to be excluded here as an API-only junk variant. That flipped
 * with Champions v1.2.0 / Regulation M-C (2026-09-09), which introduced **Z
 * Mega Evolution** as a real mechanic: Mega Lucario Z (Aura Guard), Mega
 * Garchomp Z (Levitate) and Mega Absol Z (Sharpness) are distinct battle forms
 * with their own stat lines, and a species can now carry BOTH a plain Mega and
 * a Mega Z (Lucario/Garchomp/Absol all do). Anything that assumes at most one
 * Mega per species — or an X/Y-only suffix — is wrong post-1.2.
 */
const BATTLE_FORM_RE = /-(mega(-[xyz])?|primal)$/;

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
 * Abilities for a battle form PokeAPI serves with NONE — Showdown's species
 * data for that form (slots 0/1/H; never the event-only "S" slot, e.g.
 * Greninja's Battle Bond, which Champions doesn't allow). A Mega's ability is
 * its single most battle-defining fact, so a form must never ship ability-less.
 * (This used to be MEGA_FORM_ABILITIES, curated by hand from Serebii for the
 * Champions-original Megas PokeAPI once served as `abilities: []`; PokeAPI has
 * served all of them since, so today this fires for nothing — it is the net.)
 */
async function championsFormAbilities(formSlug) {
  const id = showdownSpeciesFor(formSlug);
  const sp = id ? getSpecies(champions, id) : null;
  if (!sp) return [];
  const names = ["0", "1", "H"].map((k) => sp.abilities?.[k]).filter(Boolean);
  return Promise.all(
    names.map(async (name) => ({
      name: slugify(name),
      displayName: name,
      isHidden: false,
      shortEffect: (await getAbilityInfo(slugify(name))).shortEffect,
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
  // A form PokeAPI serves ability-less falls back to Showdown's species data.
  let abilities = await readAbilities(data);
  if (!abilities.length) {
    abilities = await championsFormAbilities(data.name);
    console.warn(
      abilities.length
        ? `  ~ ${data.name}: PokeAPI has no abilities — using Showdown's (${abilities.map((a) => a.displayName).join("/")})`
        : `  ! ${data.name}: no abilities from PokeAPI or Showdown`,
    );
  }
  return {
    key: data.name,
    label: override?.label ?? formLabel(data.name, baseDisplay),
    ...(override?.tab ? { tab: override.tab } : {}),
    kind: override?.kind ?? formKind(data.name),
    types: readTypes(data),
    stats: readStats(data),
    abilities,
    // The FORM's own weight — Low Kick / Grass Knot / Heavy Slam / Heat Crash
    // read it. Until 2026-11-18 forms had none and the calc gave every Mega its
    // base's (Mega Steelix 400 kg instead of 740, Mega Sableye 11 instead of
    // 161): 69 of 84 forms weigh something else. rosterCheck holds it to Showdown.
    weightKg: data.weight / 10,
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
  // A legacy dotted slug ("mr.rime") -> PokeAPI's "mr-rime".
  const slug = rosterSlug.replace(/\./g, "-");

  // The variety that is the Champions form (Floette → Floette-Eternal), else the slug.
  let { data, notFound } = await getJson(`${API}/pokemon/${ROSTER_TO_POKEAPI_POKEMON[slug] ?? slug}`);
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
  const displayName = rosterDisplayName(slug, speciesData);
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

  // The Champions movepool: resolved up front from Showdown's champions mod
  // (main() refuses to bake if any roster slug has no Champions learnset).
  // Megas/stances share it — Showdown gives a forme without its own learnset
  // its base's, and the app's forms carry no moveSlugs of their own.
  const { moveSlugs } = movepools.get(slug);

  return {
    id: speciesData?.id ?? data.id,
    name: slug,
    displayName,
    types: readTypes(data),
    stats: readStats(data),
    abilities: await readAbilities(data, slug),
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
    // PokeAPI's own "champions" version-group learnset — a second opinion
    // logged against Showdown's in main(), never baked.
    _pokeapiChampions: data.moves
      .filter((m) => m.version_group_details.some((d) => d.version_group.name === "champions"))
      .map((m) => m.move.name),
  };
}

/**
 * The roster vs Showdown's Champions-legal species. Every Champions-legal
 * species/forme must be claimed by a roster page or form, or be a documented
 * UNMODELED_SHOWDOWN_FORMS entry — this is the automatic replacement for
 * re-diffing a roster web page by hand. Returns what `npm run status` checks.
 */
function rosterCheck(built) {
  const claimed = new Set();
  const illegalForms = [];
  // PokeAPI's stats/types vs the Champions species' (the mod has no pokedex.ts,
  // so Showdown's base data is the game's). A mismatch = the slug fetched the
  // wrong PokeAPI variety — Floette shipped Red-Flower stats that way.
  const statMismatches = [];
  // Same for WEIGHT (Low Kick / Grass Knot / Heavy Slam / Heat Crash), per form —
  // forms carried their base's until 2026-11-18. Documented exceptions only.
  const weightMismatches = [];
  const SD_STATS = { hp: "hp", attack: "atk", defense: "def", specialAttack: "spa", specialDefense: "spd", speed: "spe" };
  for (const p of built) {
    for (const [key, entry] of [[p.name, p], ...p.forms.map((f) => [f.key, f])]) {
      const id = showdownSpeciesFor(key);
      if (!id) {
        illegalForms.push(key);
        continue;
      }
      claimed.add(id);
      for (const alt of ROSTER_TO_SHOWDOWN[key] ?? []) claimed.add(stripId(alt));
      const sp = getSpecies(champions, id);
      const ours = `${Object.keys(SD_STATS).map((k) => entry.stats[k]).join("/")} ${entry.types.join("/")}`;
      const theirs = `${Object.values(SD_STATS).map((k) => sp.baseStats?.[k]).join("/")} ${(sp.types ?? []).join("/").toLowerCase()}`;
      if (ours !== theirs) statMismatches.push(`${key} ${ours} ≠ ${id} ${theirs}`);
      const known = WEIGHT_CHECK_EXCEPTIONS[key];
      const excused = known && known.pokeapiKg === entry.weightKg && known.showdownKg === sp.weightkg;
      if (entry.weightKg !== sp.weightkg && !excused) weightMismatches.push(`${key} ${entry.weightKg} kg ≠ ${id} ${sp.weightkg} kg`);
    }
  }
  const unclaimed = Object.keys(champions.formatsData)
    .filter((id) => champions.species[id] && isChampionsLegal(champions, id))
    .filter((id) => !claimed.has(id) && !(id in UNMODELED_SHOWDOWN_FORMS))
    .sort();
  return { unclaimedLegal: unclaimed, illegalForms, statMismatches, weightMismatches };
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

  // Showdown's Champions dex (pinned commit) + PokeAPI's full move index.
  console.log("Fetching Showdown's champions mod + PokeAPI's move index…");
  const [dex, moveIndex] = await Promise.all([
    loadChampionsDex({ userAgent: USER_AGENT }),
    getJson(`${API}/move?limit=3000`),
  ]);
  champions = dex;
  console.log(
    `  Showdown ${SHOWDOWN_REPO}@${champions.sha.slice(0, 10)}` +
      (champions.sha === PINNED_SHOWDOWN_SHA ? ` (pinned, ${PINNED_SHOWDOWN_DATE})` : " (SHOWDOWN_SHA trial — NOT the pinned commit)"),
  );
  const knownPokeapiMoves = new Set((moveIndex.data?.results ?? []).map((m) => m.name));
  pokeapiMoveSlug = new Map();
  for (const name of knownPokeapiMoves) {
    const id = stripId(name);
    if (!pokeapiMoveSlug.has(id)) pokeapiMoveSlug.set(id, name);
  }

  // Every roster slug's Champions movepool, resolved BEFORE any PokeAPI work —
  // a slug with no Champions learnset aborts the bake. (The Serebii era fell
  // back to the full MAINLINE movepool here, silently; that path is gone.)
  movepools = new Map();
  const unresolved = [];
  for (const r of roster) {
    const slug = r.replace(/\./g, "-");
    try {
      movepools.set(slug, championsMoveSlugs(slug));
    } catch (err) {
      unresolved.push(err.message);
    }
  }
  if (unresolved.length) {
    throw new Error(
      `no Champions movepool for ${unresolved.length} roster slug(s):\n  ${unresolved.join("\n  ")}\n` +
        "  → map it in scripts/species-aliases.mjs (ROSTER_TO_SHOWDOWN_SPECIES), or remove it from roster.json if it is not in the game",
    );
  }

  const built = (
    await pooled(roster, async (rosterSlug) => {
      try {
        return await buildPokemon(rosterSlug);
      } catch (err) {
        const salvaged = previousPokemon.get(rosterSlug.replace(/\./g, "-"));
        if (salvaged) {
          console.warn(`  ~ ${rosterSlug}: PokeAPI kept failing (${err.message}) — reusing the committed dataset's entry`);
          // Salvage stats/forms, never the movepool: that is Showdown's.
          return { ...salvaged, moveSlugs: movepools.get(salvaged.name).moveSlugs };
        }
        throw err;
      }
    })
  ).filter(Boolean);
  built.sort((a, b) => a.id - b.id);

  // Second opinion: PokeAPI's own "champions" version group (where it has one).
  let agree = 0;
  const disagree = [];
  for (const p of built) {
    const theirs = new Set(p._pokeapiChampions ?? []);
    delete p._pokeapiChampions;
    if (!theirs.size) continue;
    const ours = new Set(p.moveSlugs);
    const onlyOurs = [...ours].filter((s) => !theirs.has(s));
    const onlyTheirs = [...theirs].filter((s) => !ours.has(s) && !EXCLUDED_MOVES.has(s));
    if (!onlyOurs.length && !onlyTheirs.length) agree++;
    else disagree.push(`${p.name}${onlyOurs.length ? ` +${onlyOurs.join("/")}` : ""}${onlyTheirs.length ? ` −${onlyTheirs.join("/")}` : ""}`);
  }
  console.log(
    `  PokeAPI's champions learnsets: ${agree} identical, ${disagree.length} differ` +
      (disagree.length ? ` (PokeAPI lags v1.2.0 — Slash, Pound, …): ${disagree.slice(0, 6).join(", ")}${disagree.length > 6 ? ", …" : ""}` : ""),
  );

  // Fetch every move once into a shared index, keyed by slug. Each Pokémon
  // references moves by slug, so move data isn't duplicated 180+ times.
  const allMoveSlugs = [...new Set(built.flatMap((p) => p.moveSlugs))].sort();
  console.log(`Fetching ${allMoveSlugs.length} unique moves…`);
  const moveList = (await pooled(allMoveSlugs, buildMove)).filter(Boolean);
  // Champions layer: PP scale + the mod's patches + Champions text. Flags
  // (contact, sound, slicing…) come from Showdown — PokeAPI has none — and
  // Showdown also settles any spread/single-target disagreement, since that one
  // drives the ×0.75 damage reduction.
  const retargeted = [];
  const patched = [];
  let ppRescaled = 0;
  for (const m of moveList) {
    const sd = sdMove(m.name);
    const changes = applyChampionsMove(m) ?? [];
    if (changes.some((c) => c.startsWith("pp "))) ppRescaled++;
    const notable = changes.filter((c) => !c.startsWith("pp ") || champions.modMoves[stripId(m.name)]?.pp !== undefined);
    m.flags = showdownFlags(sd);
    const mainlineFlags = showdownFlags(champions.baseMoves[stripId(m.name)]);
    const gained = m.flags.filter((f) => !mainlineFlags.includes(f));
    const lost = mainlineFlags.filter((f) => !m.flags.includes(f));
    if (gained.length || lost.length) notable.push(`flags ${[...gained.map((f) => `+${f}`), ...lost.map((f) => `−${f}`)].join(" ")}`);
    if (notable.length) patched.push(`${m.name} (${notable.join(", ")})`);
    const fixed = reconciledSpreadTarget(m, sd);
    if (fixed) {
      retargeted.push(`${m.name}: ${m.target} → ${fixed}`);
      m.target = fixed;
    }
  }
  console.log(`  ~ Champions PP scale applied to ${ppRescaled} moves; ${patched.length} carry champions-mod patches`);
  for (const line of patched) console.log(`      ${line}`);
  if (retargeted.length) {
    console.log(`  ~ spread target corrected from Showdown: ${retargeted.join(", ")}`);
  }
  const moves = Object.fromEntries(moveList.map((m) => [m.name, m]));

  // Moves PokeAPI couldn't resolve (Champions-new) are built from Showdown
  // data instead of being dropped; only moves missing from BOTH are dropped.
  const unresolvedMoves = allMoveSlugs.filter((s) => !moves[s]);
  const dropped = [];
  for (const slug of unresolvedMoves) {
    const recovered = buildMoveFromShowdown(slug, sdMove(slug));
    if (recovered) moves[slug] = recovered;
    else dropped.push(slug);
  }
  if (unresolvedMoves.length - dropped.length > 0) {
    console.log(`  + recovered ${unresolvedMoves.length - dropped.length} move(s) from Showdown data: ${unresolvedMoves.filter((s) => moves[s]).join(", ")}`);
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
      const sd = sdMove(m.name);
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

  // Names Showdown couldn't supply (PokeAPI's English name or the slug rule
  // stood in) — none today; a new one means a Showdown id the slug doesn't hit.
  if (nameFallbacks.length) {
    console.warn(`  ~ ${nameFallbacks.length} name(s) not from Showdown: ${[...new Set(nameFallbacks)].join("; ")}`);
  }

  // The roster vs the game, per Showdown (status turns any gap red).
  const check = rosterCheck(built);
  if (check.unclaimedLegal.length) {
    console.warn(
      `  ! Champions-legal per Showdown but no roster page/form: ${check.unclaimedLegal.join(", ")} — add to roster.json ` +
        "(or UNMODELED_SHOWDOWN_FORMS in species-aliases.mjs, with a reason)",
    );
  }
  if (check.illegalForms.length) {
    console.warn(`  ! baked but not Champions-legal per Showdown: ${check.illegalForms.join(", ")}`);
  }
  if (check.statMismatches.length) {
    console.warn(
      `  ! base stats/types differ from Showdown's Champions species: ${check.statMismatches.join("; ")} — ` +
        "map the slug to the right PokeAPI variety (ROSTER_TO_POKEAPI_POKEMON in species-aliases.mjs)",
    );
  }
  if (check.weightMismatches.length) {
    console.warn(
      `  ! weight differs from Showdown's Champions species: ${check.weightMismatches.join("; ")} — ` +
        "fix the PokeAPI variety, or document it in WEIGHT_CHECK_EXCEPTIONS (species-aliases.mjs)",
    );
  }

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(
    OUT_PATH,
    JSON.stringify(
      {
        // generatedAt drives the home screen's "data updated" stamp.
        generatedAt: new Date().toISOString().slice(0, 10),
        sources: {
          showdown: {
            repo: SHOWDOWN_REPO,
            commit: champions.sha,
            mod: "data/mods/champions",
            license: SHOWDOWN_LICENSE,
          },
          // Which Showdown species' Champions learnset each roster page carries.
          movepools: Object.fromEntries(built.map((p) => [p.name, movepools.get(p.name).id])),
          rosterCheck: check,
        },
        // Champions' held-item pool (Showdown's champions items.ts: everything
        // not tagged nonstandard — no Choice Band/Specs, Assault Vest, Eviolite…).
        // `npm run status` holds the Calc's fixed item list to it.
        itemPool: Object.values(champions.items)
          .filter((it) => !it.isNonstandard && it.name)
          .map((it) => it.name)
          .sort(),
        // Showdown's text for each pool item, at the pinned commit. data:comp
        // describes an item PokeAPI has no text for from this — the
        // Champions-original Mega Stones, the three v1.2.0 Z stones and Leek
        // used to ship a generated placeholder ("Absolite Z — a held item used
        // in Pokémon Champions.") although Showdown names what each one does.
        itemText: Object.fromEntries(
          Object.values(champions.items)
            .filter((it) => !it.isNonstandard && it.name)
            .map((it) => [it.name, champions.text.item(stripId(it.name)).shortDesc])
            .filter(([, text]) => text)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        ),
        pokemon: built,
        moves,
      },
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
