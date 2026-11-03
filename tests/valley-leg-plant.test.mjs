// M2b（走り・歩きの滑らかさ）：足の接地の保持の純粋層（dist/valley/leg-plant.js）と、?smooth=ik の切替（loco.js）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANT, FREE, LOCK, RELEASE, SETTLE, createFoot, stepFoot, releaseFoot, maybeSettle, abortSettle, dropToReach, inFlat, follow } from '../dist/valley/leg-plant.js';
import { solveTwoBoneInto } from '../dist/valley/hand-grip.js';
import { parseLoco } from '../dist/valley/loco.js';

const out = [0, 0, 0, 0], near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

test('a planted foot stays at the world position where it landed, whatever the animation does', () => {
  const f = createFoot();
  stepFoot(f, true, 1, 2, 1 / 60, out);
  assert.equal(f.mode, LOCK); assert.deepEqual(out.slice(0, 3), [1, 2, 0]); assert.equal(out[3], 1);
  for (let i = 1; i <= 20; i++) { stepFoot(f, true, 1 + i * 0.01, 2 - i * 0.02, 1 / 60, out); assert.deepEqual(out.slice(0, 2), [1, 2]); }
});

test('release eases the held offset back to the animation without a jump, in time not frames', () => {
  for (const hz of [30, 60, 144]) {
    const f = createFoot(), dt = 1 / hz;
    stepFoot(f, true, 0, 0, dt, out);
    stepFoot(f, false, 0.1, 0, dt, out);              // 動作の足は10cm先：放す最初のコマは、留めた所から1コマ分だけ寄る
    assert.equal(f.mode, RELEASE); assert.ok(out[0] < 0.1 * 0.25, `${hz}Hz first frame ${out[0]}`);
    let prev = out[0], t = dt;
    while (f.mode === RELEASE) { stepFoot(f, false, 0.1, 0, dt, out); assert.ok(out[0] >= prev - 1e-12 && out[0] - prev < 0.1 * 4 * dt / PLANT.release); prev = out[0]; t += dt; }
    assert.equal(f.mode, FREE); assert.equal(out[0], 0.1);
    assert.ok(Math.abs(t - PLANT.release) <= 2 * dt, `${hz}Hz took ${t}`);
  }
});

test('re-planting during a release starts from the shown position (no pop)', () => {
  const f = createFoot();
  stepFoot(f, true, 0, 0, 1 / 60, out);
  stepFoot(f, false, 0.2, 0, 1 / 60, out); stepFoot(f, false, 0.2, 0, 1 / 60, out);
  const shown = out[0];
  stepFoot(f, true, 0.2, 0, 1 / 60, out);
  assert.equal(f.mode, LOCK); assert.ok(near(out[0], shown, 0.02), `${out[0]} vs ${shown}`);
});

test('unreachable feet are released from where they are held', () => {
  const f = createFoot();
  stepFoot(f, true, 0, 0, 1 / 60, out);
  releaseFoot(f, 0.5, 0);
  assert.equal(f.mode, RELEASE); assert.ok(near(f.ox, -0.5));
  stepFoot(f, true, 0.5, 0, 1 / 60, out);   // 放している途中でも、着いたらその場へ留める
  assert.equal(f.mode, LOCK);
});

