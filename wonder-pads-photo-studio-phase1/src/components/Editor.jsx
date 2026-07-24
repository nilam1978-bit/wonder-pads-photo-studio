import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RATIOS,
  DEFAULT_WATERMARK,
  computeCenteredCrop,
  drawEdit,
  drawCheckerboard,
  measureTextLayers,
  filterString,
} from '../utils/renderEdit';
import { loadImageCanvas } from '../utils/loadImageCanvas';
import { computeAutoEnhance } from '../utils/autoEnhance';
import { removeBackgroundFromFile } from '../utils/removeBackground';
import { renderFullEdit, makeThumbFromCanvas, downloadCanvas } from '../utils/exportImage';
import './Editor.css';

const CROP_BOX = 380; // fixed square preview box used while in Crop mode
const MIN_CROP_SIZE = 0.05; // smallest crop rect allowed, as a fraction of the image
const HANDLE_HIT_RADIUS = 16; // px, generous so it's easy to grab on a phone
const DEFAULT_ADJUSTMENTS = { brightness: 0, contrast: 0, saturation: 0 };
const DEFAULT_FILL = { type: 'color', color: '#ffffff' };
const WATERMARK_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

function makeTextId() {
  return `text-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function ratioButtonsForMode(mode) {
  const all = ['free', '1:1', '4:5', '9:16', '16:9'];
  return mode === 'fit' ? all.filter((k) => k !== 'free') : all;
}

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
    width = Math.min(width, anchor.x, (1 - anchor.y) * ratioValue);
    height = width / ratioValue;
    x = anchor.x - width;
    y = anchor.y;
  }
  return { x, y, width, height };
}

export default function Editor({ image, onClose, onSave, onReset, onBgRemoved, presets, onAddPreset, logoCanvas, onSetLogo }) {
  const initial = image.editState || {};
  const [sourceCanvas, setSourceCanvas] = useState(null);
  const [mode, setMode] = useState(initial.mode || 'crop');
  const [activeTab, setActiveTab] = useState(initial.mode || 'crop');
  const [ratioKey, setRatioKey] = useState(initial.ratioKey || 'free');
  const [crop, setCrop] = useState(initial.crop || { x: 0, y: 0, width: 1, height: 1 });
  const [fitFill, setFitFill] = useState(initial.fitFill || DEFAULT_FILL);
  const [adjustments, setAdjustments] = useState(initial.adjustments || DEFAULT_ADJUSTMENTS);
  const [removeBackground, setRemoveBackground] = useState(initial.removeBackground || false);
  const [removingBackground, setRemovingBackground] = useState(false);
  const [checkEdges, setCheckEdges] = useState(false);
  const [eyedropperActive, setEyedropperActive] = useState(false);
  const [textLayers, setTextLayers] = useState(initial.textLayers || []);
  const [selectedTextId, setSelectedTextId] = useState(null);
  const [watermark, setWatermark] = useState(initial.watermark || DEFAULT_WATERMARK);
  const [saving, setSaving] = useState(false);
  const [presetNameInput, setPresetNameInput] = useState('');
  const [showPresetSave, setShowPresetSave] = useState(false);
  const [bgImageVersion, setBgImageVersion] = useState(0);

  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const textDragRef = useRef(null);
  const textBoundsRef = useRef([]);
  const bgImageCanvasRef = useRef(null); // cached canvas for a custom uploaded backdrop

  useEffect(() => {
    let cancelled = false;
    loadImageCanvas(image.file, 1000).then((canvas) => {
      if (!cancelled) setSourceCanvas(canvas);
    });
    return () => {
      cancelled = true;
    };
  }, [image.file]);

  useEffect(() => {
    if (fitFill.type === 'image' && fitFill.imageFile) {
      let cancelled = false;
      loadImageCanvas(fitFill.imageFile, 1200).then((canvas) => {
        if (!cancelled) {
          bgImageCanvasRef.current = canvas;
          setBgImageVersion((v) => v + 1);
        }
      });
      return () => {
        cancelled = true;
      };
    }
  }, [fitFill]);

  const drawSource = removeBackground && image.bgRemovedCanvas ? image.bgRemovedCanvas : sourceCanvas;

  const resolvedFill = useMemo(
    () => (fitFill.type === 'image' ? { ...fitFill, imageCanvas: bgImageCanvasRef.current } : fitFill),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fitFill, bgImageVersion]
  );

  const resolvedWatermark = useMemo(
    () => (watermark.enabled && logoCanvas ? { ...watermark, logoCanvas } : watermark),
    [watermark, logoCanvas]
  );

  const applyRatio = useCallback(
    (key, forMode) => {
      setRatioKey(key);
      if (forMode === 'crop' && drawSource) {
        setCrop(computeCenteredCrop(drawSource.width, drawSource.height, RATIOS[key]));
      }
    },
    [drawSource]
  );

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    if (tab === 'crop' || tab === 'fit') {
      setMode(tab);
      if (tab === 'fit' && ratioKey === 'free') applyRatio('4:5', 'fit');
    }
  };

  const handleAutoEnhance = () => {
    if (!sourceCanvas) return;
    setAdjustments(computeAutoEnhance(sourceCanvas));
  };

  const handleRemoveBackground = async () => {
    if (image.bgRemovedCanvas) {
      setRemoveBackground(true);
      return;
    }
    setRemovingBackground(true);
    try {
      const canvas = await removeBackgroundFromFile(image.file);
      onBgRemoved(image.id, canvas);
      setRemoveBackground(true);
    } catch (err) {
      console.error('Background removal failed', err);
    }
    setRemovingBackground(false);
  };

  const applyPreset = (preset) => {
    setMode(preset.look.mode);
    setActiveTab(preset.look.mode);
    setRatioKey(preset.look.ratioKey);
    setFitFill(preset.look.fitFill);
    setAdjustments(preset.look.adjustments || DEFAULT_ADJUSTMENTS);
    if (preset.look.mode === 'crop' && drawSource) {
      setCrop(computeCenteredCrop(drawSource.width, drawSource.height, RATIOS[preset.look.ratioKey]));
    }
  };

  const handleSavePreset = () => {
    const name = presetNameInput.trim();
    if (!name) return;
    // Presets deliberately don't capture background-removal, text, or
    // watermark state — those are per-photo specifics (or an expensive
    // AI step), not a lightweight reusable "look".
    onAddPreset(name, { mode, ratioKey, fitFill, adjustments });
    setPresetNameInput('');
    setShowPresetSave(false);
  };

  const handleReset = () => {
    setMode('crop');
    setActiveTab('crop');
    setRatioKey('free');
    setCrop({ x: 0, y: 0, width: 1, height: 1 });
    setFitFill(DEFAULT_FILL);
    setAdjustments(DEFAULT_ADJUSTMENTS);
    setRemoveBackground(false);
    setCheckEdges(false);
    setTextLayers([]);
    setSelectedTextId(null);
    setWatermark(DEFAULT_WATERMARK);
    onReset(image.id);
  };

  // ---- Text layers ----
  const addTextLayer = () => {
    const layer = {
      id: makeTextId(),
      text: 'Your text',
      x: 0.5,
      y: 0.5,
      fontSizeFrac: 0.08,
      color: '#ffffff',
      bgColor: null,
    };
    setTextLayers((prev) => [...prev, layer]);
    setSelectedTextId(layer.id);
    setActiveTab('text');
  };

  const updateTextLayer = (id, patch) => {
    setTextLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const removeTextLayer = (id) => {
    setTextLayers((prev) => prev.filter((l) => l.id !== id));
    if (selectedTextId === id) setSelectedTextId(null);
  };

  const selectedTextLayer = textLayers.find((l) => l.id === selectedTextId) || null;

  // ---- Crop-mode layout + drawing ----
  const getCropLayout = useCallback(() => {
    if (!drawSource) return null;
    const scale = Math.min(CROP_BOX / drawSource.width, CROP_BOX / drawSource.height);
    const drawW = drawSource.width * scale;
    const drawH = drawSource.height * scale;
    return {
      offsetX: (CROP_BOX - drawW) / 2,
      offsetY: (CROP_BOX - drawH) / 2,
      drawW,
      drawH,
    };
  }, [drawSource]);

  const drawCropPreview = useCallback(() => {
    const canvas = canvasRef.current;
    const layout = getCropLayout();
    if (!canvas || !layout || !drawSource) return;
    canvas.width = CROP_BOX;
    canvas.height = CROP_BOX;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, CROP_BOX, CROP_BOX);

    const { offsetX, offsetY, drawW, drawH } = layout;

    if (removeBackground) {
      drawCheckerboard(ctx, CROP_BOX, CROP_BOX, 10);
    }

    ctx.save();
    ctx.filter = filterString(adjustments);
    ctx.drawImage(drawSource, 0, 0, drawSource.width, drawSource.height, offsetX, offsetY, drawW, drawH);
    ctx.restore();

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(offsetX, offsetY, drawW, drawH);

    const rect = {
      x: offsetX + crop.x * drawW,
      y: offsetY + crop.y * drawH,
      w: crop.width * drawW,
      h: crop.height * drawH,
    };

    if (removeBackground && !checkEdges) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();
      drawCheckerboard(ctx, CROP_BOX, CROP_BOX, 10);
      ctx.restore();
    }

    ctx.save();
    ctx.filter = filterString(adjustments);
    ctx.drawImage(
      drawSource,
      crop.x * drawSource.width,
      crop.y * drawSource.height,
      crop.width * drawSource.width,
      crop.height * drawSource.height,
      rect.x,
      rect.y,
      rect.w,
      rect.h
    );
    ctx.restore();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

    ctx.fillStyle = '#ffffff';
    [
      [rect.x, rect.y],
      [rect.x + rect.w, rect.y],
      [rect.x, rect.y + rect.h],
      [rect.x + rect.w, rect.y + rect.h],
    ].forEach(([cx, cy]) => {
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [drawSource, crop, adjustments, removeBackground, checkEdges, getCropLayout]);

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
    if (!canvas || !drawSource) return;
    const { w, h } = getFitBoxSize();
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    if (removeBackground && checkEdges) {
      drawCheckerboard(ctx, w, h, 10);
      const containScale = Math.min(w / drawSource.width, h / drawSource.height);
      const dw = drawSource.width * containScale;
      const dh = drawSource.height * containScale;
      ctx.drawImage(drawSource, (w - dw) / 2, (h - dh) / 2, dw, dh);
      return;
    }

    drawEdit(
      ctx,
      drawSource,
      drawSource.width,
      drawSource.height,
      { mode: 'fit', fitFill: resolvedFill, adjustments },
      w,
      h
    );
  }, [drawSource, resolvedFill, adjustments, getFitBoxSize, removeBackground, checkEdges]);

  // ---- Text-tab: shows the fully composed result (whatever framing is
  // currently set) with draggable text + watermark on top. This is the
  // ONLY view that shares the exact output coordinate space, which is
  // why text placement lives here rather than on the crop/fit canvases. ----
  const getOutputBoxSize = useCallback(() => {
    const longEdge = 380;
    let aspect = 1;
    if (mode === 'crop' && drawSource) {
      aspect = (crop.width / crop.height) * (drawSource.width / drawSource.height);
    } else {
      aspect = RATIOS[ratioKey] || 1;
    }
    return aspect >= 1
      ? { w: longEdge, h: Math.round(longEdge / aspect) }
      : { w: Math.round(longEdge * aspect), h: longEdge };
  }, [mode, crop, ratioKey, drawSource]);

  const drawTextPreview = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !drawSource) return;
    const { w, h } = getOutputBoxSize();
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const previewEditState = {
      mode,
      ratioKey,
      crop,
      fitFill: resolvedFill,
      adjustments,
      removeBackground,
      textLayers,
      watermark: resolvedWatermark,
    };
    drawEdit(ctx, drawSource, drawSource.width, drawSource.height, previewEditState, w, h);
    textBoundsRef.current = measureTextLayers(ctx, textLayers, w, h);

    if (selectedTextId) {
      const b = textBoundsRef.current.find((bb) => bb.id === selectedTextId);
      if (b) {
        ctx.save();
        ctx.strokeStyle = '#c98cbf';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(b.x, b.y, b.width, b.height);
        ctx.restore();
      }
    }
  }, [drawSource, mode, ratioKey, crop, resolvedFill, adjustments, removeBackground, textLayers, resolvedWatermark, selectedTextId, getOutputBoxSize]);

  useEffect(() => {
    if (activeTab === 'crop') drawCropPreview();
    else if (activeTab === 'fit') drawFitPreview();
    else drawTextPreview();
  }, [activeTab, drawCropPreview, drawFitPreview, drawTextPreview]);

  // ---- Pointer interaction: crop-mode move/resize ----
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

  const handleCropPointerDown = (e) => {
    if (!drawSource) return;
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

  // ---- Eyedropper — always samples the ORIGINAL photo, since that's the
  // meaningful source of real background color even when currently
  // viewing the background-removed version. ----
  const handleFitClick = (e) => {
    if (!eyedropperActive || !sourceCanvas) return;
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

  const handleBackgroundImagePick = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setEyedropperActive(false);
      setFitFill({ type: 'image', imageFile: file });
    }
  };

  // ---- Text-tab dragging ----
  const handleTextPointerDown = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const localX = (e.clientX - rect.left) * scaleX;
    const localY = (e.clientY - rect.top) * scaleY;
    const hit = textBoundsRef.current.find(
      (b) => localX >= b.x && localX <= b.x + b.width && localY >= b.y && localY <= b.y + b.height
    );
    if (hit) {
      setSelectedTextId(hit.id);
      const layer = textLayers.find((l) => l.id === hit.id);
      textDragRef.current = {
        id: hit.id,
        startPointerX: localX,
        startPointerY: localY,
        startX: layer.x,
        startY: layer.y,
        boxW: canvas.width,
        boxH: canvas.height,
      };
    } else {
      setSelectedTextId(null);
    }
  };

  useEffect(() => {
    const handleMove = (e) => {
      const drag = textDragRef.current;
      if (!drag) return;
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const localX = (e.clientX - rect.left) * scaleX;
      const localY = (e.clientY - rect.top) * scaleY;
      const dx = (localX - drag.startPointerX) / drag.boxW;
      const dy = (localY - drag.startPointerY) / drag.boxH;
      updateTextLayer(drag.id, {
        x: Math.min(1, Math.max(0, drag.startX + dx)),
        y: Math.min(1, Math.max(0, drag.startY + dy)),
      });
    };
    const handleUp = () => {
      textDragRef.current = null;
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, []);

  const handleCanvasPointerDown = (e) => {
    if (activeTab === 'crop') handleCropPointerDown(e);
    else if (activeTab === 'fit') handleFitClick(e);
    else handleTextPointerDown(e);
  };

  const handleLogoPick = (e) => {
    const file = e.target.files?.[0];
    if (file) onSetLogo(file);
  };

  // ---- Save: renders the final edit at full resolution, updates the
  // library thumbnail, and downloads a copy to your device ----
  const handleSave = async () => {
    setSaving(true);
    const editState = { mode, ratioKey, crop, fitFill, adjustments, removeBackground, textLayers, watermark };
    const outCanvas = await renderFullEdit(image.file, editState, image.bgRemovedCanvas, logoCanvas);
    const newThumbUrl = await makeThumbFromCanvas(outCanvas);

    const baseName = image.fileName.replace(/\.[^.]+$/, '');
    downloadCanvas(outCanvas, `${baseName}-edited.jpg`);

    onSave(image.id, editState, newThumbUrl, 'edited');
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

  const showFillOptions = activeTab === 'fit' || (activeTab !== 'text' && removeBackground);

  return (
    <div className="editor">
      <div className="editor-topbar">
        <button type="button" onClick={onClose} className="editor-back">
          ← Back
        </button>
        <span className="editor-filename">{image.fileName}</span>
        <button type="button" onClick={handleReset} className="editor-reset">
          Reset
        </button>
      </div>

      {presets.length > 0 && (
        <div className="editor-preset-row">
          <span className="editor-fill-label">Apply a saved preset:</span>
          <div className="editor-fill-options">
            {presets.map((p) => (
              <button key={p.id} type="button" onClick={() => applyPreset(p)}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="editor-bg-row">
        <button type="button" onClick={handleRemoveBackground} disabled={removingBackground}>
          {removingBackground
            ? 'Removing background…'
            : removeBackground
            ? '✓ Background removed'
            : 'Remove background'}
        </button>
        {removeBackground && (
          <>
            <button type="button" onClick={() => setRemoveBackground(false)}>
              Undo
            </button>
            <button
              type="button"
              className={checkEdges ? 'active' : ''}
              onClick={() => setCheckEdges((v) => !v)}
            >
              Check edges
            </button>
          </>
        )}
      </div>
      {removingBackground && (
        <p className="editor-hint">First run downloads the model — this can take a little while.</p>
      )}
      {checkEdges && <p className="editor-hint">Checkerboard shows through any transparent area — look for faint color fringes.</p>}

      <div className="editor-modes">
        <button type="button" className={activeTab === 'crop' ? 'active' : ''} onClick={() => handleTabChange('crop')}>
          Crop
        </button>
        <button type="button" className={activeTab === 'fit' ? 'active' : ''} onClick={() => handleTabChange('fit')}>
          Fit &amp; pad
        </button>
        <button type="button" className={activeTab === 'text' ? 'active' : ''} onClick={() => handleTabChange('text')}>
          Text &amp; logo
        </button>
      </div>

      <div className="editor-canvas-wrap">
        <canvas
          ref={canvasRef}
          onPointerDown={handleCanvasPointerDown}
          className={eyedropperActive ? 'editor-canvas eyedropper' : 'editor-canvas'}
        />
      </div>

      {activeTab !== 'text' && (
        <div className="editor-ratios">
          {ratioButtonsForMode(activeTab).map((key) => (
            <button
              key={key}
              type="button"
              className={ratioKey === key ? 'active' : ''}
              onClick={() => applyRatio(key, activeTab)}
            >
              {key === 'free' ? 'Freeform' : key}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'crop' && (
        <p className="editor-hint">Drag inside the box to move it, or drag a corner to resize.</p>
      )}

      {showFillOptions && (
        <div className="editor-fill">
          <span className="editor-fill-label">
            {removeBackground ? 'Background:' : 'Fill the padded space with:'}
          </span>
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
            <button type="button" className={eyedropperActive ? 'active' : ''} onClick={() => setEyedropperActive((v) => !v)}>
              Eyedropper
            </button>
            {!removeBackground && (
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
            )}
            <label className={`editor-file-button ${fitFill.type === 'image' ? 'active' : ''}`}>
              Custom image
              <input type="file" accept="image/*" onChange={handleBackgroundImagePick} hidden />
            </label>
          </div>
          {eyedropperActive && <p className="editor-hint">Tap anywhere on the photo to pick that color.</p>}
        </div>
      )}

      {activeTab === 'text' && (
        <div className="editor-text-panel">
          <button type="button" onClick={addTextLayer}>
            + Add text
          </button>

          {textLayers.length > 0 && (
            <div className="editor-fill-options">
              {textLayers.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={selectedTextId === l.id ? 'active' : ''}
                  onClick={() => setSelectedTextId(l.id)}
                >
                  {l.text || '(empty)'}
                </button>
              ))}
            </div>
          )}

          {selectedTextLayer && (
            <div className="editor-text-controls">
              <input
                type="text"
                value={selectedTextLayer.text}
                onChange={(e) => updateTextLayer(selectedTextLayer.id, { text: e.target.value })}
                placeholder="Type your text"
              />
              <label className="editor-slider">
                <span>Size</span>
                <input
                  type="range"
                  min={2}
                  max={20}
                  value={Math.round(selectedTextLayer.fontSizeFrac * 100)}
                  onChange={(e) => updateTextLayer(selectedTextLayer.id, { fontSizeFrac: Number(e.target.value) / 100 })}
                />
                <span className="editor-slider-value">{Math.round(selectedTextLayer.fontSizeFrac * 100)}%</span>
              </label>
              <div className="editor-fill-options">
                <span className="editor-fill-label">Text color</span>
                <input
                  type="color"
                  value={selectedTextLayer.color}
                  onChange={(e) => updateTextLayer(selectedTextLayer.id, { color: e.target.value })}
                />
                <label className="editor-checkbox">
                  <input
                    type="checkbox"
                    checked={!!selectedTextLayer.bgColor}
                    onChange={(e) => updateTextLayer(selectedTextLayer.id, { bgColor: e.target.checked ? '#000000' : null })}
                  />
                  Background chip
                </label>
                {selectedTextLayer.bgColor && (
                  <input
                    type="color"
                    value={selectedTextLayer.bgColor}
                    onChange={(e) => updateTextLayer(selectedTextLayer.id, { bgColor: e.target.value })}
                  />
                )}
                <button type="button" onClick={() => removeTextLayer(selectedTextLayer.id)}>
                  Delete
                </button>
              </div>
              <p className="editor-hint">Drag the text directly on the photo above to reposition it.</p>
            </div>
          )}

          <div className="editor-watermark-panel">
            <span className="editor-fill-label">Logo watermark</span>
            {!logoCanvas ? (
              <label className="editor-file-button">
                Upload your logo
                <input type="file" accept="image/*" onChange={handleLogoPick} hidden />
              </label>
            ) : (
              <>
                <label className="editor-checkbox">
                  <input
                    type="checkbox"
                    checked={watermark.enabled}
                    onChange={(e) => setWatermark((w) => ({ ...w, enabled: e.target.checked }))}
                  />
                  Add watermark to this photo
                </label>
                {watermark.enabled && (
                  <>
                    <div className="editor-fill-options">
                      {WATERMARK_CORNERS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={watermark.corner === c ? 'active' : ''}
                          onClick={() => setWatermark((w) => ({ ...w, corner: c }))}
                        >
                          {c.replace('-', ' ')}
                        </button>
                      ))}
                    </div>
                    <label className="editor-slider">
                      <span>Size</span>
                      <input
                        type="range"
                        min={5}
                        max={40}
                        value={Math.round(watermark.scale * 100)}
                        onChange={(e) => setWatermark((w) => ({ ...w, scale: Number(e.target.value) / 100 }))}
                      />
                      <span className="editor-slider-value">{Math.round(watermark.scale * 100)}%</span>
                    </label>
                    <label className="editor-slider">
                      <span>Opacity</span>
                      <input
                        type="range"
                        min={10}
                        max={100}
                        value={Math.round(watermark.opacity * 100)}
                        onChange={(e) => setWatermark((w) => ({ ...w, opacity: Number(e.target.value) / 100 }))}
                      />
                      <span className="editor-slider-value">{Math.round(watermark.opacity * 100)}%</span>
                    </label>
                    <label className="editor-file-button">
                      Change logo
                      <input type="file" accept="image/*" onChange={handleLogoPick} hidden />
                    </label>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {activeTab !== 'text' && (
        <div className="editor-adjustments">
          <div className="editor-adjustments-header">
            <span className="editor-fill-label">Adjustments</span>
            <button type="button" onClick={handleAutoEnhance}>
              Auto-enhance
            </button>
          </div>
          {[
            ['brightness', 'Brightness'],
            ['contrast', 'Contrast'],
            ['saturation', 'Saturation'],
          ].map(([key, label]) => (
            <label key={key} className="editor-slider">
              <span>{label}</span>
              <input
                type="range"
                min={-100}
                max={100}
                value={adjustments[key]}
                onChange={(e) => setAdjustments((a) => ({ ...a, [key]: Number(e.target.value) }))}
              />
              <span className="editor-slider-value">{adjustments[key]}</span>
            </label>
          ))}
        </div>
      )}

      <div className="editor-preset-save">
        {showPresetSave ? (
          <div className="editor-fill-options">
            <input
              type="text"
              placeholder="Preset name"
              value={presetNameInput}
              onChange={(e) => setPresetNameInput(e.target.value)}
              className="editor-preset-input"
            />
            <button type="button" onClick={handleSavePreset}>
              Save preset
            </button>
            <button type="button" onClick={() => setShowPresetSave(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setShowPresetSave(true)}>
            Save this look as a preset
          </button>
        )}
      </div>

      <button type="button" className="editor-save" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save & download'}
      </button>
    </div>
  );
}
