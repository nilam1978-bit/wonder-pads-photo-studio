// SCREEN 3 — Compress & Rename: deliberate batch compression + customer-facing fabric naming
const DEFAULT_FABRIC_CATEGORIES = [
  { value:'floral', label:'Floral' },
  { value:'animal', label:'Animal' },
  { value:'geometric', label:'Geometric' },
  { value:'abstract', label:'Abstract' },
  { value:'holiday', label:'Holiday' },
  { value:'plain', label:'Plain' },
  { value:'other', label:'Other' },
];
const DEFAULT_FABRIC_MATERIALS = ['100% Cotton Flannel','Woven Cotton Topper','Bamboo Terry','Organic Cotton'];
const readFabricList = (key, fallback) => {
  try { const parsed = JSON.parse(localStorage.getItem(key) || ''); return Array.isArray(parsed) && parsed.length ? parsed : fallback; }
  catch (_) { return fallback; }
};
const writeFabricList = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} };

const FABRIC_PRESETS = {
  standard: { label:'Standard', note:'1200px · 82% JPEG', maxDimension:1200, quality:.82 },
  web: { label:'Web light', note:'1600px · 78% JPEG', maxDimension:1600, quality:.78 },
  small: { label:'Small upload', note:'900px · 76% JPEG', maxDimension:900, quality:.76 },
};
const FABRIC_RTS_DEFAULTS = {
  padTypes:['Light','Liner','Regular Pad','Heavy / Overnight','Postpartum'],
  shapes:['Moon Rise','Contoured Hourglass','Wide Back Flare','Petite Liner','Standard Winged'],
};
const readFabricRtsOptions = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem('wp_rts_options') || '{}');
    return {
      padTypes:Array.from(new Set([...(FABRIC_RTS_DEFAULTS.padTypes || []), ...(parsed.padTypes || [])])),
      shapes:Array.from(new Set([...(FABRIC_RTS_DEFAULTS.shapes || []), ...(parsed.shapes || [])])),
    };
  } catch (_) { return FABRIC_RTS_DEFAULTS; }
};

const FABRIC_NAME_POOLS = {
  floral:['Meadow Bloom','Petal Meadow','Rosewater Garden','Wildflower Letter','Cottage Posy','Blush Botanica'],
  animal:['Woodland Story','Foxglove Friends','Meadow Fauna','Little Forest','Wildwood Keepsake','Bunny & Bloom'],
  geometric:['Quiet Geometry','Modern Petal','Soft Rhythm','Rose Grid','Measured Bloom','Gentle Lines'],
  abstract:['Cloud Study','Painterly Haze','Blush Current','Softly Abstract','Watercolour Drift','Quiet Daydream'],
  holiday:['Winter Market','Candlelit Holly','Merry Meadow','Frosted Berry','Harvest Ribbon','Seasonal Story'],
  plain:['Linen Neutral','Soft Cotton','Rose Blush','Natural Cream','Sage Quiet','Petal White'],
  other:['Garden Keepsake','Sunday Cloth','Heirloom Study','Soft Notion','Little Atelier','Kindred Cloth'],
};

const fabricSlug = (value) => String(value || 'fabric').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'fabric';
const fabricCategoryLabel = (value, categories=DEFAULT_FABRIC_CATEGORIES) => categories.find(option => option.value === value)?.label || 'Other';
const formatFabricBytes = (bytes) => {
  if (!bytes) return '0 B';
  const units = ['B','KB','MB','GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024,index)).toFixed(index ? 1 : 0)} ${units[index]}`;
};

const compressFabricImage = (file, options) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('Could not read this image.'));
  reader.onload = () => {
    const image = new Image();
    image.onerror = () => reject(new Error('Could not load this image for compression.'));
    image.onload = () => {
      const maxDimension = Number(options.maxDimension) || 1200;
      const quality = Math.min(1, Math.max(.1, Number(options.quality) || .82));
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas compression is unavailable.')); return; }
      ctx.fillStyle = '#fff'; ctx.fillRect(0,0,width,height);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image,0,0,width,height);
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('Could not create a compressed image.')); return; }
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({ dataUrl, blob, width, height, originalBytes:file.size, compressedBytes:blob.size, ratio:file.size ? Math.max(0, Math.round((1 - blob.size / file.size) * 100)) : 0 });
      }, 'image/jpeg', quality);
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
});

const fallbackFabricName = (category, index, existingNames=[]) => {
  const pool = FABRIC_NAME_POOLS[category] || FABRIC_NAME_POOLS.other;
  const available = pool.filter(name => !existingNames.includes(name));
  return (available.length ? available : pool)[index % (available.length || pool.length)];
};

