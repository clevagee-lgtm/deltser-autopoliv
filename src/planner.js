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
      if(head.arc===360 || (head.arc<=180 ? after && before : after || before)){
        if(visit(y*map.width+x)===false)return false;
      }
    }
  }
  return true;
}
function isTurf(kind){
  return kind===1 || kind===7;
}
function reachesHead(source,target,scaleX,scaleY){
  const dx=(target.x-source.x)*scaleX,dy=(target.y-source.y)*scaleY;
  const distance=Math.hypot(dx,dy);
  if(distance<1e-9 || distance>source.radius+1e-9)return false;
  if(source.arc===360)return true;
  const angle=(Math.atan2(dy,dx)*180/Math.PI-source.start+720)%360;
  return angle<=source.arc+1e-8 || angle>=360-1e-8;
}
function spacingException(head,map){
  if(map.regions[head.region]?.kind===7)return "Узкая полоса";
  if(head.arc>=30 && head.arc<=60)return "Угловой сектор 30–60°";
  return null;
}
function checkHeadSpacing(heads,map,scaleX,scaleY){
  let reached=0,exempt=0,missing=0;
  const checks=heads.map(target=>{
    // Keep a witness from a different location for the drawing and the CSV.
    const source=heads.findIndex(h=>reachesHead(h,target,scaleX,scaleY));
    const exception=source<0 ? spacingException(target,map) : null;
    if(source>=0)reached++;
    else if(exception)exempt++;
    else missing++;
    return {source,exception};
  });
  return {checks,reached,exempt,missing};
}
// Summed-area mask for protected cell centres. Subdivide only rectangles
// which contain protected cells and which the sector may intersect.
function sprayPermission(map,scaleX,scaleY,allowPaths){
  const blocked=map.regions.map(r=>r.kind===3 || r.kind===4 || (r.kind===6 && !allowPaths));
  if(!blocked.some(Boolean))return ()=>true;
  const stride=map.width+1, prefix=new Uint32Array(stride*(map.height+1));
  for(let y=0;y<map.height;y++){
    let count=0;
    for(let x=0;x<map.width;x++){
      if(blocked[map.ids[y*map.width+x]])count++;
      prefix[(y+1)*stride+x+1]=prefix[y*stride+x+1]+count;
    }
  }
  return function permitted(h){
    const rx=h.radius/scaleX,ry=h.radius/scaleY;
    const left=Math.max(0,Math.ceil(h.x-rx-.5)),right=Math.min(map.width-1,Math.floor(h.x+rx-.5));
    const top=Math.max(0,Math.ceil(h.y-ry-.5)),bottom=Math.min(map.height-1,Math.floor(h.y+ry-.5));
    const a=h.start*Math.PI/180,b=(h.start+h.arc)*Math.PI/180;
    const ax=Math.cos(a),ay=Math.sin(a),bx=Math.cos(b),by=Math.sin(b);
    function touches(x0,y0,x1,y1){
      if(x0>x1 || y0>y1 || prefix[(y1+1)*stride+x1+1]-prefix[y0*stride+x1+1]
        -prefix[(y1+1)*stride+x0]+prefix[y0*stride+x0]===0)return false;
      const l=(x0+.5-h.x)*scaleX,r=(x1+.5-h.x)*scaleX;
      const t=(y0+.5-h.y)*scaleY,d=(y1+.5-h.y)*scaleY;
      if(Math.max(l,-r,0)**2+Math.max(t,-d,0)**2>h.radius**2+1e-9)return false;
      if(h.arc!==360){
        const after=Math.max(ax*t,ax*d)-Math.min(ay*l,ay*r)>=-1e-9;
        const before=Math.max(by*l,by*r)-Math.min(bx*t,bx*d)>=-1e-9;
        if(h.arc<=180 ? !(after && before) : !(after || before))return false;
      }
      if(x0===x1 && y0===y1)return true;
      if(x1-x0>y1-y0){
        const mid=(x0+x1)>>1;
        return touches(x0,y0,mid,y1) || touches(mid+1,y0,x1,y1);
      }
      const mid=(y0+y1)>>1;
      return touches(x0,y0,x1,mid) || touches(x0,mid+1,x1,y1);
    }
    return !touches(left,top,right,bottom);
  };
}
// Optimise incoming coverage against the same cell mask used for the area report.
function improveSpacing(map,options,heads,scaleX,scaleY,turf,wet,allowPaths,permitted){
  const incoming=new Uint16Array(650);
  const reaches=(a,b)=>reachesHead(a,b,scaleX,scaleY);
  const walk=(h,fn)=>visitSector(h,map,scaleX,scaleY,fn);
  function updateLinks(source,delta){
    for(let j=0;j<heads.length;j++)if(heads[j] && reaches(source,heads[j]))incoming[j]+=delta;
  }
  for(const h of heads)updateLinks(h,1);
  const optional=h=>Boolean(spacingException(h,map));

  // A redundant nozzle may still be the sole source of water for a neighbour.
  function prune(){
    for(let i=heads.length-1;i>=0;i--){
      const h=heads[i];
      if(!h)continue;
      if(heads.some((target,j)=>target && !optional(target) && incoming[j]===1 && reaches(h,target)))continue;
      if(!walk(h,k=>!(turf[k] && wet[k]===1)))continue;
      walk(h,k=>{wet[k]--;});updateLinks(h,-1);heads[i]=null;
    }
  }
  prune();
  const nozzles=[...options].sort((a,b)=>a.radius**2*a.arc-b.radius**2*b.arc || a.flow-b.flow);
  const maxRadius=Math.max(0,...nozzles.map(n=>n.radius));
  const distance=(a,b)=>Math.hypot((a.x-b.x)*scaleX,(a.y-b.y)*scaleY);
  const existingAt=h=>heads.some(other=>other && reaches(other,h));
  const allowedCell=k=>turf[k] || (allowPaths && map.regions[map.ids[k]]?.kind===6);
  // Keep the union of off-lawn spray from growing during spacing repairs.
  const fits=h=>permitted(h) && walk(h,k=>Boolean(wet[k] || allowedCell(k)));
  function covering(origin,target,accept){
    const d=distance(origin,target);
    for(const nozzle of nozzles){
      if(d<1e-9 || d>nozzle.radius+1e-9)continue;
      for(let step=0;step<(nozzle.arc===360?1:32);step++){
        const trial={...origin,...nozzle,start:step*360/32,rPx:nozzle.radius/scaleX};
        if(reaches(trial,target) && accept(trial) && fits(trial))return trial;
      }
    }
    return null;
  }
  function adjust(source,index,target){
    const required=heads.filter((h,j)=>h && !optional(h) && incoming[j]===1 && reaches(source,h));
    const requiredCells=[];
    walk(source,k=>{if(turf[k] && wet[k]===1)requiredCells.push({x:k%map.width+.5,y:Math.floor(k/map.width)+.5});});
    // The centre cell belongs to every sector, but never counts as another head.
    const trial=covering(source,target,h=>{
      if(!incoming[index] && optional(source) && !optional(h))return false;
      return required.every(other=>reaches(h,other)) &&
        requiredCells.every(p=>(p.x===h.x && p.y===h.y) || reaches(h,p));
    });
    if(!trial)return false;
    updateLinks(source,-1);walk(source,k=>{wet[k]--;});
    heads[index]=trial;updateLinks(trial,1);walk(trial,k=>{wet[k]++;});
    return true;
  }
  const missing=i=>heads[i] && !incoming[i] && !optional(heads[i]);
  const near=(target)=>heads.map((h,i)=>h?{h,i,d:distance(h,target)}:null)
    .filter(p=>p && p.d>1e-9 && p.d<=maxRadius+1e-9).sort((a,b)=>a.d-b.d);
  // Reuse installed positions before considering another head.
  for(let i=0;i<heads.length;i++){
    if(!missing(i))continue;
    const target=heads[i];
    for(const p of near(target).slice(0,12))if(adjust(p.h,p.i,target))break;
  }
  // Seek a supported position on grass. Prefer spacing near a catalogue radius.
  for(let i=0;i<heads.length;i++){
    if(!missing(i))continue;
    const target=heads[i],seen=new Set();
    let added=null;
    for(const radius of [...new Set(nozzles.map(n=>n.radius))].sort((a,b)=>a-b)){
      for(const fraction of [.9,.65]){
        for(const [vx,vy] of directionVectors){
          const x=Math.floor(target.x+vx*radius*fraction/scaleX),y=Math.floor(target.y+vy*radius*fraction/scaleY);
          if(x<0 || x>=map.width || y<0 || y>=map.height)continue;
          const k=y*map.width+x;
          if(!turf[k] || seen.has(k))continue;
          seen.add(k);
          const pos={x:x+.5,y:y+.5,region:map.ids[k]};
          if(!existingAt(pos) || heads.some(h=>h && distance(h,pos)<nozzles[0].radius*.5))continue;
          added=covering(pos,target,()=>true);
          if(added)break;
        }
        if(added)break;
      }
      if(added)break;
    }
    if(!added)continue;
    let index=heads.indexOf(null);
    if(index<0){if(heads.length>=650)break;index=heads.length;}
    heads[index]=added;
    incoming[index]=heads.reduce((n,h)=>n+Number(Boolean(h && reaches(h,added))),0);
    updateLinks(added,1);walk(added,k=>{wet[k]++;});
  }
  prune();
  for(let i=heads.length-1;i>=0;i--)if(!heads[i])heads.splice(i,1);
}

