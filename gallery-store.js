// Wonder Pads Studio — browser storage helpers (plain script, loaded before the app).
//
// The browser's small storage (localStorage, ~5 MB) is only good for little lists. Photos are big, so they
// live in IndexedDB instead, which can hold hundreds of megabytes. Three drawers in one database:
//   sessions — the working photo behind each Saved Gallery shot (so "Open refine" works after a refresh)
//   drafts   — the Production workspace, auto-saved so a refresh doesn't lose uploads / cut-outs
//   gallery  — the full-size finished pictures of the Saved Gallery
// The small list of Saved Gallery cards (name, size, a small preview) stays in localStorage.
(function () {
  const DB = 'wp_refine';
  const VERSION = 2;
  const META_KEY = 'wp_saved_shots';
  const THUMB_EDGE = 360;

  const open = () => new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('This browser has no photo storage.'));
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('gallery')) db.createObjectStore('gallery', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const run = async (store, mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => { db.close(); resolve(req && req.result); };
      t.onerror = () => { db.close(); reject(t.error); };
      t.onabort = () => { db.close(); reject(t.error || new Error('The browser could not store this (it may be full).')); };
    });
  };

  const toBlob = async (src) => {
    if (!src) return null;
    if (src instanceof Blob) return src;
    const r = await fetch(src);
    return r.blob();
  };

  const store = (name) => ({
    put: (rec) => run(name, 'readwrite', (s) => s.put(rec)).then(() => undefined),
    get: (id) => run(name, 'readonly', (s) => s.get(id)),
    del: (id) => run(name, 'readwrite', (s) => s.delete(id)).then(() => undefined),
    clear: () => run(name, 'readwrite', (s) => s.clear()).then(() => undefined),
    keys: () => run(name, 'readonly', (s) => s.getAllKeys()),
  });

  // ---- sessions (compat with the earlier Open-refine code) ----
  const sessions = store('sessions');
  window.WPRefineStore = {
    put: sessions.put, get: sessions.get, del: sessions.del, clear: sessions.clear, toBlob,
    async keep(ids) {
      const all = (await sessions.keys()) || [];
      for (const k of all) if (!ids.includes(k)) await sessions.del(k);
    },
  };

  // ---- drafts (auto-saved Production workspace) ----
  window.WPDrafts = { ...store('drafts'), toBlob };

  // ---- Fabric photos (full-size Compress results; the list keeps only a small preview) ----
  // Kept in the 'drafts' drawer under the key "photo:<id>" so no database upgrade is needed.
  const drafts = store('drafts');
  window.WPPhotos = {
    put: (id, blob) => drafts.put({ id: 'photo:' + id, blob }),
    async getBlob(id) { const r = await drafts.get('photo:' + id); return r ? r.blob : null; },
    del: (id) => drafts.del('photo:' + id),
  };

  // ---- Saved Gallery ----
  const gallery = store('gallery');
  let migrating = false;

  const readMeta = () => {
    try { const v = JSON.parse(localStorage.getItem(META_KEY) || '[]'); return Array.isArray(v) ? v : []; }
    catch (_) { return []; }
  };
  const writeMeta = (list) => {
    try { localStorage.setItem(META_KEY, JSON.stringify(list)); }
    catch (_) { throw new Error('The Saved Gallery list is full on this device. Remove a few saved photos, then try again.'); }
  };
  const announce = () => { try { window.dispatchEvent(new CustomEvent('wp-saved-gallery-updated')); } catch (_) {} };

  const loadImage = (blob) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this picture.')); };
    img.src = url;
  });

  // A small preview for the gallery cards. JPEG when the picture has no see-through parts (tiny),
  // PNG when it does (so cut-outs and quarter pieces keep their transparency).
  async function makeThumb(blob) {
    const img = await loadImage(blob);
    const k = Math.min(1, THUMB_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    let alpha = false;
    try {
      const d = ctx.getImageData(0, 0, w, h).data;
      for (let i = 3; i < d.length; i += 4 * 7) { if (d[i] < 250) { alpha = true; break; } }
    } catch (_) { alpha = blob.type === 'image/png'; }
    if (!alpha) return c.toDataURL('image/jpeg', 0.82);
    return c.toDataURL('image/png');
  }

  window.WPMakeThumb = (blobOrUrl) => toBlob(blobOrUrl).then(makeThumb);

  const api = {
    // The cards to show. `src` is the small preview (or an old full picture not yet moved).
    list() {
      return readMeta().map((e) => ({ ...e, src: e.thumb || e.src || '' }));
    },
    async save(entry, blob) {
      if (!blob) throw new Error('Nothing to save.');
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (_) {}
      const thumb = await makeThumb(blob);
      await gallery.put({ key: entry.key, blob, type: blob.type || 'image/png', savedAt: Date.now() });
      const { src: _drop, ...clean } = entry;
      const record = { ...clean, thumb, hasFull: true };
      const next = [...readMeta().filter((x) => x.key !== entry.key), record];
      try { writeMeta(next); }
      catch (e) { try { await gallery.del(entry.key); } catch (_) {} throw e; }
      announce();
      return record;
    },
    // The full-size picture as a Blob (works for new shots, and for old ones saved before this update).
    async fullBlob(shotOrKey) {
      const key = typeof shotOrKey === 'string' ? shotOrKey : shotOrKey && shotOrKey.key;
      try {
        const rec = key ? await gallery.get(key) : null;
        if (rec && rec.blob) return rec.blob;
      } catch (_) {}
      const meta = readMeta().find((x) => x.key === key) || (typeof shotOrKey === 'object' ? shotOrKey : null);
      const src = meta && (meta.src && String(meta.src).startsWith('data:') ? meta.src : meta.thumb);
      if (!src) throw new Error('This saved picture is no longer available.');
      return toBlob(src);
    },
    async fullUrl(shotOrKey) { return URL.createObjectURL(await api.fullBlob(shotOrKey)); },
    async remove(key) {
      writeMeta(readMeta().filter((x) => x.key !== key));
      try { await gallery.del(key); } catch (_) {}
      announce();
    },
    async clear() {
      writeMeta([]);
      try { await gallery.clear(); } catch (_) {}
      announce();
    },
    // Old saves kept the whole picture inside the small list. Move each one to the big storage once.
    async migrate() {
      if (migrating) return;
      migrating = true;
      try {
        const legacy = readMeta().filter((e) => typeof e.src === 'string' && e.src.startsWith('data:') && !e.hasFull);
        if (!legacy.length) return;
        const done = new Map();
        for (const e of legacy) {
          try {
            const blob = await toBlob(e.src);
            const thumb = await makeThumb(blob);
            await gallery.put({ key: e.key, blob, type: blob.type || 'image/png', savedAt: Date.now() });
            done.set(e.key, thumb);
          } catch (_) { /* leave this one as it is */ }
        }
        if (!done.size) return;
        const next = readMeta().map((e) => {
          if (!done.has(e.key)) return e;
          const { src: _drop, ...clean } = e;
          return { ...clean, thumb: done.get(e.key), hasFull: true };
        });
        writeMeta(next);
        announce();
      } catch (_) { /* try again next launch */ }
      finally { migrating = false; }
    },
  };
  window.WPGallery = api;
  window.setTimeout(() => api.migrate(), 1200);
})();
