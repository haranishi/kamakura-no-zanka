// 回帰：節目の演出の「枠」（C0a後半・R26/R28/R29）。表 CINEMATICS は空のまま、試験の仮の演出（6秒）をこの試験の側から流す。
//  (a) 世界の停止：矢が飛んでいる戦闘中に流し、前後で人物・判断・矢・位置・任務の時刻・米・乱数の呼出数が完全に一致する。
//      さらに、同じ手順で演出を流さない2枚目のページと、復帰後240コマの戦闘記録が一致する。
//  (b) 飛ばし（実際のキー・マウスのイベント）：開始前からの押し続け・0.6秒前の連打では飛ばず、0.6秒後の新しい押下で飛ぶ。
//      戦闘からは、3操作を離してから新しく0.6秒長押ししたときだけ。飛ばした入力が攻撃・会話の行送りへ漏れない。
//  (c) 終了の通知・復帰先は各1回。同じ試行で同じ演出は二度予約できず、やり直しの新しい試行では流せる。
//  (d) 休止（P）・画面の非表示で演出の時計が止まり、戻っても経過を繰り越さない。
//  (e) 章末の記録：chapter1_end の完走・飛ばしでだけ書く。中断・表示失敗・別の演出では書かない。型不正・読めない値は未完了に戻して知らせる。
//      はじめから・もう一度で未完了へ戻し openingSeen は残す。やり直しでは記録を残し、予約だけ新しくする。書けなくても遊びは止まらない。
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-cinematic-frame.mjs --strict --out <フォルダ>
import { POINTER_LOCK_GUARD } from '../lib/pointerlock-guard.mjs';

const shot = (sec, id, from, to) => ({ durationSec: sec, camera: { anchor: 'hero', from, to, lookAt: [0, 1.3, 0], fov: 42 }, subtitleIds: [id],
  gestures: [], scenery: [], still: { camera: { anchor: 'hero', from: [2.6, 1.7, 3.4], to: [2.6, 1.7, 3.4], lookAt: [0, 1.3, 0], fov: 42 }, gestures: [] } });
const entry = (id, returnTarget = 'play', kind = 'event') => ({ id, chapter: 1, kind, trigger: 'qa', stage: 'valley', prepareSec: 0.2, transitionSec: 0.3,
  returnSec: 0.5, returnTarget, shots: [shot(2.5, 'qa_a', [3.2, 1.6, 3.8], [1.6, 1.4, 4.4]), shot(2.5, 'qa_b', [-2.8, 2.2, 3.0], [-3.4, 2.6, 1.6])] });
const TEXT = { qa_a: '試験の演出：一つ目の画', qa_b: '試験の演出：二つ目の画' };
const REC = 'kamakura-valley-cinematics';

// 世界の論理の状態（見た目は含めない）。循環は印にし、Vector3 は配列にする。乱数は呼んだ回数で比べる
const INSTALL = `(() => {
  const g = __valley.game;
  if (!g.rng.qa) { const r = g.rng, f = () => (f.n++, r()); f.n = 0; f.qa = true; g.rng = f; }
  const ser = (v, d = 0, seen = new WeakSet()) => {
    if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
    if (v.isVector3) return [v.x, v.y, v.z];
    if (v.isObject3D || v.isMaterial || v.isBufferGeometry) return '[three]';
    if (seen.has(v)) return '[seen]'; if (d > 6) return '[deep]'; seen.add(v);
    if (Array.isArray(v)) return v.map(x => ser(x, d + 1, seen));
    if (v instanceof Map || v instanceof Set) return [...v].map(x => ser(x, d + 1, seen));
    const o = {}; for (const k of Object.keys(v).sort()) { const x = ser(v[k], d + 1, seen); if (x !== undefined) o[k] = x; } return o;
  };
  window.__worldSnap = () => JSON.stringify(ser({ time: g.time, stopT: g.stopT, slowT: g.slowT, slowDur: g.slowDur, timers: g.timers.map(t => t.t), rngN: g.rng.n,
    hero: { f: g.hero.fighter, pos: g.hero.pos, yaw: g.hero.yaw, speed: g.hero.speed, lunge: g.hero.lunge },
    enemies: g.enemies.map(e => ({ id: e.id, f: e.fighter, b: e.brain, pos: e.pos, yaw: e.yaw, dormant: e.dormant, departed: e.departed, lunge: e.lunge, reported: e.reported })),
    arrows: g.battle.arrows.map(a => ({ pos: a.pos, vel: a.vel, life: a.life, stuck: a.stuck, t: a.t, ally: a.ally, owner: a.owner.id })),
    quest: { beat: g.quest.beat, res: g.quest.resources, flags: g.quest.flags, cp: g.quest.checkpoint }, pillageT: g.pillageT, lostFood: g.lostFood,
    noises: g.noises, barkAt: g.battle.barkAt, tokens: g.tokens }));
  return true; })()`;

