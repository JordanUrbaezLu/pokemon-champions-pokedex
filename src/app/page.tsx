import { RosterSearch } from "@/components/RosterSearch";
import { PokeballIcon } from "@/components/PokeballIcon";
import {
  getRosterEntries,
  getRosterCount,
  getDataUpdatedAt,
  getCompetitiveMeta,
} from "@/lib/pokedex";

/** "2026-06-11" -> "Jun 11" — compact enough for the subtitle line. */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[(m ?? 1) - 1]} ${d}${y !== new Date().getFullYear() ? ` ${y}` : ""}`;
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
            {/* Regulation visible at a glance — stale data is dead data. */}
            {getCompetitiveMeta().formatLabel.match(/Reg [^,)]+/)?.[0] ?? "Doubles"} ·{" "}
            {getRosterCount()} Pokémon
            {updatedAt && (
              <span className="whitespace-nowrap"> · updated {shortDate(updatedAt)}</span>
            )}
          </p>
        </div>
      </header>
      <RosterSearch entries={entries} />
    </main>
  );
}
