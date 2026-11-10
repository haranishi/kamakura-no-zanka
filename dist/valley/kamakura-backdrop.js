// W2c-18 seaedge: static exterior land only, independent of the walking/collision world.
import { shoreNoise } from './kamakura-shore.js';
import { standColor } from './kamakura-stands.js';
// The far crowns were brightened after the overlook check (STANDS2.gain in the stand view); the land beyond the map follows that tone.
const CANOPY_LIFT=Object.freeze([1.75,1.6,1.3]);
const canopy=standColor({id:0,sourceSpecies:0,tint:0}).map((v,i)=>v*CANOPY_LIFT[i]);
export const BACKDROP = Object.freeze({
  extentM: 30000, nearExtentM: 6000, // metres from the rectangular terrain boundary.
  nearCellM: 160, farCellM: 640, // maximum grid pitches (seams share the finer row).
  blendM: 800, landThresholdM: .5, minHeightM: 2, // endpoint match, procedural blend, land clearance.
  nearMinM: 60, nearMaxM: 160, farMinM: 250, farMaxM: 600, // procedural mountain envelopes.
  farHeightStartM: 15000, // metres: distant envelope reaches its full height.
  northGain: .2, // fraction of extra height from south to north.
  ridgeScaleM: 2800, valleyScaleM: 950, ridgeWeight: .7,
  noiseOffset: 13, // noise cells: decorrelate valleys from the broad ridge. // metre scales and broad ridge weighting.
  shadeScaleM: 560, shadeContrast: .1, // metres and ±fraction of canopy colour.
  canopy: Object.freeze(canopy), // linear RGB from the existing distant forest source.
  debugNear: 0xff00ff, debugFar: 0xffff00, // flat near magenta / far yellow.
  seamSnapM: .01, // metres: round boundary vertices outward before Float32 storage.
  maxTriangles: 60000, maxDraws: 2, // hard construction limits.
  adaptRangesM: Object.freeze([30000,18000,3000,1600]), // adapt 0..3 distance (metres).
  lightRangeM: 6000, // metres: light quality omits the outer grid.
});
const C=BACKDROP,clamp=x=>Math.max(0,Math.min(1,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
export const backdropEnabled=search=>new URLSearchParams(search).get('backdrop')!=='0';
export const backdropRange=(quality='standard',step=0)=>Math.min(quality==='light'?C.lightRangeM:C.extentM,C.adaptRangesM[Math.max(0,Math.min(3,step))]);
// Projection to the nearest boundary segment; outside a corner both segments meet at the same endpoint.
export function backdropPoint(terrain,x,z,out={}) {
  const b=terrain.bounds,px=Math.max(b.minX,Math.min(b.maxX,x)),pz=Math.max(b.minZ,Math.min(b.maxZ,z));
  const dx=Math.abs(x-px),dz=Math.abs(z-pz),distance=Math.hypot(dx,dz);
  out.inside=x>b.minX&&x<b.maxX&&z>b.minZ&&z<b.maxZ;
  out.edge=dx>dz?(x<b.minX?'west':'east'):(z<b.minZ?'north':'south');
  out.distance=distance;out.edgeHeight=terrain.heightAt(px,pz);out.land=out.edgeHeight>=C.landThresholdM&&!out.inside;
  if(!out.land){out.height=0;return out;}
  const ridge=1-Math.abs(2*shoreNoise(x/C.ridgeScaleM,z/C.ridgeScaleM)-1);
  const valley=shoreNoise(x/C.valleyScaleM+C.noiseOffset,z/C.valleyScaleM+C.noiseOffset);
  const n=C.ridgeWeight*ridge+(1-C.ridgeWeight)*valley;
  const far=smooth(0,C.farHeightStartM,distance);
  const lo=C.nearMinM+(C.farMinM-C.nearMinM)*far,hi=C.nearMaxM+(C.farMaxM-C.nearMaxM)*far;
  const north=1-clamp((pz-b.minZ)/(b.maxZ-b.minZ));
  const mountain=lo+(hi-lo)*clamp(n+C.northGain*(north-.5));
  // Exact terrain seam takes precedence for a rare edge sample below the 2m clearance.
  out.height=distance===0?out.edgeHeight:Math.max(C.minHeightM,out.edgeHeight+(mountain-out.edgeHeight)*smooth(0,C.blendM,distance));
  return out;
}
function edgeProfile(terrain,edge,work) {
  const b=terrain.bounds,horizontal=edge==='north'||edge==='south',start=horizontal?b.minX:b.minZ,end=horizontal?b.maxX:b.maxZ;
  const cell=Math.min(C.nearCellM,terrain.cell||C.nearCellM),n=Math.ceil((end-start)/cell-1e-8),nodes=[],crossings=[];
  let landLength=0;
  for(let i=0;i<=n;i++){
    const u=start+(end-start)*i/n,x=horizontal?u:edge==='east'?b.maxX:b.minX,z=horizontal?(edge==='north'?b.minZ:b.maxZ):u;
    const height=terrain.heightAt(x,z);work.heightSamples++;
    if(!Number.isFinite(height))throw new RangeError('Backdrop edge height is not finite');
    nodes.push(u);
    if(i){const prev=nodes[i-1],old=terrain.heightAt(horizontal?prev:x,horizontal?z:prev);work.heightSamples++;
      const a=old>=C.landThresholdM,c=height>=C.landThresholdM;
      if(a&&c)landLength+=u-prev;
      else if(a!==c){let lo=prev,hi=u;
        for(let k=0;k<24;k++){const mid=(lo+hi)/2,h=terrain.heightAt(horizontal?mid:x,horizontal?z:mid);work.heightSamples++;if((h>=C.landThresholdM)===a)lo=mid;else hi=mid;}
        const cross=a?lo:hi;crossings.push(cross);landLength+=a?cross-prev:u-cross;}
    }
  }
  const boundaries=[start,...crossings,end],intervals=[];
  for(let i=0;i<boundaries.length-1;i++){
    const u=(boundaries[i]+boundaries[i+1])/2,h=terrain.heightAt(horizontal?u:edge==='east'?b.maxX:b.minX,horizontal?(edge==='north'?b.minZ:b.maxZ):u);work.heightSamples++;
    if(h>=C.landThresholdM)intervals.push([boundaries[i],boundaries[i+1]]);
  }
  return {nodes,crossings,intervals,fraction:landLength/(end-start)};
}
function coordinates(start,end,cell,extra) {
  const n=Math.ceil((end-start)/cell),set=new Set([start,end]);
  for(let i=1;i<n;i++)set.add(start+(end-start)*i/n);
  for(const v of extra)if(v>start&&v<end)set.add(v);
  return [...set].sort((a,b)=>a-b);
}
export function buildBackdrop(terrain,{quality='standard'}={}) {
  const b=terrain.bounds;if(!b||!(b.maxX>b.minX&&b.maxZ>b.minZ))throw new RangeError('Backdrop bounds');
  const work={heightSamples:0,candidateTriangles:0},edges={},landEdges={};
  for(const name of ['north','east','south','west']){edges[name]=edgeProfile(terrain,name,work);landEdges[name]=edges[name].fraction;}
  const segments=[];let triangles=0,maxHeight=0;
  const sample=(x,z)=>{work.heightSamples++;const p=backdropPoint(terrain,x,z);if(!Number.isFinite(p.height))throw new RangeError('Backdrop height');if(p.distance>(quality==='light'?C.lightRangeM:C.extentM))p.land=false;return {x,z,...p};};
  for(const outer of [false,true]){
    if(outer&&quality==='light')continue;
    const cell=outer?C.farCellM:C.nearCellM,start=outer?C.nearExtentM:0,end=outer?C.extentM:C.nearExtentM;
    const distances=coordinates(start,end,cell,[]),positions=[],colors=[],indices=[],bands=[],cache=new Map();
    const vertex=p=>{
      const key=`${p.x.toFixed(6)},${p.z.toFixed(6)}`;if(cache.has(key))return cache.get(key);
      const i=positions.length/3;cache.set(key,i);positions.push(Math.fround(p.x===b.minX?p.x-C.seamSnapM:p.x===b.maxX?p.x+C.seamSnapM:p.x),Math.fround(p.height),Math.fround(p.z===b.minZ?p.z-C.seamSnapM:p.z===b.maxZ?p.z+C.seamSnapM:p.z));maxHeight=Math.max(maxHeight,p.height);
      const gain=1+C.shadeContrast*(2*shoreNoise(p.x/C.shadeScaleM,p.z/C.shadeScaleM)-1);
      colors.push(C.canopy[0]*gain,C.canopy[1]*gain,C.canopy[2]*gain);return i;
    };
    const append=(a,c,d)=>{
      if(Math.abs((c.x-a.x)*(d.z-a.z)-(c.z-a.z)*(d.x-a.x))<1e-8)return;
      let ia=vertex(a),ic=vertex(c),id=vertex(d);
      // Positive y-facing winding, independent of which rectangular side produced the triangle.
      const cross=(positions[ic*3]-positions[ia*3])*(positions[id*3+2]-positions[ia*3+2])-(positions[ic*3+2]-positions[ia*3+2])*(positions[id*3]-positions[ia*3]);
      if(Math.abs(cross)<1e-8)return;
      if(cross>0)[ic,id]=[id,ic];
      indices.push(ia,ic,id);triangles++;
      if(triangles>C.maxTriangles)throw new RangeError('Backdrop triangle budget');
    };
    const clip=(a,c,d)=>{
      work.candidateTriangles++;const input=[a,c,d],output=[];
      for(let i=0;i<3;i++){
        const p=input[i],q=input[(i+1)%3];if(p.land)output.push(p);
        if(p.land!==q.land){
          // Search on the actual edge-height function, rather than extruding a sea vertex.
          let lo=0,hi=1;
          for(let k=0;k<24;k++){const t=(lo+hi)/2,r=sample(p.x+(q.x-p.x)*t,p.z+(q.z-p.z)*t);if(r.land===p.land)lo=t;else hi=t;}
          const t=p.land?lo:hi;output.push(sample(p.x+(q.x-p.x)*t,p.z+(q.z-p.z)*t));
        }
      }
      for(let i=1;i+1<output.length;i++)append(output[0],output[i],output[i+1]);
    };
    const row=(edge,interval,d)=>{
      const horizontal=edge==='north'||edge==='south',lo=horizontal?b.minX:b.minZ,hi=horizontal?b.maxX:b.maxZ;
      const extra=d===0?edges[edge].nodes:edges[edge].crossings;
      const pitch=outer&&d===start?C.nearCellM:cell;
      const from=interval[0]===lo?lo-d:interval[0],to=interval[1]===hi?hi+d:interval[1];
      return coordinates(from,to,pitch,extra).map(u=>sample(horizontal?u:(edge==='east'?b.maxX+d:b.minX-d),horizontal?(edge==='north'?b.minZ-d:b.maxZ+d):u));
    };
    // A zipper joins rows of different pitches, including the 160m/640m seam without T-junctions.
    const strips=[];
    for(const edge of Object.keys(edges))for(const interval of edges[edge].intervals)strips.push({edge,interval,previous:row(edge,interval,start)});
    for(let r=1;r<distances.length;r++){
      for(const strip of strips){
        const a=strip.previous,c=row(strip.edge,strip.interval,distances[r]);let i=0,j=0;
        while(i<a.length-1||j<c.length-1){
          if(j===c.length-1||(i<a.length-1&&(i+1)/(a.length-1)<=(j+1)/(c.length-1))){clip(a[i],c[j],a[i+1]);i++;}
          else {clip(a[i],c[j],c[j+1]);j++;}
        }
        strip.previous=c;
      }
      bands.push({distance:distances[r],count:indices.length});
    }
    if(indices.length)segments.push({outer,positions:new Float32Array(positions),colors:new Float32Array(colors),indices:new Uint32Array(indices),bands});
  }
  return {segments,triangles,draws:segments.length,landEdges,maxHeight,work};
}
