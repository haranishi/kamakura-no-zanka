// 回帰：やり直しを繰り返しても、GPU資源（形・画像）が増えない。
// 以前は人物ごとの骨の行列の画像・武器の形と材質を解放しておらず、やり直しのたびに画像が約11枚ずつ増えた。
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-retry-leak.mjs --strict
export default async function ({ st, step, call, v, freeze, start, log }) {
  await start('new'); await freeze(true); await step(30);
  const adv = async () => { for (let i = 0; i < 80; i++) { const q = await st(); if (q.talking) { await call('advanceDialogue', true); await step(10); } else if (q.pending) await step(30); else break; } };
  for (const e of [{ type: 'enter_zone', zone: 'temple_yard' }, { type: 'dialogue_end', id: 'boy_arrives' }, { type: 'arrived', place: 'viewpoint' }]) await call('dispatch', e);
  await adv(); await v("document.getElementById('choice-front').click()"); await step(10); await adv();
  const mem = () => v("(()=>{ const i = __valley.game.renderer.info.memory; return { geometries: i.geometries, textures: i.textures }; })()");
  const counts = [];
  for (let k = 0; k < 4; k++) {
    await call('dispatch', { type: 'enter_zone', zone: 'village_front' }); await adv(); await step(30);
    await v("(()=>{ const g = __valley.game, f = g.hero.fighter; f.hp = 0; f.alive = false; f.state = 'down'; g.onHeroDown(); })()");
    await step(120);
    await v("document.getElementById('death-retry').click()"); await step(120); await adv();
    counts.push(await mem()); log('retry', k + 1, JSON.stringify(counts[k]));
    await v("document.getElementById('choice-front')?.click()"); await step(10);
  }
  const first = counts[0], last = counts[counts.length - 1];
  if (last.textures > first.textures || last.geometries > first.geometries) throw new Error(`GPU resources grew across retries: ${JSON.stringify(first)} → ${JSON.stringify(last)}`);
}
