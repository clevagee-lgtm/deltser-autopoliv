// Masks share the same grid and cell centres as recognition and sprinkler planning.
function polygonMask(points,width,height){
  const mask=new Uint8Array(width*height);
  if(points.length<3)return mask;
  for(let y=0;y<height;y++){
    const scan=y+.5, crossings=[];
    for(let i=0,j=points.length-1;i<points.length;j=i++){
      const [ax,ay]=points[j],[bx,by]=points[i];
      if((ay>scan)!==(by>scan))crossings.push(ax+(scan-ay)*(bx-ax)/(by-ay));
    }
    crossings.sort((a,b)=>a-b);
    for(let i=0;i+1<crossings.length;i+=2){
      const left=Math.max(0,Math.ceil(crossings[i]-.5));
      const right=Math.min(width,Math.ceil(crossings[i+1]-.5));
      if(left<right)mask.fill(1,y*width+left,y*width+right);
    }
  }
  return mask;
}

function enclosedMask(pixels,width,height,x,y){
  const start=Math.floor(y)*width+Math.floor(x);
  const mask=new Uint8Array(width*height),queue=new Int32Array(mask.length);
  if(x<0 || y<0 || x>=width || y>=height)return null;
  const r=pixels[start*4],g=pixels[start*4+1],b=pixels[start*4+2];
  const matches=i=>Math.max(Math.abs(pixels[4*i]-r),Math.abs(pixels[4*i+1]-g),Math.abs(pixels[4*i+2]-b))<=7;
  let end=1;
  queue[0]=start;mask[start]=1;
  for(let pos=0;pos<end;pos++){
    const i=queue[pos],col=i%width;
    if(col===0||col===width-1||i<width||i>=mask.length-width)return null;
    for(const n of [i-1,i+1,i-width,i+width]){
      if(!mask[n] && matches(n)){mask[n]=1;queue[end++]=n;}
    }
  }
  return end>=4 && end<=mask.length*.6 ? mask : null;
}

function editRegionMap(map,mask,kind){
  const {width,height}=map;
  const labels=Int32Array.from(map.ids,(id,i)=>mask[i]?map.regions.length:id);
  const ids=new Int32Array(labels.length).fill(-1),queue=new Int32Array(ids.length),regions=[];
  for(let start=0;start<labels.length;start++){
    const label=labels[start];
    if(label<0 || ids[start]>=0)continue;
    const r={...(map.regions[label]||{kind,evidence:"Контур указан вручную"}),id:regions.length,count:0,minX:width,minY:height,maxX:0,maxY:0,x:0,y:0};
    let end=1;queue[0]=start;ids[start]=r.id;
    for(let pos=0;pos<end;pos++){
      const i=queue[pos],x=i%width,y=Math.floor(i/width);
      r.x+=x;r.y+=y;r.minX=Math.min(r.minX,x);r.maxX=Math.max(r.maxX,x);
      r.minY=Math.min(r.minY,y);r.maxY=Math.max(r.maxY,y);
      for(const n of [x?i-1:-1,x<width-1?i+1:-1,i-width,i+width]){
        if(n>=0&&n<labels.length&&labels[n]===label&&ids[n]<0){queue[end++]=n;ids[n]=r.id;}
      }
    }
    r.count=end;r.x/=end;r.y/=end;regions.push(r);
  }
  return {width,height,ids,regions};
}
