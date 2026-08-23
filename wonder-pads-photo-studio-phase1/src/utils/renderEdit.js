import { paintBackdrop } from './backdrops';

export const DEFAULT_WATERMARK = { enabled: false, corner: 'bottom-right', scale: 0.18, opacity: 0.9 };

export const DEFAULT_LOOK_EDIT_STATE = {
  mode: 'crop',
  ratioKey: 'free',
  crop: { x: 0, y: 0, width: 1, height: 1 },
  fitFill: { type: 'color', color: '#ffffff' },
  adjustments: { brightness: 0, contrast: 0, saturation: 0 },
  removeBackground: false,
  brushStrokes: [],
  textLayers: [],
  watermark: DEFAULT_WATERMARK,
};

// Every ratio button maps to a width/height number. "free" has no ratio —
// you're dragging by hand with nothing enforced.
export const RATIOS = {
  free: null,
  '1:1': 1,
  '4:5': 4 / 5,
  '9:16': 9 / 16,
  '16:9': 16 / 9,
  '3:4': 3 / 4,
  '4:3': 4 / 3,
};

// Display metadata for each ratio button — what it's for, and the actual
// export pixel size at our standard 1400px long edge. "free" is handled
// separately in the UI since it has no fixed size to show.
export const ASPECT_PRESETS = {
  '1:1': { label: 'Square', sub: 'IG feed · catalog', pxLabel: '1400 × 1400' },
  '4:5': { label: 'IG Portrait', sub: 'Feed · higher reach', pxLabel: '1120 × 1400' },
  '9:16': { label: 'IG Reel', sub: 'Reels · Stories · TikTok', pxLabel: '788 × 1400' },
  '16:9': { label: 'Landscape', sub: 'Web banner · YouTube', pxLabel: '1400 × 788' },
  '3:4': { label: 'Portrait', sub: 'Pinterest', pxLabel: '1050 × 1400' },
  '4:3': { label: 'Classic', sub: 'Product listing', pxLabel: '1400 × 1050' },
};

// Given an image's real size and a target ratio, returns the largest
// centered crop rectangle of that ratio that fits inside the image.
// Coordinates are normalized 0-1 so they don't care about resolution.
export function computeCenteredCrop(imgWidth, imgHeight, ratioValue) {
  if (!Number.isFinite(imgWidth) || !Number.isFinite(imgHeight) || imgWidth <= 0 || imgHeight <= 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
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

// Fills the whole canvas with either a flat color or a cover-fit custom
// image. Shared by Fit-mode padding and by Crop mode whenever the
// background has been removed (the cutout has empty space that needs
// something behind it).
export function drawBackgroundFill(ctx, fill, outWidth, outHeight) {
  if (fill?.type === 'image' && fill.imageCanvas) {
    const iw = fill.imageCanvas.width;
    const ih = fill.imageCanvas.height;
    const coverScale = Math.max(outWidth / iw, outHeight / ih);
    const cw = iw * coverScale;
    const ch = ih * coverScale;
    ctx.drawImage(fill.imageCanvas, (outWidth - cw) / 2, (outHeight - ch) / 2, cw, ch);
  } else if (fill?.type === 'backdrop' && fill.spec) {
    paintBackdrop(ctx, fill.spec, outWidth, outHeight);
  } else {
    ctx.fillStyle = fill?.color || '#ffffff';
    ctx.fillRect(0, 0, outWidth, outHeight);
  }
}

// A plain gray/white checkerboard, the standard "this is transparent"
// indicator — used only as an inspection view so leftover background
// halos from an AI cutout are easy to spot against a neutral pattern.
export function drawCheckerboard(ctx, width, height, size = 12) {
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      const dark = ((x / size + y / size) | 0) % 2 === 0;
      ctx.fillStyle = dark ? '#d8d8d8' : '#ffffff';
      ctx.fillRect(x, y, size, size);
    }
  }
}

// Draws just the photo itself, positioned per the current crop or fit
// framing — no background fill, no text, no watermark. Shared by the
// main render AND by the "restore" brush tool, which needs to draw the
// ORIGINAL photo in that exact same position so a brushed area can bring
// back exactly the right pixels.
function drawFramedPhotoOnly(ctx, source, srcWidth, srcHeight, editState, outWidth, outHeight) {
  ctx.save();
  ctx.filter = filterString(editState?.adjustments);
  if (editState?.mode === 'fit') {
    const containScale = Math.min(outWidth / srcWidth, outHeight / srcHeight);
    const dw = srcWidth * containScale;
    const dh = srcHeight * containScale;
    ctx.drawImage(source, (outWidth - dw) / 2, (outHeight - dh) / 2, dw, dh);
  } else {
    const crop = editState?.crop || { x: 0, y: 0, width: 1, height: 1 };
    const sx = crop.x * srcWidth;
    const sy = crop.y * srcHeight;
    const sw = crop.width * srcWidth;
    const sh = crop.height * srcHeight;
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outWidth, outHeight);
  }
  ctx.restore();
}

