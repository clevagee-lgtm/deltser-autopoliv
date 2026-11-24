// Run the browser solver on a private, pre-labelled grid. Emit aggregate measurements only.
import {readFileSync} from "node:fs";
import vm from "node:vm";

const root=new URL("../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");
const planner=vm.createContext({});
for(const name of ["catalog","contours","planner"])vm.runInContext(read("src/"+name+".js"),planner);
const catalogue=planner.readCatalog(read("data/mp-rotator.csv"));

function measure(file){
  const {width,height,sx,sy}=JSON.parse(readFileSync(file,"utf8"));
  const labels=readFileSync(file.replace(/\.json$/i,".bin"));
  if(!file.toLowerCase().endsWith(".json") || !Number.isInteger(width) || !Number.isInteger(height)
    || width<1 || height<1 || !(sx>0 && sy>0) || width*height!==labels.length)
    throw new Error("Размеры контрольной сетки или масштаб некорректны.");
  let map={width,height,ids:new Int32Array(labels.length).fill(-1),regions:[]};
  for(const kind of [...new Set(labels)].filter(Boolean).sort()){
    if(kind>7)throw new Error("Неизвестная метка в контрольной сетке.");
    map=planner.editRegionMap(map,Uint8Array.from(labels,k=>Number(k===kind)),kind);
  }
  const drafts=[.88,.94,.98].map(fit=>planner.proposeHeads(map,catalogue,sx,sy,null,false,fit));
  function summary(result){
    const round=n=>Math.round(n*100)/100;
    return {heads:result.heads.length,reached:result.spacing.reached,exceptions:result.spacing.exempt,
      missing:result.spacing.missing,hit:result.hit,total:result.total,dryM2:round(result.dryM2),
      outsideM2:round(result.outsideM2),pathM2:labels.includes(6)?round(result.pathM2):null};
  }
  return {file,default:summary(drafts[0]),choices:planner.comparableLayouts(drafts[0],drafts.slice(1)).map(summary)};
}
if(process.argv.length<3)throw new Error("Укажите один или несколько файлов масок .json");
for(const file of process.argv.slice(2))console.log(JSON.stringify(measure(file)));
