// Main-thread facade for background removal — dispatches to bg-worker.js so ONNX
// inference does NOT block the UI. Compositing (backdrops, brush edits) runs on
// the main thread using regular Canvas because we need DOM interop for downloads.

(function () {
  let worker = null;
  let ready = false;
  let progressListener = null;
  let jobSeq = 0;
  // id -> { resolve, reject, timeout, lastTick }
  // Timeout is heartbeat-based: it resets whenever the worker posts progress or
  // the model finishes loading. This prevents a slow model download (~44-176 MB
  // on first run) from killing the job before inference even starts.
  const jobs = new Map();
  const readyWaiters = [];

  // Ceiling in ms with no worker activity at all before we give up.
  // Downloads produce progress messages regularly so this window only bites if
  // the worker is truly hung.
  const HEARTBEAT_MS = 90_000;
  // Hard upper bound so a truly broken job can't leak forever.
  const HARD_CEILING_MS = 15 * 60_000;

  const setProgressListener = (fn) => { progressListener = fn; };

  function armHeartbeat(job) {
    if (job.heartbeat) clearTimeout(job.heartbeat);
    job.heartbeat = setTimeout(() => {
      if (!jobs.has(job.id)) return;
      jobs.delete(job.id);
      job.reject(new Error('Background removal stalled (no progress for 90s). Please refresh and try again.'));
    }, HEARTBEAT_MS);
  }

  function clearJobTimers(job) {
    if (job.heartbeat) clearTimeout(job.heartbeat);
    if (job.ceiling) clearTimeout(job.ceiling);
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker('bg-worker.js');
    worker.addEventListener('message', (e) => {
      const msg = e.data || {};
      if (msg.type === 'progress') {
        // Reset the heartbeat for every in-flight job whenever the worker
        // reports activity — model download progress counts.
        jobs.forEach(job => armHeartbeat(job));
        if (progressListener) progressListener(msg.payload);
        return;
      }
      if (msg.type === 'ready') {
        ready = true;
        // Kick the heartbeat forward for any waiting jobs.
        jobs.forEach(job => armHeartbeat(job));
        readyWaiters.splice(0).forEach(fn => fn());
        return;
      }
      if (msg.type === 'result') {
        const job = jobs.get(msg.id);
        if (job) {
          clearJobTimers(job);
          jobs.delete(msg.id);
          job.resolve(msg.dataURL);
        }
        return;
      }
      if (msg.type === 'error') {
        if (msg.id != null) {
          const job = jobs.get(msg.id);
          if (job) {
            clearJobTimers(job);
            jobs.delete(msg.id);
            job.reject(new Error(msg.message));
          }
        } else {
          // library/model init failure — fail every pending job.
          // Also drop the worker so the next call can retry from a clean state.
          jobs.forEach((job) => { clearJobTimers(job); job.reject(new Error(msg.message)); });
          jobs.clear();
          try { worker.terminate(); } catch (_) {}
          worker = null;
          ready = false;
        }
      }
    });
    worker.addEventListener('error', (e) => {
      const err = new Error('Worker crashed: ' + (e.message || 'unknown error'));
      jobs.forEach((job) => { clearJobTimers(job); job.reject(err); });
      jobs.clear();
      try { worker.terminate(); } catch (_) {}
      worker = null;
      ready = false;
    });
    worker.postMessage({ type: 'init' });
    return worker;
  }

  function preload() { try { ensureWorker(); } catch (e) { console.warn('preload:', e); } }

  async function removeBackground(src) {
    ensureWorker();
    const id = ++jobSeq;
    return new Promise((resolve, reject) => {
      const job = { id, resolve, reject };
      job.ceiling = setTimeout(() => {
        if (!jobs.has(id)) return;
        clearJobTimers(job);
        jobs.delete(id);
        reject(new Error('Background removal exceeded 15 minutes. Please refresh and try a smaller image.'));
      }, HARD_CEILING_MS);
      armHeartbeat(job);
      jobs.set(id, job);
      worker.postMessage({ type: 'remove', id, src });
    });
  }

  // === Studio backdrop compositor (main thread) ===
  // opts: { ratio: '1:1'|'4:5'|'9:16'|'16:9'|'3:4'|'4:3', longEdge: 1400, padding: 0.10, zoom: 1, dropShadow: true }
  async function composite(transparentSrc, backdrop, opts = {}) {
    const ratio = opts.ratio || '1:1';
    const longEdge = opts.longEdge || opts.size || 1400;
    const padding = opts.padding == null ? 0.10 : opts.padding;
    const zoom = Math.max(0.65, Math.min(1.45, Number(opts.zoom) || 1));
    const dropShadow = opts.dropShadow === true;

    // Compute canvas dimensions from ratio
    const [rw, rh] = ratio.split(':').map(Number);
    const canvasAspect = rw / rh;
    let cw, ch;
    if (canvasAspect >= 1) { cw = longEdge; ch = Math.round(longEdge / canvasAspect); }
    else                   { ch = longEdge; cw = Math.round(longEdge * canvasAspect); }

    const rawImg = await loadImageBitmap(transparentSrc);
    // Remove faint retained shadow pixels from the cutout before compositing.
    // Opaque pad pixels and their antialiased edges are preserved; low-alpha
    // shadow halos are cleared so outputs do not mix shadowed and shadow-free tiles.
    const cleanCanvas = document.createElement('canvas');
    cleanCanvas.width = rawImg.width;
    cleanCanvas.height = rawImg.height;
    const cleanCtx = cleanCanvas.getContext('2d', { willReadFrequently: true });
    cleanCtx.drawImage(rawImg, 0, 0);
    const cleanData = cleanCtx.getImageData(0, 0, cleanCanvas.width, cleanCanvas.height);
    for (let i = 3; i < cleanData.data.length; i += 4) {
      if (cleanData.data[i] < 140) cleanData.data[i] = 0;
    }
    cleanCtx.putImageData(cleanData, 0, 0);
    const img = await loadImageBitmap(cleanCanvas.toDataURL('image/png'));
    const visible = findVisibleBounds(img);
    const sourceX = visible.x;
    const sourceY = visible.y;
    const sourceW = visible.w;
    const sourceH = visible.h;
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');

    paintBackdrop(ctx, backdrop, Math.max(cw, ch), cw, ch);

    // Fit product with padding on the SHORT edge
    const minEdge = Math.min(cw, ch);
    const targetMax = minEdge * (1 - padding * 2) * zoom;
    const aspect = sourceW / sourceH;
    let w, h;
    if (aspect >= 1) { w = targetMax; h = targetMax / aspect; }
    else             { h = targetMax; w = targetMax * aspect; }
    // Clamp if the visible product would exceed the canvas in either dimension.
    if (w > cw * (1 - padding * 2)) { const s = (cw * (1 - padding * 2)) / w; w *= s; h *= s; }
    if (h > ch * (1 - padding * 2)) { const s = (ch * (1 - padding * 2)) / h; w *= s; h *= s; }
    const x = (cw - w) / 2;
    const y = (ch - h) / 2;

    if (dropShadow && backdrop.type !== 'transparent') {
      ctx.save();
      ctx.filter = 'blur(24px)';
      ctx.globalAlpha = 0.35;
      ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, x + minEdge*0.008, y + minEdge*0.02, w, h);
      ctx.restore();
    }

    ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, x, y, w, h);
    return canvas.toDataURL('image/png');
  }

  // paintBackdrop signature: (ctx, spec, referenceSize, cw?, ch?)
  // referenceSize kept for gradient math tuning; cw/ch are actual canvas dims.
  function paintBackdrop(ctx, spec, size, cw, ch) {
    const W = cw || size;
    const H = ch || size;
    if (spec.type === 'transparent') return;
    if (spec.type === 'solid') { ctx.fillStyle = spec.color; ctx.fillRect(0,0,W,H); return; }
    if (spec.type === 'linear') {
      const angle = (spec.angle || 160) * Math.PI / 180;
      const cx = W/2, cy = H/2;
      const d = Math.max(W, H);
      const x0 = cx - Math.cos(angle) * d;
      const y0 = cy - Math.sin(angle) * d;
      const x1 = cx + Math.cos(angle) * d;
      const y1 = cy + Math.sin(angle) * d;
      const g = ctx.createLinearGradient(x0,y0,x1,y1);
      g.addColorStop(0, spec.from); g.addColorStop(1, spec.to);
      ctx.fillStyle = g; ctx.fillRect(0,0,W,H); return;
    }
    if (spec.type === 'radial') {
      const g = ctx.createRadialGradient(W*0.4, H*0.35, size*0.05, W*0.5, H*0.5, size*0.75);
      g.addColorStop(0, spec.center); g.addColorStop(1, spec.edge);
      ctx.fillStyle = g; ctx.fillRect(0,0,W,H); return;
    }
    if (spec.type === 'paper') {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      const base = spec.base || '#F9E4F3';
      g.addColorStop(0, lighten(base, 6));
      g.addColorStop(0.6, base);
      g.addColorStop(1, darken(base, 8));
      ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
      const b = ctx.createRadialGradient(W*0.5, H*0.9, size*0.05, W*0.5, H*0.9, size*0.55);
      b.addColorStop(0, 'rgba(60,40,55,.10)'); b.addColorStop(1, 'rgba(60,40,55,0)');
      ctx.fillStyle = b; ctx.fillRect(0,0,W,H); return;
    }
    if (spec.type === 'linen') {
      ctx.fillStyle = spec.base || '#EFE7DC';
      ctx.fillRect(0,0,W,H);
      addNoise(ctx, Math.max(W,H), 0.08);
      const v = ctx.createRadialGradient(W*0.5, H*0.5, size*0.3, W*0.5, H*0.5, size*0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(80,60,50,.14)');
      ctx.fillStyle = v; ctx.fillRect(0,0,W,H); return;
    }
    if (spec.type === 'sage') {
      ctx.fillStyle = spec.base || '#EAEFE5';
      ctx.fillRect(0,0,W,H);
      addNoise(ctx, Math.max(W,H), 0.05);
      return;
    }
  }

  function findVisibleBounds(img) {
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    const probe = document.createElement('canvas');
    probe.width = width;
    probe.height = height;
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    pctx.drawImage(img, 0, 0, width, height);
    const pixels = pctx.getImageData(0, 0, width, height).data;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[(y * width + x) * 4 + 3] > 12) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0 || maxY < 0) return { x:0, y:0, w:width, h:height };
    return { x:minX, y:minY, w:maxX - minX + 1, h:maxY - minY + 1 };
  }

  function addNoise(ctx, size, strength) {
    const cell = document.createElement('canvas');
    cell.width = cell.height = 256;
    const cctx = cell.getContext('2d');
    const img = cctx.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.random() - 0.5) * 255 * strength;
      img.data[i] = img.data[i+1] = img.data[i+2] = 128 + v;
      img.data[i+3] = 22;
    }
    cctx.putImageData(img, 0, 0);
    const pattern = ctx.createPattern(cell, 'repeat');
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = pattern;
    ctx.fillRect(0,0,size,size);
    ctx.restore();
  }

  function loadImageBitmap(src) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = typeof src === 'string' ? src : URL.createObjectURL(src);
    });
  }

  function lighten(hex, amt) { return shift(hex, amt); }
  function darken(hex, amt)  { return shift(hex, -amt); }
  function shift(hex, amt) {
    const n = hex.replace('#','');
    const r = Math.max(0, Math.min(255, parseInt(n.slice(0,2),16) + amt));
    const g = Math.max(0, Math.min(255, parseInt(n.slice(2,4),16) + amt));
    const b = Math.max(0, Math.min(255, parseInt(n.slice(4,6),16) + amt));
    return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
  }

  window.WPBGRemoval = {
    preload, removeBackground, composite, setProgressListener,
    isReady: () => ready,
  };
})();
