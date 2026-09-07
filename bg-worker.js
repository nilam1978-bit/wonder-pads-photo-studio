// Web Worker for background removal — runs the RMBG-1.4 ONNX model off the main thread.
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js';
const MODEL_ID = 'briaai/RMBG-1.4';
let mod = null, model = null, processor = null, loading = null;
function emit(type, payload) { self.postMessage({ type, payload }); }
const DTYPE_FALLBACKS = ['q8', 'fp16', 'fp32'];

async function loadModel() {
  if (loading) return loading;
  loading = (async () => {
    emit('progress', { key: 'loading library', percent: 3 });
    mod = await import(TRANSFORMERS_URL);
    if (mod.env) {
      mod.env.allowLocalModels = false;
      mod.env.useBrowserCache = true;
      // Keep model downloads on this website. The Cloudflare Worker forwards
      // /hf-proxy/... to Hugging Face server-side, avoiding the browser CORS
      // failure that otherwise causes every queued photo to show "Failed".
      mod.env.remoteHost = `${self.location.origin}/hf-proxy`;
    }
    emit('progress', { key: 'loading model', percent: 8 });
    let lastErr = null;
    for (const dtype of DTYPE_FALLBACKS) {
      try {
        model = await mod.AutoModel.from_pretrained(MODEL_ID, {
          progress_callback: (p) => {
            if (p.status === 'progress' && p.total) emit('progress', {
              key: `downloading model (${dtype})`,
              percent: Math.min(8 + Math.round((p.loaded / p.total) * 80), 88),
              loaded: p.loaded,
              total: p.total,
            });
          },
          dtype,
        });
        emit('progress', { key: `model loaded (${dtype})`, percent: 89 });
        break;
      } catch (err) {
        lastErr = err;
        emit('progress', { key: `${dtype} unavailable, trying next`, percent: 8 });
      }
    }
    if (!model) throw lastErr || new Error('Failed to load RMBG-1.4 in any dtype');
    emit('progress', { key: 'loading processor', percent: 92 });
    processor = await mod.AutoProcessor.from_pretrained(MODEL_ID, { progress_callback: () => {} });
    emit('progress', { key: 'ready', percent: 100 });
    emit('ready');
  })().catch(err => {
    loading = null;
    emit('error', { message: err && err.message ? err.message : String(err) });
    throw err;
  });
  return loading;
}

async function removeBg(src, id, maxDimension = 0) {
  let pixelValues = null;
  let outputTensor = null;
  let orig = null;
  try {
    await loadModel();
    emit('progress', { key: 'processing', percent: 20 });
    const raw = await mod.RawImage.fromURL(src);
    emit('progress', { key: 'processing', percent: 45 });
    const processed = await processor(raw);
    pixelValues = processed.pixel_values;
    emit('progress', { key: 'inferring', percent: 65 });
    await new Promise(r => setTimeout(r, 0));
    const inference = await model({ input: pixelValues });
    outputTensor = inference.output;
    emit('progress', { key: 'compositing', percent: 85 });
    const maskData = outputTensor.data;
    const [_, __, maskH, maskW] = outputTensor.dims;
    const maskCanvas = new OffscreenCanvas(maskW, maskH);
    const mctx = maskCanvas.getContext('2d');
    const maskImg = mctx.createImageData(maskW, maskH);
    for (let i = 0; i < maskData.length; i++) {
      const v = Math.max(0, Math.min(255, Math.round(maskData[i] * 255)));
      maskImg.data[i*4] = 255;
      maskImg.data[i*4+1] = 255;
      maskImg.data[i*4+2] = 255;
      maskImg.data[i*4+3] = v;
    }
    mctx.putImageData(maskImg, 0, 0);
    orig = await self.createImageBitmap(await (await fetch(src)).blob());
    const scale = maxDimension > 0 ? Math.min(1, maxDimension / Math.max(orig.width, orig.height)) : 1;
    const outWidth = Math.max(1, Math.round(orig.width * scale));
    const outHeight = Math.max(1, Math.round(orig.height * scale));
    const outCanvas = new OffscreenCanvas(outWidth, outHeight);
    const octx = outCanvas.getContext('2d');
    octx.drawImage(orig, 0, 0, outWidth, outHeight);
    octx.globalCompositeOperation = 'destination-in';
    octx.drawImage(maskCanvas, 0, 0, outWidth, outHeight);
    octx.globalCompositeOperation = 'source-over';
    const blob = await outCanvas.convertToBlob({ type: 'image/png' });
    emit('progress', { key: 'done', percent: 100 });
    // A Blob avoids creating several large base64 string copies in mobile RAM.
    self.postMessage({ type: 'result', id, blob, width: outWidth, height: outHeight });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err && err.message ? err.message : String(err) });
  } finally {
    try { pixelValues?.dispose?.(); } catch (_) {}
    try { outputTensor?.dispose?.(); } catch (_) {}
    try { orig?.close?.(); } catch (_) {}
    pixelValues = null;
    outputTensor = null;
    orig = null;
  }
}

self.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.type === 'init') { loadModel().catch(()=>{}); return; }
  if (msg.type === 'remove') { removeBg(msg.src, msg.id, Number(msg.maxDimension) || 0); }
});
