"use client";

/**
 * The opponent tray: up to 6 Pokémon pinned during team preview, kept in
 * localStorage on the device, so every later lookup is one tap instead of a
 * re-typed search. Renders nothing on the server; components subscribe
 * through a tiny event pattern so the dock updates everywhere at once.
 */

import { useCallback, useSyncExternalStore } from "react";
import { POKEMON_TYPES, type PokemonType } from "./types";

const KEY = "cpx:opponents:v1";
const CHANGE_EVENT = "cpx:opponents-change";

export const MAX_PINNED = 6;

/** A pinned opposing Pokémon — everything the tray + briefing need, no more. */
export interface PinnedOpponent {
  /** roster slug (the route param) */
  slug: string;
  /** form whose data was pinned (Mega slug) or null for base */
  formKey: string | null;
  displayName: string;
  icon: string | null;
  types: PokemonType[];
  /** its 4× weakness, if any — the kill-shot tag on the tray chip */
  quad: PokemonType | null;
  /** common-spread Lv. 50 Speed (null without ladder data) */
  speed: number | null;
  /** archetype chips from the threat profile, e.g. [{label, tone}] */
  archetype: { label: string; tone: string }[];
  /** the top threat headline, for the briefing row */
  headline: string | null;
}

function read(): PinnedOpponent[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    // Validate each entry's shape, not just the array — one malformed record
    // (from an old schema or hand-editing) must not brick every screen that
    // reads the tray. The tray reads displayName.slice() and types[0] directly,
    // so both must be present and well-formed or the record is dropped.
    return parsed.filter(
      (o): o is PinnedOpponent =>
        !!o &&
        typeof o === "object" &&
        typeof o.slug === "string" &&
        typeof o.displayName === "string" &&
        Array.isArray(o.types) &&
        o.types.length > 0 &&
        o.types.every((t: unknown) => POKEMON_TYPES.includes(t as PokemonType)),
    );
  } catch {
    return [];
  }
}

function write(value: PinnedOpponent[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Private mode — the dock just won't persist across launches.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// useSyncExternalStore needs referentially stable snapshots between changes.
let cache: PinnedOpponent[] | null = null;
const EMPTY: PinnedOpponent[] = [];

function subscribe(callback: () => void) {
  const invalidate = () => {
    cache = null;
    callback();
  };
  window.addEventListener(CHANGE_EVENT, invalidate);
  window.addEventListener("storage", invalidate);
  return () => {
    window.removeEventListener(CHANGE_EVENT, invalidate);
    window.removeEventListener("storage", invalidate);
  };
}

export function useOpponents() {
  const opponents = useSyncExternalStore(
    subscribe,
    () => {
      if (!cache) cache = read();
      return cache;
    },
    () => EMPTY,
  );

  const pin = useCallback((mon: PinnedOpponent) => {
    const current = read();
    // Doubles caps a team at 6, so the tray does too. When full, don't silently
    // evict the earliest pin for a NEW mon — no-op (the UI disables the control
    // via `isFull`). Re-pinning an already-pinned slug still updates it in place.
    const already = current.some((o) => o.slug === mon.slug);
    if (!already && current.length >= MAX_PINNED) return;
    write([...current.filter((o) => o.slug !== mon.slug), mon].slice(-MAX_PINNED));
  }, []);

  const unpin = useCallback((slug: string) => {
    write(read().filter((o) => o.slug !== slug));
  }, []);

  const clear = useCallback(() => write([]), []);

  return { opponents, pin, unpin, clear, isFull: opponents.length >= MAX_PINNED };
}
