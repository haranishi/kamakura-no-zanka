// 回帰（M3・design-locomotion-smooth §6・§13）：走りの形（腕・体幹・頭・前傾・曲がりの傾き・骨盤の上下）。実ゲームの主人公で、物差し tools/lib/upper-metrics.mjs の目標を確かめる。
//  1. 台本（smooth-journey と同じ）を新しいページで1回：定速の走り・通常移動の腕振りの幅・平均・手の行き来・反対側の太ももとの同期、体幹の逆回転、頭の揺れ、骨盤の上下、前傾、
//     走り出しの前傾、曲がりの内側への傾き（目標は TARGET。根拠は reports/polish3/locomotion-smooth/m3.md）。足の物差し（regress-locomotion-ik と同じ定速の滑り・窓）も悪くしない。
//  2. 同じページで ?smooth=arms（M2b の姿勢）と、定速の走り3秒を比べる：腕の幅・手の行き来が10%以上増え、頭の左右の揺れ・角加速度が10%以上減り、体幹が逆回転へ。
//  3. 30・60・144コマ/秒で、定速の走りの腕の幅・骨盤の上下・前傾・頭の揺れが極端に変わらない（60コマ/秒との差が HZ_TOL の内）。
//  4. 「動きを減らす」：腕の幅・体幹のねじれが、通常の設定より下がる。
//  5. 二重加算がない：補正を戻す（undo）と、骨は同じコマの mixer の直後の姿勢と一致する（差 1e-9 以下。層は姿勢を変えていること＝差が 1e-3 超も確かめる）。
//  6. 技を出すと（移動の動作でなくなると）0.15秒で効きが0.05以下へ戻る。
//  7. 手の安全装置：台本のどの区間でも、手が首の高さまで上がらない・前へ突き出ない（初版が盲検で負けた原因）。同じ台本を ?smooth=arms でも流し、屈み歩きの区間の腕が層あり・なしで同じ（屈みに入る間の層の暴れの再発防止）。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-locomotion-upper.mjs --strict --out <dir>（KZ_OUT=… でJSON）
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { prepare, recordJourney, START, OPTS } from './smooth-journey.mjs';
import { smoothMetrics } from '../lib/smooth-metrics.mjs';
import { upperMetrics, upperSummary, upperWindow } from '../lib/upper-metrics.mjs';

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };
// 台本の目標（M2b の基準と人の走りの目安から。m3.md の表）
// 腕の目標は盲検の結果で作り直した（初版の「前へも振る」目標 armMean −15〜0・armAmp 60〜 は、前へ出た手が顔の高さまで上がる形で、旧 M2b に54件中3対19で負けた）。
// 今の形は「前へ出る腕は M2b のまま、後ろへ引く側だけ深く」：振り幅は M2b より大きく、平均は M2b（−25度）より少し後ろ、手の最高と前への出は M2b を超えない。
export const TARGET = {
  'run.armAmp': [50, 90], 'run.armMean': [-40, -20], 'run.handTravel': [25, 60], 'run.handDyMax': [-30, -5], 'run.handReachMax': [10, 22], 'run.syncBest': [0.9, 1], 'run.counter': [-1, -0.5], 'run.headYawAmp': [0, 4], 'run.headPitchAmp': [0, 3.5], 'run.bobCm': [5, 7], 'run.leanDeg': [8, 13],
  'walk.armAmp': [48, 90], 'walk.handDyMax': [-30, -5], 'walk.handReachMax': [10, 22], 'walk.counter': [-1, -0.5], 'walk.headYawAmp': [0, 4], 'walk.bobCm': [6, 8.5],
  'accel.run_start.leanMax': [11, 20], 'turn.inward': [2, 12],
};
// 手の安全装置（どの区間でも）：手は首の関節より HAND_DY_MAX cm 以下、肩から前へ HAND_REACH_MAX cm 以下（M2b の最高は −5.9・19.0。初版は +2.0・26.4）
const HAND_DY_MAX = -5, HAND_REACH_MAX = 24;
const SLIP = { jog: 1.84, run: 1.3, run2: 1.3 }, WINDOW_CM = 6, STOP_FREE_CM = 30;   // regress-locomotion-ik と同じ
const HZ_TOL = { armAmp: 0.15, bobCm: 1.0, leanDeg: 1.5, headYawAmp: 1.5 };   // 割合（腕）か差（cm・度）
export const BONES = ['Hips', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand', 'neck', 'Head'];

// 定速の走り（secs 秒・最後の keep 秒を記録）。戻り値は upper-metrics の frames
export const STEADY = `async (A, g, h, ch, reset, [q, hz, secs, keep, BONES, reduce]) => {
  A.configureLoco(q); reset(); const dt = 1 / hz, V = new ch.model.position.constructor(), Q = new ch.model.quaternion.constructor(), frames = [];
  const r0 = g.settings.reducedMotion; g.settings.reducedMotion = !!reduce;
  for (let i = 0; i < Math.round(0.6 * hz); i++) __valley.step(1, dt);
  h.crouch = false; __valley.key('KeyW', true); __valley.key('ShiftLeft', true);
  const n = Math.round(secs * hz);
  for (let i = 0; i < n; i++) {
    __valley.step(1, dt);
    if (i < n - Math.round(keep * hz)) continue;
    ch.model.updateMatrixWorld(true); const bones = {};
    for (const b of BONES) { const o = ch.bone(b); o.getWorldPosition(V); o.getWorldQuaternion(Q); bones[b] = [V.x, V.y, V.z, Q.x, Q.y, Q.z, Q.w]; }
    frames.push({ t: i * dt, tag: 'steady', pos: [h.pos.x, h.pos.y ?? 0, h.pos.z], modelYaw: ch.root.rotation.y, speed: h.speed, bones });
  }
  g.settings.reducedMotion = r0;
  for (const c of ['KeyW', 'ShiftLeft']) __valley.key(c, false);
  return frames;
}`;

// 二重加算の点検と、技での戻り
const PROBE = `async (A, g, h, ch, reset, [q]) => {
  A.configureLoco(q); reset(); const dt = 1 / 60, out = {};
  for (let i = 0; i < 36; i++) __valley.step(1, dt);
  __valley.key('KeyW', true); __valley.key('ShiftLeft', true);
  for (let i = 0; i < 90; i++) __valley.step(1, dt);
  out.applied = ch.upper.applied; out.w = ch.upper.w; out.last = ch.upper.last;
  // 補正を全部戻した姿勢と、同じコマの mixer の直後（この層を当てる直前）の姿勢。比べるコマだけ relaxArms を止める（あれは戻さずに mixer の上書きに任せる層）。
  // mixer.update(0) を当て直す比べ方は使えない：移動の切り替え（locomote）が mixer の後に重みと時刻を替えるので、層が無くても0.8度ずれた
  const snap = () => { const s = []; ch.bones.forEach(o => s.push([o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w, o.position.x, o.position.y, o.position.z])); return s; };
  let ref = null; const apply = ch.upper.apply; ch.armRelax = false;
  ch.upper.apply = function (dt, active) { ref = snap(); return apply.call(this, dt, active); };
  __valley.step(1, dt);
  delete ch.upper.apply; ch.armRelax = true;
  out.changed = 0; { const fin = snap(); for (let i = 0; i < fin.length; i++) out.changed = Math.max(out.changed, 1 - Math.min(1, Math.abs(fin[i][0] * ref[i][0] + fin[i][1] * ref[i][1] + fin[i][2] * ref[i][2] + fin[i][3] * ref[i][3]) / Math.hypot(...fin[i].slice(0, 4)) / Math.hypot(...ref[i].slice(0, 4)))); }
  ch.sword?.undo(); ch.legs?.undo(); ch.upper.undo();
  const a = snap(), b = ref; let d = 0;
  // 向きの差は正規化した内積で（mixer の混ぜた四元数は長さが1から3e-5ほどずれる。同じ値どうしでも 1−|内積| が0にならない）
  const ndot = (p, q) => Math.abs(p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3] * q[3]) / Math.hypot(p[0], p[1], p[2], p[3]) / Math.hypot(q[0], q[1], q[2], q[3]);
  for (let i = 0; i < a.length; i++) { const dot = ndot(a[i], b[i]); const e = Math.max(1 - Math.min(1, dot), Math.abs(a[i][4] - b[i][4]), Math.abs(a[i][5] - b[i][5]), Math.abs(a[i][6] - b[i][6])); if (e > d) { d = e; out.undoWorst = [...ch.bones.keys()][i]; } }
  out.undoDiff = d;
  for (let i = 0; i < 6; i++) __valley.step(1, dt);
  // 技（左クリック）：移動の動作でなくなったら効きを戻す
  out.wBefore = ch.upper.w; __valley.click(0); for (let i = 0; i < 8; i++) __valley.step(1, dt);
  out.wAfter = ch.upper.w; out.current = ch.currentName; out.loco = ch.locoName;
  for (const c of ['KeyW', 'ShiftLeft']) __valley.key(c, false);
  for (let i = 0; i < 120; i++) __valley.step(1, dt);
  return out;
}`;

export default async function (ctx) {
  await prepare(ctx);
  const { v, log } = ctx, out = {};
  // 1. 台本
  const run = await recordJourney(v), um = upperMetrics(run), sum = upperSummary(um), foot = smoothMetrics(run, OPTS);
  out.journey = { summary: sum, metrics: um };
  for (const [k, [lo, hi]] of Object.entries(TARGET)) { log(`台本 ${k.padEnd(24)} ${sum[k]}（目標 ${lo}〜${hi}）`); check(sum[k] >= lo && sum[k] <= hi, `journey ${k}: ${sum[k]} not in ${lo}..${hi}`); }
  log('台本 そのほか', JSON.stringify(sum));
  // 手の安全装置：歩き・走り・止まり・曲がり・反転のどの区間でも、手が首の高さまで上がらない・前へ突き出ない（盲検で初版が負けた原因）
  out.hand = {};
  for (const tag of ['start', 'jog', 'run_start', 'run', 'stop', 'reverse', 'run2', 'turn', 'run3', 'stop2']) {
    const fr = run.frames.filter(f => f.tag === tag); if (fr.length < 3) continue;
    const hp = upperWindow(fr, run.dt).handPose; out.hand[tag] = hp;
    check(hp.dyMaxCm <= HAND_DY_MAX, `journey ${tag}: hand ${hp.dyMaxCm} cm vs neck > ${HAND_DY_MAX}`); check(hp.reachMaxCm <= HAND_REACH_MAX, `journey ${tag}: hand reach ${hp.reachMaxCm} cm > ${HAND_REACH_MAX}`);
  }
  log('台本 手の最高（首との差cm）・前への出（cm）:', Object.entries(out.hand).map(([t, h]) => `${t} ${h.dyMaxCm}・${h.reachMaxCm}`).join('  '));
  for (const [tag, lim] of Object.entries(SLIP)) { const s = foot.slip.byTag[tag]; check(s && s.cmPerM != null && s.cmPerM <= lim, `journey ${tag}: slip ${s?.cmPerM} cm/m > ${lim}`); }
  for (const e of foot.windows.list) { const lim = e.kind === 'stop' ? STOP_FREE_CM : WINDOW_CM; check(e.maxCm <= lim, `journey window ${e.kind}@${e.t.toFixed(2)}: ${e.maxCm}cm > ${lim}`); }
  log('台本 足（regress-locomotion-ik と同じ物差し）', JSON.stringify(Object.fromEntries(Object.entries(SLIP).map(([t]) => [t, foot.slip.byTag[t]?.cmPerM]))), foot.windows.list.map(e => `${e.kind}@${e.t.toFixed(2)} ${e.maxCm}`).join(' '));
  // 屈み歩きの区間は層を使わない：同じ台本を ?smooth=arms（M2b）でも流し、腕の骨の向き・手の位置が（効きが落ちる数コマを除いて）同じことを確かめる。
  // 手の上限が層の効きに連動しなかったとき、屈み歩きに入る約0.35秒、左腕が最大40度（手で27cm）ずれ、層が止まる瞬間に弾けた（生の記録を main と項目ごとに比べて発見。「歩きながら屈む」試験では再現しなかった）
  const toggle = q => v(`(async () => { const A = await import('/valley/actors.js'); A.configureLoco(${JSON.stringify(q)}); })()`);
  await toggle('?loco=a&smooth=arms'); const runOff = await recordJourney(v); await toggle(await v('location.search'));
  const qdeg = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[3] * b[3] + a[4] * b[4] + a[5] * b[5] + a[6] * b[6]))) * 180 / Math.PI;
  check(runOff.frames.length === run.frames.length, `journey length differs: ${runOff.frames.length} vs ${run.frames.length}`);
  out.offDiff = {};
  // （立ちの区間 stand は比べない：2回目の台本の冒頭は1回目の終わりの姿勢を引きずり、層と無関係に23度ずれる）
  for (const [name, tags, degMax, cmMax] of [['crouch', ['slow', 'stop3'], 3, 3]]) {
    let n = 0, deg = 0, cm = 0, pos = 0;
    for (let i = 0; i < run.frames.length; i++) {
      const f = run.frames[i], g = runOff.frames[i]; if (!g || !tags.includes(f.tag)) continue; n++;
      pos = Math.max(pos, Math.hypot(f.pos[0] - g.pos[0], f.pos[2] - g.pos[2]));
      for (const b of ['LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm']) deg = Math.max(deg, qdeg(f.bones[b], g.bones[b]));
      for (const s of ['Left', 'Right']) { const p = f.bones[s + 'Hand'], q = g.bones[s + 'Hand']; cm = Math.max(cm, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100); }
    }
    out.offDiff[name] = { frames: n, deg: Math.round(deg * 10) / 10, cm: Math.round(cm * 10) / 10, pos };
    log(`台本 ${name}（${tags.join('・')}）の腕：層あり対 ?smooth=arms の差 最大 ${deg.toFixed(1)}度・手${cm.toFixed(1)}cm（${n}コマ。上限 ${degMax}度・${cmMax}cm）`);
    check(n >= 30, `${name}: only ${n} frames compared`); check(pos < 1e-3, `${name}: the two journeys are not aligned (${pos} m)`);
    check(deg <= degMax && cm <= cmMax, `${name}: arm differs ${deg} deg / ${cm} cm from ?smooth=arms (limit ${degMax} deg / ${cmMax} cm)`);
  }
  const pg = (fn, arg) => v(`(async () => { const A = await import('/valley/actors.js'); const g = __valley.game, h = g.hero, ch = h.character;
    const reset = () => { for (const k of ['KeyW', 'KeyS', 'ShiftLeft', 'KeyC']) __valley.key(k, false); h.crouch = false; h.place(${START.x}, ${START.z}, ${START.yaw}); h.speed = 0; h.locoA = 0; h.locoV = 0; g.rig.yaw = ${START.yaw}; g.rig.snap();
      for (const a of ch.mixer._actions) a.stop(); ch.mixer.time = 0; ch.time = 0; ch.current = null; ch.currentName = null; ch.locoName = null; ch.locoOut = null; ch.gait = 'idle'; ch.resetContacts();
      const far = (a, i) => { if (a && a !== h) a.place(${START.x} + 60 + i * 3, ${START.z} + 60, 0); };
      far(g.ally, 0); [...g.npcs.values()].forEach((n, i) => far(n, i + 1)); g.enemies.forEach((e, i) => far(e, i + 40)); h.lockTarget = null; h.guardStance = false; };
    const original = location.search; const res = await (${fn})(A, g, h, ch, reset, ${JSON.stringify(arg ?? null)}); A.configureLoco(original); reset(); return res; })()`);
  // どの通りも同じ設定で1回空で流してから測る（台本の直後や設定を替えた直後の1回目は、前の状態を引きずった：屈みの姿勢が残る・頭の揺れが2.6度と1.1度に分かれる）
  const steady = async (q, hz = 60, reduce = false) => { await pg(STEADY, [q, hz, 3.0, 1.6, BONES, reduce]); return upperWindow(await pg(STEADY, [q, hz, 3.0, 1.6, BONES, reduce]), 1 / hz); };
  const flat = w => ({ armAmp: (w.arm.ampL + w.arm.ampR) / 2, armMean: (w.arm.meanL + w.arm.meanR) / 2, handTravel: (w.arm.handTravelL + w.arm.handTravelR) / 2, sync: (w.sync.L.best + w.sync.R.best) / 2, counter: w.trunk.counter, twistAmp: w.trunk.twistAmp, headYawAmp: w.head.yawAmp, headAccP99: w.head.angAccP99, bobCm: w.pelvis.bobCm, leanDeg: w.lean.meanDeg, handDyMax: w.handPose.dyMaxCm, handReachMax: w.handPose.reachMaxCm });
  const r1 = x => Math.round(x * 100) / 100;
  // 2. ?smooth=arms と比べる
  const before = flat(await steady('?loco=a&smooth=arms')), after = flat(await steady('?loco=a'));
  out.compare = { before, after };
  log('走り3秒 M2b（?smooth=arms）:', JSON.stringify(Object.fromEntries(Object.entries(before).map(([k, x]) => [k, r1(x)]))));
  log('走り3秒 M3              :', JSON.stringify(Object.fromEntries(Object.entries(after).map(([k, x]) => [k, r1(x)]))));
  check(after.armAmp >= before.armAmp * 1.1, `arm swing ${after.armAmp} < 1.1 x ${before.armAmp}`);
  check(after.handTravel >= before.handTravel * 1.1, `hand travel ${after.handTravel} < 1.1 x ${before.handTravel}`);
  check(after.headYawAmp <= before.headYawAmp * 0.9, `head yaw ${after.headYawAmp} > 0.9 x ${before.headYawAmp}`);
  check(after.headAccP99 <= before.headAccP99 * 0.9, `head angular acceleration ${after.headAccP99} > 0.9 x ${before.headAccP99}`);
  check(after.counter <= -0.5 && before.counter > 0, `trunk counter-rotation: ${before.counter} -> ${after.counter}`);
  check(after.sync >= 0.9, `arm/thigh sync ${after.sync} < 0.9`);
  check(after.handDyMax <= HAND_DY_MAX && after.handReachMax <= HAND_REACH_MAX, `steady run hand ${after.handDyMax} cm vs neck / reach ${after.handReachMax} cm`);
  // 3. コマ速度
  out.hz = { 60: after };
  for (const hz of [30, 144]) {
    const w = flat(await steady('?loco=a', hz)); out.hz[hz] = w;
    log(`走り3秒 ${hz}コマ/秒:`, JSON.stringify(Object.fromEntries(Object.entries(w).map(([k, x]) => [k, r1(x)]))));
    check(Math.abs(w.armAmp - after.armAmp) <= after.armAmp * HZ_TOL.armAmp, `${hz}Hz arm swing ${w.armAmp} vs ${after.armAmp}`);
    for (const k of ['bobCm', 'leanDeg', 'headYawAmp']) check(Math.abs(w[k] - after[k]) <= HZ_TOL[k], `${hz}Hz ${k} ${w[k]} vs ${after[k]}`);
  }
  // 4. 動きを減らす
  const reduced = flat(await steady('?loco=a', 60, true)); out.reduced = reduced;
  log('走り3秒 動きを減らす:', JSON.stringify(Object.fromEntries(Object.entries(reduced).map(([k, x]) => [k, r1(x)]))));
  check(reduced.armAmp < after.armAmp - 5, `reduced motion arm swing ${reduced.armAmp} not below ${after.armAmp}`);
  check(reduced.twistAmp < after.twistAmp, `reduced motion twist ${reduced.twistAmp} not below ${after.twistAmp}`);
  // 5・6. 二重加算と技
  const p = await pg(PROBE, ['?loco=a']); out.probe = p;
  log(`補正を戻した骨と mixer の姿勢の差 ${p.undoDiff.toExponential(2)}（${p.undoWorst}）（効き ${p.w.toFixed(2)}・当てていた ${p.applied}）／技の前の効き ${p.wBefore.toFixed(2)} → 0.13秒後 ${p.wAfter.toFixed(3)}（今の動作 ${p.current}）`);
  check(p.applied && p.w > 0.9, `layer not active while running (w ${p.w})`);
  check(p.changed > 1e-3, `the layer did not change the pose in the probe frame (${p.changed})`);
  check(p.undoDiff <= 1e-9, `undo does not return the bones to the mixer pose: ${p.undoDiff}`);
  check(p.wBefore > 0.9 && p.wAfter <= 0.05 && p.current !== p.loco, `layer did not fade out on an attack: ${p.wBefore} -> ${p.wAfter} (${p.current})`);
  if (process.env.KZ_OUT) fs.writeFileSync(process.env.KZ_OUT, JSON.stringify({ ...out, fail }, null, 1) + '\n');
  if (fail.length) log('FAIL', fail.join(' / '));
  assert.deepEqual(fail, [], 'regress-locomotion-upper');
  log('regress-locomotion-upper: OK');
}
