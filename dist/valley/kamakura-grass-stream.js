// W2c-15 stream: distance-driven growth -> a constant, world-keyed inner disc.
// Pure rules; no renderer, clock, private data or mutable global state.
import { grassR5Jitter } from './kamakura-grass-r5.js';
import { tilesAround } from './grass-field.js';
import { GRASS } from './config.js';

export const grass9Enabled = search => new URLSearchParams(search).get('grass9') !== '0';
export const GRASS9_CHUNKS = Object.freeze({near:6,mid:6});
// Only a chunk that touches the constant disc is urgent. The 30-56 m ring is prefetch: a frame always builds at least one chunk, and the
// ring advances at ~25 chunks/s at 8 m/s, so 2 ms keeps ahead of it while the frame stays short.
export const grass9WorkBudget = (distance,radius=30) => distance<=radius?6:2;
export const GRASS9_DENSITY = .23;
// Display luminance a subpixel blade may reach (see kamakura-grass-stream-view.js); lit lawn pixels sit well below it.
export const GRASS9_THIN_CAP = '.32';
export const grass9Radius = (quality='standard', step=0) => step>=3?12:step>=2||quality==='light'?20:30;
const smooth=(a,b,d)=>{const t=Math.max(0,Math.min(1,(d-a)/(b-a)));return t*t*(3-2*t);};
export const grass9Blend = (x,z,d,r=30) => smooth(r+3,r+15,d+(grassR5Jitter(x,z)-.75)*6);
export const grass9DensityAt = (x,z,d,r=30) => 1-grass9Blend(x,z,d,r);
export const grass9Retain = (x,z) => (grassR5Jitter(x,z)-.75)*2 < GRASS9_DENSITY;
// Preparation only: retain complete records, preserving every dimension and pigment byte.
export function packGrassStream(data,kind) {
  if(kind!=='near')return data;
  let count=0;
  for(let i=0;i<data.length;i+=15)if(grass9Retain(data[i],data[i+2]))count++;
  const out=new Float32Array(count*15);let offset=0;
  for(let i=0;i<data.length;i+=15)if(grass9Retain(data[i],data[i+2]))
    for(let j=0;j<15;j++)out[offset++]=data[i+j];
  return out;
}
export function grass9Distance(c,x,z) {
  const size=GRASS9_CHUNKS.near;
  return Math.hypot(Math.max(c.cx*size-x,0,x-(c.cx+1)*size),Math.max(c.cz*size-z,0,z-(c.cz+1)*size));
}
export function grass9Ahead(x,z,vx=0,vz=0) {
  const speed=Math.hypot(vx,vz),lead=Math.min(60,speed*3+10);
  return {x:x+(speed?vx/speed*lead:0),z:z+(speed?vz/speed*lead:0),lead};
}
export function grass9Tiles(field,x,z,{quality='standard',radius=30,vx=0,vz=0}={}) {
  const scale=quality==='light'?.6:1,outer=radius+16;
  const reach={near:(outer+10)/scale,mid:GRASS9_MID_REACH,midInner:radius/scale};
  const current=tilesAround(field,x,z,{quality,reach}),ahead=grass9Ahead(x,z,vx,vz);
  // A swept corridor, not just a distant disc: a turn cannot leave a gap behind the tip.
  const keys=new Set(current.near.map(t=>t.key));
  for(let d=10;d<=ahead.lead;d+=10){const f=d/ahead.lead;
    const next=tilesAround(field,x+(ahead.x-x)*f,z+(ahead.z-z)*f,{quality,reach:{near:outer/scale,mid:0}});
    for(const t of next.near)if(!keys.has(t.key)){keys.add(t.key);current.near.push(t);}
  }
  return current;
}
export function grass9Queue(chunks,resident,x,z) {
  return chunks.near.filter(c=>!resident.has(c.key)).map(c=>({...c,dist:grass9Distance(c,x,z)}))
    .sort((a,b)=>a.dist-b.dist||a.key.localeCompare(b.key));
}
// Planning per chunk instead of per metre tile: the same near chunks as wantedChunks(grass9Tiles(...)).near, found by
// rectangle distance (a chunk is wanted exactly when one of its tiles is), without building ~12,000 tile objects per replan.
export function grass9NearChunks(field,x,z,{quality='standard',radius=30,vx=0,vz=0}={}) {
  const scale=quality==='light'?.6:1,outer=radius+16,size=GRASS9_CHUNKS.near*GRASS.nearSize,distance=GRASS.quality[quality].distance;
  const discs=[{x,z,r:(outer+10)/scale*distance}],ahead=grass9Ahead(x,z,vx,vz);
  for(let d=10;d<=ahead.lead;d+=10){const f=d/ahead.lead;discs.push({x:x+(ahead.x-x)*f,z:z+(ahead.z-z)*f,r:outer/scale*distance});}
  const found=new Map(),fx1=field.x0+field.nx,fz1=field.z0+field.nz;
  for(const disc of discs){
    const r2=disc.r*disc.r;
    for(let cz=Math.floor((disc.z-disc.r)/size);cz<=Math.floor((disc.z+disc.r)/size);cz++)
      for(let cx=Math.floor((disc.x-disc.r)/size);cx<=Math.floor((disc.x+disc.r)/size);cx++){
        const x0=cx*size,z0=cz*size;
        if(!(x0<fx1&&x0+size>field.x0&&z0<fz1&&z0+size>field.z0))continue;
        const dx=Math.max(x0-disc.x,0,disc.x-x0-size),dz=Math.max(z0-disc.z,0,disc.z-z0-size);
        if(dx*dx+dz*dz>r2)continue;
        const key=`near:${cx},${cz}`;
        if(!found.has(key))found.set(key,{cx,cz,key});
      }
  }
  return [...found.values()].map(c=>({...c,dist:grass9Distance(c,x,z)})).sort((a,b)=>a.dist-b.dist||a.cz-b.cz||a.cx-b.cx);
}
// Mid cards are planned per chunk as well. A chunk holds every tile it overlaps: the mid shader already zeroes cards inside the
// stream radius (alive *= grass9Blend) and beyond the mid radius (fadeOut = 1), so the tiles of a boundary chunk that the tile
// plan would have left out are never visible, and no per-tile active list is needed.
export const GRASS9_MID_REACH=158;
export function grass9MidChunks(field,x,z,{quality='standard',radius=30}={}) {
  const outer=GRASS9_MID_REACH*GRASS.quality[quality].distance,size=GRASS9_CHUNKS.mid*GRASS.midSize,fx1=field.x0+field.nx,fz1=field.z0+field.nz,out=[];
  for(let cz=Math.floor((z-outer)/size);cz<=Math.floor((z+outer)/size);cz++)
    for(let cx=Math.floor((x-outer)/size);cx<=Math.floor((x+outer)/size);cx++){
      const x0=cx*size,z0=cz*size;
      if(!(x0<fx1&&x0+size>field.x0&&z0<fz1&&z0+size>field.z0))continue;
      const dx=Math.max(x0-x,0,x-x0-size),dz=Math.max(z0-z,0,z-z0-size);
      if(dx*dx+dz*dz>outer*outer)continue;
      const fx=Math.max(Math.abs(x0-x),Math.abs(x0+size-x)),fz=Math.max(Math.abs(z0-z),Math.abs(z0+size-z));
      if(fx*fx+fz*fz<radius*radius)continue;
      out.push({cx,cz,key:`mid:${cx},${cz}`,dist:Math.hypot(dx,dz)});
    }
  return out.sort((a,b)=>a.dist-b.dist||a.cz-b.cz||a.cx-b.cx);
}
export const grass9Plan=(field,x,z,o)=>({near:grass9NearChunks(field,x,z,o),mid:grass9MidChunks(field,x,z,o)});
export const GRASS9_GLSL=`
float grass9Blend(vec2 p,float d){return smoothstep(uGrass9Radius+3.0,uGrass9Radius+15.0,d+(grass6Jitter(p)-.75)*6.0);}
`;
