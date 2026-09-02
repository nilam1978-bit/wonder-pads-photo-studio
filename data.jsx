// Preset data — the 5 branded photoshoot presets
const PRESETS = [
  {
    id: 'sewing-studio',
    name: 'Sewing Studio',
    thumb: 'assets/preset-sewing.jpg',
    status: 'live',
    tags: ['handmade', 'behind-the-scenes', 'warm'],
    lighting: 'Soft Window',
    lightingIntensity: 65,
    propDensity: 72,
    angle: 'Overhead',
    aspect: '4:3',
    updated: '2 days ago',
    uses: 148,
    prompt: 'Overhead flat lay product photo of {PRODUCT} on a warm wood sewing studio desk. Style with pastel thread spools in blush and sage, small brass scissors, a linen measuring tape, and a lace pin cushion. Soft natural window light from left. Boutique handmade aesthetic. Muted sage green and blush accents. High-end product photography, sharp focus on {PRODUCT}, dreamy warm tones.',
    negative: 'blurry, harsh shadows, plastic, synthetic, cluttered, dark, oversaturated, cartoon',
    author: 'Wonder Studio',
  },
  {
    id: 'blush-flatlay',
    name: 'Blush Pink Flat Lay',
    thumb: 'assets/preset-blush.jpg',
    status: 'live',
    tags: ['romantic', 'petals', 'signature'],
    lighting: 'Diffused Daylight',
    lightingIntensity: 78,
    propDensity: 55,
    angle: 'Overhead',
    aspect: '1:1',
    updated: '4 days ago',
    uses: 312,
    prompt: 'Overhead flat lay of {PRODUCT} on a blush pink linen backdrop. Scattered dried rose petals, delicate sprigs of babys breath, one small white ceramic dish beside the product. Minimal, feminine boutique styling. Soft diffused daylight. Pale pink and cream palette. Dreamy pastel product photography.',
    negative: 'blurry, harsh shadows, cluttered, dark, oversaturated, oversharpened, artificial',
    author: 'Wonder Studio',
  },
  {
    id: 'cozy-craft',
    name: 'Cozy Craft Desk',
    thumb: 'assets/preset-cozy.jpg',
    status: 'live',
    tags: ['lifestyle', 'homey', 'warm'],
    lighting: 'Golden Hour',
    lightingIntensity: 55,
    propDensity: 68,
    angle: 'Overhead',
    aspect: '4:3',
    updated: '1 week ago',
    uses: 89,
    prompt: 'Cozy craft desk scene from above. {PRODUCT} sits on a natural warm wood surface next to a small ceramic mug of tea, a sprig of eucalyptus, folded oatmeal linen napkin, and an open notebook. Soft afternoon golden light. Warm neutral tones with sage green accents. Artisan, handmade, lived-in aesthetic.',
    negative: 'blurry, sterile, harsh shadows, cluttered, dark, oversaturated',
    author: 'Wonder Studio',
  },
  {
    id: 'neutral-linen',
    name: 'Neutral Linen Lifestyle',
    thumb: 'assets/preset-linen.jpg',
    status: 'live',
    tags: ['minimal', 'editorial', 'neutral'],
    lighting: 'Diffused Daylight',
    lightingIntensity: 60,
    propDensity: 25,
    angle: 'Overhead',
    aspect: '4:3',
    updated: '5 days ago',
    uses: 204,
    prompt: 'Elegant, minimal flat lay of {PRODUCT} on natural oatmeal linen fabric with soft rippled folds and gentle shadows. A single sprig of olive leaves as an accent. Generous negative space. Luxury boutique lifestyle photography. Muted neutral tones, warm off-white and sage grey palette. Soft diffused daylight.',
    negative: 'blurry, cluttered, colorful, saturated, busy, dark, harsh',
    author: 'Wonder Studio',
  },
  {
    id: 'soft-studio',
    name: 'Soft Feminine Studio Backdrop',
    thumb: 'assets/preset-studio.jpg',
    status: 'draft',
    tags: ['catalog', 'clean', 'studio'],
    lighting: 'Studio Softbox',
    lightingIntensity: 82,
    propDensity: 10,
    angle: 'Three-Quarter',
    aspect: '1:1',
    updated: 'Just now',
    uses: 27,
    prompt: 'Soft feminine studio backdrop product photo. {PRODUCT} centered on a smooth blush pink gradient seamless paper backdrop. Gentle studio lighting from above left with a soft diffused shadow. Clean minimal styling, no props. Ecommerce catalog quality. Pink and cream color palette.',
    negative: 'blurry, cluttered, harsh shadows, colored gels, dark background',
    author: 'Wonder Studio',
  },
];

