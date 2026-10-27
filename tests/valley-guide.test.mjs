import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBaseline, buildRecovery, assess, directions, roadDistance } from '../dist/valley/guide.js';

// 合成の九十九折。仕様の境界以外の数値は、この試験だけの設計値。
const nav = { bounds: { minX: -100, minZ: -100, maxX: 200, maxZ: 200 }, walkable: () => true, cell: 0.5 };
function baseline(points = [{ x: 0, z: 0 }, { x: 100, z: 0 }], id = 'test') {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  return { id, points, cumulative, length: cumulative.at(-1), objectiveId: 'b2_road', plan: 'front' };
}
function sample(b, state = null, values = {}) {
  return assess(b, state, { t: 0, pos: b.points[0], mode: 'free', objectiveId: b.objectiveId, plan: b.plan, baselineId: b.id, ...values });
}
function world(road) {
  return { zones: { viewpoint: { x: 0, z: 20 } }, roads: {
    temple: { halfWidth: 2, points: [[-10, 0], [0, 0]] }, forest: road }, spawns: {} };
}
const switchbacks = { halfWidth: 1, points: [[0, 0], [30, 0], [30, 10], [0, 10], [0, 20]] };

test('switchback direction uses the next turn when direct bearing differs by at least 30 degrees', () => {
  const b = baseline(switchbacks.points.map(([x, z]) => ({ x, z })));
  const a = sample(b);
  assert.equal(a.directions.angleDeg, 90);
  assert.deepEqual(a.direction, { x: 1, z: 0 });
  const angle = Math.PI / 6;
  const c = baseline([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: Math.cos(angle) * 10, z: Math.sin(angle) * 10 }]);
  assert.deepEqual(directions(c, c.points[0]).direction, { x: 1, z: 0 });
});

test('baseline preserves every mandatory switchback in order and is independent of later observations', () => {
  const b = buildBaseline(world(switchbacks), nav, { objectiveId: 'b2_road', from: { x: -5, z: 0 } });
  assert(b);
  const forest = b.mandatory.filter(p => p.road === 'forest');
  assert.deepEqual(forest.map(p => p.index), [0, 1, 2, 3, 4]);
  for (const p of forest) assert.deepEqual(b.points[p.pathIndex], p.point);
  assert(b.length >= 85);
  const saved = structuredClone(b);
  sample(b, null, { pos: { x: 50, z: 50 } });
  assert.deepEqual(b, saved);
});

test('a wall across the road band returns null rather than taking a detour outside the road', () => {
  const w = world({ halfWidth: 1, points: [[0, 0], [30, 0], [30, 20], [0, 20]] });
  const blocked = { ...nav, walkable: (x, z) => !(x > 14 && x < 16 && z < 5 && z > -5) };
  assert.equal(buildBaseline(w, blocked, { objectiveId: 'b2_road', from: { x: -5, z: 0 } }), null);
});

test('blocked mandatory point is corrected within its band and correction distance is recorded', () => {
  const w = world(switchbacks);
  const b = buildBaseline(w, { ...nav, walkable: (x, z) => Math.hypot(x - 30, z) > 0.6 }, { objectiveId: 'b2_road', from: { x: -5, z: 0 } });
  assert(b);
  const c = b.corrections.find(p => p.road === 'forest' && p.index === 1);
  assert(c && c.meters > 0);
  assert.equal(c.meters, Math.hypot(c.corrected.x - c.original.x, c.corrected.z - c.original.z));
  assert(roadDistance(switchbacks, c.corrected) <= 1.3);
});

test('off-road boundary is exact: 24.9m is on road, 25m is off road', () => {
  assert.equal(sample(baseline(), null, { pos: { x: 10, z: 24.9 } }).offRoad, false);
  const a = sample(baseline(), null, { pos: { x: 10, z: 25 } });
  assert.equal(a.offRoad, true); assert.equal(a.emphasized, true);
});

test('stall needs 30 free seconds and uses strictly less than 10m progress', () => {
  const b = baseline();
  const a = sample(b);
  assert.equal(sample(b, a.state, { t: 29.99 }).stalled, false);
  assert.equal(sample(b, a.state, { t: 30, pos: { x: 9.99, z: 0 } }).stalled, true);
  const ten = sample(b, a.state, { t: 30, pos: { x: 10, z: 0 } });
  assert.equal(ten.progress30, 10); assert.equal(ten.stalled, false);
});

test('rolling 30s window interpolates irregular samples instead of counting total progress', () => {
  const b = baseline(); let a = sample(b);
  a = sample(b, a.state, { t: 20, pos: { x: 20, z: 0 } });
  a = sample(b, a.state, { t: 40, pos: { x: 20, z: 0 } });
  assert.equal(a.progress30, 10); assert.equal(a.stalled, false);
  a = sample(b, a.state, { t: 41, pos: { x: 20, z: 0 } });
  assert.equal(a.progress30, 9); assert.equal(a.stalled, true);
});

for (const mode of ['combat', 'dialogue', 'paused']) test(`${mode} clears samples and stops clock; free restarts its 30s window`, () => {
  const b = baseline(); let a = sample(b);
  a = sample(b, a.state, { t: 20 });
  const clock = a.state.clock;
  a = sample(b, a.state, { t: 25, mode });
  assert.deepEqual(a.state.history, []); assert.equal(a.state.clock, clock); assert.equal(a.emphasized, false);
  a = sample(b, a.state, { t: 90, mode }); assert.equal(a.state.clock, clock);
  a = sample(b, a.state, { t: 100 }); assert.equal(a.state.clock, clock);
  a = sample(b, a.state, { t: 129.99 }); assert.equal(a.stalled, false);
  a = sample(b, a.state, { t: 130 }); assert.equal(a.stalled, true);
});

