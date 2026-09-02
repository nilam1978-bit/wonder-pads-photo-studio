// Curated on-brand studio backdrops. Rendered client-side via canvas — no AI needed.
// Each backdrop returns a spec consumable by WPBGRemoval.composite().

const BACKDROPS = [
  {
    id: 'transparent',
    name: 'Transparent PNG',
    desc: 'Clean cutout for ecommerce, no backdrop',
    swatch: 'checker',
    spec: { type:'transparent' },
  },
  {
    id: 'blush-paper',
    name: 'Blush Studio Paper',
    desc: 'Signature soft pink seamless',
    swatch: 'linear-gradient(180deg,#FBE9F5 0%,#F1CFEA 60%,#E1B4D3 100%)',
    spec: { type:'paper', base:'#F1CFEA' },
  },
  {
    id: 'blush-solid',
    name: 'Blush Solid',
    desc: 'Flat brand pink',
    swatch: '#F1CFEA',
    spec: { type:'solid', color:'#F1CFEA' },
  },
  {
    id: 'blush-radial',
    name: 'Blush Halo',
    desc: 'Soft radial spotlight on blush',
    swatch: 'radial-gradient(circle at 40% 35%, #FFECF6 0%, #F1CFEA 70%)',
    spec: { type:'radial', center:'#FFECF6', edge:'#F1CFEA' },
  },
  {
    id: 'linen-neutral',
    name: 'Linen Neutral',
    desc: 'Oatmeal linen with soft vignette',
    swatch: '#EFE7DC',
    spec: { type:'linen', base:'#EFE7DC' },
  },
  {
    id: 'sage-soft',
    name: 'Sage Soft',
    desc: 'Muted botanical sage',
    swatch: '#EAEFE5',
    spec: { type:'sage', base:'#EAEFE5' },
  },
  {
    id: 'cream-paper',
    name: 'Cream Paper',
    desc: 'Warm neutral studio backdrop',
    swatch: 'linear-gradient(180deg,#FDF9F2 0%,#F3EADA 100%)',
    spec: { type:'paper', base:'#F3EADA' },
  },
  {
    id: 'white-catalog',
    name: 'Pure White',
    desc: 'Catalog / marketplace standard',
    swatch: '#FFFFFF',
    spec: { type:'solid', color:'#FFFFFF' },
  },
  {
    id: 'gradient-sunrise',
    name: 'Petal Gradient',
    desc: 'Pink to peach diagonal',
    swatch: 'linear-gradient(160deg,#F9E4F3 0%,#F5D2C5 100%)',
    spec: { type:'linear', from:'#F9E4F3', to:'#F5D2C5', angle:160 },
  },
];

// Default multi-backdrop set for the "generate 4 shots" flow
const DEFAULT_BATCH_IDS = ['blush-paper','linen-neutral','sage-soft','white-catalog'];

// Output aspect ratios — includes the social sizes small shops actually need.
const OUTPUT_RATIOS = [
  { id:'1:1',  label:'Square',      sub:'IG feed · catalog',  ratio:[1,1],  pxLabel:'1400 × 1400' },
  { id:'4:5',  label:'IG Portrait', sub:'Feed · higher reach',ratio:[4,5],  pxLabel:'1120 × 1400' },
  { id:'9:16', label:'IG Reel',     sub:'Reels · Stories · TikTok', ratio:[9,16], pxLabel:'788 × 1400' },
  { id:'16:9', label:'Landscape',   sub:'Web banner · YouTube', ratio:[16,9], pxLabel:'1400 × 788' },
  { id:'3:4',  label:'Portrait',    sub:'Pinterest',           ratio:[3,4],  pxLabel:'1050 × 1400' },
  { id:'4:3',  label:'Classic',     sub:'Product listing',    ratio:[4,3],  pxLabel:'1400 × 1050' },
];

window.BACKDROPS = BACKDROPS;
window.DEFAULT_BATCH_IDS = DEFAULT_BATCH_IDS;
window.OUTPUT_RATIOS = OUTPUT_RATIOS;
