// M1（走り・歩きの滑らかさ）：速さの表・時間で決める加速と減速・旋回の純粋層（dist/valley/loco.js）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCO_TABLES, GAITS_SMOOTH, ACCEL, TURN, parseLoco, dependents, gaitsFor, turnRate, turnTargetScale, speedStep, simulateRamp } from '../dist/valley/loco.js';
import { GAITS, pickGait } from '../dist/valley/anim-data.js';

test('tables: default a, candidates b/c, custom walk/sprint, and old/off turn everything back', () => {
  const d = parseLoco('');
  assert.deepEqual([d.name, d.walk, d.sprint, d.crouch, d.guard, d.smoothSpeed, d.smoothAccel], ['a', 3, 5, 1.3, 1.5, true, true]);
  assert.deepEqual([parseLoco('?loco=b').walk, parseLoco('?loco=b').sprint, parseLoco('?loco=c').walk, parseLoco('?loco=c').sprint], [2.8, 4.5, 3.2, 5.5]);
  const custom = parseLoco('?qa=1&loco=b&walk=3.3&sprint=5.8');
  assert.deepEqual([custom.name, custom.walk, custom.sprint], ['b*', 3.3, 5.8]);
  assert.equal(parseLoco('?walk=99').walk, 3, 'out-of-range walk is ignored');
  assert.equal(parseLoco('?walk=4&sprint=3').sprint, 4, 'sprint never below walk');
  for (const q of ['?loco=old', '?smooth=off', '?loco=old&walk=4']) {
    const c = parseLoco(q); assert.deepEqual([c.name, c.walk, c.sprint, c.smoothSpeed, c.smoothAccel], ['old', 2.5, 5, false, false], q);
  }
  assert.deepEqual([parseLoco('?smooth=speed').name, parseLoco('?smooth=speed').smoothAccel], ['old', true]);
  assert.deepEqual([parseLoco('?smooth=accel').name, parseLoco('?smooth=accel').smoothAccel], ['a', false]);
  assert.equal(parseLoco('?loco=zzz').unknownLoco, 'zzz');
  assert.equal(LOCO_TABLES.old.walk, 2.5);
});

test('dependents: old values exactly; new tables keep ally/enemy relative to the hero, dash and dodge are not here', () => {
  assert.deepEqual({ ...dependents(parseLoco('?loco=old')) }, { ally: 2.0, allyCatchUp: 1.6, allyStep: 2.1, run: 3.6, officerRun: 3.2 });
  for (const q of ['', '?loco=b', '?loco=c', '?loco=c&walk=4&sprint=7']) {
    const c = parseLoco(q), d = dependents(c);
    assert(d.ally * (1 + d.allyCatchUp) >= 1.04 * c.sprint - 1e-9, q);
    assert(d.run >= c.walk && d.officerRun >= c.walk, q);
    assert(Math.abs(d.ally / c.walk - 0.8) < 1e-9, q);
  }
});

test('gait borders: new table only with the new speeds; ranges follow the clip speeds (walk 3.0 plays Run)', () => {
  assert.equal(gaitsFor(parseLoco('?loco=old'), GAITS), GAITS);
  assert.equal(gaitsFor(parseLoco(''), GAITS), GAITS_SMOOTH);
  assert.equal(pickGait('walk', 3.0, GAITS_SMOOTH), 'run');
  assert.equal(pickGait('walk', 2.5, GAITS), 'jog');
  assert.equal(pickGait('run', 2.5, GAITS_SMOOTH), 'run', 'hysteresis keeps run above runDown');
  assert.equal(pickGait('run', 2.3, GAITS_SMOOTH), 'jog');
  assert.equal(pickGait('walk', 1.5, GAITS_SMOOTH), 'walk');
  assert.equal(pickGait('jog', 1.5, GAITS_SMOOTH), 'jog');
});

test('speed curve: smooth start and end, about 0.22 s up and 0.18 s down to 95%, never negative, stops exactly', () => {
  const up = simulateRamp(0, 5, 600), down = simulateRamp(5, 0, 600);
  assert(Math.abs(up.reach - ACCEL.up) < 0.01, `up ${up.reach}`);
  assert(Math.abs(down.reach - ACCEL.down) < 0.01, `down ${down.reach}`);
  // 始まりの加速度は0（跳ばない）：最初の1コマの速さの変化は、途中の最大の半分未満（直線の加速なら同じ大きさになる）
  const st = { v: 0, a: 0 }, dv = [];
  for (let i = 0; i < 30; i++) { const before = st.v; speedStep(st, 5, 1 / 60); dv.push(st.v - before); }
  assert(dv[0] < 0.5 * Math.max(...dv) && Math.max(...dv) < 1.0, `per-frame steps ${dv.slice(0, 5)}`);
  const s2 = { v: 5, a: 0 }; let n = 0; while (s2.v > 0 && n < 1000) { speedStep(s2, 0, 1 / 60); assert(s2.v >= 0); n++; }
  assert(n < 30, 'reaches exactly zero');
  assert.equal(speedStep({ v: 1, a: 0 }, 0, 0), 0);
});

test('frame rate: stop and start distance and time agree at 30, 60 and 144 Hz', () => {
  for (const [from, to] of [[5, 0], [3, 0], [0, 5], [0, 3], [1.3, 0]]) {
    const r = [30, 60, 144].map(hz => simulateRamp(from, to, hz, to ? 0.6 : 2));
    for (const x of r) {
      assert(Math.abs(x.dist - r[1].dist) <= 0.01 * r[1].dist + 0.002, `${from}->${to}: ${r.map(y => y.dist)}`);
      assert(Math.abs(x.t - r[1].t) <= 1 / 30 + 1e-9, `${from}->${to}: ${r.map(y => y.t)}`);
    }
  }
  const stop = simulateRamp(5, 0, 60);
  assert(stop.dist > 0.3 && stop.dist < 0.5, `sprint glides ${stop.dist}`);
  assert(simulateRamp(3, 0, 60).dist > 0.15, 'walk glides');
});

test('retargeting mid-ramp keeps speed continuous (Shift released at half speed, sharp turn halves the target)', () => {
  const st = { v: 0, a: 0 }; let prev = 0, max = 0;
  for (let i = 0; i < 120; i++) { const target = i < 10 ? 5 : i < 40 ? 3 : i < 60 ? 0.6 : 5; speedStep(st, target, 1 / 60); max = Math.max(max, Math.abs(st.v - prev)); prev = st.v; }
  assert(max < 0.9, `max per-frame change ${max}`);
});

test('turning: 14 rad/s slow, 7 at sprint, guard 6; sharp turns lower the target, reversing keeps 20% (skid)', () => {
  const c = parseLoco('');
  assert.equal(turnRate(0, c), TURN.slow);
  assert.equal(turnRate(c.sprint, c), TURN.fast);
  assert(turnRate(3, c) < TURN.slow && turnRate(3, c) > TURN.fast);
  assert.equal(turnRate(5, c, true), TURN.guard);
  assert.equal(turnTargetScale(0.3), 1);
  assert.equal(turnTargetScale(Math.PI), TURN.skidScale);
  assert.equal(turnTargetScale(-Math.PI), TURN.skidScale);
  const mid = turnTargetScale(1.6); assert(mid > TURN.skidScale && mid < 1);
  for (let a = 0; a < Math.PI; a += 0.1) assert(turnTargetScale(a + 0.1) <= turnTargetScale(a) + 1e-12, 'monotonic');
});
