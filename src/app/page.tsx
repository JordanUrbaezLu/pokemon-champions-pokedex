import { RosterSearch } from "@/components/RosterSearch";
import { PokeballIcon } from "@/components/PokeballIcon";
import { getRosterEntries, getRosterCount, getDataUpdatedAt } from "@/lib/pokedex";

/** "2026-06-11" -> "June 11, 2026". */
function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[(m ?? 1) - 1]} ${d}, ${y}`;
}

export default function Home() {
  const entries = getRosterEntries();
  const updatedAt = getDataUpdatedAt();

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-3 px-4 pb-1 pt-5">
        <PokeballIcon className="size-9 shrink-0 drop-shadow" />
        <div>
          <h1 className="text-2xl font-black leading-none tracking-tight">
            Champions Pokédex
          </h1>
          <p className="mt-1 text-sm text-muted">
            {getRosterCount()} Pokémon
            {updatedAt && (
              <span className="whitespace-nowrap"> · updated {longDate(updatedAt)}</span>
            )}
          </p>
        </div>
      </header>
      <RosterSearch entries={entries} />
    </main>
  );
}
