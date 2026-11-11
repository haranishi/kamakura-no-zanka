// WW15.3 / townfill T1–T3. Startup-only pure derivation; no geography or rendering state.
import { HOUSE_FAR, houseFarEnabled, houseBox, houseBounds } from './kamakura-houses.js';
import { bridgeSites } from './kamakura-bridges.js';
import { houseFarWall } from './kamakura-house-far.js';
import { insidePolygon, KAMAKURA_SLOPE_WINDOW_M } from './kamakura-terrain.js';
import { createSurfaceCodeAt, createRiverIndex } from './kamakura-surface.js';
export const TOWN_FILL = Object.freeze({
  reach: 640, // m: maximum distance from the avenue axis
  start: 60, shoreGap: 60, coastSmall: 150, // m: shrine setback, water setback, small-house coastal band
  slope: 5, riverGap: 8, roadGap: 3, facilityGap: 6, // degrees / m: excluded terrain and obstacle margins
  laneFirst: 22, laneEvery: 46, crossEvery: 84, laneWidth: 3.2, // m: lane offsets, cross intervals and width
  step: 5, laneMin: 20, laneLengthMax: 60000, // m: sampling, minimum fragment and bounded global ground-path scan
  bend: 1.5, bendWave: 160, // m: lateral amplitude and wavelength of gentle lane meanders
  laneHouseGap: 1.5, existingGap: 1.5, houseGap: 1.2, // m: lane/old-house/new-house clearances
  plotHold: 1.25, // m: inset of the ground a garden, burnt plot or repair plot holds against later houses (keeps same-lane neighbours free)
  frontageMin: 8, frontageMax: 11.5, depth: 20, // m: plot dimensions
  houseRate: .74, gardenRate: .16, burntRate: .06, repairRate: .04, // shares at the town centre
  outerStart: 300, outerHouseRate: .45, // m / share: taper from central density to the town edge
  machiyaRate: .62, koyaRate: .30, // shares: remaining house types are storehouses
  setbackMin: 1.5, setbackMax: 3, shift: .8, yaw: 4, // m / m / m / degrees: front setback and placement variation
  scaleMin: .92, scaleMax: 1.08, annexRate: .25, annexSpace: 6, // ratios / m: size variation and rear outbuildings
  farHouseTriangles: 16, farWallTriangles: 12, // triangles: existing far renderer box/roof and wall topology
  houseMax: 6500, lightRate: .6, densityMin: .5, densityMax: 1.5, // count / ratios: load-time quality and density limits
  indexCell: 32, probe: 2.5, // m: spatial bucket and footprint/perimeter sampling interval
  axisGap: 300, axisSide: 30, axisAngle: 10, // m / m / degrees: joining unlabelled, aligned avenue fragments
  groupYaw: 0, edgeFray: 0, yardRate: 0, // degrees / shares: opt-in grouped facades, ragged edge and rear tree markers
  groupMin: 3, groupMax: 6, groupSetback: .85, // houses / share: group size and shared setback weight
  kindAttempts: 2, turnHalves: 4, // attempts: smaller-model fallback; halve unsafe variation, then align to the road
  frayMax: .12, frayHouseMax: .03, frayWaveMin: 40, frayWaveMax: 90, // shares / m: plot/house removal ceilings (keep roof density) and broad edge waves
  frayBand: 20, frayNeighbour: 1.8, // m / ratio: exposed end band and same-row neighbour reach in plot widths
  yardGap: 2, yardSize: 2, // m: marker clearance and marker diameter
  roadPlots: 0, infillRate: 0, // toggle / share: existing-road frontages and small gap houses; absent preserves the old layout
  compactDepth: 12, // m: shallow road plots and maximum small-house gap depth
  infillWidth: 6, infillDepth: 7, infillWidthMax: 12, // m: minimum gap frontage/depth and wider fallback frontage
  infillStep: 2, // m: overlapping frontage probes; occupied ground rejects later probes
  bridgeGap: 8, // m: keep both bridge approaches free of new frontages
  frontReach: 25, // m: original houses eligible to vote for a model's front face
});
// Only layout/rate fields are data-driven; safety budgets and obstacle margins stay fixed.
export const TOWN_FILL_FIELDS = Object.freeze({
  frontageMin: [6, 40], frontageMax: [6, 60], depth: [8, 60], laneFirst: [8, 100],
  laneEvery: [20, 160], crossEvery: [30, 300], reach: [60, 1500], start: [0, 500],
  shoreGap: [0, 200], coastSmall: [0, 500], outerStart: [0, 1400],
  yaw: [0, 25], shift: [0, 3], setbackMin: [.5, 8], setbackMax: [.5, 8],
  bend: [0, 8], bendWave: [40, 400], annexRate: [0, 1],
  roadPlots: [0, 1], infillRate: [0, 1],
  groupYaw: [0, 20], edgeFray: [0, 1], yardRate: [0, 1],
  houseRate: [0, 1], gardenRate: [0, 1], burntRate: [0, 1], repairRate: [0, 1],
});
export function townFillConfig(value) {
  if (value === undefined) return TOWN_FILL;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid town_fill');
  for (const [name, v] of Object.entries(value)) {
    const range = Object.hasOwn(TOWN_FILL_FIELDS, name) && TOWN_FILL_FIELDS[name];
    if (!range || !Number.isFinite(v) || v < range[0] || v > range[1]) throw new RangeError('Invalid town_fill field: ' + name);
  }
  if (value.roadPlots !== undefined && value.roadPlots !== 0 && value.roadPlots !== 1) throw new RangeError('Invalid town_fill field: roadPlots');
  const c = { ...TOWN_FILL, ...value };
  if (c.setbackMax < c.setbackMin || c.frontageMax < c.frontageMin || c.outerStart >= c.reach ||
      Math.abs(c.houseRate + c.gardenRate + c.burntRate + c.repairRate - 1) > 1e-8) throw new RangeError('Inconsistent town_fill');
  return Object.freeze(c);
}
const C = TOWN_FILL, clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function townFillAmount(search = '') {
  const raw = new URLSearchParams(search).get('townfill'), value = Number(raw);
  return raw === '0' ? 0 : raw === null || !Number.isFinite(value) || value <= 0 ? 1 : clamp(value, C.densityMin, C.densityMax);
}
export function townHash(a, b = 0, salt = 0) {
  let n = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ salt;
  n = Math.imul(n ^ n >>> 16, 0x7feb352d); n = Math.imul(n ^ n >>> 15, 0x846ca68b);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
}
export function townAxis(data) {
  const groups = new Map(), loose = [];
  for (const [id, p] of Object.entries(data.roads || {}).sort(([a], [b]) => a.localeCompare(b))) if (p.kind === 'local_road') {
    if (p.route_id) { if (!groups.has(p.route_id)) groups.set(p.route_id, []); groups.get(p.route_id).push(p); }
    else loose.push({ id, p });
  }
  // Older decoded data has no route_id. Join only endpoint-aligned fragments, not parallel side streets.
  for (const { id, p } of loose) {
    let group;
    const a = p.xyz_m[0], b = p.xyz_m.at(-1), dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    for (const roads of groups.values()) if (!group) for (const q of roads) {
      const u = q.xyz_m[0], v = q.xyz_m.at(-1), ex = v[0] - u[0], ez = v[1] - u[1], el = Math.hypot(ex, ez);
      if (!len || !el || Math.abs((dx * ex + dz * ez) / (len * el)) < Math.cos(C.axisAngle * Math.PI / 180)) continue;
      const side = Math.abs((a[0] - u[0]) * ez - (a[1] - u[1]) * ex) / el;
      const gap = Math.min(...[a, b].flatMap(t => [u, v].map(s => Math.hypot(t[0] - s[0], t[1] - s[1]))));
      if (side <= C.axisSide && gap <= C.axisGap) { group = roads; break; }
    }
    if (group) group.push(p); else groups.set(id, [p]);
  }
  let best = null;
  for (const [id, roads] of groups) {
    const points = [...new Map(roads.flatMap(r => r.xyz_m.map(p => [p[0] + ',' + p[1], { x: p[0], z: -p[1] }]))).values()];
    if (points.length < 2) continue;
    let mx = 0, mz = 0; for (const p of points) { mx += p.x; mz += p.z; } mx /= points.length; mz /= points.length;
    let xx = 0, zz = 0, xz = 0; for (const p of points) { xx += (p.x - mx) ** 2; zz += (p.z - mz) ** 2; xz += (p.x - mx) * (p.z - mz); }
    const theta = Math.atan2(2 * xz, xx - zz) / 2, ux = Math.cos(theta), uz = Math.sin(theta);
    points.sort((a, b) => (a.x - b.x) * ux + (a.z - b.z) * uz || a.x - b.x || a.z - b.z);
    const marks = (data.facilities?.nodes || []).filter(n => n.part === 'torii' || n.part === 'hall');
    const distance = p => marks.reduce((d, n) => Math.min(d, Math.hypot(p.x - n.anchor_xz[0], p.z - n.anchor_xz[1])), Infinity);
    if (distance(points.at(-1)) < distance(points[0]) || !marks.length && points.at(-1).z < points[0].z) points.reverse();
    for (let i = points.length - 2; i > 0; i--) {
      const a = points[i - 1], b = points[i], c = points[i + 1];
      if (Math.abs((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x)) < 1e-8) points.splice(i, 1);
    }
    const lengths = [0]; for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
    const axis = { id, points, lengths, length: lengths.at(-1), width: Math.max(...roads.map(r => r.width_m)), pieces: roads.length };
    if (axis.length > 0 && (!best || axis.length > best.length)) best = axis;
  }
  return best;
}
export function townSample(axis, along, offset = 0) {
  let i = 1; while (i < axis.lengths.length - 1 && axis.lengths[i] < along) i++;
  const a = axis.points[i - 1], b = axis.points[i], l = axis.lengths[i] - axis.lengths[i - 1], t = clamp((along - axis.lengths[i - 1]) / l, 0, 1), dx = (b.x - a.x) / l, dz = (b.z - a.z) / l;
  return { x: a.x + (b.x - a.x) * t - dz * offset, z: a.z + (b.z - a.z) * t + dx * offset, dx, dz, along, offset };
}
// A town-only sampler avoids building a second full-world sea-distance texture (~half a second).
// Height interpolation, patch selection and physical slope window follow kamakura-terrain exactly.
export function townTerrain(data) {
  const { meta, heights, walk, patches } = data, { width: w, height: h, cell_m: cell } = meta.grid;
  const x0 = -(w - 1) * cell / 2, z0 = -(h - 1) * cell / 2, codeAt = createSurfaceCodeAt(meta, data.surface);
  const at = (i, j) => meta.height.min_m + heights[clamp(j, 0, h - 1) * w + clamp(i, 0, w - 1)] / 65535 * (meta.height.max_m - meta.height.min_m);
  function heightAt(x, z) {
    let u = clamp((x - x0) / cell, 0, w - 1), v = clamp((z - z0) / cell, 0, h - 1);
    if (Math.abs(u - Math.round(u)) < 1e-9) u = Math.round(u);
    if (Math.abs(v - Math.round(v)) < 1e-9) v = Math.round(v);
    let i = Math.min(w - 2, Math.floor(u)), j = Math.min(h - 2, Math.floor(v)), k = patches?.index.get(j * w + i);
    if (k === undefined && patches) {
      if (u === i && i > 0) { k = patches.index.get(j * w + i - 1); if (k !== undefined) i--; }
      if (k === undefined && v === j && j > 0) { k = patches.index.get((j - 1) * w + i); if (k !== undefined) j--; }
      if (k === undefined && u === i && v === j && i > 0 && j > 0) { k = patches.index.get((j - 1) * w + i - 1); if (k !== undefined) { i--; j--; } }
    }
    let a, b, c, d;
    if (k !== undefined) {
      u = clamp((u - i) * 4, 0, 4); v = clamp((v - j) * 4, 0, 4); i = Math.min(3, Math.floor(u)); j = Math.min(3, Math.floor(v));
      const n = k * 25 + j * 5 + i; a = patches.heights[n]; b = patches.heights[n + 1]; c = patches.heights[n + 5]; d = patches.heights[n + 6];
    } else { a = at(i, j); b = at(i + 1, j); c = at(i, j + 1); d = at(i + 1, j + 1); }
    u -= i; v -= j; return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  }
  const mask = (x, z) => walk[Math.round(clamp((z - z0) / cell, 0, h - 1)) * w + Math.round(clamp((x - x0) / cell, 0, w - 1))];
  const cols = Math.ceil((-2 * x0) / C.indexCell) + 1, border = new Set(), polygonCache = new Map();
  for (let i = 0, j = meta.walk.polygon_m.length - 1; i < meta.walk.polygon_m.length; j = i++) {
    const a = meta.walk.polygon_m[i], b = meta.walk.polygon_m[j];
    for (let iz = Math.floor((Math.min(-a[1], -b[1]) - z0) / C.indexCell); iz <= Math.floor((Math.max(-a[1], -b[1]) - z0) / C.indexCell); iz++)
      for (let ix = Math.floor((Math.min(a[0], b[0]) - x0) / C.indexCell); ix <= Math.floor((Math.max(a[0], b[0]) - x0) / C.indexCell); ix++) border.add(iz * cols + ix);
  }
  const insideA = (x, z) => {
    if (x < x0 || x > -x0 || z < z0 || z > -z0) return false;
    const key = Math.floor((z - z0) / C.indexCell) * cols + Math.floor((x - x0) / C.indexCell);
    if (border.has(key)) return insidePolygon(x, -z, meta.walk.polygon_m);
    if (!polygonCache.has(key)) polygonCache.set(key, insidePolygon(x, -z, meta.walk.polygon_m));
    return polygonCache.get(key);
  };
  const slopeAt = (x, z) => { const e = KAMAKURA_SLOPE_WINDOW_M / 2; return Math.atan(Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e)) * 180 / Math.PI; };
  const riverIndex = createRiverIndex(data.rivers, C.indexCell);
  return { groundAt(x, z) {
    if (codeAt(x, z) !== 4 || mask(x, z) !== 1 || !insideA(x, z) || heightAt(x, z) <= 0) return 'water';
    if (slopeAt(x, z) >= C.slope) return 'slope';
    return riverIndex.riverDistanceAt(x, z, C.riverGap) <= C.riverGap ? 'water' : null;
  }, heightAt, slopeAt, insideA, codeAt, walkable: (x, z) => insideA(x, z) && mask(x, z) === 1 && heightAt(x, z) > 0,
    waterAt: (x, z) => mask(x, z) === 2 || heightAt(x, z) <= 0 ? 1 : 0,
    ...riverIndex };
}
function spatial(cell = C.indexCell) {
  const grid = new Map(), empty = Object.freeze([]);
  return {
    add(item, x0, z0, x1, z1) { for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) { if (!grid.has(i)) grid.set(i, new Map()); const col = grid.get(i); for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) { if (!col.has(j)) col.set(j, []); col.get(j).push(item); } } },
    at(x, z) { return grid.get(Math.floor(x / cell))?.get(Math.floor(z / cell)) || empty; }
  };
}
const decorateBox = b => ({ ...b, c: Math.cos(b.rotY || 0), s: Math.sin(b.rotY || 0) });
const radius = b => Math.hypot(b.w, b.d) / 2;
function insertBox(index, box, margin) { const r = radius(box) + margin; index.add(box, box.x - r, box.z - r, box.x + r, box.z + r); }
function pointBox(x, z, b, gap) { const dx = x - b.x, dz = z - b.z; return Math.abs(dx * b.c - dz * b.s) <= b.w / 2 + gap && Math.abs(dx * b.s + dz * b.c) <= b.d / 2 + gap; }
export function townBoxesOverlap(a, b, gap = 0) {
  const ac = Math.cos(a.rotY || 0), as = Math.sin(a.rotY || 0), bc = Math.cos(b.rotY || 0), bs = Math.sin(b.rotY || 0), dx = b.x - a.x, dz = b.z - a.z;
  for (const [x, z] of [[ac, -as], [as, ac], [bc, -bs], [bs, bc]]) {
    const ar = Math.abs(x * ac - z * as) * a.w / 2 + Math.abs(x * as + z * ac) * a.d / 2;
    const br = Math.abs(x * bc - z * bs) * b.w / 2 + Math.abs(x * bs + z * bc) * b.d / 2;
    if (Math.abs(dx * x + dz * z) >= ar + br + gap) return false;
  }
  return true;
}
function segmentDistance(s, x, z) { const t = clamp(((x - s.x) * s.dx + (z - s.z) * s.dz) / s.len2, 0, 1); return Math.hypot(x - s.x - t * s.dx, z - s.z - t * s.dz); }
function addPath(index, path, id, margin) {
  for (let i = 1; i < path.xyz_m.length; i++) {
    const a = path.xyz_m[i - 1], b = path.xyz_m[i], dx = b[0] - a[0], dz = a[1] - b[1], r = (path.width_m || C.step) / 2;
    if (!dx && !dz) continue;
    const s = { x: a[0], z: -a[1], dx, dz, len2: dx * dx + dz * dz, r, id };
    index.add(s, Math.min(a[0], b[0]) - r - margin, Math.min(-a[1], -b[1]) - r - margin, Math.max(a[0], b[0]) + r + margin, Math.max(-a[1], -b[1]) + r + margin);
  }
}
export function townFront(houses, paths) {
  const counts = new Map(), index = spatial();
  for (const [id, p] of Object.entries(paths)) addPath(index, p, id, C.frontReach);
  for (const item of houses?.instances || []) {
    const b = houseBox(houses.kinds.get(item.kind), item.matrix); let nearest = null, distance = C.frontReach;
    for (const s of index.at(b.x, b.z)) { const d = segmentDistance(s, b.x, b.z); if (d < distance) { distance = d; nearest = s; } }
    if (!nearest) continue;
    const t = clamp(((b.x - nearest.x) * nearest.dx + (b.z - nearest.z) * nearest.dz) / nearest.len2, 0, 1);
    const dx = nearest.x + t * nearest.dx - b.x, dz = nearest.z + t * nearest.dz - b.z, m = item.matrix;
    const x = (dx * m[0] + dz * m[2]) / Math.hypot(m[0], m[2]), z = (dx * m[8] + dz * m[10]) / Math.hypot(m[8], m[10]);
    const face = Math.abs(x) > Math.abs(z) ? x > 0 ? 0 : 1 : z > 0 ? 2 : 3;
    if (!counts.has(item.kind)) counts.set(item.kind, [0, 0, 0, 0]); counts.get(item.kind)[face]++;
  }
  const axes = {}, votes = {};
  for (const [id, k] of houses?.kinds || []) {
    const n = counts.get(id) || [0, 0, 0, 0], max = Math.max(...n), face = max ? n.indexOf(max) : -1;
    // With no evidence, the long local axis goes perpendicular to the road.
    axes[id] = face < 0 ? k.bbox_max[0] - k.bbox_min[0] > k.bbox_max[1] - k.bbox_min[1] ? '+x' : '+z' : ['+x', '-x', '+z', '-z'][face]; votes[id] = n;
  }
  return { axis: axes, votes };
}
export function townState(rank, offset, density = 1, light = false, C = TOWN_FILL) {
  let t = clamp((Math.abs(offset) - C.outerStart) / (C.reach - C.outerStart), 0, 1); t = t * t * (3 - 2 * t);
  const house = Math.min(1 - C.burntRate - C.repairRate, (C.houseRate + (C.outerHouseRate - C.houseRate) * t) * density * (light ? C.lightRate : 1));
  return rank < house ? 'house' : rank < 1 - C.burntRate - C.repairRate ? 'garden' : rank < 1 - C.repairRate ? 'burnt' : 'repair';
}
export function prepareTownFill(data, { search = '', terrain = null } = {}) {
  const C = townFillConfig(data.meta?.town_fill);
  const flexible = C.groupYaw > 0 || ['yaw', 'shift', 'setbackMin', 'setbackMax'].some(name => data.meta?.town_fill?.[name] !== undefined);
  const amount = townFillAmount(search); if (!amount) return null;
  const axis = townAxis(data); if (!axis || !data.houses) return null;
  terrain ||= townTerrain(data);
  const codeAt = terrain.codeAt || createSurfaceCodeAt(data.meta, data.surface), old = spatial(), facilities = spatial(), roads = spatial(C.step), laneIndex = spatial(C.step), placed = spatial();
  const work = { ground: 0, boxChecks: 0, roadChecks: 0, candidates: 0, segments: 0, kindSkipped: 0, turnAttempts: 0, edgeChecks: 0, yardChecks: 0 };
  const skipped = { existing: 0, facility: 0, road: 0, water: 0, slope: 0, cap: 0 };
  const paths = Object.assign(Object.create(null), data.patches?.paths);
  for (const [id, p] of Object.entries(data.roads || {})) paths['road:' + id] = p;
  for (const [id, p] of Object.entries(data.sando || {})) paths['sando:' + id] = p;
  const oldBoxes = data.houses.instances.map(p => decorateBox(houseBox(data.houses.kinds.get(p.kind), p.matrix)));
  for (const b of oldBoxes) insertBox(old, b, C.existingGap + C.depth);
  for (const n of data.facilities?.nodes || []) {
    const a = n.bbox_min, b = n.bbox_max, box = decorateBox({ x: n.anchor_xz[0] + (a[0] + b[0]) / 2, z: n.anchor_xz[1] + (a[2] + b[2]) / 2, w: b[0] - a[0], d: b[2] - a[2], rotY: 0 });
    insertBox(facilities, box, C.facilityGap + C.depth);
  }
  for (const [id, p] of Object.entries(paths)) addPath(roads, p, id, C.roadGap + C.laneWidth / 2);
  const front = townFront(data.houses, paths);
  // Find the beach separately in each axis-parallel strip (no single fixed coastal coordinate).
  const strips = new Map();
  function stripEnd(offset) {
    const key = Math.round(offset / C.laneEvery); if (strips.has(key)) return strips.get(key);
    let end = axis.length, beach = Infinity;
    for (let s = C.start; s <= axis.length; s += C.step) {
      const p = townSample(axis, s, offset), code = codeAt(p.x, p.z);
      if (code === 0 || terrain.waterAt(p.x, p.z) > 0) { beach = s; end = s - C.shoreGap; break; }
    }
    const result = { end, beach }; strips.set(key, result); return result;
  }
  function ground(x, z) {
    work.ground++;
    if (terrain.groundAt) return terrain.groundAt(x, z);
    if (!terrain.insideA(x, z) || !terrain.walkable(x, z)) return 'water';
    if (terrain.waterAt(x, z) > 0 || terrain.riverDistanceAt?.(x, z, C.riverGap) <= C.riverGap) return 'water';
    if (codeAt(x, z) !== 4) return 'water';
    if (terrain.slopeAt(x, z) >= C.slope) return 'slope';
    return null;
  }
  function blockedBox(index, x, z, gap) { for (const b of index.at(x, z)) { work.boxChecks++; if (pointBox(x, z, b, gap)) return true; } return false; }
  function blockedRoad(index, x, z, gap, ignore = null) { for (const s of index.at(x, z)) { work.roadChecks++; if (s.id !== ignore && segmentDistance(s, x, z) <= s.r + gap) return true; } return false; }
  const lanes = Object.create(null), hints = new Map(); let laneLength = 0, laneNumber = 0;
  function lane(points, tag) {
    let fragment = [], meters = 0, firstHint = null, lastHint = null;
    function flush() {
      if (meters >= C.laneMin && laneLength + meters <= C.laneLengthMax) {
        const id = tag + ':' + laneNumber++; hints.set(id, { first: firstHint, last: lastHint }); lanes[id] = Object.freeze({ xyz_m: Object.freeze(fragment.map(Object.freeze)), width_m: C.laneWidth, kind: 'lane', name: '路地' }); laneLength += meters;
      }
      fragment = []; meters = 0; firstHint = lastHint = null;
    }
    for (const p of points) {
      let valid = !ground(p.x, p.z) && !blockedBox(old, p.x, p.z, C.laneHouseGap + C.laneWidth / 2) && !blockedBox(facilities, p.x, p.z, C.facilityGap + C.laneWidth / 2) && !blockedRoad(roads, p.x, p.z, C.roadGap + C.laneWidth / 2);
      if (valid) for (const side of [-1, 1]) {
        const nx = tag === 'parallel' ? -p.dz : p.dx, nz = tag === 'parallel' ? p.dx : p.dz;
        if (ground(p.x + nx * side * C.laneWidth / 2, p.z + nz * side * C.laneWidth / 2)) { valid = false; break; }
      }
      if (valid && fragment.length) {
        const a = fragment.at(-1), dx = p.x - a[0], dz = p.z + a[1], distance = Math.hypot(dx, dz), probes = Math.ceil(distance / C.probe);
        for (let n = 0; n <= probes && valid; n++) for (const side of [-1, 0, 1]) {
          const x = a[0] + dx * n / probes - dz / distance * side * C.laneWidth / 2, z = -a[1] + dz * n / probes + dx / distance * side * C.laneWidth / 2;
          if (ground(x, z) || blockedBox(old, x, z, C.laneHouseGap) || blockedBox(facilities, x, z, C.facilityGap) || blockedRoad(roads, x, z, C.roadGap)) { valid = false; break; }
        }
      }
      if (!valid) { flush(); continue; }
      const a = fragment.at(-1); if (a) meters += Math.hypot(p.x - a[0], p.z + a[1]); fragment.push([p.x, -p.z, 0]); firstHint ||= p; lastHint = p;
    }
    flush();
  }
  const offsets = [];
  for (let side = -1; side <= 1; side += 2) for (let off = axis.width / 2 + C.laneFirst; off + C.bend < C.reach; off += C.laneEvery) offsets.push(side * off);
  // Alternate banks and then work outwards, so a length cap cannot empty one half of town.
  offsets.sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
  for (const offset of offsets) {
    const points = [], end = stripEnd(offset).end;
    for (let s = C.start; s <= end; s += C.step) points.push(townSample(axis, s, offset + C.bend * Math.sin(s / C.bendWave * Math.PI * 2 + Math.abs(offset) / C.laneEvery)));
    lane(points, 'parallel');
  }
  // Cross lanes are one band wide; adjacent bands have staggered phases.
  for (let band = 0; band < offsets.length; band++) {
    const offset = offsets[band], sign = Math.sign(offset), a = offset, b = clamp(offset + sign * C.laneEvery, -C.reach + C.bend, C.reach - C.bend);
    for (let s = C.start + C.crossEvery / 2 * (band % 2); s < stripEnd(offset).end; s += C.crossEvery) {
      const points = [];
      for (let u = 0; u <= Math.abs(b - a); u += C.step) { const off = a + sign * u, p = townSample(axis, s + C.bend * Math.sin(off / C.bendWave * Math.PI * 2), off); if (p.along >= C.start && p.along <= stripEnd(off).end) points.push(p); }
      lane(points, 'cross');
    }
  }
  for (const [id, p] of Object.entries(lanes)) { addPath(laneIndex, p, id, 0); work.segments += p.xyz_m.length - 1; }
  const kinds = { machiya: [], koya: [], kura: [] };
  for (const k of data.houses.kinds.values()) { const group = /^(machiya|koya|kura)(?:_|$)/.exec(k.house_type || '')?.[1]; if (group) kinds[group].push(k); }
  for (const list of Object.values(kinds)) list.sort((a, b) => a.index - b.index);
  let nextId = data.houses.instances.reduce((n, p) => Math.max(n, p.id + 1), 0);
  let farTriangles = 0;
  const farEnabled = houseFarEnabled(search);
  if (farEnabled) for (const p of data.houses.instances) farTriangles += houseFarWall(data.houses.kinds.get(p.kind).node) ? C.farWallTriangles : C.farHouseTriangles;
  const additions = [], plots = [], states = { house: 0, garden: 0, burnt: 0, repair: 0 }, light = new URLSearchParams(search).get('q') === 'light';
  function rectReason(box, laneId, checkNew = true) {
    if (extraPlacement && approaches.some(b => townBoxesOverlap(box, b))) return 'bridge';
    for (const b of old.at(box.x, box.z)) { work.boxChecks++; if (townBoxesOverlap(box, b, C.existingGap - (extraPlacement ? C.houseGap : 0))) return 'existing'; }
    for (const b of facilities.at(box.x, box.z)) { work.boxChecks++; if (townBoxesOverlap(box, b, C.facilityGap - (extraPlacement ? C.houseGap : 0))) return 'facility'; }
    if (checkNew) for (const b of placed.at(box.x, box.z)) { work.boxChecks++; if (b !== rotating && townBoxesOverlap(box, b, extraPlacement ? 0 : C.houseGap)) return 'existing'; }
    const c = Math.cos(box.rotY), s = Math.sin(box.rotY), nx = Math.ceil(box.w / C.probe), nz = Math.ceil(box.d / C.probe);
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
      const u = (i / nx - .5) * box.w, v = (j / nz - .5) * box.d, x = box.x + c * u + s * v, z = box.z - s * u + c * v;
      const why = ground(x, z); if (why) return why;
      if (blockedRoad(roads, x, z, 0) || blockedRoad(laneIndex, x, z, 0)) return 'road';
    }
    return null;
  }
  // Supplemental scans share the existing global path-length budget. They never move an allocated house.
  const supplemental = { roadPlots: 0, roadHouses: 0, infill: 0, scanned: 0, samples: 0, axisChecks: 0, rejected: { bounds: 0, rate: 0, model: 0, fit: 0, existing: 0, facility: 0, road: 0, water: 0, slope: 0, bridge: 0, cap: 0, budget: 0 } };
  const approaches = C.roadPlots || C.infillRate ? bridgeSites(data, terrain).map(b => ({
    x: b.x + b.ux * (b.start + b.end) / 2, z: b.z + b.uz * (b.start + b.end) / 2,
    w: b.end - b.start + 2 * C.bridgeGap, d: b.roadWidth + 2 * C.infillDepth, rotY: Math.atan2(-b.uz, b.ux)
  })) : [];
  const records = [], yardCandidates = [], rotations = [];
  let rotating = null, extraPlacement = false, lastPlacementReason = 'fit';
  function choose(kindGroup, frontage, faceKey, seed, salt, compact = false, plotDepth = C.depth) {
    const list = kinds[kindGroup].filter(k => {
      const bounds = houseBounds(k), face = front.axis[k.index], width = face.endsWith('x') ? bounds.max[2] - bounds.min[2] : bounds.max[0] - bounds.min[0];
      const depth = face.endsWith('x') ? bounds.max[0] - bounds.min[0] : bounds.max[2] - bounds.min[2];
      const scale = C.scaleMin + (C.scaleMax - C.scaleMin) * townHash(seed, faceKey, 31);
      const angle = flexible ? 0 : (townHash(seed, faceKey, 32) * 2 - 1) * C.yaw * Math.PI / 180;
      return (Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * depth) * scale <= frontage - C.houseGap &&
        (Math.abs(Math.sin(angle)) * width + Math.abs(Math.cos(angle)) * depth) * scale <= plotDepth - (flexible ? C.setbackMin : C.setbackMax);
    });
    if (compact) list.sort((a, b) => { const u = houseBounds(a), v = houseBounds(b); return (u.max[0] - u.min[0]) * (u.max[2] - u.min[2]) - (v.max[0] - v.min[0]) * (v.max[2] - v.min[2]) || a.index - b.index; });
    return list.length ? list[compact ? 0 : Math.floor(townHash(seed, faceKey, salt) * list.length)] : null;
  }
  function place(k, p, side, width, depth, laneId, seed, salt, rear = 0, group = null) {
    const scale = C.scaleMin + (C.scaleMax - C.scaleMin) * townHash(seed, salt, 31), face = front.axis[k.index];
    const desired = Math.atan2(-p.dx * side, p.dz * side), local = face === '+x' ? 0 : face === '-x' ? Math.PI : face === '+z' ? Math.PI / 2 : -Math.PI / 2;
    const variation = (townHash(seed, salt, 32) * 2 - 1) * C.yaw * Math.PI / 180;
    const body = houseBounds(k), w = (body.max[0] - body.min[0]) * scale, d = (body.max[2] - body.min[2]) * scale;
    const nx = -p.dz * side, nz = p.dx * side, tx = p.dx, tz = p.dz;
    const individual = townHash(seed, salt, 33), rank = group ? group.setback * C.groupSetback + individual * (1 - C.groupSetback) : individual;
    const desiredSetback = C.setbackMin + (C.setbackMax - C.setbackMin) * rank;
    let why = null;
    for (let attempt = 0; attempt <= (flexible ? C.turnHalves + 1 : 0); attempt++) {
      work.turnAttempts++;
      const keep = attempt > C.turnHalves ? 0 : 1 / 2 ** attempt, turn = variation * keep;
      const yaw = local - desired + turn, c = Math.cos(yaw), s = Math.sin(yaw);
      const half = Math.abs(nx * c - nz * s) * w / 2 + Math.abs(nx * s + nz * c) * d / 2;
      const alongHalf = Math.abs(tx * c - tz * s) * w / 2 + Math.abs(tx * s + tz * c) * d / 2;
      if (alongHalf * 2 > width - C.houseGap || half * 2 + rear > depth - (flexible ? C.setbackMin : C.setbackMax)) continue;
      const setback = flexible ? Math.min(C.setbackMin + (desiredSetback - C.setbackMin) * keep, depth - half * 2 - rear) : desiredSetback;
      const shift = (townHash(seed, salt, 34) * 2 - 1) * Math.min(C.shift, width / 2 - alongHalf) * keep;
      const box = decorateBox({ x: p.x + nx * (p.r + setback + half + rear) + tx * shift, z: p.z + nz * (p.r + setback + half + rear) + tz * shift, w, d, rotY: yaw });
      // Check the rotated footprint and a free perimeter; rotation must not seal a narrow passage.
      const clearWidth = extraPlacement ? Math.max(w + 2 * C.houseGap, face.endsWith('x') ? C.infillDepth : C.infillWidth) : w + 2 * C.houseGap;
      const clearDepth = extraPlacement ? Math.max(d + 2 * C.houseGap, face.endsWith('x') ? C.infillWidth : C.infillDepth) : d + 2 * C.houseGap;
      why = rectReason({ ...box, w: clearWidth, d: clearDepth }, laneId);
      if (why) continue;
      if (additions.length >= C.houseMax || farEnabled && farTriangles + C.farHouseTriangles > HOUSE_FAR.triangles) { skipped.cap++; lastPlacementReason = 'cap'; return null; }
      const u = (body.min[0] + body.max[0]) / 2 * scale, v = (body.min[2] + body.max[2]) / 2 * scale;
      const matrix = [c * scale, 0, -s * scale, 0, 0, scale, 0, 0, s * scale, 0, c * scale, 0, box.x - c * u - s * v, 0, box.z + s * u - c * v, 1];
      const item = { id: nextId++, kind: k.index, matrix };
      additions.push(item); if (farEnabled) farTriangles += C.farHouseTriangles; insertBox(placed, box, C.depth + C.houseGap);
      const result = { box, item, turn, used: setback + half * 2 + rear };
      if (group) rotations.push({ result, base: local - desired, desired: variation + group.turn * Math.PI / 180, width, depth, p, nx, nz, tx, tz, laneId, u, v, scale });
      return result;
    }
    lastPlacementReason = why || 'fit';
    if (why && !extraPlacement) skipped[why]++;
    return null;
  }
  function plotsAlong(path, laneId, row, supplementalMode = null) {
    const infill = supplementalMode === 'infill', extra = supplementalMode !== null;
    const points = path.xyz_m, lengths = [0]; for (let i = 1; i < points.length; i++) lengths.push(lengths.at(-1) + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    const mini = { points: points.map(p => ({ x: p[0], z: -p[1] })), lengths };
    for (let side = -1; side <= 1; side += 2) {
      let slot = 0, groupEnd = 0, groupIndex = -1, cluster = null;
      for (let start = 0; start < lengths.at(-1); slot++) {
        const seed = Math.imul(row + 1, 73856093) ^ Math.imul(slot + 1, 19349663), salt = side + 2;
        if (C.groupYaw && slot >= groupEnd) {
          groupIndex++;
          groupEnd = slot + C.groupMin + Math.floor(townHash(row, side, groupIndex + 101) * (C.groupMax - C.groupMin + 1));
          cluster = { turn: (townHash(row, side, groupIndex + 201) * 2 - 1) * C.groupYaw, setback: townHash(row, side, groupIndex + 301) };
        }
        const width = infill ? C.infillWidth : C.frontageMin + (C.frontageMax - C.frontageMin) * townHash(seed, salt, 1), along = start + width / 2; start += infill ? C.infillStep : width;
        if (along + width / 2 > lengths.at(-1)) break;
        if (extra) {
          if (supplemental.scanned + laneLength + (infill ? C.infillStep : width) > C.laneLengthMax || additions.length >= C.houseMax) { supplemental.rejected.budget++; break; }
          supplemental.samples++;
          supplemental.scanned += infill ? C.infillStep : width;
          if (infill && townHash(seed, salt, 401) >= Math.min(1, C.infillRate * amount * (light ? C.lightRate : 1))) { supplemental.rejected.rate++; continue; }
        }
        const p = townSample(mini, along); p.r = (path.width_m || axis.width) / 2;
        // Project onto the closest avenue segment, rather than depending on a world-axis coordinate.
        let axisDistance = Infinity, axisAlong = 0, signedOffset = 0;
        const hint = hints.get(laneId), estimate = hint ? hint.first.along + (hint.last.along - hint.first.along) * along / lengths.at(-1) : along;
        let lo = 1, hi = axis.lengths.length - 1;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (axis.lengths[mid] < estimate - C.depth) lo = mid + 1; else hi = mid; }
        for (let i = extra ? 1 : lo; i < axis.points.length; i++) {
          if (extra && supplemental.axisChecks >= C.laneLengthMax / C.step) { supplemental.rejected.budget++; return; }
          if (extra) supplemental.axisChecks++;
          if (!extra && axis.lengths[i - 1] > estimate + C.depth) break;
          const a = axis.points[i - 1], b = axis.points[i], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz, t = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / l2, 0, 1), d = Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
          if (d < axisDistance) { axisDistance = d; axisAlong = axis.lengths[i - 1] + Math.sqrt(l2) * t; signedOffset = ((p.z - a.z) * dx - (p.x - a.x) * dz) / Math.sqrt(l2); }
        }
        if (axisAlong - (extra ? 0 : C.depth / 2) < C.start || axisAlong + (extra ? 0 : C.depth / 2) > stripEnd(signedOffset).end || axisDistance + (extra ? 0 : C.depth) > C.reach) { if (extra) supplemental.rejected.bounds++; continue; }
        if (extra) {
          work.candidates++;
          const depths = infill ? [C.compactDepth] : [C.depth, C.compactDepth];
          const frontages = infill ? [C.infillWidth, C.infillWidthMax] : [width];
          const state = infill ? 'house' : townState(townHash(seed, salt, 3), axisDistance, amount, light, C);
          if (state !== 'house') { supplemental.rejected.rate++; continue; }
          const coastal = stripEnd(signedOffset).beach - axisAlong <= C.coastSmall, type = townHash(seed, salt, 4);
          const group = infill || coastal ? 'koya' : type < C.machiyaRate ? 'machiya' : type < C.machiyaRate + C.koyaRate ? 'koya' : 'kura';
          let main = null, usedDepth = 0;
          let usedWidth = width; lastPlacementReason = 'model';
          fitting: for (const depth of depths) for (const frontage of frontages) {
            const k = choose(!infill && depth === C.compactDepth ? 'koya' : group, frontage, salt, seed, 5, false, depth);
            if (!k) continue;
            main = place(k, p, side, frontage, depth, laneId, seed, salt);
            if (main) { usedDepth = depth; usedWidth = frontage; break fitting; }
          }
          if (!main) { supplemental.rejected[lastPlacementReason]++; continue; }
          const yaw = Math.atan2(-p.dz, p.dx), box = main.box;
          plots.push(Object.freeze({ x: box.x, z: box.z, yaw, width: usedWidth, depth: usedDepth, state: 'house', lane: laneId, houseTurn: main.turn, house: main.item.id, source: supplementalMode }));
          records.push({ first: additions.length - 1, end: additions.length, along: axisAlong, offset: signedOffset, lane: laneId, state: 'house', main });
          states.house++;
          if (infill) supplemental.infill++; else { supplemental.roadPlots++; supplemental.roadHouses++; }
          continue;
        }
        const yaw = Math.atan2(-p.dz, p.dx), box = { x: p.x - p.dz * side * (p.r + (C.depth + C.setbackMin) / 2), z: p.z + p.dx * side * (p.r + (C.depth + C.setbackMin) / 2), w: width - C.houseGap, d: C.depth - C.setbackMin, rotY: yaw };
        work.candidates++;
        const rank = townHash(seed, salt, 3), state = townState(rank, axisDistance, amount, light, C);
        // Opt-in facade variation may use a partly obstructed plot if the actual house and
        // its free perimeter fit. Empty plots still reserve their complete ground rectangle.
        if (!flexible || state !== 'house') {
          const why = rectReason(box, laneId, false); if (why) { skipped[why]++; continue; }
        }
        const first = additions.length; let main = null;
        if (state === 'house') {
          const coastal = stripEnd(signedOffset).beach - axisAlong <= C.coastSmall, type = townHash(seed, salt, 4), group = coastal ? 'koya' : type < C.machiyaRate ? 'machiya' : type < C.machiyaRate + C.koyaRate ? 'koya' : 'kura';
          const k = choose(group, width, salt, seed, 5); if (!k) { work.kindSkipped++; continue; }
          main = place(k, p, side, width, C.depth, laneId, seed, salt, 0, cluster);
          if (!main && flexible && C.kindAttempts > 1) {
            const compact = choose(group, width, salt, seed, 5, true);
            if (compact && compact !== k) main = place(compact, p, side, width, C.depth, laneId, seed, salt, 0, cluster);
          }
          if (!main) continue;
          const free = C.depth - main.used;
          if (free >= C.annexSpace && townHash(seed, salt, 6) < C.annexRate) {
            const annex = choose(coastal || townHash(seed, salt, 7) < .5 ? 'koya' : 'kura', width, salt, seed, 8);
            if (annex) place(annex, p, side, width, C.depth, laneId, seed, salt + 100, main.used + C.houseGap, cluster);
          }
          if (C.yardRate && additions.length === first + 1 && townHash(seed, salt, 9) < C.yardRate) {
            const distance = main.used + C.yardGap + C.yardSize / 2;
            if (distance + C.yardSize / 2 <= C.depth) yardCandidates.push({ record: records.length, x: p.x - p.dz * side * (p.r + distance), z: p.z + p.dx * side * (p.r + distance), size: C.yardSize });
          }
        } else {
          // A garden, a burnt plot or a house under repair holds its ground. Lanes cross, so the plots of two lanes cover the same
          // earth: a house of the other lane used to be built on top of these plots (a third of them was lost to the town dress,
          // and a ruin's position landed inside a house). A plot that a house already stands on is dropped instead.
          let taken = false;
          for (const b of placed.at(box.x, box.z)) { work.boxChecks++; if (townBoxesOverlap(box, b)) { taken = true; break; } }
          if (taken) { skipped.existing++; continue; }
          insertBox(placed, { ...box, w: box.w - 2 * C.plotHold, d: box.d - 2 * C.plotHold }, C.depth + C.houseGap);
        }
        states[state]++; plots.push(Object.freeze({ x: box.x, z: box.z, yaw, width, depth: C.depth, state, lane: laneId, ...(flexible && main ? { houseTurn: main.turn } : {}) }));
        records.push({ first, end: additions.length, along: axisAlong, offset: signedOffset, lane: laneId, state, main });
      }
    }
  }
  plotsAlong({ xyz_m: axis.points.map(p => [p.x, -p.z, 0]), width_m: axis.width }, 'avenue', 0);
  let row = 1; for (const [id, p] of Object.entries(lanes)) plotsAlong(p, id, row++);
  // Reserve every house first. Rotating an early facade must not consume a later
  // neighbour's space and silently lower the house count. Unsafe turns fall back to
  // the already allocated transform, so this pass never deletes a house.
  for (const r of rotations) {
    const { result, base, desired, width, depth, p, nx, nz, tx, tz, laneId, u, v, scale } = r;
    const b = result.box; rotating = b;
    for (let attempt = 0; attempt <= C.turnHalves; attempt++) {
      work.turnAttempts++;
      const turn = desired / 2 ** attempt, yaw = base + turn, c = Math.cos(yaw), s = Math.sin(yaw);
      const half = Math.abs(nx * c - nz * s) * b.w / 2 + Math.abs(nx * s + nz * c) * b.d / 2;
      const alongHalf = Math.abs(tx * c - tz * s) * b.w / 2 + Math.abs(tx * s + tz * c) * b.d / 2;
      const oldHalf = Math.abs(nx * b.c - nz * b.s) * b.w / 2 + Math.abs(nx * b.s + nz * b.c) * b.d / 2;
      const fromLane = (b.x - p.x) * nx + (b.z - p.z) * nz - p.r + half - oldHalf;
      const x = b.x + nx * (half - oldHalf), z = b.z + nz * (half - oldHalf);
      if (2 * alongHalf > width - C.houseGap || fromLane + half > depth) continue;
      if (rectReason({ ...b, x, z, rotY: yaw, w: b.w + 2 * C.houseGap, d: b.d + 2 * C.houseGap }, laneId)) continue;
      b.x = x; b.z = z; b.rotY = yaw; b.c = c; b.s = s; result.turn = turn;
      const m = result.item.matrix; m[0] = m[10] = c * scale; m[2] = -s * scale; m[8] = s * scale;
      m[12] = b.x - c * u - s * v; m[14] = b.z + s * u - c * v;
      break;
    }
    rotating = null;
  }
  for (let i = 0; i < records.length; i++) if (C.groupYaw && records[i].main) plots[i] = Object.freeze({ ...plots[i], houseTurn: records[i].main.turn });
  // Remove complete plots only after allocation. Earlier reservations remain conservative, so
  // removing a plot never causes a neighbouring frontage or an avenue house to move.
  const edge = { total: plots.length, eligible: 0, dropped: 0, fraction: 0 }, removed = new Set();
  if (C.edgeFray && plots.length) {
    const bands = new Map(), neighbours = plots.map(() => []), index = spatial();
    const reach = Math.max(C.frontageMax * C.frayNeighbour, C.depth + C.laneWidth);
    let first = Infinity, last = -Infinity;
    records.forEach((r, i) => {
      first = Math.min(first, r.along); last = Math.max(last, r.along);
      const key = Math.floor(r.along / C.frayWaveMin) * 2 + +(r.offset > 0);
      if (!r.lane.startsWith('cross')) bands.set(key, Math.max(bands.get(key) || 0, Math.abs(r.offset)));
      const p = plots[i]; index.add(i, p.x - reach, p.z - reach, p.x + reach, p.z + reach);
    });
    const candidates = [];
    records.forEach((r, i) => {
      const p = plots[i];
      if (r.state === 'house') for (const j of index.at(p.x, p.z)) {
        work.edgeChecks++;
        if (j !== i && records[j].state === 'house' && Math.hypot(p.x - plots[j].x, p.z - plots[j].z) <= reach) neighbours[i].push(j);
      }
      const band = bands.get(Math.floor(r.along / C.frayWaveMin) * 2 + +(r.offset > 0));
      const exposed = Math.abs(r.offset) >= C.outerStart || Math.abs(r.offset) >= band - C.frontageMax || r.along < first + C.frayBand || r.along > last - C.frayBand;
      const isolated = r.state === 'house' && neighbours[i].length === 0;
      if (r.lane === 'avenue' || Math.abs(r.offset) < C.laneFirst || !exposed && !isolated) return;
      // Two continuous waves, not per-house coin flips: contiguous bites in an exposed edge.
      const wave = Math.sin(r.along * 2 * Math.PI / C.frayWaveMax + r.offset * 2 * Math.PI / C.frayWaveMax) + Math.sin(r.along * 2 * Math.PI / C.frayWaveMin) / 2;
      candidates.push({ i, wave, isolated: +isolated, outer: +(r.lane.startsWith('parallel') && Math.abs(r.offset) >= band - C.frontageMax) });
    });
    edge.eligible = candidates.length;
    candidates.sort((a, b) => b.isolated - a.isolated || b.outer - a.outer || a.wave - b.wave || a.i - b.i);
    const limit = Math.floor(edge.total * C.frayMax * C.edgeFray);
    let removedHouses = 0;
    const houseLimit = Math.floor(additions.length * C.frayHouseMax * C.edgeFray);
    for (const { i } of candidates) {
      if (removed.size >= limit) break;
      const houseCount = records[i].end - records[i].first;
      if (removedHouses + houseCount > houseLimit) continue;
      // A remaining house must keep at least one remaining house beside it.
      if (neighbours[i].some(j => !removed.has(j) && !neighbours[j].some(k => k !== i && !removed.has(k)))) continue;
      removed.add(i); removedHouses += houseCount;
    }
    const removedItems = new Set();
    for (const i of removed) { const r = records[i]; states[r.state]--; for (let j = r.first; j < r.end; j++) removedItems.add(additions[j]); }
    for (let i = additions.length - 1; i >= 0; i--) if (removedItems.has(additions[i])) { additions.splice(i, 1); if (farEnabled) farTriangles -= C.farHouseTriangles; }
    edge.dropped = removed.size; edge.fraction = edge.dropped / edge.total;
  }
  // The original avenue, lanes, group turns and edge decisions are complete before opt-in additions.
  extraPlacement = true;
  if (C.roadPlots || C.infillRate) {
    const avenueRoutes = new Set(Object.entries(data.roads || {}).filter(([id, p]) => p.route_id === axis.id || id === axis.id).map(([id]) => id));
    const streetPieces = Object.entries(data.roads || {}).filter(([id, p]) => !avenueRoutes.has(id) && ['local_road', 'kaido', 'trail'].includes(p.kind)).sort(([a], [b]) => a.localeCompare(b));
    const streetPaths = [];
    // Contiguous export fragments of one route share frontage spacing; river gaps stay separate.
    const routeEnds = new Map();
    for (const [id, path] of streetPieces) {
      const route = (path.route_id || id).replace(/:\d+$/, ''), last = routeEnds.get(route), a = path.xyz_m[0];
      if (last && last[1].width_m === path.width_m && last[1].xyz_m.at(-1)[0] === a[0] && last[1].xyz_m.at(-1)[1] === a[1]) last[1].xyz_m.push(...path.xyz_m.slice(1));
      else { const entry = [id, { ...path, xyz_m: [...path.xyz_m] }]; streetPaths.push(entry); routeEnds.set(route, entry); }
    }
    if (C.roadPlots) for (const [id, p] of streetPaths) plotsAlong(p, 'road:' + id, row++, 'road');
    if (C.infillRate) {
      plotsAlong({ xyz_m: axis.points.map(p => [p.x, -p.z, 0]), width_m: axis.width }, 'avenue', row++, 'infill');
      for (const [id, p] of [...streetPaths.map(([id, p]) => ['road:' + id, p]), ...Object.entries(lanes)]) plotsAlong(p, id, row++, 'infill');
    }
  }
  const yards = [];
  if (C.yardRate) {
    const boxes = spatial(), markers = spatial(), yardPaths = spatial();
    for (const b of oldBoxes) insertBox(boxes, b, C.yardGap + C.yardSize);
    for (const p of additions) insertBox(boxes, decorateBox(houseBox(data.houses.kinds.get(p.kind), p.matrix)), C.yardGap + C.yardSize);
    for (const [id, p] of Object.entries({ ...paths, ...lanes })) addPath(yardPaths, p, id, C.yardGap + C.yardSize);
    for (const candidate of yardCandidates) {
      if (removed.has(candidate.record)) continue;
      const { x, z, size } = candidate, gap = C.yardGap + size / 2; work.yardChecks++;
      if (ground(x, z) || blockedBox(boxes, x, z, gap) || blockedBox(facilities, x, z, gap) || blockedRoad(yardPaths, x, z, gap)) continue;
      if (markers.at(x, z).some(p => Math.hypot(x - p.x, z - p.z) < C.yardGap + size / 2 + p.size / 2)) continue;
      const marker = Object.freeze({ x, z, size }); yards.push(marker);
      markers.add(marker, x - C.yardGap - size, z - C.yardGap - size, x + C.yardGap + size, z + C.yardGap + size);
    }
  }
  let houses = data.houses;
  if (additions.length) {
    const countByKind = { ...houses.catalog.count_by_kind };
    for (const p of additions) { const name = houses.kinds.get(p.kind).node; countByKind[name] = (countByKind[name] || 0) + 1; }
    houses = { ...houses, instances: [...houses.instances, ...additions], catalog: { ...houses.catalog, count: houses.instances.length + additions.length, count_by_kind: countByKind } };
  }
  return { houses, lanes: Object.freeze(lanes), townPlots: Object.freeze(plots.filter((_, i) => !removed.has(i))), yards: Object.freeze(yards), stats: { axis, lanes: { count: Object.keys(lanes).length, length: laneLength }, plots: states,
    houses: { before: data.houses.instances.length, added: additions.length, skipped }, front, edge, supplemental, yards: yards.length, annexes: records.reduce((n, r, i) => n + (removed.has(i) ? 0 : Math.max(0, r.end - r.first - 1)), 0), work: { ...work, farTriangles } } };
}
