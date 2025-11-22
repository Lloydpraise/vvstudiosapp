const CACHE_NAME = "vvstudios-cache-v2";

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

// INSTALL: pre-cache everything
self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

// ACTIVATE: delete old caches
self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

// FETCH: cache-first for navigation + static assets
self.addEventListener("fetch", event => {

    // NAVIGATION: cache-first fallback to offline.html
    if (event.request.mode === "navigate") {
        event.respondWith(
            caches.match(event.request)
                .then(cached => {
                    if (cached) return cached;
                    return fetch(event.request)
                        .catch(() => caches.match("/offline.html"));
                })
        );
        return;
    }

    // STATIC FILES: cache-first
    event.respondWith(
        caches.match(event.request).then(cached => {
            return cached || fetch(event.request);
        })
    );
});
