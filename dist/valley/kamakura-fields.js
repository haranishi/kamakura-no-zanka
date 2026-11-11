// Seeded, world-keyed colonies. No private terrain values or mutable global state.
import { createSurfaceCodeAt } from './kamakura-surface.js';
import { fbm } from './terrain-height.js';
import { kamakuraPaths } from './kamakura-roads.js';
import { pathRadius } from './kamakura-ground-path.js';
export const FIELD_KINDS = Object.freeze(['susuki', 'kikyo', 'ominaeshi', 'yamayuri', 'hamahirugao']);
export const FIELD_NAMES = Object.freeze(['ススキ', '桔梗', '女郎花', '山百合', '浜昼顔']);
// Clumps per square metre. One card draws a clump of several stems, so these are lower than a count of single stems would be.
export const FIELD_DENSITIES = Object.freeze([.9, 2.5, 2.5, .35, 1.2]);
export const FIELDS = Object.freeze({ seed: 1618, cell: 10, radius: 70, lightRadius: 45, budgetMs: 1.5, work: 384, cellsPerFrame: 4, maxInstances: 40000, maxTriangles: 150000, maxDraws: 6 });
export const fieldHash = (x,z,seed=FIELDS.seed) => { let n=Math.imul(x|0,374761393)^Math.imul(z|0,668265263)^(seed|0); n=Math.imul(n^(n>>>13),1274126177); return ((n^(n>>>16))>>>0)/4294967296; };
const clamp=v=>Math.max(0,Math.min(1,v));
export const fieldSmooth = (a,b,v) => {const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
export function fieldOptions(search='') {
  const q=new URLSearchParams(search),s=q.get('fields'),n=Number(s),seed=Number(q.get('fieldseed'));
  return { enabled:!(s?.trim()&&n===0), density:s?.trim()&&Number.isFinite(n)?Math.max(.25,Math.min(3,n)):1,
    seed:q.has('fieldseed')&&Number.isSafeInteger(seed)?seed:FIELDS.seed, debug:q.get('fieldsdebug')==='1' };
}
// A map may thin or thicken its wild flowers: meta.fields.density multiplies the density (1 = as it is). Seen from an overlook at
// dusk, white lilies at full density along every verge read as noise. `&fields=` in the address still wins (for tuning and captures).
export const FIELD_MAP_DENSITY = Object.freeze({ min: .1, max: 3 }); // multipliers a map may ask for
export function fieldMapDensity(meta, search='') {
  if (new URLSearchParams(search).get('fields')?.trim()) return 1;
  const f=meta?.fields; if(f===undefined)return 1;
  if(!f||typeof f!=='object'||Array.isArray(f)||Object.keys(f).some(key=>key!=='density')||!Number.isFinite(f.density)||f.density<FIELD_MAP_DENSITY.min||f.density>FIELD_MAP_DENSITY.max)throw new RangeError('Invalid meta.fields');
  return f.density;
}
// Path buckets are independent of the grass environment's growing metre cache.
export function createFieldMap({terrain,habitat,data={},colliders,seed=FIELDS.seed}) {
  const routes=new Map(),weights={};
  const codeAt=createSurfaceCodeAt(data.meta??{grid:{width:0,height:0,cell_m:1}},data.surface);
  // Pass paths and, where the data has them, the roads: nothing grows within half a metre of the trodden width.
  for(const path of Object.values(kamakuraPaths(data)||{}))for(let i=1;i<path.xyz_m.length;i++) {
    const a=path.xyz_m[i-1],b=path.xyz_m[i],clear=pathRadius(path)+.5,line={x:a[0],z:-a[1],dx:b[0]-a[0],dz:a[1]-b[1],clear};
    for(let iz=Math.floor((Math.min(-a[1],-b[1])-clear)/64);iz<=Math.floor((Math.max(-a[1],-b[1])+clear)/64);iz++)
      for(let ix=Math.floor((Math.min(a[0],b[0])-clear)/64);ix<=Math.floor((Math.max(a[0],b[0])+clear)/64);ix++) {
        const key=`${ix},${iz}`;if(!routes.has(key))routes.set(key,[]);routes.get(key).push(line);
      }
  }
  function patchStrength(x,z,padding=0) {
    const gx=Math.floor(x/180),gz=Math.floor(z/180);let best=0;
    const edge=fbm(x/13,z/13,seed+31,2)*4+fbm(x/63,z/63,seed+37,2)*5;
    for(let j=gz-1;j<=gz+1;j++)for(let i=gx-1;i<=gx+1;i++) {
      const px=(i+.2+.6*fieldHash(i,j,seed+11))*180,pz=(j+.2+.6*fieldHash(i,j,seed+19))*180;
      const radius=34+fieldHash(i,j,seed+29)*24;
      best=Math.max(best,1-fieldSmooth(radius-8,radius,Math.hypot(x-px,z-pz)+edge-padding));
    }
    return best;
  }
  function allowed(x,z,w) {
    const b=terrain.bounds;
    if(b&&(x<b.minX||x>b.maxX||z<b.minZ||z>b.maxZ))return false;
    if(w.town>.5||terrain.waterAt?.(x,z)>0||terrain.slopeAt?.(x,z)>30||(terrain.riverDistanceAt?.(x,z,30)??Infinity)<=2)return false;
    const surface=codeAt(x,z);
    if((w.temple>0&&w.bare>.4)||surface===4||surface===6||surface===7||surface===5)return false;
    for(const p of routes.get(`${Math.floor(x/64)},${Math.floor(z/64)}`)||[]) {
      const t=clamp(((x-p.x)*p.dx+(z-p.z)*p.dz)/(p.dx*p.dx+p.dz*p.dz||1));
      if(Math.hypot(x-p.x-t*p.dx,z-p.z-t*p.dz)<=p.clear)return false;
    }
    // Expanded box query includes adjacent buckets, including rotated facilities.
    if(colliders?.grid)for(let j=Math.floor((z-1.5)/8);j<=Math.floor((z+1.5)/8);j++)for(let i=Math.floor((x-1.5)/8);i<=Math.floor((x+1.5)/8);i++)
      for(const o of colliders.grid.get(`${i},${j}`)||[])if(o.type==='box') {
        const dx=x-o.x,dz=z-o.z;
        if(Math.hypot(Math.max(0,Math.abs(dx*o.c-dz*o.s)-o.hx),Math.max(0,Math.abs(dx*o.s+dz*o.c)-o.hz))<=1.5)return false;
      }
    return true;
  }
  function fieldAt(x,z,out={}) {
    out.kind=null;out.strength=0;
    const strength=patchStrength(x,z);if(strength<=0)return out;
    habitat.at(x,z,weights);if(!allowed(x,z,weights))return out;
    const sea=terrain.seaDistanceAt?.(x,z)??Infinity,river=terrain.riverDistanceAt?.(x,z,30)??Infinity;
    let kind=null;
    if(weights.sand>.5&&sea>=12&&sea<=80)kind='hamahirugao';
    else if(weights.meadow>0&&weights.forest>=.2&&weights.forest<=.7)kind='yamayuri';
    else if(weights.meadow>=.5&&weights.sand<.5) {
      const pick=fieldHash(Math.floor(x/300),Math.floor(z/300),seed+47);
      kind=pick<.5&&river>=25?'susuki':pick<.75?'kikyo':'ominaeshi';
    }
    if(kind){out.kind=kind;out.strength=strength;}
    return out;
  }
  return {fieldAt, mayIntersect:(cx,cz)=>patchStrength(cx*10+5,cz*10+5,12)>0};
}
// Half-open ten-metre cells; candidate positions remain identical under density changes.
export function createFieldCell(map,cx,cz,{seed=FIELDS.seed,density=1}={}) {
  return {cx,cz,key:`${cx},${cz}`,cursor:0,total:map.mayIntersect(cx,cz)?2400:0,records:[],seed,density,done:false,scratch:{}};
}
export function stepFieldCell(map,job,work=FIELDS.work) {
  const end=Math.min(job.total,job.cursor+work);
  for(;job.cursor<end;job.cursor++) {
    const i=job.cursor,s=job.seed+Math.imul(i+1,1013),x=job.cx*10+10*fieldHash(job.cx,job.cz,s),z=job.cz*10+10*fieldHash(job.cx,job.cz,s+3);
    const f=map.fieldAt(x,z,job.scratch),kind=FIELD_KINDS.indexOf(f.kind);
    if(kind<0||fieldHash(job.cx,job.cz,s+5)>=FIELD_DENSITIES[kind]*job.density*f.strength/24)continue;
    job.records.push({x,z,kind,scale:.75+.5*fieldHash(job.cx,job.cz,s+7),yaw:fieldHash(job.cx,job.cz,s+11)*Math.PI*2,
      tint:.88+.24*fieldHash(job.cx,job.cz,s+13),hue:(fieldHash(job.cx,job.cz,s+17)-.5)*.035,variant:fieldHash(job.cx,job.cz,s+19)});
  }
  job.done=job.cursor===job.total;return job.done;
}
export function fieldLodScale(distance,radius=FIELDS.radius) {
  return 1-fieldSmooth(radius-10,radius,distance);
}