// Studio Presets are local composition recipes. Scene-prompt metadata is kept
// separately so it can be reused later without changing the reliable browser
// compositor workflow.
const STUDIO_PRESET_DEFAULTS = {
  ratio: '1:1',
  backdropIds: ['blush-paper','linen-neutral','sage-soft','white-catalog'],
  padding: 0.10,
  zoom: 1,
  labelText: '',
  labelPosition: 'bottom-left',
  labelSize: 'medium',
  labelBackground: true,
  labelColor: '#4D3245',
  labelBackgroundColor: '#FFF1F8',
  logoDataUrl: '',
  logoName: '',
  logoPosition: 'top-right',
  logoScale: 0.18,
  logoOpacity: 1,
};

const normalizeStudioPreset = (preset = {}) => {
  const studio = preset.studio || {};
  const scene = preset.scenePrompt || {};
  return {
    ...preset,
    studio: {
      ...STUDIO_PRESET_DEFAULTS,
      ratio: studio.ratio || (preset.aspect === '4:3' ? '4:3' : STUDIO_PRESET_DEFAULTS.ratio),
      backdropIds: Array.isArray(studio.backdropIds) && studio.backdropIds.length ? studio.backdropIds.slice(0,4) : STUDIO_PRESET_DEFAULTS.backdropIds.slice(),
      ...studio,
    },
    scenePrompt: {
      prompt: scene.prompt ?? preset.prompt ?? '',
      negative: scene.negative ?? preset.negative ?? '',
      lighting: scene.lighting ?? preset.lighting ?? 'Diffused Daylight',
      lightingIntensity: scene.lightingIntensity ?? preset.lightingIntensity ?? 60,
      propDensity: scene.propDensity ?? preset.propDensity ?? 30,
      angle: scene.angle ?? preset.angle ?? 'Overhead',
      aspect: scene.aspect ?? preset.aspect ?? '1:1',
    },
  };
};

const readStudioPresets = () => {
  try {
    const saved = JSON.parse(localStorage.getItem('wp_studio_presets') || 'null');
    if (Array.isArray(saved) && saved.length) return saved.map(normalizeStudioPreset);
  } catch (_) {}
  return PRESETS.map(normalizeStudioPreset);
};

const saveStudioPresets = (presets) => {
  const normalized = presets.map(normalizeStudioPreset);
  try { localStorage.setItem('wp_studio_presets', JSON.stringify(normalized)); } catch (_) {}
  window.dispatchEvent(new CustomEvent('wp-studio-presets-updated'));
  return normalized;
};

const LIGHTING_OPTIONS = ['Soft Window','Diffused Daylight','Golden Hour','Studio Softbox','Overcast'];
const ANGLE_OPTIONS = ['Overhead','Three-Quarter','Eye-Level','Macro Close-up'];
const ASPECT_OPTIONS = ['1:1','4:3','3:4','16:9'];

const PRESERVATION_ITEMS = [
  'Product shape locked',
  'Colors & print preserved',
  'Proportions maintained',
  'Stitching detail kept',
  'Snap button intact',
];

Object.assign(window, { PRESETS, LIGHTING_OPTIONS, ANGLE_OPTIONS, ASPECT_OPTIONS, PRESERVATION_ITEMS, STUDIO_PRESET_DEFAULTS, normalizeStudioPreset, readStudioPresets, saveStudioPresets });
