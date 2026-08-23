// Runs the RMBG-1.4 background-removal model off the main thread, via
// @huggingface/transformers (a WASM/ONNX runtime — no server, no
// per-image cost, everything happens in the browser). Ported from a
// genspark prototype that loaded the same library from a CDN; here it's
// the bundled npm package instead, so Vite can bundle it and it keeps
// working offline after the model's first download.
//
// Messages:
//   IN:  { type:'remove', src: dataURL, id }
//   OUT: { type:'progress', id, percent, key }
//   OUT: { type:'result', id, dataURL, width, height }
//   OUT: { type:'error', id, message }
//
// Only one 'remove' is ever in flight at a time (the app processes photos
// one at a time), so every progress message during a request — including
// the one-time model download on the very first call — carries that
// request's id and the main thread can show it on the right gallery card.

import { AutoModel, AutoProcessor, RawImage, env } from '@huggingface/transformers';

const MODEL_ID = 'briaai/RMBG-1.4';

env.allowLocalModels = false;
env.useBrowserCache = true;
// Route model downloads through our own Worker's /hf-proxy/ route instead
// of hitting huggingface.co directly from the browser — see
// src/backend/worker.js for why (a cross-origin CORS block specific to
// this deployment's origin). remotePathTemplate is left at its default
// ('{model}/resolve/{revision}/{file}'), which is exactly the path shape
// the proxy expects after stripping the '/hf-proxy/' prefix.
// Note: this only works where the Worker proxy route actually exists
// (the deployed site) — background removal won't reach the model during
// local `npm run dev`, since Vite's dev server doesn't run worker.js.
if (typeof self !== 'undefined' && self.location) {
  env.remoteHost = `${self.location.origin}/hf-proxy`;
}

let model = null;
let processor = null;
let loading = null;

function emit(type, extra, id) {
  self.postMessage({ type, id, ...extra });
}

async function loadModel(id) {
  if (loading) return loading;
  loading = (async () => {
    emit('progress', { percent: 5, key: 'loading library' }, id);
    model = await AutoModel.from_pretrained(MODEL_ID, {
      progress_callback: (p) => {
        if (p.status === 'progress' && p.total) {
          const pct = 10 + Math.round((p.loaded / p.total) * 70);
          emit('progress', { percent: Math.min(pct, 80), key: `downloading ${p.file || 'model'}` }, id);
        }
      },
      dtype: 'fp32',
    });
    emit('progress', { percent: 85, key: 'loading processor' }, id);
    processor = await AutoProcessor.from_pretrained(MODEL_ID, { progress_callback: () => {} });
  })().catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

async function removeBg(src, id) {
  try {
    await loadModel(id);
    emit('progress', { percent: 88 }, id);

    const raw = await RawImage.fromURL(src);
    emit('progress', { percent: 90 }, id);

    const { pixel_values } = await processor(raw);
    emit('progress', { percent: 93 }, id);

    // Yield to the event loop so progress messages actually flush before
    // the (synchronous, blocking) inference call below.
    await new Promise((r) => setTimeout(r, 0));

    const { output } = await model({ input: pixel_values });
    emit('progress', { percent: 96 }, id);

    // Build a mask canvas from the model output (OffscreenCanvas — safe
    // to use inside a worker, no DOM needed).
    const maskData = output.data;
    const [, , maskH, maskW] = output.dims;
    const maskCanvas = new OffscreenCanvas(maskW, maskH);
    const mctx = maskCanvas.getContext('2d');
    const maskImg = mctx.createImageData(maskW, maskH);
    for (let i = 0; i < maskData.length; i++) {
      const v = Math.max(0, Math.min(255, Math.round(maskData[i] * 255)));
      maskImg.data[i * 4] = 255;
      maskImg.data[i * 4 + 1] = 255;
      maskImg.data[i * 4 + 2] = 255;
      maskImg.data[i * 4 + 3] = v;
    }
    mctx.putImageData(maskImg, 0, 0);

    // Composite the original photo through that mask, at full resolution.
    const orig = await self.createImageBitmap(await (await fetch(src)).blob());
    const outCanvas = new OffscreenCanvas(orig.width, orig.height);
    const octx = outCanvas.getContext('2d');
    octx.drawImage(orig, 0, 0, orig.width, orig.height);
    octx.globalCompositeOperation = 'destination-in';
    octx.drawImage(maskCanvas, 0, 0, orig.width, orig.height);

    const blob = await outCanvas.convertToBlob({ type: 'image/png' });
    const buf = await blob.arrayBuffer();
    // Base64-encode in chunks so we don't blow the call-stack on a big photo.
    let bin = '';
    const bytes = new Uint8Array(buf);
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    const dataURL = 'data:image/png;base64,' + btoa(bin);

    emit('progress', { percent: 100 }, id);
    self.postMessage({ type: 'result', id, dataURL, width: orig.width, height: orig.height });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: (err && err.message) || String(err) });
  }
}

self.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.type === 'remove') removeBg(msg.src, msg.id);
});
