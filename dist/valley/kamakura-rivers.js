// Pure river decoding and immutable ribbon construction. Coordinates: east/up/south.
export const waterEnabled = search => new URLSearchParams(search).get('water') !== '0';
export const riverPolicy = (quality = 'standard') => ({ chunkLength: 512, maxDistance: quality === 'light' ? 2000 : 3500 });
export function decodeRivers(info, expectedCount = 27) {
  const fail = () => { throw new Error('鎌倉の川データが不正です'); };
  if (info?.schema !== 'kz-rivers/0.1' || !Array.isArray(info.rivers) || info.rivers.length !== expectedCount) fail();
  const ids = new Set(); let points = 0;
  for (const r of info.rivers) {
    const n = r?.xy_m?.length;
    if (typeof r?.id !== 'string' || !r.id || ids.has(r.id) || typeof r.enters_sea !== 'boolean' ||
        !(r.name === null || typeof r.name === 'string') || !Array.isArray(r.xy_m) || n < 2 || n > 100000) fail();
    ids.add(r.id); points += n;
    for (const key of ['width_m', 'depth_m', 'bed_m', 'water_elev_m']) {
      if (!Array.isArray(r[key]) || r[key].length !== n || !r[key].every(Number.isFinite)) fail();
    }
    if (!r.xy_m.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) ||
        !r.width_m.every(v => v > 0) || !r.depth_m.every(v => v > 0) || !r.water_elev_m.every((v, i) => v > r.bed_m[i])) fail();
  }
  if (points > 1e6) fail();
  return { rivers: info.rivers, points };
}
// CPU counterpart of the fragment distance gate, also used by the Node acceptance tests.
export function riverDistanceAlpha(distance, maxDistance) {
  const t = Math.max(0, Math.min(1, (distance - (maxDistance - 128)) / 128));
  return 1 - t * t * (3 - 2 * t);
}
export function riverRibbon(r, vscale = 1) {
  if (!(Number.isFinite(vscale) && vscale > 0)) throw new RangeError('Invalid vertical scale');
  const points = []; let along = 0, seaClipped = false;
  for (let i = 0; i < r.xy_m.length; i++) {
    const p = { x: r.xy_m[i][0], z: -r.xy_m[i][1], y: r.water_elev_m[i] * vscale, half: r.width_m[i] / 2 + 1.2 };
    const prev = points.at(-1), distance = prev ? Math.hypot(p.x - prev.x, p.z - prev.z) : 0;
    if (prev && distance < 1e-6) continue;
    if (r.enters_sea && p.y <= 0) {
      seaClipped = true;
      // A crossing ends exactly on the sea; wholly submerged stretches have no ribbon.
      if (prev?.y > 0) {
        const f = prev.y / (prev.y - p.y);
        points.push({ x: prev.x + (p.x - prev.x) * f, z: prev.z + (p.z - prev.z) * f,
          y: 0, half: prev.half + (p.half - prev.half) * f, along: along + distance * f });
        break;
      }
      continue;
    }
    along += distance; points.push({ ...p, along });
  }
  const positions = [], uvs = [], indices = [];
  const sharp = new Set();
  for (let i = 0; i < points.length; i++) {
    const p = points[i], a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z, length = Math.hypot(tx, tz);
    if (i > 0 && i < points.length - 1) {
      const ax = p.x - a.x, az = p.z - a.z, bx = b.x - p.x, bz = b.z - p.z;
      // Exclude turns over 120 degrees, rather than folding triangles across a hairpin.
      if ((ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz)) < -.5) sharp.add(i);
    }
    if (length < 1e-6) { sharp.add(i); tx = 1; tz = 0; length = 1; }
    const nx = -tz / length, nz = tx / length;
    for (const s of [-1, 1]) { positions.push(p.x + s * nx * p.half, p.y, p.z + s * nz * p.half); uvs.push(s, p.along); }
  }
  // Test the actual Float32 positions that will be sent to the GPU.
  const pos = new Float32Array(positions);
  const upArea = (a, b, c) => (pos[b * 3 + 2] - pos[a * 3 + 2]) * (pos[c * 3] - pos[a * 3]) -
    (pos[b * 3] - pos[a * 3]) * (pos[c * 3 + 2] - pos[a * 3 + 2]);
  let excludedSegments = 0;
  for (let i = 1; i < points.length; i++) {
    const k = (i - 1) * 2;
    if (sharp.has(i - 1) || sharp.has(i) || upArea(k, k + 1, k + 2) <= 1e-6 || upArea(k + 1, k + 3, k + 2) <= 1e-6) { excludedSegments++; continue; }
    indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  return { id: r.id, positions: pos, uvs: new Float32Array(uvs), indices, seaClipped, excludedSegments };
}
export function splitRiverRibbon(ribbon, chunkLength = 512) {
  if (!Number.isFinite(chunkLength) || chunkLength <= 0) throw new RangeError('Invalid river chunk length');
  const chunks = []; let current, bucket;
  for (let i = 0; i < ribbon.indices.length; i += 6) {
    const source = ribbon.indices.slice(i, i + 6), next = Math.floor(ribbon.uvs[source[0] * 2 + 1] / chunkLength);
    if (!current || next !== bucket) {
      bucket = next; current = { positions: [], uvs: [], indices: [], sourceVertices: new Map() }; chunks.push(current);
    }
    for (const index of source) {
      if (!current.sourceVertices.has(index)) {
        current.sourceVertices.set(index, current.positions.length / 3);
        current.positions.push(...ribbon.positions.slice(index * 3, index * 3 + 3));
        current.uvs.push(...ribbon.uvs.slice(index * 2, index * 2 + 2));
      }
      current.indices.push(current.sourceVertices.get(index));
    }
  }
  return chunks.map(c => ({ positions: new Float32Array(c.positions), uvs: new Float32Array(c.uvs), indices: c.indices,
    riverId: ribbon.id, sourceVertices: [...c.sourceVertices.keys()] }));
}
export function prepareRivers(data, vscale = 1, quality = 'standard') {
  const policy = riverPolicy(quality), ribbons = (data?.rivers || []).map(r => riverRibbon(r, vscale));
  return { policy, ribbons, chunks: ribbons.flatMap(r => splitRiverRibbon(r, policy.chunkLength)) };
}
