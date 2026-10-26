// 回帰：「つづきから」が、その段の入口を作り直す。
//  ・見晴らしの区切りからは、道を選ぶ場面が出る（出ないと plan が空のまま、方角の針が正面を指す）。
//  ・クリア後（保存は結果の区切り）は、焚き火の前で結果の会話が出て、結果画面へ進む（出ないと何も起きず進めない）。
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-continue.mjs --strict
export default async function ({ st, step, call, v, freeze, start, log }) {
  const adv = async () => { for (let i = 0; i < 80; i++) { const q = await st(); if (q.talking) { await call('advanceDialogue', true); await step(10); } else if (q.pending) await step(30); else break; } };
  const toTitle = () => v("(() => { const g = __valley.game; g.hud.hideResult(); g.hud.showChoice(false); g.pendingDialogue = null; g.flow = 'idle'; })()");
  const ev = async (type, f = {}) => { await call('dispatch', { type, ...f }); await step(2); };
  const shown = id => v(`(() => { const e = document.getElementById('${id}'); return !!e && !e.classList.contains('hidden'); })()`);
  const until = async (pred, max, what) => { for (let i = 0; i < max; i++) { await step(5); if (await pred()) return; } throw new Error('timed out waiting for ' + what); };

  await start('new'); await freeze(true); await step(30);
  // --- 見晴らしの区切り
  await ev('enter_zone', { zone: 'temple_yard' }); await adv();
  await ev('dialogue_end', { id: 'boy_arrives' });
  await ev('arrived', { place: 'viewpoint' }); await adv();
  await toTitle(); await start('continue'); await step(5);
  let q = await st();
  if (q.beat !== 'b3_viewpoint' || q.flow !== 'play') throw new Error(`continue at the viewpoint: beat ${q.beat}, flow ${q.flow}`);
  await until(async () => (await st()).flow === 'choice', 60, 'the route choice after continuing from the viewpoint');
  if (!(await shown('choice'))) throw new Error('the route choice panel is not shown');
  log('viewpoint continue: the route choice is shown');

  // --- クリア後の区切り
  await toTitle(); await start('new'); await step(10);
  await ev('enter_zone', { zone: 'temple_yard' }); await adv();
  await ev('dialogue_end', { id: 'boy_arrives' });
  await ev('arrived', { place: 'viewpoint' }); await adv();
  await ev('choose_plan', { plan: 'front' }); await ev('enter_zone', { zone: 'village_front' });
  await ev('enemy_down', { id: 'officer', how: 'routed' }); await adv();
  await ev('interact', { id: 'archer_captive' }); await adv();
  await ev('party_joined', { id: 'archer' });
  await ev('enter_zone', { zone: 'ambush_trigger' });
  for (const id of ['ambush_soldier_1', 'ambush_soldier_2', 'ambush_archer']) await ev('enemy_down', { id, how: 'killed' });
  await adv(); await ev('arrived', { place: 'temple_steps' });
  q = await st();
  if (q.beat !== 'b7_result' || q.checkpoint !== 'cp_result') throw new Error(`did not reach the result checkpoint: ${q.beat} ${q.checkpoint}`);
  await toTitle(); await start('continue'); await step(5);     // 結果の会話は進めずに終えた体で、つづきから
  q = await st();
  if (q.beat !== 'b7_result') throw new Error(`continue after the clear: beat ${q.beat}`);
  await until(async () => (await st()).talking, 120, 'the result dialogue after continuing from the cleared game');
  await adv();
  await until(async () => shown('result'), 60, 'the result screen');
  const lines = await v("document.querySelectorAll('#result-lines li').length");
  if (lines < 4) throw new Error(`the result screen has ${lines} lines`);
  log('cleared-game continue: the result dialogue and the result screen appear (' + lines + ' lines)');
}
