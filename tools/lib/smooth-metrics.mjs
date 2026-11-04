// 走り・歩きの滑らかさの指標（要件 R38.2・design-locomotion-smooth §8）。純粋：渡された毎コマの記録だけを読む。外部依存なし。
// 記録 run = { dt, frames: [フレーム] }。フレーム:
//   t 秒・tag 台本の区間名・event 操作の出来事（'start'|'stop'|'turn'|'reverse'|… そのコマで操作した。無ければ null）
//   pos [x,y,z] 論理の位置・yaw 論理の向き・modelYaw 模型の向き（rad）・speed 論理の速さ（m/秒）・gait 歩容（'idle'|'walk'|'jog'|'run'…）
//   contact [左,右] 足が着いているか（呼ぶ側が gait-table の平らな区間から決める）・contactLegacy 旧い物差し（clips.json の contacts。指標 slipLegacy）
//   bones { 骨の名前: [px,py,pz, qx,qy,qz,qw] } 世界の位置と向き・cam [px,py,pz, qx,qy,qz,qw, fov]
// 物差しの決め方（手本の契約の考え方を借りて一から書いた。数値は持ち込んでいない）:
//   足の滑り＝接地が続くコマの間の足首の水平移動の合計 ÷ 論理の位置が進んだ距離（cm/m）。進んでいない区間は合計（cm）だけを見る。
//   接地のずれ＝1回の接地（続くコマ）の間に、着いた点から足首が離れた最大（cm）。出来事の窓（0.5秒）ごとに最大を取る。
//   関節の跳ね＝親の骨に対する回転が1コマで45°・90°を超えた回数（同じ骨で続くコマは1回）。体全体の向き変えは数えない。
//   向きの跳ね＝1コマで30°を超える向きの変化。歩容の往復＝0.4秒以内に元の歩容へ戻る切り替え。
//   カメラ＝位置の加加速度（3回の差÷dt³）と、回転の角加速度（角速度の差÷dt）の p99。速さの不連続＝1コマの速さの変化がしきい値を超えた回数。
export const PARENT = Object.freeze({
  Spine02: 'Hips', Spine01: 'Spine02', Spine: 'Spine01', neck: 'Spine', Head: 'neck',
  LeftShoulder: 'Spine', LeftArm: 'LeftShoulder', LeftForeArm: 'LeftArm', LeftHand: 'LeftForeArm',
  RightShoulder: 'Spine', RightArm: 'RightShoulder', RightForeArm: 'RightArm', RightHand: 'RightForeArm',
  LeftUpLeg: 'Hips', LeftLeg: 'LeftUpLeg', LeftFoot: 'LeftLeg', LeftToeBase: 'LeftFoot',
  RightUpLeg: 'Hips', RightLeg: 'RightUpLeg', RightFoot: 'RightLeg', RightToeBase: 'RightFoot',
});
export const GROUPS = Object.freeze({
  legs: ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'],
  arms: ['LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand'],
  core: ['Spine02', 'Spine01', 'Spine', 'neck', 'Head'],
});
export const BONES = Object.freeze(['Hips', ...Object.keys(PARENT)]);
export const FEET = Object.freeze(['LeftFoot', 'RightFoot']);
export const DEFAULTS = Object.freeze({ window: 0.5, popDeg: [45, 90], facingDeg: 30, flipWindow: 0.4, speedJump: 1.0, camExclude: [] });

const round = (x, n = 2) => Number.isFinite(x) ? Math.round(x * 10 ** n) / 10 ** n : x;
export function percentile(values, p) {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return 0;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p / 100 * s.length) - 1))];
}
export const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// 四元数 [x,y,z,w]
const qconj = q => [-q[0], -q[1], -q[2], q[3]];
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
// 回転の大きさ（rad・最短の向き）
export const qangle = q => { const l = Math.hypot(...q) || 1; return 2 * Math.acos(Math.min(1, Math.abs(q[3]) / l)); };
// 回転ベクトル（軸×角）。q と −q は同じ回転なので w≥0 にそろえる
export function rotvec(q) {
  const s = q[3] < 0 ? -1 : 1, x = q[0] * s, y = q[1] * s, z = q[2] * s, w = q[3] * s, n = Math.hypot(x, y, z);
  if (n < 1e-12) return [0, 0, 0];
  const a = 2 * Math.atan2(n, w); return [x / n * a, y / n * a, z / n * a];
}
const quatOf = arr => arr.slice(3, 7);
const localQ = (f, bone) => { const p = PARENT[bone], c = f.bones?.[bone]; if (!c || !p || !f.bones[p]) return null; return qmul(qconj(quatOf(f.bones[p])), quatOf(c)); };

