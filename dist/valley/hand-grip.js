// hand-grip.js — 手の指の骨を合成して、柄・鞘を握らせるための純粋な計算（Three.js非依存）。設計は design-hand-grip.md。
// 人物GLB（Meshy）は指の骨を持たず、指はそろえて開いた1枚の面（4本は側面でつながる）。そこで、
//   指4本を1本の鎖（付け根・中・先の3関節）、親指を1本の鎖（2関節）として、手の頂点の重みを分ける。
//   握る形（関節の角と、円筒の中心線の位置）は、その型の実際の頂点で合わせる（fitGrip。型ごとに1回）。
// 座標は「手の骨の局所（結合姿勢）」。f＝指の向き（骨の +Y）、n＝手のひらの向き、w＝親指の側。単位は m・rad。

export const HAND = Object.freeze({
  frameBand: Object.freeze([0.72, 0.9]),   // 指の板の横の軸を求める帯（指先の高さに対する比。親指を含まない）
  joints: Object.freeze([0.60, 0.78, 0.89]), // 指の付け根・中・先の関節（指先の高さに対する比）
  blend: 0.006,                            // 関節の前後で重みを混ぜる半幅
  thumbFrom: 0.25, thumbJoints: Object.freeze([0.45, 0.75]),   // 親指の軸（母指球→親指の先）の上の関節の位置
  thumbEdge: Object.freeze([-0.004, 0.010]),                   // 指の板の縁から外へ、親指に属し始める幅（m）
  thumbBand: Object.freeze([0.25, 0.40, 0.80, 0.86]),          // 親指に属する高さの範囲（入り始め・入り切る・抜け始め・抜け切る）
  relaxed: Object.freeze([0.16, 0.22, 0.12]),                   // 握っていない手の、指の軽い曲げ（rad）
  relaxedThumb: Object.freeze([0.10, 0.08]),
  limits: Object.freeze([1.65, 1.9, 1.4]),                      // 指の関節の曲げの上限（rad）
  channelBack: 0.012,                                           // 柄の中心を、指の付け根の関節より手首側へ置く量（m）
});

const clamp = (v, lo, hi) => Number.isNaN(v) ? lo : Math.max(lo, Math.min(hi, v));
export function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = v => { const l = Math.hypot(v[0], v[1], v[2]); return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0]; };
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

// 手の形を測る。points＝手の局所の頂点 [[x,y,z],…]、weights＝その頂点の手の骨の重み。
// down＝結合姿勢での「下」を手の局所で表した向き（T姿勢の手は、手のひらが下）。side＝'Right'|'Left'。
// 親指の側 w は、手の向きの決まり（右手は w×f＝n、左手は f×w＝n）から決め、親指の出っ張りの側と一致するかを thumbAgrees で返す。
export function measureHand(points, weights, { down, side }) {
  const f = [0, 1, 0];
  const solid = points.filter((p, i) => weights[i] >= 0.5);
  if (solid.length < 50) throw new RangeError('手の頂点が少なすぎる: ' + solid.length);
  const tipF = Math.max(...solid.map(p => p[1]));
  // 指の帯で、局所 XZ 面の主成分（長い軸＝横 w、短い軸＝厚み n）
  const band = solid.filter(p => p[1] > HAND.frameBand[0] * tipF && p[1] < HAND.frameBand[1] * tipF);
  let mx = 0, mz = 0; for (const p of band) { mx += p[0]; mz += p[2]; } mx /= band.length; mz /= band.length;
  let sxx = 0, szz = 0, sxz = 0; for (const p of band) { sxx += (p[0] - mx) ** 2; szz += (p[2] - mz) ** 2; sxz += (p[0] - mx) * (p[2] - mz); }
  const a = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  let n = [-Math.sin(a), 0, Math.cos(a)];
  if (dot(n, down) < 0) n = n.map(v => -v);
  const w = side === 'Left' ? cross(n, f) : cross(f, n);
  const toPalm = p => [dot(p, w), p[1], dot(p, n)];
  const pc = solid.map(toPalm);
  const distal = pc.filter(q => q[1] > 0.82 * tipF);
  const wLo = Math.min(...distal.map(q => q[0])), wHi = Math.max(...distal.map(q => q[0]));
  // 親指の出っ張り（手のひらの帯で、指の板の縁より外へ出る量）は、w の正の側が大きいはず
  const mid = pc.filter(q => q[1] > 0.45 * tipF && q[1] < 0.7 * tipF);
  const thumbAgrees = Math.max(...mid.map(q => q[0])) - wHi > wLo - Math.min(...mid.map(q => q[0]));
  const wC = (wLo + wHi) / 2;
  // 断面（その高さの帯で、指の板の幅の中の頂点の厚み）。外れた少数の頂点（袖や装具の端）に引かれないよう、5〜95%の幅で見る
  const section = fy => {
    let r = 0.006, near = [];
    while (near.length < 20 && r < 0.03) { near = pc.filter(q => Math.abs(q[1] - fy) < r && q[0] > wLo && q[0] < wHi); r *= 1.5; }
    if (near.length < 4) return { n: 0, half: 0.007, palm: 0.007 };
    const ns = near.map(q => q[2]).sort((x, y) => x - y), at = k => ns[Math.min(ns.length - 1, Math.max(0, Math.round(k * (ns.length - 1))))];
    const lo = at(0.05), hi = at(0.95);
    return { n: (lo + hi) / 2, half: Math.max(0.004, (hi - lo) / 2), palm: hi };
  };
  const joints = HAND.joints.map(r => { const fy = r * tipF, s = section(fy); return { f: fy, n: s.n, half: s.half }; });
  // 親指：板の縁より外で、指先より低い所の、いちばん外の点が親指の先
  const rim = pc.filter(q => q[1] > 0.3 * tipF && q[1] < 0.8 * tipF);
  const thumbTip = rim.reduce((b, q) => (q[0] > b[0] ? q : b), rim[0]);
  const thumbBase = [wHi - 0.01, HAND.thumbFrom * tipF, section(HAND.thumbFrom * tipF).n];
  return { side, f, w, n, c: cross(f, n), tipF, wLo, wHi, wC, joints, thumbTip, thumbBase, thumbAgrees, palmAt: fy => section(fy).palm };
}

