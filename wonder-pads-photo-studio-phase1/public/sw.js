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
// Only same-origin requests are handled — the RMBG-1.4 model weights
// download from Hugging Face's CDN via a redirect
// (.../resolve/main/...), and a service worker re-fetching a redirected
// cross-origin request is a known way to break CORS on a request that
// works fine unintercepted. Offline caching of the model was a
// nice-to-have; it's not worth breaking background removal over, so
// those requests are left alone entirely and go straight to the network
// exactly as if no service worker existed.
//
// Vite's build produces content-hashed filenames, so there's no fixed
// file list to precache here — the cache fills in naturally as files are
// requested, same as v1.

const VERSION = 'wp-photo-studio-v3';
const APP_CACHE = `app-${VERSION}`;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let the browser handle cross-origin requests as normal

  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const copy = res.clone();
          caches
            .open(APP_CACHE)
            .then((cache) => cache.put(req, copy))
            .catch(() => {});
        }
        return res;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        return fetch(req);
      }
    })()
  );
});
