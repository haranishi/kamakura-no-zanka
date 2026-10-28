// Pure chunk ownership and bounded streaming. Resident distance is supplied by the view.
import { GRASS } from './config.js';
import { grassBudget } from './grass-field.js';
export const CHUNK_TILES = Object.freeze({ near: 3, mid: 6 });
export function chunkOf(kind, tx, tz) {
  const n = CHUNK_TILES[kind];
  if (!n || !Number.isInteger(tx) || !Number.isInteger(tz)) throw new RangeError('chunk: integer tiles and near/mid required');
  const cx = Math.floor(tx / n), cz = Math.floor(tz / n);
  return { cx, cz, key: `${kind}:${cx},${cz}` };
}
export function chunkTiles(kind, cx, cz) {
  const n = CHUNK_TILES[kind], out = [];
  if (!n || !Number.isInteger(cx) || !Number.isInteger(cz)) throw new RangeError('chunk: integer coordinates required');
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) out.push({ tx: cx * n + x, tz: cz * n + z });
  return out;
}
export function wantedChunks(tiles) {
  return Object.fromEntries(['near', 'mid'].map(kind => {
    const unique = new Map();
    for (const t of tiles[kind]) {
      const c = chunkOf(kind, t.tx, t.tz), old = unique.get(c.key);
      if (!old || t.dist < old.dist) unique.set(c.key, { ...c, dist: t.dist });
    }
    return [kind, [...unique.values()].sort((a, b) => a.dist - b.dist || a.cz - b.cz || a.cx - b.cx)];
  }));
}
// wanted/resident are arrays of {key,dist}. For a resident, dist is metres beyond
// the active outer radius (negative inside). A Map may be passed directly.
export function planChunks({ wanted, resident, maxBuild, hysteresis = 1.5 }) {
  const old = resident instanceof Map ? [...resident.values()] : resident;
  const active = new Set(wanted.map(c => c.key)), have = new Set(old.map(c => c.key));
  const build = [...wanted].sort((a, b) => a.dist - b.dist || a.key.localeCompare(b.key))
    .filter(c => !have.has(c.key)).map(c => c.key);
  return { build: [...new Set(build)].slice(0, Math.max(0, Math.floor(maxBuild))),
    evict: [...new Set(old.filter(c => !active.has(c.key) && c.dist > hysteresis).map(c => c.key))] };
}
export function chunkBudget(quality = 'standard') {
  const base = grassBudget(quality);
  // Mid includes three star plates and min(3, ceil(2 cards × 1.8 patch × quality)).
  // This bounds standard/light at 38,592/9,984 triangles while preserving mean card density.
  // Near uses the existing outer tile overhang for the extended shader fade; no extra tiles.
  // Upload only active tiles from each fully cached chunk. Even an all-susuki
  // cell adds at most 10 long leaves + 3 heads; flowers add only six ribbons.
  const near = { ...base.near, triangles: base.near.triangles + base.near.tiles * 13 * 6 };
  const q = GRASS.quality[quality];
  // Sample all offsets in a chunk; expand by the maximum sampling error.
  const chunks = (radius, size) => {
    let max = 0; const r = radius + Math.SQRT2 * size / 32;
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) {
      const x = i * size / 16, z = j * size / 16; let count = 0;
      for (let cz = Math.floor((z-r)/size); cz <= Math.floor((z+r)/size); cz++)
        for (let cx = Math.floor((x-r)/size); cx <= Math.floor((x+r)/size); cx++)
          if (Math.hypot(Math.max(cx*size-x,0,x-(cx+1)*size),Math.max(cz*size-z,0,z-(cz+1)*size)) <= r) count++;
      max = Math.max(max, count);
    }
    return max;
  };
  return { near, mid: base.mid, nearChunks: chunks(GRASS.nearRadius * q.distance, GRASS.nearSize * CHUNK_TILES.near), midChunks: chunks(GRASS.midRadius * q.distance, GRASS.midSize * CHUNK_TILES.mid) };
}
