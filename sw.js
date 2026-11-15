// Hinterland service worker: lets the web player open offline after the first visit.
// Bump VERSION to drop old caches on the next deploy.
const VERSION = "hinterland-v1";
const PRECACHE = [
  "./", "index.html", "app.css", "app.js", "mascot.png",
  "icon-192.png", "icon-512.png", "manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Same-origin, inside this worker's scope only.
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  // Never touch media range requests or the review test audio.
  if (req.headers.has("range") || url.pathname.includes("/review/")) return;

  // Network first, so a new deploy is never served stale while online; cache is the offline fallback.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