export default async function ({ page, v, st, step, start, freeze, call, shot: snap, log }) {
  const fail = msg => { throw new Error(msg); };
  // 2つの状態の最初に違う所（落ちたときの手がかり）
  const where = (a, b, p = '', out = []) => { if (out.length >= 6 || JSON.stringify(a) === JSON.stringify(b)) return out; if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) where(a[k], b[k], p + '.' + k, out); } else out.push(`${p}: ${JSON.stringify(a)?.slice(0, 80)} vs ${JSON.stringify(b)?.slice(0, 80)}`); return out; };
  const firstDiff = (x, y) => where(JSON.parse(x), JSON.parse(y)).join(' | ');
  const report = {};
  const cs = () => v('__valley.cinematic.state()');
  const play = (e, opts = {}) => v(`__valley.cinematic.play(${JSON.stringify(e)}, ${JSON.stringify({ textById: TEXT, ...opts })})`);
  // 試験の復帰先：遊びへ戻り、呼ばれた回数を数える（会話を始めるものも用意し、飛ばしの E が行送りへ漏れないかを見る）
  const RETURNS = `(() => { const g = __valley.game; window.__ret = { play: 0, talk: 0 };
    g.cinema.returns.register('qa_play', () => { window.__ret.play++; g.flow = 'play'; });
    g.cinema.returns.register('qa_talk', () => { window.__ret.talk++; g.flow = 'play'; g.startDialogue('boy_arrives'); });
    return true; })()`;
  // 里の戦い：弓兵と兵1人だけを動かす（arrow-death と同じ寄せ方）。主人公は傷を受けても戻る（god）。手順は2枚のページで同じ
  async function battle(vv, stepN) {
    // タイトルの間は実時間で時計と乱数が進む（ページごとに違う）。止めてから始め、時計を同じ値へずらし、乱数を同じ種で作り直す
    await vv(`(async () => { __valley.freeze(true); __valley.start('new'); const g = __valley.game, { mulberry32 } = await import('/valley/scatter.js');
      const d = g.time - 100; g.time -= d; g.beatAt -= d; for (const t of g.timers) t.t -= d; for (const n of g.noises) n.t -= d;
      if (g.lastLookT != null) g.lastLookT -= d; g.enemySnapsAt = -1; g.fxT = g.chimneyT = g.listenerT = g.markerT = 0; g.raidSmokeOdd = false; g.rng = mulberry32(1333); return 0; })()`);
    await stepN(30);
    const adv = async () => { for (let i = 0; i < 60; i++) { const s = await vv('__valley.state()'); if (s.talking) { await vv('__valley.advanceDialogue(true)'); await stepN(10); } else if (s.pending) await stepN(30); else break; } };
    for (const e of [{ type: 'enter_zone', zone: 'temple_yard' }, { type: 'dialogue_end', id: 'boy_arrives' }, { type: 'arrived', place: 'viewpoint' }]) await vv(`__valley.dispatch(${JSON.stringify(e)})`);
    await adv(); await vv("document.getElementById('choice-front').click()"); await stepN(10); await adv();
    await vv('(__valley.teleport(-30, -3, -1.6), 0)'); await stepN(10);
    await vv(`(() => { const g = __valley.game; g.god = true; let soldier = false;
      for (const e of g.enemies) { if (e.kind === 'archer') continue; if (!soldier && e.kind === 'soldier') { soldier = true; e.place(-28.2, -3.4, 1.6); e.dormant = false; e.brain.state = 'combat'; e.brain.awareness = 1; e.fighter.aware = true; continue; } e.dormant = true; }
      const a = g.enemies.find(e => e.kind === 'archer'); a.place(-18, -2, 1.6); a.dormant = false; a.brain.state = 'combat'; a.brain.awareness = 1; a.fighter.aware = true; return true; })()`);
    await vv(INSTALL);
    for (let i = 0; i < 900; i++) { await stepN(1); if (await vv('__valley.game.battle.arrows.some(a => !a.stuck) && __valley.game.battle.arrows.length > 0')) return i; }
    fail('no arrow was fired in the battle setup');
  }

  // ---- (a) 世界の停止
  const p2 = await page.context().browser().newPage({ viewport: page.viewportSize(), deviceScaleFactor: 1 });   // 演出を流さない比較用
  await p2.addInitScript(POINTER_LOCK_GUARD.pretend);
  await p2.goto(page.url()); await p2.waitForFunction('window.__valleyReady===true', null, { timeout: 180000 });
  const v2 = e => p2.evaluate(e), step2 = n => p2.evaluate(`(__valley.step(${n}), 0)`), stepA = n => v(`(__valley.step(${n}), 0)`);
  const fa = await battle(v, stepA), fb = await battle(v2, step2);
  const s0 = await v('__worldSnap()'), b0 = await v2('__worldSnap()');
  if (fa !== fb || s0 !== b0) fail(`the two pages diverged before the cinematic (arrow at ${fa}/${fb}) ${firstDiff(s0, b0)}`);
  const arrowsInFlight = await v('__valley.game.battle.arrows.filter(a => !a.stuck).length');
  await v(RETURNS);
  const r0 = await play(entry('qa_freeze'), { fromBattle: true });
  if (!r0.ok) fail('cinematic did not start: ' + JSON.stringify(r0));
  let frames = 0, midCalls = 0, midTris = 0, changed = 0;
  for (; frames < 600; frames++) {
    const s = await v('(__valley.step(1), __valley.state())');
    if (s.flow !== 'cinematic') break;
    midCalls = Math.max(midCalls, s.render.calls); midTris = Math.max(midTris, s.render.tris);
    if (frames % 30 === 0 && await v('__worldSnap()') !== s0) changed++;
  }
  const s1 = await v('__worldSnap()'), a1 = await cs();
  if (changed) fail(`the world changed during the cinematic (${changed} samples)`);
  if (s1 !== s0) fail('the world after the cinematic differs from before it ' + firstDiff(s0, s1));
  if (a1.endCount !== 1 || frames < 355 || frames > 362) fail(`cinematic should run 6s (got ${frames} frames, ${a1.endCount} ends)`);
  // 復帰後の戦闘記録：演出なしのページと毎コマ比べる
  let diff = -1;
  for (let i = 0; i < 240 && diff < 0; i++) { await stepA(1); await step2(1); const x = await v('__worldSnap()'), y = await v2('__worldSnap()'); if (x !== y) { diff = i; report.diverged = firstDiff(x, y); } }
  if (diff >= 0) fail(`battle after the cinematic diverged from the run without it at frame ${diff} ${report.diverged}`);
  const endA = JSON.parse(await v('__worldSnap()'));
  await p2.close();
  report.freeze = { arrowsInFlight, frames, rngCalls: JSON.parse(s0).rngN, rngCallsAfter240: endA.rngN, arrowsAfter: endA.arrows.length, gameTimeHeld: JSON.parse(s0).time,
    calls: midCalls, tris: midTris };
  log('freeze', JSON.stringify(report.freeze));
  if (midCalls > 900 || midTris > 5e6) fail('draw budget exceeded during the cinematic ' + JSON.stringify(report.freeze));

  // ---- 実際の入力の準備：キャンバスを押してマウスを固定する（自動試験では pointerlock-guard が受け止める）
  await v('(() => { const g = __valley.game; g.god = true; for (const e of g.enemies) { e.dormant = true; } g.battle.clear(); return true; })()');
  await stepA(5);
  const lock = async () => {
    if (await v('__valley.game.input.locked')) return;
    const hit = await v("document.elementFromPoint(640, 360)?.tagName"); if (hit !== 'CANVAS') fail('the canvas is not under the pointer: ' + hit);
    await page.mouse.click(640, 360); await page.waitForFunction('__valley.game.input.locked === true');
  };
  await lock();
  const kd = c => page.keyboard.down(c), ku = c => page.keyboard.up(c), md = () => page.mouse.down(), mu = () => page.mouse.up();
  const elapsedAt = async () => (await cs()).active?.elapsed ?? null;
  const runFrames = async (n, each) => { for (let i = 0; i < n; i++) { await stepA(1); if (each && await each(i)) return i; } return -1; };
  const skippedNow = async () => (await cs()).active?.skipped === true || (await cs()).flow !== 'cinematic';
  const finishOut = async () => { for (let i = 0; i < 700; i++) { if ((await cs()).flow !== 'cinematic') return i; await stepA(1); } fail('cinematic did not end'); };
  const heroAttacked = () => v("(() => { const f = __valley.game.hero.fighter; return f.state === 'attack' || !!f.move; })()");

  // (b1) 通常：開始前から E を押し続けても飛ばない。離して新しく押すと（0.6秒後）飛ぶ
  await kd('KeyE'); await play(entry('qa_hold'));
  if (await runFrames(90, skippedNow) >= 0) fail('holding E from before the start skipped the cinematic');
  await ku('KeyE'); await stepA(2); await kd('KeyE'); await stepA(1);
  const b1 = await cs(); if (!b1.events.some(e => e.type === 'skip' && e.id === 'qa_hold')) fail('a new press of E after 0.6s did not skip');
  const skipAt = b1.events.find(e => e.type === 'skip' && e.id === 'qa_hold').t;
  const backIn = await finishOut(); await ku('KeyE');
  if (backIn / 60 > 0.6) fail(`skip took ${backIn} frames to return (over 0.6s)`);
  // (b2) 通常：0.6秒前の連打（Space）では飛ばず、案内のあとの新しい押下で飛ぶ
  await play(entry('qa_mash'));
  for (let i = 0; i < 5; i++) { await kd('Space'); await stepA(2); await ku('Space'); await stepA(3); }
  const mash = await cs(); if (mash.active?.skipped || mash.active.elapsed > 0.6) fail('mashing before 0.6s skipped or overran: ' + JSON.stringify(mash.active));
  await stepA(12); await kd('Space'); await stepA(1); await ku('Space');
  if (!(await cs()).events.some(e => e.type === 'skip' && e.id === 'qa_mash')) fail('a press after the hint did not skip');
  await finishOut();
  // (b3) 戦闘から：押し続け（クリック）では飛ばず、離したあとの連打でも飛ばず、新しい0.6秒の長押し（Space）で飛ぶ。0.5秒では飛ばない
  await md(); await play(entry('qa_battle'), { fromBattle: true });
  if (await runFrames(90, skippedNow) >= 0) fail('holding the mouse from before a battle cinematic skipped it');
  await mu(); await stepA(2);
  for (let i = 0; i < 8; i++) { await md(); await stepA(4); await mu(); await stepA(4); }
  if (await skippedNow()) fail('mashing clicks skipped a battle cinematic');
  await kd('Space'); await stepA(30); await ku('Space'); await stepA(2);
  if (await skippedNow()) fail('a 0.5s hold skipped a battle cinematic');
  await kd('Space'); const heldFrames = await runFrames(60, skippedNow); await ku('Space');
  if (heldFrames < 0) fail('a new 0.6s hold did not skip a battle cinematic');
  report.skip = { normalSkipAt: skipAt, returnFrames: backIn, battleHoldFrames: heldFrames + 1 };
  await finishOut();
  // (b4) 漏れ：クリックで飛ばし、復帰の途中で離す → 戻っても斬らない。E で飛ばして会話へ戻る → 最初の行が送られない
  await stepA(30);
  if (await heroAttacked()) fail('hero was attacking before the leak check');
  await play(entry('qa_leak_click')); await stepA(45); await md(); await stepA(3); await mu();
  await finishOut(); let leaked = false;
  for (let i = 0; i < 20; i++) { await stepA(1); if (await heroAttacked()) leaked = true; }
  if (leaked) fail('the click that skipped the cinematic started an attack');
  await play(entry('qa_leak_talk', 'qa_talk')); await stepA(45); await kd('KeyE'); await stepA(3); await ku('KeyE');
  await finishOut(); await stepA(3);
  const talk = await v('(() => { const d = __valley.game.hud.dialogue; return d ? { id: d.id, i: d.i } : null; })()');
  if (!talk || talk.id !== 'boy_arrives' || talk.i !== 0) fail('the E that skipped the cinematic advanced the next dialogue: ' + JSON.stringify(talk));
  await v('__valley.advanceDialogue(true)'); await stepA(5);

  // ---- (c) 通知・復帰先は各1回。予約と試行
  await v('(window.__ret = { play: 0, talk: 0 }, 0)');
  const before = await cs();
  await play(entry('qa_once', 'qa_play')); await finishOut(); await stepA(30);
  const once = await cs(), ret = await v('window.__ret');
  const endsOnce = once.events.filter(e => e.type === 'ended' && e.id === 'qa_once').length;
  if (once.endCount - before.endCount !== 1 || endsOnce !== 1 || ret.play !== 1) fail(`end notice/return should be once: ends ${once.endCount - before.endCount}/${endsOnce}, return ${ret.play}`);
  if (!once.played.some(([[id, at], s]) => id === 'qa_once' && at === once.attempt && s === 'ended')) fail('reservation was not marked ended');
  const again = await play(entry('qa_once', 'qa_play'));
  if (again.ok || again.reason !== 'reserved') fail('the same cinematic played twice in one attempt: ' + JSON.stringify(again));
  report.once = { endCount: once.endCount, returns: ret.play };

  // ---- (d) 休止（P）と非表示。閉じる（close の通知）は非同期なので、休止が解けるのを待ってから進める
  const unpause = async () => { await page.click('#pause-resume'); await page.waitForFunction('__valley.game.paused === false'); };
  await play(entry('qa_pause')); await stepA(30);
  const e0 = await elapsedAt();
  await page.keyboard.press('KeyP');
  if (!(await v('__valley.game.paused'))) fail('P did not pause during the cinematic');
  await stepA(120); const e1 = await elapsedAt();
  await unpause(); await stepA(1); const e2 = await elapsedAt(); await stepA(30); const e3 = await elapsedAt();
  if (e1 !== e0 || e2 !== e0 || Math.abs(e3 - e0 - 0.5) > 0.02) fail(`pause: elapsed ${e0} → paused ${e1} → first frame ${e2} → +30 frames ${e3} ` + JSON.stringify(await v("({ paused: __valley.game.paused, active: __valley.cinematic.state().active })")));
  await v("(Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }), document.dispatchEvent(new Event('visibilitychange')), 0)");
  await stepA(90); const h1 = await elapsedAt();
  await v("(delete document.hidden, document.dispatchEvent(new Event('visibilitychange')), 0)");
  if (await v("document.getElementById('pause').open")) await unpause();
  await stepA(1); const h2 = await elapsedAt(); await stepA(30); const h3 = await elapsedAt();
  if (h1 !== e3 || h2 !== e3 || Math.abs(h3 - e3 - 0.5) > 0.02) fail(`hidden: ${e3} → ${h1} → ${h2} → ${h3}`);
  report.pause = { e0, paused: e1, resumed: e3, hidden: h1, afterHidden: h3 };
  await finishOut(); await lock();

  // ---- 見え方：語りの枠（字幕OFFでも出る）・案内・HUD・カメラ。動きを減らす設定ではカメラが動かない
  await v('(__valley.game.hud.subsOn = false, 0)');
  await snap('cine-0-play');
  await play(entry('qa_look')); await stepA(20);
  const f20 = await cs(); if (f20.frame.hint !== 0) fail('skip hint shown before 0.6s');
  await stepA(70); const f90 = await cs();
  if (!f90.frame.narration || f90.frame.line !== TEXT.qa_a || f90.frame.hint !== 1 || !f90.frame.hudHidden) fail('frame at 1.5s: ' + JSON.stringify(f90.frame));
  await snap('cine-1-shot-a');
  await stepA(150); const f240 = await cs(); if (f240.frame.line !== TEXT.qa_b) fail('second shot subtitle: ' + f240.frame.line);
  if (Math.hypot(f240.camera.x - f90.camera.x, f240.camera.z - f90.camera.z) < 1) fail('the camera did not move between shots');
  await snap('cine-2-shot-b');
  await finishOut(); await stepA(2); const back = await cs();
  if (back.frame.narration || back.frame.hudHidden) fail('frame not cleaned up after the cinematic ' + JSON.stringify(back.frame));
  await snap('cine-3-back');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await play(entry('qa_reduced')); await stepA(60); const m1 = await cs(); await stepA(60); const m2 = await cs();
  if (JSON.stringify(m1.camera) !== JSON.stringify(m2.camera) || m1.frame.line !== TEXT.qa_a) fail('reduced motion: camera moved or text missing ' + JSON.stringify([m1.camera, m2.camera]));
  await snap('cine-4-reduced');
  await finishOut(); await page.emulateMedia({ reducedMotion: null }); await v('(__valley.game.hud.subsOn = true, 0)');
  report.look = { cameraShotA: f90.camera, cameraShotB: f240.camera, reduced: m1.camera };

  // ---- (e) 章末の記録
  const rec = () => v(`JSON.parse(localStorage.getItem('${REC}') || 'null')`);
  const clear = () => v(`(localStorage.removeItem('${REC}'), 0)`);
  await clear(); await v('(__valley.cinematic.reset(), 0)');
  await play(entry('qa_other')); await finishOut();
  if (await rec()) fail('a non chapter-end cinematic wrote the record');
  await play(entry('chapter1_end', 'play', 'end')); await finishOut();
  if ((await rec())?.chapter1EndSeen !== true) fail('completing chapter1_end did not write the record');
  await clear(); await v('(__valley.cinematic.reset(), 0)'); await lock();
  await play(entry('chapter1_end', 'play', 'end')); await stepA(45); await kd('KeyE'); await stepA(2); await ku('KeyE'); await finishOut();
  if ((await rec())?.chapter1EndSeen !== true) fail('skipping chapter1_end did not write the record');
  await clear(); await v('(__valley.cinematic.reset(), 0)');
  await play(entry('chapter1_end', 'play', 'end')); await stepA(60); await v('(__valley.cinematic.reset(), 0)');
  if (await rec() || (await st()).flow !== 'play') fail('an interrupted chapter1_end wrote the record or did not return to play');
  const bad = { ...entry('chapter1_end', 'play', 'end'), shots: [] };
  const rb = await play(bad); await stepA(2);
  if (rb.ok || await rec() || (await st()).flow !== 'play') fail('a broken chapter1_end entry wrote the record or blocked play');
  // 型不正・読めない値は未完了＋通知、正しい記録は結果へ直行
  const resume = async raw => { await v(`(localStorage.setItem('${REC}', ${JSON.stringify(raw)}), __valley.game.quest.checkpoint = 'cp_result', 0)`);
    const plan = await v('__valley.cinematic.resume()'); return { plan, toast: await v("document.getElementById('toast').textContent") }; };
  const cpWas = await v('__valley.game.quest.checkpoint');
  const rTyped = await resume(JSON.stringify({ schema: REC, version: 1, chapter1EndSeen: 'yes' }));
  await v("(document.getElementById('toast').textContent = '', 0)");
  const rBroken = await resume('{not json');
  const rDone = await resume(JSON.stringify({ schema: REC, version: 1, chapter1EndSeen: true }));
  await v(`(__valley.game.quest.checkpoint = ${JSON.stringify(cpWas)}, 0)`);
  if (rTyped.plan !== 'play-end' || !rTyped.toast.includes('演出の記録') || rBroken.plan !== 'play-end' || !rBroken.toast.includes('演出の記録') || rDone.plan !== 'to-result')
    fail('resume plans: ' + JSON.stringify({ rTyped, rBroken, rDone }));
  // やり直し：記録は残し、試行番号を進めて予約を新しくする（同じ演出をもう一度流せる）
  await play(entry('qa_retry', 'qa_play')); await finishOut();
  const att0 = (await cs()).attempt;
  if ((await play(entry('qa_retry', 'qa_play'))).ok) fail('qa_retry should be reserved before the retry');
  await v('(__valley.game.toCheckpoint(), 0)'); await stepA(80);
  const afterRetry = await cs();
  if (afterRetry.attempt !== att0 + 1 || (await rec())?.chapter1EndSeen !== true) fail(`retry: attempt ${att0} → ${afterRetry.attempt}, record ${JSON.stringify(await rec())}`);
  if (!(await play(entry('qa_retry', 'qa_play'))).ok) fail('the new attempt could not play the cinematic again');
  await finishOut();
  // はじめから：未完了へ戻し、openingSeen は残す。やり直しの試行番号も0へ
  await v("(localStorage.setItem('kamakura-valley-meta', JSON.stringify({ schema: 'kamakura-valley-meta', version: 1, openingSeen: true })), 0)");
  await v('(__valley.game.startNew(), 0)'); await stepA(5);
  const fresh = await cs(), meta = await v("JSON.parse(localStorage.getItem('kamakura-valley-meta'))");
  if ((await rec())?.chapter1EndSeen !== false || meta.openingSeen !== true || fresh.attempt !== 0 || fresh.played.length) fail('new game reset: ' + JSON.stringify({ rec: await rec(), meta, attempt: fresh.attempt }));
  // 書けない：完走しても遊びへ戻り、知らせる
  await v(`(() => { const set = Storage.prototype.setItem; window.__setItem = set; Storage.prototype.setItem = function (k, val) { if (k === '${REC}') throw new Error('quota'); return set.call(this, k, val); }; return 0; })()`);
  await play(entry('chapter1_end', 'play', 'end')); await finishOut(); await stepA(2);
  const toast = await v("document.getElementById('toast').textContent");
  await v('(Storage.prototype.setItem = window.__setItem, 0)');
  if ((await st()).flow !== 'play' || !toast.includes('演出の記録')) fail('write failure: flow or notice ' + toast);
  report.record = { resume: { typed: rTyped.plan, broken: rBroken.plan, done: rDone.plan }, attempt: [att0, afterRetry.attempt], writeFailToast: toast };
  log('report', JSON.stringify(report));
  if (process.env.KZ_OUT) (await import('node:fs')).writeFileSync(process.env.KZ_OUT, JSON.stringify(report, null, 1) + '\n');
}
