// 走りの形（上半身）の物差し（要件 R36・R38、design-locomotion-smooth §6・M3）。純粋：渡された毎コマの記録だけを読む。外部依存なし。
// 記録は smooth-journey.mjs の frames（bones＝世界の位置と向き [px,py,pz,qx,qy,qz,qw]・modelYaw・pos・speed・t・tag）。
// M0 の指標（関節の跳ね・足の滑り）は「ロボットのような硬さ」を捉えられない（動かない腕は跳ねもしない）。ここでは動きの「量と同期」を測る：
//   腕振り＝上腕（肩→肘）の前後の角度の幅（度）と、反対側の太もも（股→膝）の角度との相関（位相差つき）。手の前後の行き来（cm）。
//   体幹＝骨盤の向き（左右の股を結ぶ線）と胸の向き（左右の肩を結ぶ線）の、進む向きからの角の幅と、その相関（負＝逆回転）。
//   頭＝頭の向き（最初のコマの前向きの軸を追う）の左右・上下の揺れの幅、高さの揺れ、角加速度の p99。
//   骨盤の上下＝腰の高さ（地面から）の最大−最小（cm）。前傾＝腰→首の線の前への傾き（度）。曲がりの傾き＝同じ線の横への傾きと、横の加速度の向き。
// 角の向き：模型の前＝(sin 向き, 0, cos 向き)、右＝前×上＝(−cos, 0, sin)。前・右・上へ倒れるのが正。
const D = 180 / Math.PI;
const round = (x, n = 2) => Number.isFinite(x) ? Math.round(x * 10 ** n) / 10 ** n : x;
export const fwdOf = f => [Math.sin(f.modelYaw), Math.cos(f.modelYaw)];
export const rightOf = f => [-Math.cos(f.modelYaw), Math.sin(f.modelYaw)];

// 骨 a→b の線の、前後（sag）と左右（lat）の傾き（度。真下＝0。sag は前が正、lat は右が正）
export function segAngles(f, a, b) {
  const A = f.bones?.[a], B = f.bones?.[b];
  if (!A || !B) return null;
  const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], [fx, fz] = fwdOf(f), [rx, rz] = rightOf(f);
  return { sag: Math.atan2(dx * fx + dz * fz, -dy) * D, lat: Math.atan2(dx * rx + dz * rz, -dy) * D };
}
// 線 a→b（左→右）の向きの、体の右からの水平の回り（度。上から見て左回りが正）
export function lineYaw(f, a, b) {
  const A = f.bones?.[a], B = f.bones?.[b];
  if (!A || !B) return null;
  const dx = B[0] - A[0], dz = B[2] - A[2], [fx, fz] = fwdOf(f), [rx, rz] = rightOf(f);
  return Math.atan2(dx * fx + dz * fz, dx * rx + dz * rz) * D;
}
// 上向きの線（腰→首など）を、真上からの前・右の傾き（度）にする
export function upAngles(f, a, b) {
  const s = segAngles(f, b, a);   // 下向きの線 b→a（首→腰）。首が前にあれば首→腰は後ろを向くので、符号を返す
  return s && { sag: -s.sag, lat: -s.lat };
}

export const amp = a => { const v = a.filter(Number.isFinite); return v.length ? Math.max(...v) - Math.min(...v) : 0; };
export const mean = a => { const v = a.filter(Number.isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0; };
export function pearson(a, b) {
  const n = Math.min(a.length, b.length); if (n < 3) return 0;
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa > 1e-9 && sbb > 1e-9 ? sab / Math.sqrt(saa * sbb) : 0;   // 動かない列（硬い腕）は0
}
// 相互相関：b を lag コマずらして a と比べる（a[i] と b[i−lag]。lag が正＝a が b より遅れる）。maxLag の範囲で最大の r とその lag
export function crossCorr(a, b, maxLag) {
  let best = { r: -Infinity, lag: 0 };
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const x = [], y = [];
    for (let i = 0; i < a.length; i++) { const j = i - lag; if (j >= 0 && j < b.length) { x.push(a[i]); y.push(b[j]); } }
    const r = pearson(x, y); if (r > best.r) best = { r, lag };
  }
  return { r0: pearson(a, b), best: best.r === -Infinity ? 0 : best.r, lag: best.lag };
}
// 周期（コマ）：自己相関が最初に山になる遅れ（r＞0.3）。見つからなければ null
export function periodFrames(a, minLag = 4) {
  let prev = 1, rising = false;
  for (let lag = 1; lag < a.length * 0.75; lag++) {
    const r = pearson(a.slice(lag), a.slice(0, a.length - lag));
    if (lag >= minLag && rising && r < prev && prev > 0.3) return lag - 1;
    rising = r > prev; prev = r;
  }
  return null;
}
const qconj = q => [-q[0], -q[1], -q[2], q[3]];
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qrot = (q, v) => { const r = qmul(qmul(q, [v[0], v[1], v[2], 0]), qconj(q)); return [r[0], r[1], r[2]]; };
function rotvec(q) { const s = q[3] < 0 ? -1 : 1, x = q[0] * s, y = q[1] * s, z = q[2] * s, w = q[3] * s, n = Math.hypot(x, y, z); if (n < 1e-12) return [0, 0, 0]; const a = 2 * Math.atan2(n, w); return [x / n * a, y / n * a, z / n * a]; }
function p99(v) { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(0.99 * s.length) - 1)] : 0; }

