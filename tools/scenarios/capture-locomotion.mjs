// 撮影：主人公の走り出し・走っている途中・止まる・曲がる・歩き→走りを、横からの固定カメラでコマ画像に残す（足運びの改修の前後比較）。
// 乱数・時計・画面の繰り返しは capture-calls.mjs と同じく止める（同じコードなら同じコマ）。入力は実際のキー（W・Shift）と視点の向きだけ。
// 論理の位置は改修の前後で同じなので、カメラの置き場所（その場面の論理の位置から決める）も前後で同じになる。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-locomotion.mjs --out <dir> --strict
//   出力: <dir>/<場面>-NN.png（4コマ＝60コマ/秒で約67msごと、8枚）と <dir>/locomotion.json（各コマの論理の位置）
import fs from 'node:fs/promises';
import path from 'node:path';
import { deterministic } from './capture-calls.mjs';
import { FLAT } from './measure-locomotion.mjs';

const EVERY = 4, TILES = 8;
const run = { KeyW: true, ShiftLeft: true }, walk = { KeyW: true, ShiftLeft: false }, stop = { KeyW: false, ShiftLeft: false };
// lead：撮り始めるまでの準備（秒・キー）。at：撮影の何枚目の前に入れる操作。ahead：カメラの狙いを論理の位置から進む向きへ何m先に置くか
const SCENES = [
  { name: 'run_start', lead: [], at: { 0: { keys: run } }, ahead: 1.3 },
  { name: 'run_mid', lead: [[1.2, run]], at: {}, ahead: 1.3 },
  { name: 'run_stop', lead: [[1.2, run]], at: { 2: { keys: stop } }, ahead: 0.6 },
  { name: 'turn', lead: [[1.0, run]], at: { 1: { look: Math.PI / 2 } }, ahead: 0.4, side: 1 },
  { name: 'walk_to_run', lead: [[1.0, walk]], at: { 2: { keys: run } }, ahead: 1.2 },
];

export default async function (ctx) {
  await deterministic(ctx);
  const { st, step, call, v, shot, start, key } = ctx;
  await start('new'); await step(40); await call('god', true);
  for (let i = 0; i < 60; i++) { const s = await st(); if (s.talking) { await call('advanceDialogue', true); await step(10); } else if (s.pending) await step(30); else break; }
  await v("document.body.classList.add('hide-hud')");
  const log = [];
  for (const sc of SCENES) {
    await call('camera', null);
    for (const k of ['KeyW', 'ShiftLeft']) await key(k, false);
    await call('teleport', FLAT.x, FLAT.z, FLAT.yaw); await call('look', FLAT.yaw, 0.2); await v('(__valley.game.hero.speed = 0, 0)'); await step(36);
    for (const [secs, keys] of sc.lead) { for (const [k, on] of Object.entries(keys)) await key(k, on); await step(Math.round(secs * 60)); }
    const h = (await st()).hero;
    // 横（東）から、進む向き（−z）の少し先を見る。カメラは場面の間ずっと動かさない
    const cx = h.x + 4.6 * (sc.side ? 0.7 : 1), cz = h.z - sc.ahead + (sc.side ? 2.2 : 0);
    await call('camera', [cx, 1.25, cz], [h.x, 0.9, h.z - sc.ahead], 42);
    for (let i = 0; i < TILES; i++) {
      const op = sc.at[i];
      if (op?.keys) for (const [k, on] of Object.entries(op.keys)) await key(k, on);
      if (op?.look != null) await call('look', op.look, null);
      await step(i === 0 ? 1 : EVERY);
      await shot(`${sc.name}-${String(i).padStart(2, '0')}`);
      const s = (await st()).hero; log.push({ scene: sc.name, i, x: +s.x.toFixed(3), z: +s.z.toFixed(3) });
    }
  }
  for (const k of ['KeyW', 'ShiftLeft']) await key(k, false);
  await call('camera', null);
  await fs.writeFile(path.join(ctx.out, 'locomotion.json'), JSON.stringify({ every: EVERY, frames: log }, null, 1) + '\n');
}
