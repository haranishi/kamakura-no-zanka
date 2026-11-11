import { PLAN as P } from '../worlds/kamakura-return.mjs';
import { designedCamera, designedFrameHits } from './designed-perspective.mjs';
import { northOffset, townWestAt, townEastAt, inRect, shoreAt, harborAt } from './designed-terrain.mjs';
import { houseBox } from '../../dist/valley/kamakura-houses.js';
// All measurements use emitted geometry or the same perspective as the runtime's authored camera.
export function designedComposition(world) {
  const camera=designedCamera(),W=P.preview.perspectiveWidth,H=P.preview.perspectiveHeight;
  const boxes=world.filled.houses.instances.map(p=>houseBox(world.filled.houses.kinds.get(p.kind),p.matrix));
  const townTrees=world.veg.filter(v=>v[0]>P.town.west-120&&v[0]<P.town.east+40&&northOffset-v[1]>P.town.south-20&&northOffset-v[1]<P.town.north+20);
  let cells=0,covered=0;
  for(let y=P.town.south;y<=P.town.north;y+=P.grid.cell)for(let x=townWestAt(y);x<=townEastAt(y);x+=P.grid.cell){
    cells++;const z=northOffset-y;
    if(boxes.some(b=>{const co=Math.cos(b.rotY),si=Math.sin(b.rotY),dx=x-b.x,dz=z-b.z;return Math.hypot(Math.max(0,Math.abs(co*dx-si*dz)-b.w/2),Math.max(0,Math.abs(si*dx+co*dz)-b.d/2))<=12;})||townTrees.some(v=>Math.hypot(v[0]-x,v[1]-z)<=12+v[5]))covered++;
  }
  const project=(x,y,h)=>{const p=camera.project(x,y,h);return [p[0]/W,p[1]/H];};
  const h=P.harbor;let right=0,left=1,bottom=0;
  for(let deg=0;deg<360;deg+=.5){
    if(Math.abs((deg-h.mouth+540)%360-180)<h.opening/2)continue;
    const angle=deg*Math.PI/180,r=P.works.ringSize[1]/2;if(h.northOpen&&Math.cos(angle)>0)continue;const p=project(h.x+(h.radius+r)*Math.sin(angle),h.y+(h.radiusY+r)*Math.cos(angle),h.height);
    left=Math.min(left,p[0]);right=Math.max(right,p[0]);bottom=Math.max(bottom,p[1]);
  }
  const gate=world.nodes.find(n=>n.part==='romon'&&n.facility==='tsurugaoka');
  const buddha=world.nodes.find(n=>n.part==='buddha'),x=buddha.anchor_xz[0],y=northOffset-buddha.anchor_xz[1],head=[x,y,P.terraces[0].rect[4]+buddha.bbox_max[1]];
  const occluded=(target)=>{
    const o=camera.origin,dx=target[0]-o[0],dy=target[1]-o[1],dh=target[2]-o[2],length=Math.hypot(dx,dy,dh);
    let terrain=false,trees=0;
    for(let s=P.grid.cell;s<length-P.grid.cell;s+=P.grid.cell){const t=s/length;if(world.field.sample(o[0]+dx*t,o[1]+dy*t).h>o[2]+dh*t){terrain=true;break;}}
    for(const v of world.veg){const cy=northOffset-v[1],ch=v[2]+v[4]*.7,t=Math.max(0,Math.min(1,((v[0]-o[0])*dx+(cy-o[1])*dy+(ch-o[2])*dh)/(length*length)));if(t>0&&t<1&&Math.hypot(v[0]-o[0]-dx*t,cy-o[1]-dy*t,ch-o[2]-dh*t)<v[5])trees++;}
    return {terrain,trees};
  };
  const treeSpecies=[0,0,0,0];for(const v of world.veg)treeSpecies[v[6]]++;
  const l=P.shrine.lower;let gravel=0,lower=0;for(let y=l[2]+1;y<l[3];y+=2)for(let x=l[0]+1;x<l[1];x+=2){lower++;if(world.field.sample(x,y).code===6)gravel++;}
  return {topHits:designedFrameHits(world.field).slice(0,9).filter(p=>p.hit).length,shoreY:project(0,shoreAt(0),0)[1],beachY:project(0,shoreAt(0)+P.shore.beach,P.shore.beachTop)[1],stairY:project(0,P.shrine.stairSouth,P.shrine.lower[4])[1],bridge:project(world.field.crossings[0].x,world.field.crossings[0].y,world.field.crossings[0].level),gateY:project(gate.anchor_xz[0],northOffset-gate.anchor_xz[1],world.field.upper+gate.bbox_max[1])[1],townWidth:project(townEastAt(P.town.south),P.town.south,P.town.base)[0]-project(townWestAt(P.town.south),P.town.south,P.town.base)[0],harborFrame:{left,right,bottom},townCoverage:covered/cells,treeSpecies:treeSpecies.map(v=>v/world.veg.length),grove:world.field.sanctuaryTrees,gravelFraction:gravel/lower,buddhaHead:project(...head),buddhaHeadOcclusion:occluded(head),buddhaChestOcclusion:occluded([x,y,P.terraces[0].rect[4]+buddha.bbox_max[1]*.7]),mouthHouses:world.placed.mouthHouses};
}