// 手の局所の点を、手のひらの座標 [w, f, n] へ
export function palmCoords(m, p) { return [dot(p, m.w), p[1], dot(p, m.n)]; }
// 手のひらの座標を、手の局所へ
export function fromPalm(m, q) { return add(add(m.w.map(v => v * q[0]), m.f, q[1]), m.n, q[2]); }

// 骨の置き場（手の局所。親子は 手→f0→f1→f2、手→t0→t1。値は各骨の親からの位置）
export function boneLayout(m) {
  const at = j => fromPalm(m, [m.wC, m.joints[j].f, m.joints[j].n]);
  const f0 = at(0), f1 = at(1), f2 = at(2);
  const tb = m.thumbBase, tt = m.thumbTip, along = (s) => [tb[0] + (tt[0] - tb[0]) * s, tb[1] + (tt[1] - tb[1]) * s, tb[2] + (tt[2] - tb[2]) * s];
  const t0 = fromPalm(m, along(HAND.thumbJoints[0])), t1 = fromPalm(m, along(HAND.thumbJoints[1]));
  return {
    f0, f1: add(f1, f0, -1), f2: add(f2, f1, -1),
    t0, t1: add(t1, t0, -1),
    world: { f0, f1, f2, t0, t1 },          // 手の局所での位置（逆結合行列に使う）
    lengths: [m.joints[1].f - m.joints[0].f, m.joints[2].f - m.joints[1].f, m.tipF - m.joints[2].f],
  };
}

// 1つの頂点の、手の骨の重み（1とする）の分け方。戻りは { palm, f0, f1, f2, t0, t1 }（合計1）
export function splitHandWeight(m, p) {
  const [pw, pf] = palmCoords(m, p), b = HAND.blend, J = m.joints.map(j => j.f), T = m.tipF;
  const tb = HAND.thumbBand;
  const thumb = smoothstep(m.wHi + HAND.thumbEdge[0], m.wHi + HAND.thumbEdge[1], pw) * smoothstep(tb[0] * T, tb[1] * T, pf) * (1 - smoothstep(tb[2] * T, tb[3] * T, pf));
  const fing = 1 - thumb;
  const s0 = smoothstep(J[0] - b, J[0] + b, pf), s1 = smoothstep(J[1] - b, J[1] + b, pf), s2 = smoothstep(J[2] - b, J[2] + b, pf);
  // 親指の軸に沿った位置（母指球=0、親指の先=1）
  const tb3 = m.thumbBase, tt = m.thumbTip, d = [tt[0] - tb3[0], tt[1] - tb3[1]], len2 = d[0] * d[0] + d[1] * d[1];
  const t = len2 > 0 ? ((pw - tb3[0]) * d[0] + (pf - tb3[1]) * d[1]) / len2 : 0;
  const k0 = smoothstep(HAND.thumbJoints[0] - 0.08, HAND.thumbJoints[0] + 0.08, t), k1 = smoothstep(HAND.thumbJoints[1] - 0.07, HAND.thumbJoints[1] + 0.07, t);
  return {
    palm: fing * (1 - s0) + thumb * (1 - k0),
    f0: fing * (s0 - s1), f1: fing * (s1 - s2), f2: fing * s2,
    t0: thumb * (k0 - k1), t1: thumb * k1,
  };
}

