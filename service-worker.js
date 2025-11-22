const CACHE_NAME = "vvstudios-cache-v1";
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/install.html",
  "/offline.html",
  "/manifest.json",
  "/install.js",
  "/auth.js",
  "/dashboard.js",
  "/assets/logo.png",
  "/icons/icon-48.png",
  "/icons/icon-72.png",
  "/icons/icon-96.png",
  "/icons/icon-144.png",
  "/icons/icon-192.png",
  "/icons/icon-256.png",
  "/icons/icon-384.png",
  "/icons/icon-512.png"
];

// INSTALL
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Try addAll first (fast), but if one file fails, fall back to adding individually
    try {
      await cache.addAll(ASSETS_TO_CACHE);
      console.log("[SW] All assets cached (addAll).");
    } catch (err) {
      console.warn("[SW] cache.addAll failed — caching assets individually:", err);
      for (const url of ASSETS_TO_CACHE) {
        try {
          // Use fetch then put to get better control over errors
          const resp = await fetch(url, { cache: "no-store" });
          if (!resp || resp.status >= 400) {
            console.warn(`[SW] Failed to fetch ${url} — status:`, resp && resp.status);
            continue; // skip this asset but continue
          }
          // only cache successful responses
          await cache.put(url, resp.clone());
        } catch (e) {
          console.warn(`[SW] Could not cache ${url}:`, e);
        }
      }
    }

    // finish install even if some assets failed (we have offline fallback)
    await self.skipWaiting();
  })());
});

// ACTIVATE — clear old caches
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
    console.log("[SW] Activated and old caches cleared.");
  })());
});

// FETCH
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== "GET") {
    return; // let non-GETs go to network
  }

  // Navigation requests: network-first with offline fallback
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const networkResp = await fetch(req);
        // Optionally cache the page for offline use (same-origin only)
        try {
          if (new URL(req.url).origin === location.origin && networkResp.ok) {
            const copy = networkResp.clone();
            const cache = await caches.open(CACHE_NAME);
            await cache.put(req, copy);
          }
        } catch (e) {
          console.warn("[SW] Failed to cache navigation response:", e);
        }
        return networkResp;
      } catch (err) {
        console.warn("[SW] Network nav fetch failed, serving offline:", err);
        const cached = await caches.match("/offline.html");
        return cached || Response.error();
      }
    })());
    return;
  }

  // For other requests → try cache-first, then network; if network → cache it (same-origin only)
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    try {
      const networkResp = await fetch(req);
      // Only cache same-origin and successful responses (status 200)
      try {
        const reqUrl = new URL(req.url);
        if (reqUrl.origin === location.origin && networkResp && networkResp.ok) {
          const copy = networkResp.clone();
          const cache = await caches.open(CACHE_NAME);
          // Use request as key (this includes querystring)
          await cache.put(req, copy);
        }
      } catch (e) {
        console.warn("[SW] Could not cache network response:", e);
      }
      return networkResp;
    } catch (err) {
      // network failed — provide sensible fallbacks
      console.warn("[SW] Network fetch failed for:", req.url, err);
      // If it's an image request, return a cached logo if available
      if (req.destination === "image") {
        const logo = await caches.match("/assets/logo.png");
        if (logo) return logo;
      }
      // Otherwise fallback to offline page (if available)
      const offline = await caches.match("/offline.html");
      if (offline) return offline;

      return Response.error();
    }
  })());
});
