import test from 'node:test';
import assert from 'node:assert/strict';
import { FAUNA, FAUNA_GLSL, faunaAmounts, kiteCell, kitePosition, crowWindow, crowCrossing, crowSpan, crowPosition, flockCell, flockAllowed, createFlockState,
  resetFlock, updateFlock, flockBirdPosition, insectSeed, insectPosition } from '../dist/valley/kamakura-fauna.js';

const terrain = { waterAt: () => 0, slopeAt: () => 0, walkable: () => true };
const hero = (x, z = 0, speed = 0) => ({ pos: { x, z }, speed });
const grounded = () => resetFlock(createFlockState(), { ix: 0, iz: 0, x: 0, z: 0, count: 7, roll: .1, phase: 1 }, 0);

test('coordinate keyed cells are deterministic, distinct, bounded and reuse output', () => {
  for (const make of [kiteCell, flockCell]) for (let x = -8; x < 8; x++) for (let z = -8; z < 8; z++) {
    const out = {}, a = make(x, z), b = make(x, z);
    assert.deepEqual(a, b); assert.notDeepEqual(a, make(x + 1, z)); assert.equal(make(x, z, out), out);
    const width = make === kiteCell ? FAUNA.kiteCell : FAUNA.flockCell;
    assert(a.x >= x * width && a.x < (x + 1) * width && a.z >= z * width && a.z < (z + 1) * width);
    if (make === flockCell) assert(a.count >= FAUNA.flockBirds - 5 && a.count <= FAUNA.flockBirds);
    else {
      // Low and near enough to enter a level camera's frame, at a soaring kite's air speed whatever the size of the circle.
      assert(a.height >= FAUNA.kiteLow && a.height <= FAUNA.kiteHigh && a.radius >= FAUNA.kiteNear && a.radius <= FAUNA.kiteFar);
      const speed = 2 * Math.PI * a.radius / a.period;
      assert(speed >= FAUNA.kiteSlow - 1e-9 && speed <= FAUNA.kiteFast + 1e-9);
    }
  }
});

test('habitat/time table excludes forest kites, sand/water/steep/unwalkable flocks and evening butterflies', () => {
  assert.equal(faunaAmounts({ forest: 1, town: 1, shore: 1 }, 'noon').kites, 0);
  assert(faunaAmounts({ shore: 1 }, 'noon').kites > 0);
  for (const h of [{ sand: 1, meadow: 1 }, { forest: 1, town: 1 }]) assert.equal(faunaAmounts(h, 'noon').flocks, 0);
  assert.equal(faunaAmounts({ meadow: 1, temple: 1 }, 'evening').butterflies, 0);
  assert.equal(faunaAmounts({ river: 1 }, 'morning').dragonflies, 0);
  assert.equal(faunaAmounts({ meadow: 1 }, 'noon').dragonflies, 0);
  assert.equal(faunaAmounts({ river: 1 }, 'evening').dragonflies, FAUNA.dragonflies);
  assert(faunaAmounts({ shore: 1 }, 'noon').kites > faunaAmounts({ town: 1 }, 'noon').kites);   // the beach is where the kites gather
  assert(faunaAmounts({ forest: 1 }, 'noon').crows > 0 && faunaAmounts({ forest: 1 }, 'noon').crows < faunaAmounts({}, 'noon').crows);
  const c = flockCell(0, 0);
  assert(flockAllowed(c, { meadow: 1 }, terrain));
  for (const t of [{ ...terrain, waterAt: () => .4 }, { ...terrain, slopeAt: () => 28 }, { ...terrain, walkable: () => false }]) assert(!flockAllowed(c, { meadow: 1 }, t));
  assert(!flockAllowed(c, { sand: 1 }, terrain)); assert(!flockAllowed(c, { forest: 1 }, terrain));
  const out = {}; assert.equal(faunaAmounts({}, 'noon', out), out);
});

