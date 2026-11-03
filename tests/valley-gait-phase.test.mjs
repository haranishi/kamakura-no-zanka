// M2a（走り・歩きの滑らかさ）：足の位相と歩調の純粋層（dist/valley/gait-phase.js）と、止まりの残りの距離（loco.js の stopLeft）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { STOP_KC, passStartTime, footDown, stopPace } from '../dist/valley/gait-phase.js';
import { GAIT_TABLE } from '../dist/valley/gait-table.js';
import { ACCEL, speedStep, stopLeft, parseLoco } from '../dist/valley/loco.js';

const RUN = GAIT_TABLE.CMU_Run.hero;

test('start from the passing phase of the gait table', () => {
  assert.equal(passStartTime(RUN), RUN.pass[0] * RUN.period);
  assert.equal(passStartTime(RUN, 1), RUN.pass[1] * RUN.period);
  assert.equal(passStartTime(null), null);
  assert.equal(passStartTime({ period: 1 }), null);
});

test('footDown follows the flat windows (wrapping windows included)', () => {
  assert.equal(footDown(RUN, 0.15), true);
  assert.equal(footDown(RUN, 0.4), false, 'run flight between the two stances');
  const walk = GAIT_TABLE.Samurai_Walk.hero;   // 右の平らな区間は周期をまたぐ（0.68〜0.03）
  assert.equal(footDown(walk, 0.01), true);
  assert.equal(footDown(walk, 0.55), false);
});

test('stopPace lands on a passing phase when it can, and stays inside the limits', () => {
  const natural = 0.38 / (RUN.period * RUN.stanceSpeed);   // 走りから止まる距離で進む位相
  const target = RUN.pass[0];
  // ちょうど届く位置から：倍率1
  assert(Math.abs(stopPace(RUN, target - natural, 0.38) - 1) < 1e-9);
  // 少し手前：着いた足がある間は上限 hi で止める
  const k = stopPace(RUN, 0.08, 0.38);
  assert(k >= STOP_KC.lo && k <= STOP_KC.hi + 1e-12, `stance pace ${k}`);
  assert(Math.abs(k - Math.min(STOP_KC.hi, (target - 0.08) / natural)) < 1e-9);
  // 両足が浮いている間は広い上限まで
  const air = stopPace(RUN, 0.3, 0.38);
  assert(air <= STOP_KC.airHi + 1e-12 && air >= STOP_KC.lo);
  // 残りの距離が無い・表が無いときは1
  assert.equal(stopPace(RUN, 0.3, 0), 1);
  assert.equal(stopPace(null, 0.3, 0.4), 1);
  // 進み切った位相は的に着く（倍率が許容の内のとき）
  for (const p of [0.6, 0.65, 0.1]) {
    const c = stopPace(RUN, p, 0.38), end = (p + c * natural) % 1;
    const hit = RUN.pass.some(t => Math.abs(end - t) < 1e-9);
    if (c > STOP_KC.lo + 1e-9 && c < (footDown(RUN, p) ? STOP_KC.hi : STOP_KC.airHi) - 1e-9) assert(hit, `phase ${p} pace ${c} ends ${end}`);
  }
});

test('stopLeft is the exact remaining distance of the stopping spring', () => {
  for (const [v, a] of [[5, 0], [3, 0], [2.4, -41], [0.5, -3]]) {
    const st = { v, a }, want = stopLeft(st);
    let dist = 0; const s2 = { v, a };
    for (let i = 0; i < 400; i++) dist += speedStep(s2, 0, 1 / 240, ACCEL);
    assert(Math.abs(dist - want) < 2e-3, `v=${v} a=${a}: ${dist} vs ${want}`);
  }
  assert.equal(stopLeft({ v: 0, a: 0 }), 0);
});

test('?smooth=phase, ?smooth=off and ?loco=old turn the phase layer back', () => {
  assert.equal(parseLoco('').smoothPhase, true);
  for (const q of ['?smooth=phase', '?smooth=off', '?loco=old', '?smooth=speed,phase']) assert.equal(parseLoco(q).smoothPhase, false, q);
  assert.equal(parseLoco('?smooth=speed').smoothPhase, true);
});
