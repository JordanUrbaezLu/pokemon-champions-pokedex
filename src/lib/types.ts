/**
 * Domain model for the Pokémon Champions Pokédex.
 *
 * Everything the app renders comes from these shapes. The raw PokeAPI v2
 * responses are normalized into this model at build time by
 * `scripts/generate-dataset.mjs`, so the running app never talks to the API.
 */

export const POKEMON_TYPES = [
  "normal",
  "fire",
  "water",
  "electric",
  "grass",
  "ice",
  "fighting",
  "poison",
  "ground",
  "flying",
  "psychic",
  "bug",
  "rock",
  "ghost",
  "dragon",
  "dark",
  "steel",
  "fairy",
] as const;

export type PokemonType = (typeof POKEMON_TYPES)[number];

/** The six battle stats, keyed for quick access. */
export interface PokemonStats {
  hp: number;
  attack: number;
  defense: number;
  specialAttack: number;
  specialDefense: number;
  speed: number;
  /** Base stat total — a fast proxy for raw power. */
  total: number;
}

export interface PokemonAbility {
  /** PokeAPI slug, e.g. "intimidate". */
  name: string;
  /** Human-readable, e.g. "Intimidate". */
  displayName: string;
  /** Hidden abilities are rarer and worth flagging in battle. */
  isHidden: boolean;
  /** One-line effect summary, pulled from the ability's short_effect. */
  shortEffect: string;
}

/**
 * What kind of in-battle form this is — a Mega/Primal, or a stance/form change
 * (Aegislash Blade, Palafin Hero, …) that shares the base's competitive data.
 */
export type FormKind = "mega" | "primal" | "stance" | "form";

/**
 * An alternate in-battle form (Mega Evolution / Primal Reversion / stance /
 * form change) with its own battle profile. A trainer toggles to these on the
 * detail screen to see how the threat changes — different typing, stats, ability.
 */
export interface BattleForm {
  /** PokeAPI slug of the form, e.g. "charizard-mega-x". */
  key: string;
  /** Display label, e.g. "Mega Charizard X". */
  label: string;
  /** Short label for the form toggle tab (defaults to a stripped `label`). */
  tab?: string;
  kind: FormKind;
  types: PokemonType[];
  stats: PokemonStats;
  abilities: PokemonAbility[];
  sprite: string | null;
  artwork: string | null;
}

/**
 * A single Champions-roster Pokémon, normalized and battle-ready.
 * This is the unit the entire UI is built around.
 *
 * The top-level type/stat/ability fields describe the **base form**. Any
 * Mega/Primal forms live in `forms` and are surfaced via the detail-page toggle.
 */
export interface ChampionPokemon {
  id: number;
  /** PokeAPI slug, e.g. "charizard" — used as the route param. */
  name: string;
  /** Display name, e.g. "Charizard". */
  displayName: string;
  types: PokemonType[];
  stats: PokemonStats;
  abilities: PokemonAbility[];
  /** Height in metres. */
  heightM: number;
  /** Weight in kilograms. */
  weightKg: number;
  /** Small pixel sprite (fallback list icon). */
  sprite: string | null;
  /** High-res official artwork, used on the detail screen. */
  artwork: string | null;
  /** Clean Pokémon HOME render — the preferred list icon. */
  home: string | null;
  /** Alternate in-battle forms (Mega/Primal/stance/form). Empty for most Pokémon. */
  forms: BattleForm[];
  /**
   * For stance/form mons, the default form's real name (e.g. "Shield",
   * "Zero", "Male") shown as the first toggle tab instead of "Base".
   */
  baseFormLabel?: string;
  /**
   * Recently added to Champions and not yet on the ladder (from roster.json
   * `newcomers`). Surfaced as a NEW badge + a home-screen filter so trainers
   * can find and learn the mons they haven't faced yet.
   */
  isNew?: boolean;
  /**
   * Slugs of the moves this Pokémon can learn (current-generation movepool),
   * resolved against the dataset's shared move index. Kept as slugs to avoid
   * duplicating full move data across 180+ Pokémon.
   */
  moveSlugs: string[];
}

/** Whether a move deals physical/special damage, or is a non-damaging status move. */
export type DamageClass = "physical" | "special" | "status";

