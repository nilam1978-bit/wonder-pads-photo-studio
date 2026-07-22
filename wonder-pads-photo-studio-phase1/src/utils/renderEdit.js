// Every ratio button maps to a width/height number. "free" has no ratio —
// you're dragging by hand with nothing enforced.
export const RATIOS = {
  free: null,
  '1:1': 1,
  '4:5': 4 / 5,
  '9:16': 9 / 16,
  '16:9': 16 / 9,
};

// Given an image's real size and a target ratio, returns the largest
// centered crop rectangle of that ratio that fits inside the image.
// Coordinates are normalized 0-1 so they don't care about resolution.
export function computeCenteredCrop(imgWidth, imgHeight, ratioValue) {
  if (!ratioValue) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const imgRatio = imgWidth / imgHeight;
  if (imgRatio > ratioValue) {
    const width = ratioValue / imgRatio;
    return { x: (1 - width) / 2, y: 0, width, height: 1 };
  }
  const height = imgRatio / ratioValue;
  return { x: 0, y: (1 - height) / 2, width: 1, height };
}

// Turns {brightness, contrast, saturation} (each -100..100, 0 = no change)
// into a canvas filter string. Same units the sliders use, so what you see
// while dragging is exactly what gets baked into the final export.
export function filterString(adjustments) {
  const { brightness = 0, contrast = 0, saturation = 0 } = adjustments || {};
  return `brightness(${100 + brightness}%) contrast(${100 + contrast}%) saturate(${100 + saturation}%)`;
}

// Draws whatever the current edit describes onto a canvas context, at
// whatever output size you ask for. Called with a small size for the live
// on-screen preview, and again with the full original size for downloads
// and saved thumbnails — same instructions, different resolution.
export function drawEdit(ctx, source, srcWidth, srcHeight, editState, outWidth, outHeight) {
  ctx.clearRect(0, 0, outWidth, outHeight);

  if (!editState || editState.mode === 'fit') {
    drawFit(ctx, source, srcWidth, srcHeight, editState, outWidth, outHeight);
    return;
  }

  // Crop mode: take the chosen rectangle out of the source and stretch it
  // to fill the whole output canvas.
  const crop = editState.crop || { x: 0, y: 0, width: 1, height: 1 };
  const sx = crop.x * srcWidth;
  const sy = crop.y * srcHeight;
  const sw = crop.width * srcWidth;
  const sh = crop.height * srcHeight;
  ctx.save();
  ctx.filter = filterString(editState.adjustments);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outWidth, outHeight);
  ctx.restore();
}

function drawFit(ctx, source, srcWidth, srcHeight, editState, outWidth, outHeight) {
  const fill = editState?.fitFill || { type: 'color', color: '#ffffff' };

  if (fill.type === 'blur') {
    // Cover-fill a blurred copy behind everything, so the pad space picks
    // up softened colors from the photo itself instead of a flat color.
    // Brightness/contrast/saturation intentionally do NOT apply here —
    // this backdrop is just a soft color cue, not part of the product shot.
    const coverScale = Math.max(outWidth / srcWidth, outHeight / srcHeight);
    const cw = srcWidth * coverScale;
    const ch = srcHeight * coverScale;
    ctx.save();
    ctx.filter = `blur(${Math.round(outWidth * 0.04)}px)`;
    ctx.drawImage(source, (outWidth - cw) / 2, (outHeight - ch) / 2, cw, ch);
    ctx.restore();
  } else {
    ctx.fillStyle = fill.color || '#ffffff';
    ctx.fillRect(0, 0, outWidth, outHeight);
  }

  // The full, untouched photo sits on top, scaled down to fit entirely
  // inside the frame (nothing cropped away). Adjustments apply here, to
  // the actual product photo.
  const containScale = Math.min(outWidth / srcWidth, outHeight / srcHeight);
  const dw = srcWidth * containScale;
  const dh = srcHeight * containScale;
  ctx.save();
  ctx.filter = filterString(editState?.adjustments);
  ctx.drawImage(source, (outWidth - dw) / 2, (outHeight - dh) / 2, dw, dh);
  ctx.restore();
}
