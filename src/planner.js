// Irrigation preview in image coordinates. Pressure here is explicitly at the nozzle.
const operatingBar=2.8;
const directionVectors=Array.from({length:16},(_,i)=>[Math.cos(i*Math.PI/8),Math.sin(i*Math.PI/8)]);
function sectorContains(head,x,y) {
  const dx=x-head.x,dy=y-head.y,dist=Math.hypot(dx,dy);
  if(dist>head.rPx)return false;
  if(dist<0.001 || head.arc===360)return true;
  const angle=(Math.atan2(dy,dx)*180/Math.PI+360-head.start+360)%360;
  return angle<=head.arc;
}
function proposeHeads(map,table,scaleX,scaleY,flowLimit) {
  const heads=[],warnings=[],zones=[];
  if(!(scaleX>0 && scaleY>0))return {heads,warnings:["Укажите масштаб."],zones};
  const inZone=(x,y,id)=>x>=0&&y>=0&&x<map.width&&y<map.height&&map.ids[Math.floor(y)*map.width+Math.floor(x)]===id;
  let unsupported=0;
  for(const reg of map.regions.filter(r=>r.kind===1)){
    const width=(reg.maxX-reg.minX+1)*scaleX,height=(reg.maxY-reg.minY+1)*scaleY;
    const area=reg.count*scaleX*scaleY;
    const base=table.filter(r=>r.bar===operatingBar && r.arc===180 && r.radius<=Math.min(width,height)*1.25)
      .sort((a,b)=>b.radius-a.radius).find(r=>Math.PI*r.radius*r.radius/8<=area);
    if(!base){unsupported++;continue;}
    const columns=Math.max(1,Math.ceil(width/base.radius)),rows=Math.max(1,Math.ceil(height/base.radius));
    if((columns+1)*(rows+1)>650 || heads.length>650){warnings.push("Крупная область требует отдельного расчёта.");continue;}
    const rgHeads=[];
    for(let row=0;row<=rows;row++)for(let col=0;col<=columns;col++){
      const gx=reg.minX+.5+col*(reg.maxX-reg.minX)/columns,gy=reg.minY+.5+row*(reg.maxY-reg.minY)/rows;
      // Snap to a nearby included point, keeping the nozzle clear of excluded objects.
      let target=null;
      for(const shift of [0,.13,.25,.38]) {
        for(const [vx,vy] of directionVectors){
          const x=gx+shift*base.radius/scaleX*vx,y=gy+shift*base.radius/scaleY*vy;
          if(inZone(x,y,reg.id)){target={x,y};break;}
        }
        if(target)break;
      }
      if(!target)continue;
      const {x,y}=target;
      if(rgHeads.some(h=>Math.hypot((h.x-x)*scaleX,(h.y-y)*scaleY)<base.radius*.53))continue;
      const candidates=table.filter(r=>r.bar===operatingBar && r.model===base.model && [90,180,270,360].includes(r.arc));
      let best=null;
      for(const nozzle of candidates){
        const rays=Array.from({length:32},(_,i)=>{
          const a=(i+.5)*Math.PI/16;
          return [.2,.5,.8,1].reduce((s,d)=>s+Number(inZone(x+Math.cos(a)*nozzle.radius*d/scaleX,y+Math.sin(a)*nozzle.radius*d/scaleY,reg.id)),0)/4;
        });
        for(let offset=0;offset<(nozzle.arc===360?1:32);offset++){
          const n=nozzle.arc/360*32;
          let inside=0;
          for(let j=0;j<n;j++)inside+=rays[(offset+j)%32];
          if(inside/n<.88)continue;
          const score=inside-4*(n-inside);
          if(!best||score>best.score)best={...nozzle,x,y,rPx:nozzle.radius/scaleX,start:offset*360/32,score,region:reg.id};
        }
      }
      if(best)rgHeads.push(best);
    }
    heads.push(...rgHeads);
  }
  if(unsupported)warnings.push("Узких или малых областей вне диапазона выбранных сопел: "+unsupported+".");
  if(flowLimit>0){
    // Preserve spatial order. A zone never exceeds the entered working capacity.
    let zone=null;
    for(const h of heads){
      if(h.flow>flowLimit){h.zone=null;continue;}
      if(!zone || (zone.flow+h.flow)>flowLimit+1e-8){
        zone={id:zones.length+1,flow:0,n:0};zones.push(zone);
      }
      h.zone=zone.id;zone.n++;zone.flow=Math.round((zone.flow+h.flow)*100)/100;
    }
    if(heads.some(h=>!h.zone))warnings.push("Есть сопла, расход которых превышает доступную подачу.");
  }
  const turf=map.regions.filter(r=>r.kind===1).reduce((s,r)=>s+r.count,0);
  // Rasterize physical sectors into the same grid; do not visually clip overspray.
  const wet=new Uint8Array(map.ids.length);
  for(const h of heads){
    for(let y=Math.max(0,Math.floor(h.y-h.rPx));y<Math.min(map.height,Math.ceil(h.y+h.rPx+1));y++)
      for(let x=Math.max(0,Math.floor(h.x-h.rPx));x<Math.min(map.width,Math.ceil(h.x+h.rPx+1));x++)
        if(sectorContains(h,x+.5,y+.5))wet[y*map.width+x]=1;
  }
  let hit=0, outside=0;
  for(let i=0;i<wet.length;i++)if(wet[i]){if(map.regions[map.ids[i]]?.kind===1)hit++;else outside++;}
  return {heads,zones,warnings,coverage:turf?Math.round(100*hit/turf):null,outsideM2:outside*scaleX*scaleY};
}
const planColors=["#127f98","#8050a5","#ad681f","#228152","#a14258","#426ab2"];
let playback=null;
function stopPlayback(){clearInterval(playback);playback=null;}
function generate(){
  clearDesign();
  if(!state.scale)return;
  const m=state.map;
  state.design=proposeHeads(m,catalog,state.scale*canvas.width/m.width,state.scale*canvas.height/m.height,state.flow);
}
function paintHeads(){
  const m=state.map;
  ctx.save();ctx.scale(canvas.width/m.width,canvas.height/m.height);
  for(const h of state.design.heads){
    if(state.activeZone && state.activeZone!==h.zone)continue;
    const color=planColors[((h.zone||1)-1)%planColors.length];
    const start=h.start*Math.PI/180;
    ctx.fillStyle=color+"33";ctx.strokeStyle=color;ctx.lineWidth=.7;
    ctx.beginPath();ctx.moveTo(h.x,h.y);ctx.arc(h.x,h.y,h.rPx,start,start+h.arc*Math.PI/180);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle=color;ctx.beginPath();ctx.arc(h.x,h.y,1.7,0,2*Math.PI);ctx.fill();
  }
  ctx.restore();
}
function downloadFile(name,type,text){
 const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement("a");link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
function headCSV(){
 const lines=["Номер;Модель;Сектор, град;Начало по часовой от правой оси, град;Радиус, м;Расход, л/мин;Условная зона;X от левого края, м;Y от верхнего края, м"];
 const m=state.map;
 state.design.heads.forEach((h,i)=>lines.push([i+1,h.model,h.arc,h.start,h.radius,h.flow,h.zone||"",+(h.x*canvas.width/m.width*state.scale).toFixed(2),+(h.y*canvas.height/m.height*state.scale).toFixed(2)].join(";")));
 downloadFile("Deltser-sopla.csv","text/csv;charset=utf-8","\uFEFF"+lines.join("\r\n"));
}
function designControls(){
  const d=$("design");d.replaceChildren();
  const title=document.createElement("h2");title.textContent="Эскиз полива";d.append(title);
  const note=document.createElement("p");note.className="note";note.textContent="Для эскиза принято 2,8 бар на сопле. Потери давления и трассы требуют отдельного расчёта.";d.append(note);
  if(!state.scale){d.append("После задания масштаба здесь появится расстановка.");return;}
  if(!state.design)generate();
  const result=state.design,n=result.heads.length;
  const info=document.createElement("p");info.textContent=n?("Сопел: "+n+" · покрытие выделенного газона: "+result.coverage+"%."):"Для выделенных областей подходящая расстановка пока не найдена.";d.append(info);
  if(n){
    const label=document.createElement("label");label.textContent="Доступная подача при рабочем давлении, л/мин";
    const flow=document.createElement("input");flow.type="number";flow.step="any";flow.min="0.1";flow.max="1500";flow.value=state.flow||"";flow.placeholder="Если известна";label.append(flow);d.append(label);
    const apply=document.createElement("button");apply.textContent="Пересчитать зоны";apply.onclick=()=>{
      if(flow.value && (!flow.checkValidity() || Number(flow.value)<=0)){tell("Проверьте значение подачи, л/мин.");return;}
      state.flow=flow.value?Number(flow.value):null;generate();designControls();paint();
    };d.append(apply);
    const summary=document.createElement("p");summary.textContent=result.zones.length?"Предварительных зон: "+result.zones.length+".":"Разделение на зоны ожидает данных об источнике.";d.append(summary);
    if(result.zones.length){const play=document.createElement("button");play.textContent=playback?"Остановить показ":"Показать зоны по очереди";play.onclick=()=>{
      if(playback){stopPlayback();state.activeZone=null;play.textContent="Показать зоны по очереди";}
      else{let index=0;state.layer=true;const step=()=>{state.activeZone=result.zones[index++%result.zones.length].id;paint();tell("Зона "+state.activeZone+" · "+result.zones[state.activeZone-1].flow+" л/мин");};step();playback=setInterval(step,1350);play.textContent="Остановить показ";}paint();
    };d.append(play);}
    const tools=document.createElement("div");tools.className="group";
    for(const [label,fn] of [["Ведомость CSV",headCSV],["Печать / PDF",()=>{stopPlayback();state.activeZone=null;state.layer=true;paint();window.print();}]]){const b=document.createElement("button");b.textContent=label;b.onclick=fn;tools.append(b);}d.append(tools);
    const report=$("report");report.replaceChildren();const heading=document.createElement("h2");heading.textContent="Предварительная ведомость сопел";report.append(heading);
    const tbl=document.createElement("table");
    const tr=tbl.createTHead().insertRow();for(const s of ["Модель","Сектор","Радиус","Расход на сопло","Кол-во","Зона"]){const th=document.createElement("th");th.textContent=s;tr.append(th);}
    const groups=new Map();for(const h of result.heads){const k=[h.model,h.arc,h.radius,h.flow,h.zone||"—"].join("/");groups.set(k,(groups.get(k)||0)+1);}
    const body=tbl.createTBody();
    for(const [k,count] of groups){const [model,arc,radius,flow,zone]=k.split("/");const row=body.insertRow();for(const s of [model,arc+"°",radius+" м",flow+" л/мин",count,zone])row.insertCell().textContent=s;}
    report.append(tbl);
  }
  for(const s of result.warnings){const p=document.createElement("p");p.className="note";p.textContent=s;d.append(p);}
  if(n){const p=document.createElement("p");p.className="note";p.textContent="Геометрическая площадь за газоном внутри изображения: "+Math.round(result.outsideM2)+" м². Оценка не учитывает ветер и равномерность осадков.";d.append(p);}
  paint();
}
