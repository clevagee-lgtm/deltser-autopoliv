const $=id=>document.getElementById(id);
const canvas=$("plan"), ctx=canvas.getContext("2d"), catalog=readCatalog(CSV);
const state={image:null,map:null,layer:true,scale:null,points:[],measuring:false,selection:null,
  name:"",mode:"",design:null,variants:null,flow:null,activeZone:null,loadId:0,server:false};
let overlayCanvas=null;
let editMode=null, vertices=[], draftMask=null, draftLayer=null, pickPixels=null;
const undoMaps=[];
function resetEdit(){
  editMode=null;vertices=[];draftMask=null;draftLayer=null;
  $("saveArea").disabled=true;$("cancelArea").hidden=true;
  $("editHint").textContent="Выберите способ и отметьте область на плане.";
}
function rememberMap(){
  undoMaps.push(state.map);
  if(undoMaps.length>12)undoMaps.shift();
  $("undoArea").disabled=false;
}
function beginEdit(mode){
  resetEdit();editMode=mode;state.layer=true;state.measuring=false;$("meterBox").hidden=true;
  $("cancelArea").hidden=false;
  $("editHint").textContent=mode==="pick"?"Нажмите внутри однотонной замкнутой области.":"Нажмите по очереди на углы контура, затем примените его.";
  tell($("editHint").textContent);paint();
}
function previewMask(mask){
  draftMask=mask;draftLayer=null;
  $("saveArea").disabled=!mask?.some(Boolean);
  if(!$("saveArea").disabled){
    const m=state.map;
    draftLayer=document.createElement("canvas");draftLayer.width=m.width;draftLayer.height=m.height;
    const c=draftLayer.getContext("2d"),img=c.createImageData(m.width,m.height);
    for(let i=0;i<mask.length;i++)if(mask[i])img.data.set([181,44,146,140],i*4);
    c.putImageData(img,0,0);
  }
  paint();
}
function tell(message){$("status").textContent=message;}
function clearDesign(){
  state.design=null;state.variants=null;state.activeZone=null;
  if(typeof stopPlayback==="function") stopPlayback();
  $("report").replaceChildren();
}
function paint(){
  if(!state.image)return;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(state.image,0,0,canvas.width,canvas.height);
  if(state.layer && overlayCanvas){ctx.save();ctx.globalAlpha=0.53;ctx.imageSmoothingEnabled=false;ctx.drawImage(overlayCanvas,0,0,canvas.width,canvas.height);ctx.restore();}
  if(state.layer && state.design && typeof paintHeads==="function")paintHeads();
  if(state.layer && draftLayer)ctx.drawImage(draftLayer,0,0,canvas.width,canvas.height);
  if(editMode==="polygon" && vertices.length){
    ctx.save();ctx.scale(canvas.width/state.map.width,canvas.height/state.map.height);
    ctx.strokeStyle="#932071";ctx.fillStyle="#fff";ctx.lineWidth=1.3;
    ctx.beginPath();vertices.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();
    for(const [x,y] of vertices){ctx.beginPath();ctx.arc(x,y,2,0,2*Math.PI);ctx.fill();ctx.stroke();}
    ctx.restore();
  }
  let result;
  if(!state.layer) result="Исходное изображение. Для просмотра эскиза нажмите «Разметка».";
  else if(!state.scale) result="Разметка участка готова. Укажите масштаб для расстановки сопел.";
  else if(state.design?.heads.length) result="Сопел на плане: "+state.design.heads.length+". Покрытие выделенного газона: "+state.design.coverage+"%. Полив за границей газона в кадре: "+Math.round(state.design.outsideM2)+" м². Синие точки с белой обводкой — сопла. Цветные секторы показывают полив.";
  else if(manual.active)result="Пока нет дождевателей. Проверьте размер и контур газона.";
  else result="Сопел на плане: 0. Проверьте масштаб и границы газона в разделе «Исправить область».";
  if(manual.active && !state.map.regions.length)result="";
  $("planResult").textContent=result;
  if(manual.active)drawManualVertices();
  const factor=Math.max(canvas.width,canvas.height)/650;
  ctx.lineWidth=Math.max(2,2*factor);ctx.strokeStyle="#a64124";ctx.fillStyle="#fff";
  if(state.points.length===2){ctx.beginPath();ctx.moveTo(...state.points[0]);ctx.lineTo(...state.points[1]);ctx.stroke();}
  for(const point of state.points){ctx.beginPath();ctx.arc(...point,4*factor,0,Math.PI*2);ctx.fill();ctx.stroke();}
  $("original").setAttribute("aria-pressed",!state.layer);$("overlay").setAttribute("aria-pressed",state.layer);
}
function renderMask(){
  const map=state.map;
  overlayCanvas=document.createElement("canvas");overlayCanvas.width=map.width;overlayCanvas.height=map.height;
  const dc=overlayCanvas.getContext("2d"),data=dc.createImageData(map.width,map.height);
  for(let i=0;i<map.ids.length;i++){
    const id=map.ids[i];if(id<0)continue;
    const color=palette[map.regions[id].kind];if(!color)continue;
    const rgb=parseInt(color.slice(1),16);const p=i*4;
    data.data[p]=rgb>>16;data.data[p+1]=(rgb>>8)&255;data.data[p+2]=rgb&255;
    const boundary=i%map.width===0 || map.ids[i-1]!==id || map.ids[i-map.width]!==id;
    const x=i%map.width,y=Math.floor(i/map.width);
    const drip=map.regions[id].kind===5;
    const stripe=drip && (y+Math.round(1.5*Math.sin(x/7)))%7===0 && x%9<6;
    data.data[p+3]=boundary || stripe || state.selection===id ? 255 : drip ? 55 : 165;
  }
  dc.putImageData(data,0,0);
}
function refresh(){
  const m=state.map;
  $("summary").replaceChildren();
  for(let k=1;k<kinds.length;k++){
    const regions=m.regions.filter(r=>r.kind===k);
    if(!regions.length)continue;
    const row=document.createElement("div");row.className="line";
    const label=document.createElement("span"),chip=document.createElement("i");chip.className="key";chip.style.background=palette[k];label.append(chip,names[k]);
    const amount=document.createElement("b");
    const area=regions.reduce((s,r)=>s+r.count,0)*canvas.width/m.width*canvas.height/m.height;
    amount.textContent=state.scale?Math.round(area*state.scale**2)+" м²":regions.length+" обл.";
    row.append(label,amount);$("summary").append(row);
  }
  if(!$("summary").childElementCount)$("summary").textContent="Подходящие области не выделены.";
  $("caption").textContent=state.name+" · "+state.mode;
  $("pathHint").textContent=m.regions.some(r=>r.kind===6) ? "При включении струя может попадать на отмеченные дорожки." : "Чтобы учесть дорожку, отметьте её в разделе «Разметить контур»." ;
  if(manual.active)$("pathHint").textContent="Для учёта дорожки обведите её отдельным контуром типа «Дорожка».";
  $("scaleInfo").textContent=state.scale?state.scaleEvidence:"Нужен один известный размер для расчёта в метрах.";
  $("region").replaceChildren(...m.regions.map(r=>new Option("№ "+(r.id+1)+" · "+names[r.kind],r.id)));
  $("corrections").hidden=!m.regions.length;
  if(m.regions.length){
    const id=state.selection??m.regions[0].id;
    $("region").value=id;$("kind").value=m.regions[id].kind;
  }
  $("method").textContent=state.method;
  if(manual.active)manualControls();
  renderMask();paint();
  if(typeof designControls==="function")designControls();
}
function loadImage(image,name,meta={}){
  $("waterPaths").checked=false;
  clearDesign();resetEdit();undoMaps.length=0;$("undoArea").disabled=true;
  const factor=Math.min(1,1600/Math.max(image.width,image.height));
  canvas.width=Math.max(1,Math.round(image.width*factor));canvas.height=Math.max(1,Math.round(image.height*factor));
  const down=Math.min(1,420/Math.max(canvas.width,canvas.height));
  const sample=document.createElement("canvas");sample.width=Math.max(1,Math.round(canvas.width*down));sample.height=Math.max(1,Math.round(canvas.height*down));
  const sc=sample.getContext("2d");sc.fillStyle="white";sc.fillRect(0,0,sample.width,sample.height);sc.drawImage(image,0,0,sample.width,sample.height);
  pickPixels=null;
  const map=meta.manual?{width:sample.width,height:sample.height,ids:new Int32Array(sample.width*sample.height).fill(-1),regions:[]}:detectRegions(sc.getImageData(0,0,sample.width,sample.height).data,sample.width,sample.height);
  if(meta.path){
    const mask=polygonMask(meta.path.map(([x,y])=>[x*map.width/image.width,y*map.height/image.height]),map.width,map.height);
    Object.assign(map,editRegionMap(map,mask,6));
  }
  if(!meta.manual && meta.words) useTextLabels(map,meta.words);
  if(!meta.manual && meta.polygons && typeof applyPolygons==="function")applyPolygons(map,meta.polygons);
  Object.assign(state,{image,name,map,mode:meta.mode||"Локальный анализ",scale:meta.scale??null,scaleEvidence:meta.scaleEvidence||"",
    method:meta.method||"Цветовые подсказки. Белые зоны и объекты без уверенной границы остаются без заливки.",flow:null,points:[],selection:null,layer:true,measuring:false});
  state.grid=meta.manual || meta.scale?null:findSquareGrid(image);$("grid").hidden=!state.grid;
  if(state.grid && meta.gridUnit>0 && meta.gridUnit<=10){
    state.scale=meta.gridUnit/state.grid;state.scaleEvidence="Из подписи и шага сетки: "+meta.gridUnit+" м на клетку.";
  }else if(meta.reference){
    const ref=meta.reference,a=ref.start,b=ref.end;
    const length=Math.hypot((a[0]-b[0])*canvas.width,(a[1]-b[1])*canvas.height);
    if(length>=canvas.width*.06 && ref.meters>0){state.scale=ref.meters/length;state.scaleEvidence="Оценка по размерной линии «"+ref.label+"». Проверьте её на плане.";state.points=[[a[0]*canvas.width,a[1]*canvas.height],[b[0]*canvas.width,b[1]*canvas.height]];}
  }
  $("meterBox").hidden=true;$("meters").value="";$("corrections").open=false;
  setupManual(Boolean(meta.manual));
  refresh();
}
function demonstration(){
  ++state.loadId;
  const sheet=document.createElement("canvas");sheet.width=860;sheet.height=500;
  const c=sheet.getContext("2d");c.fillStyle="#fbfaf2";c.fillRect(0,0,860,500);
  c.strokeStyle="#d0d9c7";c.lineWidth=1;
  for(let x=30;x<835;x+=20){c.beginPath();c.moveTo(x,25);c.lineTo(x,472);c.stroke();}
  for(let y=25;y<472;y+=20){c.beginPath();c.moveTo(30,y);c.lineTo(830,y);c.stroke();}
  function rect(x,y,w,h,fill){c.fillStyle=fill;c.fillRect(x,y,w,h);}
  rect(50,50,760,400,"#deddd1");rect(69,68,338,176,"#aad182");rect(69,265,338,164,"#a7ce80");
  rect(430,68,201,179,"#b9b5a4");rect(445,84,170,145,"#d9d4c4");rect(653,68,137,179,"#91b8d6");
  rect(430,265,360,164,"#b6ce94");
  for(let x=445;x<786;x+=31)for(let y=280;y<427;y+=29){c.fillStyle="#488050";c.beginPath();c.arc(x,y,9,0,2*Math.PI);c.fill();}
  c.fillStyle="#243f35";c.font="600 16px sans-serif";c.fillText("ДОМ",513,161);c.fillText("ПРУД",696,161);
  c.fillText("38 м",413,45);c.strokeStyle="#435c4b";c.lineWidth=2;c.strokeRect(50,50,760,400);
  c.fillText("◀",46,45);c.fillText("▶",794,45);
  loadImage(sheet,"Учебный участок",{path:[[69,244],[407,244],[407,265],[69,265]],scale:0.05,scaleEvidence:"38 м по внешней границе учебного участка.",mode:"Демонстрационный план",method:"Между двумя газонами отмечена дорожка. Переключите «Поливать дорожки», чтобы сравнить расстановку."});
  tell("Открыт учебный пример. Загрузите свой план для независимой проверки.");
}
async function decodeImage(blob){const url=URL.createObjectURL(blob);try{const img=new Image();img.src=url;await img.decode();return img;}finally{URL.revokeObjectURL(url);}}
async function upload(file){
  if(!file)return;
  const id=++state.loadId,started=performance.now();
  if(file.size>16*1024*1024){tell("Файл больше 16 МБ. Выберите уменьшенную копию.");return;}
  tell("Читаем план…");
  try{
    let image,meta={};
    const manualUpload=new URLSearchParams(location.search).get("lab")!=="1";
    if(state.server && (!manualUpload || (file.type==="application/pdf" && document.documentElement.dataset.pdf!=="true")) && typeof serverPlan==="function")({image,meta}=await serverPlan(file));
    else if(file.type==="application/pdf" || /\.pdf$/i.test(file.name)){
      if(document.documentElement.dataset.pdf!=="true")throw new Error("Для PDF откройте веб-версию или выберите изображение.");
      ({image,meta}=await readPdf(file));
    }else image=await decodeImage(file);
    if(id!==state.loadId)return;
    loadImage(image,file.name,{...meta,manual:manualUpload});manual.started=started;tell(manual.active?"План загружен. Укажите известный размер.":state.map.regions.length?"Разметка готова. Переключайте слои для сравнения.":"Не удалось уверенно выделить области. Откройте «Разметить контур» и укажите области полива.");
  }catch(e){if(id===state.loadId)tell("Не удалось открыть план. "+(e.message||"Проверьте формат файла."));}
}
$("kind").replaceChildren(...names.map((s,i)=>new Option(s,i)));
$("browse").onclick=()=>$("file").click();
$("file").onchange=e=>{upload(e.target.files[0]);e.target.value="";};
document.addEventListener("dragover",e=>e.preventDefault());
document.addEventListener("drop",e=>{e.preventDefault();upload(e.dataTransfer.files[0]);});
$("waterPaths").onchange=()=>{
  clearDesign();state.layer=true;refresh();
  tell(state.scale?"Эскиз пересчитан.":"Настройка дорожек сохранена для расчёта после задания масштаба.");
};
$("demo").onclick=demonstration;
$("original").onclick=()=>{resetEdit();state.layer=false;paint();};$("overlay").onclick=()=>{state.layer=true;paint();};
$("region").onchange=()=>{state.selection=Number($("region").value);refresh();};
$("change").onclick=()=>{
  const id=Number($("region").value),kind=Number($("kind").value);
  if(!state.map.regions[id] || state.map.regions[id].kind===kind)return;
  rememberMap();state.map={...state.map,regions:state.map.regions.map(r=>r.id===id?{...r,kind,evidence:"Уточнено вручную"}:r)};
  resetEdit();clearDesign();refresh();tell("Тип области изменён.");
};
$("pickArea").onclick=()=>beginEdit("pick");
$("drawArea").onclick=()=>beginEdit("polygon");
$("cancelArea").onclick=()=>{resetEdit();paint();};
$("saveArea").onclick=()=>{
  if(!draftMask?.some(Boolean))return;
  rememberMap();state.map=editRegionMap(state.map,draftMask,Number($("contourKind").value));
  state.selection=null;resetEdit();clearDesign();refresh();tell("Контур применён.");
};
$("undoArea").onclick=()=>{
  if(!undoMaps.length)return;
  state.map=undoMaps.pop();state.selection=null;resetEdit();clearDesign();refresh();
  $("undoArea").disabled=!undoMaps.length;tell("Последняя правка отменена.");
};
$("measure").onclick=()=>{resetEdit();state.measuring=manual.active?true:!state.measuring;if(manual.active)endOutline();state.points=[];$("meterBox").hidden=true;if(manual.active)manualControls();paint();tell(state.measuring?"Нажмите на начало, затем на конец известного отрезка.":"Измерение отменено.");};
canvas.onclick=e=>{
  const b=canvas.getBoundingClientRect(),x=(e.clientX-b.left)/b.width*canvas.width,y=(e.clientY-b.top)/b.height*canvas.height;
  if(manual.active && !state.measuring){manualClick(x,y);return;}
  if(editMode){
    const m=state.map,gx=x*m.width/canvas.width,gy=y*m.height/canvas.height;
    if(editMode==="polygon"){
      vertices.push([gx,gy]);previewMask(polygonMask(vertices,m.width,m.height));
    }else{
      if(!pickPixels){
        const buffer=document.createElement("canvas");buffer.width=canvas.width;buffer.height=canvas.height;
        const c=buffer.getContext("2d");c.fillStyle="white";c.fillRect(0,0,buffer.width,buffer.height);
        c.drawImage(state.image,0,0,buffer.width,buffer.height);
        pickPixels=c.getImageData(0,0,buffer.width,buffer.height).data;
      }
      const full=enclosedMask(pickPixels,canvas.width,canvas.height,x,y);
      let mask=null;
      if(full){
        mask=new Uint8Array(m.ids.length);
        for(let j=0;j<m.height;j++)for(let i=0;i<m.width;i++)
          mask[j*m.width+i]=full[Math.floor((j+.5)*canvas.height/m.height)*canvas.width+Math.floor((i+.5)*canvas.width/m.width)];
        if(!mask.some(Boolean))mask=null;
      }
      previewMask(mask);
      tell(mask?"Проверьте подсвеченную область и нажмите «Применить контур».":"Граница не замкнулась. Выберите «Обвести точками».");
    }
    return;
  }
  if(state.measuring){
    if(state.points.length===2)state.points=[];
    state.points.push([x,y]);if(manual.active)manualControls();paint();
    if(state.points.length===2){$("meterBox").hidden=false;$("meters").focus();tell("Введите реальную длину отмеченного отрезка.");}
    else tell("Теперь нажмите на второй конец отрезка.");return;
  }
  const m=state.map,id=m.ids[Math.floor(y/canvas.height*m.height)*m.width+Math.floor(x/canvas.width*m.width)];
  if(id>=0){state.selection=id;$("corrections").open=true;refresh();tell("Область № "+(id+1)+" · "+m.regions[id].evidence);}
};
$("setMeters").onclick=()=>{
  const meters=Number($("meters").value),[a,b]=state.points;
  if(!a || !b || !(meters>0 && meters<=2000)){tell("Введите длину отрезка в метрах от 0 до 2000.");return;}
  const px=Math.hypot(a[0]-b[0],a[1]-b[1]);if(px<3){tell("Отметьте более длинный отрезок.");return;}
  state.scale=meters/px;state.scaleEvidence=meters+" м по отмеченному вами отрезку.";state.measuring=false;$("meterBox").hidden=true;
  state.layer=true;clearDesign();if(manual.active && !manual.outlines.length)startOutline();refresh();tell("Масштаб применён.");
};
$("grid").onclick=()=>{if(!state.grid)return;resetEdit();state.scale=1/state.grid;state.scaleEvidence="1 метр на клетку, подтверждено вами.";state.measuring=false;state.points=[];$("meterBox").hidden=true;state.layer=true;clearDesign();refresh();tell("Масштаб применён по сетке.");};
bindManual();
demonstration();
initializeInputs();
