// Wonder Pads Studio — Service Worker
// v73 focused canvas editor. Network-first for app assets keeps previews and
// deployments current, while cached files provide an offline fallback.
const VERSION = 'wp-studio-v76-persistent-pattern-workflow';
const APP_SHELL_CACHE = `app-shell-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;
const APP_SHELL = [
  './', './index.html', './manifest.webmanifest',
  './icons.jsx', './data.jsx', './backdrops.jsx', './preset-builder.jsx',
  './production.jsx', './fabric-prep.jsx', './app.jsx', './bg-removal.js',
  './gemini.js', './proxy-config.js', './bg-worker.js', './cutout-editor.jsx',
  './silhouette-studio.jsx', './assets/pdf.min.js', './assets/pdf.worker.min.js',
  './assets/icon-192.png', './assets/icon-512.png', './assets/brand-reference.png',
  './assets/preset-sewing.jpg', './assets/preset-blush.jpg', './assets/preset-cozy.jpg',
  './assets/preset-linen.jpg', './assets/preset-studio.jpg', './assets/product-upload.jpg'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(APP_SHELL_CACHE).then(cache =>
    Promise.allSettled(APP_SHELL.map(url => cache.add(url).catch(() => null)))
  ).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key !== APP_SHELL_CACHE && key !== RUNTIME_CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isCdn = /cdn\.jsdelivr\.net|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|huggingface\.co|hf\.co/i.test(url.hostname);
  if (sameOrigin) {
    event.respondWith((async () => {
      try {
        const response = await fetch(req);
        if (response.ok) {
          const cache = await caches.open(APP_SHELL_CACHE);
          await cache.put(req, response.clone());
        }
        return response;
      } catch (_) {
        return (await caches.match(req)) || (await caches.match(req, {ignoreSearch:true}));
      }
    })());
    return;
  }
  if (isCdn) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      const response = await fetch(req);
      if (response.ok) await cache.put(req, response.clone());
      return response;
    })());
  }
});