const suggestFabricNameWithGemini = async ({dataUrl, category, material, avoid}) => {
  const key = window.WPGemini?.getKey?.() || '';
  if (!window.WPGemini?.hasKey?.()) return null;
  const base64 = String(dataUrl || '').split(',')[1] || '';
  if (!base64) throw new Error('Gemini could not read the compressed fabric image.');
  const prompt = `You are the naming editor for a small-batch reusable-cloth shop. Inspect the attached fabric photo carefully and create ONE distinctive customer-facing shop name for this exact print. Use the visible motif, repeat pattern, line quality, palette, and overall mood as inspiration; do not simply repeat the category or material. Category: ${category}. Material: ${material || 'woven cotton topper'}. Existing names to avoid: ${avoid.join(', ') || 'none'}. Return JSON only, with no markdown, in this exact shape: {"name":"Two To Four Word Title Case Name","category":"${category}"}. The name must be warm, memorable, easy to say, and suitable for a product card. Do not include the words AI, fabric, print, image, cotton, material, pattern, floral, animal, geometric, abstract, holiday, plain, or generic color names unless the image makes that word genuinely distinctive.`;
  const generated = await window.WPGemini?.generateNaming?.({prompt, dataUrl});
  if (!generated) throw new Error('Gemini naming helper is unavailable.');
  const text = generated.text || '';
  const objectText = text.replace(/```json|```/gi,'').trim().match(/\{[\s\S]*\}/)?.[0] || '';
  let parsed;
  try { parsed = JSON.parse(objectText); } catch (_) { throw new Error('Gemini returned an unreadable name response.'); }
  if (!parsed.name || typeof parsed.name !== 'string') throw new Error('Gemini returned no usable fabric name.');
  return { name:parsed.name.trim().replace(/\s+/g,' '), category:parsed.category || category, source:'Gemini' };
};

const namingErrorLabel = (error) => {
  const message = String(error?.message || error || 'Naming request failed');
  if (/401|403|key|api key|unauthorized|permission/i.test(message)) return 'Gemini key rejected';
  if (/BUSY|429|quota|rate|503|overloaded|high demand/i.test(message)) return 'Gemini busy — retried, using fallback';
  if (/MODEL\s+([^:]+):\s*(.*)/i.test(message)) {
    const match = message.match(/MODEL\s+([^:]+):\s*(.*)/i);
    return `Gemini failed on ${match[1]} — ${match[2].slice(0,90)}`;
  }
  if (/404|410|model/i.test(message)) return 'Gemini model unavailable';
  return `Gemini unavailable — ${message.slice(0,90)}`;
};