// 4つまでの影響（[骨, 重み]）に絞り、合計 total（既定255）の整数へ量子化する。重みの大きい順に残し、端数は最大の影響へ。
export function quantizeInfluences(list, total = 255, slots = 4) {
  const merged = new Map();
  for (const [bone, w] of list) if (w > 0) merged.set(bone, (merged.get(bone) || 0) + w);
  const kept = [...merged].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, slots);
  const sum = kept.reduce((s, [, w]) => s + w, 0);
  if (!(sum > 0)) return [];
  const out = kept.map(([bone, w]) => [bone, Math.floor(w / sum * total)]);
  out[0][1] += total - out.reduce((s, [, w]) => s + w, 0);
  return out.filter(([, w]) => w > 0);
}

// 鎖を円筒へ巻きつける曲げの角度（2次元）。joint0＝最初の関節 [x, y]（x＝指の向き、y＝手のひらの向き）、
// lengths＝各節の長さ、half＝各節の厚みの半分、center・radius＝円筒の断面。曲げは手のひらの側へ正。
// 各節の中心線が、円筒の表面から指の厚みの半分だけ離れた円（R＝radius＋half）に接するよう、根元から順に決める。
// 関節が既に円の内側なら、その節は曲げない（前の節の向きを保つ）。各関節の角度は 0〜limits に収める。
export function wrapAngles({ joint0, lengths, half, center, radius, limits = HAND.limits }) {
  const angles = [];
  let jx = joint0[0], jy = joint0[1], heading = 0;
  for (let i = 0; i < lengths.length; i++) {
    const R = radius + half[i], dx = center[0] - jx, dy = center[1] - jy, rho = Math.hypot(dx, dy);
    let want = heading;
    if (rho > R) {
      // 円の中心が、進む向きの左（手のひらの側）に R の距離で来る向き：−dx sinα + dy cosα = R
      const beta = Math.atan2(dx, dy), spread = Math.acos(R / rho);
      const cands = [-beta + spread, -beta - spread].map(x => { let y = x; while (y - heading > Math.PI) y -= 2 * Math.PI; while (y - heading < -Math.PI) y += 2 * Math.PI; return y; });
      // 接点が前方にあるほう
      const ahead = cands.filter(al => dx * Math.cos(al) + dy * Math.sin(al) > 0);
      want = (ahead.length ? ahead : cands).reduce((b, x) => (Math.abs(x - heading) < Math.abs(b - heading) ? x : b));
    }
    const bend = clamp(want - heading, 0, limits[i]);
    angles.push(bend);
    heading += bend;
    jx += Math.cos(heading) * lengths[i]; jy += Math.sin(heading) * lengths[i];
  }
  return angles;
}

