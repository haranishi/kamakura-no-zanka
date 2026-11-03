// 走りの形（M3）の純粋な層 dist/valley/upper-body.js と、切替 ?smooth=arms（loco.js）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { UPPER, springStep, follow, armTarget, armOmega, forearmFix, twistFix, pelvisFix, leanTarget, bankTarget, bobScale, speedT } from '../dist/valley/upper-body.js';
import { parseLoco } from '../dist/valley/loco.js';

test('?smooth=arms turns only the upper-body layer off; it rides on the leg IK pass so ?smooth=ik also turns it off', () => {
  assert.equal(parseLoco('').smoothArms, true);
  const arms = parseLoco('?smooth=arms');
  assert.equal(arms.smoothArms, false); assert.equal(arms.smoothIk, true); assert.equal(arms.smoothPhase, true); assert.equal(arms.smoothAccel, true);
  for (const q of ['?smooth=ik', '?smooth=off', '?loco=old', '?smooth=speed,arms']) assert.equal(parseLoco(q).smoothArms, false, q);
  assert.equal(parseLoco('?smooth=speed').smoothArms, true);
});

test('springStep is exact: the same curve at 30, 60 and 144 frames per second', () => {
  const run = hz => { const st = { x: 0, v: 0 }, out = []; for (let i = 0; i < hz; i++) { springStep(st, 10, 30, 0.35, 1 / hz); if ((i + 1) % (hz / 6) === 0) out.push(st.x); } return out; };
  const a = run(30), b = run(60), c = run(144 * 1);
  for (let k = 0; k < 6; k++) { assert.ok(Math.abs(a[k] - b[k]) < 1e-9 && Math.abs(b[k] - c[k]) < 1e-9, `${a[k]} ${b[k]} ${c[k]}`); }
  assert.ok(Math.abs(b[5] - 10) < 1e-3);   // 1秒で目標へ落ち着く
  // 弱い減衰は行き過ぎる（ばねらしさ）、臨界減衰は行き過ぎない
  const st = { x: 0, v: 0 }; let peak = 0; for (let i = 0; i < 60; i++) peak = Math.max(peak, springStep(st, 1, 30, 0.35, 1 / 60));
  assert.ok(peak > 1.25 && peak < 1.4, String(peak));
  const cr = { x: 0, v: 0 }; let pk = 0; for (let i = 0; i < 60; i++) pk = Math.max(pk, springStep(cr, 1, 10, 1, 1 / 60));
  assert.ok(pk <= 1 + 1e-9);
  assert.equal(springStep({ x: 3, v: 0 }, 0, 10, 0.5, 0), 3);   // 時間が進まないコマは動かさない
});

test('driving the arm spring with the opposite thigh: small lag, about 1.17x gain, frame-rate independent', () => {
  const period = 0.426, om = armOmega(period), w = 2 * Math.PI / period;
  assert.ok(Math.abs(om / w - UPPER.arm.omegaPerCycle) < 1e-9);
  assert.equal(armOmega(0), UPPER.arm.omegaMin);
  const sim = hz => { const st = { x: 0, v: 0 }, dt = 1 / hz, xs = []; for (let i = 0; i < hz * 3; i++) { const t = i * dt; springStep(st, 20 * Math.sin(w * t), om, UPPER.arm.zeta, dt); if (t > 2) xs.push([t, st.x]); } return xs; };
  for (const hz of [30, 60, 144]) {
    const xs = sim(hz), amp = Math.max(...xs.map(p => p[1]));
    assert.ok(amp > 20 * 1.05 && amp < 20 * 1.35, `${hz}: ${amp}`);
  }
});

