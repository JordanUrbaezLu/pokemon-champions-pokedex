"use client";

/**
 * The data-bracket toggle: "master" (top ladder brackets — the default) vs
 * "all" (whole ladder). Persisted on the device and shared by every screen
 * through a tiny subscribe pattern, so flipping it on one page flips the
 * whole app. Both brackets are baked into every prerendered page, so the
 * switch is instant and never touches the network.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { DataBracket } from "./types";

const KEY = "cpx:bracket:v1";
const CHANGE_EVENT = "cpx:bracket-change";
const DEFAULT_BRACKET: DataBracket = "master";

function read(): DataBracket {
  if (typeof window === "undefined") return DEFAULT_BRACKET;
  try {
    // Reading localStorage throws in some privacy modes / blocked-storage
    // contexts — never let that crash the home and detail screens.
    return window.localStorage.getItem(KEY) === "all" ? "all" : DEFAULT_BRACKET;
  } catch {
    return DEFAULT_BRACKET;
  }
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function useBracket(): [DataBracket, (next: DataBracket) => void] {
  const bracket = useSyncExternalStore(
    subscribe,
    read,
    // The server (and first hydration pass) always renders the default, so
    // static output is deterministic; a stored "all" applies right after.
    () => DEFAULT_BRACKET,
  );
  const setBracket = useCallback((next: DataBracket) => {
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // Private mode — the toggle still works for this page via the event.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [bracket, setBracket];
}
