// B4/B5: invented deterministic patterns evaluated on the supplied river polylines.
import { riverFlow } from './kamakura-shore-r4.js';
import { riverRibbon } from './kamakura-rivers.js';
export const RIVER_ROCKS = Object.freeze({
  minRiverWidth: 4, minWidth: .5, maxWidth: 2.2, // m: eligible channels and rock diameters.
  bankMin: 20, bankMax: 45, streamMin: 60, streamMax: 120, // m: cluster intervals.
  mouthClear: 40, pierClear: 3, passage: 1.6, // m: exclusions / free corridor on the opposite side.
  steepDrop: .015, // m/m: twice the placement density above this bed slope.
  standardCap: 900, lightCap: 400, range: 500, foamRange: 400, // counts / m: limits.
  adaptFactor: .15, // fraction per quality step: shrink rock/foam distance limits.
  colliderMin: 1.2, embedded: 1 / 3, heightRatio: .7, // m / fractions: collision and silhouette.
  foamLift: .03, foamMinLength: 2, foamMaxLength: 4, foamWidth: 1.2, // m / diameter multiples.
  foamMinSpeed: .5, foamMaxSpeed: 1.2, // m/s: speed from existing riverFlow, within brief limits.
  rapidWidth: .18, // m: shallow riffle streak thickness.
});
export const rocksEnabled = search => { const q = new URLSearchParams(search); return q.get('rocks') !== '0' && q.get('layers') !== '0'; };
// Integer seed arithmetic, independent of random state and transcendental table hashes.
export function riverlifeHash(i, salt = 0) { let h = Math.imul(i + 1, 374761393) ^ Math.imul(salt + 1, 668265263); h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967296; }
export function riverSamples(r, vscale = 1) {
  let along = 0;
  const points = r.xy_m.map((p, i) => {
    if (i) along += Math.hypot(p[0] - r.xy_m[i - 1][0], p[1] - r.xy_m[i - 1][1]);
    return { x: p[0], z: -p[1], along, width: r.width_m[i], water: r.water_elev_m[i] * vscale, bed: r.bed_m[i] * vscale };
  });
  if (!r.enters_sea) return points;
  const clipped = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[i + 1];
    if (a.water > 0) clipped.push(a);
    if (b && (a.water > 0) !== (b.water > 0)) {
      const t = a.water / (a.water - b.water), p = {};
      for (const key of ['x', 'z', 'along', 'width', 'water', 'bed']) p[key] = a[key] + (b[key] - a[key]) * t;
      p.water = 0; clipped.push(p);
    }
  }
  const start = clipped[0]?.along ?? 0;
  for (const p of clipped) p.along -= start;
  return clipped;
}
function sample(points, at) {
  let i = 1; while (i < points.length - 1 && points[i].along < at) i++;
  const a = points[i - 1], b = points[i], length = b.along - a.along;
  if (length <= 0) return null;
  const t = Math.max(0, Math.min(1, (at - a.along) / length)), lerp = key => a[key] + (b[key] - a[key]) * t;
  return { x: lerp('x'), z: lerp('z'), water: lerp('water'), bed: lerp('bed'), width: lerp('width'), tx: (b.x - a.x) / length, tz: (b.z - a.z) / length };
}
export function riverRocks(data, terrain, sites = [], quality = 'standard') {
  const rocks = [], foam = [], groups = [], cap = quality === 'light' ? RIVER_ROCKS.lightCap : RIVER_ROCKS.standardCap;
  let serial = 0;
  for (const [ri, r] of (data.rivers?.rivers || []).entries()) {
    const points = riverSamples(r, terrain.vscale ?? 1), length = points.at(-1)?.along ?? 0;
    if (!length) continue;
    const forward = points[0].water >= points.at(-1).water ? 1 : -1;
    const flow = riverFlow(riverRibbon(r, terrain.vscale ?? 1), terrain);
    const speed = Math.max(RIVER_ROCKS.foamMinSpeed, Math.min(RIVER_ROCKS.foamMaxSpeed, flow.speed));
    const mouth = r.enters_sea ? (forward > 0 ? length : 0) : Infinity;
    for (let lane = 0; lane < 3; lane++) {
      let at = (lane === 1 ? RIVER_ROCKS.bankMin / 2 : 0) + riverlifeHash(ri, lane) * RIVER_ROCKS.bankMin;
      while (at < length) {
        const p = sample(points, at); if (!p) break;
        const up = sample(points, Math.max(0, at - 50)), down = sample(points, Math.min(length, at + 50));
        const slope = (up.bed - down.bed) * forward / Math.max(1, Math.min(length, at + 50) - Math.max(0, at - 50));
        const steep = slope >= RIVER_ROCKS.steepDrop, stream = lane === 2, seed = serial++;
        const spacing = stream ? RIVER_ROCKS.streamMin + riverlifeHash(seed, 3) * (RIVER_ROCKS.streamMax - RIVER_ROCKS.streamMin) : RIVER_ROCKS.bankMin + riverlifeHash(seed, 4) * (RIVER_ROCKS.bankMax - RIVER_ROCKS.bankMin);
        if (p.width >= RIVER_ROCKS.minRiverWidth && Math.abs(mouth - at) > RIVER_ROCKS.mouthClear) {
          const sign = lane === 0 ? -1 : lane === 1 ? 1 : (riverlifeHash(seed, 5) < .5 ? -1 : 1);
          const n = stream ? 2 + Math.floor(riverlifeHash(seed, 6) * 4) : 1 + Math.floor(riverlifeHash(seed, 7) * 3);
          const rockStart = rocks.length, foamStart = foam.length;
          const group = { river: r.id, stream, steep, along: at, sign, count: 0, width: p.width }; groups.push(group);
          for (let j = 0; j < n; j++) {
            const rockAlong = at + (j - (n - 1) / 2) * RIVER_ROCKS.maxWidth;
            const q = sample(points, rockAlong); if (rockAlong < 0 || rockAlong > length || !q || Math.abs(mouth - (at + (j - (n - 1) / 2) * RIVER_ROCKS.maxWidth)) <= RIVER_ROCKS.mouthClear) continue;
            const max = stream ? Math.min(RIVER_ROCKS.maxWidth, q.width / 3, (q.width - RIVER_ROCKS.passage) / 2) : RIVER_ROCKS.maxWidth;
            if (max < RIVER_ROCKS.minWidth) continue;
            const width = RIVER_ROCKS.minWidth + riverlifeHash(seed * 5 + j, 8) * (max - RIVER_ROCKS.minWidth);
            // All stream rocks in this group occupy ONE side: the opposite half stays clear.
            const offset = sign * (stream ? q.width / 2 - width / 2 : q.width / 2 + width * .35);
            const x = q.x - q.tz * offset, z = q.z + q.tx * offset;
            if (sites.some(s => s.piers.some(pier => Math.hypot(x - pier.x, z - pier.z) < RIVER_ROCKS.pierClear + width / 2))) continue;
            // Keep approaches open as well as the explicitly required pier exclusion.
            if (sites.some(s => x > s.minX - width && x < s.maxX + width && z > s.minZ - width && z < s.maxZ + width)) continue;
            const height = width * RIVER_ROCKS.heightRatio, surface = q.water;
            const rock = { x, z, y: surface - height * RIVER_ROCKS.embedded, width, height, variant: (seed + j) % 4,
              river: r.id, group: groups.length - 1, stream, along: at + (j - (n - 1) / 2) * RIVER_ROCKS.maxWidth, offset, channelWidth: q.width,
              tx: q.tx * forward, tz: q.tz * forward, water: q.water };
            rocks.push(rock); group.count++;
            if (stream) {
              const wakeLength = width * (RIVER_ROCKS.foamMinLength + riverlifeHash(seed + j, 9) * (RIVER_ROCKS.foamMaxLength - RIVER_ROCKS.foamMinLength));
              const wakeAlong = rockAlong + forward * (width + wakeLength) / 2;
              const wake = sample(points, wakeAlong), arc = sample(points, rockAlong - forward * width / 2);
              if (wakeAlong < 0 || wakeAlong > length || Math.abs(mouth - wakeAlong) < RIVER_ROCKS.mouthClear + wakeLength / 2) { rocks.pop(); group.count--; continue; }
              foam.push({ x: x + rock.tx * (width + wakeLength) / 2, z: z + rock.tz * (width + wakeLength) / 2, y: wake.water + RIVER_ROCKS.foamLift,
                slope: (sample(points, Math.min(length, wakeAlong + forward)).water - wake.water), group: groups.length - 1, width: width * RIVER_ROCKS.foamWidth, length: wakeLength, tx: rock.tx, tz: rock.tz, speed, kind: 0 });
              foam.push({ x: x - rock.tx * width / 2, z: z - rock.tz * width / 2, y: arc.water + RIVER_ROCKS.foamLift,
                slope: (sample(points, Math.min(length, rockAlong + forward)).water - q.water), group: groups.length - 1, width: width * RIVER_ROCKS.foamWidth, length: width, tx: rock.tx, tz: rock.tz, speed, kind: 1 });
            }
          }
          if (stream && group.count < 2) { rocks.length = rockStart; foam.length = foamStart; group.count = 0; }
          if (steep && stream && group.count) for (let j = 0, n = 2 + seed % 3; j < n; j++) {
            const q = sample(points, at + (j + 1) * RIVER_ROCKS.maxWidth);
            if (Math.abs(mouth - (at + (j + 1) * RIVER_ROCKS.maxWidth)) <= RIVER_ROCKS.mouthClear) continue;
            foam.push({ x: q.x, z: q.z, y: q.water + RIVER_ROCKS.foamLift, slope: (sample(points, Math.min(length, at + (j + 1) * RIVER_ROCKS.maxWidth + forward)).water - q.water), group: groups.length - 1, width: q.width * .8, length: RIVER_ROCKS.rapidWidth, tx: q.tx * forward, tz: q.tz * forward, speed, kind: 2 });
          }
        }
        at += spacing / (steep ? 2 : 1);
      }
    }
  }
  // Thin WHOLE clusters across the river network, so a long first bank cannot consume
  // the entire budget before the stream wakes or the opposite bank get a turn.
  let selected = rocks, selectedFoam = foam, selectedGroups = groups;
  if (rocks.length > cap) {
    const ranked = groups.map((g, i) => ({ g, i, rank: riverlifeHash(i, 53) })).sort((a, b) => a.rank - b.rank || a.i - b.i);
    const keep = new Set(); let used = 0;
    for (const { g, i } of ranked) if (g.count && used + g.count <= cap) { keep.add(i); used += g.count; }
    selected = rocks.filter(r => keep.has(r.group)); selectedFoam = foam.filter(f => keep.has(f.group));
    const remap = new Map(); selectedGroups = groups.filter((g, i) => { if (!keep.has(i)) return false; remap.set(i, remap.size); return true; });
    for (const r of selected) r.group = remap.get(r.group);
    for (const f of selectedFoam) f.group = remap.get(f.group);
  }
  for (const r of selected) r.y = Math.max(r.water, terrain.heightAt(r.x, r.z)) - r.height * RIVER_ROCKS.embedded;
  return { rocks: selected, foam: selectedFoam, groups: selectedGroups, cap };
}
export function rockCircles(rocks) { return rocks.filter(r => r.width >= RIVER_ROCKS.colliderMin).map(r => ({ x: r.x, z: r.z, r: r.width / 2, height: r.height })); }
