import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { decodeData, loadKamakura } from '../dist/valley/kamakura-data.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { chunkGeometry, choosePatchLOD } from '../dist/valley/kamakura-chunks.js';
import { axisPoint, kamakuraSpawn, pointDeparture } from '../dist/valley/kamakura-spawn.js';
import { readPrivateData, verifySeams } from '../tools/lib/kamakura-validation.mjs';
import { verifyPatches, verifyReachability } from '../tools/lib/kamakura-patch-validation.mjs';
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
  // Fine sawtooth remains in shading, but walking measures the 3.9m window.
  assert(t.slopeAt(-2.5, -2.5) < 40); assert(t.walkable(-2.5, -2.5));
  assert(t.walkable(-3.5, -3.5));
  for (const [x, z] of [[-2.5, -2.5], [-4.1, -3], [2, 2]]) {
    const dx = (t.heightAt(x + 1.95, z) - t.heightAt(x - 1.95, z)) / 3.9;
    const dz = (t.heightAt(x, z + 1.95) - t.heightAt(x, z - 1.95)) / 3.9;
    assert(Math.abs(t.slopeAt(x, z) - Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI) < 1e-10);
    assert(Math.abs(scaled.slopeAt(x, z) - Math.atan(Math.hypot(dx * 2, dz * 2)) * 180 / Math.PI) < 1e-10);
  }
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
test('test departure ?pos=east,north&yaw= starts at that point, faces the heading and relocates to walkable ground', () => {
  const t = createKamakuraTerrain(patched().data);
  const p = kamakuraSpawn(t, '?pos=-2,3&yaw=90');
  assert.equal(p.x, -2); assert.equal(p.z, -3); assert.equal(p.yaw, -Math.PI / 2);
  // Without yaw the normal spawn heading is kept; the path departure still wins when ?spawn= names a route.
  assert.equal(kamakuraSpawn(t, '?pos=-2,3').yaw, -t.meta.spawn.yaw_deg_clockwise_from_north * Math.PI / 180);
  assert.equal(kamakuraSpawn(t, '?spawn=test&at=.5&pos=5,5').x, -2);
  // Invalid values fall back to the normal spawn instead of throwing.
  for (const bad of ['?pos=', '?pos=1', '?pos=a,b', '?pos=1,2,3', '?pos=,5', '?pos=Infinity,0']) assert.equal(kamakuraSpawn(t, bad).x, t.meta.spawn.x, bad);
  assert.equal(kamakuraSpawn(t, '?pos=1,2&yaw=').yaw, -t.meta.spawn.yaw_deg_clockwise_from_north * Math.PI / 180);
  // A point on a wall of non-walkable ground moves to the nearest walkable point within 40 m, otherwise nothing.
  const blocked = { ...t, walkable: (x, z) => x > 5 && t.walkable(x, z) };
  const q = pointDeparture(blocked, new URLSearchParams('pos=0,0')); assert(q && q.x > 5 && blocked.walkable(q.x, q.z));
  assert.equal(pointDeparture({ ...t, walkable: () => false }, new URLSearchParams('pos=0,0')), null);
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
  // CLI and Node use the same acceptance gate; boundary steps are reporting only.
  assert.equal(r.exact.violations, 0); assert.equal(r.exact.max, 0);
  assert.equal(Object.keys(r.routes).length, 7);
  for (const id of Object.keys(data.patches.axes)) {
    for (const at of [0, .5, 1]) {
      const p = kamakuraSpawn(t, '?spawn=' + id + '&at=' + at);
      assert(t.walkable(p.x, p.z));
    }
  }
  assert(r.accepted, JSON.stringify(r.failures));
});

test('patch bounds extend A and zero mask only inside cells, never extend water or the world frame', () => {
  const { data } = patched(); data.meta.walk.polygon_m = [[8, 8], [12, 8], [12, 12], [8, 12]]; data.walk.fill(0);
  const t = createKamakuraTerrain(data);
  assert(!t.insideA(-2, -2)); assert(t.insidePatch(-2, -2)); assert(t.walkable(-2, -2));
  assert(!t.walkable(-4.01, -2)); assert(!t.insidePatch(-100, -100)); assert(!t.walkable(-100, -100));
  data.walk.fill(2); assert(!t.walkable(-2, -2)); assert.equal(t.movementBlockedAt(-2, -2), 'water');
});
test('v0.3 path loading, malformed path rejection, distance fraction and direction use the road rather than the axis', async () => {
  const { f, extra } = patched(); f.meta.schema = 'kz-world-web/0.3'; f.meta.patches.paths_file = 'patch_paths.json';
  const paths = { test: { route_id: 'synthetic', s_m: [10, 11, 14], xyz_m: [[-3, 3, 1000], [-3, 2, 1000], [0, 2, 1000]] } };
  const files = { 'meta.json': f.meta, 'patch_axes.json': extra.axes, 'patch_paths.json': paths,
    'height_u16.bin': f.heights.buffer, 'walk_u8.bin': f.walk.buffer, 'patch_cells_i32.bin': extra.cells, 'patch_h_f32.bin': extra.heights };
  const calls = [];
  const data = await loadKamakura(async url => { calls.push(url); const v = files[url.split('/').at(-1)]; return { ok: !!v, json: async () => v, arrayBuffer: async () => v }; });
  assert(calls.includes('/world-private/patch_paths.json'));
  const t = createKamakuraTerrain(data), p = kamakuraSpawn(t, '?spawn=test&at=.5');
  assert.equal(p.x, -2); assert.equal(p.z, -2); assert.equal(p.yaw, -Math.PI / 2);
  assert.equal(kamakuraSpawn(t, '?spawn=test&at=0').yaw, -Math.PI);
  assert.equal(kamakuraSpawn(t, '?spawn=test&at=1').x, 0);
  const decode = paths => decodeData(f.meta, f.heights.buffer, f.walk.buffer, { ...extra, paths });
  assert.throws(() => decode()); assert.throws(() => decode({}));
  paths.test.s_m[1] = 10; assert.throws(() => decode(paths)); paths.test.s_m[1] = 11;
  paths.test.xyz_m[1][2] = NaN; assert.throws(() => decode(paths));
});
test('reachability uses strict integer thresholds, fixed endpoints and all eight neighbours', () => {
  const { data } = patched(); data.meta.patches.items[0].offset = 0; data.meta.patches.items[0].count = 1;
  const route = { s_m: [0, 4], xy_m: [[-4, 4], [0, 0]], floor_m: [1000, 1000] };
  const terrain = { ...createKamakuraTerrain(data), slopeAt: (x, z) => x === z ? 10 : 89 };
  const r = verifyReachability(terrain, data, 'test', route);
  assert.equal(r.minimumLimit_deg, 11); assert(r.at46);
  const blocked = verifyReachability({ ...terrain, slopeAt: () => 60 }, data, 'test', route);
  assert.equal(blocked.minimumLimit_deg, 61); assert(!blocked.at46);
});
