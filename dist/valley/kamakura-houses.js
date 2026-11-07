// Pure private-house decoding, placement and horizontal footprints. No bundled geography.
export const HOUSE_CHUNK = 256;
export const houseNodeName = name => name.replace(/\.\d+$/, '');
export function decodeHouses(catalog, buffer) {
  const fail = () => { throw new Error('家の配置データが不正です'); };
  if (!catalog || !Number.isInteger(catalog.count) || catalog.count < 0 || catalog.count > 100000 ||
      !Array.isArray(catalog.kinds) || !catalog.kinds.length || !catalog.count_by_kind ||
      buffer.byteLength !== catalog.count * 17 * 4) fail();
  const kinds = new Map(), counts = new Map();
  for (const k of catalog.kinds) {
    if (!Number.isInteger(k.index) || k.index < 0 || kinds.has(k.index) || counts.has(k.node) || typeof k.node !== 'string' ||
        ![k.bbox_min, k.bbox_max].every(a => a?.length === 3 && a.every(Number.isFinite)) ||
        !k.bbox_min.every((v, i) => v < k.bbox_max[i]) || !(k.triangles > 0)) fail();
    kinds.set(k.index, k); counts.set(k.node, 0);
  }
  const view = new DataView(buffer), instances = [];
  for (let i = 0; i < catalog.count; i++) {
    const index = view.getFloat32(i * 68, true), kind = kinds.get(index), matrix = [];
    if (!kind || !catalog.count_by_kind[kind.node] || /^(5_|6_|k14_)/.test(kind.node)) fail();
    for (let j = 0; j < 16; j++) matrix.push(view.getFloat32(i * 68 + 4 + j * 4, true));
    // The contract is yaw + positive scale, no shear, tilt, reflection or perspective.
    const sx = Math.hypot(matrix[0], matrix[2]), sz = Math.hypot(matrix[8], matrix[10]);
    if (!matrix.every(Number.isFinite) || !(sx > 0 && sz > 0 && matrix[5] > 0) ||
        [1, 3, 4, 6, 7, 9, 11].some(j => Math.abs(matrix[j]) > 1e-5) || matrix[15] !== 1 ||
        Math.abs(matrix[0] * matrix[8] + matrix[2] * matrix[10]) > sx * sz * 1e-5 ||
        matrix[0] * matrix[10] - matrix[2] * matrix[8] <= 0) fail();
    instances.push({ id: i, kind: index, matrix }); counts.set(kind.node, counts.get(kind.node) + 1);
  }
  for (const [name, count] of counts) if (count !== (catalog.count_by_kind[name] ?? 0)) fail();
  if (Object.keys(catalog.count_by_kind).some(name => !counts.has(name))) fail();
  return { catalog, kinds, instances };
}
// Blender bbox (east,north,up) -> glTF bbox (east,up,south).
export function houseBounds(kind) {
  return { min: [kind.bbox_min[0], kind.bbox_min[2], -kind.bbox_max[1]],
    max: [kind.bbox_max[0], kind.bbox_max[2], -kind.bbox_min[1]] };
}
// The lowest ring belongs to the foundation/body, never the projecting roof.
export function houseBodyBounds(positions) {
  let bottom = Infinity;
  for (let i = 1; i < positions.length; i += 3) bottom = Math.min(bottom, positions[i]);
  const min = [Infinity, bottom, Infinity], max = [-Infinity, bottom, -Infinity];
  for (let i = 0; i < positions.length; i += 3) if (positions[i + 1] <= bottom + 1e-4) {
    for (const k of [0, 2]) { min[k] = Math.min(min[k], positions[i + k]); max[k] = Math.max(max[k], positions[i + k]); }
  }
  if (![...min, ...max].every(Number.isFinite) || min[0] >= max[0] || min[2] >= max[2]) throw new Error('家の基壇を読み取れません');
  return { min, max };
}
// Slope fit. The skirt below the datum hides a drop on the downhill side, so the house may stand above the lowest
// ground, but the skirt bottom must never end above it (a gap shows daylight). A hillside may cover the wall base a
// little; beyond HOUSE_BURY_TOLERANCE the house is raised instead, while the no-gap rule still wins.
// Samples are a grid, so the true lowest point can lie between them: the margin grows with the largest step between
// neighbouring samples (half of it, plus a fixed floor).
export const HOUSE_SKIRT_MARGIN = .1;
export const HOUSE_BURY_TOLERANCE = .5;
export const HOUSE_SAMPLE_SPACING = .5;
export function houseFootprintHeights(m, body, terrain, spacing = HOUSE_SAMPLE_SPACING) {
  const sx = Math.hypot(m[0], m[2]), sz = Math.hypot(m[8], m[10]);
  const nx = Math.max(2, Math.ceil((body.max[0] - body.min[0]) * sx / spacing) + 1);
  const nz = Math.max(2, Math.ceil((body.max[2] - body.min[2]) * sz / spacing) + 1);
  let low = Infinity, high = -Infinity, sum = 0, step = 0, previous = new Array(nz);
  for (let i = 0; i < nx; i++) {
    const u = body.min[0] + (body.max[0] - body.min[0]) * i / (nx - 1);
    let before = NaN;
    for (let j = 0; j < nz; j++) {
      const v = body.min[2] + (body.max[2] - body.min[2]) * j / (nz - 1);
      const h = terrain.heightAt(m[12] + m[0] * u + m[8] * v, m[14] + m[2] * u + m[10] * v);
      low = Math.min(low, h); high = Math.max(high, h); sum += h;
      if (j > 0) step = Math.max(step, Math.abs(h - before));
      if (i > 0) step = Math.max(step, Math.abs(h - previous[j]));
      before = h; previous[j] = h;
    }
  }
  return { low, high, mean: sum / (nx * nz), step };
}
export function houseFit(m, body, terrain) {
  const ground = houseFootprintHeights(m, body, terrain), bottom = body.min[1] * m[5];
  const margin = HOUSE_SKIRT_MARGIN + ground.step / 2;
  const upper = ground.low - margin - bottom, lower = ground.high - HOUSE_BURY_TOLERANCE;
  const feasible = lower <= upper;
  return { ...ground, bottom, margin, feasible, y: feasible ? Math.min(upper, Math.max(lower, ground.mean)) : upper };
}
// Without a body footprint the origin is the ground datum (legacy single-point form).
export function houseMatrix(instance, terrain, body = null) {
  const m = instance.matrix.slice();
  m[13] = body ? houseFit(m, body, terrain).y : terrain.heightAt(m[12], m[14]);
  return m;
}
export function houseBox(kind, m, body = houseBounds(kind)) {
  const u = (body.min[0] + body.max[0]) / 2, v = (body.min[2] + body.max[2]) / 2;
  return { x: m[12] + m[0] * u + m[8] * v, z: m[14] + m[2] * u + m[10] * v,
    w: (body.max[0] - body.min[0]) * Math.hypot(m[0], m[2]),
    d: (body.max[2] - body.min[2]) * Math.hypot(m[8], m[10]),
    height: kind.bbox_max[2] * m[5], rotY: Math.atan2(-m[2], m[0]) };
}
export function houseChunks(houses) {
  const map = new Map();
  for (const item of houses.instances) {
    const ix = Math.floor(item.matrix[12] / HOUSE_CHUNK), iz = Math.floor(item.matrix[14] / HOUSE_CHUNK), key = `${ix},${iz}`;
    if (!map.has(key)) map.set(key, { key, x: (ix + .5) * HOUSE_CHUNK, z: (iz + .5) * HOUSE_CHUNK, items: [] });
    map.get(key).items.push(item);
  }
  return [...map.values()];
}
export function houseChunkDistance(ch, pos) {
  return Math.hypot(Math.max(0, Math.abs(ch.x - pos.x) - HOUSE_CHUNK / 2), Math.max(0, Math.abs(ch.z - pos.z) - HOUSE_CHUNK / 2));
}
export function houseLOD(distance, previous = null) {
  const near = previous === 0 ? 385 : previous === null ? 350 : 315;
  const far = previous === 1 ? 1080 : previous === null ? 1000 : 920;
  return distance < near ? 0 : distance < far ? 1 : 2;
}
// Exact segment/rotated rectangle intersection, also handles a zero-length spawn point.
export function houseIntersects(box, a, b = a, radius = 0) {
  const c = Math.cos(box.rotY), s = Math.sin(box.rotY);
  const local = p => [(p.x - box.x) * c - (p.z - box.z) * s, (p.x - box.x) * s + (p.z - box.z) * c];
  const p = local(a), q = local(b), half = [box.w / 2 + radius, box.d / 2 + radius];
  let lo = 0, hi = 1;
  for (let k = 0; k < 2; k++) {
    const d = q[k] - p[k];
    if (Math.abs(d) < 1e-12) { if (Math.abs(p[k]) > half[k]) return false; }
    else { const u = (-half[k] - p[k]) / d, v = (half[k] - p[k]) / d;
      lo = Math.max(lo, Math.min(u, v)); hi = Math.min(hi, Math.max(u, v)); if (lo > hi) return false; }
  }
  return true;
}
