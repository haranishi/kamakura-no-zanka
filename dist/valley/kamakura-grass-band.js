// W2c-9r1 grass: two abrupt tiers -> overlapping world-keyed distance bands.
import { FERN, SUSUKI } from './grass-field.js';
import { grassHash, grassColony } from './kamakura-grass-look.js';
import { shoreNoise, SEA_VIS } from './kamakura-shore.js';
export const grassBandEnabled = search => new URLSearchParams(search).get('gband') !== '0';
const smooth = (a,b,v) => { const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t); };
// Low-frequency displacement prevents circular/horizontal contours, without camera-keyed randomness.
export const grassBandOffset = (x,z) => 4*(shoreNoise(x/13,z/13)-.5);
export const nearGrassDensityAt = (x,z,dist) => { const d=dist+grassBandOffset(x,z);return (1-smooth(12,23,d))*(1-.8*smooth(6,18,d)); };
export const midGrassDensityAt = (x,z,dist) => {
  const d=dist+midGrassBandOffset(x,z)*smooth(30,70,dist);
  return smooth(6,18,d)*(1-.50*smooth(28,110,d))*(1-smooth(80,144,d));
};
// W2c-9r2 grass: ±2m end contour -> two-scale ±14m, long sparse tail.
export const midGrassBandOffset = (x,z) => 20*(shoreNoise(x/27,z/27)-.5)+8*(shoreNoise(x/7,z/7)-.5);
// Ground's public handoff API: x/z are horizontal world metres, dist is camera distance.
// Caller multiplies by its habitat mask (sand, paving and water must remain ground).
export const grassTintAt = (x,z,dist) => smooth(70,125,dist+grassBandOffset(x,z));
export const GRASS_BAND_GLSL = `
float grassBandHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float grassBandNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(grassBandHash(i),grassBandHash(i+vec2(1.0,0.0)),f.x),mix(grassBandHash(i+vec2(0.0,1.0)),grassBandHash(i+vec2(1.0)),f.x),f.y);}
float grassBandOffset(vec2 p){return 4.0*(grassBandNoise(p/13.0)-.5);}
float midGrassBandOffset(vec2 p){return 20.0*(grassBandNoise(p/27.0)-.5)+8.0*(grassBandNoise(p/7.0)-.5);}
float nearGrassDensity(float d){return (1.0-smoothstep(12.0,23.0,d))*(1.0-.8*smoothstep(6.0,18.0,d));}
float midGrassDensity(float d){return smoothstep(6.0,18.0,d)*(1.0-.50*smoothstep(28.0,110.0,d))*(1.0-smoothstep(80.0,144.0,d));}
`;
// Rectangles are the actual facilityFootprint bounds prepared by kamakura-facilities.js.
export function facilityGrassAt(x,z,boxes=[]) {
  let distance=Infinity;
  for(const b of boxes){const c=Math.cos(b.rotY??0),s=Math.sin(b.rotY??0),dx=x-b.x,dz=z-b.z;
    distance=Math.min(distance,Math.hypot(Math.max(0,Math.abs(dx*c-dz*s)-b.w/2),Math.max(0,Math.abs(dx*s+dz*c)-b.d/2)));}
  return smooth(0,4,distance);
}
// Sand: continuous colony core + sparse fringe; no roots within maximum swash reach.
// W2c-9r2 grass: doubly sparse singles -> broader colonies with a compact core.
export const sandGrassAt = (x,z,shoreDistance,refuge=0,crest=0) =>
  smooth(SEA_VIS.reach+1,26,shoreDistance)*Math.max(refuge,
    2.2*smooth(.30,.78,grassColony(x*.75,z*.75)+.12*smooth(0,.4,crest)));
export function createGrassBandCell(cell,terrain,{surfaceCodeAt,facilityBoxes=[],environmentAt}={}) {
  // Inflate by the rotated half-cell diagonal, then index once (never scan all facilities per cell).
  const buckets=new Map(),empty=[];
  for(const b of facilityBoxes){const box={...b,w:b.w+Math.SQRT2,d:b.d+Math.SQRT2},r=Math.hypot(box.w,box.d)/2+4;
    for(let j=Math.floor((b.z-r)/64);j<=Math.floor((b.z+r)/64);j++)for(let i=Math.floor((b.x-r)/64);i<=Math.floor((b.x+r)/64);i++){const key=`${i},${j}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(box);}}
  return (ix,iz) => {
    const v=cell(ix,iz);if(!v.placeable)return v;
    const x=ix+.5,z=iz+.5,code=surfaceCodeAt(x,z);
    // Conservative whole-cell exclusions stop jittered roots crossing paving or wet sand.
    const local=buckets.get(`${Math.floor(x/64)},${Math.floor(z/64)}`)??empty;
    const facility=facilityGrassAt(x,z,local);let shore=Infinity;
    for(let j=0;j<=1;j++)for(let i=0;i<=1;i++){
      shore=Math.min(shore,terrain.seaDistanceAt?.(ix+i,iz+j)??Infinity);
    }
    const e=environmentAt?.(x,z),tree=e?.tree??Infinity,house=e?.house??Infinity,river=e?.river??Infinity;
    // Whole-cell exclusion remains authoritative; the outer trunk ring starts at 0.5m.
    const root=tree>=.5&&tree<=1.5?1:0,base=house>0&&house<=2.5?1:0;
    const bank=smooth(.25,1,river)*(1-smooth(18,25,river));
    const refuge=Math.max(root,base,bank),crest=e?.crest??0;
    const habitat=facility*(code===0?sandGrassAt(x,z,shore,refuge*.85,crest):1);
    if(terrain.slopeAt(x,z)>=35 || !habitat){v.placeable=0;v.density=0;v.midPatch=0;return v;}
    v.density=Math.min(255,Math.round(Math.max(v.density,refuge*145)*habitat));
    if(code===3||root||base)v.species=FERN;
    else if(bank)v.species=grassHash(x,z,947)<.45?FERN:SUSUKI;
    // Dense grassland, sparse fern litter, clustered sand; no hard colony thresholds.
    const colony=.12+1.5*grassColony(x,z),scale=code===2?1:code===3?.24:code===0?.8:.38;
    // R1 overwrote ecology's root/bank boosts AND ridge suppression here.
    const ridge=(1-.8*smooth(30,32,terrain.slopeAt(x,z)))*(1-.85*smooth(0,1.2,crest));
    // Sand keeps its local card rate as the extended grassland band is thinned.
    v.midPatch=Math.min(1.8,Math.max(colony*scale,refuge*1.8)*habitat)*ridge*(code===0?2:1);
    v.placeable=+(v.density>0||v.midPatch>0);
    return v;
  };
}
// Chunk preparation only: crossed multi-leaf cards already form a tuft; vary its burial and crown.
export function packGrassBands(data,kind) {
  if(kind!=='mid')return data;
  for(let i=0;i<data.length;i+=15){const x=data[i],z=data[i+2],h=grassHash(x,z,907);
    data[i+1]-=.04*grassHash(x,z,911);data[i+4]*=.82+.36*h;
    data[i+5]*=.85+.3*grassHash(x,z,919);data[i+12]=(.5-grassHash(x,z,929))*.22;
    // Shared shader marker: crown scale survives distance-dependent height selection.
    data[i+14]=h;
  }
  return data;
}
