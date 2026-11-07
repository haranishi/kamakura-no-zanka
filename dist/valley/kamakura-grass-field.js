// Bounded, deterministic metre cells. Scheduling receives elapsed time from the view.
import { GRASS } from './config.js';
import { SHORT, TALL, FERN, SUSUKI } from './grass-field.js';
import { fbm } from './terrain-height.js';
import { vegExclusions } from './kamakura-veg.js';
export const GRASS_WINDOW = 96, GRASS_MOVE = 24, GRASS_EDGE = 6;
export const grassEnabled = search => new URLSearchParams(search).get('grass') !== '0';
export const grassFrameBudget = quality => quality === 'light' ? 1.5 : 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const noise = (seed, x, z, scale, offset) => fbm(x * scale, z * scale, seed + offset, 2);
const attributes = ['placeable', 'density', 'height', 'species', 'midPatch'];
const index = (f, x, z) => x < f.x0 || z < f.z0 || x >= f.x0 + f.nx || z >= f.z0 + f.nz ? -1 : (z - f.z0) * f.nx + x - f.x0;
export function grassEdge(field, x, z) {
  const d = Math.min(x - field.x0, z - field.z0, field.x0 + field.nx - 1 - x, field.z0 + field.nz - 1 - z);
  const t = clamp(d / GRASS_EDGE, 0, 1); return t * t * (3 - 2 * t);
}
// Reuse the collision grid (including dynamically registered stand trunks). No all-tree scan.
// No start-point exclusion: grass does not block anything, and a bare disc around the
// hero's start looked like a crop circle (seen in real Chrome, 2026-11-07).
export function grassExclusions(terrain, { colliders, extraColliders, paths = {} } = {}) {
  const path = vegExclusions({ waterAt: () => 0, heightAt: () => 1 }, { paths, pathMargin: 2.5 + Math.SQRT1_2 });
  return (x, z) => {
    const reason = path({ x, z }); if (reason) return reason;
    const margin = Math.SQRT1_2;
    const found = new Set();
    for (let j = Math.floor((z - margin - .4) / 8); j <= Math.floor((z + margin + .4) / 8); j++)
      for (let i = Math.floor((x - margin - .4) / 8); i <= Math.floor((x + margin + .4) / 8); i++)
        for (const col of [colliders, extraColliders]) for (const o of col?.grid.get(`${i},${j}`) || []) found.add(o);
    for (const o of found) {
      if (o.type === 'circle') { if (Math.hypot(x - o.x, z - o.z) <= o.r + margin) return 'trunk'; }
      else {
        const dx = x - o.x, dz = z - o.z;
        if (Math.abs(dx * o.c - dz * o.s) <= o.hx + .4 + margin && Math.abs(dx * o.s + dz * o.c) <= o.hz + .4 + margin) return 'box';
      }
    }
    return null;
  };
}
// Surface codes are the original eight classes, before the footstep mapping merges them.
export function createGrassCell(terrain, { surfaceCodeAt, exclude = () => null, seed = 1333 } = {}) {
  return (ix, iz) => {
    const x = ix + .5, z = iz + .5;
    const heights = [terrain.heightAt(ix, iz), terrain.heightAt(ix + 1, iz), terrain.heightAt(ix, iz + 1), terrain.heightAt(ix + 1, iz + 1)];
    const empty = { placeable: 0, density: 0, height: 0, species: SHORT, midPatch: 0, heights };
    const code = surfaceCodeAt?.(x, z), scale = ({ 0: .15, 2: 1, 3: .3, 4: .2 })[code];
    if (!scale || !terrain.walkable(x, z) || terrain.waterAt(x, z) > .05 || terrain.slopeAt(x, z) > 32 || exclude(x, z)) return empty;
    const [a,b,c,d] = heights;
    if (Math.max(Math.hypot(b-a,c-a),Math.hypot(d-c,d-b)) > Math.tan(32 * Math.PI / 180)) return empty;
    const river = terrain.riverDistanceAt(x, z, 25);   // only the 1.7 m exclusion and the 25 m bank band matter here
    if (river <= 1 + Math.SQRT1_2) return empty;
    const patch = clamp(.5 + GRASS.patch.largeWeight * noise(seed,x,z,GRASS.patch.largeScale,521) + GRASS.patch.smallWeight * noise(seed,x,z,GRASS.patch.smallScale,523),0,1);
    const density = (1 + (GRASS.maxDensity - 1) * patch) * scale;
    const s = noise(seed,x,z,GRASS.speciesScale,557);
    let species = code === 3 ? FERN : code === 0 ? SUSUKI : code === 4 ? SHORT : s > GRASS.tallThreshold ? TALL : SHORT;
    if (river < 25) species = s < GRASS.fernThreshold ? FERN : SUSUKI;
    // Fixed theoretical envelope replaces window-wide quantiles/normalisation: moving
    // the window must never change a shared cell's value. Same two-scale mid patch.
    const mid = clamp(1 + .4 * (noise(seed,x,z,1/3,593) + noise(seed,x,z,1/14,599)),.2,1.8);
    return { placeable: 1, density: Math.ceil(density * 255 / 2), height: Math.round(clamp(.5 + noise(seed,x,z,GRASS.heightScale,541)*.5,0,1)*255), species, midPatch: mid * scale, heights };
  };
}
function emptyField(pos, seed) {
  const nx = GRASS_WINDOW, nz = nx, n = nx * nz;
  return { seed, edge: GRASS_EDGE, x0: Math.floor(pos.x) - nx/2, z0: Math.floor(pos.z) - nz/2, nx, nz,
    placeable: new Uint8Array(n), density: new Uint8Array(n), height: new Uint8Array(n), species: new Uint8Array(n), midPatch: new Float32Array(n),
    rawDensity: new Uint8Array(n), rawMidPatch: new Float32Array(n), heights: new Float32Array((nx+1)*(nz+1)), stats: { evaluated: 0, reused: 0 } };
}
export function createGrassWindows(cell, { seed = 1333 } = {}) {
  let field = null, pending = null, generation = 0;
  function plan(pos) {
    if (!Number.isFinite(pos.x + pos.z)) throw new RangeError('grass window: finite position required');
    // Finish the chosen window before chasing movement again; otherwise a slow
    // device or fast flight could cancel every batch before any field commits.
    if (pending) return false;
    const target = field;
    if (target && Math.hypot(pos.x - (target.x0 + target.nx/2),pos.z - (target.z0 + target.nz/2)) < GRASS_MOVE) return false;
    pending = { field: emptyField(pos, seed), cursor: 0, generation: ++generation };
    return true;
  }
  // At least one cell per call; the caller supplies elapsed milliseconds (no clock here).
  function work(elapsed, budget = 2) {
    if (!pending) return 0;
    const next = pending.field; let done = 0;
    while (pending.cursor < next.nx * next.nz && (!done || elapsed() < budget)) {
      const k = pending.cursor++, x = next.x0 + k % next.nx, z = next.z0 + Math.floor(k / next.nx), old = field ? index(field,x,z) : -1;
      let v;
      if (old >= 0) {
        v = Object.fromEntries(attributes.map(a => [a,field[a][old]]));
        v.placeable = +(field.rawDensity[old] > 0); v.density = field.rawDensity[old]; v.midPatch = field.rawMidPatch[old];
        const h = (z-field.z0)*(field.nx+1)+x-field.x0;
        v.heights = [field.heights[h],field.heights[h+1],field.heights[h+field.nx+1],field.heights[h+field.nx+2]]; next.stats.reused++;
      } else { v = cell(x,z); next.stats.evaluated++; }
      for (const a of attributes) next[a][k] = v[a];
      next.rawDensity[k] = v.density; next.rawMidPatch[k] = v.midPatch;
      const edge = grassEdge(next,x,z); next.density[k] = Math.round(v.density*edge); next.midPatch[k] = next.rawMidPatch[k]*edge;
      if (!edge) next.placeable[k] = 0;
      const h = Math.floor(k/next.nx)*(next.nx+1)+k%next.nx;
      next.heights[h]=v.heights[0]; next.heights[h+1]=v.heights[1]; next.heights[h+next.nx+1]=v.heights[2]; next.heights[h+next.nx+2]=v.heights[3]; done++;
    }
    return done;
  }
  function commit() {
    if (!pending || pending.cursor !== pending.field.nx * pending.field.nz) return null;
    field = pending.field; pending = null; return field;
  }
  return { plan, work, commit, dispose() { pending = field = null; }, cancel() { pending = null; }, get field() { return field; }, get pending() { return pending; } };
}
