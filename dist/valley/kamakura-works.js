// Optional, invented harbour works. Coordinates are east/north in data, east/up/south in placement.
import { riverlifeHash as hash } from './kamakura-river-rocks.js';
export const WORKS = Object.freeze({
  fences: 24, fencePoints: 64, fenceLength: 800, // counts / m: complete rail input limits.
  fenceSpacing: 2.2, postMin: .12, postMax: .16, railMin: .07, railMax: .09, // m: interval and timber diameters.
  fenceHeightMin: .6, fenceHeightMax: 1.6, headVariation: .05, fenceTilt: 3, // m / m / m / degrees: natural post heads.
  railLow: .45, railHigh: .85, railOverhang: .12, fenceEmbed: .12, // height fractions / m / m: two rails, exposed ends, buried foot.
  fenceColliderSpacing: .18, fenceColliderRadius: .1, // m: close circles along the rail line, no broad road-blocking box.
  groups: 32, rocks: 2000, piers: 8, moorings: 24, // counts: hard input/placement limits.
  coordinate: 1e6, extent: 2000, sizeMin: .2, sizeMax: 20, // m: finite input envelopes.
  linePoints: 128, pierPoints: 9, pierLength: 60, pierWidth: 8, deckMax: 5, // counts / m: bounded construction work.
  // Parent (real Chrome): crest stones of one size on an exact line read as a clipped hedge. They now differ in size, lean,
  // proportion and place, and the spacing follows the smallest of them so the two rows still close.
  crestSpacing: .64, crestMinSize: .72, crestOffset: .15, skirtShare: .45, // diameter fraction / size fraction / width fraction / crest count fraction.
  crestShift: .1, crestSlide: .1, // diameter fraction / step fraction: a crest stone leaves its line across and along by at most this much.
  stretchMin: .86, stretchRange: .3, flatMin: .7, flatRange: .3, // gains: each stone's own width, length and height.
  skirtOuterMin: .5, skirtOuterMax: .75, skirtInnerMax: .35, // size-range fractions: medium outer stones and small inner stones.
  embedMin: .26, embedMax: .4, tilt: 12, // height fractions / degrees: seating variation.
  near: 400, far: 4000, farLight: 2500, // m: three-dimensional camera distances.
  adaptDistance: .16, keepLight: .75, adaptKeep: .18, // fractions: distance/count reduction per step.
  nearTriangles: 60000, farTriangles: 25000, draws: 8, // submitted triangles / main draws, shadows excluded.
  batch: 48, // placement operations per displayed frame during preparation.
  plank: .5, plankVariation: .12, thickness: .12, // m / fraction / m: transverse deck boards.
  pileSpacing: 3, pileDiameter: .22, pileEmbed: .15, pileMin: .3, bollard: .8, // m: supports, bed penetration, shortest pile worth setting, mooring posts above deck.
  beamDepth: .18, beamWidth: .18, plankGap: .012, // m: under-deck transverse beams and board seams.
  pierTriangles: 600, // triangles per pier, including deck, supports, beams and bollards.
  waterline: .25, heave: .06, roll: 2, periodMin: 3, periodMax: 5, // m / m / degrees / seconds: moored hull motion.
  boatWidth: 1.8, boatLength: 7.5, sailWidth: 3, sailLength: 13.5, // m: existing harbour hull scale.
});
const W = WORKS, radians = Math.PI / 180;
const finite = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
const fail = () => { throw new Error('港の作り物の形式・範囲が不正です'); };
const point = p => Array.isArray(p) && p.length === 2 && p.every(v => finite(v, -W.coordinate, W.coordinate));
function line(value, limit) {
  if (!Array.isArray(value) || value.length < 2 || value.length > limit || !value.every(point)) fail();
  let length = 0;
  for (let i = 1; i < value.length; i++) { const d = Math.hypot(value[i][0]-value[i-1][0], value[i][1]-value[i-1][1]); if (!(d > 0)) fail(); length += d; }
  return length;
}
export function decodeWorks(source) {
  if (source?.schema !== 'kz-works/0.1') fail();
  const rocks = source.rocks === undefined ? [] : source.rocks, piers = source.piers === undefined ? [] : source.piers, moorings = source.moorings === undefined ? [] : source.moorings;
  if (!Array.isArray(rocks) || !Array.isArray(piers) || !Array.isArray(moorings) || rocks.length > W.groups || piers.length > W.piers || moorings.length > W.moorings) fail();
  const fences=source.fences===undefined?[]:source.fences;
  if(!Array.isArray(fences)||fences.length>W.fences)fail();
  let total = 0; const ids = new Set();
  for (const r of rocks) {
    if (!r || typeof r.id !== 'string' || !r.id.length || ids.has(r.id) || !['ring','disc','line'].includes(r.shape) ||
      !Number.isInteger(r.count) || r.count < 1 || !Array.isArray(r.size_m) || r.size_m.length !== 2 ||
      !finite(r.size_m[0], W.sizeMin, W.sizeMax) || !finite(r.size_m[1], r.size_m[0], W.sizeMax)) fail();
    ids.add(r.id); total += r.count;
    if (r.shape === 'line') { line(r.xy_m, W.linePoints); if (!finite(r.width, W.sizeMin, W.extent)) fail(); }
    else {
      if (!finite(r.x,-W.coordinate,W.coordinate) || !finite(r.y,-W.coordinate,W.coordinate) || !finite(r.radius,W.sizeMin,W.extent)) fail();
      if (r.shape === 'ring' && (!finite(r.width, r.size_m[1], r.radius) || !finite(r.gap_bearing_deg,0,360) || !finite(r.gap_deg,0,180))) fail();
    }
  }
  if (total > W.rocks) fail();
  for (const p of piers) {
    if (!p || typeof p.id !== 'string' || !p.id.length || ids.has(p.id) || line(p.xy_m,W.pierPoints) > W.pierLength ||
      !finite(p.width_m,W.sizeMin,W.pierWidth) || !finite(p.deck_m,W.thickness,W.deckMax)) fail();
    ids.add(p.id);
  }
  for (const m of moorings) if (!m || !finite(m.x,-W.coordinate,W.coordinate) || !finite(m.y,-W.coordinate,W.coordinate) || !finite(m.yaw_deg,0,360) || !['boat','sail'].includes(m.kind)) fail();
  let fenceLength=0;
  for(const f of fences) {
    if(!f || typeof f.id!=='string' || !f.id.length || ids.has(f.id) || f.kind!=='rail' || !finite(f.height_m,W.fenceHeightMin,W.fenceHeightMax))fail();
    fenceLength+=line(f.xy_m,W.fencePoints);ids.add(f.id);
  }
  if(fenceLength>W.fenceLength)fail();
  return { schema: source.schema, rocks, piers, moorings, fences };
}
export function worksEnabled(search = '') { const q = new URLSearchParams(search); return q.get('works') !== '0' && q.get('layers') !== '0'; }
export function worksPolicy(quality = 'standard', step = 0) {
  return { near: W.near * (1 - step * W.adaptDistance), far: (quality === 'light' ? W.farLight : W.far) * (1 - step * W.adaptDistance),
    keep: (quality === 'light' ? W.keepLight : 1) * (1 - step * W.adaptKeep) };
}
function atLine(points, distance, out) {
  let used = 0;
  for (let i=1;i<points.length;i++) {
    const a=points[i-1], b=points[i], dx=b[0]-a[0], dz=a[1]-b[1], length=Math.hypot(dx,dz);
    if (distance <= used+length || i===points.length-1) { const t=Math.max(0,Math.min(1,(distance-used)/length)); out.x=a[0]+dx*t; out.z=-a[1]+dz*t; out.ux=dx/length; out.uz=dz/length; return out; }
    used += length;
  }
  return out;
}
export function pierPlan(p, terrain) {
  const length=line(p.xy_m,W.pierPoints), spans=[], piles=[], boards=[], beams=[], bollards=[], probe={};
  let offset=0;
  for(let i=1;i<p.xy_m.length;i++) {
    const a=p.xy_m[i-1],b=p.xy_m[i],dx=b[0]-a[0],dz=a[1]-b[1],n=Math.hypot(dx,dz);
    spans.push({x:a[0]+dx/2,z:-(a[1]+b[1])/2,ux:dx/n,uz:dz/n,length:n,along:offset}); offset+=n;
  }
  // Posts include the end, with every interval at most 3 m, including through bends.
  const intervals=Math.ceil(length/W.pileSpacing);
  for(let i=0;i<=intervals;i++) {
    const s=length*i/intervals; atLine(p.xy_m,s,probe);
    for(const side of [-1,1]) {
      const x=probe.x-probe.uz*side*p.width_m/2,z=probe.z+probe.ux*side*p.width_m/2,bottom=terrain.heightAt(x,z)-W.pileEmbed;
      if (!Number.isFinite(bottom)) throw new Error('桟橋の杭の下の高さが読めません');
      // Parent (real Chrome): a pier that starts on a quay stopped the whole layer. Where the ground reaches the underside of the
      // deck the boards rest on it, and no pile is set.
      if (bottom>=p.deck_m-W.thickness-W.pileMin) continue;
      piles.push({x,z,bottom,top:p.deck_m-W.thickness,along:s});
    }
    beams.push({x:probe.x,z:probe.z,ux:probe.ux,uz:probe.uz,length:p.width_m});
  }
  if (piles.length<2) throw new Error('桟橋が水の上に出ていません');
  atLine(p.xy_m,length,probe);
  for(const side of [-1,1]) bollards.push({x:probe.x-probe.uz*side*p.width_m/2,z:probe.z+probe.ux*side*p.width_m/2,bottom:p.deck_m-W.thickness,top:p.deck_m+W.bollard});
  // Flat board tops cost two triangles. Continuous slab edges preserve thickness without hidden bottom faces.
  const fixed=piles.length*8+bollards.length*10+beams.length*8+spans.length*8;
  const cap=Math.floor((W.pierTriangles-fixed)/2);
  if(cap<spans.length) throw new Error('桟橋の形状が予算を超えます');
  let remaining=cap;
  for(let j=0;j<spans.length;j++) {
    const s=spans[j], n=Math.min(Math.ceil(s.length/W.plank),remaining-(spans.length-j-1)); remaining-=n;
    let previous=0;
    for(let i=0;i<n;i++) {
      const end=i===n-1?s.length:s.length*(i+1+W.plankVariation*(hash(i,j)-.5))/n, mid=(previous+end)/2-s.length/2;
      boards.push({x:s.x+s.ux*mid,z:s.z+s.uz*mid,ux:s.ux,uz:s.uz,length:end-previous-W.plankGap,tone:1+W.plankVariation*(hash(i,j+17)-.5)}); previous=end;
    }
  }
  return {id:p.id,kind:'pier',x:spans[0].x,y:p.deck_m,z:spans[0].z,width:p.width_m,deck:p.deck_m,length,spans,piles,boards,beams,bollards};
}
function crestCounts(r) {
  const half = r.gap_deg*radians/2, margin=r.gap_deg===0?0:Math.asin(Math.min(1,r.size_m[1]/(2*(r.radius-r.width*W.crestOffset))));
  const start=(r.gap_bearing_deg*radians)+half+margin, arc=Math.PI*2-2*half-2*margin;
  const n=Math.ceil(arc*(r.radius+r.width*W.crestOffset)/(r.size_m[1]*W.crestMinSize*W.crestSpacing))+1;
  return {start,arc,n};
}
export function* worksPlacementBatches(source, terrain) {
  const data=decodeWorks(source), result={rocks:[],piers:[],moorings:[],fences:[],groups:data.rocks.length,skipped:0,requested:0,supplemental:0,work:{placements:0,heightTests:0,batches:0}};
  const probe={}; let serial=0, pending=0;
  for(let group=0;group<data.rocks.length;group++) {
    const r=data.rocks[group], [lo,hi]=r.size_m, crest=r.shape==='ring'?crestCounts(r):null;
    const crestTotal=crest?crest.n*2:0, count=Math.max(r.count,crestTotal+Math.ceil(crestTotal*W.skirtShare));
    result.requested+=r.count; result.supplemental+=count-r.count;
    if(result.rocks.length+result.skipped+count>W.rocks) throw new Error('連続した石の2列が岩の上限を超えます');
    const length=r.shape==='line'?line(r.xy_m,W.linePoints):0;
    for(let i=0;i<count;i++,serial++) {
      const a=hash(serial,11), b=hash(serial,23), c=hash(serial,37); let x,z,size,row=-1;
      if(crest && i<crestTotal) {
        row=Math.floor(i/crest.n); size=Math.max(lo,hi*(W.crestMinSize+(1-W.crestMinSize)*a));
        // Across: never past the band. Along: the ends keep their place, so the mouth stays as wide as the data says.
        const slack=Math.max(0,r.width/2-r.width*W.crestOffset-size/2), steps=r.gap_deg===0?crest.n:crest.n-1, k=i%crest.n;
        const radius=r.radius+(row?1:-1)*r.width*W.crestOffset+(b-.5)*2*Math.min(slack,W.crestShift*size);
        const slide=r.gap_deg!==0&&(k===0||k===crest.n-1)?0:(c-.5)*2*W.crestSlide;
        const angle=crest.start+crest.arc*(k+slide)/steps;
        x=r.x+Math.sin(angle)*radius; z=-r.y-Math.cos(angle)*radius;
      } else if(crest) {
        const outside=i%2===0, angle=crest.start+crest.arc*a;
        size=lo+(hi-lo)*(outside?W.skirtOuterMin+(W.skirtOuterMax-W.skirtOuterMin)*b:W.skirtInnerMax*b);
        const radius=r.radius+(outside?1:-1)*(r.width/2-size/2);
        x=r.x+Math.sin(angle)*radius; z=-r.y-Math.cos(angle)*radius;
      } else if(r.shape==='disc') {
        const radius=r.radius*Math.sqrt(a),angle=b*Math.PI*2; x=r.x+radius*Math.cos(angle); z=-r.y+radius*Math.sin(angle); size=lo+(hi-lo)*(1-radius/r.radius);
      } else {
        atLine(r.xy_m,length*a,probe); const lateral=(b-.5)*r.width; x=probe.x-probe.uz*lateral; z=probe.z+probe.ux*lateral; size=lo+(hi-lo)*c;
      }
      const sx=W.stretchMin+W.stretchRange*hash(serial,61),sz=W.stretchMin+W.stretchRange*hash(serial,67),sy=W.flatMin+W.flatRange*hash(serial,83);
      const ground=terrain.heightAt(x,z),embed=W.embedMin+(W.embedMax-W.embedMin)*hash(serial,41),tall=size*sy,y=ground-embed*tall;
      const tiltX=(hash(serial,47)-.5)*2*W.tilt*radians,tiltZ=(hash(serial,53)-.5)*2*W.tilt*radians;
      const exposedTop=y+tall/2+Math.cos(tiltX)*Math.cos(tiltZ)*tall/2;
      if(!Number.isFinite(ground)) throw new Error('岩の地面の高さが不正です');
      result.work.placements++; result.work.heightTests++;
      if(ground<0 && exposedTop<=0) result.skipped++;
      else result.rocks.push({kind:'rock',group,row,x,y,z,size,sx,sy,sz,ground,embed,variant:serial%4,yaw:hash(serial,43)*Math.PI*2,tiltX,tiltZ,rank:hash(serial,59),r:size/2,height:tall*(1-embed)});
      if(++pending>=W.batch) { pending=0;result.work.batches++;yield result; }
    }
  }
  for(const f of data.fences) {const plan=fencePlan(f,terrain);plan.rank=result.fences.length/data.fences.length;for(const post of plan.posts)post.rank=plan.rank;result.fences.push(plan);result.work.placements+=plan.posts.length+plan.rails.length;result.work.heightTests+=plan.posts.length;result.work.batches++;yield result;}
  for(const p of data.piers) { result.piers.push(pierPlan(p,terrain));result.work.batches++;yield result; }
  for(let i=0;i<data.moorings.length;i++) {
    const m=data.moorings[i],sail=m.kind==='sail';
    result.moorings.push({kind:m.kind,x:m.x,y:-W.waterline,z:-m.y,yaw:-m.yaw_deg*radians+Math.PI,w:sail?W.sailWidth:W.boatWidth,d:sail?W.sailLength:W.boatLength,
      phase:hash(i,71)*Math.PI*2,period:W.periodMin+(W.periodMax-W.periodMin)*hash(i,73),rank:hash(i,79),pose:{x:m.x,y:-W.waterline,z:-m.y,yaw:-m.yaw_deg*radians+Math.PI,tiltX:0,tiltZ:0}});
  }
  result.work.batches++;return result;
}
export function prepareWorks(source,terrain) { const job=worksPlacementBatches(source,terrain);let next; do {next=job.next();}while(!next.done);return next.value; }
// Caller owns out. No temporary arrays/objects, for both rendering and motion tests.
export function worksMotion(boat,time,out) {
  const angle=time*Math.PI*2/boat.period+boat.phase;
  out.x=boat.x;out.z=boat.z;out.y=boat.y+Math.sin(angle)*W.heave;out.yaw=boat.yaw;out.tiltX=0;out.tiltZ=Math.sin(angle)*W.roll*radians;return out;
}
export function worksCircles(rocks) { return rocks.map(r=>({x:r.x,z:r.z,r:r.r,height:r.height})); }

