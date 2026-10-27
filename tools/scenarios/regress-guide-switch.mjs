// 回帰：「脇道から」を選んだ人が南の畦道へ向かうと、3秒後に案内の道が north → south に切り替わる（逆も）。
// 切替が無いと、正しい畦道を歩いているのに「道外れ」の強調が出続ける。早すぎると、通りがかりで道が入れ替わる。
// 合格線: 3秒の手前では切り替わらず、3〜4秒のあいだに切り替わる。切り替わったあとは道外れ・強調が消える。
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-guide-switch.mjs --strict
export default async function ({ v, freeze, start, step, call, log, st }) {
  const clear = async () => { for (let i = 0; i < 12; i++) { const s = await st(); if (!s.talking && !s.pending) break; await call('advanceDialogue'); await step(6); } };
  await start('new'); await freeze(true); await step(30); await call('god', true);
  await call('dispatch', { type: 'enter_zone', zone: 'temple_yard' });
  for (let i = 0; i < 6; i++) { await step(20); await call('advanceDialogue'); }
  await call('dispatch', { type: 'dialogue_end', id: 'boy_arrives' }).catch(() => {});
  await call('teleport', -47, -30, -2.3); await step(10);
  await call('dispatch', { type: 'arrived', place: 'viewpoint' });
  for (let i = 0; i < 8; i++) { await step(20); await call('advanceDialogue'); }
  await step(70); await clear();
  if (!await v(`!document.getElementById('choice').classList.contains('hidden')`)) throw new Error('the route choice did not appear at the viewpoint');
  await v(`document.getElementById('choice-flank').click()`); await step(10);
  let g = await call('guideView');
  if (g.plan !== 'north') throw new Error(`flank should start on the north road, got ${g.plan}`);
  const expectSwitch = async (label, x, z, to) => {
    await call('teleport', x, z, 0); let switchedAt = null;
    for (let i = 1; i <= 12; i++) {
      await step(30); g = await call('guideView');
      if (g.plan === to && switchedAt === null) switchedAt = i * 0.5;
    }
    log(`${label}: ${to} へ切替 ${switchedAt}s  (切替後 道外れ${g.offRoad} 強調${g.emphasized})`);
    if (switchedAt === null) throw new Error(`${label}: the plan never switched to ${to}`);
    if (switchedAt < 3 || switchedAt > 4) throw new Error(`${label}: switched at ${switchedAt}s; expected after 3s of staying on the other road (3–4s)`);
    if (g.offRoad || g.emphasized) throw new Error(`${label}: still off-road/emphasized after switching`);
  };
  await expectSwitch('南の畦道に立つ', -40, 44, 'south');
  await expectSwitch('北の斜面道に立つ', -14, -38, 'north');
}
