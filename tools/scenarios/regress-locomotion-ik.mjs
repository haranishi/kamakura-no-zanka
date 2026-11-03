// 回帰（M2b・design-locomotion-smooth §5・§12）：脚のIKと接地。実ゲームの主人公で、要件 R34.1・34.2・34.4 の目標を確かめる。
//  1. 台本（smooth-journey と同じ）を新しいページで1回：定速の滑り（cm/m）が 小走りの区間 jog 1.84・走りの区間 run/run2 1.30 以下（どれも3以下）、
//     出来事の窓（走り出し・反転・旋回）の接地足のずれが 6cm 以下。停止の窓は、既定では止まった後に足を放して待ちの姿へ寄せる（M2a と同じ見た目。盲検で、
//     留めて一歩で寄せる版は足を開いたまま固まって見えた）ので M2a と同じ水準（STOP_FREE_CM 以下）。6cm 以内は ?stop=hold の版が受け持つ（2）。
//  2. 掃引（同じページで M2a の経路 ?smooth=ik と比べる。各通りの前に動作の時計を0へ戻す＝regress-locomotion-phase と同じ決め方）：
//     歩き出し・切り替え（小走り→Shift）・反転（走り→S）で、窓0.5秒のずれの最大が 6cm 以下。止まり（走り／通常移動）の既定は M2a より悪くならない（+0.5cm まで）。
//     ?stop=hold（止まった後に着いた足を留めて一歩で寄せる）の止まりは 6cm 以下で、走りは 30・60・144コマ/秒の3通りで（コマ速度で極端に変わらない：最大どうしの差も 6cm 以下）。
//  3. 地面：石段の下の林道・土手の斜面・川岸・棚田の段を歩き、着いている足の足首の高さ（足の下の地面から）が、平らな所での範囲から
//     浮く・沈むのが 3cm 以下（?smooth=ik の値も並べる。IKが無いと坂で浮き・沈みが出る）。歩いて止まった後の立ち姿の両足首も同じ（止まった後も足を放すだけで、地面への高さは合わせ続ける）。
// 接地の決め方は smooth-journey と同じ（gait-table の平らな区間・無ければ両足）。掃引の窓・接地の扱いは regress-locomotion-phase の SWEEP と同じ。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-locomotion-ik.mjs --strict --out <dir>（KZ_OUT=… でJSON）
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { prepare, recordJourney, START, FLAT, OPTS } from './smooth-journey.mjs';
import { smoothMetrics } from '../lib/smooth-metrics.mjs';

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };
const stats = r => ({ list: r, mean: Math.round(r.reduce((a, b) => a + b, 0) / r.length * 10) / 10, max: Math.max(...r) });
const SLIP = { jog: 1.84, run: 1.3, run2: 1.3 }, WINDOW_CM = 6, GROUND_CM = 3;
const STOP_FREE_CM = 30, STOP_SWEEP_CM = 40;   // 既定の止まり（M2a と同じ）の上限：台本の停止の窓（M2a で 20.4・18cm）、掃引の最大（M2a で走り 22〜24・通常移動 31.5cm）。これを超えたら、止まりが M2a より悪くなっている

// 1通り：before＝窓の前の操作（[秒, キー, 掃引でずらすか]）、window＝窓を開く操作。戻り値は窓の接地足のずれの最大（cm）
const SWEEP = `async (A, g, h, ch, reset, [q, before, windowKeys, offsets, FLAT, hz]) => {
  A.configureLoco(q); const dt = 1 / hz, meta = g.roster.meta.clips, V = new ch.model.position.constructor(), res = [];
  const inWin = (p, [s, e]) => s <= e ? p >= s && p <= e : p >= s || p <= e;
  for (const k of offsets) {
    reset(); for (let i = 0; i < Math.round(0.6 * hz); i++) __valley.step(1, dt);
    for (const [secs, keys, extra] of before) { for (const [c, on] of Object.entries(keys)) __valley.key(c, on); for (let i = 0; i < Math.round(secs * hz) + (extra ? Math.round(k * hz / 60) : 0); i++) __valley.step(1, dt); }
    for (const [c, on] of Object.entries(windowKeys)) __valley.key(c, on);
    const anchor = [null, null]; let worst = 0;
    for (let i = 0; i < Math.round(0.5 * hz); i++) {
      __valley.step(1, dt);
      let best = null, bw = 0; for (const [name, a] of ch.actions) { const m = meta[name]; if (!m?.contacts || m.kind !== 'cycle' || !ch.mixer._isActiveAction(a)) continue; const w = a.getEffectiveWeight(); if (w > bw) { bw = w; best = { a, m, name }; } }
      let contact = [true, true]; if (best && bw >= 0.5) { const ph = (best.a.time / best.m.seconds) % 1, fl = FLAT[best.name]; contact = ['left', 'right'].map(s => (fl ? fl[s] : best.m.contacts[s] || []).some(w => inWin(ph, w))); }
      ch.model.updateMatrixWorld(true);
      ['LeftFoot', 'RightFoot'].forEach((b, s) => { if (!contact[s]) { anchor[s] = null; return; } ch.bone(b).getWorldPosition(V); if (!anchor[s]) anchor[s] = [V.x, V.z]; worst = Math.max(worst, Math.hypot(V.x - anchor[s][0], V.z - anchor[s][1]) * 100); });
    }
    for (const c of ['KeyW', 'KeyS', 'ShiftLeft']) __valley.key(c, false);
    res.push(Math.round(worst * 10) / 10);
  }
  return res;
}`;

