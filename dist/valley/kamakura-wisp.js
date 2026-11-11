import { mistNoise } from './kamakura-mist.js';
// Metres, seconds and unitless shares; all visual controls for the placed ground mist.
export const WISP = Object.freeze({
  maxItems:16, radiusMinM:15, radiusMaxM:160, heightMinM:1.5, heightMaxM:14,
  liftMinM:0, liftMaxM:25, liftDefaultM:1, strengthMin:.1, strengthMax:1,
  segments:14, lightSegments:12, // grid intervals across the diameter (prepared once).
  lowerShare:.45, edgeStart:.7, opacityCap:.336, // lower sheet depth / radial feather / alpha ceiling (two sheets stay below .56).
  noiseM:40, noiseSpeedMps:.9, noiseStretch:1.4, noiseBase:.25, // world noise size / wind speed / along-wind stretch / minimum density.
  brightness:1.12, warmShare:.18, warmBase:.04, // fog colour gain / sun-side haze mixing / warm share away from sun.
  nearVerticalM:3, nearHiddenM:25, nearFullM:60, // eye clearance / horizontal fade endpoints.
  rangesM:Object.freeze([900,700,500,350]), rangeFade:.8, // drawing distance per adapt step / beginning of distance feather.
  counts:Object.freeze([16,12,8,4]), lightCount:12, // source budgets at adapt 0–3.
  debugRGB:Object.freeze([1,0,.65]), // linear RGB: diagnostic pink.
});
export const WISP_TIMES=Object.freeze({dusk:1,morning:1,evening:.8,golden:.3,noon:0});
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
export const wispEnabled=search=>new URLSearchParams(search).get('wisp')!=='0';
export const wispTime=time=>WISP_TIMES[time]??WISP_TIMES.golden;
export function validateWisps(items){
  if(items===undefined)return null;
  if(!Array.isArray(items)||items.length>WISP.maxItems)throw new RangeError('Invalid meta.wisps');
  for(const item of items){
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['x','y','radius_m','height_m','lift_m','strength'].includes(k)))throw new RangeError('Invalid wisp');
    for(const [key,lo,hi] of [['x',-Infinity,Infinity],['y',-Infinity,Infinity],['radius_m',WISP.radiusMinM,WISP.radiusMaxM],['height_m',WISP.heightMinM,WISP.heightMaxM],['lift_m',WISP.liftMinM,WISP.liftMaxM],['strength',WISP.strengthMin,WISP.strengthMax]]){
      const v=key==='lift_m'?(item[key]===undefined?WISP.liftDefaultM:item[key]):item[key];
      if(!Number.isFinite(v)||v<lo||v>hi)throw new RangeError('Invalid wisp '+key);
    }
  }
  return items;
}
export const wispDepth=(top,ground,height)=>smooth(0,height,top-ground);
export const wispEdge=(distance,radius)=>1-smooth(radius*WISP.edgeStart,radius,distance);
export function wispNear(horizontal,vertical){
  return Math.abs(vertical)>WISP.nearVerticalM?1:smooth(WISP.nearHiddenM,WISP.nearFullM,horizontal);
}
export function wispNoise(x,z,time,dirX=1,dirZ=0){
  return WISP.noiseBase+(1-WISP.noiseBase)*mistNoise((x-dirX*WISP.noiseSpeedMps*time)/(WISP.noiseM*WISP.noiseStretch),(z-dirZ*WISP.noiseSpeedMps*time)/WISP.noiseM);
}
export function wispBudget(length,quality='standard',step=0){
  step=Math.max(0,Math.min(3,Math.floor(step)));
  const count=Math.min(length,WISP.counts[step],quality==='light'?WISP.lightCount:WISP.maxItems);
  const layers=quality==='light'||step>=2?1:2,segments=quality==='light'?WISP.lightSegments:WISP.segments;
  return {count,layers,segments,triangles:count*layers*segments*segments*2,draws:count?1:0,range:WISP.rangesM[step]};
}
// All LOD index ranges share the same horizontal vertices and baked terrain depths.
export function buildWisps(items,terrain,quality='standard'){
  validateWisps(items);
  const positions=[],depths=[],sources=[],uvs=[],indices=[],centres=[],lods=[];
  const n=quality==='light'?WISP.lightSegments:WISP.segments,layers=quality==='light'?1:2;
  let work=0;
  for(let i=0;i<items.length;i++){
    const s=items[i],z=-s.y,ground=terrain.heightAt(s.x,z),top=ground+(s.lift_m??WISP.liftDefaultM)+s.height_m;
    work++;centres.push({x:s.x,z,top,lower:layers===2?top-s.height_m*WISP.lowerShare:top});
    // Sample each ground point just once; both sheets use that same terrain height.
    const heights=new Float64Array((n+1)*(n+1));
    for(let row=0;row<=n;row++)for(let col=0;col<=n;col++){
      const u=col/n*2-1,v=row/n*2-1,x=s.x+u*s.radius_m,pz=z+v*s.radius_m;
      heights[row*(n+1)+col]=terrain.heightAt(x,pz);work++;
    }
    for(let layer=0;layer<layers;layer++)for(let row=0;row<=n;row++)for(let col=0;col<=n;col++){
      const u=col/n*2-1,v=row/n*2-1,h=top-layer*s.height_m*WISP.lowerShare;
      positions.push(s.x+u*s.radius_m,h,z+v*s.radius_m);uvs.push(u,v);
      depths.push(wispDepth(h,heights[row*(n+1)+col],s.height_m)*s.strength);sources.push(i);
    }
  }
  for(let step=0;step<=3;step++){
    const budget=wispBudget(items.length,quality,step),start=indices.length;
    for(let i=0;i<budget.count;i++)for(let layer=0;layer<budget.layers;layer++)for(let row=0;row<n;row++)for(let col=0;col<n;col++){
      const a=(i*layers+layer)*(n+1)*(n+1)+row*(n+1)+col,b=a+1,c=a+n+1,d=c+1;
      indices.push(a,c,b,b,c,d);
    }
    lods.push({...budget,start,indices:indices.length-start});
  }
  return {positions:new Float32Array(positions),uvs:new Float32Array(uvs),depths:new Float32Array(depths),sources:new Float32Array(sources),indices:new Uint16Array(indices),centres,lods,work};
}
