"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { PokemonCard } from "./PokemonCard";
import { BracketToggle } from "./BracketToggle";
import { useBracket } from "@/lib/bracket";
import { TYPE_COLORS, typeTextColor } from "@/lib/type-meta";
import { POKEMON_TYPES, type PokemonType } from "@/lib/types";
import type { RosterEntry } from "@/lib/pokedex";

// Autofocus the search field only on the FIRST home mount of the session — not
// on every back-navigation, where re-grabbing focus pops the keyboard over the
// list and scrolls away the trainer's place. Module-scoped so it survives the
// home screen unmounting while a detail page is open.
let didAutoFocus = false;

// Session-scoped search query, shared across mounts of this screen.
const QUERY_KEY = "cpx:query";
const queryListeners = new Set<() => void>();
let queryCache: string | null = null;

function readQuery(): string {
  if (queryCache === null) {
    try {
      // sessionStorage access throws where site storage is blocked — the home
      // screen must still render, so fall back to an empty query.
      queryCache = window.sessionStorage.getItem(QUERY_KEY) ?? "";
    } catch {
      queryCache = "";
    }
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

// Session-scoped roster filters, shared across mounts and restored on
// back-navigation — the same approach as the search query above. The home
// screen unmounts while a detail page is open, so plain component state resets
// on Back; sessionStorage (plus a module-level cache that keeps the snapshot
// referentially stable for useSyncExternalStore) survives the round trip. The
// server snapshot is the empty default, so hydration stays deterministic.
const FILTERS_KEY = "cpx:filters";

interface RosterFilters {
  types: PokemonType[];
  roles: string[];
  megaOnly: boolean;
  newOnly: boolean;
}

const EMPTY_FILTERS: RosterFilters = { types: [], roles: [], megaOnly: false, newOnly: false };
const filterListeners = new Set<() => void>();
let filtersCache: RosterFilters | null = null;

function readFilters(): RosterFilters {
  if (filtersCache === null) {
    let parsed: RosterFilters = EMPTY_FILTERS;
    try {
      const raw = window.sessionStorage.getItem(FILTERS_KEY);
      // Spread over the default so a stored payload from an older shape (missing
      // a key) still yields a complete, valid filter object.
      if (raw) parsed = { ...EMPTY_FILTERS, ...JSON.parse(raw) };
    } catch {
      parsed = EMPTY_FILTERS;
    }
    filtersCache = parsed;
  }
  return filtersCache;
}

function subscribeFilters(callback: () => void) {
  filterListeners.add(callback);
  return () => {
    filterListeners.delete(callback);
  };
}

function writeFilters(next: RosterFilters) {
  filtersCache = next;
  try {
    window.sessionStorage.setItem(FILTERS_KEY, JSON.stringify(next));
  } catch {
    // Private mode — filters still work, just don't persist.
  }
  for (const callback of filterListeners) callback();
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
  const router = useRouter();

  // Whether the popover is open is ephemeral UI state; the filter SELECTIONS
  // persist (sessionStorage store above) so Back from a detail page restores the
  // trainer's narrowed view instead of clearing it.
  const [filterOpen, setFilterOpen] = useState(false);
  const filters = useSyncExternalStore(subscribeFilters, readFilters, () => EMPTY_FILTERS);
  const { megaOnly, newOnly } = filters;
  const types = useMemo(() => new Set(filters.types), [filters.types]);
  const roles = useMemo(() => new Set(filters.roles), [filters.roles]);
  const filterCount =
    filters.types.length + filters.roles.length + (megaOnly ? 1 : 0) + (newOnly ? 1 : 0);
  // Is anything in the roster flagged new? Hide the toggle entirely if not.
  const hasNewcomers = useMemo(() => entries.some((e) => e.isNew), [entries]);

  // Battle roles available to filter on — the threat archetypes the data
  // actually produces, with their tone colors.
  const roleOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entries) {
      for (const a of e.pin.archetype) if (!m.has(a.label)) m.set(a.label, a.tone);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries]);

  const toggleType = (t: PokemonType) =>
    writeFilters({
      ...filters,
      types: filters.types.includes(t)
        ? filters.types.filter((x) => x !== t)
        : [...filters.types, t],
    });
  const toggleRole = (label: string) =>
    writeFilters({
      ...filters,
      roles: filters.roles.includes(label)
        ? filters.roles.filter((x) => x !== label)
        : [...filters.roles, label],
    });
  const toggleMega = () => writeFilters({ ...filters, megaOnly: !filters.megaOnly });
  const toggleNew = () => writeFilters({ ...filters, newOnly: !filters.newOnly });
  const clearFilters = () => writeFilters(EMPTY_FILTERS);

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
      if (newOnly && !e.isNew) return false;
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
  }, [entries, query, bracket, types, roles, megaOnly, newOnly]);

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

  // Focus the search field once per session (first home mount), not on every
  // back-navigation — see `didAutoFocus` above.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (didAutoFocus) return;
    didAutoFocus = true;
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sticky search controls so they stay reachable while results scroll. */}
      <div className="sticky top-0 z-20 border-b border-border bg-background/90 px-4 pb-3 pt-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
              aria-hidden
            >
              ⌕
            </span>
            <input
              ref={inputRef}
              type="search"
              inputMode="search"
              // Raw keystrokes must reach the filter: iOS autocorrect would
              // rewrite "chomp" (Garchomp) or "gible" into dictionary words and
              // silently zero out the results.
              autoCorrect="off"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => updateQuery(e.target.value)}
              // Go = open the top-ranked match: results are prefix-first, so
              // "king" + Go lands on Kingambit in one motion, keyboard dropped.
              enterKeyHint="go"
              onKeyDown={(e) => {
                if (e.key === "Enter" && query.trim() && results[0]) {
                  e.currentTarget.blur();
                  router.push(`/pokemon/${results[0].name}`);
                }
              }}
              placeholder="Search name or type…"
              aria-label="Search the roster by name or type"
              className="w-full rounded-2xl border border-border bg-surface py-3 pl-10 pr-11 text-base outline-none placeholder:text-muted focus:border-foreground/30"
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
          <div className="absolute inset-x-4 top-full z-30 mt-1 max-h-[60dvh] origin-top overflow-y-auto rounded-2xl border border-border bg-surface p-3 shadow-2xl animate-[dropdownIn_.16s_ease-out]">
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
                    onClick={() => toggleType(t)}
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
                        onClick={() => toggleRole(label)}
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
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={toggleMega}
                aria-pressed={megaOnly}
                className={`rounded-full border px-3 py-1 text-[11px] font-bold transition-colors ${
                  megaOnly
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border bg-surface-2 text-muted"
                }`}
              >
                Has Mega
              </button>
              {hasNewcomers && (
                <button
                  type="button"
                  onClick={toggleNew}
                  aria-pressed={newOnly}
                  className={`rounded-full border px-3 py-1 text-[11px] font-bold transition-colors ${
                    newOnly
                      ? "border-sky-400 bg-sky-400/15 text-sky-300"
                      : "border-border bg-surface-2 text-muted"
                  }`}
                >
                  New to Champions
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Dim backdrop — rendered outside the blurred sticky header (which would
          otherwise contain a fixed child) so it covers the whole list; tapping
          it dismisses the filter popover. Sits below the header so the search
          bar and the popover stay crisp above it. */}
      {filterOpen && (
        <div
          className="fixed inset-0 z-10 bg-black/40 animate-[fadeIn_.16s_ease-out]"
          onClick={() => setFilterOpen(false)}
          aria-hidden
        />
      )}

      <div className="flex-1 px-4 pb-8 pt-3">
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          {/* aria-live so screen-reader users hear the match count / empty state
              update as they type, instead of swiping the list to discover it. */}
          <p className="text-xs text-muted" role="status" aria-live="polite">
            {results.length} Pokémon
          </p>
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