const tagsOf = frames => [...new Set(frames.map(f => f.tag))];
const hdist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

// (a) 足の滑り。区間（tag）ごとと全体
// key は接地の列の名前（既定 'contact'。'low' なら呼ぶ側が「接地かつ足首が地面の近く」で決めた列）
export function footSlip(frames, key = 'contact') {
  const by = {}, add = (tag, k, v) => { (by[tag] ||= { slipCm: 0, distM: 0 })[k] += v; };
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i], g = frames[i - 1];
    add(f.tag, 'distM', hdist(f.pos, g.pos));
    FEET.forEach((foot, s) => { if (f[key]?.[s] && g[key]?.[s] && f.bones?.[foot] && g.bones?.[foot]) add(f.tag, 'slipCm', hdist(f.bones[foot], g.bones[foot]) * 100); });
  }
  const total = { slipCm: 0, distM: 0 };
  for (const v of Object.values(by)) { total.slipCm += v.slipCm; total.distM += v.distM; }
  const fin = v => ({ slipCm: round(v.slipCm), distM: round(v.distM, 3), cmPerM: v.distM > 0.05 ? round(v.slipCm / v.distM) : null });
  return { total: fin(total), byTag: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, fin(v)])) };
}

// 1回の接地ごとの「着いた点からのずれ」の列。各コマ i の、その足のずれ（cm・接地していなければ null）
export function stanceDrift(frames) {
  return FEET.map((foot, s) => {
    let anchor = null;
    return frames.map(f => {
      if (!f.contact?.[s] || !f.bones?.[foot]) { anchor = null; return null; }
      if (!anchor) anchor = f.bones[foot];
      return hdist(f.bones[foot], anchor) * 100;
    });
  });
}

// 区間ごとの、接地のずれの最大（cm）。前の担当の measure-locomotion と同じ考え方（比較用）
export function stanceMaxByTag(frames) {
  const d = stanceDrift(frames), out = {};
  frames.forEach((f, i) => { for (const s of [0, 1]) if (d[s][i] != null) out[f.tag] = Math.max(out[f.tag] || 0, d[s][i]); });
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, round(v)]));
}

// 出来事：操作（frame.event）と、動いている歩容どうしの切り替え（'switch'）
export function events(frames) {
  const out = [];
  frames.forEach((f, i) => {
    if (f.event) out.push({ kind: f.event, i, t: f.t });
    const g = frames[i - 1];
    if (g && f.gait !== g.gait && f.gait !== 'idle' && g.gait !== 'idle' && f.gait && g.gait) out.push({ kind: 'switch', i, t: f.t, from: g.gait, to: f.gait });
  });
  return out;
}

// (b) 出来事の窓（既定0.5秒）での接地のずれの最大（cm）。窓の中の動きだけを測る：足ごとに、窓の中で最初に接地したコマの位置からのずれ。
// （M2b 以前は stanceDrift＝接地の始めからの累積だった。累積だと、窓の前に起きた動き＝止まった直後に足を待ちの姿へ寄せた分が、1秒後の反転の窓にも数えられた。
//  掃引の回帰（regress-locomotion-*）の SWEEP はもともと窓の中だけを測っているので、それと同じ決め方に揃えた。旧い数字は stanceMaxByTag 側に残る）
export function windowDrift(frames, opts = {}) {
  const { window } = { ...DEFAULTS, ...opts }, list = [];
  for (const e of events(frames)) {
    let m = 0; const anchor = [null, null];
    for (let i = e.i; i < frames.length && frames[i].t - e.t < window - 1e-9; i++) {
      const f = frames[i];
      FEET.forEach((foot, s) => {
        if (!f.contact?.[s] || !f.bones?.[foot]) { anchor[s] = null; return; }
        if (!anchor[s]) anchor[s] = f.bones[foot];
        m = Math.max(m, hdist(f.bones[foot], anchor[s]) * 100);
      });
    }
    list.push({ ...e, maxCm: round(m) });
  }
  const byKind = {};
  for (const e of list) byKind[e.kind] = Math.max(byKind[e.kind] || 0, e.maxCm);
  return { list, byKind, max: round(Math.max(0, ...list.map(e => e.maxCm))) };
}

