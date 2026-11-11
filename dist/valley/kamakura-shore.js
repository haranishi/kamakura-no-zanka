export { shore3Enabled, FOAM_LINEAR_MAX } from './kamakura-shore-r3.js';
import { SHORE_R3_GLSL } from './kamakura-shore-r3.js';
// W2c-9a: silent sea → shared, pure shore-distance field (metres, 3–4 chamfer).
export const SHORE_LIMIT_M = 3000;
export const SHORE_GRID = Object.freeze({ smallMapM:2500, minCellM:4, terrainCellGain:2, maxSide:512, legacyCellM:8 });
// W2c-19 edges: metre controls and preparation costs for sheltered water.
export const SHELTER=Object.freeze({
  openM:25, seaM:120, edgeM:2, fadeM:12, // erosion clearance / offshore seed / shore restoration / soft falloff, metres.
  foamGain:.25, foamEdgeM:.8, // fractional coverage / metres: stationary thin foam survives on sheltered edges.
  budgetMs:1.5, batchCells:64, packCells:64, maxFrameWork:8192, // leave headroom under the 2ms preparation target.
  debug:Object.freeze([1,0,1]), // purple: water without open-sea surf.
});
// Directional surf: facing comes from the signed-distance gradient, not world position.
export const SWELL=Object.freeze({
  facingStart:-.3, facingEnd:.4, // dot product: lee is zero, seaward shore is one.
  gradientEpsilon:1e-6, // metres: undefined gradients retain the existing surf.
  debug:Object.freeze([1,.5,0]) // orange: direction reduced the surf (debug only).
});
export const swellEnabled=search=>new URLSearchParams(search).get('swell')!=='0';
export function validateSea(sea){
  if(sea===undefined)return;
  if(!sea||Array.isArray(sea)||typeof sea!=='object'||Object.keys(sea).some(k=>k!=='swell_from_deg')||
    !Number.isFinite(sea.swell_from_deg)||sea.swell_from_deg<0||sea.swell_from_deg>360)throw new Error('海の波向きの指定が不正です');
}
export function swellFacing(dx,dz,fromDeg){
  const length=Math.hypot(dx,dz);if(length<SWELL.gradientEpsilon)return 1;
  const a=fromDeg*Math.PI/180,f=(dx*Math.sin(a)-dz*Math.cos(a))/length;
  const t=Math.max(0,Math.min(1,(f-SWELL.facingStart)/(SWELL.facingEnd-SWELL.facingStart)));
  return t*t*(3-2*t);
}
export const shelterEnabled=search=>new URLSearchParams(search).get('shelter')!=='0';
const clamp = (v, hi) => Math.max(0, Math.min(hi, v));
export function createShoreField(terrain, { cell = 16 } = {}) {
  if (!Number.isFinite(cell) || cell <= 0) throw new RangeError('Invalid shore cell');
  const b = terrain.bounds, x0 = b.minX, z0 = b.minZ;
  const w = Math.ceil((b.maxX - x0) / cell) + 1, h = Math.ceil((b.maxZ - z0) / cell) + 1;
  const data = new Float32Array(w * h);
  const straight = cell, diagonal = cell * 4 / 3;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = terrain.isSea(x0 + i * cell, z0 + j * cell) ? 0 : Infinity;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    if (i) data[k] = Math.min(data[k], data[k - 1] + straight);
    if (j) data[k] = Math.min(data[k], data[k - w] + straight,
      i ? data[k - w - 1] + diagonal : Infinity, i + 1 < w ? data[k - w + 1] + diagonal : Infinity);
  }
  for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
    const k = j * w + i;
    if (i + 1 < w) data[k] = Math.min(data[k], data[k + 1] + straight);
    if (j + 1 < h) data[k] = Math.min(data[k], data[k + w] + straight,
      i ? data[k + w - 1] + diagonal : Infinity, i + 1 < w ? data[k + w + 1] + diagonal : Infinity);
  }
  // A finite sentinel keeps interpolation near the cap free of Infinity * 0 / NaN.
  for (let k = 0; k < data.length; k++) data[k] = Math.min(SHORE_LIMIT_M, data[k]);
  function seaDistanceAt(x, z) {
    const gx = clamp((Math.max(b.minX, Math.min(b.maxX, x)) - x0) / cell, w - 1);
    const gz = clamp((Math.max(b.minZ, Math.min(b.maxZ, z)) - z0) / cell, h - 1);
    // Clamp before testing sea so outside queries really use the nearest field edge.
    if (terrain.isSea(Math.min(b.maxX, x0 + gx * cell), Math.min(b.maxZ, z0 + gz * cell))) return 0;
    const i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j;
    const k = j * w + i, right = Math.min(i + 1, w - 1) - i, down = Math.min(j + 1, h - 1) * w + i;
    const d = (data[k] * (1 - u) + data[k + right] * u) * (1 - v) + (data[down] * (1 - u) + data[down + right] * u) * v;
    return d >= SHORE_LIMIT_M ? Infinity : d;
  }
  return { cell, x0, z0, w, h, data, seaDistanceAt };
}

