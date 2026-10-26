import test from 'node:test';
import assert from 'node:assert/strict';
import { buildColliders, moveActor, pushOut, segmentBlocked, rayClip, nearestFree } from '../dist/valley/collision.js';
import { WORLD } from '../dist/valley/world-data.js';
import { insideFootprint } from '../dist/valley/scatter.js';
import { createTerrain } from '../dist/valley/terrain-height.js';

const bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
const flat = (overrides = {}) => ({ bounds, heightAt: () => 0, slopeAt: () => 0, waterAt: () => 0, walkable: () => true, ...overrides });
const colliders = (overrides = {}) => buildColliders({ bounds, ...overrides });
const pos = (x, z, y = 0) => ({ x, y, z });
const house = (rotY = 0) => ({ id: 'house', x: 0, z: 0, rotY, footprint: { w: 2, d: 4 } });
const circleWorld = () => colliders({ extraCircles: [{ x: 0, z: 0, r: 1 }] });
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

test('circle: frontal movement stops without penetration or mutating input', () => {
  const p = Object.freeze(pos(-2, 0)), c = circleWorld();
  const out = moveActor(c, flat(), p, 3, 0);
  near(out.x, -1.3); near(out.z, 0);
  assert.equal(out.blocked, 'wall'); assert.equal(out.slid, false);
  assert.deepEqual(p, pos(-2, 0));
});
test('circle: diagonal movement slides along the normal', () => {
  const out = moveActor(circleWorld(), flat(), pos(-2, -0.4), 1.5, 1);
  assert.equal(out.blocked, 'wall'); assert.equal(out.slid, true);
  assert.ok(Math.hypot(out.x, out.z) >= 1.3 - 1e-7);
  assert.ok(out.z > 0.6);
});
test('rotated box: corner remains outside the footprint and permits sliding', () => {
  const b = house(Math.PI / 4), c = colliders({ buildings: [b] });
  let p = pos(-3, -1.5), slid = false;
  for (let i = 0; i < 160; i++) {
    p = moveActor(c, flat(), p, 0.1, 0.07); slid ||= p.slid;
    assert.equal(insideFootprint(b, p.x, p.z), false);
    assert.deepEqual(pushOut(c, flat(), p), { x: p.x, y: p.y, z: p.z });
  }
  assert.equal(slid, true); assert.ok(p.z > 0);
});
test('3m movement cannot tunnel through a thin wall', () => {
  const c = colliders({ extraBoxes: [{ x: 0, z: 0, rotY: 0, w: 0.02, d: 10 }] });
  const out = moveActor(c, flat(), pos(-1, 0), 3, 0);
  assert.ok(out.x <= -0.31 + 1e-7); assert.equal(out.blocked, 'wall');
});
test('water stops only the blocked axis and allows exactly 0.45m', () => {
  const t = flat({ waterAt: x => x > 0 ? 0.46 : 0.45 });
  const out = moveActor(colliders(), t, pos(-0.2, 0), 1, 1);
  assert.ok(out.x <= 0); near(out.z, 1);
  assert.equal(out.blocked, 'water'); assert.equal(out.slid, true);
});
test('slope threshold defaults to 42 degrees and can be overridden', () => {
  const t = flat({ slopeAt: x => x > 0 ? 43 : 0 }), c = colliders();
  assert.equal(moveActor(c, t, pos(-0.1, 0), 0.5, 0).blocked, 'slope');
  near(moveActor(c, t, pos(-0.1, 0), 0.5, 0, 0.3, { maxSlope: 43 }).x, 0.4);
});
test('steps block uphill only, obey maxStep, and follow the ground', () => {
  const t = flat({ heightAt: x => x >= 0 ? 0.6 : 0 }), c = colliders();
  const up = moveActor(c, t, pos(-0.1, 0), 0.4, 0);
  assert.ok(up.x < 0); assert.equal(up.blocked, 'step'); near(up.y, 0);
  const down = moveActor(c, t, pos(0.1, 0, 0.6), -0.4, 0);
  near(down.x, -0.3); near(down.y, 0); assert.equal(down.blocked, null);
  near(moveActor(c, t, pos(-0.1, 0), 0.4, 0, 0.3, { maxStep: 0.6 }).y, 0.6);
  const ramp = flat({ heightAt: (x, z) => x * 0.2 + z * 0.1 });
  near(moveActor(c, ramp, pos(1, 2), 0.3, 0.2).y, 0.48);
});
test('bounds contain the entire actor and honor terrain bounds too', () => {
  const c = colliders(), p = moveActor(c, flat(), pos(49.6, 0), 3, 0);
  assert.ok(p.x <= 49.7); assert.equal(p.blocked, 'bounds');
  const t = flat({ bounds: { ...bounds, maxX: 2 } });
  assert.ok(moveActor(c, t, pos(1.6, 0), 1, 0).x <= 1.7);
});
test('pushOut resolves circle centers, rotated box interiors and multiple contacts', () => {
  const worlds = [circleWorld(), colliders({ buildings: [house(Math.PI / 4)] }),
    colliders({ extraCircles: [{ x: -0.8, z: 0, r: 1 }, { x: 0.8, z: 0, r: 1 }] })];
  for (const c of worlds) {
    const p = Object.freeze(pos(0, 0)), out = pushOut(c, flat(), p);
    assert.notDeepEqual(out, p); assert.deepEqual(pushOut(c, flat(), out), out);
    assert.deepEqual(p, pos(0, 0));
  }
});
test('wall push never moves an actor into forbidden water', () => {
  const c = circleWorld(), t = flat({ waterAt: x => x < -1.35 ? 1 : 0 });
  const out = moveActor(c, t, pos(-1.35, 0), 0.2, 0);
  assert.ok(t.waterAt(out.x) <= 0.45);
});
test('segmentBlocked: open space and a sampled ridge', () => {
  const a = pos(-5, 0, 1.7), b = pos(5, 0, 1.7), c = colliders();
  assert.equal(segmentBlocked(c, flat(), a, b), false);
  assert.equal(segmentBlocked(c, flat({ heightAt: x => Math.abs(x) < 1 ? 3 : 0 }), a, b), true);
});
test('segmentBlocked: buildings, trees, props use ground-relative height caps', () => {
  const worlds = [colliders({ buildings: [house()] }), circleWorld(), colliders({ props: [{ x: 0, z: 0, r: 1 }] })];
  for (const [i, c] of worlds.entries()) {
    const cap = [6, 7, 1.2][i];
    assert.equal(segmentBlocked(c, flat(), pos(-5, 0, cap - 0.1), pos(5, 0, cap - 0.1)), true);
    assert.equal(segmentBlocked(c, flat(), pos(-5, 0, cap), pos(5, 0, cap)), false);
    assert.equal(segmentBlocked(c, flat({ heightAt: () => 20 }), pos(-5, 0, 20.5), pos(5, 0, 20.5)), true);
  }
});
test('segmentBlocked handles descending rays, rotated thin walls, vertical and zero-length segments', () => {
  const c = colliders({ buildings: [house(Math.PI / 4)] });
  assert.equal(segmentBlocked(c, flat(), pos(-5, 0, 10), pos(5, 0, 0.5)), true);
  assert.equal(segmentBlocked(c, flat(), pos(0, 0, 8), pos(0, 0, 1)), true);
  assert.equal(segmentBlocked(c, flat(), pos(0, 0, 1), pos(0, 0, 1)), true);
  assert.equal(segmentBlocked(c, flat(), pos(10, 10, 1), pos(10, 10, 1)), false);
});
test('rayClip: stops radius plus margin before buildings and circles', () => {
  for (const c of [colliders({ buildings: [house()] }), circleWorld()]) {
    const t = rayClip(c, flat(), pos(-5, 0, 1), pos(5, 0, 1));
    near(t, 0.345); assert.ok(-5 + 10 * t < -1.25);
  }
});
test('rayClip: ground intersection, buried start, free ray and zero length', () => {
  const c = colliders(), t = flat();
  const fraction = rayClip(c, t, pos(0, 0, 2), pos(10, 0, -2));
  near(fraction, 0.4075, 1e-5); assert.ok(2 - fraction * 4 >= 0.25);
  assert.equal(rayClip(c, t, pos(0, 0, 0), pos(2, 0, 1)), 0);
  assert.equal(rayClip(c, t, pos(0, 0, 2), pos(10, 0, 2)), 1);
  assert.equal(rayClip(c, t, pos(0, 0, 2), pos(0, 0, 2)), 1);
});
test('nearestFree: identity, rings avoid obstacle and water, bounded failure', () => {
  const c = circleWorld();
  assert.deepEqual(nearestFree(c, flat(), 4, 4), { x: 4, z: 4 });
  const p = nearestFree(c, flat({ waterAt: x => x > 0 ? 1 : 0 }), 0, 0);
  assert.ok(p.x <= 0 && Math.hypot(p.x, p.z) >= 1.3);
  assert.ok(Math.hypot(p.x, p.z) <= 1.4 + 1e-7);
  assert.equal(nearestFree(c, flat(), 0, 0, 0.3, 1), null);
  assert.equal(nearestFree(c, flat({ walkable: () => false }), 4, 4), null);
});
test('trees are filtered by center bounds, with species-specific trunk radii', () => {
  const c = colliders({ trees: { x: [0, 1, 2, 51, -50], z: [0, 0, 0, 0, 0], s: [1, 2, 3, 1, 1], kind: [0, 1, 2, 1, 0] } });
  assert.equal(c.circles.length, 4);
  assert.deepEqual(c.circles.map(o => o.r), [0.32, 0.84, 0.96, 0.32]);
  assert.ok(c.grid instanceof Map);
});
test('world data and createTerrain integrate without changing their input', () => {
  const before = JSON.stringify(WORLD), t = createTerrain(WORLD);
  const c = buildColliders({ buildings: WORLD.buildings, props: WORLD.props, bounds: WORLD.bounds });
  assert.equal(c.boxes.length, WORLD.buildings.length);
  const out = moveActor(c, t, pos(WORLD.start.x, WORLD.start.z), 0.1, 0);
  assert.ok([out.x, out.y, out.z].every(Number.isFinite));
  near(out.y, t.heightAt(out.x, out.z)); assert.equal(JSON.stringify(WORLD), before);
});
test('invalid numbers are rejected rather than emitting NaN or Infinity', () => {
  const c = colliders();
  assert.throws(() => moveActor(c, flat(), pos(0, 0), Infinity, 0), RangeError);
  assert.throws(() => pushOut(c, flat(), pos(NaN, 0)), RangeError);
  assert.throws(() => rayClip(c, flat(), pos(0, 0), pos(1, 1), -1), RangeError);
  assert.throws(() => nearestFree(c, flat(), 0, 0, 0.3, NaN), RangeError);
});
test('10,000 moves use local hash cells with thousands of trees', t => {
  const trees = { x: [], z: [], s: [], kind: [] };
  for (let x = -400; x <= 400; x += 8) for (let z = -400; z <= 400; z += 8) {
    trees.x.push(x); trees.z.push(z); trees.s.push(1); trees.kind.push(0);
  }
  const large = { minX: -500, maxX: 500, minZ: -500, maxZ: 500 };
  const c = buildColliders({ bounds: large, trees }), terrain = flat({ bounds: large });
  // 遠方の幹を読む実装に戻ると、時間の揺れによらず失敗する。
  for (const o of c.circles) if (Math.abs(o.x) > 16 || Math.abs(o.z) > 16) {
    Object.defineProperty(o, 'r', { get() { throw new Error('Scanned a distant tree'); } });
  }
  const p = pos(3, 3);
  for (let i = 0; i < 1000; i++) moveActor(c, terrain, p, 0.1, 0);
  const start = process.hrtime.bigint();
  for (let i = 0; i < 10000; i++) moveActor(c, terrain, p, 0.1, 0);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  t.diagnostic(`10,201 trees / 10,000 moves: ${ms.toFixed(2)}ms, ${(ms / 10).toFixed(2)}us/move`);
  assert.ok(ms < 1500, `Excessive movement cost: ${ms}ms`);
});