/** A move's battle-facing properties — what a trainer needs to read a threat. */
export interface MoveSummary {
  name: string;
  displayName: string;
  type: PokemonType;
  damageClass: DamageClass;
  /** Base power; null for status (and a few variable-power) moves. */
  power: number | null;
  /** Accuracy %, or null when a move never misses. */
  accuracy: number | null;
  pp: number | null;
  /** Turn priority (e.g. +1 for Bullet Punch). 0 for most moves. */
  priority: number;
  shortEffect: string;
  /** Full effect text, shown in the move modal. */
  effect: string;
  /** Who the move hits, e.g. "all-other-pokemon" (matters in doubles). */
  target: string | null;
  /** Status it can inflict, e.g. "paralysis" (null if none). */
  ailment: string | null;
  ailmentChance: number;
  /** Stat changes, e.g. [{ stat: "attack", change: 2 }] for Swords Dance. */
  statChanges: { stat: string; change: number }[];
  /** Chance (%) the stat change happens; 0 = guaranteed (a self-boost/drop). */
  statChance: number;
  /** % of damage healed (drain) or % of max HP recovered (healing). */
  healing: number;
  drain: number;
  flinchChance: number;
  critRate: number;
  minHits: number | null;
  maxHits: number | null;
  /**
   * Showdown move flags worth surfacing ("contact", "punch", "sound",
   * "bullet", "bite", "slicing", "wind", "pulse").
   */
  flags?: string[];
}

/** The full baked dataset: the roster plus a shared move index. */
export interface PokedexDataset {
  /** ISO date the dataset was generated — the home screen's freshness stamp. */
  generatedAt?: string;
  pokemon: ChampionPokemon[];
  moves: Record<string, MoveSummary>;
}

// --- Competitive layer (from the Champions Smogon ladder) ---------------------

export type EvStat = "hp" | "atk" | "def" | "spa" | "spd" | "spe";

export interface CompetitiveTeammate {
  displayName: string;
  /** Roster slug if the teammate is in the Champions roster (for linking). */
  slug: string | null;
  usagePct: number;
}

export interface CompetitiveSpread {
  nature: string;
  evs: Partial<Record<EvStat, number>>;
}

/**
 * How a Pokémon is actually played on the Champions ladder — distilled from
 * Smogon usage stats. This is what answers "what will my opponent be running?".
 */
/** A build-time damage verdict: one likely move vs the top-meta common sets. */
export interface MoveBenchmark {
  /** move slug */
  move: string;
  ohkoCount: number;
  twoCount: number;
  /** example victims (Smogon display names), max 3 each */
  ohko: string[];
  two: string[];
}

export interface CompetitiveProfile {
  /** Usage: share of teams running this Pokémon. */
  usagePct: number;
  rawCount: number;
  /** Smogon display name behind this profile (drives build-time tooling). */
  smogonName?: string;
  /**
   * When the data is for a different form than the page's base (e.g. base Rotom
   * resolves to the doubles-relevant Rotom-Wash), the Smogon form name shown.
   */
  asForm: string | null;
  /** Usage % per ability, keyed by stripped ability id (e.g. "roughskin"). */
  abilityUsage: Record<string, number>;
  /** Usage % per move, keyed by move slug — woven into the movepool list. */
  moveUsage: Record<string, number>;
  items: { displayName: string; slug: string | null; usagePct: number }[];
  /**
   * % of sets running each item CLASS, from the full item table (not just the
   * top 3): "scarf", "choice" (band/specs/scarf), "sash", "lifeOrb", "av",
   * "berry".
   */
  itemClasses?: Record<string, number> | null;
  spread: CompetitiveSpread | null;
  /**
   * How the FULL spread distribution invests in Speed — catches bimodal mons
   * the single top spread misrepresents. Percentages of weighted sets:
   * max (252 Spe), some, none (0 Spe, neutral nature), minus (a −Spe nature —
   * the Trick Room tell).
   */
  speedInvest?: { max: number; some: number; none: number; minus: number } | null;
  teammates: CompetitiveTeammate[];
  /** Set-up moves (Swords Dance, Calm Mind, …) common enough to watch for. */
  setupThreats: { displayName: string; usagePct: number }[];
  /**
   * Precomputed KO verdicts for its likely moves vs the top meta's common
   * sets (@smogon/calc at build time) — the damage-calculator answer with
   * zero inputs. Master bracket only.
   */
  benchmarks?: MoveBenchmark[];
}

