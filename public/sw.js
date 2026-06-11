/*
 * Champions Pokédex service worker.
 *
 * The app's pages are fully static and its data is baked in, so the only
 * things between a trainer and an instant, offline-capable open are the
 * hashed JS/CSS chunks, the HTML, and the sprite CDN. Strategy:
 *
 *  - hashed static assets (/_next/static/): cache-first (immutable by design)
 *  - images (sprite CDN + local): cache-first with a size cap
 *  - navigations: network-first with cache fallback — fresh when online,
 *    instant and alive on venue Wi-Fi or in airplane mode once visited
 *
 * Bump VERSION to invalidate everything after a deploy with breaking changes.
 */

const VERSION = "v1";
const STATIC_CACHE = `cpx-static-${VERSION}`;
const IMAGE_CACHE = `cpx-images-${VERSION}`;
const PAGE_CACHE = `cpx-pages-${VERSION}`;
const IMAGE_CACHE_MAX = 900; // ~roster icons + artworks for visited pages

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
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
  if (hit) return hit;
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
    if (response.ok) cache.put(request, response.clone());
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
    event.respondWith(cacheFirst(STATIC_CACHE, request));
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
