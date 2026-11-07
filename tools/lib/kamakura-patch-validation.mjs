// Private measurements are returned/printed at runtime only. Never persist results in this repository.
import { createKamakuraTerrain } from '../../dist/valley/kamakura-terrain.js';
import { axisPoint, patchRoute } from '../../dist/valley/kamakura-spawn.js';
const distribution = values => {
  const s = [...values].sort((a, b) => a - b);
  return { count: s.length, mean: s.reduce((a, b) => a + b, 0) / s.length, p50: s[Math.floor(s.length * .5)], p95: s[Math.min(s.length - 1, Math.floor(s.length * .95))], max: s.at(-1) };
};
export function verifyPatches(data) {
  if (!data.patches) return { skip: 'meta.patchesなし：v0.1には細密パッチがありません' };
  const t = createKamakuraTerrain(data), t40 = createKamakuraTerrain(data, 1, 40), { cells, heights, axes } = data.patches;
  const result = { routes: {}, exact: { count: 0, violations: 0, max: 0 }, boundary: {}, vertices: {}, failures: [] };
  for (const id of Object.keys(axes)) {
    const route = patchRoute(data.patches, id), length = route.s_m.at(-1) - route.s_m[0];
    const floor = route.xy_m.map(([x, y], k) => Math.abs(t.heightAt(x, -y) - route.floor_m[k]));
    const directions = {};
    for (const reverse of [false, true]) {
      const samples = [];
      for (let d = 0; d < length; d++) samples.push(axisPoint(route, reverse ? length - d : d));
      samples.push(axisPoint(route, reverse ? 0 : length));
      const stats = { points: samples.length * 3, blocked: 0, blocked40: 0, blockedLength_m: 0, blockedLength40_m: 0,
        blockedBySide: { left: 0, center: 0, right: 0 }, violations: [] };
      for (let k = 0; k < samples.length; k++) {
        const p = samples[k];
        // A sample owns the half-segments to its neighbours; lengths sum to the full route.
        const weight = ((k ? Math.abs(p.distance - samples[k - 1].distance) : 0) +
          (k + 1 < samples.length ? Math.abs(p.distance - samples[k + 1].distance) : 0)) / 2;
        let blocked = false, blocked40 = false;
        for (const side of [-1, 0, 1]) {
          const x = p.x - p.dz * side * 1.5, z = p.z + p.dx * side * 1.5;
          if (!t40.walkable(x, z)) { stats.blocked40++; blocked40 = true; }
          if (!t.walkable(x, z)) {
            stats.blocked++; blocked = true;
            stats.blockedBySide[side === -1 ? 'left' : side === 0 ? 'center' : 'right']++;
            stats.violations.push({ id, distance: p.distance, side, x, z, slope: t.slopeAt(x, z), reason: t.movementBlockedAt(x, z) });
          }
        }
        if (blocked) stats.blockedLength_m += weight;
        if (blocked40) stats.blockedLength40_m += weight;
      }
      stats.walkableRatio = 1 - stats.blocked / stats.points;
      stats.walkableRatio40 = 1 - stats.blocked40 / stats.points;
      stats.blockedLengthRatio = stats.blockedLength_m / length;
      directions[reverse ? 'reverse' : 'forward'] = stats;
    }
    const reachability = verifyReachability(t, data, id, route);
    result.routes[id] = { source: data.patches.paths ? 'path' : 'axis-fallback', length_m: length, directions, floor: distribution(floor), reachability };
    for (const [direction, d] of Object.entries(directions)) if (d.blockedLengthRatio > .06)
      result.failures.push({ id, check: '①′', direction, value: d.blockedLengthRatio, limit: .06 });
    const f = result.routes[id].floor;
    if (f.p95 > .05 || f.max > .2) result.failures.push({ id, check: '②′', p95: f.p95, max: f.max, limits: [.05, .2] });
    if (!reachability.at46 || !reachability.referenceWithin3)
      result.failures.push({ id, check: '⑤', ...reachability });
  }
  const boundary = [], corners = [];
  for (let k = 0; k < cells.length / 2; k++) {
    const r = cells[k * 2], c = cells[k * 2 + 1];
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
      const x = t.x0 + (c + i / 4) * t.cell, z = t.z0 + (r + j / 4) * t.cell;
      const diff = Math.abs(t.heightAt(x, z) - heights[k * 25 + j * 5 + i]);
      result.exact.count++; result.exact.max = Math.max(result.exact.max, diff); if (diff > 1e-4) result.exact.violations++;
    }
    for (const [side, dc, dr] of [['north', 0, -1], ['south', 0, 1], ['west', -1, 0], ['east', 1, 0]]) {
      if (t.patchIndex(c + dc, r + dr) !== undefined) continue;
      for (let q = 0; q <= 4; q++) {
        const x = t.x0 + (c + (dc ? (dc > 0 ? 1 : 0) : q / 4)) * t.cell;
        const z = t.z0 + (r + (dr ? (dr > 0 ? 1 : 0) : q / 4)) * t.cell;
        const delta = Math.abs(t.heightAt(x - dc * .2, z - dr * .2) - t.heightAt(x + dc * .2, z + dr * .2));
        boundary.push({ x, z, side, delta });
        corners.push({ x, z, side, delta: Math.abs(t.heightAt(x, z) - t.baseHeightAt(x, z)) });
      }
    }
  }
  const summarize = entries => ({ ...distribution(entries.map(e => e.delta)), over05: entries.filter(e => e.delta > .5), top10: entries.sort((a, b) => b.delta - a.delta).slice(0, 10) });
  result.boundary = summarize(boundary); result.vertices = summarize(corners);
  if (result.exact.violations) result.failures.push({ check: '③', ...result.exact });
  if (Object.keys(result.routes).length !== 7) result.failures.push({ check: 'route-count', value: Object.keys(result.routes).length, expected: 7 });
  result.accepted = result.failures.length === 0;
  return result;
}

