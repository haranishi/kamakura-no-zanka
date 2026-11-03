// 計測の土台（要件 R38.1・design-locomotion-smooth §8）：同じ走る台本を固定60Hzで動かし、毎コマを記録して滑らかさの指標（tools/lib/smooth-metrics.mjs）を出す。
// 台本：立つ→歩き出す（歩き→小走り）→小走り→走り→キーを離す→停止→反転（S）→走り→旋回（視点を0.6秒で90°回す＝マウスの操作）→キーを離す→
//   屈んでゆっくり歩く→停止。入力は実際のキー（W・S・Shift・C）と視点の向きだけ。論理・見た目のコードには触れない（読むだけ）。
// 記録：論理の位置・向き・速さ・歩容、模型の向き、腰・背骨・首・頭・肩・腕・手・脚・足首・つま先の世界の位置と向き、カメラの位置・向き・画角。
// 接地は clips.json の contacts（周期の割合）から：重み0.5以上の周期の動作があればその位相で、無ければ（待ち・混ぜの途中）両足を着いているものとする。
// 補助の列 low：接地かつ足首が地面から「立って待つ姿の足首の高さ＋3cm」より低い（clips.json の区間は両足支持の縁で上がり始めの足を含むため）。
// 乱数・時計・画面の繰り返しは capture-calls.mjs の deterministic で止める。同じコードなら同じ値：別々に3回起動して、記録の指紋（framesSha）が一致する。
//   同じページで続けて流すと、待ちの動作の時刻や人物の状態が前の回から引き継がれて一致しない（2026-11-04 に確かめた）。比べるのは起動ごと。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/smooth-journey.mjs --strict --out <dir>
//   出力: <dir>/smooth-journey.json（指標）と、KZ_RAW=1 なら <dir>/smooth-journey-frames.json（毎コマの記録）
//   main など古い版でも回せるよう、この道具は smooth-metrics.mjs と capture-calls.mjs だけに依存する（足りない値は null のまま）。
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { deterministic } from './capture-calls.mjs';
import { smoothMetrics, BONES } from '../lib/smooth-metrics.mjs';

export const START = { x: 2, z: 4, yaw: 0 };            // 里の中ほどの平らな所（measure-locomotion.mjs の FLAT と同じ）。yaw 0 は −z へ進む
const W = { KeyW: true, KeyS: false, ShiftLeft: false }, RUN = { KeyW: true, KeyS: false, ShiftLeft: true }, NONE = { KeyW: false, KeyS: false, ShiftLeft: false };
// 台本の各区間：t 秒・keys 押すキー（区間の頭で）・event 指標の窓を開く出来事・turn 区間の間に視点を回す角（rad・なめらかな山形）・crouch 区間の頭で C を押す
export const SCRIPT = [
  { tag: 'stand', t: 1.0, keys: NONE },
  { tag: 'start', t: 0.5, keys: W, event: 'start' },
  { tag: 'jog', t: 1.5 },
  { tag: 'run_start', t: 0.6, keys: RUN },
  { tag: 'run', t: 1.5 },
  { tag: 'stop', t: 1.0, keys: NONE, event: 'stop' },
  { tag: 'reverse', t: 1.2, keys: { KeyW: false, KeyS: true, ShiftLeft: false }, event: 'reverse' },
  { tag: 'run2', t: 0.6, keys: { KeyW: false, KeyS: true, ShiftLeft: true } },
  { tag: 'turn', t: 0.6, turn: Math.PI / 2, event: 'turn' },
  { tag: 'run3', t: 0.6 },
  { tag: 'stop2', t: 0.6, keys: NONE, event: 'stop' },
  { tag: 'slow', t: 1.8, keys: W, crouch: true, event: 'start' },
  { tag: 'stop3', t: 1.2, keys: NONE, event: 'stop' },
];
export const DT = 1 / 60;

