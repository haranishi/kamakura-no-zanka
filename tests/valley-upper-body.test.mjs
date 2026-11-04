// 走りの形（M3）の純粋な層 dist/valley/upper-body.js と、切替 ?smooth=arms（loco.js）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { UPPER, springStep, follow, armTarget, armOmega, forearmFix, twistFix, pelvisFix, leanTarget, bankTarget, bobScale, speedT, handBack } from '../dist/valley/upper-body.js';
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

test('armTarget (back-only default): pulls the arm further back only while the opposite thigh is behind; grows with speed; smaller for a constrained arm and with reduced motion', () => {
  assert.equal(UPPER.arm.backOnly, true);
  assert.equal(Math.abs(armTarget(-30, 5, 0)), 0);            // 効き0なら何もしない（−0 になることがある）
  assert.equal(armTarget(30, 5, 1), 0);                       // 反対側の太ももが前＝腕が前へ出る側は触らない（収録のまま・盲検で好まれた）
  assert.equal(armTarget(0, 5, 1), 0);
  assert.ok(armTarget(-30, 5, 1) < -5);                       // 後ろへ引く
  assert.ok(armTarget(-30, 5, 1) < armTarget(-30, 2, 1));     // 速いほど深く
  assert.ok(Math.abs(armTarget(-30, 5, 1, UPPER.arm.constrained)) < Math.abs(armTarget(-30, 5, 1)) * 0.5);
  assert.ok(Math.abs(armTarget(-30, 5, 1, 1, true)) < Math.abs(armTarget(-30, 5, 1)) * 0.5);
  assert.equal(armTarget(-400, 5, 1), -UPPER.arm.max);        // 上限
  // 切替：backOnly を外すと、太ももが前のとき腕も前へ補正する（盲検で負けた初版の形。試験用に残してある）
  const keep = UPPER.arm.backOnly;
  try { UPPER.arm.backOnly = false; assert.ok(armTarget(30, 5, 1) > 5); } finally { UPPER.arm.backOnly = keep; }
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

test('handBack: pulls a raised or far-reaching hand back inside the limits; leaves a low, near or backward hand alone; never pushes forward', () => {
  // 肩から見た手：真下から前へ a 度、肩から手まで r＝0.4m。上限 uMax＝肩の−0.05m（高さ）・reach＝0.27m（前への出）
  const r = 0.4, D = Math.PI / 180, at = deg => [r * Math.sin(deg * D), -r * Math.cos(deg * D)];
  const after = (deg, uMax, reach) => { const [f, u] = at(deg), d = handBack(f, u, uMax, reach), a2 = deg * D - d; return { d, f2: r * Math.sin(a2), u2: -r * Math.cos(a2) }; };
  // 低くて近い手（20度）は、限界の手前なので、ほとんど動かさない
  let [f, u] = at(20); assert.ok(handBack(f, u, -0.05, 0.27) < 0.5 * D);
  // 後ろへ振った腕・肩から近すぎる手は触らない
  [f, u] = at(-40); assert.equal(handBack(f, u, -0.05, 0.27), 0);
  assert.equal(handBack(0.01, -0.02, -0.05, 0.27), 0);
  // 高く上がった手・遠く出た手は、戻した後に両方の上限の内（なめらかな最小の余裕1cm）。前へは押さない（d≥0）
  for (const deg of [50, 70, 90, 120]) {
    const { d, f2, u2 } = after(deg, -0.05, 0.27);
    assert.ok(d > 0, String(deg)); assert.ok(f2 <= 0.27 + 0.01 && u2 <= -0.05 + 0.01, `${deg}: ${f2} ${u2}`);
  }
  // 高さだけの上限（前への出は無制限）：真横（90度）の手は、肩の−0.05mの高さまで下がる
  const h = after(90, -0.05, 9); assert.ok(h.u2 <= -0.05 + 0.01 && h.u2 > -0.15, String(h.u2));
  // 上限が厳しいほど戻す角は大きい
  assert.ok(after(60, -0.2, 9).d > after(60, -0.05, 9).d);
  // 上限が手の届く範囲より低い（不可能）でも、数値が壊れない
  assert.ok(Number.isFinite(handBack(...at(30), -0.9, 0.01)));
  // 既定の上限は、前へ出た手が首の関節より下・前への出が腕の長さの半分強
  assert.ok(UPPER.hand.dy < 0 && UPPER.hand.reach > 0.15 && UPPER.hand.reach < 0.4);
});

test('follow is the same at any frame rate and does not move without time', () => {
  let a = 0, b = 0; for (let i = 0; i < 30; i++) a = follow(a, 1, 6, 1 / 30); for (let i = 0; i < 144; i++) b = follow(b, 1, 6, 1 / 144);
  assert.ok(Math.abs(a - b) < 1e-12); assert.equal(follow(0.3, 1, 6, 0), 0.3);
});
