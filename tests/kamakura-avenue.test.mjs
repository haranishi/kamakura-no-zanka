import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AVENUE, avenueAxis, avenueSample, avenueRange, prepareAvenue, avenueBerm, bermStone, bermHash, avenueToriiGeometry, avenueToriiColor } from '../dist/valley/kamakura-avenue.js';
import { prepareVeg } from '../dist/valley/kamakura-veg.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { loadKamakura } from '../dist/valley/kamakura-data.js';
import { syntheticWorld } from '../tools/make-synthetic-world.mjs';
const road = (points, route_id = 'avenue', width_m = 14, kind = 'local_road') => ({ route_id, width_m, kind, xyz_m: points.map(([x, z]) => [x, -z, 0]) });
const terrain = (extra = {}) => ({ heightAt: () => 10, waterAt: () => 0, walkable: () => true, insideA: () => true, ...extra });
const world = (width = 14) => ({ roads: { main: road([[0, 0], [0, 600]], 'avenue', width) }, veg: [] });
const pine = (x, z, id = 0) => ({ x, z, id, sourceSpecies: 1, tier: 0, height: 10, crown: 4, variant: 0, rank: 0, yaw: 0, tint: 0, phase: 0, lean: 0 });
const node = (part, x, z, w = 4, d = 4) => ({ node: part, part, anchor_xz: [x, z], bbox_min: [-w / 2, 0, -d / 2], bbox_max: [w / 2, 10, d / 2] });
const plan = (d = world(), t = terrain()) => prepareAvenue(d, { terrain: t });
const close = (a, b, eps = 1e-5) => assert(Math.abs(a - b) < eps, `${a} != ${b}`);
const fetchFiles = files => async url => {
  const bytes = files.get(path.basename(url)); if (!bytes) throw new Error('Missing synthetic file');
  return { ok: true, json: async () => JSON.parse(bytes), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};

test('A1 joins reversed fragments by route, chooses the longest route and starts at the shrine', () => {
  const d = world(27); d.roads = { tail: road([[0, 600], [0, 370]], 'long', 27), short: road([[100, 0], [100, 190]], 'short'), head: road([[0, 0], [0, 200]], 'long', 27) };
  d.facilities = { nodes: [node('torii', 0, 620)] };
  const a = avenueAxis(d); assert.equal(a.pieces, 2); assert.equal(a.width, 27); assert.equal(a.route, 'long'); close(a.length, 600); close(a.start.z, 600); close(avenueSample(a, 300).z, 300);
  assert.deepEqual(avenueAxis(d), a); assert.equal(avenueAxis({}), null); assert.equal(avenueAxis({ roads: { t: road([[0, 0], [0, 300]], 't', 5, 'trail') } }), null);
  d.facilities = { nodes: [node('hall', 0, -10)] }; close(avenueAxis(d).start.z, 0);
  const rotated = { roads: { main: road([[10, 10], [310, 410]]) } }; close(avenueAxis(rotated).length, 500);
});

test('A2 rows cover the whole avenue, use deterministic varied pine attributes, and retain source references when inactive', t => {
  for (const width of [10, 14, 27]) {
    const d = world(width); d.veg = [pine(90, 50, 23)]; const p = plan(d);
    assert(p.pines.length >= 80 && p.pines.length <= 130); assert.equal(p.pines[0].id, 24);
    assert.deepEqual(p.pines, plan(d).pines); assert.equal(p.veg[0], d.veg[0]);
    for (const side of [-1, 1]) {
      const row = p.pines.filter(p => p.side === side); assert(row[0].along < 15); assert(row.at(-1).along > 580);
      for (let i = 0; i < row.length; i++) {
        const q = row[i], lateral = Math.abs(q.x); assert(lateral >= width / 2 + AVENUE.pineOffset - AVENUE.pineJitter && lateral <= width / 2 + AVENUE.pineOffset + AVENUE.pineJitter);
        if (i) { const gap = q.along - row[i - 1].along; assert(gap >= 9); if (gap > 14) assert(p.torii.some(t => t.along >= row[i - 1].along - 5 && t.along <= q.along + 5)); }
        assert(q.height >= 9 && q.height <= 14 && q.crown >= 3 && q.crown <= 4.5 && q.rank >= 0 && q.rank <= .35 && Math.abs(q.lean) <= AVENUE.lean);
        assert.equal(q.sourceSpecies, 1); assert.equal(q.tier, 0);
      }
    }
    const kept = prepareVeg(p.veg, terrain(), { paths: d.roads }).active;
    assert.equal(kept.filter(q => q.id >= 24).length, p.pines.length);
    assert.equal(prepareAvenue(d, { search: '?avenue=0', terrain: terrain() }), null); assert.equal(d.veg.length, 1);
    t.diagnostic(JSON.stringify({ width, pines: p.pines.length, ...p.work }));
  }
  const d = { veg: [] }, original = d.veg; assert.equal(plan(d), null); assert.equal(d.veg, original);
});

test('A2 excludes boxes, water, river width, other roads, trees, old/new torii posts and unwalkable/outside terrain', () => {
  const baseline = plan(), q = baseline.pines[15];
  const cases = [
    ['house', d => { d.facilities = { nodes: [node('hall', q.x, q.z)] }; }, terrain()],
    ['water', () => {}, terrain({ waterAt: (x, z) => Math.hypot(x - q.x, z - q.z) < 2 ? .4 : 0 })],
    ['water', () => {}, terrain({ riverDistanceAt: (x, z) => Math.hypot(x - q.x, z - q.z) < 2 ? 0 : 20 })],
    ['road', d => { d.roads.cross = road([[-20, q.z], [20, q.z]], 'cross', 4, 'trail'); }, terrain()],
    ['tree', d => { d.veg = [pine(q.x, q.z)]; }, terrain()],
    ['other', () => {}, terrain({ walkable: (x, z) => Math.hypot(x - q.x, z - q.z) > 2 })],
    ['other', () => {}, terrain({ insideA: (x, z) => Math.hypot(x - q.x, z - q.z) > 2 })],
  ];
  for (const [reason, edit, ter] of cases) {
    const d = world(); edit(d); const p = plan(d, ter); assert(p.skipped[reason] > 0, reason);
    assert(p.pines.every(p => Math.hypot(p.x - q.x, p.z - q.z) >= 2), reason);
  }
  const d = world(); d.facilities = { nodes: [node('torii', 0, 0)] }; const p = plan(d);
  assert(p.pines.every(p => Math.hypot(p.x, p.z) >= AVENUE.oldToriiClearance));
  for (const tree of p.pines) for (const torii of p.torii) for (const post of torii.posts) assert(Math.hypot(tree.x - post.x, tree.z - post.z) >= AVENUE.postClearance);
  const home = world(); home.houses = { kinds: new Map([[0, { bbox_min: [-2, -2, 0], bbox_max: [2, 2, 6] }]]), instances: [{ kind: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, q.x, 10, q.z, 1] }] };
  assert(plan(home).skipped.house > 0);
});

