// R14 pure placement. All stochastic streams are keyed by world metre cells, never tile order.
import { GRASS } from './config.js';
import { cellRand, insideFootprint, insidePlot, scatterRocks, ROCK_MODEL } from './scatter.js';
import { fbm } from './terrain-height.js';

export const SHORT = 0;
export const TALL = 1;
export const SUSUKI = 2;
export const FERN = 3;
export const FLOWER = 4;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const qualityOf = quality => {
  const q = GRASS.quality[quality];
  if (!q) throw new RangeError('quality: expected standard or light');
  return q;
};
const index = (f, x, z) => x < f.x0 || z < f.z0 || x >= f.x0 + f.nx || z >= f.z0 + f.nz ? -1 : (z - f.z0) * f.nx + x - f.x0;
const noise = (seed, x, z, scale, offset) => fbm(x * scale, z * scale, seed + offset, 2);

// One texel per metre, centred at (x0 + i + .5, z0 + j + .5).
// Ineligible sources are zero; one zero-padded box pass may spill into their edges.
export function coverMap(field) {
  const { x0, z0, nx, nz, placeable, density } = field;
  const source = new Uint8Array(nx * nz), data = new Uint8Array(nx * nz);
  let maxDensity = 0;
  for (let k = 0; k < source.length; k++) if (placeable[k]) maxDensity = Math.max(maxDensity, density[k]);
  for (let k = 0; k < source.length; k++) {
    if (placeable[k] && density[k] > 0) source[k] = Math.round(255 * clamp(0.6 + 0.4 * density[k] / maxDensity, 0, 1));
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    let sum = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = i + dx, z = j + dz;
      if (x >= 0 && x < nx && z >= 0 && z < nz) sum += source[z * nx + x];
    }
    data[j * nx + i] = Math.round(sum / 9);
  }
  return { data, x0, z0, nx, nz };
}

