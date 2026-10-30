// 握りを原点、+Yを切先、+Zを刃側とする。長さはm、回転は[x,y,z,w]。
import { shortestArc } from './arm-ik.js';
export const SWORD = Object.freeze({ bladeBase: 0.16, bladeLength: 0.72, bladeSori: 0.018, sayaY0: 0.17, sayaLength: 0.78, sayaSori: 0.018, sayaRadius: 0.0225, koiguchiY: 0.168, tsubaY: 0.128, tsukaLength: 0.25 });
export const S_CLEAR = SWORD.bladeBase + SWORD.bladeLength - SWORD.koiguchiY;
export const S_OUT = 0.74;
export const SAYA_BACK_MAX = 0.22;
export const TWIST_MAX_DEG = 35;
const clamp = (v, lo, hi) => Number.isNaN(v) ? lo : Math.max(lo, Math.min(hi, v));

// 刃の断面（weapons.js の bladeGeometry の既定）。幅 w・厚み th は根元から先へ線形に細り、最後の7%は先端へ向けて絞る。
// 断面は、反りの中心線（z）のまわりに、幅 w（z方向）・厚み th（x方向）。
export const BLADE_SECTION = Object.freeze({ w0: 0.031, w1: 0.022, th0: 0.0075, th1: 0.0052, taperStart: 0.93 });
export function bladeHalfSection(yInSwordFrame) {
  const t = clamp((yInSwordFrame - SWORD.bladeBase) / SWORD.bladeLength, 0, 1);
  const taper = t > BLADE_SECTION.taperStart ? Math.max(0, (1 - t) / (1 - BLADE_SECTION.taperStart)) : 1;
  const w = (BLADE_SECTION.w0 + (BLADE_SECTION.w1 - BLADE_SECTION.w0) * t) * (0.18 + 0.82 * taper);
  const th = (BLADE_SECTION.th0 + (BLADE_SECTION.th1 - BLADE_SECTION.th0) * t) * taper;
  return { halfWidth: w / 2, halfThickness: th / 2 };
}

export function sayaCenter(y) {
  const t = (y - SWORD.sayaY0) / SWORD.sayaLength;
  return SWORD.sayaSori * 4 * t * (1 - t);
}
export function bladeCenter(yInSwordFrame) {
  const t = (yInSwordFrame - SWORD.bladeBase) / SWORD.bladeLength;
  return SWORD.bladeSori * 4 * t * (1 - t);
}

const radius = (SWORD.sayaLength ** 2 / 4 + SWORD.sayaSori ** 2) / (2 * SWORD.sayaSori);
const centerY = SWORD.sayaY0 + SWORD.sayaLength / 2, centerZ = SWORD.sayaSori - radius;
const tipOffsetY = SWORD.bladeBase + SWORD.bladeLength - centerY;
const tipRadius = Math.hypot(tipOffsetY, centerZ);

export function swordOnSaya(s) {
  s = clamp(s, 0, S_OUT);
  if (s === 0) return { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
  // C=[0,中央Y,反り-R] の周囲を +X 回転: P'=C+Rx(θ)(P-C)。
  // sは切先の-Y移動量。円弧長そのものだとS_CLEARで切先がまだ鞘に残る。
  const angle = Math.asin(tipOffsetY / tipRadius) - Math.asin((tipOffsetY - s) / tipRadius);
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  return {
    position: [0, centerY * (1 - cosine) + centerZ * sine, centerZ * (1 - cosine) - centerY * sine],
    quaternion: [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)],
  };
}

function normalize(q) {
  const n = Math.hypot(...q);
  return n > 0 ? q.map(v => v / n) : [0, 0, 0, 1];
}

export function blendPose(a, b, w) {
  w = clamp(w, 0, 1);
  const qa = normalize(a.quaternion), qb = normalize(b.quaternion);
  let dot = qa.reduce((sum, v, i) => sum + v * qb[i], 0);
  // q と -q は同じ姿勢。短い弧を選ぶ。
  if (dot < 0) { for (let i = 0; i < 4; i++) qb[i] = -qb[i]; dot = -dot; }
  dot = clamp(dot, -1, 1);
  let q;
  if (dot > 0.9995) q = qa.map((v, i) => v + (qb[i] - v) * w);
  else {
    const angle = Math.acos(dot), sine = Math.sin(angle);
    const wa = Math.sin((1 - w) * angle) / sine, wb = Math.sin(w * angle) / sine;
    q = qa.map((v, i) => v * wa + qb[i] * wb);
  }
  return { position: a.position.map((v, i) => v + (b.position[i] - v) * w), quaternion: normalize(q) };
}

// 試験用。両端を含むn点（n>=2の整数）を鞘の枠で返す。
export function bladeCenterInSayaFrame(s, n) {
  if (!Number.isInteger(n) || n < 2) throw new RangeError('刃の標本数は2以上の整数');
  const { position: p, quaternion: q } = swordOnSaya(s);
  const cosine = 1 - 2 * q[0] ** 2, sine = 2 * q[0] * q[3];
  return Array.from({ length: n }, (_, i) => {
    const y = SWORD.bladeBase + SWORD.bladeLength * i / (n - 1), z = bladeCenter(y);
    return [p[0], p[1] + cosine * y - sine * z, p[2] + sine * y + cosine * z];
  });
}

