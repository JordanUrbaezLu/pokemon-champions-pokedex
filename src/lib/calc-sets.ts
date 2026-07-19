"use client";

/**
 * Saved Battle Calc sets — a trainer's own builds, kept in localStorage on the
 * device so they persist across sessions and can be loaded into either side to
 * compare matchups. Same tiny event-store pattern as the opponent tray
 * (`opponents.ts`): renders nothing on the server, updates everywhere at once.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { EvStat } from "./types";

const KEY = "cpx:calc-sets:v1";
const CHANGE_EVENT = "cpx:calc-sets-change";

/** How many saved sets to keep (oldest drop off past this). */
export const MAX_SETS = 30;

/** A saved build — the set fields only, not transient battle state. */
export interface SavedSet {
  id: string;
  /** Display label, e.g. "Garchomp @ Life Orb". */
  name: string;
  slug: string;
  formIdx: number;
  nature: string;
  sp: Partial<Record<EvStat, number>>;
  ability: string | null;
  item: string;
  moveSlug: string;
}

function read(): SavedSet[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is SavedSet =>
        !!s && typeof s === "object" &&
        typeof s.id === "string" &&
        typeof s.slug === "string" &&
        typeof s.name === "string" &&
        typeof s.nature === "string" &&
        typeof s.formIdx === "number" &&
        typeof s.item === "string" &&
        typeof s.moveSlug === "string" &&
        !!s.sp && typeof s.sp === "object",
    );
  } catch {
    return [];
  }
}

function write(value: SavedSet[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Private mode — sets just won't persist across launches.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

let cache: SavedSet[] | null = null;
const EMPTY: SavedSet[] = [];

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

/** A stable-enough id without needing a crypto import. */
function newId(): string {
  return `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function useCalcSets() {
  const sets = useSyncExternalStore(
    subscribe,
    () => {
      if (!cache) cache = read();
      return cache;
    },
    () => EMPTY,
  );

  const saveSet = useCallback((set: Omit<SavedSet, "id">) => {
    const id = newId();
    write([...read(), { ...set, id }].slice(-MAX_SETS));
    return id;
  }, []);

  const removeSet = useCallback((id: string) => {
    write(read().filter((s) => s.id !== id));
  }, []);

  const clear = useCallback(() => write([]), []);

  return { sets, saveSet, removeSet, clear };
}
