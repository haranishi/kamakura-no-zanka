// upper-rig.js — 走りの形の層（design-locomotion-smooth §6・§13、M3）。見た目の層：論理の位置・向き・戦闘・当たりは変えない。
// 式は upper-body.js（純粋）。ここは骨へ当てるだけ。実行順は mixer → この層（体幹の逆回転・前傾・曲がりの傾き→腕→頭）→ 脚のIK（骨盤の上下 lift はIKが当てる）→ 刀 → 握り。
// 効くのは移動の動作が今の動作のとき（LegRig.stance と同じ見方）だけで、技・回避・受け・抜納刀・両手持ちの間は効きを0へ戻す（25/秒）。屈み歩きには使わない。
// 前のコマの補正は undo で戻してから mixer を当てる（二重に掛けない）。毎コマの新規確保をしない（入れ物は作っておく）。
import * as THREE from 'three';
import { UPPER, follow, springStep, armTarget, armOmega, forearmFix, twistFix, pelvisFix, leanTarget, bankTarget, bobScale, handBack } from './upper-body.js';

const NAMES = ['Spine02', 'Spine01', 'Spine', 'Head', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'Hips', 'LeftUpLeg', 'RightUpLeg'];
const SPINE = [0, 1, 2], SPINE_SHARE = [0.3, 0.3, 0.4], D2R = Math.PI / 180;
const V = new THREE.Vector3(), W = new THREE.Vector3(), N = new THREE.Vector3(), FWD = new THREE.Vector3(), RIGHT = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
const Q = new THREE.Quaternion(), PQ = new THREE.Quaternion(), RQ = new THREE.Quaternion(), HQ = new THREE.Quaternion(), MQ = new THREE.Quaternion(), MQI = new THREE.Quaternion();
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// 「動きを減らす」（game.js が毎コマ置く）
export const UPPER_ENV = { reduce: false };

export class UpperRig {
  constructor(ch) {
    this.ch = ch;
    this.b = NAMES.map(n => ch.bone(n));
    this.hips = ch.bone('Hips'); this.handL = ch.bone('LeftHand'); this.handR = ch.bone('RightHand'); this.neck = ch.bone('neck') || null;
    this.legs = [['LeftUpLeg', 'LeftLeg'], ['RightUpLeg', 'RightLeg']].map(([a, b]) => [ch.bone(a), ch.bone(b)]);
    this.ok = !!this.hips && this.b.every(Boolean) && this.legs.every(l => l[0] && l[1]);
    this.saved = this.b.map(() => new THREE.Quaternion());
    this.applied = false; this.lift = 0;
    this.w = 0; this.armL = { x: 0, v: 0 }; this.armR = { x: 0, v: 0 }; this.lean = { x: 0, v: 0 }; this.bank = { x: 0, v: 0 };
    this.v = 0; this.vPrev = 0; this.acc = 0; this.yawRate = 0; this.rx = NaN; this.rz = 0; this.ryaw = 0;
    this.pMean = 0; this.cMean = 0; this.hipMid = NaN; this.headS = new THREE.Quaternion(); this.headOn = false;
    this.last = { w: 0, pelvis: 0, armL: 0, armR: 0, lean: 0, bank: 0, twist: 0, lift: 0, v: 0 };   // 試験用：直近コマの値（毎コマ新しく作らない）
  }

  undo() {
    if (!this.applied) return;
    for (let i = 0; i < this.b.length; i++) this.b[i].quaternion.copy(this.saved[i]);
    this.applied = false;
  }

  resetState() {
    this.w = 0; this.armL.x = this.armL.v = this.armR.x = this.armR.v = this.lean.x = this.lean.v = this.bank.x = this.bank.v = 0;
    this.acc = 0; this.yawRate = 0; this.headOn = false; this.hipMid = NaN; this.lift = 0;
  }

