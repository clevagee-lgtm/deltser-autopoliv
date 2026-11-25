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

test('freehand teaching lawn keeps perimeter heads with tilted edges and reversed clicks',()=>{
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:'',replaceChildren(){}});
    return elements.get(id);
  };
  const width=420,height=244;
  const state={map:{width,height},scale:.05};
  const canvas={width:860,height:500};
  const c=vm.createContext({canvas,state,$:element,Option:class {},performance,
    paint(){},clearDesign(){},refresh(){
      state.design=c.proposeHeads(state.map,table,.05*860/width,.05*500/height,null);
    }});
  for(const file of ['recognition','contours','catalog','planner','manual']){
    vm.runInContext(fs.readFileSync('src/'+file+'.js','utf8'),c);
  }
  const table=c.readCatalog(fs.readFileSync('data/mp-rotator.csv','utf8'));
  c.bindManual();element('manualKind').value='1';
  const shear=164*Math.tan(3*Math.PI/180);
  const lawn=[[69,265],[407,265],[407+shear,429],[69+shear,429]];
  for(const degrees of [0,25,89]){
    const angle=degrees*Math.PI/180;
    const points=lawn.map(([x,y])=>[430+(x-238)*Math.cos(angle)-(y-347)*Math.sin(angle),
      250+(x-238)*Math.sin(angle)+(y-347)*Math.cos(angle)]);
    for(const order of [points,[...points].reverse()]){
      element('addOutline').onclick();
      for(const [x,y] of order)c.manualClick(x,y);
      assert.equal(element('alignOption').hidden,false);
      element('finish').onclick();
      assert.equal(state.design.heads.length,6);
      assert.equal(state.design.heads.filter(h=>h.arc===90).length,4);
      assert.equal(state.design.coverage,100);assert.equal(state.design.spacing.missing,0);
      assert.equal(state.design.outsideM2,0);
      element('outlineList').value='0';element('removeOutline').onclick();
    }
  }
  element('addOutline').onclick();
  for(const [x,y] of lawn)c.manualClick(x,y);
  element('alignRectangle').checked=false;element('finish').onclick();
  const original=c.polygonMask(lawn.map(([x,y])=>[x*width/860,y*height/500]),width,height);
  assert.deepEqual(Array.from(state.map.ids,id=>Number(id>=0)),Array.from(original));
  assert.equal(c.fitLawnRectangle([[0,0],[160,0],[140,80],[0,80]],1,1),null);
  assert.equal(c.fitLawnRectangle([[0,0],[100,70],[100,0],[0,70]],1,1),null);
});