// Draws whatever the current edit describes onto a canvas context, at
// whatever output size you ask for. Called with a small size for the live
// on-screen preview, and again with the full original size for downloads
// and saved thumbnails — same instructions, different resolution.
// "source" should already be whichever image belongs on top — the
// original photo, or its background-removed cutout — the caller decides
// that; this function just draws it. "originalSource", if given, is used
// only by the "restore" brush tool to bring back pre-cutout pixels in a
// brushed area.
export function drawEdit(ctx, source, srcWidth, srcHeight, editState, outWidth, outHeight, originalSource = null) {
  ctx.clearRect(0, 0, outWidth, outHeight);

  if (editState?.mode === 'fit') {
    drawFit(ctx, source, srcWidth, srcHeight, editState, outWidth, outHeight);
  } else {
    // Crop mode. A background-removed cutout can have empty (transparent)
    // space inside the crop rectangle, so paint a fill first in that case.
    if (editState?.removeBackground) {
      drawBackgroundFill(ctx, editState.fitFill, outWidth, outHeight);
    }
    drawFramedPhotoOnly(ctx, source, srcWidth, srcHeight, editState, outWidth, outHeight);
  }

  // Brush touch-ups (blur / erase / restore) apply to the photo itself,
  // before text or a logo ever get added on top.
  if (editState?.brushStrokes?.length) {
    applyBrushStrokes(ctx, editState, source, originalSource, srcWidth, srcHeight, outWidth, outHeight);
  }

  // Text and watermark sit on top of the finished framing, in that
  // order, so a logo never gets hidden behind a text label.
  if (editState?.textLayers?.length) {
    drawTextLayers(ctx, editState.textLayers, outWidth, outHeight);
  }
  if (editState?.watermark?.enabled && editState.watermark.logoCanvas) {
    drawWatermark(ctx, editState.watermark, outWidth, outHeight);
  }
}

// Traces each stroke's path as a thick round-cornered line (or a single
// dot for a tap with no drag) — the shared shape used both as a visible
// mask and as an erase path.
// Draws each stroke's shape (circle or round-joined line) as an opaque
// mask onto ctx. When a stroke has feather > 0, it's rendered onto its
// own transparent canvas with a CSS blur filter first, then composited
// in — blurring a solid white shape produces exactly the soft alpha
// falloff a feathered brush edge needs, and it still composites cleanly
// through whatever globalCompositeOperation the caller has set (the
// blur happens on the source, not on the destination).
function strokePathOnto(ctx, strokes, outWidth, outHeight) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  strokes.forEach((s) => {
    const drawShape = (targetCtx) => {
      const r = (s.brushSize * outWidth) / 2;
      if (s.points.length <= 1) {
        const p = s.points[0];
        if (!p) return;
        targetCtx.beginPath();
        targetCtx.arc(p.x * outWidth, p.y * outHeight, r, 0, Math.PI * 2);
        targetCtx.fill();
        return;
      }
      targetCtx.lineWidth = s.brushSize * outWidth;
      targetCtx.beginPath();
      s.points.forEach((p, i) => {
        const x = p.x * outWidth;
        const y = p.y * outHeight;
        if (i === 0) targetCtx.moveTo(x, y);
        else targetCtx.lineTo(x, y);
      });
      targetCtx.stroke();
    };

    const featherPx = (s.feather || 0) * outWidth * 0.05;
    if (featherPx > 0.5) {
      const strokeCanvas = document.createElement('canvas');
      strokeCanvas.width = outWidth;
      strokeCanvas.height = outHeight;
      const sctx = strokeCanvas.getContext('2d');
      sctx.lineCap = 'round';
      sctx.lineJoin = 'round';
      sctx.fillStyle = ctx.fillStyle;
      sctx.strokeStyle = ctx.strokeStyle;
      sctx.filter = `blur(${featherPx}px)`;
      drawShape(sctx);
      ctx.drawImage(strokeCanvas, 0, 0);
    } else {
      drawShape(ctx);
    }
  });
}

