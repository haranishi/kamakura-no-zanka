// capture-setと同じ物語順を、描画・撮影待ちに依存せず通す読み込み測定用経路。
export default async function ({ call, step, st, start, freeze, v }) {
  await start('new'); await freeze(true); await call('god', true);
  const stages = [];
  const adv = async () => {
    // 未測定の検査設計：会話の遅延・仲間加入を待つ上限（capture-setの待ち方を継承）。
    for (let i = 0; i < 120; i++) {
      const s = await st();
      if (s.talking) await call('advanceDialogue', true);
      else if (!s.pending) return;
      await step(30);
    }
    throw Error('dialogue did not settle');
  };
  const expect = async beat => { const s = await st(); if (s.beat !== beat) throw Error(`expected ${beat}, got ${s.beat}`); stages.push(beat); };
  await expect('b0_temple');
  // 座標と待機コマ数はcapture-setの既存設計値（未測定）を継承。
  await call('teleport', -86, -75, -2.2); await call('dispatch', { type: 'enter_zone', zone: 'temple_yard' });
  await expect('b1_boy'); await step(40); await adv(); await expect('b2_road');
  await call('teleport', -48, -46, 0); await step(25);
  await call('teleport', -51, -34, -2.3); await call('dispatch', { type: 'arrived', place: 'viewpoint' });
  await step(20); await adv(); await expect('b3_viewpoint');
  await v("document.getElementById('choice-front').click()");
  await call('teleport', -33, -3, -1.6); await call('dispatch', { type: 'enter_zone', zone: 'village_front' });
  await step(40); await expect('b4_village');
  // QAイベントで戦闘の完了を送る。測定は任務の腕前には依存させない。
  await v(`(()=>{ const g=__valley.game; for(const e of g.enemies) if(e.group==='village_enemies' && e.fighter.alive) {
    e.fighter.hp=0; e.fighter.alive=false; e.fighter.state='down'; e.die(); g.reportDown(e,'killed');
  } })()`);
  await step(30); await adv(); await expect('b5_archer');
  await call('teleport', -8.6, 7.4, 0); await call('dispatch', { type: 'interact', id: 'archer_captive' });
  await step(20); await adv(); await step(200); await expect('b6_escort');
  await call('teleport', -50, -18, 0.93); await call('dispatch', { type: 'enter_zone', zone: 'ambush_trigger' }); await step(70);
  await v(`(()=>{ const g=__valley.game; for(const e of g.enemies) if(e.fighter.alive) {
    e.fighter.hp=0; e.fighter.alive=false; e.fighter.state='down'; e.die(); g.reportDown(e,'killed');
  } })()`);
  await step(30); await adv();
  await call('teleport', -73, -65, 2.4); await call('dispatch', { type: 'arrived', place: 'temple_steps' });
  await expect('b7_result'); await step(80); await adv(); await step(120); await expect('done');
  return stages;
}