test('A3 target fractions, safe shifts, rotation, opening, height and bounded geometry', t => {
  const d = world(), p = plan(d); assert.equal(p.torii.length, 2);
  for (let i = 0; i < 2; i++) { const q = p.torii[i]; close(q.along, 600 * AVENUE.fractions[i]); close(q.opening, 9); close(q.height, 9 * .95); close(Math.cos(q.yaw), -q.dz); assert.equal(q.posts.length, 2); }
  const near = plan(world(10)); close(near.torii[0].opening, 7);
  const crossing = world(); crossing.roads.cross = road([[-50, 168], [50, 168]], 'cross', 4, 'trail');
  const moved = plan(crossing); assert(Math.abs(moved.torii[0].along - 168) > 2 && Math.abs(moved.torii[0].along - 168) <= 40);
  const wet = plan(world(), terrain({ waterAt: (x, z) => Math.abs(z - 168) < 5 ? .4 : 0 })); assert(Math.abs(wet.torii[0].along - 168) >= 5);
  const boxed = world(); boxed.facilities = { nodes: [node('fence', 0, 168, 30, 100)] }; assert.equal(plan(boxed).torii.length, 1);
  const g = avenueToriiGeometry(p, [.6, .12, .04]); assert(g.triangles <= 800); assert(g.ranges.every(r => r.count / 3 <= 400));
  for (const n of g.positions) assert(Number.isFinite(n)); assert(g.colors.some(n => Math.abs(n - .6 * AVENUE.roofShade) < 1e-6));
  t.diagnostic(JSON.stringify({ toriiTriangles: g.triangles, trianglesPerTorii: g.triangles / 2 }));
});