function completeCoverage(map,table,scaleX,scaleY,heads,allowPaths,permitted){
  const turf=Uint8Array.from(map.ids,id=>Number(isTurf(map.regions[id]?.kind)));
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
            const weight=kind===6 && allowPaths ? 0 : kind===4 || kind===3 ? 5 : kind===2 ? .65 : 1.5;
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
          const trial={...nozzle,x:x+.5,y:y+.5,rPx:nozzle.radius/scaleX,start:start*360/rays,region:map.ids[y*map.width+x],score};
          if(permitted(trial)){best=trial;bestScore=score;}
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
  const anchorOffsets=[],usedOffsets=new Set(["0,0"]);
  for(const d of [.75,1.15,1.65,2.9,3.9,5.5])for(let a=0;a<32;a++){
    const offset=[Math.round(d*Math.cos(a*Math.PI/16)/scaleX),Math.round(d*Math.sin(a*Math.PI/16)/scaleY)];
    const key=offset.join(",");
    if(!usedOffsets.has(key)){usedOffsets.add(key);anchorOffsets.push(offset);}
  }
  // Give boundary cells beside hard exclusions first choice of a legal sector.
  const boundary=[],interior=[];
  const blocked=k=>{
    const kind=map.regions[map.ids[k]]?.kind;
    return kind===3 || kind===4 || (kind===6 && !allowPaths);
  };
  for(let i=0;i<turf.length;i++){
    if(!turf[i] || wet[i])continue;
    const x=i%map.width;
    const edge=(x>0 && blocked(i-1)) || (x+1<map.width && blocked(i+1))
      || blocked(i-map.width) || blocked(i+map.width);
    (edge?boundary:interior).push(i);
  }
  for(const i of boundary.concat(interior)){
    if(heads.length>=650 || !options.length)break;
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
  // Each replacement must still reach every cell and dependent head unique to it.
  function tighten(first,preserveLinks){
    const incoming=new Map();
    if(preserveLinks){
      for(const target of heads){
        incoming.set(target,heads.reduce((n,h)=>n+Number(reachesHead(h,target,scaleX,scaleY)),0));
      }
    }
    for(let index=heads.length-1;index>=first;index--){
      const head=heads[index], bounds=new Float64Array(rays);
      let reach=0, spill=0, needed=false;
      function requirePoint(x,y){
        needed=true;
        const dx=(x-head.x)*scaleX,dy=(y-head.y)*scaleY;
        const distance=Math.hypot(dx,dy);
        reach=Math.max(reach,distance);
        if(!distance)return;
        const angle=(Math.atan2(dy,dx)*180/Math.PI+360)%360;
        for(let k=0;k<rays;k++){
          let delta=(angle-k*360/rays+360)%360;
          if(delta>360-1e-8)delta=0;
          bounds[k]=Math.max(bounds[k],delta);
        }
      }
      mark(head,-1);
      visitSector(head,map,scaleX,scaleY,i=>{
        if(wet[i])return;
        if(turf[i])requirePoint(i%map.width+.5,Math.floor(i/map.width)+.5);
        else spill++;
      });
      if(preserveLinks){
        for(const target of heads){
          if(!reachesHead(head,target,scaleX,scaleY))continue;
          if(incoming.get(target)===1)requirePoint(target.x,target.y);
          incoming.set(target,incoming.get(target)-1);
        }
      }
      if(!needed){heads.splice(index,1);continue;}
      let best=head,bestArea=head.radius**2*head.arc;
      const originalArea=bestArea;
      for(const nozzle of options){
        const area=nozzle.radius**2*nozzle.arc;
        if(nozzle.radius+1e-9<reach || area>(preserveLinks?originalArea:bestArea))continue;
        if(preserveLinks && !incoming.get(head) && spacingException(head,map)
          && !spacingException({...head,...nozzle},map))continue;
        for(let k=0;k<(nozzle.arc===360?1:rays);k++){
          if(bounds[k]>nozzle.arc+1e-9)continue;
          if(!spill && area>=bestArea)continue;
          const trial={...head,...nozzle,start:k*360/rays,rPx:nozzle.radius/scaleX};
          if(!permitted(trial))continue;
          let off=0;
          visitSector(trial,map,scaleX,scaleY,i=>{
            if(!wet[i] && !turf[i])off++;
            return off<=spill;
          });
          if(off<spill || (off===spill && area<bestArea)){
            best=trial;bestArea=area;spill=off;
          }
        }
      }
      if(preserveLinks){
        incoming.set(best,incoming.get(head));
        for(const target of heads){
          if(reachesHead(best,target,scaleX,scaleY))incoming.set(target,incoming.get(target)+1);
        }
      }
      heads[index]=best;mark(best,1);
    }
  }
  tighten(initialCount,false);
  improveSpacing(map,options,heads,scaleX,scaleY,turf,wet,allowPaths,permitted);
  tighten(0,true);
  let total=0,hit=0,outside=0,pathCells=0;
  const dryCells=[];
  for(let i=0;i<turf.length;i++){
    total+=turf[i];
    if(turf[i] && !wet[i])dryCells.push(i);
    if(wet[i]){if(turf[i])hit++;else {outside++;if(map.regions[map.ids[i]]?.kind===6)pathCells++;}}
  }
  return {total,hit,dryCells,dryM2:dryCells.length*scaleX*scaleY,coverage:total?Math.floor(1000*hit/total)/10:null,pathM2:pathCells*scaleX*scaleY,outsideM2:outside*scaleX*scaleY};
}
function proposeHeads(map,table,scaleX,scaleY,flowLimit,allowPaths=false,minInside=.88) {
  const heads=[],warnings=[],zones=[];
  if(!(scaleX>0 && scaleY>0))return {heads,warnings:["Укажите масштаб."],zones};
  const inZone=(x,y,id)=>x>=0&&y>=0&&x<map.width&&y<map.height&&map.ids[Math.floor(y)*map.width+Math.floor(x)]===id;

  allowPaths=allowPaths && map.regions.some(r=>r.kind===6);
  const permitted=sprayPermission(map,scaleX,scaleY,allowPaths);
  for(const reg of map.regions.filter(r=>isTurf(r.kind))){
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
            return [.2,.5,.8,1].reduce((sum,distance)=>{
              const px=x+Math.cos(a)*nozzle.radius*distance/scaleX;
              const py=y+Math.sin(a)*nozzle.radius*distance/scaleY;
              if(inZone(px,py,reg.id))return sum+1;
              if(!allowPaths || px<0 || py<0 || px>=map.width || py>=map.height)return sum;
              const kind=map.regions[map.ids[Math.floor(py)*map.width+Math.floor(px)]]?.kind;
              return sum+Number(isTurf(kind) || kind===6);
            },0)/4;
          });
          for(let offset=0;offset<(nozzle.arc===360?1:32);offset++){
            const n=nozzle.arc/360*32;
            let inside=0;
            for(let j=0;j<n;j++)inside+=rays[(offset+j)%32];
            if(inside/n<minInside)continue;
            const score=inside-4*(n-inside);
            if(!best||score>best.score){
              const trial={...nozzle,x,y,rPx:nozzle.radius/scaleX,start:offset*360/32,score,region:reg.id};
              if(permitted(trial))best=trial;
            }
          }
        }
        if(best)rgHeads.push(best);
      }
      return rgHeads;
    }
  }
  const coverage=completeCoverage(map,table,scaleX,scaleY,heads,allowPaths,permitted);
  if(coverage.hit<coverage.total)warnings.push("Часть газона осталась без покрытия. Проверьте границы областей. Для оставшихся ячеек не удалось подобрать сектор в пределах ограничений эскиза.");
  const spacing=checkHeadSpacing(heads,map,scaleX,scaleY);
  const result={heads,zones,warnings,spacing,...coverage};
  groupZones(result,flowLimit);
  return result;
}
const supplyWarning="Есть сопла, расход которых превышает доступную подачу.";
function groupZones(result,flowLimit){
  const {heads}=result;
  const zones=result.zones=[];
  const warnings=result.warnings=result.warnings.filter(text=>text!==supplyWarning);
  for(const h of heads)h.zone=null;
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
    if(heads.some(h=>!h.zone))warnings.push(supplyWarning);
  }
}
function zoneFamily(h){
  return h.model==="MP-800SR" || h.bar===2.1 ? h.model : "MP";
}
const planColors=["#127f98","#8050a5","#ad681f","#228152","#a14258","#426ab2"];
let playback=null;
function stopPlayback(){clearInterval(playback);playback=null;}
function calculateLayout(minInside){
  const m=state.map;
  return proposeHeads(m,catalog,state.scale*canvas.width/m.width,state.scale*canvas.height/m.height,
    state.flow,$("waterPaths").checked,minInside);
}
function generate(){
  clearDesign();
  if(state.scale)state.design=calculateLayout(.88);
}
function comparableLayouts(base,candidates){
  const viable=[base,...candidates.filter(d=>d.hit>=base.hit && d.spacing.missing<=base.spacing.missing
    && d.pathM2<=base.pathM2+1e-8)];
  const dominates=(a,b)=>a.heads.length<=b.heads.length && a.outsideM2<=b.outsideM2+1e-8 &&
    a.hit>=b.hit && a.spacing.missing<=b.spacing.missing;
  return viable.filter((d,i)=>!viable.some((other,j)=>i!==j && dominates(other,d)
    && (!dominates(d,other) || j<i))).sort((a,b)=>a.heads.length-b.heads.length || a.outsideM2-b.outsideM2);
}
function layoutChoices(panel){
  if(state.variants){
    if(state.variants.length===1){
      const note=document.createElement("p");note.className="note";
      note.textContent="Сравнение завершено. Выбран лучший из рассчитанных вариантов по покрытию, доливу, числу сопел и выходу за газон.";panel.append(note);
      return;
    }
    const label=document.createElement("label");label.textContent="Сопла и площадь полива за газоном";
    const select=document.createElement("select");
    for(const [i,result] of state.variants.entries()){
      const area=result.outsideM2.toLocaleString("ru",{maximumFractionDigits:1});
      select.add(new Option(result.heads.length+" сопел · "+area+" м² за газоном",String(i)));
    }
    select.selectedIndex=state.variants.indexOf(state.design);
    select.onchange=()=>{
      stopPlayback();state.activeZone=null;state.layer=true;
      state.design=state.variants[select.selectedIndex];designControls();
    };
    label.append(select);panel.append(label);
    return;
  }
  const compare=document.createElement("button");compare.type="button";
  compare.textContent="Сравнить варианты расстановки";
  compare.onclick=async()=>{
    const base=state.design;
    compare.disabled=true;compare.textContent="Сравниваем…";
    const alternatives=[];
    for(const fit of [.94,.98]){
      await new Promise(resolve=>setTimeout(resolve,30));
      if(state.design!==base || !compare.isConnected)return;
      alternatives.push(calculateLayout(fit));
    }
    state.variants=comparableLayouts(base,alternatives);
    state.design=state.variants.includes(base)?base:state.variants[0];
    stopPlayback();state.activeZone=null;state.layer=true;designControls();
  };
  panel.append(compare);
}
function paintHeads(){
  drawSectors(ctx,canvas,state.map,state.design,state.scale,state.activeZone);
}
function drawSectors(ctx,canvas,m,design,scale,activeZone){
  ctx.save();ctx.scale(canvas.width/m.width,canvas.height/m.height);
  const visible=design.heads.filter(h=>!activeZone || activeZone===h.zone);
  for(const h of visible){
    const color=planColors[((h.zone||1)-1)%planColors.length];
    const start=h.start*Math.PI/180;
    ctx.fillStyle=color+"33";ctx.strokeStyle=color;ctx.lineWidth=.7;
    ctx.beginPath();ctx.moveTo(h.x,h.y);ctx.ellipse(h.x,h.y,h.rPx,h.radius/(scale*canvas.height/m.height),0,start,start+h.arc*Math.PI/180);ctx.closePath();ctx.fill();ctx.stroke();
  }
  // Draw markers last so overlapping sectors cannot cover a sprinkler.
  const unit=m.width/(canvas.clientWidth || canvas.width);
  ctx.fillStyle="#d72a26bb";
  for(const index of design.dryCells)ctx.fillRect(index%m.width,Math.floor(index/m.width),1,1);
  for(const [index,h] of design.heads.entries()){
    if(activeZone && activeZone!==h.zone)continue;
    const check=design.spacing.checks[index];
    if(check.source<0 && !check.exception){
      ctx.strokeStyle="#bd360d";ctx.lineWidth=2.5*unit;
      ctx.strokeRect(h.x-6*unit,h.y-6*unit,12*unit,12*unit);
    }
    ctx.beginPath();ctx.arc(h.x,h.y,4*unit,0,2*Math.PI);
    ctx.fillStyle="#104571";ctx.fill();ctx.strokeStyle="#fff";ctx.lineWidth=1.7*unit;ctx.stroke();
  }
  ctx.restore();
}
function downloadFile(name,type,text){
 const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement("a");link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
function headCSV(){
 const lines=["Номер;Модель;Сектор, град;Начало по часовой от правой оси, град;Радиус, м;Расход, л/мин;Условная зона;X от левого края, м;Y от верхнего края, м;Номер сопла, доливающего до этого;Исключение или замечание"];
 const m=state.map;
 state.design.heads.forEach((h,i)=>{
   const check=state.design.spacing.checks[i];
   lines.push([i+1,h.model,h.arc,h.start,h.radius,h.flow,h.zone||"",+(h.x*canvas.width/m.width*state.scale).toFixed(2),+(h.y*canvas.height/m.height*state.scale).toFixed(2),check.source<0?"":check.source+1,check.exception||(check.source<0?"Нет долива":"")].join(";"));
 });
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
  if(result.total){
    const audit=document.createElement("p");
    const {reached,exempt,missing}=result.spacing;
    audit.textContent="Соседний дождеватель доливает до "+reached+" из "+n+" сопел.";
    if(exempt)audit.textContent+=" Допустимых исключений без долива — "+exempt+".";
    if(missing)audit.textContent+=" Без долива — "+missing+" (красные квадраты).";
    if(result.dryCells.length)audit.textContent+=" Красным на газоне показана сухая площадь — "+result.dryM2.toLocaleString("ru",{maximumSignificantDigits:3})+" м².";
    d.append(audit);
  }
  if(n){
    layoutChoices(d);
    const label=document.createElement("label");label.textContent="Доступная подача при рабочем давлении, л/мин";
    const flow=document.createElement("input");flow.type="number";flow.step="any";flow.min="0.1";flow.max="1500";flow.value=state.flow||"";flow.placeholder="Если известна";label.append(flow);d.append(label);
    const apply=document.createElement("button");apply.textContent="Пересчитать зоны";apply.onclick=()=>{
      if(flow.value && (!flow.checkValidity() || Number(flow.value)<=0)){tell("Проверьте значение подачи, л/мин.");return;}
      state.flow=flow.value?Number(flow.value):null;
      stopPlayback();state.activeZone=null;
      for(const layout of state.variants || [state.design])groupZones(layout,state.flow);
      designControls();
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
  if(n){const p=document.createElement("p");p.className="note";p.textContent="Геометрическая площадь за газоном внутри изображения: "+result.outsideM2.toLocaleString("ru",{maximumFractionDigits:2})+" м², из них на отмеченных дорожках — "+result.pathM2.toLocaleString("ru",{maximumFractionDigits:2})+" м². Покрытие показывает, какая доля распознанного газона попала хотя бы под один сектор. Равномерность полива требует отдельной проверки.";d.append(p);}
  paint();
}
