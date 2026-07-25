import { DEFAULT_LOOK_EDIT_STATE } from './renderEdit';
import { renderFullEdit } from './exportImage';

// Renders each selected photo's current look (or an untouched render, if
// it has no edits yet) into one square cell each, cropped to fill the
// cell so the grid lines up cleanly — the same "cover" behavior a phone
// gallery grid uses.
export async function buildCollage(images, cols, rows, { logoCanvas = null, cellSize = 600, gap = 12, background = '#ffffff' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = cols * cellSize + (cols + 1) * gap;
  canvas.height = rows * cellSize + (rows + 1) * gap;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const slots = images.slice(0, cols * rows);
  for (let i = 0; i < slots.length; i++) {
    const img = slots[i];
    const editState = img.editState || DEFAULT_LOOK_EDIT_STATE;
    const rendered = await renderFullEdit(img.file, editState, img.bgRemovedCanvas, logoCanvas);

    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = gap + col * (cellSize + gap);
    const y = gap + row * (cellSize + gap);

    const scale = Math.max(cellSize / rendered.width, cellSize / rendered.height);
    const dw = rendered.width * scale;
    const dh = rendered.height * scale;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, cellSize, cellSize);
    ctx.clip();
    ctx.drawImage(rendered, x + (cellSize - dw) / 2, y + (cellSize - dh) / 2, dw, dh);
    ctx.restore();
  }

  return canvas;
}
