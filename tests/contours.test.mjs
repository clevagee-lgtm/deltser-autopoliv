import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync("src/contours.js","utf8"),ctx);
test("exclusions split a hand-drawn lawn without mutating the previous map",()=>{
  const empty={width:10,height:8,ids:new Int32Array(80).fill(-1),regions:[]};
  const rect=(x,y,w,h)=>ctx.polygonMask([[x,y],[x+w,y],[x+w,y+h],[x,y+h]],10,8);
  const lawn=ctx.editRegionMap(empty,rect(1,1,8,6),1);
  const cut=ctx.editRegionMap(lawn,rect(4,0,2,8),4);
  assert.deepEqual(Array.from(cut.regions.filter(r=>r.kind===1),r=>r.count),[18,18]);
  const drip=ctx.editRegionMap(cut,rect(1,1,3,6),5);
  assert.equal(drip.regions[drip.ids[22]].kind,5);
  assert.equal(lawn.regions[0].count,48);
});
test("bounded pick preserves holes and refuses escaping selections",()=>{
  const w=15,p=new Uint8Array(w*w*4).fill(255);
  for(let y=2;y<=12;y++)for(let x=2;x<=12;x++)
    if(x===2||y===2||x===12||y===12||(x===7&&y===7))p.fill(0,4*(y*w+x),4*(y*w+x)+3);
  const m=ctx.enclosedMask(p,w,w,4,4);assert.equal(m.reduce((a,b)=>a+b),80);assert.equal(m[7*w+7],0);
  assert.equal(ctx.enclosedMask(p,w,w,0,0),null);
});
