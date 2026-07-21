import { useCallback, useEffect, useRef, useState } from 'react';
import { RATIOS, computeCenteredCrop, drawEdit } from '../utils/renderEdit';
import { loadImageCanvas } from '../utils/loadImageCanvas';
import './Editor.css';

const CROP_BOX = 380; // fixed square preview box used while in Crop mode
const MIN_CROP_SIZE = 0.05; // smallest crop rect allowed, as a fraction of the image
const HANDLE_HIT_RADIUS = 16; // px, generous so it's easy to grab on a phone

function ratioButtonsForMode(mode) {
  const all = ['free', '1:1', '4:5', '9:16', '16:9'];
  return mode === 'fit' ? all.filter((k) => k !== 'free') : all;
}

// Given which corner is being dragged and the opposite (anchor) corner,
// works out a new aspect-locked rectangle that can't spill outside the
// image. See the build notes for the per-corner math this follows.
function resizeWithRatio(corner, anchor, candidateWidth, ratioValue) {
  let width = Math.max(candidateWidth, MIN_CROP_SIZE);
  let x, y, height;
  if (corner === 'se') {
    width = Math.min(width, 1 - anchor.x, (1 - anchor.y) * ratioValue);
    height = width / ratioValue;
    x = anchor.x;
    y = anchor.y;
  } else if (corner === 'nw') {
    width = Math.min(width, anchor.x, anchor.y * ratioValue);
    height = width / ratioValue;
    x = anchor.x - width;
    y = anchor.y - height;
  } else if (corner === 'ne') {
    width = Math.min(width, 1 - anchor.x, anchor.y * ratioValue);
    height = width / ratioValue;
    x = anchor.x;
    y = anchor.y - height;
  } else {
    // sw
    width = Math.min(width, anchor.x, (1 - anchor.y) * ratioValue);
    height = width / ratioValue;
    x = anchor.x - width;
    y = anchor.y;
  }
  return { x, y, width, height };
}

function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/jpeg', 0.9);
}

