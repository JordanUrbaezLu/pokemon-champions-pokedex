"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { PokemonCard } from "./PokemonCard";
import { BracketToggle } from "./BracketToggle";
import { useBracket } from "@/lib/bracket";
import { TYPE_COLORS, typeTextColor } from "@/lib/type-meta";
import { POKEMON_TYPES, type PokemonType } from "@/lib/types";
import type { RosterEntry } from "@/lib/pokedex";

// Session-scoped search query, shared across mounts of this screen.
const QUERY_KEY = "cpx:query";
const queryListeners = new Set<() => void>();
let queryCache: string | null = null;

function readQuery(): string {
  if (queryCache === null) {
    queryCache = window.sessionStorage.getItem(QUERY_KEY) ?? "";
  }
  return queryCache;
}

function subscribeQuery(callback: () => void) {
  queryListeners.add(callback);
  return () => {
    queryListeners.delete(callback);
  };
}

function writeQuery(q: string) {
  queryCache = q;
  try {
    window.sessionStorage.setItem(QUERY_KEY, q);
  } catch {
    // Private mode — search still works, just doesn't persist.
  }
  for (const callback of queryListeners) callback();
}

/**
 * The home screen's beating heart: type a name and the roster filters
 * instantly. No network, no debounce lag — the whole roster is already in
 * memory, so results update on every keystroke. A filter dropdown narrows by
 * type, battle role, and Mega; the bracket toggle re-sorts and re-labels pick
 * rates from the other baked data set — all client-side, all instant.
 */
