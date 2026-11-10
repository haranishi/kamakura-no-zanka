import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { prepareProps, propPlacementBatches, createPropSite, PROP_KINDS, PROPS, PROP_HOLLOW, propBoxDistance, propInBox, propFade, propRange } from '../dist/valley/kamakura-props.js';
import { createHabitat } from '../dist/valley/kamakura-habitat.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { readPrivateData } from '../tools/lib/kamakura-validation.mjs';
import { readPrivateFacilities } from '../tools/lib/kamakura-facility-validation.mjs';
import { facilityFootprint } from '../dist/valley/kamakura-facilities.js';
import { readPrivateHouses } from '../tools/lib/kamakura-house-validation.mjs';
import { houseBox, houseMatrix } from '../dist/valley/kamakura-houses.js';

function world() {
  const hall = { node: 'hall', part: 'hall', facility: 'tsurugaoka', anchor_xz: [0, 0], bbox_min: [-10, 0, -5], bbox_max: [10, 8, 5] };
  const gate = { node: 'gate', part: 'torii', facility: 'tsurugaoka', anchor_xz: [0, 65], bbox_min: [-4, 0, -1], bbox_max: [4, 5, 1] };
  const data = { facilities: { nodes: [hall, gate] }, patches: { paths: { pass: { xyz_m: [[160, -150, 0], [160, -210, 0]] } } }, meta: { places: [{ name: 'beach', kind: 'coast', x: 0, y: -800 }] } };
  const boxes = Array.from({ length: 600 }, (_, i) => ({ x: 400 + i % 30 * 14, z: -350 + Math.floor(i / 30) * 14, w: 6, d: 4, height: 5, rotY: i % 2 * .4 }));
  const terrain = { heightAt: (x, z) => 10 + x * .001, walkable: (x, z) => z < 850, slopeAt: () => 1, waterAt: (x, z) => z >= 850 ? 1 : 0, seaDistanceAt: (x, z) => Math.max(0, 850 - z), riverDistanceAt: () => 100 };
  const habitat = { at(x, z, out) { out.sand = z > 750 ? 1 : 0; out.pass = x > 120 && x < 200 ? 1 : 0; out.town = x > 350 ? 1 : 0; return out; } };
  return { data, houses: { boxes }, terrain, habitat };
}
const total = object => Object.values(object).reduce((a, b) => a + b, 0);

test('deterministic seven-kind placement, finite transforms, spacing, boxes and prohibited terrain', t => {
  const w = world(), a = prepareProps(w), b = prepareProps(w);
  assert.deepEqual(a.items, b.items); assert.deepEqual(a.skipped, b.skipped);
  for (const k of PROP_KINDS) assert(a.placed[k] > 0, k);
  for (let i = 0; i < a.items.length; i++) {
    const p = a.items[i];
    for (const k of ['x', 'y', 'z', 'yaw', 'scale', 'tiltX', 'tiltZ']) assert(Number.isFinite(p[k]), k);
    assert(p.scale >= .9 && p.scale <= 1.1);
    assert.equal(a.site.reason(p), null);
    if (p.kind !== 'smoke') for (const box of a.site.boxes) assert(propBoxDistance(p.x, p.z, box) >= .3);
    assert(w.terrain.walkable(p.x, p.z)); assert(w.terrain.slopeAt(p.x, p.z) <= 25); assert.equal(w.terrain.waterAt(p.x, p.z), 0);
    if (p.kind !== 'boat' && p.kind !== 'smoke') assert(p.y <= w.terrain.heightAt(p.x, p.z));
    if (p.kind !== 'boat') { assert.equal(p.tiltX, 0); assert.equal(p.tiltZ, 0); }
    for (let j = 0; j < i; j++) { const q = a.items[j]; assert(Math.hypot(p.x - q.x, p.z - q.z) >= (p.kind === 'boat' || q.kind === 'boat' ? 3 : .8)); }
  }
  t.diagnostic(JSON.stringify({ syntheticPlaced: a.placed, syntheticSkipped: a.skipped }));
});

test('lanterns form complete pairs nine metres apart on the hall-to-gate approach', () => {
  const r = prepareProps(world()), lamps = r.items.filter(p => p.kind === 'lantern');
  assert(lamps.length >= 4 && lamps.length <= 10);
  const rows = new Map(); for (const p of lamps) { if (!rows.has(p.z)) rows.set(p.z, []); rows.get(p.z).push(p); }
  let previous;
  for (const [z, pair] of rows) { assert.equal(pair.length, 2); assert.equal(pair[0].x, -pair[1].x); assert(z > 5 && z < 65); if (previous !== undefined) assert.equal(z - previous, 9); previous = z; }
  // Missing gate picks a long face with available walkable ground, for a 30m approach.
  const w = world(); w.data.facilities.nodes.pop(); w.terrain.walkable = (x, z) => z < 0;
  const fallback = prepareProps(w).items.filter(p => p.kind === 'lantern'); assert(fallback.length >= 4); assert(fallback.every(p => p.z < -5));
});