// W2c-9e: inverse (water -> land) and river fields; bounded work supplied by caller.
export const SEA_VIS = Object.freeze({ reach: 9, minReach: 3.3, foamWidth: 1.6, tide: 11.5, tideWidth: 2.5 });
export const SAND_WIND=Object.freeze({x:5,z:1.7,warp:.5,xScale:.025,zScale:.023});
export const sandWindDirection=(x,z)=>[SAND_WIND.x+Math.sin(z*SAND_WIND.xScale)*SAND_WIND.warp,SAND_WIND.z+Math.sin(x*SAND_WIND.zScale)*SAND_WIND.warp];
export const shoreWetness = (d, wave) => Math.max(0, Math.min(1, (SEA_VIS.minReach + (SEA_VIS.reach - SEA_VIS.minReach) * wave - d) / 2));
export const shoreFoam = (d, wave) => Math.max(0, 1 - Math.abs(d - (1 + 5 * (1 - wave))) / SEA_VIS.foamWidth);
export function riverWetness(d){const u=Math.max(0,Math.min(1,(d-.6)/1.4));return 1-u*u*(3-2*u);}
export const tideLine = d => Math.max(0, 1 - Math.abs(d - SEA_VIS.tide) / SEA_VIS.tideWidth);
export function createDistanceJob(terrain, { river = false, cell = river ? 8 : 16, limit = river ? 12 : SHORE_LIMIT_M } = {}) {
  if (!(cell > 0) || !Number.isFinite(cell) || !(limit > 0) || !Number.isFinite(limit)) throw new RangeError('Invalid distance grid');
  const b = terrain.bounds, x0 = b.minX, z0 = b.minZ;
  const w = Math.ceil((b.maxX-x0)/cell)+1, h = Math.ceil((b.maxZ-z0)/cell)+1;
  const data = new Float32Array(w*h); let phase = 0, cursor = 0;
  const field = {x0,z0,w,h,cell,data,maxX:b.maxX,maxZ:b.maxZ};
  function step(budget = 256) {
    for (let n=0;n<budget && phase<3;n++) {
      const k = phase===2 ? data.length-1-cursor : cursor, i=k%w, j=Math.floor(k/w);
      if (!phase) {
        const x=Math.min(b.maxX,x0+i*cell), z=Math.min(b.maxZ,z0+j*cell);
        data[k]=river ? Math.min(limit,terrain.riverDistanceAt(x,z,limit)) : terrain.isSea(x,z) ? limit : 0;
      } else if (phase===1) {
        if(i)data[k]=Math.min(data[k],data[k-1]+cell);
        if(j)data[k]=Math.min(data[k],data[k-w]+cell,i?data[k-w-1]+cell*4/3:limit,i+1<w?data[k-w+1]+cell*4/3:limit);
      } else {
        if(i+1<w)data[k]=Math.min(data[k],data[k+1]+cell);
        if(j+1<h)data[k]=Math.min(data[k],data[k+w]+cell,i?data[k+w-1]+cell*4/3:limit,i+1<w?data[k+w+1]+cell*4/3:limit);
      }
      if(++cursor===data.length){cursor=0;phase=river?3:phase+1;}
    }
    return phase===3;
  }
  return {field,step,get done(){return phase===3;}};
}
export function sampleDistance(field,x,z) {
  const gx=clamp((Math.min(x,field.maxX??Infinity)-field.x0)/field.cell,field.w-1), gz=clamp((Math.min(z,field.maxZ??Infinity)-field.z0)/field.cell,field.h-1);
  const i=Math.floor(gx),j=Math.floor(gz),u=gx-i,v=gz-j,k=j*field.w+i;
  const r=Math.min(i+1,field.w-1)-i, down=Math.min(j+1,field.h-1)*field.w+i;
  return (field.data[k]*(1-u)+field.data[k+r]*u)*(1-v)+(field.data[down]*(1-u)+field.data[down+r]*u)*v;
}
// Data identity shares view uniforms without modifying terrain or chunk ownership.
const shoreViews=new WeakMap();
export const shoreViewFor=data=>shoreViews.get(data);
export const registerShoreView=(data,view)=>shoreViews.set(data,view);
export const unregisterShoreView=data=>shoreViews.delete(data);
export function shorePropAt(terrain,codeAt,x,z) {
  const d=terrain.shoreSigned ? -terrain.shoreSigned.signedDistanceAt(x,z) : terrain.seaDistanceAt(x,z);
  return d>=0&&d<=16&&!terrain.isSea(x,z)&&terrain.riverDistanceAt(x,z,2)>2;
}
export function shoreHash(x,z,salt=0) {
  let n=Math.imul(x|0,73856093)^Math.imul(z|0,19349663)^salt;
  n=Math.imul(n^(n>>>16),0x45d9f3b);return ((n^(n>>>16))>>>0)/4294967296;
}
// W2c-9e3: one muted depth palette, broken three-front surf and six-second wet memory.
export const SEA_PALETTE=Object.freeze([[0,'#6d8579'],[6,'#4d7d7e'],[40,'#1f4b5a'],[200,'#143549']]);
export const SEA_CHROMA=.8;
export const WET_MEMORY=Object.freeze({seconds:6,decay:4,step:.5,edge:1.5});
export const BREAKERS=Object.freeze([{speed:1,phase:0,offset:0},{speed:.85,phase:2.7,offset:14},{speed:.7,phase:5.1,offset:29}]);
export const shoreReach=wave=>SEA_VIS.minReach+(SEA_VIS.reach-SEA_VIS.minReach)*wave;
export function wetReachAt(time,envelope){
  let reach=0;
  for(let age=0;age<=WET_MEMORY.seconds;age+=WET_MEMORY.step)reach=Math.max(reach,shoreReach(envelope(Math.max(0,time-age)))*Math.exp(-age/WET_MEMORY.decay));
  return reach;
}
export const wetFromReach=(d,reach)=>Math.max(0,Math.min(1,(reach-d)/WET_MEMORY.edge));
const fract=x=>x-Math.floor(x),mix=(a,b,t)=>a+(b-a)*t;
const noiseHash=(x,z)=>fract(Math.sin(x*127.1+z*311.7)*43758.5453);
export function shoreNoise(x,z){let i=Math.floor(x),j=Math.floor(z),u=fract(x),v=fract(z);u=u*u*(3-2*u);v=v*v*(3-2*v);return mix(mix(noiseHash(i,j),noiseHash(i+1,j),u),mix(noiseHash(i,j+1),noiseHash(i+1,j+1),u),v);}
export function breakerFoam(d,wave,x,z,offset=0){
  if(d<0||d>45)return 0;
  const n=shoreNoise(x/16+offset,z/16+offset),wide=.5+2.5*shoreNoise(x/8+7+offset,z/8+offset);
  const broken=Math.max(0,Math.min(1,(n-.34)/.24));
  const delta=Math.abs(d-(1+5*(1-wave)+offset));
  const body=Math.max(0,1-delta/(wide*.5));
  const lace=.65+.35*shoreNoise(x*2.3,z*2.3);
  const tip=Math.max(0,1-Math.abs(d-(1+5*(1-wave)+offset-wide*.32))/.12);
  return Math.min(1,body*.75+tip*.55)*broken*lace;
}
// Shared JS/GLSL constants and algebra: wave is evaluated once on the audio clock.
export const SHORE_GLSL=`
// W2c-9r1 shore: shared distance controls wet sand, depth and irregular surf.
uniform float uShore2;
// W2c-10b shore5: optional shared wet-band control (unset = legacy).
uniform float uShoreWet5;
float shoreSmooth(float d,float reach){return 1.0-smoothstep(0.0,reach,max(0.0,d));}
float shoreDepth(float d){return smoothstep(0.0,32.0,max(0.0,d));}

vec2 sandWindDirection(vec2 p){return vec2(${SAND_WIND.x.toFixed(1)}+sin(p.y*${SAND_WIND.xScale})*${SAND_WIND.warp},${SAND_WIND.z}+sin(p.x*${SAND_WIND.zScale})*${SAND_WIND.warp});}
float shoreHash2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float shoreNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(shoreHash2(i),shoreHash2(i+vec2(1.0,0.0)),f.x),mix(shoreHash2(i+vec2(0.0,1.0)),shoreHash2(i+vec2(1.0)),f.x),f.y);}
// W2c-9r2 shore fix: distant films retain contrast and a six-pixel FWHM (48m cap).
float shoreBandWidth(float base,float footprint){return max(base,min(48.0,max(0.0,footprint)*6.0));}
float shoreSurf(float d,float wave,vec2 p,float band){
  float footprint=max(fwidth(d),.001);
  if(d < -4.0 || d > 72.0)return 0.0; // skip offshore noise after evaluating the derivative
  float centre=1.0+band+4.0*(1.0-wave)+2.2*(shoreNoise(p/19.0+band)-.5);
  float width=shoreBandWidth(1.0+2.1*shoreNoise(p/9.0+band),footprint);
  // W2c-9r2 shore: integrate narrow fronts to pixel width instead of a horizontal fade.
  float softWidth=sqrt(width*width+footprint*footprint);
  float body=(1.0-smoothstep(0.0,softWidth,abs(d-centre)));
  float jitter=.8+.4*shoreNoise(p/17.0+band);
  float gaps=mix(smoothstep(.30,.64,shoreNoise(p/11.0+band)),.38,smoothstep(2.0*jitter,8.0*jitter,footprint));
  return body*gaps;
}


${SHORE_R3_GLSL}
float shoreWet(float d,float wave){return clamp((${SEA_VIS.minReach.toFixed(1)}+${(SEA_VIS.reach-SEA_VIS.minReach).toFixed(1)}*wave-d)/2.0,0.0,1.0);}
float shoreFoam(float d,float wave){return max(0.0,1.0-abs(d-(1.0+5.0*(1.0-wave)))/${SEA_VIS.foamWidth.toFixed(1)});}
// W2c-9r2 shore: diffuse 9m wash -> readable 0.6–1.5m saturated sand at the waterline.
float shoreWetReach(float d,float reach){
  float wetPixel5=max(fwidth(d),.001);
  if(uShoreWet5>0.0){
    float wetWidth5=surfWetWidth3(reach,wetPixel5);
    float oldWet5=shoreSmooth(d,wetWidth5*(1.0+.18*shoreNoise(gl_FragCoord.xy/37.0)+.12*shoreNoise(gl_FragCoord.xy/113.0)));
    // A darker core survives reduction at the 27–70m viewpoints; retain wet memory.
    float wet5=1.0-smoothstep(wetWidth5*.25,wetWidth5*1.25,max(0.0,d));
    return mix(oldWet5,wet5,uShoreWet5);
  }
if(uShore3>.5)return shoreSmooth(d,surfWetWidth3(reach,max(fwidth(d),.001))*(1.0+.18*shoreNoise(gl_FragCoord.xy/37.0)+.12*shoreNoise(gl_FragCoord.xy/113.0)));return uShore2>.5?shoreSmooth(d,shoreBandWidth(clamp(reach*.18,.6,1.5),max(fwidth(d),.001)*2.0)):clamp((reach-d)/${WET_MEMORY.edge.toFixed(1)},0.0,1.0);}
// Short, scattered river foam; the long-wave gaps are independent of the moving lace.
float riverFoamCentre(vec2 p){return .35+.38*shoreNoise(p/5.7);}
float riverFoamWidth(vec2 p){return .18+.36*shoreNoise(p/2.9+8.0);}
float riverBankFoam(float d,vec2 p,float time,float footprint){
  if(d<0.0||d>1.4)return 0.0;
  float width=riverFoamWidth(p),centre=riverFoamCentre(p);
  float gaps=smoothstep(.43,.65,shoreNoise(p/3.7));
  float lace=mix(.35,1.0,smoothstep(.32,.72,shoreNoise(p*2.1+vec2(time*.16,-time*.23))));
  float jitter=.8+.4*shoreNoise(p/7.0);
  float resolved=1.0-smoothstep(.15*jitter,1.4*jitter,footprint);
  return (1.0-smoothstep(0.0,width,abs(d-centre)))*gaps*lace*resolved;
}
float breakerFoam(float d,float wave,vec2 p,float offset){
  if(d<0.0||d>45.0)return 0.0;
  float n=shoreNoise(p/16.0+offset),wide=.5+2.5*shoreNoise(p/8.0+vec2(7.0+offset,offset));
  float broken=clamp((n-.34)/.24,0.0,1.0);
  float delta=abs(d-(1.0+5.0*(1.0-wave)+offset));
  float body=max(0.0,1.0-delta/(wide*.5));
  float lace=.65+.35*shoreNoise(p*2.3);
  float tip=max(0.0,1.0-abs(d-(1.0+5.0*(1.0-wave)+offset-wide*.32))/.12);
  return min(1.0,body*.75+tip*.55)*broken*lace;
}
float tideLine(float d){return max(0.0,1.0-abs(d-${SEA_VIS.tide.toFixed(1)})/${SEA_VIS.tideWidth.toFixed(1)});}
`;

