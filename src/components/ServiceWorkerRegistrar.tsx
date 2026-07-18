"use client";

import { useEffect } from "react";

/**
 * Registers the offline service worker (production only — in dev it would
 * fight the dev server's hot reloading). After the first visit, the app
 * opens instantly and keeps working on venue Wi-Fi or airplane mode.
 *
 * It also keeps an installed PWA from running an old build forever: a fresh
 * deploy re-stamps sw.js (its VERSION is a hash of the baked data), so on
 * reopen `registration.update()` picks up the new worker, and when that worker
 * takes control we reload ONCE to swap in the new build + data. Guards:
 *  - `refreshing` prevents a reload loop;
 *  - we skip the reload for the very first install (no prior controller), so a
 *    first-ever visit isn't reloaded out from under the user.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const hadController = !!navigator.serviceWorker.controller;
    let refreshing = false;

    const onControllerChange = () => {
      // Only a genuine update (a worker was already in control) triggers a
      // reload — never the initial install's claim.
      if (!hadController || refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    let registration: ServiceWorkerRegistration | undefined;
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        registration = reg;
      })
      .catch(() => {
        // Registration failing (old browser, private mode) just means no
        // offline support — the app itself works fine.
      });

    // A PWA session can stay open for days without a navigation; check for a new
    // worker whenever the app returns to the foreground (a natural "just opened"
    // moment), not mid-use.
    const onVisible = () => {
      if (document.visibilityState === "visible") registration?.update().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
