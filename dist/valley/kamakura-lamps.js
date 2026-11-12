// Optional household light; deterministic rules in metres, independent of rendering.
import { houseHash } from './kamakura-house-texture.js';
import { houseFamily } from './kamakura-house-build.js';
export const LAMPS = Object.freeze({
  max: 400, lightMax: 200, adaptKeep: .18, // houses / fraction: capacity and reduction per step.
  far: 1600, adaptDistance: .18, // m / fraction: far limit and reduction per step.
  // Real Chrome, from the overlook: a hamlet 150m away showed no light. Its openings had already given way to 3-pixel points, while
  // a door there is still 6 by 12 pixels. Openings and their spill on the ground now stay true shapes out to about 290m.
  blendStart: 260, blendEnd: 320, // m: opening-to-point transition around 290m.
  wallOffset: .03, doorWidth: .9, doorHeight: 1.7, windowWidth: .7, windowHeight: .5, // m: front openings.
  windowY: 1.45, doorBase: .12, windowOffset: .3, twoWindows: 5, // m / width fraction / m: window layout.
  groundOffset: .04, poolRadius: 3, poolAhead: 1.7, poolGrid: 4, // m / cells per side: conforming ground patch.
  intensity: 2.6, poolIntensity: .34, edge: .22, // linear light gains: dusk emission, additive spill, dark opening edges.
  flicker: .07, frequency: .55, // fraction / Hz: gentle, independent house phases.
  pixels: 3.2, pointGain: 2.4, eveningGain: .8, // framebuffer pixels / gain on a distant point / gain in the evening.
  // Real Chrome, the opening scene: with the openings' own strength the far points could not be told from the roofs around them.
});
const C=LAMPS;
const EVENING_TIMES=Object.freeze(['evening','dusk']);
export function validateLights(value) {
  if(value===undefined)return null;
  if(!value || typeof value!=='object' || Array.isArray(value) || !Number.isFinite(value.rate) || value.rate<0 || value.rate>1)throw new Error('家の明かりの割合が不正です');
  return value;
}
export function lampsEnabled(search='',time='noon',lights) {
  const q=new URLSearchParams(search);
  return !!validateLights(lights)?.rate && EVENING_TIMES.includes(time) && q.get('lamps')!=='0' && q.get('layers')!=='0';
}
export function lampsPolicy(quality='standard',step=0) {
  step=Math.max(0,Math.min(3,step));
  return {limit:Math.floor((quality==='light'?C.lightMax:C.max)*(1-step*C.adaptKeep)),far:C.far*(1-step*C.adaptDistance),openings:step<3,pools:step<2};
}
export function lampFarWeight(distance) {
  const t=Math.max(0,Math.min(1,(distance-C.blendStart)/(C.blendEnd-C.blendStart)));
  return t*t*(3-2*t);
}
export function selectLampHouses(boxes,houses,lights,fires=[]) {
  const rate=validateLights(lights)?.rate??0,items=new Map((houses?.instances||[]).map(p=>['house-'+p.id,p])),result=[];
  if(!rate)return result;
  for(const box of boxes||[]) {
    const item=items.get(box.id),kind=houses.kinds.get(item?.kind);
    if(!kind || !['town','small','mansion'].includes(houseFamily(kind)))continue;
    if(fires.some(f=>Math.hypot(box.x-f.x,box.z+f.y)<=f.radius_m))continue;
    const rank=houseHash(box.x,box.z);
    if(rank>=rate)continue;
    const m=item.grounded||item.matrix;
    result.push({id:box.id,x:box.x,y:m[13],z:box.z,w:box.w,d:box.d,yaw:box.rotY,rank,phase:houseHash(box.z,box.x)*Math.PI*2});
  }
  result.sort((a,b)=>a.rank-b.rank||a.id.localeCompare(b.id));
  return result;
}
export function lampLayout(house,terrain) {
  const c=Math.cos(house.yaw),s=Math.sin(house.yaw),front=house.d/2+C.wallOffset;
  const at=(u,v,y)=>({x:house.x+c*u+s*v,y,z:house.z-s*u+c*v});
  const openings=[{...at(0,front,house.y+C.doorBase+C.doorHeight/2),w:C.doorWidth,h:C.doorHeight}];
  const sides=house.w>=C.twoWindows?[-1,1]:[1];
  for(const side of sides)openings.push({...at(side*house.w*C.windowOffset,front,house.y+C.windowY),w:C.windowWidth,h:C.windowHeight});
  const pool=at(0,front+C.poolAhead,0);pool.y=terrain.heightAt(pool.x,pool.z)+C.groundOffset;
  if(!Number.isFinite(pool.y))throw new Error('家の前の地面の高さが不正です');
  return {house,openings,pool};
}
