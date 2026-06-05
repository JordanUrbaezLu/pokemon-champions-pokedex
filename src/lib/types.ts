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

/** What kind of in-battle form this is. */
export type FormKind = "mega" | "primal";

/**
 * An alternate in-battle form (Mega Evolution / Primal Reversion) with its own
 * battle profile. A trainer toggles to these on the detail screen to see how
 * the threat changes — different typing, stats, and ability.
 */
export interface BattleForm {
  /** PokeAPI slug of the form, e.g. "charizard-mega-x". */
  key: string;
  /** Display label, e.g. "Mega Charizard X". */
  label: string;
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
  /** Alternate in-battle forms (Mega/Primal). Empty for most Pokémon. */
  forms: BattleForm[];
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
}

/** The full baked dataset: the roster plus a shared move index. */
export interface PokedexDataset {
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
export interface CompetitiveProfile {
  /** Usage: share of teams running this Pokémon. */
  usagePct: number;
  rawCount: number;
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
  spread: CompetitiveSpread | null;
  teammates: CompetitiveTeammate[];
  /** Set-up moves (Swords Dance, Calm Mind, …) common enough to watch for. */
  setupThreats: { displayName: string; usagePct: number }[];
}

export interface CompetitiveMeta {
  format: string;
  /** Human-readable format label, e.g. "Champions VGC (doubles), Reg M-A". */
  formatLabel: string;
  month: string;
  battles: number;
  source: string;
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
  pokemon: Record<string, CompetitiveProfile>;
  /** Item details keyed by slug, for items referenced in typical sets. */
  itemIndex: Record<string, ItemDetail>;
}
