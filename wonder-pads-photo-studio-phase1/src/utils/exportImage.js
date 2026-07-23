import { RATIOS, drawEdit } from './renderEdit';
import { loadImageCanvas } from './loadImageCanvas';

// Renders an edit at full original resolution — the real, final-quality
// output, used for downloads and for regenerating a photo's library
// thumbnail after an edit or preset is applied.
//
// If the edit has the background removed, pass the already-computed
// cutout canvas as bgRemovedCanvas so this doesn't have to re-run the AI
// model — that only ever needs to happen once per photo.
export async function renderFullEdit(file, editState, bgRemovedCanvas = null) {
  const source = editState.removeBackground && bgRemovedCanvas ? bgRemovedCanvas : await loadImageCanvas(file);

  let resolvedFitFill = editState.fitFill;
  if (editState.fitFill?.type === 'image' && editState.fitFill.imageFile) {
    const imageCanvas = await loadImageCanvas(editState.fitFill.imageFile, 1600);
    resolvedFitFill = { ...editState.fitFill, imageCanvas };
  }
  const resolvedEditState = { ...editState, fitFill: resolvedFitFill };

  let outWidth, outHeight;
  if (editState.mode === 'crop') {
    outWidth = Math.round(editState.crop.width * source.width);
    outHeight = Math.round(editState.crop.height * source.height);
  } else {
    const ratioValue = RATIOS[editState.ratioKey] || 1;
    const longEdge = Math.max(source.width, source.height);
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
  drawEdit(outCanvas.getContext('2d'), source, source.width, source.height, resolvedEditState, outWidth, outHeight);
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
