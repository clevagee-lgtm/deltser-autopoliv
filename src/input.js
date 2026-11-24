function axisPeriod(profile){
  const mean=profile.reduce((s,v)=>s+v,0)/profile.length;
  const peaks=[];
  for(let i=2;i<profile.length-2;i++){
    if(profile[i]<mean*1.8 || profile[i]<.055 || profile[i]<profile[i-1] || profile[i]<=profile[i+1])continue;
    if(peaks.length && i-peaks.at(-1)<4){if(profile[i]>profile[peaks.at(-1)])peaks[peaks.length-1]=i;}
    else peaks.push(i);
  }
  const ds=peaks.slice(1).map((x,i)=>x-peaks[i]).filter(d=>d>=7 && d<=100);
  if(ds.length<7)return null;
  const sorted=ds.toSorted?ds.toSorted((a,b)=>a-b):[...ds].sort((a,b)=>a-b);
  let best=null;
  for(const d of sorted){
    const hits=ds.filter(v=>Math.abs(v-d)<=1.5);
    if(!best || hits.length>best.length)best=hits;
  }
  return best && best.length>=7 && best.length>=ds.length*.32?best.reduce((a,b)=>a+b,0)/best.length:null;
}
function findSquareGrid(image){
  const c=document.createElement("canvas"),k=Math.min(1,1600/Math.max(image.width,image.height));c.width=Math.round(image.width*k);c.height=Math.round(image.height*k);
  const cc=c.getContext("2d",{willReadFrequently:true});cc.drawImage(image,0,0,c.width,c.height);
  const bytes=cc.getImageData(0,0,c.width,c.height).data,xs=new Float32Array(c.width),ys=new Float32Array(c.height);
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
    const i=(y*c.width+x)*4,r=bytes[i],g=bytes[i+1],b=bytes[i+2];
    if(r<125 && Math.max(r,g,b)-Math.min(r,g,b)<48){xs[x]+=1/c.height;ys[y]+=1/c.width;}
  }
  const dx=axisPeriod(xs),dy=axisPeriod(ys);
  return dx && dy && Math.abs(dx-dy)<Math.max(1.5,dx*.075)?(dx+dy)/2:null;
}

function applyPolygons(map,polygons){
  const c=document.createElement("canvas");c.width=map.width;c.height=map.height;
  const p=c.getContext("2d",{willReadFrequently:true});const regionKinds=[];
  // Exclusions win any overlap with irrigation polygons.
  const ordered=[...polygons].sort((a,b)=>Number(["water","excluded"].includes(a.kind))-Number(["water","excluded"].includes(b.kind)));
  for(const region of ordered){
    const kind=kinds.indexOf(region.kind);
    if(kind<0 || region.points.length<3)continue;
    regionKinds.push(kind);p.fillStyle="rgb("+regionKinds.length+",0,0)";
    p.beginPath();region.points.forEach(([x,y],i)=>i?p.lineTo(x*c.width,y*c.height):p.moveTo(x*c.width,y*c.height));p.closePath();p.fill();
  }
  if(!regionKinds.length)return;
  const data=p.getImageData(0,0,c.width,c.height).data;
  map.ids.fill(-1);map.regions=[];
  const remap=new Map();
  for(let i=0;i<map.ids.length;i++){
    if(data[i*4+3]!==255)continue;
    const label=data[i*4]-1;if(label<0 || label>=regionKinds.length)continue;
    let r=remap.get(label);
    if(!r){r={id:map.regions.length,kind:regionKinds[label],count:0,minX:c.width,minY:c.height,maxX:0,maxY:0,evidence:"Контур предложен моделью"};remap.set(label,r);map.regions.push(r);}
    map.ids[i]=r.id;const x=i%c.width,y=Math.floor(i/c.width);r.count++;r.minX=Math.min(r.minX,x);r.maxX=Math.max(r.maxX,x);r.minY=Math.min(r.minY,y);r.maxY=Math.max(r.maxY,y);
  }
}
async function serverPlan(file){
  const resp=await fetch("/api/analyze",{method:"POST",body:file,headers:{"Content-Type":"application/octet-stream"}});
  if(!resp.ok){let reason="Ошибка обработки файла.";try{reason=(await resp.json()).detail||reason;}catch{}throw new Error(reason);}
  const d=await resp.json(),img=new Image();img.src="data:image/jpeg;base64,"+d.image;await img.decode();
  return {image:img,meta:{words:d.words,polygons:d.polygons,mode:d.mode,method:d.note,gridUnit:d.grid_unit,reference:d.reference}};
}
async function readPdf(file){
  const pdfjs=await import("./vendor/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc="./vendor/pdf.worker.min.mjs";
  const doc=await pdfjs.getDocument({data:await file.arrayBuffer(),isEvalSupported:false}).promise;
  try{
    const page=await doc.getPage(1),size=page.getViewport({scale:1}),vp=page.getViewport({scale:Math.min(3,1600/Math.max(size.width,size.height))});
    const c=document.createElement("canvas");c.width=Math.ceil(vp.width);c.height=Math.ceil(vp.height);
    await page.render({canvasContext:c.getContext("2d"),viewport:vp}).promise;
    const words=[];
    for(const item of (await page.getTextContent()).items){if(!item.str)continue;
      const [x,y]=vp.convertToViewportPoint(item.transform[4],item.transform[5]);
      words.push({text:item.str,x:(x+item.width*vp.scale/2)/c.width,y:(y-item.height*vp.scale/2)/c.height});
    }
    const line=words.map(w=>w.text).join(" ");
    const match=line.match(/(?:1\s*)?клетк[аи]\s*[-–—=]\s*(\d+(?:[.,]\d+)?)\s*(?:метр|м\b)/iu);
    return {image:c,meta:{words,gridUnit:match?Number(match[1].replace(",",".")):null,mode:"PDF · лист 1 из "+doc.numPages,method:"Цветовые области и текстовый слой первой страницы. Условные обозначения на плане могут требовать уточнения."}};
  }finally{await doc.destroy();}
}
async function initializeInputs(){
  if(!/^https?:$/.test(location.protocol))return;
  try{
    const response=await fetch("/api/capabilities");if(response.ok && response.headers.get("content-type")?.includes("application/json"))state.server=(await response.json()).analyze===true;
  }catch{}
  // Bundled PDF.js assets are present in the web build.
  if(state.server || document.documentElement.dataset.pdf==="true"){
    $("file").accept+=",.pdf";$("formats").textContent="PDF (первый лист), JPG, PNG, WebP · до 16 МБ";
  }
}
