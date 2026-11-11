// Pure angular silhouettes. Colours are taken from the active sky by the view.
import { shoreNoise } from './kamakura-shore.js';
export const HORIZON = Object.freeze({
  maxItems:12, segments:Object.freeze([96,64,32,16]), // items / ridge intervals at adapt 0–3.
  lightSegments:Object.freeze([48,32,24,12]), // intervals in light quality.
  lightItems:8, reducedItems:6, // silhouettes retained in light / adapt 3 (input order).
  renderOrder:-9, depth:.999999, bottomDeg:-.08, // after sky (-10), behind ordinary geometry; tiny seam overlap.
  taperRise:7, taperFall:4, seedCoarse:.17, seedFine:.31, // inverse edge fractions / independent noise seed scales.
  ridgeBase:.2, ridgeNoise:.8, coarseScale:5.7, fineScale:17.3, fineShare:.23, // fractional profile / irregular noise scales.
  haze:Object.freeze({range:.66,headland:.3,island:.48}), // share of the horizon haze colour.
  gain:Object.freeze({range:.72,headland:.42,island:.53}), // share of sky mid/fog colour retained.
  skyMix:.65, baseFade:.24, // fog share of the base colour / relative height consumed by sea haze.
  debug:Object.freeze({range:0x4488ff,headland:0xff9933,island:0x33ff99}), // diagnostic blue / orange / green.
});
export function validateHorizon(value) {
  if(value===undefined)return null;
  if(!Array.isArray(value)||value.length>HORIZON.maxItems)throw new RangeError('Invalid meta.horizon');
  for(const item of value){
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['bearing_deg','width_deg','height_deg','kind'].includes(k))||
      typeof item.kind!=='string'||!Object.hasOwn(HORIZON.haze,item.kind))throw new RangeError('Invalid horizon silhouette');
    for(const [key,lo,hi] of [['bearing_deg',0,360],['width_deg',.5,80],['height_deg',.1,6]])
      if(!Number.isFinite(item[key])||item[key]<lo||item[key]>hi)throw new RangeError('Invalid horizon '+key);
  }
  return value;
}
export function horizonRidge(item,t) {
  if(t<=0||t>=1)return 0;
  const seed=item.bearing_deg+item.width_deg;
  const n=shoreNoise(t*HORIZON.coarseScale+seed,seed*HORIZON.seedCoarse)*(1-HORIZON.fineShare)+
    shoreNoise(t*HORIZON.fineScale+seed,seed*HORIZON.seedFine)*HORIZON.fineShare;
  // Both endpoints meet the sea, but distinct edge tapers and independent noise avoid mirrored peaks.
  const taper=Math.min(1,t*HORIZON.taperRise,(1-t)*HORIZON.taperFall);
  return item.height_deg*taper*(HORIZON.ridgeBase+HORIZON.ridgeNoise*n);
}
export function horizonDirection(bearingDeg,heightDeg,out) {
  const b=bearingDeg*Math.PI/180,h=heightDeg*Math.PI/180,c=Math.cos(h);
  out[0]=Math.sin(b)*c;out[1]=Math.sin(h);out[2]=-Math.cos(b)*c;return out;
}
export function horizonBudget(length,quality='standard',step=0) {
  step=Math.max(0,Math.min(3,Math.floor(step)));
  const count=Math.min(length,step===3?HORIZON.reducedItems:quality==='light'?HORIZON.lightItems:HORIZON.maxItems);
  const segments=(quality==='light'?HORIZON.lightSegments:HORIZON.segments)[step];
  return {count,segments,triangles:count*segments*2,draws:count?1:0,work:count*(segments+1)};
}
export function buildHorizon(items,quality='standard') {
  validateHorizon(items);
  const lods=[],positions=[],kinds=[],heights=[],scratch=[0,0,0];
  const names=['range','headland','island'];let work=0;
  for(let step=0;step<=3;step++){
    const budget=horizonBudget(items.length,quality,step),start=positions.length/3;
    for(let i=0;i<budget.count;i++){
      const item=items[i],kind=names.indexOf(item.kind),ridge=new Float32Array(budget.segments+1);
      for(let j=0;j<=budget.segments;j++)ridge[j]=horizonRidge(item,j/budget.segments);
      for(let j=0;j<budget.segments;j++){
        for(const [edge,top] of [[j,0],[j+1,0],[j,1],[j,1],[j+1,0],[j+1,1]]){
          const t=edge/budget.segments,alt=top?ridge[edge]:HORIZON.bottomDeg;
          horizonDirection(item.bearing_deg+(t-.5)*item.width_deg,alt,scratch);
          positions.push(...scratch);kinds.push(kind);heights.push(top?alt/item.height_deg:0);
        }
      }
    }
    work+=budget.work;lods.push({...budget,start,vertices:positions.length/3-start});
  }
  return {positions:new Float32Array(positions),kinds:new Float32Array(kinds),heights:new Float32Array(heights),lods,work};
}
