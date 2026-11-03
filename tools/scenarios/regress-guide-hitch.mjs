// 回帰：林道を走って基準路から25m以上離れ、迷いの助け（復帰探索・0.5秒ごと）が働いている間も、1コマが詰まらない。
// 2026-11-03 の測定：案内あり（既定）の走行で、道を外れた最初の1回に約0.7〜1秒、その後0.5秒ごとに0.1〜0.2秒の停止が出た
// （復帰探索が毎回、格子を作り直していた）。案内を切ると出なかった。修正の記録は tasks-polish3.md の G。
// 合格線: 暖機後の720コマで 100ms以上のコマが0、p99 が 2コマ分（33.4ms）以下。
// 門番であることの確認: 道外れの強調が300コマ以上続き、復帰路が8回以上作り直されること（働いていない検査を合格にしない）。
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-guide-hitch.mjs --strict
import fs from 'node:fs/promises';
import path from 'node:path';
export default async function ({ page, out, start, freeze, log }) {
  await start('new'); await freeze(true);
  const r = await page.evaluate(() => {
    const qa = window.__valley, g = qa.game, DT = 1 / 60, WARM = 30, FRAMES = 720, ARRIVAL = 0.6;
    if (g.settings.waymarks !== 'bold') throw Error(`waymarks must be the default 'bold', got ${g.settings.waymarks}`);
    qa.god(true);
    qa.dispatch({ type: 'enter_zone', zone: 'temple_yard' });
    for (let i = 0; i < 8; i++) { qa.step(20); qa.advanceDialogue(true); }
    qa.dispatch({ type: 'dialogue_end', id: 'boy_arrives' });
    qa.advanceDialogue(true); g.pendingDialogue = null;
    if (g.quest.beat !== 'b2_road') throw Error(`expected b2_road, got ${g.quest.beat}`);
    const originalZones = g.updateZones, originalUpdate = g.update;
    g.updateZones = () => {}; // 区域に入って段が進むと基準路が替わるので、測定中は b2 に固定する（measure-perf と同じ）
    qa.step(2); // 寺の庭で b2 の基準路を作る（林道の先は、この基準路の終点より先＝道外れ）
    const road = g.world.roads.forest.points.map(([x, z]) => ({ x, z }));
    const route = [...road.slice(7), g.world.zones.village_front];
    qa.teleport(route[0].x, route[0].z, 0);
    let target = 1, direction = 1, emphasized = 0, rebuilt = 0, last = g.guide?.recovery ?? null;
    g.update = function (dt) {
      let p = route[target];
      const h = g.hero.pos;
      if (Math.hypot(p.x - h.x, p.z - h.z) < ARRIVAL) {
        if (target + direction < 0 || target + direction >= route.length) direction *= -1;
        target += direction; p = route[target];
      }
      qa.look(Math.atan2(-(p.x - h.x), -(p.z - h.z)), 0.2); g.input.held.add('KeyW'); g.input.held.add('ShiftLeft');
      originalUpdate.call(g, dt);
      const v = qa.guideView();
      if (v.emphasized) emphasized++;
      const now = g.guide?.recovery ?? null;
      if (now && now !== last) rebuilt++;
      last = now;
    };
    try {
      qa.perfSamples(WARM, DT);
      emphasized = 0; rebuilt = 0;
      const samples = qa.perfSamples(FRAMES, DT);
      return { ms: samples.ms, emphasized, rebuilt, quality: samples.quality, w: samples.w, h: samples.h, beat: g.quest.beat,
        hero: { x: g.hero.pos.x, z: g.hero.pos.z }, recoveryMs: qa.guideView().recoveryMs };
    } finally { g.update = originalUpdate; g.updateZones = originalZones; g.input.clear(); }
  });
  const sorted = [...r.ms].sort((a, b) => a - b), p99 = sorted[Math.ceil(0.99 * sorted.length) - 1], max = sorted.at(-1);
  const over100 = r.ms.filter(v => v >= 100).length, over50 = r.ms.filter(v => v >= 50).length;
  const summary = { frames: r.ms.length, p99, max, over50, over100, emphasized: r.emphasized, rebuilt: r.rebuilt, quality: r.quality, size: `${r.w}x${r.h}`, beat: r.beat, lastRecoveryMs: r.recoveryMs };
  await fs.writeFile(path.join(out, 'guide-hitch.json'), JSON.stringify({ summary, ms: r.ms }, null, 1) + '\n');
  log(JSON.stringify(summary));
  if (r.beat !== 'b2_road') throw Error(`beat changed during the run: ${r.beat}`);
  if (r.emphasized < 300 || r.rebuilt < 8) throw Error(`the guide recovery did not run enough to test (emphasized ${r.emphasized} frames, rebuilt ${r.rebuilt}); the gate would be empty`);
  if (over100 > 0) throw Error(`${over100} frames took 100ms or more (max ${max.toFixed(1)}ms). 型: 迷いの助けの復帰探索が1コマで重い計算をしている`);
  if (p99 > 33.4) throw Error(`p99 ${p99.toFixed(1)}ms > 33.4ms. 型: 復帰探索が0.5秒ごとにコマを詰まらせている`);
}
