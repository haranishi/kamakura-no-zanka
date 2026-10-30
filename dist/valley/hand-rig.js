// hand-rig.js — 指の骨を合成し、見える腕を柄・鞘へ寄せて握らせる（Three.js の結線。計算は hand-grip.js）。
// 刀は、これまでどおり「動作の手の骨」（RightHand）に付き、抜刀の層（sword-rig.js）も同じ骨を動かす。
// 見える腕は、その腕の写し（Arm・ForeArm・Hand の3本と、指の5本）で、頂点の重みを写しへ付け替えてある。
// この層は写しだけを動かすので、刀の位置と向き・抜刀の層・論理・既存の骨は、この層の有無で変わらない。
// 毎コマ、写しを動作の骨から写し直してから動かすので、写しに後処理が残ることもない。
import * as THREE from 'three';
import { HAND, measureHand, boneLayout, splitHandWeight, quantizeInfluences, fitGrip, solveTwoBoneInto, rollWithinReach } from './hand-grip.js';
import { shortestArc } from './arm-ik.js';
import { LAYER } from './sword-layer.js';
import { sayaCenter } from './sword-path.js';

export const HAND_RIG_WHO = new Set(['hero', 'soldier', 'officer']);   // 刀を持つ人物（兵の弓手も同じ模型）
const SIDES = ['Right', 'Left'];
const ARM_PARTS = ['Arm', 'ForeArm', 'Hand'];
const DIGITS = ['f0', 'f1', 'f2', 't0', 't1'];
const PER_SIDE = ARM_PARTS.length + DIGITS.length;
// 柄（weapons.js の tsuka：半径16.5mm・横に0.86倍の楕円）と鞘（半径22.5mm）の、指が巻きつく半径
export const GRIP_RADIUS = Object.freeze({ tsuka: 0.0155, saya: 0.0225 });
// 右手が柄のどこを握るか（柄の枠の y。鍔の面は 0.125）。左手が鞘のどこを持つか（sword-rig.js の LEFT_HOLD と同じ 0.26）
export const GRIP_SLIDE = Object.freeze({ tsuka: 0.084, saya: 0.26 });
// 柄のまわりの手の回り。ふだんは構えの握り（0）。腕が届かないコマ（実測：腰の柄を握って引き始める間は4〜14cm、振りの数コマ・歩きながらの抜刀）だけ、
// 右肩から届く弧の中で0に最も近い回りへ寄せる（hand-grip.js の rollWithinReach）。回りの変化は毎秒 rate rad まで（1コマで跳ばない）。
export const GRIP_ROLL = Object.freeze({ rate: 20, reach: 0.985 });
const GRIP_IN = 1 / 3;
const NO_FIT = Object.freeze({ fingers: Object.freeze([0, 0, 0]), thumb: Object.freeze([0, 0]) });
const EASE = 0.08;   // 刀が手から離れる・手へ戻るとき（落とす・降参・持ち替え）に、握りを緩める時間（秒）

