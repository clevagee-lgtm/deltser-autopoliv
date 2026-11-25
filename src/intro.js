// The teaching plan uses the same raster mask, scale and sector renderer as the editor.
let introFrame=0;
function stopIntro(){cancelAnimationFrame(introFrame);}
function startIntro(){
  const view=$("walkthrough"), brush=view.getContext("2d"), sheet=exampleSheet();
  const {outlines,stages,...map}=/*INTRO_LAYOUT*/;
  const motion=matchMedia("(prefers-reduced-motion: reduce)");
  const play=$("playIntro");
  let elapsed=0,previous=null,running=false;

  function outline(points,fraction){
    const progress=Math.min(4,fraction*4),index=Math.min(3,Math.floor(progress));
    const from=points[index],to=points[(index+1)%4],part=progress-index;
    const x=from[0]+(to[0]-from[0])*part,y=from[1]+(to[1]-from[1])*part;
    brush.strokeStyle="#852367";brush.lineWidth=4;brush.beginPath();
    brush.moveTo(...points[0]);
    for(let i=1;i<=index;i++)brush.lineTo(...points[i]);
    brush.lineTo(x,y);brush.stroke();
    for(const [vx,vy] of points.slice(0,index+1)){
      brush.fillStyle="white";brush.beginPath();brush.arc(vx,vy,6,0,2*Math.PI);brush.fill();brush.stroke();
    }
    brush.fillStyle="#71205b";brush.beginPath();brush.arc(x,y,9,0,2*Math.PI);brush.fill();
  }
  function paintScene(){
    brush.drawImage(sheet,0,0);
    const stage=elapsed>=8600?2:elapsed>=5000?1:0;
    if(stage)drawSectors(brush,view,map,stages[stage-1],.05,null);
    let caption="Учебный участок с двумя газонами";
    if(elapsed>=2000 && elapsed<5000){outline(outlines[0],(elapsed-2000)/3000);caption="Обводим первый газон";}
    else if(stage===2)caption="Готовая схема полива двух газонов";
    else if(elapsed>=7000){outline(outlines[1],(elapsed-7000)/1600);caption="Добавляем второй газон";}
    else if(stage===1)caption="На первом газоне появились дождеватели";
    $("scene").textContent=caption;
  }
  function control(){
    play.textContent=running?"Пауза":elapsed>=10000?"Повторить":"Продолжить";
  }
  function frame(now){
    if(previous!==null)elapsed=Math.min(10000,elapsed+now-previous);
    previous=now;paintScene();
    if(elapsed<10000)introFrame=requestAnimationFrame(frame);
    else{running=false;control();}
  }
  function toggle(){
    stopIntro();
    running=!running;
    if(running){
      if(elapsed>=10000)elapsed=0;
      previous=null;introFrame=requestAnimationFrame(frame);
    }
    control();
  }
  play.onclick=toggle;
  function preference(){
    stopIntro();running=false;elapsed=motion.matches?10000:0;paintScene();control();
    if(!motion.matches && !$("introDemo").hidden)toggle();
  }
  motion.addEventListener("change",preference);
  preference();
}
