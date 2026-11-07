// Private measurements are returned/printed at runtime only. Never persist results in this repository.
import { createKamakuraTerrain } from '../../dist/valley/kamakura-terrain.js';
import { axisPoint } from '../../dist/valley/kamakura-spawn.js';
const distribution = values => {
  const s = [...values].sort((a, b) => a - b);
  return { count: s.length, mean: s.reduce((a, b) => a + b, 0) / s.length, p50: s[Math.floor(s.length * .5)], p95: s[Math.min(s.length - 1, Math.floor(s.length * .95))], max: s.at(-1) };
};
export function verifyPatches(data) {
  if (!data.patches) return { skip: 'meta.patchesなし：v0.1には細密パッチがありません' };
  const t = createKamakuraTerrain(data), { cells, heights, axes } = data.patches;
  const result = { axes: {}, exact: { count: 0, violations: 0, max: 0 }, boundary: {}, vertices: {} };
  for (const [id, axis] of Object.entries(axes)) {
    const floor = axis.xy_m.map(([x, y], k) => Math.abs(t.heightAt(x, -y) - axis.floor_m[k]));
    const directions = {};
    for (const reverse of [false, true]) {
      const samples = [], length = axis.s_m.at(-1) - axis.s_m[0];
      for (let d = 0; d < length; d++) samples.push(axisPoint(axis, reverse ? length - d : d));
      samples.push(axisPoint(axis, reverse ? 0 : length));
      const violations = [], rises = [];
      let blocked = 0, strict = 0, loose = 0;
      const blockedBySide = { left: 0, center: 0, right: 0 }, blockedByReason = {};
      for (let k = 0; k < samples.length; k++) {
        const p = samples[k];
        for (const side of [-1, 0, 1]) {
          const offset = side * axis.floor_width_m / 3, x = p.x - p.dz * offset, z = p.z + p.dx * offset;
          if (!t.walkable(x, z)) { blocked++; blockedBySide[side === -1 ? 'left' : side === 0 ? 'center' : 'right']++; const reason = t.movementBlockedAt(x, z); blockedByReason[reason] = (blockedByReason[reason] || 0) + 1; violations.push({ kind: 'walkable', distance: p.distance, side, x, z, slope: t.slopeAt(x, z), reason: t.movementBlockedAt(x, z) }); }
        }
        if (k) {
          const prev = samples[k - 1], rise = Math.abs(t.heightAt(p.x, p.z) - t.heightAt(prev.x, prev.z)); rises.push(rise);
          if (rise > 0.6) strict++;
          if (rise > 1) loose++;
          if (rise > .6) violations.push({ kind: 'height-step', distance: p.distance, x: p.x, z: p.z, rise });
        }
      }
      directions[reverse ? 'reverse' : 'forward'] = { points: samples.length, blocked, blockedBySide, blockedByReason, strictOver06: strict, looseOver10: loose, rises: distribution(rises), violations };
    }
    result.axes[id] = { directions, floor: { ...distribution(floor), within035: floor.filter(v => v <= .35).length / floor.length } };
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
  result.accepted = result.exact.violations === 0 && Object.values(result.axes).every(a => a.floor.within035 >= .95 && Object.values(a.directions).every(d => !d.blocked && !d.strictOver06)) && result.boundary.over05.length === 0;
  return result;
}
