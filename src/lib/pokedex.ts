import dataset from "@/data/generated/pokemon.json";
import competitiveData from "@/data/generated/competitive.json";
import type {
  ChampionPokemon,
  CompetitiveDataset,
  CompetitiveMeta,
  CompetitiveProfile,
  ItemDetail,
  MoveSummary,
  PokedexDataset,
  PokemonType,
} from "./types";

/**
 * The baked dataset, imported statically so it ships in the bundle and is
 * available instantly — no runtime fetch, no loading state. Tolerant of the
 * legacy array shape so a mid-regeneration dataset never breaks the app.
 */
const raw = dataset as unknown;
const DATA: PokedexDataset = Array.isArray(raw)
  ? { pokemon: raw as ChampionPokemon[], moves: {} }
  : (raw as PokedexDataset);

const ALL = DATA.pokemon;

/** Every Pokémon in the Champions Pokédex, in National Dex order. */
export function getAllPokemon(): ChampionPokemon[] {
  return ALL;
}

const MOVES = DATA.moves;

/** Look up a single Pokémon by its PokeAPI slug (the route param). */
export function getPokemonByName(name: string): ChampionPokemon | undefined {
  return ALL.find((p) => p.name === name);
}

/** Resolve a Pokémon's move slugs into full move data from the shared index. */
export function getMovesFor(pokemon: ChampionPokemon): MoveSummary[] {
  return (pokemon.moveSlugs ?? []).map((s) => MOVES[s]).filter(Boolean);
}

/** A single move from the shared index, by slug. */
export function getMoveBySlug(slug: string): MoveSummary | undefined {
  return MOVES[slug];
}

const COMPETITIVE = competitiveData as unknown as CompetitiveDataset;

/** The Champions ladder snapshot the competitive data was distilled from. */
export function getCompetitiveMeta(): CompetitiveMeta {
  return COMPETITIVE.meta;
}

/**
 * How a specific form is played on the Champions doubles ladder, if it sees
 * enough play. Keyed by form slug — the base slug, or a Mega slug like
 * "charizard-mega-y".
 */
export function getCompetitiveByKey(
  key: string,
): CompetitiveProfile | undefined {
  return COMPETITIVE.pokemon[key];
}

/** Look up full item details (effect, category, sprite) by slug, for the item modal. */
export function getItemDetail(slug: string | null): ItemDetail | undefined {
  return slug ? COMPETITIVE.itemIndex?.[slug] : undefined;
}

/** Build a form-key → profile map for a Pokémon's base + Mega forms. */
export function getCompetitiveByForm(
  pokemon: ChampionPokemon,
): Record<string, CompetitiveProfile> {
  const keys = [pokemon.name, ...pokemon.forms.map((f) => f.key)];
  const out: Record<string, CompetitiveProfile> = {};
  for (const key of keys) {
    const profile = COMPETITIVE.pokemon[key];
    if (profile) out[key] = profile;
  }
  return out;
}

/** Total roster size, for headers and counts. */
export function getRosterCount(): number {
  return ALL.length;
}

/**
 * A trimmed-down roster row for the search list. Kept lean on purpose: this is
 * the payload serialized to the client, so it carries only what a list row and
 * a name/type search need — not full stats, abilities, or form data.
 */
export interface RosterEntry {
  id: number;
  name: string;
  displayName: string;
  types: PokemonType[];
  /** Best available list icon (Pokémon HOME render, falling back gracefully). */
  icon: string | null;
  /** Detail-page hero artwork, so the list can prefetch it before a tap. */
  artwork: string | null;
  /** First Mega form's hero artwork, for prefetching the Mega deep-link. */
  megaArtwork: string | null;
  bst: number;
  hasMega: boolean;
  /** First Mega/alternate form key, so the list can deep-link straight to it. */
  megaKey: string | null;
  /** Doubles ladder pick rate (%), or null if it sees no meaningful play. */
  usagePct: number | null;
  /** Base species slug, so "ninetales" matches "Alolan Ninetales" in search. */
  species: string;
}

// Strip a form suffix to the base species so forms are findable by base name.
const FORM_SUFFIX = /-(alola|galar|hisui|paldea|wash|heat|frost|mow|fan)(-.*)?$/;
function baseSpecies(slug: string): string {
  return slug.replace(FORM_SUFFIX, "");
}

/** Lean roster projection for the home search screen. */
export function getRosterEntries(): RosterEntry[] {
  return ALL.map((p) => {
    // Rank by the most-used form: many species are played almost entirely as
    // their Mega (Charizard 0.2% base vs Mega-Y 14%), so use the max.
    const usages = [p.name, ...p.forms.map((f) => f.key)]
      .map((k) => COMPETITIVE.pokemon[k]?.usagePct)
      .filter((u): u is number => u != null);
    return {
      id: p.id,
      name: p.name,
      displayName: p.displayName,
      types: p.types,
      icon: p.home ?? p.artwork ?? p.sprite,
      artwork: p.artwork ?? p.home ?? p.sprite,
      megaArtwork: p.forms[0]?.artwork ?? null,
      bst: p.stats.total,
      hasMega: p.forms.length > 0,
      megaKey: p.forms[0]?.key ?? null,
      usagePct: usages.length ? Math.max(...usages) : null,
      species: baseSpecies(p.name),
    };
  });
}