  // dt：このコマの秒。active：この人物に使うか（脚のIKを使う人と同じ顔ぶれ。?smooth=arms・演出の間は false）
  apply(dt, active) {
    this.lift = 0;
    if (!this.ok) return;
    const ch = this.ch, root = ch.root.position;
    // 根の動き（瞬間移動は状態を戻す）。速さ・加速度・向きの変化の速さ（右回りが正）
    if (!Number.isFinite(this.rx) || Math.hypot(root.x - this.rx, root.z - this.rz) > UPPER.teleport || !(dt > 0)) {
      if (dt > 0 || !Number.isFinite(this.rx)) { this.rx = root.x; this.rz = root.z; this.ryaw = ch.root.rotation.y; this.v = this.vPrev = 0; this.resetState(); }
    } else {
      const vi = Math.hypot(root.x - this.rx, root.z - this.rz) / dt, yr = -wrap(ch.root.rotation.y - this.ryaw) / dt;
      this.rx = root.x; this.rz = root.z; this.ryaw = ch.root.rotation.y;
      this.v = follow(this.v, vi, 14, dt); this.acc = follow(this.acc, (this.v - this.vPrev) / dt, 14, dt); this.vPrev = this.v;
      this.yawRate = follow(this.yawRate, yr, 12, dt);
    }
    const loco = !!ch.locoName && ch.currentName === ch.locoName && ch.style !== 'crouch' && !ch.cinePose;
    const sw = ch.sword?.frame, swording = !!(sw && sw.u > 0 && sw.u < 1), twoHand = (ch.hands?.sides?.Left?.g2 || 0) > 0.02;
    const want = active && loco && !swording && !twoHand && ch.gait !== 'idle' ? Math.min(1, this.v / 2) : 0;
    this.w = follow(this.w, want, want > this.w ? UPPER.fade.up : active && loco ? UPPER.fade.down : UPPER.fade.cut, dt);
    if (!active) { this.w = 0; this.resetState(); return; }
    if (this.w < 1e-3 && want === 0 && Math.abs(this.armL.x) + Math.abs(this.armR.x) + Math.abs(this.lean.x) + Math.abs(this.bank.x) < 0.05) { this.w = 0; this.headOn = false; return; }
    const w = this.w, reduce = UPPER_ENV.reduce;
    for (let i = 0; i < this.b.length; i++) this.saved[i].copy(this.b[i].quaternion);
    this.applied = true;
    ch.model.updateMatrixWorld(true);
    ch.model.getWorldQuaternion(MQ); MQI.copy(MQ).invert();
    FWD.set(0, 0, 1).applyQuaternion(MQ); FWD.y = 0; FWD.normalize(); RIGHT.crossVectors(FWD, UP);
    // 動作の姿勢を読む：太ももの前後の角度、胸（肩の線）の回り（体の右からの水平の角）
    const thighL = this.sag(this.legs[0][0], this.legs[0][1]), thighR = this.sag(this.legs[1][0], this.legs[1][1]);
    const pel = this.lineYaw(this.b[9], this.b[10]), che = this.lineYaw(this.b[4], this.b[5]);
    this.pMean = follow(this.pMean, pel, UPPER.twist.mean, dt); this.cMean = follow(this.cMean, che, UPPER.twist.mean, dt);
    // 骨盤の上下：腰の高さ（根から）の揺れを bobScale 倍へ（当てるのは脚のIK：足首の高さは動作のまま解くので、足は浮かない）
    const a = ch.current, meta = ch.locoName && ch.meta(ch.locoName), ts = a ? Math.abs(a.timeScale) * ch.rate : 1;
    this.hips.getWorldPosition(V); const hy = V.y - root.y;
    this.hipMid = Number.isFinite(this.hipMid) ? follow(this.hipMid, hy, UPPER.bob.rate, dt) : hy;
    if (ch.legIk && meta?.hipsY) this.lift = (bobScale((meta.hipsY[1] - meta.hipsY[0]) * ch.root.scale.y, ts, reduce) - 1) * (hy - this.hipMid) * w;
    // 体幹：逆回転（上の軸）・前傾（右の軸。前へ倒すのは負）・曲がりの傾き（前の軸。右へ倒すのは正）
    springStep(this.lean, leanTarget(this.v, this.acc, w, reduce), UPPER.lean.omega, UPPER.lean.zeta, dt);
    springStep(this.bank, bankTarget(this.v, this.yawRate, w, reduce), UPPER.bank.omega, UPPER.bank.zeta, dt);
    const tw = twistFix(thighR, thighL, wrap((che - this.cMean) * D2R) / D2R, w, reduce);
    // 骨盤：腰だけを回し、太ももと背骨は逆に回して元の向きに残す
    const pf = pelvisFix(thighR, thighL, wrap((pel - this.pMean) * D2R) / D2R, w, reduce) * D2R;
    if (Math.abs(pf) > 1e-6) { this.rot(this.b[8], UP, pf); this.rot(this.b[9], UP, -pf); this.rot(this.b[10], UP, -pf); this.rot(this.b[0], UP, -pf); }
    for (let k = 0; k < 3; k++) {
      const s = SPINE_SHARE[k], bone = this.b[SPINE[k]];
      if (k === 0) { this.rot(bone, RIGHT, -this.lean.x * D2R); this.rot(bone, FWD, this.bank.x * D2R); }
      this.rot(bone, UP, tw * s * D2R);
    }
    this.b[0].updateMatrixWorld(true);
    // 腕：反対側の太ももの角度から、減衰の弱いばねで。鞘・柄・弓を持つ腕は弱く
    const period = a && meta?.seconds && ts > 0 ? meta.seconds / ts : 0, om = armOmega(period);
    const holdR = ch.weapons?.tachiDrawn?.holder?.visible || ch.weapons?.naginata?.holder?.visible, holdL = ch.weapons?.yumi?.holder?.visible;
    // 腕と前腕は速さでも弱める（止まりの0.2秒で効きが残ると、待ちへ混ぜる間に前へ開いた脚の角度で腕が前へ水平に上がった＝撮影で確認）。目標が0へ向かう間は減衰を強く（行き過ぎて後ろへ振れない）
    // 強い減速（止まり）でも弱める：止まりで待ちの姿へ混ぜる間、動作の腕は前へ上がる。補正を残すと、奥の腕が前へ水平に伸びて見えた（真横の撮影で確認）
    const wa = w * Math.min(1, this.v / UPPER.arm.fullSpeed) * Math.max(0, Math.min(1, 1 + this.acc / UPPER.arm.brake)), zA = want > 0.5 ? UPPER.arm.zeta : UPPER.arm.zetaStop;
    springStep(this.armL, armTarget(thighR, this.v, wa, holdL ? UPPER.arm.constrained : 1, reduce), om, zA, dt);
    springStep(this.armR, armTarget(thighL, this.v, wa, holdR ? UPPER.arm.constrained : 1, reduce), om, zA, dt);
    const sL = holdL ? UPPER.arm.constrained : 1, sR = holdR ? UPPER.arm.constrained : 1;
    // 上腕の前への傾きは、動作の角＋補正が cap 度を超えない（止まりで待ちの姿へ混ぜる間、動作の腕が前へ45度ほど上がり、補正を足すと水平に突き出た＝撮影で確認）
    const xL = Math.min(this.armL.x, Math.max(0, UPPER.arm.cap - this.sag(this.b[4], this.b[6]))), xR = Math.min(this.armR.x, Math.max(0, UPPER.arm.cap - this.sag(this.b[5], this.b[7])));
    this.rot(this.b[4], RIGHT, xL * D2R); this.rot(this.b[6], RIGHT, this.elbowKeep(this.b[4], this.b[6], this.handL, forearmFix(xL, this.v, wa, sL, reduce)) * D2R);
    this.rot(this.b[5], RIGHT, xR * D2R); this.rot(this.b[7], RIGHT, this.elbowKeep(this.b[5], this.b[7], this.handR, forearmFix(xR, this.v, wa, sR, reduce)) * D2R);
    // 手の上限（盲検の指摘：前へ出た手が顔の高さまで上がる・腕が棒のように突き出る）。鞘・柄・弓を持つ腕は、刀・握りの層が決めるので触らない
    if (this.neck) { if (!holdL) this.limitHand(this.b[4], this.handL, w); if (!holdR) this.limitHand(this.b[5], this.handR, w); }
    // 頭：進む向きから見た頭の向きを、ゆっくりならした向きへ寄せる（揺れを打ち消す）
    const head = this.b[3];
    head.parent.updateMatrixWorld(true);
    head.getWorldQuaternion(HQ); Q.copy(MQI).multiply(HQ);   // 進む向きから見た頭
    if (!this.headOn) { this.headS.copy(Q); this.headOn = true; }
    else this.headS.slerp(Q, 1 - Math.exp(-UPPER.head.rate * dt));
    Q.slerp(this.headS, UPPER.head.keep * w);
    HQ.copy(MQ).multiply(Q);
    head.parent.getWorldQuaternion(PQ); head.quaternion.copy(PQ.invert().multiply(HQ));
    head.updateMatrixWorld(true);
    this.hips.updateMatrixWorld(true);
    const L = this.last; L.w = w; L.pelvis = pf / D2R; L.armL = xL; L.armR = xR; L.lean = this.lean.x; L.bank = this.bank.x; L.twist = tw; L.lift = this.lift; L.v = this.v;
  }