// (c) 関節の跳ね
export function jointPops(frames, opts = {}) {
  const { popDeg } = { ...DEFAULTS, ...opts }, out = {}, worst = {};
  for (const [group, bones] of Object.entries(GROUPS)) {
    const counts = popDeg.map(() => 0); let maxStep = 0;
    for (const bone of bones) {
      const prevOver = popDeg.map(() => false);
      for (let i = 1; i < frames.length; i++) {
        const a = localQ(frames[i - 1], bone), b = localQ(frames[i], bone);
        if (!a || !b) { prevOver.fill(false); continue; }
        const deg = qangle(qmul(qconj(a), b)) * 180 / Math.PI;
        if (deg > maxStep) { maxStep = deg; worst[group] = { bone, t: frames[i].t, tag: frames[i].tag, deg: round(deg, 1) }; }
        popDeg.forEach((lim, k) => { const over = deg > lim; if (over && !prevOver[k]) counts[k]++; prevOver[k] = over; });
      }
    }
    out[group] = { ...Object.fromEntries(popDeg.map((lim, k) => [`over${lim}`, counts[k]])), maxStepDeg: round(maxStep, 1) };
  }
  return { ...out, worst };
}

// (d) 向きの跳ね（論理の向きと模型の向き）
export function facingJumps(frames, opts = {}) {
  const lim = ({ ...DEFAULTS, ...opts }).facingDeg * Math.PI / 180, res = {};
  for (const key of ['yaw', 'modelYaw']) {
    let n = 0, max = 0;
    for (let i = 1; i < frames.length; i++) { const a = frames[i - 1][key], b = frames[i][key]; if (!Number.isFinite(a) || !Number.isFinite(b)) continue; const d = Math.abs(angleDiff(b, a)); max = Math.max(max, d); if (d > lim) n++; }
    res[key] = { over: n, maxStepDeg: round(max * 180 / Math.PI, 1) };
  }
  return res;
}

// (e) 歩容の往復：切り替えのあと flipWindow 秒以内に、切り替え前の歩容へ戻った数
export function gaitFlips(frames, opts = {}) {
  const w = ({ ...DEFAULTS, ...opts }).flipWindow, ch = [];
  for (let i = 1; i < frames.length; i++) if (frames[i].gait !== frames[i - 1].gait) ch.push({ t: frames[i].t, from: frames[i - 1].gait, to: frames[i].gait });
  let flips = 0; const list = [];
  for (let k = 1; k < ch.length; k++) if (ch[k].to === ch[k - 1].from && ch[k].t - ch[k - 1].t <= w + 1e-9) { flips++; list.push({ t: ch[k - 1].t, via: ch[k - 1].to, back: ch[k].to }); }
  return { changes: ch.length, flips, list };
}

