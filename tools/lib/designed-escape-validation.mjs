import { prepareVeg, vegCircles } from '../../dist/valley/kamakura-veg.js';
import { kamakuraPaths } from '../../dist/valley/kamakura-roads.js';
import { prepareWorks, worksCircles } from '../../dist/valley/kamakura-works.js';
import { ESCAPE as R } from '../worlds/kamakura-escape.mjs';
import { designedCamera } from './designed-perspective.mjs';
import { routeDefinitions, nearLine, routeTargets, townTargets, crownFrame, crownPoint, canopyIntersects } from './designed-route.mjs';
import { gameZ, northOffset } from './designed-terrain.mjs';
import { createKamakuraTerrain } from '../../dist/valley/kamakura-terrain.js';
import { buildColliders, moveActor } from '../../dist/valley/collision.js';
import { houseBox } from '../../dist/valley/kamakura-houses.js';
import { facilityBoxes } from './designed-placement.mjs';
export const ESCAPE_FRAMES=Object.freeze([
  ['T12',R.pass[12],[66,82,80,96]],['T10',R.pass[10],[46,60,63,78]],['T8',R.pass[8],[33,46,51,64]],
  ['T6',R.pass[6],[26,38,43,56]],['T3',R.pass[3],[31,45,36,48]],['草地',R.meadow,[26,42,78,95]],
  ['草地の梢',R.trees[1],[22,36,50,66]],['枝道の小屋',R.huts[1],[70,85,42,58]],['町',[0,126],[46,60,21,31]],
]);
export function escapeReport(world,{movement=true}={}) {
  const terrain=createKamakuraTerrain(world.filled),at=(x,y)=>terrain.heightAt(x,gameZ(y)),camera=designedCamera('escape');
  const frames=ESCAPE_FRAMES.map(([name,p,range])=>{const tree=name==='草地の梢',point=tree?crownPoint(p[0],p[1],at(...p),0,0,p[2],R.meadowTreeLean,R.meadowTreeYaw*Math.PI/180):[p[0],p[1],at(...p)],h=point[2],v=camera.project(...point);return {name,x:v[0]/12.8,y:v[1]/7.2,height:h,range};});
  const routeHeights=routeDefinitions.map(r=>({id:r.id,points:r.points.map(([x,y])=>[x,y,at(x,y)]),maxGrade:0,maxFourGrade:0,maxError:0}));
  for(let k=0;k<routeDefinitions.length;k++){
    const r=routeDefinitions[k],out=routeHeights[k],samples=[];let arc=0;
    for(let i=1;i<r.points.length;i++){
      const a=r.points[i-1],b=r.points[i],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),n=Math.ceil(len/.25);
      for(let j=0;j<n;j++){const t=j/n,x=a[0]+dx*t,y=a[1]+dy*t,h=at(x,y);samples.push({s:arc+len*t,h});out.maxError=Math.max(out.maxError,Math.abs(h-a[2]-(b[2]-a[2])*t));}arc+=len;
    }
    samples.push({s:arc,h:at(...r.points.at(-1))});
    for(let i=1;i<samples.length;i++)out.maxGrade=Math.max(out.maxGrade,Math.abs(samples[i].h-samples[i-1].h)/(samples[i].s-samples[i-1].s));
    let end=0;for(let i=0;i<samples.length;i++){while(end<samples.length-1&&samples[end].s<samples[i].s+4)end++;if(samples[end].s-samples[i].s>=3.9)out.maxFourGrade=Math.max(out.maxFourGrade,Math.abs(samples[end].h-samples[i].h)/(samples[end].s-samples[i].s));}
  }
  const roofTargets=world.placed.routeHouses.filter(b=>b.hamlet).map(b=>[b.x,northOffset-b.z,at(b.x,northOffset-b.z)+b.height]);
  const targets=routeTargets({sample:(x,y)=>({h:at(x,y)})},roofTargets),origin=camera.origin;
  const rays=targets.slice(0,-townTargets(world.field).length-R.seaTargets.length).map(p=>{
    const len=Math.hypot(p[0]-origin[0],p[1]-origin[1]),n=Math.ceil(len/R.rayStep);let clearance=Infinity,hit=null,trees=0;
    // A surface target has zero clearance at its endpoint. Exclude its final quarter (at most 30m) only from the margin metric; still test every ray sample for hits.
    for(let i=1;i<n;i++){
      const t=i/n,x=origin[0]+(p[0]-origin[0])*t,y=origin[1]+(p[1]-origin[1])*t,h=origin[2]+(p[2]-origin[2])*t,gap=h-at(x,y);
      if(len*(1-t)>Math.min(30,len*.25)&&len*t>4)clearance=Math.min(clearance,gap);
      if(gap<-.05&&!hit)hit={x,y,gap};
    }
    for(const v of world.veg){if(canopyIntersects(origin,p,v,R.crownClearance))trees++;
    }return {target:p,clearance,required:roofTargets.includes(p)||p[0]===R.pass[12][0]&&p[1]===R.pass[12][1]?R.roofClearance:R.rayClearance,hit,trees};
  });
  const visibility=points=>points.map(p=>{
    const dx=p[0]-origin[0],dy=p[1]-origin[1],len=Math.hypot(dx,dy),n=Math.ceil(len/R.rayStep);let terrainHit=false,trees=0;
    for(let i=1;i<n;i++){const t=i/n;if(origin[2]+(p[2]-origin[2])*t<at(origin[0]+dx*t,origin[1]+dy*t)-.05){terrainHit=true;break;}}
    for(const v of world.veg){if(Math.hypot(v[0]-p[0],northOffset-v[1]-p[1])>R.treeEndpoint&&canopyIntersects(origin,p,v))trees++;
    }return {target:p,terrainHit,trees,clear:!terrainHit&&!trees};
  });
  const visibilityReport={town:visibility(townTargets({sample:(x,y)=>({h:at(x,y)})})),sea:visibility(R.seaTargets),fires:visibility(R.fires.map(([x,y])=>[x,y,at(x,y)+R.fireLift]))};
  const crowns=world.veg.map(v=>({x:v[0],y:northOffset-v[1],distance:Math.hypot(v[0]-origin[0],northOffset-v[1]-origin[1]),...crownFrame(v[0],northOffset-v[1],v[4],v[5],v[2],v[11],v[3])}));
  const walls={ne:[],sw:[]};
  for(let i=1;i<R.cut.length;i++){
    const a=R.cut[i-1],b=R.cut[i],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),x=(a[0]+b[0])/2,y=(a[1]+b[1])/2;
    for(const [name,side,height] of [['ne',1,R.wallNE],['sw',-1,R.wallSW]]){if(name==='sw'&&i>1)continue;const d=R.cutWidth/2+height/R.wallSlope;walls[name].push({rise:at(x+side*dy/len*d,y-side*dx/len*d)-at(x,y),run:d-R.cutWidth/2});}
  }
  const wallProfiles={};
  const ca=R.cut[0],cb=R.cut.at(-1),cx=cb[0]-ca[0],cy=cb[1]-ca[1],cl=Math.hypot(cx,cy);
  for(const [name,side,minimum] of [['ne',1,8],['sw',-1,5]]){
    const samples=[];let run=0,longest=0;
    for(let along=0;along<=cl;along+=R.rayStep){
      const x=ca[0]+cx*along/cl,y=ca[1]+cy*along/cl,floor=at(x,y);let rise=0;
      for(let distance=R.cutWidth/2;distance<=R.gradeWidth;distance+=R.rayStep)rise=Math.max(rise,at(x+side*cy/cl*distance,y-side*cx/cl*distance)-floor);
      samples.push({along,rise});if(rise>=minimum){run+=R.rayStep;longest=Math.max(longest,run);}else run=0;
    }wallProfiles[name]={length:longest,min:Math.min(...samples.filter(p=>p.rise>=minimum).map(p=>p.rise)),max:Math.max(...samples.map(p=>p.rise)),samples};
  }
  const meadow=[];for(let y=R.meadow[1]+R.meadowOffset[1]-R.meadowRadius;y<=R.meadow[1]+R.meadowOffset[1]+R.meadowRadius;y++)for(let x=R.meadow[0]+R.meadowOffset[0]-R.meadowRadius;x<=R.meadow[0]+R.meadowOffset[0]+R.meadowRadius;x++)if(Math.hypot(x-R.meadow[0]-R.meadowOffset[0],y-R.meadow[1]-R.meadowOffset[1])<=R.meadowRadius){const slope=Math.atan(Math.hypot(at(x+.5,y)-at(x-.5,y),at(x,y+.5)-at(x,y-.5)))*180/Math.PI;meadow.push(slope);}
  const fences=JSON.parse(world.files.get('works.json')).fences;
  const fenceLength=fences.reduce((n,f)=>n+f.xy_m.slice(1).reduce((s,p,i)=>s+Math.hypot(p[0]-f.xy_m[i][0],p[1]-f.xy_m[i][1]),0),0);
  const moves=[];let work=0;
  if(movement){
    const boxes=world.filled.houses.instances.map(p=>houseBox(world.filled.houses.kinds.get(p.kind),p.matrix));
    const facilities=facilityBoxes(world.nodes.filter(n=>n.part==='hall'&&n.facility!=='daibutsuden'));
    const circles=vegCircles(prepareVeg(world.filled.veg,terrain,{boxes:[...boxes,...facilities],paths:kamakuraPaths(world.filled),spawn:{x:world.meta.spawn.x,z:-world.meta.spawn.y}}),sp=>[20,12,13,8,3,1.2][sp]);
    circles.push(...worksCircles(prepareWorks(JSON.parse(world.files.get('works.json')),terrain).rocks));
    const col=buildColliders({bounds:terrain.bounds,extraBoxes:[...boxes,...facilities],extraCircles:circles});
    for(const r of routeDefinitions)for(const reverse of [false,true]){
      const points=reverse?[...r.points].reverse():r.points;let pos={x:points[0][0],z:gameZ(points[0][1]),y:at(...points[0])},blocked=null;
      for(let i=1;i<points.length;i++){
        const p=points[i],dx=p[0]-pos.x,dz=gameZ(p[1])-pos.z,n=Math.ceil(Math.hypot(dx,dz)/.2);
        for(let j=0;j<n;j++){pos=moveActor(col,terrain,pos,dx/n,dz/n);work++;}
        if(Math.hypot(pos.x-p[0],pos.z-gameZ(p[1]))>.05){blocked={segment:i,x:pos.x,north:northOffset-pos.z,why:pos.blocked};break;}
      }moves.push({id:r.id,reverse,ok:!blocked,blocked});
    }
  }
  return {visibility:visibilityReport,crowns,treeChanges:world.field.routeTrees,frames,horizon:50-100*Math.tan(R.camera.pitch*Math.PI/180)/(2*Math.tan(R.camera.fov*Math.PI/360)),routes:routeHeights,walls,wallProfiles,meadow:{flatArea:meadow.filter(s=>s<=6).length,totalArea:meadow.length,max:Math.max(...meadow)},fences:{count:fences.length,length:fenceLength},rays,moves,work,summary:{houses:world.filled.houses.instances.length,trees:world.veg.length,fires:world.meta.fires?.length||0,patchCells:world.meta.patches.total_cells}};
}
