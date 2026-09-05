/* Wonder Pads storefront silhouette geometry, v81. No external tracing service. */
(function(root){
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const uid=()=>`s${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;
  const empty=()=>({assets:[],layers:[],nodes:[],stage:'pieces',name:'pad-silhouette'});
  const images=new Map();
  const image=src=>{if(!images.has(src))images.set(src,new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>{images.delete(src);reject(new Error('This image could not be opened.'));};im.src=src;}));return images.get(src);};
  const turn=(p,deg)=>{const a=deg*Math.PI/180;return{x:p.x*Math.cos(a)-p.y*Math.sin(a),y:p.x*Math.sin(a)+p.y*Math.cos(a)};};
  const world=(p,l)=>{const q=turn({x:p.x*l.scale*(l.flip?-1:1),y:p.y*l.scale},l.rotation);return{x:l.x+q.x,y:l.y+q.y};};
  const local=(p,l)=>{const q=turn({x:p.x-l.x,y:p.y-l.y},-l.rotation);return{x:q.x/l.scale*(l.flip?-1:1),y:q.y/l.scale};};
  const corners=r=>[{x:r.x,y:r.y},{x:r.x+r.w,y:r.y},{x:r.x+r.w,y:r.y+r.h},{x:r.x,y:r.y+r.h}];
  const bounds=pts=>{if(!pts.length)return null;let x=Infinity,y=Infinity,X=-Infinity,Y=-Infinity;pts.forEach(p=>{x=Math.min(x,p.x);y=Math.min(y,p.y);X=Math.max(X,p.x);Y=Math.max(Y,p.y);});return{x,y,w:Math.max(.001,X-x),h:Math.max(.001,Y-y)};};
  const layerBounds=ls=>bounds(ls.flatMap(l=>corners(l.crop).map(p=>world(p,l))));
  const nodes=pts=>pts.map(p=>({...p,in:{...p},out:{...p}}));
  const path=ns=>ns.length<3?'':`M${ns[0].x},${ns[0].y}`+ns.map((a,i)=>{const b=ns[(i+1)%ns.length];return ` C${a.out.x},${a.out.y} ${b.in.x},${b.in.y} ${b.x},${b.y}`;}).join('')+' Z';
  const move=(n,p)=>{const dx=p.x-n.x,dy=p.y-n.y;return{...n,...p,in:{x:n.in.x+dx,y:n.in.y+dy},out:{x:n.out.x+dx,y:n.out.y+dy}};};
  const cubic=(a,b,t)=>{const u=1-t;return{x:u*u*u*a.x+3*u*u*t*a.out.x+3*u*t*t*b.in.x+t*t*t*b.x,y:u*u*u*a.y+3*u*u*t*a.out.y+3*u*t*t*b.in.y+t*t*t*b.y};};
  const curveBounds=ns=>{const pts=[];ns.forEach((a,i)=>{const b=ns[(i+1)%ns.length];pts.push(a);['x','y'].forEach(k=>{const A=-a[k]+3*a.out[k]-3*b.in[k]+b[k],B=2*(a[k]-2*a.out[k]+b.in[k]),C=a.out[k]-a[k];let roots=[];if(Math.abs(A)<1e-9){if(Math.abs(B)>1e-9)roots=[-C/B];}else{const d=B*B-4*A*C;if(d>=0)roots=[(-B+Math.sqrt(d))/(2*A),(-B-Math.sqrt(d))/(2*A)];}roots.filter(t=>t>0&&t<1).forEach(t=>pts.push(cubic(a,b,t)));});});return bounds(pts);};
  const svg=ns=>{const b=curveBounds(ns);return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x} ${b.y} ${b.w} ${b.h}" width="${Math.ceil(b.w)}" height="${Math.ceil(b.h)}"><path fill="#000000" d="${path(ns)}"/></svg>`;};
  const download=(blob,name)=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),15000);};
  const openStore=()=>new Promise((resolve,reject)=>{const r=indexedDB.open('wp-silhouette-workspace',1);r.onupgradeneeded=()=>r.result.createObjectStore('projects');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const save=async doc=>{const db=await openStore();try{await new Promise((resolve,reject)=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put(doc,'current');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}};
  const load=async()=>{const db=await openStore();try{return await new Promise((resolve,reject)=>{const r=db.transaction('projects').objectStore('projects').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}};
  const legacy=()=>{try{const old=JSON.parse(localStorage.getItem('wp-silhouette-session-v2')||'null');if(!old)return null;const assets=[],layers=[];(old.assemblySources||[]).forEach(l=>{const id=uid(),w=l.naturalWidth||l.crop?.w||960,h=l.naturalHeight||l.crop?.h||2880,crop=l.crop||{x:0,y:0,w,h},scale=l.scale||1,rotation=l.rotation||0;assets.push({id,name:l.name,src:l.data,w,h});const off=turn({x:(crop.x+crop.w/2)*scale,y:(crop.y+crop.h/2)*scale},rotation);layers.push({id:uid(),assetId:id,name:l.name,x:l.x-off.x,y:l.y-off.y,scale,rotation,flip:false,opacity:l.opacity??74,visible:l.visible!==false,locked:false,crop});});const ns=old.assemblyMode===false?(old.nodes||[]).map(n=>({x:n.x,y:n.y,in:n.handleIn||{x:n.x,y:n.y},out:n.handleOut||{x:n.x,y:n.y}})):[];return assets.length?{assets,layers,nodes:ns,stage:ns.length?'silhouette':'pieces',name:'pad-silhouette'}:null;}catch{return null;}};
  // Square morphology uses two sliding windows instead of a per-pixel kernel.
  function morphology(mask,w,h,r,dilate){
    if(!r)return mask;const temp=new Uint8Array(mask.length),out=new Uint8Array(mask.length),test=sum=>dilate?sum>0:sum===2*r+1;
    for(let y=0;y<h;y++){let sum=0;for(let x=0;x<=Math.min(r,w-1);x++)sum+=mask[y*w+x];for(let x=0;x<w;x++){temp[y*w+x]=test(sum)?1:0;if(x-r>=0)sum-=mask[y*w+x-r];if(x+r+1<w)sum+=mask[y*w+x+r+1];}}
    for(let x=0;x<w;x++){let sum=0;for(let y=0;y<=Math.min(r,h-1);y++)sum+=temp[y*w+x];for(let y=0;y<h;y++){out[y*w+x]=test(sum)?1:0;if(y-r>=0)sum-=temp[(y-r)*w+x];if(y+r+1<h)sum+=temp[(y+r+1)*w+x];}}return out;
  }
  function fill(mask,w,h){
    const outside=new Uint8Array(mask.length),queue=new Int32Array(mask.length);let head=0,tail=0;const add=i=>{if(!mask[i]&&!outside[i]){outside[i]=1;queue[tail++]=i;}};
    for(let x=0;x<w;x++){add(x);add((h-1)*w+x);}for(let y=0;y<h;y++){add(y*w);add(y*w+w-1);}while(head<tail){const i=queue[head++],x=i%w;if(x>0)add(i-1);if(x<w-1)add(i+1);if(i>=w)add(i-w);if(i+w<mask.length)add(i+w);}return Uint8Array.from(outside,v=>v?0:1);
  }
  function components(mask,w,h){
    const seen=new Uint8Array(mask.length),queue=new Int32Array(mask.length),groups=[];
    for(let start=0;start<mask.length;start++){if(!mask[start]||seen[start])continue;let head=0,tail=1;queue[0]=start;seen[start]=1;while(head<tail){const i=queue[head++],x=i%w;const add=n=>{if(mask[n]&&!seen[n]){seen[n]=1;queue[tail++]=n;}};if(x>0)add(i-1);if(x<w-1)add(i+1);if(i>=w)add(i-w);if(i+w<mask.length)add(i+w);}groups.push(queue.slice(0,tail));}return groups.sort((a,b)=>b.length-a.length);
  }
  function boundary(mask,w,h){
    const edges=new Map(),stride=w+1;const edge=(a,b)=>{if(!edges.has(a))edges.set(a,[]);edges.get(a).push(b);};
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(!mask[y*w+x])continue;const p=y*stride+x;if(y===0||!mask[(y-1)*w+x])edge(p,p+1);if(x===w-1||!mask[y*w+x+1])edge(p+1,p+stride+1);if(y===h-1||!mask[(y+1)*w+x])edge(p+stride+1,p+stride);if(x===0||!mask[y*w+x-1])edge(p+stride,p);}
    let best=[],areaMax=0;while(edges.size){const start=edges.keys().next().value,pts=[];let at=start,guard=0;do{pts.push({x:at%stride,y:Math.floor(at/stride)});const options=edges.get(at);if(!options?.length)break;const next=options.pop();if(!options.length)edges.delete(at);at=next;}while(at!==start&&guard++<mask.length*4);if(at===start){const area=Math.abs(pts.reduce((s,p,i)=>{const q=pts[(i+1)%pts.length];return s+p.x*q.y-q.x*p.y;},0));if(area>areaMax){best=pts;areaMax=area;}}}return best;
  }
  const lineDistance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
  function simplify(pts,tolerance){if(pts.length<=2)return pts;const keep=new Uint8Array(pts.length),stack=[[0,pts.length-1]];keep[0]=keep[pts.length-1]=1;while(stack.length){const[a,b]=stack.pop();let d=tolerance,index=-1;for(let i=a+1;i<b;i++){const v=lineDistance(pts[i],pts[a],pts[b]);if(v>d){d=v;index=i;}}if(index!==-1){keep[index]=1;stack.push([a,index],[index,b]);}}return pts.filter((_,i)=>keep[i]);}
  function ring(pts,tolerance){const mid=Math.floor(pts.length/2);return [...simplify(pts.slice(0,mid+1),tolerance).slice(0,-1),...simplify([...pts.slice(mid),pts[0]],tolerance).slice(0,-1)];}
  async function trace(doc,threshold,gap){
    const layers=doc.layers.filter(l=>l.visible),b=layerBounds(layers);if(!b)throw new Error('Place at least one page on the canvas.');
    const scale=Math.min(2,1600/Math.max(b.w,b.h)),margin=Math.max(24,Math.ceil(gap*scale)+8),w=Math.ceil(b.w*scale)+margin*2,h=Math.ceil(b.h*scale)+margin*2;
    const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
    // Identical transforms to the workspace. White paper cannot erase the earlier
    // piece. Alignment opacity is ignored, so transparency cannot split a trace.
    ctx.globalCompositeOperation='multiply';
    for(const l of layers){const a=doc.assets.find(a=>a.id===l.assetId),im=await image(a.src);ctx.save();ctx.translate(margin-b.x*scale,margin-b.y*scale);ctx.scale(scale,scale);ctx.translate(l.x,l.y);ctx.rotate(l.rotation*Math.PI/180);ctx.scale(l.scale*(l.flip?-1:1),l.scale);const r=l.crop;ctx.beginPath();ctx.rect(r.x,r.y,r.w,r.h);ctx.clip();ctx.drawImage(im,0,0,a.w,a.h);ctx.restore();}
    const pixels=ctx.getImageData(0,0,w,h).data;let mask=new Uint8Array(w*h);for(let i=0;i<mask.length;i++){const j=i*4;mask[i]=255-(pixels[j]*.2126+pixels[j+1]*.7152+pixels[j+2]*.0722)>=threshold?1:0;}
    const radius=clamp(Math.round(gap*scale/2),0,30);mask=morphology(morphology(mask,w,h,radius,true),w,h,radius,false);mask=fill(mask,w,h);
    // Remove single-pixel ink tails without flattening the pad's inward curves.
    mask=fill(morphology(morphology(mask,w,h,1,false),w,h,1,true),w,h);
    const groups=components(mask,w,h);if(!groups.length||groups[0].length<100)throw new Error('No clear outline found. Crop closely around your pattern or increase ink sensitivity.');
    const large=groups.filter(g=>g.length>Math.max(100,groups[0].length*.025));if(large.length>1)throw new Error(`There are ${large.length} separate shapes. Overlap the joining edges, crop away other patterns, or increase Close small gaps. Your assembly is unchanged.`);
    mask=new Uint8Array(w*h);groups[0].forEach(i=>mask[i]=1);const raw=boundary(mask,w,h);if(raw.length<4)throw new Error('The boundary could not be followed. Check that the outside edge is closed.');const bb=bounds(raw);if(groups[0].length/(bb.w*bb.h)<.13)throw new Error('The outline appears open. Align the cut edges or increase Close small gaps to make a closed shape.');
    return nodes(ring(raw,1.3).map(p=>({x:(p.x-margin)/scale+b.x,y:(p.y-margin)/scale+b.y})));
  }
  const api={clamp,uid,empty,image,turn,world,local,corners,bounds,layerBounds,nodes,path,move,cubic,curveBounds,svg,download,save,load,legacy,morphology,fill,components,boundary,ring,trace};
  if(typeof module!=='undefined')module.exports=api;root.WPSilhouette=api;
})(typeof window!=='undefined'?window:globalThis);
