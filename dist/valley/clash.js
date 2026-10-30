// clash.js — 刃が当たった点・刃同士が打ち合う点の幾何（8.3a 第2周・R18.3）。Three.js・DOM・乱数・時計に触れない。
// battle.js が当たり・受け・弾きの瞬間に1回呼ぶ（毎コマではない）。点は [x, y, z] の配列。
// 火花は「刃が体を通る点から、刃の進む向きへ」（第1周は受けた人の胸の中心から放射状で、刃の無い側にも散った）。

export const STRIKE = Object.freeze({
  torsoRadius: 0.22,   // 胴の半径（m）。刃がこれより遠いときは、胴の表面の、刃の側の点に火花を置く
  torsoHalf: 0.28,     // 胴の軸の半分の長さ（m）。胸（Spine02）の上下
  push: 0.35,          // ひるみの押す向きに混ぜる、刃の進む向きの割合（残りは相手から自分への向き）
});

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp01 = x => Math.max(0, Math.min(1, x));
const at = (a, d, k) => [a[0] + d[0] * k, a[1] + d[1] * k, a[2] + d[2] * k];

// 線分 p0→p1 と q0→q1 の最も近い2点。s・t は線分の上の割合（0〜1）、d は2点の距離。平行・長さ0でも有限の答えを返す。
export function closestSegments(p0, p1, q0, q1) {
  const d1 = sub(p1, p0), d2 = sub(q1, q0), r = sub(p0, q0);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s, t;
  if (a <= 1e-12 && e <= 1e-12) { s = 0; t = 0; }
  else if (a <= 1e-12) { s = 0; t = clamp01(f / e); }
  else {
    const c = dot(d1, r);
    if (e <= 1e-12) { t = 0; s = clamp01(-c / a); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-12 ? clamp01((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  const p = at(p0, d1, s), q = at(q0, d2, t);
  return { s, t, p, q, d: Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) };
}

// 当たった点：刃（mid→tip）と胴の軸（low→high）の最も近い所。刃が胴の半径の内側を通っていれば刃の上の点、
// 外なら胴の軸から刃へ向かう胴の表面の点（受けた人の体の上の、刃が来た側）。inside は刃が胴に届いたか。
export function strikePoint(mid, tip, low, high, radius = STRIKE.torsoRadius) {
  const c = closestSegments(mid, tip, low, high);
  if (c.d <= radius) return { point: c.p, inside: true, gap: c.d };
  const k = radius / c.d, dir = sub(c.p, c.q);
  return { point: at(c.q, dir, k), inside: false, gap: c.d };
}

// 弾きの打ち合う点：相手の刃（root→tip）の上で、受けた人の右肩に最も近い点（腕を伸ばして刀で届く所）。
// 刃の根元の近く（手の中）を避けるため、刃の外側の8割の上で探す。
export function clashPoint(root, tip, shoulder) {
  const d = sub(tip, root), from = at(root, d, 0.2), L = dot(d, d);
  const k = L > 1e-12 ? clamp01((dot(sub(shoulder, root), d) / L - 0.2) / 0.8) : 0;
  return at(from, sub(tip, from), k);
}

// ひるみの押す向き（世界の水平・長さ1）：相手から自分への向きに、刃の進む向き（水平成分）を STRIKE.push だけ混ぜる。
// 刃の速度が無い・水平成分が無いときは、相手から自分への向きだけ。どちらも無ければ null。
export function pushDirection(fromX, fromZ, toX, toZ, travel) {
  let ax = toX - fromX, az = toZ - fromZ; const al = Math.hypot(ax, az);
  if (al > 1e-9) { ax /= al; az /= al; } else { ax = 0; az = 0; }
  let bx = 0, bz = 0;
  if (travel) { const bl = Math.hypot(travel[0], travel[2]); if (bl > 1e-6) { bx = travel[0] / bl; bz = travel[2] / bl; } }
  const w = bx || bz ? STRIKE.push : 0, x = ax * (1 - w) + bx * w, z = az * (1 - w) + bz * w, l = Math.hypot(x, z);
  return l > 1e-9 ? { x: x / l, z: z / l } : null;
}