// ページの中で台本を1回流し、毎コマの記録を返す
export function recordJourney(v, { script = SCRIPT, start = START, dt = DT, settle = 0.6 } = {}) {
  return v(`(() => {
    const g = __valley.game, h = g.hero, ch = h.character, meta = g.roster.meta.clips;
    const dt = ${dt}, script = ${JSON.stringify(script)}, start = ${JSON.stringify(start)}, BONES = ${JSON.stringify(BONES)};
    const keys = ['KeyW', 'KeyS', 'ShiftLeft', 'KeyC'];
    for (const k of keys) __valley.key(k, false);
    h.crouch = false; h.place(start.x, start.z, start.yaw); h.speed = 0; g.rig.yaw = start.yaw; g.rig.pitch = 0.2; g.rig.snap();
    for (let i = 0; i < Math.round(${settle} / dt); i++) __valley.step(1, dt);
    ch.model.updateMatrixWorld(true);
    let lowY = 0; for (const b of ['LeftFoot', 'RightFoot']) { const p = ch.bone(b).getWorldPosition(new ch.model.position.constructor()); lowY = Math.max(lowY, p.y - g.terrain.heightAt(p.x, p.z)); }
    lowY += 0.03;
    const V = new ch.model.position.constructor(), Q = new ch.model.quaternion.constructor(), r5 = x => Math.round(x * 1e5) / 1e5;
    const inWin = (p, [s, e]) => s <= e ? p >= s && p <= e : p >= s || p <= e;
    const frames = []; let t = 0, blocked = 0, moving = false;
    for (const seg of script) {
      if (seg.keys) moving = !!(seg.keys.KeyW || seg.keys.KeyS);
      const n = Math.round(seg.t / dt);
      if (seg.keys) for (const [k, on] of Object.entries(seg.keys)) __valley.key(k, on);
      if (seg.crouch) __valley.key('KeyC', true);
      const yaw0 = g.rig.yaw;
      for (let i = 0; i < n; i++) {
        if (seg.turn) g.rig.yaw = yaw0 + seg.turn * (1 - Math.cos(Math.PI * (i + 1) / n)) / 2;   // 視点を山形の速さで回す（マウスの操作の代わり）
        const before = { x: h.pos.x, z: h.pos.z };
        __valley.step(1, dt); t += dt;
        if (seg.crouch && i === 0) __valley.key('KeyC', false);
        const movedNow = Math.hypot(h.pos.x - before.x, h.pos.z - before.z) / dt;
        if (moving && h.speed > 0.5 && movedNow < h.speed * 0.8) blocked++;   // 壁・斜面で進めなかったコマ（台本の場所の点検用）
        let best = null, bw = 0;
        for (const [name, a] of ch.actions) { const m = meta[name]; if (!m?.contacts || m.kind !== 'cycle') continue; const w = a.getEffectiveWeight(); if (w > bw) { bw = w; best = { name, a, m }; } }
        let contact = [true, true], phase = null;
        if (best && bw >= 0.5) { phase = (best.a.time / best.m.seconds) % 1; contact = ['left', 'right'].map(s => (best.m.contacts[s] || []).some(w => inWin(phase, w))); }
        ch.model.updateMatrixWorld(true);
        const low = ['LeftFoot', 'RightFoot'].map((b, s) => { if (!contact[s]) return false; ch.bone(b).getWorldPosition(V); return V.y - g.terrain.heightAt(V.x, V.z) < lowY; });
        const bones = {};
        for (const b of BONES) { const o = ch.bone(b); if (!o) continue; o.getWorldPosition(V); o.getWorldQuaternion(Q); bones[b] = [V.x, V.y, V.z, Q.x, Q.y, Q.z, Q.w].map(r5); }
        const c = g.camera;
        frames.push({ t: r5(t), tag: seg.tag, event: i === 0 && seg.event ? seg.event : null, pos: [h.pos.x, h.pos.y ?? 0, h.pos.z].map(r5), yaw: r5(h.yaw), modelYaw: r5(ch.root.rotation.y), speed: r5(h.speed),
          gait: ch.gait ?? null, clip: best?.name ?? null, weight: r5(bw), phase: phase == null ? null : r5(phase), timeScale: best ? r5(best.a.timeScale) : null, contact, low, bones,
          cam: [c.position.x, c.position.y, c.position.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w, c.fov].map(r5) });
      }
    }
    for (const k of keys) __valley.key(k, false);
    if (h.crouch) { __valley.key('KeyC', true); __valley.step(1, dt); __valley.key('KeyC', false); }
    return { dt, blocked, lowY: r5(lowY), frames };
  })()`);
}

export async function prepare(ctx) {
  await deterministic(ctx);
  const { start, step, call, st } = ctx;
  await start('new'); await step(40); await call('god', true);
  for (let i = 0; i < 60; i++) { const s = await st(); if (s.talking) { await call('advanceDialogue', true); await step(10); } else if (s.pending) await step(30); else break; }
  await call('camera', null);
}

// 表：区間ごとの足の滑りと接地のずれ、全体の指標
export function report(m, log) {
  log('区間        進んだm  接地中の足の水平移動cm  cm/m   接地のずれ最大cm  カメラ加加速度p99  角加速度p99');
  for (const [tag, s] of Object.entries(m.slip.byTag)) log(`${tag.padEnd(11)} ${String(s.distM).padStart(7)} ${String(s.slipCm).padStart(10)} ${String(s.cmPerM ?? '-').padStart(16)} ${String(m.stanceMax[tag] ?? '-').padStart(12)} ${String(m.camera.byTag[tag]?.posJerkP99 ?? '-').padStart(16)} ${String(m.camera.byTag[tag]?.rotAccelP99 ?? '-').padStart(12)}`);
  log('出来事の窓（0.5秒）の接地のずれ最大cm:', m.windows.list.map(e => `${e.kind}${e.from ? `(${e.from}→${e.to})` : ''}@${e.t.toFixed(2)} ${e.maxCm}`).join('  '));
  log('全体:', JSON.stringify(m.summary));
  log('関節の跳ねの最大:', JSON.stringify(m.pops.worst));
}

export const OPTS = Object.freeze({ camExclude: ['turn'] });   // 視点を回した区間はカメラの要約から外す（区間ごとの値には残る）

export default async function (ctx) {
  await prepare(ctx);
  const run = await recordJourney(ctx.v), metrics = smoothMetrics(run, OPTS);
  const framesSha = createHash('sha256').update(JSON.stringify(run.frames)).digest('hex').slice(0, 16);
  report(metrics, ctx.log);
  ctx.log('壁・斜面で進めなかったコマ:', run.blocked, ' コマ数:', run.frames.length, ' 記録の指紋:', framesSha);
  fs.writeFileSync(path.join(ctx.out, 'smooth-journey.json'), JSON.stringify({ script: SCRIPT, start: START, dt: DT, opts: OPTS, frames: run.frames.length, blocked: run.blocked, lowY: run.lowY, framesSha, metrics }, null, 1) + '\n');
  if (process.env.KZ_RAW) fs.writeFileSync(path.join(ctx.out, 'smooth-journey-frames.json'), JSON.stringify(run));
}
