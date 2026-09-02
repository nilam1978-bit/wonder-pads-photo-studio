// SCREEN 2 — Production Generator with BULK upload + PhotoRoom-style gallery
// Each uploaded photo is an "item" in a gallery. BG removal is started per item;
// backdrop / ratio / results are per-item and edited when an item is "active".

const ProductionGenerator = ({ initialPresetId, onGoto }) => {
  const { useState, useEffect, useRef, useCallback, useMemo } = React;

  const [selectedPresetId, setSelectedPresetId] = useState(initialPresetId || 'blush-flatlay');
  const [studioPresets] = useState(() => (window.readStudioPresets ? window.readStudioPresets() : PRESETS));
  const [generationCount, setGenerationCount] = useState(() => Number(localStorage.getItem('wp_generation_count') || 1));
  useEffect(() => { localStorage.setItem('wp_generation_count', String(generationCount)); }, [generationCount]);

  // Gallery — array of items. Each item:
  //   { id, name, src, w, h, cutout?, bgProgress?, bgError?, results?, chosenBackdropIds, ratio }
  const [items, setItems] = useState([]);
  const itemsRef = useRef([]);
  const [activeId, setActiveId] = useState(null);
  const ratioRenderTokens = useRef(new Map());

  // Queued jobs need a synchronous snapshot. Reading a local variable assigned
  // inside a setItems updater races React and can make a newly uploaded photo
  // appear to process forever without ever reaching the worker.
  useEffect(() => { itemsRef.current = items; }, [items]);
  const [selection, setSelection] = useState(new Set());     // multi-select of item ids
  const [chosenRatioGlobal, setChosenRatioGlobal] = useState(() => localStorage.getItem('wp_ratio') || '1:1');
  useEffect(()=>{ localStorage.setItem('wp_ratio', chosenRatioGlobal); }, [chosenRatioGlobal]);

  const [showEditor, setShowEditor] = useState(false);
  const [showSilhouette, setShowSilhouette] = useState(false);
  const [showStudioModal, setShowStudioModal] = useState(false);
  const [refineTool, setRefineTool] = useState(null);
  const [showCollageModal, setShowCollageModal] = useState(false);
  const [collageSources, setCollageSources] = useState([]);
  const [collageLayout, setCollageLayout] = useState('2x2');
  const [collageAspectRatio, setCollageAspectRatio] = useState('1:1');
  const [collageBackdrop, setCollageBackdrop] = useState('blush');
  const [collageGap, setCollageGap] = useState(20);
  const [collageTitle, setCollageTitle] = useState('Wonder Pads studio set');
  const [collageSrc, setCollageSrc] = useState('');
  const [collageBusy, setCollageBusy] = useState(false);
  const [collageNotice, setCollageNotice] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const logoInputRef = useRef(null);

  const COLLAGE_LAYOUTS = {
    '2x2': { label:'2×2 grid', cols:2, rows:2 },
    '3x3': { label:'3×3 grid', cols:3, rows:3 },
    '2x3': { label:'2×3 grid', cols:2, rows:3 },
    '3x2': { label:'3×2 grid', cols:3, rows:2 },
  };
  const collageSpec = COLLAGE_LAYOUTS[collageLayout] || COLLAGE_LAYOUTS['2x2'];
  const collageCapacity = collageSpec.cols * collageSpec.rows;

  const preset = studioPresets.find(p=>p.id===selectedPresetId) || studioPresets[0] || PRESETS[1];
  const studioSettings = { ...(window.STUDIO_PRESET_DEFAULTS || {}), ...(preset?.studio || {}) };
  const presetBackdropIds = Array.isArray(studioSettings.backdropIds) && studioSettings.backdropIds.length ? studioSettings.backdropIds.slice(0,4) : DEFAULT_BATCH_IDS.slice();
  const presetRatio = studioSettings.ratio || chosenRatioGlobal;
  const resultDefaults = (extra = {}) => ({
    zoom: Number(studioSettings.zoom) || 1,
    padding: Number(studioSettings.padding) || 0.10,
    fitApplied: true,
    labelText: studioSettings.labelText || '',
    labelPosition: studioSettings.labelPosition || 'bottom-left',
    labelSize: studioSettings.labelSize || 'medium',
    labelBackground: studioSettings.labelBackground !== false,
    labelColor: studioSettings.labelColor || '#4D3245',
    labelBackgroundColor: studioSettings.labelBackgroundColor || '#FFF1F8',
    logoDataUrl: studioSettings.logoDataUrl || '',
    logoName: studioSettings.logoName || '',
    logoPosition: studioSettings.logoPosition || 'top-right',
    logoScale: Number(studioSettings.logoScale) || 0.18,
    logoOpacity: studioSettings.logoOpacity == null ? 1 : Number(studioSettings.logoOpacity),
    ...extra,
  });

  const applyStudioPreset = (id) => {
    const next = studioPresets.find(p=>p.id===id);
    if (!next) return;
    setSelectedPresetId(id);
    const nextSettings = next.studio || {};
    if (nextSettings.ratio) setChosenRatioGlobal(nextSettings.ratio);
    const nextBackdrops = Array.isArray(nextSettings.backdropIds) && nextSettings.backdropIds.length ? nextSettings.backdropIds.slice(0,4) : DEFAULT_BATCH_IDS.slice();
    setItems(prev => prev.map(item => ({ ...item, ratio: nextSettings.ratio || item.ratio, chosenBackdropIds: nextBackdrops.slice() })));
  };

  const activeItem = items.find(it => it.id === activeId) || null;

  // Preload BG-removal model once
  useEffect(() => {
    if (window.WPBGRemoval) window.WPBGRemoval.preload();
  }, []);


  // === Item patching helpers ===
  const patchItem = useCallback((id, delta) => {
    setItems(prev => prev.map(it => it.id === id ? (typeof delta === 'function' ? delta(it) : { ...it, ...delta }) : it));
  }, []);

  // Setup a per-item progress listener bridge — the WPBGRemoval singleton only
  // has one listener, so we attach it once and route progress to whichever item
  // is currently being processed. We stash the "currently processing id" here.
  const currentJobItemId = useRef(null);
  useEffect(() => {
    if (!window.WPBGRemoval) return;
    window.WPBGRemoval.setProgressListener((p) => {
      const id = currentJobItemId.current;
      if (!id) return;
      patchItem(id, { bgProgress: p });
    });
  }, [patchItem]);

  // === Ingest files ===
  const readFileAsDataURL = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = (e) => res(e.target.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  const dimensionsFromSrc = (src) => new Promise((res) => {
    const i = new Image();
    i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight });
    i.onerror = () => res({ w: 0, h: 0 });
    i.src = src;
  });

  // Sequential job queue for BG removal (worker is single-threaded per model instance)
  const queueRef = useRef(Promise.resolve());
  const enqueueBgRemoval = (id, fallbackItem = null) => {
    queueRef.current = queueRef.current.then(async () => {
      // Use the synchronized ref rather than reading state through an updater
      // and immediately consuming the not-yet-assigned local variable.
      const cur = itemsRef.current.find(it => it.id === id) || fallbackItem;
      if (!cur || !(cur.manualSrc || cur.src) || cur.cutout) return;

      currentJobItemId.current = id;
      patchItem(id, { bgProgress: { key:'queued', percent:0 }, bgError: null });
      try {
        const transparent = await window.WPBGRemoval.removeBackground(cur.manualSrc || cur.src);
        patchItem(id, { cutout: transparent, bgProgress: { key:'done', percent:100 }, cutoutMethod:'bg-remove' });
      } catch (e) {
        patchItem(id, { bgError: e.message || String(e), bgProgress: null });
      } finally {
        if (currentJobItemId.current === id) currentJobItemId.current = null;
      }
    });
  };

  const ingestFiles = async (fileList) => {
    if (!fileList || !fileList.length) return;
    const files = Array.from(fileList).filter(f => /^image\//.test(f.type)).slice(0, 50);
    const now = Date.now();

    // Read + measure each file first, then push them in as a batch
    const prepared = await Promise.all(files.map(async (f, i) => {
      const src = await readFileAsDataURL(f);
      const dim = await dimensionsFromSrc(src);
      return {
        id: `it_${now}_${i}_${Math.random().toString(36).slice(2,7)}`,
        name: f.name,
        src,
        w: dim.w, h: dim.h,
        manualSrc: null,
        previewDraft: resultDefaults({ status:'ok', src, backdropId:presetBackdropIds[0], ratio:presetRatio }),
        cutout: null,
        bgProgress: { key:'queued', percent:0 },
        bgError: null,
        results: null,
        chosenBackdropIds: presetBackdropIds.slice(),
        ratio: presetRatio,
      };
    }));

    setItems(prev => {
      const next = [...prev, ...prepared];
      // Auto-activate the first newly-added if nothing was active
      if (!activeId && prepared.length) queueMicrotask(() => setActiveId(prepared[0].id));
      return next;
    });

    // Seed the synchronous snapshot before queuing because React state effects
    // run after this handler returns.
    itemsRef.current = [...itemsRef.current, ...prepared];
    // Start the sequential background-removal queue automatically after the batch is in the synchronized ref.
    prepared.forEach(item => enqueueBgRemoval(item.id, item));
  };

  const useSample = async () => {
    // Add the sample as a new gallery item
    const src = 'assets/product-upload.jpg';
    const dim = await dimensionsFromSrc(src);
    const id = `it_${Date.now()}_sample`;
    const item = {
      id, name: 'sample-pad.jpg', src,
      w: dim.w, h: dim.h,
      manualSrc: null,
      previewDraft: resultDefaults({ status:'ok', src, backdropId:presetBackdropIds[0], ratio:presetRatio }),
      cutout: null,
      bgProgress: { key:'not-started', percent:0 },
      bgError: null,
      results: null,
      chosenBackdropIds: presetBackdropIds.slice(),
      ratio: presetRatio,
    };
    itemsRef.current = [...itemsRef.current, item];
    setItems(prev => [...prev, item]);
    if (!activeId) setActiveId(id);
    enqueueBgRemoval(id, item);
  };

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files) ingestFiles(e.dataTransfer.files);
  };

  const removeItem = (id) => {
    setItems(prev => prev.filter(it => it.id !== id));
    setSelection(prev => { const n = new Set(prev); n.delete(id); return n; });
    if (activeId === id) {
      setItems(prev => {
        const still = prev.filter(it => it.id !== id);
        setActiveId(still.length ? still[0].id : null);
        return still;
      });
    }
  };

  const startBgRemoval = (id) => {
    const item = itemsRef.current.find(it => it.id === id) || items.find(it => it.id === id);
    if (!item || item.cutout || item.bgProgress?.key === 'processing' || item.bgProgress?.key === 'queued') return;
    patchItem(id, { cutout: null, bgError: null, bgProgress:{ key:'queued', percent:0 } });
    enqueueBgRemoval(id, item);
  };

  const retryBgRemoval = (id) => startBgRemoval(id);

  const toggleSelection = (id) => {
    setSelection(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const selectAll   = () => setSelection(new Set(items.map(it => it.id)));
  const selectNone  = () => setSelection(new Set());

  const bulkRemoveSelected = () => {
    if (selection.size === 0) return;
    const toRemove = new Set(selection);
    setItems(prev => prev.filter(it => !toRemove.has(it.id)));
    setSelection(new Set());
    if (activeId && toRemove.has(activeId)) {
      setItems(prev => { setActiveId(prev.length ? prev[0].id : null); return prev; });
    }
  };

  // === Backdrop / ratio changes (on active item) ===
  const setActiveRatio = async (newRatio) => {
    if (!activeItem) return;
    const resultIndex = selectedResultIdx;
    const renderKey = `${activeItem.id}:${resultIndex}`;
    const renderToken = `${Date.now()}-${Math.random()}`;
    ratioRenderTokens.current.set(renderKey, renderToken);
    patchItem(activeItem.id, { ratio: newRatio });
    // Only the selected studio result is recomposited. Sibling results retain
    // their own canvas, pixels, ratio, and shadow treatment.
    if (activeItem.results && activeItem.cutout && activeItem.results[resultIndex]) {
      const cutout = activeItem.cutout;
      const current = activeItem.results[resultIndex];
      patchItem(activeItem.id, (it) => ({
        ...it,
        results: (it.results || []).map((r, i) => i === resultIndex ? { ...r, status:'pending', ratio:newRatio } : r),
      }));
      const bd = BACKDROPS.find(b => b.id === current.backdropId);
      try {
        const src = await window.WPBGRemoval.composite(cutout, bd.spec, {
          ratio: newRatio,
          longEdge: 1400,
          padding: Number(current.padding) || 0.10,
          zoom: Number(current.zoom) || 1,
          dropShadow: false,
        });
        if (ratioRenderTokens.current.get(renderKey) !== renderToken) return;
        patchItem(activeItem.id, (it) => ({
          ...it,
          results: (it.results || []).map((r, i) => i === resultIndex ? { ...r, status:'ok', src, ratio:newRatio } : r),
        }));
      } catch (e) {
        if (ratioRenderTokens.current.get(renderKey) !== renderToken) return;
        patchItem(activeItem.id, (it) => ({
          ...it,
          results: (it.results || []).map((r, i) => i === resultIndex ? { ...r, status:'error', error:e.message, ratio:newRatio } : r),
        }));
      }
    }
  };

  const toggleBackdropInActive = (id) => {
    if (!activeItem) return;
    patchItem(activeItem.id, (it) => {
      const has = it.chosenBackdropIds.includes(id);
      let next;
      if (has) next = it.chosenBackdropIds.filter(x => x !== id);
      else if (it.chosenBackdropIds.length >= 4) next = [...it.chosenBackdropIds.slice(1), id];
      else next = [...it.chosenBackdropIds, id];
      return { ...it, chosenBackdropIds: next };
    });
  };

  const runGenerateActive = async () => {
    if (!activeItem || !activeItem.cutout) return;
    const ids = activeItem.chosenBackdropIds.slice(0, generationCount);
        const cutout = activeItem.cutout;
    // Preserve each existing result's own ratio on Re-run. A Canvas change is scoped
    // to the selected result and must not be overwritten by the shared item default.
    const ratios = ids.map((id, i) => activeItem.results?.[i]?.ratio || activeItem.ratio);
    const pending = ids.map((id, i) => resultDefaults({ status:'pending', backdropId: id, ratio: ratios[i] }));
    patchItem(activeItem.id, { results: pending });
    const outs = await Promise.all(ids.map(async (id, i) => {
      const ratio = ratios[i];
      const bd = BACKDROPS.find(b => b.id === id);
      try {
        const src = await window.WPBGRemoval.composite(cutout, bd.spec, { ratio, longEdge: 1400, padding: Number(studioSettings.padding) || 0.10, zoom:Number(studioSettings.zoom) || 1, dropShadow: false });
        return resultDefaults({ status:'ok', src, backdropId: id, ratio });
      } catch (e) {
        return resultDefaults({ status:'error', error: e.message, backdropId: id, ratio });
      }
    }));
    patchItem(activeItem.id, { results: outs });
  };

  // Batch generate for all selected items (uses each item's own settings)
  const runGenerateBatch = async () => {
    const targetIds = selection.size > 0 ? Array.from(selection) : items.map(it => it.id);
    for (const id of targetIds) {
      const it = items.find(x => x.id === id);
      if (!it || !it.cutout) continue;
      const ratio = it.ratio;
      const ids = it.chosenBackdropIds.slice(0, generationCount);
      patchItem(id, { results: ids.map(bid => resultDefaults({ status:'pending', backdropId: bid, ratio })) });
      const outs = await Promise.all(ids.map(async (bid) => {
        const bd = BACKDROPS.find(b => b.id === bid);
        try {
          const src = await window.WPBGRemoval.composite(it.cutout, bd.spec, { ratio, longEdge: 1400, padding: Number(studioSettings.padding) || 0.10, zoom:Number(studioSettings.zoom) || 1, dropShadow: false });
          return resultDefaults({ status:'ok', src, backdropId: bid, ratio });
        } catch (e) {
          return resultDefaults({ status:'error', error: e.message, backdropId: bid, ratio });
        }
      }));
      patchItem(id, { results: outs });
    }
  };

  const swapBackdropInResult = async (resultIndex, newBackdropId) => {
    if (!activeItem) return;
    if (!activeItem.results?.length) {
      patchItem(activeItem.id, it => ({ ...it, previewDraft: { ...(it.previewDraft || resultDefaults()), backdropId:newBackdropId } }));
      return;
    }
    const cutout = activeItem.cutout;
    const ratio = activeItem.results[resultIndex]?.ratio || activeItem.ratio;
    patchItem(activeItem.id, (it) => ({ ...it, results: it.results.map((r,i) => i===resultIndex ? { ...r, status:'pending', backdropId:newBackdropId } : r) }));
    const bd = BACKDROPS.find(b => b.id === newBackdropId);
      const zoom = Number(activeItem.results[resultIndex]?.zoom) || 1;
    const padding = Number(activeItem.results[resultIndex]?.padding) || 0.10;
    try {
      const src = await window.WPBGRemoval.composite(cutout, bd.spec, { ratio, longEdge: 1400, padding, zoom });
      patchItem(activeItem.id, (it) => ({ ...it, results: it.results.map((r,i) => i===resultIndex ? { ...r, status:'ok', src, backdropId:newBackdropId, ratio } : r) }));
    } catch (e) {
      patchItem(activeItem.id, (it) => ({ ...it, results: it.results.map((r,i) => i===resultIndex ? { ...r, status:'error', error:e.message, backdropId:newBackdropId, ratio } : r) }));
    }
  };

  const changeResultRatio = async (resultIndex, newRatio) => {
    if (!activeItem) return;
    if (!activeItem.results?.length) {
      patchItem(activeItem.id, it => ({ ...it, ratio:newRatio, previewDraft: { ...(it.previewDraft || resultDefaults()), ratio:newRatio } }));
      return;
    }
    const cutout = activeItem.cutout;
    const r = activeItem.results[resultIndex];
    if (!r) return;
    patchItem(activeItem.id, (it) => ({ ...it, results: it.results.map((x,i) => i===resultIndex ? { ...x, status:'pending', ratio:newRatio } : x) }));
    const zoom = Number(r.zoom) || 1;
    const bd = BACKDROPS.find(b => b.id === r.backdropId);
    try {
      const src = await window.WPBGRemoval.composite(cutout, bd.spec, {         ratio: newRatio, longEdge: 1400, padding: Number(r.padding) || 0.10, zoom });
      patchItem(activeItem.id, (it) => ({ ...it, results: it.results.map((x,i) => i===resultIndex ? { ...x, status:'ok', src, backdropId:r.backdropId, ratio:newRatio } : x) }));
    } catch (e) {
      patchItem(activeItem.id, (it) => ({ ...it, results: it.results.map((x,i) => i===resultIndex ? { ...x, status:'error', error:e.message, backdropId:r.backdropId, ratio:newRatio } : x) }));
    }
  };

  const recomposeResultAtZoom = async (resultIndex, nextZoom, fitApplied = false) => {
    if (!activeItem) return;
    if (!activeItem.cutout || !activeItem.results?.[resultIndex]) {
      patchItem(activeItem.id, it => ({ ...it, previewDraft: { ...(it.previewDraft || resultDefaults()), zoom:Math.max(0.65, Math.min(1.45, Number(nextZoom) || 1)), fitApplied } }));
      return;
    }
    const zoom = Math.max(0.65, Math.min(1.45, Number(nextZoom) || 1));
    const current = activeItem.results[resultIndex];
    const bd = BACKDROPS.find(b => b.id === current.backdropId);
    if (!bd) return;
    patchItem(activeItem.id, (it) => ({
      ...it,
      results: it.results.map((r, i) => i === resultIndex ? { ...r, status:'pending', zoom, fitApplied } : r),
    }));
    try {
      const src = await window.WPBGRemoval.composite(activeItem.cutout, bd.spec, {
        ratio: current.ratio || activeItem.ratio,
        longEdge: 1400,
        padding: Number(current.padding) || 0.10,
        zoom,
      });
      patchItem(activeItem.id, (it) => ({
        ...it,
        results: it.results.map((r, i) => i === resultIndex ? { ...r, status:'ok', src, zoom, fitApplied } : r),
      }));
    } catch (e) {
      patchItem(activeItem.id, (it) => ({
        ...it,
        results: it.results.map((r, i) => i === resultIndex ? { ...r, status:'error', error:e.message, zoom, fitApplied } : r),
      }));
    }
  };

  const fitSelectedResult = () => recomposeResultAtZoom(selectedResultIdx, 1, true);
  const zoomSelectedResult = (value) => recomposeResultAtZoom(selectedResultIdx, value, false);

  const downloadOne = (src, filename) => {
    const a = document.createElement('a');
    a.href = src; a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const saveDataUrlToPhone = async (src, filename) => {
    if (!src || !filename) return;
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      const file = new File([blob], filename, { type: blob.type || 'image/png' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files:[file] })) {
        await navigator.share({ files:[file], title:'Wonder Pads Studio', text:'Saved from Wonder Pads Studio' });
        return 'shared';
      }
      const objectUrl = URL.createObjectURL(blob);
      downloadOne(objectUrl, filename);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
      return 'downloaded';
    } catch (error) {
      try { window.open(src, '_blank', 'noopener,noreferrer'); return 'opened'; }
      catch (_) { return 'failed'; }
    }
  };


  const [selectedResultIdx, setSelectedResultIdx] = useState(0);
  const [exportFormat, setExportFormat] = useState('png');
  const [savedShots, setSavedShots] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem('wp_saved_shots') || '[]');
      return Array.isArray(value) ? value : [];
    } catch (_) { return []; }
  });
  const [savingSelectedResult, setSavingSelectedResult] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');
  useEffect(() => {
    try { localStorage.setItem('wp_saved_shots', JSON.stringify(savedShots)); } catch (_) {}
    window.dispatchEvent(new CustomEvent('wp-saved-gallery-updated'));
  }, [savedShots]);

  const selectedResult = activeItem?.results?.[selectedResultIdx] || activeItem?.previewDraft || null;
  const patchSelectedResult = useCallback((delta) => {
    if (!activeItem || !selectedResult) return;
    patchItem(activeItem.id, (it) => it.results?.length
      ? { ...it, results: it.results.map((result, index) => index === selectedResultIdx ? { ...result, ...delta } : result) }
      : { ...it, previewDraft: { ...(it.previewDraft || {}), ...delta } }
    );
  }, [activeItem, selectedResult, selectedResultIdx, patchItem]);

  const labelPositionStyle = (position) => {
    const base = { position:'absolute', bottom:12, maxWidth:'78%', fontWeight:700, letterSpacing:'.01em', lineHeight:1.15, textAlign:'center', pointerEvents:'none' };
    if (position === 'bottom-center') return { ...base, left:'50%', transform:'translateX(-50%)' };
    if (position === 'bottom-right') return { ...base, right:12, textAlign:'right' };
    return { ...base, left:12, textAlign:'left' };
  };

  const logoPositionStyle = (position) => {
    const base = { position:'absolute', width:'var(--logo-width)', maxWidth:'42%', maxHeight:'30%', objectFit:'contain', padding:4, pointerEvents:'none' };
    if (position === 'top-left') return { ...base, top:10, left:10 };
    if (position === 'bottom-left') return { ...base, bottom:10, left:10 };
    if (position === 'bottom-right') return { ...base, bottom:10, right:10 };
    return { ...base, top:10, right:10 };
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !selectedResult) return;
    try {
      const dataUrl = await readFileAsDataURL(file);
      patchSelectedResult({ logoDataUrl:dataUrl, logoName:file.name, logoScale: selectedResult.logoScale || 0.18, logoOpacity: selectedResult.logoOpacity ?? 1, logoPosition: selectedResult.logoPosition || 'top-right' });
    } catch (err) {
      console.warn('Logo could not be read', err);
    } finally {
      e.target.value = '';
    }
  };

  const clearLogo = () => patchSelectedResult({ logoDataUrl:'', logoName:'', logoScale:0.18, logoOpacity:1, logoPosition:'top-right' });

  const renderFinishedShot = async (result, format = 'png') => {
    if (!result?.src || result.status !== 'ok') return null;
    const image = await new Promise((resolve, reject) => {
      const loaded = new Image();
      loaded.onload = () => resolve(loaded);
      loaded.onerror = reject;
      loaded.src = result.src;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    if (result.logoDataUrl) {
      const logo = await new Promise((resolve, reject) => {
        const loaded = new Image();
        loaded.onload = () => resolve(loaded);
        loaded.onerror = reject;
        loaded.src = result.logoDataUrl;
      });
      const requested = Math.min(0.42, Math.max(0.08, Number(result.logoScale) || 0.18));
      const maxW = canvas.width * requested;
      const maxH = canvas.height * 0.3;
      const logoRatio = (logo.naturalWidth || logo.width) / (logo.naturalHeight || logo.height || 1);
      const logoW = Math.min(maxW, maxH * logoRatio);
      const logoH = logoW / logoRatio;
      const edge = Math.round(28 * Math.max(1, canvas.width / 900));
      const position = result.logoPosition || 'top-right';
      const x = position === 'top-left' || position === 'bottom-left' ? edge : canvas.width - logoW - edge;
      const y = position === 'bottom-left' || position === 'bottom-right' ? canvas.height - logoH - edge : edge;
      ctx.save();
      ctx.globalAlpha = Math.min(1, Math.max(0.2, Number(result.logoOpacity) || 1));
      ctx.drawImage(logo, x, y, logoW, logoH);
      ctx.restore();
    }

    const text = String(result.labelText || '').trim();
    if (text) {
      const scale = Math.max(1, canvas.width / 900);
      const fontSize = result.labelSize === 'small' ? 24 : result.labelSize === 'large' ? 46 : 34;
      const padding = Math.round(16 * scale);
      const font = `700 ${Math.round(fontSize * scale)}px Georgia, serif`;
      ctx.font = font;
      const metrics = ctx.measureText(text);
      const boxW = metrics.width + padding * 2;
      const boxH = Math.round(fontSize * scale * 1.35);
      const margin = Math.round(28 * scale);
      const position = result.labelPosition || 'bottom-left';
      const x = position === 'bottom-center' ? (canvas.width - boxW) / 2 : position === 'bottom-right' ? canvas.width - boxW - margin : margin;
      const y = canvas.height - margin - boxH;
      if (result.labelBackground !== false) {
        ctx.fillStyle = result.labelBackgroundColor || 'rgba(255,255,255,.86)';
        ctx.beginPath();
        ctx.roundRect(x, y, boxW, boxH, Math.round(12 * scale));
        ctx.fill();
      }
      ctx.fillStyle = result.labelColor || '#4D3245';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(text, x + boxW / 2, y + boxH / 2 + Math.round(2 * scale));
    }

    const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
    return canvas.toDataURL(mime, format === 'png' ? undefined : 0.92);
  };

  const shotFilename = (result, item = activeItem, format = exportFormat) => {
    const bd = BACKDROPS.find(b => b.id === result?.backdropId);
    const ratioTag = (result?.ratio || item?.ratio || '1:1').replace(':','x');
    const stem = (item?.name || 'wonder-pads-studio-shot').replace(/\.[^.]+$/, '');
    return `${stem}-${bd?.id || 'shot'}-${ratioTag}.${format}`;
  };

  const downloadFinishedShot = async (result, item = activeItem, format = exportFormat) => {
    if (!item || !result || result.status !== 'ok') return;
    const output = await renderFinishedShot(result, format);
    if (!output) return;
    downloadOne(output, shotFilename(result, item, format));
  };

  const saveFinishedShotToPhone = async () => {
    if (!activeItem || !selectedResult || selectedResult.status !== 'ok') return;
    const output = await renderFinishedShot(selectedResult, exportFormat);
    if (!output) return;
    const status = await saveDataUrlToPhone(output, shotFilename(selectedResult, activeItem, exportFormat));
    setSaveNotice(status === 'shared' ? 'Share sheet opened' : status === 'downloaded' ? 'Saved to downloads' : status === 'opened' ? 'Image opened — long-press to save' : 'Could not save automatically');
  };

  const downloadAllForGallery = async () => {
    const ready = items.flatMap(item => (item.results || []).filter(result => result.status === 'ok').map(result => ({ item, result })));
    if (!ready.length) return;
    for (const { item, result } of ready) {
      await downloadFinishedShot(result, item, exportFormat);
      await new Promise(res => setTimeout(res, 180));
    }
  };

  const selectedSavedKey = activeItem && selectedResult ? `${activeItem.id}:${selectedResultIdx}` : '';
  const selectedSavedShot = savedShots.find(shot => shot.key === selectedSavedKey) || null;

  const saveSelectedResult = async () => {
    if (!activeItem || !selectedResult || selectedResult.status !== 'ok' || savingSelectedResult) return;
    setSavingSelectedResult(true);
    setSaveNotice('');
    try {
      const output = await renderFinishedShot(selectedResult, 'png');
      if (!output) return;
      const bd = BACKDROPS.find(b => b.id === selectedResult.backdropId);
      const ratio = selectedResult.ratio || activeItem.ratio || '1:1';
      const ratioTag = ratio.replace(':','x');
      const stem = activeItem.name.replace(/\.[^.]+$/, '');
      const key = `${activeItem.id}:${selectedResultIdx}`;
      const savedShot = {
        key,
        itemId: activeItem.id,
        itemName: activeItem.name,
        resultIndex: selectedResultIdx,
        backdropId: selectedResult.backdropId,
        backdropName: bd?.name || 'Studio shot',
        ratio,
        fileName: `${stem}-${bd?.id || 'shot'}-${ratioTag}.png`,
        src: output,
        savedAt: new Date().toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }),
      };
      const wasSaved = !!savedShots.find(shot => shot.key === key);
      setSavedShots(prev => [...prev.filter(shot => shot.key !== key), savedShot]);
      setSaveNotice(wasSaved ? 'Saved gallery updated' : 'Saved to gallery');
      setTimeout(() => setSaveNotice(''), 2600);
    } catch (e) {
      console.warn('Could not save studio shot', e);
      setSaveNotice('Could not save this shot');
      setTimeout(() => setSaveNotice(''), 2600);
    } finally {
      setSavingSelectedResult(false);
    }
  };

  const downloadSavedShot = (shot) => {
    if (!shot?.src) return;
    downloadOne(shot.src, shot.fileName || 'wonder-pads-studio-shot.png');
  };

  const reopenSavedShot = (shot) => {
    if (!shot || !items.some(item => item.id === shot.itemId)) return;
    setActiveId(shot.itemId);
    setSelectedResultIdx(shot.resultIndex || 0);
    setShowStudioModal(true);
  };

  const clearSavedGallery = () => setSavedShots([]);

  const getCollageCandidates = useCallback(() => {
    const workingShots = items.flatMap(item => (item.results || [])
      .filter(result => result.status === 'ok')
      .map((result, resultIndex) => ({
        key:`working:${item.id}:${resultIndex}`,
        source:result.src,
        result,
        name:item.name,
        detail:BACKDROPS.find(b => b.id === result.backdropId)?.name || 'Studio shot',
        kind:'Generated',
      })));
    const finalizedShots = savedShots.map(shot => ({
      key:`saved:${shot.key}`,
      source:shot.src,
      name:shot.itemName,
      detail:shot.backdropName,
      kind:'Saved',
    }));
    return [...finalizedShots, ...workingShots];
  }, [items, savedShots]);

  const openCollageModal = () => {
    const candidates = getCollageCandidates();
    setCollageSources(candidates.slice(0, collageCapacity));
    setCollageSrc('');
    setCollageNotice('');
    setShowCollageModal(true);
  };

  const toggleCollageSource = (candidate) => {
    setCollageSources(prev => prev.some(source => source.key === candidate.key)
      ? prev.filter(source => source.key !== candidate.key)
      : prev.length >= collageCapacity ? prev : [...prev, candidate]);
    setCollageSrc('');
  };

  const buildCollage = async () => {
    if (collageSources.length < 2 || collageBusy) return;
    setCollageBusy(true);
    setCollageNotice('');
    try {
      const loaded = await Promise.all(collageSources.map(async source => {
        const finalizedSource = source.kind === 'Generated' && source.result ? (await renderFinishedShot(source.result, 'png') || source.source) : source.source;
        return new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve({ ...source, image });
          image.onerror = reject;
          image.src = finalizedSource;
        });
      }));
      const canvas = document.createElement('canvas');
      const width = 1200;
      const [ratioW, ratioH] = String(collageAspectRatio || '1:1').split(':').map(Number);
      const height = Math.round(width * ((ratioH || 1) / (ratioW || 1)));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const backgrounds = {
        blush: ['#FFF7FB','#F3D4EB'],
        cream: ['#FFFDF8','#F5EBDD'],
        white: ['#FFFFFF','#FFFFFF'],
      };
      const [topColor, bottomColor] = backgrounds[collageBackdrop] || backgrounds.blush;
      const background = ctx.createLinearGradient(0, 0, width, height);
      background.addColorStop(0, topColor);
      background.addColorStop(1, bottomColor);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);

      const gap = Math.max(8, Math.min(48, Number(collageGap) || 20));
      const title = String(collageTitle || '').trim();
      const titleOffset = title ? 118 : 42;
      if (title) {
        ctx.fillStyle = '#4A2340';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '600 42px Georgia, serif';
        ctx.fillText(title, width / 2, 48);
        ctx.fillStyle = '#8C6E83';
        ctx.font = '500 16px Arial, sans-serif';
        ctx.fillText('Studio presentation · Wonder Pads Reusables', width / 2, 88);
      }

      const drawRoundedImage = (image, x, y, boxW, boxH, radius = 22) => {
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,.76)';
        ctx.beginPath();
        ctx.roundRect(x, y, boxW, boxH, radius);
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(x, y, boxW, boxH, radius);
        ctx.clip();
        const imageRatio = (image.naturalWidth || image.width) / (image.naturalHeight || image.height || 1);
        const boxRatio = boxW / boxH;
        let drawW = boxW;
        let drawH = boxH;
        if (imageRatio > boxRatio) drawH = boxW / imageRatio;
        else drawW = boxH * imageRatio;
        ctx.drawImage(image, x + (boxW - drawW) / 2, y + (boxH - drawH) / 2, drawW, drawH);
        ctx.restore();
      };

      const { cols, rows } = collageSpec;
      const tileW = (width - gap * (cols + 1)) / cols;
      const tileH = (height - titleOffset - gap * (rows + 1)) / rows;
      loaded.forEach((entry, index) => drawRoundedImage(entry.image, gap + (index % cols) * (tileW + gap), titleOffset + gap + Math.floor(index / cols) * (tileH + gap), tileW, tileH, 24));
      setCollageSrc(canvas.toDataURL('image/png'));
      setCollageNotice(`${loaded.length} shots arranged`);
    } catch (error) {
      console.warn('Could not build collage', error);
      setCollageNotice('Could not build this collage');
    } finally {
      setCollageBusy(false);
    }
  };

  const downloadCollage = () => {
    if (!collageSrc) return;
    downloadOne(collageSrc, `wonder-pads-collage-${collageLayout}-${String(collageAspectRatio).replace(':','x')}.png`);
  };

  const collageCandidates = getCollageCandidates();

  // Stats for the gallery header

  const stats = useMemo(() => {
    const total = items.length;
    const cutoutsDone = items.filter(it => !!it.cutout).length;
    const processing = items.filter(it => ['queued','processing'].includes(it.bgProgress?.key)).length;
    const notStarted = items.filter(it => !it.cutout && !it.bgError && !['queued','processing'].includes(it.bgProgress?.key)).length;
    const errored = items.filter(it => !!it.bgError).length;
    const withResults = items.filter(it => it.results && it.results.some(r=>r.status==='ok')).length;
    return { total, cutoutsDone, processing, notStarted, errored, withResults };
  }, [items]);
  useEffect(() => {
    try { localStorage.setItem('wp_production_summary', JSON.stringify(stats)); } catch (_) {}
    window.dispatchEvent(new CustomEvent('wp-overview-updated'));
  }, [stats]);

  return (
      <div className="page">
      {showEditor && activeItem?.src && (
        <CutoutEditor
          original={activeItem.src}
          cutout={activeItem.cutout || activeItem.manualSrc || activeItem.src}
          onSave={(newSrc)=>{
            patchItem(activeItem.id, activeItem.cutout ? { cutout: newSrc, results: null } : { manualSrc: newSrc });
            setShowEditor(false);
          }}
          onClose={()=>setShowEditor(false)}
        />
      )}

      <div className="page-head">
        <div>
          <div className="row" style={{gap:10, marginBottom:8}}>
            <span className="pill pill-sage"><span className="pill-dot"/> Production · Studio</span>
            <span className="pill pill-blush">Bulk upload · in-browser</span>
          </div>
          <div className="page-title">Studio-ready product shots<span style={{color:'var(--rose)', fontStyle:'italic'}}>.</span></div>
          <div className="page-sub">Drop up to 50 product photos at once. Background removal starts automatically after upload. When each cutout is ready, use <b>Edit cutout</b> for cleanup or <b>Refine</b> to prepare the studio presentation.</div>
        </div>
        <div className="row studio-production-preset-tools">
          <label className="studio-production-preset-picker"><span>Studio style</span><select className="select" value={selectedPresetId} onChange={e=>applyStudioPreset(e.target.value)} aria-label="Choose Studio Preset">{studioPresets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <button className="btn btn-ghost" onClick={()=>onGoto && onGoto('builder')}><Icon name="settings" className="ico-sm"/> Manage presets</button>
        </div>
      </div>


      {/* ==== GALLERY (PhotoRoom-style) ==== */}
      <div className="production-gallery-shell" style={{marginBottom:24}}>
        <div className="row between production-gallery-head" style={{marginBottom:14}}>
          <div className="row" style={{gap:10}}>
            <div className="serif" style={{fontSize:22}}>Gallery</div>
            {items.length > 0 && (
              <>
                <span className="pill pill-linen">{stats.total}</span>
                {stats.processing > 0 && <span className="pill pill-blush"><span className="spinner" style={{width:10, height:10, borderWidth:1.5, marginRight:4}}/> {stats.processing} removing</span>}
                {stats.notStarted > 0 && <span className="pill pill-linen">{stats.notStarted} awaiting BG Remove</span>}
                {stats.cutoutsDone > 0 && <span className="pill pill-sage"><Icon name="check" className="ico-sm"/> {stats.cutoutsDone} ready</span>}
                {stats.errored > 0 && <span className="pill pill-draft">{stats.errored} failed</span>}
              </>
            )}
          </div>
          <div className="row production-gallery-actions" style={{gap:8}}>
            {items.length > 0 && (
              <>
                {selection.size > 0 ? (
                  <>
                    <span style={{fontSize:12.5, color:'var(--muted)', marginRight:4}}>{selection.size} selected</span>
                    <button className="btn btn-ghost" style={{padding:'7px 12px', fontSize:12}} onClick={selectNone}>Clear</button>
                    <button className="btn btn-ghost" style={{padding:'7px 12px', fontSize:12, color:'#B84A5F'}} onClick={bulkRemoveSelected}>
                      <Icon name="trash" className="ico-sm"/> Remove
                    </button>
                    <button className="btn btn-primary" style={{padding:'7px 12px', fontSize:12}} onClick={runGenerateBatch}>
                      <Icon name="sparkles" className="ico-sm"/> Generate for {selection.size}
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-ghost" style={{padding:'7px 12px', fontSize:12}} onClick={selectAll}>Select all</button>
                    <button className="btn btn-ghost" style={{padding:'7px 12px', fontSize:12}} onClick={()=> fileInputRef.current && fileInputRef.current.click()}>
                      <Icon name="plus" className="ico-sm"/> Add more
                    </button>
                  </>
                )}
              </>
            )}
            {items.length > 0 && (
              <button type="button" className="btn btn-blush collage-launch-btn" disabled={collageCandidates.length < 2} onClick={openCollageModal} title={collageCandidates.length < 2 ? 'Generate at least two studio shots first' : 'Create a collage from generated or saved shots'}>
                <Icon name="grid" className="ico-sm"/> Collage{collageCandidates.length > 0 ? ` · ${Math.min(collageCandidates.length, 4)}` : ''}
              </button>
            )}
            {items.length > 0 && (
              <div className="gallery-export-controls">
                <span className="gallery-export-label">Export</span>
                {['png','jpeg','webp'].map((format) => (
                  <button key={format} type="button" className={'chip gallery-export-chip'+(exportFormat === format ? ' on' : '')} onClick={()=>setExportFormat(format)}>
                    {format.toUpperCase()}
                  </button>
                ))}
                <button type="button" className="btn btn-primary gallery-export-btn" disabled={!stats.withResults} onClick={downloadAllForGallery}>
                  <Icon name="download" className="ico-sm"/> {stats.withResults ? 'Export gallery' : 'Generate shots first'}
                </button>
              </div>
            )}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          style={{display:'none'}}
          onChange={(e)=> ingestFiles(e.target.files)}
        />

        {items.length === 0 && (
          <div
            className="upload-zone"
            style={dragOver ? {background:'linear-gradient(160deg,#FDF5FA,#F7DFEE)', borderColor:'var(--blush-deep)', transform:'scale(1.005)'} : {}}
            onClick={()=> fileInputRef.current && fileInputRef.current.click()}
            onDragOver={(e)=>{ e.preventDefault(); setDragOver(true); }}
            onDragLeave={()=> setDragOver(false)}
            onDrop={onDrop}
          >
            <div style={{width:56, height:56, borderRadius:14, background:'#fff', margin:'0 auto 12px', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--rose)', boxShadow:'0 2px 10px rgba(196,122,184,.2)'}}>
              <Icon name="upload" className="ico-lg"/>
            </div>
            <div className="serif" style={{fontSize:20, color:'var(--ink)'}}>Drop product photos here</div>
            <div style={{fontSize:12.5, color:'var(--muted)', marginTop:6}}>PNG, JPG or WEBP · up to 50 files · any background works · original resolution preserved</div>
            <div className="row" style={{marginTop:14, justifyContent:'center', gap:8}}>
              <button className="btn btn-blush" onClick={(e)=>{ e.stopPropagation(); fileInputRef.current && fileInputRef.current.click(); }}>
                <Icon name="photo" className="ico-sm"/> Browse files
              </button>
              <button className="btn btn-ghost" onClick={(e)=>{ e.stopPropagation(); useSample(); }}>
                <Icon name="sparkle2" className="ico-sm"/> Try a sample
              </button>
            </div>
          </div>
        )}

        {items.length > 0 && (
          <div
            onDragOver={(e)=>{ e.preventDefault(); setDragOver(true); }}
            onDragLeave={()=> setDragOver(false)}
            onDrop={onDrop}
            style={{border: dragOver ? '2px dashed var(--blush-deep)' : '2px dashed transparent', borderRadius:14, padding: dragOver ? 8 : 0, transition:'.15s'}}
          >
            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))', gap:12}}>
              {items.map(it => {
                const isActive = it.id === activeId;
                const isSelected = selection.has(it.id);
                const done = !!it.cutout;
                const processing = ['queued','processing'].includes(it.bgProgress?.key);
                const hasResults = it.results && it.results.some(r=>r.status==='ok');
                return (
                  <div key={it.id}
                       onClick={()=>{ setActiveId(it.id); if (done) { setSelectedResultIdx(0); setShowStudioModal(true); } }}
                       style={{
                         position:'relative',
                         borderRadius:14,
                         overflow:'hidden',
                         background:'#fff',
                         border: isActive ? '2px solid var(--blush-deep)' : (isSelected ? '2px solid var(--sage-deep)' : '1px solid var(--line)'),
                         cursor:'pointer',
                         transition:'.15s',
                         boxShadow: isActive ? '0 8px 24px rgba(196,122,184,.2)' : 'var(--shadow-sm)',
                       }}>
                    {/* Thumbnail — original with a checker for cutout preview overlay */}
                    <div style={{position:'relative', aspectRatio:'1/1', background:'conic-gradient(#F1EDE8 25%, #fff 0 50%, #F1EDE8 0 75%, #fff 0) 0 0/16px 16px'}}>
                      <img src={it.cutout || it.manualSrc || it.src} alt={it.name}
                        style={{width:'100%', height:'100%', objectFit:'contain'}}/>

                      {/* Status ribbon */}
                      <div style={{position:'absolute', top:8, left:8, right:8, display:'flex', justifyContent:'space-between', gap:6, pointerEvents:'none'}}>
                        <div style={{pointerEvents:'auto'}}>
                          {done && !hasResults && <span className="pill pill-sage"><Icon name="check" className="ico-sm"/> Cutout</span>}
                          {hasResults && <span className="pill pill-live"><Icon name="check" className="ico-sm"/> Generated</span>}
                          {!done && !it.bgError && <span className="pill pill-blush"><span className="spinner" style={{width:10, height:10, borderWidth:1.5, marginRight:4}}/> {it.bgProgress?.percent || 0}%</span>}
                          {it.bgError && <span className="pill pill-draft" title={it.bgError}>Failed</span>}
                        </div>
                        <div style={{display:'flex', gap:4}}>
                          <button
                            onClick={(e)=>{ e.stopPropagation(); toggleSelection(it.id); }}
                            title={isSelected ? 'Unselect' : 'Select'}
                            style={{
                              width:24, height:24, borderRadius:'50%',
                              background: isSelected ? 'var(--sage-deep)' : 'rgba(255,255,255,.9)',
                              color: isSelected ? '#fff' : 'var(--ink-soft)',
                              border: isSelected ? 'none' : '1px solid rgba(0,0,0,.08)',
                              display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer',
                              boxShadow:'0 1px 3px rgba(0,0,0,.1)'
                            }}>
                            {isSelected ? <Icon name="check" className="ico-sm"/> : <span style={{width:10, height:10, borderRadius:'50%', border:'1.5px solid currentColor'}}/>}
                          </button>
                          <button
                            onClick={(e)=>{ e.stopPropagation(); removeItem(it.id); }}
                            title="Remove"
                            style={{width:24, height:24, borderRadius:'50%', background:'rgba(255,255,255,.9)', color:'#B84A5F', border:'1px solid rgba(0,0,0,.08)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:'0 1px 3px rgba(0,0,0,.1)'}}>
                            <Icon name="x" className="ico-sm"/>
                          </button>
                        </div>
                      </div>

                      {/* Progress bar overlay while processing */}
                      {!done && !it.bgError && (
                        <div style={{position:'absolute', bottom:0, left:0, right:0, height:3, background:'rgba(0,0,0,.05)'}}>
                          <div style={{height:'100%', width:(it.bgProgress?.percent||0)+'%', background:'linear-gradient(90deg, var(--blush-deep), var(--rose))', transition:'width .3s'}}/>
                        </div>
                      )}

                      {/* Failure retry */}
                      {it.bgError && (
                        <div style={{position:'absolute', bottom:8, left:8, right:8}}>
                          <button className="btn btn-blush" style={{width:'100%', justifyContent:'center', padding:'5px 8px', fontSize:11}}
                            onClick={(e)=>{ e.stopPropagation(); retryBgRemoval(it.id); }}>
                            <Icon name="refresh" className="ico-sm"/> Retry
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Meta row */}
                    <div style={{padding:'8px 10px 10px'}}>
                      <div style={{fontSize:12, fontWeight:600, color:'var(--ink)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{it.name}</div>
                      <div style={{fontSize:10.5, color:'var(--muted)', marginTop:2, display:'flex', justifyContent:'space-between'}}>
                        <span>{it.w}×{it.h}</span>
                        <span>{it.ratio}</span>
                      </div>
                      <div className="gallery-actions" onClick={(e)=>e.stopPropagation()}>
                        <button className="btn btn-ghost gallery-action-btn" disabled={!done} title={done ? 'Edit transparent cutout' : 'Available when BG Remove finishes'} onClick={()=>{ if (!done) return; setActiveId(it.id); setShowStudioModal(false); setShowEditor(true); }}>
                          <Icon name="edit" className="ico-sm"/> Edit cutout
                        </button>
                        <button className="btn btn-blush gallery-action-btn" disabled={!done} title={done ? 'Open studio refinement' : 'Available when BG Remove finishes'} onClick={()=>{ if (!done) return; setActiveId(it.id); setSelectedResultIdx(0); setShowStudioModal(true); }}>
                          <Icon name="sparkles" className="ico-sm"/> Refine
                        </button>
                        <button className="btn btn-ghost gallery-action-btn" disabled={!done} title={done ? 'Create an editable vector silhouette' : 'Available when BG Remove finishes'} onClick={()=>{ if (!done) return; setActiveId(it.id); setShowSilhouette(false); onGoto && onGoto('silhouette', null, null, it); }}>
                          <Icon name="template" className="ico-sm"/> Silhouette
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* + tile at end */}
              <button
                onClick={()=> fileInputRef.current && fileInputRef.current.click()}
                style={{
                  aspectRatio:'1/1',
                  borderRadius:14,
                  border:'1.5px dashed rgba(196,122,184,.35)',
                  background:'linear-gradient(160deg, #FEFAFC 0%, #FBEEF6 100%)',
                  display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                  gap:8, color:'var(--rose)', cursor:'pointer',
                  transition:'.15s',
                }}>
                <div style={{width:40, height:40, borderRadius:12, background:'#fff', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 2px 8px rgba(196,122,184,.15)'}}>
                  <Icon name="plus" className="ico-lg"/>
                </div>
                <div style={{fontSize:12, fontWeight:600, color:'var(--ink-soft)'}}>Add more</div>
              </button>
            </div>
          </div>
        )}
      </div>

      {savedShots.length > 0 && (
        <div className="card card-pad saved-gallery-card" aria-label="Saved gallery">
          <div className="row between saved-gallery-head">
            <div>
              <div className="serif" style={{fontSize:22}}>Saved gallery</div>
              <div className="saved-gallery-note">Finalized studio shots saved from Refine. These are ready to download or revisit.</div>
            </div>
            <div className="row" style={{gap:8}}>
              <span className="pill pill-sage"><Icon name="check" className="ico-sm"/> {savedShots.length} saved</span>
              <button type="button" className="btn btn-ghost" style={{padding:'7px 10px', fontSize:11}} onClick={clearSavedGallery}>Clear all</button>
            </div>
          </div>
          <div className="saved-gallery-grid">
            {savedShots.map(shot => (
              <div className="saved-shot-card" key={shot.key}>
                <div className="saved-shot-preview">
                  <img src={shot.src} alt={`${shot.itemName} · ${shot.backdropName}`} />
                  <span className="saved-shot-badge"><Icon name="check" className="ico-sm"/> Saved</span>
                </div>
                <div className="saved-shot-meta">
                  <div className="saved-shot-name" title={shot.itemName}>{shot.itemName}</div>
                  <div className="saved-shot-details">{shot.backdropName} · {shot.ratio} · {shot.savedAt}</div>
                  <div className="saved-shot-actions">
                    <button type="button" className="btn btn-ghost" onClick={()=>reopenSavedShot(shot)}><Icon name="edit" className="ico-sm"/> Open refine</button>
                    <button type="button" className="btn btn-blush" onClick={()=>downloadSavedShot(shot)}><Icon name="download" className="ico-sm"/> Download</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCollageModal && (
        <div className="collage-modal-overlay" onClick={(e)=>{ if (e.target === e.currentTarget) setShowCollageModal(false); }}>
          <div className="collage-modal" role="dialog" aria-modal="true" aria-label="Create collage">
            <div className="collage-modal-head">
              <div>
                <div className="eyebrow">Gallery composition</div>
                <div className="serif collage-modal-title">Create a collage</div>
                <div className="collage-modal-sub">Arrange generated or saved studio shots into one blush-pink presentation image.</div>
              </div>
              <div className="row" style={{gap:8}}>
                <span className="pill pill-linen">{collageSources.length} of {collageCapacity} selected</span>
                <button type="button" className="btn btn-ghost" onClick={()=>setShowCollageModal(false)}><Icon name="x" className="ico-sm"/> Close</button>
              </div>
            </div>
            <div className="collage-modal-body">
              <div className="collage-preview-panel">
                <div className="collage-preview-frame" style={{aspectRatio:String(collageAspectRatio || '1:1').replace(':','/')}}>
                  {collageSrc ? <img src={collageSrc} alt="Collage preview"/> : <div className="collage-preview-empty"><Icon name="grid" className="ico-lg"/><div className="serif">Your collage preview will appear here</div><div>Select at least two shots, then choose Build collage.</div></div>}
                  {collageBusy && <div className="collage-preview-loading"><div className="spinner"/><span>Building collage…</span></div>}
                </div>
                <div className="collage-preview-caption">Canvas is composed in your browser. The original studio shots remain unchanged.</div>
              </div>
              <div className="collage-control-rail">
                <div className="collage-control-heading">
                  <div className="serif" style={{fontSize:20}}>Collage settings</div>
                  {collageNotice && <span className="save-notice" role="status">{collageNotice}</span>}
                </div>
                <div className="collage-control-note">Choose up to {collageCapacity} images from the available generated and Saved gallery shots.</div>

                <div className="refine-section-label">Images</div>
                <div className="collage-source-list">
                  {collageCandidates.length === 0 && <div className="collage-source-empty">Generate or save studio shots first.</div>}
                  {collageCandidates.map(candidate => {
                    const selected = collageSources.some(source => source.key === candidate.key);
                    return <button type="button" key={candidate.key} className={'collage-source'+(selected ? ' selected' : '')} onClick={()=>toggleCollageSource(candidate)} aria-pressed={selected}>
                      <span className="collage-source-thumb"><img src={candidate.source} alt=""/></span>
                      <span className="collage-source-copy"><strong>{candidate.name}</strong><small>{candidate.kind} · {candidate.detail}</small></span>
                      <span className="collage-source-check">{selected ? <Icon name="check" className="ico-sm"/> : <span/>}</span>
                    </button>;
                  })}
                </div>

                <div className="refine-section-label">Layout</div>
                <div className="chips collage-choice-chips">
                  {Object.entries(COLLAGE_LAYOUTS).map(([value,spec]) => <button type="button" key={value} className={'chip'+(collageLayout===value?' on':'')} onClick={()=>{setCollageLayout(value); setCollageSources(prev=>prev.slice(0, COLLAGE_LAYOUTS[value].cols * COLLAGE_LAYOUTS[value].rows)); setCollageSrc('');}}>{spec.label}</button>)}
                </div>

                <div className="refine-section-label">Aspect ratio</div>
                <div className="chips collage-choice-chips">
                  {OUTPUT_RATIOS.map(r => <button type="button" key={r.id} className={'chip'+(collageAspectRatio===r.id?' on':'')} onClick={()=>{setCollageAspectRatio(r.id); setCollageSrc('');}}>{r.id} · {r.label}</button>)}
                </div>

                <div className="refine-section-label">Backdrop</div>
                <div className="chips collage-choice-chips">
                  {[['blush','Blush pink'],['cream','Warm cream'],['white','Pure white']].map(([value,label]) => <button type="button" key={value} className={'chip backdrop-chip'+(collageBackdrop===value?' on':'')} onClick={()=>{setCollageBackdrop(value); setCollageSrc('');}}><span className="backdrop-dot" style={{background:value==='blush'?'#F3D4EB':value==='cream'?'#F5EBDD':'#fff'}}/>{label}</button>)}
                </div>

                <label className="field collage-title-field"><span className="field-lbl">Title <span className="hint">Optional</span></span><input value={collageTitle} onChange={(e)=>{setCollageTitle(e.target.value); setCollageSrc('');}} placeholder="Wonder Pads studio set"/></label>
                <label className="fit-zoom-row collage-gap-row"><span className="refine-mini-label">Spacing</span><input type="range" min="8" max="48" step="1" value={collageGap} onChange={(e)=>{setCollageGap(Number(e.target.value)); setCollageSrc('');}}/><span className="zoom-value">{collageGap}px</span></label>

                <div className="collage-modal-actions">
                  <button type="button" className="btn btn-primary" disabled={collageSources.length < 2 || collageBusy} onClick={buildCollage}><Icon name={collageBusy ? 'refresh' : 'sparkles'} className="ico-sm"/> {collageBusy ? 'Building…' : collageSrc ? 'Rebuild collage' : 'Build collage'}</button>
                  <button type="button" className="btn btn-blush" disabled={!collageSrc || collageBusy} onClick={downloadCollage}><Icon name="download" className="ico-sm"/> Download collage</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==== COMPACT STUDIO REFINEMENT MODAL ==== */}
      {activeItem && showStudioModal && (
        <div className="studio-modal-overlay" onClick={(e)=>{ if (e.target === e.currentTarget) setShowStudioModal(false); }}>
          <div className="studio-modal" role="dialog" aria-modal="true" aria-label="Refine each photo">
            <div className="studio-modal-head">
              <div>
                <div className="eyebrow">Studio refinement</div>
                <div className="serif studio-modal-title">Refine each photo</div>
                <div className="studio-modal-sub">{activeItem.name} · studio shots and presentation refinements in one place.</div>
              </div>
              <div className="studio-modal-head-actions">
                {saveNotice && <span className="save-notice" role="status">{saveNotice}</span>}
                <button className={selectedSavedShot ? 'btn btn-ghost' : 'btn btn-primary'} disabled={!activeItem.cutout || !selectedResult || selectedResult.status !== 'ok' || savingSelectedResult} onClick={saveSelectedResult}>
                  <Icon name={savingSelectedResult ? 'refresh' : selectedSavedShot ? 'check' : 'save'} className="ico-sm"/> <span className="compact-action-label">{savingSelectedResult ? 'Saving…' : selectedSavedShot ? 'Update saved' : 'Save changes'}</span>
                </button>
                <button className="btn btn-ghost save-phone-btn" disabled={!activeItem.cutout || !selectedResult || selectedResult.status !== 'ok'} onClick={saveFinishedShotToPhone}>
                  <Icon name="download" className="ico-sm"/> <span className="compact-action-label">Save to phone</span>
                </button>
                <label className="generation-count-control" title="Number of browser-composited studio outputs made for this photo"><span>Outputs</span><select value={generationCount} onChange={(e)=>setGenerationCount(Number(e.target.value))} aria-label="Number of studio outputs"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></label>
                <button className="btn btn-blush" disabled={!activeItem.cutout} onClick={runGenerateActive}>
                  <Icon name={activeItem.results ? 'refresh' : 'sparkles'} className="ico-sm"/> <span className="compact-action-label">{activeItem.results ? 'Re-run' : 'Generate'}</span>
                </button>
                <button className="btn btn-ghost" title="Close Refine" aria-label="Close Refine" onClick={()=>setShowStudioModal(false)}><Icon name="x" className="ico-sm"/> <span className="compact-action-label">Close</span></button>
              </div>
            </div>

            <div className="two-col">
              <div className="stack">
                <div className="refine-results-card">
                  <div className="gen-body">
                    {!activeItem.cutout && (
                      <div style={{padding:'18px 20px', textAlign:'center'}}>
                        <div className="original-refine-preview" style={{aspectRatio:(selectedResult?.ratio || activeItem.ratio || '1:1').replace(':',' / '), background:(BACKDROPS.find(b => b.id === selectedResult?.backdropId) || BACKDROPS[1])?.swatch || '#F1CFEA'}}>
                          <img src={activeItem.manualSrc || activeItem.src} alt={activeItem.name} style={{width:'100%', height:'100%', objectFit:'contain', padding:'8%'}}/>
                          {selectedResult?.logoDataUrl && <img src={selectedResult.logoDataUrl} alt="" aria-hidden="true" style={{...logoPositionStyle(selectedResult.logoPosition), '--logo-width':`${Math.round((Number(selectedResult.logoScale) || 0.18) * 100)}%`, opacity:Number(selectedResult.logoOpacity) || 1}}/>}
                          {String(selectedResult?.labelText || '').trim() && <div style={{...labelPositionStyle(selectedResult.labelPosition), background:selectedResult.labelBackground === false ? 'transparent' : (selectedResult.labelBackgroundColor || 'rgba(255,255,255,.86)'), color:selectedResult.labelColor || '#4D3245', fontSize:selectedResult.labelSize === 'small' ? 11 : selectedResult.labelSize === 'large' ? 17 : 14, padding:selectedResult.labelBackground === false ? '2px 0' : '6px 10px', borderRadius:10, boxShadow:selectedResult.labelBackground === false ? 'none' : '0 3px 12px rgba(77,50,69,.12)'}}>{selectedResult.labelText}</div>}
                          <span className="pill pill-linen original-preview-badge">Original photo</span>
                        </div>
                        <div className="serif" style={{fontSize:18, color:'var(--ink)', marginTop:14}}>Original photo mode</div>
                        <div style={{fontSize:12.5, color:'var(--muted)', marginTop:6}}>Refine the finished cutout into a compact studio presentation. Background removal runs automatically after upload.</div>
                        {activeItem.bgError && <div style={{fontSize:12, color:'#8A4635', marginTop:8}}>Background removal failed. Use Retry on the gallery card to try again.</div>}
                      </div>
                    )}

                    {activeItem.cutout && !activeItem.results && (
                      <div style={{padding:'26px 20px', textAlign:'center'}}>
                        <div className="serif" style={{fontSize:20, color:'var(--ink)'}}>Cutout ready</div>
                        <div style={{fontSize:12.5, color:'var(--muted)', marginTop:6}}>Generate studio shots, then select one to refine its presentation.</div>
                      </div>
                    )}

                    {activeItem.results && (
                      <>
                        <div style={{fontSize:11, color:'var(--muted)', marginBottom:8, display:'flex', alignItems:'center', gap:6}}>
                          <Icon name="check" className="ico-sm" style={{color:'var(--sage-deep)'}}/> Made in your browser · original {activeItem.w}×{activeItem.h}px preserved
                        </div>
                        <div className="results-grid">
                          {activeItem.results.map((r, i) => {
                            const bd = BACKDROPS.find(b => b.id === r.backdropId);
                            const isTransparent = bd?.spec?.type === 'transparent';
                            // Generated tiles own their ratio. Never fall back to the mutable
                            // photo-level ratio here, or one selected result can resize siblings.
                            const tileRatio = r.ratio || '1:1';
                            const [rw, rh] = tileRatio.split(':').map(Number);
                            return (
                              <div key={i} className={'result'+(selectedResultIdx===i?' selected':'')} onClick={()=> r.status==='ok' && setSelectedResultIdx(i)} style={{'--result-ratio':`${rw} / ${rh}`, aspectRatio:`${rw}/${rh}`, ...(isTransparent && r.status==='ok' ? {background:'conic-gradient(#f0f0f0 25%, #fff 0 50%, #f0f0f0 0 75%, #fff 0) 0 0/20px 20px'} : {})}}>
                                {r.status === 'pending' && <div className="generating" style={{position:'absolute', inset:0}}><div className="spinner"/><div>Compositing…</div></div>}
                                {r.status === 'error' && <div style={{position:'absolute', inset:0, background:'#FBEFEA', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:16, textAlign:'center'}}><div style={{fontWeight:700, color:'#8A4635', fontSize:12}}>Failed</div></div>}
                                {r.status === 'ok' && (
                                  <>
                                    <img src={r.src} alt={bd?.name || 'Shot'} style={{width:'100%', height:'100%', objectFit:'cover'}}/>
                                    {r.logoDataUrl && <img src={r.logoDataUrl} alt="" aria-hidden="true" style={{...logoPositionStyle(r.logoPosition), '--logo-width':`${Math.round((Number(r.logoScale) || 0.18) * 100)}%`, opacity:Number(r.logoOpacity) || 1}}/>}
                                    {String(r.labelText || '').trim() && <div style={{...labelPositionStyle(r.labelPosition), background:r.labelBackground === false ? 'transparent' : (r.labelBackgroundColor || 'rgba(255,255,255,.86)'), color:r.labelColor || '#4D3245', fontSize:r.labelSize === 'small' ? 11 : r.labelSize === 'large' ? 17 : 14, padding:r.labelBackground === false ? '2px 0' : '6px 10px', borderRadius:10, boxShadow:r.labelBackground === false ? 'none' : '0 3px 12px rgba(77,50,69,.12)'}}>{r.labelText}</div>}
                                  </>
                                )}
                                <div className="num">{bd?.name || '—'}</div>
                                <div style={{position:'absolute', top:10, right:10, background:'rgba(255,255,255,.94)', borderRadius:999, padding:'3px 9px', fontFamily:'var(--serif)', fontSize:12, color:'var(--ink)'}}>{tileRatio}</div>
                                {r.status === 'ok' && <div className="toolbar"><button className="btn btn-blush" onClick={(e)=>{ e.stopPropagation(); setSelectedResultIdx(i); }}><Icon name="edit" className="ico-sm"/> Finish</button></div>}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="refine-rail">
                {true ? (
                  <div className="refine-control-card">
                    <div className="refine-rail-heading">
                      <div>
                        <div className="eyebrow">{activeItem.results ? 'Selected studio shot' : 'Original photo setup'}</div>
                        <div className="serif" style={{fontSize:20}}>{activeItem.results ? `Refine shot 0${selectedResultIdx+1}` : 'Prepare this photo'}</div>
                      </div>
                      <div className="pill pill-linen">{selectedResult?.ratio || activeItem.ratio}</div>
                    </div>
                    <div className="refine-rail-note">{activeItem.results ? 'Adjust the presentation of this result. Changes update the preview and are included in the global export.' : 'Set the canvas, backdrop, fit, branding, and label now. These choices stay with the photo and will be used after BG Remove.'}</div>

                    <div className="refine-tool-ribbon" role="tablist" aria-label="Refine tools">
                      {[['canvas','Canvas'],['backdrop','Backdrop'],['fit','Fit'],['branding','Branding'],['label','Label']].map(([value,label]) => <button type="button" key={value} role="tab" aria-selected={refineTool===value} className={'refine-tool-tab'+(refineTool===value?' on':'')} onClick={()=>setRefineTool(current => current === value ? null : value)}>{label}</button>)}
                    </div>
                    <div className="refine-tool-hint">Choose a tool to focus its controls. Changes remain live in {activeItem.results ? 'the selected studio shot.' : 'this photo setup.'}</div>
                    {refineTool === 'canvas' && <div className="refine-tool-panel">
                    <div className="refine-section-label">Aspect ratio <span className="hint" style={{textTransform:'none', letterSpacing:0, marginLeft:6}}>selected shot only</span></div>
                    <div className="chips">
                      {OUTPUT_RATIOS.map(r => {
                        const active = (selectedResult?.ratio || activeItem.ratio) === r.id;
                        return <button key={r.id} onClick={()=>changeResultRatio(selectedResultIdx, r.id)} className={'chip'+(active?' on':'')}>{r.id} · {r.label}</button>;
                      })}
                    </div>

                    </div>}
                    {refineTool === 'backdrop' && <div className="refine-tool-panel">
                    <div className="refine-section-label">Backdrop</div>
                    <div className="chips refine-backdrop-chips">
                      {BACKDROPS.map(bd => {
                        const active = selectedResult?.backdropId === bd.id;
                        return <button key={bd.id} onClick={()=>swapBackdropInResult(selectedResultIdx, bd.id)} className={'chip backdrop-chip'+(active?' on':'')}><span className="backdrop-dot" style={{background:bd.swatch === 'checker' ? 'conic-gradient(#eee 25%, #fff 0 50%, #eee 0 75%, #fff 0) 0 0/8px 8px' : bd.swatch}}/>{bd.name}</button>;
                      })}
                    </div>

                    </div>}
                    {refineTool === 'fit' && <div className="refine-tool-panel">
                    <div className="fit-tool">
                      <div className="fit-tool-head">
                        <div>
                          <div className="serif" style={{fontSize:17}}>Fit pad to canvas</div>
                          <div className="fit-tool-note">{activeItem.results ? 'The cutout is fitted from its visible edges, not its empty source margin.' : 'Preview zoom is stored now and will apply when this photo is composited after BG Remove.'}</div>
                        </div>
                        <button type="button" className="btn btn-ghost" style={{padding:'6px 9px', fontSize:10.5}} onClick={fitSelectedResult}>Reset fit</button>
                      </div>
                      <label className="fit-zoom-row"><span className="refine-mini-label">Zoom</span><input type="range" min="0.65" max="1.45" step="0.01" value={Number(selectedResult?.zoom) || 1} onChange={(e)=>zoomSelectedResult(Number(e.target.value))}/><span className="zoom-value">{Math.round((Number(selectedResult?.zoom) || 1) * 100)}%</span></label>
                    </div>
                    </div>}
                    {refineTool === 'branding' && <div className="refine-tool-panel">
                    <div className="logo-tool">
                      <input ref={logoInputRef} type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" onChange={handleLogoUpload} style={{display:'none'}}/>
                      <div className="row between" style={{gap:8, alignItems:'center'}}>
                        <div><div className="serif" style={{fontSize:18}}>Logo</div><div style={{fontSize:11, color:'var(--muted)', marginTop:2}}>Applied to this shot and included in global export.</div></div>
                        {!selectedResult?.logoDataUrl ? <button type="button" className="btn btn-blush" style={{padding:'7px 10px', fontSize:11}} onClick={()=>logoInputRef.current?.click()}><Icon name="upload" className="ico-sm"/> Upload</button> : <button type="button" className="btn btn-ghost" style={{padding:'7px 10px', fontSize:11}} onClick={()=>logoInputRef.current?.click()}><Icon name="refresh" className="ico-sm"/> Replace</button>}
                      </div>
                      {selectedResult?.logoDataUrl && <div className="logo-controls">
                        <div className="logo-file-row"><div className="logo-file-preview"><img src={selectedResult.logoDataUrl} alt="Uploaded logo preview"/></div><div style={{minWidth:0, flex:1}}><div style={{fontSize:11.5, fontWeight:700, color:'var(--ink)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{selectedResult.logoName || 'Uploaded logo'}</div><div style={{fontSize:10.5, color:'var(--muted)', marginTop:2}}>Transparent image · live preview</div></div><button type="button" className="btn btn-ghost" style={{padding:'5px 8px', fontSize:10.5}} onClick={clearLogo}>Remove</button></div>
                        <div className="logo-control-grid"><label className="field" style={{margin:0}}><span className="field-lbl" style={{marginBottom:4}}>Position</span><select className="select" value={selectedResult.logoPosition || 'top-right'} onChange={(e)=>patchSelectedResult({logoPosition:e.target.value})}><option value="top-left">Top left</option><option value="top-right">Top right</option><option value="bottom-left">Bottom left</option><option value="bottom-right">Bottom right</option></select></label><label className="field" style={{margin:0}}><span className="field-lbl" style={{marginBottom:4}}><span>Size</span><span className="hint">{Math.round((Number(selectedResult.logoScale) || 0.18) * 100)}%</span></span><input type="range" min="0.08" max="0.42" step="0.01" value={selectedResult.logoScale || 0.18} onChange={(e)=>patchSelectedResult({logoScale:Number(e.target.value)})}/></label><label className="field" style={{margin:0}}><span className="field-lbl" style={{marginBottom:4}}><span>Opacity</span><span className="hint">{Math.round((Number(selectedResult.logoOpacity) || 1) * 100)}%</span></span><input type="range" min="0.2" max="1" step="0.05" value={selectedResult.logoOpacity ?? 1} onChange={(e)=>patchSelectedResult({logoOpacity:Number(e.target.value)})}/></label></div>
                      </div>}
                      </div>
                    </div>}
                    {refineTool === 'label' && <div className="refine-tool-panel">
                    <div className="label-editor-head">
<div><div className="serif" style={{fontSize:18}}>Label</div><div className="label-editor-note">{activeItem.results ? 'Shown on this shot and included in global export.' : 'Saved with this photo setup and applied to the studio output later.'}</div></div><span className="pill pill-blush">Live</span></div>
                    <div className="label-control-grid"><label className="refine-field">Label text<input value={selectedResult?.labelText || ''} onChange={(e)=>patchSelectedResult({labelText:e.target.value})} placeholder="e.g. Garden Bloom · Reusable Pad"/></label><label className="refine-field">Position<select value={selectedResult?.labelPosition || 'bottom-left'} onChange={(e)=>patchSelectedResult({labelPosition:e.target.value})}><option value="bottom-left">Bottom left</option><option value="bottom-center">Bottom center</option><option value="bottom-right">Bottom right</option></select></label></div>
                    <div className="label-style-row"><span className="refine-mini-label">Size</span>{[['small','Small'],['medium','Medium'],['large','Large']].map(([value,label])=><button key={value} type="button" className={'chip'+((selectedResult?.labelSize || 'medium')===value?' on':'')} onClick={()=>patchSelectedResult({labelSize:value})}>{label}</button>)}<label className="row" style={{gap:5, fontSize:11, color:'var(--ink-soft)', marginLeft:2, cursor:'pointer'}}><input type="checkbox" checked={selectedResult?.labelBackground !== false} onChange={(e)=>patchSelectedResult({labelBackground:e.target.checked})}/> Pale card</label></div>
                    <div className="label-color-row"><label className="row" style={{gap:5, fontSize:11, color:'var(--ink-soft)'}}>Text<input type="color" value={selectedResult?.labelColor || '#4D3245'} onChange={(e)=>patchSelectedResult({labelColor:e.target.value})} style={{width:28, height:26, padding:2, border:'1px solid var(--line)', borderRadius:7, background:'#fff', cursor:'pointer'}}/></label><label className="row" style={{gap:5, fontSize:11, color:'var(--ink-soft)'}}>Card<input type="color" value={selectedResult?.labelBackgroundColor || '#FFF1F8'} onChange={(e)=>patchSelectedResult({labelBackgroundColor:e.target.value})} style={{width:28, height:26, padding:2, border:'1px solid var(--line)', borderRadius:7, background:'#fff', cursor:'pointer'}}/></label><button type="button" className="btn btn-ghost" style={{marginLeft:'auto', padding:'6px 9px', fontSize:10.5}} onClick={()=>patchSelectedResult({labelText:'', labelPosition:'bottom-left', labelSize:'medium', labelBackground:true, labelColor:'#4D3245', labelBackgroundColor:'#FFF1F8'})}>Clear</button></div>
                    </div>}
                  </div>
                ) : (
                  <div className="card card-pad refine-empty-card"><div className="eyebrow">Presentation refinements</div><div className="serif" style={{fontSize:19}}>Generate studio shots first</div><div style={{fontSize:12, color:'var(--muted)', marginTop:6}}>The selected-shot controls will appear here after the Studio shots are ready.</div></div>
                )}
              </div>
            </div>
          </div>
        </div>
            )}
      {showSilhouette && window.SilhouetteStudio && <SilhouetteStudio item={activeItem} onClose={()=>setShowSilhouette(false)} />}
    </div>
  );
};
window.ProductionGenerator = ProductionGenerator;
