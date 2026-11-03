// hand-grip.js — 手の指の骨を合成して、柄・鞘を握らせるための純粋な計算（Three.js非依存）。設計は design-hand-grip.md。
// 人物GLB（Meshy）は指の骨を持たず、指はそろえて開いた1枚の面（4本は側面でつながる。侍大将は先の近くまでつながる）。そこで、
//   指4本をそれぞれ1本の鎖（付け根・中・先の3関節）、親指を1本の鎖（2関節）として、手の頂点の重みを分ける。隣の指との境は横に混ぜる。
//   握る形（指ごとの関節の角と、円筒の中心線の位置）は、その型の実際の頂点で合わせる（fitGrip。型ごとに1回）。
// 座標は「手の骨の局所（結合姿勢）」。f＝指の向き（骨の +Y）、n＝手のひらの向き、w＝親指の側。単位は m・rad。
// 指の番号 k は板の幅を4つに分けた順（0＝小指の側、3＝人差し指の側）。骨の名は 'f' + k + 関節（0＝付け根・1＝中・2＝先）。

export const HAND = Object.freeze({
  frameBand: Object.freeze([0.72, 0.9]),   // 指の板の横の軸を求める帯（指先の高さに対する比。親指を含まない）
  joints: Object.freeze([0.60, 0.78, 0.89]), // 指の付け根・中・先の関節（その指の先の高さに対する比）
  blend: 0.006,                            // 関節の前後で重みを混ぜる半幅
  fingerBlend: 0.0035,                     // 隣の指との境で重みを混ぜる半幅
  thumbFrom: 0.25, thumbJoints: Object.freeze([0.45, 0.75]),   // 親指の軸（母指球→親指の先）の上の関節の位置
  thumbEdge: Object.freeze([-0.004, 0.010]),                   // 指の板の縁から外へ、親指に属し始める幅（m）
  thumbBand: Object.freeze([0.25, 0.40, 0.80, 0.86]),          // 親指に属する高さの範囲（入り始め・入り切る・抜け始め・抜け切る）
  relaxed: Object.freeze([0.16, 0.22, 0.12]),                   // 握っていない手の、指の軽い曲げ（rad）
  cascade: Object.freeze([1.3, 1.15, 1.0, 0.85]),              // 握っていない指の曲げの、指ごとの倍率（小指ほど深い。そろうと板に見えた）
  relaxedThumb: Object.freeze([0.10, 0.08]),
  limits: Object.freeze([1.65, 1.9, 1.4]),                      // 指の関節の曲げの上限（rad）
  channelBack: 0.012,                                           // 柄の中心を、指の付け根の関節より手首側へ置く量（m）
});
export const FINGERS = 4;
export const DIGIT_KEYS = Object.freeze(['f00', 'f01', 'f02', 'f10', 'f11', 'f12', 'f20', 'f21', 'f22', 'f30', 'f31', 'f32', 't0', 't1']);

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
  // 指ごと：板の幅の4分の1。関節の高さと厚みの中心は、4本で共有する（板と同じ。指ごとの先の高さの比にすると、小指の付け根が2cm下がり、
  // 同じ角でも柄から外れて、板の合わせが4.5mmから12mmへ悪化した。実測）。先の高さだけ、その幅の頂点の最大を持つ
  const fw = (wHi - wLo) / FINGERS, fingers = [];
  for (let k = 0; k < FINGERS; k++) {
    const lo = wLo + k * fw, hi = lo + fw;
    let tip = 0; for (const q of pc) if (q[0] >= lo && q[0] <= hi && q[1] > tip) tip = q[1];
    fingers.push({ lo, hi, wC: (lo + hi) / 2, tip: tip > 0.6 * tipF ? tip : tipF, joints });
  }
  // 親指：板の縁より外で、指先より低い所の、いちばん外の点が親指の先
  const rim = pc.filter(q => q[1] > 0.3 * tipF && q[1] < 0.8 * tipF);
  const thumbTip = rim.reduce((b, q) => (q[0] > b[0] ? q : b), rim[0]);
  const thumbBase = [wHi - 0.01, HAND.thumbFrom * tipF, section(HAND.thumbFrom * tipF).n];
  return { side, f, w, n, c: cross(f, n), tipF, wLo, wHi, wC, joints, fingers, thumbTip, thumbBase, thumbAgrees, palmAt: fy => section(fy).palm };
}

