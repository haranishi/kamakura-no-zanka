// sword-rig.js — 抜刀・納刀の見た目の結線（Three.js）。
// 進み具合 u と姿勢 pose は sword-layer.js（純粋）が決める。ここは、それを人物の骨・腰の鞘・刀の物体へ当てるだけ。
// 刀は1本の物体（右手の枠 tachiDrawn）。u=0 では腰の柄が見え、u>0 では動く刀が柄を兼ねる（腰の柄は隠す）。
//   u ≦ pullEnd：刀を鞘の曲線に沿って滑らせ（sword-path.js）、右手を腕IKで握りへ合わせる。鞘は帯の中で後ろへ引き、上体をひねる。
//   u ＞ pullEnd：刀は手に付いたまま（握りの誤差0）。手の目標を「鞘から抜けた位置」から「いまの動作の手」へ混ぜる。
// 骨の後処理なので、relaxArms のあとに呼ぶ。動作（mixer）は毎コマ骨を書き直すので、戻す処理は鞘の位置と刀の枠だけ。
import * as THREE from 'three';
import { swordOnSaya, swingBlend, blendOrientation, swingRollDeg } from './sword-path.js';
import { solveTwoBone, shortestArc } from './arm-ik.js';

const TWIST_BONES = [['Spine', 0.3], ['Spine01', 0.3], ['Spine02', 0.4]];
// 左手が鞘を持つ位置（鞘の枠・鯉口 y=0.168 の少し先）。
const LEFT_HOLD = [0.0, 0.26, 0.0];
const SHRUG_MAX = THREE.MathUtils.degToRad(40);   // 肩甲骨を前へ出す最大の角度
// 弾きの打ち合い（8.3a 第2周・見た目だけ）：hold 秒（ゲームの秒。命中の停止の間）保ち、fade 秒でもとの動作へ戻す。
// 刃は右肩から打ち合う点への向きに置き、握りから at（m）の所がその点を通る。手は肩から minReach 以上離す。左手は柄頭（pommel）へ。
const CLASH = { hold: 0.012, fade: 0.2, at: 0.62, minReach: 0.35, pommel: -0.1 };

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const arr = v => [v.x, v.y, v.z];
const diff = (a, b) => [a.x - b.x, a.y - b.y, a.z - b.z];
const ONE = V(1, 1, 1);
const Q3 = new THREE.Quaternion();   // 親の回転の作業用（rotateBoneWorld・setBoneWorldQuaternion だけが使う）

export class SwordRig {
  constructor(character) {
    this.ch = character;
    this.frame = null;            // { u, pose }（sword-layer.js の tick の戻り）
    this.saved = new Map();       // 触った骨の、触る前の局所の向き
    this.active = false;
    this.last = null;             // 直近コマの診断（試験・調整用）
    this.lastIk = {};
    this.memos = new Map();       // 向きの混ぜで、前のコマの結果を持つ（層が動いている間だけ）
    this.diag = { maxRollDeg: 0 };   // 試験・調整用：向きの混ぜで出会った、刃のまわりのねじれの最大（度）
    const d = character.weapons.tachiDrawn.holder, h = character.weapons.tachiHip.holder;
    this.home = {
      drawn: { position: d.position.clone(), quaternion: d.quaternion.clone(), scale: d.scale.clone() },
      hip: { position: h.position.clone(), quaternion: h.quaternion.clone() },
    };
    this.drawnLocalInv = new THREE.Matrix4().compose(this.home.drawn.position, this.home.drawn.quaternion, this.home.drawn.scale).invert();
    // 鞘の軸（切先の向き）を、腰の骨の局所で。鞘を引く向きに使う。
    this.sayaAxis = V(0, 1, 0).applyQuaternion(this.home.hip.quaternion);
    // 刃の向き（+Y）を、手の骨の向きの局所で（握りの枠の回転を通す）
    this.bladeLocal = V(0, 1, 0).applyQuaternion(this.home.drawn.quaternion).toArray();
    this.twistSign = 1;           // 上体のひねりの向き（左へ +1）。見た目の確認で符号を決める
    this.useLeft = true;
  }

