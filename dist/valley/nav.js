const point = p => !!p && Number.isFinite(p.x) && Number.isFinite(p.z);

export function buildNavGrid({minX, minZ, maxX, maxZ, cell = 2, walkable}) {
  if (![minX, minZ, maxX, maxZ, cell].every(Number.isFinite) ||
      cell <= 0 || maxX <= minX || maxZ <= minZ || typeof walkable !== 'function') {
    throw new TypeError('Invalid navigation grid');
  }
  const width = Math.ceil((maxX - minX) / cell);
  const height = Math.ceil((maxZ - minZ) / cell);
  if (!Number.isSafeInteger(width * height) || width < 1 || height < 1) throw new RangeError('Navigation grid is too large');
  const grid = {minX, minZ, maxX, maxZ, cell, width, height, cells: []};
  for (let i = 0; i < width * height; i++) {
    const p = center(grid, i);
    grid.cells.push(!!walkable(p.x, p.z));
  }
  return grid;
}

function center(g, i) {
  const x = i % g.width, z = Math.floor(i / g.width);
  return {
    x: g.minX + x * g.cell + Math.min(g.cell, g.maxX - g.minX - x * g.cell) / 2,
    z: g.minZ + z * g.cell + Math.min(g.cell, g.maxZ - g.minZ - z * g.cell) / 2,
  };
}

function index(g, p) {
  if (!point(p) || p.x < g.minX || p.z < g.minZ || p.x >= g.maxX || p.z >= g.maxZ) return -1;
  return Math.floor((p.z - g.minZ) / g.cell) * g.width + Math.floor((p.x - g.minX) / g.cell);
}

export function nearestWalkable(grid, p, maxRadius = Number.MAX_VALUE) {
  if (!point(p) || !(maxRadius >= 0)) return null;
  let best = null, distance = maxRadius;
  for (let i = 0; i < grid.cells.length; i++) {
    if (!grid.cells[i]) continue;
    const c = center(grid, i), d = Math.hypot(c.x - p.x, c.z - p.z);
    if (d <= distance && (!best || d < distance)) { best = c; distance = d; }
  }
  return best;
}

export function losClear(walkableFn, a, b, step = 0.5) {
  if (!point(a) || !point(b) || !Number.isFinite(step) || step <= 0) return false;
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
  if (!Number.isSafeInteger(n)) return false;
  for (let i = 0; i <= n; i++) {
    if (!walkableFn(a.x + (b.x - a.x) * i / n, a.z + (b.z - a.z) * i / n)) return false;
  }
  return true;
}

// 見通しの検査量を制限し、蛇行した長い経路でも二乗時間にしない。
export function smoothPath(path, walkableFn, step = 0.5, segmentClear = () => true) {
  if (path === null) return null;
  if (!Array.isArray(path) || !path.every(point)) return null;
  if (path.length < 3) return path.map(p => ({x: p.x, z: p.z}));
  let budget = Math.max(64, path.length * 16);
  const clear = (a, b) => {
    const cost = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step) + 2;
    if (cost > budget) return false;
    budget -= cost;
    return losClear(walkableFn, a, b, step) && segmentClear(a, b);
  };
  const result = [path[0]];
  let anchor = 0;
  while (anchor < path.length - 1) {
    let next = path.length - 1;
    // 遠くから半分ずつ試す。省略できなくても元の安全な辺を残す。
    while (next > anchor + 1 && !clear(path[anchor], path[next])) {
      next = anchor + Math.floor((next - anchor) / 2);
    }
    result.push(path[next]);
    anchor = next;
  }
  return result.map(p => ({x: p.x, z: p.z}));
}

class Heap {
  constructor() { this.items = []; }
  push(item) {
    const a = this.items; let i = a.length; a.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= item.f) break;
      a[i] = a[p]; i = p;
    }
    a[i] = item;
  }
  pop() {
    const a = this.items, first = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let c = i * 2 + 1;
        if (c + 1 < a.length && a[c + 1].f < a[c].f) c++;
        if (a[c].f >= last.f) break;
        a[i] = a[c]; i = c;
      }
      a[i] = last;
    }
    return first;
  }
}

