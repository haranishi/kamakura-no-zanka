const CELL = 8;
const EPS = 1e-8;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function finite(...values) {
  if (!values.every(Number.isFinite)) throw new RangeError('Expected finite coordinates');
}
function size(v) { finite(v); if (v < 0) throw new RangeError('Expected nonnegative size'); return v; }
function inBounds(b, x, z, r = 0) {
  return x - r >= b.minX && x + r <= b.maxX && z - r >= b.minZ && z + r <= b.maxZ;
}

export function buildColliders({ buildings = [], props = [], trees, bounds, extraCircles = [], extraBoxes = [] }) {
  finite(bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ);
  if (bounds.minX > bounds.maxX || bounds.minZ > bounds.maxZ) throw new RangeError('Invalid bounds');
  const circles = [], boxes = [], grid = new Map();
  const circle = (p, height) => {
    finite(p.x, p.z); size(p.r);
    circles.push({ ...p, height: size(p.height ?? height), type: 'circle' });
  };
  const box = b => {
    finite(b.x, b.z, b.rotY ?? 0);
    const hx = size(b.footprint?.w ?? b.w) / 2, hz = size(b.footprint?.d ?? b.d) / 2;
    boxes.push({ ...b, hx, hz, c: Math.cos(b.rotY ?? 0), s: Math.sin(b.rotY ?? 0), height: size(b.height ?? 6), type: 'box' });
  };
  for (const p of props) circle(p, 1.2);
  if (trees) for (let i = 0; i < trees.x.length; i++) {
    const x = trees.x[i], z = trees.z[i]; finite(x, z);
    if (inBounds(bounds, x, z)) circle({ x, z, r: (trees.kind[i] === 1 ? 0.42 : 0.32) * size(trees.s[i]), kind: trees.kind[i] }, 7);
  }
  for (const p of extraCircles) circle(p, 7);
  for (const b of buildings) box(b);
  for (const b of extraBoxes) box(b);
  for (const o of [...circles, ...boxes]) {
    const ex = o.type === 'circle' ? o.r : Math.abs(o.c) * o.hx + Math.abs(o.s) * o.hz;
    const ez = o.type === 'circle' ? o.r : Math.abs(o.s) * o.hx + Math.abs(o.c) * o.hz;
    for (let ix = Math.floor((o.x - ex) / CELL); ix <= Math.floor((o.x + ex) / CELL); ix++) {
      for (let iz = Math.floor((o.z - ez) / CELL); iz <= Math.floor((o.z + ez) / CELL); iz++) {
        const key = `${ix},${iz}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(o);
      }
    }
  }
  return { circles, boxes, grid, bounds: { ...bounds } };
}
function nearby(col, x0, z0, x1 = x0, z1 = z0, r = 0) {
  const found = new Set();
  for (let ix = Math.floor((Math.min(x0, x1) - r) / CELL); ix <= Math.floor((Math.max(x0, x1) + r) / CELL); ix++) {
    for (let iz = Math.floor((Math.min(z0, z1) - r) / CELL); iz <= Math.floor((Math.max(z0, z1) + r) / CELL); iz++) {
      const list = col.grid.get(`${ix},${iz}`);
      if (list) for (const o of list) found.add(o);
    }
  }
  return found;
}
function penetration(o, x, z, radius) {
  if (o.type === 'circle') {
    const dx = x - o.x, dz = z - o.z, r = o.r + radius, d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return null;
    const d = Math.sqrt(d2);
    return d > EPS ? { x: dx / d * (r - d + EPS), z: dz / d * (r - d + EPS) } : { x: r + EPS, z: 0 };
  }
  const dx = x - o.x, dz = z - o.z;
  const u = dx * o.c - dz * o.s, v = dx * o.s + dz * o.c;
  const du = u - clamp(u, -o.hx, o.hx), dv = v - clamp(v, -o.hz, o.hz);
  const d = Math.hypot(du, dv);
  let pu, pv;
  if (d > EPS) {
    if (d >= radius) return null;
    pu = du / d * (radius - d + EPS); pv = dv / d * (radius - d + EPS);
  } else {
    const ux = o.hx - Math.abs(u), vz = o.hz - Math.abs(v);
    if (ux < vz) { pu = (u < 0 ? -1 : 1) * (ux + radius + EPS); pv = 0; }
    else { pu = 0; pv = (v < 0 ? -1 : 1) * (vz + radius + EPS); }
  }
  return { x: pu * o.c + pv * o.s, z: -pu * o.s + pv * o.c };
}
function reason(col, terrain, x, z, r, y, opts) {
  if (!inBounds(col.bounds, x, z, r) || !inBounds(terrain.bounds, x, z, r)) return 'bounds';
  const water = terrain.waterAt(x, z), slope = terrain.slopeAt(x, z), h = terrain.heightAt(x, z);
  finite(water, slope, h);
  if (water > 0.45) return 'water';
  if (slope > (opts.maxSlope ?? 42)) return 'slope';
  if (y !== null && h - y > (opts.maxStep ?? 0.55) + EPS) return 'step';
  return null;
}
function resolve(col, x, z, r) {
  let hit = false;
  for (let i = 0; i < 8; i++) {
    let changed = false;
    for (const o of nearby(col, x, z, x, z, r)) {
      const p = penetration(o, x, z, r);
      if (p) { x += p.x; z += p.z; changed = hit = true; }
    }
    if (!changed) break;
  }
  const overlap = [...nearby(col, x, z, x, z, r)].some(o => penetration(o, x, z, r));
  return { x, z, hit, overlap };
}
export function moveActor(col, terrain, pos, dx, dz, radius = 0.3, opts = {}) {
  finite(pos.x, pos.y, pos.z, dx, dz); size(radius);
  if (opts.maxSlope !== undefined) size(opts.maxSlope);
  if (opts.maxStep !== undefined) size(opts.maxStep);
  let x = pos.x, z = pos.z, y = terrain.heightAt(x, z), blocked = null, slid = false;
  finite(y);
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / Math.min(0.2, Math.max(radius, 0.01))));
  const sx = dx / n, sz = dz / n;
  for (let i = 0; i < n; i++) {
    const ox = x, oz = z, oy = y;
    let nx = x + sx, nz = z + sz;
    let why = reason(col, terrain, nx, nz, radius, oy, opts);
    if (why) {
      blocked = why; nx = x; nz = z;
      if (sx !== 0) {
        why = reason(col, terrain, x + sx, z, radius, oy, opts);
        if (why) blocked = why; else nx += sx;
      }
      if (sz !== 0) {
        why = reason(col, terrain, nx, z + sz, radius, oy, opts);
        if (why) blocked = why; else nz += sz;
      }
    }
    const p = resolve(col, nx, nz, radius);
    if (p.hit) blocked = 'wall';
    why = reason(col, terrain, p.x, p.z, radius, oy, opts);
    if (why) { blocked = why; } else if (!p.overlap) { x = p.x; z = p.z; }
    if ((p.hit || nx !== ox + sx || nz !== oz + sz) && Math.abs(sx * (z - oz) - sz * (x - ox)) > EPS) slid = true;
    y = terrain.heightAt(x, z); finite(y);
  }
  return { x, y, z, blocked, slid };
}
export function pushOut(col, terrain, pos, radius = 0.3) {
  finite(pos.x, pos.y, pos.z); size(radius);
  const p = resolve(col, pos.x, pos.z, radius);
  const y = terrain.heightAt(p.x, p.z); finite(y);
  return { x: p.x, y, z: p.z };
}

// 交差区間を残す。入口が屋根より高くても、出口までに線が下がる場合がある。
function slab(p, d, lo, hi, interval) {
  if (Math.abs(d) < EPS) return p >= lo && p <= hi;
  let a = (lo - p) / d, b = (hi - p) / d;
  if (a > b) [a, b] = [b, a];
  interval[0] = Math.max(interval[0], a); interval[1] = Math.min(interval[1], b);
  return interval[0] <= interval[1];
}
function footprintInterval(o, a, b, r) {
  const dx = b.x - a.x, dz = b.z - a.z, px = a.x - o.x, pz = a.z - o.z;
  const t = [0, 1];
  if (o.type === 'box') {
    if (!slab(px * o.c - pz * o.s, dx * o.c - dz * o.s, -o.hx - r, o.hx + r, t) ||
        !slab(px * o.s + pz * o.c, dx * o.s + dz * o.c, -o.hz - r, o.hz + r, t)) return null;
  } else {
    const rr = o.r + r, aa = dx * dx + dz * dz, bb = px * dx + pz * dz, cc = px * px + pz * pz - rr * rr;
    if (aa < EPS * EPS) { if (cc > 0) return null; }
    else {
      const disc = bb * bb - aa * cc;
      if (disc < 0) return null;
      t[0] = Math.max(0, (-bb - Math.sqrt(disc)) / aa);
      t[1] = Math.min(1, (-bb + Math.sqrt(disc)) / aa);
      if (t[0] > t[1]) return null;
    }
  }
  return t;
}
function obstacleHit(col, terrain, a, b, radius, ignoreThin = 0) {
  let best = 2;
  for (const o of nearby(col, a.x, a.z, b.x, b.z, radius)) {
    if (ignoreThin > 0 && o.type !== 'box' && o.r < ignoreThin) continue;       // 幟の竿のような細い円は、カメラの線を遮らない
    const t = footprintInterval(o, a, b, radius);
    if (!t) continue;
    const base = terrain.heightAt(o.x, o.z); finite(base);
    // 高さは配置地点の地面を基準とする。propsも木も地下からは見通せない。
    if (!slab(a.y, b.y - a.y, base - radius, base + o.height + radius - EPS, t)) continue;
    best = Math.min(best, t[0]);
  }
  return best;
}
function point(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }; }
function validateLine(a, b) { finite(a.x, a.y, a.z, b.x, b.y, b.z); }
export function segmentBlocked(col, terrain, a, b, opts = {}) {
  validateLine(a, b);
  if (obstacleHit(col, terrain, a, b, 0) <= 1) return true;
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 1.5));
  for (let i = 0; i <= n; i++) {
    const p = point(a, b, i / n), h = terrain.heightAt(p.x, p.z); finite(h);
    if (h >= p.y + 0.25) return true;
  }
  return false;
}
export function rayClip(col, terrain, from, to, radius = 0.25, { ignoreThin = 0 } = {}) {
  validateLine(from, to); size(radius);
  let hit = obstacleHit(col, terrain, from, to, radius, ignoreThin);
  const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) / 0.1));
  const under = t => { const p = point(from, to, t), h = terrain.heightAt(p.x, p.z); finite(h); return p.y < h + radius; };
  for (let i = 0; i <= n && i / n <= hit; i++) if (under(i / n)) {
    let lo = Math.max(0, (i - 1) / n), hi = i / n;
    for (let j = 0; j < 16; j++) { const mid = (lo + hi) / 2; if (under(mid)) hi = mid; else lo = mid; }
    hit = hi; break;
  }
  return hit <= 1 ? Math.max(0, hit - 0.03) : 1;
}
export function nearestFree(col, terrain, x, z, radius = 0.3, maxR = 6) {
  finite(x, z); size(radius); size(maxR);
  const free = (px, pz) => !reason(col, terrain, px, pz, radius, null, {}) && terrain.walkable(px, pz) &&
    ![...nearby(col, px, pz, px, pz, radius)].some(o => penetration(o, px, pz, radius));
  if (free(x, z)) return { x, z };
  const rings = Math.ceil(maxR / 0.2);
  for (let i = 1; i <= rings; i++) {
    const r = Math.min(i * 0.2, maxR), count = Math.max(8, Math.ceil(2 * Math.PI * r / 0.2));
    for (let j = 0; j < count; j++) {
      const px = x + Math.cos(j * 2 * Math.PI / count) * r, pz = z + Math.sin(j * 2 * Math.PI / count) * r;
      if (free(px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}
