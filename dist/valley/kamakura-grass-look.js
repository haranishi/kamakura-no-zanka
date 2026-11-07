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
      a[4]=Math.min(.60,(.20+.40*h)*e.height); a[5]=.018+.024*grassHash(x,z,127); a[6]=.18+.55*grassHash(x,z,131); a[11]=0;
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
      // W2c-9c2: 35–70cm tufts, independent widths and lean; never a dry ridge shard.
      a[4]=.35+.35*h; a[5]=.65+.65*grassHash(x,z,151);
      a[12]=(.5-grassHash(x,z,157))*.16;
      for(let j=0;j<3;j++) a[8+j]=Math.max(MID_GRASS.floor,a[8+j]*.55);
      records.push(a);
    }
  }
  const out=new Float32Array(records.length*15);for(let i=0;i<records.length;i++)out.set(records[i],i*15);return out;
}
// Index paths once; reuse the live eight-metre collision buckets for shade/maintenance.
export function createGrassEnvironment(terrain,{ colliders, extraColliders, paths={} }={}) {
  const routes=new Map(), key=(x,z)=>`${x},${z}`;
  for(const path of Object.values(paths))for(let i=1;i<path.xyz_m.length;i++) {
    const a=path.xyz_m[i-1],b=path.xyz_m[i],segment={x:a[0],z:-a[1],dx:b[0]-a[0],dz:a[1]-b[1]};
    for(let z=Math.floor((Math.min(-a[1],-b[1])-10)/64);z<=Math.floor((Math.max(-a[1],-b[1])+10)/64);z++)
      for(let x=Math.floor((Math.min(a[0],b[0])-10)/64);x<=Math.floor((Math.max(a[0],b[0])+10)/64);x++){
        const k=key(x,z);if(!routes.has(k))routes.set(k,[]);routes.get(k).push(segment);
      }
  }
  return (x,z,withNormal=false)=>{
    let path=Infinity,house=Infinity,shade=0;
    for(const a of routes.get(key(Math.floor(x/64),Math.floor(z/64)))||[]) {
      const t=clamp(((x-a.x)*a.dx+(z-a.z)*a.dz)/(a.dx*a.dx+a.dz*a.dz||1));
      path=Math.min(path,Math.hypot(x-a.x-t*a.dx,z-a.z-t*a.dz));
    }
    for(let j=Math.floor((z-12)/8);j<=Math.floor((z+12)/8);j++)for(let i=Math.floor((x-12)/8);i<=Math.floor((x+12)/8);i++)
      for(const col of [colliders,extraColliders])for(const o of col?.grid.get(key(i,j))||[]) {
        if(o.type==='circle')shade=Math.max(shade,1-smooth((Math.hypot(x-o.x,z-o.z)-o.r)/Math.min(10,Math.max(3,o.height*.4))));
        else {const dx=x-o.x,dz=z-o.z,d=Math.hypot(Math.max(0,Math.abs(dx*o.c-dz*o.s)-o.hx),Math.max(0,Math.abs(dx*o.s+dz*o.c)-o.hz));house=Math.min(house,d);shade=Math.max(shade,.65*(1-smooth(d/8)));}
      }
    const e=grassEcology(x,z,{river:terrain.riverDistanceAt(x,z,15),path,house,shade,sand:1-smooth((terrain.seaDistanceAt?.(x,z)??Infinity)/40),elevation:terrain.heightAt(x,z),slopeBreak:terrain.slopeAt ? smooth(terrain.slopeAt(x,z)/24) : 0});
    if(withNormal){const nx=terrain.heightAt(x-.5,z)-terrain.heightAt(x+.5,z),nz=terrain.heightAt(x,z-.5)-terrain.heightAt(x,z+.5),length=Math.hypot(nx,1,nz);e.normalX=nx/length;e.normalY=1/length;e.normalZ=nz/length;}
    return e;
  };
}

// W2c-9c2: shaded clumps retain separation from the mean ground, including dusk.
export const MID_GRASS = Object.freeze({groundScale:.68, blend:.40, floor:.035, sink:.12, maxSlope:36});
export function grassGroundTint(rgb) { return rgb.map(v=>Math.max(MID_GRASS.floor,v*MID_GRASS.groundScale)); }
