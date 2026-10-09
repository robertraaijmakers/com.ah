/* AH Planner service worker.
 * - static assets: cache-first
 * - pages: network-first, fall back to the last visited copy, then /offline.html
 * - selected read-only API calls: network-first, fall back to the last response
 *   (so the shopping list and pantry stay readable in the shop without signal)
 * Writes (POST/PATCH/DELETE) always go to the network.
 */
const VERSION = "v1";
const STATIC = `static-${VERSION}`;
const PAGES = `pages-${VERSION}`;
const API = `api-${VERSION}`;
const API_CACHEABLE = ["/api/shopping/", "/api/pantry/", "/api/plans/", "/api/meals/", "/api/family/", "/api/advice/"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PAGES).then((c) => c.add("/offline.html")).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![STATIC, PAGES, API].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, cacheName, fallback) {
  const cache = await caches.open(cacheName);
  try {
    const resp = await fetch(request);
    if (resp.ok) cache.put(request, resp.clone());
    return resp;
  } catch {
    const hit = await cache.match(request);
    if (hit) return hit;
    return fallback ? fallback() : Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const resp = await fetch(request);
        if (resp.ok) cache.put(request, resp.clone());
        return resp;
      })
    );
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    if (API_CACHEABLE.some((p) => (url.pathname + "/").startsWith(p) || url.pathname.startsWith(p))) {
      event.respondWith(networkFirst(request, API));
    }
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, PAGES, () => caches.match("/offline.html")));
  }
});