// 手の局所の点を、手のひらの座標 [w, f, n] へ
export function palmCoords(m, p) { return [dot(p, m.w), p[1], dot(p, m.n)]; }
// 手のひらの座標を、手の局所へ
export function fromPalm(m, q) { return add(add(m.w.map(v => v * q[0]), m.f, q[1]), m.n, q[2]); }

// 骨の置き場（手の局所。親子は 手→f{k}0→f{k}1→f{k}2、手→t0→t1。値は各骨の親からの位置）
export function boneLayout(m) {
  const out = { world: {} };
  m.fingers.forEach((fg, k) => {
    let prev = [0, 0, 0];
    fg.joints.forEach((j, i) => { const p = fromPalm(m, [fg.wC, j.f, j.n]), key = 'f' + k + i; out.world[key] = p; out[key] = add(p, prev, -1); prev = p; });
  });
  const tb = m.thumbBase, tt = m.thumbTip, along = (s) => [tb[0] + (tt[0] - tb[0]) * s, tb[1] + (tt[1] - tb[1]) * s, tb[2] + (tt[2] - tb[2]) * s];
  const t0 = fromPalm(m, along(HAND.thumbJoints[0])), t1 = fromPalm(m, along(HAND.thumbJoints[1]));
  out.world.t0 = t0; out.world.t1 = t1; out.t0 = t0; out.t1 = add(t1, t0, -1);
  out.lengths = m.fingers.map(fg => [fg.joints[1].f - fg.joints[0].f, fg.joints[2].f - fg.joints[1].f, fg.tip - fg.joints[2].f]);
  return out;
}

// 横の位置 pw の、4本の指への分け方（合計1。境の前後 fingerBlend で混ぜる）
export function fingerShares(m, pw) {
  const fw = (m.wHi - m.wLo) / FINGERS, h = HAND.fingerBlend, out = [0, 0, 0, 0];
  let upper = 1;   // 番号が k 以上の指の分
  for (let k = 0; k < FINGERS; k++) {
    const next = k === FINGERS - 1 ? 0 : smoothstep(m.wLo + (k + 1) * fw - h, m.wLo + (k + 1) * fw + h, pw);
    out[k] = upper - next; upper = next;
  }
  return out;
}