// 1つの窓（同じ動き方が続くコマの列）の上半身の指標
export function upperWindow(frames, dt) {
  if (!frames.length) return null;
  const S = (a, b, k) => frames.map(f => segAngles(f, a, b)?.[k] ?? NaN);
  const La = S('LeftArm', 'LeftForeArm', 'sag'), Ra = S('RightArm', 'RightForeArm', 'sag'), Lt = S('LeftUpLeg', 'LeftLeg', 'sag'), Rt = S('RightUpLeg', 'RightLeg', 'sag');
  const hand = side => frames.map(f => { const H = f.bones?.Hips, W = f.bones?.[side + 'Hand']; if (!H || !W) return NaN; const [fx, fz] = fwdOf(f); return ((W[0] - H[0]) * fx + (W[2] - H[2]) * fz) * 100; });
  const per = periodFrames(Rt.map(x => x || 0)) ?? periodFrames(Lt.map(x => x || 0)), maxLag = Math.max(1, Math.round((per ?? 30) / 2));
  const cL = crossCorr(La, Rt, maxLag), cR = crossCorr(Ra, Lt, maxLag);
  const pelvis = frames.map(f => lineYaw(f, 'LeftUpLeg', 'RightUpLeg') ?? NaN), chest = frames.map(f => lineYaw(f, 'LeftArm', 'RightArm') ?? NaN);
  // 頭：最初のコマの「前」を頭の骨の局所へ写し、その軸の各コマの向き（前からの左右・上下）
  const h0 = frames[0].bones?.Head, [f0x, f0z] = fwdOf(frames[0]), local = h0 ? qrot(qconj(h0.slice(3, 7)), [f0x, 0, f0z]) : null;
  const headYaw = [], headPitch = [];
  for (const f of frames) {
    const h = f.bones?.Head; if (!h || !local) { headYaw.push(NaN); headPitch.push(NaN); continue; }
    const d = qrot(h.slice(3, 7), local), [fx, fz] = fwdOf(f), [rx, rz] = rightOf(f);
    headYaw.push(Math.atan2(-(d[0] * rx + d[2] * rz), d[0] * fx + d[2] * fz) * D); headPitch.push(Math.asin(Math.max(-1, Math.min(1, d[1]))) * D);
  }
  const w = []; for (let i = 1; i < frames.length; i++) { const a = frames[i - 1].bones?.Head, b = frames[i].bones?.Head; w.push(a && b ? rotvec(qmul(b.slice(3, 7), qconj(a.slice(3, 7)))).map(x => x / dt) : null); }
  const alpha = []; for (let i = 1; i < w.length; i++) if (w[i] && w[i - 1]) alpha.push(Math.hypot(w[i][0] - w[i - 1][0], w[i][1] - w[i - 1][1], w[i][2] - w[i - 1][2]) / dt * D);
  const headH = frames.map(f => f.bones?.Head ? (f.bones.Head[1] - f.pos[1]) * 100 : NaN), hipsH = frames.map(f => f.bones?.Hips ? (f.bones.Hips[1] - f.pos[1]) * 100 : NaN);
  const lean = frames.map(f => upAngles(f, 'Hips', 'neck')?.sag ?? NaN), bank = frames.map(f => upAngles(f, 'Hips', 'neck')?.lat ?? NaN);
  return {
    frames: frames.length, periodFrames: per,
    arm: { ampL: round(amp(La), 1), ampR: round(amp(Ra), 1), meanL: round(mean(La), 1), meanR: round(mean(Ra), 1), handTravelL: round(amp(hand('Left')), 1), handTravelR: round(amp(hand('Right')), 1) },
    thigh: { ampL: round(amp(Lt), 1), ampR: round(amp(Rt), 1) },
    sync: { L: { r0: round(cL.r0), best: round(cL.best), lag: cL.lag, lagFrac: per ? round(cL.lag / per) : null }, R: { r0: round(cR.r0), best: round(cR.best), lag: cR.lag, lagFrac: per ? round(cR.lag / per) : null } },
    trunk: { pelvisYawAmp: round(amp(pelvis), 1), chestYawAmp: round(amp(chest), 1), twistAmp: round(amp(chest.map((c, i) => c - pelvis[i])), 1), counter: round(pearson(pelvis, chest)) },
    head: { yawAmp: round(amp(headYaw), 1), pitchAmp: round(amp(headPitch), 1), heightAmpCm: round(amp(headH), 1), angAccP99: round(p99(alpha), 0) },
    pelvis: { bobCm: round(amp(hipsH), 1), meanCm: round(mean(hipsH), 1) },
    lean: { meanDeg: round(mean(lean), 1), maxDeg: round(Math.max(...lean.filter(Number.isFinite)), 1) },
    bank: { meanDeg: round(mean(bank), 1) },
  };
}

