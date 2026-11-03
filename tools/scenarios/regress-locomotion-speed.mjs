// 回帰（M1・design-locomotion-smooth §2・§3）：時間で決める加速・減速・旋回と、速さの表の切替を実ゲームの主人公で確かめる。
//  1. 止まる距離と時間：走り・通常移動から手を離し、30・60・144コマ/秒で止まるまでの距離と時間が一致する（差は距離2%・時間1コマ以内）。
//     新しい経路ではキーを離しても進み（走り0.3〜0.5m）、旧い経路（?loco=old）では1コマで止まる（0m）。
//  2. 速さの連続：走り出し・止まり・反転（S）で、論理の速さと実際に進んだ速さの1コマの変化が1m/秒以下（60コマ/秒）。
//  3. 候補の表：old・a・b・c と個別の walk/sprint で、定速の通常移動・走りが表の値になる。仲間の追いつく上限は走りの1.04倍以上、敵の走りは通常移動以上。
//  4. 止まりの位相の掃引（記録だけ・合否なし）：走りの長さを1コマずつ12通り（走りの半周＝左右の1歩ぶん）ずらし、止まりの窓0.5秒の接地のずれ（cm・gait-table の平らな区間）。M2a の手がかり。
// 速さの表はページの actors.js の configureLoco を直接呼んで切り替える（URL の ?loco= と同じ関数）。最後に読み込み時の設定へ戻す。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-locomotion-speed.mjs --strict --out <dir>（KZ_OUT=… でJSON）
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { prepare, START, FLAT } from './smooth-journey.mjs';

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };

export default async function (ctx) {
  await prepare(ctx);
  const { v, log } = ctx;
  const out = { stops: [], jumps: null, tables: [], sweep: null };
  const run = (fn, arg) => v(`(async () => { const A = await import('/valley/actors.js'); const g = __valley.game, h = g.hero, ch = h.character;
    const reset = () => { for (const k of ['KeyW', 'KeyS', 'ShiftLeft', 'KeyC']) __valley.key(k, false); h.crouch = false; h.place(${START.x}, ${START.z}, ${START.yaw}); h.speed = 0; h.locoA = 0; h.locoV = 0; g.rig.yaw = ${START.yaw}; g.rig.snap(); };
    const original = location.search; const res = await (${fn})(A, g, h, ch, reset, ${JSON.stringify(arg ?? null)}); A.configureLoco(original); reset(); return res; })()`);

  // 1. 止まる距離と時間
  for (const loco of ['a', 'old']) for (const gait of ['sprint', 'walk']) {
    const rows = [];
    for (const hz of [30, 60, 144]) {
      rows.push(await run(`async (A, g, h, ch, reset, [loco, gait, hz]) => {
        A.configureLoco('?loco=' + loco); reset(); const dt = 1 / hz;
        __valley.key('KeyW', true); if (gait === 'sprint') __valley.key('ShiftLeft', true);
        for (let i = 0; i < Math.round(1.6 * hz); i++) __valley.step(1, dt);
        const v0 = h.speed, x0 = h.pos.x, z0 = h.pos.z; __valley.key('KeyW', false); __valley.key('ShiftLeft', false);
        let t = 0, n = 0, moving = 0; while (n < 2 * hz) { const bx = h.pos.x, bz = h.pos.z; __valley.step(1, dt); n++; if (Math.hypot(h.pos.x - bx, h.pos.z - bz) > 1e-5) moving = n; if (h.speed === 0 && n > moving) break; }
        return { loco, gait, hz, v0, dist: Math.hypot(h.pos.x - x0, h.pos.z - z0), time: moving * dt };
      }`, [loco, gait, hz]));
    }
    out.stops.push(...rows);
    log(`止まり ${loco} ${gait}: ` + rows.map(r => `${r.hz}Hz v0=${r.v0.toFixed(2)} ${(r.dist * 100).toFixed(1)}cm ${(r.time * 1000).toFixed(0)}ms`).join('  '));
    const ref = rows[1];
    if (loco === 'old') check(rows.every(r => r.dist < 0.005), `old ${gait}: the body should stop in one frame (${rows.map(r => r.dist.toFixed(3))})`);
    else {
      check(ref.dist > (gait === 'sprint' ? 0.3 : 0.15) && ref.dist < (gait === 'sprint' ? 0.5 : 0.35), `${loco} ${gait}: stop distance ${ref.dist.toFixed(3)} m out of range`);
      for (const r of rows) {
        check(Math.abs(r.dist - ref.dist) <= 0.02 * ref.dist + 0.003, `${loco} ${gait} ${r.hz}Hz: stop distance ${r.dist.toFixed(4)} vs 60Hz ${ref.dist.toFixed(4)}`);
        check(Math.abs(r.time - ref.time) <= 1 / 30 + 1e-9, `${loco} ${gait} ${r.hz}Hz: stop time ${r.time.toFixed(3)} vs 60Hz ${ref.time.toFixed(3)}`);
      }
    }
  }

  // 2. 速さの連続（既定の表 a）
  out.jumps = await run(`async (A, g, h, ch, reset) => {
    A.configureLoco('?loco=a'); reset(); const dt = 1 / 60, seq = [[0.5, {}], [1.2, { KeyW: true }], [1.0, { KeyW: true, ShiftLeft: true }], [0.8, { KeyW: false, ShiftLeft: false }], [1.2, { KeyS: true }], [0.8, { KeyS: false }]];
    let prevV = h.speed, prevT = 0, maxL = 0, maxT = 0, worst = null;
    for (const [secs, keys] of seq) { for (const [k, on] of Object.entries(keys)) __valley.key(k, on);
      for (let i = 0; i < Math.round(secs / dt); i++) { const bx = h.pos.x, bz = h.pos.z; __valley.step(1, dt); const tv = Math.hypot(h.pos.x - bx, h.pos.z - bz) / dt;
        const dl = Math.abs(h.speed - prevV), dm = Math.abs(tv - prevT); if (dl > maxL) maxL = dl; if (dm > maxT) { maxT = dm; worst = { keys, i, tv, prevT }; } prevV = h.speed; prevT = tv; } }
    return { maxLogicalStep: maxL, maxTravelStep: maxT, worst };
  }`);
  log('速さの1コマの変化の最大（m/秒）:', JSON.stringify(out.jumps));
  check(out.jumps.maxLogicalStep <= 1.0 && out.jumps.maxTravelStep <= 1.0, `speed jumps over 1 m/s per frame: ${JSON.stringify(out.jumps)}`);

  // 3. 候補の表
  for (const q of ['?loco=old', '?loco=a', '?loco=b', '?loco=c', '?loco=c&walk=3.4&sprint=6', '?smooth=speed', '?smooth=off']) {
    const r = await run(`async (A, g, h, ch, reset, q) => {
      const cfg = A.configureLoco(q); reset(); const dt = 1 / 60, speedAfter = keys => { reset(); for (const [k, on] of Object.entries(keys)) __valley.key(k, on); for (let i = 0; i < 90; i++) __valley.step(1, dt); const s = h.speed; for (const k of Object.keys(keys)) __valley.key(k, false); return s; };
      return { q, name: cfg.name, walk: speedAfter({ KeyW: true }), sprint: speedAfter({ KeyW: true, ShiftLeft: true }), cfgWalk: cfg.walk, cfgSprint: cfg.sprint, smoothAccel: cfg.smoothAccel, S: { ...A.SPEED } };
    }`, q);
    out.tables.push(r);
    log(`表 ${q}: ${r.name} 通常 ${r.walk.toFixed(3)} 走り ${r.sprint.toFixed(3)} 仲間 ${r.S.ally.toFixed(2)}×(1+${r.S.allyCatchUp.toFixed(2)}) 敵 ${r.S.run}/${r.S.officerRun} 加減速=${r.smoothAccel ? '新' : '旧'}`);
    check(Math.abs(r.walk - r.cfgWalk) < 0.01 && Math.abs(r.sprint - r.cfgSprint) < 0.01, `${q}: steady speeds ${r.walk}/${r.sprint} vs table ${r.cfgWalk}/${r.cfgSprint}`);
    check(r.S.ally * (1 + r.S.allyCatchUp) >= 1.04 * r.cfgSprint - 1e-9, `${q}: the ally cannot catch the sprint`);
    check(r.S.run >= r.cfgWalk && r.S.officerRun >= r.cfgWalk, `${q}: enemy run below the hero walk`);
  }
  const tb = Object.fromEntries(out.tables.map(r => [r.q, r]));
  check(tb['?loco=a'].cfgWalk === 3 && tb['?loco=a'].cfgSprint === 5 && tb['?loco=b'].cfgWalk === 2.8 && tb['?loco=c'].cfgSprint === 5.5 && tb['?loco=old'].cfgWalk === 2.5, 'candidate tables changed');
  check(tb['?smooth=off'].name === 'old' && !tb['?smooth=off'].smoothAccel && tb['?smooth=speed'].name === 'old' && tb['?smooth=speed'].smoothAccel, 'smooth flags do not turn the table/accel back');

  // 4. 止まりの位相の掃引（記録だけ）
  const FEET = ['LeftFoot', 'RightFoot'];
  for (const loco of ['old', 'a']) {
    const r = await run(`async (A, g, h, ch, reset, [loco, FEET, FLAT]) => {
      A.configureLoco('?loco=' + loco); const dt = 1 / 60, meta = g.roster.meta.clips, V = new ch.model.position.constructor(), res = [];
      const inWin = (p, [s, e]) => s <= e ? p >= s && p <= e : p >= s || p <= e;
      for (let k = 0; k < 12; k++) {
        reset(); for (let i = 0; i < 36; i++) __valley.step(1, dt);
        __valley.key('KeyW', true); __valley.key('ShiftLeft', true); for (let i = 0; i < 90 + k; i++) __valley.step(1, dt);
        __valley.key('KeyW', false); __valley.key('ShiftLeft', false);
        const anchor = [null, null]; let worst = 0;
        for (let i = 0; i < 30; i++) {
          __valley.step(1, dt);
          let best = null, bw = 0; for (const [name, a] of ch.actions) { const m = meta[name]; if (!m?.contacts || m.kind !== 'cycle') continue; const w = a.getEffectiveWeight(); if (w > bw) { bw = w; best = { a, m, name }; } }
          let contact = [true, true]; if (best && bw >= 0.5) { const ph = (best.a.time / best.m.seconds) % 1, fl = FLAT[best.name]; contact = ['left', 'right'].map(s => (fl ? fl[s] : best.m.contacts[s] || []).some(w => inWin(ph, w))); }
          ch.model.updateMatrixWorld(true);
          FEET.forEach((b, s) => { if (!contact[s]) { anchor[s] = null; return; } ch.bone(b).getWorldPosition(V); if (!anchor[s]) anchor[s] = [V.x, V.z]; worst = Math.max(worst, Math.hypot(V.x - anchor[s][0], V.z - anchor[s][1]) * 100); });
        }
        res.push(Math.round(worst * 10) / 10);
      }
      return res;
    }`, [loco, FEET, FLAT]);
    (out.sweep ||= {})[loco] = r;
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    log(`止まりの位相の掃引 ${loco}（cm）: ${r.join(' ')}  平均 ${mean.toFixed(1)} 最大 ${Math.max(...r)}`);
  }

  if (process.env.KZ_OUT) fs.writeFileSync(process.env.KZ_OUT, JSON.stringify({ ...out, fail }, null, 1) + '\n');
  if (fail.length) { log('FAIL', fail.join(' / ')); }
  assert.deepEqual(fail, [], 'regress-locomotion-speed');
  log('regress-locomotion-speed: OK');
}
