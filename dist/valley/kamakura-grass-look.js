// W2c-9c: world-keyed ecology and packing; no scene, clock or random source.
import { fbm } from './terrain-height.js';
export const grassLookEnabled = search => new URLSearchParams(search).get('glook') !== '0';
const clamp = v => Math.max(0, Math.min(1, v));
const smooth = v => { const t = clamp(v); return t*t*(3-2*t); };
export const grassHash = (x,z,n=0) => { const v=Math.sin(x*127.1+z*311.7+n*74.7)*43758.5453; return v-Math.floor(v); };
export function grassEcology(x,z,{ river=Infinity, shade=0, house=Infinity, path=Infinity, sand=0, elevation=0, slopeBreak=0, seed=1333 }={}) {
  const wet=1-smooth(river/15), managed=1-smooth(Math.min(house/9,(path-2.5)/7.5));
  const broad=clamp(.5+.65*fbm(x/95,z/95,seed+701,2)+.25*fbm(x/21,z/21,seed+709,2));
  const dry=clamp(.12+.45*sand+.22*smooth(elevation/100)+.22*broad-.35*wet);
  const edge=smooth((path-2.5)/2.5), shadow=clamp(shade);
  // W2c-9c2: uncut margins keep tall tufts even where nearby lawns are managed.
  const refuge=clamp(Math.max(1-smooth(house/9),shadow,wet,slopeBreak));
  return { wet, dry, shade:shadow, managed, edge,
    midDensity:edge*(1.10+.55*broad)*(1+.65*refuge),
    density:edge*(.42+.58*broad)*(1-.65*shadow)*(1-.6*managed)*(1+.25*wet),
    height:(.5+.5*broad)*(1-.7*managed)*(1+.35*wet),
    flowers:clamp((fbm(x/23,z/23,seed+727,2)-.12)*1.8)*(1-shadow)*(1-.8*managed)*edge };
}
// W2c-9c3: 3–12m colonies, empty intervals, and uncut physical margins.
export const MID_BANDS = Object.freeze([
  Object.freeze({from:12,to:30,tall:.30,medium:.50,low:.20}),
  Object.freeze({from:30,to:70,tall:.20,medium:.80,low:0}),
  Object.freeze({from:70,to:120,tall:0,medium:1,low:0})
]);
export function grassColony(x,z,seed=1333) {
  return clamp(.5+1.5*fbm(x/12,z/12,seed+811,2)+.5*fbm(x/3,z/3,seed+821,2));
}
export function grassMargin({path=Infinity,house=Infinity,tree=Infinity,river=Infinity,townEdge=Infinity}={}) {
  const shoulder=path-2.5;
  return Math.max(+(shoulder>=.4-1e-9&&shoulder<=1.2+1e-9),+(house>=0&&house<=1.2),
    +(tree>=0&&tree<=1.2),+(river>.25&&river<=1.5),+(townEdge<=1.2));
}
// The same hash thresholds and dimensions are emitted into the mid vertex hook.
export function midGrassShape(x,z,distance,margin=0) {
  const u=grassHash(x,z,113),pick=grassHash(x,z,149),band=MID_BANDS[distance<30?0:distance<70?1:2];
  const kind=(margin&&distance<70)||pick<band.tall?'tall':pick<band.tall+band.medium?'medium':'low';
  const height=margin&&distance<70?.5+.3*u:kind==='tall'?.45+.30*u:kind==='medium'?.25+.15*u:.08+.12*u;
  return {kind,height,width:(kind==='tall'?.24:.50)*(.6+1.2*grassHash(x,z,151))};
}
// At the exact centre the radial direction is undefined: zero there; one maximum at r/3.
export function grassPush(distance,radius=.8) {
  if (!(radius>0) || distance<=0 || distance>=radius) return 0;
  const t=distance/radius; return 6.75*t*(1-t)*(1-t);
}
export const grassRecovery = seconds => (1+12*Math.max(0,seconds))*Math.exp(-12*Math.max(0,seconds));
const linear = v => v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
const greens=[[.34,.46,.20],[.48,.55,.27],[.64,.57,.35]].map(c=>c.map(linear));
const blooms=[[.78,.77,.65],[.78,.65,.27],[.43,.43,.60]].map(c=>c.map(linear));
// Called during chunk preparation only. Extra roots share the original chunk buffers.
export function packGrassLook(data,kind,ecology,quality='standard') {
  const near=kind==='near', records=[], seen=new Set(), cells=new Map();
  for(let i=0;i<data.length;i+=15) {
    const a=Array.from(data.subarray(i,i+15)), x=a[0],z=a[2], key=`${Math.floor(x)},${Math.floor(z)}`, e=cells.get(key)??ecology(Math.floor(x)+.5,Math.floor(z)+.5,near), h=grassHash(x,z,113);
    cells.set(key,e);
    const hue=grassHash(x,z,109), dry=clamp(e.dry+(hue-.5)*.12), gold=greens[2], variation=.82+.28*grassHash(x,z,119);
    for(let j=0;j<3;j++) {const fresh=greens[0][j]*(1-hue*.35)+greens[1][j]*hue*.35; a[8+j]=(fresh*(1-dry)+gold[j]*dry)*variation*(1-.35*e.shade);}
    if(near) {
      a[12]=e.normalX??0;a[13]=e.normalY??1;a[14]=e.normalZ??0;
      a[4]=e.margin ? .5+.3*h : Math.max(a[4],Math.min(.60,(.20+.40*h)*e.height)); a[5]=Math.max(a[5],.030+.018*grassHash(x,z,127)); a[6]=.18+.55*grassHash(x,z,131); a[11]=0;
      // Brown seed heads reuse the upper ribbon of a minority of tall blades.
      if(h>.92){a[11]=-3;a[5]=.032;}
      records.push(a);
      if(quality!=='light') {const low=a.slice(); low[1]+=.012;low[3]+=Math.PI*.65;low[4]=.04+.08*h;low[5]=.025+.018*h;low[6]=.6;low[11]=-1;records.push(low);}
      if(!seen.has(key)) {
        seen.add(key);
        if(grassHash(Math.floor(x),Math.floor(z),137)<e.flowers*(quality==='light'?.5:1)) {
          const flower=a.slice(), c=blooms[Math.floor(grassHash(x,z,139)*3)];
          flower[4]=.12+.12*h;flower[5]=.065;flower[6]=.15;flower[11]=-2;
          for(let j=0;j<3;j++)flower[8+j]=c[j]; records.push(flower);
        }
      }
    } else {
      // W2c-9c3: retain leaf silhouettes, not wide identical round cushions.
      const shape=midGrassShape(x,z,20,e.margin);
      // Include the buried 12cm so even low clumps emerge above the soil.
      a[4]=shape.height+MID_GRASS.sink; a[5]=shape.width;
      a[11]=e.margin ? -1 : grassHash(x,z,149); a[14]=h;
      a[12]=(.5-grassHash(x,z,157))*.16;
      const variation=.6+1.2*grassHash(x,z,163);
      for(let j=0;j<3;j++) a[8+j]=Math.max(MID_GRASS.floor,a[8+j]*.70*variation);
      records.push(a);
    }
  }
  const out=new Float32Array(records.length*15);for(let i=0;i<records.length;i++)out.set(records[i],i*15);return out;
}
// Index paths once; reuse the live eight-metre collision buckets for shade/maintenance.
export function createGrassEnvironment(terrain,{ colliders, extraColliders, paths={}, surfaceCodeAt }={}) {
  const routes=new Map(), key=(x,z)=>`${x},${z}`;
  for(const path of Object.values(paths))for(let i=1;i<path.xyz_m.length;i++) {
    const a=path.xyz_m[i-1],b=path.xyz_m[i],segment={x:a[0],z:-a[1],dx:b[0]-a[0],dz:a[1]-b[1]};
    for(let z=Math.floor((Math.min(-a[1],-b[1])-10)/64);z<=Math.floor((Math.max(-a[1],-b[1])+10)/64);z++)
      for(let x=Math.floor((Math.min(a[0],b[0])-10)/64);x<=Math.floor((Math.max(a[0],b[0])+10)/64);x++){
        const k=key(x,z);if(!routes.has(k))routes.set(k,[]);routes.get(k).push(segment);
      }
  }
  // W2c-9p: metre ecology is shared by window preparation and near/mid packing.
  // The view prunes to its bounded window; normal work stays lazy and near-only.
  const cache=new Map(), buckets=new Map(), layers=[colliders,extraColliders];
  const environment=(x,z,withNormal=false,river)=>{
    const id=key(x,z);let e=cache.get(id);
    if(!e) {
    let path=Infinity,house=Infinity,tree=Infinity,shade=0;
    for(const a of routes.get(key(Math.floor(x/64),Math.floor(z/64)))||[]) {
      const t=clamp(((x-a.x)*a.dx+(z-a.z)*a.dz)/(a.dx*a.dx+a.dz*a.dz||1));
      path=Math.min(path,Math.hypot(x-a.x-t*a.dx,z-a.z-t*a.dz));
    }
    // A collider occupies several buckets; shade/house minima need each only once.
    const bx=Math.floor((x-12)/8),bz=Math.floor((z-12)/8),bucketKey=key(bx,bz);
    let candidates=buckets.get(bucketKey);
    if(!candidates){
      const unique=new Set();
      for(let j=bz;j<=Math.floor((z+12)/8);j++)for(let i=bx;i<=Math.floor((x+12)/8);i++)
        for(const col of layers)for(const o of col?.grid.get(key(i,j))||[])unique.add(o);
      candidates=[...unique];buckets.set(bucketKey,candidates);
    }
    for(const o of candidates) {
      if(o.type==='circle'){const d=Math.hypot(x-o.x,z-o.z)-o.r;tree=Math.min(tree,d);shade=Math.max(shade,1-smooth(d/Math.min(10,Math.max(3,o.height*.4))));}
      else {const dx=x-o.x,dz=z-o.z,d=Math.hypot(Math.max(0,Math.abs(dx*o.c-dz*o.s)-o.hx),Math.max(0,Math.abs(dx*o.s+dz*o.c)-o.hz));house=Math.min(house,d);shade=Math.max(shade,.65*(1-smooth(d/8)));}
    }
    const riverDistance=river??terrain.riverDistanceAt(x,z,15),slope=terrain.slopeAt?.(x,z)??0;
    let townEdge=Infinity;
    const code=surfaceCodeAt?.(x,z);
    // Dirt/grass transitions describe town lanes without a private path map.
    if(code===0||code===2)for(const [dx,dz] of [[.75,0],[-.75,0],[0,.75],[0,-.75],[1.2,0],[-1.2,0],[0,1.2],[0,-1.2]]) {
      const other=surfaceCodeAt(x+dx,z+dz);
      if((code===0&&other===2)||(code===2&&other===0))townEdge=Math.min(townEdge,Math.hypot(dx,dz));
    }
    const margin=grassMargin({path,house,tree,river:riverDistance,townEdge});
    e=grassEcology(x,z,{river:riverDistance,path,house,shade,sand:1-smooth((terrain.seaDistanceAt?.(x,z)??Infinity)/40),elevation:terrain.heightAt(x,z),slopeBreak:smooth(slope/24)});
    // A positive local crest suppresses ridge rows; bowls retain their colonies.
    const crest=Math.max(0,terrain.heightAt(x,z)-(terrain.heightAt(x-4,z)+terrain.heightAt(x+4,z)+terrain.heightAt(x,z-4)+terrain.heightAt(x,z+4))/4);
    e.margin=margin;e.colony=grassColony(x,z);
    // W2c-9r2 grass: expose physical refuge/crest distances to the band placement rule.
    e.tree=tree;e.house=house;e.river=riverDistance;e.crest=crest;
    const colonyWeight=e.colony>.53 ? 1.55 : e.colony>.40 ? .35 : .025;
    e.midDensity*=Math.max(margin?1.8:0,colonyWeight)*(1-.8*smooth((slope-30)/2))*(1-.65*smooth(crest/1.5));
    if(code===0)e.midDensity*=margin?1:.15;
    // Grassland preserves the pre-9b leaf-density floor; soil stays trampled.
    e.nearDensity=code===2?Math.max(1,e.density):e.density;
    if(margin){e.nearDensity=Math.max(e.nearDensity,1.15);e.midDensity=Math.max(e.midDensity,2);}
    cache.set(id,e);
    }
    if(withNormal && e.normalY===undefined){const nx=terrain.heightAt(x-.5,z)-terrain.heightAt(x+.5,z),nz=terrain.heightAt(x,z-.5)-terrain.heightAt(x,z+.5),length=Math.hypot(nx,1,nz);e.normalX=nx/length;e.normalY=1/length;e.normalZ=nz/length;}
    return e;
  };
  let retained=null;
  environment.retain=(f)=>{
    // No cache-wide scan on a streaming frame. Expansion keeps warm entries;
    // movement starts a bounded generation, while resident geometry keeps its bytes.
    if(!retained || f.x0>retained.x0 || f.z0>retained.z0 || f.x0+f.nx<retained.x0+retained.nx || f.z0+f.nz<retained.z0+retained.nz)cache.clear();
    buckets.clear();retained={x0:f.x0,z0:f.z0,nx:f.nx,nz:f.nz};
  };
  environment.dispose=()=>{cache.clear();buckets.clear();};
  return environment;
}

// W2c-9c2: shaded clumps retain separation from the mean ground, including dusk.
export const MID_GRASS = Object.freeze({groundScale:.68, blend:.40, floor:.035, sink:.12, maxSlope:36});
export function grassGroundTint(rgb) { return rgb.map(v=>Math.max(MID_GRASS.floor,v*MID_GRASS.groundScale)); }
