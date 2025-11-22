const CACHE_NAME = "vvstudios-cache-v3";

const ASSETS_TO_CACHE = [
    "index.html",
    "install.html",
    "offline.html",

    // HTML pages
    "ads_management_dashboard.html",
    "copilot.html",
    "crmlanding.html",

    // JS files
    "install.js",
    "auth.js",
    "dashboard.js",
    "ads-dashboard.js",
    "aiassistant.js",
    "livechat-logic.js",
    "sales-logic.js",
    "router.js",

    // Assets
    "assets/logo.png",

    // Icons
    "icons/icon-48.png",
    "icons/icon-72.png",
    "icons/icon-96.png",
    "icons/icon-144.png",
    "icons/icon-192.png",
    "icons/icon-256.png",
    "icons/icon-384.png",
    "icons/icon-512.png",

    // Manifest
    "manifest.json"
];

// INSTALL — Precache all assets
self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
    );
    self.skipWaiting();
});

// ACTIVATE — Clear old caches
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

// FETCH — Cache-First for pages, fallback to offline
self.addEventListener("fetch", event => {

    // Navigation requests → serve from cache first
    if (event.request.mode === "navigate") {
        event.respondWith(
            caches.match(event.request)
                .then(cached => {
                    if (cached) return cached;
                    return fetch(event.request)
                        .catch(() => caches.match("offline.html"));
                })
        );
        return;
    }

    // Other requests → cache-first
    event.respondWith(
        caches.match(event.request).then(cached => {
            return cached || fetch(event.request);
        })
    );
});
