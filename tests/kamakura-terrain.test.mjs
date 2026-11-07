import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { createKamakuraTerrain, insidePolygon } from '../dist/valley/kamakura-terrain.js';
import { decodeData, loadKamakura } from '../dist/valley/kamakura-data.js';
import { buildColliders, moveActor } from '../dist/valley/collision.js';
import { readPrivateData, verifySamples, verifySeams } from '../tools/lib/kamakura-validation.mjs';
import { chooseLOD, chunkGeometry } from '../dist/valley/kamakura-chunks.js';
import { startWorld, verticalScale } from '../dist/valley/world-entry.js';

test('synthetic cell centres, north row, little-endian decode and bilinear interpolation', () => {
  const f = fixture({ width: 2, height: 2, cell: 2 }); f.heights.set([10, 20, 30, 60]);
  const bin = new ArrayBuffer(8), v = new DataView(bin); f.heights.forEach((n, i) => v.setUint16(i * 2, n, true));
  const t = createKamakuraTerrain(decodeData(f.meta, bin, f.walk.buffer));
  assert.equal(t.heightAt(-1, -1), 10); assert.equal(t.heightAt(1, 1), 60);
  assert.equal(t.heightAt(0, 0), 30); assert.equal(t.heightAt(0.5, -0.5), 26.25);
  assert.equal(t.heightAt(-100, -100), 10);
  assert.throws(() => decodeData(f.meta, new ArrayBuffer(2), f.walk.buffer));
});
test('slope uses scaled real metres; 40 degrees is a strict limit', () => {
  const f = fixture({ cell: 10, slope: 0.5 }); const t = createKamakuraTerrain(f), scaled = createKamakuraTerrain(f, 1.8);
  assert(Math.abs(t.slopeAt(0, 0) - Math.atan(0.5) * 180 / Math.PI) < 1e-8);
  assert(t.walkable(0, 0)); assert(!scaled.walkable(0, 0));
  assert(Math.abs(scaled.heightAt(0, 0) / t.heightAt(0, 0) - 1.8) < 1e-9);
  const steep = createKamakuraTerrain(fixture({ slope: 1 })); assert.equal(steep.slopeAt(0, 0), 45); assert(!steep.walkable(0, 0));
  assert.equal(t.roadInfo(0, 0), null); assert.equal(Object.values(t.surfaceAt(0, 0)).reduce((a, b) => a + b), 1);
});
test('water mask, sea level, mask exclusion, polygon and swept movement stop at boundaries', () => {
  const f = fixture(); f.meta.walk.polygon_m = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
  const t = createKamakuraTerrain(f), col = buildColliders({ bounds: t.bounds });
  assert(insidePolygon(0, 0, f.meta.walk.polygon_m)); assert(!t.walkable(12, 0));
  const p = { x: 0, y: t.heightAt(0, 0), z: 0 };
  const r = moveActor(col, t, p, 30, 0); assert(r.x < 10); assert.equal(r.blocked, 'bounds');
  f.walk.fill(2); assert(!t.walkable(0, 0)); assert.equal(moveActor(col, t, p, 1, 0).blocked, 'water');
  f.walk.fill(1); f.heights.fill(0); assert(!t.walkable(0, 0)); assert(t.waterAt(0, 0) > 0.45);
  f.heights.fill(10); f.walk.fill(0); assert(!t.walkable(0, 0));
});
test('optional world hook enforces 40 degrees without relaxing legacy collision limits', () => {
  const f = fixture({ slope: 1 }), t = createKamakuraTerrain(f), col = buildColliders({ bounds: t.bounds });
  const p = { x: 0, y: t.heightAt(0, 0), z: 0 };
  assert.equal(moveActor(col, t, p, 1, 0).blocked, 'slope');
  const legacy = { ...t }; delete legacy.movementBlockedAt;
  assert.equal(moveActor(col, legacy, p, 1, 0).blocked, null); // 45° < existing 46°
  const step = { ...legacy, slopeAt: () => 0, heightAt: x => x > 0 ? 100 : 0 };
  assert.equal(moveActor(col, step, { x: 0, y: 0, z: 0 }, 1, 0).blocked, 'step');
});
test('all LOD pairs share every edge position, height and normal in both directions', () => {
  const f = fixture(); f.heights.forEach((_, k) => { f.heights[k] = 100 + Math.round(20 * Math.sin(k % 145 / 5) * Math.cos(Math.floor(k / 145) / 9)); });
  assert.equal(verifySeams(createKamakuraTerrain(f)), 32);
  // Partial final chunks and corners also retain complete original-grid edges.
  assert.equal(verifySeams(createKamakuraTerrain(f), 128, 128, 8), 32);
  const g = chunkGeometry(createKamakuraTerrain(f), 0, 0, 64, 64, 8, { east: 1, south: 4 });
  assert(g.indices.every(i => i >= 0 && i < g.positions.length / 3));
  for (let k = 0; k < g.indices.length; k += 3) {
    const [a, b, c] = g.indices.slice(k, k + 3).map(i => i * 3), p = g.positions;
    assert((p[b + 2] - p[a + 2]) * (p[c] - p[a]) - (p[b] - p[a]) * (p[c + 2] - p[a + 2]) > 0, 'upward nondegenerate triangles');
  }
});
test('LOD hysteresis avoids threshold flicker', () => {
  assert.equal(chooseLOD(430, 1), 1); assert.equal(chooseLOD(470, 1), 2);
  assert.equal(chooseLOD(400, 2), 2); assert.equal(chooseLOD(370, 2), 1);
  assert.equal(chooseLOD(4000, 1), 8); assert.equal(chooseLOD(10, 8), 1);
});
test('default entry loads only valley; opt-in and missing-data fallback run once', async () => {
  for (const search of ['', '?spawn=asaina_pass&at=.5', '?world=on', '?world=other']) {
    const calls = []; await startWorld(search, { valley: () => calls.push('valley'), kamakura: () => calls.push('private'), fallback: () => calls.push('notice') });
    assert.deepEqual(calls, ['valley']);
  }
  const calls = []; await startWorld('?world=kamakura', { valley: () => calls.push('valley'), kamakura: () => { throw Error(); }, fallback: () => calls.push('notice') });
  assert.deepEqual(calls, ['notice', 'valley']);
  assert.equal(verticalScale(''), 1); assert.equal(verticalScale('?vscale=1.8'), 1.8); assert.equal(verticalScale('?vscale=NaN'), 1);
});
test('loader requests only same-origin private files; missing or invalid data rejects', async () => {
  const f = fixture(), calls = [];
  const fetcher = async (url, opts) => { calls.push(url); assert.equal(opts.cache, 'no-store'); return { ok: true, json: async () => f.meta, arrayBuffer: async () => url.endsWith('height_u16.bin') ? f.heights.buffer : f.walk.buffer }; };
  await loadKamakura(fetcher); assert.deepEqual(calls, ['/world-private/meta.json', '/world-private/height_u16.bin', '/world-private/walk_u8.bin']);
  await assert.rejects(loadKamakura(async () => ({ ok: false })));
  await assert.rejects(loadKamakura(async () => ({ ok: true, json: async () => ({}) })));
});
test('private check_samples, coordinate orientation and real-data LOD seams', { skip: !process.env.KZ_WORLD_DIR && 'KZ_WORLD_DIR未設定：リポジトリ外の実データが必要' }, async () => {
  const { data, checks } = await readPrivateData(process.env.KZ_WORLD_DIR); assert(verifySamples(data, checks) > 0);
  const t = createKamakuraTerrain(data); verifySeams(t, 64, 64);
  assert(t.walkable(data.meta.spawn.x, -data.meta.spawn.y));
  // Walk a short deterministic route in physical metres without copying samples into source.
  const col = buildColliders({ bounds: t.bounds }), yaw = -data.meta.spawn.yaw_deg_clockwise_from_north * Math.PI / 180;
  let p = { x: data.meta.spawn.x, z: -data.meta.spawn.y, y: data.meta.spawn.z };
  let advanced = false;
  for (let i = 0; i < 200; i++) {
    const next = moveActor(col, t, p, -Math.sin(yaw) * 0.1, -Math.cos(yaw) * 0.1);
    advanced ||= Math.hypot(next.x - p.x, next.z - p.z) > 0;
    assert(t.walkable(next.x, next.z), 'Real-metre walk stays on permitted terrain');
    assert(next.y === t.heightAt(next.x, next.z), 'Ground height stays attached'); p = next;
  }
  assert(advanced, 'Real-metre route advances from spawn');
});