// Blur, erase, and restore are each their own pass, applied in that
// order, so overlapping touch-ups combine the way you'd expect from
// painting them on in that sequence.
function applyBrushStrokes(ctx, editState, source, originalSource, srcWidth, srcHeight, outWidth, outHeight) {
  const strokes = editState.brushStrokes || [];
  const blurStrokes = strokes.filter((s) => s.tool === 'blur');
  const restoreStrokes = strokes.filter((s) => s.tool === 'restore');
  const eraseStrokes = strokes.filter((s) => s.tool === 'erase');

  if (blurStrokes.length) {
    const blurred = document.createElement('canvas');
    blurred.width = outWidth;
    blurred.height = outHeight;
    const bctx = blurred.getContext('2d');
    bctx.filter = `blur(${Math.max(4, Math.round(outWidth * 0.025))}px)`;
    bctx.drawImage(ctx.canvas, 0, 0);
    bctx.filter = 'none';
    bctx.globalCompositeOperation = 'destination-in';
    bctx.fillStyle = '#fff';
    bctx.strokeStyle = '#fff';
    strokePathOnto(bctx, blurStrokes, outWidth, outHeight);
    ctx.drawImage(blurred, 0, 0);
  }

  if (restoreStrokes.length && originalSource) {
    const restored = document.createElement('canvas');
    restored.width = outWidth;
    restored.height = outHeight;
    const rctx = restored.getContext('2d');
    // Use originalSource's OWN dimensions here, not the cutout's
    // (srcWidth/srcHeight belong to `source`, which can be a different
    // resolution — the live editor's preview canvas is capped at 1000px
    // while the cutout is full-resolution). Sampling with the wrong
    // canvas's dimensions stretches/misaligns the restored area into a
    // blurry, offset patch instead of the crisp original pixels.
    drawFramedPhotoOnly(rctx, originalSource, originalSource.width, originalSource.height, editState, outWidth, outHeight);
    rctx.globalCompositeOperation = 'destination-in';
    rctx.fillStyle = '#fff';
    rctx.strokeStyle = '#fff';
    strokePathOnto(rctx, restoreStrokes, outWidth, outHeight);
    ctx.drawImage(restored, 0, 0);
  }

  if (eraseStrokes.length) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';
    strokePathOnto(ctx, eraseStrokes, outWidth, outHeight);
    ctx.restore();
  }
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
    drawBackgroundFill(ctx, fill, outWidth, outHeight);
  }

  // The full, untouched photo sits on top, scaled down to fit entirely
  // inside the frame (nothing cropped away). Adjustments apply here, to
  // the actual product photo.
  drawFramedPhotoOnly(ctx, source, srcWidth, srcHeight, editState, outWidth, outHeight);
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Text size is stored as a fraction of the output width (not a fixed
// pixel count) so the same layer looks the same relative size whether
// it's being dragged around a small preview or rendered into a full-
// resolution download.
function fontSizeFor(layer, outWidth) {
  return Math.max(8, layer.fontSizeFrac * outWidth);
}

export function drawTextLayers(ctx, layers, outWidth, outHeight) {
  (layers || []).forEach((layer) => {
    const fontSize = fontSizeFor(layer, outWidth);
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const px = layer.x * outWidth;
    const py = layer.y * outHeight;
    const lines = (layer.text || '').split('\n');
    const lineHeight = fontSize * 1.2;
    const textWidth = Math.max(fontSize, ...lines.map((line) => ctx.measureText(line || ' ').width));
    const textHeight = Math.max(lineHeight, lines.length * lineHeight);

    if (layer.bgColor) {
      const padX = fontSize * 0.4;
      const padY = fontSize * 0.3;
      const bw = textWidth + padX * 2;
      const bh = textHeight + padY * 2;
      ctx.fillStyle = layer.bgColor;
      roundRectPath(ctx, px - bw / 2, py - bh / 2, bw, bh, Math.min(10, bh / 2));
      ctx.fill();
    }

    ctx.fillStyle = layer.color || '#ffffff';
    const firstLineY = py - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, index) => ctx.fillText(line, px, firstLineY + index * lineHeight));
  });
}

// Returns each text layer's on-screen bounding box in pixels, for hit-
// testing which one a tap/drag landed on. Purely a preview-interaction
// helper — not used when rendering the real export.
export function measureTextLayers(ctx, layers, outWidth, outHeight) {
  return (layers || []).map((layer) => {
    const fontSize = fontSizeFor(layer, outWidth);
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
    const lines = (layer.text || ' ').split('\n');
    const width = Math.max(fontSize, ...lines.map((line) => ctx.measureText(line || ' ').width)) + fontSize * 0.8;
    const height = Math.max(fontSize * 1.6, lines.length * fontSize * 1.2 + fontSize * 0.6);
    const px = layer.x * outWidth;
    const py = layer.y * outHeight;
    return { id: layer.id, x: px - width / 2, y: py - height / 2, width, height };
  });
}

// A logo image stamped into a corner. "logoCanvas" must already be
// loaded (resolved once when the logo is chosen, then reused) — this
// function only draws.
export function drawWatermark(ctx, watermark, outWidth, outHeight) {
  const { logoCanvas, corner = 'bottom-right', scale = 0.18, opacity = 0.9 } = watermark || {};
  if (!logoCanvas) return;
  const logoW = outWidth * scale;
  const logoH = logoCanvas.height * (logoW / logoCanvas.width);
  const margin = outWidth * 0.03;
  const positions = {
    'top-left': [margin, margin],
    'top-right': [outWidth - logoW - margin, margin],
    'bottom-left': [margin, outHeight - logoH - margin],
    'bottom-right': [outWidth - logoW - margin, outHeight - logoH - margin],
  };
  const [x, y] = positions[corner] || positions['bottom-right'];
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(logoCanvas, x, y, logoW, logoH);
  ctx.restore();
}
