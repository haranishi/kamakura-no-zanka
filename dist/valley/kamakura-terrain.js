import { createSurfaceAt, createRiverIndex } from './kamakura-surface.js';
// Pure provider. Public coordinates use the game's x=east, y=up, z=south.
export const KAMAKURA_MAX_WALK_SLOPE_DEG = 46;
export const KAMAKURA_SLOPE_WINDOW_M = 3.9;
export function maxWalkSlope(search) {
  const raw = new URLSearchParams(search).get('maxslope'), n = Number(raw);
  return raw?.trim() && Number.isFinite(n) && n > 0 && n < 90 ? n : KAMAKURA_MAX_WALK_SLOPE_DEG;
}
export const groundEnabled = search => new URLSearchParams(search).get('ground') !== '0';
// Decode before interpolation: vertex attributes are in the linear working space.
const groundLinear = Float64Array.from({ length: 256 }, (_, n) => {
  const c = n / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mix = (a, b, t) => a + (b - a) * t;
export function insidePolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[i], [bx, by] = polygon[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}
export function createKamakuraTerrain({ meta, heights, walk, patches = null, ground = null, surface = null, rivers = null }, vscale = 1, maxSlope = KAMAKURA_MAX_WALK_SLOPE_DEG) {
  if (!Number.isFinite(vscale) || vscale <= 0) throw new RangeError('Invalid vertical scale');
  if (!Number.isFinite(maxSlope) || maxSlope <= 0 || maxSlope >= 90) throw new RangeError('Invalid slope limit');
  const { width: w, height: h, cell_m: cell } = meta.grid;
  // Pixel centres: do not use the rounded frame_m extent.
  const x0 = -(w - 1) * cell / 2, z0 = -(h - 1) * cell / 2;
  const bounds = { minX: x0, maxX: -x0, minZ: z0, maxZ: -z0 };
  const at = (i, j) => (meta.height.min_m + heights[clamp(j, 0, h - 1) * w + clamp(i, 0, w - 1)] / 65535 * (meta.height.max_m - meta.height.min_m)) * vscale;
  const gridAt = (x, z) => ({ i: clamp((x - x0) / cell, 0, w - 1), j: clamp((z - z0) / cell, 0, h - 1) });
  function groundColorAt(x, z) {
    if (!meta.ground || !ground) return null;
    const { i, j } = gridAt(x, z), a = Math.floor(i), b = Math.floor(j), u = i - a, v = j - b;
    const get = (c, r, k) => groundLinear[ground[(Math.min(r, h - 1) * w + Math.min(c, w - 1)) * 3 + k]];
    return [0, 1, 2].map(k => mix(mix(get(a, b, k), get(a + 1, b, k), u),
      mix(get(a, b + 1, k), get(a + 1, b + 1, k), u), v));
  }
  function baseHeightAt(x, z) {
    const { i, j } = gridAt(x, z), a = Math.floor(i), b = Math.floor(j), u = i - a, v = j - b;
    return mix(mix(at(a, b), at(a + 1, b), u), mix(at(a, b + 1), at(a + 1, b + 1), u), v);
  }
  const patchIndex = (i, j) => patches?.index.get(j * w + i);
  function patchSample(x, z) {
    const { i, j } = gridAt(x, z);
    // Snap rounding noise at exact shared grid points, including negative coordinates.
    const snap = v => Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v) : v;
    const si = snap(i), sj = snap(j), a = Math.min(w - 2, Math.floor(si)), b = Math.min(h - 2, Math.floor(sj));
    let k = patchIndex(a, b), pa = a, pb = b;
    // A shared edge belongs to either incident patch, including its east/south end.
    if (k === undefined) for (const [di, dj] of [[-1, 0], [0, -1], [-1, -1]]) {
      if ((di && si !== a) || (dj && sj !== b) || a + di < 0 || b + dj < 0) continue;
      k = patchIndex(a + di, b + dj);
      if (k !== undefined) { pa = a + di; pb = b + dj; break; }
    }
    if (k === undefined) return null;
    const u = clamp(snap((si - pa) * 4), 0, 4), v = clamp(snap((sj - pb) * 4), 0, 4);
    const c = Math.min(3, Math.floor(u)), r = Math.min(3, Math.floor(v));
    const get = (dc, dr) => patches.heights[k * 25 + (r + dr) * 5 + c + dc] * vscale;
    return { u: u - c, v: v - r, a: get(0, 0), b: get(1, 0), c: get(0, 1), d: get(1, 1) };
  }
  function heightAt(x, z) {
    const p = patchSample(x, z);
    return p ? mix(mix(p.a, p.b, p.u), mix(p.c, p.d, p.u), p.v) : baseHeightAt(x, z);
  }
  function gradient(x, z) {
    const p = patchSample(x, z);
    if (p) return [mix(p.b - p.a, p.d - p.c, p.v) / (cell / 4), mix(p.c - p.a, p.d - p.b, p.u) / (cell / 4)];
    const { i, j } = gridAt(x, z), a = Math.min(w - 2, Math.floor(i)), b = Math.min(h - 2, Math.floor(j));
    return [mix(at(a + 1, b) - at(a, b), at(a + 1, b + 1) - at(a, b + 1), j - b) / cell,
      mix(at(a, b + 1) - at(a, b), at(a + 1, b + 1) - at(a + 1, b), i - a) / cell];
  }
  // Walking uses a fixed physical window; shading retains the fine gradient.
  const slopeAt = (x, z) => {
    const e = KAMAKURA_SLOPE_WINDOW_M / 2;
    return Math.atan(Math.hypot((heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e),
      (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e))) * 180 / Math.PI;
  };
  function normalAt(x, z) {
    if (patchSample(x, z)) {
      const [dx, dz] = gradient(x, z), l = Math.hypot(dx, 1, dz);
      return { x: -dx / l, y: 1 / l, z: -dz / l };
    }
    // Shared, symmetric sample normals; independent of a chunk's LOD.
    const e = cell / 2, dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e), l = Math.hypot(dx, 1, dz);
    return { x: -dx / l, y: 1 / l, z: -dz / l };
  }
  const insideA = (x, z) => x >= x0 && x <= -x0 && z >= z0 && z <= -z0 && insidePolygon(x, -z, meta.walk.polygon_m);
  const insidePatch = (x, z) => x >= x0 && x <= -x0 && z >= z0 && z <= -z0 && patchSample(x, z) !== null;
  const maskAt = (x, z) => { const { i, j } = gridAt(x, z); return walk[Math.round(j) * w + Math.round(i)]; };
  const isWater = (x, z) => maskAt(x, z) === 2 || heightAt(x, z) <= 0;
  const { riverDistanceAt } = createRiverIndex(rivers);
  const surfaceAt = createSurfaceAt(meta, surface);
  // The sea is deep water (blocks, >= 0.46). A river is wadeable: K7's rivers are 0.5 m deep at the surface, schematic. The value
  // stays under collision.js's 0.45 m cut-off, so the hero walks in a river, while it is still > 0.05 for the water footstep.
  const RIVER_WADE_DEPTH = 0.4;
  const waterAt = (x, z) => isWater(x, z) ? Math.max(0.46, -heightAt(x, z)) : (riverDistanceAt(x, z) === 0 ? RIVER_WADE_DEPTH : 0);
  function blockedAt(x, z) {
    if ((!insideA(x, z) || maskAt(x, z) === 0) && !insidePatch(x, z)) return 'bounds';
    if (isWater(x, z)) return 'water';
    if (slopeAt(x, z) >= maxSlope) return 'slope';
    return null;
  }
  function movementBlockedAt(x, z, r = 0) {
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) { const why = blockedAt(x + dx, z + dz); if (why) return why; }
    return null;
  }
  return { meta, groundColorAt, patches, patchIndex, baseHeightAt, vscale, w, h, cell, x0, z0, at, heightAt, slopeAt, maxSlope, insidePatch, normalAt, waterAt, insideA, maskAt,
    waterLevelAt: () => 0, roadInfo: () => null, surfaceAt, riverDistanceAt,
    walkable: (x, z) => !blockedAt(x, z), movementBlockedAt, bounds };
}