// W2c-9e2: sub-cell zero-height crossings replace whole-cell visual distances.
// The 9a audio field above deliberately retains its 16m sampling and semantics.
// Metres throughout: all wetness/foam/audio consumers sample physical distances, never cell indices.
export function shoreFieldCell(terrain) {
  const b=terrain.bounds,span=Math.max(b.maxX-b.minX,b.maxZ-b.minZ),c=SHORE_GRID;
  return span<=c.smallMapM?Math.max(c.minCellM,(terrain.cell??c.minCellM)*c.terrainCellGain,span/(c.maxSide-1)):c.legacyCellM;
}
export function createSignedShoreJob(terrain, {cell=shoreFieldCell(terrain),limit=240,shelter=true,sea:seaOptions,swell=true}={}) {
  if(!(cell>0)||!Number.isFinite(cell)||!(limit>0)||!Number.isFinite(limit))throw new RangeError('Invalid signed grid');
  validateSea(seaOptions);const directional=swell&&seaOptions!==undefined,withOpen=shelter||directional;
  const b=terrain.bounds,x0=b.minX,z0=b.minZ,w=Math.ceil((b.maxX-x0)/cell)+1,h=Math.ceil((b.maxZ-z0)/cell)+1;
  const data=new Float32Array(w*h),heights=new Float32Array(w*h),sea=new Uint8Array(w*h);
  const field={cell,x0,z0,w,h,data,maxX:b.maxX,maxZ:b.maxZ,signedDistanceAt:(x,z)=>sampleDistance(field,x,z)};
  const openness=withOpen?new Float32Array(w*h):null,openDistance=shelter?new Float32Array(w*h):null;
  const queue=shelter?new Uint32Array(w*h):null,visited=shelter?new Uint8Array(w*h):null;
  let head=0,tail=0,phase=0,cursor=0,work=0,sheltered=0,water=0,reduced=0;
  const directionPhase=shelter?10:5,phases=directionPhase+(directional?1:0);
  // Until the openness exists every water cell counts as open (the surf of the version before it), on the CPU as in the texture.
  if(withOpen){field.openness=openness;field.opennessAt=(x,z)=>phase===phases?sampleDistance(openField,x,z):1;}
  const openField=withOpen?{...field,data:openness}:null;
  if(directional)field.swellGain=new Float32Array(w*h).fill(1);
  function enqueue(k){if(!visited[k]&&sea[k]&&data[k]>=SHELTER.openM){visited[k]=1;queue[tail++]=k;}}
  // stop: the phase to halt before. 5 ends after the signed distance (the part the sea and the sand wait for).
  function step(budget=256,stop=phases){
    for(let n=0;n<budget&&phase<stop;n++,work++){
      if(phase===6){
        if(head===tail){phase++;cursor=0;continue;}
        const k=queue[head++],i=k%w,j=Math.floor(k/w);
        if(i)enqueue(k-1);if(i+1<w)enqueue(k+1);if(j)enqueue(k-w);if(j+1<h)enqueue(k+w);
        continue;
      }
      const k=phase===3||phase===8?data.length-1-cursor:cursor,i=k%w,j=Math.floor(k/w);
      if(phase===0){const x=Math.min(b.maxX,x0+i*cell),z=Math.min(b.maxZ,z0+j*cell);heights[k]=terrain.heightAt(x,z);sea[k]=heights[k]<=0&&terrain.isSea(x,z)?1:0;data[k]=limit;}
      else if(phase===1){
        // Seed each centre with the distance to the interpolated zero
        // crossing on its incident edges (not a whole-cell land/sea step).
        for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
          const a=i+dx,b=j+dz;if(a<0||a>=w||b<0||b>=h||(!dx&&!dz))continue;
          const q=b*w+a;if(sea[q]===sea[k]||heights[q]*heights[k]>0||heights[q]===heights[k])continue;
          const t=heights[k]/(heights[k]-heights[q]);
          data[k]=Math.min(data[k],Math.hypot(dx,dz)*cell*Math.abs(t));
        }
      }else if(phase===2){
        if(i)data[k]=Math.min(data[k],data[k-1]+cell);
        if(j)data[k]=Math.min(data[k],data[k-w]+cell,i?data[k-w-1]+cell*4/3:limit,i+1<w?data[k-w+1]+cell*4/3:limit);
      }else if(phase===3){
        if(i+1<w)data[k]=Math.min(data[k],data[k+1]+cell);
        if(j+1<h)data[k]=Math.min(data[k],data[k+w]+cell,i?data[k+w-1]+cell*4/3:limit,i+1<w?data[k+w+1]+cell*4/3:limit);
      }else if(phase===4)data[k]*=sea[k]?1:-1;
      else if(phase===5&&shelter){
        if(sea[k]&&data[k]>=SHELTER.openM&&(data[k]>=SHELTER.seaM||i===0||j===0||i===w-1||j===h-1))enqueue(k);
      }else if(phase===7){
        openDistance[k]=visited[k]?0:SHORE_LIMIT_M;
        if(i)openDistance[k]=Math.min(openDistance[k],openDistance[k-1]+cell);
        if(j)openDistance[k]=Math.min(openDistance[k],openDistance[k-w]+cell,i?openDistance[k-w-1]+cell*4/3:SHORE_LIMIT_M,i+1<w?openDistance[k-w+1]+cell*4/3:SHORE_LIMIT_M);
      }else if(phase===8){
        if(i+1<w)openDistance[k]=Math.min(openDistance[k],openDistance[k+1]+cell);
        if(j+1<h)openDistance[k]=Math.min(openDistance[k],openDistance[k+w]+cell,i?openDistance[k+w-1]+cell*4/3:SHORE_LIMIT_M,i+1<w?openDistance[k+w+1]+cell*4/3:SHORE_LIMIT_M);
      }else if(phase===9){
        const t=clamp((openDistance[k]-SHELTER.openM-SHELTER.edgeM)/SHELTER.fadeM,1);
        openness[k]=1-t*t*(3-2*t);
        if(sea[k]){water++;if(openness[k]<1)sheltered++;}
      }
      if(directional&&phase===directionPhase){
        let gain=1;
        if(sea[k]&&i>0&&i+1<w&&j>0&&j+1<h&&data[k]<limit){
          gain=swellFacing(data[k+1]-data[k-1],data[k+w]-data[k-w],seaOptions.swell_from_deg);
        }
        const before=shelter?openness[k]:1;
        openness[k]=before*gain;
        // Already sheltered water did not lose any surf: keep it purple in debug.
        field.swellGain[k]=before>openness[k]?gain:1;
        if(sea[k]){if(!shelter)water++;if(before>openness[k])reduced++;}
      }
      if(++cursor===data.length){cursor=0;phase++;}
    }
    return phase>=stop;
  }
  return {field,step,get done(){return phase===phases;},get distanceReady(){return phase>=5;},get work(){return work;},get shelteredFraction(){return water?sheltered/water:0;},get swellReducedFraction(){return water?reduced/water:0;}};
}

