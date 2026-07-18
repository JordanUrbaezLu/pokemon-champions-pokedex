/*
 * Champions Pokédex service worker.
 *
 * The app's pages are fully static and its data is baked in, so the only
 * things between a trainer and an instant, offline-capable open are the
 * hashed JS/CSS chunks, the HTML, and the sprite CDN. Strategy:
 *
 *  - hashed static assets (/_next/static/): cache-first (immutable by design)
 *  - images (sprite CDN + local): cache-first, LRU-trimmed at a size cap
 *  - navigations: network-first with cache fallback — fresh when online,
 *    instant and alive on venue Wi-Fi or in airplane mode once visited
 *
 * VERSION is STAMPED from a hash of the baked data by
 * scripts/generate-competitive.mjs, so every data refresh (i.e. every real
 * deploy) changes this file's bytes → the browser installs the new worker →
 * `activate` deletes the previous version's caches. Do not edit VERSION by hand.
 */

const VERSION = "cpx-5fe1e604f7fc";
const STATIC_CACHE = `cpx-static-${VERSION}`;
const IMAGE_CACHE = `cpx-images-${VERSION}`;
const PAGE_CACHE = `cpx-pages-${VERSION}`;
const IMAGE_CACHE_MAX = 900; // ~roster icons + artworks for visited pages
const STATIC_CACHE_MAX = 400; // a couple of builds' worth of chunks, then trim

self.addEventListener("install", (event) => {
  // Precache the home shell: the very first page is loaded BEFORE this worker
  // controls anything, so without this an offline visit to an unvisited route
  // would have no fallback.
  event.waitUntil(
    caches.open(PAGE_CACHE).then((cache) => cache.add("/")).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop every cache that isn't this VERSION's — this is what reclaims a
      // superseded build's chunks/images instead of letting them pile up.
      const keep = new Set([STATIC_CACHE, IMAGE_CACHE, PAGE_CACHE]);
      for (const key of await caches.keys()) {
        if (!keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(cacheName, request, cap) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) {
    // LRU: move the hit to the tail so the FIFO trim below evicts the genuinely
    // least-recently-used entries. Without this, your own team's sprites (opened
    // first, re-viewed every turn via the tray) are the first to go once over
    // the cap, while a one-off opponent's artwork survives. Fire-and-forget so
    // nothing is added to the response's latency.
    if (cap) {
      const clone = hit.clone();
      cache
        .delete(request)
        .then(() => cache.put(request, clone))
        .catch(() => {});
    }
    return hit;
  }
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    cache.put(request, response.clone());
    if (cap) {
      const keys = await cache.keys();
      // Oldest-first eviction once over the cap.
      for (let i = 0; i < keys.length - cap; i++) cache.delete(keys[i]);
    }
  }
  return response;
}

async function networkFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    // Only cache a genuine, same-origin app page. On a captive portal (the exact
    // "venue Wi-Fi" case) a login page can resolve as a 200 — usually redirected
    // and/or cross-origin — and would otherwise poison the "/" offline fallback
    // for every later launch.
    if (
      response.ok &&
      !response.redirected &&
      new URL(response.url).origin === self.location.origin
    ) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const hit = await cache.match(request);
    if (hit) return hit;
    // Last resort: the home screen, so the app never dead-ends offline.
    const home = await cache.match("/");
    if (home) return home;
    throw new Error("offline and uncached");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(STATIC_CACHE, request, STATIC_CACHE_MAX));
    return;
  }
  if (
    request.destination === "image" ||
    url.hostname === "raw.githubusercontent.com"
  ) {
    event.respondWith(cacheFirst(IMAGE_CACHE, request, IMAGE_CACHE_MAX));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(PAGE_CACHE, request));
  }
});