  // 骨を世界の軸 axis まわりに ang だけ回す（親の局所へ直して）
  rot(bone, axis, ang) {
    if (Math.abs(ang) < 1e-7) return;
    bone.parent.getWorldQuaternion(PQ); RQ.setFromAxisAngle(axis, ang);
    bone.quaternion.premultiply(PQ).premultiply(RQ).premultiply(PQ.invert());
  }
  // 肩から見た手が、首の関節より UPPER.hand.dy 以下・前への出 UPPER.hand.reach 以下に収まるよう、腕を肩の軸まわりに後ろへ戻す（式は upper-body.js の handBack）。
  // 戻す角は層の効き w（0〜1）に比例させる：屈み・技などで層が消えていく間も全力で引き戻すと、屈み歩きに入る0.35秒、左腕が最大40度ずれ、層が止まる瞬間に弾けた（生の記録の比較で発見）
  limitHand(arm, hand, w) {
    if (!(w > 1e-3)) return;
    arm.getWorldPosition(V); hand.getWorldPosition(W); this.neck.getWorldPosition(N);
    W.sub(V);
    const H = UPPER.hand, d = handBack(W.x * FWD.x + W.z * FWD.z, W.y, N.y - V.y + H.dy, H.reach) * Math.min(1, w);
    if (d > 1e-4) { this.rot(arm, RIGHT, -d); arm.updateMatrixWorld(true); }
  }
  // 前腕の補正 fix（度）を、腕が前にある間は肘の曲がりが minFlex 度を下回らないように減らす（伸ばしすぎて腕が棒になるのを防ぐ。伸ばす向きの補正だけを削る）
  elbowKeep(arm, fore, hand, fix) {
    if (!(fix < 0) || !hand) return fix;
    const us = this.sag(arm, fore);
    if (us <= 0) return fix;
    const fs = this.sag(fore, hand), room = fs - (us + UPPER.arm.minFlex);
    return Math.max(fix, Math.min(0, -room));
  }
  // 骨 a→b の線の、体の前への傾き（度・真下が0）
  sag(a, b) {
    a.getWorldPosition(V); b.getWorldPosition(W); W.sub(V);
    return Math.atan2(W.x * FWD.x + W.z * FWD.z, -W.y) / D2R;
  }
  // 線 a→b（左→右）の、体の右からの水平の角（度・右が前へ回ると正）
  lineYaw(a, b) {
    a.getWorldPosition(V); b.getWorldPosition(W); W.sub(V);
    return Math.atan2(W.x * FWD.x + W.z * FWD.z, W.x * RIGHT.x + W.z * RIGHT.z) / D2R;
  }
}
