// 走りの形（上半身）の物差し（tools/lib/upper-metrics.mjs・M3）を、合成の記録で確かめる。
// とくに「硬い腕（動かない）」を0として拾えること（わざと壊した記録）、相関の位相差・逆回転・前傾・曲がりの傾きの向き。
import test from 'node:test';
import assert from 'node:assert/strict';
import { upperWindow, turnLean, crossCorr, periodFrames, pearson, segAngles, upAngles } from '../tools/lib/upper-metrics.mjs';

const DT = 1 / 60, R = Math.PI / 180;
// 模型の向き yaw で前＝(sin, cos)、右＝(−cos, sin)。opts の関数は時刻 t の角（度）・高さ（m）
function frame(t, o = {}) {
  const yaw = o.yaw ? o.yaw(t) : Math.PI, f = [Math.sin(yaw), Math.cos(yaw)], r = [-Math.cos(yaw), Math.sin(yaw)];
  const speed = o.speed ?? 5, px = o.px ? o.px(t) : f[0] * speed * t, pz = o.pz ? o.pz(t) : f[1] * speed * t;
  const hy = 0.9 + (o.bob ? o.bob(t) : 0), H = [px, hy, pz];
  const at = (base, side, yawOff, dy) => { const c = Math.cos(yawOff * R), s = Math.sin(yawOff * R), rx = r[0] * c + f[0] * s, rz = r[1] * c + f[1] * s; return [base[0] + rx * side, base[1] + dy, base[2] + rz * side]; };
  const limb = (p, deg, len) => [p[0] + f[0] * Math.sin(deg * R) * len, p[1] - Math.cos(deg * R) * len, p[2] + f[1] * Math.sin(deg * R) * len];
  const pel = o.pelvis ? o.pelvis(t) : 0, che = o.chest ? o.chest(t) : 0, lean = o.lean ? o.lean(t) : 0, bank = o.bank ? o.bank(t) : 0;
  const LU = at(H, -0.1, pel, -0.05), RU = at(H, 0.1, pel, -0.05);
  const top = [H[0] + f[0] * Math.sin(lean * R) * 0.5 + r[0] * Math.sin(bank * R) * 0.5, H[1] + Math.cos(lean * R) * 0.5, H[2] + f[1] * Math.sin(lean * R) * 0.5 + r[1] * Math.sin(bank * R) * 0.5];
  const LA = at(top, -0.18, che, -0.05), RA = at(top, 0.18, che, -0.05);
  const la = o.armL ? o.armL(t) : 0, ra = o.armR ? o.armR(t) : 0, lt = o.thighL ? o.thighL(t) : 0, rt = o.thighR ? o.thighR(t) : 0;
  const q = o.head ? o.head(t) : [0, 0, 0, 1], b = (p, qq = [0, 0, 0, 1]) => [...p, ...qq];
  const LF = limb(LA, la, 0.28), RF = limb(RA, ra, 0.28);
  return { t, tag: 'x', pos: [px, 0, pz], modelYaw: yaw, speed, bones: {
    Hips: b(H), LeftUpLeg: b(LU), RightUpLeg: b(RU), LeftLeg: b(limb(LU, lt, 0.42)), RightLeg: b(limb(RU, rt, 0.42)),
    neck: b(top), Head: b([top[0], top[1] + 0.15, top[2]], q), LeftArm: b(LA), RightArm: b(RA), LeftForeArm: b(LF), RightForeArm: b(RF),
    LeftShoulder: b(LA), RightShoulder: b(RA), LeftHand: b(limb(LF, la + 70, 0.25)), RightHand: b(limb(RF, ra + 70, 0.25)) } };
}
const frames = (n, o) => Array.from({ length: n }, (_, i) => frame(i * DT, o));
const T = 0.5, w = 2 * Math.PI / T;   // 30コマの周期
const legs = { thighR: t => 35 * Math.sin(w * t), thighL: t => -35 * Math.sin(w * t) };

test('angles: forward and right are positive, the up line leans forward when the neck is ahead', () => {
  const f = frame(0, { armL: () => 30, lean: () => 10, bank: () => 5 });
  assert.ok(Math.abs(segAngles(f, 'LeftArm', 'LeftForeArm').sag - 30) < 1e-6);
  const up = upAngles(f, 'Hips', 'neck');
  assert.ok(Math.abs(up.sag - 10) < 0.5 && up.lat > 4 && up.lat < 6, JSON.stringify(up));
});

test('a frozen (stiff) arm reads as zero swing and zero sync — the defect M0 could not see', () => {
  const m = upperWindow(frames(120, { ...legs, armL: () => -25, armR: () => -25 }), DT);
  assert.equal(m.arm.ampL, 0); assert.equal(m.arm.ampR, 0);
  assert.equal(m.sync.L.best, 0); assert.equal(m.sync.R.best, 0);
  assert.equal(m.arm.meanL, -25);
});

