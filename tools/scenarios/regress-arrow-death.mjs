// 回帰：弓兵の矢で主人公が倒れたとき、描画の繰り返しが止まらず、倒れた画面が出る（以前は battle.removeArrow で落ちて固まった）。
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-arrow-death.mjs --strict
export default async function ({ st, step, call, v, freeze, start, wait, log }) {
  await start('new'); await freeze(true); await step(30);
  const adv = async () => { for (let i = 0; i < 60; i++) { const s = await st(); if (s.talking) { await call('advanceDialogue', true); await step(10); } else if (s.pending) await step(30); else break; } };
  for (const e of [{ type: 'enter_zone', zone: 'temple_yard' }, { type: 'dialogue_end', id: 'boy_arrives' }, { type: 'arrived', place: 'viewpoint' }]) await call('dispatch', e);
  await adv(); await v("document.getElementById('choice-front').click()"); await step(10); await adv();
  await call('teleport', -30, -3, -1.6); await step(10);
  // 弓兵だけを動かし、主人公の体力を10にして、弓兵に背を向ける。あとは実時間の描画の繰り返しに任せる
  await v(`(() => { const g = __valley.game; for (const e of g.enemies) if (e.kind !== 'archer') e.dormant = true; const a = g.enemies.find(e => e.kind === 'archer'); a.place(-18, -2, 1.6); g.hero.fighter.hp = 10; g.hero.yaw = -1.6; })()`);
  await step(2); await freeze(false);
  let death = false, t0 = -1, t1 = -1;
  for (let i = 0; i < 24 && !death; i++) {
    await wait(500);
    const r = await v(`(() => { const g = __valley.game; return { t: g.time, alive: g.hero.fighter.alive, death: !document.getElementById('death').classList.contains('hidden') }; })()`);
    if (!r.alive && t0 < 0) t0 = r.t;
    death = r.death; t1 = r.t;
  }
  await wait(1500);
  const after = await v(`(() => { const g = __valley.game; return { t: g.time, death: !document.getElementById('death').classList.contains('hidden'), flow: g.flow }; })()`);
  log('hero died at game time', t0, '→ later', after.t, 'flow', after.flow, 'death screen', after.death);
  if (t0 < 0) throw new Error('hero never died (scenario setup failed)');
  if (!(after.t > t0 + 0.5)) throw new Error('game time stopped advancing after the arrow kill (loop died)');
  if (!after.death) throw new Error('death screen was not shown');
}
