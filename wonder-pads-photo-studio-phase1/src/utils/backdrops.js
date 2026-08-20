// Curated on-brand studio backdrops, rendered client-side via canvas — no
// AI, no assets to ship. Each preset has a CSS `swatch` (for the picker UI)
// and a `spec` consumed by paintBackdrop() below, which is the actual
// renderer used at export resolution.

export const BACKDROP_PRESETS = [
  {
    id: 'blush-paper',
    name: 'Blush Studio Paper',
    desc: 'Signature soft pink seamless',
    swatch: 'linear-gradient(180deg,#FBE9F5 0%,#F1CFEA 60%,#E1B4D3 100%)',
    spec: { type: 'paper', base: '#F1CFEA' },
  },
  {
    id: 'blush-radial',
    name: 'Blush Halo',
    desc: 'Soft radial spotlight on blush',
    swatch: 'radial-gradient(circle at 40% 35%, #FFECF6 0%, #F1CFEA 70%)',
    spec: { type: 'radial', center: '#FFECF6', edge: '#F1CFEA' },
  },
  {
    id: 'linen-neutral',
    name: 'Linen Neutral',
    desc: 'Oatmeal linen with soft vignette',
    swatch: '#EFE7DC',
    spec: { type: 'linen', base: '#EFE7DC' },
  },
  {
    id: 'sage-soft',
    name: 'Sage Soft',
    desc: 'Muted botanical sage',
    swatch: '#EAEFE5',
    spec: { type: 'sage', base: '#EAEFE5' },
  },
  {
    id: 'cream-paper',
    name: 'Cream Paper',
    desc: 'Warm neutral studio backdrop',
    swatch: 'linear-gradient(180deg,#FDF9F2 0%,#F3EADA 100%)',
    spec: { type: 'paper', base: '#F3EADA' },
  },
  {
    id: 'gradient-sunrise',
    name: 'Petal Gradient',
    desc: 'Pink to peach diagonal',
    swatch: 'linear-gradient(160deg,#F9E4F3 0%,#F5D2C5 100%)',
    spec: { type: 'linear', from: '#F9E4F3', to: '#F5D2C5', angle: 160 },
  },
];

function lighten(hex, amt) { return shift(hex, amt); }
function darken(hex, amt) { return shift(hex, -amt); }
function shift(hex, amt) {
  const n = hex.replace('#', '');
  const r = Math.max(0, Math.min(255, parseInt(n.slice(0, 2), 16) + amt));
  const g = Math.max(0, Math.min(255, parseInt(n.slice(2, 4), 16) + amt));
  const b = Math.max(0, Math.min(255, parseInt(n.slice(4, 6), 16) + amt));
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

// A faint film-grain texture, overlaid at low strength so flat presets
// (linen, sage) don't look like a flat digital fill.
function addNoise(ctx, W, H, strength) {
  const cell = document.createElement('canvas');
  cell.width = cell.height = 256;
  const cctx = cell.getContext('2d');
  const img = cctx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() - 0.5) * 255 * strength;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 128 + v;
    img.data[i + 3] = 22;
  }
  cctx.putImageData(img, 0, 0);
  const pattern = ctx.createPattern(cell, 'repeat');
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// Paints a backdrop spec into the given context, filling the whole
// W×H area. Ported from genspark's Wonder Pads Studio prototype.
export function paintBackdrop(ctx, spec, W, H) {
  const size = Math.max(W, H);
  if (!spec) return;

  if (spec.type === 'solid') {
    ctx.fillStyle = spec.color;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  if (spec.type === 'linear') {
    const angle = (spec.angle || 160) * Math.PI / 180;
    const cx = W / 2, cy = H / 2;
    const d = Math.max(W, H);
    const x0 = cx - Math.cos(angle) * d;
    const y0 = cy - Math.sin(angle) * d;
    const x1 = cx + Math.cos(angle) * d;
    const y1 = cy + Math.sin(angle) * d;
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, spec.from);
    g.addColorStop(1, spec.to);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  if (spec.type === 'radial') {
    const g = ctx.createRadialGradient(W * 0.4, H * 0.35, size * 0.05, W * 0.5, H * 0.5, size * 0.75);
    g.addColorStop(0, spec.center);
    g.addColorStop(1, spec.edge);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  if (spec.type === 'paper') {
    const base = spec.base || '#F9E4F3';
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, lighten(base, 6));
    g.addColorStop(0.6, base);
    g.addColorStop(1, darken(base, 8));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Soft seamless-paper shadow pooling toward the bottom.
    const b = ctx.createRadialGradient(W * 0.5, H * 0.9, size * 0.05, W * 0.5, H * 0.9, size * 0.55);
    b.addColorStop(0, 'rgba(60,40,55,.10)');
    b.addColorStop(1, 'rgba(60,40,55,0)');
    ctx.fillStyle = b;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  if (spec.type === 'linen') {
    ctx.fillStyle = spec.base || '#EFE7DC';
    ctx.fillRect(0, 0, W, H);
    addNoise(ctx, W, H, 0.08);
    const v = ctx.createRadialGradient(W * 0.5, H * 0.5, size * 0.3, W * 0.5, H * 0.5, size * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(80,60,50,.14)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  if (spec.type === 'sage') {
    ctx.fillStyle = spec.base || '#EAEFE5';
    ctx.fillRect(0, 0, W, H);
    addNoise(ctx, W, H, 0.05);
    return;
  }
}