  setFrame(frame) { this.frame = frame || null; }
  reset() { this.undo(); this.frame = null; this.active = false; this.last = null; this.clashAt = null; this.memos.clear(); this.restore(0); }

  // 触る骨は、触る前の局所の向きを控える。手の骨など、動作が毎コマは書き直さない骨に、後処理が残り続けないよう、次のコマの最初に戻す。
  touch(bone) { if (!this.saved.has(bone)) this.saved.set(bone, bone.quaternion.clone()); }
  undo() { for (const [bone, q] of this.saved) bone.quaternion.copy(q); this.saved.clear(); }

  // 骨を、ワールドの回転 delta だけ回す（親の回転を介して局所へ戻す）。
  rotateBoneWorld(bone, delta) {
    this.touch(bone);
    bone.parent.getWorldQuaternion(Q3);
    bone.quaternion.premultiply(Q3).premultiply(delta);
    Q3.invert(); bone.quaternion.premultiply(Q3);
    bone.updateMatrixWorld(true);
  }
  // 骨のワールドの向きを q にそろえる。
  setBoneWorldQuaternion(bone, q) {
    this.touch(bone);
    bone.parent.getWorldQuaternion(Q3); Q3.invert();
    bone.quaternion.copy(Q3).multiply(q);
    bone.updateMatrixWorld(true);
  }

  // 層が動いていないときの定常状態（納刀＝腰の柄が見える／抜刀＝手の刀が見える）へ戻す
  restore(u) {
    const ch = this.ch, d = ch.weapons.tachiDrawn.holder, h = ch.weapons.tachiHip.holder;
    h.position.copy(this.home.hip.position);
    d.position.copy(this.home.drawn.position); d.quaternion.copy(this.home.drawn.quaternion); d.scale.copy(this.home.drawn.scale);
    d.visible = u >= 1; ch.weapons.tachiHipHilt.object.visible = u < 1;
  }

  // 向きの混ぜ（世界の向き qa → qf を h だけ）。key ごとに、前のコマの結果に沿って連続させる（sword-path.js）。
  // swing＝刃が上へ振れる曲線（抜いた直後の後ろ向きの刃 ⇄ 構え）。blend＝単純な混ぜ（手の向きを、動作のままから握りへ）。
  memo(key) { let m = this.memos.get(key); if (!m) this.memos.set(key, m = {}); return m; }
  swing(key, qa, qf, h) {
    this.diag.maxRollDeg = Math.max(this.diag.maxRollDeg, swingRollDeg(qa.toArray(), qf.toArray(), this.bladeLocal));
    const q = swingBlend(qa.toArray(), qf.toArray(), h, this.bladeLocal, undefined, this.memo(key));
    return new THREE.Quaternion(q[0], q[1], q[2], q[3]);
  }
  blend(key, qa, qf, w) {
    const q = blendOrientation(qa.toArray(), qf.toArray(), w, this.memo(key));
    return new THREE.Quaternion(q[0], q[1], q[2], q[3]);
  }

  // 刀の枠（世界）。鞘の枠 × 鞘の曲線に沿って s だけ抜いた姿勢。
  swordOnAxis(s) {
    const p = swordOnSaya(s);
    return new THREE.Matrix4().compose(V(...p.position), new THREE.Quaternion(...p.quaternion), ONE).premultiply(this.ch.weapons.tachiHip.holder.matrixWorld);
  }

