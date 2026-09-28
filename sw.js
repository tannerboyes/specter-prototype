const CACHE_NAME = "specter-cache-v6";
const PRECACHE_URLS = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "data.js",
  "manifest.json",
  "logo.png",
  "icon-192.png",
  "icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Same-origin app-shell files: always try the network first, so an
// installed home-screen app never gets stuck showing a stale version
// while there's connectivity. Only fall back to the cached copy when
// truly offline. Everything else (Supabase calls, cross-origin fonts)
// passes straight through untouched.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  // cache: "no-store" bypasses the browser's own HTTP cache too — without
  // it, "network first" could still silently return a stale response the
  // browser had cached from an earlier visit, well before ever reaching
  // the actual network.
  event.respondWith(
    fetch(req, { cache: "no-store" })
      .then((res) => {
        if (res.ok) caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
