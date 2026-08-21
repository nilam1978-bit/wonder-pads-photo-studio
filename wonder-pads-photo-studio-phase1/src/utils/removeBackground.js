// Runs AI background removal via a dedicated Web Worker (bgRemovalWorker.js,
// RMBG-1.4 through @huggingface/transformers) so the model never blocks the
// UI thread. The very first call on a fresh visit downloads the model — a
// one-time cost of a few seconds to tens of seconds depending on
// connection; after that it's cached by the browser and later calls are
// much faster.
//
// removeBackgroundFromFile keeps the exact same signature it had before
// this model swap (file in, canvas out) — nothing that calls it needed to
// change. The optional onProgress(percent) callback is new: it's how a
// gallery card can show real per-item progress instead of just a status
// pill (the previous library didn't expose incremental progress at all).

let worker = null;
let nextId = 1;
const pending = new Map(); // id -> { resolve, reject, onProgress }

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./bgRemovalWorker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e) => {
      const msg = e.data || {};
      const entry = pending.get(msg.id);
      if (!entry) return;
      if (msg.type === 'progress') {
        entry.onProgress?.(msg.percent, msg.key);
        return;
      }
      if (msg.type === 'result') {
        pending.delete(msg.id);
        entry.resolve(msg);
        return;
      }
      if (msg.type === 'error') {
        pending.delete(msg.id);
        entry.reject(new Error(msg.message || 'Background removal failed'));
      }
    });
    worker.addEventListener('error', (e) => {
      // A worker-level error (e.g. failed to load the module) isn't tied
      // to one request id — reject everything still waiting so a caller
      // never hangs forever.
      pending.forEach(({ reject }) => reject(new Error(e.message || 'Background removal worker crashed')));
      pending.clear();
    });
  }
  return worker;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export async function removeBackgroundFromFile(file, onProgress) {
  const src = await fileToDataUrl(file);
  const id = nextId++;
  const w = getWorker();
  const { dataURL, width, height } = await new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    w.postMessage({ type: 'remove', src, id });
  });

  const bitmap = await createImageBitmap(await (await fetch(dataURL)).blob());
  const canvas = document.createElement('canvas');
  canvas.width = width || bitmap.width;
  canvas.height = height || bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}