  // 弾きの打ち合い（8.3a 第2周）：受けた刃の上の点 point（[x,y,z]・世界）へ、刃を通す。すぐ当て、以降は apply が毎コマ当て直す。
  clash(point) {
    this.clashFrom = this.ch.time; this.clashAt = V(point[0], point[1], point[2]);
    this.memos.delete('handRight'); this.memos.delete('handLeft');
    this.applyClash();
  }
  applyClash() {
    const p = this.clashAt, ch = this.ch;
    if (!p) return;
    const x = Math.min(1, Math.max(0, (ch.time - this.clashFrom - CLASH.hold) / CLASH.fade)), w = 1 - x * x * (3 - 2 * x);
    const arm = ch.bones.get('RightArm'), drawn = ch.weapons.tachiDrawn?.holder;
    if (!(w > 1e-3) || !arm || !drawn?.visible || this.active) { this.clashAt = null; return; }
    ch.model.updateMatrixWorld(true);
    const s = arm.getWorldPosition(V()), dir = p.clone().sub(s), L = dir.length();
    if (!(L > 1e-4)) { this.clashAt = null; return; }
    dir.divideScalar(L);
    const hand = p.clone().addScaledVector(dir, -Math.min(CLASH.at, Math.max(CLASH.minReach, L - CLASH.minReach)));
    const hq = drawn.getWorldQuaternion(new THREE.Quaternion()), y = V(0, 1, 0).applyQuaternion(hq);
    const blade = new THREE.Quaternion(...shortestArc(arr(y), arr(dir))).multiply(hq);           // 刃を dir へ（刃のまわりのねじれは今のまま）
    this.solveArm('Right', hand, blade.multiply(this.home.drawn.quaternion.clone().invert()), w);   // 手の向き＝刀の枠の向き×枠の局所の逆
    if (this.useLeft) { ch.model.updateMatrixWorld(true); this.solveArm('Left', V(0, CLASH.pommel, 0).applyMatrix4(drawn.matrixWorld), null, w * 0.9); }
    ch.model.updateMatrixWorld(true);
  }

  apply() {
    const f = this.frame, ch = this.ch;
    if (!f || !(f.u > 0 && f.u < 1)) {
      // 動いていた層が終わったコマで、定常状態（納刀／抜刀）へ戻す。それ以外は何もしない（動作と setTachi に任せる）。
      if (this.active) this.restore(f ? f.u : 0);
      this.active = false; this.last = null;
      if (this.clashAt) this.applyClash(); else this.memos.clear();   // 打ち合いの間は、向きの混ぜの前のコマを持ち越す
      return;
    }
    this.active = true;
    const { pose } = f, bones = ch.bones, drawn = ch.weapons.tachiDrawn.holder, hip = ch.weapons.tachiHip.holder;

    // 1. 鞘を帯の中で後ろへ引く（左手が引く）。上体を左へひねり、右肩を鞘へ近づける。
    hip.position.copy(this.home.hip.position).addScaledVector(this.sayaAxis, pose.sayaBack);
    if (pose.twistDeg !== 0) {
      ch.model.updateMatrixWorld(true);
      const up = V(0, 1, 0).transformDirection(ch.model.matrixWorld);
      for (const [name, w] of TWIST_BONES) {
        const b = bones.get(name); if (!b) continue;
        this.rotateBoneWorld(b, new THREE.Quaternion().setFromAxisAngle(up, THREE.MathUtils.degToRad(pose.twistDeg * w * this.twistSign)));
      }
    }
    ch.model.updateMatrixWorld(true);
    hip.updateWorldMatrix(true, false);

    // 2. 右手首の目標。u≦pullEnd は刀の握りそのもの、それ以降は「抜けた位置」から「いまの動作の手」へ混ぜる。
    const hand = bones.get('RightHand');
    hand.updateWorldMatrix(true, false);
    const swordAxis = this.swordOnAxis(pose.s);
    const wristAxis = swordAxis.clone().multiply(this.drawnLocalInv);
    const onAxis = pose.handBlend <= 0;
    let wrist = wristAxis;
    if (!onAxis) {
      const pa = V(), pf = V(), qa = new THREE.Quaternion(), qf = new THREE.Quaternion();
      wristAxis.decompose(pa, qa, V()); hand.matrixWorld.clone().decompose(pf, qf, V());
      wrist = new THREE.Matrix4().compose(pa.lerp(pf, pose.handBlend), this.swing('wrist', qa, qf, pose.handBlend), ONE);
    }
    const wp = V(), wq = new THREE.Quaternion();
    wrist.decompose(wp, wq, V());
    this.solveArm('Right', wp, wq, pose.ikRight, !onAxis);

    // 3. 左手は鞘を持つ（位置だけ。手の向きは動作のまま）。
    if (this.useLeft && pose.ikLeft > 0) this.solveArm('Left', V(...LEFT_HOLD).applyMatrix4(hip.matrixWorld), null, pose.ikLeft);
    ch.model.updateMatrixWorld(true);

    // 4. 刀の枠：鞘の上にある間は、世界の位置を保つように手の骨の局所を決める。手に付いたら定位置。
    ch.weapons.tachiHipHilt.object.visible = false; drawn.visible = true;
    if (onAxis) {
      hand.updateWorldMatrix(true, false);
      new THREE.Matrix4().copy(hand.matrixWorld).invert().multiply(swordAxis).decompose(drawn.position, drawn.quaternion, drawn.scale);
    } else {
      drawn.position.copy(this.home.drawn.position); drawn.quaternion.copy(this.home.drawn.quaternion); drawn.scale.copy(this.home.drawn.scale);
    }
    this.last = { u: f.u, s: pose.s, onAxis, ik: this.lastIk };
  }

