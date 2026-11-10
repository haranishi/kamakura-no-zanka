// upper-rig.js — 走りの形の層（design-locomotion-smooth §6・§13、M3）。見た目の層：論理の位置・向き・戦闘・当たりは変えない。
// 式は upper-body.js（純粋）。ここは骨へ当てるだけ。実行順は mixer → この層（体幹の逆回転・前傾・曲がりの傾き→腕→頭）→ 脚のIK（骨盤の上下 lift はIKが当てる）→ 刀 → 握り。
// 効くのは移動の動作が今の動作のとき（LegRig.stance と同じ見方）だけで、技・回避・受け・抜納刀・両手持ちの間は効きを0へ戻す（25/秒）。屈み歩きには使わない。
// 前のコマの補正は undo で戻してから mixer を当てる（二重に掛けない）。毎コマの新規確保をしない（入れ物は作っておく）。
import * as THREE from 'three';
import { solveTwoBoneInto } from './hand-grip.js';
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

// Opt-in late pass, owned/created only by the Kamakura layer. The legacy UpperRig above
// keeps its exact path when style is absent. All scratch storage belongs to this instance.
export class HeroMoveRig {
  constructor(ch, hero, policy) {
    this.ch = ch; this.hero = hero; this.cfg = policy.HERO_MOVE; this.compute = policy.heroMoveTarget; this.mix = policy.moveMix;
    this.bones = ['Spine02', 'Head', 'LeftShoulder', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand'].map(n => ch.bone(n));
    this.saved = this.bones.map(b => b.quaternion.clone());
    this.shoulders = [this.bones[2].quaternion.clone(), this.bones[3].quaternion.clone()];
    this.face = ch.bone('headfront').position.clone().normalize();
    this.p = new THREE.Vector3(); this.n = new THREE.Vector3(); this.a = new THREE.Vector3(); this.bv = new THREE.Vector3(); this.c = new THREE.Vector3();
    this.fwd = new THREE.Vector3(); this.right = new THREE.Vector3(); this.axis = new THREE.Vector3(); this.goal = new THREE.Vector3(); this.hint = new THREE.Vector3();
    this.q = new THREE.Quaternion(); this.pq = new THREE.Quaternion(); this.hq = new THREE.Quaternion();
    this.root = [0, 0, 0]; this.mid = [0, 0, 0]; this.end = [0, 0, 0]; this.target = [0, 0, 0]; this.pole = [0, 0, 0];
    this.out = { mid: [0, 0, 0], end: [0, 0, 0], reached: true, error: 0 };
    this.targetPose = { lean: 0, head: 0, fist: 0, active: false, arm: 0, flex: 0 };
    this.leanState = { x: 1, v: 0 }; this.weight = 0; this.carry = 0; this.curlWeight = 0; this.speed = 0; this.prevSpeed = 0;
    this.applied = false; this.paused = false; this.enabled = true; this.ready = false;
    this.previous = [new THREE.Vector3(), new THREE.Vector3()];
    this.stance = policy.HERO_STANCE; this.guardWeight = 0; this.carryWeight = 0; this.stanceClock = 0;
    this.guardOn = false; this.carryOn = false; this.drawReady = false; this.drawBlend = 0;
    this.swordY = new THREE.Vector3(); this.swordZ = new THREE.Vector3(); this.swordX = new THREE.Vector3();
    this.swordPos = new THREE.Vector3(); this.swordQuat = new THREE.Quaternion(); this.identity = new THREE.Quaternion();
    this.handPos = new THREE.Vector3(); this.handQuat = new THREE.Quaternion(); this.scale = new THREE.Vector3();
    this.mat = new THREE.Matrix4(); this.basisMat = new THREE.Matrix4(); this.swordMat = new THREE.Matrix4();
    this.homeMat = new THREE.Matrix4().compose(ch.sword.home.drawn.position, ch.sword.home.drawn.quaternion, ch.sword.home.drawn.scale);
    this.drawPrevious = new THREE.Vector3();
    ch.root.updateWorldMatrix(true, true);
    ch.weapons.tachiDrawn.holder.getWorldScale(this.scale); this.weaponScale = this.scale.x;
    this.stature = ch.height / 1.66;
    if (!ch.hands.swordGrip) ch.hands.swordGrip = ch.hands.makeSwordGrip(ch.sword.home.drawn.quaternion);
  }
  undo() {
    if (!this.applied) return;
    for (let i = 0; i < this.bones.length; i++) this.bones[i].quaternion.copy(this.saved[i]);
    this.applied = false;
  }
  rot(bone, axis, angle) {
    bone.parent.getWorldQuaternion(this.pq); this.q.setFromAxisAngle(axis, angle);
    bone.quaternion.premultiply(this.pq).premultiply(this.q).premultiply(this.pq.invert());
    bone.updateMatrixWorld(true);
  }
  basis() {
    this.ch.model.getWorldQuaternion(this.q);
    this.fwd.set(0, 0, 1).applyQuaternion(this.q); this.fwd.y = 0; this.fwd.normalize();
    this.right.crossVectors(this.fwd, UP);
  }
  apply(dt) {
    if (this.paused) return;
    const ch = this.ch, sword = ch.sword.frame, live = !!(sword && sword.u > 0 && sword.u < 1);
    const holdL = ch.weapons.yumi?.holder.visible, drawn = ch.weapons.tachiDrawn.holder.visible;
    const active = this.enabled && !this.hero.scripted && this.hero.alive !== false && !this.hero.down &&
      this.hero.fighter?.state === 'idle' && !this.hero.fighter.blocking && ch.currentName === ch.locoName && ch.style !== 'crouch' && !live && !drawn && !holdL;
    const rate = dt > 0 ? 1 - Math.exp(-dt * 18) : 0;
    this.weight += ((active ? 1 : 0) - this.weight) * rate;
    if (Math.abs(this.weight - (active ? 1 : 0)) < 1e-5) this.weight = active ? 1 : 0;
    // Draw layer and resting carry have a single union weight, never two sequential IKs.
    const runDrawn = drawn && !live && this.enabled && this.hero.fighter?.state === 'idle' && !this.hero.fighter.blocking && ch.currentName === ch.locoName && (ch.gait === 'jog' || ch.gait === 'run');
    const carryWant = active || runDrawn || (live && sword.u < .74 && this.carry > .99) ? 1 : live ? sword.pose.ikLeft : 0;
    this.carry += (carryWant - this.carry) * rate;
    if (Math.abs(this.carry - carryWant) < 1e-5) this.carry = carryWant;
    this.speed = this.hero.speed || 0;
    this.stanceClock += dt;
    const canStance = this.enabled && !this.hero.scripted && this.hero.alive !== false && !this.hero.down &&
      this.hero.fighter?.state === 'idle' && !this.hero.fighter.blocking && ch.currentName === ch.locoName && ch.style !== 'crouch' && !live && drawn && !holdL;
    this.carryOn = canStance && (ch.gait === 'jog' || ch.gait === 'run');
    this.guardOn = canStance && !this.carryOn;
    if (!live && this.drawBlend > .9 && this.guardOn) this.guardWeight = 1;
    this.drawBlend = live && sword.mode === 'drawing' ? sword.pose.handBlend : 0;
    const gw = this.guardOn ? 1 : 0, cw = this.carryOn ? 1 : 0;
    this.guardWeight += Math.max(-dt / this.stance.exit, Math.min(dt / (this.carryWeight > 0 ? this.stance.stop : this.stance.enter), gw - this.guardWeight));
    this.carryWeight += Math.max(-dt / (this.guardOn ? this.stance.stop : this.stance.exit), Math.min(dt / this.stance.enter, cw - this.carryWeight));
    if (canStance || (!live && drawn && this.guardWeight + this.carryWeight > 0)) {
      ch.model.updateMatrixWorld(true); this.basis();
      for (let i = 0; i < this.bones.length; i++) this.saved[i].copy(this.bones[i].quaternion);
      this.applied = true;
      this.applyStance(dt);
      return;
    }
    if (!drawn) this.drawReady = false;
    ch.model.updateMatrixWorld(true); this.basis();
    ch.bone('LeftUpLeg').getWorldPosition(this.a); ch.bone('LeftLeg').getWorldPosition(this.bv); this.bv.sub(this.a);
    const thigh = Math.atan2(this.bv.dot(this.fwd), -this.bv.y) / D2R;
    const acc = dt > 0 ? (this.speed - this.prevSpeed) / dt : 0; this.prevSpeed = this.speed;
    this.compute(this.targetPose, this.speed, thigh, acc, active, UPPER_ENV.reduce);
    this.curlWeight += ((active ? this.targetPose.fist : 0) - this.curlWeight) * rate;
    if (!(this.weight > 1e-5)) return;
    for (let i = 0; i < this.bones.length; i++) this.saved[i].copy(this.bones[i].quaternion);
    this.applied = true;
    const w = this.weight;
    // Absolute chest-line feedback includes both the original clip and M3's correction.
    springStep(this.leanState, this.targetPose.lean, UPPER.lean.omega, UPPER.lean.zeta, dt);
    const hip = ch.bone('Hips'), neck = ch.bone('neck'), spine = this.bones[0];
    for (let i = 0; i < 4; i++) {
      hip.getWorldPosition(this.p); neck.getWorldPosition(this.n); spine.getWorldPosition(this.a);
      this.n.sub(this.p); this.a.sub(this.p);
      const measured = Math.atan2(this.n.dot(this.fwd), this.n.y) / D2R;
      const gain = this.n.length() / Math.max(.1, this.n.length() - this.a.length());
      this.rot(spine, this.right, -(this.leanState.x - measured) * gain * w * D2R);
    }
    for (let i = 0; i < 2; i++) { this.bones[2 + i].quaternion.slerp(this.shoulders[i], w); this.bones[2 + i].updateMatrixWorld(true); }
    this.rot(this.bones[2], this.fwd, -28 * w * D2R);
    this.rot(this.bones[2], UP, 25 * w * D2R);
    const head = this.bones[1]; head.getWorldQuaternion(this.hq);
    this.n.copy(this.face).applyQuaternion(this.hq);
    const pitch = Math.asin(Math.max(-1, Math.min(1, this.n.y))) / D2R;
    this.axis.copy(this.n).cross(UP).normalize();
    this.rot(head, this.axis, (this.targetPose.head - pitch) * w * D2R);
    // Folded elbow: use the shipped opposite-thigh phase. No free-running sine/clock.
    const arm = this.bones[4], fore = this.bones[5], hand = this.bones[6];
    arm.getWorldPosition(this.a); fore.getWorldPosition(this.bv); hand.getWorldPosition(this.c);
    const l1 = this.a.distanceTo(this.bv), l2 = this.bv.distanceTo(this.c), angle = this.targetPose.arm * D2R, flex = this.targetPose.flex * D2R;
    this.goal.copy(this.a).addScaledVector(this.fwd, l1 * Math.sin(angle) + l2 * Math.sin(angle + flex));
    this.goal.y -= l1 * Math.cos(angle) + l2 * Math.cos(angle + flex);
    hip.getWorldPosition(this.p);
    this.n.copy(this.goal).sub(this.p);
    this.goal.addScaledVector(this.right, .19 - this.n.dot(this.right));
    this.hint.copy(this.a).addScaledVector(this.fwd, -.25); this.hint.y -= .35;
    this.goal.lerp(this.c, 1 - w);
    this.solve(arm, fore, hand, this.goal, this.hint);
  }
  // Desired sword frame, then the existing holder inverse gives the animation wrist.
  // +Y is toward the tip, +Z the cutting edge. Geometry remains attached to RightHand.
  stanceTarget(carry) {
    const ch = this.ch, cfg = this.stance, size = this.stature;
    ch.bone('Hips').getWorldPosition(this.p);
    const angle = cfg.pitch * D2R, yaw = cfg.yaw * D2R;
    if (carry) {
      this.swordY.copy(this.fwd).multiplyScalar(-Math.cos(yaw)).addScaledVector(this.right, Math.sin(yaw)).multiplyScalar(Math.cos(angle));
      this.swordY.y = Math.sin(angle);
      this.handPos.copy(this.p).addScaledVector(this.right, cfg.wristRight * size).addScaledVector(this.fwd, cfg.wristFwd * size);
      this.handPos.y += cfg.wristUp * size;
    } else {
      this.swordPos.copy(this.p).addScaledVector(this.fwd, cfg.pommelFwd * size).addScaledVector(this.right, cfg.pommelRight * size); this.swordPos.y += cfg.pommelUp * size;
      // The tip is measured at the actual end of the shipped blade, not at a proxy bone.
      const rise = (ch.root.position.y + (cfg.tipHeight + cfg.breath * Math.sin(this.stanceClock * 2 * Math.PI / cfg.period)) * size - this.swordPos.y) / (1.017 * this.weaponScale);
      this.swordY.copy(this.fwd).multiplyScalar(Math.sqrt(1 - Math.min(.95, rise * rise))); this.swordY.y = rise;
    }
    this.swordZ.copy(UP).negate().addScaledVector(this.swordY, this.swordY.y).normalize();
    this.swordX.crossVectors(this.swordY, this.swordZ).normalize();
    this.swordQuat.setFromRotationMatrix(this.basisMat.makeBasis(this.swordX, this.swordY, this.swordZ));
    if (carry) {
      const G = ch.hands.swordGrip;
      this.n.copy(G.wrist).multiplyScalar(this.weaponScale).applyQuaternion(this.swordQuat);
      this.swordPos.copy(this.handPos).sub(this.n);
    } else this.swordPos.addScaledVector(this.swordY, .137 * this.weaponScale);
    this.scale.setScalar(this.weaponScale);
    this.swordMat.compose(this.swordPos, this.swordQuat, this.scale);
    this.mat.copy(this.swordMat).multiply(ch.sword.drawnLocalInv).decompose(this.handPos, this.handQuat, this.scale);
  }
  drawEndpoint(pos, quat) {
    if (!this.enabled) return;
    this.basis();
    this.stanceTarget(this.speed > 2.1);
    pos.copy(this.handPos); quat.copy(this.handQuat);
  }
  applyStance(dt) {
    const ch = this.ch, hand = this.bones[6], arm = this.bones[4], fore = this.bones[5];
    if (this.carryWeight > 0) {
      this.bones[2].quaternion.slerp(this.shoulders[0], this.carryWeight); this.bones[2].updateMatrixWorld(true);
      this.rot(this.bones[2], this.fwd, -28 * this.carryWeight * D2R);
      this.rot(this.bones[2], UP, 25 * this.carryWeight * D2R);
    }
    hand.getWorldPosition(this.goal); hand.getWorldQuaternion(this.hq);
    if (this.guardWeight > 0) {
      this.stanceTarget(false); this.goal.lerp(this.handPos, this.guardWeight); this.hq.slerp(this.handQuat, this.guardWeight);
    }
    if (this.carryWeight > 0) {
      this.stanceTarget(true); this.goal.lerp(this.handPos, this.carryWeight); this.hq.slerp(this.handQuat, this.carryWeight);
    }
    // Limit the *gripping* wrist by moving the animation wrist (and therefore the sword).
    // The visible arm is never left behind its hilt.
    this.scale.set(1, 1, 1); this.mat.compose(this.goal, this.hq, this.scale).multiply(this.homeMat).multiply(ch.hands.swordGrip.inv);
    this.handPos.setFromMatrixPosition(this.mat);
    if (this.drawReady && dt > 0) {
      this.p.copy(this.drawPrevious); ch.root.localToWorld(this.p);
      this.n.copy(this.handPos).sub(this.p); const distance = this.n.length(), limit = this.stance.wristStep * dt * 60;
      if (distance > limit && distance < 1.5) this.goal.addScaledVector(this.n, limit / distance - 1);
    }
    arm.getWorldPosition(this.hint); this.hint.addScaledVector(this.right, .02); this.hint.y -= .5;
    this.extendShoulder(this.goal);
    this.solve(arm, fore, hand, this.goal, this.hint);
    hand.parent.getWorldQuaternion(this.pq); hand.quaternion.copy(this.pq.invert()).multiply(this.hq); hand.updateMatrixWorld(true);
  }
  extendShoulder(goal) {
    const arm = this.bones[4], fore = this.bones[5], hand = this.bones[6], clav = this.bones[3];
    arm.getWorldPosition(this.a); fore.getWorldPosition(this.bv); hand.getWorldPosition(this.c);
    const reach = (this.a.distanceTo(this.bv) + this.bv.distanceTo(this.c)) * .985;
    for (let i = 0; i < 4; i++) {
      arm.getWorldPosition(this.a); const extra = this.a.distanceTo(goal) - reach;
      if (extra <= 0) break;
      clav.getWorldPosition(this.p); this.n.copy(this.a).sub(this.p); const radius = this.n.length();
      this.c.copy(goal).sub(this.p).normalize(); this.n.normalize();
      this.q.setFromUnitVectors(this.n, this.c);
      const full = 2 * Math.acos(Math.min(1, Math.abs(this.q.w)));
      if (!(full > 1e-5 && radius > 1e-5)) break;
      this.q.slerp(this.identity, 1 - Math.min(1, extra / radius * 1.1 / full));
      this.rotateDelta(clav);
    }
  }
  sayaOrientation(side, point, axis, channel, out) {
    // Choose the cylinder roll nearest the shoulder, independently of the clip's open palm.
    // This avoids the unreachable wrist produced by Samurai_Walk's hand behind the back.
    out.setFromUnitVectors(side.curlAxis, axis);
    this.n.copy(channel).applyQuaternion(out); this.n.addScaledVector(axis, -this.n.dot(axis));
    side.vis[0].getWorldPosition(this.a);
    this.bv.copy(point).sub(this.a); this.bv.addScaledVector(axis, -this.bv.dot(axis));
    this.c.crossVectors(this.n, this.bv);
    const roll = Math.atan2(axis.dot(this.c), this.n.dot(this.bv));
    out.premultiply(this.q.setFromAxisAngle(axis, roll));
  }
  finishHands(dt) {
    if (this.paused) return;
    const ch = this.ch;
    for (let i = 0; i < 2; i++) {
      const side = i ? ch.hands.sides.Left : ch.hands.sides.Right;
      const arm = side.vis[0], fore = side.vis[1], hand = side.vis[2];
      hand.getWorldPosition(this.goal); hand.getWorldQuaternion(this.hq);
      // A held blade stays on its authored draw path. Capping only its visible wrist
      // would leave the hand behind the hilt (31 cm in the shipped draw/slash test).
      const grippingBlade = i === 0 && ch.weapons.tachiDrawn.holder.visible && !(ch.sword.frame?.u < .30 && side.g < .99);
      if (this.ready && dt > 0 && !grippingBlade) {
        this.p.copy(this.previous[i]); ch.root.localToWorld(this.p);
        this.n.copy(this.goal).sub(this.p);
        const distance = this.n.length(), limit = this.cfg.wristStep * dt * 60;
        if (distance > limit && distance < 1) {
          this.goal.copy(this.p).addScaledVector(this.n, limit / distance);
          fore.getWorldPosition(this.hint);
          this.solve(arm, fore, hand, this.goal, this.hint);
          hand.getWorldPosition(this.goal);
          if (this.goal.distanceTo(this.p) > limit + .002) {
            // An unreachable capped target is projected to the reach sphere by IK.
            // In that case keep the nearest reachable point to the previous wrist.
            this.goal.copy(this.p); this.solve(arm, fore, hand, this.goal, this.hint);
          }
          hand.parent.getWorldQuaternion(this.pq);
          hand.quaternion.copy(this.pq.invert()).multiply(this.hq); hand.updateMatrixWorld(true);
        }
      }
      hand.getWorldPosition(this.previous[i]); ch.root.worldToLocal(this.previous[i]);
    }
    ch.hands.sides.Right.vis[2].getWorldPosition(this.drawPrevious); ch.root.worldToLocal(this.drawPrevious);
    this.drawReady = true;
    this.ready = true;
  }
  measure() {
    const ch = this.ch; ch.root.updateWorldMatrix(true, true); this.basis();
    ch.bone('Hips').getWorldPosition(this.p); ch.bone('neck').getWorldPosition(this.n); this.n.sub(this.p);
    const lean = Math.atan2(this.n.dot(this.fwd), this.n.y) / D2R;
    ch.bone('Head').getWorldQuaternion(this.hq); this.n.copy(this.face).applyQuaternion(this.hq);
    const headPitch = Math.asin(Math.max(-1, Math.min(1, this.n.y))) / D2R;
    const R = ch.hands.sides.Right, L = ch.hands.sides.Left;
    R.vis[0].getWorldPosition(this.a); R.vis[1].getWorldPosition(this.bv); R.vis[2].getWorldPosition(this.c);
    const up = this.c.y - this.p.y, fwd = this.n.copy(this.c).sub(this.a).dot(this.fwd), right = this.n.copy(this.c).sub(this.p).dot(this.right);
    const elbowR = this.n.copy(this.a).sub(this.bv).angleTo(this.axis.copy(this.c).sub(this.bv)) / D2R;
    const armSpreadR = Math.atan2(Math.abs(this.n.copy(this.bv).sub(this.a).dot(this.right)), this.a.y - this.bv.y) / D2R;
    this.goal.set(0, .26, 0).applyMatrix4(ch.weapons.tachiHip.holder.matrixWorld); L.vis[2].getWorldPosition(this.c);
    const leftGap = this.c.distanceTo(this.goal);
    L.vis[1].getWorldPosition(this.bv); L.vis[0].getWorldPosition(this.a);
    const elbowDropL = this.a.y - this.bv.y, armSpreadL = Math.atan2(Math.abs(this.n.copy(this.bv).sub(this.a).dot(this.right)), elbowDropL) / D2R;
    this.n.copy(ch.hands.channels.saya.Left); L.vis[2].localToWorld(this.n);
    const gripGap = this.n.distanceTo(this.goal);
    return { on: this.enabled, speed: this.speed, gait: ch.gait, lean, headPitch, wristR: { up, fwd, right }, elbowR, armSpreadR,
      carryLeft: L.gSaya, leftGap, gripGap, leftReachError: L.last.error, elbowDropL, armSpreadL, curlR: Array.from(R.curl), drawn: ch.weapons.tachiDrawn.holder.visible, ...this.measureStance() };
  }
  measureStance() {
    const ch = this.ch, holder = ch.weapons.tachiDrawn.holder, L = ch.hands.sides.Left, R = ch.hands.sides.Right;
    const hip = ch.bone('Hips').getWorldPosition(new THREE.Vector3());
    const pommel = holder.localToWorld(new THREE.Vector3(0, -.137, 0)).sub(hip);
    const tip = holder.localToWorld(new THREE.Vector3(0, .88, -.0014));
    const base = holder.localToWorld(new THREE.Vector3(0, -.137, 0)), dir = tip.clone().sub(base);
    const edge = new THREE.Vector3(0, 0, 1).transformDirection(holder.matrixWorld);
    const wrist = R.vis[2].getWorldPosition(new THREE.Vector3()).sub(hip);
    const yawDeg = Math.atan2(dir.dot(this.right), dir.dot(this.fwd)) / D2R;
    const drop = s => s.vis[0].getWorldPosition(new THREE.Vector3()).y - s.vis[1].getWorldPosition(new THREE.Vector3()).y;
    return { guard: { on: this.guardOn, w: this.guardWeight,
      pommel: { fwd: pommel.dot(this.fwd), right: pommel.dot(this.right), up: pommel.y },
      tip: { height: tip.y - ch.root.position.y, yawDeg }, edgeDownDeg: Math.acos(Math.max(-1, Math.min(1, -edge.y))) / D2R,
      elbowDropL: drop(L), elbowDropR: drop(R), leftReachGap: L.last.error },
      carry: { on: this.carryOn, w: this.carryWeight, wrist: { right: wrist.dot(this.right), fwd: wrist.dot(this.fwd), up: wrist.y },
        tipPitchDeg: Math.atan2(dir.y, Math.hypot(dir.x, dir.z)) / D2R, tipYawDeg: Math.abs(yawDeg) - 180, tipHeight: tip.y - ch.root.position.y } };
  }
  solve(arm, fore, hand, goal, hint) {
    arm.getWorldPosition(this.a); fore.getWorldPosition(this.bv); hand.getWorldPosition(this.c);
    this.a.toArray(this.root); this.bv.toArray(this.mid); this.c.toArray(this.end); goal.toArray(this.target); hint.toArray(this.pole);
    solveTwoBoneInto(this.out, this.root, this.mid, this.end, this.target, this.pole);
    this.axis.copy(this.bv).sub(this.a).normalize(); this.n.fromArray(this.out.mid).sub(this.a).normalize();
    this.q.setFromUnitVectors(this.axis, this.n); this.rotateDelta(arm);
    fore.getWorldPosition(this.bv); hand.getWorldPosition(this.c);
    this.axis.copy(this.c).sub(this.bv).normalize(); this.n.fromArray(this.out.end).sub(this.bv).normalize();
    this.q.setFromUnitVectors(this.axis, this.n); this.rotateDelta(fore);
  }
  rotateDelta(bone) {
    bone.parent.getWorldQuaternion(this.pq);
    bone.quaternion.premultiply(this.pq).premultiply(this.q).premultiply(this.pq.invert()); bone.updateMatrixWorld(true);
  }
}
