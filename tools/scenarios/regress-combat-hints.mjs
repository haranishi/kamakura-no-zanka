// 回帰（8.3b）：弾いた瞬間に「E で、とどめを刺せる」の案内を出さない（右下の「弾いた。いま反撃」と同時に出て迷わせた）。
// とどめの案内は、崩れた敵の前で「とどめを刺す」の表示が出たときに出る。案内は鍵ごとに一度だけ（hud.js）。
//   PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-combat-hints.mjs --seed 1333 --strict --out <フォルダ>
// 場面：capture-combat-impact.mjs の D（斥候の袈裟斬りを弾く）と同じ置き方・同じ入力。敵の技は論理の状態を予備の始めにして結線を呼ぶ（検査だけの近道）。
export default async function ({ st, step, call, v, freeze, start, log }) {
  await start('new'); await freeze(true); await step(40); await call('god', true);
  const adv = async () => { for (let i = 0; i < 60; i++) { const s = await st(); if (s.talking) { await call('advanceDialogue', true); await step(10); } else if (s.pending) await step(30); else break; } };
  for (const e of [{ type: 'enter_zone', zone: 'temple_yard' }, { type: 'dialogue_end', id: 'boy_arrives' }]) await call('dispatch', e);
  await adv(); await step(20);
  await v(`(async () => {
    const g = __valley.game, { MOVES } = await import('/valley/combat.js');
    g.makeEnemies('village_enemies', { alert: 'unaware', dormant: true });
    for (const e of g.enemies) { e.dormant = true; e.place(e.pos.x + 40, e.pos.z + 40, 0); }
    const h = g.hero; h.place(-30, -6, -Math.PI / 2); h.fighter.yaw = h.yaw; g.rig.yaw = h.yaw; g.rig.snap(); h.drawSword({ fast: true });
    for (const e of g.enemies) if (e.id !== 'road_scout') { e.dormant = true; e.place(-80, -80, 0); }
    const e = g.enemies.find(e => e.id === 'road_scout'), f = e.fighter;
    e.place(h.pos.x + 2.2, h.pos.z, Math.PI / 2); e.dormant = false; e.brain.state = 'combat'; e.brain.awareness = 1; f.aware = true;
    e.apply = function (intent, dt) { return Object.getPrototypeOf(this).apply.call(this, { ...intent, startMove: null, move: null }, dt); };
    g.hud.hintsShown.clear(); g.hud.hideHint();
    window.__ch = {
      force() { f.move = { id: 'soldier_slash', t: 0, phase: 'windup', struck: [], targetId: null }; f.state = 'attack'; f.telegraphing = MOVES.soldier_slash.telegraph > 0;
        f.pendingEvents.push({ type: 'phase', id: f.id, moveId: 'soldier_slash', phase: 'windup' }); e.beginMove('soldier_slash'); e.chainRoll = 9; return true; },
      block(on) { const i = g.input; if (on) { i.mousePressed.add(2); i.mouse.add(2); } else i.mouse.delete(2); return true; },
      stagger() { e.place(h.pos.x + 1.6, h.pos.z, Math.PI / 2); f.state = 'stagger'; f.staggerT = 2.2; f.posture = 0; e.onCombatEvent({ type: 'stagger_start' }); return true; },
      read() { const el = g.hud.el; return { parries: g.stats.parries, hint: el.hint.classList.contains('hidden') ? '' : el.hint.textContent,
        prompt: el.prompt.classList.contains('hidden') ? '' : el['prompt-text'].textContent, finisherShown: g.hud.hintsShown.has('finisher'), foe: f.state }; },
    };
    return true;
  })()`);
  await step(30);
  // D と同じ：0コマで袈裟斬りを始め、26コマで受け（弾きの窓に入る）、そのあと48コマ見る
  await v('__ch.force()');
  const after = [];
  for (let i = 1; i <= 74; i++) {
    if (i === 26) await v('__ch.block(true)');
    await step(1);
    const r = await v('__ch.read()');
    if (r.parries > 0) after.push(r);
  }
  await v('__ch.block(false)');
  const counterShown = after.some(r => r.prompt.includes('反撃'));
  const finisherAtParry = after.filter(r => r.hint.includes('とどめ') || r.finisherShown).length;
  // 崩れた敵の前：とどめの表示と案内が出る
  await v('__ch.stagger()');
  let atStagger = null;
  for (let i = 0; i < 30; i++) { await step(1); const r = await v('__ch.read()'); if (r.prompt === 'とどめを刺す') { atStagger = r; break; } }
  const checks = {
    parried: after.length > 0,
    counterPromptShown: counterShown,
    noFinisherHintAfterParry: finisherAtParry === 0,
    finisherPromptAtStagger: !!atStagger,
    finisherHintAtStagger: !!atStagger && atStagger.hint.includes('とどめ') && atStagger.finisherShown,
  };
  log('frames after parry ' + after.length + ', finisher hint frames ' + finisherAtParry + ', stagger ' + JSON.stringify(atStagger));
  log(JSON.stringify(checks));
  const ok = Object.values(checks).every(Boolean);
  log(ok ? 'regress-combat-hints: all checks passed' : 'regress-combat-hints: FAILED');
  if (!ok) throw new Error('regress-combat-hints failed: ' + JSON.stringify(checks));
  return checks;
}
