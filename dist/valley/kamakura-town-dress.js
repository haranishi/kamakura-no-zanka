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
  inset: .6, gate: 1.4, fenceDepth: .12, sideLength: 6, sideRate: .3, laneWidth: 3.2, // m / fraction: fences stay inside plots
  houseFence: .45, gardenFence: .7, otherFence: .2, bambooRate: .6, boardRate: .25, // deterministic proportions
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
  const result = { items: [], boxes: [], index: new Map(), plots: { burnt: 0, repair: 0, garden: 0 }, fences: { plots: 0, segments: 0, byKind: { bamboo: 0, board: 0, log: 0 } }, tents: 0, skipped: { small: 0, terrain: 0, lane: 0, tentCap: 0, tentShortfall: 0, house: 0 }, work: { plots: 0, probes: 0, segments: 0 } };
  const paths = pathIndex(data), tentCandidates = [], houseIndex = new Map();
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
    const rate = plot.state === 'house' ? C.houseFence : plot.state === 'garden' ? C.gardenFence : C.otherFence;
    if (hash(10) < rate) {
      const rank = hash(11), kind = rank < C.bambooRate ? 'bamboo' : rank < C.bambooRate + C.boardRate ? 'board' : 'log';
      const gate = (hash(12) - .5) * (width - C.gate) / 2, left = -width / 2, right = width / 2;
      let accepted = 0;
      const segment = (u, v, w, yaw) => {
        const at = local(plot, u, v), f = { ...at, kind, yaw, w, d: C.fenceDepth, plot: i, rank: hash(4) };
        if (!add(f)) return;
        result.boxes.push({ x: f.x, z: f.z, w, d: f.d, rotY: yaw, height: C.fenceHeights[kind], base: f.y });
        accepted++; result.fences.segments++;
      };
      segment((left + gate - C.gate / 2) / 2, sign * (depth / 2 - C.fenceDepth / 2), gate - C.gate / 2 - left, plot.yaw);
      segment((right + gate + C.gate / 2) / 2, sign * (depth / 2 - C.fenceDepth / 2), right - gate - C.gate / 2, plot.yaw);
      if (hash(13) < C.sideRate) segment(hash(14) < .5 ? left + C.fenceDepth / 2 : right - C.fenceDepth / 2, sign * (depth / 2 - C.sideLength / 2), C.sideLength, plot.yaw + Math.PI / 2);
      if (accepted) { result.fences.plots++; result.fences.byKind[kind]++; }
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