test('pass paths convert north to -z; groups have prescribed sizes; jizo face the path; boats face the sea', () => {
  const r = prepareProps(world());
  for (const group of ['hall', 'pass:0', 'pass:1']) {
    const towers = r.items.filter(p => p.kind === 'gorinto' && p.group === group); assert(towers.length >= (group === 'hall' ? 3 : 2)); assert(towers.length <= (group === 'hall' ? 9 : 5));
  }
  for (const p of r.items.filter(p => p.kind === 'jizo' && p.group.startsWith('pass:'))) { assert(Math.abs(p.x - 160) >= 2.5 && Math.abs(p.x - 160) <= 4); assert(Math.sin(p.yaw) * (160 - p.x) > 0); assert(p.z >= 150 && p.z <= 213); }
  const boats = r.items.filter(p => p.kind === 'boat'); assert(boats.length >= 4 && boats.length <= 10);
  for (const p of boats) { assert(Math.cos(p.yaw) > .99); assert(p.z >= 825 && p.z <= 842); assert(Math.hypot(p.x, p.z - 800) <= 250); }
});


test('upright bases sink to downhill ground; boats align to longitudinal and lateral slope', () => {
  const w = world(); w.terrain.heightAt = (x, z) => 10 + x * .10 + z * .05; w.terrain.slopeAt = () => 7;
  const r = prepareProps(w);
  for (const p of r.items) {
    if (p.kind === 'boat') { assert(Math.abs(p.tiltX) > .01); assert(Math.abs(p.tiltZ - .08) > .01); }
    else if (p.kind !== 'smoke') { const radius = p.kind === 'yard' ? .72 : p.kind === 'nobori' ? .05 : .4; assert(p.y <= w.terrain.heightAt(p.x - radius, p.z - radius) + 1e-9); }
  }
});

test('temple tower groups sit inside the enclosing walls, and tsurugaoka banners have a shared 12-pole ceiling', () => {
  const w = world();
  for (const [i, x, z, min, max] of [[0, -30, 0, [-.5, 0, -30], [.5, 2, 30]], [1, 30, 0, [-.5, 0, -30], [.5, 2, 30]], [2, 0, -30, [-30, 0, -.5], [30, 2, .5]], [3, 0, 30, [-30, 0, -.5], [30, 2, .5]]]) {
    w.data.facilities.nodes.push({ node: `wall${i}`, part: 'fence', facility: 'tsurugaoka', anchor_xz: [x, z], bbox_min: min, bbox_max: max });
  }
  const towers = prepareProps(w).items.filter(p => p.kind === 'gorinto' && p.group === 'hall');
  assert(towers.length >= 3); assert(towers.every(p => p.x > -29 && p.x < 29 && p.z > -29 && p.z < 29));
  w.data.facilities.nodes = w.data.facilities.nodes.filter(n => n.part !== 'fence');
  w.data.facilities.nodes.push({ node: 'gate2', part: 'gate', facility: 'tsurugaoka', anchor_xz: [80, 65], bbox_min: [-4, 0, -1], bbox_max: [4, 5, 1] });
  assert.equal(prepareProps(w).placed.nobori, 12);
});

test('a fence or cloister record spanning a whole ring blocks only its band; the yard inside stays open; every skip has a reason', () => {
  // Real fence records are one bounding box around the whole enclosure. Solid, it emptied every temple yard in the browser.
  const w = world(); w.data.facilities.nodes.push({ node: 'ring', part: 'fence', facility: 'tsurugaoka', anchor_xz: [0, 20], bbox_min: [-40, 0, -45], bbox_max: [40, 2, 45] });
  const site = createPropSite(w);
  assert.equal(site.reason({ kind: 'jizo', x: 0, z: 30 }), null, 'open yard inside the ring');
  assert.equal(site.reason({ kind: 'jizo', x: 39.5, z: 20 }), 'box', 'on the fence band');
  assert.equal(site.reason({ kind: 'jizo', x: 40.5, z: 20 }), 'box', 'just outside the fence');
  assert(propInBox(0, 30, { x: 0, z: 20, w: 80, d: 90, rotY: 0 }, .5), 'a solid box still blocks its inside');
  assert.equal(PROP_HOLLOW.fence < PROP_HOLLOW.kairo, true);
  const r = prepareProps(w);
  assert(r.items.some(p => p.kind === 'lantern'), 'lanterns still stand inside the ring');
  for (const k of PROP_KINDS) assert.equal(Object.values(r.why[k]).reduce((a, b) => a + b, 0), r.skipped[k], k);
});