test('A3 3D range follows quality and each automatic step', () => {
  assert.equal(avenueRange(), 5000); assert.equal(avenueRange('light'), 3000); assert.equal(avenueRange('standard', 1), 4000); assert.equal(avenueRange('standard', 2), 3000);
  assert.equal(avenueRange('standard', 3), 2000); assert.equal(avenueRange('light', 3), 2000);
});

test('A4 berm faces: stone slopes without the hue of the ground, a grass top, a soil toe, and a tone of its own for each stretch', () => {
  const ground = [.1, .2, .08], ter = terrain({ groundColorAt: () => ground }), b = avenueBerm(plan(world(), ter), ter), c = b.colors;
  const stone = bermStone(ground), lum = .2126 * ground[0] + .7152 * ground[1] + .0722 * ground[2];
  for (let k = 0; k < 3; k++) close(stone[k], lum * AVENUE.stoneHue[k] * AVENUE.stoneGain);
  assert(stone[0] > stone[1] && stone[1] > stone[2] && stone[0] - stone[2] < stone[0] * .25, 'a warm grey, not the green of the ground');
  // Each stretch: 8 face triangles (toe 2, slope 2, top 2, slope 2) and then the end caps, 9 colour values per triangle.
  const tones = new Set(); let stretches = 0;
  for (let at = 0; at < c.length; at += (8 + 6) * 9, stretches++) {
    const face = n => [c[at + n * 18], c[at + n * 18 + 1], c[at + n * 18 + 2]], toe = face(0), outer = face(1), top = face(2), inner = face(3);
    for (let k = 0; k < 3; k++) close(toe[k], ground[k]);
    const tone = outer[0] / stone[0]; tones.add(tone.toFixed(4)); assert(tone >= 1 - AVENUE.bermTone - 1e-6 && tone <= 1 + AVENUE.bermTone + 1e-6);
    for (let k = 0; k < 3; k++) { close(outer[k], stone[k] * tone); close(inner[k], stone[k] * tone); }
    assert(top[1] > top[0] && top[1] > top[2], 'the top stays green'); assert(top[1] / top[0] > outer[1] / outer[0] * 1.2, 'the top is clearly greener in hue than the stone');
    for (let n = 8; n < 14; n++) for (let k = 0; k < 3; k++) close(c[at + n * 9 + k], stone[k] * tone);
  }
  assert.equal(stretches, b.segments.length); assert(tones.size > b.segments.length / 3, 'stretches differ in tone');
  for (const [i, side] of [[1, 1], [1, -1], [2, 1]]) assert(bermHash(i, side) >= 0 && bermHash(i, side) < 1);
});
test('A4 berm cross section and ground contact follow a synthetic slope; entrances and crossing widths stay open', t => {
  const d = world(); d.roads.cross = road([[-100, 300], [100, 300]], 'cross', 8, 'kaido');
  const ter = terrain({ heightAt: (x, z) => 10 + x * .12 + z * .06, groundColorAt: () => [.1, .2, .08] }), p = plan(d, ter), b = avenueBerm(p, ter);
  assert(b.triangles <= 6000 && b.length > 0 && b.gaps > 0);
  for (const s of b.segments) {
    assert(s.from >= 600 * .28 && s.to <= 600 * .74); assert(s.to - s.from <= 6 + 1e-6);
    assert(s.to <= 293 || s.from >= 307);
    for (const center of [210, 280, 350, 420]) assert(s.to <= center - 2.5 || s.from >= center + 2.5);
    for (const row of s.rows) { for (const p of [row[0], row.at(-1)]) assert(Math.abs(p[1] - ter.heightAt(p[0], p[2])) <= .05); close(Math.hypot(row[0][0] - row.at(-1)[0], row[0][2] - row.at(-1)[2]), 2.6); close(Math.hypot(row[2][0] - row[3][0], row[2][2] - row[3][2]), 1); }
  }
  const house = world(); house.facilities = { nodes: [node('fence', -6.4, 330, 10, 10)] }; const houseBerm = avenueBerm(plan(house), terrain());
  assert(houseBerm.segments.filter(s => s.side > 0).every(s => s.to <= 325 || s.from >= 335));
  t.diagnostic(JSON.stringify({ bermTriangles: b.triangles, combinedTriangles: b.triangles + avenueToriiGeometry(p, [1, 0, 0]).triangles, gaps: b.gaps, length: b.length }));
});

