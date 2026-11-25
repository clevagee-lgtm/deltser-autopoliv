// Confirmed outlines are the source of the planning mask. Later outlines take
// precedence in overlaps; rebuilding restores what lay beneath a removed one.
const manual={active:false, outlines:[], history:[], draft:null, editing:-1, vertex:-1};
function setupManual(active){
  Object.assign(manual,{active,outlines:[],history:[],draft:null,editing:-1,vertex:-1});
  document.body.classList.toggle("manual-plan",active);
  $("manual").hidden=!active;
  $(active?"scaleSlot":"scaleHome").append($("scaleTools"));
  canvas.style.width="100%";$("zoom").value="1";$("manualKind").value="1";
  if(!active)return;
  state.scale=null;state.points=[];state.measuring=true;state.grid=null;$("grid").hidden=true;
  $("firstTime").textContent="";
  state.mode="Ручная обводка";
}
function manualControls(){
  const {draft,outlines,editing,vertex}=manual;
  $("manualActions").hidden=!state.scale || state.measuring;
  $("guide").textContent=state.measuring || !state.scale ? (state.points.length===2?"Введите длину отрезка в метрах.":state.points.length?"Отметьте второй конец известного отрезка.":"Отметьте два конца отрезка, длину которого знаете.") :
    editing>=0?(vertex<0?"Нажмите на вершину, которую хотите передвинуть.":"Укажите новое место вершины.") :
    draft?"Отметьте углы газона по порядку и замкните контур.":"Добавьте следующий контур или выберите существующий для правки.";
  $("finish").hidden=$("cancelOutline").hidden=!draft;
  $("finish").disabled=!draft || draft.length<3;
  $("finish").textContent=editing>=0?"Сохранить правку":"Замкнуть контур";
  $("addOutline").hidden=Boolean(draft);
  for(const id of ["outlineList","adjust","removeOutline"])$(id).hidden=Boolean(draft)||!outlines.length;
  $("restore").hidden=Boolean(draft)||!manual.history.length;
  $("manualKind").disabled=editing>=0;
}
function startOutline(index=-1){
  manual.editing=index;manual.vertex=-1;
  manual.draft=index<0?[]:manual.outlines[index].points.slice();
  if(index>=0)$("manualKind").value=manual.outlines[index].kind;
  manualControls();paint();
}
function endOutline(){
  manual.editing=-1;manual.vertex=-1;manual.draft=null;
  manualControls();paint();
}
function rebuildOutlines(){
  const {width,height}=state.map;
  let map={width,height,ids:new Int32Array(width*height).fill(-1),regions:[]};
  for(const {points,kind} of manual.outlines)map=editRegionMap(map,polygonMask(points,width,height),kind);
  state.map=map;state.selection=null;
  $("outlineList").replaceChildren(...manual.outlines.map((o,i)=>new Option((i+1)+". "+names[o.kind],i)));
  endOutline();clearDesign();refresh();
}
function changeOutlines(next){
  manual.history.push(manual.outlines);
  if(manual.history.length>12)manual.history.shift();
  manual.outlines=next;rebuildOutlines();
}
function manualClick(x,y){
  if(!state.scale || !manual.draft)return;
  const point=[x*state.map.width/canvas.width,y*state.map.height/canvas.height];
  if(manual.editing<0)manual.draft.push(point);
  else if(manual.vertex>=0){manual.draft[manual.vertex]=point;manual.vertex=-1;}
  else{
    const rect=canvas.getBoundingClientRect();
    const distances=manual.draft.map(([a,b])=>Math.hypot((a-point[0])*rect.width/state.map.width,(b-point[1])*rect.height/state.map.height));
    const nearest=Math.min(...distances);
    if(nearest<=22)manual.vertex=distances.indexOf(nearest);
  }
  manualControls();paint();
}
function drawManualVertices(){
  const points=manual.draft;
  if(!points?.length)return;
  const pixels=points.map(([x,y])=>[x*canvas.width/state.map.width,y*canvas.height/state.map.height]);
  const unit=canvas.width/canvas.getBoundingClientRect().width;
  ctx.save();ctx.strokeStyle="#932071";ctx.lineWidth=2*unit;
  ctx.beginPath();pixels.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
  if(manual.editing>=0)ctx.closePath();
  ctx.stroke();
  pixels.forEach(([x,y],i)=>{ctx.fillStyle=i===manual.vertex?"#ffba41":"white";ctx.beginPath();ctx.arc(x,y,4*unit,0,2*Math.PI);ctx.fill();ctx.stroke();});
  ctx.restore();
}
function bindManual(){
  $("zoom").onchange=()=>{canvas.style.width=Number($("zoom").value)*100+"%";paint();};
  $("addOutline").onclick=()=>startOutline();
  $("adjust").onclick=()=>startOutline(Number($("outlineList").value));
  $("cancelOutline").onclick=endOutline;
  $("finish").onclick=()=>{
    const points=manual.draft;
    if(!points || !polygonMask(points,state.map.width,state.map.height).some(Boolean)){
      $("guide").textContent="Отметьте углы так, чтобы между ними была площадь.";return;
    }
    const next=manual.outlines.slice();
    next[manual.editing<0?next.length:manual.editing]={points,kind:Number($("manualKind").value)};
    changeOutlines(next);
    if(state.design?.heads.length && !$("firstTime").textContent){
      const seconds=Math.round((performance.now()-manual.started)/1000);
      $("firstTime").textContent="От загрузки до первой расстановки: "+seconds+" с.";
    }
  };
  $("removeOutline").onclick=()=>changeOutlines(manual.outlines.filter((_,i)=>i!==Number($("outlineList").value)));
  $("restore").onclick=()=>{manual.outlines=manual.history.pop();rebuildOutlines();};
}
