import { RATIOS, drawEdit } from './renderEdit';
import { loadImageCanvas } from './loadImageCanvas';

// Renders an edit at full original resolution — the real, final-quality
// output, used for downloads and for regenerating a photo's library
// thumbnail after an edit or preset is applied.
export async function renderFullEdit(file, editState) {
  const fullCanvas = await loadImageCanvas(file);

  let outWidth, outHeight;
  if (editState.mode === 'crop') {
    outWidth = Math.round(editState.crop.width * fullCanvas.width);
    outHeight = Math.round(editState.crop.height * fullCanvas.height);
  } else {
    const ratioValue = RATIOS[editState.ratioKey] || 1;
    const longEdge = Math.max(fullCanvas.width, fullCanvas.height);
    if (ratioValue >= 1) {
      outWidth = longEdge;
      outHeight = Math.round(longEdge / ratioValue);
    } else {
      outHeight = longEdge;
      outWidth = Math.round(longEdge * ratioValue);
    }
  }

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outWidth;
  outCanvas.height = outHeight;
  drawEdit(outCanvas.getContext('2d'), fullCanvas, fullCanvas.width, fullCanvas.height, editState, outWidth, outHeight);
  return outCanvas;
}

// Shrinks a rendered canvas down to a library-grid-sized thumbnail and
// returns a blob URL ready to drop straight into a photo's thumbUrl.
export async function makeThumbFromCanvas(canvas, maxDimension = 480) {
  const scale = Math.min(1, maxDimension / Math.max(canvas.width, canvas.height));
  const thumb = document.createElement('canvas');
  thumb.width = Math.round(canvas.width * scale);
  thumb.height = Math.round(canvas.height * scale);
  thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);
  const blob = await new Promise((resolve) => thumb.toBlob(resolve, 'image/jpeg', 0.82));
  return URL.createObjectURL(blob);
}

export function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/jpeg', 0.9);
}
