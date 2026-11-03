// hand-rig.js — 指の骨を合成し、見える腕を柄・鞘へ寄せて握らせる（Three.js の結線。計算は hand-grip.js）。
// 刀は、これまでどおり「動作の手の骨」（RightHand）に付き、抜刀の層（sword-rig.js）も同じ骨を動かす。
// 見える腕は、その腕の写し（Arm・ForeArm・Hand の3本と、指の14本）で、頂点の重みを写しへ付け替えてある。
// この層は写しだけを動かすので、刀の位置と向き・抜刀の層・論理・既存の骨は、この層の有無で変わらない。
// 毎コマ、写しを動作の骨から写し直してから動かすので、写しに後処理が残ることもない。
import * as THREE from 'three';
import { HAND, FINGERS, DIGIT_KEYS, measureHand, boneLayout, splitHandWeight, quantizeInfluences, fitGrip, gripExtent, solveTwoBoneInto, rollWithinReach } from './hand-grip.js';
import { shortestArc } from './arm-ik.js';
import { LAYER } from './sword-layer.js';
import { sayaCenter } from './sword-path.js';

export const HAND_RIG_WHO = new Set(['hero', 'soldier', 'officer']);   // 刀を持つ人物（兵の弓手も同じ模型）
const SIDES = ['Right', 'Left'];
const ARM_PARTS = ['Arm', 'ForeArm', 'Hand'];
const PER_SIDE = ARM_PARTS.length + DIGIT_KEYS.length;
// 柄（weapons.js の tsuka：半径16.5mm・横に0.86倍の楕円）と鞘（半径22.5mm）の、指が巻きつく半径
export const GRIP_RADIUS = Object.freeze({ tsuka: 0.0155, saya: 0.0225 });
// 右手が柄のどこを握るか（柄の枠の y。鍔の下の面は 0.125）。手の幅が鍔へ掛かる型は、鍔から tsubaClear 離れる所まで下げる（兵の人差し指が鍔に掛かった）。
// 左手が鞘のどこを持つか（sword-rig.js の LEFT_HOLD と同じ 0.26）。両手持ちの左手は、小指の側が柄頭（−0.125）の縁に来る所。
export const GRIP_SLIDE = Object.freeze({ tsuka: 0.084, saya: 0.26, tsubaFace: 0.125, tsubaClear: 0.004, tsubaRadius: 0.041, pommel: -0.125, pommelOver: 0.004 });
// 柄のまわりの手の回り。ふだんは構えの握り（0）。腕が届かないコマ（実測：腰の柄を握って引き始める間は4〜14cm、振りの数コマ・歩きながらの抜刀）だけ、
// 肩から届く弧の中で0に最も近い回りへ寄せる（hand-grip.js の rollWithinReach）。回りの変化は毎秒 rate rad まで（1コマで跳ばない）。
// 抜刀・納刀の引く間（u≦pullEnd）は、構えの握りから draw rad 回した握り（親指が上・四指が下）を目指し、刃を構えへ振る間に0へ戻す。
// 構えの握りのまま腰の柄を握ると、真上から手の甲だけが見え、平手を乗せたように読めた（評価の指摘6）。−0.6〜−1.2 を u0.3〜0.8 で撮り比べ、
// −0.9〜−1.2 で親指が上・指が下に巻き、u0.3 から腕が届いた。親指の先が真上に来る回り（約±π）を目指すと、下から支える握りになり、抜く間に手が柄を1周した（実測）
// 刃を構えへ振る前半（u pullEnd〜0.82）は、さらに swing まで回す（−1.0 のまま振ると、u0.7〜0.88 で前腕の袖が鍔を横切り、袖に黒い四角が出た。
// 回りを −1.6〜0.8 で撮り比べ、u0.75〜0.8 で横切らないのは −1.4 より深い回りだけ、u0.85 からは −1.6〜−0.2 のどれでも横切らなかった。実測）
export const GRIP_ROLL = Object.freeze({ rate: 20, reach: 0.985, draw: -1.0, swing: -1.5, swingIn: 0.75, swingOut: 0.82 });
// 抜刀・納刀の進み具合 u での、目指す回り（構えの握りからの回り。u=1 と、抜いていないときは0）
export function drawRoll(u) {
  const { draw, swing, swingIn, swingOut } = GRIP_ROLL, p = LAYER.pullEnd;
  if (u <= p) return draw;
  if (u <= swingIn) return draw + (swing - draw) * smooth01((u - p) / (swingIn - p));
  if (u <= swingOut) return swing;
  return swing * (1 - smooth01((u - swingOut) / (1 - swingOut)));
}
// 両手持ち：動作の左手首が柄の軸から near 以内なら握り切り、far で離す（実測：構えで3〜4cm、袈裟・横薙ぎ・唐竹は2〜26cm、歩きは24cm、両手受けは28cm以上）。
// y は柄の枠で、この範囲の外は持たない。重みは臨界減衰の2次の追従（固有の速さ omega）で追う（攻撃で左手が数コマごとに出入りするので、そのまま使うと手が跳ぶ。
// 1次の追従（時定数0.07秒）は離し始めの1コマが最も速く、納刀の始めに左手首が隣の3.6倍回った。実測）。
// 袈裟の振り下ろし（左手首14cm）で左手を離したままにすると、柄へ寄せた右の袖の裾が左の指の前へ出て、黒い破片に見えた（評価の指摘1）
export const TWO_HAND = Object.freeze({ near: 0.12, far: 0.22, yLo: -0.32, yHi: 0.30, yEdge: 0.06, omega: 18 });
const GRIP_IN = 1 / 3;
const NO_FIT = Object.freeze({ fingers: Object.freeze([0, 0, 0, 0].map(() => Object.freeze([0, 0, 0]))), thumb: Object.freeze([0, 0]) });
const EASE = 0.08;   // 刀が手から離れる・手へ戻るとき（落とす・降参・持ち替え）に、握りを緩める時間（秒）
const POLE = 0.25;   // 肘の向きの点を、動作の肘から外へ出す距離（m）
const TWIST = 0.5;   // 手首のねじれのうち、前腕へ移す割合
const smooth01 = x => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

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
      // 指・親指が主の頂点（手の重みが半分以上で、その6割以上が指・親指）は、前腕などの小さな重みを外して手へまとめる
      // （手首を曲げたコマで、親指の付け根の頂点が前腕の5%に引かれて柄へ2.4mm入った。侍大将・実測）
      let total = 0; for (let k = 0; k < 4; k++) total += wi[i * 4 + k] / 255;
      const pure = wts[t] >= 0.5 * total && 1 - split.palm >= 0.6;
      for (let k = 0; k < 4; k++) {
        const j = ji[i * 4 + k], w = wi[i * 4 + k] / 255;
        if (!(w > 0)) continue;
        if (j !== first + 2) { if (!pure) list.push([j, w]); continue; }
        const wh = pure ? total : w;
        list.push([j, wh * split.palm]);
        DIGIT_KEYS.forEach((d, n) => { if (split[d] > 0) list.push([first + 3 + n, wh * split[d]]); });
      }
      const q = quantizeInfluences(list);
      for (let k = 0; k < 4; k++) { ji[i * 4 + k] = q[k] ? q[k][0] : 0; wi[i * 4 + k] = q[k] ? q[k][1] : 0; }
    });
    // 逆結合行列：腕の写しは元と同じ。指は手の結合姿勢から平行移動しただけ
    const inv = [...real.map(r => sk.boneInverses[r]), ...DIGIT_KEYS.map(d => new THREE.Matrix4().makeTranslation(-layout.world[d][0], -layout.world[d][1], -layout.world[d][2]).multiply(sk.boneInverses[h]))];
    // 握る形を、この型の実際の頂点で合わせる（型ごとに1回）。右手は柄、左手は鞘（抜刀の間）と柄（両手持ち）
    const fit = side === 'Right' ? { tsuka: fitGrip(m, layout, verts, GRIP_RADIUS.tsuka) } : { saya: fitGrip(m, layout, verts, GRIP_RADIUS.saya), tsuka: fitGrip(m, layout, verts, GRIP_RADIUS.tsuka) };
    // 柄を握った手の、親指の側・小指の側への広がり（柄の軸に沿って。鍔・柄頭に当たる範囲の皮だけ）
    const t = fit.tsuka, wNeg = m.w.map(x => -x);
    const extent = { thumb: gripExtent(layout, t.axes, t, verts, m.w, GRIP_SLIDE.tsubaRadius + 0.01), pinky: gripExtent(layout, t.axes, t, verts, wNeg, GRIP_SLIDE.tsubaRadius + 0.01) };
    sides[side] = { model: m, layout, first, inv, fit, extent, vertices: ids.length };
  });
  geo.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(ji, 4));
  geo.setAttribute('skinWeight', new THREE.Uint8BufferAttribute(wi, 4, true));
  geo.userData.handRig = { base, sides, total: base + SIDES.length * PER_SIDE };
  return geo.userData.handRig;
}

