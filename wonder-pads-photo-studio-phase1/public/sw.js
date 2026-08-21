// Wonder Pads Photo Studio — Service Worker
//
// Unlike a hand-built single-file app, a Vite build's asset filenames are
// content-hashed and change on every build, so we can't precache a fixed
// file list at write-time (that's what a bundler PWA plugin is for, and
// pulling one in was more scope than this step needed). Instead: cache
// same-origin GET requests opportunistically as the app is used
// (cache-first, falling back to network), and cache the RMBG-1.4 model
// weights from Hugging Face's CDN the first time they're downloaded
// (stale-while-revalidate) so the app — including background removal —
// keeps working offline after that first visit.

const VERSION = 'wp-photo-studio-v1';
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

  if (isSameOrigin) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(APP_CACHE).then((c) => c.put(req, res.clone()));
            return res;
          })
      )
    );
    return;
  }

  if (isModelCDN) {
    event.respondWith(
      caches.open(MODEL_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