const FabricPrep = ({onGoto, initialFabricId}) => {
  const [items, setItems] = React.useState(() => readFabricList('wp_prepared_fabrics', []));
  const [preset, setPreset] = React.useState('standard');
  const [customDimension, setCustomDimension] = React.useState(1200);
  const [customQuality, setCustomQuality] = React.useState(82);
  const [skipCompression, setSkipCompression] = React.useState(false);
  const [targetMaxMb, setTargetMaxMb] = React.useState(0.4);
  const [batchNotice, setBatchNotice] = React.useState('');
  const [isBatchProcessing, setIsBatchProcessing] = React.useState(false);
  const [settingsTab, setSettingsTab] = React.useState('batch');
  const [batchTags, setBatchTags] = React.useState('');
  const [applyBatchTags, setApplyBatchTags] = React.useState(true);
  const [categoryOptions, setCategoryOptions] = React.useState(() => readFabricList('wp_fabric_categories', DEFAULT_FABRIC_CATEGORIES));
  const [materialOptions, setMaterialOptions] = React.useState(() => readFabricList('wp_fabric_materials', DEFAULT_FABRIC_MATERIALS));
  const [defaultCategory, setDefaultCategory] = React.useState(() => readFabricList('wp_fabric_categories', DEFAULT_FABRIC_CATEGORIES)[0]?.value || 'other');
  const [material, setMaterial] = React.useState(() => readFabricList('wp_fabric_materials', DEFAULT_FABRIC_MATERIALS)[0] || '');
  const [newCategory, setNewCategory] = React.useState('');
  const [newMaterial, setNewMaterial] = React.useState('');
  const [showOptionEditor, setShowOptionEditor] = React.useState(false);
  const [editingFabric, setEditingFabric] = React.useState(null);
  const [fabricEditorTab, setFabricEditorTab] = React.useState('details');
  const [fabricEditorNotice, setFabricEditorNotice] = React.useState('');
  const [rtsPadDraft, setRtsPadDraft] = React.useState(null);
  const fabricImageInputRef = React.useRef(null);
  React.useEffect(() => { writeFabricList('wp_fabric_categories', categoryOptions); }, [categoryOptions]);
  React.useEffect(() => { writeFabricList('wp_fabric_materials', materialOptions); }, [materialOptions]);
  React.useEffect(() => {
    const portable = items.map(({id,fileName,originalBytes,compressedUrl,compressedBytes,ratio,width,height,category,collection,colorHex,material,tags,inStock,originalUrl,name,nameSource,status,namingNote,createdAt}) => ({id,fileName,originalBytes,compressedUrl,compressedBytes,ratio,width,height,category,collection:collection || category,colorHex:colorHex || '#F4B8C1',material,tags:tags || '',inStock:inStock !== false,originalUrl,name,nameSource,status,namingNote,createdAt:createdAt || Date.now()}));
    writeFabricList('wp_prepared_fabrics', portable);
    window.dispatchEvent(new CustomEvent('wp-fabrics-updated'));
    window.dispatchEvent(new CustomEvent('wp-overview-updated'));
  }, [items]);

  const [geminiKey, setGeminiKey] = React.useState(() => window.WPGemini?.hasKey?.() ? (window.WPGemini?.getKey?.() || 'proxy') : '');
  const [geminiModel, setGeminiModel] = React.useState({status:'idle', model:'', displayName:''});
  const [keyDraft, setKeyDraft] = React.useState('');
  const [showKeyInput, setShowKeyInput] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const inputRef = React.useRef(null);
  const nameCounter = React.useRef(0);

  const compression = preset === 'custom'
    ? { label:'Custom', note:`${customDimension}px · ${customQuality}% JPEG`, maxDimension:Number(customDimension), quality:Number(customQuality)/100 }
    : FABRIC_PRESETS[preset];

  const existingNames = items.map(item => item.name).filter(Boolean);
  const updateItem = (id, patch) => setItems(prev => prev.map(item => item.id === id ? {...item, ...patch} : item));
  const addCategoryOption = () => {
    const label = newCategory.trim();
    if (!label) return;
    const value = fabricSlug(label);
    if (categoryOptions.some(option => option.value === value)) return;
    const next = [...categoryOptions, {value, label}];
    setCategoryOptions(next); setDefaultCategory(value); setNewCategory('');
  };
  const renameCategoryOption = (value, label) => {
    const clean = label.trim();
    if (!clean) return;
    setCategoryOptions(prev => prev.map(option => option.value === value ? {...option, label:clean} : option));
  };
  const removeCategoryOption = (value) => {
    if (categoryOptions.length <= 1) return;
    const next = categoryOptions.filter(option => option.value !== value);
    setCategoryOptions(next);
    if (defaultCategory === value) setDefaultCategory(next[0].value);
    setItems(prev => prev.map(item => item.category === value ? {...item, category:next[0].value} : item));
  };
  const addMaterialOption = () => {
    const value = newMaterial.trim();
    if (!value || materialOptions.includes(value)) return;
    setMaterialOptions(prev => [...prev, value]); setMaterial(value); setNewMaterial('');
  };
  const renameMaterialOption = (previous, nextValue) => {
    const clean = nextValue.trim();
    if (!clean || materialOptions.includes(clean)) return;
    setMaterialOptions(prev => prev.map(option => option === previous ? clean : option));
    if (material === previous) setMaterial(clean);
  };
  const removeMaterialOption = (value) => {
    if (materialOptions.length <= 1) return;
    const next = materialOptions.filter(option => option !== value);
    setMaterialOptions(next);
    if (material === value) setMaterial(next[0]);
  };

  const processFile = (file) => {
    const id = `fabric-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    const item = { id, file, fileName:file.name, originalBytes:file.size, createdAt:Date.now(), originalUrl:URL.createObjectURL(file), compressedUrl:'', compressedBytes:0, ratio:0, width:0, height:0, category:defaultCategory, collection:defaultCategory, colorHex:'#F4B8C1', material, tags:'', inStock:true, name:'', nameSource:'Waiting', status:'staged', preset:compression.label, error:'' };
    setItems(prev => [item, ...prev]);
  };

  const addFiles = (fileList) => {
    const files = Array.from(fileList || []).filter(file => file.type.startsWith('image/'));
    if (files.length) setBatchNotice(`${files.length} photo${files.length === 1 ? '' : 's'} staged. Review settings, then press Compress Batch.`);
    files.forEach(processFile);
  };

  const compressBatch = async () => {
    const pending = items.filter(item => item.status === 'staged' || item.status === 'error');
    if (!pending.length) { setBatchNotice('Add photos before compressing the batch.'); return; }
    setIsBatchProcessing(true); setBatchNotice(`Compressing ${pending.length} photo${pending.length === 1 ? '' : 's'}…`);
    for (const item of pending) {
      updateItem(item.id, {status:'compressing', error:'', preset:skipCompression ? 'Original size' : compression.label, ...(applyBatchTags ? {tags:batchTags.trim()} : {})});
      try {
        if (skipCompression) {
          const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload=()=>resolve(String(reader.result || '')); reader.onerror=()=>reject(new Error('Could not read this image.')); reader.readAsDataURL(item.file); });
          updateItem(item.id, {compressedUrl:dataUrl, compressedBytes:item.originalBytes, width:0, height:0, ratio:0, status:'compressed', nameSource:'Waiting for naming'});
        } else {
          const compressed = await compressFabricImage(item.file, compression);
          updateItem(item.id, {compressedUrl:compressed.dataUrl, compressedBytes:compressed.compressedBytes, width:compressed.width, height:compressed.height, ratio:compressed.ratio, status:'compressed', preset:compression.label, nameSource:'Waiting for naming'});
        }
      } catch (error) { updateItem(item.id, {status:'error', error:error.message || 'Unable to compress this image.'}); }
    }
    setIsBatchProcessing(false); setBatchNotice('Compression complete. Open a compressed photo to rename it or create an RTS pad.');
  };

  const regenerateName = async (item) => {
    updateItem(item.id, { status:'analyzing', nameSource:'Regenerating…' });
    const avoid = items.map(entry => entry.name).filter(name => name && name !== item.name);
    let suggestion = null;
    let namingNote = '';
    try { suggestion = await suggestFabricNameWithGemini({dataUrl:item.compressedUrl, category:item.category, material:item.material, avoid:[...avoid, item.name]}); }
    catch (error) { namingNote = namingErrorLabel(error); console.warn('Fabric Gemini regeneration failed:', error); }
    const fallback = fallbackFabricName(item.category, nameCounter.current++, [...avoid, item.name]);
    updateItem(item.id, { name:suggestion?.name || fallback, nameSource:suggestion?.source || (namingNote ? `Fallback · ${namingNote}` : 'Local suggestion'), namingNote, status:'ready' });
  };

  const removeItem = (id) => setItems(prev => prev.filter(item => item.id !== id));
  const saveGeminiKey = () => {
    const value = keyDraft.trim();
    if (!value || !window.WPGemini?.setKey) return;
    window.WPGemini.setKey(value);
    setGeminiKey(value);
    setKeyDraft('');
    setShowKeyInput(false);
  };
  const clearGeminiKey = () => {
    if (window.WPGemini?.getKey?.()) window.WPGemini?.setKey?.('');
    setGeminiKey(window.WPGemini?.hasKey?.() ? 'proxy' : '');
  };
  const downloadItem = (item) => {
    if (!item.compressedUrl) return;
    const anchor = document.createElement('a'); anchor.href = item.compressedUrl; anchor.download = `${fabricSlug(item.name || item.fileName)}.jpg`; anchor.click();
  };
  const downloadPrepared = () => items.filter(item => item.compressedUrl).forEach((item, index) => setTimeout(() => downloadItem(item), index * 180));
  const openFabricEditor = (item, tab='details') => {
    const next = {
      ...item,
      collection:item.collection || item.category || defaultCategory,
      colorHex:item.colorHex || '#F4B8C1',
      tags:item.tags || '',
      inStock:item.inStock !== false,
    };
    setEditingFabric(next);
    setFabricEditorTab(tab);
    setFabricEditorNotice('');
    if (tab === 'rts') {
      const rtsOptions = readFabricRtsOptions();
      setRtsPadDraft({
        listingName:next.name || '',
        suggestedName:`${next.name || 'New fabric'} · Light · 8 inches · ${rtsOptions.shapes[0] || 'Moon Rise'}`,
        padType:rtsOptions.padTypes[0] || 'Light',
        size:'8 inches',
        shape:rtsOptions.shapes[0] || 'Moon Rise',
        price:'$8.00',
        details:`Made with ${next.name || 'this fabric'}`,
        available:true,
        padPhoto:'',
      });
    }
  };
  const closeFabricEditor = () => { setEditingFabric(null); setRtsPadDraft(null); setFabricEditorNotice(''); };
  const handoffConsumedRef = React.useRef('');
  React.useEffect(() => {
    if (!initialFabricId || handoffConsumedRef.current === initialFabricId) return;
    const match = items.find(item => item.id === initialFabricId);
    if (!match) return;
    handoffConsumedRef.current = initialFabricId;
    openFabricEditor(match, 'rts');
  }, [initialFabricId, items]);
  const updateEditingFabric = (patch) => setEditingFabric(prev => prev ? {...prev, ...patch} : prev);
  const saveFabricDetails = () => {
    if (!editingFabric) return;
    const patch = {
      name:editingFabric.name || 'Untitled fabric',
      category:editingFabric.category || editingFabric.collection || defaultCategory,
      collection:editingFabric.collection || editingFabric.category || defaultCategory,
      colorHex:editingFabric.colorHex || '#F4B8C1',
      material:editingFabric.material || material,
      tags:editingFabric.tags || '',
      inStock:editingFabric.inStock !== false,
    };
    updateItem(editingFabric.id, patch);
    setEditingFabric(prev => prev ? {...prev, ...patch} : prev);
    setFabricEditorNotice('Fabric details saved');
  };
  const handleFabricImageChange = (event) => {
    const file = event.target.files?.[0];
    if (!file || !editingFabric) return;
    const reader = new FileReader();
    reader.onload = () => {
      const imageUrl = String(reader.result || '');
      updateItem(editingFabric.id, {compressedUrl:imageUrl, fileName:file.name});
      setEditingFabric(prev => prev ? {...prev, compressedUrl:imageUrl, fileName:file.name} : prev);
      setFabricEditorNotice('Fabric image updated');
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };
  const handlePadPhotoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setRtsPadDraft(prev => prev ? {...prev, padPhoto:String(reader.result || '')} : prev);
    reader.readAsDataURL(file);
    event.target.value = '';
  };
  const openRtsTab = () => {
    if (!editingFabric) return;
    const options = readFabricRtsOptions();
    setFabricEditorTab('rts');
    setRtsPadDraft(prev => prev || {
      listingName:editingFabric.name || '',
      suggestedName:`${editingFabric.name || 'New fabric'} · Light · 8 inches · ${options.shapes[0] || 'Moon Rise'}`,
      padType:options.padTypes[0] || 'Light',
      size:'8 inches',
      shape:options.shapes[0] || 'Moon Rise',
      price:'$8.00',
      details:`Made with ${editingFabric.name || 'this fabric'}`,
      available:true,
      padPhoto:'',
    });
  };
  const createRtsPadFromFabric = () => {
    if (!editingFabric || !rtsPadDraft) return;
    const cleanName = (rtsPadDraft.listingName || editingFabric.name || 'Ready-made pad').trim();
    const listing = {
      id:`rts-${Date.now()}`,
      fabricId:editingFabric.id,
      fabricName:editingFabric.name || 'Unnamed fabric',
      imageUrl:editingFabric.compressedUrl || editingFabric.originalUrl || '',
      title:cleanName,
      padType:rtsPadDraft.padType || 'Light',
      shape:rtsPadDraft.shape || 'Moon Rise',
      size:rtsPadDraft.size || '8 inches',
      absorbency:rtsPadDraft.padType || 'Light',
      placement:'Centered Motif',
      quantity:1,
      notes:rtsPadDraft.details || '',
      mode:'reference-modal',
      price:rtsPadDraft.price || '$8.00',
      details:rtsPadDraft.details || '',
      available:rtsPadDraft.available !== false,
      padPhotoUrl:rtsPadDraft.padPhoto || '',
      createdAt:new Date().toISOString(),
    };
    let listings = [];
    try { listings = JSON.parse(localStorage.getItem('wp_rts_listings') || '[]'); } catch (_) {}
    if (!Array.isArray(listings)) listings = [];
    localStorage.setItem('wp_rts_listings', JSON.stringify([listing, ...listings]));
    window.dispatchEvent(new CustomEvent('wp-rts-listings-updated'));
    setFabricEditorNotice('RTS pad created — saved with this fabric and visible in Overview');
    window.setTimeout(closeFabricEditor, 700);
  };

  const galleryItems = [...items.filter(item => !item.compressedUrl), ...items.filter(item => item.compressedUrl)];
  const stats = {
    count:items.length,
    ready:items.filter(item => item.status === 'compressed' || item.status === 'ready').length,
    original:items.reduce((sum,item) => sum + (item.originalBytes || 0),0),
    compressed:items.reduce((sum,item) => sum + (item.compressedBytes || 0),0),
  };
  const savedPercent = stats.original ? Math.max(0, Math.round((1 - stats.compressed / stats.original) * 100)) : 0;
  const stagedItems = items.filter(item => !item.compressedUrl);
  const compressedItems = items.filter(item => item.compressedUrl);
  const renderFabricCard = (item) => <article className="fabric-item-card" key={item.id}>
    <div className="fabric-item-preview">{item.compressedUrl ? <img src={item.compressedUrl} alt={item.name || item.fileName}/> : item.originalUrl ? <img src={item.originalUrl} alt={item.fileName}/> : <div className="fabric-item-wait"><span className="spinner"/></div>}<span className={'fabric-status '+item.status}>{item.status==='analyzing'?'Naming…':item.status==='compressing'?'Compressing…':item.status==='staged'?'Waiting':'Ready'}</span></div>
    <div className="fabric-item-body">{item.error ? <div className="fabric-item-error">{item.error}</div> : <><div className="fabric-item-title">{item.name || (item.status==='staged' ? 'Waiting for compression' : 'Ready for naming')}</div><div className="fabric-item-file" title={item.fileName}>Source · {item.fileName}</div><div className="fabric-card-settings"><label><span>CATEGORY</span><select value={item.category || defaultCategory} onChange={event=>updateItem(item.id,{category:event.target.value,collection:event.target.value})}>{categoryOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label><span>MATERIAL</span><select value={item.material || material} onChange={event=>updateItem(item.id,{material:event.target.value})}>{materialOptions.map(option=><option key={option} value={option}>{option}</option>)}</select></label><label className="fabric-card-tags"><span>TAGS</span><input value={item.tags || ''} placeholder="floral, pink" onChange={event=>updateItem(item.id,{tags:event.target.value})}/></label><label className="fabric-card-stock"><input type="checkbox" checked={item.inStock !== false} onChange={event=>updateItem(item.id,{inStock:event.target.checked})}/><span>In stock</span></label></div>{item.compressedUrl && <div className="fabric-item-meta">{item.nameSource} · {formatFabricBytes(item.originalBytes)} → {formatFabricBytes(item.compressedBytes)} · {item.ratio}% smaller</div>}{item.namingNote && <div className="fabric-name-note">{item.namingNote} · using fallback name</div>}<div className="fabric-item-actions">{item.compressedUrl ? <><label className="fabric-manual-name"><span>FILE NAME</span><input value={item.name || ''} placeholder="Enter fabric file name" onChange={event=>updateItem(item.id,{name:event.target.value,nameSource:'Manual filename',status:'ready'})}/></label><div className="fabric-action-buttons"><button type="button" className="btn btn-ghost fabric-action-btn" title="Create RTS Pad" aria-label="Create RTS Pad" onClick={()=>openFabricEditor(item,'rts')}><Icon name="tag" className="ico-sm"/><span className="fabric-action-label">Create RTS Pad</span></button><button type="button" className="btn btn-ghost fabric-action-btn" title="Save JPG" aria-label="Save JPG" onClick={()=>downloadItem(item)}><Icon name="download" className="ico-sm"/><span className="fabric-action-label">Save JPG</span></button><button type="button" className="btn btn-ghost fabric-action-btn fabric-action-danger" title="Remove" aria-label="Remove" onClick={()=>removeItem(item.id)}><Icon name="trash" className="ico-sm"/><span className="fabric-action-label">Remove</span></button></div></> : <><span className="muted small">Waiting for Compress Batch</span><button type="button" className="btn btn-ghost fabric-action-btn fabric-action-danger" title="Remove" aria-label="Remove" onClick={()=>removeItem(item.id)}><Icon name="trash" className="ico-sm"/><span className="fabric-action-label">Remove</span></button></>}</div>{item.compressedUrl && <div className="fabric-rts-handoff"><Icon name="tag" className="ico-sm"/><span>RTS name: <strong>{item.name || 'Name this fabric first'}</strong></span></div>}</>}</div>
  </article>;

  return (
    <div className="fabric-prep-page">
      <div className="page-heading fabric-prep-heading">
        <div>
          <div className="eyebrow"><Icon name="sparkles" className="ico-sm"/> Compress &amp; Rename · fabric workflow</div>
          <h1 className="serif">Compress and name your fabrics.</h1>
          <p className="muted">Stage a batch, choose your settings, explicitly compress the photos, then rename each result or create an RTS pad.</p>
        </div>
        <div className="row fabric-prep-heading-actions">
          <button type="button" className="btn btn-ghost" onClick={() => inputRef.current?.click()}><Icon name="upload" className="ico-sm"/> Add fabrics</button>
          <button type="button" className="btn btn-primary" disabled={!stats.ready} onClick={downloadPrepared}><Icon name="download" className="ico-sm"/> Save prepared</button>
        </div>
      </div>

      <div className="fabric-prep-layout fabric-prep-layout-stacked">
        <section className="card fabric-prep-intake">
          <div className="row between fabric-prep-section-head">
            <div><div className="serif" style={{fontSize:21}}>1. Choose fabric photos</div><div className="muted small">Photos are staged only. Nothing compresses until you press Compress Batch.</div></div>
            <span className="pill pill-sage"><Icon name="check" className="ico-sm"/> {stats.ready} ready</span>
          </div>
          <div className={'fabric-dropzone'+(isDragging?' dragging':'')} onDragOver={(event)=>{event.preventDefault();setIsDragging(true);}} onDragLeave={()=>setIsDragging(false)} onDrop={(event)=>{event.preventDefault();setIsDragging(false);addFiles(event.dataTransfer.files);}}>
            <Icon name="upload" className="ico-lg"/>
            <div className="serif" style={{fontSize:20}}>Drop fabric photos here</div>
            <div className="muted small">PNG, JPG or WEBP · batch upload · original file stays local</div>
            <button type="button" className="btn btn-blush" onClick={()=>inputRef.current?.click()}>Browse fabrics</button>
            <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event)=>{addFiles(event.target.files); event.target.value='';}}/>
          </div>
          <div className="fabric-prep-stats">
            <div><span className="eyebrow">FILES</span><strong>{stats.count}</strong></div>
            <div><span className="eyebrow">COMPRESSED</span><strong>{formatFabricBytes(stats.compressed)}</strong></div>
            <div><span className="eyebrow">SAVED</span><strong>{savedPercent}%</strong></div>
          </div>
        </section>

        <aside className="card fabric-prep-settings">
          <div className="serif" style={{fontSize:21}}>2. Set up your batch</div>
          <div className="muted small" style={{marginTop:3}}>Choose every setting first, then explicitly compress the staged gallery.</div>
          <div className="fabric-settings-panel">
            <div className="refine-mini-label">COMPRESSION</div>
            <div className="fabric-preset-list">{Object.entries(FABRIC_PRESETS).map(([key, option]) => <button type="button" key={key} className={'fabric-preset'+(preset===key?' selected':'')} onClick={()=>setPreset(key)}><span>{option.label}</span><small>{option.note}</small></button>)}<button type="button" className={'fabric-preset'+(preset==='custom'?' selected':'')} onClick={()=>setPreset('custom')}><span>Custom</span><small>Active refinement values</small></button></div>
            <label className="fabric-modal-check fabric-skip-compression"><input type="checkbox" checked={skipCompression} onChange={event=>setSkipCompression(event.target.checked)}/><span>Skip compression — keep original size</span></label>
            <div className="fabric-custom-sliders"><label className="fabric-range-field"><span><b>MAX WIDTH / HEIGHT</b><output>{customDimension}px</output></span><input type="range" min="600" max="4000" step="50" value={customDimension} onChange={event=>setCustomDimension(event.target.value)}/></label><label className="fabric-range-field"><span><b>TARGET MAX SIZE</b><output>{targetMaxMb} MB</output></span><input type="range" min="0.1" max="2" step="0.1" value={targetMaxMb} onChange={event=>setTargetMaxMb(event.target.value)}/></label><label className="fabric-range-field"><span><b>STARTING QUALITY</b><output>{customQuality}%</output></span><input type="range" min="30" max="100" step="1" value={customQuality} onChange={event=>setCustomQuality(event.target.value)}/></label></div>
            <div className="fabric-batch-tags"><div className="refine-mini-label">BATCH TAGS</div><input type="text" value={batchTags} onChange={event=>setBatchTags(event.target.value)} placeholder="e.g. Ready Made, wpfabrics"/><label className="fabric-modal-check"><input type="checkbox" checked={applyBatchTags} onChange={event=>setApplyBatchTags(event.target.checked)}/><span>Apply to all compressed photos</span></label></div>
            <button type="button" className="btn btn-primary fabric-compress-batch" disabled={isBatchProcessing || !items.some(item=>item.status==='staged'||item.status==='error')} onClick={compressBatch}><Icon name="sparkles" className="ico-sm"/> {isBatchProcessing ? 'Compressing batch…' : `Compress Batch${items.filter(item=>item.status==='staged'||item.status==='error').length ? ` · ${items.filter(item=>item.status==='staged'||item.status==='error').length}` : ''}`}</button>{batchNotice && <div className="fabric-batch-notice">{batchNotice}</div>}
          </div>
          <div className="fabric-settings-panel">
            <div className="row between"><div className="refine-mini-label">DEFAULT FABRIC DETAILS</div><button type="button" className="text-button" onClick={()=>setShowOptionEditor(value=>!value)}>{showOptionEditor?'Close editor':'Edit lists'}</button></div>
            <label className="refine-field" style={{marginTop:7}}><span>CATEGORY</span><select value={defaultCategory} onChange={event=>setDefaultCategory(event.target.value)}>{categoryOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className="refine-field" style={{marginTop:8}}><span>MATERIAL</span><select value={material} onChange={event=>setMaterial(event.target.value)}>{materialOptions.map(option=><option key={option} value={option}>{option}</option>)}</select></label>
            {showOptionEditor && <div className="fabric-options-editor"><div className="fabric-option-group"><div className="refine-mini-label">CATEGORIES</div>{categoryOptions.map(option=><div className="fabric-option-row" key={option.value}><input value={option.label} onChange={event=>renameCategoryOption(option.value,event.target.value)} onBlur={event=>renameCategoryOption(option.value,event.target.value)}/><button type="button" className="text-button danger" disabled={categoryOptions.length<=1} onClick={()=>removeCategoryOption(option.value)}>Remove</button></div>)}<div className="fabric-option-add"><input value={newCategory} onChange={event=>setNewCategory(event.target.value)} placeholder="Add a category"/><button type="button" className="btn btn-ghost" onClick={addCategoryOption}>Add</button></div></div><div className="fabric-option-group"><div className="refine-mini-label">MATERIALS</div>{materialOptions.map(option=><div className="fabric-option-row" key={option}><input value={option} onChange={event=>renameMaterialOption(option,event.target.value)} onBlur={event=>renameMaterialOption(option,event.target.value)}/><button type="button" className="text-button danger" disabled={materialOptions.length<=1} onClick={()=>removeMaterialOption(option)}>Remove</button></div>)}<div className="fabric-option-add"><input value={newMaterial} onChange={event=>setNewMaterial(event.target.value)} placeholder="Add a material"/><button type="button" className="btn btn-ghost" onClick={addMaterialOption}>Add</button></div></div></div>}
          </div>
        </aside>
      </div>

      <section className="card fabric-gallery-card">
        <div className="row between fabric-gallery-head"><div><div className="serif" style={{fontSize:22}}>Fabric preparation gallery</div><div className="muted small">Upload first, explicitly compress second, then open a completed photo for naming or RTS creation.</div></div><span className="pill">{compression.label} · {compression.maxDimension}px · {Math.round(compression.quality*100)}%</span></div>
        {!items.length ? <div className="fabric-empty"><Icon name="photo" className="ico-lg"/><div className="serif" style={{fontSize:19}}>Your staged fabric photos will appear here</div><div className="muted small">Choose one or more photos, set the batch options, and press Compress Batch.</div></div> : <>
          {stagedItems.length > 0 && <div className="fabric-gallery-stage"><div className="fabric-gallery-stage-head"><div><div className="refine-mini-label">STAGED UPLOAD GALLERY</div><div className="muted small">These images are waiting. Uploading did not start compression.</div></div><span className="pill">{stagedItems.length} waiting</span></div><div className="fabric-gallery-grid">{stagedItems.map(renderFabricCard)}</div></div>}
          {compressedItems.length > 0 && <div className="fabric-gallery-stage fabric-gallery-results"><div className="fabric-gallery-stage-head"><div><div className="refine-mini-label">READY FOR NAMING &amp; LISTING</div><div className="muted small">Edit fabric settings in the card, or open Create RTS Pad for the selected fabric.</div></div><span className="pill pill-sage">{compressedItems.length} complete</span></div><div className="fabric-gallery-grid">{compressedItems.map(renderFabricCard)}</div></div>}
        </>}
      </section>

      {editingFabric && <div className="fabric-editor-overlay" role="dialog" aria-modal="true" aria-label="Create RTS Pad">
        <div className="fabric-editor-modal">
          <div className="fabric-editor-head">
            <div className="serif fabric-editor-title">Create RTS Pad</div>
            <button type="button" className="fabric-editor-close" onClick={closeFabricEditor} aria-label="Close Create RTS Pad">×</button>
          </div>
          {false ? <div className="fabric-editor-body">
            <label className="fabric-modal-field"><span>Name</span><input value={editingFabric.name || ''} onChange={event=>updateEditingFabric({name:event.target.value, nameSource:'Edited by you'})} placeholder="Enter a customer-facing name"/></label>
            <label className="fabric-modal-field"><span>Collection</span><select value={editingFabric.collection || editingFabric.category || defaultCategory} onChange={event=>updateEditingFabric({collection:event.target.value, category:event.target.value})}>{categoryOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <div className="fabric-modal-field-grid">
              <label className="fabric-modal-field"><span>Colour Hex</span><input value={editingFabric.colorHex || '#F4B8C1'} onChange={event=>updateEditingFabric({colorHex:event.target.value})} placeholder="#F4B8C1"/></label>
              <label className="fabric-modal-field"><span>Material</span><select value={editingFabric.material || material} onChange={event=>updateEditingFabric({material:event.target.value})}>{materialOptions.map(option=><option key={option}>{option}</option>)}</select></label>
            </div>
            <label className="fabric-modal-field"><span>Tags <small>(comma-separated)</small></span><input value={editingFabric.tags || ''} onChange={event=>updateEditingFabric({tags:event.target.value})} placeholder="floral, pink"/></label>
            <label className="fabric-modal-check"><input type="checkbox" checked={editingFabric.inStock !== false} onChange={event=>updateEditingFabric({inStock:event.target.checked})}/><span>In Stock</span></label>
            <div className="fabric-modal-section-label">Fabric image</div>
            <div className="fabric-modal-image-row">
              <div className="fabric-modal-image-preview">{editingFabric.compressedUrl ? <img src={editingFabric.compressedUrl} alt={editingFabric.name || editingFabric.fileName}/> : <Icon name="photo" className="ico-lg"/>}</div>
              <div className="fabric-modal-image-actions"><button type="button" className="btn btn-ghost" onClick={()=>fabricImageInputRef.current?.click()}><Icon name="refresh" className="ico-sm"/> Change image</button><button type="button" className="btn btn-ghost" onClick={()=>fabricImageInputRef.current?.click()}><Icon name="upload" className="ico-sm"/> Upload from device</button><input ref={fabricImageInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleFabricImageChange}/></div>
            </div>
            {fabricEditorNotice && <div className="fabric-editor-notice"><Icon name="check" className="ico-sm"/> {fabricEditorNotice}</div>}
            <button type="button" className="btn btn-blush fabric-editor-primary" onClick={saveFabricDetails}>Save Changes</button>
          </div> : <div className="fabric-editor-body">
            <div className="fabric-modal-source"><span>FABRIC</span><strong>{editingFabric.name || 'Unnamed fabric'}</strong></div>
            <label className="fabric-modal-field"><span>RTS Listing Name</span><input value={rtsPadDraft?.listingName || ''} onChange={event=>setRtsPadDraft(prev=>({...prev, listingName:event.target.value}))}/></label>
            <button type="button" className="fabric-suggestion" onClick={()=>setRtsPadDraft(prev=>({...prev, listingName:prev.suggestedName}))}>Use suggested name: <strong>{rtsPadDraft?.suggestedName || editingFabric.name}</strong></button>
            <div className="fabric-modal-field-grid">
              <label className="fabric-modal-field"><span>Pad Type</span><select value={rtsPadDraft?.padType || ''} onChange={event=>setRtsPadDraft(prev=>({...prev, padType:event.target.value}))}>{readFabricRtsOptions().padTypes.map(value=><option key={value}>{value}</option>)}</select></label>
              <label className="fabric-modal-field"><span>Size</span><select value={rtsPadDraft?.size || '8 inches'} onChange={event=>setRtsPadDraft(prev=>({...prev, size:event.target.value}))}>{['6 inches','7 inches','8 inches','9 inches','10 inches','11 inches','12 inches','14 inches'].map(value=><option key={value}>{value}</option>)}</select></label>
              <label className="fabric-modal-field"><span>Shape</span><select value={rtsPadDraft?.shape || ''} onChange={event=>setRtsPadDraft(prev=>({...prev, shape:event.target.value}))}>{readFabricRtsOptions().shapes.map(value=><option key={value}>{value}</option>)}</select></label>
              <label className="fabric-modal-field"><span>Price ($)</span><select value={rtsPadDraft?.price || '$8.00'} onChange={event=>setRtsPadDraft(prev=>({...prev, price:event.target.value}))}>{['$6.00','$7.00','$8.00','$9.00','$10.00','$12.00'].map(value=><option key={value}>{value}</option>)}</select></label>
            </div>
            <label className="fabric-modal-field"><span>Detailed information</span><input value={rtsPadDraft?.details || ''} onChange={event=>setRtsPadDraft(prev=>({...prev, details:event.target.value}))}/></label>
            <label className="fabric-modal-check"><input type="checkbox" checked={rtsPadDraft?.available !== false} onChange={event=>setRtsPadDraft(prev=>({...prev, available:event.target.checked}))}/><span>Available</span></label>
            <div className="fabric-modal-section-label">Ready-made pad photo</div>
            <div className="fabric-modal-pad-photo-row"><div className="fabric-modal-pad-photo">{rtsPadDraft?.padPhoto ? <img src={rtsPadDraft.padPhoto} alt="Ready-made pad"/> : <span>No image</span>}</div><input id="rts-pad-photo-input" type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handlePadPhotoChange}/><label htmlFor="rts-pad-photo-input" className="btn btn-ghost"><Icon name="upload" className="ico-sm"/> Upload pad photo</label></div>
            {fabricEditorNotice && <div className="fabric-editor-notice"><Icon name="check" className="ico-sm"/> {fabricEditorNotice}</div>}
            <button type="button" className="btn btn-blush fabric-editor-primary" onClick={createRtsPadFromFabric}><Icon name="tag" className="ico-sm"/> Create Ready-Made Pad</button>
          </div>}
        </div>
      </div>}
    </div>
  );
};