test('kite orbits keep altitude/radius bounds and continuous 60Hz motion over long times', t => {
  let maxStep = 0;
  const a = {}, b = {}, dir = [.6, .8];
  for (let i = 0; i < 50; i++) {
    const s = kiteCell(i - 25, i * 3);
    for (let n = 0; n < 500; n++) {
      const time = n * 13.73;
      assert.equal(kitePosition(s, time, dir, a), a); kitePosition(s, time + 1 / 60, dir, b);
      assert(a.y >= FAUNA.kiteLow - 2.5 && a.y <= FAUNA.kiteHigh + 2.5);
      assert(a.bank <= -.14 && a.bank >= -.26);   // leaning into the circle, so the wings show their face
      assert(Math.abs(Math.hypot(a.x - a.centerX, a.z - a.centerZ) - s.radius) < 1e-9);
      maxStep = Math.max(maxStep, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
  }
  assert(maxStep < (FAUNA.kiteFast + 1) / 60); t.diagnostic(JSON.stringify({ maxKiteStepMetres: maxStep }));
});

test('crow crossings belong to a cell and a time window, run continuously inside it and are hidden at both ends', t => {
  const a = {}, b = {}; let maxStep = 0, groups = 0;
  for (let ix = -6; ix < 6; ix++) for (let iz = -6; iz < 6; iz++) for (const time of [0, 7.3, 500.4, 86400.2]) {
    const window = crowWindow(ix, iz, time), c = crowCrossing(ix, iz, window), again = crowCrossing(ix, iz, window);
    assert.deepEqual(c, again); assert.notDeepEqual(c, crowCrossing(ix, iz, window + 1));
    assert(time >= c.start - 1e-6 && time < c.start + FAUNA.crowWindow + 1e-6);          // the window that holds this time
    assert.equal(crowWindow(ix, iz, c.start + FAUNA.crowWindow / 2), window);
    assert(c.x >= ix * FAUNA.crowCell && c.x < (ix + 1) * FAUNA.crowCell && c.z >= iz * FAUNA.crowCell && c.z < (iz + 1) * FAUNA.crowCell);
    assert(c.count >= 2 && c.count <= FAUNA.crowBirds && c.height >= FAUNA.crowLow && c.height <= FAUNA.crowHigh);
    assert(c.speed >= FAUNA.crowSlow && c.speed <= FAUNA.crowFast && Math.abs(Math.hypot(c.dx, c.dz) - 1) < 1e-9);
    groups++;
    for (let i = 0; i < c.count; i++) {
      assert.equal(crowPosition(c, i, c.start, a).fade, 0); assert(crowPosition(c, i, c.start + FAUNA.crowWindow - 1e-6, a).fade < 1e-6);
      assert.equal(crowPosition(c, i, c.start + FAUNA.crowWindow / 2, a), a); assert.equal(a.fade, 1); assert.equal(a.flap, 1);
      assert(Math.hypot(a.x - c.x, a.z - c.z) < 12);                                      // mid-way, the group is over its cell point
      assert(Math.abs(a.y - c.height) <= .7 + 1e-9);
      for (let n = 0; n < 40; n++) {
        const at = c.start + (n + .5) / 40 * FAUNA.crowWindow;
        crowPosition(c, i, at, a); crowPosition(c, i, at + 1 / 60, b);
        maxStep = Math.max(maxStep, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
        assert(Math.hypot(a.x - c.x, a.z - c.z) <= crowSpan(c) + 12);
        // Heading follows the course: the nose (-z of the model) points along (dx, dz).
        assert(Math.abs(-Math.sin(a.yaw) - c.dx) < 1e-9 && Math.abs(-Math.cos(a.yaw) - c.dz) < 1e-9);
      }
    }
  }
  assert(maxStep < (FAUNA.crowFast + 2) / 60 && groups === 576);
  t.diagnostic(JSON.stringify({ maxCrowStepMetres: maxStep }));
});

test('walking/running trigger is inclusive, never fires from flying camera, and sends one bounded event', () => {
  for (const [x, speed, flying, triggers] of [[7, 0, false, true], [7.01, 0, false, false], [10, 3, false, true], [10.01, 3, false, false], [3, 5, true, false]]) {
    const s = grounded(), events = [];
    assert.equal(updateFlock(s, hero(x, 0, speed), 10, flying, false, events), triggers);
    assert.equal(events.length, triggers ? 1 : 0);
    if (triggers) { assert.equal(s.mode, 1); assert.equal(s.dx, -1); assert.equal(events[0].type, 'flockBurst'); }
    for (let n = 0; n < 500; n++) updateFlock(s, hero(x, 0, speed), 10 + n / 60, flying, false, events);
    assert.equal(events.length, triggers ? 1 : 0);
  }
  const events = Array.from({ length: 16 }, (_, id) => ({ id })), old = events[0], s = grounded();
  updateFlock(s, hero(5), 0, false, false, events);
  assert.equal(events.length, 16); assert(!events.includes(old)); assert.equal(events.at(-1), s.event);
  // Reuse a state slot while the consumer leaves its queue undrained: old coordinates stay intact.
  for (let n = 1; n <= 20; n++) {
    const older = events.at(-1), oldX = older.x;
    resetFlock(s, { ix: n, iz: 0, x: n * 100, z: 0, count: 3, phase: 0, roll: 0 }, 0);
    updateFlock(s, hero(n * 100), n, false, false, events);
    assert.equal(older.x, oldX); assert.equal(new Set(events).size, events.length); assert.equal(events.length, 16);
  }
});

test('a disturbed flock returns only after a continuous 30m/40s absence; returning near resets the timer', () => {
  const s = grounded(), events = [];
  updateFlock(s, hero(0), 0, false, false, events);
  updateFlock(s, hero(29.99), 100, false, false, events); assert.equal(s.mode, 2);
  updateFlock(s, hero(30), 101, false, false, events); assert.equal(s.awaySince, 101);
  updateFlock(s, hero(30), 140.99, false, false, events); assert.equal(s.mode, 2);
  updateFlock(s, hero(0), 141, false, false, events); assert.equal(s.awaySince, -1);
  updateFlock(s, hero(40), 142, false, false, events);
  updateFlock(s, hero(40), 182, false, false, events); assert.equal(s.mode, 0);
  updateFlock(s, hero(0), 183, false, false, events); assert.equal(events.length, 2);
});

test('take-off fans away from the walker, starts slowly, stays under the walking camera and fades at the end; reduced motion stays grounded', () => {
  const s = grounded(), events = [], out = {}, T = FAUNA.flightSeconds;
  updateFlock(s, hero(5), 10, false, false, events);
  const ox = Math.cos(s.phase) * .4, oz = Math.sin(s.phase) * .4;
  flockBirdPosition(s, 0, 10 + T, out);
  assert(Math.abs(Math.hypot(out.x - ox, out.z - oz) - FAUNA.flightDistance) < 1e-9);
  assert(out.y - .08 >= FAUNA.flightRise * .75 - 1e-9 && out.y - .08 <= FAUNA.flightRise * 1.25 + 1e-9);
  assert.equal(out.fade, 0);
  // First third of the flight: less than a fifth of the way, already a quarter of the height (slow, steep take-off).
  flockBirdPosition(s, 0, 10 + T / 3, out);
  assert(Math.hypot(out.x - ox, out.z - oz) < FAUNA.flightDistance * .2 && out.y > FAUNA.flightRise * .75 * .5); assert.equal(out.fade, 1);
  // Seen from a walker 8 m behind the flock at eye height 1.6 m, no bird climbs above 16 degrees after the first second.
  for (let i = 0; i < s.count; i++) for (let n = 0; n <= 40; n++) {
    const at = 10 + i / 6 * .25 + 1 + (T - 1) * n / 40; flockBirdPosition(s, i, at, out);
    assert(Math.atan2(out.y - 1.6, Math.hypot(out.x - 8, out.z)) < 16 * Math.PI / 180);
  }
  // Courses spread about the direction away from the walker (who stands at +x here), never back toward him.
  const first = flockBirdPosition(s, 0, 10 + T), last = flockBirdPosition(s, s.count - 1, 10 + T + 1);
  assert(first.x < -30 && last.x < -30 && Math.abs(first.z - last.z) > 15);
  assert(flockBirdPosition(s, 0, 10.1).flap > 0); assert.equal(flockBirdPosition(s, 6, 10.1).flap, 0);
  const quiet = grounded(); updateFlock(quiet, hero(0), 10, false, true, events);
  flockBirdPosition(quiet, 0, 10.5, out); assert.equal(out.fade, 0); assert.equal(out.flap, 0); assert(out.y < .12);
  assert.equal(events.length, 1);
});

test('insects stay in the box at ground-relative heights; world positions do not follow the viewer', () => {
  const a = {}, b = {}, dir = [1, 0]; let matched = 0;
  for (const kind of [0, 1]) for (let i = 0; i < 100; i++) for (const time of [0, 19.3, 10000]) {
    const s = insectSeed(i, kind), viewer = { x: -37, y: 900, z: 81 };
    assert.equal(insectPosition(s, time, dir, viewer, a), a);
    assert(a.x >= viewer.x - 25 && a.x < viewer.x + 25 && a.z >= viewer.z - 25 && a.z < viewer.z + 25);
    assert(a.y >= (kind === 0 ? .4 : .8) - 1e-9 && a.y <= (kind === 0 ? 1.8 : 2.5) + 1e-9);
    insectPosition(s, time, dir, { x: -36, y: 0, z: 82 }, b);
    if (a.fade > .99 && b.fade > .99) { assert.equal(a.x, b.x); assert.equal(a.z, b.z); matched++; }
  }
  assert(matched > 100);
});

test('every insect recycling jump is hidden at both sides of the box', t => {
  let jumps = 0; const a = {}, b = {}, viewer = { x: 0, z: 0 }, dir = [.6, .8];
  for (let kind = 0; kind < 2; kind++) for (let i = 0; i < 32; i++) {
    const s = insectSeed(i, kind);
    for (let n = 0; n < 2400; n++) {
      insectPosition(s, n / 60, dir, viewer, a); insectPosition(s, (n + 1) / 60, dir, viewer, b);
      if (Math.hypot(a.x - b.x, a.z - b.z) > FAUNA.box - 2) { assert.equal(a.fade, 0); assert.equal(b.fade, 0); jumps++; }
    }
  }
  assert(jumps > 10); t.diagnostic(JSON.stringify({ hiddenInsectWraps: jumps }));
});

test('dragonfly speed distribution has separate stationary and dart populations', t => {
  const s = insectSeed(0, 1), a = {}, b = {}, viewer = { x: 0, z: 0 }, dir = [1, 0];
  let stopped = 0, dart = 0, total = 0;
  for (let n = 0; n < 6000; n++) {
    insectPosition(s, n / 600, dir, viewer, a); insectPosition(s, (n + 1) / 600, dir, viewer, b);
    const speed = Math.hypot(a.x - b.x, a.z - b.z) * 600;
    if (speed > 30) continue;
    if (speed < .001) stopped++; if (speed > 3) dart++; total++;
  }
  assert(stopped > total * .6); assert(dart > total * .08);
  t.diagnostic(JSON.stringify({ stoppedFraction: stopped / total, dartFraction: dart / total }));
});

test('GLSL articulation constants originate in the same JS table, formatted as decimals', () => {
  for (const key of ['birdRate', 'birdRateRange', 'butterflyRate', 'butterflyRateRange', 'wingAmplitude', 'kiteDihedral', 'kiteStroke', 'kiteBeat', 'crowStroke', 'crowBeat']) assert(FAUNA_GLSL.includes(FAUNA[key].toFixed(6)));
});
