import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const c=vm.createContext({});
vm.runInContext(fs.readFileSync('src/recognition.js','utf8'),c);
function sample(){
 const w=100,h=80,p=new Uint8ClampedArray(w*h*4).fill(255);
 for(let y=5;y<75;y++)for(let x=5;x<95;x++){
  if(x>45 && x<53)continue;
  p.set(x<49?[134,186,106,255]:[145,190,220,255],(y*w+x)*4);
 }
 return c.detectRegions(p,w,h);
}
test('isolated pond and lawn with empty path',()=>{
 const m=sample();assert.deepEqual(Array.from(m.regions,r=>r.kind),[1,3]);
 assert.equal(m.ids[35*m.width+49],-1);
});
test('a local text label can override a colour hypothesis',()=>{
 const m=sample();c.useTextLabels(m,[{text:'Цветник',x:.25,y:.4}]);assert.equal(m.regions[0].kind,2);
});
