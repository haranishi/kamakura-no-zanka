// Pure stand planning. Private placements are never persisted.
import { prepareVeg, nearbyVeg, vegExclusions } from './kamakura-veg.js';
import { canopyClumps, canopyEnabled } from './kamakura-canopy.js';
export const standsEnabled = search => new URLSearchParams(search).get('stands') !== '0' && new URLSearchParams(search).get('trees') !== '0';
export function standPolicy(quality = 'standard') {
  const light = quality === 'light';
  return { light, ranges: light ? [0, 3000, 5000] : [0, 5000, 8000], hide: [[0, 0], [100, 180], [500, 800]], enter: 200, retain: 450, perFrame: 2 };
}
export function standShrink(distance, near, far) {
  const t = Math.max(0, Math.min(1, (distance - near) / (far - near)));
  return t * t * (3 - 2 * t);
}
export const standChildCount = (r, light = false) => {
  const n = Math.max(3, Math.min(16, Math.round(Math.PI * r * r / 70)));
  return light ? Math.max(3, Math.round(n / 2)) : n;
};
// Integer PRNG: id alone fixes the sequence, without time or host randomness.
function randomFor(id) {
  let state = (id ^ 0x9e3779b9) >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
// スクリーンショットから測った見た目の色（2026-11-06）。BRIEF-W2C5B-FIX の樹冠中間色。
// Private sourceSpecies: 照葉樹・松・杉・落葉。葉テクスチャ用のpaletteとは別。
export const STAND_COLOR = Object.freeze([
  Object.freeze([34, 48, 24]), Object.freeze([14, 33, 13]),
  Object.freeze([42, 69, 35]), Object.freeze([50, 61, 26])
]);
export function standColor(item) {
  const linear = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  // Discard initial correlated LCG draws so adjacent placement ids have visible variation.
  const rng = randomFor(item.id); rng(); rng();
  const gain = (1 + .12 * item.tint) * (1 + (rng() * 2 - 1) * .06);
  // Lighting gain ~1.1: divide in sRGB before converting; tint/jitter match tree linear gain.
  return STAND_COLOR[item.sourceSpecies].map(v => linear(v / 1.1 / 255) * gain);
}
export function standGround(item, terrain) {
  const { x, z } = item, r = item.crown * .7;
  return Math.min(...[[x,z],[x-r,z],[x+r,z],[x,z-r],[x,z+r]].map(([a,b]) => terrain.heightAt(a,b)));
}
export function standChildren(stand, light = false) {
  const rng = randomFor(stand.id), points = [], r = stand.crown;
  // Jittered triangular grid: 6m pitch and <=.35m jitter keep neighbours >=5m apart.
  const angle = rng() * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle);
  const ox = (rng() - .5) * 3, oz = (rng() - .5) * 3, span = Math.ceil(r / 5) + 1;
  for (let row = -span; row <= span; row++) for (let col = -span; col <= span; col++) {
    const x = (col + (row & 1) * .5) * 6 + ox + (rng() - .5) * .7;
    const z = row * Math.sqrt(27) + oz + (rng() - .5) * .7;
    if (Math.hypot(x, z) <= r) points.push({ x: x * c - z * s, z: x * s + z * c, order: rng() });
  }
  points.sort((a, b) => a.order - b.order);
  return points.slice(0, standChildCount(r, light)).map((p, k) => ({ ...stand, id: stand.id * 16 + k, tier: 0,
    x: stand.x + p.x, z: stand.z + p.z, height: stand.height * (.75 + .3 * rng()), yaw: rng() * Math.PI * 2,
    lean: (rng() - .5) * .12, tint: Math.max(-1, Math.min(1, stand.tint + (rng() - .5) * .4)),
    variant: Math.floor(rng() * 4), phase: rng(), rank: rng() }));
}
export function prepareStands(items, terrain, options = {}, policy = standPolicy()) {
  const distant = new Map(), grid = new Map(); let expandable = 0;
  for (const raw of items || []) {
    if (![1, 2].includes(raw.tier) || raw.sourceSpecies > 3 || (policy.light && raw.tier === 1 && raw.rank >= .5)) continue;
    const mapped = { ...raw, species: [1, 2, 0, 1][raw.sourceSpecies], color: standColor(raw) };
    const item = { ...mapped, tier: raw.tier, y: standGround(raw, terrain), expandable: raw.tier === 1 && terrain.insideA(raw.x, raw.z) };
    const dk = `${item.tier}/${item.sourceSpecies}/${Math.floor(item.x / 1000)},${Math.floor(item.z / 1000)}`;
    if (!distant.has(dk)) distant.set(dk, []); distant.get(dk).push(item);
    if (item.expandable) {
      expandable++;
      const k = `${Math.floor(item.x / 256)},${Math.floor(item.z / 256)}`;
      if (!grid.has(k)) grid.set(k, []); grid.get(k).push(item);
    }
  }
  let canopy = null;
  if (options.preparedVeg && canopyEnabled(options.search || '')) {
    canopy = canopyClumps(options.preparedVeg, { quality: policy.light ? 'light' : 'standard', existing: [...distant.values()].flat() });
    for (const item of canopy.clumps) {
      const k = `0/${Math.floor(item.x / 1000)},${Math.floor(item.z / 1000)}`;
      if (!distant.has(k)) distant.set(k, []);
      distant.get(k).push(item);
    }
  }
  return { distant, grid, expandable, terrain, exclude: vegExclusions(terrain, options), policy, canopy };
}
export function planStandChunks(prepared, resident, pos) {
  const wanted = new Map();
  // nearbyVeg visits intersecting cells, not every placement in the world.
  for (const item of nearbyVeg(prepared.grid, pos, prepared.policy.enter).items) {
    const k = `${Math.floor(item.x / 256)},${Math.floor(item.z / 256)}`;
    wanted.set(k, prepared.grid.get(k));
  }
  const distance = k => {
    const [x, z] = k.split(',').map(Number);
    return Math.hypot(Math.max(x * 256 - pos.x, 0, pos.x - (x + 1) * 256), Math.max(z * 256 - pos.z, 0, pos.z - (z + 1) * 256));
  };
  const create = [...wanted.keys()].filter(k => !resident.has(k)).sort((a, b) => distance(a) - distance(b) || a.localeCompare(b));
  const remove = [...resident.keys()].filter(k => distance(k) > prepared.policy.retain);
  return { create, remove };
}
export function generateStandChunk(prepared, key) {
  const children = (prepared.grid.get(key) || []).flatMap(i => standChildren(i, prepared.policy.light));
  // Outside-A candidates are excluded even when their parent centre is inside A.
  return prepareVeg(children.filter(i => prepared.terrain.insideA(i.x, i.z)), prepared.terrain, { exclude: prepared.exclude });
}
export function combineStandChunks(resident) {
  const active = [], grid = new Map();
  for (const chunk of resident.values()) {
    active.push(...chunk.active);
    for (const [key, items] of chunk.grid) { if (!grid.has(key)) grid.set(key, []); grid.get(key).push(...items); }
  }
  return { active, grid };
}
