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
 assert.ok(d.heads.every(h=>table.some(r=>r.model===h.model&&r.arc===h.arc&&r.flow===h.flow&&r.radius===h.radius&&r.bar===2.8)));
});
test('water and missing scale do not produce heads',()=>{
 assert.equal(c.proposeHeads(map(3),table,.22,.22,8).heads.length,0);
 assert.equal(c.proposeHeads(map(),table,0,0,8).heads.length,0);
});
test('unknown and inadequate supply never become valid zones',()=>{
 for(const flow of [null,.1])assert.equal(c.proposeHeads(map(),table,.22,.22,flow).zones.length,0);
});
