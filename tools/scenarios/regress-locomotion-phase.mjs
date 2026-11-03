// 回帰（M2a・design-locomotion-smooth §4・§11）：足の位相と歩調。実ゲームの主人公で、窓0.5秒の接地足のずれ（cm・gait-table の平らな区間）を
// 新しい経路（既定）と M1 の経路（?smooth=phase）で同じページの中で比べる。どれも位相の運で値が変わるので、1本ではなく位相をずらした掃引で見る。
//  1. 歩容の切り替え：通常移動を小走りの速さ（?walk=2.0・2.5）にして小走りで進み、Shift で走りへ。押す時刻を2コマずつ12通り（小走りの半周）。
//  2. 歩き出し：待ちから W（表 a・通常移動3.0）。待ちの長さを4通り。
//  3. 止まり：走り（5.0）・通常移動（3.0）から手を離す。走りの長さを1コマずつ12通り（走りの半周＝左右の1歩ぶん）。
// 合否（gate＝M1 に対する倍率）：歩き出し・止まり（走り）は平均と最大を10%以上下げる。切り替えは最大を10%以上下げ、平均は悪くしない
//   （平均は M1 で既に4cm前後と小さく、5〜9%しか下がらない）。止まり（通常移動）は平均の悪化を10%まで（要件38.3）・最大は悪くしない。
//   1. の小走りの速さは2.0と2.5の2通り（M0 の基準 B の小走り2.5で Shift を押したときに10.3cm流れた）。
// 各通りの前に、位置・速さ・動作の再生と乱数をすべて初めに戻す（動作の時計 mixer.time を0へ戻さないと、同じ通りが15cmと30cmに分かれた。時計が大きいと混ぜの終わりの比較が丸めで1コマずれ、接地の始まりが変わる）。
// 接地を決める周期の動作は、mixer が今動かしている物だけ（止めた動作は古い重みを返す。isRunning は倍率0で止めた出ていく動作も外すので使わない）。
// 速さの表はページの actors.js の configureLoco を直接呼んで切り替える（URL の ?loco=・?smooth= と同じ関数）。最後に読み込み時の設定へ戻す。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-locomotion-phase.mjs --strict --out <dir>（KZ_OUT=… でJSON）
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { prepare, START, FLAT } from './smooth-journey.mjs';

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };
// 1通りずつ別の指示で流す（1回の指示の中で続けて流すと、同じ通りが13cmと28cmに分かれた。指示ごとに乱数を作り直す capture-calls の決め方に乗る）
const sweep = async (run, c, q) => { const r = []; for (const k of c.offsets) r.push(...await run(SWEEP, [q, c.before, c.window, [k], FLAT])); return r; };
const stats = r => ({ list: r, mean: Math.round(r.reduce((a, b) => a + b, 0) / r.length * 10) / 10, max: Math.max(...r) });

