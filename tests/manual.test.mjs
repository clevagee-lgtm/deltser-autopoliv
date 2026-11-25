import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

for (const width of [1280,390]) {
  test('two independent outlines and editable vertices at display width '+width, () => {
    const elements=new Map();
    function element(id){
      if(!elements.has(id))elements.set(id,{value:'0',replaceChildren(){}});
      return elements.get(id);
    }
    const state={map:{width:80,height:60},scale:.25};
    const canvas={width:400,height:300,getBoundingClientRect:()=>({width,height:width*.75})};
    const c=vm.createContext({canvas,state,$:element,Option:class {},performance,
      paint(){},clearDesign(){},refresh(){
        state.design=c.proposeHeads(state.map,table,.25,.25,null);
      }});
    for(const file of ['recognition','contours','catalog','planner','manual']){
      vm.runInContext(fs.readFileSync('src/'+file+'.js','utf8'),c);
    }
    const table=c.readCatalog(fs.readFileSync('data/mp-rotator.csv','utf8'));
    c.bindManual();
    element('manualKind').value='1';
    function draw(left){
      element('addOutline').onclick();
      for(const [x,y] of [[left,40],[left+110,40],[left+110,170],[left,170]])c.manualClick(x,y);
      element('finish').onclick();
    }
    draw(30);
    assert.ok(state.design.heads.length);
    draw(220);
    function rightMask(){return state.map.ids.map((id,i)=>Number(i%80>40 && id>=0));}
    const right=rightMask();
    assert.ok(state.design.heads.some(h=>h.x>40));
    element('adjust').onclick();
    c.manualClick(140,40);c.manualClick(155,60);
    element('finish').onclick();
    assert.deepEqual(rightMask(),right);
    assert.ok(state.map.regions[0].maxX>27);
    element('removeOutline').onclick();
    assert.ok(state.design.heads.every(h=>h.x>40));
    element('restore').onclick();
    assert.ok(state.design.heads.some(h=>h.x<40));
    assert.deepEqual(rightMask(),right);
  });
}