export function createGrassField(world, terrain, { box = GRASS.box, padding = GRASS.padding } = {}) {
  const x0 = Math.floor(box[0] - padding), z0 = Math.floor(box[2] - padding);
  const nx = Math.ceil(box[1] + padding) - x0, nz = Math.ceil(box[3] + padding) - z0, n = nx * nz;
  const field = { seed: world.seed, x0, z0, nx, nz, placeable: new Uint8Array(n), density: new Uint8Array(n), height: new Uint8Array(n), species: new Uint8Array(n), heights: new Float32Array((nx + 1) * (nz + 1)) };
  const H = field.heights, stride = nx + 1;
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) H[j * stride + i] = terrain.heightAt(x0 + i, z0 + j);
  // Conservative cell envelopes keep jittered roots out of boundaries and even small rocks.
  const rocks = scatterRocks(world, terrain);
  const circles = rocks.x.map((x, i) => ({ x, z: rocks.z[i], r: Math.hypot(ROCK_MODEL.width * rocks.s[i] * rocks.sx[i], ROCK_MODEL.depth * rocks.s[i] * rocks.sz[i]) / 2 }));
  const halfDiagonal = Math.SQRT1_2;
  const T = world.terraces, candidates = [], forests = new Float32Array(n), clears = new Float32Array(n);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = x0 + i + 0.5, z = z0 + j + 0.5;
    const forest = terrain.forestDensity(x, z), ri = terrain.riverInfo(x, z), road = terrain.roadInfo(x, z);
    if (terrain.waterAt(x, z) > 0.05 || ri.d < 12 + halfDiagonal) continue;
    if (forest > 0.80) continue;
    if (road && (road.w > 0.35 || road.dist < 2.8)) continue;
    if (Math.hypot(x - 4, z - 6) < 7 + halfDiagonal) continue;
    if (x > T.x0 - 2 - halfDiagonal && x < T.x1 + 2 + halfDiagonal && z > T.z0 - 2 - halfDiagonal && z < T.z1 + 2 + halfDiagonal) continue;
    if (world.buildings.some(b => insideFootprint(b, x, z, 0.4 + halfDiagonal))) continue;
    if ((world.plots || []).some(p => insidePlot(p, x, z, 0.4 + halfDiagonal))) continue;
    if (world.props.some(p => Math.hypot(x - p.x, z - p.z) < (p.r || 1) + 0.4 + halfDiagonal)) continue;
    if (circles.some(r => Math.hypot(x - r.x, z - r.z) < r.r + halfDiagonal)) continue;
    if (terrain.slopeAt(x, z, 1) > 32) continue;
    // Corner gradients catch steep changes hidden by the centre's averaged slope.
    const a = H[j * stride + i], b = H[j * stride + i + 1], c = H[(j + 1) * stride + i], d = H[(j + 1) * stride + i + 1];
    if (Math.max(Math.hypot(b - a, c - a), Math.hypot(d - c, d - b)) > Math.tan(32 * Math.PI / 180)) continue;
    forests[k] = forest; clears[k] = noise(world.seed, x, z, GRASS.clearingScale, 511);
    candidates.push(k);
  }
  // Quantile on eligible grassland: ten percent is open ground, not missing grass density.
  const sorted = candidates.map(k => clears[k]).sort((a, b) => a - b);
  const clearingThreshold = sorted[Math.floor(sorted.length * (1 - GRASS.clearingFraction))] ?? Infinity;
  let clearCount = 0;
  for (const k of candidates) {
    if (clears[k] >= clearingThreshold) { clearCount++; continue; }
    const x = x0 + k % nx + 0.5, z = z0 + Math.floor(k / nx) + 0.5, forest = forests[k];
    field.placeable[k] = 1;
    const patch = clamp(0.5 + GRASS.patch.largeWeight * noise(world.seed, x, z, GRASS.patch.largeScale, 521) + GRASS.patch.smallWeight * noise(world.seed, x, z, GRASS.patch.smallScale, 523), 0, 1);
    // Preserve a one-leaf-density floor locally; forest cover reduces only the extra patch.
    const density = 1 + (GRASS.maxDensity - 1) * (1 - forest * 0.9) * patch;
    field.density[k] = Math.ceil(density * 255 / 2);
    field.height[k] = Math.round(clamp(0.5 + noise(world.seed, x, z, GRASS.heightScale, 541) * 0.5, 0, 1) * 255);
    const s = noise(world.seed, x, z, GRASS.speciesScale, 557);
    const edge = Math.max(T.x0 - x, x - T.x1, T.z0 - z, z - T.z1);
    let kind = s > GRASS.tallThreshold ? TALL : SHORT;
    if ((forest > GRASS.fernForest || terrain.riverInfo(x, z).d < 25) && s < GRASS.fernThreshold) kind = FERN;
    if (forest < GRASS.susukiForest && s < GRASS.susukiThreshold) kind = SUSUKI;
    if (edge >= 3 && edge <= 6) kind = FLOWER;
    field.species[k] = kind;
  }
  // Centre per placeable cell: card count is independent of near-leaf density.
  // cardLeaves is represented-leaf accounting only, never a card-count divisor.
  field.midPatch = new Float32Array(n);
  let weight = 0, sum = 0, lo = Infinity, hi = -Infinity;
  for (const k of candidates) if (field.placeable[k]) {
    const x = x0 + k % nx + .5, z = z0 + Math.floor(k / nx) + .5;
    const v = noise(world.seed, x, z, 1 / 3, 593) + noise(world.seed, x, z, 1 / 14, 599);
    field.midPatch[k] = v; weight++; sum += v;
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  const mean = weight ? sum / weight : 0, span = Math.max(mean - lo, hi - mean, 1e-6);
  for (const k of candidates) if (field.placeable[k]) field.midPatch[k] = 1 + .8 * (field.midPatch[k] - mean) / span;
  // Centre the two-scale field at one, keeping its .2–1.8 envelope.
  // The independent three-card cap is applied only during stochastic rounding.
  let low = -.8, high = .8;
  for (let pass = 0; pass < 24; pass++) {
    const shift = (low + high) / 2;
    let total = 0;
    for (const k of candidates) if (field.placeable[k]) total += clamp(field.midPatch[k] + shift, .2, 1.8);
    if (total < weight) low = shift; else high = shift;
  }
  for (const k of candidates) if (field.placeable[k]) field.midPatch[k] = clamp(field.midPatch[k] + (low + high) / 2, .2, 1.8);
  field.stats = { eligible: candidates.length, clearCount, clearingThreshold };
  return field;
}