// 二関節IK（arm-ik.js の solveTwoBone と同じ幾何）を、配列を作らずに解く。毎コマ全員の腕に使うので、新しい配列を確保しない。
// root・mid・end・target・hint は長さ3の配列（読むだけ）。結果は out.mid・out.end（長さ3の配列）へ書き、out.reached・out.error を返す。
export function solveTwoBoneInto(out, root, mid, end, target, hint) {
  const ux = mid[0] - root[0], uy = mid[1] - root[1], uz = mid[2] - root[2];
  const lx = end[0] - mid[0], ly = end[1] - mid[1], lz = end[2] - mid[2];
  let dx = target[0] - root[0], dy = target[1] - root[1], dz = target[2] - root[2];
  const a = Math.hypot(ux, uy, uz), b = Math.hypot(lx, ly, lz), distance = Math.hypot(dx, dy, dz);
  const near = Math.abs(a - b), far = a + b;
  const reached = distance >= near && distance <= far;
  const reach = Math.max(near, Math.min(far, distance));
  if (distance > 0) { dx /= distance; dy /= distance; dz /= distance; }
  else {
    const cx = end[0] - root[0], cy = end[1] - root[1], cz = end[2] - root[2], cl = Math.hypot(cx, cy, cz);
    if (cl > 0) { dx = cx / cl; dy = cy / cl; dz = cz / cl; } else if (a > 0) { dx = ux / a; dy = uy / a; dz = uz / a; } else { dx = 1; dy = 0; dz = 0; }
  }
  const ex = reached ? target[0] : root[0] + dx * reach, ey = reached ? target[1] : root[1] + dy * reach, ez = reached ? target[2] : root[2] + dz * reach;
  const hx = hint[0] - root[0], hy = hint[1] - root[1], hz = hint[2] - root[2], hd = hx * dx + hy * dy + hz * dz;
  let bx = hx - dx * hd, by = hy - dy * hd, bz = hz - dz * hd;
  if (Math.hypot(bx, by, bz) <= 1e-12) { const ud = ux * dx + uy * dy + uz * dz; bx = ux - dx * ud; by = uy - dy * ud; bz = uz - dz * ud; }
  let bl = Math.hypot(bx, by, bz);
  if (bl > 1e-12) { bx /= bl; by /= bl; bz /= bl; }
  else {
    // 最も平行でない軸（arm-ik.js の perpendicular と同じ選び方）
    const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz), i = ax <= ay && ax <= az ? 0 : ay <= az ? 1 : 2;
    const px = i === 0 ? 1 : 0, py = i === 1 ? 1 : 0, pz = i === 2 ? 1 : 0, pd = px * dx + py * dy + pz * dz;
    bx = px - dx * pd; by = py - dy * pd; bz = pz - dz * pd; bl = Math.hypot(bx, by, bz); bx /= bl; by /= bl; bz /= bl;
  }
  out.end[0] = ex; out.end[1] = ey; out.end[2] = ez;
  if (reach === 0) {
    const tl = Math.hypot(hx, hy, hz);
    let fx, fy, fz;
    if (tl > 1e-12) { fx = hx / tl; fy = hy / tl; fz = hz / tl; } else if (a > 0) { fx = ux / a; fy = uy / a; fz = uz / a; } else { fx = bx; fy = by; fz = bz; }
    out.mid[0] = root[0] + fx * a; out.mid[1] = root[1] + fy * a; out.mid[2] = root[2] + fz * a;
  } else {
    const along = (a * a - b * b + reach * reach) / (2 * reach), height = Math.sqrt(Math.max(0, a * a - along * along));
    out.mid[0] = root[0] + dx * along + bx * height; out.mid[1] = root[1] + dy * along + by * height; out.mid[2] = root[2] + dz * along + bz * height;
  }
  out.reached = reached;
  out.error = Math.hypot(target[0] - ex, target[1] - ey, target[2] - ez);
  return out;
}

// 柄のまわりの手の回り φ を、腕が届く範囲で want に最も近く選ぶ（毎コマ呼ぶので、引数は数のまま。配列を作らない）。
// (x0,y0,z0)＝回り0のときの手首の位置、(sx,sy,sz)＝肩、どちらも柄の枠（+Y が柄の軸）。回り φ の手首は柄の軸まわりに φ（Three.js の makeRotationY と同じ向き）。
// |手首(φ) − 肩| ≤ reach となる φ は、φ* を中心とする弧になる。want がその弧の外なら、弧の端（margin だけ内側）へ寄せる。どの φ でも届かないなら φ*（最も近い）。
export function rollWithinReach(x0, y0, z0, sx, sy, sz, reach, want = 0, margin = 0.05) {
  const P = sx * x0 + sz * z0, Q = sx * z0 - sz * x0, K = Math.hypot(P, Q);
  const base = x0 * x0 + y0 * y0 + z0 * z0 + sx * sx + sy * sy + sz * sz - 2 * sy * y0;
  if (K < 1e-12) return want;
  const best = Math.atan2(Q, P), kappa = (base - reach * reach) / (2 * K);
  if (kappa <= -1) return want;
  if (kappa >= 1) return best;
  const half = Math.max(0, Math.acos(kappa) - margin);
  let d = want - best; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
  return want - (d - clamp(d, -half, half));     // want から測る（届くなら want そのもの。2πずれた同じ向きを返さない）
}

// ---- 実際の頂点で握りを合わせる（型ごとに1回）
// 骨の回り：指は手の横の軸 c、親指は親指の向き d と手のひらの向き n から作る曲げの軸 d×n（どちらも、正の角で手のひらの側へ曲がる）。
export function thumbAxis(m) {
  const d = unit(add(fromPalm(m, m.thumbTip), fromPalm(m, m.thumbBase), -1));
  return unit(cross(d, m.n));
}
// 軸 axis（単位）のまわりに angle だけ回す3×3（行優先）
function rotation(axis, angle) {
  const [x, y, z] = axis, c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}
