import { removeBackground as imglyRemoveBackground } from '@imgly/background-removal';

// Runs the AI background-removal model entirely in the browser (no
// account, no per-image cost). The very first call on a fresh visit
// downloads the model — a one-time cost of a few seconds to tens of
// seconds depending on connection; after that it's cached by the browser
// and later calls are much faster.
export async function removeBackgroundFromFile(file) {
  const blob = await imglyRemoveBackground(file);
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}
