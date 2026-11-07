import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { decodeData, loadKamakura } from '../dist/valley/kamakura-data.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { chunkGeometry, choosePatchLOD } from '../dist/valley/kamakura-chunks.js';
import { axisPoint, kamakuraSpawn } from '../dist/valley/kamakura-spawn.js';
import { readPrivateData, verifySeams } from '../tools/lib/kamakura-validation.mjs';
import { verifyPatches } from '../tools/lib/kamakura-patch-validation.mjs';
function patched() {
  const f = fixture({ width: 9, height: 9, cell: 4 });
  f.meta.schema = 'kz-world-web/0.2';
  f.meta.patches = { cells_file: 'patch_cells_i32.bin', h_file: 'patch_h_f32.bin', axes_file: 'patch_axes.json', subdivisions: 4, total_cells: 1, items: [{ id: 'test' }] };
  const cells = new ArrayBuffer(8), heights = new ArrayBuffer(100), cv = new DataView(cells), hv = new DataView(heights);
  cv.setInt32(0, 3, true); cv.setInt32(4, 3, true);
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) hv.setFloat32((r * 5 + c) * 4, 1000 + (c === 2 ? 2 : 0) + (r === 2 ? 1 : 0), true);
  const axes = { test: { xy_m: [[-4, -4], [0, -4]], s_m: [-2, 2], floor_m: [1000, 1000], floor_width_m: 2 } };
  return { f, extra: { cells, heights, axes }, data: decodeData(f.meta, f.heights.buffer, f.walk.buffer, { cells, heights, axes }) };
}
test('v0.2 LE patch contract rejects missing, duplicate, out-of-grid, nonfinite and malformed axes', () => {
  const { f, extra } = patched(), decode = ex => decodeData(f.meta, f.heights.buffer, f.walk.buffer, ex);
  assert.throws(() => decode()); assert.throws(() => decode({ ...extra, heights: new ArrayBuffer(4) }));
  const bad = extra.cells.slice(0); new DataView(bad).setInt32(0, -1, true); assert.throws(() => decode({ ...extra, cells: bad }));
  const h = extra.heights.slice(0); new DataView(h).setFloat32(0, NaN, true); assert.throws(() => decode({ ...extra, heights: h }));
  assert.throws(() => decode({ ...extra, axes: {} }));
  f.meta.patches.total_cells = 2;
  const cells = new Uint8Array(16); cells.set(new Uint8Array(extra.cells)); cells.set(new Uint8Array(extra.cells), 8);
  assert.throws(() => decode({ ...extra, cells: cells.buffer, heights: new ArrayBuffer(200) }));
});
test('patch samples, bilinear subcells, fine gradients, scaled slope, water and unchanged outside', () => {
  const { data } = patched(), t = createKamakuraTerrain(data), scaled = createKamakuraTerrain(data, 2);
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) assert.equal(t.heightAt(-4 + c, -4 + r), data.patches.heights[r * 5 + c]);
  assert.equal(t.heightAt(-2.5, -2.5), 1001.5);
  assert(t.slopeAt(-2.5, -2.5) > 40); assert(!t.walkable(-2.5, -2.5));
  assert.equal(t.slopeAt(-3.5, -3.5), 0); assert(t.walkable(-3.5, -3.5));
  assert.equal(scaled.heightAt(-2.5, -2.5), 2003);
  const n = t.normalAt(-2.5, -2.5); assert(Math.abs(n.y - 1 / Math.sqrt(6)) < 1e-12);
  assert.equal(t.heightAt(6, 6), t.baseHeightAt(6, 6));
  data.walk.fill(2); assert(!t.walkable(-3.5, -3.5)); assert(t.waterAt(-3.5, -3.5) > 0);
});
test('patch replaces one base cell with exactly 32 triangles; coarse mesh has no patch; seams share quarter vertices', () => {
  const t = createKamakuraTerrain(patched().data), g = chunkGeometry(t, 0, 0, 8, 8, 1);
  let fineTriangles = 0, area = 0;
  for (let k = 0; k < g.indices.length; k += 3) {
    const p = g.indices.slice(k, k + 3).map(i => g.positions.slice(i * 3, i * 3 + 3));
    const signed = (p[1][2] - p[0][2]) * (p[2][0] - p[0][0]) - (p[1][0] - p[0][0]) * (p[2][2] - p[0][2]);
    assert(signed > 0); area += signed / 2;
    if (p.every(([x, , z]) => x >= -4 && x <= 0 && z >= -4 && z <= 0)) fineTriangles++;
  }
  assert.equal(area, 32 * 32); assert.equal(fineTriangles, 32);
  const coarse = chunkGeometry(t, 0, 0, 8, 8, 4);
  assert(!coarse.positions.some((v, i) => i % 3 === 0 && v === -3 && coarse.positions[i + 2] === -3));
  assert.equal(verifySeams(t, 0, 0, 4), 32);
  // Patch on the chunk border, mixed LOD stitching and shared normals.
  const f = patched(); new DataView(f.extra.cells).setInt32(4, 4, true);
  assert.equal(verifySeams(createKamakuraTerrain(decodeData(f.f.meta, f.f.heights.buffer, f.f.walk.buffer, f.extra)), 0, 0, 4), 32);
  const edgeTerrain = createKamakuraTerrain(decodeData(f.f.meta, f.f.heights.buffer, f.f.walk.buffer, f.extra));
  const edgeMesh = chunkGeometry(edgeTerrain, 0, 0, 4, 4, 1, { east: 1, south: 1 });
  for (let i = 0; i < edgeMesh.positions.length; i += 3) assert.equal(edgeMesh.positions[i + 1], edgeTerrain.heightAt(edgeMesh.positions[i], edgeMesh.positions[i + 2]));
  assert.equal(choosePatchLOD(1100, 8), 1); assert.equal(choosePatchLOD(1250, 1), 1); assert(choosePatchLOD(1400, 1) > 1);
});
test('loader fetches optional patch files only locally; legacy without patches still loads', async () => {
  const { f, extra } = patched(), files = { 'meta.json': f.meta, 'patch_axes.json': extra.axes, 'height_u16.bin': f.heights.buffer, 'walk_u8.bin': f.walk.buffer, 'patch_cells_i32.bin': extra.cells, 'patch_h_f32.bin': extra.heights }, calls = [];
  const data = await loadKamakura(async url => { calls.push(url); assert(url.startsWith('/world-private/')); const value = files[url.split('/').at(-1)]; return { ok: !!value, json: async () => value, arrayBuffer: async () => value }; });
  assert.equal(data.patches.index.size, 1); assert.equal(calls.length, 6);
  delete f.meta.patches; assert.equal(decodeData(f.meta, f.heights.buffer, f.walk.buffer).patches, null);
});
test('departure uses arc length, axis direction, clamps at, and relocates to walkable terrain', () => {
  const t = createKamakuraTerrain(patched().data), axis = t.patches.axes.test;
  assert.equal(axisPoint(axis, 2).x, -2);
  assert.equal(kamakuraSpawn(t, '?spawn=test&at=.5').x, -2);
  assert.equal(kamakuraSpawn(t, '?spawn=test&at=1').x, 0);
  assert.equal(kamakuraSpawn(t, '?spawn=test&at=-1').x, -4);
  assert.equal(kamakuraSpawn(t, '?spawn=test').yaw, -Math.PI / 2);
  assert.equal(kamakuraSpawn(t, '').x, t.meta.spawn.x);
  const blocked = { ...t, walkable: (x, z) => x > -3 && t.walkable(x, z) };
  const p = kamakuraSpawn(blocked, '?spawn=test'); assert(blocked.walkable(p.x, p.z));
});
test('private patch acceptance records every violation without exceptions for particular passes', { skip: !process.env.KZ_WORLD_DIR && 'KZ_WORLD_DIR未設定：私有パッチデータが必要' }, async ctx => {
  const { data } = await readPrivateData(process.env.KZ_WORLD_DIR);
  if (!data.patches) return ctx.skip('meta.patchesなし：v0.1のデータ');
  const t = createKamakuraTerrain(data);
  for (const item of data.meta.patches.items) {
    const k = item.offset * 2;
    verifySeams(t, Math.floor(data.patches.cells[k + 1] / 64) * 64, Math.floor(data.patches.cells[k] / 64) * 64);
  }
  const r = verifyPatches(data);
  // This test is the exact provider gate. Axis/floor/boundary acceptance is a separate CLI gate,
  // which exits nonzero with every position/value when the input data fails the criteria.
  assert.equal(r.exact.violations, 0); assert.equal(r.exact.max, 0);
  assert.equal(Object.keys(r.axes).length, 7);
  for (const id of Object.keys(data.patches.axes)) {
    const p = kamakuraSpawn(createKamakuraTerrain(data), '?spawn=' + id + '&at=.5');
    assert(createKamakuraTerrain(data).walkable(p.x, p.z));
  }
});