const mv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const mm = (a, b) => [0, 1, 2].flatMap(r => [0, 1, 2].map(c => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
// 指・親指の骨の姿勢（手の局所で、結合姿勢の点 v → R v + t）。layout は boneLayout、fingers・thumb は各関節の曲げ（rad）
export function poseDigits(layout, axes, fingers, thumb) {
  const R1 = rotation(axes.curl, fingers[0]), R12 = mm(R1, rotation(axes.curl, fingers[1])), R123 = mm(R12, rotation(axes.curl, fingers[2]));
  const S1 = rotation(axes.thumb, thumb[0]), S12 = mm(S1, rotation(axes.thumb, thumb[1]));
  const p0 = layout.world.f0, p1 = layout.world.f1, p2 = layout.world.f2, q0 = layout.world.t0, q1 = layout.world.t1;
  const pose = (R, pivots) => { // R は根元からの合成。pivots は [関節の結合位置, その関節までの合成回転] の列
    let t = [0, 0, 0];
    for (const [p, Rp, Rn] of pivots) t = add(t, add(mv(Rp, p), mv(Rn, p), -1));
    return { R, t };
  };
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return {
    f0: pose(R1, [[p0, I, R1]]),
    f1: pose(R12, [[p0, I, R1], [p1, R1, R12]]),
    f2: pose(R123, [[p0, I, R1], [p1, R1, R12], [p2, R12, R123]]),
    t0: pose(S1, [[q0, I, S1]]),
    t1: pose(S12, [[q0, I, S1], [q1, S1, S12]]),
  };
}
// 結合姿勢の点 v（手の局所）と重みの分け方 split から、曲げたあとの位置（線形の皮）
export function skinDigits(v, split, poses) {
  let x = v[0] * split.palm, y = v[1] * split.palm, z = v[2] * split.palm;
  for (const k of ['f0', 'f1', 'f2', 't0', 't1']) {
    const s = split[k]; if (!(s > 0)) continue;
    const p = poses[k], r = mv(p.R, v);
    x += s * (r[0] + p.t[0]); y += s * (r[1] + p.t[1]); z += s * (r[2] + p.t[2]);
  }
  return [x, y, z];
}
// 円筒（中心線が点 center・向き axis、半径 radius）の表面からの符号つき距離（外が正）
export function cylinderDistance(p, center, axis, radius) {
  const d = add(p, center, -1), along = dot(d, axis);
  return Math.hypot(d[0] - axis[0] * along, d[1] - axis[1] * along, d[2] - axis[2] * along) - radius;
}

// 実際の頂点で、円筒（半径 radius）を握る形を合わせる。verts＝[{ p: 結合姿勢の手の局所, s: splitHandWeight の結果 }]
//   1. 円筒の中心線は手の横の軸 c に沿い、指の付け根の関節より channelBack だけ手首側。手のひらの側の高さは、その幅の手のひらの頂点が円筒に入らない最小。
//   2. 指（3関節を1つの板として）：板の幅を4つ（4本の指）× 3節の各組で、柄にいちばん近い皮が表面から contact だけ離れるよう、めり込みを重く数えて、関節の角を少しずつ動かして合わせる（座標降下）。
//   3. 親指（2関節）：親指の皮がめり込まず、先の節が表面に近いよう、角の格子を探す。
export const FIT = Object.freeze({ contact: 0.0008, sinkWeight: 400, sinkLimit: 0.001, margin: 0.0005, liftMax: 0.006, thumbGrid: Object.freeze([-0.5, 1.7, 0, 1.3, 0.05]) });
export function fitGrip(m, layout, verts, radius) {
  const axes = { curl: m.c, thumb: thumbAxis(m) };
  const fC = m.joints[0].f - HAND.channelBack;
  // 1 中心線の手のひらの側の高さ（その幅の手のひらの頂点が円筒に入らない最小）。指の当たりを見て、さらに liftMax まで浮かせてよい
  let nC0 = -Infinity;
  for (const { p, s } of verts) {
    const [pw, pf, pn] = palmCoords(m, p);
    if (s.palm < 0.5 || pw < m.wLo || pw > m.wHi || Math.abs(pf - fC) >= radius) continue;
    nC0 = Math.max(nC0, pn + Math.sqrt(radius * radius - (pf - fC) ** 2));
  }
  if (!Number.isFinite(nC0)) nC0 = m.palmAt(fC) + radius;
  nC0 += FIT.margin;
  let lift = 0, center = fromPalm(m, [m.wC, fC, nC0]);
  const axis = m.c;
  // 組：指は 節 × 板の幅の4分の1、親指は節ごと
  const groups = new Map();
  for (const v of verts) {
    let best = 'palm', bw = v.s.palm;
    for (const k of ['f0', 'f1', 'f2', 't0', 't1']) if (v.s[k] > bw) { bw = v.s[k]; best = k; }
    if (best === 'palm' || bw < 0.5) continue;
    let key = best;
    if (best[0] === 'f') {
      const pw = palmCoords(m, v.p)[0];
      if (pw < m.wLo || pw > m.wHi) continue;                    // 板の幅の外（親指との水かき）は、指の当たりに数えない
      key += '/' + Math.max(0, Math.min(3, Math.floor((pw - m.wLo) / (m.wHi - m.wLo) * 4)));
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }
  const thumbVerts = verts.filter(v => v.s.t0 + v.s.t1 >= 0.5);   // 親指が主の頂点（人差し指との水かきは、指の側で数える）
  const minDist = (list, poses) => { let d = Infinity; for (const v of list) d = Math.min(d, cylinderDistance(skinDigits(v.p, v.s, poses), center, axis, radius)); return d; };
  const energy = (fingers, lifted) => {
    center = fromPalm(m, [m.wC, fC, nC0 + lifted]);
    const poses = poseDigits(layout, axes, fingers, [0, 0]);
    let e = 0;
    for (const [key, list] of groups) {
      if (key[0] !== 'f') continue;
      const err = minDist(list, poses) - FIT.contact;
      e += err < 0 ? FIT.sinkWeight * err * err : err * err;
    }
    return e;
  };
  // 2 指：2次元の巻きつけを初期値に、3つの角と円筒の浮きを座標降下
  const half = m.joints.map(j => Math.min(j.half, 0.009));
  const lengths = [m.joints[1].f - m.joints[0].f, m.joints[2].f - m.joints[1].f, m.tipF - m.joints[2].f];
  let fingers = wrapAngles({ joint0: [m.joints[0].f, m.joints[0].n], lengths, half, center: [fC, nC0], radius });
  let best = energy(fingers, lift);
  for (let step = 0.12; step > 0.002; step /= 2) {
    for (let improved = true, guard = 0; improved && guard < 40; guard++) {
      improved = false;
      for (let k = 0; k < 4; k++) for (const sgn of [1, -1]) {
        const trial = fingers.slice(); let l = lift;
        if (k < 3) trial[k] = clamp(trial[k] + sgn * step, 0, HAND.limits[k]); else l = clamp(lift + sgn * step * 0.02, 0, FIT.liftMax);
        const e = energy(trial, l);
        if (e < best - 1e-12) { best = e; fingers = trial; lift = l; improved = true; }
      }
    }
  }
  center = fromPalm(m, [m.wC, fC, nC0 + lift]);
  // 3 親指：格子で探す。皮が sinkLimit より深く入る姿勢は採らず、その中で先の節が表面に近いもの（曲げは小さいほど良い）
  const tip = groups.get('t1') || [];
  let thumb = [0, 0], tBest = Infinity, fallback = [0, 0], fbSink = -Infinity;
  const [a0, a1, b0, b1, gs] = FIT.thumbGrid;   // 付け根は少し反らす（手のひらから離す）側も探す
  for (let a = a0; a <= a1 + 1e-9; a += gs) for (let b = b0; b <= b1 + 1e-9; b += gs) {
    const poses = poseDigits(layout, axes, fingers, [a, b]), sink = minDist(thumbVerts, poses);
    if (sink > fbSink) { fbSink = sink; fallback = [a, b]; }
    if (sink < -FIT.sinkLimit) continue;
    const near = tip.length ? minDist(tip, poses) : 0, e = (near - FIT.contact) ** 2 + 1e-6 * (a + b);
    if (e < tBest) { tBest = e; thumb = [a, b]; }
  }
  if (tBest === Infinity) thumb = fallback;
  const poses = poseDigits(layout, axes, fingers, thumb), report = {};
  for (const [key, list] of groups) report[key] = minDist(list, poses);
  report.sinkAll = minDist(verts, poses);
  return { center, axis, fC, nC: nC0 + lift, lift, fingers, thumb, axes, report };
}