export function RosterSearch({ entries }: { entries: RosterEntry[] }) {
  // The team-preview loop is type → tap → read → back → next mon. The query
  // lives in a tiny sessionStorage-backed store so back-navigation restores
  // it (the trainer keeps their place instead of retyping), hydration stays
  // deterministic (server snapshot is ""), and no effects are involved.
  const query = useSyncExternalStore(subscribeQuery, readQuery, () => "");
  const updateQuery = writeQuery;
  const [bracket] = useBracket();

  // Filters (ephemeral per session).
  const [filterOpen, setFilterOpen] = useState(false);
  const [types, setTypes] = useState<ReadonlySet<PokemonType>>(new Set());
  const [roles, setRoles] = useState<ReadonlySet<string>>(new Set());
  const [megaOnly, setMegaOnly] = useState(false);
  const filterCount = types.size + roles.size + (megaOnly ? 1 : 0);

  // Battle roles available to filter on — the threat archetypes the data
  // actually produces, with their tone colors.
  const roleOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entries) {
      for (const a of e.pin.archetype) if (!m.has(a.label)) m.set(a.label, a.tone);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries]);

  const toggleSet = <T,>(
    set: ReadonlySet<T>,
    value: T,
    setter: (s: ReadonlySet<T>) => void,
  ) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  const clearFilters = () => {
    setTypes(new Set());
    setRoles(new Set());
    setMegaOnly(false);
  };

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Mid-battle, every keystroke counts: rank prefix matches first (what
    // autocomplete muscle-memory expects), then substring matches ("gambit" →
    // Kingambit, "chomp" → Garchomp). A type name as the query filters by
    // type ("ghost" → every Ghost), since that's how trainers think too.
    const score = (e: RosterEntry): number => {
      if (!q) return 1;
      const name = e.displayName.toLowerCase();
      if (name.startsWith(q) || e.species.startsWith(q)) return 3;
      if (e.types.some((t) => t === q || (q.length >= 3 && t.startsWith(q)))) return 2;
      if (name.includes(q)) return 1;
      return 0;
    };
    const passesFilters = (e: RosterEntry) => {
      if (types.size && !e.types.some((t) => types.has(t))) return false;
      if (megaOnly && !e.hasMega) return false;
      if (roles.size && !e.pin.archetype.some((a) => roles.has(a.label))) return false;
      return true;
    };
    return entries
      .map((e) => ({ e, s: score(e) }))
      .filter(({ e, s }) => s > 0 && passesFilters(e))
      .sort((a, b) => {
        if (a.s !== b.s) return b.s - a.s;
        const au = a.e.usage[bracket] ?? -1;
        const bu = b.e.usage[bracket] ?? -1;
        if (au !== bu) return bu - au;
        return a.e.id - b.e.id;
      })
      .map(({ e }) => e);
  }, [entries, query, bracket, types, roles, megaOnly]);

  // Pick-rate rank across the WHOLE roster for the active bracket — so a
  // Pokémon shows its true "#3 most-used" rank even when the list is filtered
  // down to a single search result. Mons with no ladder data get no rank.
  const rankByName = useMemo(() => {
    const ranked = entries
      .filter((e) => e.usage[bracket] != null)
      .sort((a, b) => {
        const d = (b.usage[bracket] ?? 0) - (a.usage[bracket] ?? 0);
        return d !== 0 ? d : a.id - b.id;
      });
    const map = new Map<string, number>();
    ranked.forEach((e, i) => map.set(e.name, i + 1));
    return map;
  }, [entries, bracket]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sticky search controls so they stay reachable while results scroll. */}
      <div className="sticky top-0 z-10 border-b border-border bg-background/90 px-4 pb-3 pt-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
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
              onChange={(e) => updateQuery(e.target.value)}
              placeholder="Search name or type…"
              aria-label="Search the roster by name or type"
              className="w-full rounded-2xl border border-border bg-surface py-3 pl-10 pr-11 text-base outline-none placeholder:text-muted focus:border-accent"
            />
            {query && (
              <button
                type="button"
                onClick={() => updateQuery("")}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-muted active:bg-surface-2"
              >
                ✕
              </button>
            )}
          </div>

          {/* Filter dropdown trigger — count badge when any filter is on. */}
          <button
            type="button"
            onClick={() => setFilterOpen((o) => !o)}
            aria-expanded={filterOpen}
            aria-label="Filter the roster"
            className={`relative flex size-12 shrink-0 items-center justify-center rounded-2xl border transition-colors ${
              filterCount > 0 || filterOpen
                ? "border-accent/60 bg-accent/10 text-accent"
                : "border-border bg-surface text-muted active:bg-surface-2"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-5"
              aria-hidden
            >
              <path d="M3 5h18l-7 8.2V19l-4 2v-7.8L3 5z" />
            </svg>
            {filterCount > 0 && (
              <span className="absolute -right-1 -top-1 flex size-4.5 items-center justify-center rounded-full bg-accent text-[10px] font-black text-white">
                {filterCount}
              </span>
            )}
          </button>
        </div>

        {filterOpen && (
          <div className="mt-2 max-h-[52dvh] overflow-y-auto rounded-2xl border border-border bg-surface p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-black uppercase tracking-wider text-muted">
                Type
              </span>
              {filterCount > 0 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-[11px] font-bold text-accent active:opacity-70"
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {POKEMON_TYPES.map((t) => {
                const on = types.has(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleSet(types, t, setTypes)}
                    aria-pressed={on}
                    className="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide transition-opacity"
                    style={
                      on
                        ? { backgroundColor: TYPE_COLORS[t], color: typeTextColor(t) }
                        : { backgroundColor: `${TYPE_COLORS[t]}24`, color: TYPE_COLORS[t] }
                    }
                  >
                    {t}
                  </button>
                );
              })}
            </div>

            {roleOptions.length > 0 && (
              <>
                <div className="mb-1.5 mt-3 text-[11px] font-black uppercase tracking-wider text-muted">
                  Role
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {roleOptions.map(([label, tone]) => {
                    const on = roles.has(label);
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => toggleSet(roles, label, setRoles)}
                        aria-pressed={on}
                        className="rounded-full px-2.5 py-1 text-[11px] font-bold transition-opacity"
                        style={
                          on
                            ? { backgroundColor: tone, color: "#0b0f14" }
                            : { backgroundColor: `${tone}22`, color: tone }
                        }
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <div className="mb-1.5 mt-3 text-[11px] font-black uppercase tracking-wider text-muted">
              Other
            </div>
            <button
              type="button"
              onClick={() => setMegaOnly((m) => !m)}
              aria-pressed={megaOnly}
              className={`rounded-full border px-3 py-1 text-[11px] font-bold transition-colors ${
                megaOnly
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-border bg-surface-2 text-muted"
              }`}
            >
              Has Mega
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 px-4 pb-8 pt-3">
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <p className="text-xs text-muted">{results.length} Pokémon</p>
          <BracketToggle />
        </div>

        {results.length === 0 ? (
          <div className="mt-16 text-center text-muted">
            <p className="text-sm">
              {query
                ? `No Pokémon match “${query}”.`
                : "No Pokémon match these filters."}
            </p>
            <p className="mt-1 text-xs">
              {filterCount > 0 ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="font-bold text-accent active:opacity-70"
                >
                  Clear filters
                </button>
              ) : (
                "Only Pokémon in Pokémon Champions appear here."
              )}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {results.map((entry) => (
              <PokemonCard
                key={entry.name}
                entry={entry}
                usagePct={entry.usage[bracket]}
                rank={rankByName.get(entry.name) ?? null}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