test('the settle step lifts the foot and lands it on the idle pose; walking off mid-step puts it down where it is', () => {
  const feet = [createFoot(), createFoot()];
  stepFoot(feet[0], true, 0, 0, 1 / 60, out); stepFoot(feet[1], true, 0.3, 0.4, 1 / 60, out);
  assert.equal(maybeSettle(feet, 0, 0.01, 0.3, 0.4), false);         // 待ちの姿から1cm：置き直さない
  assert.equal(maybeSettle(feet, 0.2, 0, 0.3, 0.4), true);           // 20cm離れた足だけ
  assert.equal(feet[0].mode, SETTLE); assert.equal(feet[1].mode, LOCK);
  let top = 0;
  for (let t = 0; t < PLANT.settleTime + 0.05; t += 1 / 60) { stepFoot(feet[0], true, 0.2, 0, 1 / 60, out); top = Math.max(top, out[2]); }
  assert.equal(feet[0].mode, LOCK); assert.ok(near(out[0], 0.2)); assert.ok(near(top, PLANT.settleLift, 0.005)); assert.equal(out[2], 0);
  // 途中で歩き出す
  const g = [createFoot(), createFoot()];
  stepFoot(g[0], true, 0, 0, 1 / 60, out); stepFoot(g[1], true, 0, 0, 1 / 60, out);
  maybeSettle(g, 0.2, 0, 0, 0);
  for (let i = 0; i < 9; i++) stepFoot(g[0], true, 0.2, 0, 1 / 60, out);
  const x = out[0];
  abortSettle(g[0], 0.2, 0);
  assert.equal(g[0].mode, LOCK); assert.ok(near(g[0].lx, x, 0.01)); assert.ok(g[0].h > 0);
  for (let i = 0; i < 30; i++) stepFoot(g[0], true, 0.5, 0, 1 / 60, out);
  assert.ok(near(out[0], g[0].lx)); assert.equal(out[2], 0);
});

test('the pelvis only goes down, and only as far as the leg needs', () => {
  assert.equal(dropToReach(0.9, 0.1, 0, 0.85), 0);                   // 届く：下げない
  assert.ok(near(dropToReach(0.9, 0, 0, 0.85), 0.05));                // 5cm 下の足：5cm 下げる
  assert.ok(near(dropToReach(0.9, 0.05, 0.4, 0.85), 0.85 - Math.sqrt(0.85 ** 2 - 0.16)));
  assert.equal(dropToReach(0.9, 0, 0.9, 0.85), Infinity);             // 水平に脚より遠い：下げても届かない
  assert.equal(dropToReach(0.9, 1.2, 0, 0.85), 0);                    // 高い足に合わせて上げない
});

test('flat windows may wrap the cycle seam, and the follow filter is time based', () => {
  assert.equal(inFlat([[0.9, 0.1]], 0.95), true); assert.equal(inFlat([[0.9, 0.1]], 0.05), true); assert.equal(inFlat([[0.9, 0.1]], 0.5), false);
  assert.equal(inFlat(null, 0.5), false);
  let a = 1, b = 1; for (let i = 0; i < 6; i++) a = follow(a, 0, 10, 1 / 60); for (let i = 0; i < 2; i++) b = follow(b, 0, 10, 1 / 20);
  assert.ok(near(a, b, 1e-12));
});

test('two-bone leg geometry: knee bends toward the forward hint and the foot lands on reachable targets', () => {
  const o = { mid: [0, 0, 0], end: [0, 0, 0], reached: false, error: 0 };
  solveTwoBoneInto(o, [0, 0.9, 0], [0, 0.48, 0.02], [0, 0.08, 0], [0, 0.12, 0.25], [0, 0.48, 0.32]);
  assert.equal(o.reached, true); assert.ok(o.error < 1e-9); assert.ok(o.mid[2] > 0.1, `knee z ${o.mid[2]}`);
  const a = Math.hypot(o.mid[1] - 0.9, o.mid[2]), b = Math.hypot(o.end[1] - o.mid[1], o.end[2] - o.mid[2]);
  assert.ok(near(a, Math.hypot(0.42, 0.02), 1e-9) && near(b, Math.hypot(0.4, 0.02), 1e-9));
  solveTwoBoneInto(o, [0, 0.9, 0], [0, 0.48, 0.02], [0, 0.08, 0], [0, -0.5, 0], [0, 0.48, 0.32]);
  assert.equal(o.reached, false); assert.ok(o.error > 0.5);           // 届かない：伸ばした所まで（呼出側が放す）
});

test('?smooth=ik, ?smooth=off and ?loco=old turn the leg IK back', () => {
  assert.equal(parseLoco('').smoothIk, true);
  for (const q of ['?smooth=ik', '?smooth=off', '?loco=old', '?smooth=phase,ik']) assert.equal(parseLoco(q).smoothIk, false, q);
  assert.equal(parseLoco('?smooth=phase').smoothIk, true);
});
