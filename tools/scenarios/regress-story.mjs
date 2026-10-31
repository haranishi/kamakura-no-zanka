// 回帰：物語の本体（S5・S6）を実ゲームの主人公で通す。
//  F1（袖印を E で調べる）・穂太を見る間・C1（物見の書き付け）・F2（遠くを見る）・C3（侍大将の一言）・やり直しで断片が二重にならない・
//  久作の第一声（F3）・F4・掛け合い（戦闘中は出ない／同じ台詞を繰り返さない）・F5 と無言の間・保存の断片・結末（断片0・3・5個）・焚き火の輪。
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-story.mjs --strict --out reports/polish3/story
export default async function ({ st, step, call, v, freeze, start, tap, shot, log }) {
  const fail = m => { throw new Error(m); };
  const G = '__valley.game';
  const dlg = () => v(`(() => { const d = ${G}.hud.dialogue; return d && { id: d.id, i: d.i, texts: d.lines.map(l => l.text) }; })()`);
  const prompt = () => v("(() => { const p = document.getElementById('prompt'); return p.classList.contains('hidden') ? '' : document.getElementById('prompt-text').textContent; })()");
  const sub = () => v(`(() => ({ kind: ${G}.hud.subtitleKind(), text: document.getElementById('subtitle').textContent }))()`);
  const frags = () => v(`${G}.quest.flags.fragments.join(',')`);
  const ev = async (type, f = {}) => { await call('dispatch', { type, ...f }); await step(2); };
  const until = async (pred, max, what, n = 5) => { for (let i = 0; i < max; i++) { if (await pred()) return; await step(n); } fail('timed out waiting for ' + what); };
  // 会話を全部進め、出た会話の id と行を記録する
  const adv = async (seen = []) => {
    for (let i = 0; i < 160; i++) {
      const q = await st();
      if (q.talking) { const d = await dlg(); if (!seen.length || seen.at(-1).id !== d.id) seen.push(d); await call('advanceDialogue', true); await step(6); }
      else if (q.pending) await step(20); else break;
    }
    return seen;
  };
  const toTitle = () => v(`(() => { const g = ${G}; g.hud.hideResult(); g.hud.showChoice(false); g.pendingDialogue = null; g.hud.dialogue = null; document.getElementById('dialogue').classList.add('hidden'); document.body.classList.remove('talking'); g.flow = 'idle'; })()`);
  const kill = id => v(`(() => { const g = ${G}, e = g.enemies.find(e => e.id === '${id}'); e.fighter.hp = 0; e.fighter.alive = false; e.die(); g.reportDown(e, 'killed'); })()`);

  await start('new'); await freeze(true); await step(30); await call('god', true);

  // ---- F1：袖印。開始位置では案内が出ず、近づくと出る。E で会話の枠、拾うと消える
  if (await prompt()) fail('a prompt is shown at the start: ' + await prompt());
  await call('teleport', -90.6, -82.0, Math.atan2(-1.3, -1.0)); await call('look', Math.atan2(-1.3, -1.0) - 0.35, 0.3); await step(6);
  if (await prompt() !== '袖印を調べる') fail('no sleeve-badge prompt near it: ' + await prompt());
  await shot('story-01-sode-prompt');
  await tap('KeyE'); await step(2);
  let d = await dlg();
  if (d?.id !== 'relic_sode' || d.texts[0] !== '……あの門を。') fail('E did not open the sleeve-badge line: ' + JSON.stringify(d));
  await step(45); await shot('story-02-sode-look');
  await adv();
  if (await frags() !== 'F1') fail('F1 not recorded: ' + await frags());
  await step(20);
  if (await prompt()) fail('the prompt stays after taking the badge');
  if (await v(`${G}.relicView.items.size`) !== 0) fail('the badge is still lying on the ground');
  log('F1: prompt, line, record and removal OK');

  // ---- 穂太を見る間：最初の台詞のあと、無言の間で主人公が子へ向き、寄る。E を押さずに次へ進む
  await ev('enter_zone', { zone: 'temple_yard' });
  await until(async () => (await st()).talking, 160, 'the boy dialogue', 5);
  d = await dlg(); if (d.id !== 'boy_arrives' || d.texts[1] !== '……') fail('the gaze beat is missing: ' + JSON.stringify(d));
  await tap('KeyE'); await step(1);
  if ((await dlg()).i !== 1 || !(await v(`!!${G}.gaze`))) fail('the gaze did not start on the silent line');
  await step(36); await shot('story-03-boy-gaze');
  await step(30);
  d = await dlg(); if (d.i !== 2 || await v(`!!${G}.gaze`)) fail('the 0.8 s silence did not move on by itself: ' + JSON.stringify(d));
  await adv();
  log('gaze at the boy: silent line, turn and push-in, moves on by itself');

  // ---- C1：物見が倒れた所に書き付けが落ち、E で読める（一度きり）
  if ((await st()).beat !== 'b2_road') fail('not on the road');
  const sc = (await st()).enemies.find(e => e.id === 'road_scout');
  await kill('road_scout'); await step(4);
  await call('teleport', sc.x - 0.9, sc.z - 0.6, 0); await step(4);
  if (await prompt() !== '書き付けを拾う') fail('no note prompt where the scout fell: ' + await prompt());
  await tap('KeyE'); await step(2);
  d = await dlg(); if (d?.texts[0] !== '兵糧の書き付け。腹を空かせた兵か。') fail('the note line: ' + JSON.stringify(d));
  await adv(); await step(10);
  if (await prompt()) fail('the note can be read twice');
  log('C1: the scout drops the note and it reads once');

  // ---- F2：見晴らし岩で「遠くを見る」。区切りのあとで拾ったので、やり直すと拾い直せ、二重にならない
  await ev('arrived', { place: 'viewpoint' }); await adv();
  await until(async () => (await st()).flow === 'choice', 60, 'the route choice');
  await v("document.getElementById('choice-front').click()"); await step(6);
  const far = { x: -46.4, z: -31.0 };
  await call('teleport', far.x + 0.8, far.z - 0.9, 2.3); await step(30);
  if (await prompt() !== '遠くを見る') fail('no far-view prompt at the viewpoint: ' + await prompt());
  await tap('KeyE'); await step(2);
  d = await dlg(); if (d?.id !== 'relic_far_look') fail('E did not open the far view');
  await step(55); await shot('story-04-far-look');
  await adv();
  if (await frags() !== 'F1,F2') fail('F2 not recorded: ' + await frags());
  // 里へ入る → 侍大将の一言（C3）が字幕に出る
  await call('teleport', -30, -3, -1.6); await ev('enter_zone', { zone: 'village_front' }); await step(4);
  let s = await sub();
  if (s.kind !== 'clue' || !s.text.includes('新しき世の命だ。蔵を空けよ。恨むなら、恨め。')) fail('C3 did not show when the officer entered the fight: ' + JSON.stringify(s));
  await shot('story-05-officer-c3');
  await v(`${G}.toCheckpoint()`); await step(60);
  if ((await st()).beat !== 'b3_viewpoint' || await frags() !== 'F1') fail('retry did not rewind F2: ' + (await st()).beat + ' ' + await frags());
  await until(async () => (await st()).flow === 'choice', 80, 'the route choice after retry');
  await v("document.getElementById('choice-front').click()"); await step(6);
  await call('teleport', far.x + 0.8, far.z - 0.9, 2.3); await step(10);
  await tap('KeyE'); await step(2); await adv();
  await tap('KeyE'); await step(2); await adv();                   // もう一度押しても数えない
  if (await frags() !== 'F1,F2') fail('F2 counted twice or lost: ' + await frags());
  log('F2: far view, retry rewinds and re-picks once; C3 shows at the start of the village fight');

  // ---- 久作の第一声（正面・食糧35以上）と F3、弥十郎の「先に逃げた」のあとの F4
  await call('teleport', -30, -3, -1.6); await ev('enter_zone', { zone: 'village_front' }); await step(4);
  if ((await sub()).kind === 'clue') fail('C3 repeated after the retry');
  await v(`(() => { const g = ${G}, o = g.enemies.find(e => e.id === 'officer'); g.reportDown(o, 'routed'); })()`);
  await until(async () => (await st()).talking, 120, 'the village-cleared dialogue');
  d = await dlg();
  if (!d.texts[0].startsWith('あんたの戦で') || d.texts[1] !== '逃げてきた武士は、あんたで三人目だ。皆、同じ顔をする。') fail('Kyusaku lines: ' + JSON.stringify(d.texts));
  await step(20); await shot('story-06-kyusaku-first');
  await adv();
  await ev('interact', { id: 'archer_captive' });
  await until(async () => (await st()).talking, 60, 'the archer dialogue');
  d = await dlg(); if (d.texts[3] !== '……私もだ。') fail('F4 is not after "先に逃げた": ' + JSON.stringify(d.texts));
  await adv();
  await until(async () => (await st()).beat === 'b6_escort', 120, 'the escort beat');
  if (await frags() !== 'F1,F2,F3,F4') fail('F3/F4 not recorded: ' + await frags());
  const savedFr = await v("JSON.parse(localStorage.getItem('kamakura-valley-progress')).flags.fragments.join(',')");
  if (savedFr !== 'F1,F2,F3,F4') fail('the checkpoint save lacks the fragments: ' + savedFr);
  log('Kyusaku first line and F3, F4 after "先に逃げた", saved at the checkpoint');

  // ---- 掛け合い：弥十郎との道中。データの順に、同じ台詞を繰り返さず、出る
  await call('teleport', -14, 3, 1.2); await step(4);
  const heard = []; let banterShot = false;
  for (let i = 0; i < 90; i++) {
    await call('step', 10, 0.05);
    s = await sub();
    if (s.kind === 'banter' && heard.at(-1) !== s.text) { heard.push(s.text); if (!banterShot) { await shot('story-07-banter'); banterShot = true; } }
  }
  log('banter heard on the way back:', JSON.stringify(heard));
  if (!heard.length || !heard[0].includes('この脚では足手まといだ')) fail('the first escort exchange did not play first: ' + JSON.stringify(heard));
  if (heard.some(t => t.startsWith('久作'))) fail('a village line played after the rescue');
  if (new Set(heard).size !== heard.length) fail('a banter line repeated');
  // 待ち伏せ：戦闘中は掛け合いを出さない
  await ev('enter_zone', { zone: 'ambush_trigger' });
  for (let i = 0; i < 60; i++) {
    await step(5);
    const r = await v(`({ kind: ${G}.hud.subtitleKind(), fight: ${G}.alertedEnemies() })`);
    if (r.kind === 'banter' && r.fight > 0) fail('banter shown during the fight');
  }
  for (const id of ['ambush_soldier_1', 'ambush_soldier_2', 'ambush_archer']) await kill(id);
  await until(async () => (await st()).talking, 60, 'the ambush-cleared dialogue');
  d = await dlg();
  if (d.texts.at(-2) !== '……あの夜、門に貴殿の姿がなかった。' || d.texts.at(-1) !== '……') fail('F5 and the silence: ' + JSON.stringify(d.texts));
  for (let i = 0; i < d.texts.length - 1; i++) { await tap('KeyE'); await step(2); }
  await step(100);                                                  // 1.5秒の無言は E を押さずに終わる
  if ((await st()).talking) fail('the 1.5 s silence did not end by itself');
  log('banter: in order, no repeats, none in the fight; F5 with the unanswered silence');

  // ---- 結末（断片5つ）：三つの会話・袖印をくべる・穂太を見る間・語り
  await call('teleport', -74, -66, 2.4); await ev('arrived', { place: 'temple_steps' });
  if ((await st()).beat !== 'b7_result') fail('did not reach the result');
  const seen5 = [];
  for (let i = 0; i < 200; i++) {
    const q = await st();
    if (q.talking) {
      const dd = await dlg(); if (!seen5.length || seen5.at(-1).id !== dd.id) seen5.push(dd);
      if (dd.id === 'ending_truth' && !seen5.shot1) { await step(20); await shot('story-08-ending-truth'); seen5.shot1 = true; }
      if (dd.id === 'ending_coda' && dd.texts[dd.i] === 'もう、いい。' && !seen5.shot2) { await step(14); await shot('story-09-sode-burn'); seen5.shot2 = true; if (!(await v(`${G}.flareT > 0`))) fail('no flare when the badge goes in'); }
      if (dd.id === 'ending_coda' && dd.texts[dd.i] === '……' && !seen5.shot3) { await step(40); await shot('story-10-ending-gaze'); seen5.shot3 = true; }
      if (dd.id === 'ending_coda' && dd.texts[dd.i].startsWith('燃え残った火') && !seen5.shot4) { await step(10); await shot('story-11-narration'); seen5.shot4 = true; }
      await tap('KeyE'); await step(3);
    } else if (q.pending) await step(10); else if (await v("!document.getElementById('result').classList.contains('hidden')")) break; else await step(10);
  }
  const ids = seen5.map(x => x.id).join('>');
  if (ids !== 'result>ending_truth>ending_coda') fail('ending order: ' + ids);
  if (!seen5[0].texts.includes('あの兵たちも、腹を空かせていた。')) fail('the enemy clue is missing from the result');
  if (seen5[1].texts.length !== 5 || !seen5[2].texts.includes('もう、いい。') || !seen5[2].texts.includes('燃え残った火は、谷で、人の灯になった。')) fail('ending with 5: ' + JSON.stringify(seen5.slice(1)));
  if (!(await v(`${G}.npcs.has('boy')`))) fail('the boy is not at the fire');
  log('ending with five fragments: three talks, the badge burns, the gaze, the narration');

  // ---- 結末の段（0・3個）と焚き火の輪：区切りの保存を書き換えて、つづきから（旧い保存＝断片なし、も同じ道）
  for (const [list, truthLines, burn, trust] of [[[], 3, false, 40], [['F3', 'F4', 'F5'], 5, false, 60]]) {
    await v(`(() => { const s = JSON.parse(localStorage.getItem('kamakura-valley-progress')); s.flags.fragments = ${JSON.stringify(list)}; s.trust = ${trust}; localStorage.setItem('kamakura-valley-progress', JSON.stringify(s)); })()`);
    await toTitle(); await start('continue'); await step(5);
    if (await frags() !== list.join(',')) fail('restored fragments: ' + await frags());
    const ring = await v(`(() => { const g = ${G}, f = g.world.props.find(p => p.id === 'bonfire'), n = g.npcs.get('r_man'); return { d: Math.hypot(n.pos.x - f.x, n.pos.z - f.z), mode: n.mode }; })()`);
    if (trust >= 58 ? !(ring.d < 3.6 && ring.mode === 'cower') : !(ring.d > 7)) fail(`fire ring for trust ${trust}: ${JSON.stringify(ring)}`);
    const seen = await adv();
    await until(() => v("!document.getElementById('result').classList.contains('hidden')"), 60, 'the result screen');   // 結果画面まで待つ（次のつづきからへ、前の遊びの時計を持ち込まない）
    const truth = seen.find(x => x.id === 'ending_truth'), coda = seen.find(x => x.id === 'ending_coda');
    if (truth?.texts.length !== truthLines || coda.texts.includes('もう、いい。') !== burn) fail(`ending with ${list.length}: ${JSON.stringify([truth, coda])}`);
    log(`ending with ${list.length}: truth ${truth.texts.length} lines, burn ${burn}; ring ${ring.d.toFixed(1)} m (${ring.mode})`);
  }

  // ---- 里の荒れ（見た目だけ）：蓄えが少ない保存で帰り道の区切りからつづけ、荷車のあたりの煙を撮る
  await v(`(() => { const s = JSON.parse(localStorage.getItem('kamakura-valley-progress')); Object.assign(s, { beat: 'b6_escort', checkpoint: 'cp_archer_joined' }); s.flags.ambush = null; s.resources.food = 20; localStorage.setItem('kamakura-valley-progress', JSON.stringify(s)); })()`);
  await toTitle(); await start('continue'); await step(5);
  if ((await st()).beat !== 'b6_escort') fail('could not continue on the road back');
  await call('teleport', -12, 2, Math.atan2(15.5, -4.5)); await call('look', Math.atan2(15.5, -4.5), 0.12); await step(240, 1 / 30);
  await shot('story-12-raided-smoke');
  log('raided village: smoke by the cart captured');
}