// (f) カメラ
// exclude：要約の p99 から外す区間（操作者が視点を回した区間など。要件37.1は「入力以外で跳ばさない」）。区間ごとの値は全部出す
export function cameraMotion(frames, dt, exclude = []) {
  const P = frames.map(f => f.cam?.slice(0, 3)), Q = frames.map(f => f.cam?.slice(3, 7)), jerk = [], alpha = [], at = [], touch = [], touchA = [];
  // touch：差の窓（加加速度は4コマ・角加速度は3コマ）に外す区間のコマが1つでも入るか。M4（2026-11-04）で足した：区間の名前だけで外すと、
  // 視点を回し終えた直後の3コマ（run3 の頭）の窓に回した分が残り、要約の p99 を決めていた（M3 の main で 239.8 のうち、台本の止まりは 287 でも p99 は旋回の尾）
  const hit = (a, b) => { for (let j = Math.max(0, a); j <= b; j++) if (exclude.includes(frames[j].tag)) return true; return false; };
  for (let i = 3; i < frames.length; i++) {
    if (!P[i] || !P[i - 3]) continue;
    jerk.push(Math.hypot(...[0, 1, 2].map(k => P[i][k] - 3 * P[i - 1][k] + 3 * P[i - 2][k] - P[i - 3][k])) / dt ** 3); at.push(frames[i].tag); touch.push(hit(i - 3, i));
  }
  const w = []; for (let i = 1; i < frames.length; i++) w.push(Q[i] && Q[i - 1] ? rotvec(qmul(Q[i], qconj(Q[i - 1]))).map(x => x / dt) : null);
  const atA = [];
  for (let i = 1; i < w.length; i++) if (w[i] && w[i - 1]) { alpha.push(Math.hypot(...[0, 1, 2].map(k => w[i][k] - w[i - 1][k])) / dt); atA.push(frames[i + 1].tag); touchA.push(hit(i - 1, i + 1)); }
  const fov = frames.map(f => f.cam?.[7]).filter(Number.isFinite);
  const byTag = {};
  for (const tag of tagsOf(frames)) byTag[tag] = { posJerkP99: round(percentile(jerk.filter((_, i) => at[i] === tag), 99), 1), rotAccelP99: round(percentile(alpha.filter((_, i) => atA[i] === tag), 99), 2) };
  const keepJ = jerk.filter((_, i) => !exclude.includes(at[i])), keepA = alpha.filter((_, i) => !exclude.includes(atA[i]));
  const cleanJ = jerk.filter((_, i) => !touch[i]), cleanA = alpha.filter((_, i) => !touchA[i]);
  return { exclude, posJerkP99: round(percentile(keepJ, 99), 1), posJerkP99Clean: round(percentile(cleanJ, 99), 1), rotAccelP99Clean: round(percentile(cleanA, 99), 2), posJerkP99All: round(percentile(jerk, 99), 1), rotAccelP99All: round(percentile(alpha, 99), 2), posJerkMax: round(Math.max(0, ...jerk), 1), rotAccelP99: round(percentile(keepA, 99), 2), rotAccelMax: round(Math.max(0, ...alpha), 2), fovRange: fov.length ? [round(Math.min(...fov)), round(Math.max(...fov))] : null, byTag };
}

// (f2) カメラの見え方（M4・2026-11-04）：悪く見える現象そのものを測る。実装の値（ばねの強さ）ではなく、画面と動きから。
//  画面上の主人公＝論理の位置の 1.0m 上を、そのコマのカメラ（位置・向き・画角）で画面へ写した点（−1〜1。y は上が正）。aspect は画面の横÷縦。
//  区間ごとに、その点の範囲（流れ）・1コマの動きの最大（画面/秒）、カメラの高さの加速度の最大（m/秒²）、画角の変化の速さの最大（度/秒）。
//  exclude の区間（操作者が視点を回した区間）は要約から外す
export function screenPoint(cam, p, aspect) {
  const [cx, cy, cz, qx, qy, qz, qw, fov] = cam, vx = p[0] - cx, vy = p[1] - cy, vz = p[2] - cz;
  // 逆の回転（共役）で、世界の差をカメラの向きへ
  const x = -qx, y = -qy, z = -qz, w = qw;
  const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz;
  const lx = ix * w + iw * -x + iy * -z - iz * -y, ly = iy * w + iw * -y + iz * -x - ix * -z, lz = iz * w + iw * -z + ix * -y - iy * -x;
  const t = Math.tan(fov * Math.PI / 360), d = Math.max(1e-6, -lz);
  return [lx / (d * t * aspect), ly / (d * t)];
}
export function cameraView(frames, dt, aspect = 16 / 9, exclude = []) {
  const S = frames.map(f => f.cam ? screenPoint(f.cam, [f.pos[0], f.pos[1] + 1.0, f.pos[2]], aspect) : null);
  const byTag = {}, all = { yRange: 0, xRange: 0, screenSpeedMax: 0, camYAccMax: 0, fovRateMax: 0 };
  for (const tag of tagsOf(frames)) {
    const idx = frames.map((f, i) => f.tag === tag && i >= 2 && S[i] && S[i - 1] && S[i - 2] ? i : -1).filter(i => i >= 0);
    if (!idx.length) continue;
    const xs = idx.map(i => S[i][0]), ys = idx.map(i => S[i][1]);
    const r = { xRange: round(Math.max(...xs) - Math.min(...xs), 3), yRange: round(Math.max(...ys) - Math.min(...ys), 3), yMin: round(Math.min(...ys), 3),
      screenSpeedMax: round(Math.max(...idx.map(i => Math.hypot(S[i][0] - S[i - 1][0], S[i][1] - S[i - 1][1]) / dt)), 3),
      camYAccMax: round(Math.max(...idx.map(i => Math.abs(frames[i].cam[1] - 2 * frames[i - 1].cam[1] + frames[i - 2].cam[1]) / dt ** 2)), 2),
      fovRateMax: round(Math.max(...idx.map(i => Math.abs(frames[i].cam[7] - frames[i - 1].cam[7]) / dt)), 2) };
    byTag[tag] = r;
    if (!exclude.includes(tag)) for (const k of Object.keys(all)) all[k] = Math.max(all[k], r[k]);
  }
  return { aspect, ...all, byTag };
}