// Cell-centred attributes; corner heights have a different origin and stride.
function bilinear(f, data, x, z, corners = false) {
  const gx = clamp(x - f.x0 - (corners ? 0 : 0.5), 0, f.nx - (corners ? 0 : 1));
  const gz = clamp(z - f.z0 - (corners ? 0 : 0.5), 0, f.nz - (corners ? 0 : 1));
  const i = Math.floor(gx), j = Math.floor(gz), stride = f.nx + (corners ? 1 : 0);
  const i1 = Math.min(i + 1, stride - 1), j1 = Math.min(j + 1, f.nz - (corners ? 0 : 1));
  return lerp(lerp(data[j * stride + i], data[j * stride + i1], gx - i), lerp(data[j1 * stride + i], data[j1 * stride + i1], gx - i), gz - j);
}
export function sampleGrass(field, x, z) {
  const k = index(field, Math.floor(x), Math.floor(z));
  if (k < 0 || !Number.isFinite(x + z)) return { placeable: false, density: 0, height: 0.8, species: SHORT };
  return { placeable: !!field.placeable[k], density: bilinear(field, field.density, x, z) * 2 / 255, height: 0.8 + bilinear(field, field.height, x, z) * 0.55 / 255, species: field.species[k] };
}
function arrays(names, count, byte) {
  return Object.fromEntries(names.map(name => [name, name === byte ? new Uint8Array(count) : new Float32Array(count)]));
}
// The optional integer size makes cell stability explicit, and permits later tile rebatching.
function cells(field, tx, tz, size, fn) {
  if (!Number.isInteger(tx) || !Number.isInteger(tz) || !Number.isInteger(size) || size < 1) throw new RangeError('tile: integer coordinates and size required');
  for (let z = tz * size; z < (tz + 1) * size; z++) for (let x = tx * size; x < (tx + 1) * size; x++) {
    const k = index(field, x, z); if (k >= 0 && field.placeable[k]) fn(x, z, k);
  }
}
export function nearTile(field, tx, tz, { quality = 'standard', size = GRASS.nearSize } = {}) {
  const q = qualityOf(quality), entries = []; let count = 0, clumpCount = 0;
  cells(field, tx, tz, size, (x, z, k) => {
    const n = Math.ceil(Math.round(GRASS.nearDensity * field.density[k] * 2 / 255) * q.density);
    const kind = field.species[k], rate = kind === SUSUKI ? GRASS.susukiRate : kind === FLOWER ? GRASS.flowerRate : 0;
    const rng = cellRand(field.seed + GRASS.clumpSeed, x, z);
    const cn = rng() < rate * q.density ? 1 : 0;
    entries.push({ x, z, k, n, kind, cn }); count += n; clumpCount += cn;
  });
  const out = { key: `near:${tx},${tz}`, count, ...arrays(['x', 'y', 'z', 'h', 'w', 'lean', 'yaw', 'hue', 'species'], count, 'species'), clumps: { count: clumpCount, ...arrays(['x', 'y', 'z', 'h', 'yaw', 'hue', 'kind'], clumpCount, 'kind') } };
  let i = 0, c = 0;
  for (const e of entries) {
    const { x, z, k, n, kind } = e, species = kind === SUSUKI || kind === FLOWER ? SHORT : kind;
    const spec = GRASS.species[species], rng = cellRand(field.seed + GRASS.seed, x, z);
    const longRng = cellRand(field.seed + GRASS.seed + 1, x, z);
    for (let j = 0; j < n; j++, i++) {
      const px = x + 0.001 + rng() * 0.998, pz = z + 0.001 + rng() * 0.998;
      out.x[i] = px; out.z[i] = pz; out.y[i] = bilinear(field, field.heights, px, pz, true) - GRASS.sink;
      out.h[i] = clamp(lerp(...spec.h, rng()) * (0.8 + field.height[k] * 0.55 / 255) * (0.75 + 0.55 * rng()) * (longRng() < .08 ? 1.5 : 1), GRASS.minHeight, GRASS.maxHeight);
      out.w[i] = lerp(...spec.w, rng()); out.lean[i] = lerp(...spec.lean, .5 + .5 * Math.sin((rng() - .5) * Math.PI)); out.yaw[i] = rng() * Math.PI * 2; out.hue[i] = rng(); out.species[i] = species;
    }
    if (e.cn) {
      const rng = cellRand(field.seed + GRASS.clumpSeed + 1, x, z), cl = out.clumps;
      cl.x[c] = x + 0.001 + rng() * 0.998; cl.z[c] = z + 0.001 + rng() * 0.998;
      cl.y[c] = bilinear(field, field.heights, cl.x[c], cl.z[c], true) - GRASS.sink;
      cl.h[c] = clamp(lerp(...GRASS.species[kind].h, rng()) * (0.8 + field.height[k] * 0.55 / 255), GRASS.minHeight, GRASS.maxHeight);
      cl.yaw[c] = rng() * Math.PI * 2; cl.hue[c] = rng(); cl.kind[c++] = kind;
    }
  }
  return out;
}
export function midTile(field, tx, tz, { quality = 'standard', size = GRASS.midSize } = {}) {
  const q = qualityOf(quality), entries = []; let count = 0;
  cells(field, tx, tz, size, (x, z, k) => {
    const rng = cellRand(field.seed + GRASS.midSeed, x, z);
    const average = GRASS.midCardRate * q.density;
    const patch = field.midPatch?.[k] ?? 1;
    const n = Math.min(GRASS.midMaxCards, Math.floor(average * patch + rng()));
    entries.push({ x, z, k, n }); count += n;
  });
  const out = { key: `mid:${tx},${tz}`, count, ...arrays(['x', 'y', 'z', 's', 'sx', 'sy', 'flip', 'yaw', 'hue', 'brightness', 'tilt', 'tiltYaw', 'species'], count, 'species') };
  let i = 0;
  for (const { x, z, k, n } of entries) {
    const rng = cellRand(field.seed + GRASS.midSeed, x, z); rng(); // count draw
    for (let j = 0; j < n; j++, i++) {
      out.x[i] = x + 0.001 + rng() * 0.998; out.z[i] = z + 0.001 + rng() * 0.998;
      out.y[i] = bilinear(field, field.heights, out.x[i], out.z[i], true) - GRASS.sink;
      const u = rng();
      out.s[i] = .5 + 1.4 * u * u;
      out.sx[i] = 1 + GRASS.card.aspect * (2 * rng() - 1);
      out.sy[i] = (1 + GRASS.card.aspect * (2 * rng() - 1)) * (rng() < .12 ? 1.5 : 1);
      out.flip[i] = rng() < .5 ? -1 : 1; out.yaw[i] = rng() * Math.PI * 2;
      out.hue[i] = rng(); out.brightness[i] = .8 + .4 * rng();
      out.tilt[i] = (2 * rng() - 1) * Math.PI / 15; out.tiltYaw[i] = rng() * Math.PI * 2;
      out.species[i] = field.species[k];
    }
  }
  return out;
}
function tileList(x, z, size, inner, outer) {
  const out = [];
  for (let tz = Math.ceil((z - outer) / size) - 1; tz <= Math.floor((z + outer) / size); tz++) for (let tx = Math.ceil((x - outer) / size) - 1; tx <= Math.floor((x + outer) / size); tx++) {
    const x0 = tx * size, z0 = tz * size;
    const dist = Math.hypot(Math.max(x0 - x, 0, x - x0 - size), Math.max(z0 - z, 0, z - z0 - size));
    const far = Math.hypot(Math.max(Math.abs(x0 - x), Math.abs(x0 + size - x)), Math.max(Math.abs(z0 - z), Math.abs(z0 + size - z)));
    if (dist <= outer && far >= inner) out.push({ tx, tz, dist });
  }
  return out.sort((a, b) => a.dist - b.dist || a.tz - b.tz || a.tx - b.tx);
}
export function tilesAround(field, x, z, { quality = 'standard' } = {}) {
  if (!Number.isFinite(x + z)) throw new RangeError('camera: finite coordinates required');
  const q = qualityOf(quality), out = {};
  for (const [name, size, inner, outer] of [['near', GRASS.nearSize, 0, GRASS.nearRadius * q.distance], ['mid', GRASS.midSize, GRASS.nearRadius * q.distance * 0.8, GRASS.midRadius * q.distance]]) {
    out[name] = tileList(x, z, size, inner, outer).filter(t => t.tx * size < field.x0 + field.nx && (t.tx + 1) * size > field.x0 && t.tz * size < field.z0 + field.nz && (t.tz + 1) * size > field.z0).map(t => ({ ...t, key: `${name}:${t.tx},${t.tz}` }));
  }
  return out;
}
export function grassBudget(quality = 'standard') {
  const q = qualityOf(quality), result = {};
  // Each camera position lies within sqrt(2)*size/32 of a sampled point.
  // Expand the outer circle and shrink the inner circle by that amount: a true upper bound.
  for (const [name, size, inner, outer, perCell, triangles] of [
    ['near', GRASS.nearSize, 0, GRASS.nearRadius * q.distance, Math.ceil(Math.round(GRASS.nearDensity * Math.ceil(GRASS.maxDensity * 255 / 2) * 2 / 255) * q.density), 6],
    ['mid', GRASS.midSize, GRASS.nearRadius * q.distance * 0.8, GRASS.midRadius * q.distance, Math.min(GRASS.midMaxCards, Math.ceil(GRASS.midCardRate * q.density * 1.8)), 6],
  ]) {
    let max = 0; const error = Math.SQRT2 * size / 32;
    for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) max = Math.max(max, tileList(i * size / 16, j * size / 16, size, Math.max(0, inner - error), outer + error).length);
    const count = max * size * size * perCell;
    result[name] = { tiles: max, count, triangles: count * triangles };
  }
  return { quality, ...result, leaves: result.near.count, cards: result.mid.count, triangles: result.near.triangles + result.mid.triangles };
}
