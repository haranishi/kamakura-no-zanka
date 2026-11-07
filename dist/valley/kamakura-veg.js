// Pure private-placement decoding, filtering and bounded spatial selection. No scene state.
import { TREES } from './config.js';
import { lodMembership } from './tree-lod.js';
export const VEG_FIELDS = ['x_east_m', 'z_south_m', 'y_up_m', 'yaw_rad', 'height_m', 'crown_radius_m', 'species', 'tier', 'variant', 'tint', 'wind_phase', 'lean_rad', 'thin_rank', 'reserved_13', 'reserved_14', 'reserved_15'];
export const TREE_NAMES = ['cedar', 'zelkova', 'pine', 'maple', 'sapling', 'shrub'];
export function decodeVeg(info, buffer, count = info?.count) {
  if (info?.schema !== 'kz-veg-web/0.1' || info.file !== 'veg_f32.bin' || info.encoding !== 'float32-le (N,16)' ||
      !Number.isInteger(count) || count < 0 || count > 2e6 || count !== info.count ||
      JSON.stringify(info.fields) !== JSON.stringify(VEG_FIELDS) || buffer.byteLength !== count * 64) throw new Error('木のデータ形式・長さが不正です');
  const view = new DataView(buffer), items = [];
  for (let i = 0; i < count; i++) {
    const v = Array.from({ length: 16 }, (_, k) => view.getFloat32(i * 64 + k * 4, true));
    if (!v.every(Number.isFinite) || ![6, 7, 8].every((k, j) => Number.isInteger(v[k]) && v[k] >= 0 && v[k] <= [6, 2, 3][j]) ||
        v[4] <= 0 || v[5] < 0 || Math.abs(v[9]) > 1 || [10, 12].some(k => v[k] < 0 || v[k] > 1)) throw new Error('木の配置が不正です');
    items.push({ id: i, x: v[0], z: v[1], yaw: v[3], height: v[4], crown: v[5], sourceSpecies: v[6], tier: v[7], variant: v[8], tint: v[9], phase: v[10], lean: v[11], rank: v[12] });
  }
  return items;
}
export const treesEnabled = search => new URLSearchParams(search).get('trees') !== '0';
// W2c-9r1 veg: the near trunk bows, the middle trunk is one straight prism. Entering early (inside the near model's
// opaque range) drew it as a pale dithered ghost beside the trunk. It now enters as the near trunk starts to leave.
// `&vtrunk=0` restores the shared enter-early window for A/B comparison.
export const vegTrunkHandover = search => new URLSearchParams(search).get('vtrunk') !== '0';
export const vegTrunkLod = ({ lod: [a, b], blend: w }) => [a, a + w, b, b + 2 * w];
const smooth = (a, b, d) => { const t = Math.max(0, Math.min(1, (d - a) / (b - a))); return t * t * (3 - 2 * t); };
// [near trunk, middle trunk] weights as the shader evaluates them (the near model leaves over a..a+2w).
export function vegTrunkWeights(distance, policy, handover = true) {
  const [a, b] = policy.lod, w = policy.blend, [x0, x1, z0, z1] = handover ? vegTrunkLod(policy) : [a - 2 * w, a, b, b + 2 * w];
  return [1 - smooth(a, a + 2 * w, distance), smooth(x0, x1, distance) * (1 - smooth(z0, z1, distance))];
}
export function mapVeg(item) {
  const species = [1, 2, 0, 1, 5, null, 3][item.sourceSpecies];
  if (item.tier !== 0 || species === null) return null;
  const name = TREE_NAMES[species], shape = Math.min(item.variant, (TREES.variants[name] ?? 1) - 1);
  const linear = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  const hex = TREES.palette[name][0].slice(1), gain = 1 + .12 * item.tint;
  const color = [0, 2, 4].map((k, j) => linear(parseInt(hex.slice(k, k + 2), 16) / 255) * gain * (item.sourceSpecies === 0 ? [.50, .55, .61][j] : 1));
  return { ...item, species, shape, color };
}
const key = (x, z) => `${x},${z}`;
// Bounds are indexed too, so exclusions do not scan every house for every tree.
function insert(grid, value, minX, maxX, minZ, maxZ, cell = 256) {
  for (let x = Math.floor(minX / cell); x <= Math.floor(maxX / cell); x++) for (let z = Math.floor(minZ / cell); z <= Math.floor(maxZ / cell); z++) {
    const k = key(x, z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(value);
  }
}
function nearHouse(b, p) {
  const c = Math.cos(b.rotY), s = Math.sin(b.rotY), dx = p.x - b.x, dz = p.z - b.z;
  return Math.hypot(Math.max(0, Math.abs(dx * c - dz * s) - b.w / 2), Math.max(0, Math.abs(dx * s + dz * c) - b.d / 2)) <= 1;
}
function segmentDistance(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}
export function vegExclusions(terrain, { boxes = [], paths = {}, spawn, pathMargin = 2.5, spawnMargin = 3 } = {}) {
  const obstacles = new Map(), routes = new Map();
  for (const b of boxes) { const r = Math.hypot(b.w, b.d) / 2 + 1; insert(obstacles, b, b.x - r, b.x + r, b.z - r, b.z + r); }
  for (const p of Object.values(paths)) for (let i = 1; i < p.xyz_m.length; i++) {
    const a = { x: p.xyz_m[i - 1][0], z: -p.xyz_m[i - 1][1] }, b = { x: p.xyz_m[i][0], z: -p.xyz_m[i][1] };
    insert(routes, { a, b }, Math.min(a.x, b.x) - pathMargin, Math.max(a.x, b.x) + pathMargin, Math.min(a.z, b.z) - pathMargin, Math.max(a.z, b.z) + pathMargin);
  }
  return item => {
    const k = key(Math.floor(item.x / 256), Math.floor(item.z / 256));
    return (obstacles.get(k) || []).some(b => nearHouse(b, item)) ? 'house'
      : (routes.get(k) || []).some(({ a, b }) => segmentDistance(item, a, b) <= pathMargin) ? 'path'
      : spawn && Math.hypot(item.x - spawn.x, item.z - spawn.z) <= spawnMargin ? 'spawn'
      : terrain.waterAt(item.x, item.z) > 0 || terrain.heightAt(item.x, item.z) <= 0 ? 'water' : null;
  };
}
export function prepareVeg(items, terrain, options = {}) {
  const exclude = options.exclude || vegExclusions(terrain, options);
  const records = [], active = [], excluded = { house: 0, path: 0, spawn: 0, water: 0 }, grid = new Map(); let insideA = 0;
  for (const raw of items) {
    const item = mapVeg(raw); if (!item) continue;
    const reason = exclude(item);
    item.excluded = reason; records.push(item);
    if (reason) { excluded[reason]++; continue; }
    item.y = terrain.heightAt(item.x, item.z); item.insideA = terrain.insideA(item.x, item.z);
    if (item.insideA) insideA++;
    active.push(item); insert(grid, item, item.x, item.x, item.z, item.z);
  }
  return { records, active, grid, excluded, insideA };
}
export function nearbyVeg(grid, pos, radius) {
  const items = []; let cells = 0;
  for (let x = Math.floor((pos.x - radius) / 256); x <= Math.floor((pos.x + radius) / 256); x++) for (let z = Math.floor((pos.z - radius) / 256); z <= Math.floor((pos.z + radius) / 256); z++) {
    const dx = Math.max(x * 256 - pos.x, 0, pos.x - (x + 1) * 256), dz = Math.max(z * 256 - pos.z, 0, pos.z - (z + 1) * 256);
    if (Math.hypot(dx, dz) > radius) continue;
    const bucket = grid.get(key(x, z)); if (bucket) { cells++; items.push(...bucket); }
  }
  return { items, cells };
}
export function vegPolicy(quality = 'standard') {
  const light = quality === 'light';
  // TREES.budget is triangles per geometry, not an instance capacity. Separate global instance caps.
  return { lod: TREES.lod[light ? 'light' : 'standard'], blend: TREES.lod.blend[light ? 'light' : 'standard'], range: light ? 300 : 450, capacities: light ? [64, 600, 2500] : [128, 1800, 6000] };
}
export function selectVeg(grid, pos, policy = vegPolicy()) {
  const found = nearbyVeg(grid, pos, policy.range + 6), levels = [[], [], []], dropped = [0, 0, 0];
  const sorted = found.items.map(item => ({ item, distance: Math.hypot(item.x - pos.x, item.z - pos.z) }))
    .filter(v => v.distance <= policy.range + 6).sort((a, b) => a.distance - b.distance || a.item.rank - b.item.rank || a.item.id - b.item.id);
  for (const { item, distance } of sorted) {
    const small = item.species === 5, cfg = TREES.shrub, range = policy.range === 300 ? cfg.lightDistance : cfg.distance;
    if (small && distance > range + 6) continue;
    const member = lodMembership(distance, small ? { lod: [cfg.split, Infinity], blend: 0 } : policy);
    for (let level = 0; level < (small ? 2 : 3); level++) if (member[level]) {
      if (levels[level].length < policy.capacities[level]) levels[level].push(item); else dropped[level]++;
    }
  }
  return { levels, dropped, cells: found.cells, scanned: found.items.length };
}
export function vegCircles(prepared, heightOf) {
  return prepared.active.filter(i => i.species !== 5 && i.insideA).map(i => ({ x: i.x, z: i.z, r: (i.species === 1 ? .42 : .32) * i.height / heightOf(i.species, i.shape), kind: i.species }));
}
