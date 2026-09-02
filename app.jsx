// App shell — sidebar + topbar + route switcher
const readSavedShots = () => {
  try {
    const value = JSON.parse(localStorage.getItem('wp_saved_shots') || '[]');
    return Array.isArray(value) ? value : [];
  } catch (_) { return []; }
};

const writeSavedShots = (shots) => {
  try { localStorage.setItem('wp_saved_shots', JSON.stringify(shots)); } catch (_) {}
};
const readOverviewStore = (key, fallback) => {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '');
    return value ?? fallback;
  } catch (_) { return fallback; }
};
const overviewDate = (value) => {
  if (!value) return 'Recently';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString([], {month:'short', day:'numeric'});
};

const Overview = ({onGoto}) => {
  const [data, setData] = React.useState(() => ({
    fabrics:readOverviewStore('wp_prepared_fabrics', []),
    shots:readOverviewStore('wp_saved_shots', []),
    listings:readOverviewStore('wp_rts_listings', []),
    production:readOverviewStore('wp_production_summary', {total:0,cutoutsDone:0,processing:0,errored:0,withResults:0}),
  }));
  const refresh = React.useCallback(() => setData({
    fabrics:readOverviewStore('wp_prepared_fabrics', []),
    shots:readOverviewStore('wp_saved_shots', []),
    listings:readOverviewStore('wp_rts_listings', []),
    production:readOverviewStore('wp_production_summary', {total:0,cutoutsDone:0,processing:0,errored:0,withResults:0}),
  }), []);
  React.useEffect(() => {
    refresh();
    const events = ['wp-overview-updated','wp-saved-gallery-updated','wp-rts-listings-updated','wp-fabrics-updated','storage'];
    events.forEach(name => window.addEventListener(name, refresh));
    return () => events.forEach(name => window.removeEventListener(name, refresh));
  }, [refresh]);

  const fabrics = Array.isArray(data.fabrics) ? data.fabrics : [];
  const shots = Array.isArray(data.shots) ? data.shots : [];
  const listings = Array.isArray(data.listings) ? data.listings : [];
  const readyFabrics = fabrics.filter(f => f.status === 'ready' || !!f.compressedUrl);
  const activeFabrics = fabrics.filter(f => f.status === 'compressing' || f.status === 'analyzing');
  const fabricIdsWithListings = new Set(listings.map(item => item.fabricId).filter(Boolean));
  const awaitingRts = readyFabrics.filter(f => !fabricIdsWithListings.has(f.id));
  const production = data.production || {};
  const needsAttention = Number(production.errored || 0) + activeFabrics.length;
  const recentShots = shots.slice(0, 4);
  const activities = [
    ...listings.slice(0, 3).map(item => ({key:`listing-${item.id}`, icon:'tag', title:`RTS pad created · ${item.title || item.fabricName || 'Untitled pad'}`, detail:item.fabricName || 'Saved fabric', date:overviewDate(item.createdAt)})),
    ...fabrics.slice(0, 3).map(item => ({key:`fabric-${item.id}`, icon:'scissors', title:`Fabric ready · ${item.name || item.fileName || 'Untitled fabric'}`, detail:item.material || 'Prepared fabric', date:overviewDate(item.createdAt)})),
    ...shots.slice(0, 3).map(item => ({key:`shot-${item.key}`, icon:'photo', title:`Shot saved · ${item.itemName || 'Product photo'}`, detail:item.backdropName || 'Studio result', date:item.savedAt || 'Recently'})),
  ].slice(0, 5);

  return <div className="overview-page">
    <div className="page-heading overview-heading">
      <div><div className="eyebrow"><Icon name="home" className="ico-sm"/> Studio · Overview</div><h1 className="serif">Good morning, Nilam.</h1><p className="muted">A live view of what is ready, what needs attention, and where to continue your Wonder Pads workflow.</p></div>
      <div className="row overview-actions"><button type="button" className="btn btn-blush" onClick={()=>onGoto('generator')}><Icon name="sparkles" className="ico-sm"/> Add product photos</button><button type="button" className="btn btn-ghost" onClick={()=>onGoto('fabric-prep')}><Icon name="scissors" className="ico-sm"/> Compress & Rename</button></div>
    </div>

    <div className="overview-stat-grid">
      <button type="button" className="overview-stat-card" onClick={()=>onGoto('gallery')}><span className="overview-stat-label">Photos saved</span><strong>{shots.length}</strong><span className="overview-stat-detail">Finalized studio results <Icon name="photo" className="ico-sm"/></span></button>
      <button type="button" className="overview-stat-card" onClick={()=>onGoto('fabric-prep')}><span className="overview-stat-label">Fabrics ready</span><strong>{readyFabrics.length}</strong><span className="overview-stat-detail">{activeFabrics.length ? `${activeFabrics.length} preparing` : 'Ready for shop naming'} <Icon name="scissors" className="ico-sm"/></span></button>
      <button type="button" className="overview-stat-card" onClick={()=>onGoto('fabric-prep')}><span className="overview-stat-label">RTS pads created</span><strong>{listings.length}</strong><span className="overview-stat-detail">Create from a saved fabric <Icon name="tag" className="ico-sm"/></span></button>
      <button type="button" className={'overview-stat-card'+(needsAttention ? ' attention' : '')} onClick={()=>onGoto(needsAttention ? 'generator' : 'fabric-prep')}><span className="overview-stat-label">Needs attention</span><strong>{needsAttention}</strong><span className="overview-stat-detail">{needsAttention ? 'Processing or failed items' : 'Everything is in good shape'} <Icon name={needsAttention ? 'refresh' : 'check'} className="ico-sm"/></span></button>
    </div>

    <section className="overview-continue card card-pad">
      <div><div className="eyebrow"><Icon name="sparkles" className="ico-sm"/> Continue your workflow</div><div className="serif overview-continue-title">{awaitingRts.length ? `Finish ${awaitingRts[0].name || 'your next fabric'} as an RTS pad.` : readyFabrics.length ? 'Your fabric library is ready for the next listing.' : shots.length ? 'Your saved studio work is ready to revisit.' : 'Start with your first product photo or fabric.'}</div><p className="muted small">{awaitingRts.length ? 'The saved fabric name and preview will already be waiting in the Create RTS Pad tab.' : readyFabrics.length ? 'Open Compress & Rename to edit a fabric, create a ready-made pad, or prepare another print.' : shots.length ? 'Review your finalized photos and create a collage from the Production Generator.' : 'The Overview will update as soon as you upload and save work.'}</p></div>
      <button type="button" className="btn btn-primary" onClick={()=>onGoto(awaitingRts.length || readyFabrics.length ? 'fabric-prep' : shots.length ? 'gallery' : 'generator')}>{awaitingRts.length ? 'Create RTS pad' : readyFabrics.length ? 'Open Compress & Rename' : shots.length ? 'Open Saved Gallery' : 'Start creating'} <Icon name="chevronRight" className="ico-sm"/></button>
    </section>

    <div className="overview-two-col">
      <section className="card card-pad overview-panel"><div className="row between"><div><div className="serif overview-panel-title">Recent activity</div><div className="muted small">Updates from your saved work.</div></div><span className="pill pill-sage"><Icon name="check" className="ico-sm"/> Live</span></div>{activities.length ? <div className="overview-activity-list">{activities.map(item=><div className="overview-activity" key={item.key}><div className="overview-activity-icon"><Icon name={item.icon} className="ico-sm"/></div><div><strong>{item.title}</strong><span>{item.detail}</span></div><time>{item.date}</time></div>)}</div> : <div className="overview-empty-inline"><Icon name="sparkles" className="ico-lg"/><span>Your activity will appear here as you save work.</span></div>}</section>
      <section className="card card-pad overview-panel"><div className="row between"><div><div className="serif overview-panel-title">Fabric-to-RTS queue</div><div className="muted small">Prepared fabrics that do not have a pad yet.</div></div><span className="pill">{awaitingRts.length} waiting</span></div>{awaitingRts.length ? <div className="overview-queue-list">{awaitingRts.slice(0,4).map(item=><div className="overview-queue-item" key={item.id}><div className="overview-fabric-thumb">{item.compressedUrl ? <img src={item.compressedUrl} alt=""/> : <Icon name="photo" className="ico-sm"/>}</div><div className="overview-queue-copy"><strong>{item.name || item.fileName || 'Untitled fabric'}</strong><span>{item.material || 'Prepared fabric'} · {item.category || 'Unsorted'}</span></div><button type="button" className="btn btn-blush" onClick={()=>onGoto('fabric-prep',null,item.id)}>Create RTS Pad</button></div>)}</div> : <div className="overview-empty-inline"><Icon name="tag" className="ico-lg"/><span>All ready fabrics have an RTS pad, or none are prepared yet.</span></div>}</section>
    </div>

    <section className="card card-pad overview-panel"><div className="row between"><div><div className="serif overview-panel-title">Recent Saved Gallery</div><div className="muted small">Your latest finished product photos and compositions.</div></div><button type="button" className="btn btn-ghost" onClick={()=>onGoto('gallery')}>View gallery <Icon name="chevronRight" className="ico-sm"/></button></div>{recentShots.length ? <div className="overview-shot-strip">{recentShots.map(shot=><button type="button" className="overview-shot" key={shot.key} onClick={()=>onGoto('gallery')}><img src={shot.src} alt={shot.itemName || 'Saved shot'}/><span>{shot.itemName || 'Saved product photo'}</span></button>)}</div> : <div className="overview-empty-inline overview-gallery-empty"><Icon name="photo" className="ico-lg"/><span>No saved photos yet. Refine a product photo and choose Save changes to build this gallery.</span><button type="button" className="btn btn-blush" onClick={()=>onGoto('generator')}>Open Production Generator</button></div>}</section>
  </div>;
};