// W2c-9r1 shore: allocation-free CPU counterparts for distance acceptance.
export const SHORE_BANDS=Object.freeze([0,4.6,11.4]);
export const shore2Enabled=search=>new URLSearchParams(search).get('shore2')!=='0';
const smooth01=v=>{const u=Math.max(0,Math.min(1,v));return u*u*(3-2*u);};
export const shoreMoisture=(d,reach)=>1-smooth01(Math.max(0,d)/reach);
export const shoreDepthMix=d=>smooth01(Math.max(0,d)/32);
export function surfCentre(wave,x,z,band=0){return 1+band+4*(1-wave)+2.2*(shoreNoise(x/19+band,z/19+band)-.5);}
export function surfWidth(x,z,band=0){return 1.0+2.1*shoreNoise(x/9+band,z/9+band);}
export function surfFoam(d,wave,x,z,band=0){return (1-smooth01(Math.abs(d-surfCentre(wave,x,z,band))/surfWidth(x,z,band)))*smooth01((shoreNoise(x/11+band,z/11+band)-.30)/.34);}
export function riverPropAt(terrain,x,z){
  const d=terrain.riverDistanceAt(x,z,4);
  if(d<.05||d>3.5||terrain.isSea?.(x,z))return false;
  const slope=terrain.slopeAt?.(x,z)??Math.atan(Math.hypot((terrain.heightAt(x+.5,z)-terrain.heightAt(x-.5,z)),(terrain.heightAt(x,z+.5)-terrain.heightAt(x,z-.5))))*180/Math.PI;
  return slope<30&&shoreHash(x,z,108)<.6;
}