// 地面：start から yaw の向きへ secs 秒歩く（keys）。着いている足の足首の高さ（足の下の地面から）の最小・最大（cm）。最初の0.4秒は数えない
const GROUND = `async (A, g, h, ch, reset, [q, walks, FLAT]) => {
  A.configureLoco(q); const dt = 1 / 60, meta = g.roster.meta.clips, V = new ch.model.position.constructor(), out = {};
  const inWin = (p, [s, e]) => s <= e ? p >= s && p <= e : p >= s || p <= e;
  for (const wk of walks) {
    reset(); h.place(wk.x, wk.z, wk.yaw); g.rig.yaw = wk.yaw; g.rig.snap(); for (let i = 0; i < 36; i++) __valley.step(1, dt);
    for (const [c, on] of Object.entries(wk.keys)) __valley.key(c, on);
    let lo = Infinity, hi = -Infinity, n = 0, y0 = h.pos.y;
    for (let i = 0; i < Math.round(wk.secs / dt); i++) {
      __valley.step(1, dt);
      if (i * dt < 0.4) continue;
      let best = null, bw = 0; for (const [name, a] of ch.actions) { const m = meta[name]; if (!m?.contacts || m.kind !== 'cycle' || !ch.mixer._isActiveAction(a)) continue; const w = a.getEffectiveWeight(); if (w > bw) { bw = w; best = { a, m, name }; } }
      let contact = [true, true]; if (best && bw >= 0.5) { const ph = (best.a.time / best.m.seconds) % 1, fl = FLAT[best.name]; contact = ['left', 'right'].map(s => (fl ? fl[s] : best.m.contacts[s] || []).some(w => inWin(ph, w))); }
      ch.model.updateMatrixWorld(true);
      ['LeftFoot', 'RightFoot'].forEach((b, s) => { if (!contact[s]) return; ch.bone(b).getWorldPosition(V); const y = V.y - g.terrain.heightAt(V.x, V.z); lo = Math.min(lo, y); hi = Math.max(hi, y); n++; });
    }
    for (const c of ['KeyW', 'KeyS', 'ShiftLeft']) __valley.key(c, false);
    const res = { lo: Math.round(lo * 1000) / 10, hi: Math.round(hi * 1000) / 10, n, climb: Math.round((h.pos.y - y0) * 100) / 100, moved: Math.round(Math.hypot(h.pos.x - wk.x, h.pos.z - wk.z) * 100) / 100 };
    // 止まった後：0.5秒おいて、1秒の間の両足首の高さ（足の下の地面から）の最小・最大（待ちの歩容。足を放しても地面へ合わせ続けるか）
    for (let i = 0; i < 30; i++) __valley.step(1, dt);
    let ilo = Infinity, ihi = -Infinity;
    for (let i = 0; i < 60; i++) { __valley.step(1, dt); ch.model.updateMatrixWorld(true); for (const b of ['LeftFoot', 'RightFoot']) { ch.bone(b).getWorldPosition(V); const y = V.y - g.terrain.heightAt(V.x, V.z); ilo = Math.min(ilo, y); ihi = Math.max(ihi, y); } }
    res.idle = { lo: Math.round(ilo * 1000) / 10, hi: Math.round(ihi * 1000) / 10 };
    out[wk.name] = res;
  }
  return out;
}`;