// ---- 型の形（全員で共有）を1回だけ書き換える：腕の頂点を写しへ、手の頂点を指の骨へ
function prepareGeometry(mesh) {
  const geo = mesh.geometry;
  if (geo.userData.handRig) return geo.userData.handRig;
  const sk = mesh.skeleton, base = sk.bones.length, index = name => sk.bones.findIndex(b => b.name === name);
  const P = geo.attributes.position, J = geo.attributes.skinIndex, W = geo.attributes.skinWeight, count = P.count;
  const ji = new Uint8Array(count * 4), wi = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) for (let k = 0; k < 4; k++) { ji[i * 4 + k] = J.getComponent(i, k); wi[i * 4 + k] = Math.round(W.getComponent(i, k) * 255); }
  const v = new THREE.Vector3(), mat = new THREE.Matrix4(), sides = {};
  SIDES.forEach((side, s) => {
    const real = ARM_PARTS.map(p => index(side + p)), h = real[2], first = base + s * PER_SIDE;
    if (real.some(r => r < 0)) throw new Error('hand-rig: 骨が無い ' + side);
    mat.copy(sk.boneInverses[h]).multiply(mesh.bindMatrix);
    const pts = [], wts = [], ids = [];
    for (let i = 0; i < count; i++) {
      let w = 0; for (let k = 0; k < 4; k++) if (ji[i * 4 + k] === h) w += wi[i * 4 + k] / 255;
      if (w > 0) { v.fromBufferAttribute(P, i).applyMatrix4(mat); pts.push([v.x, v.y, v.z]); wts.push(w); ids.push(i); }
    }
    const down = new THREE.Vector3(0, -1, 0).transformDirection(mat);
    const m = measureHand(pts, wts, { down: down.toArray(), side });
    const layout = boneLayout(m);
    // 腕の3本は写しへ（重みはそのまま）
    for (let i = 0; i < count * 4; i++) { const r = real.indexOf(ji[i]); if (r >= 0 && wi[i] > 0) ji[i] = first + r; }
    // 手の重みを、手のひら・指・親指へ分ける（その頂点だけ量子化し直す）
    const verts = [];
    ids.forEach((i, t) => {
      const split = splitHandWeight(m, pts[t]), list = [];
      if (wts[t] >= 0.5) verts.push({ p: pts[t], s: split });
      for (let k = 0; k < 4; k++) {
        const j = ji[i * 4 + k], w = wi[i * 4 + k] / 255;
        if (!(w > 0)) continue;
        if (j !== first + 2) { list.push([j, w]); continue; }
        list.push([j, w * split.palm]);
        DIGITS.forEach((d, n) => { if (split[d] > 0) list.push([first + 3 + n, w * split[d]]); });
      }
      const q = quantizeInfluences(list);
      for (let k = 0; k < 4; k++) { ji[i * 4 + k] = q[k] ? q[k][0] : 0; wi[i * 4 + k] = q[k] ? q[k][1] : 0; }
    });
    // 逆結合行列：腕の写しは元と同じ。指は手の結合姿勢から平行移動しただけ
    const inv = [...real.map(r => sk.boneInverses[r]), ...DIGITS.map(d => new THREE.Matrix4().makeTranslation(-layout.world[d][0], -layout.world[d][1], -layout.world[d][2]).multiply(sk.boneInverses[h]))];
    // 握る形を、この型の実際の頂点で合わせる（型ごとに1回）。右手は柄、左手は鞘（左手で柄を握る両手持ちは二段目）
    const fit = side === 'Right' ? { tsuka: fitGrip(m, layout, verts, GRIP_RADIUS.tsuka) } : { saya: fitGrip(m, layout, verts, GRIP_RADIUS.saya) };
    sides[side] = { model: m, layout, first, inv, fit, vertices: ids.length };
  });
  geo.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(ji, 4));
  geo.setAttribute('skinWeight', new THREE.Uint8BufferAttribute(wi, 4, true));
  geo.userData.handRig = { base, sides, total: base + SIDES.length * PER_SIDE };
  return geo.userData.handRig;
}

// 読み込みのときに型を準備しておく（初めてその人物を作るコマに、型ごとに約50msの準備が乗らないように。実測）
export function prepareHands(scene) {
  let mesh = null; scene.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; });
  if (mesh) prepareGeometry(mesh);
}

// ---- 作業用（毎コマ確保しない）
const VA = new THREE.Vector3(), VB = new THREE.Vector3(), VC = new THREE.Vector3(), VD = new THREE.Vector3(), VE = new THREE.Vector3();
const PQ = new THREE.Quaternion(), DQ = new THREE.Quaternion(), TQ = new THREE.Quaternion(), HQ = new THREE.Quaternion(), QX = new THREE.Quaternion();
const TP = new THREE.Vector3(), HP = new THREE.Vector3(), SC = new THREE.Vector3(), AXIS = new THREE.Vector3(), SP = new THREE.Vector3();
const MT = new THREE.Matrix4(), MS = new THREE.Matrix4();
const ROOT = [0, 0, 0], MID = [0, 0, 0], END = [0, 0, 0], TGT = [0, 0, 0], HINT = [0, 0, 0], OUT = { mid: [0, 0, 0], end: [0, 0, 0], reached: true, error: 0 };
const arr3 = (v, a) => { a[0] = v.x; a[1] = v.y; a[2] = v.z; return a; };

