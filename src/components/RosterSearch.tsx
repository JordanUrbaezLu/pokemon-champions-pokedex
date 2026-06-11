"use client";

import { useMemo, useState } from "react";
import { PokemonCard } from "./PokemonCard";
import { BracketToggle } from "./BracketToggle";
import { useBracket } from "@/lib/bracket";
import type { RosterEntry } from "@/lib/pokedex";

/**
 * The home screen's beating heart: type a name and the roster filters
 * instantly. No network, no debounce lag — the whole roster is already in
 * memory, so results update on every keystroke. The bracket toggle re-sorts
 * and re-labels pick rates from the other baked data set, just as instantly.
 */
export function RosterSearch({ entries }: { entries: RosterEntry[] }) {
  const [query, setQuery] = useState("");
  const [bracket] = useBracket();

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      // Prefix match on the name OR its base species, so "p" shows Pokémon
      // starting with P and "ninetales" finds Alolan Ninetales too.
      .filter(
        (e) =>
          !q ||
          e.displayName.toLowerCase().startsWith(q) ||
          e.species.startsWith(q),
      )
      // Most-used (most likely to face) first, Dex no. to break ties.
      .sort((a, b) => {
        const au = a.usage[bracket] ?? -1;
        const bu = b.usage[bracket] ?? -1;
        if (au !== bu) return bu - au;
        return a.id - b.id;
      });
  }, [entries, query, bracket]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sticky search controls so they stay reachable while results scroll. */}
      <div className="sticky top-0 z-10 border-b border-border bg-background/90 px-4 pb-3 pt-2 backdrop-blur">
        <div className="relative">
          <span
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
            aria-hidden
          >
            ⌕
          </span>
          <input
            type="search"
            inputMode="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a Pokémon by name…"
            aria-label="Search the roster by name"
            className="w-full rounded-2xl border border-border bg-surface py-3 pl-10 pr-10 text-base outline-none placeholder:text-muted focus:border-accent"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 size-7 -translate-y-1/2 rounded-full text-muted active:bg-surface-2"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 px-4 pb-8 pt-3">
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <p className="text-xs text-muted">{results.length} Pokémon</p>
          <BracketToggle />
        </div>

        {results.length === 0 ? (
          <div className="mt-16 text-center text-muted">
            <p className="text-sm">No Pokémon match “{query}”.</p>
            <p className="mt-1 text-xs">
              Only Pokémon in Pokémon Champions appear here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {results.map((entry) => (
              <PokemonCard
                key={entry.name}
                entry={entry}
                usagePct={entry.usage[bracket]}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
