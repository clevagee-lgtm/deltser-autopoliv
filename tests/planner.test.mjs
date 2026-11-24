import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const c=vm.createContext({});
for(const f of ['catalog','planner'])vm.runInContext(fs.readFileSync('src/'+f+'.js','utf8'),c);
const table=c.readCatalog(fs.readFileSync('data/mp-rotator.csv','utf8'));
function map(kind=1){return {width:80,height:60,ids:new Int32Array(4800),regions:[{id:0,kind,count:4800,minX:0,maxX:79,minY:0,maxY:59}]};}
test('geometric draft respects supply and nozzle table',()=>{
 const d=c.proposeHeads(map(),table,.22,.22,8);
 assert.ok(d.heads.length>2 && d.zones.length>1);
 assert.ok(d.zones.every(z=>z.flow<=8));
 assert.ok(d.coverage>75);
 assert.ok(d.heads.every(h=>table.some(r=>r.model===h.model&&r.arc===h.arc&&r.flow===h.flow&&r.radius===h.radius&&r.bar===h.bar)));
});
test('water and missing scale do not produce heads',()=>{
 assert.equal(c.proposeHeads(map(3),table,.22,.22,8).heads.length,0);
 assert.equal(c.proposeHeads(map(),table,0,0,8).heads.length,0);
});
test('unknown and inadequate supply never become valid zones',()=>{
 for(const flow of [null,.1])assert.equal(c.proposeHeads(map(),table,.22,.22,flow).zones.length,0);
});
test('places catalogue nozzles inside a diagonal oval lawn',()=>{
  const width=40, ids=new Int32Array(width*width).fill(-1);
  const region={id:0,kind:1,count:0,minX:width,minY:width,maxX:0,maxY:0};
  for(let y=0;y<width;y++)for(let x=0;x<width;x++){
    const major=(x+y-40)/(Math.SQRT2*16),minor=(x-y)/(Math.SQRT2*8);
    if(major**2+minor**2>1)continue;
    ids[y*width+x]=0;region.count++;
    region.minX=Math.min(region.minX,x);region.maxX=Math.max(region.maxX,x);
    region.minY=Math.min(region.minY,y);region.maxY=Math.max(region.maxY,y);
  }
  const draft=c.proposeHeads({width,height:width,ids,regions:[region]},table,.24,.24,null);
  assert.ok(draft.heads.length>0 && draft.coverage>0);
  assert.ok(draft.heads.every(h=>ids[Math.floor(h.y)*width+Math.floor(h.x)]===0));
});
test('all isolated and narrow patches are reached by real sectors',()=>{
  const width=74,height=42,ids=new Int32Array(width*height).fill(-1),regions=[];
  function patch(left,top,right,bottom){
    const id=regions.length,count=(right-left+1)*(bottom-top+1);
    regions.push({id,kind:1,minX:left,minY:top,maxX:right,maxY:bottom,count});
    for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)ids[y*width+x]=id;
  }
  patch(4,4,16,7);patch(38,12,38,12);patch(46,20,65,33);
  const sx=.23,sy=.19;
  const draft=c.proposeHeads({width,height,ids,regions},table,sx,sy,8);
  let hit=0,spill=0;
  for(let i=0;i<ids.length;i++){
    const covered=draft.heads.some(h=>{
      const dx=(i%width+.5-h.x)*sx,dy=(Math.floor(i/width)+.5-h.y)*sy;
      const angle=(Math.atan2(dy,dx)*180/Math.PI-h.start+720)%360;
      return Math.hypot(dx,dy)<=h.radius+1e-9 && ((!dx&&!dy)||angle<h.arc+1e-8||angle>360-1e-8);
    });
    if(covered){if(ids[i]>=0)hit++;else spill++;}
  }
  assert.equal(hit,ids.filter(id=>id>=0).length);
  assert.equal(draft.coverage,100);assert.equal(draft.hit,hit);
  assert.ok(Math.abs(draft.outsideM2-spill*sx*sy)<1e-6);
  assert.ok(draft.heads.every(h=>ids[Math.floor(h.y)*width+Math.floor(h.x)]>=0));
  for(const zone of draft.zones){
    const families=new Set(draft.heads.filter(h=>h.zone===zone.id).map(c.zoneFamily));
    assert.equal(families.size,1);assert.ok(zone.flow<=8);
  }
});
test('coverage reflects unserved cells if the design reaches its capacity',()=>{
  const width=651,height=1,ids=new Int32Array(width);
  const regions=[{id:0,kind:1,count:width,minX:0,maxX:width-1,minY:0,maxY:0}];
  const d=c.proposeHeads({width,height,ids,regions},table,20,20);
  assert.ok(d.hit<d.total && d.coverage<100 && d.warnings.length);
});
test('path permission changes the layout while protecting buildings and water',()=>{
  const width=64,height=36;
  const ids=new Int32Array(width*height).fill(-1),regions=[];
  function rect(kind,l,t,r,b){
    const id=regions.length;
    regions.push({id,kind,minX:l,minY:t,maxX:r,maxY:b,count:(r-l+1)*(b-t+1)});
    for(let y=t;y<=b;y++)ids.fill(id,y*width+l,y*width+r+1);
  }
  rect(1,4,5,28,30);rect(6,29,5,32,30);rect(1,33,5,57,30);
  rect(4,58,5,60,30);rect(3,4,31,57,32);
  const plan={width,height,ids,regions},sx=.21,sy=.19;
  const strict=c.proposeHeads(plan,table,sx,sy,10),allowed=c.proposeHeads(plan,table,sx,sy,10,true);
  for(const result of [strict,allowed]){
    let path=0,hit=0;
    assert.ok(result.heads.length);
    for(const h of result.heads)assert.equal(regions[ids[Math.floor(h.y)*width+Math.floor(h.x)]].kind,1);
    for(let i=0;i<ids.length;i++){
      const kind=regions[ids[i]]?.kind;
      const wet=result.heads.some(h=>{
        const dx=(i%width+.5-h.x)*sx,dy=(Math.floor(i/width)+.5-h.y)*sy;
        const angle=(Math.atan2(dy,dx)*180/Math.PI-h.start+720)%360;
        return Math.hypot(dx,dy)<=h.radius+1e-9 && ((!dx&&!dy)||angle<h.arc+1e-8||angle>360-1e-8);
      });
      if(wet){
        assert.ok(kind!==3 && kind!==4);
        if(kind===6)path++;
        if(kind===1)hit++;
      }
    }
    assert.equal(result.hit,hit);
    assert.equal(result.total,2*25*26);
    assert.equal(result.pathM2,path*sx*sy);
  }
  assert.equal(strict.pathM2,0);
  assert.ok(allowed.pathM2>0);
  assert.equal(allowed.coverage,100);
  assert.notDeepEqual(strict.heads,allowed.heads);
});