// 曲がりの傾き：横の加速度（進む向きの変化から。右が正）と、腰→首の線の横の傾き（右が正）。inward＝内側への傾きの平均（度・正なら内側）、
// expect＝同じコマの atan(横の加速度/g) の平均（体全体が遠心力と釣り合う傾き。人はこの一部を上体で見せる）、corr＝両者の相関
export function turnLean(frames, dt, smooth = 4) {
  const n = frames.length, vx = [], vz = [];
  for (let i = 0; i < n; i++) { const a = frames[Math.max(0, i - 1)], b = frames[Math.min(n - 1, i + 1)], k = (Math.min(n - 1, i + 1) - Math.max(0, i - 1)) * dt || dt; vx.push((b.pos[0] - a.pos[0]) / k); vz.push((b.pos[2] - a.pos[2]) / k); }
  const lat = [], bank = [];
  for (let i = smooth; i < n - smooth; i++) {
    const ax = (vx[i + smooth] - vx[i - smooth]) / (2 * smooth * dt), az = (vz[i + smooth] - vz[i - smooth]) / (2 * smooth * dt), [rx, rz] = rightOf(frames[i]);
    lat.push(ax * rx + az * rz); bank.push(upAngles(frames[i], 'Hips', 'neck')?.lat ?? NaN);
  }
  const sel = lat.map((a, i) => Math.abs(a) > 1.0 ? i : -1).filter(i => i >= 0);   // 1m/秒² を超える横の加速度のコマだけ
  const inward = mean(sel.map(i => bank[i] * Math.sign(lat[i]))), expect = mean(sel.map(i => Math.atan(Math.abs(lat[i]) / 9.81) * D));
  return { frames: sel.length, inward: round(inward, 1), expect: round(expect, 1), corr: round(pearson(sel.map(i => lat[i]), sel.map(i => bank[i]))), latMax: round(Math.max(0, ...lat.map(Math.abs)), 1) };
}

// 台本（smooth-journey）の記録からまとめる。定常の窓は各区間の最後の secs 秒。加速の前傾は走り出しの区間（start・run_start）の始めの accelSecs 秒の最大
export function upperMetrics(run, { secs = 1.2, accelSecs = 0.35, steady = { walk: 'jog', run: 'run' }, turn = ['turn', 'run3'] } = {}) {
  const { frames, dt } = run, byTag = tag => frames.filter(f => f.tag === tag), out = { steady: {}, accel: {} };
  for (const [name, tag] of Object.entries(steady)) { const fr = byTag(tag); out.steady[name] = upperWindow(fr.slice(Math.max(0, fr.length - Math.round(secs / dt))), dt); }
  for (const tag of ['start', 'run_start']) { const fr = byTag(tag).slice(0, Math.round(accelSecs / dt)); if (fr.length) out.accel[tag] = { leanMaxDeg: round(Math.max(...fr.map(f => upAngles(f, 'Hips', 'neck')?.sag ?? -Infinity)), 1) }; }
  out.turn = turnLean(frames.filter(f => turn.includes(f.tag)), dt);
  return out;
}

// 表に出す値（前後の比較用）
export function upperSummary(m) {
  const s = m.steady, o = {};
  for (const k of Object.keys(s)) {
    const w = s[k]; if (!w) continue;
    Object.assign(o, { [`${k}.armAmp`]: round((w.arm.ampL + w.arm.ampR) / 2, 1), [`${k}.armMean`]: round((w.arm.meanL + w.arm.meanR) / 2, 1), [`${k}.handTravel`]: round((w.arm.handTravelL + w.arm.handTravelR) / 2, 1),
      [`${k}.syncBest`]: round((w.sync.L.best + w.sync.R.best) / 2), [`${k}.syncLag`]: round(((w.sync.L.lagFrac ?? 0) + (w.sync.R.lagFrac ?? 0)) / 2), [`${k}.twistAmp`]: w.trunk.twistAmp, [`${k}.counter`]: w.trunk.counter,
      [`${k}.headYawAmp`]: w.head.yawAmp, [`${k}.headPitchAmp`]: w.head.pitchAmp, [`${k}.headAccP99`]: w.head.angAccP99, [`${k}.bobCm`]: w.pelvis.bobCm, [`${k}.leanDeg`]: w.lean.meanDeg });
  }
  for (const [k, v] of Object.entries(m.accel || {})) o[`accel.${k}.leanMax`] = v.leanMaxDeg;
  if (m.turn) { o['turn.inward'] = m.turn.inward; o['turn.expect'] = m.turn.expect; o['turn.corr'] = m.turn.corr; }
  return o;
}
