// 回帰：里を守った瞬間（侍大将が退いて会話が始まる）に、すでに振りかぶっていた兵の一撃や飛んでいる矢が会話中に当たらない。
// 以前は体力が少ないと会話の最中に倒れ、区切り（見晴らし）へ戻されて、守った里の敵が元どおり立っていた。
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-cleared-dialogue.mjs --strict
export default async function ({ st, step, call, v, freeze, start, log }) {
  const adv = async () => { for (let i = 0; i < 80; i++) { const q = await st(); if (q.talking) { await call('advanceDialogue', true); await step(10); } else if (q.pending) await step(30); else break; } };
  const toTitle = () => v("(() => { const g = __valley.game; g.hud.hideResult(); g.hud.showChoice(false); g.pendingDialogue = null; g.flow = 'idle'; })()");
  const enterVillage = async () => {
    await start('new'); await freeze(true); await step(30);
    for (const e of [{ type: 'enter_zone', zone: 'temple_yard' }, { type: 'dialogue_end', id: 'boy_arrives' }, { type: 'arrived', place: 'viewpoint' }]) await call('dispatch', e);
    await adv(); await v("document.getElementById('choice-front').click()"); await step(10); await adv();
    await call('teleport', -30, -3, -1.6); await step(10);
    await call('dispatch', { type: 'enter_zone', zone: 'village_front' }); await adv(); await step(10);
  };
  for (const attackerId of ['village_soldier_1', 'village_archer']) {
    if (attackerId !== 'village_soldier_1') await toTitle();
    await enterVillage();
    const archer = attackerId === 'village_archer', away = archer ? 12 : 2.0;
    // 攻め手と侍大将だけを残し、主人公の体力を10にする
    await v(`(() => { const g = __valley.game, h = g.hero; let k = 0;
      for (const e of g.enemies) if (e.id !== '${attackerId}' && e.id !== 'officer') { e.dormant = true; e.place(80 + k * 3, 80); k++; }
      const o = g.enemies.find(e => e.id === 'officer'); o.dormant = true; o.place(70, 70);
      const a = g.enemies.find(e => e.id === '${attackerId}'); a.dormant = false;
      a.place(h.pos.x - Math.sin(h.yaw) * ${away}, h.pos.z - Math.cos(h.yaw) * ${away}, h.yaw + Math.PI); h.fighter.hp = 10; })()`);
    // 攻め手が技を出す（兵は振りかぶり／弓兵は矢が飛ぶ）まで、主人公は何もしない
    let ready = false;
    for (let i = 0; i < 900 && !ready; i++) {
      await step(1);
      ready = await v(`(() => { const g = __valley.game, a = g.enemies.find(e => e.id === '${attackerId}');
        return ${archer} ? g.battle.arrows.some(x => !x.ally && !x.stuck) : !!(a.fighter.move && a.fighter.move.phase === 'windup'); })()`);
    }
    if (!ready) throw new Error(`${attackerId} never attacked`);
    // その瞬間に侍大将が退いた＝里を守った。会話の最中を2秒（人が台詞を読む間）見守る
    await v("(() => { const g = __valley.game; g.reportDown(g.enemies.find(e => e.id === 'officer'), 'routed'); })()");
    await step(2);
    let q = await st();
    if (q.beat !== 'b5_archer' || !q.talking) throw new Error(`${attackerId}: the village was not cleared into a dialogue (beat ${q.beat}, talking ${q.talking})`);
    let died = false;
    for (let i = 0; i < 120 && !died; i++) { q = await step(1); if (!q.hero.alive) died = true; }
    log(attackerId, 'hero alive', q.hero.alive, 'hp', q.hero.hp, 'flow', q.flow, 'beat', q.beat);
    if (died || q.hero.hp < 10) throw new Error(`${attackerId}: the hero was hurt during the village-cleared dialogue (hp ${q.hero.hp}, alive ${q.hero.alive})`);
    await adv(); q = await st();
    if (q.hero.hp <= 10) throw new Error(`${attackerId}: no heal after the dialogue (hp ${q.hero.hp})`);
  }
}
