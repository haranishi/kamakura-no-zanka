// 回帰：実ゲームの主人公（HeroActor）の入力・戦闘・死亡・やり直しの経路で、抜刀・納刀の層が論理と食い違わないこと（8.2）。
// regress-draw-sheathe.mjs は層だけを駆動する。ここは、本物のゲームを、本物の入力で動かし、毎コマ次を確かめる:
//   不変条件   hero.drawn（論理）が、層の状態（抜く途中・抜いた）と一致する。攻撃中に、層が「納めている」ことがない
//   測定       握りの誤差・刃の鞘への収まり・刀と手の跳び・表示・値の健全性（tools/lib/draw-sheathe-metrics.mjs。跳びは層が動いているコマだけ）
//   場面ごとの結果  自動の抜刀／攻撃で速く抜く／納刀を始めるコマの同時入力（取り消し）／受け／抜刀の途中の死亡／抜刀の途中のやり直し
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-draw-sheathe-game.mjs --seed 1333 --strict
import { LIMITS, createMetrics, popScore } from '../lib/draw-sheathe-metrics.mjs';

const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

export default async function ({ st, step, call, v, freeze, start, click, release, log }) {
  await start('new'); await freeze(true); await step(40);
  await v(`(async () => {
    window.__dsPose = await import('/valley/sword-layer.js');
    window.__dsMake = await (${createMetrics.toString()})();
    window.__dsProbe = f => {
      const g = __valley.game, h = g.hero, snap = h.swordLayer.snapshot(), out = { u: snap.u, mode: snap.mode, pose: window.__dsPose.poseAt(snap.u) };
      window.__dsRun.sample(out);
      const bad = [];
      if (h.drawn !== (snap.mode === 'drawing' || snap.mode === 'drawn')) bad.push('drawn=' + h.drawn + ' なのに層は ' + snap.mode);
      if (h.fighter.alive && h.fighter.state === 'attack' && (snap.mode === 'sheathing' || snap.mode === 'sheathed')) bad.push('攻撃中なのに層は ' + snap.mode);
      if (bad.length) window.__dsInv.push([f, bad.join('；'), snap.mode, +snap.u.toFixed(3)]);
      return [snap.mode, snap.u, h.fighter.state, h.drawn];
    };
    return true;
  })()`);
  const adv = async () => { for (let i = 0; i < 60; i++) { const s = await st(); if (s.talking) { await call('advanceDialogue', true); await step(10); } else if (s.pending) await step(30); else break; } };
  const prepare = async () => {
    // start('new') は、タイトル画面（flow が idle）のときだけ働く。2回目以降は、本体の startNew() で、新しいゲームから始める
    if ((await v('__valley.game.flow')) === 'idle') await start('new'); else await v('(() => { __valley.game.startNew(); return true; })()');
    await freeze(true); await step(40); await call('god', true);
    for (const e of [{ type: 'enter_zone', zone: 'temple_yard' }, { type: 'dialogue_end', id: 'boy_arrives' }]) await call('dispatch', e);
    await v(`(() => { const e = __valley.game.enemies.find(e => e.id === 'road_scout'); if (e) e.dormant = true; return true; })()`);   // 場面の前に、敵が気づいて主人公が抜いてしまわないよう、現れた直後に休眠にする
    await adv(); await step(20);
    const sc = (await st()).enemies.find(e => e.id === 'road_scout');
    await call('camera', null); await call('teleport', sc.x - 6, sc.z - 5, yawTo(6, 5)); await call('look', yawTo(6, 5), 0.22); await step(25);
    await v(`(() => { window.__dsRun = window.__dsMake(__valley.game.hero.character); window.__dsInv = []; return true; })()`);
  };
  const placeScout = (dx, dz, combat) => v(`(() => { const g = __valley.game, e = g.enemies.find(e => e.id === 'road_scout'), h = g.hero.pos; e.place(h.x + ${dx}, h.z + ${dz}, 0); ${combat ? "e.dormant = false; e.brain.state = 'combat'; e.brain.awareness = 1; e.fighter.aware = true;" : ''} })()`);
  const killScout = () => v(`(() => { const g = __valley.game, e = g.enemies.find(e => e.id === 'road_scout'); e.fighter.hp = 0; e.fighter.alive = false; e.fighter.state = 'down'; e.die(); g.reportDown(e, 'killed'); })()`);
  // コマを進めながら、毎コマ不変条件と測定を取る。per(i) はそのコマの入力（step の前）
  const run = async (n, per = async () => {}) => { const trail = []; for (let i = 0; i < n; i++) { await per(i); await step(1); trail.push(await v(`window.__dsProbe(${i})`)); } return trail; };
  const startsSheathed = async name => { const t = await v('(() => { const h = __valley.game.hero; return [h.swordLayer.snapshot().mode, h.drawn]; })()'); if (t[0] !== 'sheathed' || t[1]) fails.push(`${name}: 場面が納刀から始まっていない ${JSON.stringify(t)}`); };
  const finish = () => v(`(() => { const R = window.__dsRun.finish(null); return { R, inv: window.__dsInv, hero: { mode: __valley.game.hero.swordLayer.snapshot(), drawn: __valley.game.hero.drawn, queued: __valley.game.hero.queued, dash: !!__valley.game.hero.dash, rigActive: __valley.game.hero.character.sword.active, shown: __valley.game.hero.character.weapons.tachiDrawn.holder.visible, hilt: __valley.game.hero.character.weapons.tachiHipHilt.object.visible } }; })()`);

  const results = {}, fails = [];
  const judge = (name, r, { pops = true } = {}) => {
    const R = r.R, chk = (cond, msg) => { if (!cond) fails.push(`${name}: ${msg}`); };
    const masked = a => a.map((x, i) => (R.liveFlags[i] ? x : null));
    const p1 = popScore(masked(R.stepPos), LIMITS.popFloorM), p2 = popScore(masked(R.stepRot), LIMITS.popFloorRad), p4 = popScore(masked(R.stepHandRot), LIMITS.popFloorRad);
    chk(r.inv.length === 0, `論理と層の食い違い ${JSON.stringify(r.inv.slice(0, 3))}`);
    chk(R.nan === 0, `NaN ${R.nan}`);
    chk(R.vis === 0, `刀と腰の柄の表示が食い違うコマ ${R.vis}`);
    chk(R.maxIkErrMm <= LIMITS.gripPosMm, `右腕のIKが届かない量 ${R.maxIkErrMm.toFixed(1)}mm`);
    chk(R.maxGripMm <= LIMITS.gripPosMm, `握りの誤差 ${R.maxGripMm.toFixed(1)}mm`);
    chk(R.wallHits === 0, `刃の断面が鞘の管に収まらないコマ ${R.wallHits}`);
    chk(R.maxArmDevMm <= LIMITS.armLenMm, `腕の長さの変化 ${R.maxArmDevMm.toFixed(2)}mm`);
    if (pops) { chk(p1.worst <= LIMITS.popRatio, `刀が1コマだけ跳ぶ（${p1.worst.toFixed(1)}倍・コマ ${p1.at}）`); chk(p2.worst <= LIMITS.popRatio, `刀の向きが1コマだけ跳ぶ（${p2.worst.toFixed(1)}倍）`); chk(p4.worst <= LIMITS.popRatio, `右手の向きが1コマだけ跳ぶ（${p4.worst.toFixed(1)}倍）`); }
    results[name] = { live: R.liveFrames, grip: +R.maxGripMm.toFixed(1), ikErr: +R.maxIkErrMm.toFixed(1), room: +R.minRoomMm.toFixed(1), pop: [p1.worst, p2.worst, p4.worst].map(x => +x.toFixed(2)), mode: r.hero.mode.mode, drawn: r.hero.drawn };
    log(`${name}: live ${R.liveFrames} grip ${R.maxGripMm.toFixed(1)}mm ikErr ${R.maxIkErrMm.toFixed(1)}mm room ${R.minRoomMm.toFixed(1)}mm pop ${results[name].pop} → ${r.hero.mode.mode} drawn=${r.hero.drawn}`);
    return chk;
  };

  // 1 敵が離れた所で気づく → 落ち着いた抜刀（攻撃入力なし）
  await prepare(); await startsSheathed('alertAutoDraw'); await placeScout(14, 6, true);
  let trail = await run(100); let r = await finish(); judge('alertAutoDraw', r);
  if (!(r.hero.mode.mode === 'drawn' && r.hero.drawn && r.hero.shown && !r.hero.hilt && !r.hero.rigActive)) fails.push(`alertAutoDraw: 自動で抜き切れていない ${JSON.stringify(r.hero)}`);
  const firstDrawn = trail.findIndex(t => t[0] === 'drawn'); if (firstDrawn < 0 || firstDrawn > 50) fails.push(`alertAutoDraw: 抜き切るまで ${firstDrawn} コマ（約0.62秒＝38コマ前後）`);

  // 2 抜く途中に攻撃入力 → 攻撃は同じコマに始まり、層は速く抜き切る
  await prepare(); await startsSheathed('attackMidDraw'); await placeScout(14, 6, true);
  let attackAt = -1;
  trail = await run(80, async i => { if (i === 15) await click(0, true); if (i === 17) await release(0); });
  trail.forEach((t, i) => { if (attackAt < 0 && t[2] === 'attack') attackAt = i; });
  r = await finish(); judge('attackMidDraw', r);
  if (attackAt !== 15) fails.push(`attackMidDraw: 攻撃の開始が入力のコマ（15）でない（${attackAt}）`);
  if (r.hero.mode.mode !== 'drawn') fails.push(`attackMidDraw: 最後に抜いた状態でない（${r.hero.mode.mode}）`);

  // 3 納刀のまま攻撃入力 → 速い抜刀
  await prepare(); await startsSheathed('attackFromSheathed'); await placeScout(2.4, 0.9, false);
  attackAt = -1; let drawnAt = -1;
  trail = await run(60, async i => { if (i === 5) await click(0, true); if (i === 7) await release(0); });
  trail.forEach((t, i) => { if (attackAt < 0 && t[2] === 'attack') attackAt = i; if (drawnAt < 0 && t[0] === 'drawn') drawnAt = i; });
  r = await finish(); judge('attackFromSheathed', r);
  if (attackAt !== 5) fails.push(`attackFromSheathed: 攻撃の開始が入力のコマ（5）でない（${attackAt}）`);
  if (drawnAt < 0 || drawnAt - 5 > 10) fails.push(`attackFromSheathed: 抜き切るまで ${drawnAt - 5} コマ（10コマ以内）`);

  // 4 納刀を始めるコマに攻撃入力 → 納刀は取り消され、攻撃が通る（以前は、納刀を続けたまま攻撃した）
  await prepare(); await startsSheathed('sheatheBoundaryRace'); await placeScout(2.4, 0.9, false);
  await run(5, async i => { if (i === 1) await click(0, true); if (i === 3) await release(0); });          // 抜いた状態にする
  await killScout(); await run(60);                                                                       // 攻撃を終えて落ち着く
  await v(`(() => { __valley.game.hero.sheatheIn = 0.004; return true; })()`);                            // 次の更新でちょうど納刀の条件になる
  let raceAttack = false;
  trail = await run(40, async i => { if (i === 0) await click(0, true); if (i === 2) await release(0); });
  raceAttack = trail.slice(0, 3).some(t => t[2] === 'attack');
  r = await finish(); judge('sheatheBoundaryRace', r);
  if (!raceAttack) fails.push('sheatheBoundaryRace: 納刀を始めるコマの攻撃入力が通っていない');
  if (trail.slice(0, 12).some(t => t[0] === 'sheathing')) fails.push('sheatheBoundaryRace: 攻撃したのに納刀を続けた');

  // 5 納刀のまま受け（右クリックを押し続ける）
  await prepare(); await startsSheathed('blockFromSheathed'); await placeScout(2.4, 0.9, false);
  trail = await run(50, async i => { if (i === 5) await click(2, true); if (i === 40) await release(2); });
  r = await finish(); judge('blockFromSheathed', r);
  if (!trail.slice(20, 40).every(t => t[0] === 'drawn')) fails.push('blockFromSheathed: 受けの間（抜き切ったあと）に抜いた状態でない');
  if (trail.slice(5, 40).some(t => t[0] === 'sheathing' || t[0] === 'sheathed')) fails.push('blockFromSheathed: 受けを始めたのに、刀を納めた状態が出る');

  // 6 抜く途中に主人公が倒れる → 途中の層を適用し続けない
  await prepare(); await startsSheathed('dieMidDraw'); await placeScout(14, 6, true);
  await run(12);
  await call('god', false);
  await v(`(() => { const f = __valley.game.hero.fighter; f.hp = 0; f.alive = false; f.state = 'down'; return true; })()`);
  const liveBefore = (await finish()).R.liveFrames;
  trail = await run(40);
  r = await finish(); judge('dieMidDraw', r, { pops: false });
  if (r.R.liveFrames > liveBefore + 1) fails.push(`dieMidDraw: 死亡のあとも層を適用し続けた（${r.R.liveFrames - liveBefore}コマ）`);
  if (!(r.hero.mode.mode === 'drawn' || r.hero.mode.mode === 'sheathed')) fails.push(`dieMidDraw: 途中のまま ${r.hero.mode.mode}`);
  if (r.hero.rigActive) fails.push('dieMidDraw: 層が動いたまま');

  // 7 抜く途中にやり直し → 予約・とどめの接近が消え、層は納刀から（敵がまだ気づいていれば、そのあとにまた抜くのは正しい）
  await prepare(); await startsSheathed('resetMidDraw'); await placeScout(14, 6, true);
  await run(12);
  const readState = () => v(`(() => { const h = __valley.game.hero; return { queued: h.queued, dash: !!h.dash, mode: h.swordLayer.snapshot(), drawn: h.drawn, rigActive: h.character.sword.active, shown: h.character.weapons.tachiDrawn.holder.visible, hilt: h.character.weapons.tachiHipHilt.object.visible }; })()`);
  const mid = await readState(); if (mid.mode.mode !== 'drawing') fails.push(`resetMidDraw: 準備が崩れた（${mid.mode.mode}）`);
  await v(`(() => { const g = __valley.game, h = g.hero, e = g.enemies.find(e => e.id === 'road_scout'); h.queued = { kind: 'heavy', t: 0.45 }; h.dash = { target: e, speed: 13 }; h.reset(h.pos.x, h.pos.z, h.yaw); return true; })()`);
  r = await readState();                                                                                    // やり直した直後（コマを進める前）
  if (r.queued !== null || r.dash) fails.push(`resetMidDraw: 予約・とどめの接近が残る ${JSON.stringify({ queued: r.queued, dash: r.dash })}`);
  if (!(r.mode.mode === 'sheathed' && !r.drawn && !r.rigActive && !r.shown && r.hilt)) fails.push(`resetMidDraw: 納刀の状態へ戻っていない ${JSON.stringify(r)}`);
  await v(`(() => { __valley.game.enemies.find(e => e.id === 'road_scout').dormant = true; return true; })()`);
  await step(10); r = await readState();                                                                     // 敵が気づいていなければ、納刀のまま
  if (!(r.mode.mode === 'sheathed' && !r.drawn && !r.rigActive)) fails.push(`resetMidDraw: やり直しのあとに勝手に抜いた ${JSON.stringify(r)}`);
  log(`resetMidDraw: ${JSON.stringify(r)}`);

  if (fails.length) throw new Error('実ゲームの抜刀・納刀の回帰が不合格:\n  ' + fails.join('\n  '));
  log('OK: 7 game cases');
}
