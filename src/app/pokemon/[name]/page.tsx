import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PokemonDetail } from "./PokemonDetail";
import {
  getAllPokemon,
  getPokemonByName,
  getMovesFor,
  getMoveBySlug,
  getCompetitiveByForm,
  getCompetitiveMeta,
  getItemDetail,
} from "@/lib/pokedex";
import type { ItemDetail, MoveSummary } from "@/lib/types";

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

  const competitiveByForm = getCompetitiveByForm(pokemon);

  // Union the movepool with any move the ladder shows it running but that's
  // missing from its movepool (e.g. Alolan Ninetales' Aurora Veil / Freeze-Dry),
  // so the "Common" filter never hides a move it actually uses.
  const movepool = getMovesFor(pokemon);
  const have = new Set(movepool.map((m) => m.name));
  const extra: MoveSummary[] = [];
  for (const profile of Object.values(competitiveByForm)) {
    for (const slug of Object.keys(profile.moveUsage)) {
      if (!have.has(slug)) {
        const m = getMoveBySlug(slug);
        if (m) {
          have.add(slug);
          extra.push(m);
        }
      }
    }
  }
  const moves = [...movepool, ...extra];

  // Resolve full details for every item this Pokémon's sets use, for the modal.
  const itemDetails: Record<string, ItemDetail> = {};
  for (const profile of Object.values(competitiveByForm)) {
    for (const it of profile.items) {
      if (it.slug && !itemDetails[it.slug]) {
        const detail = getItemDetail(it.slug);
        if (detail) itemDetails[it.slug] = detail;
      }
    }
  }

  return (
    <PokemonDetail
      pokemon={pokemon}
      moves={moves}
      competitiveByForm={competitiveByForm}
      competitiveMeta={getCompetitiveMeta()}
      itemDetails={itemDetails}
    />
  );
}
