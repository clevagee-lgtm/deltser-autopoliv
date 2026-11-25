// Regenerate the lightweight preview after changing the planner or teaching plan.
import {readFileSync, writeFileSync} from "node:fs";
import vm from "node:vm";

const root=new URL("../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");
const engine=vm.createContext({});
for(const source of ["recognition","contours","catalog","planner"]){
  vm.runInContext(read("src/"+source+".js"),engine);
}
const sheetWidth=860, sheetHeight=500, width=420, height=Math.round(sheetHeight*width/sheetWidth);
const outlines=[[[69,68],[407,68],[407,244],[69,244]],[[69,265],[407,265],[407,429],[69,429]]];
let map={width,height,ids:new Int32Array(width*height).fill(-1),regions:[]};
const catalog=engine.readCatalog(read("data/mp-rotator.csv"));
const stages=outlines.map(points=>{
  const cells=points.map(([x,y])=>[x*width/sheetWidth,y*height/sheetHeight]);
  map=engine.editRegionMap(map,engine.polygonMask(cells,width,height),1);
  const {heads,spacing,dryCells}=engine.proposeHeads(map,catalog,.05*sheetWidth/width,.05*sheetHeight/height,null);
  return {heads:heads.map(({x,y,start,arc,rPx,radius})=>({x,y,start,arc,rPx,radius})),
    spacing:{checks:spacing.checks.map(({source,exception})=>({source,exception}))},dryCells:Array.from(dryCells)};
});
writeFileSync(new URL("data/intro-layout.json",root),JSON.stringify({width,height,outlines,stages})+"\n");
