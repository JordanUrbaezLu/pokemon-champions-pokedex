import Link from "next/link";
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
        <div className="min-w-0">
          <h1 className="font-display text-[22px] font-bold leading-none tracking-tight">
            Champions Pokédex
          </h1>
          <p className="mt-1 text-sm text-muted">
            {getRosterCount()} Pokémon
            {updatedAt && (
              <span className="whitespace-nowrap"> · updated {longDate(updatedAt)}</span>
            )}
          </p>
        </div>
        {/* Side-doors off the battle list: run the numbers, or study top teams. */}
        <nav className="ml-auto flex shrink-0 items-center gap-1.5">
          <Link
            href="/calc"
            className="tap-target rounded-xl glass-quiet px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wider text-muted active:bg-surface-2"
          >
            Calc
          </Link>
          <Link
            href="/teams"
            className="tap-target rounded-xl glass-quiet px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wider text-muted active:bg-surface-2"
          >
            Teams
          </Link>
        </nav>
      </header>
      <RosterSearch entries={entries} />
    </main>
  );
}
