// Cutout Editor — Restore / Erase brushes, Invert view, Zoom + Pan, Undo/Redo.
// Props: { original, cutout, onSave(newCutoutDataURL), onClose() }
// - original: data URL of the untouched uploaded photo (used for Restore — samples original pixels)
// - cutout:   data URL of the current transparent PNG (RMBG output, or previously edited)

const CutoutEditor = ({ original, cutout, onSave, onClose }) => {
  const { useState, useEffect, useRef, useCallback } = React;

  const [tool, setTool] = useState('erase');            // 'restore' | 'erase' | 'pan'
  const [brushSize, setBrushSize] = useState(60);
  const [brushSoftness, setBrushSoftness] = useState(50); // 0..100, feather
  const [invert, setInvert] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [cursor, setCursor] = useState({ x: -999, y: -999, visible: false });
  const [showOriginal, setShowOriginal] = useState(false);   // hold-to-compare
  const [history, setHistory] = useState([]);          // stack of past cutout data URLs
  const [future, setFuture] = useState([]);            // redo stack
  const [saving, setSaving] = useState(false);

  const workCanvasRef = useRef(null);         // the editable canvas at full res
  const originalImgRef = useRef(null);        // loaded original HTMLImageElement
  const cutoutImgRef = useRef(null);          // loaded current cutout HTMLImageElement
  const viewCanvasRef = useRef(null);         // what the user sees (with checker or invert overlay)
  const stageRef = useRef(null);              // pan/pointer target

  const [imgDims, setImgDims] = useState({ w: 0, h: 0 });
  const [loaded, setLoaded] = useState(false);
  const isDrawing = useRef(false);
  const lastPt = useRef(null);
  const isPanning = useRef(false);
  const panStart = useRef(null);
  const activePointers = useRef(new Map());
  const pinchStart = useRef(null);
  const restoreStampCanvasRef = useRef(null);

  // Load images + init work canvas
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [orig, cut] = await Promise.all([loadImg(original), loadImg(cutout)]);
      if (cancelled) return;
      originalImgRef.current = orig;
      cutoutImgRef.current = cut;
      const w = orig.naturalWidth, h = orig.naturalHeight;
      setImgDims({ w, h });
      const wc = document.createElement('canvas');
      wc.width = w; wc.height = h;
      const wctx = wc.getContext('2d');
      wctx.drawImage(cut, 0, 0, w, h);
      workCanvasRef.current = wc;
      setLoaded(true);
      // Initial fit
      queueMicrotask(() => fitToView());
      renderView();
    })();
    return () => { cancelled = true; };
  }, [original, cutout]);

  // Redraw the visible canvas whenever state changes
  useEffect(() => { if (loaded) renderView(); }, [loaded, invert, showOriginal, zoom, pan, cursor]);

  function loadImg(src) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = src;
    });
  }

  function fitToView() {
    const stage = stageRef.current;
    if (!stage || !imgDims.w) return;
    const rect = stage.getBoundingClientRect();
    const s = Math.min(rect.width / imgDims.w, rect.height / imgDims.h) * 0.92;
    setZoom(s);
    setPan({ x: rect.width/2 - (imgDims.w * s)/2, y: rect.height/2 - (imgDims.h * s)/2 });
  }

  function renderView() {
    const view = viewCanvasRef.current;
    const stage = stageRef.current;
    if (!view || !stage) return;
    const rect = stage.getBoundingClientRect();
    view.width = rect.width;
    view.height = rect.height;
    const ctx = view.getContext('2d');
    ctx.clearRect(0, 0, view.width, view.height);

    // Background: checkerboard OR inverted flat color
    if (invert) {
      ctx.fillStyle = '#7C4A6E';
      ctx.fillRect(0, 0, view.width, view.height);
    } else {
      // checkerboard
      const s = 20;
      for (let y = 0; y < view.height; y += s) {
        for (let x = 0; x < view.width; x += s) {
          ctx.fillStyle = ((x + y) / s) % 2 === 0 ? '#F1EDE8' : '#FFFFFF';
          ctx.fillRect(x, y, s, s);
        }
      }
    }

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    if (showOriginal && originalImgRef.current) {
      ctx.drawImage(originalImgRef.current, 0, 0);
    } else if (workCanvasRef.current) {
      // For invert view, tint transparent regions differently by drawing a soft outline first
      ctx.drawImage(workCanvasRef.current, 0, 0);
    }
    ctx.restore();

    // Brush cursor
    if (cursor.visible && tool !== 'pan') {
      ctx.save();
      ctx.strokeStyle = tool === 'restore' ? 'rgba(80,160,110,.95)' : 'rgba(200,80,120,.95)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, (brushSize * zoom) / 2, 0, Math.PI * 2);
      ctx.stroke();
      // faint fill
      ctx.fillStyle = tool === 'restore' ? 'rgba(80,160,110,.10)' : 'rgba(200,80,120,.10)';
      ctx.fill();
      ctx.restore();
    }
  }

  // === Brush ops (operate on the full-res work canvas) ===
  function stampAt(imgX, imgY) {
    const wc = workCanvasRef.current;
    if (!wc) return;
    const ctx = wc.getContext('2d');
    const r = brushSize / 2;
    const feather = brushSoftness / 100;

    if (tool === 'erase') {
      // Erase = remove alpha in a soft circle
      // Approach: draw a radial-gradient mask into a temp, then composite as destination-out
      ctx.save();
      const grd = ctx.createRadialGradient(imgX, imgY, r * (1 - feather), imgX, imgY, r);
      grd.addColorStop(0, 'rgba(0,0,0,1)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(imgX, imgY, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (tool === 'restore') {
      // Restore = paint original pixels back into the alpha. Keep the temporary
      // canvas limited to the brush footprint: allocating a full photo-sized
      // canvas for every touch move can exhaust Safari memory and reload the page.
      const orig = originalImgRef.current;
      if (!orig) return;
      const pad = Math.ceil(r) + 2;
      const size = pad * 2;
      let tmp = restoreStampCanvasRef.current;
      if (!tmp) { tmp = document.createElement('canvas'); restoreStampCanvasRef.current = tmp; }
      if (tmp.width !== size || tmp.height !== size) { tmp.width = size; tmp.height = size; }
      const tctx = tmp.getContext('2d', { willReadFrequently:false });
      tctx.clearRect(0, 0, size, size);
      // Copy only the source pixels under this brush stamp.
      tctx.drawImage(orig, imgX - pad, imgY - pad, size, size, 0, 0, size, size);
      const grd = tctx.createRadialGradient(pad, pad, r * (1 - feather), pad, pad, r);
      grd.addColorStop(0, 'rgba(0,0,0,1)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      tctx.globalCompositeOperation = 'destination-in';
      tctx.fillStyle = grd;
      tctx.fillRect(0, 0, size, size);
      tctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(tmp, imgX - pad, imgY - pad);
    }
  }

  function drawStrokeBetween(a, b) {
    // Interpolate stamps along the line so a fast drag stays continuous
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(brushSize / 6, 2);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      stampAt(a.x + dx * t, a.y + dy * t);
    }
  }

  function toImageCoord(clientX, clientY) {
    const rect = stageRef.current.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      viewX: sx,
      viewY: sy,
      imgX: (sx - pan.x) / zoom,
      imgY: (sy - pan.y) / zoom,
    };
  }

  function onPointerDown(e) {
    if (!loaded) return;
    if (e.pointerType === 'touch') e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    if (e.pointerType === 'touch') {
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.current.size >= 2) {
        isDrawing.current = false;
        isPanning.current = false;
        lastPt.current = null;
        const pts = [...activePointers.current.values()].slice(-2);
        const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
        pinchStart.current = {
          distance: Math.max(1, Math.hypot(dx, dy)),
          zoom,
          pan: { ...pan },
          center: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
        };
        return;
      }
    }
    const p = toImageCoord(e.clientX, e.clientY);

    // Middle mouse / space held / pan tool = pan
    if (tool === 'pan' || e.button === 1 || e.shiftKey) {
      isPanning.current = true;
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      return;
    }

    // Snapshot for undo before starting a stroke
    setHistory(prev => [...prev.slice(-19), workCanvasRef.current.toDataURL('image/png')]);
    setFuture([]);
    isDrawing.current = true;
    lastPt.current = { x: p.imgX, y: p.imgY };
    stampAt(p.imgX, p.imgY);
    renderView();
  }

  function onPointerMove(e) {
    if (e.pointerType === 'touch') {
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.current.size >= 2) {
        const pts = [...activePointers.current.values()].slice(-2);
        const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
        const center = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        if (!pinchStart.current) {
          pinchStart.current = { distance: Math.max(1, Math.hypot(dx, dy)), zoom, pan: { ...pan }, center };
        }
        const start = pinchStart.current;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const newZoom = Math.max(0.1, Math.min(8, start.zoom * distance / start.distance));
        const rect = stageRef.current.getBoundingClientRect();
        const startCenter = { x: start.center.x - rect.left, y: start.center.y - rect.top };
        const nextCenter = { x: center.x - rect.left, y: center.y - rect.top };
        const imageAtStartCenter = { x: (startCenter.x - start.pan.x) / start.zoom, y: (startCenter.y - start.pan.y) / start.zoom };
        setZoom(newZoom);
        setPan({ x: nextCenter.x - imageAtStartCenter.x * newZoom, y: nextCenter.y - imageAtStartCenter.y * newZoom });
        setCursor({ x: -999, y: -999, visible: false });
        e.preventDefault();
        return;
      }
    }
    const p = toImageCoord(e.clientX, e.clientY);
    setCursor({ x: p.viewX, y: p.viewY, visible: true });

    if (isPanning.current && panStart.current) {
      setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
      return;
    }
    if (isDrawing.current) {
      drawStrokeBetween(lastPt.current, { x: p.imgX, y: p.imgY });
      lastPt.current = { x: p.imgX, y: p.imgY };
      renderView();
    }
  }

  function onPointerUp(e) {
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch(_){}
    if (e.pointerType === 'touch') {
      activePointers.current.delete(e.pointerId);
      if (activePointers.current.size < 2) pinchStart.current = null;
    }
    isDrawing.current = false;
    isPanning.current = false;
    lastPt.current = null;
    panStart.current = null;
  }

  function onPointerCancel(e) {
    if (e.pointerType === 'touch') activePointers.current.delete(e.pointerId);
    pinchStart.current = null;
    isDrawing.current = false;
    isPanning.current = false;
    lastPt.current = null;
    panStart.current = null;
  }

  function onPointerLeave() {
    setCursor({ x: -999, y: -999, visible: false });
  }

  function onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1/1.12;
    const newZoom = Math.max(0.1, Math.min(8, zoom * factor));
    // Zoom around the cursor
    const rect = stageRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const ix = (cx - pan.x) / zoom;
    const iy = (cy - pan.y) / zoom;
    setZoom(newZoom);
    setPan({ x: cx - ix * newZoom, y: cy - iy * newZoom });
  }

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const wc = workCanvasRef.current;
    const cur = wc.toDataURL('image/png');
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    setFuture(f => [...f, cur]);
    loadImg(prev).then(img => {
      const ctx = wc.getContext('2d');
      ctx.clearRect(0, 0, wc.width, wc.height);
      ctx.drawImage(img, 0, 0);
      renderView();
    });
  }, [history]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const wc = workCanvasRef.current;
    const cur = wc.toDataURL('image/png');
    const next = future[future.length - 1];
    setFuture(f => f.slice(0, -1));
    setHistory(h => [...h, cur]);
    loadImg(next).then(img => {
      const ctx = wc.getContext('2d');
      ctx.clearRect(0, 0, wc.width, wc.height);
      ctx.drawImage(img, 0, 0);
      renderView();
    });
  }, [future]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'r' || e.key === 'R') setTool('restore');
      else if (e.key === 'e' || e.key === 'E') setTool('erase');
      else if (e.key === 'h' || e.key === 'H') setTool('pan');
      else if (e.key === 'i' || e.key === 'I') setInvert(v => !v);
      else if (e.key === '[') setBrushSize(s => Math.max(4, s - 8));
      else if (e.key === ']') setBrushSize(s => Math.min(400, s + 8));
      else if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); }
      else if (e.key === 'f' || e.key === 'F') fitToView();
      else if (e.key === '0') { setZoom(1); setPan({x:0,y:0}); queueMicrotask(fitToView); }
      else if (e.key === 'Escape') onClose && onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, onClose]);

  // Hold-to-compare with original
  useEffect(() => {
    const down = (e) => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); setShowOriginal(true); } };
    const up = (e) => { if (e.code === 'Space') { e.preventDefault(); setShowOriginal(false); } };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const handleSave = () => {
    if (!workCanvasRef.current) return;
    setSaving(true);
    // toDataURL can be sync-heavy for large canvases; yield first
    setTimeout(() => {
      const dataURL = workCanvasRef.current.toDataURL('image/png');
      setSaving(false);
      onSave && onSave(dataURL);
    }, 0);
  };

  return (
    <div className="cutout-editor-root" style={{position:'fixed', inset:0, background:'rgba(74,35,64,.46)', backdropFilter:'blur(7px)', zIndex:200, display:'flex', flexDirection:'column'}}>
      {/* Header */}
      <div className="cutout-editor-header" style={{padding:'14px 22px', borderBottom:'1px solid rgba(196,122,184,.24)', background:'linear-gradient(160deg, #FFF8FC 0%, #F2D4EB 62%, #EBC2DF 100%)', color:'var(--ink)', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <div>
          <div style={{fontFamily:'var(--serif)', fontSize:22, letterSpacing:'.005em'}}>Cutout Editor</div>
          <div style={{fontSize:11.5, opacity:.7, marginTop:2}}>{imgDims.w}×{imgDims.h} · {Math.round(zoom*100)}% zoom · hold <b>Space</b> to compare with original</div>
        </div>
        <div style={{display:'flex', gap:8}}>
          <button className="btn btn-ghost" style={{background:'rgba(255,255,255,.72)', color:'var(--ink)', borderColor:'rgba(196,122,184,.24)'}} onClick={onClose}>
            <Icon name="x" className="ico-sm"/> Cancel
          </button>
          <button className="btn btn-blush" onClick={handleSave} disabled={saving}>
            <Icon name="check" className="ico-sm"/> {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="cutout-editor-body" style={{flex:1, display:'flex', minHeight:0}}>
        {/* Toolbar */}
        <div className="cutout-editor-toolbar" style={{width:86, background:'#FFF7FB', borderRight:'1px solid rgba(196,122,184,.2)', padding:'14px 10px', display:'flex', flexDirection:'column', gap:6, alignItems:'center'}}>
          <ToolBtn icon="magic" label="Restore (R)" active={tool==='restore'} accent="#8FCF9E" onClick={()=>setTool('restore')}/>
          <ToolBtn icon="scissors" label="Erase (E)" active={tool==='erase'} accent="#E8A0B7" onClick={()=>setTool('erase')}/>
          <ToolBtn icon="grid" label="Pan (H · hold Shift)" active={tool==='pan'} accent="#B0B7CC" onClick={()=>setTool('pan')}/>
          <div style={{height:1, background:'rgba(255,255,255,.08)', width:'100%', margin:'6px 0'}}/>
          <ToolBtn icon="eye" label="Invert view (I)" active={invert} accent="#D8B0E2" onClick={()=>setInvert(v=>!v)}/>
          <div style={{height:1, background:'rgba(255,255,255,.08)', width:'100%', margin:'6px 0'}}/>
          <ToolBtn icon="refresh" label="Undo (⌘Z)" onClick={undo} disabled={history.length===0}/>
          <ToolBtn icon="chevronRight" label="Redo (⌘⇧Z)" onClick={redo} disabled={future.length===0}/>
          <div style={{flex:1}}/>
          <ToolBtn icon="aperture" label="Fit (F)" onClick={fitToView}/>
        </div>

        {/* Stage */}
        <div
          ref={stageRef}
          className="cutout-editor-stage"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerLeave={onPointerLeave}
          onWheel={onWheel}
          style={{flex:1, position:'relative', overflow:'hidden', background:'linear-gradient(145deg,#F7EDF3 0%,#EFE2EA 100%)', cursor: tool==='pan' ? 'grab' : 'crosshair', touchAction:'none', WebkitUserSelect:'none', userSelect:'none'}}
        >
          <canvas ref={viewCanvasRef} style={{width:'100%', height:'100%', display:'block'}}/>
          {!loaded && (
            <div style={{position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--ink)', flexDirection:'column', gap:10}}>
              <div className="spinner"/>
              <div style={{fontSize:12, opacity:.7}}>Loading cutout…</div>
            </div>
          )}
          {showOriginal && loaded && (
            <div style={{position:'absolute', top:16, left:'50%', transform:'translateX(-50%)', background:'rgba(255,236,246,.95)', color:'#5B2F52', padding:'6px 12px', borderRadius:999, fontSize:12, fontWeight:700}}>Showing original photo (release Space to return)</div>
          )}
        </div>

        {/* Right panel — brush controls */}
        <div className="cutout-editor-controls" style={{width:280, background:'#FFF9FB', borderLeft:'1px solid rgba(196,122,184,.2)', padding:20, color:'var(--ink)', overflowY:'auto'}}>
          <div style={{fontSize:11, textTransform:'uppercase', letterSpacing:'.14em', opacity:.55, marginBottom:6}}>Current tool</div>
          <div style={{fontFamily:'var(--serif)', fontSize:22, marginBottom:16}}>
            {tool==='restore' ? 'Restore brush' : tool==='erase' ? 'Erase brush' : 'Pan / navigate'}
          </div>
          <div style={{fontSize:12.5, opacity:.75, lineHeight:1.6, marginBottom:20}}>
            {tool==='restore' && 'Paint the original photo\'s pixels back into the cutout — perfect for recovering print details, snap buttons or stitching that the model over-cropped.'}
            {tool==='erase' && 'Wipe away any leftover background pixels the model missed — stray shadows, fabric wrinkles, tag strings.'}
            {tool==='pan' && 'Drag to navigate. Scroll to zoom. Hold Shift with any tool to pan without switching.'}
          </div>

          {tool !== 'pan' && (
            <>
              <div style={{fontSize:11, textTransform:'uppercase', letterSpacing:'.14em', opacity:.55, marginBottom:6}}>Brush size · <b>[</b> / <b>]</b></div>
              <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:16}}>
                <input type="range" min="4" max="400" value={brushSize} onChange={e=>setBrushSize(+e.target.value)}
                  style={{flex:1, '--pct': ((brushSize-4)/(400-4)*100)+'%', background:'linear-gradient(90deg, #E4A6D6 0 var(--pct), rgba(255,255,255,.12) var(--pct) 100%)'}}/>
                <div style={{fontFamily:'var(--serif)', fontSize:18, minWidth:44, textAlign:'right'}}>{brushSize}</div>
              </div>

              <div style={{fontSize:11, textTransform:'uppercase', letterSpacing:'.14em', opacity:.55, marginBottom:6}}>Edge softness</div>
              <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:20}}>
                <input type="range" min="0" max="100" value={brushSoftness} onChange={e=>setBrushSoftness(+e.target.value)}
                  style={{flex:1, '--pct': brushSoftness+'%', background:'linear-gradient(90deg, #E4A6D6 0 var(--pct), rgba(255,255,255,.12) var(--pct) 100%)'}}/>
                <div style={{fontFamily:'var(--serif)', fontSize:18, minWidth:44, textAlign:'right'}}>{brushSoftness}</div>
              </div>
            </>
          )}

          <div style={{fontSize:11, textTransform:'uppercase', letterSpacing:'.14em', opacity:.55, marginBottom:6}}>Zoom</div>
          <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:20}}>
            <button className="btn btn-ghost" style={{background:'#fff', color:'var(--ink)', borderColor:'rgba(196,122,184,.22)', padding:'6px 10px'}} onClick={()=>setZoom(z=>Math.max(0.1, z/1.2))}>−</button>
            <div style={{flex:1, textAlign:'center', fontFamily:'var(--serif)', fontSize:18}}>{Math.round(zoom*100)}%</div>
            <button className="btn btn-ghost" style={{background:'#fff', color:'var(--ink)', borderColor:'rgba(196,122,184,.22)', padding:'6px 10px'}} onClick={()=>setZoom(z=>Math.min(8, z*1.2))}>+</button>
          </div>
          <div style={{display:'flex', gap:6, marginBottom:20}}>
            <button className="btn btn-ghost" style={{background:'#fff', color:'var(--ink)', borderColor:'rgba(196,122,184,.22)', flex:1, justifyContent:'center', padding:'7px 10px', fontSize:12}} onClick={fitToView}>Fit</button>
            <button className="btn btn-ghost" style={{background:'#fff', color:'var(--ink)', borderColor:'rgba(196,122,184,.22)', flex:1, justifyContent:'center', padding:'7px 10px', fontSize:12}} onClick={()=>setZoom(1)}>100%</button>
          </div>

        </div>
      </div>
    </div>
  );
};

const ToolBtn = ({ icon, label, active, accent, onClick, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={label}
    style={{
      width:52, height:52,
      borderRadius:12,
      background: active ? (accent || '#E4A6D6') : '#fff',
      color: active ? 'var(--ink)' : 'var(--ink-soft)',
      border:'1px solid ' + (active ? 'transparent' : 'rgba(196,122,184,.22)'),
      display:'flex', alignItems:'center', justifyContent:'center',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? .35 : 1,
      transition:'.15s',
    }}>
    <Icon name={icon} className="ico"/>
  </button>
);

window.CutoutEditor = CutoutEditor;
