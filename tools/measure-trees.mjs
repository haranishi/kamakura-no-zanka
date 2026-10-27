import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { moveActor } from '../dist/valley/collision.js';
import { measurementWorld } from './lib/measurement-world.mjs';

// research-measurements.md の仕様の値。4方向・余剰帯は除外。
const GRID = 5, RADIUS = 0.3, TOLERANCE = 0.5;
export function measureTrees(input = measurementWorld()) {
  const { world, terrain, trees, col, move = moveActor } = input;
  const b = world.bounds, W = Math.floor((b.maxX - b.minX) / GRID), H = Math.floor((b.maxZ - b.minZ) / GRID);
  const px = i => b.minX + (i % W + 0.5) * GRID;
  const pz = i => b.minZ + (Math.floor(i / W) + 0.5) * GRID;
  const start = Math.floor((world.start.z - b.minZ) / GRID) * W + Math.floor((world.start.x - b.minX) / GRID);
  const seen = new Set([start]), queue = [start];
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k];
    if (!terrain.walkable(px(i), pz(i))) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = i % W + dx, z = Math.floor(i / W) + dz, j = z * W + x;
      if (x < 0 || x >= W || z < 0 || z >= H || seen.has(j) || !terrain.walkable(px(j), pz(j))) continue;
      const r = move(col, terrain, { x: px(i), y: terrain.heightAt(px(i), pz(i)), z: pz(i) }, dx * GRID, dz * GRID, RADIUS);
      if (Math.hypot(r.x - px(j), r.z - pz(j)) < TOLERANCE) { seen.add(j); queue.push(j); }
    }
  }
  const all = [0, 0, 0], walkable = [0, 0, 0], reachable = [0, 0, 0];
  trees.kind.forEach((kind, i) => {
    all[kind]++;
    if (!terrain.walkable(trees.x[i], trees.z[i])) return;
    walkable[kind]++;
    const x = Math.floor((trees.x[i] - b.minX) / GRID), z = Math.floor((trees.z[i] - b.minZ) / GRID);
    if (x >= 0 && x < W && z >= 0 && z < H && seen.has(z * W + x)) reachable[kind]++;
  });
  const sum = ns => ns.reduce((a, b) => a + b, 0);
  const total = { all: sum(all), walkable: sum(walkable), reachable: sum(reachable) };
  return { all, walkable, reachable, total, ratios: {
    reachableNonCedarPct: total.reachable ? (reachable[1] + reachable[2]) / total.reachable * 100 : 0,
    reachableBroadleafPct: total.reachable ? reachable[1] / total.reachable * 100 : 0,
  } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), result = measureTrees();
  const i = args.indexOf('--baseline');
  if (i >= 0) {
    const before = JSON.parse(fs.readFileSync(args[i + 1], 'utf8'));
    result.delta = Object.fromEntries(['all', 'walkable', 'reachable'].map(k => [k, result[k].map((v, j) => v - before[k][j])]));
    result.delta.total = Object.fromEntries(Object.entries(result.total).map(([k, v]) => [k, v - before.total[k]]));
    result.delta.ratios = Object.fromEntries(Object.entries(result.ratios).map(([k, v]) => [k, v - before.ratios[k]]));
  }
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else { console.log('樹種順: 杉・広葉・松（research-measurements.md の到達格子）'); console.table(Object.fromEntries(['all', 'walkable', 'reachable'].map(k => [k, { 杉: result[k][0], 広葉: result[k][1], 松: result[k][2], 合計: result.total[k] }]))); console.log(result.ratios); if (result.delta) console.log('前測定との差', result.delta); }
}