// ページの中で1通りを流す：before＝窓の前の操作（[秒, キー]の列）、window＝窓を開く操作のキー。戻り値は窓の接地足のずれの最大（cm）
const SWEEP = `async (A, g, h, ch, reset, [q, before, windowKeys, offsets, FLAT]) => {
  A.configureLoco(q); const dt = 1 / 60, meta = g.roster.meta.clips, V = new ch.model.position.constructor(), res = [];
  const inWin = (p, [s, e]) => s <= e ? p >= s && p <= e : p >= s || p <= e;
  for (const k of offsets) {
    reset(); for (let i = 0; i < 36; i++) __valley.step(1, dt);
    for (const [secs, keys, extra] of before) { for (const [c, on] of Object.entries(keys)) __valley.key(c, on); for (let i = 0; i < Math.round(secs / dt) + (extra ? k : 0); i++) __valley.step(1, dt); }
    for (const [c, on] of Object.entries(windowKeys)) __valley.key(c, on);
    const anchor = [null, null]; let worst = 0;
    for (let i = 0; i < 30; i++) {
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

const W = { KeyW: true }, RUN = { KeyW: true, ShiftLeft: true }, NONE = { KeyW: false, ShiftLeft: false };
export const CASES = [
  { name: 'switch25', q: '?loco=a&walk=2.5', before: [[1.5, W, true]], window: { ShiftLeft: true }, offsets: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22], gate: { max: 0.9 } },
  { name: 'switch', q: '?loco=a&walk=2.0', before: [[1.5, W, true]], window: { ShiftLeft: true }, offsets: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22], gate: { max: 0.9 } },
  { name: 'start', q: '?loco=a', before: [[0.01, {}, true]], window: W, offsets: [0, 7, 19, 31], gate: { mean: 0.9, max: 0.9 } },
  { name: 'stopRun', q: '?loco=a', before: [[1.5, RUN, true]], window: NONE, offsets: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], gate: { mean: 0.9, max: 0.9 } },
  { name: 'stopWalk', q: '?loco=a', before: [[1.5, W, true]], window: NONE, offsets: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22], gate: { mean: 1.1 } },
];

export default async function (ctx) {
  await prepare(ctx);
  const { v, log } = ctx;
  const run = (fn, arg) => v(`(async () => { const A = await import('/valley/actors.js'); const g = __valley.game, h = g.hero, ch = h.character;
    const seeded = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const rng0 = g.rng, rnd0 = Math.random;
    const reset = () => { Math.random = seeded(1333); g.rng = seeded(1333); for (const k of ['KeyW', 'KeyS', 'ShiftLeft', 'KeyC']) __valley.key(k, false); h.crouch = false; h.place(${START.x}, ${START.z}, ${START.yaw}); h.speed = 0; h.locoA = 0; h.locoV = 0; g.rig.yaw = ${START.yaw}; g.rig.snap();
      for (const a of ch.mixer._actions) a.stop(); ch.mixer.time = 0; ch.time = 0; ch.current = null; ch.currentName = null; ch.locoName = null; ch.locoOut = null; ch.gait = 'idle'; ch.resetContacts();
      const far = (a, i) => { if (a && a !== h) a.place(${START.x} + 60 + i * 3, ${START.z} + 60, 0); };
      far(g.ally, 0); [...g.npcs.values()].forEach((n, i) => far(n, i + 1)); g.enemies.forEach((e, i) => far(e, i + 40)); h.lockTarget = null; h.guardStance = false; };   // 近くの仲間・村人は押し分けで主人公を押すので遠ざける   // 動作も最初から（前の通りの待ちの時刻・混ぜを持ち越さない）
    const original = location.search; const res = await (${fn})(A, g, h, ch, reset, ${JSON.stringify(arg ?? null)}); A.configureLoco(original); reset(); g.rng = rng0; Math.random = rnd0; return res; })()`);
  const out = {};
  for (const c of CASES) {
    const before = stats(await sweep(run, c, c.q + '&smooth=phase'));
    const after = stats(await sweep(run, c, c.q));
    if (process.env.KZ_SELFCHECK) log(`${c.name} 同じ設定をもう1回（揺れの点検）: ${(await sweep(run, c, c.q + '&smooth=phase')).join(' ')}`);
    out[c.name] = { q: c.q, before, after };
    log(`${c.name.padEnd(8)} M1（?smooth=phase）: ${before.list.join(' ')}  平均 ${before.mean} 最大 ${before.max}`);
    log(`${''.padEnd(8)} M2a（既定）       : ${after.list.join(' ')}  平均 ${after.mean} 最大 ${after.max}`);
    const g = { mean: 1, ...c.gate };
    check(after.mean <= before.mean * g.mean + 0.05, `${c.name}: mean ${after.mean} vs M1 ${before.mean} (allowed ×${g.mean})`);
    check(after.max <= (g.max ? before.max * g.max : before.max + 0.5), `${c.name}: max ${after.max} vs M1 ${before.max} (allowed ${g.max ? '×' + g.max : '+0.5cm'})`);
  }
  if (process.env.KZ_OUT) fs.writeFileSync(process.env.KZ_OUT, JSON.stringify({ ...out, fail }, null, 1) + '\n');
  if (fail.length) log('FAIL', fail.join(' / '));
  assert.deepEqual(fail, [], 'regress-locomotion-phase');
  log('regress-locomotion-phase: OK');
}
