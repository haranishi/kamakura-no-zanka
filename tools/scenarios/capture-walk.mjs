// 見晴らし岩（見1の立ち位置）から里の入口まで、林道を走る様子をコマ画像で残す（S7-A。二次運動と密度を、静止画だけで判断しないため）。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-walk.mjs --out .captures/walk-after --strict
// 出力: <out>/walk-NN.png（45コマ＝0.75秒ごと）と <out>/walk.json（各コマの位置と段階）。襲撃中（b3。見晴らしで正面を選んだあと）。
// 乱数・時計・画面の繰り返しは capture-calls.mjs と同じく止める（同じコードなら同じコマになる）。歩き方は実際のキー（W＋Shift）と視点の向きだけ。
import fs from 'node:fs/promises';
import path from 'node:path';
import { deterministic } from './capture-calls.mjs';

const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
// 林道の中心線（world-data の roads.forest）を、見晴らしの平場から里の入口へたどる。
const ROUTE = [[-50, -33.5], [-60, -28], [-56.5, -20.5], [-44, -14], [-33.5, -8.5]];
const EVERY = 45, LIMIT = 1500;

export default async function (ctx) {
  await deterministic(ctx);
  const { st, step, call, v, shot, start, freeze, key } = ctx;
  const adv = async () => { for (let i = 0; i < 60; i++) { const s = await st(); if (s.talking) { await call('advanceDialogue', true); await step(10); } else if (s.pending) await step(30); else break; } };
  await start('new'); await freeze(true); await step(40); await call('god', true);
  // 見晴らしの区切りまで（capture-set.mjs と同じ近道）：穂太の話 → 物見を倒す → 見晴らしの会話 → 正面を選ぶ
  await call('teleport', -86, -75, -2.2); await step(5);
  for (let i = 0; i < 160; i++) { await step(3); const s = await st(); if (s.talking) break; }
  await adv();
  await v(`(()=>{ const g=__valley.game; const e=g.enemies.find(e=>e.id==='road_scout'); if (!e) return; e.fighter.hp=0; e.fighter.alive=false; e.fighter.state='down'; e.die(); g.reportDown(e,'killed'); })()`);
  await call('teleport', -51, -34, -2.3); await call('look', -2.1, 0.05); await step(20); await adv();
  await v("document.getElementById('choice-front').click()"); await step(5);
  await v("document.body.classList.add('hide-hud')");
  // 見1に立って里を見てから、道へ下りて走る
  await call('camera', null); await call('teleport', -46.4, -31.0, yawTo(46.4, 35)); await call('look', yawTo(46.4, 35), 0.1); await step(30);
  const frames = [];
  let wp = 0, n = 0;
  await key('ShiftLeft', true); await key('KeyW', true);
  try {
    for (let f = 0; f < LIMIT && wp < ROUTE.length; f += 3) {
      const s = await st(), h = s.hero, [tx, tz] = ROUTE[wp];
      if (Math.hypot(tx - h.x, tz - h.z) < 1.6) { wp++; continue; }
      await call('look', yawTo(tx - h.x, tz - h.z), 0.1);
      await step(3);
      if (f % EVERY === 0) { const name = 'walk-' + String(n++).padStart(2, '0'); await shot(name); frames.push({ name, x: +h.x.toFixed(2), z: +h.z.toFixed(2), beat: s.beat }); }
    }
  } finally { await key('KeyW', false); await key('ShiftLeft', false); }
  await fs.writeFile(path.join(ctx.out, 'walk.json'), JSON.stringify({ every: EVERY, route: ROUTE, frames }, null, 2) + '\n');
  ctx.log(`walk frames: ${frames.length}, reached waypoint ${wp}/${ROUTE.length}`);
}
