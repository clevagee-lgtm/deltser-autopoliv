// Irrigation preview in image coordinates. Pressure here is explicitly at the nozzle.
const operatingBar=2.8;
const directionVectors=Array.from({length:16},(_,i)=>[Math.cos(i*Math.PI/8),Math.sin(i*Math.PI/8)]);
// Count coverage on the recognition grid using the centre of each cell.
// In metres the footprint is a circular sector, even for non-square image cells.
function visitSector(head,map,scaleX,scaleY,visit){
  const rx=head.radius/scaleX, ry=head.radius/scaleY;
  const a=head.start*Math.PI/180, b=(head.start+head.arc)*Math.PI/180;
  const ax=Math.cos(a), ay=Math.sin(a), bx=Math.cos(b), by=Math.sin(b);
  const left=Math.max(0,Math.ceil(head.x-rx-.5)), right=Math.min(map.width-1,Math.floor(head.x+rx-.5));
  const top=Math.max(0,Math.ceil(head.y-ry-.5)), bottom=Math.min(map.height-1,Math.floor(head.y+ry-.5));
  for(let y=top;y<=bottom;y++){
    const dy=(y+.5-head.y)*scaleY;
    for(let x=left;x<=right;x++){
      const dx=(x+.5-head.x)*scaleX;
      if(dx*dx+dy*dy>head.radius**2+1e-9)continue;
      const after=ax*dy-ay*dx>=-1e-9, before=dx*by-dy*bx>=-1e-9;
      if(head.arc===360 || (head.arc<=180 ? after && before : after || before))visit(y*map.width+x);
    }
  }
}
function completeCoverage(map,table,scaleX,scaleY,heads){
  const turf=Uint8Array.from(map.ids,id=>Number(map.regions[id]?.kind===1));
  const wet=new Uint16Array(turf.length);
  const mark=(head,delta)=>visitSector(head,map,scaleX,scaleY,i=>{wet[i]+=delta;});
  const occupied=new Set();
  const location=(x,y)=>Math.floor(y)*map.width+Math.floor(x);
  for(const head of heads){mark(head,1);occupied.add(location(head.x,head.y));}
  function add(head){
    heads.push(head);mark(head,1);occupied.add(location(head.x,head.y));
  }
  const initialCount=heads.length;
  const options=table.filter(r=>r.bar===(r.model==='4A'||r.model==='6A'?2.1:operatingBar) && r.arc%45===0);
  const rays=32, rings=12;
  const stencils=new Map();
  // Equal-area polar bins allow headings to be scored without rasterising every candidate.
  for(const r of options){
    if(stencils.has(r.radius))continue;
    const offsets=[];
    for(let ray=0;ray<rays;ray++){
      const angle=(ray+.5)*2*Math.PI/rays;
      for(let k=0;k<rings;k++){
        const d=r.radius*Math.sqrt((k+.5)/rings);
        offsets.push([Math.round(Math.cos(angle)*d/scaleX),Math.round(Math.sin(angle)*d/scaleY)]);
      }
    }
    stencils.set(r.radius,offsets);
  }
  function candidateAt(x,y,targetX,targetY,best){
    if(occupied.has(location(x,y)))return best;
    const dx=(targetX-x)*scaleX,dy=(targetY-y)*scaleY;
    const distance=Math.hypot(dx,dy);
    const direction=(Math.atan2(dy,dx)*180/Math.PI+360)%360;
    const histograms=new Map();
    for(const [radius,offsets] of stencils){
      if(radius<distance)continue;
      const gain=new Float64Array(2*rays+1),spill=new Float64Array(2*rays+1);
      const cellArea=Math.PI*radius**2/(rays*rings);
      for(let ray=0;ray<rays;ray++){
        let added=0,off=0;
        for(let k=0;k<rings;k++){
          const [dx,dy]=offsets[ray*rings+k],sx=x+dx,sy=y+dy,j=sy*map.width+sx;
          if(sx<0||sy<0||sx>=map.width||sy>=map.height){off++;continue;}
          if(turf[j]){if(!wet[j])added++;}
          else {
            const kind=map.regions[map.ids[j]]?.kind;
            const weight=kind===4 || kind===3 ? 5 : kind===2 ? .65 : 1.5;
            off+=weight*(wet[j] ? .25 : 1);
          }
        }
        gain[ray+1]=gain[ray]+added*cellArea;
        spill[ray+1]=spill[ray]+off*cellArea;
      }
      for(let k=1;k<=rays;k++){
        gain[rays+k]=gain[rays]+gain[k];spill[rays+k]=spill[rays]+spill[k];
      }
      histograms.set(radius,{gain,spill});
    }
    let bestScore=best?.score ?? -Infinity;
    for(const nozzle of options){
      if(nozzle.radius<distance)continue;
      const {gain,spill}=histograms.get(nozzle.radius),bins=nozzle.arc*rays/360;
      const area=Math.PI*nozzle.radius**2*nozzle.arc/360;
      for(let start=0;start<(nozzle.arc===360?1:rays);start++){
        if(distance && (direction-start*360/rays+360)%360>nozzle.arc+1e-9)continue;
        const extra=gain[start+bins]-gain[start], waste=spill[start+bins]-spill[start];
        if(waste>Math.max(1.5,area*.12))continue;
        const score=(extra+.02)/(1+.12*waste+.055*area);
        if(score>bestScore){
          bestScore=score;
          best={...nozzle,x:x+.5,y:y+.5,rPx:nozzle.radius/scaleX,start:start*360/rays,region:map.ids[y*map.width+x],score};
        }
      }
    }
    return best;
  }
  // Fill broad interiors first so a stray boundary pixel cannot dictate the main layout.
  const anchors=[];
  const minStep=Math.ceil(Math.sqrt(turf.length/1000));
  const stepX=Math.max(minStep,Math.round(1.5/scaleX)),stepY=Math.max(minStep,Math.round(1.5/scaleY));
  for(let y=0;y<map.height && options.length;y+=stepY)for(let x=0;x<map.width;x+=stepX){
    if(turf[y*map.width+x]){const head=candidateAt(x,y,x,y,null);if(head)anchors.push(head);}
  }
  anchors.sort((a,b)=>b.score-a.score);
  for(const anchor of anchors){
    if(heads.length>=650)break;
    const x=Math.floor(anchor.x),y=Math.floor(anchor.y);
    const head=candidateAt(x,y,x,y,null);
    if(!head || head.score<1.25)continue;
    add(head);
  }
  const anchorOffsets=[];
  for(const d of [.75,1.65,3.5])for(let a=0;a<8;a++){
    anchorOffsets.push([Math.round(d*Math.cos(a*Math.PI/4)/scaleX),Math.round(d*Math.sin(a*Math.PI/4)/scaleY)]);
  }
  for(let i=0;i<turf.length && heads.length<650 && options.length;i++){
    if(!turf[i] || wet[i])continue;
    const x=i%map.width,y=Math.floor(i/map.width);
    let best=candidateAt(x,y,x,y,null);
    for(const [dx,dy] of anchorOffsets){
      const ax=x+dx,ay=y+dy;
      if(ax>=0 && ay>=0 && ax<map.width && ay<map.height && turf[ay*map.width+ax]){
        best=candidateAt(ax,ay,x,y,best);
      }
    }
    // With only long-range models in a supplied catalogue some cells cannot
    // be reached within the spill budget. Keep the measured shortfall visible.
    if(best)add(best);
  }
  // Tighten a finishing sector around the cells that no other nozzle reaches.
  // Each accepted replacement preserves coverage and cannot increase off-lawn area.
  for(let index=heads.length-1;index>=initialCount;index--){
    const head=heads[index];
    mark(head,-1);
    let reach=0, spill=0, needed=false;
    const bounds=Array.from({length:rays},()=>0);
    visitSector(head,map,scaleX,scaleY,i=>{
      if(wet[i])return;
      if(!turf[i]){spill++;return;}
      needed=true;
      const dx=(i%map.width+.5-head.x)*scaleX,dy=(Math.floor(i/map.width)+.5-head.y)*scaleY;
      const distance=Math.hypot(dx,dy);
      reach=Math.max(reach,distance);
      if(!distance)return;
      const angle=(Math.atan2(dy,dx)*180/Math.PI+360)%360;
      for(let k=0;k<rays;k++){
        let delta=(angle-k*360/rays+360)%360;
        if(delta>360-1e-8)delta=0;
        bounds[k]=Math.max(bounds[k],delta);
      }
    });
    if(!needed){heads.splice(index,1);continue;}
    let best=head;
    let bestArea=head.radius**2*head.arc;
    for(const nozzle of options){
      const area=nozzle.radius**2*nozzle.arc;
      if(nozzle.radius+1e-9<reach || area>=bestArea)continue;
      for(let k=0;k<(nozzle.arc===360?1:rays);k++){
        if(bounds[k]>nozzle.arc+1e-9)continue;
        const trial={...head,...nozzle,start:k*360/rays,rPx:nozzle.radius/scaleX};
        let off=0;
        visitSector(trial,map,scaleX,scaleY,i=>{if(!wet[i] && !turf[i])off++;});
        if(off<=spill && (off<spill || area<bestArea)){best=trial;bestArea=area;spill=off;}
      }
    }
    heads[index]=best;mark(best,1);
  }
  let total=0,hit=0,outside=0;
  for(let i=0;i<turf.length;i++){
    total+=turf[i];
    if(wet[i]){if(turf[i])hit++;else outside++;}
  }
  return {total,hit,coverage:total?Math.floor(1000*hit/total)/10:null,outsideM2:outside*scaleX*scaleY};
}
function proposeHeads(map,table,scaleX,scaleY,flowLimit) {
  const heads=[],warnings=[],zones=[];
  if(!(scaleX>0 && scaleY>0))return {heads,warnings:["Укажите масштаб."],zones};
  const inZone=(x,y,id)=>x>=0&&y>=0&&x<map.width&&y<map.height&&map.ids[Math.floor(y)*map.width+Math.floor(x)]===id;

  for(const reg of map.regions.filter(r=>r.kind===1)){
    const width=(reg.maxX-reg.minX+1)*scaleX,height=(reg.maxY-reg.minY+1)*scaleY;
    const area=reg.count*scaleX*scaleY;
    if(heads.length>=650){warnings.push("Достигнут предел числа сопел в эскизе.");break;}
    const models=table.filter(r=>r.bar===operatingBar && r.arc===180 && r.radius<=Math.min(width,height)*1.25 && Math.PI*r.radius*r.radius/8<=area)
      .sort((a,b)=>b.radius-a.radius);
    if(!models.length)continue;
    let rgHeads=[];
    for(const model of models){
      // Irregular lawns can miss every intersection of the perimeter grid.
      // Try the cell centres, then a shorter catalogue radius with the same fit checks.
      const columns=Math.ceil(width/model.radius), rows=Math.ceil(height/model.radius);
      if((columns+1)*(rows+1)>650){warnings.push("Крупная область требует отдельного расчёта.");break;}
      for(const offset of [0,.5]){
        rgHeads=placeGrid(model,columns,rows,offset);
        if(rgHeads.length)break;
      }
      if(rgHeads.length)break;
    }
    const remaining=650-heads.length;
    heads.push(...rgHeads.slice(0,remaining));
    if(rgHeads.length>remaining){warnings.push("Достигнут предел числа сопел в эскизе.");break;}
    function placeGrid(base,columns,rows,offset){
      const candidates=table.filter(r=>r.bar===operatingBar && r.model===base.model && [90,180,270,360].includes(r.arc));
      const rgHeads=[];
      for(let row=0;row+offset<=rows;row++)for(let col=0;col+offset<=columns;col++){
        const gx=reg.minX+.5+(col+offset)*(reg.maxX-reg.minX)/columns,gy=reg.minY+.5+(row+offset)*(reg.maxY-reg.minY)/rows;
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
      return rgHeads;
    }
  }
  const coverage=completeCoverage(map,table,scaleX,scaleY,heads);
  if(coverage.hit<coverage.total)warnings.push("Часть газона осталась без покрытия. Проверьте границы областей. Для оставшихся ячеек не удалось подобрать сектор в пределах ограничений эскиза.");
  if(flowLimit>0){
    // Preserve spatial order. A zone never exceeds the entered working capacity.
    let zone=null;
    for(const h of [...heads].sort((a,b)=>zoneFamily(a).localeCompare(zoneFamily(b)))){
      if(h.flow>flowLimit){h.zone=null;continue;}
      if(!zone || zone.family!==zoneFamily(h) || (zone.flow+h.flow)>flowLimit+1e-8){
        zone={id:zones.length+1,flow:0,n:0,family:zoneFamily(h)};zones.push(zone);
      }
      h.zone=zone.id;zone.n++;zone.flow=Math.round((zone.flow+h.flow)*100)/100;
    }
    if(heads.some(h=>!h.zone))warnings.push("Есть сопла, расход которых превышает доступную подачу.");
  }
  return {heads,zones,warnings,...coverage};
}
function zoneFamily(h){
  return h.model==="MP-800SR" || h.bar===2.1 ? h.model : "MP";
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
  const visible=state.design.heads.filter(h=>!state.activeZone || state.activeZone===h.zone);
  for(const h of visible){
    const color=planColors[((h.zone||1)-1)%planColors.length];
    const start=h.start*Math.PI/180;
    ctx.fillStyle=color+"33";ctx.strokeStyle=color;ctx.lineWidth=.7;
    ctx.beginPath();ctx.moveTo(h.x,h.y);ctx.ellipse(h.x,h.y,h.rPx,h.radius/(state.scale*canvas.height/m.height),0,start,start+h.arc*Math.PI/180);ctx.closePath();ctx.fill();ctx.stroke();
  }
  // Draw markers last so overlapping sectors cannot cover a sprinkler.
  const unit=m.width/(canvas.clientWidth || canvas.width);
  for(const h of visible){
    ctx.beginPath();ctx.arc(h.x,h.y,4*unit,0,2*Math.PI);
    ctx.fillStyle="#104571";ctx.fill();ctx.strokeStyle="#fff";ctx.lineWidth=1.7*unit;ctx.stroke();
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
  const note=document.createElement("p");note.className="note";note.textContent="Рабочее давление на сопле: 2,8 бар для MP Rotator и 2,1 бар для коротких форсунок 4A и 6A. Стандартные MP, MP-800SR, 4A и 6A группируются по зонам отдельно.";d.append(note);
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
  if(n){const p=document.createElement("p");p.className="note";p.textContent="Геометрическая площадь за газоном внутри изображения: "+Math.round(result.outsideM2)+" м². Покрытие показывает, какая доля распознанного газона попала хотя бы под один сектор. Равномерность полива требует отдельной проверки.";d.append(p);}
  paint();
}
