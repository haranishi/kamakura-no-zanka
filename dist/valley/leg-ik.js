// leg-ik.js — 脚のIKと接地（design-locomotion-smooth §5・§12、M2b）。見た目の層：論理の位置・向き・戦闘は変えない。
// 人物の更新を「mixer・接地通知」と「この接地→体幹ばね→腕→刀→握り」に分けたあと（characters.js の finishPose）、押し分けの後に呼ぶ。
// 1. どの足が着いているか：mixer が動かしている周期の動作のうち重み0.5以上の物の位相を gait-table の「足裏が平ら」な区間で見る。
//    無ければ（待ち・混ぜの途中）両足を着いているとみなす。移動の動作が今の動作でない（技・回避・受け・座りなど）ときは使わない（足を放す）。
// 2. 着いた足は世界の位置に留める（leg-plant.js）。高さは足の下の地面（terrain.heightAt）＋動作の足首の高さ、傾きは地面の傾き。
// 3. 骨盤は、留めた足・低い足に届くまで下げる（上げない）。それでも届かない足は放す。
// 4. 二関節IK（hand-grip.js の solveTwoBoneInto＝arm-ik.js の幾何の出力を使い回す版）で太もも・すねを回し、足の向きは動作の世界の向きのまま（＋傾き）。
// 前のコマの補正は undo で戻してから mixer を当てる（二重に掛けない）。毎コマの新規確保をしない。
import * as THREE from 'three';
import { solveTwoBoneInto } from './hand-grip.js';
import { GAIT_TABLE } from './gait-table.js';
import { PLANT, LOCK, SETTLE, FREE, createFoot, resetFoot, stepFoot, releaseFoot, maybeSettle, abortSettle, dropToReach, follow, inFlat } from './leg-plant.js';

const SIDES = [['LeftUpLeg', 'LeftLeg', 'LeftFoot'], ['RightUpLeg', 'RightLeg', 'RightFoot']];
const V = new THREE.Vector3(), W = new THREE.Vector3(), Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), N = new THREE.Vector3(), FWD = new THREE.Vector3();
const A3 = [0, 0, 0], B3 = [0, 0, 0], C3 = [0, 0, 0], T3 = [0, 0, 0], H3 = [0, 0, 0], OUT = { mid: [0, 0, 0], end: [0, 0, 0], reached: false, error: 0 }, FO = [0, 0, 0, 0];
const STANCE = [false, false];

