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

/**
 * Abilities that OVERRIDE raw type effectiveness on defense. The matchup grid
 * is pure type math and can't see them, so a Levitate mon would read "weak to
 * Ground" and an Eelektross (pure Electric + Levitate) would read "weak to
 * Ground" despite having no weaknesses at all. We surface these as an explicit
 * caveat so a trainer never commits to a move the opponent's ability negates.
 * Keyed by stripped ability id.
 */
const DEFENSIVE_ABILITY_NOTES: Record<string, string> = {
  levitate: "Levitate — immune to Ground (ignore any Ground weakness)",
  flashfire: "Flash Fire — immune to Fire (and it powers up)",
  waterabsorb: "Water Absorb — heals from Water instead of taking it",
  stormdrain: "Storm Drain — draws in and absorbs Water",
  dryskin: "Dry Skin — heals from Water (but takes 1.25× Fire)",
  voltabsorb: "Volt Absorb — heals from Electric",
  lightningrod: "Lightning Rod — draws in and absorbs Electric",
  motordrive: "Motor Drive — Electric does nothing (gives it +1 Speed)",
  sapsipper: "Sap Sipper — Grass does nothing (gives it +1 Attack)",
  eartheater: "Earth Eater — heals from Ground",
  wellbakedbody: "Well-Baked Body — immune to Fire (gains +2 Def)",
  thickfat: "Thick Fat — takes half from Fire and Ice",
  heatproof: "Heatproof — takes half from Fire",
  waterbubble: "Water Bubble — takes half from Fire",
  purifyingsalt: "Purifying Salt — takes half from Ghost",
  fluffy: "Fluffy — takes 2× Fire (but halves contact moves)",
  wonderguard: "Wonder Guard — only super-effective hits connect",
};

const stripAbilityId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Human-readable caveats for any of the defender's abilities that change its
 * real type matchups. One entry per distinct ability; empty when none apply.
 */
export function abilityMatchupNotes(abilityNames: readonly string[]): string[] {
  const notes: string[] = [];
  for (const name of abilityNames) {
    const note = DEFENSIVE_ABILITY_NOTES[stripAbilityId(name)];
    if (note && !notes.includes(note)) notes.push(note);
  }
  return notes;
}

/**
 * Machine-readable companion to DEFENSIVE_ABILITY_NOTES: abilities that REDUCE
 * incoming effectiveness, as a multiplier on the raw type result (0 = negated,
 * 0.5 = halved). Only reducing entries live here — an ability can't be relied on
 * to CREATE a weakness (the opponent may not be running it), but the "kill shot"
 * must never promise damage an ability negates. Keyed by stripped ability id.
 */
const DEFENSIVE_ABILITY_FACTORS: Record<string, Partial<Record<PokemonType, number>>> = {
  levitate: { ground: 0 },
  flashfire: { fire: 0 },
  wellbakedbody: { fire: 0 },
  waterabsorb: { water: 0 },
  stormdrain: { water: 0 },
  dryskin: { water: 0 },
  voltabsorb: { electric: 0 },
  lightningrod: { electric: 0 },
  motordrive: { electric: 0 },
  sapsipper: { grass: 0 },
  eartheater: { ground: 0 },
  thickfat: { fire: 0.5, ice: 0.5 },
  heatproof: { fire: 0.5 },
  waterbubble: { fire: 0.5 },
  purifyingsalt: { ghost: 0.5 },
};

/**
 * Worst-case (most-resistant) multiplier of an attacking type given the
 * defender's POSSIBLE abilities. Used where a claim must hold no matter which
 * ability the opponent is actually running — so if any of its abilities negates
 * or halves the type, that's what we assume. Falls back to raw type math when
 * no ability touches the type.
 */
export function effectiveDefensiveMultiplier(
  attacking: PokemonType,
  defenderTypes: readonly PokemonType[],
  abilityNames: readonly string[] = [],
): number {
  let factor = 1;
  for (const name of abilityNames) {
    const f = DEFENSIVE_ABILITY_FACTORS[stripAbilityId(name)]?.[attacking];
    if (f != null) factor = Math.min(factor, f);
  }
  return defensiveMultiplier(attacking, defenderTypes) * factor;
}

/**
 * Ability-aware defensive profile — the read the "kill shot" can trust. Same
 * buckets as {@link defensiveProfile}, but a weakness the mon's ability negates
 * or halves is demoted: a Levitate mon shows NO Ground weakness, and a Thick Fat
 * mon's 4× Ice drops to a 2× (out of `quad`). Type-only when no abilities given.
 */
export function effectiveDefensiveProfile(
  defenderTypes: readonly PokemonType[],
  abilityNames: readonly string[] = [],
): DefensiveProfile {
  const profile: DefensiveProfile = {
    quad: [],
    weak: [],
    resists: [],
    doubleResists: [],
    immune: [],
  };
  for (const type of POKEMON_TYPES) {
    const m = effectiveDefensiveMultiplier(type, defenderTypes, abilityNames);
    if (m === 0) profile.immune.push(type);
    else if (m >= 4) profile.quad.push(type);
    else if (m > 1) profile.weak.push(type);
    else if (m <= 0.25) profile.doubleResists.push(type);
    else if (m < 1) profile.resists.push(type);
  }
  return profile;
}
