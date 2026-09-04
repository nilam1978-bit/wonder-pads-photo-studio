(() => {
  const {useEffect,useMemo,useRef,useState}=React;

  // Canvas is deliberately much taller than a 9:16 phone screen so long
  // pattern pieces (overnight/postpartum shapes, multi-page assemblies)
  // have room to lay out without being squeezed. Export scale is driven
  // entirely by calibration + output-inches, so this is purely an editing
  // canvas size and never affects the physical size of an export.
  const STAGE={width:720,height:2400};

  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const bounds=(pts)=>{if(!pts.length)return null;const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);return{minX,maxX,minY,maxY,width:maxX-minX,height:maxY-minY};};
  const defaultHandles=(p,prev,next)=>{const dx=next.x-prev.x,dy=next.y-prev.y,l=Math.hypot(dx,dy)||1,h=Math.min(52,l*.2);return{handleIn:{x:p.x-dx/l*h,y:p.y-dy/l*h},handleOut:{x:p.x+dx/l*h,y:p.y+dy/l*h}};};
  const makeNode=(p,kind='sharp')=>({...p,kind,handleIn:{...p},handleOut:{...p}});
  const vectorize=(pts)=>pts.map((p,i)=>{const prev=pts[(i-1+pts.length)%pts.length],next=pts[(i+1)%pts.length];return{...makeNode(p,'smooth'),...defaultHandles(p,prev,next)};});
  const fallbackNodes=(b)=>{const x=b?.minX??220,y=b?.minY??190,w=b?.width??280,h=b?.height??760;return vectorize([{x:x+w*.5,y},{x:x+w*.78,y:y+h*.08},{x:x+w*.92,y:y+h*.22},{x:x+w*.82,y:y+h*.34},{x:x+w*.68,y:y+h*.39},{x:x+w*.67,y:y+h*.58},{x:x+w*.85,y:y+h*.78},{x:x+w*.75,y:y+h*.95},{x:x+w*.5,y:y+h},{x:x+w*.25,y:y+h*.95},{x:x+w*.15,y:y+h*.78},{x:x+w*.33,y:y+h*.58},{x:x+w*.32,y:y+h*.39},{x:x+w*.18,y:y+h*.34},{x:x+w*.08,y:y+h*.22},{x:x+w*.22,y:y+h*.08}]);};
  const pathFor=(nodes)=>{if(nodes.length<3)return'';let d=`M ${nodes[0].x.toFixed(1)} ${nodes[0].y.toFixed(1)}`;for(let i=0;i<nodes.length;i++){const a=nodes[i],b=nodes[(i+1)%nodes.length];if(a.kind==='sharp'&&b.kind==='sharp')d+=` L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;else{const c1=a.kind==='smooth'?a.handleOut:a,c2=b.kind==='smooth'?b.handleIn:b;d+=` C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;}}return d+' Z';};
  const nearest=(p,items)=>items.reduce((best,x,i)=>{const d=dist(p,x);return d<best.distance?{index:i,distance:d}:best},{index:null,distance:Infinity});
  const nearestSegment=(p,nodes)=>{let best=null;nodes.forEach((a,i)=>{const b=nodes[(i+1)%nodes.length],dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy||1,t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/l,0,1),q={x:a.x+t*dx,y:a.y+t*dy},d=dist(p,q);if(!best||d<best.distance)best={index:i,point:q,distance:d};});return best;};
  const eventPoint=(e,svg,pan,zoom)=>{const r=svg.getBoundingClientRect(),fit=Math.min(r.width/STAGE.width,r.height/STAGE.height),shownWidth=STAGE.width*fit,shownHeight=STAGE.height*fit,offsetX=(r.width-shownWidth)/2,offsetY=(r.height-shownHeight)/2;const v={x:(e.clientX-r.left-offsetX)/fit,y:(e.clientY-r.top-offsetY)/fit};return{x:(v.x-pan.x)/zoom,y:(v.y-pan.y)/zoom};};
  const loadImage=(url)=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('The photo could not be read.'));img.src=url;});
  const SILHOUETTE_SESSION_KEY='wp-silhouette-session-v2';
  const SILHOUETTE_PARTS_KEY='wp-silhouette-parts-v1';
  const readSilhouetteSession=()=>{try{return JSON.parse(localStorage.getItem(SILHOUETTE_SESSION_KEY)||'null')||null;}catch{return null;}};
  const readSilhouetteParts=()=>{try{const value=JSON.parse(localStorage.getItem(SILHOUETTE_PARTS_KEY)||'[]');return Array.isArray(value)?value:[];}catch{return[];}};
  const writeSilhouetteParts=(parts)=>{try{localStorage.setItem(SILHOUETTE_PARTS_KEY,JSON.stringify(parts));window.dispatchEvent(new CustomEvent('wp-silhouette-parts-updated'));}catch{}};
  const fileAsDataUrl=(file)=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=()=>reject(new Error('The file could not be read.'));r.readAsDataURL(file);});
  const ensurePdfJs=()=>{const existing=window.pdfjsLib||window['pdfjs-dist/build/pdf'];if(existing)return Promise.resolve(existing);return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='assets/pdf.min.js?runtime=71';s.onload=()=>{const lib=window.pdfjsLib||window['pdfjs-dist/build/pdf'];lib?resolve(lib):reject(new Error('PDF renderer did not expose a browser API.'));};s.onerror=()=>reject(new Error('PDF renderer could not be loaded.'));document.head.appendChild(s);});};

  // Renders one PDF page to a PNG data URL at the given render scale.
  // Reused for full-quality "add to canvas" renders and for the small
  // thumbnail grid (at a much lower scale) so we never duplicate the
  // pdf.js render boilerplate.
  const renderPdfPageToDataUrl=async(doc,pageNumber,scale=1.6)=>{
    const page=await doc.getPage(pageNumber);
    const viewport=page.getViewport({scale});
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.ceil(viewport.width));
    canvas.height=Math.max(1,Math.ceil(viewport.height));
    await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
    return {data:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height};
  };

  // Builds an assembly layer object with its TRUE natural pixel size and a
  // full-image default crop, instead of guessing at STAGE size. Uploaded
  // photos/PDF pages are never resized to fit here — only the crop box
  // (still expressed in the source's own pixel space) trims what shows.
  const makeImageLayer=async(id,name,data,opts={})=>{
    let width=opts.width,height=opts.height;
    if(!width||!height){
      const img=await loadImage(data);
      width=img.naturalWidth;height=img.naturalHeight;
    }
    return {
      id,name,data,visible:true,
      x:opts.x??360,y:opts.y??(STAGE.height*0.42),
      scale:opts.scale??1,rotation:opts.rotation??0,opacity:opts.opacity??58,
      naturalWidth:width,naturalHeight:height,
      crop:{x:0,y:0,w:width,h:height},
      pdfName:opts.pdfName,pdfPage:opts.pdfPage,pdfPages:opts.pdfPages
    };
  };

  const autoTrace=async(url,threshold=44)=>{const img=await loadImage(url),scale=Math.min(1,380/Math.max(img.naturalWidth,img.naturalHeight)),w=Math.max(72,Math.round(img.naturalWidth*scale)),h=Math.max(72,Math.round(img.naturalHeight*scale)),c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,w,h);const px=ctx.getImageData(0,0,w,h).data,bg=[0,0,0];[[0,0],[w-1,0],[0,h-1],[w-1,h-1]].forEach(([x,y])=>{const i=(y*w+x)*4;bg[0]+=px[i];bg[1]+=px[i+1];bg[2]+=px[i+2];});bg[0]/=4;bg[1]/=4;bg[2]/=4;const mask=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;mask[y*w+x]=Math.hypot(px[i]-bg[0],px[i+1]-bg[1],px[i+2]-bg[2])>=threshold?1:0;}const seen=new Uint8Array(w*h),components=[];for(let start=0;start<w*h;start++){if(!mask[start]||seen[start])continue;const q=[start],comp=[];seen[start]=1;for(let qi=0;qi<q.length;qi++){const at=q[qi],x=at%w,y=Math.floor(at/w);comp.push(at);const ns=[];if(x>0)ns.push(at-1);if(x<w-1)ns.push(at+1);if(y>0)ns.push(at-w);if(y<h-1)ns.push(at+w);for(const n of ns)if(mask[n]&&!seen[n]){seen[n]=1;q.push(n);}}components.push(comp);}const largest=components.sort((a,b)=>b.length-a.length)[0]||[];if(largest.length<10)throw new Error('I could not isolate the pad. Use a plain contrasting background, then try again.');const chosen=new Uint8Array(w*h);largest.forEach(i=>chosen[i]=1);const boundary=[];for(const at of largest){const x=at%w,y=Math.floor(at/w);if(x===0||x===w-1||y===0||y===h-1||!chosen[at-1]||!chosen[at+1]||!chosen[at-w]||!chosen[at+w])boundary.push({x,y});}const minX=Math.min(...boundary.map(p=>p.x)),maxX=Math.max(...boundary.map(p=>p.x)),minY=Math.min(...boundary.map(p=>p.y)),maxY=Math.max(...boundary.map(p=>p.y)),cx=(minX+maxX)/2,cy=(minY+maxY)/2,sample=[];for(let i=0;i<64;i++){const a=i/64*Math.PI*2;let best=null,bestScore=-Infinity;for(const p of boundary){const dx=p.x-cx,dy=p.y-cy,r=Math.hypot(dx,dy)||1,delta=Math.abs(Math.atan2(Math.sin(Math.atan2(dy,dx)-a),Math.cos(Math.atan2(dy,dx)-a)));const score=r-(delta*260);if(score>bestScore){bestScore=score;best=p;}}sample.push(best||boundary[0]);}const fit=Math.min(STAGE.width/img.naturalWidth,STAGE.height/img.naturalHeight),ox=(STAGE.width-img.naturalWidth*fit)/2,oy=(STAGE.height-img.naturalHeight*fit)/2;return vectorize(sample.map(p=>({x:(p.x/scale)*fit+ox,y:(p.y/scale)*fit+oy})));};

  function SilhouetteStudio({item,onClose,onGoto,standalone=false}){
    const initialSource=item?.cutout||item?.manualSrc||item?.src||'';
    const savedSession=useMemo(()=>initialSource?null:readSilhouetteSession(),[initialSource]);

    const [source,setSource]=useState(initialSource||savedSession?.source||'');
    const [sourceName,setSourceName]=useState(item?.name||savedSession?.sourceName||'pad-photo');
    const [nodes,setNodes]=useState(()=>fallbackNodes());
    const [selected,setSelected]=useState(null);
    const [tool,setTool]=useState('calibrate');
    const [calibration,setCalibration]=useState([]);
    const [referenceInches,setReferenceInches]=useState(4);
    const [outputInches,setOutputInches]=useState(10);
    const [photoOpacity,setPhotoOpacity]=useState(savedSession?.photoOpacity??74);
    const [autoThreshold,setAutoThreshold]=useState(savedSession?.autoThreshold??44);
    const [zoom,setZoom]=useState(savedSession?.zoom??1);
    const [magnifierOpen,setMagnifierOpen]=useState(false);
    const [magnifierPos,setMagnifierPos]=useState({left:12,top:12});
    const [magnifierEnabled,setMagnifierEnabled]=useState(savedSession?.magnifierEnabled??true);
    const [magnifierRadius,setMagnifierRadius]=useState(savedSession?.magnifierRadius??70);
    const [pan,setPan]=useState(savedSession?.pan||{x:0,y:0});
    const [showHandles,setShowHandles]=useState(savedSession?.showHandles??true);
    const [focusSelected,setFocusSelected]=useState(savedSession?.focusSelected??false);
    const [extracting,setExtracting]=useState(false);
    const [preview,setPreview]=useState(false);
    const [previewMode,setPreviewMode]=useState('outline');
    const [notice,setNotice]=useState(initialSource?'Automatic outline draft ready. Drag any point to refine the shape.':'Upload a photo or PDF to begin.');
    const [drag,setDrag]=useState(null);
    const [pdfUrl,setPdfUrl]=useState('');
    const [pdfDataUrl,setPdfDataUrl]=useState(savedSession?.pdfDataUrl||'');
    const [pdfPage,setPdfPage]=useState(savedSession?.pdfPage||1);
    const [pdfPageCount,setPdfPageCount]=useState(savedSession?.pdfPageCount||0);
    const [pdfLoading,setPdfLoading]=useState(false);
    const [pdfPageImage,setPdfPageImage]=useState(savedSession?.pdfPageImage||'');
    const [pdfThumbs,setPdfThumbs]=useState([]);
    const [pdfThumbsLoading,setPdfThumbsLoading]=useState(false);
    const [canvasModal,setCanvasModal]=useState(false);
    const [assemblyMode,setAssemblyMode]=useState(savedSession?.assemblyMode??true);
    const [assemblySources,setAssemblySources]=useState(savedSession?.assemblySources||[]);
    const [assemblySelected,setAssemblySelected]=useState(savedSession?.assemblySelected??0);
    const [assemblyOuterOnly,setAssemblyOuterOnly]=useState(savedSession?.assemblyOuterOnly??true);
    const [parts,setParts]=useState(savedSession?.parts||readSilhouetteParts());
    const [assemblyLayout,setAssemblyLayout]=useState(savedSession?.assemblyLayout||'vertical');
    const [assemblyGap,setAssemblyGap]=useState(savedSession?.assemblyGap??24);
    const [partName,setPartName]=useState('');
    const [openPopover,setOpenPopover]=useState(null); // null | 'magnify' | 'calibrate'

    const svgRef=useRef(null),pointers=useRef(new Map()),pinch=useRef(null),history=useRef([]),redoStack=useRef([]),pdfDocRef=useRef(null),hydratedPdfRef=useRef(false);
    const points=useMemo(()=>nodes.map(({x,y})=>({x,y})),[nodes]);
    const path=useMemo(()=>pathFor(nodes),[nodes]);
    const box=useMemo(()=>bounds(points),[points]);
    const activeLayer=assemblySources[assemblySelected]||null;

    const calibrationPixels=calibration.length===2?dist(calibration[0],calibration[1]):null;
    const calibrationPpi=calibrationPixels&&referenceInches>0?calibrationPixels/referenceInches:null;
    const sourceLongest=box&&calibrationPixels?Math.max(box.width,box.height)/calibrationPixels*referenceInches:null;
    const dimensions=box?box.height>=box.width?{width:outputInches*box.width/box.height,height:outputInches}:{width:outputInches,height:outputInches*box.height/box.width}:null;

    useEffect(()=>{
      if(!initialSource)return;
      makeImageLayer('initial-source',sourceName||'Source photo',initialSource,{y:STAGE.height*0.42}).then(layer=>{
        setAssemblySources(cur=>cur.length?cur:[layer]);
      }).catch(()=>{});
      setAssemblyMode(true);
      setExtracting(false);
      setNotice('Assembly canvas ready. Add and align references, then create one silhouette.');
    },[initialSource]);

    useEffect(()=>{
      if(initialSource||!savedSession?.pdfDataUrl||hydratedPdfRef.current)return;
      hydratedPdfRef.current=true;
      let u='';
      ensurePdfJs().then(async pdf=>{
        const blob=await fetch(savedSession.pdfDataUrl).then(r=>r.blob());
        u=URL.createObjectURL(blob);
        setPdfUrl(u);
        pdf.GlobalWorkerOptions.workerSrc='assets/pdf.worker.min.js';
        const doc=await pdf.getDocument({url:u}).promise;
        pdfDocRef.current=doc;
        setPdfPageCount(doc.numPages);
        generatePdfThumbs(doc);
        return renderPdfPage(doc,Math.min(savedSession.pdfPage||1,doc.numPages));
      }).catch(()=>setNotice('The saved PDF is still here, but it could not be re-rendered. Use Photo / PDF to reopen it.'));
      return()=>{if(u)URL.revokeObjectURL(u);};
    },[initialSource,savedSession]);

    useEffect(()=>{
      if(initialSource||!savedSession?.source||assemblySources.length)return;
      makeImageLayer('restored-source',savedSession.sourceName||'Restored reference',savedSession.source,{y:STAGE.height*0.42}).then(layer=>{
        setAssemblySources(cur=>cur.length?cur:[layer]);
      }).catch(()=>{});
      setAssemblyMode(true);
      setNotice('Your saved reference was restored to the assembly canvas.');
    },[initialSource,savedSession,assemblySources.length]);

    useEffect(()=>()=>{if(pdfUrl)URL.revokeObjectURL(pdfUrl);},[pdfUrl]);

    useEffect(()=>{
      if(!canvasModal)return;
      const onKey=e=>{if(e.key==='Escape')setCanvasModal(false);};
      window.addEventListener('keydown',onKey);
      return()=>window.removeEventListener('keydown',onKey);
    },[canvasModal]);

    useEffect(()=>{
      if(selected===null||!nodes[selected]||!svgRef.current||!magnifierOpen||!magnifierEnabled)return;
      const place=()=>{
        const svg=svgRef.current,wrap=svg.parentElement,sr=svg.getBoundingClientRect(),wr=wrap.getBoundingClientRect();
        const fit=Math.min(sr.width/STAGE.width,sr.height/STAGE.height);
        const offsetX=(sr.width-STAGE.width*fit)/2,offsetY=(sr.height-STAGE.height*fit)/2;
        const node=nodes[selected];
        const x=sr.left-wr.left+offsetX+(node.x*zoom+pan.x)*fit;
        const y=sr.top-wr.top+offsetY+(node.y*zoom+pan.y)*fit;
        const w=180,h=180,g=12;
        const left=clamp(x-w/2,8,Math.max(8,wr.width-w-8));
        const top=clamp(y-h-g,42,Math.max(42,wr.height-h-8));
        setMagnifierPos({left,top});
      };
      const frame=requestAnimationFrame(place);
      window.addEventListener('resize',place);
      return()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',place);};
    },[selected,nodes,zoom,pan,magnifierOpen,magnifierEnabled]);

    useEffect(()=>{
      if(!source&&!pdfDataUrl&&!parts.length&&!assemblySources.length)return;
      try{
        localStorage.setItem(SILHOUETTE_SESSION_KEY,JSON.stringify({source,sourceName,pdfDataUrl,pdfPage,pdfPageCount,pdfPageImage,nodes,calibration,referenceInches,outputInches,photoOpacity,autoThreshold,zoom,pan,showHandles,focusSelected,magnifierEnabled,magnifierRadius,assemblyMode,assemblySources,assemblySelected,assemblyOuterOnly,parts,assemblyLayout,assemblyGap,savedAt:Date.now()}));
      }catch{setNotice('Your browser storage is full; the current session may not persist.');}
    },[source,sourceName,pdfDataUrl,pdfPage,pdfPageCount,pdfPageImage,nodes,calibration,referenceInches,outputInches,photoOpacity,autoThreshold,zoom,pan,showHandles,focusSelected,magnifierEnabled,magnifierRadius,assemblyMode,assemblySources,assemblySelected,assemblyOuterOnly,parts,assemblyLayout,assemblyGap]);

    const commit=(fn)=>{history.current.push(nodes);redoStack.current=[];setNodes(fn);};

    const generatePdfThumbs=async(doc)=>{
      setPdfThumbs([]);
      setPdfThumbsLoading(true);
      try{
        for(let i=1;i<=doc.numPages;i++){
          const t=await renderPdfPageToDataUrl(doc,i,0.34);
          setPdfThumbs(cur=>[...cur,{page:i,data:t.data}]);
        }
      }catch{
        setNotice('Some PDF page previews could not be generated.');
      }finally{
        setPdfThumbsLoading(false);
      }
    };

    const renderPdfPage=async(doc,pageNumber)=>{
      if(!doc)return;
      setPdfLoading(true);
      try{
        const {data,width,height}=await renderPdfPageToDataUrl(doc,pageNumber,1.6);
        setPdfPage(pageNumber);
        setPdfPageImage(data);
        setSource(data);
        setAssemblyMode(true);
        setAssemblySources(cur=>{
          const exists=cur.some(layer=>layer.pdfName===sourceName&&layer.pdfPage===pageNumber);
          if(exists)return cur;
          return [...cur,{id:`assembly-pdf-${Date.now()}`,name:`${sourceName} · page ${pageNumber}`,data,visible:true,x:360,y:STAGE.height*0.42,scale:1,rotation:0,opacity:58,naturalWidth:width,naturalHeight:height,crop:{x:0,y:0,w:width,h:height},pdfName:sourceName,pdfPage:pageNumber,pdfPages:doc.numPages}];
        });
        setCalibration([]);
        setNodes(fallbackNodes());
        setSelected(null);
        setTool('trace');
        setNotice(`PDF page ${pageNumber} of ${doc.numPages} is active on the assembly canvas.`);
      }catch{
        setNotice('This PDF page could not be rendered. Try another page or a simpler PDF.');
      }finally{
        setPdfLoading(false);
      }
    };

    // Click a thumbnail to add THAT specific page straight to the assembly
    // canvas at full quality — no need to page through every page first.
    const addPdfPageAsLayer=async(pageNumber)=>{
      const doc=pdfDocRef.current;
      if(!doc)return;
      setPdfLoading(true);
      try{
        const {data,width,height}=await renderPdfPageToDataUrl(doc,pageNumber,1.6);
        setPdfPage(pageNumber);
        setPdfPageImage(data);
        addAssemblyLayer({id:`assembly-pdf-${Date.now()}`,name:`${sourceName} · page ${pageNumber}`,data,visible:true,x:360,y:STAGE.height*0.42,scale:1,rotation:0,opacity:58,naturalWidth:width,naturalHeight:height,crop:{x:0,y:0,w:width,h:height},pdfName:sourceName,pdfPage:pageNumber,pdfPages:doc.numPages});
      }catch{
        setNotice(`Page ${pageNumber} could not be rendered.`);
      }finally{
        setPdfLoading(false);
      }
    };

    const updateAssemblyLayer=(id,patch)=>setAssemblySources(cur=>cur.map(layer=>layer.id===id?{...layer,...patch}:layer));
    const updateAssemblyCrop=(id,patch)=>setAssemblySources(cur=>cur.map(layer=>layer.id===id?{...layer,crop:{...(layer.crop||{}),...patch}}:layer));
    const removeAssemblyLayer=(id)=>{setAssemblySources(cur=>{const next=cur.filter(layer=>layer.id!==id);setAssemblySelected(i=>Math.max(0,Math.min(i,next.length-1)));return next;});};
    const addAssemblyLayer=(layer)=>{setAssemblySources(cur=>{const next=[...cur,layer];setAssemblySelected(next.length-1);return next;});setAssemblyMode(true);setNotice(`${layer.name} added to the assembly canvas. Align it before tracing.`);};

    const onAssemblyFiles=(e)=>{
      const files=Array.from(e.target.files||[]);
      e.target.value='';
      files.forEach((f,idx)=>{
        if(f.type==='application/pdf'||/\.pdf$/i.test(f.name)){
          fileAsDataUrl(f).then(data=>{
            const u=URL.createObjectURL(f);
            setPdfUrl(u);setPdfDataUrl(data);setSourceName(f.name);
            return ensurePdfJs().then(pdf=>{
              pdf.GlobalWorkerOptions.workerSrc='assets/pdf.worker.min.js';
              return pdf.getDocument({url:u}).promise;
            }).then(doc=>{
              pdfDocRef.current=doc;
              setPdfPageCount(doc.numPages);
              generatePdfThumbs(doc);
              return renderPdfPageToDataUrl(doc,1,1.6).then(result=>({...result,pages:doc.numPages}));
            });
          }).then(result=>addAssemblyLayer({id:`assembly-${Date.now()}-${idx}`,name:`${f.name}${result.pages>1?` · page 1 of ${result.pages}`:''}`,data:result.data,visible:true,x:360,y:STAGE.height*0.42,scale:1,rotation:0,opacity:58,naturalWidth:result.width,naturalHeight:result.height,crop:{x:0,y:0,w:result.width,h:result.height},pdfName:f.name,pdfPage:1,pdfPages:result.pages})).catch(()=>setNotice(`${f.name} could not be added as a PDF reference.`));
        }else if(f.type.startsWith('image/')){
          fileAsDataUrl(f).then(data=>makeImageLayer(`assembly-${Date.now()}-${idx}`,f.name,data)).then(layer=>addAssemblyLayer(layer)).catch(()=>setNotice(`${f.name} could not be read.`));
        }
      });
    };

    const composeAssembly=async()=>{
      const c=document.createElement('canvas');
      c.width=STAGE.width;c.height=STAGE.height;
      const ctx=c.getContext('2d');
      ctx.fillStyle='#fffafd';ctx.fillRect(0,0,c.width,c.height);
      for(const layer of assemblySources.filter(x=>x.visible!==false)){
        const img=await loadImage(layer.data);
        const crop=layer.crop||{x:0,y:0,w:img.naturalWidth,h:img.naturalHeight};
        const sx=clamp(crop.x,0,Math.max(0,img.naturalWidth-1)),sy=clamp(crop.y,0,Math.max(0,img.naturalHeight-1));
        const sw=clamp(crop.w,1,img.naturalWidth-sx),sh=clamp(crop.h,1,img.naturalHeight-sy);
        ctx.save();
        ctx.globalAlpha=(layer.opacity??58)/100;
        ctx.translate(layer.x??360,layer.y??STAGE.height*0.42);
        ctx.rotate((layer.rotation||0)*Math.PI/180);
        const scale=layer.scale||1;
        ctx.drawImage(img,sx,sy,sw,sh,-sw*scale/2,-sh*scale/2,sw*scale,sh*scale);
        ctx.restore();
      }
      return c.toDataURL('image/png');
    };

    const createSingleSilhouette=async()=>{
      if(!assemblySources.length&&!source){setNotice('Add at least one photo or PDF page to the assembly canvas.');return;}
      setExtracting(true);
      try{
        const composite=await composeAssembly();
        setSource(composite);
        setSourceName('assembled-pattern-reference');
        setAssemblyMode(false);
        const n=await autoTrace(composite,autoThreshold);
        setNodes(n);
        setSelected(null);
        setTool('trace');
        setNotice('One outer silhouette created from the assembled references. Internal markings were ignored.');
      }catch(err){
        setNotice(err.message||'The assembled reference could not be traced.');
      }finally{
        setExtracting(false);
      }
    };

    const onFile=(e)=>{
      const f=e.target.files?.[0];
      if(!f)return;
      e.target.value='';
      if(f.type==='application/pdf'||/\.pdf$/i.test(f.name)){
        if(pdfUrl)URL.revokeObjectURL(pdfUrl);
        setSource('');setPdfPageImage('');setSourceName(f.name);setPdfLoading(true);setPdfThumbs([]);
        fileAsDataUrl(f).then(data=>{
          setPdfDataUrl(data);
          const u=URL.createObjectURL(f);
          setPdfUrl(u);
          return ensurePdfJs().then(pdf=>{
            pdf.GlobalWorkerOptions.workerSrc='assets/pdf.worker.min.js';
            return pdf.getDocument({url:u}).promise;
          });
        }).then(doc=>{
          pdfDocRef.current=doc;
          setPdfPageCount(doc.numPages);
          generatePdfThumbs(doc);
          return renderPdfPage(doc,1);
        }).catch(()=>{
          setPdfLoading(false);
          setNotice('The PDF could not be opened. Please try a standard PDF file.');
        });
        return;
      }
      if(!f.type.startsWith('image/')){setNotice('Choose a JPG, PNG, WebP, or PDF file.');return;}
      fileAsDataUrl(f).then(data=>makeImageLayer(`assembly-photo-${Date.now()}`,f.name,data).then(layer=>{
        setSource(data);setSourceName(f.name);
        setPdfUrl('');setPdfDataUrl('');setPdfPageImage('');setPdfPageCount(0);setPdfThumbs([]);
        setAssemblySources([layer]);
        setAssemblySelected(0);setAssemblyMode(true);setCalibration([]);setExtracting(false);
        return fallbackNodes();
      })).then(n=>{
        commit(()=>n);setSelected(null);setTool('trace');
        setNotice('Automatic outline ready. Drag any point only if it needs cleanup.');
      }).catch(()=>{
        setNodes(fallbackNodes());
        setNotice('Photo loaded. The draft outline is ready for cleanup.');
      }).finally(()=>setExtracting(false));
    };

    const addNode=()=>{
      if(nodes.length<3){commit(cur=>[...cur,makeNode({x:360,y:STAGE.height*0.42})]);return;}
      const i=selected??0,next=(i+1)%nodes.length;
      const mid={x:(nodes[i].x+nodes[next].x)/2,y:(nodes[i].y+nodes[next].y)/2};
      commit(cur=>[...cur.slice(0,next),makeNode(mid),...cur.slice(next)]);
      setSelected(next);
      setNotice('Node added between the selected point and its neighbor.');
    };
    const deleteNode=()=>{
      if(selected===null||nodes.length<=3){setNotice('Keep at least three nodes to retain a closed silhouette.');return;}
      commit(cur=>cur.filter((_,i)=>i!==selected));
      setSelected(null);
    };
    const updateNode=(i,p)=>commit(cur=>cur.map((n,j)=>j===i?{...n,x:clamp(p.x,10,STAGE.width-10),y:clamp(p.y,10,STAGE.height-10),handleIn:{x:n.handleIn.x+(p.x-n.x),y:n.handleIn.y+(p.y-n.y)},handleOut:{x:n.handleOut.x+(p.x-n.x),y:n.handleOut.y+(p.y-n.y)}}:n));

    const onStageDown=(e)=>{
      const m=pointers.current;
      m.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(m.size===2){
        const v=[...m.values()];
        pinch.current={d:dist(v[0],v[1]),z:zoom,p:{...pan}};
        setDrag(null);setMagnifierOpen(false);
        return;
      }
      if(assemblyMode&&activeLayer){
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setDrag({target:'assembly',id:activeLayer.id,lastX:e.clientX,lastY:e.clientY});
        return;
      }
      if(tool==='pan'){e.currentTarget.setPointerCapture?.(e.pointerId);return;}
      const p=eventPoint(e,svgRef.current,pan,zoom);
      if(tool==='calibrate'){
        setCalibration(cur=>cur.length===2?[p,...cur.slice(1)]:[...cur,p]);
        if(calibration.length===1){setTool('trace');setNotice('Reference captured. Now shape the vector outline.');}
        return;
      }
      const hit=nearest(p,nodes);
      if(hit.index!==null&&hit.distance<42/zoom){
        setSelected(hit.index);
        setDrag({index:hit.index,target:'node'});
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }else if(!nodes.length){
        commit(cur=>[...cur,makeNode(p)]);
      }
    };
    const onStageMove=(e)=>{
      const m=pointers.current;
      if(m.has(e.pointerId))m.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(m.size>=2&&pinch.current){
        const v=[...m.values()];
        setZoom(clamp(Number((pinch.current.z*dist(v[0],v[1])/pinch.current.d).toFixed(2)),.5,3));
        return;
      }
      if(tool==='pan'&&m.size===1){
        const r=svgRef.current.getBoundingClientRect();
        setPan(cur=>({x:cur.x+e.movementX/r.width*STAGE.width,y:cur.y+e.movementY/r.height*STAGE.height}));
        return;
      }
      if(drag&&drag.target==='assembly'){
        const r=svgRef.current.getBoundingClientRect(),dx=e.movementX/r.width*STAGE.width/zoom,dy=e.movementY/r.height*STAGE.height/zoom;
        updateAssemblyLayer(drag.id,{x:(assemblySources.find(layer=>layer.id===drag.id)?.x??360)+dx,y:(assemblySources.find(layer=>layer.id===drag.id)?.y??STAGE.height*0.42)+dy});
        return;
      }
      if(drag){
        const p=eventPoint(e,svgRef.current,pan,zoom);
        if(drag.target==='node'){setMagnifierOpen(true);updateNode(drag.index,p);}
        if(drag.target==='handleIn'||drag.target==='handleOut')commit(cur=>cur.map((n,j)=>j===drag.index?{...n,kind:'smooth',[drag.target]:{x:clamp(p.x,10,STAGE.width-10),y:clamp(p.y,10,STAGE.height-10)}}:n));
      }
    };
    const onWheel=(e)=>{e.preventDefault();setZoom(z=>clamp(Number((z*(e.deltaY>0?.9:1.1)).toFixed(2)),.5,3));};
    const onStageUp=(e)=>{pointers.current.delete(e.pointerId);if(pointers.current.size<2)pinch.current=null;setDrag(null);setMagnifierOpen(false);};

    const setKind=(kind)=>{
      if(selected===null)return;
      commit(cur=>cur.map((n,i)=>{
        if(i!==selected)return n;
        if(kind==='sharp')return{...n,kind};
        const prev=cur[(i-1+cur.length)%cur.length],next=cur[(i+1)%cur.length];
        return{...n,kind:'smooth',...defaultHandles(n,prev,next)};
      }));
    };
    const selectAdjacent=(d)=>{if(!nodes.length)return;setSelected(i=>((i??(d>0?-1:0))+d+nodes.length)%nodes.length);setTool('trace');};
    const undo=()=>{const previous=history.current.pop();if(previous){redoStack.current.push(nodes);setNodes(previous);setNotice('Last edit undone.');}};
    const redo=()=>{const next=redoStack.current.pop();if(next){history.current.push(nodes);setNodes(next);setNotice('Edit restored.');}};
    const reset=()=>{setZoom(1);setPan({x:0,y:0});setCalibration([]);setNodes(fallbackNodes());setSelected(null);setTool('trace');setNotice('View and outline reset.');};
    const toggleMoveCanvas=()=>setTool(t=>t==='pan'?'trace':'pan');
    const togglePopover=(name)=>setOpenPopover(cur=>cur===name?null:name);

    const exportSvg=()=>{
      if(!path||!dimensions)return;
      const pad=8;
      const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.minX-pad} ${box.minY-pad} ${box.width+pad*2} ${box.height+pad*2}" width="${dimensions.width.toFixed(3)}in" height="${dimensions.height.toFixed(3)}in"><path d="${path}" fill="#ffffff" stroke="#6d334b" stroke-width="4" stroke-linejoin="round"/></svg>`;
      const a=document.createElement('a');
      a.href=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
      a.download=`${sourceName.replace(/\.[^/.]+$/,'')||'pad'}-silhouette-${outputInches}in.svg`;
      a.click();
      setNotice('SVG exported at the selected physical size.');
    };
    const addCurrentPart=()=>{
      if(!path||!box){setNotice('Create an outline before adding a pattern part.');return;}
      const label=(partName.trim()||((pdfUrl?'Page ':'Part ')+(pdfUrl?pdfPage:parts.length+1)));
      const part={id:`part-${Date.now()}-${parts.length}`,name:label,page:pdfUrl?pdfPage:null,nodes:nodes.map(n=>({...n,handleIn:{...n.handleIn},handleOut:{...n.handleOut}})),box:{...box}};
      const nextParts=[...parts,part];
      setParts(nextParts);
      writeSilhouetteParts(nextParts);
      setPartName('');
      setNotice(`${label} saved as an editable pattern part. Select another PDF page to continue.`);
    };
    const exportPartSvg=(part)=>{
      const b=part.box,pad=8,d=pathFor(part.nodes);
      const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.minX-pad} ${b.minY-pad} ${b.width+pad*2} ${b.height+pad*2}"><path d="${d}" fill="#ffffff" stroke="#6d334b" stroke-width="4" stroke-linejoin="round"/></svg>`;
      const a=document.createElement('a');
      a.href=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
      a.download=`${part.name.replace(/[^a-z0-9_-]+/gi,'-').toLowerCase()||'pattern-part'}.svg`;
      a.click();
    };
    const exportJoinedSvg=()=>{
      if(parts.length<2){setNotice('Save at least two pattern parts before joining them.');return;}
      let cursor=0;
      const pad=24;
      const placed=parts.map(part=>{
        const offset=assemblyLayout==='horizontal'?{x:cursor,y:0}:{x:0,y:cursor};
        cursor+=(assemblyLayout==='horizontal'?part.box.width:part.box.height)+assemblyGap;
        return{...part,offset};
      });
      const width=assemblyLayout==='horizontal'?cursor-assemblyGap:Math.max(...placed.map(p=>p.box.width));
      const height=assemblyLayout==='horizontal'?Math.max(...placed.map(p=>p.box.height)):cursor-assemblyGap;
      const groups=placed.map((part,i)=>{
        const d=pathFor(part.nodes),tx=pad+part.offset.x-part.box.minX,ty=pad+part.offset.y-part.box.minY;
        return`<g id="${part.name.replace(/[^a-z0-9_-]+/gi,'-').toLowerCase()||`part-${i+1}`}" transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)})"><path d="${d}" fill="none" stroke="#6d334b" stroke-width="4" stroke-linejoin="round"/></g>`;
      }).join('');
      const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${(width+pad*2).toFixed(2)} ${(height+pad*2).toFixed(2)}" width="${(width+pad*2).toFixed(2)}" height="${(height+pad*2).toFixed(2)}"><title>Joined multi-part pattern</title>${groups}</svg>`;
      const a=document.createElement('a');
      a.href=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
      a.download=`${sourceName.replace(/\.[^/.]+$/,'')||'pattern'}-joined.svg`;
      a.click();
      setNotice(`Joined ${parts.length} editable parts into one SVG.`);
    };

    // ---------- the persistent 3-group ribbon ----------
    // Always visible in the canvas editor (modal or inline). Node-editing
    // tools act on the selected node immediately; Canvas-view tools change
    // zoom/pan; Output tools open the calibration panel or the clean review.
    const ribbon=(
      <div className="wp-ribbon" role="toolbar" aria-label="Silhouette editing tools">
        <div className="wp-ribbon-group">
          <span className="wp-ribbon-group-label">Node</span>
          <button className={'wp-ribbon-btn'+(selected!==null&&nodes[selected]?.kind==='sharp'?' on':'')} onClick={()=>setKind('sharp')} disabled={selected===null} title="Straight corner"><Icon name="edit" className="ico-sm"/><span>Straight</span></button>
          <button className={'wp-ribbon-btn'+(selected!==null&&nodes[selected]?.kind==='smooth'?' on':'')} onClick={()=>setKind('smooth')} disabled={selected===null} title="Smooth curve"><Icon name="layers" className="ico-sm"/><span>Curve</span></button>
          <button className="wp-ribbon-btn" onClick={addNode} disabled={!source&&!assemblySources.length} title="Add a node"><Icon name="plus" className="ico-sm"/><span>Add</span></button>
          <button className="wp-ribbon-btn" onClick={deleteNode} disabled={selected===null||nodes.length<=3} title="Remove selected node"><Icon name="trash" className="ico-sm"/><span>Remove</span></button>
          <button className="wp-ribbon-btn" onClick={()=>selectAdjacent(-1)} disabled={!nodes.length} title="Previous node"><Icon name="chevronLeft" className="ico-sm"/><span>Prev</span></button>
          <button className="wp-ribbon-btn" onClick={()=>selectAdjacent(1)} disabled={!nodes.length} title="Next node"><Icon name="chevronRight" className="ico-sm"/><span>Next</span></button>
        </div>
        <div className="wp-ribbon-divider"/>
        <div className="wp-ribbon-group">
          <span className="wp-ribbon-group-label">Canvas</span>
          <button className="wp-ribbon-btn" onClick={()=>setZoom(z=>clamp(Number((z-.25).toFixed(2)),.5,3))} title="Zoom out">−</button>
          <span className="wp-ribbon-zoom">{Math.round(zoom*100)}%</span>
          <button className="wp-ribbon-btn" onClick={()=>setZoom(z=>clamp(Number((z+.25).toFixed(2)),.5,3))} title="Zoom in">+</button>
          <button className="wp-ribbon-btn" onClick={()=>{setZoom(1);setPan({x:0,y:0});}} title="Fit to canvas">Fit</button>
          <button className={'wp-ribbon-btn'+(tool==='pan'?' on':'')} onClick={toggleMoveCanvas} title="Toggle move-canvas mode" aria-pressed={tool==='pan'}><Icon name="aperture" className="ico-sm"/><span>Move canvas</span></button>
          <button className={'wp-ribbon-btn'+(openPopover==='magnify'?' on':'')} onClick={()=>togglePopover('magnify')} title="Magnifier settings" aria-expanded={openPopover==='magnify'}><Icon name="search" className="ico-sm"/><span>Magnify</span></button>
        </div>
        <div className="wp-ribbon-divider"/>
        <div className="wp-ribbon-group">
          <span className="wp-ribbon-group-label">Output</span>
          <button className={'wp-ribbon-btn'+(openPopover==='calibrate'?' on':'')+(calibrationPpi?' wp-ribbon-btn--locked':'')} onClick={()=>togglePopover('calibrate')} title="Calibration" aria-expanded={openPopover==='calibrate'}><Icon name="scissors" className="ico-sm"/><span>Calibration{calibrationPpi?' ✓':''}</span></button>
          <button className="wp-ribbon-btn" onClick={()=>{setPreviewMode('outline');setPreview(true);}} disabled={!path} title="Review clean silhouette"><Icon name="eye" className="ico-sm"/><span>Review</span></button>
        </div>

        {openPopover==='magnify'&&(
          <div className="wp-popover wp-popover--magnify" role="dialog" aria-label="Magnifier settings">
            <div className="wp-popover-head"><strong>Magnifier</strong><button className="wp-popover-close" onClick={()=>setOpenPopover(null)}><Icon name="x" className="ico-sm"/></button></div>
            <label className="wp-popover-check"><input type="checkbox" checked={magnifierEnabled} onChange={e=>setMagnifierEnabled(e.target.checked)}/> Show while dragging a node</label>
            <label className="wp-popover-slider">Zoom level<input type="range" min="40" max="140" step="5" value={magnifierRadius} onChange={e=>setMagnifierRadius(Number(e.target.value))} disabled={!magnifierEnabled}/></label>
            <p className="wp-popover-note">The magnifier appears directly above the node only while you're dragging it — not just when it's selected.</p>
          </div>
        )}
        {openPopover==='calibrate'&&(
          <div className="wp-popover wp-popover--calibrate" role="dialog" aria-label="Calibration">
            <div className="wp-popover-head"><strong>Scale calibration</strong><button className="wp-popover-close" onClick={()=>setOpenPopover(null)}><Icon name="x" className="ico-sm"/></button></div>
            <div className="wp-popover-row"><span>Reference line</span><b>{calibration.length===2?`${Math.round(calibrationPixels)} px marked`:'Not set'}</b></div>
            <label className="wp-popover-slider">Reference length (in)<input type="number" min="1" max="12" step="0.25" value={referenceInches} onChange={e=>setReferenceInches(Number(e.target.value)||1)}/></label>
            <div className="wp-popover-row wp-popover-row--ppi"><span>Locked pixels-per-inch</span><b>{calibrationPpi?calibrationPpi.toFixed(1)+' ppi':'—'}</b></div>
            <button className="btn btn-blush" style={{width:'100%',marginTop:8}} onClick={()=>{setTool('calibrate');setOpenPopover(null);setNotice('Click two points on the canvas to mark a known-length reference line.');}}><Icon name="scissors" className="ico-sm"/> {calibrationPpi?'Re-mark reference line':'Mark reference line on canvas'}</button>
          </div>
        )}
      </div>
    );

    const content=<div className={'silhouette-body'+(canvasModal?' silhouette-body--canvas-modal':'')} role={canvasModal?'dialog':undefined} aria-modal={canvasModal?'true':undefined} aria-label={canvasModal?'Focused silhouette canvas editor':undefined}>
      {canvasModal&&<div className="silhouette-canvas-modal-head">
        <div><div className="eyebrow">Focused canvas editor</div><strong>{sourceName||'Silhouette outline'}</strong><span className="silhouette-modal-status">{selected===null?'Select a node or choose a tool':`Node ${selected+1} of ${nodes.length}`}</span></div>
        <div className="silhouette-canvas-modal-actions">
          <button className="btn btn-blush" onClick={exportSvg} disabled={!path}><Icon name="download" className="ico-sm"/> Export SVG</button>
          <button className="icon-btn" onClick={()=>setCanvasModal(false)} title="Close focused canvas"><Icon name="x" className="ico-sm"/></button>
        </div>
      </div>}

      <aside className="silhouette-side">
        <div className="silhouette-step"><span>01</span><div><strong>Place your source</strong><p>Upload a pad photo, transparent cutout, or PDF pattern reference.</p></div></div>
        <div className="silhouette-step"><span>02</span><div><strong>Shape the vector path</strong><p>Select nodes, switch straight or smooth joins, add points, or remove extras from the ribbon below the canvas.</p></div></div>
        <div className="silhouette-step"><span>03</span><div><strong>Measure and export</strong><p>Calibrate a known reference length, choose the finished longest edge, review, and export SVG.</p></div></div>

        <div className="silhouette-source">
          {pdfUrl?<>
            <div className="eyebrow">PDF pattern reference · tap a page to add it</div>
            <strong>{sourceName}{pdfPageCount?` · ${pdfPageCount} page${pdfPageCount===1?'':'s'}`:''}</strong>
            <div className="wp-pdf-thumbs">
              {pdfThumbs.map(t=>{
                const added=assemblySources.some(l=>l.pdfName===sourceName&&l.pdfPage===t.page);
                return (
                  <button key={t.page} type="button" className={'wp-pdf-thumb'+(added?' wp-pdf-thumb--added':'')} onClick={()=>addPdfPageAsLayer(t.page)} title={`Add page ${t.page} to canvas`}>
                    <img src={t.data} alt={`Page ${t.page}`}/>
                    <span className="wp-pdf-thumb-num">{t.page}</span>
                    {added&&<span className="wp-pdf-thumb-badge">✓</span>}
                  </button>
                );
              })}
              {pdfThumbsLoading&&<div className="wp-pdf-thumb wp-pdf-thumb--loading">…</div>}
            </div>
            {pdfLoading&&<div className="wp-pdf-thumbs-hint">Rendering page…</div>}
          </>:source?<>
            <div className="eyebrow">Source photo</div>
            <strong>{sourceName}</strong>
            <img src={source} alt="Source pad"/>
          </>:<div className="silhouette-empty">Upload a photo or PDF to begin.</div>}
        </div>

        <div className="silhouette-fields">
          <label>Reference pixels<input type="number" min="0" value={calibration.length===2?Math.round(calibrationPixels):''} readOnly placeholder="Mark a reference line"/></label>
          <label>Reference length (in)<input type="number" min="1" max="12" step="0.25" value={referenceInches} onChange={e=>setReferenceInches(Number(e.target.value)||1)}/></label>
          <label>Output longest edge (in)<input type="number" min="6" max="20" value={outputInches} onChange={e=>setOutputInches(Number(e.target.value)||10)}/></label>
        </div>
      </aside>

      <section className="silhouette-work">
        <div className="silhouette-assembly-bar">
          <div className="silhouette-assembly-heading">
            <div>
              <div className="eyebrow">Assembly canvas first</div>
              <strong>{assemblyMode?'Align reference pages before tracing':'Single shop-preview silhouette'}</strong>
              <span>{assemblySources.length} reference layer{assemblySources.length===1?'':'s'} · {assemblyOuterOnly?'outer boundary only':'visible contours'}</span>
            </div>
            <div className="silhouette-assembly-actions">
              <label className="btn btn-ghost"><Icon name="upload" className="ico-sm"/> Add photo/PDF<input type="file" accept="image/*,.pdf,application/pdf" multiple onChange={onAssemblyFiles}/></label>
              <button className="btn btn-blush" onClick={createSingleSilhouette} disabled={extracting||(!assemblySources.length&&!source)}><Icon name="sparkles" className="ico-sm"/> {extracting?'Tracing…':assemblyMode?'Create one silhouette':'Refresh silhouette'}</button>
            </div>
          </div>
          {assemblySources.length>0&&<div className="silhouette-layer-strip">
            {assemblySources.map((layer,i)=><button key={layer.id} className={'silhouette-layer-chip'+(assemblySelected===i?' active':'')} onClick={()=>setAssemblySelected(i)}><span>{i+1}</span>{layer.name}<b onClick={e=>{e.stopPropagation();removeAssemblyLayer(layer.id);}}>×</b></button>)}
          </div>}
          {activeLayer&&<div className="silhouette-assembly-controls">
            <span className="muted">Selected layer</span><strong>{activeLayer.name}</strong>
            <label>X<input type="range" min="0" max={STAGE.width} value={activeLayer.x??360} onChange={e=>updateAssemblyLayer(activeLayer.id,{x:Number(e.target.value)})}/></label>
            <label>Y<input type="range" min="0" max={STAGE.height} value={activeLayer.y??STAGE.height*0.42} onChange={e=>updateAssemblyLayer(activeLayer.id,{y:Number(e.target.value)})}/></label>
            <label>Scale<input type="range" min=".25" max="2" step=".01" value={activeLayer.scale??1} onChange={e=>updateAssemblyLayer(activeLayer.id,{scale:Number(e.target.value)})}/></label>
            <label>Rotate<input type="range" min="-180" max="180" value={activeLayer.rotation??0} onChange={e=>updateAssemblyLayer(activeLayer.id,{rotation:Number(e.target.value)})}/></label>
            <label>Opacity<input type="range" min="10" max="100" value={activeLayer.opacity??58} onChange={e=>updateAssemblyLayer(activeLayer.id,{opacity:Number(e.target.value)})}/></label>
            <label className="assembly-check"><input type="checkbox" checked={assemblyOuterOnly} onChange={e=>setAssemblyOuterOnly(e.target.checked)}/> Outer boundary only</label>
          </div>}
          {activeLayer&&<div className="wp-crop-block">
            <div className="wp-crop-head">
              <span className="muted">Crop this reference — the original file is never resized, only the visible window changes</span>
              <button className="wp-ribbon-btn wp-ribbon-btn--tiny" onClick={()=>updateAssemblyCrop(activeLayer.id,{x:0,y:0,w:activeLayer.naturalWidth,h:activeLayer.naturalHeight})}>Reset crop</button>
            </div>
            <div className="wp-crop-grid">
              <label>Crop X<input type="range" min="0" max={Math.max(0,(activeLayer.naturalWidth||STAGE.width)-10)} value={activeLayer.crop?.x??0} onChange={e=>updateAssemblyCrop(activeLayer.id,{x:Number(e.target.value)})}/></label>
              <label>Crop Y<input type="range" min="0" max={Math.max(0,(activeLayer.naturalHeight||STAGE.height)-10)} value={activeLayer.crop?.y??0} onChange={e=>updateAssemblyCrop(activeLayer.id,{y:Number(e.target.value)})}/></label>
              <label>Crop W<input type="range" min="10" max={activeLayer.naturalWidth||STAGE.width} value={activeLayer.crop?.w??activeLayer.naturalWidth??STAGE.width} onChange={e=>updateAssemblyCrop(activeLayer.id,{w:Number(e.target.value)})}/></label>
              <label>Crop H<input type="range" min="10" max={activeLayer.naturalHeight||STAGE.height} value={activeLayer.crop?.h??activeLayer.naturalHeight??STAGE.height} onChange={e=>updateAssemblyCrop(activeLayer.id,{h:Number(e.target.value)})}/></label>
            </div>
          </div>}
        </div>

        <div className="silhouette-stage-wrap">
          <svg ref={svgRef} viewBox={`0 0 ${STAGE.width} ${STAGE.height}`} className="silhouette-stage" style={{touchAction:'none'}} onPointerDown={onStageDown} onPointerMove={onStageMove} onPointerUp={onStageUp} onPointerCancel={onStageUp} onWheel={onWheel}>
            <defs><pattern id="sil-grid-full" width="38" height="38" patternUnits="userSpaceOnUse"><path d="M38 0H0V38" fill="none" stroke="#6d334b" strokeOpacity=".09"/></pattern></defs>
            <rect width={STAGE.width} height={STAGE.height} fill="url(#sil-grid-full)"/>
            <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
              {assemblyMode?assemblySources.filter(layer=>layer.visible!==false).map(layer=>{
                const nat={w:layer.naturalWidth||layer.crop?.w||STAGE.width,h:layer.naturalHeight||layer.crop?.h||STAGE.height};
                const crop=layer.crop||{x:0,y:0,w:nat.w,h:nat.h};
                const clipId=`sil-clip-${layer.id}`;
                return (
                  <g key={layer.id} transform={`translate(${layer.x??360} ${layer.y??STAGE.height*0.42}) rotate(${layer.rotation||0}) scale(${layer.scale||1})`} opacity={(layer.opacity??58)/100}>
                    <defs><clipPath id={clipId}><rect x={-crop.w/2} y={-crop.h/2} width={crop.w} height={crop.h}/></clipPath></defs>
                    <g clipPath={`url(#${clipId})`}>
                      <image href={layer.data} x={-crop.w/2-crop.x} y={-crop.h/2-crop.y} width={nat.w} height={nat.h}/>
                    </g>
                  </g>
                );
              }) : source&&<image href={source} x="0" y="0" width={STAGE.width} height={STAGE.height} preserveAspectRatio="xMidYMid meet" opacity={photoOpacity/100}/>}
              {!assemblyMode&&pdfUrl&&!pdfPageImage&&<rect x="34" y="34" width={STAGE.width-68} height={STAGE.height-68} rx="10" fill="#fffafc" stroke="#d8b2cb" strokeDasharray="8 8"/>}
              {!assemblyMode&&path&&<path d={path} fill="#e9a7c9" fillOpacity=".20" stroke="#6d334b" strokeWidth={4/zoom}/>}
              {!assemblyMode&&showHandles&&selected!==null&&nodes[selected]?.kind==='smooth'&&<g className="bezier-handles">
                <line x1={nodes[selected].x} y1={nodes[selected].y} x2={nodes[selected].handleIn.x} y2={nodes[selected].handleIn.y}/>
                <line x1={nodes[selected].x} y1={nodes[selected].y} x2={nodes[selected].handleOut.x} y2={nodes[selected].handleOut.y}/>
                <circle cx={nodes[selected].handleIn.x} cy={nodes[selected].handleIn.y} r={8/zoom} onPointerDown={e=>{e.preventDefault();e.stopPropagation();setSelected(selected);setDrag({index:selected,target:'handleIn'});e.currentTarget.setPointerCapture?.(e.pointerId);}}/>
                <circle cx={nodes[selected].handleOut.x} cy={nodes[selected].handleOut.y} r={8/zoom} onPointerDown={e=>{e.preventDefault();e.stopPropagation();setSelected(selected);setDrag({index:selected,target:'handleOut'});e.currentTarget.setPointerCapture?.(e.pointerId);}}/>
              </g>}
              {!assemblyMode&&nodes.map((n,i)=><g key={i} className={focusSelected&&selected!==null&&selected!==i?'trace-point--dimmed':''} onPointerDown={e=>{e.stopPropagation();setSelected(i);setDrag({index:i,target:'node'});}}>
                <circle cx={n.x} cy={n.y} r={(selected===i?12:8)/zoom} fill={selected===i?'#c95f9c':'#fffafc'} stroke={n.kind==='smooth'?'#b99a43':'#6d334b'} strokeWidth={3/zoom}/>
                <path d={n.kind==='smooth'?`M${n.x-3} ${n.y}h6`:`M${n.x-3} ${n.y-3}l6 6m0-6l-6 6`} stroke="#6d334b" strokeWidth={1.4} fill="none"/>
              </g>)}
              {calibration.map((p,i)=><circle key={'cal'+i} cx={p.x} cy={p.y} r={8/zoom} fill="#b99a43" stroke="#fff" strokeWidth={3/zoom}/>)}
              {calibration.length===2&&<line x1={calibration[0].x} y1={calibration[0].y} x2={calibration[1].x} y2={calibration[1].y} stroke="#b99a43" strokeWidth={3/zoom}/>}
            </g>
          </svg>

          {!source&&!pdfUrl&&<label className="silhouette-upload-panel">
            <Icon name="upload" className="ico-lg"/>
            <strong>Place your pad photo or PDF pattern</strong>
            <span>Automatic edge detection, editable nodes, and calibrated SVG export.</span>
            <span className="btn btn-blush">Choose photo / PDF</span>
            <input type="file" accept="image/*,.pdf,application/pdf" onChange={onFile}/>
          </label>}
          {extracting&&<div className="silhouette-extracting"><Icon name="sparkles" className="ico-lg"/><strong>Finding the pad edge</strong><span>Preparing an editable first-pass outline.</span></div>}

          <div className="silhouette-stage-hint">Two fingers: zoom · One finger: drag a node · {selected===null?'Select a node for precise cleanup':`Node ${selected+1} of ${nodes.length}`}</div>

          {ribbon}

          {magnifierEnabled&&magnifierOpen&&selected!==null&&nodes[selected]&&<div className="silhouette-magnifier" style={{left:magnifierPos.left,top:magnifierPos.top}}>
            <div className="silhouette-magnifier-label">Node {selected+1} · precision view</div>
            <svg viewBox={`${nodes[selected].x-magnifierRadius} ${nodes[selected].y-magnifierRadius} ${magnifierRadius*2} ${magnifierRadius*2}`}>
              <path d={path} fill="#e9a7c9" fillOpacity=".18" stroke="#6d334b" strokeWidth="4"/>
              <circle cx={nodes[selected].x} cy={nodes[selected].y} r="10" fill="#c95f9c" stroke="#fff" strokeWidth="3"/>
            </svg>
          </div>}
        </div>

        <div className="silhouette-status"><Icon name="check" className="ico-sm"/> {notice}</div>
      </section>

      <aside className="silhouette-controls">
        <div className="control-label">Vector node {selected===null?'· select a dot':`· node ${selected+1} of ${nodes.length}`}</div>
        <div className="node-visibility-row">
          <button onClick={()=>setFocusSelected(v=>!v)} disabled={selected===null}><Icon name="eye" className="ico-sm"/> {focusSelected?'Show all nodes':'Focus selected'}</button>
          <button onClick={()=>setShowHandles(v=>!v)} disabled={selected===null||nodes[selected]?.kind!=='smooth'}><Icon name="layers" className="ico-sm"/> {showHandles?'Hide handles':'Show handles'}</button>
        </div>
        <div className="silhouette-control-block">
          <label>Trace visibility <output>{photoOpacity}%</output><input type="range" min="20" max="100" value={photoOpacity} onChange={e=>setPhotoOpacity(Number(e.target.value))}/></label>
        </div>
        <div className="silhouette-control-block">
          <label>Auto-trace sensitivity <output>{autoThreshold}</output><input type="range" min="18" max="105" value={autoThreshold} onChange={e=>setAutoThreshold(Number(e.target.value))}/></label>
          <small>Run "Create/Refresh silhouette" again after changing sensitivity.</small>
        </div>
        <div className="silhouette-dimension-grid">
          <div><span>Source longest edge</span><strong>{sourceLongest?sourceLongest.toFixed(1)+' in':'—'}</strong></div>
          <div><span>Export size</span><strong>{dimensions?`${dimensions.width.toFixed(1)} × ${dimensions.height.toFixed(1)}`:'—'}</strong></div>
        </div>

        <div className="silhouette-assembly-block">
          <div className="control-label">Multi-page pattern assembly</div>
          <p className="assembly-help">Save each traced PDF page as a separate editable part, then arrange the parts into one SVG.</p>
          <div className="assembly-add-row">
            <input value={partName} onChange={e=>setPartName(e.target.value)} placeholder={pdfUrl?`Page ${pdfPage} name`:`Part ${parts.length+1} name`}/>
            <button className="btn btn-ghost" onClick={addCurrentPart} disabled={!path}><Icon name="plus" className="ico-sm"/> Add part</button>
          </div>
          <div className="assembly-options">
            <label>Join layout<select value={assemblyLayout} onChange={e=>setAssemblyLayout(e.target.value)}><option value="vertical">Vertical stack</option><option value="horizontal">Horizontal row</option></select></label>
            <label>Gap <output>{assemblyGap}px</output><input type="range" min="0" max="120" value={assemblyGap} onChange={e=>setAssemblyGap(Number(e.target.value))}/></label>
          </div>
          {parts.length>0&&<div className="assembly-parts">
            {parts.map((part,i)=><div className="assembly-part" key={part.id}><span><b>{i+1}</b>{part.name}{part.page?` · PDF page ${part.page}`:''}</span><button title={`Export ${part.name}`} onClick={()=>exportPartSvg(part)}><Icon name="download" className="ico-sm"/></button></div>)}
          </div>}
          <button className="btn btn-blush" onClick={exportJoinedSvg} disabled={parts.length<2}><Icon name="download" className="ico-sm"/> Join {parts.length||''} parts into SVG</button>
        </div>

        <div className="silhouette-control-actions">
          <button className="btn btn-ghost" onClick={undo} disabled={!history.current.length}><Icon name="refresh" className="ico-sm"/> Undo</button>
          <button className="btn btn-ghost" onClick={redo} disabled={!redoStack.current.length}><Icon name="refresh" className="ico-sm"/> Redo</button>
          <button className="btn btn-ghost" onClick={reset}><Icon name="refresh" className="ico-sm"/> Reset</button>
        </div>
        <button className="btn btn-blush" onClick={exportSvg} disabled={!path}><Icon name="download" className="ico-sm"/> Export scalable SVG</button>
      </aside>
    </div>;

    const header=<header className="silhouette-head">
      <div>
        <div className="eyebrow">Editing Studio · specialist workstation</div>
        <h2 className="serif">Silhouette Studio</h2>
        <p className="muted small">Preserve the pad shape as an editable vector pattern, with photo and PDF reference support.</p>
      </div>
      <div className="silhouette-head-actions">
        <button className="btn btn-ghost silhouette-open-canvas" onClick={()=>setCanvasModal(true)} disabled={!source&&!pdfUrl}><Icon name="aperture" className="ico-sm"/> Open canvas</button>
        <label className="btn btn-ghost silhouette-upload"><Icon name="upload" className="ico-sm"/> Photo / PDF<input type="file" accept="image/*,.pdf,application/pdf" onChange={onFile}/></label>
        <button className="btn btn-blush" onClick={exportSvg} disabled={!path}><Icon name="download" className="ico-sm"/> Save SVG</button>
        {!standalone&&<button className="icon-btn" onClick={onClose} title="Close silhouette editor"><Icon name="x" className="ico-sm"/></button>}
        {standalone&&onGoto&&<button className="btn btn-ghost" onClick={()=>onGoto('generator')}><Icon name="sparkles" className="ico-sm"/> Production</button>}
      </div>
    </header>;

    const page=<div className="silhouette-page">
      {header}
      <div className="silhouette-page-inner">{content}</div>
      {preview&&<div className="silhouette-preview" role="dialog" aria-modal="true">
        <div className="silhouette-preview-card">
          <div className="row between">
            <div><div className="eyebrow">Review sheet / before export</div><h3 className="serif">Check your silhouette</h3></div>
            <button className="icon-btn" onClick={()=>setPreview(false)}><Icon name="x" className="ico-sm"/></button>
          </div>
          <div className="preview-mode-toggle">
            <button className={previewMode==='outline'?'active':''} onClick={()=>setPreviewMode('outline')}><Icon name="eye" className="ico-sm"/> Clean silhouette</button>
            <button className={previewMode==='compare'?'active':''} onClick={()=>setPreviewMode('compare')} disabled={!source}><Icon name="photo" className="ico-sm"/> Compare to photo</button>
          </div>
          <div className="preview-canvas"><svg viewBox={`0 0 ${STAGE.width} ${STAGE.height}`}>
            {previewMode==='compare'&&source&&<image href={source} x="0" y="0" width={STAGE.width} height={STAGE.height} preserveAspectRatio="xMidYMid meet" opacity=".25"/>}
            <path d={path} fill={previewMode==='outline'?'#fffafc':'#e9a7c9'} fillOpacity=".9" stroke="#6d334b" strokeWidth="5"/>
          </svg></div>
          <div className="preview-summary">
            <span>{nodes.length} editable nodes</span>
            <span>{dimensions?`${dimensions.width.toFixed(1)} × ${dimensions.height.toFixed(1)} in`:'Set output size'}</span>
            <span>{previewMode==='outline'?'Clean silhouette':'Photo comparison'}</span>
          </div>
          <div className="row" style={{justifyContent:'flex-end',gap:8}}>
            <button className="btn btn-ghost" onClick={()=>setPreview(false)}>Return to editing</button>
            <button className="btn btn-blush" onClick={()=>{setPreview(false);exportSvg();}}><Icon name="download" className="ico-sm"/> Looks right — export SVG</button>
          </div>
        </div>
      </div>}
    </div>;

    return standalone?page:<div className="silhouette-overlay" role="dialog" aria-modal="true" aria-label="Create silhouette"><div className="silhouette-modal">{page}</div></div>;
  }

  window.SilhouetteStudio=SilhouetteStudio;
  window.SilhouetteStudioPage=(props)=>React.createElement(SilhouetteStudio,{...props,standalone:true});
})();