export class LegRig {
  constructor(ch) {
    this.ch = ch;
    this.hips = ch.bone('Hips');
    this.legs = SIDES.map(([u, l, f]) => ({ up: ch.bone(u), low: ch.bone(l), foot: ch.bone(f) }));
    this.ok = !!this.hips && this.legs.every(l => l.up && l.low && l.foot);
    this.feet = [createFoot(), createFoot()];
    this.drop = 0; this.idleT = 0; this.applied = false; this.reset = true; this.rootX = 0; this.rootZ = 0;
    // undo 用の元の値（腰の位置と、脚の骨の回り）
    this.hipsPos = new THREE.Vector3();
    this.saved = this.legs.map(() => [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()]);
    // 動作の足首の世界の位置・向き（このコマの）
    this.anim = this.legs.map(() => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() }));
    this.want = this.legs.map(() => new THREE.Vector3());
    this.tilt = [0, 0];
  }

  undo() {
    if (!this.applied) return;
    this.hips.position.copy(this.hipsPos);
    for (let i = 0; i < 2; i++) { const l = this.legs[i], s = this.saved[i]; l.up.quaternion.copy(s[0]); l.low.quaternion.copy(s[1]); l.foot.quaternion.copy(s[2]); }
    this.applied = false;
  }

  // 着いている足（STANCE へ書く）。戻り値：'cycle'＝周期の動作の位相で決めた／'both'＝待ち・混ぜの途中で両足／null＝移動の動作でない
  stance() {
    const ch = this.ch, meta = ch.roster.meta.clips, mixer = ch.mixer;
    if (!ch.locoName || ch.currentName !== ch.locoName) return null;
    let best = null, bw = 0, bn = null;
    for (const [name, a] of ch.actions) {
      const m = meta[name]; if (!m?.contacts || m.kind !== 'cycle' || !a.enabled || (mixer._isActiveAction && !mixer._isActiveAction(a))) continue;
      const w = a.getEffectiveWeight(); if (w > bw) { bw = w; best = a; bn = name; }
    }
    if (!best || bw < 0.5) { STANCE[0] = STANCE[1] = true; return 'both'; }
    const m = meta[bn], ph = (best.time / m.seconds) % 1, fl = GAIT_TABLE[bn]?.[ch.who]?.flat;
    STANCE[0] = inFlat(fl ? fl.left : m.contacts.left, ph); STANCE[1] = inFlat(fl ? fl.right : m.contacts.right, ph);
    return 'cycle';
  }

  // 1コマ。terrain＝heightAt を持つ地面、active＝この人物に脚のIKを使うか（範囲の外・演出の間は false：足を放して何もしない）
  apply(dt, terrain, active) {
    if (!this.ok) return;
    const ch = this.ch, feet = this.feet;
    if (!active || this.reset) {
      if (this.reset || feet[0].mode !== FREE || feet[1].mode !== FREE || this.drop) { resetFoot(feet[0]); resetFoot(feet[1]); this.drop = 0; this.idleT = 0; }
      this.reset = false;
      if (!active) return;
    }
    const kind = this.stance();
    const moving = kind != null;
    if (!moving && feet[0].mode === FREE && feet[1].mode === FREE && this.drop < 1e-5) return;   // 技・回避などで足を放し終えた
    ch.model.updateMatrixWorld(true);
    const rootY = ch.root.position.y;
    // 元の値を残す（undo）
    this.hipsPos.copy(this.hips.position);
    for (let i = 0; i < 2; i++) { const l = this.legs[i], s = this.saved[i]; s[0].copy(l.up.quaternion); s[1].copy(l.low.quaternion); s[2].copy(l.foot.quaternion); }
    this.applied = true;
    // 足の目標
    // 置き直しの一歩は、止まって（模型の根が動かず）待ちの姿で両足を着いている間だけ。動き出したら、その場へ足を下ろす
    const rp = ch.root.position, still = !(dt > 0) || Math.hypot(rp.x - this.rootX, rp.z - this.rootZ) < 0.05 * dt;
    this.rootX = rp.x; this.rootZ = rp.z;
    this.idleT = kind === 'both' && ch.gait === 'idle' && still ? this.idleT + dt : 0;
    for (let i = 0; i < 2; i++) { const an = this.anim[i]; this.legs[i].foot.getWorldPosition(an.p); this.legs[i].foot.getWorldQuaternion(an.q); }
    if (!(this.idleT > 0)) for (let i = 0; i < 2; i++) abortSettle(feet[i], this.anim[i].p.x, this.anim[i].p.z);
    else if (this.idleT > PLANT.settleDelay) maybeSettle(feet, this.anim[0].p.x, this.anim[0].p.z, this.anim[1].p.x, this.anim[1].p.z);
    let need = 0;
    for (let i = 0; i < 2; i++) {
      const f = feet[i], an = this.anim[i];
      stepFoot(f, moving && STANCE[i], an.p.x, an.p.z, dt, FO);
      const gx = FO[0], gz = FO[1], ground = terrain.heightAt(gx, gz) - rootY;
      f.gy = ground;   // 地面の高さはそのまま（ならすと、下り坂で着いた足が根の下がる分だけ遅れて沈んだ：土手で11cm）
      this.want[i].set(gx, an.p.y + f.gy + FO[2], gz);
      this.tilt[i] = FO[3];
      this.legs[i].up.getWorldPosition(V);
      const R = this.legLength(i) * PLANT.reach, d = dropToReach(V.y, this.want[i].y, Math.hypot(gx - V.x, gz - V.z), R);
      if (d > PLANT.maxDrop && (f.mode === LOCK || f.mode === SETTLE)) releaseFoot(f, an.p.x, an.p.z);   // 届かない：放す（次のコマから差を戻す）
      else if (d > need) need = Math.min(d, PLANT.maxDrop);   // 遊脚が届かないときも、上限までは下げて近づける
    }
    this.drop = Math.min(PLANT.maxDrop, follow(this.drop, need, need > this.drop ? PLANT.dropDown : PLANT.dropUp, dt));   // 下げるのは速く（遅れると足が届かず浮く）、戻すのはゆっくり
    if (this.drop < 1e-5 && need === 0) this.drop = 0;
    if (this.drop > 0) {
      this.hips.getWorldPosition(V); V.y -= this.drop;
      this.hips.parent.worldToLocal(V); this.hips.position.copy(V); this.hips.updateMatrixWorld(true);
    }
    // 膝の向きの目印：模型の前（+Z）
    ch.model.getWorldQuaternion(Q); FWD.set(0, 0, 1).applyQuaternion(Q);
    for (let i = 0; i < 2; i++) this.solveLeg(i, terrain, FWD);
  }

  legLength(i) {
    const l = this.legs[i];
    if (!l.len) { l.up.getWorldPosition(V); l.low.getWorldPosition(W); const a = V.distanceTo(W); l.foot.getWorldPosition(V); l.len = a + W.distanceTo(V); }
    return l.len;
  }

  solveLeg(i, terrain, fwd) {
    const l = this.legs[i], t = this.want[i], an = this.anim[i];
    l.up.getWorldPosition(V); A3[0] = V.x; A3[1] = V.y; A3[2] = V.z;
    l.low.getWorldPosition(W); B3[0] = W.x; B3[1] = W.y; B3[2] = W.z;
    l.foot.getWorldPosition(V); C3[0] = V.x; C3[1] = V.y; C3[2] = V.z;
    const moved = Math.abs(t.x - V.x) + Math.abs(t.y - V.y) + Math.abs(t.z - V.z);
    if (moved > 1e-5) {
      T3[0] = t.x; T3[1] = t.y; T3[2] = t.z;
      H3[0] = W.x + fwd.x * 0.3; H3[1] = W.y + fwd.y * 0.3; H3[2] = W.z + fwd.z * 0.3;
      solveTwoBoneInto(OUT, A3, B3, C3, T3, H3);
      // 太もも：股→膝の向きを新しい膝へ
      rotateBone(l.up, V.set(B3[0] - A3[0], B3[1] - A3[1], B3[2] - A3[2]), W.set(OUT.mid[0] - A3[0], OUT.mid[1] - A3[1], OUT.mid[2] - A3[2]));
      // すね：膝→足首の向きを新しい足首へ
      l.low.getWorldPosition(W); l.foot.getWorldPosition(V);
      V.sub(W); N.set(OUT.end[0] - W.x, OUT.end[1] - W.y, OUT.end[2] - W.z);
      rotateBone(l.low, V, N);
    }
    // 足の向き：動作の世界の向きのまま（太もも・すねを回しても足の向きは変えない）＋着いている足は地面の傾きへ
    const k = this.tilt[i];
    if (!(moved > 1e-5) && !(k > 0)) return;
    Q.copy(an.q);
    if (k > 0) {
      const e = 0.12, x = t.x, z = t.z, h = terrain.heightAt;
      const dx = (h(x + e, z) - h(x - e, z)) / (2 * e), dz = (h(x, z + e) - h(x, z - e)) / (2 * e);
      N.set(-dx, 1, -dz).normalize();
      const ang = Math.min(PLANT.maxTilt, UP.angleTo(N)) * k;
      if (ang > 1e-4) { W.crossVectors(UP, N).normalize(); Q2.setFromAxisAngle(W, ang); Q.premultiply(Q2); }
    }
    setWorldQuaternion(l.foot, Q);
  }
}

// 骨を、世界の向き from を to へ向ける最短の回りだけ回す（親の局所へ直して）
const PQ = new THREE.Quaternion(), RQ = new THREE.Quaternion(), WQ = new THREE.Quaternion();
function rotateBone(bone, from, to) {
  if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) return;
  RQ.setFromUnitVectors(from.normalize(), to.normalize());
  bone.getWorldQuaternion(WQ); WQ.premultiply(RQ);
  setWorldQuaternion(bone, WQ);
}
function setWorldQuaternion(bone, q) {
  bone.parent.getWorldQuaternion(PQ);
  bone.quaternion.copy(PQ.invert().multiply(q));
  bone.updateMatrixWorld(true);
}
