// Pure, camera-independent aggregation of already filtered trees. No private placements persist.
import { vegPolicy } from './kamakura-veg.js';
export const CANOPY = Object.freeze({
  cell: 18, // m: standard aggregation cell edge, anchored at world zero.
  lightCell: 28, // m: light aggregation cell edge.
  limit: 40000, // clumps: standard capacity before deterministic regridding.
  lightLimit: 14000, // clumps: light capacity before regridding.
  growth: 1.15, // ratio: cell enlargement on overflow.
  radius: .58, // cell edges: dense-cell crown radius.
  coverageGain: 1.1, // ratio: F4 measured coverage correction, still capped by maxRadius.
  maxRadius: .66, // cell edges: maximum crown radius.
  sparseGain: 1.2, // ratio: summed tree crown radii in cells with <=2 trees.
  minRadius: 4.5, // m: minimum sparse crown radius.
  overlap: 10, // m: suppress clump centres this close to an existing T1/T2 centre.
  handoff: 70, // m: grow before the individual-tree horizontal cutoff.
  coverageStep: 8, // m: forest-floor coverage sampling pitch.
});
export const canopyEnabled = search => new URLSearchParams(search).get('canopy') !== '0';
export const stands2Enabled = search => new URLSearchParams(search).get('stands2') !== '0';
export function canopyHandoff(quality = 'standard', impostorRange = 1) {
  const to = vegPolicy(quality).range * impostorRange;
  return { from: to - CANOPY.handoff, to };
}
export function canopyScale(distance, from, to) {
  const t = Math.max(0, Math.min(1, (distance - from) / (to - from)));
  return t * t * (3 - 2 * t);
}
export function canopyClumps(prepared, { quality = 'standard', existing = [], cell, limit } = {}) {
  cell ??= quality === 'light' ? CANOPY.lightCell : CANOPY.cell;
  limit ??= quality === 'light' ? CANOPY.lightLimit : CANOPY.limit;
  if (!(cell > 0) || !Number.isFinite(cell) || !Number.isInteger(limit) || limit < 4) throw new RangeError('Invalid canopy capacity or cell');
  const occupied = new Map(), pitch = CANOPY.overlap;
  for (const i of existing) {
    const k = `${Math.floor(i.x / pitch)},${Math.floor(i.z / pitch)}`;
    if (!occupied.has(k)) occupied.set(k, []);
    occupied.get(k).push(i);
  }
  // Stable summation and species ties, even if the caller reorders its spatial buckets.
  const trees = prepared.active.filter(i => !i.excluded && i.species !== 5).slice().sort((a, b) => a.id - b.id);
  let passes = 0, scanned = 0;
  for (;;) {
    passes++;
    const grid = new Map();
    for (const i of trees) {
      scanned++;
      const k = `${Math.floor(i.x / cell)},${Math.floor(i.z / cell)}`;
      let b = grid.get(k);
      if (!b) grid.set(k, b = { key: k, n: 0, weight: 0, x: 0, z: 0, y: Infinity, height: 0, crown: 0, tint: 0, species: new Map(), id: i.id });
      const w = Math.max(Number.EPSILON, i.crown);
      b.n++; b.weight += w; b.x += i.x * w; b.z += i.z * w;
      b.y = Math.min(b.y, i.y); b.height += i.height; b.crown += i.crown; b.tint += i.tint ?? 0;
      const key = i.sourceSpecies ?? i.species;
      const s = b.species.get(key);
      if (s) s.count++; else b.species.set(key, { count: 1, item: i });
    }
    const clumps = [];
    for (const b of grid.values()) {
      const x = b.x / b.weight, z = b.z / b.weight;
      let duplicate = false;
      for (let a = Math.floor(x / pitch) - 1; a <= Math.floor(x / pitch) + 1; a++) for (let c = Math.floor(z / pitch) - 1; c <= Math.floor(z / pitch) + 1; c++) {
        const nearby = occupied.get(`${a},${c}`);
        if (nearby) for (const i of nearby) if (Math.hypot(x - i.x, z - i.z) <= pitch) duplicate = true;
      }
      if (duplicate) continue;
      let best, chosen = Infinity, most = -1;
      for (const [key, s] of b.species) if (s.count > most || s.count === most && key < chosen) { best = s.item; chosen = key; most = s.count; }
      clumps.push({ id: b.id, cellKey: b.key, tier: 0, x, y: b.y, z,
        crown: Math.min(cell * CANOPY.maxRadius, (b.n <= 2 ? Math.max(CANOPY.minRadius, b.crown * CANOPY.sparseGain) : cell * CANOPY.radius) * CANOPY.coverageGain),
        height: b.height / b.n, species: best.species, sourceSpecies: best.sourceSpecies, color: best.color,
        tint: b.tint / b.n, trees: b.n, expandable: false });
    }
    if (clumps.length <= limit) return { clumps, cell, passes, scanned };
    cell *= CANOPY.growth;
  }
}
// Node measurement only: union of horizontal crown disks over litter inside the walk polygon.
export function canopyCoverage(terrain, clumps, step = CANOPY.coverageStep) {
  if (!(step > 0) || !Number.isFinite(step)) throw new RangeError('Invalid canopy sampling pitch');
  const grid = new Map(); let probes = 0;
  for (const i of clumps) {
    for (let x = Math.floor((i.x - i.crown) / step); x <= Math.floor((i.x + i.crown) / step); x++) for (let z = Math.floor((i.z - i.crown) / step); z <= Math.floor((i.z + i.crown) / step); z++) {
      const k = `${x},${z}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
  }
  let samples = 0, covered = 0;
  const b = terrain.bounds;
  for (let x = Math.ceil(b.minX / step) * step; x <= b.maxX; x += step) for (let z = Math.ceil(b.minZ / step) * step; z <= b.maxZ; z += step) {
    if (!terrain.insideA(x, z) || !(terrain.surfaceAt(x, z).litter > .5)) continue;
    samples++;
    const bucket = grid.get(`${Math.floor(x / step)},${Math.floor(z / step)}`);
    if (bucket) for (const i of bucket) { probes++; if (Math.hypot(x - i.x, z - i.z) <= i.crown) { covered++; break; } }
  }
  return { samples, covered, ratio: samples ? covered / samples : 0, probes };
}
