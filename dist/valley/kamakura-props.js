// W2c-16g: deterministic placement only. North in source paths/places is -z.
import { kamakuraPaths } from './kamakura-roads.js';
import { pathRadius } from './kamakura-ground-path.js';
export const PROP_KINDS = Object.freeze(['lantern', 'gorinto', 'jizo', 'nobori', 'smoke', 'yard', 'boat']);
export const PROPS = Object.freeze({ range: 220, smokeRange: 350, boatRange: 400, refresh: 60, fade: 30, triangles: 60000, batch: 64, budget: 3 });
export const propHash = (x, z, salt = 0) => { const n = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453; return n - Math.floor(n); };
export const propCounts = () => Object.fromEntries(PROP_KINDS.map(k => [k, 0]));
export const propRange = (kind, quality = 'standard', step = 0) => (kind === 'smoke' ? PROPS.smokeRange : kind === 'boat' ? PROPS.boatRange : PROPS.range) * (quality === 'light' ? .75 : 1) * (step >= 2 ? .6 : 1);
export function propFade(distance, range) { const t = Math.max(0, Math.min(1, (distance - range + PROPS.fade) / PROPS.fade)); return 1 - t * t * (3 - 2 * t); }
export function propBoxDistance(x, z, b) {
  const c = Math.cos(b.rotY || 0), s = Math.sin(b.rotY || 0), dx = x - b.x, dz = z - b.z;
  return Math.hypot(Math.max(0, Math.abs(dx * c - dz * s) - b.w / 2), Math.max(0, Math.abs(dx * s + dz * c) - b.d / 2));
}
const segmentDistance = (x, z, s) => {
  const dx = s.bx - s.ax, dz = s.bz - s.az, t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - s.ax - t * dx, z - s.az - t * dz);
};
// Spatial indices are built once; no geography or world-specific constants are stored.
function index(cell = 32) {
  const grid = new Map();
  return {
    add(item, x0, z0, x1 = x0, z1 = z0) {
      for (let x = Math.floor(x0 / cell); x <= Math.floor(x1 / cell); x++) for (let z = Math.floor(z0 / cell); z <= Math.floor(z1 / cell); z++) {
        const key = `${x},${z}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(item);
      }
    },
    at(x, z) { return grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) || []; },
  };
}
function facilityRecords(data, facilities) {
  const known = new Map((facilities?.records || []).map(r => [r.node.node, r]));
  return (data.facilities?.nodes || []).map(node => {
    if (known.has(node.node)) return known.get(node.node);
    const a = node.bbox_min, b = node.bbox_max;
    return { node, bounds: { x: node.anchor_xz[0] + (a[0] + b[0]) / 2, z: node.anchor_xz[1] + (a[2] + b[2]) / 2, w: b[0] - a[0], d: b[2] - a[2], rotY: 0 } };
  });
}
// A fence or cloister record is the bounding box of a whole ring: only its band is built, the yard inside is open ground.
export const PROP_HOLLOW = Object.freeze({ fence: 1.2, kairo: 7 });
export function propInBox(x, z, b, margin) {
  const outside = propBoxDistance(x, z, b);
  if (!b.hollow || outside > 0) return outside < margin;
  const c = Math.cos(b.rotY || 0), s = Math.sin(b.rotY || 0), dx = x - b.x, dz = z - b.z;
  return Math.min(b.w / 2 - Math.abs(dx * c - dz * s), b.d / 2 - Math.abs(dx * s + dz * c)) < b.hollow + margin;
}
export function createPropSite({ data = {}, terrain, facilities, houses } = {}) {
  const records = facilityRecords(data, facilities), boxIndex = index(), paths = [], pathIndex = index();
  const boxes = [...(houses?.boxes || []), ...records.map(r => PROP_HOLLOW[r.node.part] ? { ...r.bounds, hollow: PROP_HOLLOW[r.node.part] } : r.bounds)];
  for (const b of boxes) { const r = Math.hypot(b.w, b.d) / 2 + 6; boxIndex.add(b, b.x - r, b.z - r, b.x + r, b.z + r); }
  // Pass paths and, where the data has them, the roads. A road wider than a pass path keeps things that much farther from its line.
  for (const path of Object.values(kamakuraPaths(data) || {})) {
    const points = path.xyz_m || [], extra = Math.max(0, pathRadius(path) - 2.5), reach = 8 + extra;
    for (let i = 1; i < points.length; i++) {
      const s = { ax: points[i - 1][0], az: -points[i - 1][1], bx: points[i][0], bz: -points[i][1], extra };
      paths.push(s); pathIndex.add(s, Math.min(s.ax, s.bx) - reach, Math.min(s.az, s.bz) - reach, Math.max(s.ax, s.bx) + reach, Math.max(s.az, s.bz) + reach);
    }
  }
  function reason(p) {
    const { x, z } = p, radius = p.kind === 'boat' ? 5.1 : p.kind === 'yard' ? .7 : p.kind === 'nobori' ? .5 : p.kind === 'lantern' ? .6 : .45;
    // Smoke is intentionally on a roof. Check its terrain, not the house containing its source.
    if (p.kind !== 'smoke') {
      for (const b of boxIndex.at(x, z)) if (propInBox(x, z, b, .3 + radius)) return 'box';
      const pathClearance = Math.max(2 + radius, p.kind === 'gorinto' ? 3 : p.kind === 'jizo' ? 2.5 : 0);
      for (const s of pathIndex.at(x, z)) if (segmentDistance(x, z, s) <= pathClearance + s.extra) return 'path';
    }
    if (!Number.isFinite(terrain.heightAt(x, z)) || !terrain.walkable(x, z)) return 'walk';
    if (terrain.slopeAt(x, z) > 25) return 'slope';
    if (terrain.waterAt(x, z) > 0 || terrain.seaDistanceAt?.(x, z) < (p.kind === 'boat' ? 8 : 3) || terrain.riverDistanceAt?.(x, z, 2) <= 0) return 'water';
    // Check the footprint as well: a centre on dry ground must not put the bow in water.
    if (p.kind === 'boat') for (let end = -1; end <= 1; end += 2) {
      const ex = x + Math.sin(p.yaw) * end * 4, ez = z + Math.cos(p.yaw) * end * 4;
      if (!terrain.walkable(ex, ez) || terrain.waterAt(ex, ez) > 0 || terrain.slopeAt(ex, ez) > 25) return 'water';
    }
    return null;
  }
  return { records, boxes, paths, reason };
}
export function* propPlacementBatches(context, { time = 'noon', only = null } = {}) {
  const { data = {}, terrain, habitat } = context, site = createPropSite(context), items = [], placed = propCounts(), skipped = propCounts(), occupied = index(16), weights = {};
  const why = Object.fromEntries(PROP_KINDS.map(k => [k, {}])), result = { items, placed, skipped, why, site };
  // Why a prop was not placed (box, path, walk, slope, water, near): for the debug readout only.
  const blame = (p, n = 1, r = site.reason(p) || 'near') => { why[p.kind][r] = (why[p.kind][r] || 0) + n; };
  let tsuruBanners = 0;
  const wanted = kind => !only || kind === only;
  const candidate = (kind, x, z, yaw = 0, group = '') => {
    let y = terrain.heightAt(x, z);
    // Upright feet follow the lowest corner, rather than floating on the downhill side.
    if (kind !== 'smoke' && kind !== 'boat') {
      const radius = kind === 'yard' ? .72 : kind === 'nobori' ? .05 : .4;
      for (let dx = -1; dx <= 1; dx += 2) for (let dz = -1; dz <= 1; dz += 2) y = Math.min(y, terrain.heightAt(x + dx * radius, z + dz * radius));
    }
    return { kind, x, z, y, yaw: yaw + (propHash(x, z, 2) - .5) * Math.PI / 15, scale: .9 + .2 * propHash(x, z, 3), variant: propHash(x, z, 4) < .5 ? 0 : 1, age: propHash(x, z, 5), tiltX: 0, tiltZ: 0, group };
  };
  const valid = p => !site.reason(p) && occupied.at(p.x, p.z).every(q => Math.hypot(p.x - q.x, p.z - q.z) >= (p.kind === 'boat' || q.kind === 'boat' ? 3 : .8));
  const store = p => { items.push(p); placed[p.kind]++; occupied.add(p, p.x - 4, p.z - 4, p.x + 4, p.z + 4); };
  const add = p => { if (!wanted(p.kind)) return; if (valid(p)) store(p); else { skipped[p.kind]++; blame(p); } };
  const pair = (a, b) => { if (!wanted(a.kind)) return; if (valid(a) && valid(b)) { store(a); store(b); } else { skipped[a.kind] += 2; blame(valid(a) ? b : a, 2); } };
  const local = (b, u, v) => ({ x: b.x + Math.cos(b.rotY || 0) * u + Math.sin(b.rotY || 0) * v, z: b.z - Math.sin(b.rotY || 0) * u + Math.cos(b.rotY || 0) * v });
  const marks = data.meta?.places || [];
  for (const r of site.records) {
    const { node, bounds: b } = r;
    if (node.part === 'hall') {
      const gates = site.records.filter(g => g.node.facility === node.facility && ['gate', 'romon', 'torii'].includes(g.node.part));
      let dx, dz, length;
      if (gates.length) {
        gates.sort((a, c) => Math.hypot(a.bounds.x - b.x, a.bounds.z - b.z) - Math.hypot(c.bounds.x - b.x, c.bounds.z - b.z));
        dx = gates[0].bounds.x - b.x; dz = gates[0].bounds.z - b.z; length = Math.hypot(dx, dz); dx /= length || 1; dz /= length || 1;
      } else {
        // Front is a long face. Prefer the side with more walkable, unoccupied approach samples.
        const a = local(b, b.w >= b.d ? 0 : 1, b.w >= b.d ? 1 : 0); dx = a.x - b.x; dz = a.z - b.z;
        let plus = 0, minus = 0;
        for (let n = 1; n <= 5; n++) { if (!site.reason(candidate('lantern', b.x + dx * (Math.min(b.w, b.d) / 2 + n * 6), b.z + dz * (Math.min(b.w, b.d) / 2 + n * 6)))) plus++; if (!site.reason(candidate('lantern', b.x - dx * (Math.min(b.w, b.d) / 2 + n * 6), b.z - dz * (Math.min(b.w, b.d) / 2 + n * 6)))) minus++; }
        if (minus > plus) { dx = -dx; dz = -dz; } length = Math.min(b.w, b.d) / 2 + 30;
      }
      const edge = Math.abs(dx * Math.cos(b.rotY || 0) - dz * Math.sin(b.rotY || 0)) * b.w / 2 + Math.abs(dx * Math.sin(b.rotY || 0) + dz * Math.cos(b.rotY || 0)) * b.d / 2;
      const count = Math.max(2, Math.min(5, Math.floor((length - edge) / 9)));
      for (let n = 0; n < count; n++) {
        const distance = edge + 5 + n * 9, x = b.x + dx * distance, z = b.z + dz * distance;
        if (gates.length && distance >= length - 2) { if (wanted('lantern')) { skipped.lantern += 2; blame({ kind: 'lantern' }, 2, 'gate'); } continue; }
        pair(candidate('lantern', x - dz * 3.8, z + dx * 3.8, Math.atan2(dx, dz), node.node), candidate('lantern', x + dz * 3.8, z - dx * 3.8, Math.atan2(dx, dz), node.node));
      }
      const countTowers = 3 + Math.floor(propHash(b.x, b.z, 9) * 7);
      let towerU = b.w / 2 + 2.5, towerV = -b.d / 2 - 2.5, insideFence = false;
      const fences = site.records.filter(f => f.node.facility === node.facility && f.node.part === 'fence');
      if (fences.length >= 3) {
        let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
        const c = Math.cos(b.rotY || 0), s = Math.sin(b.rotY || 0);
        for (const f of fences) { const u = (f.bounds.x - b.x) * c - (f.bounds.z - b.z) * s, v = (f.bounds.x - b.x) * s + (f.bounds.z - b.z) * c; minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
        if (maxU - minU > b.w + 9 && maxV - minV > b.d + 9) { towerU = maxU - 3; towerV = minV + 3; insideFence = true; }
      }
      for (let n = 0; n < countTowers; n++) {
        const p = local(b, towerU + (insideFence ? -1 : 1) * (n % 3) * 1.4, towerV + (insideFence ? 1 : -1) * Math.floor(n / 3) * 1.4);
        add(candidate('gorinto', p.x, p.z, 0, node.node));
      }
    }
    if (['gate', 'romon', 'torii'].includes(node.part)) {
      const count = node.facility === 'tsurugaoka' ? Math.min(8, 12 - tsuruBanners) : 2;
      if (node.facility === 'tsurugaoka') tsuruBanners += count;
      for (let n = 0; n < count; n++) {
        // 3m clear of the posts: at 2m the cloth sat under the gate eaves.
        const p = local(b, (n % 2 ? -1 : 1) * (b.w / 2 + 3), Math.floor(n / 2) * 8);
        add(candidate('nobori', p.x, p.z, b.rotY || 0, node.node));
      }
    }
    yield result;
  }
  for (const [name, path] of Object.entries(data.patches?.paths || {})) {
    const points = path.xyz_m || [];
    if (points.length < 2) continue;
    for (const end of [0, points.length - 1]) {
      const p = points[end], next = points[end === 0 ? 1 : end - 1], x = p[0], z = -p[1], dx = next[0] - x, dz = -next[1] - z, len = Math.hypot(dx, dz) || 1;
      habitat?.at(x, z, weights); if (!(weights.pass > .05)) continue;
      const sideX = -dz / len, sideZ = dx / len;
      const jizos = 1 + Math.floor(propHash(x, z, 11) * 3), towers = 2 + Math.floor(propHash(x, z, 12) * 4);
      for (let n = 0; n < jizos; n++) { const px = x + sideX * 3.4 + dx / len * n * 1.4, pz = z + sideZ * 3.4 + dz / len * n * 1.4; add(candidate('jizo', px, pz, Math.atan2(-sideX, -sideZ), `${name}:${end}`)); }
      for (let n = 0; n < towers; n++) add(candidate('gorinto', x - sideX * (4 + n % 2 * 1.5) + dx / len * Math.floor(n / 2) * 1.5, z - sideZ * (4 + n % 2 * 1.5) + dz / len * Math.floor(n / 2) * 1.5, 0, `${name}:${end}`));
    }
    yield result;
  }
  const houses = context.houses?.boxes || [], smokeChance = ['morning', 'evening'].includes(time) ? .14 : .08;
  for (let i = 0; i < houses.length; i++) {
    const b = houses[i];
    if (propHash(b.x, b.z, 21) < smokeChance) { const p = candidate('smoke', b.x, b.z, 0); p.y += b.height; p.yaw = 0; p.scale = 1; add(p); }
    if (propHash(b.x, b.z, 22) < .25) {
      const sign = propHash(b.x, b.z, 23) < .5 ? -1 : 1, count = 1 + Math.floor(propHash(b.x, b.z, 24) * 2);
      for (let n = 0; n < count; n++) {
        const p = local(b, b.w >= b.d ? (n - .5) * 1.8 : sign * (b.w / 2 + 1.1), b.w >= b.d ? sign * (b.d / 2 + 1.1) : (n - .5) * 1.8);
        add(candidate('yard', p.x, p.z, (b.rotY || 0) + (b.d > b.w ? Math.PI / 2 : 0)));
      }
    }
    habitat?.at(b.x, b.z, weights);
    if (weights.town > .55 && propHash(b.x, b.z, 25) < .008) {
      const p = local(b, b.w / 2 + 4, b.d / 2 + 4); add(candidate('jizo', p.x, p.z, Math.atan2(b.x - p.x, b.z - p.z)));
    }
    if ((i + 1) % PROPS.batch === 0) yield result;
  }
  for (const mark of marks) {
    if (!['coast', 'port'].includes(mark.kind)) continue;
    if (!wanted('boat')) continue;
    const count = 4 + Math.floor(propHash(mark.x, mark.y, 31) * 7);
    for (let n = 0; n < count; n++) {
      let found = null;
      for (let trial = 0; trial < 160; trial++) {
        const angle = propHash(n + trial * 13, mark.x, 32) * Math.PI * 2, radius = Math.sqrt(propHash(n + trial * 7, mark.y, 33)) * 245, x = mark.x + Math.cos(angle) * radius, z = -mark.y + Math.sin(angle) * radius;
        const d = terrain.seaDistanceAt?.(x, z);
        if (!(d >= 8 && d <= 25)) continue;
        habitat?.at(x, z, weights); if (!(weights.sand > .4)) continue;
        // A 6m baseline: the sea field is a coarse grid, and a 1m difference turned boats up to ~50 degrees off the shore normal.
        const gx = terrain.seaDistanceAt(x + 6, z) - terrain.seaDistanceAt(x - 6, z), gz = terrain.seaDistanceAt(x, z + 6) - terrain.seaDistanceAt(x, z - 6);
        if (Math.hypot(gx, gz) < .06) continue;
        const p = candidate('boat', x, z, Math.atan2(-gx, -gz), mark.name);
        const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
        p.tiltX = Math.atan((terrain.heightAt(x - s, z - c) - terrain.heightAt(x + s, z + c)) / 2);
        p.tiltZ = Math.atan((terrain.heightAt(x + c, z - s) - terrain.heightAt(x - c, z + s)) / 2) + .08;
        if (valid(p)) { found = p; break; }
      }
      if (found) store(found); else { skipped.boat++; blame({ kind: 'boat' }, 1, 'shore'); }
      yield result;
    }
    yield result;
  }
  return result;
}
export function prepareProps(context, options) { const job = propPlacementBatches(context, options); let next; do { next = job.next(); } while (!next.done); return next.value; }
