// Studio Presets — reusable local composition recipes with optional AI scene notes.

const PresetBuilder = ({ onGoto }) => {
  const { useState, useMemo, useEffect, useRef } = React;
  const defaults = window.STUDIO_PRESET_DEFAULTS || {
    ratio:'1:1', backdropIds:['blush-paper','linen-neutral','sage-soft','white-catalog'], padding:0.10, zoom:1,
    labelText:'', labelPosition:'bottom-left', labelSize:'medium', labelBackground:true,
    labelColor:'#4D3245', labelBackgroundColor:'#FFF1F8', logoDataUrl:'', logoName:'', logoPosition:'top-right', logoScale:0.18, logoOpacity:1,
  };
  const normalize = window.normalizeStudioPreset || (p => p);
  const [presets, setPresets] = useState(() => window.readStudioPresets ? window.readStudioPresets() : PRESETS.map(normalize));
  const [selectedId, setSelectedId] = useState(() => (window.readStudioPresets ? window.readStudioPresets()[1]?.id : PRESETS[1].id) || PRESETS[1].id);
  const [editorTab, setEditorTab] = useState('studio');
  const [libFilter, setLibFilter] = useState('all');
  const [presetSection, setPresetSection] = useState('library');
  const logoInputRef = useRef(null);

  const preset = presets.find(p => p.id === selectedId) || presets[0] || normalize(PRESETS[1]);
  const studio = { ...defaults, ...(preset?.studio || {}) };
  const scene = { prompt:'', negative:'', lighting:'Diffused Daylight', lightingIntensity:60, propDensity:30, angle:'Overhead', aspect:'1:1', ...(preset?.scenePrompt || {}) };

  useEffect(() => {
    if (window.saveStudioPresets) window.saveStudioPresets(presets);
  }, [presets]);

  const patch = (delta) => setPresets(prev => prev.map(p => p.id === selectedId ? normalize({ ...p, ...delta, updated:'Just now' }) : p));
  const patchStudio = (delta) => patch({ studio: { ...studio, ...delta } });
  const patchScene = (delta) => patch({ scenePrompt: { ...scene, ...delta } });

  const duplicate = (id) => {
    const src = presets.find(p => p.id === id);
    if (!src) return;
    const copy = normalize({ ...src, id: id + '-copy-' + Date.now(), name: src.name + ' (Copy)', status:'draft', updated:'Just now', uses:0, studio:{...src.studio, backdropIds:[...(src.studio?.backdropIds || defaults.backdropIds)]}, scenePrompt:{...src.scenePrompt} });
    setPresets(prev => [copy, ...prev]);
    setSelectedId(copy.id);
  };

  const createPreset = () => {
    const id = 'studio-' + Date.now();
    const fresh = normalize({
      id, name:'Untitled Studio Preset', thumb:'assets/preset-blush.jpg', status:'draft', tags:['custom'], updated:'Just now', uses:0, author:'You',
      studio:{...defaults, backdropIds:[...defaults.backdropIds]},
      scenePrompt:{prompt:'Describe an optional regenerated scene using {PRODUCT}.', negative:'', lighting:'Diffused Daylight', lightingIntensity:60, propDensity:30, angle:'Overhead', aspect:'1:1'},
    });
    setPresets(prev => [fresh, ...prev]);
    setSelectedId(id);
    setEditorTab('studio');
    setPresetSection('settings');
  };

  const removePreset = (id) => {
    if (presets.length <= 1) return;
    const remaining = presets.filter(p => p.id !== id);
    setPresets(remaining);
    if (selectedId === id) setSelectedId(remaining[0].id);
  };

  const toggleBackdrop = (id) => {
    const current = Array.isArray(studio.backdropIds) ? studio.backdropIds : [];
    const next = current.includes(id) ? current.filter(x => x !== id) : current.length < 4 ? [...current, id] : [...current.slice(1), id];
    patchStudio({ backdropIds: next });
  };

  const filtered = useMemo(() => presets.filter(p => libFilter === 'all' ? true : p.status === libFilter), [presets, libFilter]);
  const liveCount = presets.filter(p => p.status === 'live').length;
  const draftCount = presets.filter(p => p.status !== 'live').length;
  const selectedBackdrop = BACKDROPS.find(b => b.id === studio.backdropIds?.[0]) || BACKDROPS[1];
  const selectedRatio = OUTPUT_RATIOS.find(r => r.id === studio.ratio) || OUTPUT_RATIOS[0];

  const readFileAsDataURL = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleLogo = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      patchStudio({ logoDataUrl: await readFileAsDataURL(file), logoName:file.name });
    } catch (_) {}
    event.target.value = '';
  };

  const renderPrompt = (text) => String(text || '').split(/(\{PRODUCT\})/g).map((part, i) => part === '{PRODUCT}'
    ? <span key={i} className="prompt-token">{'{PRODUCT}'}</span>
    : <span key={i}>{part}</span>);

  return (
    <div className="page studio-presets-page">
      <div className="page-head">
        <div>
          <div className="row" style={{gap:10, marginBottom:8}}>
            <span className="pill pill-blush"><span className="pill-dot"/> Studio · Presets</span>
            <span className="pill pill-sage">Local compositions</span>
          </div>
          <div className="page-title">Save your studio styles<span style={{color:'var(--rose)', fontStyle:'italic'}}>.</span></div>
          <div className="page-sub">Create reusable local recipes for backdrop, canvas, fit, labels, and logos. Optional scene prompts are stored separately for future AI workflows and never change the local Production process.</div>
        </div>
        <div className="row studio-presets-heading-actions">
          <button type="button" className="btn btn-primary" onClick={createPreset}><Icon name="plus" className="ico-sm"/> New preset</button>
        </div>
      </div>

      <div className="stat-row studio-preset-stats">
        <div className="stat accent"><div className="lbl">Studio presets</div><div className="val">{presets.length}</div><div className="delta">Saved locally in this browser</div></div>
        <div className="stat"><div className="lbl">Live recipes</div><div className="val">{liveCount}</div><div className="delta">Available for Production</div></div>
        <div className="stat"><div className="lbl">Drafts</div><div className="val">{draftCount}</div><div className="delta warn">Still editable</div></div>
        <div className="stat"><div className="lbl">Current canvas</div><div className="val" style={{fontSize:19}}>{selectedRatio.label}</div><div className="delta">{selectedRatio.pxLabel}</div></div>
      </div>

      <div className="studio-preset-section-switcher" role="tablist" aria-label="Preset sections">
        <button type="button" className={presetSection==='library'?'on':''} onClick={()=>setPresetSection('library')}><Icon name="template" className="ico-sm"/> Studio Presets</button>
        <button type="button" className={presetSection==='settings'?'on':''} onClick={()=>setPresetSection('settings')}><Icon name="settings" className="ico-sm"/> Studio Settings</button>
      </div>

      <div className="two-col studio-presets-layout" data-preset-section={presetSection}>
        <div className="stack">
          <div className="card card-pad studio-preset-library-card">
            <div className="row between" style={{marginBottom:14}}>
              <div className="row" style={{gap:8}}><div className="serif" style={{fontSize:20}}>Studio Preset Library</div><span className="pill pill-linen">{filtered.length}</span></div>
              <div className="seg">{['all','live','draft'].map(k => <button type="button" key={k} className={libFilter===k?'on':''} onClick={()=>setLibFilter(k)}>{k[0].toUpperCase()+k.slice(1)}</button>)}</div>
            </div>
            <div className="preset-grid">
              {filtered.map(p => {
                const pStudio = { ...defaults, ...(p.studio || {}) };
                const bd = BACKDROPS.find(b => b.id === pStudio.backdropIds?.[0]) || BACKDROPS[1];
                return <div role="button" tabIndex="0" key={p.id} className={'preset-card'+(p.id===selectedId?' selected':'')} onClick={()=>{setSelectedId(p.id);setEditorTab('studio');}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelectedId(p.id);setEditorTab('studio');}}}>
                  <div className="preset-thumb" style={{background:bd.swatch === 'checker' ? 'conic-gradient(#F1EDE8 25%,#fff 0 50%,#F1EDE8 0 75%,#fff 0) 0 0/16px 16px' : bd.swatch}}>
                    <img src={p.thumb} alt="" />
                    <div className="badges"><span className={p.status==='live'?'pill pill-live':'pill pill-draft'}><span className="pill-dot"/> {p.status==='live'?'Live':'Draft'}</span></div>
                    <div className="overlay-tools" onClick={e=>e.stopPropagation()}><span className="overlay-btn" title="Selected backdrop"><Icon name="sparkles" className="ico-sm"/></span><button type="button" className="overlay-btn" title="Duplicate" onClick={()=>duplicate(p.id)}><Icon name="copy" className="ico-sm"/></button></div>
                  </div>
                  <div className="preset-body"><div className="preset-name">{p.name}</div><div className="preset-meta"><div style={{fontSize:11.5,color:'var(--muted)'}}>{pStudio.ratio} · {pStudio.backdropIds?.length || 0} backdrops</div><span className="pill pill-linen">{p.updated}</span></div><div className="preset-tags">{(p.tags || []).map(t=><span key={t} className="tag">{t}</span>)}</div></div>
                </div>;
              })}
            </div>
          </div>

          <div className="card studio-preset-editor-card">
            <div className="tabs studio-preset-tabs">
              <button type="button" className={editorTab==='studio'?'on':''} onClick={()=>setEditorTab('studio')}><Icon name="settings" className="ico-sm"/> Studio settings</button>
              <button type="button" className={editorTab==='scene'?'on':''} onClick={()=>setEditorTab('scene')}><Icon name="sparkles" className="ico-sm"/> Optional scene prompt</button>
              <button type="button" className={editorTab==='guardrails'?'on':''} onClick={()=>setEditorTab('guardrails')}><Icon name="lock" className="ico-sm"/> Product guardrails</button>
            </div>
            <div className="card-pad studio-preset-editor-body">
              <div className="row between studio-preset-editor-head">
                <div className="row" style={{minWidth:0}}><div className="preset-editor-swatch" style={{background:selectedBackdrop.swatch === 'checker' ? 'conic-gradient(#F1EDE8 25%,#fff 0 50%,#F1EDE8 0 75%,#fff 0) 0 0/12px 12px' : selectedBackdrop.swatch}}/><div style={{minWidth:0}}><input className="studio-preset-name-input" value={preset.name} onChange={e=>patch({name:e.target.value})}/><div className="muted small">Local recipe · edited {preset.updated}</div></div></div>
                <div className="row studio-preset-editor-actions"><button type="button" className="btn btn-ghost" onClick={()=>duplicate(preset.id)} title="Duplicate preset"><Icon name="copy" className="ico-sm"/><span className="desktop-only-label">Duplicate</span></button><button type="button" className="btn btn-ghost" style={{color:'#B84A5F'}} onClick={()=>removePreset(preset.id)} title="Delete preset"><Icon name="trash" className="ico-sm"/><span className="desktop-only-label">Delete</span></button></div>
              </div>

              {editorTab === 'studio' && <div className="studio-settings-form">
                <div className="studio-settings-section"><div className="refine-section-label">Backdrop choices · select up to 4</div><div className="chips studio-backdrop-chips">{BACKDROPS.map(b => <button type="button" key={b.id} className={'chip backdrop-chip'+(studio.backdropIds?.includes(b.id)?' on':'')} onClick={()=>toggleBackdrop(b.id)}><span className="backdrop-dot" style={{background:b.swatch === 'checker' ? 'conic-gradient(#F1EDE8 25%,#fff 0 50%,#F1EDE8 0 75%,#fff 0) 0 0/8px 8px' : b.swatch}}/>{b.name}</button>)}</div><div className="muted small studio-settings-note">These are the only scene visuals applied by the local browser compositor.</div></div>
                <div className="studio-settings-grid">
                  <label className="field"><span className="field-lbl">Canvas ratio</span><select className="select" value={studio.ratio} onChange={e=>patchStudio({ratio:e.target.value})}>{OUTPUT_RATIOS.map(r=><option key={r.id} value={r.id}>{r.label} · {r.id}</option>)}</select></label>
                  <label className="field"><span className="field-lbl">Fit / padding <span className="hint">{Math.round((Number(studio.padding)||.1)*100)}%</span></span><input type="range" min="0.02" max="0.25" step="0.01" value={Number(studio.padding)||.1} onChange={e=>patchStudio({padding:Number(e.target.value)})}/></label>
                  <label className="field"><span className="field-lbl">Starting zoom <span className="hint">{Math.round((Number(studio.zoom)||1)*100)}%</span></span><input type="range" min="0.65" max="1.45" step="0.01" value={Number(studio.zoom)||1} onChange={e=>patchStudio({zoom:Number(e.target.value)})}/></label>
                </div>
                <div className="studio-settings-section"><div className="refine-section-label">Label defaults</div><div className="studio-settings-grid"><label className="field"><span className="field-lbl">Label text</span><input className="input" value={studio.labelText || ''} onChange={e=>patchStudio({labelText:e.target.value})} placeholder="e.g. Garden Bloom · Reusable Pad"/></label><label className="field"><span className="field-lbl">Label position</span><select className="select" value={studio.labelPosition || 'bottom-left'} onChange={e=>patchStudio({labelPosition:e.target.value})}><option value="bottom-left">Bottom left</option><option value="bottom-center">Bottom center</option><option value="bottom-right">Bottom right</option></select></label><label className="field"><span className="field-lbl">Label size</span><select className="select" value={studio.labelSize || 'medium'} onChange={e=>patchStudio({labelSize:e.target.value})}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label><label className="row studio-checkbox"><input type="checkbox" checked={studio.labelBackground !== false} onChange={e=>patchStudio({labelBackground:e.target.checked})}/><span>Use pale label card</span></label></div><div className="label-color-row studio-preset-color-row"><label className="row">Text <input type="color" value={studio.labelColor || '#4D3245'} onChange={e=>patchStudio({labelColor:e.target.value})}/></label><label className="row">Card <input type="color" value={studio.labelBackgroundColor || '#FFF1F8'} onChange={e=>patchStudio({labelBackgroundColor:e.target.value})}/></label></div></div>
                <div className="studio-settings-section"><div className="row between"><div className="refine-section-label">Logo defaults</div>{studio.logoDataUrl && <button type="button" className="text-button danger" onClick={()=>patchStudio({logoDataUrl:'',logoName:''})}>Remove logo</button>}</div><div className="logo-file-row studio-preset-logo-row">{studio.logoDataUrl ? <div className="logo-file-preview"><img src={studio.logoDataUrl} alt="Logo preview"/></div> : <div className="logo-file-preview"><Icon name="image" className="ico-sm"/></div>}<div style={{minWidth:0,flex:1}}><div className="muted small">{studio.logoName || 'No logo saved in this preset'}</div><button type="button" className="btn btn-ghost" style={{padding:'6px 9px',fontSize:10.5,marginTop:5}} onClick={()=>logoInputRef.current?.click()}><Icon name="upload" className="ico-sm"/> {studio.logoDataUrl ? 'Replace logo' : 'Choose logo'}</button><input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleLogo}/></div></div><div className="studio-settings-grid"><label className="field"><span className="field-lbl">Logo position</span><select className="select" value={studio.logoPosition || 'top-right'} onChange={e=>patchStudio({logoPosition:e.target.value})}><option value="top-left">Top left</option><option value="top-right">Top right</option><option value="bottom-left">Bottom left</option><option value="bottom-right">Bottom right</option></select></label><label className="field"><span className="field-lbl">Logo size <span className="hint">{Math.round((Number(studio.logoScale)||.18)*100)}%</span></span><input type="range" min="0.08" max="0.42" step="0.01" value={Number(studio.logoScale)||.18} onChange={e=>patchStudio({logoScale:Number(e.target.value)})}/></label><label className="field"><span className="field-lbl">Logo opacity <span className="hint">{Math.round((Number(studio.logoOpacity)==null?1:Number(studio.logoOpacity))*100)}%</span></span><input type="range" min="0.2" max="1" step="0.05" value={studio.logoOpacity == null ? 1 : studio.logoOpacity} onChange={e=>patchStudio({logoOpacity:Number(e.target.value)})}/></label></div></div>
              </div>}

              {editorTab === 'scene' && <div className="scene-prompt-notes"><div className="scene-prompt-callout"><Icon name="sparkles" className="ico-sm"/><div><strong>Optional future-AI notes</strong><div>Stored with this preset for reuse later. These prompts, camera angles, lighting values, and prop notes do not affect the local backdrop compositor or the regular Production workflow.</div></div></div><label className="field"><span className="field-lbl">Scene prompt <span className="hint">Optional · use {'{PRODUCT}'}</span></span><textarea className="textarea" value={scene.prompt} onChange={e=>patchScene({prompt:e.target.value})} placeholder="Describe a future generated scene…"/></label><label className="field"><span className="field-lbl">Negative prompt</span><textarea className="textarea neg-box" value={scene.negative} onChange={e=>patchScene({negative:e.target.value})} placeholder="blurry, cluttered, harsh shadows…"/></label><div className="studio-settings-grid"><label className="field"><span className="field-lbl">Future camera angle</span><select className="select" value={scene.angle} onChange={e=>patchScene({angle:e.target.value})}>{ANGLE_OPTIONS.map(a=><option key={a}>{a}</option>)}</select></label><label className="field"><span className="field-lbl">Future lighting</span><select className="select" value={scene.lighting} onChange={e=>patchScene({lighting:e.target.value})}>{LIGHTING_OPTIONS.map(l=><option key={l}>{l}</option>)}</select></label><label className="field"><span className="field-lbl">Lighting intensity <span className="hint">{scene.lightingIntensity}</span></span><input type="range" min="0" max="100" value={scene.lightingIntensity} onChange={e=>patchScene({lightingIntensity:Number(e.target.value)})}/></label><label className="field"><span className="field-lbl">Future prop density <span className="hint">{scene.propDensity}</span></span><input type="range" min="0" max="100" value={scene.propDensity} onChange={e=>patchScene({propDensity:Number(e.target.value)})}/></label></div><div className="prompt-locked scene-prompt-preview"><div className="lock"><Icon name="info" className="ico-sm"/> Stored separately</div>{renderPrompt(scene.prompt)}</div></div>}

              {editorTab === 'guardrails' && <div className="guardrails-panel"><div className="scene-prompt-callout"><Icon name="lock" className="ico-sm"/><div><strong>Product preservation stays on</strong><div>Production continues to use the uploaded cutout. Shape, colour, print, proportion, stitching, and snap details are not regenerated by Studio Presets.</div></div></div><div className="guardrail-list">{PRESERVATION_ITEMS.map(item=><div className="pres-item" key={item}><div className="check"><Icon name="check" className="ico-sm"/></div><div style={{flex:1}}>{item}</div><span className="pill pill-sage">Local</span></div>)}</div></div>}
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card studio-preset-preview-card" style={{overflow:'hidden'}}>
            <div className="studio-preset-preview" style={{background:selectedBackdrop.swatch === 'checker' ? 'conic-gradient(#F1EDE8 25%,#fff 0 50%,#F1EDE8 0 75%,#fff 0) 0 0/18px 18px' : selectedBackdrop.swatch}}><img src={preset.thumb} alt="Studio style reference"/><span className="pill pill-blush">Studio reference</span></div>
            <div className="card-pad"><div className="row between"><div><div className="eyebrow">Local recipe</div><div className="serif" style={{fontSize:20}}>{selectedRatio.id} · {selectedBackdrop.name}</div></div><span className="pill pill-sage">{studio.backdropIds?.length || 0} shots</span></div><div className="muted small" style={{marginTop:8}}>The reference image helps identify the style. Production applies the saved backdrop, ratio, fit, label, and logo settings to your real cutout.</div></div>
          </div>
          <div className="card card-pad studio-preset-use-card"><div className="serif" style={{fontSize:19,marginBottom:8}}>Use this studio style</div><div className="muted small" style={{lineHeight:1.5}}>Open Production with <strong>{preset.name}</strong> selected. No AI image generation is required.</div><button type="button" className="btn btn-blush" style={{width:'100%',justifyContent:'center',marginTop:14}} onClick={()=>onGoto && onGoto('generator', preset.id)}><Icon name="sparkles" className="ico-sm"/> Use in Production</button><div className="row between" style={{marginTop:10,paddingTop:10,borderTop:'1px solid var(--line)'}}><span className="muted small">Status</span><button type="button" className={preset.status==='live'?'pill pill-live':'pill pill-draft'} onClick={()=>patch({status:preset.status==='live'?'draft':'live'})}><span className="pill-dot"/> {preset.status==='live'?'Live':'Draft'}</button></div></div>
          <div className="preserve-card"><div className="preserve-title"><Icon name="check" className="ico-sm"/> What this preset controls</div><div style={{fontSize:12,color:'var(--ink-soft)',lineHeight:1.55}}>Backdrop, canvas ratio, product fit, label defaults, and logo defaults. The optional scene prompt is stored separately and remains inactive.</div></div>
        </div>
      </div>
    </div>
  );
};

window.PresetBuilder = PresetBuilder;
