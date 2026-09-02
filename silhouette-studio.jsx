(() => {
  const {useEffect,useMemo,useRef,useState}=React;
  const STAGE={width:720,height:1280};
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const bounds=(pts)=>{if(!pts.length)return null;const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);return{minX,maxX,minY,maxY,width:maxX-minX,height:maxY-minY};};
  const defaultHandles=(p,prev,next)=>{const dx=next.x-prev.x,dy=next.y-prev.y,l=Math.hypot(dx,dy)||1,h=Math.min(52,l*.2);return{handleIn:{x:p.x-dx/l*h,y:p.y-dy/l*h},handleOut:{x:p.x+dx/l*h,y:p.y+dy/l*h}};};
  const makeNode=(p,kind='sharp')=>({...p,kind,handleIn:{...p},handleOut:{...p}});
  const vectorize=(pts)=>pts.map((p,i)=>{const prev=pts[(i-1+pts.length)%pts.length],next=pts[(i+1)%pts.length];return{...makeNode(p,'smooth'),...defaultHandles(p,prev,next)};});
  const reflowNodes=(pts,original=[])=>pts.map((p,i)=>{const kind=original[i]?.kind||'smooth';if(kind==='sharp')return makeNode(p,'sharp');const prev=pts[(i-1+pts.length)%pts.length],next=pts[(i+1)%pts.length];return{...makeNode(p,'smooth'),...defaultHandles(p,prev,next)};});
  const smoothSection=(items,index)=>{const pts=items.map(({x,y})=>({x,y})),count=pts.length;if(index===null||count<4)return items;const original=pts.map(p=>({...p}));[-1,0,1].forEach(offset=>{const i=(index+offset+count)%count,prev=original[(i-1+count)%count],p=original[i],next=original[(i+1)%count];pts[i]={x:prev.x*.22+p.x*.56+next.x*.22,y:prev.y*.22+p.y*.56+next.y*.22};});const modes=items.map(n=>({...n}));[-1,0,1].forEach(offset=>{modes[(index+offset+count)%count].kind='smooth';});return reflowNodes(pts,modes);};
  const simplifyOutline=(items)=>{if(items.length<=16)return items;const kept=items.filter((_,i)=>i%2===0);return reflowNodes(kept.map(({x,y})=>({x,y})),kept);};
  const fallbackNodes=(b)=>{const x=b?.minX??220,y=b?.minY??190,w=b?.width??280,h=b?.height??760;return vectorize([{x:x+w*.5,y},{x:x+w*.78,y:y+h*.08},{x:x+w*.92,y:y+h*.22},{x:x+w*.82,y:y+h*.34},{x:x+w*.68,y:y+h*.39},{x:x+w*.67,y:y+h*.58},{x:x+w*.85,y:y+h*.78},{x:x+w*.75,y:y+h*.95},{x:x+w*.5,y:y+h},{x:x+w*.25,y:y+h*.95},{x:x+w*.15,y:y+h*.78},{x:x+w*.33,y:y+h*.58},{x:x+w*.32,y:y+h*.39},{x:x+w*.18,y:y+h*.34},{x:x+w*.08,y:y+h*.22},{x:x+w*.22,y:y+h*.08}]);};
  const pathFor=(nodes)=>{if(nodes.length<3)return'';let d=`M ${nodes[0].x.toFixed(1)} ${nodes[0].y.toFixed(1)}`;for(let i=0;i<nodes.length;i++){const a=nodes[i],b=nodes[(i+1)%nodes.length];if(a.kind==='sharp'&&b.kind==='sharp')d+=` L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;else{const c1=a.kind==='smooth'?a.handleOut:a,c2=b.kind==='smooth'?b.handleIn:b;d+=` C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;}}return d+' Z';};
  const nearest=(p,items)=>items.reduce((best,x,i)=>{const d=dist(p,x);return d<best.distance?{index:i,distance:d}:best},{index:null,distance:Infinity});
  const nearestSegment=(p,nodes)=>{let best=null;nodes.forEach((a,i)=>{const b=nodes[(i+1)%nodes.length],dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy||1,t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/l,0,1),q={x:a.x+t*dx,y:a.y+t*dy},d=dist(p,q);if(!best||d<best.distance)best={index:i,point:q,distance:d};});return best;};
  const eventPoint=(e,svg,pan,zoom)=>{const r=svg.getBoundingClientRect(),fit=Math.min(r.width/STAGE.width,r.height/STAGE.height),shownWidth=STAGE.width*fit,shownHeight=STAGE.height*fit,offsetX=(r.width-shownWidth)/2,offsetY=(r.height-shownHeight)/2;const v={x:(e.clientX-r.left-offsetX)/fit,y:(e.clientY-r.top-offsetY)/fit};return{x:(v.x-pan.x)/zoom,y:(v.y-pan.y)/zoom};};
  const loadImage=(url)=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('The photo could not be read.'));img.src=url;});
  const ensurePdfJs=()=>{const existing=window.pdfjsLib||window['pdfjs-dist/build/pdf'];if(existing)return Promise.resolve(existing);return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='assets/pdf.min.js?runtime=71';s.onload=()=>{const lib=window.pdfjsLib||window['pdfjs-dist/build/pdf'];lib?resolve(lib):reject(new Error('PDF renderer did not expose a browser API.'));};s.onerror=()=>reject(new Error('PDF renderer could not be loaded.'));document.head.appendChild(s);});};
  const autoTrace=async(url,threshold=28)=>{const img=await loadImage(url),scale=Math.min(1,380/Math.max(img.naturalWidth,img.naturalHeight)),w=Math.max(72,Math.round(img.naturalWidth*scale)),h=Math.max(72,Math.round(img.naturalHeight*scale)),c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,w,h);const px=ctx.getImageData(0,0,w,h).data,bg=[0,0,0];[[0,0],[w-1,0],[0,h-1],[w-1,h-1]].forEach(([x,y])=>{const i=(y*w+x)*4;bg[0]+=px[i];bg[1]+=px[i+1];bg[2]+=px[i+2];});bg[0]/=4;bg[1]/=4;bg[2]/=4;const mask=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;mask[y*w+x]=Math.hypot(px[i]-bg[0],px[i+1]-bg[1],px[i+2]-bg[2])>=threshold?1:0;}const seen=new Uint8Array(w*h),components=[];for(let start=0;start<w*h;start++){if(!mask[start]||seen[start])continue;const q=[start],comp=[];seen[start]=1;for(let qi=0;qi<q.length;qi++){const at=q[qi],x=at%w,y=Math.floor(at/w);comp.push(at);const ns=[];if(x>0)ns.push(at-1);if(x<w-1)ns.push(at+1);if(y>0)ns.push(at-w);if(y<h-1)ns.push(at+w);for(const n of ns)if(mask[n]&&!seen[n]){seen[n]=1;q.push(n);}}components.push(comp);}const largest=components.sort((a,b)=>b.length-a.length)[0]||[];if(largest.length<10)throw new Error('I could not isolate the pad. Use a plain contrasting background, then try again.');const chosen=new Uint8Array(w*h);largest.forEach(i=>chosen[i]=1);const boundary=[];for(const at of largest){const x=at%w,y=Math.floor(at/w);if(x===0||x===w-1||y===0||y===h-1||!chosen[at-1]||!chosen[at+1]||!chosen[at-w]||!chosen[at+w])boundary.push({x,y});}const minX=Math.min(...boundary.map(p=>p.x)),maxX=Math.max(...boundary.map(p=>p.x)),minY=Math.min(...boundary.map(p=>p.y)),maxY=Math.max(...boundary.map(p=>p.y)),cx=(minX+maxX)/2,cy=(minY+maxY)/2,sample=[];for(let i=0;i<36;i++){const a=i/36*Math.PI*2;let best=null,bestScore=-Infinity;for(const p of boundary){const dx=p.x-cx,dy=p.y-cy,r=Math.hypot(dx,dy)||1,delta=Math.abs(Math.atan2(Math.sin(Math.atan2(dy,dx)-a),Math.cos(Math.atan2(dy,dx)-a)));const score=r-(delta*260);if(score>bestScore){bestScore=score;best=p;}}sample.push(best||boundary[0]);}const fit=Math.min(STAGE.width/img.naturalWidth,STAGE.height/img.naturalHeight),ox=(STAGE.width-img.naturalWidth*fit)/2,oy=(STAGE.height-img.naturalHeight*fit)/2;return vectorize(sample.map(p=>({x:(p.x/scale)*fit+ox,y:(p.y/scale)*fit+oy})));};
  function SilhouetteStudio({item,onClose,onGoto,standalone=false}){
    const initialSource=item?.cutout||item?.manualSrc||item?.src||'';
    const [source,setSource]=useState(initialSource),[sourceName,setSourceName]=useState(item?.name||'pad-photo'),[nodes,setNodes]=useState(()=>fallbackNodes()),[storedPaths,setStoredPaths]=useState([]),[currentPathId,setCurrentPathId]=useState(1),[nextPathId,setNextPathId]=useState(2),[draftSavedAt,setDraftSavedAt]=useState(null),[selected,setSelected]=useState(null),[tool,setTool]=useState('calibrate'),[calibration,setCalibration]=useState([]),[referenceInches,setReferenceInches]=useState(4),[outputInches,setOutputInches]=useState(10),[keepSourceSize,setKeepSourceSize]=useState(false),[photoOpacity,setPhotoOpacity]=useState(74),[autoThreshold,setAutoThreshold]=useState(28),[curveStrength,setCurveStrength]=useState(48),[magnifierOpen,setMagnifierOpen]=useState(false),[magnifierPos,setMagnifierPos]=useState({left:12,top:12}),[zoom,setZoom]=useState(1),[pan,setPan]=useState({x:0,y:0}),[showHandles,setShowHandles]=useState(true),[focusSelected,setFocusSelected]=useState(false),[extracting,setExtracting]=useState(false),[preview,setPreview]=useState(false),[previewMode,setPreviewMode]=useState('outline'),[canvasView,setCanvasView]=useState('edit'),[notice,setNotice]=useState(initialSource?'Automatic outline draft ready. Drag any point to refine the shape.':'Upload a photo or PDF to begin.'),[drag,setDrag]=useState(null),[pdfUrl,setPdfUrl]=useState(''),[pdfPage,setPdfPage]=useState(1),[pdfPageCount,setPdfPageCount]=useState(0),[pdfLoading,setPdfLoading]=useState(false),[pdfPageImage,setPdfPageImage]=useState(''),[canvasModal,setCanvasModal]=useState(false);
    const svgRef=useRef(null),pointers=useRef(new Map()),pinch=useRef(null),history=useRef([]),redoStack=useRef([]),pdfDocRef=useRef(null);
    const activePath=useMemo(()=>pathFor(nodes),[nodes]),path=activePath,points=useMemo(()=>nodes.map(({x,y})=>({x,y})),[nodes]),box=useMemo(()=>bounds(points),[points]);
    const sourceLongest=box&&calibration.length===2&&dist(calibration[0],calibration[1])>0?Math.max(box.width,box.height)/dist(calibration[0],calibration[1])*referenceInches:null;
    const dimensions=box?box.height>=box.width?{width:outputInches*box.width/box.height,height:outputInches}:{width:outputInches,height:outputInches*box.height/box.width}:null;
    useEffect(()=>{if(keepSourceSize&&sourceLongest)setOutputInches(Number(sourceLongest.toFixed(3)));},[keepSourceSize,sourceLongest]);
    useEffect(()=>{if(initialSource){setExtracting(true);autoTrace(initialSource,autoThreshold).then(n=>{setNodes(n);setSelected(null);setTool('trace');setNotice('Automatic outline ready. Drag any point only if it needs cleanup.');}).catch(()=>setNotice('Automatic draft ready. Adjust the nodes or run Auto silhouette again.')).finally(()=>setExtracting(false));}},[initialSource]);
    useEffect(()=>{if(initialSource)return;try{const draft=JSON.parse(localStorage.getItem('wp-silhouette-draft')||'null');if(!draft?.nodes?.length)return;setNodes(draft.nodes);setDraftSavedAt(draft.savedAt||null);setSource(draft.source||'');setPdfPageImage(draft.source||'');setSourceName(draft.sourceName||'saved-silhouette');setCalibration(draft.calibration||[]);setReferenceInches(draft.referenceInches||4);setOutputInches(draft.outputInches||10);setKeepSourceSize(!!draft.keepSourceSize);setPhotoOpacity(draft.photoOpacity??74);setAutoThreshold(draft.autoThreshold??28);setCurveStrength(draft.curveStrength??48);setPdfPage(draft.pdfPage||1);setTool('trace');setNotice('Saved draft restored from this device.');}catch{}},[]);
    useEffect(()=>{if(selected===null||!nodes[selected]||!svgRef.current)return;const place=()=>{const svg=svgRef.current,wrap=svg.parentElement,sr=svg.getBoundingClientRect(),wr=wrap.getBoundingClientRect(),fit=Math.min(sr.width/STAGE.width,sr.height/STAGE.height),offsetX=(sr.width-STAGE.width*fit)/2,offsetY=(sr.height-STAGE.height*fit)/2,node=nodes[selected],x=sr.left-wr.left+offsetX+(node.x*zoom+pan.x)*fit,y=sr.top-wr.top+offsetY+(node.y*zoom+pan.y)*fit,boxWidth=134,boxHeight=145,gap=14;let left=x+gap;if(left+boxWidth>wr.width-8)left=x-boxWidth-gap;left=clamp(left,8,Math.max(8,wr.width-boxWidth-8));const top=clamp(y-boxHeight/2,42,Math.max(42,wr.height-boxHeight-8));setMagnifierPos({left,top});};const frame=requestAnimationFrame(place);window.addEventListener('resize',place);return()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',place);};},[selected,nodes,zoom,pan,canvasModal]);
    useEffect(()=>()=>{if(pdfUrl)URL.revokeObjectURL(pdfUrl);},[pdfUrl]); useEffect(()=>{if(!canvasModal)return;const onKey=e=>{if(e.key==='Escape')setCanvasModal(false);};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[canvasModal]);
    const commit=(fn)=>{history.current.push(nodes);redoStack.current=[];setNodes(fn);};
    const renderPdfPage=async(doc,pageNumber)=>{if(!doc)return;setPdfLoading(true);try{const page=await doc.getPage(pageNumber),viewport=page.getViewport({scale:1.6}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;const data=canvas.toDataURL('image/png');setPdfPage(pageNumber);setPdfPageImage(data);setSource(data);setCalibration([]);const traced=await autoTrace(data,autoThreshold);commit(()=>traced);setSelected(null);setTool('trace');setNotice(`PDF page ${pageNumber} of ${doc.numPages} is traced and ready to refine.`);}catch(err){setNodes(fallbackNodes());setNotice('This PDF page is visible, but its edge needs manual refinement.');}finally{setPdfLoading(false);}};
    const onFile=(e)=>{const f=e.target.files?.[0];if(!f)return;e.target.value='';setStoredPaths([]);setCurrentPathId(1);setNextPathId(2);if(f.type==='application/pdf'||/\.pdf$/i.test(f.name)){const u=URL.createObjectURL(f);if(pdfUrl)URL.revokeObjectURL(pdfUrl);setPdfUrl(u);setSource('');setPdfPageImage('');setSourceName(f.name);setPdfLoading(true);ensurePdfJs().then(pdf=>{pdf.GlobalWorkerOptions.workerSrc='assets/pdf.worker.min.js';return pdf.getDocument({url:u}).promise;}).then(doc=>{pdfDocRef.current=doc;setPdfPageCount(doc.numPages);return renderPdfPage(doc,1);}).catch(()=>{setPdfLoading(false);setNotice('The PDF could not be opened. Please try a standard PDF file.');});return;}if(!f.type.startsWith('image/')){setNotice('Choose a JPG, PNG, WebP, or PDF file.');return;}const u=URL.createObjectURL(f);setSource(u);setSourceName(f.name);setPdfUrl('');setPdfPageImage('');setPdfPageCount(0);setCalibration([]);setExtracting(true);autoTrace(u,autoThreshold).then(n=>{commit(()=>n);setSelected(null);setTool('trace');setNotice('Automatic outline ready. Drag any point only if it needs cleanup.');}).catch(()=>{setNodes(fallbackNodes());setNotice('Photo loaded. The draft outline is ready for cleanup.');}).finally(()=>setExtracting(false));};
    const autoRun=()=>{if(!source||extracting)return;setExtracting(true);autoTrace(source,autoThreshold).then(n=>{commit(()=>n);setSelected(null);setTool('trace');setNotice('Automatic silhouette refreshed.');}).catch(err=>setNotice(err.message)).finally(()=>setExtracting(false));};
    const addNode=()=>{if(nodes.length<3){commit(cur=>[...cur,makeNode({x:360,y:640})]);return;}const i=selected??0,s=nearestSegment(nodes[i],nodes),p=s?.point||{x:360,y:640};commit(cur=>[...cur.slice(0,(s?.index??0)+1),makeNode(p),...cur.slice((s?.index??0)+1)]);setSelected((s?.index??0)+1);setTool('trace');setNotice('Node inserted on the selected outline segment.');};
    const newShape=()=>{if(nodes.length>=3)setStoredPaths(cur=>[...cur,{id:currentPathId,nodes}]);const id=nextPathId;setCurrentPathId(id);setNextPathId(id+1);setNodes([]);setSelected(null);setTool('add');setNotice('New shape started. Tap at least three points around the separate figure.');};
    const switchShape=(id)=>{if(id===currentPathId)return;const target=storedPaths.find(entry=>entry.id===id);if(!target)return;setStoredPaths(cur=>[...cur.filter(entry=>entry.id!==id),{id:currentPathId,nodes}]);setCurrentPathId(id);setNodes(target.nodes);setSelected(null);setTool('trace');setNotice(`Shape ${id} selected for editing.`);};
    const deleteNode=()=>{if(selected===null||nodes.length<=3){setNotice('Keep at least three nodes to retain a closed silhouette.');return;}commit(cur=>cur.filter((_,i)=>i!==selected));setSelected(null);};
    const smoothSelected=()=>{if(selected===null){setNotice('Select a point first, then smooth its section.');return;}commit(cur=>smoothSection(cur,selected));setNotice('The selected curve section was softened.');};
    const simplify=()=>{if(nodes.length<=16){setNotice('The outline is already simplified.');return;}commit(cur=>simplifyOutline(cur));setSelected(null);setNotice('Extra points removed. Use Undo if you prefer the detailed outline.');};
    const changeCurveStrength=(value)=>{setCurveStrength(value);if(selected===null)return;commit(cur=>cur.map((n,i)=>{if(i!==selected)return n;const prev=cur[(i-1+cur.length)%cur.length],next=cur[(i+1)%cur.length],dx=next.x-prev.x,dy=next.y-prev.y,l=Math.hypot(dx,dy)||1,h=8+value*.72;return{...n,kind:'smooth',handleIn:{x:n.x-dx/l*h,y:n.y-dy/l*h},handleOut:{x:n.x+dx/l*h,y:n.y+dy/l*h}};}));};
    const updateNode=(i,p)=>setNodes(cur=>cur.map((n,j)=>{if(j!==i)return n;const x=clamp(p.x,10,710),y=clamp(p.y,10,1270),dx=x-n.x,dy=y-n.y;return{...n,x,y,handleIn:{x:n.handleIn.x+dx,y:n.handleIn.y+dy},handleOut:{x:n.handleOut.x+dx,y:n.handleOut.y+dy}};}));
    const onStageDown=(e)=>{const m=pointers.current;m.set(e.pointerId,{x:e.clientX,y:e.clientY});if(m.size===2){const v=[...m.values()];pinch.current={d:dist(v[0],v[1]),z:zoom,p:{...pan}};setDrag(null);setMagnifierOpen(false);return;}if(tool==='pan'){e.currentTarget.setPointerCapture?.(e.pointerId);setMagnifierOpen(false);return;}const p=eventPoint(e,svgRef.current,pan,zoom);if(tool==='calibrate'){setCalibration(cur=>cur.length===2?[p,...cur.slice(1)]:[...cur,p]);setMagnifierOpen(false);if(calibration.length===1){setTool('trace');setNotice('Reference captured. Now shape the vector outline.');}return;}if(tool==='add'){if(nodes.length<3){commit(cur=>[...cur,makeNode(p)]);setSelected(nodes.length);if(nodes.length===2){setTool('trace');setNotice('New closed shape created. Add more points on its edge if needed.');}setMagnifierOpen(false);return;}const seg=nearestSegment(p,nodes);if(seg&&seg.distance<48/zoom){commit(cur=>[...cur.slice(0,seg.index+1),makeNode(seg.point),...cur.slice(seg.index+1)]);setSelected(seg.index+1);setTool('trace');}setMagnifierOpen(false);return;}const hit=nearest(p,nodes);if(hit.index!==null&&hit.distance<42/zoom){history.current.push(nodes);redoStack.current=[];setSelected(hit.index);setMagnifierOpen(false);setDrag({index:hit.index,target:'node',pointerStart:{x:e.clientX,y:e.clientY}});e.currentTarget.setPointerCapture?.(e.pointerId);}else{setMagnifierOpen(false);if(!nodes.length)commit(cur=>[...cur,makeNode(p)]);}};
    const onStageMove=(e)=>{const m=pointers.current;if(m.has(e.pointerId))m.set(e.pointerId,{x:e.clientX,y:e.clientY});if(m.size>=2&&pinch.current){const v=[...m.values()];setZoom(clamp(Number((pinch.current.z*dist(v[0],v[1])/pinch.current.d).toFixed(2)),.5,3));return;}if(tool==='pan'&&m.size===1){const r=svgRef.current.getBoundingClientRect();setPan(cur=>({x:cur.x+e.movementX/r.width*STAGE.width,y:cur.y+e.movementY/r.height*STAGE.height}));return;}if(drag){if(drag.pointerStart&&Math.hypot(e.clientX-drag.pointerStart.x,e.clientY-drag.pointerStart.y)>4)setMagnifierOpen(true);const p=eventPoint(e,svgRef.current,pan,zoom);if(drag.target==='shape'){const dx=p.x-drag.start.x,dy=p.y-drag.start.y,count=drag.originalNodes.length,moved=drag.originalNodes.map((n,j)=>{const gap=Math.min((j-drag.index+count)%count,(drag.index-j+count)%count),weight=gap===0?1:gap===1?.48:gap===2?.18:0;return{x:weight?clamp(n.x+dx*weight,10,710):n.x,y:weight?clamp(n.y+dy*weight,10,1270):n.y};});setNodes(reflowNodes(moved,drag.originalNodes));return;}if(drag.target==='node')updateNode(drag.index,p);if(drag.target==='handleIn'||drag.target==='handleOut')commit(cur=>cur.map((n,j)=>j===drag.index?{...n,kind:'smooth',[drag.target]:{x:clamp(p.x,10,710),y:clamp(p.y,10,1270)}}:n));}};
    const onStageUp=(e)=>{pointers.current.delete(e.pointerId);if(pointers.current.size<2)pinch.current=null;setDrag(null);setMagnifierOpen(false);};
    const setKind=(kind)=>{if(selected===null)return;commit(cur=>cur.map((n,i)=>{if(i!==selected)return n;if(kind==='sharp')return{...n,kind};const prev=cur[(i-1+cur.length)%cur.length],next=cur[(i+1)%cur.length];return{...n,kind:'smooth',...defaultHandles(n,prev,next)};}));};
    const selectAdjacent=(d)=>{if(!nodes.length)return;setSelected(i=>((i??(d>0?-1:0))+d+nodes.length)%nodes.length);setTool('trace');};
    const undo=()=>{const previous=history.current.pop();if(previous){redoStack.current.push(nodes);setNodes(previous);setNotice('Last edit undone.');}}; const redo=()=>{const next=redoStack.current.pop();if(next){history.current.push(nodes);setNodes(next);setNotice('Edit restored.');}};
    const reset=()=>{setZoom(1);setPan({x:0,y:0});setCalibration([]);setStoredPaths([]);setCurrentPathId(1);setNextPathId(2);setNodes(fallbackNodes());setSelected(null);setTool('trace');setNotice('View and outline reset.');};
    const draftSource=async()=>{if(!source)return'';if(source.startsWith('data:'))return source;const img=await loadImage(source),scale=Math.min(1,1200/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.82);};
    const saveDraft=async()=>{try{const savedSource=await draftSource(),savedAt=Date.now();localStorage.setItem('wp-silhouette-draft',JSON.stringify({version:4,savedAt,source:savedSource,sourceName,nodes,calibration,referenceInches,outputInches,keepSourceSize,photoOpacity,autoThreshold,curveStrength,pdfPage}));setDraftSavedAt(savedAt);setNotice('Draft saved on this device. It will reopen when you return to Silhouette Studio.');}catch(err){setNotice('This draft is too large for device storage. Export the SVG to keep the finished outline.');}};
    const saveToGallery=()=>{if(!path||!dimensions||!box)return;const pad=8,svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.minX-pad} ${box.minY-pad} ${box.width+pad*2} ${box.height+pad*2}" width="${dimensions.width.toFixed(3)}in" height="${dimensions.height.toFixed(3)}in"><rect width="100%" height="100%" fill="#fffafd"/><path d="${path}" fill="#f7dce9" stroke="#6d334b" stroke-width="4" stroke-linejoin="round"/></svg>`,src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,key=`silhouette-${Date.now()}`,savedAt=new Date().toLocaleString(),entry={key,src,fileName:`${sourceName.replace(/\.[^/.]+$/,'')||'pad'}-silhouette.svg`,itemName:sourceName.replace(/\.[^/.]+$/,'')||'Pad silhouette',backdropName:'Silhouette pattern',ratio:`${dimensions.width.toFixed(1)} × ${dimensions.height.toFixed(1)} in`,savedAt,type:'silhouette',silhouette:{nodes,calibration,referenceInches,outputInches}};try{const gallery=JSON.parse(localStorage.getItem('wp_saved_shots')||'[]');localStorage.setItem('wp_saved_shots',JSON.stringify([entry,...(Array.isArray(gallery)?gallery:[])]));window.dispatchEvent(new CustomEvent('wp-saved-gallery-updated'));setNotice('Silhouette saved to Gallery as a separate pattern piece.');}catch{setNotice('The Gallery is full. Remove an older item and try again.');}};
    const exportSvg=()=>{if(!path||!dimensions)return;const pad=8,svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.minX-pad} ${box.minY-pad} ${box.width+pad*2} ${box.height+pad*2}" width="${dimensions.width.toFixed(3)}in" height="${dimensions.height.toFixed(3)}in">
<path d="${path}" fill="#ffffff" stroke="#6d334b" stroke-width="4" stroke-linejoin="round"/>
</svg>`;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));a.download=`${sourceName.replace(/\.[^/.]+$/,'')||'pad'}-silhouette-${outputInches}in.svg`;a.click();setNotice('SVG exported at the selected physical size.');};
    const content=<div className={'silhouette-body'+(canvasModal?' silhouette-body--canvas-modal':'')} role={canvasModal?'dialog':undefined} aria-modal={canvasModal?'true':undefined} aria-label={canvasModal?'Focused silhouette canvas editor':undefined}>{canvasModal&&<div className="silhouette-canvas-modal-head">
<div>
<div className="eyebrow">Focused canvas editor</div>
<strong>{sourceName||'Silhouette outline'}</strong>
<span className="silhouette-modal-status">{selected===null?'Select a node or choose a tool':`Node ${selected+1} of ${nodes.length}`}</span>
</div>
<div className="silhouette-canvas-quick-tools">
<button className={canvasView==='edit'?'active':''} onClick={()=>setCanvasView('edit')}>
<Icon name="edit" className="ico-sm"/> Edit</button>
<button className={canvasView==='compare'?'active':''} onClick={()=>{setCanvasView('compare');setMagnifierOpen(false)}} disabled={!source}>
<Icon name="eye" className="ico-sm"/> Compare</button>
<button className={tool==='trace'?'active':''} onClick={()=>setTool('trace')} disabled={!source&&!pdfUrl}>
<Icon name="edit" className="ico-sm"/> Select</button>
<button className={tool==='add'?'active':''} onClick={()=>setTool('add')} disabled={!source&&!pdfUrl}>
<Icon name="plus" className="ico-sm"/> Add</button>
<button onClick={deleteNode} disabled={selected===null||nodes.length<=3}>
<Icon name="trash" className="ico-sm"/> Remove</button>
<button onClick={simplify} disabled={nodes.length<=16}>
<Icon name="layers" className="ico-sm"/> Simplify</button>
<button className={tool==='pan'?'active':''} onClick={()=>setTool('pan')}>
<Icon name="aperture" className="ico-sm"/> Move</button>
<button onClick={()=>setKind('sharp')} disabled={selected===null}>
<Icon name="edit" className="ico-sm"/> Straight</button>
<button onClick={()=>setKind('smooth')} disabled={selected===null}>
<Icon name="layers" className="ico-sm"/> Curve</button>
<button onClick={undo} disabled={!history.current.length}>
<Icon name="refresh" className="ico-sm"/> Undo</button>
<button onClick={redo} disabled={!redoStack.current.length}>
<Icon name="refresh" className="ico-sm"/> Redo</button>
<button onClick={()=>setFocusSelected(v=>!v)} disabled={selected===null}>
<Icon name="eye" className="ico-sm"/> {focusSelected?'Show all':'Focus'}</button>
<button onClick={()=>setShowHandles(v=>!v)} disabled={selected===null||nodes[selected]?.kind!=='smooth'}>
<Icon name="layers" className="ico-sm"/> {showHandles?'Hide handles':'Show handles'}</button>
</div>
<div className="silhouette-canvas-modal-actions">
<button className="btn btn-ghost" onClick={saveDraft} disabled={!path}>
<Icon name="download" className="ico-sm"/> Save draft</button>
<button className="btn btn-ghost" onClick={()=>setPreview(true)} disabled={!path}>
<Icon name="eye" className="ico-sm"/> Review</button>
<button className="btn btn-blush" onClick={exportSvg} disabled={!path}>
<Icon name="download" className="ico-sm"/> Export SVG</button>
<button className="icon-btn" onClick={()=>setCanvasModal(false)} title="Close focused canvas">
<Icon name="x" className="ico-sm"/>
</button>
</div>
</div>}<aside className="silhouette-side">
<div className="silhouette-step">
<span>01</span>
<div>
<strong>Place your source</strong>
<p>Upload a pad photo, transparent cutout, or PDF pattern reference.</p>
</div>
</div>
<div className="silhouette-step">
<span>02</span>
<div>
<strong>Shape the vector path</strong>
<p>Select nodes, switch sharp or smooth joins, drag Bézier handles, add points, or remove extras.</p>
</div>
</div>
<div className="silhouette-step">
<span>03</span>
<div>
<strong>Measure and export</strong>
<p>Set a known reference length, choose the finished longest edge, review, and export SVG.</p>
</div>
</div>
<div className="silhouette-source">{pdfUrl?<>
<div className="eyebrow">PDF pattern reference</div>
<strong>{sourceName}</strong>
<div className="pdf-page-picker">
<img src={pdfPageImage||''} alt={`PDF page ${pdfPage} reference`}/>
<div className="pdf-page-controls">
<button type="button" disabled={pdfLoading||pdfPage<=1} onClick={()=>renderPdfPage(pdfDocRef.current,pdfPage-1)}>‹</button>
<span>{pdfLoading?'Rendering…':`Page ${pdfPage} of ${pdfPageCount||'?'}`}</span>
<button type="button" disabled={pdfLoading||pdfPage>=pdfPageCount} onClick={()=>renderPdfPage(pdfDocRef.current,pdfPage+1)}>›</button>
</div>
</div>
</>:source?<>
<div className="eyebrow">Source photo</div>
<strong>{sourceName}</strong>
<img src={source} alt="Source pad"/>
</>:<div className="silhouette-empty">Upload a photo or PDF to begin.</div>}</div>
<div className="silhouette-fields">
<label>Reference pixels<input type="number" min="0" value={calibration.length===2?Math.round(dist(calibration[0],calibration[1])):''} readOnly placeholder="Mark a reference line"/>
</label>
<label>Reference length (in)<input type="number" min="1" max="12" step="0.25" value={referenceInches} onChange={e=>setReferenceInches(Number(e.target.value)||1)}/>
</label>
<label>Output longest edge (in)<input type="number" min="1" max="100" value={outputInches} onChange={e=>{setKeepSourceSize(false);setOutputInches(Number(e.target.value)||10)}}/>
</label>
</div>
</aside>
<section className="silhouette-work">
<div className="silhouette-toolbar">
<button className={'chip'+(tool==='calibrate'?' on':'')} onClick={()=>setTool('calibrate')}>
<Icon name="scissors" className="ico-sm"/> Reference line {calibration.length===2&&'✓'}</button>
<button className={'chip'+(tool==='trace'?' on':'')} onClick={()=>setTool('trace')} disabled={!source&&!pdfUrl}>
<Icon name="edit" className="ico-sm"/> Select <span>{nodes.length} pts</span>
</button>
<button className={'chip'+(tool==='add'?' on':'')} onClick={()=>setTool('add')} disabled={!source&&!pdfUrl}>
<Icon name="plus" className="ico-sm"/> Add point</button>
<button className="chip" onClick={deleteNode} disabled={selected===null||nodes.length<=3}>
<Icon name="trash" className="ico-sm"/> Remove point</button>
<button className="chip" onClick={simplify} disabled={nodes.length<=16}>
<Icon name="layers" className="ico-sm"/> Simplify</button>
<button className={'chip'+(tool==='pan'?' on':'')} onClick={()=>setTool('pan')}>
<Icon name="aperture" className="ico-sm"/> Move view</button>
<button className="chip chip-auto" onClick={autoRun} disabled={!source||extracting}>
<Icon name="sparkles" className="ico-sm"/> {extracting?'Finding edge…':'Auto silhouette'}</button>
</div>
<div className="silhouette-stage-wrap">
<div className="silhouette-view-controls">
<button onClick={()=>setZoom(z=>clamp(Number((z-.25).toFixed(2)),.5,3))}>−</button>
<span>{Math.round(zoom*100)}%</span>
<button onClick={()=>setZoom(z=>clamp(Number((z+.25).toFixed(2)),.5,3))}>+</button>
<button onClick={()=>{setZoom(1);setPan({x:0,y:0})}}>Fit</button>
</div>
<svg ref={svgRef} viewBox={`0 0 ${STAGE.width} ${STAGE.height}`} className={'silhouette-stage'+(canvasView==='compare'?' silhouette-stage--compare':'')} style={{touchAction:'none'}} onPointerDown={canvasView==='edit'?onStageDown:undefined} onPointerMove={canvasView==='edit'?onStageMove:undefined} onPointerUp={canvasView==='edit'?onStageUp:undefined} onPointerCancel={canvasView==='edit'?onStageUp:undefined}>
<defs>
<pattern id="sil-grid-full" width="38" height="38" patternUnits="userSpaceOnUse">
<path d="M38 0H0V38" fill="none" stroke="#6d334b" strokeOpacity=".09"/>
</pattern>
</defs>
<rect width={STAGE.width} height={STAGE.height} fill="url(#sil-grid-full)"/>
<g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>{source&&<image href={source} x="0" y="0" width={STAGE.width} height={STAGE.height} preserveAspectRatio="xMidYMid meet" opacity={canvasView==='compare'?1:photoOpacity/100}/>} {pdfUrl&&!pdfPageImage&&<rect x="34" y="34" width="652" height="1212" rx="10" fill="#fffafc" stroke="#d8b2cb" strokeDasharray="8 8"/>}{activePath&&<path d={activePath} fill="#e9a7c9" fillOpacity={canvasView==='compare'?'.04':'.20'} stroke={canvasView==='compare'?'#b62572':'#6d334b'} strokeWidth={(canvasView==='compare'?6:4)/zoom}/>} {canvasView==='edit'&&showHandles&&selected!==null&&nodes[selected]?.kind==='smooth'&&<g className="bezier-handles">
<line x1={nodes[selected].x} y1={nodes[selected].y} x2={nodes[selected].handleIn.x} y2={nodes[selected].handleIn.y}/>
<line x1={nodes[selected].x} y1={nodes[selected].y} x2={nodes[selected].handleOut.x} y2={nodes[selected].handleOut.y}/>
<circle cx={nodes[selected].handleIn.x} cy={nodes[selected].handleIn.y} r={5/zoom} fill="#211820" stroke="#fff" strokeWidth={1.5/zoom} onPointerDown={e=>{e.preventDefault();e.stopPropagation();setSelected(selected);setDrag({index:selected,target:'handleIn'});e.currentTarget.setPointerCapture?.(e.pointerId);}}/>
<circle cx={nodes[selected].handleOut.x} cy={nodes[selected].handleOut.y} r={5/zoom} fill="#211820" stroke="#fff" strokeWidth={1.5/zoom} onPointerDown={e=>{e.preventDefault();e.stopPropagation();setSelected(selected);setDrag({index:selected,target:'handleOut'});e.currentTarget.setPointerCapture?.(e.pointerId);}}/>
</g>}{canvasView==='edit'&&nodes.map((n,i)=>
<g key={i} className={focusSelected&&selected!==null&&selected!==i?'trace-point--dimmed':''} onPointerDown={e=>{e.stopPropagation();history.current.push(nodes);redoStack.current=[];setSelected(i);setMagnifierOpen(false);setDrag({index:i,target:'node',pointerStart:{x:e.clientX,y:e.clientY}});}}>
<circle cx={n.x} cy={n.y} r={22/zoom} fill="transparent" stroke="none"/>
<circle cx={n.x} cy={n.y} r={(selected===i?12:8)/zoom} fill={selected===i?'#c95f9c':'#fffafc'} stroke={n.kind==='smooth'?'#b99a43':'#6d334b'} strokeWidth={3/zoom}/>
<path d={n.kind==='smooth'?`M${n.x-3} ${n.y}h6`:`M${n.x-3} ${n.y-3}l6 6m0-6l-6 6`} stroke="#6d334b" strokeWidth={1.4} fill="none"/>
</g>)}{canvasView==='edit'&&calibration.map((p,i)=>
<circle key={'cal'+i} cx={p.x} cy={p.y} r={8/zoom} fill="#b99a43" stroke="#fff" strokeWidth={3/zoom}/>)}{canvasView==='edit'&&calibration.length===2&&<line x1={calibration[0].x} y1={calibration[0].y} x2={calibration[1].x} y2={calibration[1].y} stroke="#b99a43" strokeWidth={3/zoom}/>}</g>
</svg>{canvasView==='edit'&&magnifierOpen&&selected!==null&&nodes[selected]&&<div className="silhouette-magnifier" style={{left:magnifierPos.left,top:magnifierPos.top}} aria-label="Magnified selected area">
<div className="silhouette-magnifier-head"><span>Detail</span><button type="button" aria-label="Close detail magnifier" onClick={e=>{e.stopPropagation();setMagnifierOpen(false);}}>×</button></div>
<svg viewBox={`${nodes[selected].x-72} ${nodes[selected].y-72} 144 144`}>
{source&&<image href={source} x="0" y="0" width={STAGE.width} height={STAGE.height} preserveAspectRatio="xMidYMid meet" opacity="1"/>}
<path d={activePath} fill="none" stroke="#6d334b" strokeWidth="1.5" strokeOpacity=".38" strokeDasharray="4 3"/>
<circle cx={nodes[selected].x} cy={nodes[selected].y} r="3.8" fill="#c95f9c" stroke="#fff" strokeWidth="1.5"/>
</svg>
</div>}{!source&&!pdfUrl&&<label className="silhouette-upload-panel">
<Icon name="upload" className="ico-lg"/>
<strong>Place your pad photo or PDF pattern</strong>
<span>Automatic edge detection, editable nodes, and calibrated SVG export.</span>
<span className="btn btn-blush">Choose photo / PDF</span>
<input type="file" accept="image/*,.pdf,application/pdf" onChange={onFile}/>
</label>}{extracting&&<div className="silhouette-extracting">
<Icon name="sparkles" className="ico-lg"/>
<strong>Finding the pad edge</strong>
<span>Preparing an editable first-pass outline.</span>
</div>}<div className="silhouette-stage-hint">{canvasView==='compare'?'Compare view · source at full visibility with the silhouette edge over it':<>Two fingers: zoom · One finger: drag a node · {selected===null?'Select a node for precise cleanup':`Node ${selected+1} of ${nodes.length}`}</>}</div>
</div>
<div className="silhouette-status">
<Icon name="check" className="ico-sm"/> {notice}</div>
</section>
<aside className="silhouette-controls">
<div className="control-label">Vector node {selected===null?'· select a dot':`· node ${selected+1} of ${nodes.length}`}</div>
<div className="node-mode-row">
<button className={'node-mode'+(selected!==null&&nodes[selected]?.kind==='sharp'?' node-mode--active':'')} onClick={()=>setKind('sharp')} disabled={selected===null}>
<Icon name="edit" className="ico-sm"/> Sharp corner<span>Straight segments</span>
</button>
<button className={'node-mode'+(selected!==null&&nodes[selected]?.kind==='smooth'?' node-mode--active':'')} onClick={()=>setKind('smooth')} disabled={selected===null}>
<Icon name="layers" className="ico-sm"/> Smooth curve<span>Drag Bézier handles</span>
</button>
</div>
<div className="node-navigator">
<button onClick={()=>selectAdjacent(-1)} disabled={!nodes.length}>‹</button>
<span>{selected===null?'Click a node to select it':`Node ${selected+1} / ${nodes.length}`}</span>
<button onClick={()=>selectAdjacent(1)} disabled={!nodes.length}>›</button>
</div>
<div className="node-visibility-row">
<button onClick={()=>setFocusSelected(v=>!v)} disabled={selected===null}>
<Icon name="eye" className="ico-sm"/> {focusSelected?'Show all nodes':'Focus selected'}</button>
<button onClick={()=>setShowHandles(v=>!v)} disabled={selected===null||nodes[selected]?.kind!=='smooth'}>
<Icon name="layers" className="ico-sm"/> {showHandles?'Hide handles':'Show handles'}</button>
</div>
<div className="silhouette-control-block curve-ease-controls">
<label>Curve softness <output>{curveStrength}%</output>
<input type="range" min="10" max="100" value={curveStrength} disabled={selected===null} onChange={e=>changeCurveStrength(Number(e.target.value))}/>
</label>
<small>Select a point, then adjust how gently the curve passes through it.</small>
</div>
<div className="silhouette-control-block">
<label>Trace visibility <output>{photoOpacity}%</output>
<input type="range" min="20" max="100" value={photoOpacity} onChange={e=>setPhotoOpacity(Number(e.target.value))}/>
</label>
</div>
<div className="silhouette-control-block">
<label>Auto-trace sensitivity <output>{autoThreshold<=34?'Low':autoThreshold<=68?'Medium':'High'} · {autoThreshold}</output>
<input type="range" min="18" max="105" value={autoThreshold} onChange={e=>setAutoThreshold(Number(e.target.value))}/>
</label>
<small>Run Auto silhouette again after changing sensitivity.</small>
</div>
<div className="silhouette-dimension-grid">
<div>
<span>Source longest edge</span>
<strong>{sourceLongest?sourceLongest.toFixed(1)+' in':'—'}</strong>
</div>
<div>
<span>Export size</span>
<strong>{dimensions?`${dimensions.width.toFixed(1)} × ${dimensions.height.toFixed(1)}`:'—'}</strong>
</div>
</div>
<button className={'btn btn-ghost silhouette-source-size'+(keepSourceSize?' active':'')} onClick={()=>setKeepSourceSize(v=>!v)} disabled={!sourceLongest}>
<Icon name="scissors" className="ico-sm"/> {keepSourceSize?'Using original source size':'Use original PDF/source size'}</button>
<small className="silhouette-size-help">Mark the printed reference line and enter its real length first. This changes export size, never the outline shape.</small>
<div className="silhouette-control-actions">
<button className="btn btn-ghost" onClick={undo} disabled={!history.current.length}>
<Icon name="refresh" className="ico-sm"/> Undo</button>
<button className="btn btn-ghost" onClick={reset}>
<Icon name="refresh" className="ico-sm"/> Reset</button>
<button className="btn btn-ghost" onClick={saveDraft} disabled={!path}>
<Icon name="download" className="ico-sm"/> Save draft</button>
</div>
{draftSavedAt&&<div className="silhouette-draft-status">✓ Saved on this device · {new Date(draftSavedAt).toLocaleString([], {dateStyle:'medium',timeStyle:'short'})}</div>}
<button className="btn btn-ghost" onClick={saveToGallery} disabled={!path}>
<Icon name="photo" className="ico-sm"/> Save to Gallery</button>
<button className="btn btn-ghost" onClick={()=>{setPreviewMode('outline');setPreview(true)}} disabled={!path}>
<Icon name="eye" className="ico-sm"/> Check silhouette before download</button>
<button className="btn btn-blush" onClick={exportSvg} disabled={!path}>
<Icon name="download" className="ico-sm"/> Export scalable SVG</button>
</aside>
</div>;
    const header=<header className="silhouette-head">
<div>
<div className="eyebrow">Editing Studio · specialist workstation</div>
<h2 className="serif">Silhouette Studio</h2>
<p className="muted small">Preserve the pad shape as an editable vector pattern, with photo and PDF reference support.</p>
</div>
<div className="silhouette-head-actions">
<button className="btn btn-ghost silhouette-open-canvas" onClick={()=>setCanvasModal(true)} disabled={!source&&!pdfUrl}>
<Icon name="aperture" className="ico-sm"/> Open canvas</button>
<label className="btn btn-ghost silhouette-upload">
<Icon name="upload" className="ico-sm"/> Photo / PDF<input type="file" accept="image/*,.pdf,application/pdf" onChange={onFile}/>
</label>
{!standalone&&<button className="icon-btn" onClick={onClose} title="Close silhouette editor">
<Icon name="x" className="ico-sm"/>
</button>}{standalone&&onGoto&&<button className="btn btn-ghost" onClick={()=>onGoto('generator')}>
<Icon name="sparkles" className="ico-sm"/> Production</button>}</div>
</header>;
    const page=<div className="silhouette-page">{header}<div className="silhouette-page-inner">{content}</div>{preview&&<div className="silhouette-preview" role="dialog" aria-modal="true">
<div className="silhouette-preview-card">
<div className="row between">
<div>
<div className="eyebrow">Review sheet / before export</div>
<h3 className="serif">Check your silhouette</h3>
</div>
<button className="icon-btn" onClick={()=>setPreview(false)}>
<Icon name="x" className="ico-sm"/>
</button>
</div>
<div className="preview-mode-toggle">
<button className={previewMode==='outline'?'active':''} onClick={()=>setPreviewMode('outline')}>
<Icon name="eye" className="ico-sm"/> Clean silhouette</button>
<button className={previewMode==='compare'?'active':''} onClick={()=>setPreviewMode('compare')} disabled={!source}>
<Icon name="photo" className="ico-sm"/> Compare to photo</button>
</div>
<div className="preview-canvas">
<svg viewBox={`0 0 ${STAGE.width} ${STAGE.height}`}>{previewMode==='compare'&&source&&<image href={source} x="0" y="0" width={STAGE.width} height={STAGE.height} preserveAspectRatio="xMidYMid meet" opacity=".25"/>}<path d={path} fill={previewMode==='outline'?'#fffafc':'#e9a7c9'} fillOpacity=".9" stroke="#6d334b" strokeWidth="5"/>
</svg>
</div>
<div className="preview-summary">
<span>{nodes.length} editable nodes</span>
<span>{dimensions?`${dimensions.width.toFixed(1)} × ${dimensions.height.toFixed(1)} in`:'Set output size'}</span>
<span>{previewMode==='outline'?'Clean silhouette':'Photo comparison'}</span>
</div>
<div className="row" style={{justifyContent:'flex-end',gap:8}}>
<button className="btn btn-ghost" onClick={()=>setPreview(false)}>Return to editing</button>
<button className="btn btn-blush" onClick={()=>{setPreview(false);exportSvg()}}>
<Icon name="download" className="ico-sm"/> Looks right — export SVG</button>
</div>
</div>
</div>}</div>;
    return standalone?page:<div className="silhouette-overlay" role="dialog" aria-modal="true" aria-label="Create silhouette">
<div className="silhouette-modal">{page}</div>
</div>;
  }
  window.SilhouetteStudio=SilhouetteStudio;
  window.SilhouetteStudioPage=(props)=>React.createElement(SilhouetteStudio,{...props,standalone:true});
})();
