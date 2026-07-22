// Looks at the actual pixels of a photo and suggests brightness/contrast/
// saturation slider values to fix the common "flat phone photo" problem —
// muted colors, washed-out or dim lighting. Returns values in the exact
// same -100..100 units the manual sliders use, so auto-enhance is really
// just "fill in the sliders for me" — you can still nudge them afterward.
export function computeAutoEnhance(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const step = 4; // sample every 4th pixel — plenty accurate, much faster
  const { data } = ctx.getImageData(0, 0, width, height);

  const luminances = [];
  let sumL = 0;
  let sumSat = 0;
  let count = 0;

  for (let i = 0; i < data.length; i += 4 * step) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    luminances.push(l);
    sumL += l;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    sumSat += sat;
    count += 1;
  }

  if (count === 0) return { brightness: 0, contrast: 0, saturation: 0 };

  luminances.sort((a, b) => a - b);
  const low = luminances[Math.floor(count * 0.01)];
  const high = luminances[Math.ceil(count * 0.99) - 1];
  const meanL = sumL / count;
  const meanSat = sumSat / count;

  const spread = Math.max(high - low, 1);
  const contrastFactor = Math.min(255 / spread, 2); // never boost more than 2x
  const contrast = Math.round(Math.max(0, (contrastFactor - 1) * 100));

  const target = 145;
  const brightness = Math.round(Math.max(-40, Math.min(40, ((target - meanL) / 255) * 150)));

  const saturation = meanSat < 0.3 ? Math.round(Math.min(40, (0.4 - meanSat) * 100)) : 0;

  return { brightness, contrast, saturation };
}