// ---- 向きの混ぜ（抜いた直後 ⇄ 構え）
// 抜いた直後（刃は鞘の軸＝後ろ向き）と構え（刃は前上向き）はほぼ反対向きで、最短の弧（球面線形）は、反対向きに近いところで向きが不安定になり、刃が下を通る。
// そこで、「刃を真上へ向けた向き」を制御点にして、球面上の2次曲線（球面線形を2回重ねる）で混ぜる。2つの向きが近いほど制御点を寄せ、上へ振らない。
// qa・qf は世界の向き、bladeLocal は刃の向き（+Y）を、その向きの局所で表した単位ベクトル。
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qinv = q => [-q[0], -q[1], -q[2], q[3]];
const qunit = q => { const n = Math.hypot(...q); return n > 0 ? q.map(v => v / n) : [0, 0, 0, 1]; };
const qrot = (q, v) => { const r = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q)); return [r[0], r[1], r[2]]; };
function qslerpShort(a, b, t) {
  let c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (c < 0) { b = b.map(v => -v); c = -c; }
  if (c > 0.9995) return qunit(a.map((v, i) => v + (b[i] - v) * t));
  const ang = Math.acos(Math.min(1, c)), sin = Math.sin(ang), wa = Math.sin((1 - t) * ang) / sin, wb = Math.sin(t * ang) / sin;
  return qunit(a.map((v, i) => v * wa + b[i] * wb));
}
// 2つの向きの間の混ぜは、向きの空間（SO(3)）の性質上、「どの2つの向きでも連続な混ぜ方」が存在しない（180度近くで、短い側が入れ替わる）。
// そこで、毎コマ動く向きの列に沿って連続になるよう、短い側と長い側の2通りを計算し、前のコマの結果に近いほうを採る（memo に前のコマの結果を持たせる）。
// memo が無いとき（試験・単発）は、短い側。memo は呼び出し側が、混ぜの場所ごとに1つ持ち、層が終わったら捨てる。
function qslerpRaw(a, b, t) {                                          // 短い側へ折り返さない（b の符号をそのまま使う）
  const c = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  if (c > 0.9995) return qunit(a.map((v, i) => v + (b[i] - v) * t));
  const ang = Math.acos(c), sin = Math.sin(ang);
  if (sin < 1e-9) return a;                                            // 360度の回転（a → -a）は向きが決まらない
  const wa = Math.sin((1 - t) * ang) / sin, wb = Math.sin(t * ang) / sin;
  return qunit(a.map((v, i) => v * wa + b[i] * wb));
}
function qslerpTrack(a, b, t, memo, key) {
  const bs = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? b.map(v => -v) : b;     // 短い側の表現
  const short = qslerpRaw(a, bs, t);
  if (!memo) return short;
  const prev = memo[key];
  const long = qslerpRaw(a, bs.map(v => -v), t);                                                     // 長い側
  const pick = !prev || prev[0] * short[0] + prev[1] * short[1] + prev[2] * short[2] + prev[3] * short[3] >= prev[0] * long[0] + prev[1] * long[1] + prev[2] * long[2] + prev[3] * long[3] ? short : long;
  memo[key] = pick;
  return pick;
}
// 向きの単純な混ぜ（qa → qf を w だけ）。経路は最短、毎コマの連続は memo で保つ。
export function blendOrientation(qa, qf, w, memo = null) {
  return qslerpTrack(qunit(qa), qunit(qf), clamp(w, 0, 1), memo, 'blend');
}
export function swingBlend(qa, qf, h, bladeLocal, up = [0, 1, 0], memo = null) {
  h = clamp(h, 0, 1); qa = qunit(qa); qf = qunit(qf);
  const dA = qrot(qa, bladeLocal), dF = qrot(qf, bladeLocal);
  const bulge = Math.acos(clamp(dA[0] * dF[0] + dA[1] * dF[1] + dA[2] * dF[2], -1, 1)) / Math.PI;
  const qm = qunit(qmul(shortestArc(dA, up), qa));                   // 刃を真上へ向けた向き（ねじれは qa のまま）
  const qc = qslerpShort(qa, qm, bulge);                              // 制御点：近い向きは qa のまま、反対向きで qm
  return qslerpTrack(qslerpTrack(qa, qc, h, memo, 'ac'), qslerpTrack(qc, qf, h, memo, 'cf'), h, memo, 'out');
}

// 診断：swingBlend が混ぜる2つの向きの、刃のまわりのねじれ（0〜180度）。180度付近では、ねじれの混ぜが不連続になりうる（短い側が入れ替わる）。
export function swingRollDeg(qa, qf, bladeLocal) {
  qa = qunit(qa); qf = qunit(qf);
  const dA = qrot(qa, bladeLocal), dF = qrot(qf, bladeLocal);
  const roll = qmul(qf, qinv(qmul(shortestArc(dA, dF), qa)));
  return 2 * Math.acos(clamp(Math.abs(roll[3]), 0, 1)) * 180 / Math.PI;
}