  // 二関節IKで手首を target へ。weight は FK の手首との混ぜ具合。targetQuat があれば手の向きも混ぜる。
  solveArm(side, target, targetQuat, weight, fullOrientation = false) {
    const bones = this.ch.bones, arm = bones.get(side + 'Arm'), fore = bones.get(side + 'ForeArm'), hand = bones.get(side + 'Hand');
    if (!arm || !fore || !hand || !(weight > 0)) return;
    let root = arm.getWorldPosition(V()), mid = fore.getWorldPosition(V()), end = hand.getWorldPosition(V());
    const handQ = hand.getWorldQuaternion(new THREE.Quaternion());
    const goal = end.clone().lerp(target, Math.min(1, weight));
    // 腕だけでは届かないときは、肩甲骨（鎖骨の骨）を目標へ前へ出して、届く距離を伸ばす（人は握りへ肩を出して届かせる）。
    const clav = bones.get(side + 'Shoulder');
    if (clav) {
      const reach = (root.distanceTo(mid) + mid.distanceTo(end)) * 0.985, extra = root.distanceTo(goal) - reach;
      if (extra > 0) {
        const pivot = clav.getWorldPosition(V()), r = root.clone().sub(pivot), toGoal = goal.clone().sub(pivot);
        if (r.length() > 1e-4 && toGoal.length() > 1e-4) {
          const full = new THREE.Quaternion(...shortestArc(arr(r), arr(toGoal.setLength(r.length()))));
          const fullAngle = 2 * Math.acos(Math.min(1, Math.abs(full.w)));
          const angle = Math.min(SHRUG_MAX, extra / r.length() * 1.1, fullAngle);
          if (angle > 1e-4) {
            this.rotateBoneWorld(clav, new THREE.Quaternion().slerp(full, angle / fullAngle));
            root = arm.getWorldPosition(V()); mid = fore.getWorldPosition(V()); end = hand.getWorldPosition(V());
          }
        }
      }
    }
    const r = solveTwoBone({ root: arr(root), mid: arr(mid), end: arr(end), target: arr(goal), hint: arr(mid) });
    this.lastIk[side] = { reached: r.reached, error: r.error };
    // 上腕：肘の位置へ
    this.rotateBoneWorld(arm, new THREE.Quaternion(...shortestArc(diff(mid, root), [r.mid[0] - root.x, r.mid[1] - root.y, r.mid[2] - root.z])));
    // 前腕：手首の位置へ（上腕を回したあとの肘・手首から）
    const mid2 = fore.getWorldPosition(V()), end2 = hand.getWorldPosition(V());
    this.rotateBoneWorld(fore, new THREE.Quaternion(...shortestArc(diff(end2, mid2), [r.end[0] - mid2.x, r.end[1] - mid2.y, r.end[2] - mid2.z])));
    // 手の向き
    this.setBoneWorldQuaternion(hand, !targetQuat ? handQ : fullOrientation ? targetQuat : this.blend('hand' + side, handQ, targetQuat, Math.min(1, weight)));
  }
}
