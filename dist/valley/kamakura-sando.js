// Pure, derived approaches: source coordinates are east/north, game coordinates east/south.
import { createKamakuraTerrain } from './kamakura-terrain.js';
import { houseBox } from './kamakura-houses.js';
export const SANDO = Object.freeze({ step: 4.5, minimum: 12, slope: 14, stones: 9000, range: 260, gap: .03 });
export const sandoEnabled = search => new URLSearchParams(search).get('sando') !== '0';
export function sandoRecords(data) {
  return (data.facilities?.nodes || []).map(node => ({ node, bounds: {
    x: node.anchor_xz[0] + (node.bbox_min[0] + node.bbox_max[0]) / 2,
    z: node.anchor_xz[1] + (node.bbox_min[2] + node.bbox_max[2]) / 2,
    w: node.bbox_max[0] - node.bbox_min[0], d: node.bbox_max[2] - node.bbox_min[2], rotY: 0,
  } }));
}
export function sandoHouses(data) {
  return data.houses?.instances?.map(p => houseBox(data.houses.kinds.get(p.kind), p.matrix)) || [];
}
export function sandoBoxDistance(x, z, b) {
  const c = Math.cos(b.rotY || 0), s = Math.sin(b.rotY || 0), dx = x - b.x, dz = z - b.z;
  return Math.hypot(Math.max(0, Math.abs(dx * c - dz * s) - b.w / 2), Math.max(0, Math.abs(dx * s + dz * c) - b.d / 2));
}
const gates = new Set(['torii', 'gate', 'romon']);
function band(x, z, b, thickness) {
  return Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2 &&
    Math.min(b.w / 2 - Math.abs(x - b.x), b.d / 2 - Math.abs(z - b.z)) <= thickness;
}
export function sandoLines(data, terrain) {
  if (!data.facilities?.nodes?.length) return Object.create(null);
  terrain ||= createKamakuraTerrain(data);
  const records = sandoRecords(data), houses = sandoHouses(data), groups = new Map(), out = Object.create(null);
  for (const r of records) { const id = r.node.facility; if (!groups.has(id)) groups.set(id, []); groups.get(id).push(r); }
  const dry = (x, z) => Number.isFinite(terrain.heightAt(x, z)) && terrain.walkable(x, z) && terrain.waterAt(x, z) === 0 && terrain.slopeAt(x, z) <= SANDO.slope;
  for (const [facility, members] of groups) {
    const halls = members.filter(r => r.node.part === 'hall').sort((a, b) => b.bounds.w * b.bounds.d - a.bounds.w * a.bounds.d || a.node.node.localeCompare(b.node.node));
    if (!halls.length) continue;
    const hall = halls[0].bounds, entrances = members.filter(r => gates.has(r.node.part));
    const distance = r => Math.hypot(r.bounds.x - hall.x, r.bounds.z - hall.z);
    entrances.sort((a, b) => distance(b) - distance(a) || a.node.node.localeCompare(b.node.node));
    // An outer torii starts the shrine approach; inner gates are visited in radial order.
    const outer = entrances.findIndex(r => r.node.part === 'torii');
    const ordered = outer >= 0 ? entrances.slice(outer) : entrances;
    let dx = 0, dz = 1;
    if (ordered.length) { dx = ordered.at(-1).bounds.x - hall.x; dz = ordered.at(-1).bounds.z - hall.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d; }
    else {
      dx = hall.w >= hall.d ? 0 : 1; dz = hall.w >= hall.d ? 1 : 0;
      let plus = 0, minus = 0;
      for (let n = 1; n <= 6; n++) for (const sign of [-1, 1]) {
        const d = Math.min(hall.w, hall.d) / 2 + 2.5 + n * 5, x = hall.x + sign * dx * d, z = hall.z + sign * dz * d;
        if (dry(x, z) && !houses.some(b => sandoBoxDistance(x, z, b) === 0)) { if (sign > 0) plus++; else minus++; }
      }
      if (minus > plus) { dx = -dx; dz = -dz; }
    }
    if (dx === 0 && dz === 0) continue;
    const edge = Math.min(Math.abs(dx) > 1e-9 ? hall.w / 2 / Math.abs(dx) : Infinity, Math.abs(dz) > 1e-9 ? hall.d / 2 / Math.abs(dz) : Infinity) + 2.5;
    const end = [hall.x + dx * edge, hall.z + dz * edge];
    const anchors = ordered.map(r => [r.bounds.x, r.bounds.z]);
    if (!anchors.length) anchors.push([end[0] + dx * 30, end[1] + dz * 30]);
    anchors.push(end);
    const width = outer >= 0 ? 5 : entrances.length ? 3.6 : 3;
    let fragment = [], length = 0, number = 0, stopped = false;
    const flush = () => {
      if (length >= SANDO.minimum) out[`${facility}:${number++}`] = { xyz_m: fragment, width_m: width, kind: 'sando', name: facility, facility };
      fragment = []; length = 0;
    };
    for (let i = 1; i < anchors.length && !stopped; i++) {
      const a = anchors[i - 1], b = anchors[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-9) continue;
      const nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len, steps = Math.max(1, Math.round(len / SANDO.step));
      for (let j = i === 1 ? 0 : 1; j <= steps && !stopped; j++) {
        const x = a[0] + (b[0] - a[0]) * j / steps, z = a[1] + (b[1] - a[1]) * j / steps;
        // Submetre corridor probes prevent a narrow stream/house slipping between route points.
        const previous = fragment.at(-1), px = previous?.[0] ?? x, pz = previous ? -previous[1] : z;
        const checks = Math.max(1, Math.ceil(Math.hypot(x - px, z - pz) / .5));
        let valid = true;
        for (let k = 0; k <= checks && valid; k++) {
          const qx = px + (x - px) * k / checks, qz = pz + (z - pz) * k / checks;
          for (const side of [-1, 0, 1]) {
            const sx = qx + nx * width / 2 * side, sz = qz + nz * width / 2 * side;
            if (!dry(sx, sz) || houses.some(h => sandoBoxDistance(sx, sz, h) === 0) || records.some(r => ['hall', 'stairs'].includes(r.node.part) && sandoBoxDistance(sx, sz, r.bounds) === 0)) valid = false;
          }
          if (members.some(r => (r.node.part === 'fence' || r.node.part === 'kairo') && band(qx, qz, r.bounds, r.node.part === 'fence' ? 1.2 : 7)) &&
              !entrances.some(g => sandoBoxDistance(qx, qz, g.bounds) <= 2)) { valid = false; stopped = true; }
        }
        if (!valid) { flush(); continue; }
        if (fragment.length) length += Math.hypot(x - fragment.at(-1)[0], z + fragment.at(-1)[1]);
        fragment.push([x, -z, 0]);
      }
    }
    flush();
  }
  return out;
}
// Sample by arc length. Called during placement/debug only, never during a steady frame.
export function sandoSample(line, distance) {
  const points = line.xyz_m;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b[0] - a[0], dz = a[1] - b[1], len = Math.hypot(dx, dz);
    if (distance <= len || i === points.length - 1) { const t = Math.max(0, Math.min(1, distance / len)); return { x: a[0] + dx * t, z: -a[1] + dz * t, dx: dx / len, dz: dz / len }; }
    distance -= len;
  }
}
export const sandoLength = line => line.xyz_m.reduce((n, p, i, a) => n + (i ? Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) : 0), 0);
const stoneHash = (row, col, salt) => { const n = Math.sin(row * 12.9898 + col * 78.233 + salt * 37.719) * 43758.5453; return n - Math.floor(n); };
// Brick bonds have fixed cells; rotated, worn slabs stay inside their cell's inset envelope.
export function* sandoStones(lines, terrain) {
  let count = 0;
  for (const [id, line] of Object.entries(lines || {})) {
    const columns = line.width_m >= 5 ? 4 : 3, length = sandoLength(line);
    const widths = Array.from({ length: columns }, (_, col) => .92 + .16 * stoneHash(0, col, 3));
    const sum = widths.reduce((a, b) => a + b, 0);
    let offset = -line.width_m * .3;
    for (let col = 0; col < columns; col++) {
      const pitch = widths[col] / sum * line.width_m * .6, lateral = offset + pitch / 2;
      offset += pitch;
      const edge = col === 0 || col === columns - 1;
      let cursor = .03 + (col % 2) * .46;
      for (let row = 0; cursor + 1.05 < length; row++) {
        const age = stoneHash(row, col, 5), jitter = (stoneHash(row, col, 7) - .5) * Math.PI / 30;
        const d = .9 * (.92 + .16 * stoneHash(row, col, 4));
        const w = (pitch - .03 - d * Math.abs(Math.sin(jitter))) / Math.cos(jitter);
        const depth = d * Math.cos(jitter) + w * Math.abs(Math.sin(jitter));
        const distance = cursor + depth / 2;
        cursor += depth + .02 + .02 * stoneHash(row, col, 8);
        if (edge && row % 10 === col % 10) continue;
        const at = sandoSample(line, distance), x = at.x - at.dz * lateral, z = at.z + at.dx * lateral;
        const yaw = Math.atan2(at.dx, at.dz) + jitter, c = Math.cos(yaw), s = Math.sin(yaw);
        const gx = (terrain.heightAt(x + .25, z) - terrain.heightAt(x - .25, z)) * 2, gz = (terrain.heightAt(x, z + .25) - terrain.heightAt(x, z - .25)) * 2;
        yield { kind: 'paver', x, z, y: terrain.heightAt(x, z), yaw, scale: 1, w, d, age, edge, row, col, group: id,
          tiltX: -Math.atan(gx * s + gz * c), tiltZ: Math.atan(gx * c - gz * s), variant: 0 };
        if (++count >= SANDO.stones) return;
      }
    }
  }
}
