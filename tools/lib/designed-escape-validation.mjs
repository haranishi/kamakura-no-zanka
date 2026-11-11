import { prepareVeg, vegCircles } from '../../dist/valley/kamakura-veg.js';
import { kamakuraPaths } from '../../dist/valley/kamakura-roads.js';
import { prepareWorks, worksCircles } from '../../dist/valley/kamakura-works.js';
import { PLAN as P } from '../worlds/kamakura-return.mjs';
import { ESCAPE as R } from '../worlds/kamakura-escape.mjs';
import { designedCamera } from './designed-perspective.mjs';
import { routeDefinitions, nearLine, routeTargets, townTargets, crownFrame, crownPoint, canopyIntersects, canopyHit } from './designed-route.mjs';
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
// Segment against an oriented building box. Used for first-hit and facade checks, never private dimensions.
function boxHit(o,p,b,base){
  const co=Math.cos(b.rotY||0),si=Math.sin(b.rotY||0),cy=northOffset-b.z;
  const local=v=>{const dx=v[0]-b.x,dz=cy-v[1];return [co*dx-si*dz,si*dx+co*dz,v[2]-base];};
  const a=local(o),z=local(p),bounds=[[-b.w/2,b.w/2],[-b.d/2,b.d/2],[0,b.height]];let lo=0,hi=1;
  for(let k=0;k<3;k++){const d=z[k]-a[k],[min,max]=bounds[k];if(!d){if(a[k]<min||a[k]>max)return null;continue;}
    const u=(min-a[k])/d,v=(max-a[k])/d;lo=Math.max(lo,Math.min(u,v));hi=Math.min(hi,Math.max(u,v));if(lo>hi)return null;
  }return lo;
}
export function escapeCutGeometry(world){
  const at=(x,y)=>world.field.sample(x,y).h,c=R.cut[1],a=R.cut[0],b=R.cut.at(-1),dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),sides={};
  for(const [name,sign] of [['ne',1],['sw',-1]]){
    const profile=[];for(let d=R.cutWidth/2;d<=R.cutDetail;d+=.1)profile.push({d,h:at(c[0]+sign*dy/length*d,c[1]-sign*dx/length*d)});
    const floor=at(...c),peak=Math.max(...profile.map(p=>p.h)),rise=peak-floor;
    let ledge=0,top=0,lr=0,tr=0,faceMax=0;
    for(let i=1;i<profile.length;i++){
      const p=profile[i],q=profile[i-1],run=p.d-q.d,slope=Math.atan(Math.abs(p.h-q.h)/run)*180/Math.PI;
      if(p.h-floor>=rise*.4&&p.h-floor<=rise*.6&&slope<10){lr+=run;ledge=Math.max(ledge,lr);}else lr=0;
      if(p.h>=peak-.3&&slope<10){tr+=run;top=Math.max(top,tr);}else tr=0;
      if(p.h-floor>rise*.15&&p.h-floor<rise*.8)faceMax=Math.max(faceMax,slope);
    }
    sides[name]={rise,ledge,top,faceMax};
  }
  const patches=world.filled.patches,{width,cell_m:cell}=world.meta.grid;let maxSlope=0,triangles=0,overBudget=0;
  for(const [key,k] of patches.index){
    const j=Math.floor(key/width),i=key%width,x=P.grid.west+(i+.5)*cell,y=P.grid.north-(j+.5)*cell;if(nearLine(R.cut,x,y).distance>R.cutDetail-cell)continue;
    const h=patches.heights,step=cell/4;
    for(let r=0;r<4;r++)for(let c=0;c<4;c++){
      const n=k*25+r*5+c,angle=Math.atan(Math.max(Math.hypot(h[n+1]-h[n],h[n+5]-h[n]),Math.hypot(h[n+6]-h[n+5],h[n+6]-h[n+1]))/step)*180/Math.PI;
      maxSlope=Math.max(maxSlope,angle);triangles+=2;if(angle>R.cutSlopeMax)overBudget++;
    }
  }
  return {sides,maxSlope,triangles,overBudget};
}
export function escapeDetails(world){
  const c=R.survey,camera=designedCamera('escape'),o=camera.origin,field=world.field,at=(x,y)=>field.sample(x,y).h;
  const boxes=[...world.filled.houses.instances.map(p=>houseBox(world.filled.houses.kinds.get(p.kind),p.matrix)),...facilityBoxes(world.nodes)];
  const bases=boxes.map(b=>at(b.x,northOffset-b.z));
  const terrainHit=p=>{const length=Math.hypot(p[0]-o[0],p[1]-o[1]),n=Math.ceil(length/c.step);for(let i=1;i<n;i++){const t=i/n;if(o[2]+(p[2]-o[2])*t<at(o[0]+(p[0]-o[0])*t,o[1]+(p[1]-o[1])*t))return t;}return null;};
  const canopyCells=Array.from({length:c.rows*c.columns},()=>[]);
  for(const tree of world.veg){
    const f=crownFrame(tree[0],northOffset-tree[1],tree[4],tree[5],tree[2],tree[11],tree[3]);if(!f)continue;
    const x0=Math.max(0,Math.floor((f.left-c.padding-c.left)/(c.right-c.left)*c.columns)),x1=Math.min(c.columns-1,Math.floor((f.right+c.padding-c.left)/(c.right-c.left)*c.columns));
    const y0=Math.max(0,Math.floor((f.top-c.padding-c.top)/(c.bottom-c.top)*c.rows)),y1=Math.min(c.rows-1,Math.floor((f.bottom+c.padding-c.top)/(c.bottom-c.top)*c.rows));
    for(let row=y0;row<=y1;row++)for(let col=x0;col<=x1;col++)canopyCells[row*c.columns+col].push(tree);
  }
  let hits=0,total=0,terrain=0,buildings=0,work=0;
  for(let row=0;row<c.rows;row++)for(let col=0;col<c.columns;col++){
    const x=c.left+(col+.5)*(c.right-c.left)/c.columns,y=c.top+(row+.5)*(c.bottom-c.top)/c.rows,d=camera.ray(2*x-1,1-2*y),p=o.map((v,k)=>v+d[k]*c.far);
    let first=terrainHit(p)??1,kind='terrain';
    for(let i=0;i<boxes.length;i++){const t=boxHit(o,p,boxes[i],bases[i]);work++;if(t!==null&&t<first){first=t;kind='building';}}
    for(const v of canopyCells[row*c.columns+col]){const t=canopyHit(o,p,v);work++;if(t!==null&&t<first){first=t;kind='canopy';}}
    total++;if(kind==='canopy')hits++;else if(kind==='building')buildings++;else terrain++;
  }
  const clear=(p,own)=>!terrainHit(p)&&!world.veg.some(v=>canopyIntersects(o,p,v))&&!boxes.some((b,i)=>Math.hypot(b.x-own.x,b.z-own.z)>.1&&boxHit(o,p,b,bases[i])!==null);
  const hamlet=world.placed.routeHouses.filter(b=>b.hamlet).map(b=>{
    const base=at(b.x,northOffset-b.z),roof=[b.x,northOffset-b.z,base+b.height],co=Math.cos(b.rotY),si=Math.sin(b.rotY),face=[];
    for(const fraction of [-.3,0,.3])for(const lift of [.5,.75])face.push([b.x+co*b.w*fraction+si*b.d/2,northOffset-b.z+si*b.w*fraction-co*b.d/2,base+b.height*lift]);
    const frontFacing=si*(o[0]-b.x)-co*(o[1]-(northOffset-b.z))>0;
    return {x:b.x,north:northOffset-b.z,roof:clear(roof,b),frontFacing,facade:face.map(p=>frontFacing&&clear(p,b)),clear:clear(roof,b)&&frontFacing&&face.every(p=>clear(p,b))};
  });
  const hut=world.placed.routeHouses[R.homes.length],hv=[];
  for(const u of [-1,1])for(const v of [-1,1])for(const lift of [0,1]){const co=Math.cos(hut.rotY),si=Math.sin(hut.rotY);hv.push(camera.project(hut.x+co*u*hut.w/2+si*v*hut.d/2,northOffset-hut.z+si*u*hut.w/2-co*v*hut.d/2,at(hut.x,northOffset-hut.z)+lift*hut.height));}
  const left=Math.min(...hv.map(p=>p[0]))/P.preview.perspectiveWidth,right=Math.max(...hv.map(p=>p[0]))/P.preview.perspectiveWidth;
  return {cut:escapeCutGeometry(world),forest:{hits,total,fraction:hits/total,terrain,buildings,work},hamlet,hut:{left,right,width:right-left},templeGrove:world.field.templeGrove,routeForest:world.field.routeForest};
}
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
      if(len*(1-t)>Math.min(30,len*.25)&&len*t>R.rayStart)clearance=Math.min(clearance,gap);
      if(gap<-.05&&!hit)hit={x,y,gap};
    }
    for(const v of world.veg){if(canopyIntersects(origin,p,v,R.crownClearance))trees++;
    }return {target:p,roof:roofTargets.includes(p),clearance,required:roofTargets.includes(p)||p[0]===R.pass[12][0]&&p[1]===R.pass[12][1]?R.roofClearance:R.rayClearance,hit,trees};
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
