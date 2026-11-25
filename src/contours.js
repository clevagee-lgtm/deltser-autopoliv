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

function editRegionMap(map,mask,kind,rectangle=null){
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
    if(r.rectangle && r.count!==end)delete r.rectangle;
    if(rectangle && label===map.regions.length && end===rectangle.cells)r.rectangle=rectangle;
    r.count=end;r.x/=end;r.y/=end;regions.push(r);
  }
  return {width,height,ids,regions};
}

// Fit in image pixels so angles are independent of the raster's cell aspect ratio.
function fitLawnRectangle(points,pixelX,pixelY){
  const p=points.map(([x,y])=>[x*pixelX,y*pixelY]);
  const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  const cell=Math.max(pixelX,pixelY);
  if(p.length>4 && distance(p[0],p.at(-1))<=cell)p.pop();
  // An extra click on a straight edge does not add a corner.
  for(let i=p.length-1;p.length>4 && i>=0;i--){
    const a=p[(i+p.length-1)%p.length],b=p[i],c=p[(i+1)%p.length];
    const dx=c[0]-a[0],dy=c[1]-a[1],t=((b[0]-a[0])*dx+(b[1]-a[1])*dy)/(dx*dx+dy*dy);
    if(t>=0 && t<=1 && distance(b,[a[0]+t*dx,a[1]+t*dy])<=cell)p.splice(i,1);
  }
  if(p.length!==4)return null;
  const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
  if(p.reduce((area,a,i)=>area+cross(a,p[(i+1)%4]),0)<0)p.reverse();
  const sides=p.map((a,i)=>{const b=p[(i+1)%4];return [b[0]-a[0],b[1]-a[1]];});
  const lengths=sides.map(v=>Math.hypot(...v));
  if(Math.min(...lengths)<3*cell)return null;
  const dirs=sides.map(([x,y],i)=>[x/lengths[i],y/lengths[i]]);
  const tolerance=Math.sin(5*Math.PI/180);
  for(let i=0;i<4;i++){
    const a=dirs[i],b=dirs[(i+1)%4];
    if(cross(a,b)<=0 || Math.abs(a[0]*b[0]+a[1]*b[1])>tolerance+1e-9)return null;
  }
  const angle=Math.atan2(dirs[0][1]-dirs[2][1]-dirs[1][0]+dirs[3][0],
                         dirs[0][0]-dirs[2][0]+dirs[1][1]-dirs[3][1]);
  const axis=Math.round(angle/(Math.PI/2))*Math.PI/2;
  const cx=p.reduce((sum,a)=>sum+a[0],0)/4,cy=p.reduce((sum,a)=>sum+a[1],0)/4;
  function fitted(theta){
    const ux=Math.cos(theta),uy=Math.sin(theta);
    const w=(sides[0][0]*ux+sides[0][1]*uy-sides[2][0]*ux-sides[2][1]*uy)/4;
    const h=(-sides[1][0]*uy+sides[1][1]*ux+sides[3][0]*uy-sides[3][1]*ux)/4;
    const corners=[[-w,-h],[w,-h],[w,h],[-w,h]].map(([x,y])=>[cx+x*ux-y*uy,cy+x*uy+y*ux]);
    if(corners.some((a,i)=>distance(a,p[i])>.06*Math.min(...lengths)))return null;
    return corners.map(([x,y])=>[x/pixelX,y/pixelY]);
  }
  return (Math.abs(angle-axis)<=2*Math.PI/180 && fitted(axis)) || fitted(angle);
}
