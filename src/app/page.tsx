import { RosterSearch } from "@/components/RosterSearch";
import { PokeballIcon } from "@/components/PokeballIcon";
import { getRosterEntries, getRosterCount } from "@/lib/pokedex";

export default function Home() {
  const entries = getRosterEntries();

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-3 px-4 pb-1 pt-5">
        <PokeballIcon className="size-9 shrink-0 drop-shadow" />
        <div>
          <h1 className="text-2xl font-black leading-none tracking-tight">
            Champions Pokédex
          </h1>
          <p className="mt-1 text-sm text-muted">
            Battle helper · {getRosterCount()} Pokémon in the roster
          </p>
        </div>
      </header>
      <RosterSearch entries={entries} />
    </main>
  );
}
