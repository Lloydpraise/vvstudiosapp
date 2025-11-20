const CACHE_NAME = "vvstudios-cache-v1";

const ASSETS_TO_CACHE = [
    "/",
    "/index.html",
    "/install.html", // Added the install page
    "/offline.html",
    "/manifest.json",

    // Local JS files
    "/install.js",
    "/auth.js",
    "/dashboard.js",
    
    // Assets
    "/assets/logo.png", // Added the logo
    
    // Icons (Paths corrected to include 'icons/' folder)
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
self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
    );
    self.skipWaiting();
});

// ACTIVATE (clear old caches)
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

// FETCH
self.addEventListener("fetch", event => {

    // For navigation requests → fallback to offline.html
    if (event.request.mode === "navigate") {
        event.respondWith(
            fetch(event.request).catch(() => caches.match("/offline.html"))
        );
        return;
    }

    // For other static files → cache-first
    event.respondWith(
        caches.match(event.request).then(cached => {
            return cached || fetch(event.request);
        })
    );
});