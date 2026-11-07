import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createShoreField, SHORE_LIMIT_M } from '../dist/valley/kamakura-shore.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { readPrivateData } from '../tools/lib/kamakura-validation.mjs';
import { createSurfaceCodeAt } from '../dist/valley/kamakura-surface.js';
const make = isSea => ({ bounds: { minX: 0, maxX: 160, minZ: 0, maxZ: 160 }, isSea });
for (const [name, sea] of [
  ['straight coast', (x, z) => x <= 32],
  ['inlet', (x, z) => x <= 16 || (x <= 112 && Math.abs(z - 80) <= 16)],
  ['island', (x, z) => Math.hypot(x - 80, z - 80) >= 48],
  ['edge sea', (x, z) => x === 160 && z === 160]
]) test(`shore ${name} agrees with brute-force sea centres`, () => {
  const t = make(sea), f = createShoreField(t), seeds = [];
  for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) if (sea(i * f.cell, j * f.cell)) seeds.push([i * f.cell, j * f.cell]);
  for (let z = 0; z <= 160; z += 4) for (let x = 0; x <= 160; x += 4) {
    const exact = sea(x, z) ? 0 : Math.min(...seeds.map(([sx, sz]) => Math.hypot(x - sx, z - sz)));
    assert(Math.abs(f.seaDistanceAt(x, z) - exact) <= f.cell + exact * .06);
  }
});
test('shore bilinear interpolation, sea zero, monotonic inland, outside edge and cap', () => {
  const t = make(x => x <= 32), f = createShoreField(t);
  assert(f.data instanceof Float32Array); assert.equal(f.cell, 16);
  let last = 0;
  for (let x = 0; x <= 160; x++) { const d = f.seaDistanceAt(x, 80); assert(d >= last); last = d; if (x <= 32) assert.equal(d, 0); }
  assert.equal(f.seaDistanceAt(56, 80), 24);
  for (const [x, z, cx, cz] of [[-10, 85, 0, 85], [175, 70, 160, 70], [80, -100, 80, 0], [70, 200, 70, 160]]) assert.equal(f.seaDistanceAt(x, z), f.seaDistanceAt(cx, cz));
  const partial = createShoreField({ bounds: { minX: 0, maxX: 165, minZ: 0, maxZ: 19 }, isSea: x => x < 16 });
  assert.equal(partial.seaDistanceAt(200, 10), partial.seaDistanceAt(165, 10));
  assert.equal(partial.seaDistanceAt(80, 100), partial.seaDistanceAt(80, 19));
  const empty = createShoreField(make(() => false));
  assert(empty.data.every(d => d === SHORE_LIMIT_M)); assert.equal(empty.seaDistanceAt(8, 8), Infinity);
  const long = createShoreField({ bounds: { minX: 0, maxX: 4000, minZ: 0, maxZ: 16 }, isSea: x => x === 0 });
  assert.equal(long.seaDistanceAt(2992, 0), 2992); assert.equal(long.seaDistanceAt(4000, 0), Infinity);
  assert(long.data.every(Number.isFinite));
  assert.throws(() => createShoreField(t, { cell: 0 }), RangeError);
});
test('terrain exposes sea and shore field without turning a river into sea', () => {
  const f = fixture({ width: 9, height: 9, cell: 16 });
  f.walk[0] = 2; f.heights[8] = 0;
  f.rivers = { rivers: [{ xy_m: [[-10, 0], [10, 0]], width_m: [4, 4] }] };
  const t = createKamakuraTerrain(f);
  assert.equal(t.isSea(0, 0), false); assert.equal(t.waterAt(0, 0), .4);
  for (const x of [-64, 64]) { assert(t.isSea(x, -64)); assert(t.waterAt(x, -64) >= .46); assert.equal(t.seaDistanceAt(x, -64), 0); }
  assert.equal(t.seaDistanceAt, t.shoreField.seaDistanceAt); assert(t.shoreField.data.includes(0));
});
test('private v0.9 shore timing and aggregate checks (no coordinates)', { skip: !process.env.KZ_WORLD_DIR && 'KZ_WORLD_DIR未設定：私有地形はリポジトリ外' }, async tcase => {
  const { data } = await readPrivateData(process.env.KZ_WORLD_DIR);
  const terrain = createKamakuraTerrain(data), start = performance.now(), f = createShoreField(terrain), ms = performance.now() - start;
  assert(f.data.includes(0)); assert(terrain.seaDistanceAt(data.meta.spawn.x, -data.meta.spawn.y) > 600);
  const surface = new Uint8Array(await fs.readFile(path.join(process.env.KZ_WORLD_DIR, 'surface_class_u8.bin')));
  const codeAt = createSurfaceCodeAt(data.meta, surface);
  let sand = 0, nearSand = 0, sea = 0;
  for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) {
    const k = j * f.w + i;
    if (f.data[k] === 0) sea++;
    if (codeAt(f.x0 + i * f.cell, f.z0 + j * f.cell) === 0) { sand++; if (f.data[k] < 64) nearSand++; }
  }
  assert(sand > 0 && nearSand > 0);
  tcase.diagnostic(JSON.stringify({ cell_m: f.cell, creation_ms: +ms.toFixed(2), sea_present: sea > 0, sea_percent: +(sea / f.data.length * 100).toFixed(1), sand_near_sea_percent: +(nearSand / sand * 100).toFixed(1), spawn_farther_than_600m: true }));
});