export default function Editor({ image, onClose, onSave }) {
  const initial = image.editState || {};
  const [sourceCanvas, setSourceCanvas] = useState(null);
  const [mode, setMode] = useState(initial.mode || 'crop');
  const [ratioKey, setRatioKey] = useState(initial.ratioKey || 'free');
  const [crop, setCrop] = useState(initial.crop || { x: 0, y: 0, width: 1, height: 1 });
  const [fitFill, setFitFill] = useState(initial.fitFill || { type: 'color', color: '#ffffff' });
  const [eyedropperActive, setEyedropperActive] = useState(false);
  const [saving, setSaving] = useState(false);

  const canvasRef = useRef(null);
  const dragRef = useRef(null);

  // Load the photo's real pixels once, capped to a size that's smooth to
  // drag around on screen. Full resolution only gets used later, at save time.
  useEffect(() => {
    let cancelled = false;
    loadImageCanvas(image.file, 1000).then((canvas) => {
      if (!cancelled) setSourceCanvas(canvas);
    });
    return () => {
      cancelled = true;
    };
  }, [image.file]);

  const applyRatio = useCallback(
    (key, forMode) => {
      setRatioKey(key);
      if (forMode === 'crop' && sourceCanvas) {
        setCrop(computeCenteredCrop(sourceCanvas.width, sourceCanvas.height, RATIOS[key]));
      }
    },
    [sourceCanvas]
  );

  const handleModeChange = (newMode) => {
    setMode(newMode);
    if (newMode === 'fit' && ratioKey === 'free') {
      applyRatio('4:5', 'fit');
    }
  };

  // ---- Crop-mode layout + drawing ----
  const getCropLayout = useCallback(() => {
    if (!sourceCanvas) return null;
    const scale = Math.min(CROP_BOX / sourceCanvas.width, CROP_BOX / sourceCanvas.height);
    const drawW = sourceCanvas.width * scale;
    const drawH = sourceCanvas.height * scale;
    return {
      offsetX: (CROP_BOX - drawW) / 2,
      offsetY: (CROP_BOX - drawH) / 2,
      drawW,
      drawH,
    };
  }, [sourceCanvas]);

  const drawCropPreview = useCallback(() => {
    const canvas = canvasRef.current;
    const layout = getCropLayout();
    if (!canvas || !layout || !sourceCanvas) return;
    canvas.width = CROP_BOX;
    canvas.height = CROP_BOX;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, CROP_BOX, CROP_BOX);

    const { offsetX, offsetY, drawW, drawH } = layout;
    ctx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, offsetX, offsetY, drawW, drawH);

    // Dim everything, then re-draw the crop area at full brightness on top.
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(offsetX, offsetY, drawW, drawH);

    const rect = {
      x: offsetX + crop.x * drawW,
      y: offsetY + crop.y * drawH,
      w: crop.width * drawW,
      h: crop.height * drawH,
    };
    ctx.drawImage(
      sourceCanvas,
      crop.x * sourceCanvas.width,
      crop.y * sourceCanvas.height,
      crop.width * sourceCanvas.width,
      crop.height * sourceCanvas.height,
      rect.x,
      rect.y,
      rect.w,
      rect.h
    );

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

    ctx.fillStyle = '#ffffff';
    const corners = [
      [rect.x, rect.y],
      [rect.x + rect.w, rect.y],
      [rect.x, rect.y + rect.h],
      [rect.x + rect.w, rect.y + rect.h],
    ];
    corners.forEach(([cx, cy]) => {
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [sourceCanvas, crop, getCropLayout]);

  // ---- Fit-mode layout + drawing ----
  const getFitBoxSize = useCallback(() => {
    const ratioValue = RATIOS[ratioKey] || 1;
    const longEdge = 380;
    return ratioValue >= 1
      ? { w: longEdge, h: Math.round(longEdge / ratioValue) }
      : { w: Math.round(longEdge * ratioValue), h: longEdge };
  }, [ratioKey]);

  const drawFitPreview = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sourceCanvas) return;
    const { w, h } = getFitBoxSize();
    canvas.width = w;
    canvas.height = h;
    drawEdit(canvas.getContext('2d'), sourceCanvas, sourceCanvas.width, sourceCanvas.height, { mode: 'fit', fitFill }, w, h);
  }, [sourceCanvas, fitFill, getFitBoxSize]);

  useEffect(() => {
    if (mode === 'crop') drawCropPreview();
    else drawFitPreview();
  }, [mode, drawCropPreview, drawFitPreview]);

  // ---- Pointer interaction (crop mode only) ----
  const toImageCoords = useCallback(
    (clientX, clientY) => {
      const canvas = canvasRef.current;
      const layout = getCropLayout();
      if (!canvas || !layout) return null;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const localX = (clientX - rect.left) * scaleX;
      const localY = (clientY - rect.top) * scaleY;
      const nx = (localX - layout.offsetX) / layout.drawW;
      const ny = (localY - layout.offsetY) / layout.drawH;
      return { x: Math.min(1, Math.max(0, nx)), y: Math.min(1, Math.max(0, ny)) };
    },
    [getCropLayout]
  );

  const handlePointerDown = (e) => {
    if (mode !== 'crop' || !sourceCanvas) return;
    const layout = getCropLayout();
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const localX = (e.clientX - rect.left) * scaleX;
    const localY = (e.clientY - rect.top) * scaleY;

    const rectPx = {
      x: layout.offsetX + crop.x * layout.drawW,
      y: layout.offsetY + crop.y * layout.drawH,
      w: crop.width * layout.drawW,
      h: crop.height * layout.drawH,
    };
    const corners = {
      nw: [rectPx.x, rectPx.y],
      ne: [rectPx.x + rectPx.w, rectPx.y],
      sw: [rectPx.x, rectPx.y + rectPx.h],
      se: [rectPx.x + rectPx.w, rectPx.y + rectPx.h],
    };
    const hitCorner = Object.entries(corners).find(
      ([, [cx, cy]]) => Math.hypot(localX - cx, localY - cy) <= HANDLE_HIT_RADIUS
    );

    if (hitCorner) {
      const [corner] = hitCorner;
      const anchor =
        corner === 'nw'
          ? { x: crop.x + crop.width, y: crop.y + crop.height }
          : corner === 'ne'
          ? { x: crop.x, y: crop.y + crop.height }
          : corner === 'sw'
          ? { x: crop.x + crop.width, y: crop.y }
          : { x: crop.x, y: crop.y };
      dragRef.current = { type: 'resize', corner, anchor };
    } else if (
      localX >= rectPx.x &&
      localX <= rectPx.x + rectPx.w &&
      localY >= rectPx.y &&
      localY <= rectPx.y + rectPx.h
    ) {
      const start = toImageCoords(e.clientX, e.clientY);
      dragRef.current = { type: 'move', startPointer: start, startCrop: crop };
    }
  };

  useEffect(() => {
    const handleMove = (e) => {
      const drag = dragRef.current;
      if (!drag) return;
      const point = toImageCoords(e.clientX, e.clientY);
      if (!point) return;

      if (drag.type === 'move') {
        const dx = point.x - drag.startPointer.x;
        const dy = point.y - drag.startPointer.y;
        setCrop((prev) => ({
          ...prev,
          x: Math.min(1 - prev.width, Math.max(0, drag.startCrop.x + dx)),
          y: Math.min(1 - prev.height, Math.max(0, drag.startCrop.y + dy)),
        }));
      } else if (drag.type === 'resize') {
        const ratioValue = RATIOS[ratioKey];
        const { anchor, corner } = drag;
        if (ratioValue) {
          const candidateWidth = Math.abs(point.x - anchor.x);
          const next = resizeWithRatio(corner, anchor, candidateWidth, ratioValue);
          setCrop(next);
        } else {
          const x = Math.min(anchor.x, point.x);
          const y = Math.min(anchor.y, point.y);
          const width = Math.abs(point.x - anchor.x);
          const height = Math.abs(point.y - anchor.y);
          if (width >= MIN_CROP_SIZE && height >= MIN_CROP_SIZE) {
            setCrop({ x, y, width, height });
          }
        }
      }
    };
    const handleUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [ratioKey, toImageCoords]);

  // ---- Eyedropper (fit mode only — it picks the pad-fill color) ----
  const handleFitClick = (e) => {
    if (mode !== 'fit' || !eyedropperActive || !sourceCanvas) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const { w, h } = getFitBoxSize();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const localX = (e.clientX - rect.left) * scaleX;
    const localY = (e.clientY - rect.top) * scaleY;

    const containScale = Math.min(w / sourceCanvas.width, h / sourceCanvas.height);
    const dw = sourceCanvas.width * containScale;
    const dh = sourceCanvas.height * containScale;
    const offsetX = (w - dw) / 2;
    const offsetY = (h - dh) / 2;
    const srcX = Math.round((localX - offsetX) / containScale);
    const srcY = Math.round((localY - offsetY) / containScale);

    if (srcX < 0 || srcY < 0 || srcX >= sourceCanvas.width || srcY >= sourceCanvas.height) return;

    const data = sourceCanvas.getContext('2d').getImageData(srcX, srcY, 1, 1).data;
    const hex = `#${[data[0], data[1], data[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    setFitFill({ type: 'color', color: hex });
    setEyedropperActive(false);
  };

  // ---- Save: renders the final edit at full resolution, updates the
  // library thumbnail, and downloads a copy to your device ----
  const handleSave = async () => {
    setSaving(true);
    const fullCanvas = await loadImageCanvas(image.file);
    const editState = { mode, ratioKey, crop, fitFill };

    let outW, outH;
    if (mode === 'crop') {
      outW = Math.round(crop.width * fullCanvas.width);
      outH = Math.round(crop.height * fullCanvas.height);
    } else {
      const ratioValue = RATIOS[ratioKey] || 1;
      const longEdge = Math.max(fullCanvas.width, fullCanvas.height);
      if (ratioValue >= 1) {
        outW = longEdge;
        outH = Math.round(longEdge / ratioValue);
      } else {
        outH = longEdge;
        outW = Math.round(longEdge * ratioValue);
      }
    }

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    drawEdit(outCanvas.getContext('2d'), fullCanvas, fullCanvas.width, fullCanvas.height, editState, outW, outH);

    const thumbScale = Math.min(1, 480 / Math.max(outW, outH));
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = Math.round(outW * thumbScale);
    thumbCanvas.height = Math.round(outH * thumbScale);
    thumbCanvas.getContext('2d').drawImage(outCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    const thumbBlob = await new Promise((resolve) => thumbCanvas.toBlob(resolve, 'image/jpeg', 0.82));
    const newThumbUrl = URL.createObjectURL(thumbBlob);

    const baseName = image.fileName.replace(/\.[^.]+$/, '');
    downloadCanvas(outCanvas, `${baseName}-edited.jpg`);

    onSave(image.id, editState, newThumbUrl);
    setSaving(false);
  };

  if (!sourceCanvas) {
    return (
      <div className="editor">
        <p className="editor-loading">Loading photo…</p>
        <button type="button" onClick={onClose}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="editor">
      <div className="editor-topbar">
        <button type="button" onClick={onClose} className="editor-back">
          ← Back
        </button>
        <span className="editor-filename">{image.fileName}</span>
      </div>

      <div className="editor-modes">
        <button
          type="button"
          className={mode === 'crop' ? 'active' : ''}
          onClick={() => handleModeChange('crop')}
        >
          Crop
        </button>
        <button
          type="button"
          className={mode === 'fit' ? 'active' : ''}
          onClick={() => handleModeChange('fit')}
        >
          Fit &amp; pad
        </button>
      </div>

      <div className="editor-canvas-wrap">
        <canvas
          ref={canvasRef}
          onPointerDown={mode === 'crop' ? handlePointerDown : handleFitClick}
          className={eyedropperActive ? 'editor-canvas eyedropper' : 'editor-canvas'}
        />
      </div>

      <div className="editor-ratios">
        {ratioButtonsForMode(mode).map((key) => (
          <button
            key={key}
            type="button"
            className={ratioKey === key ? 'active' : ''}
            onClick={() => applyRatio(key, mode)}
          >
            {key === 'free' ? 'Freeform' : key}
          </button>
        ))}
      </div>

      {mode === 'crop' && (
        <p className="editor-hint">Drag inside the box to move it, or drag a corner to resize.</p>
      )}

      {mode === 'fit' && (
        <div className="editor-fill">
          <span className="editor-fill-label">Fill the padded space with:</span>
          <div className="editor-fill-options">
            <button
              type="button"
              className={fitFill.type === 'color' && !eyedropperActive ? 'active' : ''}
              onClick={() => {
                setEyedropperActive(false);
                setFitFill((f) => ({ type: 'color', color: f.color || '#ffffff' }));
              }}
            >
              Color
            </button>
            {fitFill.type === 'color' && (
              <input
                type="color"
                value={fitFill.color}
                onChange={(e) => setFitFill({ type: 'color', color: e.target.value })}
              />
            )}
            <button
              type="button"
              className={eyedropperActive ? 'active' : ''}
              onClick={() => setEyedropperActive((v) => !v)}
            >
              Eyedropper
            </button>
            <button
              type="button"
              className={fitFill.type === 'blur' ? 'active' : ''}
              onClick={() => {
                setEyedropperActive(false);
                setFitFill({ type: 'blur' });
              }}
            >
              Blur-extend
            </button>
          </div>
          {eyedropperActive && <p className="editor-hint">Tap anywhere on the photo to pick that color.</p>}
        </div>
      )}

      <button type="button" className="editor-save" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save & download'}
      </button>
    </div>
  );
}