/**
 * The two data brackets the app toggles between: "master" = Smogon's top
 * skill cutoffs (1760, backfilled from 1630), "all" = the whole ladder.
 */
export type DataBracket = "master" | "all";

export interface CompetitiveMeta {
  format: string;
  /** Human-readable format label, e.g. "Champions VGC (doubles), Reg M-A". */
  formatLabel: string;
  month: string;
  battles: number;
  source: string;
  /** ISO date the competitive snapshot was generated. */
  generatedAt?: string;
  /** Footnote label per bracket, e.g. master -> "Master+ (top ladder brackets)". */
  bracketLabels?: Record<DataBracket, string>;
}

/** Full details for a held item, for the item modal. */
export interface ItemDetail {
  slug: string;
  displayName: string;
  shortEffect: string;
  effect: string;
  category: string | null;
  sprite: string | null;
  flingPower: number | null;
}

export interface CompetitiveDataset {
  meta: CompetitiveMeta;
  /** Complete profile maps per data bracket — the toggle switches between them. */
  brackets: Record<DataBracket, Record<string, CompetitiveProfile>>;
  /** Item details keyed by slug, for items referenced in typical sets. */
  itemIndex: Record<string, ItemDetail>;
}

// --- Meta teams (real tournament teams) ---------------------------------------
// Smogon exposes no "teams" for this format — only per-Pokémon co-usage. So the
// Meta Teams are REAL, whole teams lifted from Smogon's official "Champions VGC
// Regulation … Sample Teams" thread (collated from TPCi + grassroots events),
// baked at build time by scripts/generate-teams.mjs. Nothing here is synthesized.

/** One Pokémon on a meta team — its exact set, plus links back into the dex. */
export interface MetaTeamMember {
  /** Roster route slug (base species), or null if it isn't in the roster. */
  slug: string | null;
  /** Battle-form key for the `?form=` deep link, or null for the base form. */
  formKey: string | null;
  /** Base species display name, e.g. "Charizard". */
  name: string;
  /** Full form label, e.g. "Mega Charizard Y". */
  formLabel: string;
  types: PokemonType[];
  sprite: string | null;
  isMega: boolean;
  item: string | null;
  ability: string | null;
  nature: string | null;
  /** EV spread exactly as written in the source paste (Champions' own scale). */
  evs: Partial<Record<EvStat, number>>;
  /** Pre-formatted EV line, e.g. "252 HP / 4 Def / 252 Spe". */
  evStr: string;
  /** The four moves, in paste order. */
  moves: string[];
  gender: string | null;
  /** This form's current Master+ ladder usage %, or null if it sees no play. */
  usagePct: number | null;
}

/** Who built a team and how it placed — the pedigree that makes it a "top" team. */
export interface MetaTeamCredit {
  raw: string;
  author: string | null;
  /** Event + result, e.g. "Season M-3 Rank #1" or "Champions Arena II 1st Place". */
  detail: string | null;
}

export interface MetaTeam {
  /** URL slug for the /teams/[slug] detail route. */
  slug: string;
  /** Display order (1 = most decorated); the page features the top `topN`. */
  rank: number;
  /** Codename, e.g. "Mega Metagross + Mega Swampert Rain". */
  name: string;
  /** Play-style / weather archetype, e.g. "Rain", "Sun", "Offense". */
  archetype: string | null;
  /** A Pokémon type used to tint the archetype tag (weather archetypes only). */
  archetypeType: PokemonType | null;
  credit: MetaTeamCredit | null;
  /** The published sets are a recreation of the original (flagged honestly). */
  isRecreation: boolean;
  pasteUrl: string;
  /** Sum of the six members' current Master+ usage — a "how meta is this core" read. */
  metaFootprint: number;
  members: MetaTeamMember[];
}

export interface MetaTeamsMeta {
  format: string;
  regulationLabel: string;
  /** Sample-teams thread URL the teams were lifted from. */
  source: string;
  sourceLabel: string;
  /** ISO date — pinned to the competitive snapshot's date. */
  generatedAt?: string;
  /** How many teams the list page features up top. */
  topN: number;
  count: number;
}

export interface MetaTeamsDataset {
  meta: MetaTeamsMeta;
  teams: MetaTeam[];
}