const W = { KeyW: true }, RUN = { KeyW: true, ShiftLeft: true }, NONE = { KeyW: false, ShiftLeft: false }, BACK = { KeyW: false, KeyS: true, ShiftLeft: false };
const OFF12 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], OFF12x2 = OFF12.map(k => k * 2);
export const CASES = [
  { name: 'start', q: '?loco=a', before: [[0.01, {}, true]], window: W, offsets: [0, 7, 19, 31] },
  // 止まり：既定（足を放して待ちの姿へ寄せる）は M2a より悪くならない。?stop=hold（留めて一歩で寄せる）は 6cm 以内（hold：M2a との比べは要らない）
  { name: 'stopRun', q: '?loco=a', before: [[1.5, RUN, true]], window: NONE, offsets: OFF12, notWorse: true },
  { name: 'stopWalk', q: '?loco=a', before: [[1.5, W, true]], window: NONE, offsets: OFF12x2, notWorse: true },
  { name: 'stopRunHold', q: '?loco=a&stop=hold', before: [[1.5, RUN, true]], window: NONE, offsets: OFF12, hz: [60, 30, 144], hold: true },
  { name: 'stopWalkHold', q: '?loco=a&stop=hold', before: [[1.5, W, true]], window: NONE, offsets: OFF12x2, hold: true },
  { name: 'switch', q: '?loco=a&walk=2.0', before: [[1.5, W, true]], window: { ShiftLeft: true }, offsets: OFF12x2 },
  { name: 'switch25', q: '?loco=a&walk=2.5', before: [[1.5, W, true]], window: { ShiftLeft: true }, offsets: OFF12x2 },
  { name: 'reverse', q: '?loco=a', before: [[1.5, RUN, true]], window: BACK, offsets: OFF12 },
];
// 地面の場所（主人公の論理の位置と向き。yaw 0 は −z、π/2 は −x、−π/2 は +x へ進む）
export const WALKS = [
  { name: 'flat', x: START.x, z: START.z, yaw: 0, keys: W, secs: 2.0 },
  { name: 'temple_road', x: -71, z: -64.5, yaw: -2.1, keys: W, secs: 2.5 },
  { name: 'bank_slope', x: -64.2, z: -25.0, yaw: -Math.PI / 2, keys: W, secs: 2.0 },
  { name: 'river_bank', x: 97, z: 10, yaw: -Math.PI / 2, keys: W, secs: 2.0 },
  { name: 'terrace', x: 0, z: 52, yaw: Math.PI, keys: W, secs: 3.0 },
];

