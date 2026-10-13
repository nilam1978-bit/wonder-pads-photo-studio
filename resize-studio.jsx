// SCREEN — Resize Studio: upload photos and fit them into any size WITHOUT cropping
// and WITHOUT background removal. The whole photo is shown by default; you can
// then zoom in/out and drag it into place by hand. Everything runs in the browser
// — nothing is uploaded anywhere, and the original files are never changed.
//
// Wrapped in an IIFE so none of its helper names can clash with the other screens.
(function () {
  const { useState, useEffect, useRef, useCallback, useMemo } = React;

  const FALLBACK_RATIOS = [
    { id: '1:1', label: 'Square', ratio: [1, 1] },
    { id: '4:5', label: 'IG Portrait', ratio: [4, 5] },
    { id: '9:16', label: 'IG Reel', ratio: [9, 16] },
    { id: '16:9', label: 'Landscape', ratio: [16, 9] },
    { id: '3:4', label: 'Portrait', ratio: [3, 4] },
    { id: '4:3', label: 'Classic', ratio: [4, 3] },
  ];
  const getRatios = () => (Array.isArray(window.OUTPUT_RATIOS) && window.OUTPUT_RATIOS.length ? window.OUTPUT_RATIOS : FALLBACK_RATIOS);

  const LONG_EDGES = [
    { id: '1080', label: '1080 px' },
    { id: '1400', label: '1400 px' },
    { id: '2000', label: '2000 px' },
    { id: 'orig', label: 'Original size' },
  ];

  const FILLS = [
    { id: 'white', label: 'White', color: '#FFFFFF' },
    { id: 'cream', label: 'Cream', color: '#F5EBDD' },
    { id: 'blush', label: 'Blush', color: '#F3D4EB' },
    { id: 'sage', label: 'Sage', color: '#D9E2D2' },
    { id: 'grey', label: 'Soft grey', color: '#E7E4E6' },
    { id: 'black', label: 'Black', color: '#1E1A1D' },
  ];

  // The four pieces of a circle. "tl" = the TOP-LEFT piece, whose round edge faces top-left.
  const CORNERS = [
    { id: 'tl', label: 'Top-left piece', path: 'M24 24 L0 24 A24 24 0 0 1 24 0 Z' },
    { id: 'tr', label: 'Top-right piece', path: 'M0 24 L24 24 A24 24 0 0 0 0 0 Z' },
    { id: 'bl', label: 'Bottom-left piece', path: 'M24 0 L0 0 A24 24 0 0 0 24 24 Z' },
    { id: 'br', label: 'Bottom-right piece', path: 'M0 0 L24 0 A24 24 0 0 1 0 24 Z' },
  ];
  const MAX_SIDE = 6000;
  const MAX_PIXELS = 16000000; // keeps phones/iPads from running out of canvas memory
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 6;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ---------- quarter-circle shape ----------
  // Photos with a see-through shape or background can't be saved as JPG.
  const isShaped = (it) => it.ratioId === 'quarter' || it.fillType === 'none';

  // Where the full circle's centre sits for each piece (0 or 1 across the square canvas).
  function circleCentre(corner) {
    return ({ tl: [1, 1], tr: [0, 1], bl: [1, 0], br: [0, 0] })[corner] || [1, 1];
  }

  // Keeps only the quarter-circle and makes everything else see-through.
  function maskQuarter(ctx, S, corner) {
    const [fx, fy] = circleCentre(corner);
    const start = ({ tl: Math.PI, tr: Math.PI * 1.5, bl: Math.PI * 0.5, br: 0 })[corner];
    const a0 = start === undefined ? Math.PI : start;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(fx * S, fy * S);
    ctx.arc(fx * S, fy * S, S, a0, a0 + Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // The "whole photo" starting position. For a normal size that is simply "fits the canvas".
  // For a quarter circle the photo is tucked into the straight corner and sized so its far
  // corner just touches the curve — so the full photo stays visible inside the quarter.
  function fitViewFor(it) {
    if (it.ratioId !== 'quarter') return { zoom: 1, offX: 0, offY: 0 };
    const a = it.iw / it.ih;
    const k = 0.97; // tiny breathing room from the curve
    const w = (a / Math.sqrt(a * a + 1)) * k; // photo width as a fraction of the square
    const h = (1 / Math.sqrt(a * a + 1)) * k;
    const [fx, fy] = circleCentre(it.quarterCorner);
    const rcx = fx ? 1 - w / 2 : w / 2;
    const rcy = fy ? 1 - h / 2 : h / 2;
    const zoom = (w / it.iw) / Math.min(1 / it.iw, 1 / it.ih);
    return { zoom, offX: rcx - 0.5, offY: rcy - 0.5 };
  }

  // ---------- sizing ----------
  function outDims(it) {
    let w;
    let h;
    if (it.ratioId === 'custom') {
      w = parseInt(it.cwS, 10) || 1080;
      h = parseInt(it.chS, 10) || 1080;
    } else {
      const longEdge = it.long === 'orig' ? Math.max(it.iw, it.ih) : Number(it.long) || 1400;
      let rw = it.iw;
      let rh = it.ih;
      if (it.ratioId === 'quarter') {
        rw = 1;
        rh = 1;
      } else if (it.ratioId !== 'photo') {
        const r = getRatios().find((x) => x.id === it.ratioId);
        if (r) { rw = r.ratio[0]; rh = r.ratio[1]; }
      }
      if (rw >= rh) { w = longEdge; h = longEdge * (rh / rw); } else { h = longEdge; w = longEdge * (rw / rh); }
    }
    w = clamp(Math.round(w), 16, MAX_SIDE);
    h = clamp(Math.round(h), 16, MAX_SIDE);
    if (w * h > MAX_PIXELS) {
      const k = Math.sqrt(MAX_PIXELS / (w * h));
      w = Math.max(16, Math.floor(w * k));
      h = Math.max(16, Math.floor(h * k));
    }
    return { w, h };
  }

  // ---------- drawing (shared by the live preview and the real export) ----------
  // Halves a big image step by step so shrinking it down stays sharp on every browser.
  function stepDown(src, sw, sh, targetW) {
    let cur = src;
    let cw = sw;
    let ch = sh;
    while (cw / 2 >= targetW && cw > 2) {
      const nw = Math.max(1, Math.floor(cw / 2));
      const nh = Math.max(1, Math.floor(ch / 2));
      const c = document.createElement('canvas');
      c.width = nw;
      c.height = nh;
      const x = c.getContext('2d');
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = 'high';
      x.drawImage(cur, 0, 0, nw, nh);
      cur = c;
      cw = nw;
      ch = nh;
    }
    return cur;
  }

  // A soft blurred copy of the photo to use as the background. Done by shrinking to a
  // tiny picture and stretching it back (works everywhere, no canvas filter needed).
  function drawBlurFill(ctx, img, iw, ih, W, H) {
    const tw = 40;
    const th = Math.max(1, Math.round((tw * H) / W));
    const tiny = document.createElement('canvas');
    tiny.width = tw;
    tiny.height = th;
    const t = tiny.getContext('2d');
    t.imageSmoothingEnabled = true;
    t.imageSmoothingQuality = 'high';
    const s = Math.max(tw / iw, th / ih);
    t.drawImage(img, (tw - iw * s) / 2, (th - ih * s) / 2, iw * s, ih * s);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tiny, 0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.fillRect(0, 0, W, H);
  }

  // zoom 1 = the whole photo fits inside the canvas (nothing cropped).
  // offX / offY are fractions of the canvas width / height, so a move looks identical
  // in the small preview and in the full-size export.
  function drawComposite(ctx, img, iw, ih, W, H, s, hq) {
    ctx.clearRect(0, 0, W, H);
    if (s.fillType === 'blur') {
      drawBlurFill(ctx, img, iw, ih, W, H);
    } else if (s.fillType === 'none') {
      // transparent: leave the canvas empty behind the photo
    } else {
      ctx.fillStyle = s.fillColor || '#FFFFFF';
      ctx.fillRect(0, 0, W, H);
    }
    const sc = Math.min(W / iw, H / ih) * s.zoom;
    const dw = iw * sc;
    const dh = ih * sc;
    const cx = W / 2 + s.offX * W;
    const cy = H / 2 + s.offY * H;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const source = hq && sc < 0.5 ? stepDown(img, iw, ih, dw) : img;
    ctx.drawImage(source, cx - dw / 2, cy - dh / 2, dw, dh);
    if (s.ratioId === 'quarter') maskQuarter(ctx, W, s.quarterCorner);
  }

  async function renderToBlob(it, fmt, quality) {
    const { w, h } = outDims(it);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    drawComposite(c.getContext('2d'), it.el, it.iw, it.ih, w, h, it, true);
    let mime = fmt === 'png' ? 'image/png' : fmt === 'webp' ? 'image/webp' : 'image/jpeg';
    if (mime === 'image/jpeg' && isShaped(it)) mime = 'image/png'; // JPG cannot be see-through
    const blob = await new Promise((res) => c.toBlob(res, mime, quality));
    if (!blob) throw new Error('This browser could not create the image.');
    return { blob, w, h };
  }

  const extFromType = (t) => (t === 'image/png' ? 'png' : t === 'image/webp' ? 'webp' : 'jpg');
  const baseName = (name) => String(name || 'photo').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'photo';

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ---------- loading a photo ----------
  function loadPhoto(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const el = new Image();
      el.onload = () => {
        const iw = el.naturalWidth;
        const ih = el.naturalHeight;
        if (!iw || !ih) { URL.revokeObjectURL(url); reject(new Error('empty')); return; }
        // A lighter copy used only for the live preview, so dragging stays smooth.
        const k = Math.min(1, 1600 / Math.max(iw, ih));
        const proxy = document.createElement('canvas');
        proxy.width = Math.max(1, Math.round(iw * k));
        proxy.height = Math.max(1, Math.round(ih * k));
        const px = proxy.getContext('2d');
        px.imageSmoothingEnabled = true;
        px.imageSmoothingQuality = 'high';
        px.drawImage(stepDown(el, iw, ih, proxy.width), 0, 0, proxy.width, proxy.height);
        resolve({ url, el, iw, ih, proxy });
      };
      el.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
      el.src = url;
    });
  }

  const STYLES = `
  .rs-page{ padding:28px 40px 60px; max-width:1400px; }
  .rs-head{ display:flex; justify-content:space-between; align-items:flex-end; gap:20px; margin-bottom:18px; flex-wrap:wrap; }
  .rs-head h1{ margin:6px 0 5px; color:var(--ink); font-size:32px; }
  .rs-head p{ max-width:660px; margin:0; color:var(--muted); font-size:13px; line-height:1.5; }
  .rs-drop{ border:2px dashed var(--blush-deep); background:linear-gradient(145deg,#FFF8FC 0%,#F8EAF4 100%); border-radius:22px; padding:54px 24px; text-align:center; cursor:pointer; transition:.15s; }
  .rs-drop.over, .rs-drop:hover{ border-color:var(--rose); background:#FFF3FA; }
  .rs-drop .serif{ font-size:24px; color:var(--ink); margin:10px 0 4px; }
  .rs-drop .rs-sub{ color:var(--muted); font-size:13px; }
  .rs-grid{ display:grid; grid-template-columns:minmax(0,1fr) 340px; gap:18px; align-items:start; }
  .rs-stage-card{ padding:16px; }
  .rs-stage{ display:flex; align-items:center; justify-content:center; min-height:320px; padding:16px; border-radius:14px; background:
    conic-gradient(#f3eef1 25%, #fff 0 50%, #f3eef1 0 75%, #fff 0) 0 0/18px 18px; border:1px solid var(--line); }
  .rs-canvas{ display:block; max-width:100%; max-height:62vh; width:auto; height:auto; touch-action:none; cursor:grab; box-shadow:0 8px 28px rgba(80,50,70,.22); border-radius:2px; background:#fff; }
  .rs-canvas:active{ cursor:grabbing; }
  .rs-hint{ margin-top:9px; font-size:11.5px; color:var(--muted); text-align:center; }
  .rs-zoom-row{ display:flex; align-items:center; gap:10px; margin-top:12px; }
  .rs-zoom-row input[type=range]{ flex:1; accent-color:var(--rose); min-width:0; }
  .rs-zoom-val{ min-width:46px; text-align:right; font-weight:700; font-size:12.5px; color:var(--ink-soft); }
  .rs-iconbtn{ width:34px; height:34px; border-radius:50%; border:1px solid var(--line); background:#fff; font-size:18px; line-height:1; color:var(--ink); cursor:pointer; flex:0 0 auto; }
  .rs-iconbtn:hover{ border-color:var(--blush-deep); background:#FFFAFD; }
  .rs-quick{ display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
  .rs-quick .btn{ padding:7px 13px; font-size:12px; }
  .rs-rail{ padding:18px; }
  .rs-rail .rs-lbl{ font-size:11px; text-transform:uppercase; letter-spacing:.14em; color:var(--muted); font-weight:700; margin:16px 0 8px; display:flex; justify-content:space-between; align-items:center; }
  .rs-rail .rs-lbl:first-child{ margin-top:0; }
  .rs-rail .rs-lbl .hint{ text-transform:none; letter-spacing:.02em; font-weight:500; }
  .rs-swatches{ display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  .rs-swatch{ width:30px; height:30px; border-radius:50%; border:2px solid #fff; box-shadow:0 0 0 1px var(--line); cursor:pointer; padding:0; }
  .rs-swatch.on{ box-shadow:0 0 0 2px var(--rose); }
  .rs-swatch.none{ background:conic-gradient(#d8d2d6 25%, #fff 0 50%, #d8d2d6 0 75%, #fff 0) 0 0/10px 10px; }
  .rs-canvas--alpha{ background:transparent; box-shadow:none; }
  .rs-corners{ display:grid; grid-template-columns:1fr 1fr; gap:6px; }
  .rs-corner{ display:flex; align-items:center; gap:7px; padding:7px 9px; border-radius:12px; border:1px solid var(--line); background:#fff; color:var(--ink-soft); font-size:11.5px; font-weight:600; cursor:pointer; text-align:left; }
  .rs-corner.on{ background:linear-gradient(180deg,#F7E6F1 0%,#F1CFEA 100%); border-color:rgba(196,122,184,.35); color:#5B2F52; }
  .rs-corner svg{ flex:0 0 auto; }
  .rs-note{ margin-top:8px; font-size:11.5px; line-height:1.4; color:var(--muted); }
  .rs-swatch.blur{ background:linear-gradient(135deg,#F3D4EB,#D9E2D2,#F5EBDD); }
  .rs-color-input{ width:34px; height:30px; padding:0; border:1px solid var(--line); border-radius:8px; background:#fff; cursor:pointer; }
  .rs-select, .rs-num{ box-sizing:border-box; width:100%; padding:8px 10px; border:1px solid var(--line); border-radius:10px; background:#fff; font-size:13px; color:var(--ink); }
  .rs-custom{ display:flex; align-items:center; gap:8px; margin-top:8px; }
  .rs-custom span{ color:var(--muted); font-weight:700; }
  .rs-check{ display:flex; gap:8px; align-items:flex-start; font-size:12.5px; color:var(--ink-soft); margin-top:14px; line-height:1.4; cursor:pointer; }
  .rs-check input{ margin-top:2px; accent-color:var(--rose); }
  .rs-out{ margin-top:14px; padding:10px 12px; border-radius:12px; background:var(--linen-warm); font-size:12.5px; color:var(--ink-soft); }
  .rs-out strong{ color:var(--ink); }
  .rs-actions{ display:flex; flex-direction:column; gap:8px; margin-top:14px; }
  .rs-actions .btn{ justify-content:center; width:100%; }
  .rs-notice{ margin-top:10px; font-size:12px; color:var(--sage-deep); font-weight:600; }
  .rs-notice.err{ color:#9A4A3A; }
  .rs-strip{ display:flex; gap:10px; overflow-x:auto; padding:12px 2px 4px; margin-top:14px; }
  .rs-thumb{ position:relative; flex:0 0 auto; width:86px; height:86px; border-radius:12px; border:2px solid var(--line); background:#fff; padding:0; cursor:pointer; overflow:hidden; }
  .rs-thumb.on{ border-color:var(--rose); box-shadow:0 0 0 2px rgba(201,122,184,.25); }
  .rs-thumb img{ width:100%; height:100%; object-fit:contain; display:block; }
  .rs-thumb .rs-x{ position:absolute; top:3px; right:3px; width:20px; height:20px; border-radius:50%; background:rgba(61,47,58,.78); color:#fff; font-size:12px; line-height:20px; text-align:center; }
  .rs-add{ flex:0 0 auto; width:86px; height:86px; border-radius:12px; border:2px dashed var(--blush-deep); background:#FFF8FC; color:var(--rose); font-size:26px; cursor:pointer; }
  .rs-tabs{ display:flex; gap:8px; margin:0 0 16px; }
  .rs-tab{ padding:9px 18px; border-radius:999px; border:1px solid var(--line); background:#fff; font-weight:700; font-size:13px; color:var(--ink-soft); cursor:pointer; }
  .rs-tab.on{ background:linear-gradient(180deg,#F7E6F1 0%,#F1CFEA 100%); border-color:rgba(196,122,184,.35); color:#5B2F52; }
  .rs-empty-preview{ max-width:300px; text-align:center; color:var(--muted); font-size:13.5px; line-height:1.5; padding:30px 10px; }
  .rs-picker{ display:grid; grid-template-columns:repeat(auto-fill,minmax(74px,1fr)); gap:8px; }
  .rs-pick{ position:relative; aspect-ratio:1/1; display:flex; align-items:center; justify-content:center; padding:5px; border-radius:12px; border:2px solid var(--line); background:#fff; cursor:pointer; }
  .rs-pick.on{ border-color:var(--rose); box-shadow:0 0 0 2px rgba(201,122,184,.25); }
  .rs-pick-canvas{ max-width:100%; max-height:100%; display:block; border-radius:3px; }
  .rs-pick-n{ position:absolute; top:-6px; left:-6px; width:22px; height:22px; border-radius:50%; background:var(--rose); color:#fff; font-size:12px; font-weight:700; line-height:22px; text-align:center; }
  @media (max-width: 980px){
    .rs-page{ padding:18px 14px 50px; }
    .rs-grid{ grid-template-columns:1fr; }
    .rs-head h1{ font-size:26px; }
    .rs-canvas{ max-height:52vh; }
  }`;

  // ---------- collage: arrange the resized photos in a grid, nothing cropped ----------
  const COLLAGE_LAYOUTS = [
    { id: '2x2', label: '2×2 grid', cols: 2, rows: 2 },
    { id: '3x2', label: '3×2 grid', cols: 3, rows: 2 },
    { id: '2x3', label: '2×3 grid', cols: 2, rows: 3 },
    { id: '3x3', label: '3×3 grid', cols: 3, rows: 3 },
  ];
  const COLLAGE_BACKDROPS = [
    { id: 'blush', label: 'Blush pink', top: '#FFF7FB', bottom: '#F3D4EB', dot: '#F3D4EB', dark: false },
    { id: 'cream', label: 'Warm cream', top: '#FFFDF8', bottom: '#F5EBDD', dot: '#F5EBDD', dark: false },
    { id: 'white', label: 'Pure white', top: '#FFFFFF', bottom: '#FFFFFF', dot: '#FFFFFF', dark: false },
    { id: 'sage', label: 'Soft sage', top: '#F6F9F3', bottom: '#D9E2D2', dot: '#D9E2D2', dark: false },
    { id: 'black', label: 'Black', top: '#2A2328', bottom: '#1E1A1D', dot: '#1E1A1D', dark: true },
  ];

  function roundPath(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  // Small preview of one photo exactly as it will look in the collage (its own size, fit and background).
  const PickThumb = ({ item }) => {
    const ref = useRef(null);
    useEffect(() => {
      const c = ref.current;
      if (!c) return;
      const { w, h } = outDims(item);
      const k = Math.min(1, 150 / Math.max(w, h));
      c.width = Math.max(1, Math.round(w * k));
      c.height = Math.max(1, Math.round(h * k));
      drawComposite(c.getContext('2d'), item.proxy, item.proxy.width, item.proxy.height, c.width, c.height, item, false);
    });
    return <canvas ref={ref} className="rs-pick-canvas"/>;
  };

  const CollageView = ({ items, fmt, quality }) => {
    const [layoutId, setLayoutId] = useState('2x2');
    const [ratioId, setRatioId] = useState('1:1');
    const [backdropId, setBackdropId] = useState('blush');
    const [gap, setGap] = useState(24);
    const [title, setTitle] = useState('');
    const [picked, setPicked] = useState(() => items.slice(0, 4).map((i) => i.id));
    const [previewUrl, setPreviewUrl] = useState('');
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState({ text: '', err: false });
    const urlRef = useRef('');
    const blobRef = useRef(null);
    const ratios = getRatios();

    const layout = COLLAGE_LAYOUTS.find((l) => l.id === layoutId) || COLLAGE_LAYOUTS[0];
    const cap = layout.cols * layout.rows;
    const ratioDef = ratios.find((r) => r.id === ratioId) || ratios[0];

    useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

    const invalidate = () => {
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = ''; }
      blobRef.current = null;
      setPreviewUrl('');
    };
    const change = (fn) => { fn(); invalidate(); };

    const togglePick = (id) => change(() => setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= cap ? prev : [...prev, id])));

    const build = async () => {
      const chosen = picked.map((id) => items.find((i) => i.id === id)).filter(Boolean);
      if (chosen.length < 2 || busy) return;
      setBusy(true);
      setNotice({ text: 'Building…', err: false });
      try {
        const W = 1600;
        const H = Math.round((W * ratioDef.ratio[1]) / ratioDef.ratio[0]);
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        const bd = COLLAGE_BACKDROPS.find((b) => b.id === backdropId) || COLLAGE_BACKDROPS[0];
        const grad = ctx.createLinearGradient(0, 0, W, H);
        grad.addColorStop(0, bd.top);
        grad.addColorStop(1, bd.bottom);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        const t = title.trim();
        const titleH = t ? 150 : 0;
        if (t) {
          ctx.fillStyle = bd.dark ? '#F5EBDD' : '#4A2340';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = '600 56px Georgia, serif';
          ctx.fillText(t, W / 2, titleH / 2 + gap / 2, W - gap * 2);
        }

        const { cols, rows } = layout;
        const n = chosen.length;
        const tileW = (W - gap * (cols + 1)) / cols;
        const tileH = (H - titleH - gap * (rows + 1)) / rows;
        const rowsUsed = Math.ceil(n / cols);
        const blockH = rowsUsed * tileH + (rowsUsed - 1) * gap;
        const areaH = H - titleH - gap * 2;
        const startY = titleH + gap + (areaH - blockH) / 2;

        for (let r = 0; r < rowsUsed; r += 1) {
          const inRow = Math.min(cols, n - r * cols);
          const rowW = inRow * tileW + (inRow - 1) * gap;
          const startX = (W - rowW) / 2;
          for (let c = 0; c < inRow; c += 1) {
            const it = chosen[r * cols + c];
            // Render the photo exactly as set up in the Resize tab, then fit it WHOLE into its cell.
            const { w, h } = outDims(it);
            const k = Math.min(1, 1400 / Math.max(w, h));
            const pw = Math.max(1, Math.round(w * k));
            const ph = Math.max(1, Math.round(h * k));
            const pc = document.createElement('canvas');
            pc.width = pw;
            pc.height = ph;
            drawComposite(pc.getContext('2d'), it.el, it.iw, it.ih, pw, ph, it, true);

            const s = Math.min(tileW / pw, tileH / ph);
            const dw = pw * s;
            const dh = ph * s;
            const dx = startX + c * (tileW + gap) + (tileW - dw) / 2;
            const dy = startY + r * (tileH + gap) + (tileH - dh) / 2;
            const radius = Math.min(14, Math.min(dw, dh) * 0.04);

            if (isShaped(it)) {
              // see-through shapes (quarter circles) sit directly on the backdrop — no card behind them
              ctx.save();
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'high';
              ctx.drawImage(pc, dx, dy, dw, dh);
              ctx.restore();
              continue;
            }

            ctx.save();
            ctx.shadowColor = bd.dark ? 'rgba(0,0,0,.5)' : 'rgba(90,50,80,.2)';
            ctx.shadowBlur = 22;
            ctx.shadowOffsetY = 7;
            ctx.fillStyle = '#FFFFFF';
            roundPath(ctx, dx, dy, dw, dh, radius);
            ctx.fill();
            ctx.restore();

            ctx.save();
            roundPath(ctx, dx, dy, dw, dh, radius);
            ctx.clip();
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(pc, dx, dy, dw, dh);
            ctx.restore();
          }
        }

        const mime = fmt === 'png' ? 'image/png' : fmt === 'webp' ? 'image/webp' : 'image/jpeg';
        const blob = await new Promise((res) => canvas.toBlob(res, mime, quality / 100));
        if (!blob) throw new Error('This browser could not create the collage.');
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = URL.createObjectURL(blob);
        blobRef.current = blob;
        setPreviewUrl(urlRef.current);
        setNotice({ text: `${n} photos arranged · ${W} × ${H} px`, err: false });
      } catch (e) {
        setNotice({ text: e.message || 'Could not build this collage.', err: true });
      }
      setBusy(false);
    };

    const download = () => {
      if (!blobRef.current) return;
      saveBlob(blobRef.current, `wonder-pads-collage-${layout.id}-${ratioDef.id.replace(':', 'x')}.${extFromType(blobRef.current.type)}`);
    };

    const pickedValid = picked.filter((id) => items.some((i) => i.id === id));

    return (
      <div className="rs-grid">
        <div className="card rs-stage-card">
          <div className="rs-stage" style={{ minHeight: 360 }}>
            {previewUrl
              ? <img src={previewUrl} alt="Collage preview" className="rs-canvas" style={{ cursor: 'default' }}/>
              : <div className="rs-empty-preview">Pick at least two photos, then press <strong>Build collage</strong>.</div>}
          </div>
          <div className="rs-hint">Each photo keeps the size, zoom and background you set in the Resize tab. Nothing is cropped.</div>
        </div>

        <div className="card rs-rail">
          <div className="rs-lbl">Photos <span className="hint">{pickedValid.length} of {cap} chosen · tap to add / remove</span></div>
          <div className="rs-picker">
            {items.map((it) => {
              const idx = pickedValid.indexOf(it.id);
              return (
                <button key={it.id} type="button" className={'rs-pick' + (idx >= 0 ? ' on' : '')} title={it.name} onClick={() => togglePick(it.id)} aria-pressed={idx >= 0}>
                  <PickThumb item={it}/>
                  {idx >= 0 && <span className="rs-pick-n">{idx + 1}</span>}
                </button>
              );
            })}
          </div>

          <div className="rs-lbl">Layout</div>
          <div className="chips">
            {COLLAGE_LAYOUTS.map((l) => (
              <button key={l.id} type="button" className={'chip' + (layoutId === l.id ? ' on' : '')}
                onClick={() => change(() => { setLayoutId(l.id); setPicked((p) => p.slice(0, l.cols * l.rows)); })}>{l.label}</button>
            ))}
          </div>

          <div className="rs-lbl">Collage shape</div>
          <div className="chips">
            {ratios.map((r) => (
              <button key={r.id} type="button" className={'chip' + (ratioId === r.id ? ' on' : '')} onClick={() => change(() => setRatioId(r.id))}>{r.id} · {r.label}</button>
            ))}
          </div>

          <div className="rs-lbl">Backdrop</div>
          <div className="rs-swatches">
            {COLLAGE_BACKDROPS.map((b) => (
              <button key={b.id} type="button" className={'rs-swatch' + (backdropId === b.id ? ' on' : '')} style={{ background: b.dot }}
                title={b.label} aria-label={b.label} onClick={() => change(() => setBackdropId(b.id))}/>
            ))}
          </div>

          <div className="rs-lbl">Title <span className="hint">optional</span></div>
          <input className="rs-select" value={title} placeholder="e.g. New fabric collection" onChange={(e) => change(() => setTitle(e.target.value))}/>

          <div className="rs-lbl">Spacing</div>
          <div className="rs-zoom-row" style={{ marginTop: 0 }}>
            <input type="range" min="8" max="64" step="1" value={gap} aria-label="Spacing" onChange={(e) => change(() => setGap(Number(e.target.value)))}/>
            <span className="rs-zoom-val">{gap}px</span>
          </div>

          <div className="rs-actions">
            <button type="button" className="btn btn-primary" disabled={busy || pickedValid.length < 2} onClick={build}>
              <Icon name="sparkles" className="ico-sm"/> {busy ? 'Building…' : previewUrl ? 'Rebuild collage' : 'Build collage'}
            </button>
            <button type="button" className="btn btn-blush" disabled={!previewUrl || busy} onClick={download}><Icon name="download" className="ico-sm"/> Download collage</button>
          </div>
          {notice.text && <div className={'rs-notice' + (notice.err ? ' err' : '')} role="status">{notice.text}</div>}
        </div>
      </div>
    );
  };

  const ResizeStudio = () => {
    const [items, setItems] = useState([]);
    const [activeId, setActiveId] = useState(null);
    const [sameForAll, setSameForAll] = useState(true);
    const [view, setView] = useState('resize');
    const [fmt, setFmt] = useState('jpeg');
    const [quality, setQuality] = useState(92);
    const [dragOver, setDragOver] = useState(false);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState({ text: '', err: false });
    const inputRef = useRef(null);
    const canvasRef = useRef(null);
    const itemsRef = useRef([]);
    const activeIdRef = useRef(null);
    const ptrs = useRef(new Map());
    const pinchDist = useRef(0);

    itemsRef.current = items;
    activeIdRef.current = activeId;

    const active = useMemo(() => items.find((i) => i.id === activeId) || null, [items, activeId]);
    const ratios = getRatios();

    const say = (text, err = false) => setNotice({ text, err });

    // Free the in-memory photo links when leaving this screen.
    useEffect(() => () => { itemsRef.current.forEach((i) => URL.revokeObjectURL(i.url)); }, []);

    // ----- add photos -----
    const addFiles = async (fileList) => {
      const files = Array.from(fileList || []).filter((f) => /^image\//.test(f.type)).slice(0, 50);
      if (!files.length) { say('Please choose image files (JPG, PNG, WebP, HEIC…).', true); return; }
      say('Loading photos…');
      const base = itemsRef.current.find((i) => i.id === activeIdRef.current) || itemsRef.current[0] || null;
      const added = [];
      let failed = 0;
      for (const f of files) {
        try {
          const p = await loadPhoto(f);
          const fresh = {
            id: `rs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            name: f.name,
            ...p,
            ratioId: base ? base.ratioId : '1:1',
            long: base ? base.long : '1400',
            cwS: base ? base.cwS : '1080',
            chS: base ? base.chS : '1080',
            fillType: base ? base.fillType : 'color',
            fillColor: base ? base.fillColor : '#FFFFFF',
            quarterCorner: CORNERS[(itemsRef.current.length + added.length) % 4].id,
            zoom: 1,
            offX: 0,
            offY: 0,
          };
          Object.assign(fresh, fitViewFor(fresh));
          added.push(fresh);
        } catch (e) { failed += 1; }
      }
      if (added.length) {
        setItems((prev) => [...prev, ...added]);
        setActiveId((cur) => cur || added[0].id);
      }
      say(failed ? `${added.length} added, ${failed} could not be read.` : `${added.length} photo${added.length === 1 ? '' : 's'} added.`, failed > 0 && !added.length);
    };

    const removeItem = (id) => {
      const victim = itemsRef.current.find((i) => i.id === id);
      if (victim) URL.revokeObjectURL(victim.url);
      const rest = itemsRef.current.filter((i) => i.id !== id);
      setItems(rest);
      if (activeIdRef.current === id) setActiveId(rest.length ? rest[0].id : null);
      if (rest.length < 2) setView('resize');
    };

    const clearAll = () => {
      itemsRef.current.forEach((i) => URL.revokeObjectURL(i.url));
      setItems([]);
      setActiveId(null);
      setView('resize');
      say('');
    };

    // ----- settings -----
    const patchActive = useCallback((changes) => {
      setItems((prev) => prev.map((i) => (i.id === activeIdRef.current ? { ...i, ...changes } : i)));
    }, []);

    // Size / background changes go to every photo when "same for all" is on.
    // Zoom and position stay per-photo, but are reset to "whole photo fits" because the canvas shape changed.
    const applyShared = (changes, resetView) => {
      setItems((prev) => prev.map((i, idx) => {
        if (!sameForAll && i.id !== activeIdRef.current) return i;
        const merged = { ...i, ...changes };
        // choosing Quarter circle for several photos hands out the four pieces in order
        if (changes.ratioId === 'quarter') merged.quarterCorner = CORNERS[idx % 4].id;
        return resetView ? { ...merged, ...fitViewFor(merged) } : merged;
      }));
    };

    const zoomAt = useCallback((factor, px, py) => {
      setItems((prev) => prev.map((i) => {
        if (i.id !== activeIdRef.current) return i;
        const z = clamp(i.zoom * factor, MIN_ZOOM, MAX_ZOOM);
        const f = z / i.zoom;
        // keep the spot under the finger / cursor in place while zooming
        return { ...i, zoom: z, offX: clamp(px - (px - i.offX) * f, -1.5, 1.5), offY: clamp(py - (py - i.offY) * f, -1.5, 1.5) };
      }));
    }, []);

    const setZoomCentered = (z) => {
      const nz = clamp(z, MIN_ZOOM, MAX_ZOOM);
      if (!active) return;
      zoomAt(nz / active.zoom, 0, 0);
    };

    const fitWhole = () => { if (active) patchActive(fitViewFor(active)); };
    const setCorner = (id) => { if (active) patchActive({ quarterCorner: id, ...fitViewFor({ ...active, quarterCorner: id }) }); };
    const fillFrame = () => {
      if (!active) return;
      const { w, h } = outDims(active);
      const z = Math.max(w / active.iw, h / active.ih) / Math.min(w / active.iw, h / active.ih);
      patchActive({ zoom: clamp(z, MIN_ZOOM, MAX_ZOOM), offX: 0, offY: 0 });
    };
    const centerPhoto = () => patchActive({ offX: 0, offY: 0 });

    // ----- live preview -----
    const dims = active ? outDims(active) : null;
    useEffect(() => {
      const c = canvasRef.current;
      if (!c || !active || !dims) return;
      const k = Math.min(1, 1000 / Math.max(dims.w, dims.h));
      const pw = Math.max(1, Math.round(dims.w * k));
      const ph = Math.max(1, Math.round(dims.h * k));
      if (c.width !== pw) c.width = pw;
      if (c.height !== ph) c.height = ph;
      drawComposite(c.getContext('2d'), active.proxy, active.proxy.width, active.proxy.height, pw, ph, active, false);
    });

    // ----- drag to move, pinch / wheel to zoom -----
    const relPoint = (e) => {
      const r = canvasRef.current.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width - 0.5, y: (e.clientY - r.top) / r.height - 0.5, rect: r };
    };

    const onPointerDown = (e) => {
      if (!active) return;
      canvasRef.current.setPointerCapture?.(e.pointerId);
      ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.current.size === 2) {
        const [a, b] = Array.from(ptrs.current.values());
        pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };

    const onPointerMove = (e) => {
      const prev = ptrs.current.get(e.pointerId);
      if (!prev || !active) return;
      const rect = canvasRef.current.getBoundingClientRect();
      if (ptrs.current.size === 1) {
        const dx = (e.clientX - prev.x) / rect.width;
        const dy = (e.clientY - prev.y) / rect.height;
        ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        setItems((all) => all.map((i) => (i.id === activeIdRef.current
          ? { ...i, offX: clamp(i.offX + dx, -1.5, 1.5), offY: clamp(i.offY + dy, -1.5, 1.5) }
          : i)));
      } else if (ptrs.current.size === 2) {
        ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = Array.from(ptrs.current.values());
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist.current > 0 && d > 0) {
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          zoomAt(d / pinchDist.current, (mx - rect.left) / rect.width - 0.5, (my - rect.top) / rect.height - 0.5);
        }
        pinchDist.current = d;
      }
    };

    const onPointerEnd = (e) => {
      ptrs.current.delete(e.pointerId);
      pinchDist.current = 0;
    };

    // The wheel handler needs { passive:false } so the page doesn't scroll while zooming.
    useEffect(() => {
      const c = canvasRef.current;
      if (!c) return undefined;
      const onWheel = (e) => {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        zoomAt(Math.exp(-e.deltaY * 0.0015), (e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5);
      };
      c.addEventListener('wheel', onWheel, { passive: false });
      return () => c.removeEventListener('wheel', onWheel);
    }, [activeId, zoomAt]);

    // ----- export -----
    const fileNameFor = (it, blob, w, h) => `${baseName(it.name)}-${w}x${h}.${extFromType(blob.type)}`;

    const downloadActive = async () => {
      if (!active || busy) return;
      setBusy(true);
      say('Preparing…');
      try {
        const { blob, w, h } = await renderToBlob(active, fmt, quality / 100);
        saveBlob(blob, fileNameFor(active, blob, w, h));
        say(`Saved ${w} × ${h} px.`);
      } catch (e) { say(e.message || 'Could not save this photo.', true); }
      setBusy(false);
    };

    const downloadAll = async () => {
      if (!items.length || busy) return;
      setBusy(true);
      let done = 0;
      try {
        for (const it of itemsRef.current) {
          say(`Saving ${done + 1} of ${itemsRef.current.length}…`);
          const { blob, w, h } = await renderToBlob(it, fmt, quality / 100);
          saveBlob(blob, fileNameFor(it, blob, w, h));
          done += 1;
          await new Promise((r) => setTimeout(r, 400));
        }
        say(`Saved ${done} photo${done === 1 ? '' : 's'}. If your browser asked, allow multiple downloads.`);
      } catch (e) { say(`Stopped after ${done}: ${e.message || 'something went wrong'}`, true); }
      setBusy(false);
    };

    const canShare = typeof navigator !== 'undefined' && !!navigator.canShare && !!navigator.share;
    const shareAll = async () => {
      if (!items.length || busy) return;
      setBusy(true);
      say('Preparing…');
      try {
        const files = [];
        for (const it of itemsRef.current) {
          const { blob, w, h } = await renderToBlob(it, fmt, quality / 100);
          files.push(new File([blob], fileNameFor(it, blob, w, h), { type: blob.type }));
        }
        if (!navigator.canShare({ files })) { say('Your device cannot share these files. Use Download instead.', true); setBusy(false); return; }
        await navigator.share({ files });
        say('Shared.');
      } catch (e) {
        if (e && e.name === 'AbortError') say('');
        else say('Sharing was blocked by the browser. Use Download instead.', true);
      }
      setBusy(false);
    };

    // ---------- screen ----------
    const heading = (
      <div className="rs-head">
        <div>
          <div className="eyebrow"><Icon name="layout" className="ico-sm"/> Resize Studio · no crop, no background removal, collage</div>
          <h1 className="serif">Resize your photos, keep every edge.</h1>
          <p>Upload photos, pick a size, then zoom and drag each one into place. Your whole photo shows by default — nothing is cut off and the background is never touched.</p>
        </div>
        {items.length > 0 && (
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={() => inputRef.current && inputRef.current.click()}><Icon name="upload" className="ico-sm"/> Add photos</button>
            <button type="button" className="btn btn-ghost" onClick={clearAll}><Icon name="trash" className="ico-sm"/> Clear all</button>
          </div>
        )}
      </div>
    );

    const fileInput = (
      <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
        onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}/>
    );

    if (!active) {
      return (
        <div className="rs-page">
          <style>{STYLES}</style>
          {heading}
          {fileInput}
          <div className={'rs-drop' + (dragOver ? ' over' : '')}
            onClick={() => inputRef.current && inputRef.current.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}>
            <Icon name="upload" className="ico" style={{ width: 30, height: 30, color: 'var(--rose)' }}/>
            <div className="serif">Drop photos here, or tap to choose</div>
            <div className="rs-sub">Up to 50 photos · they stay on your device and are never uploaded</div>
          </div>
          {notice.text && <div className={'rs-notice' + (notice.err ? ' err' : '')} role="status">{notice.text}</div>}
        </div>
      );
    }

    const zoomPct = Math.round(active.zoom * 100);

    return (
      <div className="rs-page">
        <style>{STYLES}</style>
        {heading}
        {fileInput}
        <div className="rs-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={view === 'resize'} className={'rs-tab' + (view === 'resize' ? ' on' : '')} onClick={() => setView('resize')}>Resize</button>
          <button type="button" role="tab" aria-selected={view === 'collage'} className={'rs-tab' + (view === 'collage' ? ' on' : '')}
            disabled={items.length < 2} title={items.length < 2 ? 'Add at least two photos first' : 'Arrange your resized photos into one image'} onClick={() => setView('collage')}>Collage{items.length >= 2 ? ` · ${items.length}` : ''}</button>
        </div>
        {view === 'collage' && items.length >= 2 ? <CollageView items={items} fmt={fmt} quality={quality}/> : (
        <div className="rs-grid">
          <div>
            <div className="card rs-stage-card"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
              <div className="rs-stage">
                <canvas ref={canvasRef} className={'rs-canvas' + (isShaped(active) ? ' rs-canvas--alpha' : '')} aria-label="Preview. Drag to move the photo, scroll or pinch to zoom."
                  onPointerDown={onPointerDown} onPointerMove={onPointerMove}
                  onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}/>
              </div>
              <div className="rs-hint">Drag the photo to move it · scroll or pinch to zoom</div>
              <div className="rs-zoom-row">
                <button type="button" className="rs-iconbtn" aria-label="Zoom out" onClick={() => setZoomCentered(active.zoom / 1.1)}>−</button>
                <input type="range" min="10" max="400" step="1" value={clamp(zoomPct, 10, 400)} aria-label="Zoom"
                  onChange={(e) => setZoomCentered(Number(e.target.value) / 100)}/>
                <button type="button" className="rs-iconbtn" aria-label="Zoom in" onClick={() => setZoomCentered(active.zoom * 1.1)}>+</button>
                <span className="rs-zoom-val">{zoomPct}%</span>
              </div>
              <div className="rs-quick">
                <button type="button" className="btn btn-blush" onClick={fitWhole} title="Show the whole photo, nothing cropped">Fit whole photo</button>
                <button type="button" className="btn btn-ghost" onClick={fillFrame} title="Zoom until the frame is full (edges may be cut)">Fill frame</button>
                <button type="button" className="btn btn-ghost" onClick={centerPhoto}>Center</button>
              </div>
            </div>

            <div className="rs-strip">
              {items.map((it) => (
                <button key={it.id} type="button" className={'rs-thumb' + (it.id === activeId ? ' on' : '')} title={it.name}
                  onClick={() => setActiveId(it.id)}>
                  <img src={it.url} alt={it.name}/>
                  <span className="rs-x" role="button" aria-label={`Remove ${it.name}`}
                    onClick={(e) => { e.stopPropagation(); removeItem(it.id); }}>×</span>
                </button>
              ))}
              <button type="button" className="rs-add" aria-label="Add more photos" onClick={() => inputRef.current && inputRef.current.click()}>+</button>
            </div>
          </div>

          <div className="card rs-rail">
            <div className="rs-lbl">Size</div>
            <div className="chips">
              <button type="button" className={'chip' + (active.ratioId === 'photo' ? ' on' : '')}
                onClick={() => applyShared({ ratioId: 'photo' }, true)}>Same shape as photo</button>
              {ratios.map((r) => (
                <button key={r.id} type="button" className={'chip' + (active.ratioId === r.id ? ' on' : '')}
                  onClick={() => applyShared({ ratioId: r.id }, true)}>{r.id} · {r.label}</button>
              ))}
              <button type="button" className={'chip' + (active.ratioId === 'custom' ? ' on' : '')}
                onClick={() => applyShared({ ratioId: 'custom' }, true)}>Custom size</button>
              <button type="button" className={'chip' + (active.ratioId === 'quarter' ? ' on' : '')}
                onClick={() => applyShared({ ratioId: 'quarter' }, true)}>¼ Quarter circle</button>
            </div>

            {active.ratioId === 'quarter' && (
              <>
                <div className="rs-lbl">Which piece is this photo? <span className="hint">this photo only</span></div>
                <div className="rs-corners">
                  {CORNERS.map((c) => (
                    <button key={c.id} type="button" className={'rs-corner' + (active.quarterCorner === c.id ? ' on' : '')} onClick={() => setCorner(c.id)}>
                      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d={c.path} fill="currentColor"/></svg>
                      <span>{c.label}</span>
                    </button>
                  ))}
                </div>
                <div className="rs-note">Each piece saves as a see-through PNG square. Put the four squares together in a 2 × 2 to make the full circle (e.g. in Canva).</div>
              </>
            )}

            {active.ratioId === 'custom' ? (
              <div className="rs-custom">
                <input className="rs-num" inputMode="numeric" aria-label="Width in pixels" value={active.cwS}
                  onChange={(e) => applyShared({ cwS: e.target.value.replace(/[^\d]/g, '').slice(0, 4) }, true)}/>
                <span>×</span>
                <input className="rs-num" inputMode="numeric" aria-label="Height in pixels" value={active.chS}
                  onChange={(e) => applyShared({ chS: e.target.value.replace(/[^\d]/g, '').slice(0, 4) }, true)}/>
                <span>px</span>
              </div>
            ) : (
              <>
                <div className="rs-lbl">Longest side</div>
                <select className="rs-select" value={active.long} onChange={(e) => applyShared({ long: e.target.value }, false)}>
                  {LONG_EDGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </>
            )}

            <div className="rs-lbl">Space around the photo</div>
            <div className="rs-swatches">
              {FILLS.map((f) => (
                <button key={f.id} type="button" className={'rs-swatch' + (active.fillType === 'color' && active.fillColor.toLowerCase() === f.color.toLowerCase() ? ' on' : '')}
                  style={{ background: f.color }} title={f.label} aria-label={f.label}
                  onClick={() => applyShared({ fillType: 'color', fillColor: f.color }, false)}/>
              ))}
              <button type="button" className={'rs-swatch blur' + (active.fillType === 'blur' ? ' on' : '')}
                title="Blurred copy of the photo" aria-label="Blurred copy of the photo"
                onClick={() => applyShared({ fillType: 'blur' }, false)}/>
              <button type="button" className={'rs-swatch none' + (active.fillType === 'none' ? ' on' : '')}
                title="Transparent (saves as PNG)" aria-label="Transparent"
                onClick={() => applyShared({ fillType: 'none' }, false)}/>
              <input className="rs-color-input" type="color" aria-label="Pick any colour" value={/^#[0-9a-f]{6}$/i.test(active.fillColor) ? active.fillColor : '#ffffff'}
                onChange={(e) => applyShared({ fillType: 'color', fillColor: e.target.value }, false)}/>
            </div>

            <label className="rs-check">
              <input type="checkbox" checked={sameForAll} onChange={(e) => setSameForAll(e.target.checked)}/>
              <span>Use this size and background for all {items.length} photo{items.length === 1 ? '' : 's'}. Zoom and position stay separate for each photo.</span>
            </label>

            <div className="rs-lbl">Save as</div>
            <div className="chips">
              {[['jpeg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP']].map(([id, label]) => (
                <button key={id} type="button" className={'chip' + (fmt === id ? ' on' : '')} onClick={() => setFmt(id)}>{label}</button>
              ))}
            </div>
            {isShaped(active) && fmt === 'jpeg' && <div className="rs-note">This photo has see-through areas, so it will save as PNG.</div>}
            {fmt !== 'png' && (
              <div className="rs-zoom-row">
                <span className="rs-zoom-val" style={{ textAlign: 'left', minWidth: 52 }}>Quality</span>
                <input type="range" min="60" max="100" step="1" value={quality} onChange={(e) => setQuality(Number(e.target.value))} aria-label="Quality"/>
                <span className="rs-zoom-val">{quality}%</span>
              </div>
            )}

            <div className="rs-out">Output: <strong>{dims.w} × {dims.h} px</strong><br/>{active.iw} × {active.ih} px original · {active.name}</div>

            <div className="rs-actions">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={downloadActive}><Icon name="download" className="ico-sm"/> Download this photo</button>
              {items.length > 1 && <button type="button" className="btn btn-blush" disabled={busy} onClick={downloadAll}><Icon name="download" className="ico-sm"/> Download all {items.length}</button>}
              {canShare && <button type="button" className="btn btn-ghost" disabled={busy} onClick={shareAll}><Icon name="save" className="ico-sm"/> Share / save to phone</button>}
            </div>
            {notice.text && <div className={'rs-notice' + (notice.err ? ' err' : '')} role="status">{notice.text}</div>}
          </div>
        </div>
        )}
      </div>
    );
  };

  window.ResizeStudioPage = ResizeStudio;
})();
