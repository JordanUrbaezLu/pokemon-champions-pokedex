import { POKEMON_TYPES, type PokemonType } from "./types";

/**
 * Gen 6+ type effectiveness chart.
 *
 * Maps ATTACKING type -> DEFENDING type -> damage multiplier.
 * Any pair not listed is neutral (1x). Kept as a local constant so type
 * matchups resolve instantly with no network round-trip — this is what a
 * trainer leans on mid-battle.
 */
type Chart = Record<PokemonType, Partial<Record<PokemonType, number>>>;

export const TYPE_CHART: Chart = {
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: {
    fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2,
    flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5,
  },
  ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: {
    normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5,
    bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5,
  },
  poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
  ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug: {
    fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5,
    psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5,
  },
  rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon: { dragon: 2, steel: 0.5, fairy: 0 },
  dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
  fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
};

/**
 * Damage multiplier of a single attacking type against a (possibly dual-typed)
 * defender. Multipliers stack across the defender's types — e.g. an Ice move
 * vs. a Grass/Flying defender is 2 * 2 = 4x.
 */
export function defensiveMultiplier(
  attacking: PokemonType,
  defenderTypes: readonly PokemonType[],
): number {
  return defenderTypes.reduce(
    (mult, def) => mult * (TYPE_CHART[attacking][def] ?? 1),
    1,
  );
}

/** A defender's matchup against every attacking type, one entry per type. */
export interface TypeMatchup {
  type: PokemonType;
  multiplier: number;
}

/**
 * Defensive matchups for a defender, bucketed by how a trainer thinks about
 * them in battle: what to hit it with, and what it shrugs off.
 */
export interface DefensiveProfile {
  /** 4x — a trainer's best-case offense. */
  quad: PokemonType[];
  /** 2x. */
  weak: PokemonType[];
  /** 0.5x. */
  resists: PokemonType[];
  /** 0.25x. */
  doubleResists: PokemonType[];
  /** 0x — these moves do nothing. */
  immune: PokemonType[];
}

/**
 * Compute the full defensive profile for a set of types. Drives the
 * "what beats this Pokémon" panel that the whole app exists to deliver.
 */
export function defensiveProfile(
  defenderTypes: readonly PokemonType[],
): DefensiveProfile {
  const profile: DefensiveProfile = {
    quad: [],
    weak: [],
    resists: [],
    doubleResists: [],
    immune: [],
  };

  for (const type of POKEMON_TYPES) {
    const m = defensiveMultiplier(type, defenderTypes);
    if (m === 0) profile.immune.push(type);
    else if (m >= 4) profile.quad.push(type);
    else if (m > 1) profile.weak.push(type);
    else if (m <= 0.25) profile.doubleResists.push(type);
    else if (m < 1) profile.resists.push(type);
  }

  return profile;
}

/** Every attacking type and its multiplier vs. the defender, for a full grid. */
export function allMatchups(
  defenderTypes: readonly PokemonType[],
): TypeMatchup[] {
  return POKEMON_TYPES.map((type) => ({
    type,
    multiplier: defensiveMultiplier(type, defenderTypes),
  }));
}