// セル境界の同時通過では両隣も検査し、平滑化で角抜けを復活させない。
function gridLineClear(g, a, b) {
  let i = index(g, a), end = index(g, b);
  if (i < 0 || end < 0) return false;
  let x = i % g.width, z = Math.floor(i / g.width);
  const dx = b.x - a.x, dz = b.z - a.z, sx = Math.sign(dx), sz = Math.sign(dz);
  const valid = (cx, cz) => cx >= 0 && cz >= 0 && cx < g.width && cz < g.height && g.cells[cz * g.width + cx];
  const txStep = dx ? g.cell / Math.abs(dx) : Infinity;
  const tzStep = dz ? g.cell / Math.abs(dz) : Infinity;
  let tx = dx ? (g.minX + (x + (sx > 0 ? 1 : 0)) * g.cell - a.x) / dx : Infinity;
  let tz = dz ? (g.minZ + (z + (sz > 0 ? 1 : 0)) * g.cell - a.z) / dz : Infinity;
  for (let n = 0; n <= g.width + g.height + 2; n++) {
    if (!valid(x, z)) return false;
    if (z * g.width + x === end) return true;
    if (Math.abs(tx - tz) < 1e-10) {
      if (!valid(x + sx, z) || !valid(x, z + sz)) return false;
      x += sx; z += sz; tx += txStep; tz += tzStep;
    } else if (tx < tz) { x += sx; tx += txStep; }
    else { z += sz; tz += tzStep; }
  }
  return false;
}

export function findPath(grid, from, to) {
  if (!point(from) || !point(to)) return null;
  const goal = index(grid, to);
  if (goal < 0 || !grid.cells[goal]) return null;
  let start = index(grid, from), first = {x: from.x, z: from.z};
  if (start < 0 || !grid.cells[start]) {
    first = nearestWalkable(grid, from);
    if (!first) return null;
    start = index(grid, first);
  }
  if (first.x === to.x && first.z === to.z) return [first];
  const n = grid.cells.length, costs = new Float64Array(n).fill(Infinity);
  const parents = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
  const heap = new Heap(), target = center(grid, goal);
  const h = i => { const p = center(grid, i); return Math.hypot(p.x - target.x, p.z - target.z); };
  costs[start] = 0; heap.push({i: start, f: h(start)});
  while (heap.items.length) {
    const {i} = heap.pop();
    if (closed[i]) continue;
    if (i === goal) {
      const path = [];
      for (let p = goal; p !== -1; p = parents[p]) path.push(center(grid, p));
      path.reverse();
      // 中心を通してから実座標へつなぎ、セル内の端点で壁を横切らない。
      path.unshift(first); path.push({x: to.x, z: to.z});
      const unique = path.filter((p, j) => j === 0 || p.x !== path[j - 1].x || p.z !== path[j - 1].z);
      const walkable = (x, z) => { const k = index(grid, {x, z}); return k >= 0 && grid.cells[k]; };
      return smoothPath(unique, walkable, Math.min(0.5, grid.cell / 2), (a, b) => gridLineClear(grid, a, b));
    }
    closed[i] = 1;
    const x = i % grid.width, z = Math.floor(i / grid.width), p = center(grid, i);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dz) || x + dx < 0 || z + dz < 0 || x + dx >= grid.width || z + dz >= grid.height) continue;
      const k = (z + dz) * grid.width + x + dx;
      if (!grid.cells[k] || closed[k]) continue;
      if (dx && dz && (!grid.cells[z * grid.width + x + dx] || !grid.cells[(z + dz) * grid.width + x])) continue;
      const q = center(grid, k), cost = costs[i] + Math.hypot(q.x - p.x, q.z - p.z);
      if (cost >= costs[k]) continue;
      costs[k] = cost; parents[k] = i; heap.push({i: k, f: cost + h(k)});
    }
  }
  return null;
}
