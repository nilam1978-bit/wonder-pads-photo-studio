// Wonder Pads Photo Studio — Service Worker
//
// Network-first: always fetch from the network and return that response
// untouched: only fall back to a cached copy if the network fetch
// actually fails (offline). Caching itself never blocks or alters the
// response the page receives, and the clone happens exactly once,
// immediately after the network responds — no branching paths that could
// touch the same response body twice, which is what caused v1 of this
// file to occasionally hand back a corrupted response for one of the
// app's own JS files and crash the page.
//
// Vite's build produces content-hashed filenames, so there's no fixed
// file list to precache here — the cache fills in naturally as files are
// requested, same as v1.

const VERSION = 'wp-photo-studio-v2';
const APP_CACHE = `app-${VERSION}`;
const MODEL_CACHE = `model-${VERSION}`;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== APP_CACHE && k !== MODEL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isModelCDN = /huggingface\.co|hf\.co|cdn-lfs/i.test(url.hostname);
  if (!isSameOrigin && !isModelCDN) return; // let the browser handle anything else as normal

  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        // Cache a copy in the background, but never let caching affect
        // what the page actually gets back — and never let a caching
        // failure turn into a broken/rejected response for the page.
        if (res && res.ok) {
          const copy = res.clone();
          caches
            .open(isSameOrigin ? APP_CACHE : MODEL_CACHE)
            .then((cache) => cache.put(req, copy))
            .catch(() => {});
        }
        return res;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        // No cache and the network failed — let the browser show its
        // normal offline error rather than us throwing here.
        return fetch(req);
      }
    })()
  );
});