test('site rejects rotated footprints, 2m path corridor, water, sea edge, slopes and unwalkable land; counts every skip', () => {
  const w = world(), site = createPropSite(w);
  assert.equal(site.reason({ kind: 'jizo', x: 0, z: 0 }), 'box');
  assert.equal(site.reason({ kind: 'jizo', x: 161, z: 180 }), 'path');
  assert.equal(propBoxDistance(2, 0, { x: 0, z: 0, w: 4, d: 2, rotY: Math.PI / 2 }), 1);
  for (const override of [{ walkable: () => false }, { waterAt: () => 1 }, { slopeAt: () => 26 }, { seaDistanceAt: () => 0 }]) {
    const bad = { ...w, terrain: { ...w.terrain, ...override } }, r = prepareProps(bad);
    assert.equal(r.items.length, 0); assert(total(r.skipped) > 0);
    for (const k of PROP_KINDS) assert(r.skipped[k] > 0, k);
  }
  assert.equal(site.reason({ kind: 'smoke', x: 400, z: -350 }), null, 'roof sources intentionally exempt house/path exclusion');
});

test('8% of houses at noon and 14% morning/evening, selected by stable coordinate hash', t => {
  const w = world(); w.houses.boxes = Array.from({ length: 10000 }, (_, i) => ({ x: (i % 100) * 20, z: -1000 - Math.floor(i / 100) * 20, w: 6, d: 4, height: 5, rotY: 0 }));
  let noon;
  for (const time of ['noon', 'morning', 'evening']) {
    const r = prepareProps(w, { time, only: 'smoke' }), fraction = r.placed.smoke / 10000;
    assert(Math.abs(fraction - (time === 'noon' ? .08 : .14)) < .015);
    if (time === 'noon') noon = r.items; else for (const p of noon) assert(r.items.some(q => q.x === p.x && q.z === p.z));
    for (const p of r.items) assert.equal(p.y, w.terrain.heightAt(p.x, p.z) + 5);
    t.diagnostic(`${time}: ${(fraction * 100).toFixed(2)}% synthetic houses`);
  }
});

test('batching gives the same placement and bounds house terrain work per iteration; distance policy has smooth limits', t => {
  const w = world(); w.houses.boxes = Array.from({ length: 2800 }, (_, i) => ({ x: (i % 70) * 14 + 400, z: -500 - Math.floor(i / 70) * 14, w: 6, d: 4, height: 5, rotY: 0 }));
  const begin = performance.now(), job = propPlacementBatches(w); let next, batches = 0, maxMs = 0;
  do { const start = performance.now(); next = job.next(); maxMs = Math.max(maxMs, performance.now() - start); batches++; } while (!next.done);
  const elapsed = performance.now() - begin;
  assert(batches >= Math.floor(2800 / PROPS.batch)); assert.deepEqual(next.value.items, prepareProps(w).items);
  assert.equal(propFade(190, 220), 1); assert.equal(propFade(205, 220), .5); assert.equal(propFade(220, 220), 0);
  assert.equal(propRange('smoke'), 350); assert.equal(propRange('boat'), 400); assert.equal(propRange('yard', 'standard', 2), 132);
  t.diagnostic(`synthetic 2800 houses: ${elapsed.toFixed(2)}ms total, ${maxMs.toFixed(2)}ms largest batch, ${batches} batches (timings informational)`);
});

test('private terrain/catalogs: placement does not throw or enter prohibited ground (no private counts/coordinates logged)', async t => {
  const dir = process.env.KZ_WORLD_DIR; if (!dir) return t.skip('KZ_WORLD_DIR未設定');
  const { data } = await readPrivateData(dir), terrain = createKamakuraTerrain(data), privateHouses = await readPrivateHouses(dir, data), { houses, bodies } = privateHouses;
  const input = await readPrivateFacilities(dir, data); data.facilities = input.facilities;
  const facilities = { records: input.facilities.nodes.map(node => ({ node, bounds: facilityFootprint(node, input.positions.get(node.node), false) })) };
  const boxes = houses.instances.map(h => houseBox(houses.kinds.get(h.kind), houseMatrix(h, terrain, bodies.get(h.kind)), bodies.get(h.kind)));
  const habitat = createHabitat({ terrain, meta: data.meta, surface: data.surface, housePoints: boxes });
  const r = prepareProps({ data, terrain, facilities, houses: { boxes }, habitat });
  for (const p of r.items) assert.equal(r.site.reason(p), null, 'Private placement violates a ground rule (values withheld)');
  // Browser finding: solid ring boxes once left every temple without a lantern. Only presence is asserted, never a count.
  for (const k of ['lantern', 'gorinto', 'nobori']) assert(r.placed[k] > 0, `private world has no ${k} (counts withheld)`);
});