// 骨を、ワールドの回転 delta だけ回す
function rotateBoneWorld(bone, delta) {
  bone.parent.getWorldQuaternion(PQ);
  bone.quaternion.premultiply(PQ).premultiply(delta);
  PQ.invert(); bone.quaternion.premultiply(PQ);
}
function setBoneWorldQuaternion(bone, q) {
  bone.parent.getWorldQuaternion(PQ); PQ.invert();
  bone.quaternion.copy(PQ).multiply(q);
}

export class HandRig {
  constructor(character) {
    this.ch = character;
    let mesh = null; character.model.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; });
    this.mesh = mesh;
    const info = prepareGeometry(mesh);
    const old = mesh.skeleton, bones = old.bones.slice(), inverses = old.boneInverses.slice();
    if (bones.length !== info.base) throw new Error('hand-rig: 骨の数が型と違う');
    this.sides = {};
    for (const side of SIDES) {
      const si = info.sides[side], real = ARM_PARTS.map(p => character.bones.get(side + p));
      const vis = ARM_PARTS.map(p => Object.assign(new THREE.Bone(), { name: side + p + '_view' }));
      real[0].parent.add(vis[0]); vis[0].add(vis[1]); vis[1].add(vis[2]);
      vis.forEach((b, k) => { b.position.copy(real[k].position); b.quaternion.copy(real[k].quaternion); b.scale.copy(real[k].scale); });
      const dig = DIGITS.map(d => Object.assign(new THREE.Bone(), { name: side + '_' + d }));
      vis[2].add(dig[0]); dig[0].add(dig[1]); dig[1].add(dig[2]); vis[2].add(dig[3]); dig[3].add(dig[4]);
      DIGITS.forEach((d, k) => dig[k].position.fromArray(si.layout[d]));
      bones.push(...vis, ...dig); inverses.push(...si.inv);
      const m = si.model;
      this.sides[side] = {
        side, real, vis, dig, model: m, fit: si.fit,
        curlAxis: new THREE.Vector3(...Object.values(si.fit)[0].axes.curl), thumbAxis: new THREE.Vector3(...Object.values(si.fit)[0].axes.thumb),
        g: null, gSaya: 0, roll: null, sayaSign: 0, curl: [0, 0, 0], thumb: [0, 0], target: { pos: new THREE.Vector3(), quat: new THREE.Quaternion() },
        armLen: real[1].position.length() + real[2].position.length(),   // 上腕＋前腕（局所の長さ。刀の枠も同じ縮尺）
        last: { g: 0, gSaya: 0, reached: true, error: 0 },
      };
    }
    mesh.bind(new THREE.Skeleton(bones, inverses), mesh.bindMatrix);
    old.dispose();
    this.enabled = true;
    this.swordGrip = null;   // 柄を握る手（右）の、柄の枠から見た手の逆行列（最初に刀を持ったときに作る）
    this.channels = { tsuka: {}, saya: {} };   // 円筒の中心線が通る、手の局所の点（握りを合わせた結果）
    for (const side of SIDES) for (const [k, f] of Object.entries(this.sides[side].fit)) this.channels[k][side] = new THREE.Vector3(...f.center);
  }

  // 右手で柄を握るときの、柄の枠 S から見た手の逆行列 M⁻¹（手 = S × M⁻¹）。M＝（回転 Q₀×握りの回転、位置 溝の点 − slide×軸）。
  // 握りの回転は、刀を手の骨へ付ける定位置（GRIP.tachiDrawn。抜刀の層の home）。Q₀ は、その柄の軸を手の溝の軸（指に直角）へ回す最短の回転。
  makeSwordGrip(homeQuat) {
    const s = this.sides.Right, axisInHand = new THREE.Vector3(0, 1, 0).applyQuaternion(homeQuat);
    const c = s.curlAxis.clone(), sign = axisInHand.dot(c) >= 0 ? 1 : -1, axis = c.multiplyScalar(sign);
    const q0 = new THREE.Quaternion(...shortestArc(axisInHand.toArray(), axis.toArray()));
    const rot = q0.clone().multiply(homeQuat);
    const pos = this.channels.tsuka.Right.clone().addScaledVector(axis, -GRIP_SLIDE.tsuka);
    const inv = new THREE.Matrix4().compose(pos, rot, new THREE.Vector3(1, 1, 1)).invert();
    return { inv, q0, axis, rot, pos, wrist: new THREE.Vector3().setFromMatrixPosition(inv) };   // wrist＝回り0の手首（柄の枠）
  }

  apply(dt = 0) {
    const ch = this.ch;
    // 毎コマ呼ぶので、配列・反復子・関数を作らない（添字で回す）
    for (let i = 0; i < SIDES.length; i++) { const s = this.sides[SIDES[i]]; for (let k = 0; k < 3; k++) { const r = s.real[k], v = s.vis[k]; v.position.copy(r.position); v.quaternion.copy(r.quaternion); v.scale.copy(r.scale); } }
    if (!this.enabled) {   // 比較用：写しを動作の骨のままにし、指を結合姿勢へ（＝この層が無いときと同じ見た目）
      for (let i = 0; i < SIDES.length; i++) { const dig = this.sides[SIDES[i]].dig; for (let k = 0; k < dig.length; k++) dig[k].quaternion.identity(); }
      return;
    }
    ch.model.updateMatrixWorld(true);
    const R = this.sides.Right, L = this.sides.Left;
    // ---- 右手：手にある刀の柄
    const drawn = ch.weapons.tachiDrawn, frame = ch.sword?.frame, live = !!(frame && frame.u > 0 && frame.u < 1);
    const holding = !!(drawn && drawn.holder.visible && drawn.object.parent === drawn.holder);
    // 抜刀の間の握りの重みは、腕が柄へ届く区間（u 0〜reachEnd）の後ろ寄り（GRIP_IN〜reachEnd）で入れる。動作の手が柄へ向かい始めた最初のコマで、
    // 握りの分のずれ（約12cm）まで一度に足すと、速い抜刀の最初のコマだけ手が大きく跳んだ（隣のコマの3.1倍。実測）。
    const gR = live ? smooth01((frame.u - GRIP_IN * LAYER.reachEnd) / ((1 - GRIP_IN) * LAYER.reachEnd)) : holding ? 1 : 0;
    R.g = R.g == null || live ? gR : R.g + (gR - R.g) * (dt > 0 ? 1 - Math.exp(-dt / EASE) : 0);
    if (R.g > 1e-4 && drawn) {
      if (!this.swordGrip) this.swordGrip = this.makeSwordGrip((ch.sword ? ch.sword.home.drawn.quaternion : drawn.holder.quaternion).clone());
      // 回り：0 を、右肩から届く弧へ寄せ、変化の速さを抑える（柄の枠で計算する）
      MS.copy(drawn.holder.matrixWorld).invert();
      R.vis[0].getWorldPosition(VA).applyMatrix4(MS);
      const w0 = this.swordGrip.wrist, want = rollWithinReach(w0.x, w0.y, w0.z, VA.x, VA.y, VA.z, R.armLen * GRIP_ROLL.reach, 0);
      const lim = GRIP_ROLL.rate * dt;
      let d = want - (R.roll ?? want); d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;   // 近いほうへ回す（±πをまたいでも遠回りしない）
      R.roll = R.roll == null || !(dt > 0) ? want : R.roll + Math.max(-lim, Math.min(lim, d));
      MT.copy(drawn.holder.matrixWorld);
      if (R.roll !== 0) MT.multiply(MS.makeRotationY(R.roll));            // 柄の軸（刀の +Y）のまわりに手を回す
      MT.multiply(this.swordGrip.inv).decompose(TP, TQ, SC);
      this.reach(R, TP, TQ, R.g);
    } else R.roll = 0;
    // ---- 左手：抜刀・納刀の間、鞘を持つ（抜刀の層の左手の重みと同じ）
    const hip = ch.weapons.tachiHip;
    L.gSaya = live && hip ? frame.pose.ikLeft : 0;
    if (L.gSaya > 1e-4) {
      MS.copy(hip.holder.matrixWorld);
      const y = GRIP_SLIDE.saya, z = sayaCenter(y);
      SP.set(0, y, z).applyMatrix4(MS);
      AXIS.set(0, 1, 0.018 * 4 * (1 - 2 * (y - 0.17) / 0.78) / 0.78).normalize().transformDirection(MS);
      this.holdCylinder(L, SP, AXIS, this.channels.saya.Left, L.gSaya);
    }
    // ---- 指
    for (let i = 0; i < SIDES.length; i++) {
      const side = SIDES[i], s = this.sides[side], gT = side === 'Right' ? (s.g || 0) : 0, gS = s.gSaya || 0, g = Math.min(1, gT + gS);
      const ft = s.fit.tsuka || NO_FIT, fs = s.fit.saya || NO_FIT;
      for (let k = 0; k < 3; k++) {
        s.curl[k] = HAND.relaxed[k] * (1 - g) + gT * ft.fingers[k] + gS * fs.fingers[k];
        s.dig[k].quaternion.setFromAxisAngle(s.curlAxis, s.curl[k]);
      }
      for (let k = 0; k < 2; k++) {
        s.thumb[k] = HAND.relaxedThumb[k] * (1 - g) + gT * ft.thumb[k] + gS * fs.thumb[k];
        s.dig[3 + k].quaternion.setFromAxisAngle(s.thumbAxis, s.thumb[k]);
      }
      s.last.g = s.g || 0; s.last.gSaya = s.gSaya || 0;
    }
  }

  // 円筒（中心 point・軸 axisWorld）を、いまの手の向きから最短の回転で、溝の点 chan で握る位置へ（重み w で混ぜる）
  holdCylinder(s, point, axisWorld, chan, w) {
    const hand = s.vis[2];
    hand.getWorldQuaternion(HQ);
    VD.copy(axisWorld).applyQuaternion(QX.copy(HQ).invert());          // 円筒の軸を、手の局所で
    // 溝の軸の向き（±c）は、握り始めのコマで決めて、握っている間は変えない（毎コマ選ぶと、内積が0をまたぐコマで手が半回転した。実測）
    if (!(s.last.gSaya > 0) || !s.sayaSign) s.sayaSign = VD.dot(s.curlAxis) >= 0 ? 1 : -1;
    const sign = s.sayaSign;
    VE.copy(s.curlAxis).multiplyScalar(sign);
    DQ.setFromUnitVectors(VD.normalize(), VE);                          // 手の局所で、円筒の軸 → 溝の軸
    TQ.copy(HQ).multiply(DQ.invert());                                  // 握る手の向き
    TP.copy(chan).applyQuaternion(TQ).negate().add(point);              // 溝の点が円筒の軸の点に来る手首の位置
    this.reach(s, TP, TQ, w);
  }

  // 見える手を、位置 pos・向き quat へ（いまの手との混ぜの重み w）。腕は二関節IK（肘は動作の肘の側）。
  reach(s, pos, quat, w) {
    const arm = s.vis[0], fore = s.vis[1], hand = s.vis[2];
    hand.getWorldPosition(HP); hand.getWorldQuaternion(HQ);
    s.target.pos.copy(HP).lerp(pos, w); s.target.quat.copy(HQ).slerp(quat, w);
    arm.getWorldPosition(VA); fore.getWorldPosition(VB); hand.getWorldPosition(VC);
    solveTwoBoneInto(OUT, arr3(VA, ROOT), arr3(VB, MID), arr3(VC, END), arr3(s.target.pos, TGT), arr3(VB, HINT));
    s.last.reached = OUT.reached; s.last.error = OUT.error;
    VD.copy(VB).sub(VA).normalize(); VE.set(OUT.mid[0] - VA.x, OUT.mid[1] - VA.y, OUT.mid[2] - VA.z).normalize();
    rotateBoneWorld(arm, DQ.setFromUnitVectors(VD, VE)); arm.updateMatrixWorld(true);
    fore.getWorldPosition(VB); hand.getWorldPosition(VC);
    VD.copy(VC).sub(VB).normalize(); VE.set(OUT.end[0] - VB.x, OUT.end[1] - VB.y, OUT.end[2] - VB.z).normalize();
    rotateBoneWorld(fore, DQ.setFromUnitVectors(VD, VE)); fore.updateMatrixWorld(true);
    setBoneWorldQuaternion(hand, s.target.quat); hand.updateMatrixWorld(true);
  }
}

function smooth01(x) { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); }