test('synthetic CI world is deterministic, below 8MB, and loader appends pines with two torii; avenue=0 restores raw veg', async t => {
  const files = syntheticWorld(); assert.deepEqual([...files], [...syntheticWorld()]); const bytes = [...files.values()].reduce((n, b) => n + b.length, 0); assert(bytes <= 8 * 1024 * 1024);
  const off = await loadKamakura(fetchFiles(files), '?avenue=0'), on = await loadKamakura(fetchFiles(files));
  assert(on.avenue.pines.length > 0); assert.equal(on.avenue.torii.length, 2); assert.equal(on.veg.length, off.veg.length + on.avenue.pines.length); assert.equal(on.avenue.veg, on.veg); assert.equal(off.avenue, undefined);
  files.delete('roads.json'); const absent = await loadKamakura(async url => url.endsWith('roads.json') ? { ok: false } : fetchFiles(files)(url));
  assert.equal(absent.avenue, null); assert.deepEqual(absent.veg, off.veg);
  t.diagnostic(JSON.stringify({ bytes, addedPines: on.avenue.pines.length, torii: on.avenue.torii.length }));
});

test('torii pigment comes from its own existing facility GLB material, in linear working space', () => {
  const json = { nodes: [{ name: 'torii', mesh: 0 }], meshes: [{ primitives: [{ material: 0 }, { material: 1 }] }], materials: [{ pbrMetallicRoughness: { baseColorFactor: [.45, .035, .015, 1] } }, { pbrMetallicRoughness: { baseColorFactor: [.02, .02, .02, 1] } }] };
  const bytes = new TextEncoder().encode(JSON.stringify(json)); const kit = new ArrayBuffer(20 + bytes.length), view = new DataView(kit); view.setUint32(0, 0x46546c67, true); view.setUint32(12, bytes.length, true); new Uint8Array(kit, 20).set(bytes);
  assert.deepEqual(avenueToriiColor({ facilities: { kit, nodes: [node('torii', 0, 0)] } }), [.45, .035, .015]); assert.equal(avenueToriiColor({}), null);
});

test('private world: no exceptions, bounded geometry and no pine in forbidden terrain (aggregates only)', { skip: !process.env.KZ_WORLD_DIR && '私有データ未指定' }, async t => {
  const data = await loadKamakura(async url => { const b = await fs.readFile(path.join(process.env.KZ_WORLD_DIR, path.basename(url))); return { ok: true, json: async () => JSON.parse(b), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; });
  const p = data.avenue; assert(p); const ter = createKamakuraTerrain(data), berm = avenueBerm(p, ter), torii = avenueToriiGeometry(p, avenueToriiColor(data));
  assert(p.pines.length >= 200 && p.pines.length <= 450); assert(berm.triangles <= 6000 && torii.triangles + berm.triangles <= 7000);
  for (const q of p.pines) { assert(ter.insideA(q.x, q.z) && ter.walkable(q.x, q.z)); assert.equal(ter.waterAt(q.x, q.z), 0); assert(!p.site.boxAt(q.x, q.z, 2)); assert(!p.site.roadAt(q.x, q.z, 3)); }
  t.diagnostic(JSON.stringify({ addedPines: p.pines.length, toriiTriangles: torii.triangles, bermTriangles: berm.triangles, draws: 2, ...p.work }));
});
