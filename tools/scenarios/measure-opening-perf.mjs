// 測定：オープニングの舞台の重さ（場面A〜Dごとの1コマの時間 p50・p95・最大、描画呼出・三角形）と、
// 始まりの1コマ（舞台の組み立てと谷の先組み立て。暗転の下）・目覚めの最初の1コマの時間。
// 1コマごとに1画素を読み戻してGPUの完了まで待つ（perfSamples と同じ測り方）。予算は呼出300・三角形150万・標準p95 20ms。
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/measure-opening-perf.mjs --intro 1 --seed 1333 [--q light]
//   KZ_OUT=<file.json> で結果をJSONに残す。
import fs from 'node:fs';
import { summarize } from '../../dist/valley/perf-stats.js';

const WINDOWS = [['A', 3.4, 11.4], ['B', 12.6, 20.9], ['C', 22.1, 30.4], ['D', 31.6, 41.9]];   // 溶け合いと暗転を除いた、場面だけの区間（秒）
export default async function ({ v, start, freeze, step, log }) {
  await v("localStorage.removeItem('kamakura-valley-meta')");
  const t0 = await v('performance.now()'); await start('new'); await freeze(true);
  const startMs = await v(`(() => { const g = __valley.game, gl = g.renderer.getContext(), px = new Uint8Array(4); g.update(1/60); g.render(1/60); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return performance.now(); })()`) - t0;
  const report = { quality: null, startFrameMs: +startMs.toFixed(1), scenes: {}, wakeFirstFrameMs: null };
  let t = 1 / 60;
  for (const [id, from, to] of WINDOWS) {
    await step(Math.round((from - t) * 60)); t = from;
    const n = Math.round((to - from) * 60), r = await v(`__valley.perfSamples(${n})`); t = to;
    const s = summarize(r.ms);
    report.quality = r.quality;
    report.scenes[id] = { frames: n, p50: +s.p50.toFixed(2), p95: +s.p95.toFixed(2), max: +s.max.toFixed(2), calls: Math.max(...r.calls), tris: Math.max(...r.tris), shot: (await v('__valley.game.stage?.shot')) };
    log(id, JSON.stringify(report.scenes[id]));
  }
  await step(Math.round((46.9 - t) * 60));
  const around = await v(`(() => { const g = __valley.game, gl = g.renderer.getContext(), px = new Uint8Array(4), out = [];
    for (let i = 0; i < 30; i++) { const a = performance.now(); g.update(1/60); g.render(1/60); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); out.push([performance.now() - a, g.openingOut?.segment || g.flow]); } return out; })()`);
  const w = around.findIndex(f => f[1] === 'wake');
  report.wakeFirstFrameMs = w >= 0 ? +around[w][0].toFixed(1) : null;
  log('start frame', report.startFrameMs, 'ms; wake first frame', report.wakeFirstFrameMs, 'ms');
  if (process.env.KZ_OUT) fs.writeFileSync(process.env.KZ_OUT, JSON.stringify(report, null, 2) + '\n');
}
