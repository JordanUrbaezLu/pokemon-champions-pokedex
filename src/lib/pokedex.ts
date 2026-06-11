import dataset from "@/data/generated/pokemon.json";
import competitiveData from "@/data/generated/competitive.json";
import {
  getThreatProfile,
  metaIndexes,
  type MetaDistribution,
  type ThreatProfile,
} from "./threat";
import type {
  BattleForm,
  ChampionPokemon,
  CompetitiveDataset,
  CompetitiveMeta,
  CompetitiveProfile,
  DataBracket,
  ItemDetail,
  MoveSummary,
  PokedexDataset,
  PokemonType,
} from "./types";

export const DATA_BRACKETS: DataBracket[] = ["master", "all"];

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

/** One bracket's complete profile map. */
function profilesOf(bracket: DataBracket): Record<string, CompetitiveProfile> {
  return COMPETITIVE.brackets[bracket] ?? {};
}

/** The Champions ladder snapshot the competitive data was distilled from. */
export function getCompetitiveMeta(): CompetitiveMeta {
  return COMPETITIVE.meta;
}

/**
 * How a specific form is played on the Champions doubles ladder, in the given
 * bracket. Keyed by form slug — the base slug, or a Mega slug like
 * "charizard-mega-y".
 */
export function getCompetitiveByKey(
  key: string,
  bracket: DataBracket,
): CompetitiveProfile | undefined {
  return profilesOf(bracket)[key];
}

/** Look up full item details (effect, category, sprite) by slug, for the item modal. */
export function getItemDetail(slug: string | null): ItemDetail | undefined {
  return slug ? COMPETITIVE.itemIndex?.[slug] : undefined;
}

/** Build a form-key → profile map for a Pokémon's base + Mega forms. */
export function getCompetitiveByForm(
  pokemon: ChampionPokemon,
  bracket: DataBracket,
): Record<string, CompetitiveProfile> {
  const keys = [pokemon.name, ...pokemon.forms.map((f) => f.key)];
  const out: Record<string, CompetitiveProfile> = {};
  for (const key of keys) {
    const profile = profilesOf(bracket)[key];
    if (profile) out[key] = profile;
  }
  return out;
}

/** Total roster size, for headers and counts. */
export function getRosterCount(): number {
  return ALL.length;
}

/** ISO date the baked dataset was generated — the home screen freshness stamp. */
export function getDataUpdatedAt(): string | null {
  return DATA.generatedAt ?? null;
}

/**
 * A Pokémon's movepool UNIONED with any move the ladder shows it actually
 * running in ANY bracket (a few signature moves are missing from Serebii's
 * tables) — the superset list every consumer uses, so the move list stays
 * stable while the bracket toggle only changes the usage annotations.
 */
export function getUnionMoves(pokemon: ChampionPokemon): MoveSummary[] {
  const movepool = getMovesFor(pokemon);
  const have = new Set(movepool.map((m) => m.name));
  const extra: MoveSummary[] = [];
  for (const bracket of DATA_BRACKETS) {
    for (const key of [pokemon.name, ...pokemon.forms.map((f) => f.key)]) {
      const profile = profilesOf(bracket)[key];
      if (!profile) continue;
      for (const slug of Object.keys(profile.moveUsage)) {
        if (!have.has(slug)) {
          const m = MOVES[slug];
          if (m) {
            have.add(slug);
            extra.push(m);
          }
        }
      }
    }
  }
  return [...movepool, ...extra];
}

// --- Threat profiles -------------------------------------------------------------

/** Every (form, profile) pair a Pokémon contributes to the meta picture. */
function formsOf(p: ChampionPokemon): (Pick<BattleForm, "key" | "types" | "stats" | "abilities">)[] {
  return [
    { key: p.name, types: p.types, stats: p.stats, abilities: p.abilities },
    ...p.forms,
  ];
}

// The whole-meta stat distributions behind the percentile reads ("hits harder
// than 96% of the meta"), one per bracket so percentiles compare like with
// like. Built lazily ONCE per process — at build time, since every page is
// prerendered — and shared by all pages.
const metaDistributions = new Map<DataBracket, MetaDistribution>();
function getMetaDistribution(bracket: DataBracket): MetaDistribution {
  const cached = metaDistributions.get(bracket);
  if (cached) return cached;
  const offense: number[] = [];
  const speed: number[] = [];
  const physBulk: number[] = [];
  const specBulk: number[] = [];
  for (const p of ALL) {
    const moves = getUnionMoves(p);
    for (const f of formsOf(p)) {
      const comp = profilesOf(bracket)[f.key];
      if (!comp) continue;
      const idx = metaIndexes({
        types: f.types,
        stats: f.stats,
        abilities: f.abilities,
        comp,
        moves,
      });
      if (!idx) continue;
      if (idx.offense > 0) offense.push(idx.offense);
      speed.push(idx.speed);
      physBulk.push(idx.physBulk);
      specBulk.push(idx.specBulk);
    }
  }
  const asc = (a: number, b: number) => a - b;
  const dist: MetaDistribution = {
    offense: offense.sort(asc),
    speed: speed.sort(asc),
    physBulk: physBulk.sort(asc),
    specBulk: specBulk.sort(asc),
  };
  metaDistributions.set(bracket, dist);
  return dist;
}

/**
 * The Threat Profile for each of a Pokémon's forms that has ladder data in
 * the given bracket — computed server-side at build, so the page ships only
 * the finished read.
 */
export function getThreatProfilesByForm(
  pokemon: ChampionPokemon,
  bracket: DataBracket,
): Record<string, ThreatProfile> {
  const dist = getMetaDistribution(bracket);
  const moves = getUnionMoves(pokemon);
  const out: Record<string, ThreatProfile> = {};
  for (const f of formsOf(pokemon)) {
    const comp = profilesOf(bracket)[f.key];
    if (!comp) continue;
    out[f.key] = getThreatProfile(
      { types: f.types, stats: f.stats, abilities: f.abilities, comp, moves },
      dist,
    );
  }
  return out;
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
  /**
   * Doubles ladder pick rate (%) per data bracket, or null when it sees no
   * meaningful play there — the client toggle picks which one to show/sort by.
   */
  usage: Record<DataBracket, number | null>;
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
    // their Mega (Charizard 0.2% base vs Mega-Y 14%), so use the max — per
    // bracket, so the toggle re-sorts the list with real numbers.
    const usage = {} as Record<DataBracket, number | null>;
    for (const bracket of DATA_BRACKETS) {
      const usages = [p.name, ...p.forms.map((f) => f.key)]
        .map((k) => profilesOf(bracket)[k]?.usagePct)
        .filter((u): u is number => u != null);
      usage[bracket] = usages.length ? Math.max(...usages) : null;
    }
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
      usage,
      species: baseSpecies(p.name),
    };
  });
}