// W2c-9r2 shore: identical distance response for either bank; no side or world-axis term.
export const bankWetAlpha=d=>.68*(1-smooth01(Math.max(0,d)/1.5));
export const shoreBandWidth=(base,footprint)=>Math.max(base,Math.min(48,Math.max(0,footprint)*6));
export const shoreWetBand=(d,reach,footprint=0)=>shoreMoisture(d,shoreBandWidth(Math.max(.6,Math.min(1.5,reach*.18)),footprint*2));
export const riverFoamCentre=(x,z)=>.35+.38*shoreNoise(x/5.7,z/5.7);
export const riverFoamWidth=(x,z)=>.18+.36*shoreNoise(x/2.9+8,z/2.9+8);
export function riverBankFoam(d,x,z,time=0,footprint=0){
  const centre=riverFoamCentre(x,z),width=riverFoamWidth(x,z),jitter=.8+.4*shoreNoise(x/7,z/7);
  const gaps=smooth01((shoreNoise(x/3.7,z/3.7)-.43)/.22);
  const lace=.35+.65*smooth01((shoreNoise(x*2.1+time*.16,z*2.1-time*.23)-.32)/.4);
  return (1-smooth01(Math.abs(d-centre)/width))*gaps*lace*(1-smooth01((footprint-.15*jitter)/(1.25*jitter)));
}

// Waterline search is shared by the foam surface and the landward wet strip.
export function bankCrossingDistance(terrain,x,z,level,nx,nz,half){
  if(terrain.heightAt(x,z)>=level)return half;
  const limit=half+6;let lo=0,hi=.25;
  while(hi<limit&&terrain.heightAt(x+nx*hi,z+nz*hi)<level){lo=hi;hi+=.25;}
  hi=Math.min(hi,limit);
  if(terrain.heightAt(x+nx*hi,z+nz*hi)<level)return half;
  for(let n=0;n<10;n++){const mid=(lo+hi)/2;if(terrain.heightAt(x+nx*mid,z+nz*mid)<level)lo=mid;else hi=mid;}
  return hi;
}

export function shelteredEdgeFoam(distance,footprint=0){
  const width=Math.max(SHELTER.foamEdgeM,footprint),t=clamp(Math.abs(distance)/width,1);
  return SHELTER.foamGain*(1-t*t*(3-2*t))*SHELTER.foamEdgeM/width;
}