// 1つの頂点の、手の骨の重み（1とする）の分け方。戻りは { palm, f00…f32, t0, t1 }（合計1）
export function splitHandWeight(m, p) {
  const [pw, pf] = palmCoords(m, p), b = HAND.blend, T = m.tipF;
  const tb = HAND.thumbBand;
  const thumb = smoothstep(m.wHi + HAND.thumbEdge[0], m.wHi + HAND.thumbEdge[1], pw) * smoothstep(tb[0] * T, tb[1] * T, pf) * (1 - smoothstep(tb[2] * T, tb[3] * T, pf));
  const fing = 1 - thumb, share = fingerShares(m, pw), out = { palm: 0 };
  for (let k = 0; k < FINGERS; k++) {
    const J = m.fingers[k].joints, g = fing * share[k];
    const s0 = smoothstep(J[0].f - b, J[0].f + b, pf), s1 = smoothstep(J[1].f - b, J[1].f + b, pf), s2 = smoothstep(J[2].f - b, J[2].f + b, pf);
    out.palm += g * (1 - s0);
    out['f' + k + '0'] = g * (s0 - s1); out['f' + k + '1'] = g * (s1 - s2); out['f' + k + '2'] = g * s2;
  }
  // 親指の軸に沿った位置（母指球=0、親指の先=1）
  const tb3 = m.thumbBase, tt = m.thumbTip, d = [tt[0] - tb3[0], tt[1] - tb3[1]], len2 = d[0] * d[0] + d[1] * d[1];
  const t = len2 > 0 ? ((pw - tb3[0]) * d[0] + (pf - tb3[1]) * d[1]) / len2 : 0;
  const k0 = smoothstep(HAND.thumbJoints[0] - 0.08, HAND.thumbJoints[0] + 0.08, t), k1 = smoothstep(HAND.thumbJoints[1] - 0.07, HAND.thumbJoints[1] + 0.07, t);
  out.palm += thumb * (1 - k0);
  out.t0 = thumb * (k0 - k1); out.t1 = thumb * k1;
  return out;
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
const I3 = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);
// 指・親指の骨の姿勢（手の局所で、結合姿勢の点 v → R v + t）。layout は boneLayout、fingers は指ごとの [付け根, 中, 先] の曲げ（rad）、thumb は親指の2関節
export function poseDigits(layout, axes, fingers, thumb) {
  const pose = (R, pivots) => { // R は根元からの合成。pivots は [関節の結合位置, その関節までの合成回転, その関節のあとの合成回転] の列
    let t = [0, 0, 0];
    for (const [p, Rp, Rn] of pivots) t = add(t, add(mv(Rp, p), mv(Rn, p), -1));
    return { R, t };
  };
  const out = {};
  for (let k = 0; k < FINGERS; k++) {
    const a = fingers[k], R1 = rotation(axes.curl, a[0]), R12 = mm(R1, rotation(axes.curl, a[1])), R123 = mm(R12, rotation(axes.curl, a[2]));
    const p0 = layout.world['f' + k + '0'], p1 = layout.world['f' + k + '1'], p2 = layout.world['f' + k + '2'];
    out['f' + k + '0'] = pose(R1, [[p0, I3, R1]]);
    out['f' + k + '1'] = pose(R12, [[p0, I3, R1], [p1, R1, R12]]);
    out['f' + k + '2'] = pose(R123, [[p0, I3, R1], [p1, R1, R12], [p2, R12, R123]]);
  }
  const S1 = rotation(axes.thumb, thumb[0]), S12 = mm(S1, rotation(axes.thumb, thumb[1])), q0 = layout.world.t0, q1 = layout.world.t1;
  out.t0 = pose(S1, [[q0, I3, S1]]);
  out.t1 = pose(S12, [[q0, I3, S1], [q1, S1, S12]]);
  return out;
}
// 結合姿勢の点 v（手の局所）と重みの分け方 split から、曲げたあとの位置（線形の皮）
export function skinDigits(v, split, poses) {
  let x = v[0] * split.palm, y = v[1] * split.palm, z = v[2] * split.palm;
  for (const k of DIGIT_KEYS) {
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
// 頂点の組の名前（回帰の報告と同じ）：指は 'f' + 関節 + '/' + 指、親指は 't0'・'t1'
export const groupName = key => key[0] === 'f' ? 'f' + key[2] + '/' + key[1] : key;

// 実際の頂点で、円筒（半径 radius）を握る形を合わせる。verts＝[{ p: 結合姿勢の手の局所, s: splitHandWeight の結果 }]
//   1. 円筒の中心線は手の横の軸 c に沿い、指の付け根の関節より channelBack だけ手首側。手のひらの側の高さは、その幅の手のひらの頂点が円筒に入らない最小。
//   2a. 指を板として（4本とも同じ角で）合わせる：各指の各節で、柄にいちばん近い皮が表面から contact だけ離れるよう、めり込みを重く数えて、
//       3つの角と、円筒の浮き・指の向きのずれを少しずつ動かす（座標降下）。いちばん離れた節は worstWeight 倍で足す。
//   2b. 指ごとの差：板の角からのずれを、指ごとに spread まで・隣の指との差を neighbor までに抑えて、同じ式（＋すべての皮のめり込み）で合わせる。
//       隣の指と角が大きく違うと、境で混ぜた皮が2つの位置の中ほど（柄の内側）へ落ちる（線形の皮の弦）。指ごとに独立に合わせると、侍大将で5〜12mmめり込んだ（実測）。
//   3. 親指（2関節）：親指の皮がめり込まず、先の節が表面に近いよう、角の格子を探す。
export const FIT = Object.freeze({ contact: 0.0008, sinkWeight: 400, sinkLimit: 0.001, margin: 0.0005, liftMax: 0.006, shift: Object.freeze([-0.008, 0.006]), worstWeight: 25, spread: 0.35, neighbor: 0.22, thumbGrid: Object.freeze([-0.5, 1.7, 0, 1.3, 0.05]), thumbWide: Object.freeze([-1.2, 1.7, -0.5, 1.3, 0.05]) });
export function fitGrip(m, layout, verts, radius) {
  const axes = { curl: m.c, thumb: thumbAxis(m) };
  const fC0 = m.joints[0].f - HAND.channelBack;
  // 1 中心線の手のひらの側の高さ（その幅の手のひらの頂点が円筒に入らない最小）。指の当たりを見て、さらに liftMax まで浮かせ、指の向きに shift まで動かしてよい
  const nCache = new Map();
  const nCOf = fc => {
    const key = Math.round(fc * 1e6);
    if (nCache.has(key)) return nCache.get(key);
    let n = -Infinity;
    for (const { p, s } of verts) {
      const [pw, pf, pn] = palmCoords(m, p);
      if (s.palm < 0.5 || pw < m.wLo || pw > m.wHi || Math.abs(pf - fc) >= radius) continue;
      n = Math.max(n, pn + Math.sqrt(radius * radius - (pf - fc) ** 2));
    }
    if (!Number.isFinite(n)) n = m.palmAt(fc) + radius;
    nCache.set(key, n + FIT.margin);
    return n + FIT.margin;
  };
  let fC = fC0, nC0 = nCOf(fC0);
  const axis = m.c;
  // 頂点ごとの影響を、数の配列で持つ（合わせの間に何千回も皮を計算するので）
  const prep = verts.map(v => ({ p: v.p, palm: v.s.palm, inf: DIGIT_KEYS.map((k, i) => [i, v.s[k] || 0]).filter(x => x[1] > 0) }));
  // 組：最も重い指・親指の骨（重み0.5以上）。指は板の幅の中だけ（親指との水かきは数えない）
  const groups = new Map();
  prep.forEach((v, n) => {
    let best = -1, bw = v.palm;
    for (const [i, w] of v.inf) if (w > bw) { bw = w; best = i; }
    if (best < 0 || bw < 0.5) return;
    const key = DIGIT_KEYS[best];
    if (key[0] === 'f') { const pw = palmCoords(m, v.p)[0]; if (pw < m.wLo || pw > m.wHi) return; }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  });
  const fingerGroups = [0, 1, 2, 3].map(k => [0, 1, 2].map(j => groups.get('f' + k + j) || []));
  const thumbVerts = prep.filter(v => v.inf.reduce((s, [i, w]) => s + (i >= 12 ? w : 0), 0) >= 0.5);   // 親指が主の頂点
  const webVerts = prep.filter(v => v.inf.some(([i]) => i >= 12) && !thumbVerts.includes(v));   // 親指に少し付く頂点（人差し指との水かき）
  let center = fromPalm(m, [m.wC, fC, nC0]);
  const poseList = poses => DIGIT_KEYS.map(k => poses[k]);
  const skinMin = (list, P) => {
    let best = Infinity;
    for (const v of list) {
      const p = v.p; let x = p[0] * v.palm, y = p[1] * v.palm, z = p[2] * v.palm;
      for (const [i, w] of v.inf) { const { R, t } = P[i]; x += w * (R[0] * p[0] + R[1] * p[1] + R[2] * p[2] + t[0]); y += w * (R[3] * p[0] + R[4] * p[1] + R[5] * p[2] + t[1]); z += w * (R[6] * p[0] + R[7] * p[1] + R[8] * p[2] + t[2]); }
      const dx = x - center[0], dy = y - center[1], dz = z - center[2], al = dx * axis[0] + dy * axis[1] + dz * axis[2];
      const d = Math.hypot(dx - axis[0] * al, dy - axis[1] * al, dz - axis[2] * al) - radius;
      if (d < best) best = d;
    }
    return best;
  };
  const errOf = d => { const e = d - FIT.contact; return e < 0 ? FIT.sinkWeight * e * e : e * e; };
  const fingerVerts = prep.filter(v => v.inf.reduce((s, [i, w]) => s + (i < 12 ? w : 0), 0) > 0);
  let groupSets = fingerGroups, sinkSet = fingerVerts;   // 2b では、柄に近い頂点だけに絞る（合わせの時間の大半が2bだった）
  const energy = (fingers, all) => {
    const P = poseList(poseDigits(layout, axes, fingers, [0, 0]));
    let e = 0, worst = 0;
    for (const lists of groupSets) for (const list of lists) if (list.length) { const q = errOf(skinMin(list, P)); e += q; worst = Math.max(worst, q); }
    e += FIT.worstWeight * worst;   // いちばん離れた節も重く数える（和だけだと、侍大将で1つの節が7mm離れたまま残った。6・12・25で比べ、25が全員で最小）
    if (all) { const s = skinMin(sinkSet, P) + FIT.sinkLimit; if (s < 0) e += FIT.sinkWeight * s * s; }
    return e;
  };
  const place = (s, l) => { fC = fC0 + s; nC0 = nCOf(fC); center = fromPalm(m, [m.wC, fC, nC0 + l]); };
  // 2a 板：板の2次元の巻きつけを初期値に、3つの角と、円筒の浮き・指の向きのずれを座標降下
  const half = m.joints.map(j => Math.min(j.half, 0.009));
  const lengths = [m.joints[1].f - m.joints[0].f, m.joints[2].f - m.joints[1].f, m.tipF - m.joints[2].f];
  let plate = wrapAngles({ joint0: [m.joints[0].f, m.joints[0].n], lengths, half, center: [fC, nC0], radius }), lift = 0, shift = 0;
  const same = a => [a, a, a, a];
  place(shift, lift);
  let best = energy(same(plate), false);
  for (let step = 0.12; step > 0.002; step /= 2) {
    for (let improved = true, guard = 0; improved && guard < 40; guard++) {
      improved = false;
      for (let k = 0; k < 5; k++) for (const sgn of [1, -1]) {
        const trial = plate.slice(); let l = lift, s = shift;
        if (k < 3) trial[k] = clamp(trial[k] + sgn * step, 0, HAND.limits[k]);
        else if (k === 3) l = clamp(lift + sgn * step * 0.02, 0, FIT.liftMax);
        else s = clamp(shift + sgn * step * 0.02, FIT.shift[0], FIT.shift[1]);
        place(s, l); const e = energy(same(trial), false);
        if (e < best - 1e-12) { best = e; plate = trial; lift = l; shift = s; improved = true; }
      }
    }
  }
  place(shift, lift);
  // 2b 指ごとの差（板の角からのずれ。指ごとに spread まで・隣の指との差は neighbor まで）。
  //    数えるのは、板の姿勢で柄の表面から near 以内の頂点だけ（各組は最も近い頂点から near 以内）。最後の報告は全部の頂点で測る
  let fingers = same(plate).map(a => a.slice());
  {
    const P0 = poseList(poseDigits(layout, axes, fingers, [0, 0])), near = 0.012, dOf = v => skinMin([v], P0);
    groupSets = fingerGroups.map(lists => lists.map(list => { if (!list.length) return list; const d = list.map(dOf), m0 = Math.min(...d); return list.filter((_, i) => d[i] < m0 + near); }));
    sinkSet = fingerVerts.filter(v => dOf(v) < near);
  }
  const allowed = (fs, k, j) => Math.abs(fs[k][j] - plate[j]) <= FIT.spread + 1e-12 && (k === 0 || Math.abs(fs[k][j] - fs[k - 1][j]) <= FIT.neighbor + 1e-12) && (k === FINGERS - 1 || Math.abs(fs[k][j] - fs[k + 1][j]) <= FIT.neighbor + 1e-12);
  best = energy(fingers, true);
  for (let step = 0.08; step > 0.002; step /= 2) {
    for (let improved = true, guard = 0; improved && guard < 25; guard++) {
      improved = false;
      for (let k = 0; k < FINGERS; k++) for (let j = 0; j < 3; j++) for (const sgn of [1, -1]) {
        const trial = fingers.map(a => a.slice()); trial[k][j] = clamp(trial[k][j] + sgn * step, 0, HAND.limits[j]);
        if (!allowed(trial, k, j)) continue;
        const e = energy(trial, true);
        if (e < best - 1e-12) { best = e; fingers = trial; improved = true; }
      }
    }
  }
  // 3 親指：格子で探す。皮が sinkLimit より深く入る姿勢は採らず、その中で先の節が表面に近いもの（曲げは小さいほど良い）。
  //   付け根は少し反らす（手のひらから離す）側も探す。どれも入るときだけ、さらに反らす・先を反らす広い格子（thumbWide）で探す
  //   （はじめから広い格子にすると、兵の右手で付け根を大きく反らした姿勢が選ばれ、甲の上に親指の先がとげのように立った。兵の左手は狭い格子では3mm入る。実測）
  const tip = groups.get('t1') || [];
  let thumb = [0, 0], tBest = Infinity, fallback = [0, 0], fbSink = -Infinity;
  // 格子は2段：その格子の2倍の目で探し、いちばん良い姿勢のまわりを元の目で探す（合わせの時間を縮める）
  const tryThumb = (a, b, lim) => {
    if (a < lim[0] - 1e-9 || a > lim[1] + 1e-9 || b < lim[2] - 1e-9 || b > lim[3] + 1e-9) return;
    const P = poseList(poseDigits(layout, axes, fingers, [a, b])), sink = skinMin(thumbVerts, P);
    if (sink > fbSink) { fbSink = sink; fallback = [a, b]; }
    if (sink < -FIT.sinkLimit) return;
    // 水かきのめり込みは重く数える（親指が主の頂点だけで選ぶと、兵の右手の水かきが2mm入った。水かきで弾くと、狭い格子に入らない姿勢が無くなり、親指がとげのように立った）
    const web = webVerts.length ? Math.min(0, skinMin(webVerts, P) + FIT.sinkLimit) : 0;
    const near = tip.length ? skinMin(tip, P) : 0, e = (near - FIT.contact) ** 2 + FIT.sinkWeight * web * web + 1e-6 * (a + b);
    if (e < tBest) { tBest = e; thumb = [a, b]; }
  };
  for (const lim of [FIT.thumbGrid, FIT.thumbWide]) {
    const gs = lim[4];
    for (let a = lim[0]; a <= lim[1] + 1e-9; a += 2 * gs) for (let b = lim[2]; b <= lim[3] + 1e-9; b += 2 * gs) tryThumb(a, b, lim);
    if (tBest < Infinity) { const [a, b] = thumb; for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) tryThumb(a + i * gs, b + j * gs, lim); break; }
    const [a, b] = fallback; for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) tryThumb(a + i * gs, b + j * gs, lim);
    if (tBest < Infinity) break;
  }
  if (tBest === Infinity) thumb = fallback;
  const P = poseList(poseDigits(layout, axes, fingers, thumb)), report = {};
  for (const [key, list] of groups) report[groupName(key)] = skinMin(list, P);
  report.sinkAll = skinMin(prep, P);
  return { center, axis, fC, nC: nC0 + lift, lift, shift, fingers, thumb, axes, report };
}

// 握った手の、柄の軸に沿った広がり（中心線の点 center から、向き axis へ測った最大）。軸から rMax より遠い皮は数えない（鍔に当たる所だけ）
export function gripExtent(layout, axes, fit, verts, axis, rMax) {
  const poses = poseDigits(layout, axes, fit.fingers, fit.thumb);
  let ext = -Infinity;
  for (const v of verts) {
    const q = skinDigits(v.p, v.s, poses), d = add(q, fit.center, -1), along = dot(d, axis);
    if (Math.hypot(d[0] - axis[0] * along, d[1] - axis[1] * along, d[2] - axis[2] * along) <= rMax) ext = Math.max(ext, along);
  }
  return ext;
}