// Every authored corner is a post. Each segment is subdivided independently so bends cannot be skipped.
export function fencePlan(f,terrain) {
  const posts=[],rails=[];
  function post(x,z) {
    const ground=terrain.heightAt(x,z),seed=posts.length;
    if(!Number.isFinite(ground))throw new Error('柵の地面の高さが不正です');
    const diameter=W.postMin+(W.postMax-W.postMin)*hash(seed,x+z);
    const p={x,y:ground,z,height:f.height_m+(hash(seed,193)-.5)*2*W.headVariation,diameter,
      tiltX:(hash(seed,197)-.5)*2*W.fenceTilt*radians,tiltZ:(hash(seed,199)-.5)*2*W.fenceTilt*radians};
    posts.push(p);return p;
  }
  let previous=post(f.xy_m[0][0],-f.xy_m[0][1]);
  for(let i=1;i<f.xy_m.length;i++) {
    const a=f.xy_m[i-1],b=f.xy_m[i],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/W.fenceSpacing);
    for(let j=1;j<=n;j++) {
      const next=post(a[0]+(b[0]-a[0])*j/n,-a[1]-(b[1]-a[1])*j/n);
      for(const ratio of [W.railLow,W.railHigh])rails.push({a:{x:previous.x,y:previous.y+ratio*f.height_m,z:previous.z},b:{x:next.x,y:next.y+ratio*f.height_m,z:next.z},diameter:W.railMin+(W.railMax-W.railMin)*hash(rails.length,211)});
      previous=next;
    }
  }
  return {id:f.id,kind:'fence',x:posts[0].x,y:posts[0].y,z:posts[0].z,height:f.height_m,posts,rails};
}
export function fenceCircles(fences) {
  const circles=[];
  for(const f of fences)for(let i=1;i<f.posts.length;i++) {
    const a=f.posts[i-1],b=f.posts[i],n=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/W.fenceColliderSpacing);
    for(let j=0;j<=n;j++)circles.push({x:a.x+(b.x-a.x)*j/n,z:a.z+(b.z-a.z)*j/n,r:W.fenceColliderRadius,height:f.height});
  }
  return circles;
}
