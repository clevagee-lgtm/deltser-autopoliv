// The label map retains connected regions so that corrections update one area.
const kinds = ["unknown","lawn","planting","water","excluded","drip"];
const names = ["Без разметки","Возможный газон","Посадки","Водоём","Исключено","Капельный полив"];
const palette = ["","#4eae68","#c78c41","#348bc0","#687984","#00a8ad"];

function detectRegions(pixels, width, height) {
  const count = width*height;
  const raw = new Uint8Array(count);
  // Some drawings tint even non-irrigated space. Separate a dominant pastel
  // paper colour from visibly different grass and planting hatch patterns.
  const histogram=new Map();
  for(let p=0;p<pixels.length;p+=4){
    const r=pixels[p],g=pixels[p+1],b=pixels[p+2];
    if(g<220 || r<185 || b<180 || g-r<9 || g-b<9)continue;
    const key=(r>>2)*4096+(g>>2)*64+(b>>2);
    histogram.set(key,(histogram.get(key)||0)+1);
  }
  const common=[...histogram].sort((a,b)=>b[1]-a[1])[0];
  const paper=common && common[1]>count*.055 ? [
    (common[0]>>12)*4+1,(common[0]>>6&63)*4+1,(common[0]&63)*4+1
  ]:null;
  // A pale green swatch on a white, grey-paved sheet can denote lawn.
  // Treat broad or edge-to-edge tints as paper instead.
  let localizedTint=false;
  if(paper){
    let white=0,grey=0,tinted=0,edgeTint=0,edgeCount=0;
    for(let i=0;i<count;i++){
      const r=pixels[4*i],g=pixels[4*i+1],b=pixels[4*i+2];
      if(Math.min(r,g,b)>249)white++;
      if(g>155 && g<242 && Math.max(r,g,b)-Math.min(r,g,b)<5)grey++;
      const similar=Math.max(Math.abs(r-paper[0]),Math.abs(g-paper[1]),Math.abs(b-paper[2]))<=10;
      if(similar)tinted++;
      const x=i%width,y=Math.floor(i/width);
      if(x<width*.06||x>=width*.94||y<height*.06||y>=height*.94){
        edgeCount++;if(similar)edgeTint++;
      }
    }
    localizedTint=white>count*.18 && grey>count*.12 && tinted<count*.38 && edgeTint<edgeCount*.03;
  }
  for (let i=0;i<count;i++) {
    const [r,g,b] = pixels.subarray(i*4,i*4+3);
    if(paper && Math.max(Math.abs(r-paper[0]),Math.abs(g-paper[1]),Math.abs(b-paper[2]))<=6){if(localizedTint)raw[i]=1;continue;}
    if(paper && !localizedTint && g>185 && r-b>6 && g-r<31 && g-b>11){raw[i]=2;continue;}
    if (b-r>15 && b-g>1 && g-r>-5) raw[i]=3;
    else if (g-r>3 && g-b>12) raw[i]=(g<128 || (r/g<0.75 && g<177))?2:1;
    else if (r-b>36 && r-g>8 && g>100 && r-g<62) raw[i]=2;
  }
  const clean=new Uint8Array(count);
  // Voting joins dots in hatch patterns without closing large holes or paths.
  for (let y=1;y<height-1;y++) for (let x=1;x<width-1;x++) {
    const i=y*width+x, votes=[0,0,0,0];
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) votes[raw[i+dy*width+dx]]++;
    const best=votes.indexOf(Math.max(...votes));
    if(votes[best]>=4) clean[i]=best;
  }
  const ids=new Int32Array(count).fill(-1);
  const queue=new Int32Array(count), regions=[];
  const minimum=Math.max(14,Math.round(count*0.00055));
  for (let start=0;start<count;start++) {
    if(!clean[start] || ids[start]!==-1) continue;
    const kind=clean[start];
    let end=1, xSum=0,ySum=0, minX=width,minY=height,maxX=0,maxY=0;
    queue[0]=start; ids[start]=-2;
    for(let pos=0;pos<end;pos++){
      const i=queue[pos],x=i%width,y=Math.floor(i/width);
      xSum+=x;ySum+=y;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      for(const n of [x>0?i-1:-1,x<width-1?i+1:-1,i-width,i+width]){
        if(n>=0 && n<count && ids[n]===-1 && clean[n]===kind){ids[n]=-2;queue[end++]=n;}
      }
    }
    if(end<minimum) continue;
    const id=regions.length;
    for(let j=0;j<end;j++) ids[queue[j]]=id;
    regions.push({id,kind,count:end,x:xSum/end,y:ySum/end,minX,minY,maxX,maxY,evidence:"Цвет и контур"});
  }
  const vegetated=regions.filter(r=>r.kind===1||r.kind===2).reduce((n,r)=>n+r.count,0);
  if(vegetated<count*.055){
    // Small isolated green symbols on a sparse technical plan commonly denote trees.
    for(const r of regions)if(r.kind===1 && r.count<count*.01) {r.kind=2;r.evidence="Отдельный символ растительности";}
  }
  return {width,height,ids,regions};
}

function useTextLabels(map, words) {
  // Only match a nearby region; labels on plain paper do not create fake lawns.
  const labels=[[/газон/i,1],[/цветник|огород|грядк|малина|смородин|кустарник/i,2],[/водо[её]м|пруд/i,3]];
  for(const word of words){
    const hit=labels.find(([rx])=>rx.test(word.text));
    if(!hit) continue;
    const x=Math.round(word.x*map.width),y=Math.round(word.y*map.height);
    const scores=new Map();
    const radius=Math.max(3,Math.round(map.width*0.025));
    for(let j=Math.max(0,y-radius); j<=Math.min(map.height-1,y+radius);j++)
      for(let i=Math.max(0,x-radius);i<=Math.min(map.width-1,x+radius);i++){
        const id=map.ids[j*map.width+i];
        if(id>=0) scores.set(id,(scores.get(id)||0)+1);
      }
    const pick=[...scores].sort((a,b)=>b[1]-a[1])[0];
    if(!pick || pick[1]<(radius*radius)*0.4) continue;
    const region=map.regions[pick[0]];
    region.kind=region.labelKind && region.labelKind!==hit[1]?0:hit[1];
    region.labelKind=region.kind||-1;
    region.evidence=region.kind?'Подпись «'+word.text+'»':'Противоречивые подписи';
  }
}
