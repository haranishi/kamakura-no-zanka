// Pure provider. Public coordinates use the game's x=east, y=up, z=south.
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
export function createKamakuraTerrain({ meta, heights, walk }, vscale = 1) {
  if (!Number.isFinite(vscale) || vscale <= 0) throw new RangeError('Invalid vertical scale');
  const { width: w, height: h, cell_m: cell } = meta.grid;
  // Pixel centres: do not use the rounded frame_m extent.
  const x0 = -(w - 1) * cell / 2, z0 = -(h - 1) * cell / 2;
  const bounds = { minX: x0, maxX: -x0, minZ: z0, maxZ: -z0 };
  const at = (i, j) => (meta.height.min_m + heights[clamp(j, 0, h - 1) * w + clamp(i, 0, w - 1)] / 65535 * (meta.height.max_m - meta.height.min_m)) * vscale;
  const gridAt = (x, z) => ({ i: clamp((x - x0) / cell, 0, w - 1), j: clamp((z - z0) / cell, 0, h - 1) });
  function heightAt(x, z) {
    const { i, j } = gridAt(x, z), a = Math.floor(i), b = Math.floor(j), u = i - a, v = j - b;
    return mix(mix(at(a, b), at(a + 1, b), u), mix(at(a, b + 1), at(a + 1, b + 1), u), v);
  }
  function gradient(x, z) {
    const { i, j } = gridAt(x, z), a = Math.min(w - 2, Math.floor(i)), b = Math.min(h - 2, Math.floor(j));
    return [mix(at(a + 1, b) - at(a, b), at(a + 1, b + 1) - at(a, b + 1), j - b) / cell,
      mix(at(a, b + 1) - at(a, b), at(a + 1, b + 1) - at(a + 1, b), i - a) / cell];
  }
  const slopeAt = (x, z) => Math.atan(Math.hypot(...gradient(x, z))) * 180 / Math.PI;
  function normalAt(x, z) {
    // Shared, symmetric sample normals; independent of a chunk's LOD.
    const e = cell / 2, dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e), l = Math.hypot(dx, 1, dz);
    return { x: -dx / l, y: 1 / l, z: -dz / l };
  }
  const insideA = (x, z) => x >= x0 && x <= -x0 && z >= z0 && z <= -z0 && insidePolygon(x, -z, meta.walk.polygon_m);
  const maskAt = (x, z) => { const { i, j } = gridAt(x, z); return walk[Math.round(j) * w + Math.round(i)]; };
  const isWater = (x, z) => maskAt(x, z) === 2 || heightAt(x, z) <= 0;
  const waterAt = (x, z) => isWater(x, z) ? Math.max(0.46, -heightAt(x, z)) : 0;
  function blockedAt(x, z) {
    if (!insideA(x, z) || maskAt(x, z) === 0) return 'bounds';
    if (isWater(x, z)) return 'water';
    if (slopeAt(x, z) >= 40) return 'slope';
    return null;
  }
  function movementBlockedAt(x, z, r = 0) {
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) { const why = blockedAt(x + dx, z + dz); if (why) return why; }
    return null;
  }
  return { meta, vscale, w, h, cell, x0, z0, at, heightAt, slopeAt, normalAt, waterAt, insideA, maskAt,
    waterLevelAt: () => 0, roadInfo: () => null, surfaceAt: () => ({ grass: 0, dirt: 1, rock: 0, gravel: 0, mud: 0, litter: 0 }),
    walkable: (x, z) => !blockedAt(x, z), movementBlockedAt, bounds };
}
