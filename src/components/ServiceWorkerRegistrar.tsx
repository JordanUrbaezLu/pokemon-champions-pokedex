"use client";

import { useEffect } from "react";

/**
 * Registers the offline service worker (production only — in dev it would
 * fight the dev server's hot reloading). After the first visit, the app
 * opens instantly and keeps working on venue Wi-Fi or airplane mode.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration failing (old browser, private mode) just means no
      // offline support — the app itself works fine.
    });
  }, []);
  return null;
}