// Reference aggregates supplied by the parent; no geographical coordinates/elevations.
const references = { asaina: 10, kobukuro: 30, gokurakuji: 39, kewaizaka: 40, nagoe: 43, kamegayatsu: 43, daibutsu: 44 };   // 3.9m 幅・端点はパッチの内側の最寄り（メインの独立計算）
export function verifyReachability(t, data, id, route = patchRoute(data.patches, id)) {
  const items = data.meta.patches.items, item = items.find(a => a.id === id);
  const start = item.offset, next = start + item.count;
  if (!Number.isInteger(start) || !Number.isInteger(item.count) || start < 0 || start >= next || next > data.patches.cells.length / 2) throw new Error('Missing patch item cell range: ' + id);
  // A union of expanded cells, not their bounding rectangle (which could create shortcuts).
  const region = new Set();
  for (let k = start; k < next; k++) {
    const r = data.patches.cells[k * 2], c = data.patches.cells[k * 2 + 1];
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      if (c + dc >= 0 && r + dr >= 0 && c + dc < t.w - 1 && r + dr < t.h - 1) region.add((r + dr) * t.w + c + dc);
    }
  }
  const nodes = new Map(), key = (x, z) => x + ',' + z;
  for (const cell of region) {
    const r = Math.floor(cell / t.w), c = cell % t.w;
    for (let z = Math.ceil(t.z0 + r * t.cell); z <= Math.floor(t.z0 + (r + 1) * t.cell); z++)
      for (let x = Math.ceil(t.x0 + c * t.cell); x <= Math.floor(t.x0 + (c + 1) * t.cell); x++) {
        const k = key(x, z);
        if (!nodes.has(k)) nodes.set(k, { x, z, slope: t.slopeAt(x, z) });
      }
  }
  const nearest = p => {
    let best, distance = Infinity;
    for (const n of nodes.values()) {
      if (!t.insidePatch(n.x, n.z)) continue;   // 回廊（パッチの升目）の内側だけ
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d < distance) { best = n; distance = d; }
    }
    return best;
  };
  const first = axisPoint(route, 0), last = axisPoint(route, route.s_m.at(-1) - route.s_m[0]);
  const source = nearest(first), target = nearest(last);
  const endpoint = (p, n) => ({ x: n?.x, z: n?.z, snapDistance_m: n ? Math.hypot(n.x - p.x, n.z - p.z) : null,
    slope_deg: n?.slope, insidePatch: n ? t.insidePatch(n.x, n.z) : false });
  const reachable = limit => {
    if (!source || !target || source.slope >= limit || target.slope >= limit) return false;
    const queue = [source], seen = new Set([key(source.x, source.z)]);
    for (let i = 0; i < queue.length; i++) {
      const n = queue[i]; if (n === target) return true;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const k = key(n.x + dx, n.z + dz), q = nodes.get(k);
        if (q && q.slope < limit && !seen.has(k)) { seen.add(k); queue.push(q); }
      }
    }
    return false;
  };
  // Monotone search returns the exact minimum integer threshold, using strict '<'.
  let lo = 0, hi = 90;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (reachable(mid)) hi = mid; else lo = mid; }
  const minimumLimit_deg = hi < 90 ? hi : null;
  const referenceKey = Object.keys(references).find(k => id.toLowerCase().startsWith(k));
  const reference_deg = references[referenceKey] ?? null;
  return { at46: reachable(46), minimumLimit_deg, reference_deg,
    endpoints: { start: endpoint(first, source), end: endpoint(last, target) },
    referenceWithin3: reference_deg !== null && minimumLimit_deg !== null && Math.abs(minimumLimit_deg - reference_deg) <= 3, gridPoints: nodes.size };
}