export default async function (ctx) {
  await prepare(ctx);
  const { v, log } = ctx, parts = (process.env.KZ_PARTS || 'journey,sweep,ground').split(',');   // KZ_PARTS＝調べ直す部分だけ（作業用。合否は全部で）
  if (parts.length < 3) log('KZ_PARTS:', parts.join(','), '（一部だけ。回帰の合否には使わない）');
  // 1. 台本（新しいページの最初に1回）
  const out = {};
  if (parts.includes('journey')) {
  const journey = smoothMetrics(await recordJourney(v), OPTS); out.journey = { slip: {}, windows: journey.windows.list };
  for (const [tag, lim] of Object.entries(SLIP)) {
    const s = journey.slip.byTag[tag]; out.journey.slip[tag] = s?.cmPerM;
    log(`台本 ${tag.padEnd(5)} 滑り ${s?.cmPerM} cm/m（目標 ${lim}）`);
    check(s && s.cmPerM != null && s.cmPerM <= lim && s.cmPerM <= 3, `journey ${tag}: slip ${s?.cmPerM} cm/m > ${lim}`);
  }
  for (const e of journey.windows.list) { const lim = e.kind === 'stop' ? STOP_FREE_CM : WINDOW_CM; log(`台本の窓 ${e.kind}@${e.t.toFixed(2)} ${e.maxCm}cm（上限 ${lim}）`); check(e.maxCm <= lim, `journey window ${e.kind}@${e.t.toFixed(2)}: ${e.maxCm}cm > ${lim}`); }
  }
  const run = (fn, arg) => v(`(async () => { const A = await import('/valley/actors.js'); const g = __valley.game, h = g.hero, ch = h.character;
    const seeded = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const rng0 = g.rng, rnd0 = Math.random;
    const reset = () => { Math.random = seeded(1333); g.rng = seeded(1333); for (const k of ['KeyW', 'KeyS', 'ShiftLeft', 'KeyC']) __valley.key(k, false); h.crouch = false; h.place(${START.x}, ${START.z}, ${START.yaw}); h.speed = 0; h.locoA = 0; h.locoV = 0; g.rig.yaw = ${START.yaw}; g.rig.snap();
      for (const a of ch.mixer._actions) a.stop(); ch.mixer.time = 0; ch.time = 0; ch.current = null; ch.currentName = null; ch.locoName = null; ch.locoOut = null; ch.gait = 'idle'; ch.resetContacts();
      const far = (a, i) => { if (a && a !== h) a.place(${START.x} + 60 + i * 3, ${START.z} + 60, 0); };
      far(g.ally, 0); [...g.npcs.values()].forEach((n, i) => far(n, i + 1)); g.enemies.forEach((e, i) => far(e, i + 40)); h.lockTarget = null; h.guardStance = false; };
    const original = location.search; const res = await (${fn})(A, g, h, ch, reset, ${JSON.stringify(arg ?? null)}); A.configureLoco(original); reset(); g.rng = rng0; Math.random = rnd0; return res; })()`);
  // 2. 掃引
  out.sweep = {};
  if (parts.includes('sweep')) {
  for (const c of CASES) for (const hz of c.hz || [60]) {
    const sweep = async q => { const r = []; for (const k of c.offsets) r.push(...await run(SWEEP, [q, c.before, c.window, [k], FLAT, hz])); return stats(r); };
    const before = c.hold ? null : await sweep(c.q + '&smooth=ik'), after = await sweep(c.q), key = hz === 60 ? c.name : `${c.name}@${hz}`;
    out.sweep[key] = { before, after };
    log(`${key.padEnd(14)} ${before ? `M2a（?smooth=ik）: 平均 ${before.mean} 最大 ${before.max}  ／ ` : ''}M2b: ${after.list.join(' ')}  平均 ${after.mean} 最大 ${after.max}`);
    if (c.notWorse) { check(after.max <= before.max + 0.5, `${key}: max ${after.max}cm is worse than M2a ${before.max}cm`); check(after.max <= STOP_SWEEP_CM, `${key}: max ${after.max}cm > ${STOP_SWEEP_CM}`); }
    else check(after.max <= WINDOW_CM, `${key}: max ${after.max}cm > ${WINDOW_CM}`);
  }
  const hzMax = [60, 30, 144].map(hz => out.sweep[hz === 60 ? 'stopRunHold' : `stopRunHold@${hz}`].after.max);
  check(Math.max(...hzMax) - Math.min(...hzMax) <= WINDOW_CM, `stopRunHold across 30/60/144Hz: ${hzMax.join('/')}`);
  }
  // 3. 地面
  if (parts.includes('ground')) {
  const ground = { before: await run(GROUND, ['?loco=a&smooth=ik', WALKS, FLAT]), after: await run(GROUND, ['?loco=a', WALKS, FLAT]) };
  out.ground = ground;
  const ref = ground.after.flat;
  for (const wk of WALKS) {
    const b = ground.before[wk.name], a = ground.after[wk.name];
    const err = r => ({ float: Math.max(0, r.hi - ref.hi), sink: Math.max(0, ref.lo - r.lo) });
    const eb = err(b), ea = err(a);
    log(`地面 ${wk.name.padEnd(12)} 登り ${a.climb}m 進み ${a.moved}m  足首の高さ ${a.lo}〜${a.hi}cm（平ら ${ref.lo}〜${ref.hi}）浮き ${ea.float.toFixed(1)} 沈み ${ea.sink.toFixed(1)}cm ／ M2a: ${b.lo}〜${b.hi}cm 浮き ${eb.float.toFixed(1)} 沈み ${eb.sink.toFixed(1)}cm`);
    check(a.n > 20, `${wk.name}: too few planted samples (${a.n})`);
    check(ea.float <= GROUND_CM && ea.sink <= GROUND_CM, `${wk.name}: float ${ea.float.toFixed(1)} / sink ${ea.sink.toFixed(1)}cm > ${GROUND_CM}`);
    const idle = r => ({ float: Math.max(0, r.idle.hi - ref.idle.hi), sink: Math.max(0, ref.idle.lo - r.idle.lo) }), ib = idle(b), ia = idle(a);
    log(`地面 ${wk.name.padEnd(12)} 立ち止まり 足首 ${a.idle.lo}〜${a.idle.hi}cm（平ら ${ref.idle.lo}〜${ref.idle.hi}）浮き ${ia.float.toFixed(1)} 沈み ${ia.sink.toFixed(1)}cm ／ M2a: ${b.idle.lo}〜${b.idle.hi}cm 浮き ${ib.float.toFixed(1)} 沈み ${ib.sink.toFixed(1)}cm`);
    check(ia.float <= GROUND_CM && ia.sink <= GROUND_CM, `${wk.name} (standing): float ${ia.float.toFixed(1)} / sink ${ia.sink.toFixed(1)}cm > ${GROUND_CM}`);
  }
  }
  if (process.env.KZ_OUT) fs.writeFileSync(process.env.KZ_OUT, JSON.stringify({ ...out, fail }, null, 1) + '\n');
  if (fail.length) log('FAIL', fail.join(' / '));
  assert.deepEqual(fail, [], 'regress-locomotion-ik');
  log('regress-locomotion-ik: OK');
}