const patternPathFor = (nodes=[]) => { if(nodes.length<3)return ''; let d=`M ${nodes[0].x} ${nodes[0].y}`; for(let i=0;i<nodes.length;i++){const a=nodes[i],b=nodes[(i+1)%nodes.length]; if(a.kind==='sharp'&&b.kind==='sharp') d+=` L ${b.x} ${b.y}`; else {const c1=a.kind==='smooth'?a.handleOut:a,c2=b.kind==='smooth'?b.handleIn:b; d+=` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;}} return d+' Z'; };
const PatternJoiner = ({parts,onClose}) => {
  const [pieces,setPieces]=React.useState(()=>parts.map((part,i)=>({part,x:260+i*220,y:380,rotation:0,scale:.42,flipX:1,flipY:1})));
  const [active,setActive]=React.useState(0),drag=React.useRef(null),svgRef=React.useRef(null);
  const update=(patch)=>setPieces(cur=>cur.map((p,i)=>i===active?{...p,...patch}:p));
  const pointer=(e)=>{const r=svgRef.current.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*1000,y:(e.clientY-r.top)/r.height*800};};
  const down=(e,i)=>{e.stopPropagation();setActive(i);const p=pointer(e);drag.current={i,start:p,origin:{x:pieces[i].x,y:pieces[i].y}};e.currentTarget.setPointerCapture?.(e.pointerId);};
  const move=(e)=>{if(!drag.current)return;const p=pointer(e),d=drag.current;setPieces(cur=>cur.map((piece,i)=>i===d.i?{...piece,x:d.origin.x+p.x-d.start.x,y:d.origin.y+p.y-d.start.y}:piece));};
  const up=()=>{drag.current=null;};
  const transform=(piece)=>`translate(${piece.x} ${piece.y}) rotate(${piece.rotation}) scale(${piece.scale*piece.flipX} ${piece.scale*piece.flipY}) translate(-360 -640)`;
  const exportJoined=()=>{const groups=pieces.map((piece,i)=>{const safeId=(piece.part.name||('part-'+(i+1))).replace(/[^a-z0-9_-]+/gi,'-').toLowerCase();return `<g id="${safeId}" transform="${transform(piece)}"><path d="${patternPathFor(piece.part.nodes)}" fill="none" stroke="#6d334b" stroke-width="4"/></g>`;}).join('');const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 800"><title>Joined Wonder Pads pattern</title>${groups}</svg>`;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));a.download='wonder-pads-joined-pattern.svg';a.click();};
  const piece=pieces[active];
  return <div className="pattern-joiner-overlay"><div className="pattern-joiner-card">
    <div className="row between pattern-joiner-head"><div><div className="eyebrow">Pattern workspace</div><h2 className="serif">Join PDF pattern parts</h2><p className="muted small">Drag each part into place, then rotate, resize, or flip the selected piece.</p></div><button className="icon-btn" onClick={onClose}><Icon name="x" className="ico-sm"/></button></div>
    <div className="pattern-joiner-tools"><span>Selected: {piece?.part?.name||'Part'}</span><button onClick={()=>update({rotation:(piece?.rotation||0)-1})}>↶ Rotate</button><button onClick={()=>update({rotation:(piece?.rotation||0)+1})}>↷ Rotate</button><button onClick={()=>update({scale:Math.max(.1,(piece?.scale||.42)-.02)})}>− Size</button><button onClick={()=>update({scale:Math.min(1.5,(piece?.scale||.42)+.02)})}>＋ Size</button><button onClick={()=>update({flipX:(piece?.flipX||1)*-1})}>↔ Flip</button><button onClick={()=>update({flipY:(piece?.flipY||1)*-1})}>↕ Flip</button></div>
    <svg ref={svgRef} className="pattern-joiner-canvas" viewBox="0 0 1000 800" onPointerMove={move} onPointerUp={up} onPointerCancel={up}><defs><pattern id="join-grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0V25" fill="none" stroke="#8d687e" strokeOpacity=".10"/></pattern></defs><rect width="1000" height="800" fill="url(#join-grid)"/>{pieces.map((p,i)=><g key={p.part.id||i} transform={transform(p)} onPointerDown={e=>down(e,i)} style={{cursor:'grab'}}><path d={patternPathFor(p.part.nodes)} fill={i===active?'#f2c9dd':'#f8e6ef'} fillOpacity=".62" stroke={i===active?'#703454':'#b883a3'} strokeWidth="5" vectorEffect="non-scaling-stroke"/></g>)}</svg>
    <div className="row between pattern-joiner-foot"><span className="muted small">Parts remain separate editable paths inside one SVG.</span><div className="row"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-blush" onClick={exportJoined} disabled={!pieces.length}><Icon name="download" className="ico-sm"/> Export joined SVG</button></div></div>
  </div></div>;
};