// (g) 論理の速さの不連続：論理の速さ（speed）と、実際に位置が進んだ速さ（位置の差÷dt）の、1コマの変化がしきい値（m/秒）を超えた回数
export function speedJumps(frames, dt, opts = {}) {
  const lim = ({ ...DEFAULTS, ...opts }).speedJump, moved = frames.map((f, i) => i ? hdist(f.pos, frames[i - 1].pos) / dt : 0);
  let logical = 0, travel = 0, maxL = 0, maxT = 0; const list = [];
  for (let i = 1; i < frames.length; i++) {
    const dl = Math.abs(frames[i].speed - frames[i - 1].speed); maxL = Math.max(maxL, dl); if (dl > lim) logical++;
    if (i >= 2) { const dm = Math.abs(moved[i] - moved[i - 1]); maxT = Math.max(maxT, dm); if (dm > lim) { travel++; list.push({ t: frames[i].t, tag: frames[i].tag, dv: round(dm) }); } }
  }
  return { logical, travel, maxLogicalStep: round(maxL), maxTravelStep: round(maxT), list };
}

// まとめ：表に出す値と、細目
export function smoothMetrics(run, opts = {}) {
  const { frames, dt } = run;
  const slip = footSlip(frames), slipLegacy = frames.some(f => f.contactLegacy) ? footSlip(frames, 'contactLegacy') : null, slipLow = frames.some(f => f.low) ? footSlip(frames, 'low') : null, win = windowDrift(frames, opts), pops = jointPops(frames, opts), face = facingJumps(frames, opts), flips = gaitFlips(frames, opts), cam = cameraMotion(frames, dt, opts.camExclude || []), spd = speedJumps(frames, dt, opts), view = cameraView(frames, dt, run.aspect ?? 16 / 9, opts.camExclude || []);
  const summary = {
    'slip.cmPerM': slip.total.cmPerM, 'slipLegacy.cmPerM': slipLegacy?.total.cmPerM ?? null, 'slipLow.cmPerM': slipLow?.total.cmPerM ?? null, 'window.maxCm': win.max,
    ...Object.fromEntries(Object.entries(win.byKind).map(([k, v]) => [`window.${k}.maxCm`, v])),
    'pops.legs.over45': pops.legs.over45, 'pops.legs.over90': pops.legs.over90, 'pops.arms.over45': pops.arms.over45, 'pops.arms.over90': pops.arms.over90,
    'facing.yaw.over30': face.yaw.over, 'facing.model.over30': face.modelYaw.over, 'gait.flips': flips.flips,
    'cam.posJerkP99': cam.posJerkP99, 'cam.rotAccelP99': cam.rotAccelP99, 'cam.posJerkP99Clean': cam.posJerkP99Clean, 'cam.rotAccelP99Clean': cam.rotAccelP99Clean, 'speed.logicalJumps': spd.logical, 'speed.travelJumps': spd.travel,
    'view.yRange': view.yRange, 'view.screenSpeedMax': view.screenSpeedMax, 'view.camYAccMax': view.camYAccMax, 'view.fovRateMax': view.fovRateMax,
  };
  return { summary, slip, slipLegacy, slipLow, stanceMax: stanceMaxByTag(frames), windows: win, pops, facing: face, gait: flips, camera: cam, view, speed: spd };
}