test('an arm swinging with the opposite thigh: amplitude, correlation 1 and the lag in frames', () => {
  const m = upperWindow(frames(120, { ...legs, armL: t => 30 * Math.sin(w * t), armR: t => -30 * Math.sin(w * (t - 3 * DT)) }), DT);
  assert.equal(m.periodFrames, 30);
  assert.ok(Math.abs(m.arm.ampL - 60) < 0.5, String(m.arm.ampL));
  assert.ok(m.sync.L.best > 0.99 && m.sync.L.lag === 0);
  assert.ok(m.sync.R.best > 0.99 && m.sync.R.lag === 3 && Math.abs(m.sync.R.lagFrac - 0.1) < 1e-9, JSON.stringify(m.sync.R));
  // 同じ側の太ももと同期する腕（人の走りと逆）は、反対側との相関が負になる
  const bad = upperWindow(frames(120, { ...legs, armL: t => -30 * Math.sin(w * t) }), DT);
  assert.ok(bad.sync.L.r0 < -0.99, String(bad.sync.L.r0));
});

test('trunk: counter-rotation reads negative, a rigid block reads positive', () => {
  const counter = upperWindow(frames(120, { ...legs, pelvis: t => 8 * Math.sin(w * t), chest: t => -6 * Math.sin(w * t) }), DT);
  assert.ok(counter.trunk.counter < -0.99 && Math.abs(counter.trunk.pelvisYawAmp - 16) < 0.5 && Math.abs(counter.trunk.twistAmp - 28) < 0.5, JSON.stringify(counter.trunk));
  const block = upperWindow(frames(120, { ...legs, pelvis: t => 8 * Math.sin(w * t), chest: t => 8 * Math.sin(w * t) }), DT);
  assert.ok(block.trunk.counter > 0.99 && block.trunk.twistAmp < 0.1, JSON.stringify(block.trunk));
});

test('pelvis bob, lean and head stability', () => {
  const m = upperWindow(frames(120, { ...legs, bob: t => 0.04 * Math.sin(2 * w * t), lean: () => 9 }), DT);
  assert.ok(Math.abs(m.pelvis.bobCm - 8) < 0.1, String(m.pelvis.bobCm));
  assert.ok(Math.abs(m.lean.meanDeg - 9) < 0.5, String(m.lean.meanDeg));
  assert.equal(m.head.yawAmp, 0); assert.equal(m.head.angAccP99, 0);
  // 頭が左右に5度ずつ振れる（上の軸まわり）と、幅10度・角加速度が出る
  const wob = upperWindow(frames(120, { ...legs, head: t => { const a = 5 * R * Math.sin(w * t) / 2; return [0, Math.sin(a), 0, Math.cos(a)]; } }), DT);
  assert.ok(Math.abs(wob.head.yawAmp - 10) < 0.2 && wob.head.angAccP99 > 500, JSON.stringify(wob.head));
});

test('hand pose: a hand raised above the neck reads positive, a low hand negative; reach is measured forward from the shoulder — the defect the swing/sync metrics missed', () => {
  // 上腕を水平に前へ（la＝90度）：肘は肩の前0.28m・高さは肩と同じ、手はさらに斜め上へ。首より上・前へ約36cm
  const high = upperWindow(frames(60, { ...legs, armL: () => 90, armR: () => 90 }), DT).handPose;
  assert.ok(high.dyMaxCm > 10, JSON.stringify(high)); assert.ok(Math.abs(high.reachMaxCm - 36.5) < 1.5, JSON.stringify(high));
  // 腕を後ろへ垂らした硬い腕（−25度）：手は首よりずっと下・前へは出ない
  const low = upperWindow(frames(60, { ...legs, armL: () => -25, armR: () => -25 }), DT).handPose;
  assert.ok(low.dyMaxCm < -30 && low.reachMaxCm < 25, JSON.stringify(low));
  // 振り（前後）では最高の高さは、前へ振った瞬間の値になる（平均ではない）
  const swing = upperWindow(frames(60, { ...legs, armL: t => 10 + 40 * Math.sin(w * t), armR: t => 10 - 40 * Math.sin(w * t) }), DT).handPose;
  assert.ok(swing.dyMaxCm > low.dyMaxCm + 20 && swing.dyMaxCm < high.dyMaxCm + 5, JSON.stringify(swing));
});

test('turn lean: leaning into the turn is positive, leaning out is negative', () => {
  // 右へ曲がる円（半径 r、速さ v）：右への加速度 v²/r。腰→首を右（内側）へ6度
  const v = 5, rad = 6, om = v / rad, cx = rad, cz = 0;   // 中心は右（+x）。向き π（−z へ進む）から右回り
  const circle = { yaw: t => Math.PI - om * t, px: t => cx - rad * Math.cos(om * t), pz: t => cz - rad * Math.sin(om * t) };
  const into = turnLean(frames(60, { ...circle, bank: () => 6 }), DT);
  assert.ok(into.frames > 30 && Math.abs(into.inward - 6) < 0.6, JSON.stringify(into));
  assert.ok(Math.abs(into.expect - Math.atan(v * v / rad / 9.81) * 180 / Math.PI) < 1, JSON.stringify(into));
  const out = turnLean(frames(60, { ...circle, bank: () => -6 }), DT);
  assert.ok(out.inward < -5, JSON.stringify(out));
});

test('helpers: pearson of a constant is 0, crossCorr finds the shift, periodFrames finds the cycle', () => {
  assert.equal(pearson([1, 1, 1, 1], [1, 2, 3, 4]), 0);
  const a = Array.from({ length: 90 }, (_, i) => Math.sin(i * 2 * Math.PI / 20)), b = a.map((_, i) => Math.sin((i - 4) * 2 * Math.PI / 20));
  assert.equal(crossCorr(b, a, 10).lag, 4);
  assert.equal(periodFrames(a), 20);
});
