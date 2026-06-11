import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PokemonDetail } from "./PokemonDetail";
import {
  DATA_BRACKETS,
  getAllPokemon,
  getPokemonByName,
  getUnionMoves,
  getCompetitiveByForm,
  getCompetitiveMeta,
  getItemDetail,
  getThreatProfilesByForm,
} from "@/lib/pokedex";
import type { ThreatProfile } from "@/lib/threat";
import type { CompetitiveProfile, DataBracket, ItemDetail } from "@/lib/types";

// The roster is fixed and known, so prerender every page at build time and
// 404 anything off-roster. Result: each detail screen is fully static — it
// opens instantly with no data fetching, even on a weak connection.
export const dynamicParams = false;

export function generateStaticParams() {
  return getAllPokemon().map((p) => ({ name: p.name }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>;
}): Promise<Metadata> {
  const { name } = await params;
  const pokemon = getPokemonByName(name);
  if (!pokemon) return { title: "Not found · Champions Pokédex" };

  const types = pokemon.types.map((t) => t[0].toUpperCase() + t.slice(1)).join("/");
  return {
    title: `${pokemon.displayName} · Champions Pokédex`,
    description: `${pokemon.displayName} (${types}) — type matchups, base stats, and abilities for Pokémon Champions battles.`,
  };
}

export default async function PokemonPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const pokemon = getPokemonByName(name);
  if (!pokemon) notFound();

  // BOTH data brackets are baked into the static page, so the Master+/All
  // toggle switches instantly with zero network.
  const competitiveByBracket = {} as Record<
    DataBracket,
    Record<string, CompetitiveProfile>
  >;
  const threatByBracket = {} as Record<DataBracket, Record<string, ThreatProfile>>;
  for (const bracket of DATA_BRACKETS) {
    competitiveByBracket[bracket] = getCompetitiveByForm(pokemon, bracket);
    // The per-form "what makes this dangerous" read, computed against that
    // bracket's whole meta at build time — the page ships only the vectors.
    threatByBracket[bracket] = getThreatProfilesByForm(pokemon, bracket);
  }

  // Movepool unioned with any move the ladder shows it actually running
  // (e.g. Alolan Ninetales' Aurora Veil), so "Common" never hides a real move.
  const moves = getUnionMoves(pokemon);

  // Resolve full details for every item this Pokémon's sets use, for the modal.
  const itemDetails: Record<string, ItemDetail> = {};
  for (const byForm of Object.values(competitiveByBracket)) {
    for (const profile of Object.values(byForm)) {
      for (const it of profile.items) {
        if (it.slug && !itemDetails[it.slug]) {
          const detail = getItemDetail(it.slug);
          if (detail) itemDetails[it.slug] = detail;
        }
      }
    }
  }

  return (
    <PokemonDetail
      pokemon={pokemon}
      moves={moves}
      competitiveByBracket={competitiveByBracket}
      competitiveMeta={getCompetitiveMeta()}
      itemDetails={itemDetails}
      threatByBracket={threatByBracket}
    />
  );
}
