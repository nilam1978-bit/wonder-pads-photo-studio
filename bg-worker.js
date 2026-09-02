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
    if (mod.env) { mod.env.allowLocalModels = false; mod.env.useBrowserCache = true; }
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

async function removeBg(src, id) {
  try {
    await loadModel();
    emit('progress', { key: 'processing', percent: 20 });
    const raw = await mod.RawImage.fromURL(src);
    emit('progress', { key: 'processing', percent: 45 });
    const { pixel_values } = await processor(raw);
    emit('progress', { key: 'inferring', percent: 65 });
    await new Promise(r => setTimeout(r, 0));
    const { output } = await model({ input: pixel_values });
    emit('progress', { key: 'compositing', percent: 85 });
    const maskData = output.data;
    const [_, __, maskH, maskW] = output.dims;
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
    const orig = await self.createImageBitmap(await (await fetch(src)).blob());
    const outCanvas = new OffscreenCanvas(orig.width, orig.height);
    const octx = outCanvas.getContext('2d');
    octx.drawImage(orig, 0, 0, orig.width, orig.height);
    octx.globalCompositeOperation = 'destination-in';
    octx.drawImage(maskCanvas, 0, 0, orig.width, orig.height);
    octx.globalCompositeOperation = 'source-over';
    const blob = await outCanvas.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    const dataURL = 'data:image/png;base64,' + btoa(bin);
    emit('progress', { key: 'done', percent: 100 });
    self.postMessage({ type: 'result', id, dataURL, width: orig.width, height: orig.height });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err && err.message ? err.message : String(err) });
  }
}

self.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.type === 'init') { loadModel().catch(()=>{}); return; }
  if (msg.type === 'remove') { removeBg(msg.src, msg.id); }
});