// 読み込みのときに型を準備しておく（初めてその人物を作るコマに、型ごとの準備が乗らないように。実測）
export function prepareHands(scene) {
  let mesh = null; scene.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; });
  if (!mesh) return;
  const info = prepareGeometry(mesh);
  patchHandMaterial(mesh.material, [info.base + 1, info.base + PER_SIDE + 1]);
}

// 型の材質（全員で共有）へ、手まわりの2つの補正を足す（grade.js の patchLift のあとに重ねる）。
//  1. 袖口の裏地：前腕の写しに付く頂点で、ほぼ黒の絵（主人公の袖口の内側は sRGB 5,5,5）を、袖の紺の暗い布色にする。
//     手を柄へ寄せる抜刀・構えの寄りで、袖口の中が真っ黒な穴に見えた（評価の指摘4）。髪など前腕以外の黒は変えない。
//  2. 肌の照り：肌色の画素の粗さを LINING.skinRough 以上にする。兵の手は粗さ0.42（主人公0.79）で、空の映り込みが乗って半透けに見えた（評価の指摘5）。
export const LINING = Object.freeze({ color: Object.freeze([0.016, 0.018, 0.027]), black: Object.freeze([0.003, 0.010]), skinRough: 0.8 });
export function patchHandMaterial(material, foreArms) {
  if (!material || material.userData.kzHand) return material;
  material.userData.kzHand = true;
  const before = material.onBeforeCompile, keyBefore = material.customProgramCacheKey;
  const [r, l] = foreArms.map(i => i.toFixed(1)), [cr, cg, cb] = LINING.color.map(x => x.toFixed(4));
  material.onBeforeCompile = (shader, renderer) => {
    before?.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vKzLining;')
      .replace('#include <skinbase_vertex>', `#include <skinbase_vertex>\n\tvKzLining = dot(skinWeight, vec4(equal(skinIndex, vec4(${r}))) + vec4(equal(skinIndex, vec4(${l}))));`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vKzLining;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float kzMax = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${cr}, ${cg}, ${cb}), vKzLining * (1.0 - smoothstep(${LINING.black[0].toFixed(3)}, ${LINING.black[1].toFixed(3)}, kzMax)));
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      {
        vec3 kc = max(diffuseColor.rgb, vec3(0.0));
        float kl = dot(kc, vec3(0.2126, 0.7152, 0.0722));
        float kmx = max(kc.r, max(kc.g, kc.b)), kmn = min(kc.r, min(kc.g, kc.b)), ks = (kmx - kmn) / max(kmx, 1e-3);
        float kskin = smoothstep(0.12, 0.22, ks) * (1.0 - smoothstep(0.55, 0.75, ks)) * step(kc.g, kc.r) * step(kc.b, kc.g) * smoothstep(0.10, 0.20, kl);
        roughnessFactor = mix(roughnessFactor, max(roughnessFactor, ${LINING.skinRough.toFixed(2)}), kskin);
      }`);
  };
  material.customProgramCacheKey = () => (keyBefore ? keyBefore.call(material) : '') + `-kzhand-${r}-${l}`;
  material.needsUpdate = true;
  return material;
}

// ---- 作業用（毎コマ確保しない）
const VA = new THREE.Vector3(), VB = new THREE.Vector3(), VC = new THREE.Vector3(), VD = new THREE.Vector3(), VE = new THREE.Vector3();
const PQ = new THREE.Quaternion(), DQ = new THREE.Quaternion(), TQ = new THREE.Quaternion(), HQ = new THREE.Quaternion(), QX = new THREE.Quaternion();
const TP = new THREE.Vector3(), HP = new THREE.Vector3(), SC = new THREE.Vector3(), AXIS = new THREE.Vector3(), SP = new THREE.Vector3();
const MT = new THREE.Matrix4(), MS = new THREE.Matrix4(), MR = new THREE.Matrix4();
const ROOT = [0, 0, 0], MID = [0, 0, 0], END = [0, 0, 0], TGT = [0, 0, 0], HINT = [0, 0, 0], OUT = { mid: [0, 0, 0], end: [0, 0, 0], reached: true, error: 0 };
const arr3 = (v, a) => { a[0] = v.x; a[1] = v.y; a[2] = v.z; return a; };
const wrapPi = a => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;

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
      const dig = DIGIT_KEYS.map(d => Object.assign(new THREE.Bone(), { name: side + '_' + d }));
      DIGIT_KEYS.forEach((d, k) => { (d[2] === '0' || d === 't0' ? vis[2] : dig[k - 1]).add(dig[k]); dig[k].position.fromArray(si.layout[d]); });
      bones.push(...vis, ...dig); inverses.push(...si.inv);
      const m = si.model, f0 = si.fit.tsuka;
      this.sides[side] = {
        side, real, vis, dig, model: m, fit: si.fit, extent: si.extent,
        curlAxis: new THREE.Vector3(...f0.axes.curl), thumbAxis: new THREE.Vector3(...f0.axes.thumb),
        g: null, gSaya: 0, g2: null, v2: 0, roll: null, curl: new Float64Array(12), thumb: new Float64Array(2), target: { pos: new THREE.Vector3(), quat: new THREE.Quaternion() },
        armLen: real[1].position.length() + real[2].position.length(),   // 上腕＋前腕（局所の長さ。刀の枠も同じ縮尺）
        last: { g: 0, gSaya: 0, g2: 0, reached: true, error: 0 },
      };
    }
    mesh.bind(new THREE.Skeleton(bones, inverses), mesh.bindMatrix);
    old.dispose();
    this.enabled = true;
    this.swordGrip = null;   // 柄を握る手の、柄の枠から見た手の逆行列（最初に刀を持ったときに作る。右手と、両手持ちの左手）
    this.channels = { tsuka: {}, saya: {} };   // 円筒の中心線が通る、手の局所の点（握りを合わせた結果）
    for (const side of SIDES) for (const [k, f] of Object.entries(this.sides[side].fit)) this.channels[k][side] = new THREE.Vector3(...f.center);
  }

  // 柄を握るときの、柄の枠 S から見た手の逆行列 M⁻¹（手 = S × M⁻¹）。M＝（回転、位置 溝の点 − slide×軸）。
  // 右手の回転は、刀を手の骨へ付ける定位置（GRIP.tachiDrawn。抜刀の層の home）に、その柄の軸を手の溝の軸（指に直角）へ回す最短の回転 Q₀ を掛けたもの。
  // 左手（両手持ち）は、柄の +Y（刃の側）を左手の親指の側へ、右手の甲の向きを左手の甲の向きへ合わせる（両手とも甲が同じ側・親指が鍔の側）。
  makeSwordGrip(homeQuat) {
    const s = this.sides.Right, axisInHand = new THREE.Vector3(0, 1, 0).applyQuaternion(homeQuat);
    const c = s.curlAxis.clone(), sign = axisInHand.dot(c) >= 0 ? 1 : -1, axis = c.multiplyScalar(sign);
    const q0 = new THREE.Quaternion(...shortestArc(axisInHand.toArray(), axis.toArray()));
    const rot = q0.clone().multiply(homeQuat);
    // 鍔の側へ広がる手の幅（右手の親指の側は w＝c。刃の向きが +c なら親指の側）
    const toTsuba = sign > 0 ? s.extent.thumb : s.extent.pinky;
    const slide = Math.min(GRIP_SLIDE.tsuka, GRIP_SLIDE.tsubaFace - GRIP_SLIDE.tsubaClear - toTsuba);
    const pos = this.channels.tsuka.Right.clone().addScaledVector(axis, -slide);
    const inv = new THREE.Matrix4().compose(pos, rot, new THREE.Vector3(1, 1, 1)).invert();
    // 左手：柄の枠の基底 (Y, 右手の甲, Y×甲) → 左手の局所 (w, −n, w×−n)
    const L = this.sides.Left, mR = s.model, mL = L.model;
    const back = new THREE.Vector3(...mR.n).negate().applyQuaternion(rot.clone().invert());   // 右手の甲の向き（柄の枠）
    const ys = new THREE.Vector3(0, 1, 0), bs = back.clone().addScaledVector(ys, -back.dot(ys)).normalize(), zs = new THREE.Vector3().crossVectors(ys, bs);
    const wl = new THREE.Vector3(...mL.w), bl = new THREE.Vector3(...mL.n).negate(), zl = new THREE.Vector3().crossVectors(wl, bl);
    const rotL = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(wl, bl, zl).multiply(new THREE.Matrix4().makeBasis(ys, bs, zs).transpose()));
    const slideL = GRIP_SLIDE.pommel - GRIP_SLIDE.pommelOver + L.extent.pinky;
    const posL = this.channels.tsuka.Left.clone().addScaledVector(wl, -slideL);
    const invL = new THREE.Matrix4().compose(posL, rotL, new THREE.Vector3(1, 1, 1)).invert();
    return { inv, invL, q0, axis, rot, pos, slide, slideL, wrist: new THREE.Vector3().setFromMatrixPosition(inv), wristL: new THREE.Vector3().setFromMatrixPosition(invL) };
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
    const ease = dt > 0 ? 1 - Math.exp(-dt / EASE) : 0;
    // ---- 右手：手にある刀の柄
    const drawn = ch.weapons.tachiDrawn, frame = ch.sword?.frame, live = !!(frame && frame.u > 0 && frame.u < 1);
    const holding = !!(drawn && drawn.holder.visible && drawn.object.parent === drawn.holder);
    // 抜刀の間の握りの重みは、腕が柄へ届く区間（u 0〜reachEnd）の後ろ寄り（GRIP_IN〜reachEnd）で入れる。動作の手が柄へ向かい始めた最初のコマで、
    // 握りの分のずれ（約12cm）まで一度に足すと、速い抜刀の最初のコマだけ手が大きく跳んだ（隣のコマの3.1倍。実測）。
    const gR = live ? smooth01((frame.u - GRIP_IN * LAYER.reachEnd) / ((1 - GRIP_IN) * LAYER.reachEnd)) : holding ? 1 : 0;
    R.g = R.g == null || live ? gR : R.g + (gR - R.g) * ease;
    let gripped = false;
    if (R.g > 1e-4 && drawn) {
      if (!this.swordGrip) this.swordGrip = this.makeSwordGrip((ch.sword ? ch.sword.home.drawn.quaternion : drawn.holder.quaternion).clone());
      const G = this.swordGrip;
      MS.copy(drawn.holder.matrixWorld).invert();
      // 目指す回り：構えの握りは0。抜刀・納刀の間は drawRoll（親指が上。振る前半はさらに回して鍔を避け、u=1 で0へ戻す）
      let want = live ? drawRoll(frame.u) : 0;
      // 回り：want を、右肩から届く弧へ寄せ、変化の速さを抑える（柄の枠で計算する）
      R.vis[0].getWorldPosition(VA).applyMatrix4(MS);
      const w0 = G.wrist; want = rollWithinReach(w0.x, w0.y, w0.z, VA.x, VA.y, VA.z, R.armLen * GRIP_ROLL.reach, want);
      R.roll = this.limitRoll(R.roll, want, dt);
      MT.copy(drawn.holder.matrixWorld);
      if (R.roll !== 0) MT.multiply(MR.makeRotationY(R.roll));            // 柄の軸（刀の +Y）のまわりに手を回す
      MT.multiply(G.inv).decompose(TP, TQ, SC);
      this.reach(R, TP, TQ, R.g);
      gripped = holding && !live;
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
    // ---- 左手：両手持ち。抜き切って持っている間、動作の左手首が柄の近くにあるコマだけ、柄頭の側を握る
    let raw = 0;
    if (gripped && this.swordGrip) {
      MS.copy(drawn.holder.matrixWorld).invert();
      L.real[2].getWorldPosition(VB).applyMatrix4(MS);
      const r = Math.hypot(VB.x, VB.z), T = TWO_HAND;
      raw = (1 - smooth01((r - T.near) / (T.far - T.near))) * smooth01((VB.y - T.yLo) / T.yEdge) * (1 - smooth01((VB.y - T.yHi) / T.yEdge));
    }
    // 最初のコマ（g2 が null）は raw のまま。時間が進まないコマ（dt=0）は動かさない
    if (L.g2 == null) { L.g2 = raw; L.v2 = 0; }
    else if (dt > 0) {
      const w = TWO_HAND.omega, h = Math.min(dt, 0.05);
      L.v2 += (w * w * (raw - L.g2) - 2 * w * L.v2) * h; L.g2 += L.v2 * h;
      if (L.g2 > 1) { L.g2 = 1; L.v2 = Math.min(0, L.v2); }
    }
    if (L.g2 < 1e-4) { L.g2 = 0; L.v2 = Math.max(0, L.v2); }
    // 鞘を持つ間は両手持ちを鞘の重みの分だけ弱める（納刀の始めに左手は柄から鞘へ移る。両方を同じ重みで足すと、鞘を持ち切ったコマに柄への引きが残り、手が鞘へ19mm入った。実測）
    const g2 = L.g2 * (1 - L.gSaya);
    if (g2 > 0 && this.swordGrip) {
      const G = this.swordGrip;
      MS.copy(drawn.holder.matrixWorld).invert();
      L.vis[0].getWorldPosition(VA).applyMatrix4(MS);
      const w0 = G.wristL, want = rollWithinReach(w0.x, w0.y, w0.z, VA.x, VA.y, VA.z, L.armLen * GRIP_ROLL.reach, R.roll || 0);
      L.roll = this.limitRoll(L.roll, want, dt);
      MT.copy(drawn.holder.matrixWorld);
      if (L.roll !== 0) MT.multiply(MR.makeRotationY(L.roll));
      MT.multiply(G.invL).decompose(TP, TQ, SC);
      this.reach(L, TP, TQ, g2);
    } else L.roll = null;
    // ---- 指（握っていない指は、小指ほど深い軽い曲げ）
    for (let i = 0; i < SIDES.length; i++) {
      const side = SIDES[i], s = this.sides[side], gS = s.gSaya || 0, gT = side === 'Right' ? (s.g || 0) : s.g2 * (1 - gS), g = Math.min(1, gT + gS);
      const ft = s.fit.tsuka || NO_FIT, fs = s.fit.saya || NO_FIT;
      for (let k = 0; k < FINGERS; k++) for (let j = 0; j < 3; j++) {
        const n = k * 3 + j;
        s.curl[n] = HAND.relaxed[j] * HAND.cascade[k] * (1 - g) + gT * ft.fingers[k][j] + gS * fs.fingers[k][j];
        s.dig[n].quaternion.setFromAxisAngle(s.curlAxis, s.curl[n]);
      }
      for (let k = 0; k < 2; k++) {
        s.thumb[k] = HAND.relaxedThumb[k] * (1 - g) + gT * ft.thumb[k] + gS * fs.thumb[k];
        s.dig[12 + k].quaternion.setFromAxisAngle(s.thumbAxis, s.thumb[k]);
      }
      s.last.g = side === 'Right' ? (s.g || 0) : 0; s.last.gSaya = gS; s.last.g2 = side === 'Left' ? gT : 0;
    }
  }

  // 回りの変化を毎秒 rate rad までに抑える（近いほうへ回す。±πをまたいでも遠回りしない）。dt が0のコマ（止めた絵）は want のまま
  limitRoll(cur, want, dt) {
    if (cur == null || !(dt > 0)) return want;
    const lim = GRIP_ROLL.rate * dt, d = wrapPi(want - cur);
    return cur + Math.max(-lim, Math.min(lim, d));
  }

  // 円筒（中心 point・軸 axisWorld）を、いまの手の向きから最短の回転で、溝の点 chan で握る位置へ（重み w で混ぜる）
  holdCylinder(s, point, axisWorld, chan, w) {
    const hand = s.vis[2];
    hand.getWorldQuaternion(HQ);
    VD.copy(axisWorld).applyQuaternion(QX.copy(HQ).invert());          // 円筒の軸を、手の局所で
    // 溝の軸は +c（鞘の +Y＝鐺の側へ。左手の親指が鯉口の側を向く）に固定する。毎コマ ±c を選ぶと内積が0をまたぐコマで手が半回転し、
    // 握り始めのコマで選ぶと、納刀の始め（内積がほぼ0）に逆を選んで、のちに反対向き（内積−0.98）になり1コマで2.8rad回った（実測）。
    // +c に固定すると、全員の抜刀・納刀・歩きながらの抜刀で内積は−0.74〜1（反対向きにならない）
    VE.copy(s.curlAxis);
    DQ.setFromUnitVectors(VD.normalize(), VE);                          // 手の局所で、円筒の軸 → 溝の軸
    TQ.copy(HQ).multiply(DQ.invert());                                  // 握る手の向き
    TP.copy(chan).applyQuaternion(TQ).negate().add(point);              // 溝の点が円筒の軸の点に来る手首の位置
    this.reach(s, TP, TQ, w);
  }

  // 見える手を、位置 pos・向き quat へ（いまの手との混ぜの重み w）。腕は二関節IK（肘は動作の肘の側）。
  // 肘の向き（IK の hint）は、動作の腕の曲がる向き（動作の肘 − 肩と手首の中点）へ肘から pole だけ出した点。いまの見える肘を使うと、
  // 左手を柄から鞘へ移す納刀の始めに、2回目の IK（両手持ち）の肘が1コマで23cm裏返った（袖が48mm伸びた。実測）
  reach(s, pos, quat, w) {
    const arm = s.vis[0], fore = s.vis[1], hand = s.vis[2];
    hand.getWorldPosition(HP); hand.getWorldQuaternion(HQ);
    s.target.pos.copy(HP).lerp(pos, w); s.target.quat.copy(HQ).slerp(quat, w);
    arm.getWorldPosition(VA); fore.getWorldPosition(VB); hand.getWorldPosition(VC);
    s.real[0].getWorldPosition(SP); s.real[2].getWorldPosition(AXIS); s.real[1].getWorldPosition(HP);
    SP.add(AXIS).multiplyScalar(0.5); AXIS.copy(HP).sub(SP);
    if (AXIS.lengthSq() > 1e-4) HP.addScaledVector(AXIS.normalize(), POLE); else HP.copy(VB);
    solveTwoBoneInto(OUT, arr3(VA, ROOT), arr3(VB, MID), arr3(VC, END), arr3(s.target.pos, TGT), arr3(HP, HINT));
    s.last.reached = OUT.reached; s.last.error = OUT.error;
    VD.copy(VB).sub(VA).normalize(); VE.set(OUT.mid[0] - VA.x, OUT.mid[1] - VA.y, OUT.mid[2] - VA.z).normalize();
    rotateBoneWorld(arm, DQ.setFromUnitVectors(VD, VE)); arm.updateMatrixWorld(true);
    fore.getWorldPosition(VB); hand.getWorldPosition(VC);
    VD.copy(VC).sub(VB).normalize(); VE.set(OUT.end[0] - VB.x, OUT.end[1] - VB.y, OUT.end[2] - VB.z).normalize();
    rotateBoneWorld(fore, DQ.setFromUnitVectors(VD, VE)); fore.updateMatrixWorld(true);
    // 手首のねじれ（前腕の軸まわり）の TWIST 分を前腕へ移す（手首だけでねじると、手首の皮が飴の包みのように細く伸びた。抜刀の振りで45mm。実測）。
    // 前腕を自分の軸のまわりに回すので、肘と手首の位置は変わらない
    hand.getWorldQuaternion(HQ); DQ.copy(s.target.quat).multiply(HQ.invert());
    hand.getWorldPosition(VC); fore.getWorldPosition(VB); VD.copy(VC).sub(VB).normalize();
    const twist = wrapPi(2 * Math.atan2(DQ.x * VD.x + DQ.y * VD.y + DQ.z * VD.z, DQ.w));
    if (Math.abs(twist) > 1e-6) { rotateBoneWorld(fore, QX.setFromAxisAngle(VD, TWIST * twist)); fore.updateMatrixWorld(true); }
    setBoneWorldQuaternion(hand, s.target.quat); hand.updateMatrixWorld(true);
  }
}
