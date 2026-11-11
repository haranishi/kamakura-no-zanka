// WW15.3 / D1–D7. Pure, deterministic plot dressing; no private geography is retained here.
import { houseBox } from './kamakura-houses.js';
import { townBoxesOverlap, townHash } from './kamakura-town-fill.js';
export const TOWN_DRESS = Object.freeze({
  near: 350, gardenNear: 250, fenceNear: 90, // m: detailed geometry radii, measured in 3D
  far: 4000, lightFar: 2500, cheapFar: 1200, gardenFar: 1500, fenceFar: 700, lightFenceFar: 400, // m: silhouettes
  adaptRange: .85, lightKeep: .8, adaptKeep: .85, // ratios per quality step: range and deterministic density
  minPixels: 1.5, viewport: 941, blend: 12, // px / px / m: minimum silhouette and LOD transition band
  nearTriangles: 90000, farTriangles: 30000, draws: 16, // hard submission budgets, excluding shadows
  cell: 256, batch: 24, // m / plots: spatial index and startup work per yielded batch
  refresh: 4, // m: the eye must move this far (in any axis) before the selection is rebuilt. Parent (real Chrome): with the enclosures
  // (four times the fence segments) the per-frame rebuild — a heap over 8,000 segments and megabytes of instance data re-sent —
  // cost 2.4 ms a frame. The distance bands blend over 12 m, so a selection up to 4 m stale cannot be told apart.
  inset: .6, gate: 1.4, fenceDepth: .12, sideLength: 6, sideRate: .3, laneWidth: 3.2, // m / fraction: fences stay inside plots
  fenceSpan: 5, // m: maximum repeated fence section, keeping slat spacing at its authored scale.
  houseClearance: .6, sharedGap: .3, parallelTolerance: .001, clipEpsilon: 1e-9, minSegment: .05, // m / radians: conservative clipping and shared plot edges
  houseFence: .8, enclosed: .55, half: .25, gardenEnclosed: .4, gardenFence: .7, otherFence: .2, bambooRate: .6, boardRate: .25, // deterministic proportions
  avenueTent: .12, coastTent: .15, coastReach: 250, tentCap: 90, tentMin: 40, // fractions / m / counts
  burntWidthMin: 5, burntWidthMax: 7, burntDepthMin: 7, burntDepthMax: 11, // m: ruin footprint
  repairWidth: 6.5, repairDepth: 8.5, gardenWidth: 6, gardenDepth: 9, // m: complete near-kit footprints
  tentWidthMin: 3, tentWidthMax: 4, tentDepthMin: 2.5, tentDepthMax: 3, // m: awnings
  gardenStakesRate: .4, smokeRate: .1, clothAmplitude: .03, clothFrequency: 1.4, clothPhase: .2, // fraction / m / radians per s / radians per m
  smokeHeight: 6, smokeWidth: .35, smokeSpread: .6, smokeSpeed: .065, smokeDrift: 1, smokeOpacity: .14, // m / m / m / cycles per s / m / alpha
  fenceHeights: Object.freeze({ bamboo: 1.2, board: 1.5, log: 1 }), // m: fence silhouettes and colliders
});
export const DRESS_KINDS = Object.freeze(['burnt', 'repair', 'garden', 'bamboo', 'board', 'log', 'tent', 'smoke']);
const C = TOWN_DRESS;
export const townDressEnabled = (search = '') => new URLSearchParams(search).get('towndress') !== '0';
export function dressNear(kind) { return kind === 'smoke' ? C.near : kind === 'garden' ? C.gardenNear : C.fenceHeights[kind] ? C.fenceNear : C.near; }
export function dressRange(kind, quality = 'standard', step = 0) {
  const fence = C.fenceHeights[kind];
  const base = kind === 'smoke' ? C.near : fence ? (quality === 'light' ? C.lightFenceFar : C.fenceFar) : kind === 'garden' ? C.gardenFar : quality === 'light' ? C.lightFar : C.far;
  return step >= 3 ? Math.min(C.cheapFar, base * C.adaptRange ** step) : base * C.adaptRange ** step;
}
export function dressKeep(quality = 'standard', step = 0) { return (quality === 'light' ? C.lightKeep : 1) * C.adaptKeep ** step; }
export function dressLOD(kind, distance, quality = 'standard', step = 0) { return distance > dressRange(kind, quality, step) ? 'hidden' : distance < dressNear(kind) ? 'near' : kind === 'smoke' ? 'hidden' : 'far'; }
export function dressPixelSize(size, distance, viewport, projection) { return Math.max(size, C.minPixels * 2 * distance / (viewport * projection)); }
export function dressClothMotion(time, x, z, wind = 1) { return C.clothAmplitude * Math.min(1, Math.max(0, wind)) * Math.sin(time * C.clothFrequency + (x + z) * C.clothPhase); }
export function dressKey(ix, iz) { return (ix + 32768) * 65536 + iz + 32768; }
function local(plot, u, v) {
  const c = Math.cos(plot.yaw), s = Math.sin(plot.yaw);
  return { x: plot.x + c * u + s * v, z: plot.z - s * u + c * v };
}
function lineDistance(x, z, a, b) {
  const dx = b[0] - a[0], dz = a[1] - b[1], l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z + a[1]) * dz) / l2)) : 0;
  return { x: a[0] + dx * t, z: -a[1] + dz * t, distance: Math.hypot(x - a[0] - dx * t, z + a[1] - dz * t) };
}
// A segment index is used at startup too: thousands of fences must not each scan every lane.
function pathIndex(data) {
  const map = new Map();
  for (const path of [...Object.values(data.lanes || {}), ...Object.values(data.roads || {})]) {
    const pts = path.xyz_m || [], radius = Math.max(C.laneWidth, path.width_m || 0) / 2;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], record = { a, b, radius };
      for (let ix = Math.floor((Math.min(a[0], b[0]) - radius) / C.cell); ix <= Math.floor((Math.max(a[0], b[0]) + radius) / C.cell); ix++)
        for (let iz = Math.floor((Math.min(-a[1], -b[1]) - radius) / C.cell); iz <= Math.floor((Math.max(-a[1], -b[1]) + radius) / C.cell); iz++) {
          const key = dressKey(ix, iz); if (!map.has(key)) map.set(key, []); map.get(key).push(record);
        }
    }
  }
  return map;
}
export function* townDressBatches({ data = {}, terrain } = {}) {
  if (!data.townPlots?.length) return null;
  const result = { items: [], boxes: [], index: new Map(), plots: { burnt: 0, repair: 0, garden: 0 }, fences: { plots: 0, enclosed: 0, half: 0, segments: 0, byKind: { bamboo: 0, board: 0, log: 0 } }, tents: 0, skipped: { small: 0, terrain: 0, lane: 0, tentCap: 0, tentShortfall: 0, house: 0, shared: 0 }, work: { plots: 0, probes: 0, segments: 0 } };
  const paths = pathIndex(data), tentCandidates = [], houseIndex = new Map(), edgeIndex = new Map();
  const houses = data.houses?.instances?.map(p => houseBox(data.houses.kinds.get(p.kind), p.matrix)) || [];
  for (const box of houses) {
    const r = Math.hypot(box.w, box.d) / 2;
    for (let ix = Math.floor((box.x-r)/C.cell); ix <= Math.floor((box.x+r)/C.cell); ix++) for (let iz = Math.floor((box.z-r)/C.cell); iz <= Math.floor((box.z+r)/C.cell); iz++) {
      const key = dressKey(ix,iz); if (!houseIndex.has(key)) houseIndex.set(key,[]); houseIndex.get(key).push(box);
    }
  }
  function add(p) {
    // Check the complete footprint against dry land and paths, including transverse lane crossings.
    const radius = Math.hypot(p.w, p.d) / 2, c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    let floor = Infinity, ceiling = -Infinity;
    for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) {
      const x = p.x + c * u * p.w / 2 + s * v * p.d / 2, z = p.z - s * u * p.w / 2 + c * v * p.d / 2;
      const h = terrain.heightAt(x, z); result.work.probes++;
      if (!Number.isFinite(h) || terrain.walkable?.(x, z) === false || terrain.waterAt?.(x, z) > 0) { result.skipped.terrain++; return false; }
      floor = Math.min(floor, h); ceiling = Math.max(ceiling, h);
    }
    for (let ix = Math.floor((p.x - radius) / C.cell); ix <= Math.floor((p.x + radius) / C.cell); ix++)
      for (let iz = Math.floor((p.z - radius) / C.cell); iz <= Math.floor((p.z + radius) / C.cell); iz++) {
        if (p.kind === 'tent') for (const box of houseIndex.get(dressKey(ix,iz)) || []) if (townBoxesOverlap({ ...p, rotY: p.yaw }, box, 0)) { result.skipped.house++; return false; }
        const list = paths.get(dressKey(ix, iz)); if (!list) continue;
        for (const line of list) {
          result.work.segments++;
          // Samples at <= half the lane width, inflated by half a sample: conservative continuous clearance.
          const steps = Math.max(1, Math.ceil(p.w / (C.laneWidth / 2)));
          for (let j = 0; j <= steps; j++) {
            const u = (j / steps - .5) * p.w;
            const at = lineDistance(p.x + c * u, p.z - s * u, line.a, line.b);
            if (at.distance < line.radius + p.d / 2 + p.w / steps / 2) { result.skipped.lane++; return false; }
          }
        }
      }
    p.y = terrain.heightAt(p.x, p.z); p.groundLift = ceiling - floor;
    p.gx = (terrain.heightAt(p.x+c*.5,p.z-s*.5)-terrain.heightAt(p.x-c*.5,p.z+s*.5));
    p.gz = (terrain.heightAt(p.x+s*.5,p.z+c*.5)-terrain.heightAt(p.x-s*.5,p.z-c*.5));
    const id = result.items.length; result.items.push(p);
    const key = dressKey(Math.floor(p.x / C.cell), Math.floor(p.z / C.cell));
    if (!result.index.has(key)) result.index.set(key, []); result.index.get(key).push(id);
    return true;
  }
  for (let i = 0; i < data.townPlots.length; i++) {
    const plot = data.townPlots[i], hash = salt => townHash(i, 173, salt), width = plot.width - 2 * C.inset, depth = plot.depth - 2 * C.inset;
    result.work.plots++;
    if (!(width > C.gate && depth > C.sideLength)) { result.skipped.small++; continue; }
    const p = { kind: plot.state, x: plot.x, z: plot.z, yaw: plot.yaw, plot: i, rank: hash(4), w: width, d: depth };
    if (plot.state === 'burnt') { p.w = Math.min(width, C.burntWidthMin + hash(1) * (C.burntWidthMax - C.burntWidthMin)); p.d = Math.min(depth, C.burntDepthMin + hash(2) * (C.burntDepthMax - C.burntDepthMin)); }
    if (plot.state === 'repair') { p.w = C.repairWidth; p.d = C.repairDepth; }
    if (plot.state === 'garden') { p.w = Math.min(width, C.gardenWidth); p.d = Math.min(depth, C.gardenDepth); p.stakes = hash(3) < C.gardenStakesRate; }
    if (plot.state !== 'house') {
      if (p.w > width || p.d > depth || plot.state === 'burnt' && (p.w < C.burntWidthMin || p.d < C.burntDepthMin)) result.skipped.small++;
      else if (add(p)) { result.plots[plot.state]++; if (plot.state === 'burnt' && hash(5) < C.smokeRate) add({ ...p, kind: 'smoke', w: 1, d: 1 }); }
    }
    // plot yaw is the path tangent, not necessarily the facade's direction. Find the facing sign from its lane.
    const line = data.lanes?.[plot.lane]; let closest = null;
    const sources = line ? [line] : Object.values(data.roads || {});
    for (const path of sources) for (let j = 1; j < (path.xyz_m?.length || 0); j++) {
      const at = lineDistance(plot.x, plot.z, path.xyz_m[j - 1], path.xyz_m[j]);
      if (!closest || at.distance < closest.distance) closest = at;
    }
    if (!closest) continue;
    const sign = ((closest.x - plot.x) * Math.sin(plot.yaw) + (closest.z - plot.z) * Math.cos(plot.yaw)) < 0 ? -1 : 1;
    const choice = hash(10), mode = plot.state === 'house' ? (choice < C.enclosed ? 'enclosed' : choice < C.enclosed + C.half ? 'half' : 'none')
      : plot.state === 'garden' ? (choice < C.gardenFence ? (choice < C.gardenFence*C.gardenEnclosed ? 'enclosed' : 'front') : 'none')
      : choice < C.otherFence ? 'front' : 'none';
    if (mode !== 'none') {
      const rank = hash(11), kind = rank < C.bambooRate ? 'bamboo' : rank < C.bambooRate + C.boardRate ? 'board' : 'log';
      // The model's +z is the door side. Prefer the house in this plot; the lane is the legacy fallback.
      let facing = plot.yaw + (sign < 0 ? Math.PI : 0), owner = null, ownerDistance = Infinity;
      for (const b of houseIndex.get(dressKey(Math.floor(plot.x/C.cell),Math.floor(plot.z/C.cell))) || []) {
        const at = local(plot,0,0), dx=b.x-at.x,dz=b.z-at.z,c=Math.cos(plot.yaw),s=Math.sin(plot.yaw);
        if (Math.abs(c*dx-s*dz)>plot.width/2 || Math.abs(s*dx+c*dz)>plot.depth/2) continue;
        const distance=Math.hypot(dx,dz); if(distance<ownerDistance){owner=b;ownerDistance=distance;facing=b.rotY;}
      }
      const delta = facing-plot.yaw;
      const axis = Math.abs(Math.sin(delta)) > Math.abs(Math.cos(delta));
      const frontSign = (axis ? Math.sin(delta) : Math.cos(delta)) < 0 ? -1 : 1;
      const turn = axis ? Math.PI/2 : 0, frame = {...plot,yaw:plot.yaw+turn};
      const fw = axis ? depth : width, fd = axis ? width : depth, hx=(fw-C.fenceDepth)/2,hz=(fd-C.fenceDepth)/2;
      let gate = (hash(12)-.5)*(fw-C.gate)/2;
      if(owner)gate=Math.max(-hx+C.gate/2,Math.min(hx-C.gate/2,(owner.x-plot.x)*Math.cos(frame.yaw)-(owner.z-plot.z)*Math.sin(frame.yaw)));
      let accepted=0;
      const segment = (u,v,length,yaw,edge) => {
        if(length<C.minSegment)return;
        const at=local(frame,u,v), dx=Math.cos(yaw),dz=-Math.sin(yaw);
        const a={x:at.x-dx*length/2,z:at.z-dz*length/2},b={x:at.x+dx*length/2,z:at.z+dz*length/2};
        let intervals=[[0,length]];
        const cut=(lo,hi)=>{const next=[];for(const [l,r] of intervals){if(hi<=l||lo>=r)next.push([l,r]);else{if(lo-l>C.minSegment)next.push([l,lo]);if(r-hi>C.minSegment)next.push([hi,r]);}}intervals=next;};
        // Ray / inflated oriented box: retain the safe parts rather than dropping a whole side.
        const radius=length/2+C.houseClearance+C.fenceDepth;
        const checked=new Set();
        for(let ix=Math.floor((at.x-radius)/C.cell);ix<=Math.floor((at.x+radius)/C.cell);ix++)for(let iz=Math.floor((at.z-radius)/C.cell);iz<=Math.floor((at.z+radius)/C.cell);iz++){
          for(const house of houseIndex.get(dressKey(ix,iz))||[]){
            if(checked.has(house))continue;checked.add(house);
            const c=Math.cos(house.rotY),s=Math.sin(house.rotY),x=c*(a.x-house.x)-s*(a.z-house.z),z=s*(a.x-house.x)+c*(a.z-house.z),vx=c*dx-s*dz,vz=s*dx+c*dz;
            let lo=0,hi=length;
            for(const [origin,velocity,extent]of [[x,vx,house.w/2+C.houseClearance+C.fenceDepth/2],[z,vz,house.d/2+C.houseClearance+C.fenceDepth/2]]){
              if(Math.abs(velocity)<C.clipEpsilon){if(Math.abs(origin)>extent){hi=-1;break;}}
              else{const t0=(-extent-origin)/velocity,t1=(extent-origin)/velocity;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));}
            }
            if(hi>lo){cut(lo,hi);result.skipped.house++;}
          }
        }
        // Compare true plot boundaries (the drawn lines are inset on opposite sides of that boundary).
        const boundary=local(frame,u+edge[0]*(C.inset+C.fenceDepth/2),v+edge[1]*(C.inset+C.fenceDepth/2));
        const nearby=new Set(),reach=length/2+C.sharedGap;
        for(let ix=Math.floor((boundary.x-reach)/C.cell);ix<=Math.floor((boundary.x+reach)/C.cell);ix++)for(let iz=Math.floor((boundary.z-reach)/C.cell);iz<=Math.floor((boundary.z+reach)/C.cell);iz++)for(const old of edgeIndex.get(dressKey(ix,iz))||[])nearby.add(old);
        for(const old of nearby){
          if(old.plot===i||old.lane!==plot.lane||Math.abs(dx*old.dz-dz*old.dx)>C.parallelTolerance)continue;
          if(old.nx*(boundary.x-at.x)+old.nz*(boundary.z-at.z)>=0)continue;
          const ex=old.x-boundary.x,ez=old.z-boundary.z;
          if(Math.abs(ex*dz-ez*dx)>C.sharedGap)continue;
          const centre=length/2+ex*dx+ez*dz;cut(centre-old.length/2,centre+old.length/2);result.skipped.shared++;
        }
        for(const [start,end] of intervals){
          const pieces=Math.ceil((end-start)/C.fenceSpan);
          for(let piece=0;piece<pieces;piece++){
          const lo=start+(end-start)*piece/pieces,hi=start+(end-start)*(piece+1)/pieces;
          const f={x:a.x+dx*(lo+hi)/2,z:a.z+dz*(lo+hi)/2,kind,yaw,w:hi-lo,d:C.fenceDepth,plot:i,rank:hash(4),edge:edge[2],mode,gate};
          if(!add(f))continue;
          result.boxes.push({x:f.x,z:f.z,w:f.w,d:f.d,rotY:yaw,height:C.fenceHeights[kind],base:f.y});accepted++;result.fences.segments++;
          const offset=(lo+hi-length)/2,record={x:boundary.x+dx*offset,z:boundary.z+dz*offset,dx,dz,length:f.w,plot:i,lane:plot.lane,nx:boundary.x-at.x,nz:boundary.z-at.z};
          const key=dressKey(Math.floor(record.x/C.cell),Math.floor(record.z/C.cell));if(!edgeIndex.has(key))edgeIndex.set(key,[]);edgeIndex.get(key).push(record);
          }
        }
      };
      const outer=fw/2;
      segment((-outer+gate-C.gate/2)/2,frontSign*hz,gate-C.gate/2+outer,frame.yaw,[0,frontSign,'front']);
      segment((outer+gate+C.gate/2)/2,frontSign*hz,outer-gate-C.gate/2,frame.yaw,[0,frontSign,'front']);
      if(mode==='enclosed'||mode==='half'){
        const side=mode==='enclosed'?2*hz:hz;
        for(const sideSign of [-1,1])segment(sideSign*hx,mode==='half'?frontSign*hz/2:0,side,frame.yaw+Math.PI/2,[sideSign,0,'side']);
        if(mode==='enclosed')segment(0,-frontSign*hz,fw,frame.yaw,[0,-frontSign,'back']);
      }else if(hash(13)<C.sideRate)segment(hash(14)<.5?-hx:hx,frontSign*(fd/2-C.sideLength/2),C.sideLength,frame.yaw+Math.PI/2,[hash(14)<.5?-1:1,0,'side']);
      if(accepted){result.fences.plots++;result.fences.byKind[kind]++;if(mode==='enclosed')result.fences.enclosed++;if(mode==='half')result.fences.half++;}
    }
    {
      const coast = terrain.seaDistanceAt?.(plot.x, plot.z);
      const coastal = Number.isFinite(coast) && Math.abs(coast) <= C.coastReach && hash(21) < C.coastTent;
      const eligible = plot.state === 'house' && plot.lane === 'avenue' && hash(20) < C.avenueTent || coastal;
      if (eligible) {
        const w = C.tentWidthMin + hash(22) * (C.tentWidthMax - C.tentWidthMin), d = C.tentDepthMin + hash(23) * (C.tentDepthMax - C.tentDepthMin);
        tentCandidates.push({ kind: 'tent', w, d, yaw: plot.yaw, plot: i, rank: hash(24), coastal, plotWidth: width, localV: sign * (depth / 2 - d / 2) });
      }
    }
    if ((i + 1) % C.batch === 0) yield result;
  }
  // Preserve eligibility/proportions rather than inventing tents on invalid plots to reach a quota.
  tentCandidates.sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < tentCandidates.length; i++) {
    const p = tentCandidates[i], plot = data.townPlots[p.plot];
    if (result.tents >= C.tentCap) result.skipped.tentCap++;
    else {
      // Avenue awnings stay at the front. Coastal plots may also use their empty rear yard.
      let placed = false;
      for (const v of p.coastal ? [p.localV, -p.localV] : [p.localV]) {
        for (const u of [0, -(p.plotWidth-p.w)/2, (p.plotWidth-p.w)/2]) {
          const at = local(plot,u,v); p.x=at.x;p.z=at.z;
          if (add(p)) { result.tents++; placed=true; break; }
        }
        if (placed) break;
      }
    }
    if ((i + 1) % C.batch === 0) yield result;
  }
  result.skipped.tentShortfall = Math.max(0, C.tentMin - result.tents);
  return result;
}
export function prepareTownDress(context) { const job = townDressBatches(context); let next; do { next = job.next(); } while (!next.done); return next.value; }