const SavedGallery = ({onGoto}) => {
  const [shots, setShots] = React.useState(() => readSavedShots());
  const [patternParts, setPatternParts] = React.useState(() => { try { const v=JSON.parse(localStorage.getItem('wp-silhouette-parts-v1')||'[]'); return Array.isArray(v)?v:[]; } catch (_) { return []; } });
  const [joiningPatterns, setJoiningPatterns] = React.useState(false);

  React.useEffect(() => {
    const sync = () => setShots(readSavedShots());
    window.addEventListener('wp-saved-gallery-updated', sync);
    window.addEventListener('storage', sync);
    const syncParts = () => { try { const v=JSON.parse(localStorage.getItem('wp-silhouette-parts-v1')||'[]'); setPatternParts(Array.isArray(v)?v:[]); } catch (_) {} };
    window.addEventListener('wp-silhouette-parts-updated', syncParts);
    return () => {
      window.removeEventListener('wp-saved-gallery-updated', sync);
      window.removeEventListener('storage', sync);
      window.removeEventListener('wp-silhouette-parts-updated', syncParts);
    };
  }, []);

  const downloadShot = async (shot) => {
    if (!shot?.src) return;
    const filename = shot.fileName || 'wonder-pads-studio-shot.png';
    try {
      const response = await fetch(shot.src);
      const blob = await response.blob();
      const file = new File([blob], filename, {type:blob.type || 'image/png'});
      if (navigator.share && navigator.canShare && navigator.canShare({files:[file]})) {
        await navigator.share({files:[file], title:'Wonder Pads Studio', text:'Saved from Wonder Pads Studio'});
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    } catch (_) {
      try { window.open(shot.src, '_blank', 'noopener,noreferrer'); } catch (error) {}
    }
  };

  const removeShot = (key) => {
    const next = shots.filter(shot => shot.key !== key);
    setShots(next);
    writeSavedShots(next);
    window.dispatchEvent(new CustomEvent('wp-saved-gallery-updated'));
  };

  const clearAll = () => {
    setShots([]);
    writeSavedShots([]);
    window.dispatchEvent(new CustomEvent('wp-saved-gallery-updated'));
  };

  return <><div className="saved-gallery-page">
    <div className="page-heading saved-gallery-page-heading">
      <div>
        <div className="eyebrow"><Icon name="photo" className="ico-sm"/> Library · Saved Gallery</div>
        <h1 className="serif">Your finished studio work.</h1>
        <p className="muted">Finalized product photos saved from Refine, ready to download or revisit from one calm library.</p>
      </div>
      <div className="row saved-gallery-page-actions">
        {patternParts.length >= 2 && <button type="button" className="btn btn-blush" onClick={() => setJoiningPatterns(true)}><Icon name="layers" className="ico-sm"/> Join {patternParts.length} pattern parts</button>}
        <button type="button" className="btn btn-ghost" onClick={() => onGoto('generator')}><Icon name="sparkles" className="ico-sm"/> Open Production Generator</button>
        {shots.length > 0 && <button type="button" className="btn btn-ghost" onClick={clearAll}><Icon name="trash" className="ico-sm"/> Clear gallery</button>}
      </div>
    </div>

    <section className="card card-pad saved-gallery-page-card">
      <div className="row between saved-gallery-head">
        <div>
          <div className="serif" style={{fontSize:22}}>Saved Gallery</div>
          <div className="saved-gallery-note">Your final PNGs and polished studio compositions live here.</div>
        </div>
        <span className="pill pill-sage"><Icon name="check" className="ico-sm"/> {shots.length} saved</span>
      </div>
      {!shots.length ? <div className="saved-gallery-empty">
        <Icon name="photo" className="ico-lg"/>
        <div className="serif" style={{fontSize:20}}>Nothing saved yet</div>
        <div className="muted small">Refine a product photo, then choose Save changes to place it here.</div>
        <button type="button" className="btn btn-blush" onClick={() => onGoto('generator')}><Icon name="sparkles" className="ico-sm"/> Go to Production Generator</button>
      </div> : <div className="saved-gallery-grid">
        {shots.map(shot => <div className="saved-shot-card" key={shot.key}>
          <div className="saved-shot-preview"><img src={shot.src} alt={`${shot.itemName || 'Saved shot'} · ${shot.backdropName || 'Studio shot'}`} /><span className="saved-shot-badge"><Icon name="check" className="ico-sm"/> Saved</span></div>
          <div className="saved-shot-meta">
            <div className="saved-shot-name">{shot.itemName || 'Saved product photo'}</div>
            <div className="saved-shot-details">{shot.backdropName || 'Studio shot'} · {shot.ratio || '1:1'} · {shot.savedAt || 'Saved'}</div>
            <div className="saved-shot-actions">
              <button type="button" className="btn btn-blush" onClick={() => downloadShot(shot)}><Icon name="download" className="ico-sm"/> Save to phone</button>
              <button type="button" className="btn btn-ghost" onClick={() => removeShot(shot.key)}><Icon name="trash" className="ico-sm"/> Remove</button>
            </div>
          </div>
        </div>)}
      </div>}
    </section>
  </div>{joiningPatterns && <PatternJoiner parts={patternParts} onClose={() => setJoiningPatterns(false)} />}</>;
};

const App = () => {
  const storedScreen = localStorage.getItem('wp_screen') || 'home';
  const initial = storedScreen === 'rts' ? 'home' : storedScreen;
  const [screen, setScreen] = React.useState(initial);
  const [handoffPresetId, setHandoffPresetId] = React.useState(null);
  const [handoffFabricId, setHandoffFabricId] = React.useState(null);
  const [handoffSilhouette, setHandoffSilhouette] = React.useState(null);
  const [canInstall, setCanInstall] = React.useState(!!window.__deferredInstallPrompt);
  const [installed, setInstalled] = React.useState(window.matchMedia('(display-mode: standalone)').matches);

  React.useEffect(()=>{ localStorage.setItem('wp_screen', screen); }, [screen]);

  React.useEffect(() => {
    const onAvail = () => setCanInstall(true);
    const onInst  = () => { setCanInstall(false); setInstalled(true); };
    window.addEventListener('wp-install-available', onAvail);
    window.addEventListener('wp-installed', onInst);
    return () => {
      window.removeEventListener('wp-install-available', onAvail);
      window.removeEventListener('wp-installed', onInst);
    };
  }, []);

  const promptInstall = async () => {
    const p = window.__deferredInstallPrompt;
    if (!p) return;
    p.prompt();
    try { await p.userChoice; } catch(e){}
    window.__deferredInstallPrompt = null;
    setCanInstall(false);
  };

  const goto = (s, presetId, fabricId, silhouetteItem) => {
    if (s === 'rts') s = 'fabric-prep';
    setHandoffPresetId(presetId || null);
    setHandoffFabricId(fabricId || null);
    setHandoffSilhouette(silhouetteItem || null);
    setScreen(s);
    window.scrollTo({top:0, behavior:'smooth'});
  };

  const nav = [
    { grp:'Navigate', items:[
      { id:'home', name:'Overview', icon:'home' },
      { id:'gallery', name:'Saved Gallery', icon:'photo' },
    ]},
    { grp:'Workstations', items:[
      { id:'builder', name:'Presets', icon:'template' },
      { id:'generator', name:'Production', icon:'sparkles' },
      { id:'fabric-prep', name:'Compress', icon:'scissors' },
      { id:'silhouette', name:'Silhouette Studio', icon:'template' },
    ]},
  ];

  const screenLabel = screen === 'builder' ? 'Presets'
    : screen === 'fabric-prep' ? 'Compress'
    : screen === 'gallery' ? 'Saved Gallery'
    : screen === 'home' ? 'Overview'
    : screen === 'silhouette' ? 'Silhouette Studio'
    : 'Production';

  return (
    <div className="app-bg" style={{minHeight:'100vh'}}>
      <aside className="sidebar">
        <div className="row" style={{gap:12, marginBottom:6}}>
          <div className="logo-mark"><RoseLogo size={28}/></div>
          <div>
            <div className="brand-name">Wonder Pads</div>
            <div className="brand-sub">Reusables · Studio</div>
          </div>
        </div>

        {nav.map(grp => (
          <div key={grp.grp}>
            <div className="nav-group-title">{grp.grp}</div>
            {grp.items.map(item => (
              <div key={item.id}
                   className={'nav-item'+(screen===item.id?' active':'')}
                   style={item.disabled?{opacity:.5, cursor:'default'}:{}}
                   onClick={()=>{ if(!item.disabled) goto(item.id); }}>
                <Icon name={item.icon} className="ico"/>
                <span style={{flex:1}}>{item.name}</span>
              </div>
            ))}
          </div>
        ))}

        <div className="side-footer">
          <div className="t">Aug production budget</div>
          <div style={{opacity:.85, fontSize:11.5}}>1,284 / 2,000 shots</div>
          <div style={{height:6, background:'rgba(255,255,255,.3)', borderRadius:999, marginTop:8, overflow:'hidden'}}>
            <div style={{width:'64%', height:'100%', background:'#fff', borderRadius:999}}/>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="crumbs">
            <span>Studio</span>
            <span className="sep">›</span>
            <span className="now">{screenLabel}</span>
          </div>
          <div className="top-actions">
            <div className="search">
              <Icon name="search" className="ico-sm" style={{color:'var(--muted)'}}/>
              <input placeholder="Search presets, shots, tags…"/>
            </div>
            {canInstall && (
              <button className="btn btn-blush" style={{padding:'8px 14px', fontSize:12.5}} onClick={promptInstall} title="Install this app on your device">
                <Icon name="download" className="ico-sm"/> Install app
              </button>
            )}
            {installed && !canInstall && (
              <span className="pill pill-sage" title="Running as installed app"><Icon name="check" className="ico-sm"/> Installed</span>
            )}
            <button className="icon-btn" title="Notifications">
              <Icon name="bell" className="ico-sm"/>
              <span style={{position:'absolute', top:6, right:7, width:7, height:7, borderRadius:'50%', background:'var(--rose)'}}/>
            </button>
            <button className="icon-btn" title="Help"><Icon name="settings" className="ico-sm"/></button>
            <div className="avatar" title="Nilam">SP</div>
          </div>
        </div>

        {screen==='home'     && <Overview onGoto={goto}/>} 
        {screen==='builder'   && <PresetBuilder   onGoto={goto}/>} 
        {screen==='generator' && <ProductionGenerator initialPresetId={handoffPresetId} onGoto={goto}/>} 
        {screen==='fabric-prep' && <FabricPrep onGoto={goto} initialFabricId={handoffFabricId}/>} 
        {screen==='silhouette' && window.SilhouetteStudioPage && React.createElement(window.SilhouetteStudioPage,{item:handoffSilhouette,onGoto:goto})} 
        {screen==='gallery' && <SavedGallery onGoto={goto}/>} 
      </main>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