for (const change of ['objective', 'plan', 'baseline', 'clock', 'result']) test(`${change} clears history and emphasis`, () => {
  let b = baseline(), a = sample(b);
  a = sample(b, a.state, { t: 30 }); assert(a.emphasized);
  b = structuredClone(b);
  let values = { t: 31 };
  if (change === 'objective') b.objectiveId = 'b3_viewpoint';
  if (change === 'plan') b.plan = 'north';
  if (change === 'baseline') b.id = 'restart';
  if (change === 'clock') values.t = 0;
  if (change === 'result') values.mode = 'result';
  a = sample(b, a.state, values);
  assert.equal(a.emphasized, false); assert.equal(a.state.emphasized, false); assert.equal(a.stalled, false);
  assert.equal(a.state.history.length, change === 'result' ? 0 : 1);
});

test('emphasis releases only below 20m AND with at least 10m recent progress; history survives emphasis', () => {
  const b = baseline(); let a = sample(b, null, { pos: { x: 0, z: 25 } });
  assert(a.emphasized);
  assert(sample(b, a.state, { t: 30, pos: { x: 10, z: 20 } }).emphasized);
  assert(sample(b, a.state, { t: 30, pos: { x: 9.9, z: 19.9 } }).emphasized);
  assert(sample(b, a.state, { t: 29, pos: { x: 10, z: 0 } }).emphasized);
  a = sample(b, a.state, { t: 30, pos: { x: 10, z: 19.9 } });
  assert.equal(a.emphasized, false); assert.equal(a.state.history.length, 2);
});

test('projection at a crossing stays on the previous or adjacent segment, not a remote crossing', () => {
  const b = baseline([{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 20 }, { x: 0, z: 20 }, { x: 0, z: -20 }]);
  let a = sample(b, null, { pos: { x: 5, z: 0 } });
  a = sample(b, a.state, { t: 1, pos: { x: 0, z: -0.1 } });
  assert.equal(a.state.segment, 0); assert.equal(a.remaining, b.length);
});

test('recovery joins nearest unpassed segment, continues baseline, and cannot affect off-road or progress', () => {
  const b = baseline([{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 0 }]);
  const pos = { x: 10, z: 30 }, original = structuredClone(b);
  const r = buildRecovery(b, nav, { pos, progress: 60 });
  assert(r); assert.equal(r.progress, 60); assert.deepEqual(r.join, { x: 60, z: 0 });
  assert.deepEqual(r.points[0], pos); assert.deepEqual(r.points.at(-1), b.points.at(-1));
  const a = sample(b, null, { pos }); assert(a.offRoad); assert.equal(a.remaining, 90);
  assert.deepEqual(b, original);
  assert.equal(buildRecovery(b, { ...nav, walkable: () => false }, { pos }), null);
});

test('all public state survives JSON round trip; inputs remain unchanged; no objective returns null', () => {
  const b = baseline(), a = sample(b), before = structuredClone(a.state);
  const restored = JSON.parse(JSON.stringify(a.state));
  assert.deepEqual(sample(b, restored, { t: 30 }), sample(b, a.state, { t: 30 }));
  assert.deepEqual(a.state, before);
  assert.equal(sample(b, null, { objectiveId: null }), null);
  assert.equal(buildBaseline(world(switchbacks), nav, { objectiveId: 'done', from: { x: 0, z: 0 } }), null);
  assert.equal(buildBaseline(world(switchbacks), nav, { objectiveId: 'b7_result', from: { x: 0, z: 0 } }), null);
});

test('NaN, Infinity, overflow, invalid times/modes/plans and corrupt state are rejected', () => {
  const b = baseline();
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.throws(() => sample(b, null, { t: bad }), TypeError);
    assert.throws(() => sample(b, null, { pos: { x: bad, z: 0 } }), TypeError);
    assert.throws(() => buildRecovery(b, nav, { pos: { x: 0, z: 0 }, progress: bad }), TypeError);
    assert.throws(() => buildBaseline(world(switchbacks), nav, { objectiveId: 'b2_road', from: { x: bad, z: 0 } }), TypeError);
    assert.throws(() => sample(b, { history: [{ t: bad }] }), TypeError);
  }
  assert.throws(() => sample(b, null, { mode: 'unknown' }), TypeError);
  assert.throws(() => sample(b, null, { t: -1 }), TypeError);
  assert.throws(() => sample(b, null, { baselineId: 'wrong' }), TypeError);
  assert.throws(() => buildBaseline(world(switchbacks), nav, { objectiveId: 'b2_road', plan: 'flank', from: { x: 0, z: 0 } }), TypeError);
  assert.throws(() => sample(baseline([{ x: -Number.MAX_VALUE, z: 0 }, { x: Number.MAX_VALUE, z: 0 }])), TypeError);
});

test('passed progress does not retreat when the player walks backwards; remaining still measures the current projection', () => {
  const b = baseline();
  let a = sample(b, null, { pos: { x: 50, z: 0 } });
  a = sample(b, a.state, { t: 1, pos: { x: 40, z: 0 } });
  assert.equal(a.remaining, 60); assert.equal(a.state.progress, 50);
});
