import JSZip from 'jszip';
import { DEFAULT_LOOK_EDIT_STATE } from './renderEdit';
import { renderFullEdit } from './exportImage';

// Every exported file passes back through canvas rendering — which is
// also why this quietly strips EXIF data (phone GPS tags, camera info)
// from every photo it touches, with no separate step needed: canvas
// pixels simply don't carry that metadata.
export const SIZE_PRESETS = {
  original: { label: 'Original size', maxDim: null, quality: 0.92 },
  social: { label: 'Social / Instagram', maxDim: 2048, quality: 0.85 },
  whatsapp: { label: 'WhatsApp', maxDim: 1280, quality: 0.72 },
  web: { label: 'Web (smallest)', maxDim: 1600, quality: 0.75 },
};

const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const EXTENSION = { jpeg: 'jpg', png: 'png', webp: 'webp' };

function resizeCanvas(canvas, maxDim) {
  if (!maxDim) return canvas;
  const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
  if (scale === 1) return canvas;
  const out = document.createElement('canvas');
  out.width = Math.round(canvas.width * scale);
  out.height = Math.round(canvas.height * scale);
  out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

// Renders every given photo (using whatever edit it already has, or a
// plain untouched render if it has none) at the chosen format/size, names
// them by your pattern if given, and bundles the lot into one zip blob.
export async function exportImagesAsZip(images, settings, { logoCanvas = null, onProgress } = {}) {
  const zip = new JSZip();
  const preset = SIZE_PRESETS[settings.sizePreset] || SIZE_PRESETS.original;
  const mime = MIME[settings.format] || MIME.jpeg;
  const ext = EXTENSION[settings.format] || 'jpg';
  const usedNames = new Set();

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const editState = img.editState || DEFAULT_LOOK_EDIT_STATE;
    let canvas = await renderFullEdit(img.file, editState, img.bgRemovedCanvas, logoCanvas);
    canvas = resizeCanvas(canvas, preset.maxDim);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, preset.quality));

    const baseName = settings.renamePattern
      ? `${settings.renamePattern}-${String(i + 1).padStart(2, '0')}`
      : img.fileName.replace(/\.[^.]+$/, '');
    let filename = `${baseName}.${ext}`;
    let suffix = 2;
    while (usedNames.has(filename)) {
      filename = `${baseName}-${suffix}.${ext}`;
      suffix += 1;
    }
    usedNames.add(filename);

    zip.file(filename, blob);
    onProgress?.(i + 1, images.length);
  }

  return zip.generateAsync({ type: 'blob' });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
