// 回帰：帰還の区切り＝章末の演出 chapter1_end（C1・R25.3/R26/R27/R28/R29）。結末の流れ result → ending_truth →（演出・自動）→ ending_coda（手送り）→ 結果画面。
//  断片0・3・4・5個（信頼・米も変える）の各版を、区切りの保存（cp_result）からのつづきで通す。各版で：
//  ・完走：自動の部分が10秒以内（準備〜復帰のコマ数）。演出の間、世界（時刻・乱数の呼出数・任務・断片・人物の論理・タイマー）が開始時と同じ。
//    結果画面へ1回だけ、終わりの処理（保存・結果）も各1回。断片は減らない。5個の版でだけ袖印が手から火へ落ちて燃える。章末の完了を記録する。
//    直後の手送りの会話（ending_coda）は別枠で、行数と待ったコマを残す（決定U8）。
//  ・飛ばし：0.6秒前の押下では飛ばず、0.6秒後の新しい押下で飛び、0.6秒以内に会話へ戻る。押した E は会話の行を送らない。結果へ1回だけ。
//  ・動きを減らす設定（模擬）：同じショットの間カメラも姿勢も動かない（静止版）。字幕OFF・音量0でも必須の文（もう、いい。／最後の語り）が出る。
//  ・再開：演出の途中で閉じた続きは章末を出し直す。完了後（手送りの会話の途中）に閉じた続きは、演出も会話も出さず結果へ直行し、保存と結果は各1回。
// 撮影（--out）：各版の開始・中間・終端、5個の版の「手を離れる・火に触れる・穂太を見る」、動きを減らす版の各ショット。
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-cinematic-end.mjs --strict --out <フォルダ>
const REC = 'kamakura-valley-cinematics', PROG = 'kamakura-valley-progress';
const ALL = ['F1', 'F2', 'F3', 'F4', 'F5'];
const CASES = [
  { n: 0, list: [], trust: 40, food: 20, variant: 'plain' },
  { n: 3, list: ['F3', 'F4', 'F5'], trust: 60, food: 55, variant: 'deep' },
  { n: 4, list: ['F2', 'F3', 'F4', 'F5'], trust: 50, food: 40, variant: 'deep' },
  { n: 5, list: ALL, trust: 60, food: 60, variant: 'full' },
];
// 世界の論理の状態（見た目は含めない）。乱数は呼んだ回数で比べる
const INSTALL = `(() => {
  const g = __valley.game;
  if (!g.rng.qa) { const r = g.rng, f = () => (f.n++, r()); f.n = 0; f.qa = true; g.rng = f; }
  if (!g.__endQA) {
    const q = g.__endQA = { persist: 0, result: 0 }, p = g.persist.bind(g), r = g.showResult.bind(g);
    g.persist = () => { q.persist++; return p(); }; g.showResult = () => { q.result++; return r(); };
  }
  const n = v => Math.round(v * 1e4) / 1e4, A = a => a ? { x: n(a.pos.x), z: n(a.pos.z), yaw: n(a.yaw), mode: a.mode ?? null, role: a.role ?? null } : null;
  window.__endSnap = () => JSON.stringify({ time: g.time, rngN: g.rng.n, timers: g.timers.map(t => t.t), beat: g.quest.beat, cp: g.quest.checkpoint, flags: g.quest.flags,
    res: g.quest.resources, trust: g.quest.trust, hero: { ...A(g.hero), hp: g.hero.fighter.hp, posture: g.hero.fighter.posture, state: g.hero.fighter.state },
    ally: A(g.ally), npcs: [...g.npcs.values()].map(A), enemies: g.enemies.length, arrows: g.battle.arrows.length, ending: g.ending });
  return true; })()`;
const FRAME = `(() => { const c = __valley.cinematic.state(), r = __valley.game.renderer.info.render, d = __valley.game.hud.dialogue;
  return { flow: c.flow, phase: c.active?.phase ?? null, shot: c.active?.shot ?? -1, elapsed: c.active?.elapsed ?? null, skipped: c.active?.skipped ?? null, line: c.frame.line,
    narration: c.frame.narration, hint: c.frame.hint, stage: c.stage, endCount: c.endCount, camera: c.camera, calls: r.calls, tris: r.triangles,
    sode: __valley.game.relicView.items.has('sode_burn'), dialogue: d ? { id: d.id, i: d.i, n: d.lines.length } : null,
    resultShown: !document.getElementById('result').classList.contains('hidden'), record: c.record, plan: c.resumePlan,
    head: (() => { const b = __valley.game.hero.character.bone('Head'); return b ? b.quaternion.toArray().map(x => Math.round(x * 1e5)) : null; })() }; })()`;

