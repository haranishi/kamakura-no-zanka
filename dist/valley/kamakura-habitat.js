// kamakura-habitat.js — W2c-16: "what kind of place is this?" as one pure answer, shared by everything that has to agree about it:
// what drifts in the air, which animals live here, and which sounds are heard. Why one module: when each feature guessed on its own,
// the eye and the ear could disagree (cicadas over the open beach, sea birds deep in the cedar wood).
// Weights are 0–1 and independent of each other (a riverside meadow is both meadow and river). Coordinates: x east, z south, metres.
import { createSurfaceCodeAt } from './kamakura-surface.js';

export const HABITAT_KEYS = Object.freeze(['meadow', 'forest', 'sand', 'paddy', 'bare', 'rock', 'river', 'shore', 'town', 'temple', 'pass']);
// Ground classes of the surface grid, in file order: sand, wet sand or mud, grass, forest floor, soil, rock, gravel, paddy.
const GROUND = ['sand', 'sand', 'meadow', 'forest', 'bare', 'rock', 'bare', 'paddy'];
const GROUND_KEYS = ['meadow', 'forest', 'sand', 'paddy', 'bare', 'rock'];
// ring: the ground is averaged over the spot (counted twice) and eight points this far away, so a single odd cell does not flip the answer.
// riverReach/shoreReach: where running water and surf stop mattering. townFull: houses per townCell square that count as "in town".
// placeCore/placeReach: full weight inside the core of a temple, shrine or pass, fading to nothing at the reach.
export const HABITAT = Object.freeze({ ring: 14, riverReach: 60, shoreReach: 180, townCell: 60, townFull: 8, placeCore: 70, placeReach: 260 });
const RING = [[1, 0], [-1, 0], [0, 1], [0, -1], [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2]];
const clamp01 = v => Math.max(0, Math.min(1, v));
const PLACE_GROUP = { temple: 'temple', shrine: 'temple', pass: 'pass' };

// terrain: riverDistanceAt(x, z, reach) and optional seaDistanceAt(x, z). meta/surface: the world's meta.json and surface grid (may be absent).
// housePoints: anything with x and z (house boxes work). places: meta.places entries { name, kind, x (east), y (north) }.
export function createHabitat({ terrain, meta, surface, housePoints = [], places = meta?.places || [] } = {}) {
  const codeAt = createSurfaceCodeAt(meta || { grid: { width: 0, height: 0, cell_m: 1 } }, surface);
  // Houses per cell, read with bilinear interpolation between cell centres (a smooth "how built-up" field).
  const cell = HABITAT.townCell, counts = new Map();
  for (const p of housePoints) {
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.z)) continue;
    const key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const count = (i, j) => counts.get(`${i},${j}`) || 0;
  function townAt(x, z) {
    if (!counts.size) return 0;
    const gx = x / cell - .5, gz = z / cell - .5, i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j;
    const n = (count(i, j) * (1 - u) + count(i + 1, j) * u) * (1 - v) + (count(i, j + 1) * (1 - u) + count(i + 1, j + 1) * u) * v;
    return clamp01(n / HABITAT.townFull);
  }
  const marks = places.filter(p => PLACE_GROUP[p?.kind] && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map(p => ({ name: p.name, kind: p.kind, group: PLACE_GROUP[p.kind], x: p.x, z: 0 - p.y }));   // 0 - y: north is -z, and never a negative zero
  function placeWeight(group, x, z) {
    let best = 0;
    for (const m of marks) {
      if (m.group !== group) continue;
      const d = Math.hypot(m.x - x, m.z - z);
      if (d >= HABITAT.placeReach) continue;
      const t = clamp01((d - HABITAT.placeCore) / (HABITAT.placeReach - HABITAT.placeCore));
      best = Math.max(best, 1 - t * t * (3 - 2 * t));
    }
    return best;
  }
  // Writes every HABITAT_KEYS weight into out (pass a reused object on hot paths) and returns it.
  function at(x, z, out = {}) {
    for (const key of GROUND_KEYS) out[key] = 0;
    let total = 0;
    const add = (px, pz, weight) => { const kind = GROUND[codeAt(px, pz)]; if (kind) { out[kind] += weight; total += weight; } };
    add(x, z, 2);
    for (const [dx, dz] of RING) add(x + dx * HABITAT.ring, z + dz * HABITAT.ring, 1);
    if (total > 0) for (const key of GROUND_KEYS) out[key] /= total;
    const river = terrain?.riverDistanceAt ? terrain.riverDistanceAt(x, z, HABITAT.riverReach) : Infinity;
    const sea = terrain?.seaDistanceAt ? terrain.seaDistanceAt(x, z) : Infinity;
    out.river = clamp01(1 - river / HABITAT.riverReach);
    out.shore = clamp01(1 - sea / HABITAT.shoreReach);
    out.town = townAt(x, z);
    out.temple = placeWeight('temple', x, z);
    out.pass = placeWeight('pass', x, z);
    return out;
  }
  // The closest named place of the given kinds, or null. For sounds that come from somewhere (a temple bell).
  function nearestPlace(x, z, kinds = ['temple', 'shrine']) {
    let best = null, distance = Infinity;
    for (const m of marks) {
      if (!kinds.includes(m.kind)) continue;
      const d = Math.hypot(m.x - x, m.z - z);
      if (d < distance) { distance = d; best = m; }
    }
    return best ? { name: best.name, kind: best.kind, x: best.x, z: best.z, distance } : null;
  }
  return { at, nearestPlace };
}
// The ground kind with the largest weight ('' when the surface grid is absent).
export function habitatGround(weights) {
  let best = '', value = 0;
  for (const key of GROUND_KEYS) if (weights[key] > value) { value = weights[key]; best = key; }
  return best;
}