test('armTarget: grows with speed, follows the thigh, smaller for a constrained arm and with reduced motion', () => {
  assert.equal(armTarget(0, 5, 0), 0);                       // 効き0なら何もしない
  assert.ok(armTarget(0, 5, 1) > armTarget(0, 2, 1));        // 速いほど前へ（平均を前へ）
  assert.ok(armTarget(30, 5, 1) - armTarget(-30, 5, 1) > armTarget(30, 2, 1) - armTarget(-30, 2, 1));
  assert.ok(Math.abs(armTarget(30, 5, 1, UPPER.arm.constrained)) < Math.abs(armTarget(30, 5, 1)) * 0.5);
  assert.ok(Math.abs(armTarget(30, 5, 1, 1, true)) < Math.abs(armTarget(30, 5, 1)) * 0.5);
  assert.equal(armTarget(400, 5, 1), UPPER.arm.max);        // 上限
  assert.equal(speedT(1), 0); assert.equal(speedT(9), 1);
  // 前腕：平均より前で肘を畳み（＋）、後ろで伸ばす（−）。効き0なら0
  assert.equal(forearmFix(0, 5, 0), 0);
  assert.ok(forearmFix(40, 5, 1) > forearmFix(0, 5, 1));
});

test('twist and pelvis: right thigh forward puts the right hip forward and the left shoulder forward (counter-rotation)', () => {
  // 右の太ももが前（+30）・左が後ろ（−30）：骨盤は＋（右の腰が前）、胸は−（左肩が前）へ。動作の揺れ c・p は打ち消す
  assert.ok(pelvisFix(30, -30, 0, 1) > 0); assert.ok(twistFix(30, -30, 0, 1) < 0);
  assert.ok(Math.abs(twistFix(0, 0, 5, 1) + 5) < 1e-9);       // 脚が揃っていれば、胸の揺れは0へ
  assert.equal(Math.abs(twistFix(30, -30, 4, 0)), 0); assert.equal(Math.abs(pelvisFix(30, -30, 4, 0)), 0);
  assert.equal(Math.abs(twistFix(0, 0, 100, 1)), UPPER.twist.max);
});

test('lean: forward with speed and acceleration, back when braking, bounded; bank leans into the turn', () => {
  assert.equal(leanTarget(3, 0, 1), 0);
  assert.ok(leanTarget(5, 0, 1) > 2 && leanTarget(5, 0, 1) < 4);
  assert.ok(leanTarget(5, 30, 1) > leanTarget(5, 0, 1) + 5);
  assert.ok(leanTarget(0, -30, 1) < 0); assert.ok(leanTarget(0, -1e9, 1) >= UPPER.lean.min); assert.ok(leanTarget(8, 1e9, 1) <= UPPER.lean.max);
  assert.ok(leanTarget(5, 30, 1, true) < leanTarget(5, 30, 1) * 0.5);
  assert.ok(bankTarget(5, 2, 1) > 0 && bankTarget(5, -2, 1) < 0);   // 右回り（正）は右へ
  assert.equal(bankTarget(5, 100, 1), UPPER.bank.max);
  assert.equal(bankTarget(0, 3, 1), 0);
});

test('bobScale: the same arc played ts times faster shrinks toward bob/ts², not below the floor', () => {
  assert.equal(bobScale(0.085, 1), 1); assert.equal(bobScale(0.085, 0.8), 1); assert.equal(bobScale(0, 2), 1);
  assert.ok(Math.abs(bobScale(0.085, 1.72) - UPPER.bob.floor / 0.085) < 1e-9);   // 0.085/1.72² は下限より小さい → 下限
  assert.ok(Math.abs(bobScale(0.085, 1.05) - 1 / 1.05 ** 2) < 1e-9);
  assert.ok(bobScale(0.085, 1.72, true) < bobScale(0.085, 1.72));
});

test('follow is the same at any frame rate and does not move without time', () => {
  let a = 0, b = 0; for (let i = 0; i < 30; i++) a = follow(a, 1, 6, 1 / 30); for (let i = 0; i < 144; i++) b = follow(b, 1, 6, 1 / 144);
  assert.ok(Math.abs(a - b) < 1e-12); assert.equal(follow(0.3, 1, 6, 0), 0.3);
});