export default async function ({ page, v, st, step, start, freeze, call, tap, shot, log }) {
  const fail = m => { throw new Error(m); };
  const report = { cases: [] };
  const frame = () => v(FRAME);
  const counters = () => v('({ ...__valley.game.__endQA })');
  const ev = async (type, f = {}) => { await call('dispatch', { type, ...f }); await step(2); };
  const adv = async () => { for (let i = 0; i < 80; i++) { const q = await st(); if (q.flow === 'cinematic') return; if (q.talking) { await call('advanceDialogue', true); await step(10); } else if (q.pending) await step(30); else break; } };

  // ---- 区切りの保存（cp_result）まで近道で進める（regress-continue と同じ道）
  await start('new'); await freeze(true); await step(30);
  await ev('enter_zone', { zone: 'temple_yard' }); await adv();
  await ev('dialogue_end', { id: 'boy_arrives' }); await ev('arrived', { place: 'viewpoint' }); await adv();
  await ev('choose_plan', { plan: 'front' }); await ev('enter_zone', { zone: 'village_front' });
  await ev('enemy_down', { id: 'officer', how: 'routed' }); await adv();
  await ev('interact', { id: 'archer_captive' }); await adv(); await ev('party_joined', { id: 'archer' });
  await ev('enter_zone', { zone: 'ambush_trigger' });
  for (const id of ['ambush_soldier_1', 'ambush_soldier_2', 'ambush_archer']) await ev('enemy_down', { id, how: 'killed' });
  await adv(); await ev('arrived', { place: 'temple_steps' });
  if ((await st()).checkpoint !== 'cp_result') fail('did not reach the result checkpoint');
  const base = await v(`localStorage.getItem('${PROG}')`);
  const toTitle = () => v("(() => { const g = __valley.game; g.cinema.abort(); g.hud.hideResult(); g.hud.showChoice(false); g.pendingDialogue = null; g.hud.dialogue = null; document.getElementById('dialogue').classList.add('hidden'); document.body.classList.remove('talking'); g.flow = 'idle'; return 0; })()");
  // 保存を書き換えて（断片・信頼・米）、章末の記録を消し、つづきから。結末の会話を進めて演出が始まるまで
  const prepare = async (c, { record = null, reload = false } = {}) => {
    await v(`(() => { const s = JSON.parse(${JSON.stringify(base)}); s.flags.fragments = ${JSON.stringify(c.list)}; s.trust = ${c.trust}; s.resources.food = ${c.food};
      localStorage.setItem('${PROG}', JSON.stringify(s)); ${record === null ? `localStorage.removeItem('${REC}')` : `localStorage.setItem('${REC}', ${JSON.stringify(JSON.stringify(record))})`}; return 0; })()`);
    if (reload) await reopen(); else await toTitle();
    await v(INSTALL); const c0 = await counters();
    await start('continue'); await step(5);
    return c0;
  };
  // ページを閉じて開き直す（保存だけが残る）
  const reopen = async () => { await page.reload(); await page.waitForFunction('window.__valleyReady===true', null, { timeout: 180000 }); await freeze(true); await v(INSTALL); };
  const toCinematic = async () => {
    const ids = [];
    for (let i = 0; i < 400; i++) {
      const q = await st(); if (q.flow === 'cinematic') break;
      if (q.talking) { const id = await v('__valley.game.hud.dialogue.id'); if (ids.at(-1) !== id) ids.push(id); await call('advanceDialogue', true); await step(1); } else await step(1);
    }
    if ((await st()).flow !== 'cinematic') fail('the chapter end did not start after the truth: ' + ids.join('>'));
    await v(`(async () => { const { mulberry32 } = await import('/valley/scatter.js'); Math.random = mulberry32(77); return 0; })()`);   // 炎の粒の見た目だけをそろえる（撮影用。論理の乱数は別）
    await v(INSTALL);
    return ids;
  };
  // 演出を1コマずつ流す。skip：[コマ, ...] で E を押す。snaps：{ コマ: 名前 }
  const runCinematic = async ({ skipAt = [], snaps = {}, tag = '' } = {}) => {
    const s0 = await v('__endSnap()'), lines = new Set(), lead = Math.round(((await frame()).elapsed ?? 0) * 60); let frames = lead, changed = 0, calls = 0, tris = 0, burnFrame = -1, sodeFrames = 0, skippedAt = -1, hintAt = -1;
    for (; frames < 720; frames++) {
      const f = await frame(); if (f.flow !== 'cinematic') break;
      if (f.line) lines.add(f.line); if (f.hint && hintAt < 0) hintAt = frames; if (f.sode) sodeFrames++;
      if (f.stage?.burned && burnFrame < 0) { burnFrame = frames; if (snaps.burn) await shot(snaps.burn); }
      calls = Math.max(calls, f.calls); tris = Math.max(tris, f.tris);
      if (snaps[frames]) await shot(snaps[frames]);
      if (frames % 30 === 0 && await v('__endSnap()') !== s0) changed++;
      if (f.skipped && skippedAt < 0) skippedAt = frames;
      if (skipAt.includes(frames)) await tap('KeyE'); else await step(1);
    }
    const s1 = await v('__endSnap()'), after = await frame();
    if (changed || s1 !== s0) fail(`${tag}: the world changed during the chapter end (${changed} samples) ${s1 !== s0 ? 'and after it' : ''}`);
    return { frames, seconds: +(frames / 60).toFixed(2), lines: [...lines], calls, tris, burnFrame, sodeFrames, skippedAt, hintAt, stage: after.stage, rngCalls: JSON.parse(s0).rngN };
  };
  // 手送りの会話（別枠）：行ごとに1.5秒置いて送り、結果画面まで。返すのは会話が始まるまでのコマ・行数・送るまでのコマ
  const runCoda = async tag => {
    let wait = 0, first = null;
    for (; wait < 120; wait++) { const f = await frame(); if (f.dialogue?.id === 'ending_coda') { first = f.dialogue; break; } if (f.resultShown) break; await step(1); }
    if (!first) fail(`${tag}: the hand-advanced talk did not follow the chapter end`);
    let frames = 0, lines = 0;
    for (; frames < 2000; frames += 90) { const f = await frame(); if (f.resultShown) break; if (f.dialogue?.id === 'ending_coda') { await step(90); await v('__valley.game.hud.advanceDialogue()'); lines++; } else await step(90); }
    for (let i = 0; i < 60 && !(await frame()).resultShown; i++) await step(5);
    return { startFrames: wait, firstIndex: first.i, lines, frames };
  };
  const checkEnd = async (c, c0, tag, extra = {}) => {
    await step(120);                                                 // 二重の処理が遅れて来ないか、少し待ってから数える
    const c1 = await counters(), f = await frame(), q = await st();
    const persist = c1.persist - c0.persist, result = c1.result - c0.result;
    if (!f.resultShown || q.flow !== 'result') fail(`${tag}: not on the result screen (${q.flow})`);
    if (persist !== 1 || result !== 1) fail(`${tag}: end processing ran ${persist} saves / ${result} result screens (want 1/1)`);
    if (q.flags.fragments.join() !== c.list.join() || JSON.parse(await v(`localStorage.getItem('${PROG}')`)).flags.fragments.join() !== c.list.join()) fail(`${tag}: fragments changed`);
    if (f.record?.chapter1EndSeen !== true) fail(`${tag}: the chapter end was not recorded ${JSON.stringify(f.record)}`);
    return { persist, result, ...extra };
  };

  // ---- 各版：完走と飛ばし
  const shotsAt = (c, total) => {
    const s = { 45: `end-n${c.n}-1-start`, [Math.round(total / 2)]: `end-n${c.n}-2-middle`, [total - 40]: `end-n${c.n}-3-end` };
    if (c.n === 5) Object.assign(s, { 132: 'end-n5-a-release', 171: 'end-n5-b-touch', 192: 'end-n5-b2-flare', 348: 'end-n5-c-boy' });   // 離れる＝2.2秒、触れる直前＝2.85秒（触れるのは2.9秒）
    return s;
  };
  const TOTAL = { plain: 504, deep: 540, full: 564 };                 // 準備0.2＋移行0.4＋ショット＋復帰0.4（秒×60）
  for (const c of CASES) {
    const muted = c.n === 4;                                           // 字幕OFF・音量0
    const c0 = await prepare(c);
    if (muted) await v('(__valley.game.hud.subsOn = false, __valley.game.audio.setVolume(0), 0)');
    const ids = await toCinematic();
    if (ids.join('>') !== 'result>ending_truth') fail(`n${c.n}: talks before the chapter end: ${ids.join('>')}`);
    const end = await runCinematic({ snaps: shotsAt(c, TOTAL[c.variant]), tag: `n${c.n}` });
    if (end.stage?.variant !== c.variant) fail(`n${c.n}: variant ${end.stage?.variant}, want ${c.variant}`);
    if (end.frames > 601 || Math.abs(end.frames - TOTAL[c.variant]) > 2) fail(`n${c.n}: the automatic part ran ${end.frames} frames (want ${TOTAL[c.variant]}, at most 600)`);
    if ((c.n === 5) !== end.stage.burned || (c.n === 5) !== (end.sodeFrames > 0) || (c.n === 5 && end.stage.burnSkipped)) fail(`n${c.n}: badge burned ${end.stage.burned}, seen ${end.sodeFrames} frames`);
    if (c.n === 5 && Math.abs(end.burnFrame - 174) > 2) fail(`n5: the badge touched the fire at frame ${end.burnFrame} (want 174 = 2.9 s)`);
    const must = c.n === 5 ? ['もう、いい。', '燃え残った火は、谷で、人の灯になった。'] : ['燃え残った火は、谷で、人の灯になった。'];
    for (const t of must) if (!end.lines.includes(t)) fail(`n${c.n}: the required line "${t}" was not shown${muted ? ' with subtitles off and volume 0' : ''}: ${JSON.stringify(end.lines)}`);
    if (end.hintAt < 34 || end.hintAt > 38) fail(`n${c.n}: the skip hint appeared at frame ${end.hintAt}`);
    if (end.calls > 900 || end.tris > 5e6) fail(`n${c.n}: draw budget ${end.calls} calls / ${end.tris} triangles`);
    const coda = await runCoda(`n${c.n}`);
    if (coda.startFrames > 3 || coda.firstIndex !== 0 || coda.lines !== 3) fail(`n${c.n}: hand-advanced talk ${JSON.stringify(coda)}`);
    const done = await checkEnd(c, c0, `n${c.n}`);
    if (muted) await v('(__valley.game.hud.subsOn = true, __valley.game.audio.setVolume(0.8), 0)');
    // 飛ばし：0.6秒前の押下（20コマ目）では飛ばず、0.6秒後の新しい押下（45コマ目）で飛ぶ
    const s0 = await prepare(c); await toCinematic();
    const sk = await runCinematic({ skipAt: [20, 45], tag: `n${c.n} skip` });
    if (sk.skippedAt !== 46 || sk.frames - sk.skippedAt > 36) fail(`n${c.n}: skip at ${sk.skippedAt}, back after ${sk.frames - sk.skippedAt} frames (want 46 and ≤36)`);
    if ((c.n === 5) !== !!sk.stage.burned) fail(`n${c.n}: skipping changed whether the badge burned (${sk.stage.burned})`);
    const skCoda = await runCoda(`n${c.n} skip`);
    if (skCoda.firstIndex !== 0 || skCoda.lines !== 3) fail(`n${c.n}: the E that skipped advanced the talk ${JSON.stringify(skCoda)}`);
    const skDone = await checkEnd(c, s0, `n${c.n} skip`);
    report.cases.push({ n: c.n, variant: c.variant, trust: c.trust, food: c.food, muted, complete: { ...end, coda, ...done }, skip: { skippedAt: sk.skippedAt, returnFrames: sk.frames - sk.skippedAt, burned: sk.stage.burned, coda: skCoda, ...skDone } });
    log(`n${c.n} ${c.variant}: auto ${end.seconds}s (${end.frames} frames), burned ${end.stage.burned}, lines ${JSON.stringify(end.lines)}; coda ${coda.lines} lines after ${coda.startFrames} frames; skip back in ${sk.frames - sk.skippedAt} frames`);
  }

  // ---- 動きを減らす設定（模擬）・字幕OFF・音量0：5個の版。各ショットの静止画を撮り、同じショットの中でカメラと姿勢が動かない
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(CASES[3]); await v('(__valley.game.hud.subsOn = false, __valley.game.audio.setVolume(0), 0)');
  await toCinematic();
  const starts = [36, 120, 204, 300, 396], still = { lines: new Set(), shots: [] };
  let at = 0;
  for (const [i, s] of starts.entries()) {
    await step(s + 12 - at); const a = await frame(); await step(30); const b = await frame(); at = s + 42;
    if (a.line) still.lines.add(a.line);
    if (a.shot !== i || b.shot !== i || JSON.stringify(a.camera) !== JSON.stringify(b.camera) || JSON.stringify(a.head) !== JSON.stringify(b.head)) fail(`reduced motion shot ${i}: moved ${JSON.stringify([a.shot, b.shot, a.camera, b.camera])}`);
    still.shots.push(a.camera); await shot(`end-n5-still-${i}`);
  }
  for (let i = 0; i < 300 && (await frame()).flow === 'cinematic'; i++) await step(5);
  const rs = await frame();
  if (!rs.stage?.burned || !still.lines.has('もう、いい。') || !still.lines.has('燃え残った火は、谷で、人の灯になった。')) fail('reduced motion: the badge or the required lines are missing ' + JSON.stringify([rs.stage, [...still.lines]]));
  await v('(__valley.game.hud.subsOn = true, __valley.game.audio.setVolume(0.8), 0)'); await page.emulateMedia({ reducedMotion: null });
  report.reduced = { lines: [...still.lines], cameras: still.shots, burned: rs.stage.burned };

  // ---- 再開：演出の途中で閉じる → つづきから章末を出し直す。完了後（手送りの会話の途中）に閉じる → 結果へ直行
  await prepare(CASES[1]); await toCinematic(); await step(200);
  if ((await frame()).record?.chapter1EndSeen) fail('the record was written before the chapter end finished');
  await reopen(); const r0 = await counters(); await start('continue'); await step(5);
  const plan1 = (await frame()).plan;
  await toCinematic(); const again = await runCinematic({ tag: 'resume mid' });
  const r1 = await frame();
  if (plan1 !== 'play-end' || Math.abs(again.frames - TOTAL.deep) > 2 || r1.record?.chapter1EndSeen !== true) fail(`resume after closing mid-way: plan ${plan1}, ${again.frames} frames, record ${JSON.stringify(r1.record)}`);
  for (let i = 0; i < 10 && (await frame()).dialogue?.id !== 'ending_coda'; i++) await step(1);   // 手送りの会話の途中で閉じる（終わりの保存の前）
  if ((await frame()).dialogue?.id !== 'ending_coda') fail('the hand-advanced talk did not start');
  await reopen(); const d0 = await counters(); await start('continue'); await step(5);
  const plan2 = (await frame()).plan; await step(60);
  const d1 = await counters(), r2 = await frame(), q2 = await st();
  if (plan2 !== 'to-result' || !r2.resultShown || q2.flow !== 'result' || r2.dialogue || d1.persist - d0.persist !== 1 || d1.result - d0.result !== 1 || r2.endCount !== 0)
    fail(`resume after completing: ${JSON.stringify({ plan2, shown: r2.resultShown, flow: q2.flow, dialogue: r2.dialogue, persist: d1.persist - d0.persist, result: d1.result - d0.result, ends: r2.endCount })}`);
  report.resume = { midPlan: plan1, midFrames: again.frames, donePlan: plan2, doneSaves: d1.persist - d0.persist, doneResults: d1.result - d0.result };
  log('report', JSON.stringify(report));
  if (process.env.KZ_OUT) (await import('node:fs')).writeFileSync(process.env.KZ_OUT, JSON.stringify(report, null, 1) + '\n');
}
