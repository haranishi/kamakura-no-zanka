// 回帰：実ゲームの主人公（HeroActor）の入力・戦闘・納刀・死亡の経路で、握り（hand-rig.js・8.6a）が毎コマ設計どおりに働くこと。
// regress-hand-grip.mjs は人物だけを動かす。ここは本物のゲームを本物の入力で動かし、主人公の見える手を毎コマ測る（tools/lib/hand-grip-metrics.mjs）。
//   場面：敵が気づいて落ち着いた抜刀／納刀のまま攻撃（速い抜刀）／戦闘が終わって自動の納刀（握りが解ける）／抜く途中に倒れる
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-hand-grip-game.mjs --seed 1333 --strict
import { HAND_LIMITS, createHandMetrics } from '../lib/hand-grip-metrics.mjs';
import { popScore } from '../lib/draw-sheathe-metrics.mjs';

const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

export default async function ({ st, step, call, v, freeze, start, click, release, log }) {
  await start('new'); await freeze(true); await step(40);
  await v(`(async () => { window.__hgMake = await (${createHandMetrics.toString()})(); return true; })()`);
  const adv = async () => { for (let i = 0; i < 60; i++) { const s = await st(); if (s.talking) { await call('advanceDialogue', true); await step(10); } else if (s.pending) await step(30); else break; } };
  const prepare = async () => {
    if ((await v('__valley.game.flow')) === 'idle') await start('new'); else await v('(() => { __valley.game.startNew(); return true; })()');
    await freeze(true); await step(40); await call('god', true);
    for (const e of [{ type: 'enter_zone', zone: 'temple_yard' }, { type: 'dialogue_end', id: 'boy_arrives' }]) await call('dispatch', e);
    await v(`(() => { const e = __valley.game.enemies.find(e => e.id === 'road_scout'); if (e) e.dormant = true; return true; })()`);
    await adv(); await step(20);
    const sc = (await st()).enemies.find(e => e.id === 'road_scout');
    await call('camera', null); await call('teleport', sc.x - 6, sc.z - 5, yawTo(6, 5)); await call('look', yawTo(6, 5), 0.22); await step(25);
    await v(`(() => { window.__hgRun = window.__hgMake(__valley.game.hero.character); return true; })()`);
  };
  const placeScout = (dx, dz, combat) => v(`(() => { const g = __valley.game, e = g.enemies.find(e => e.id === 'road_scout'), h = g.hero.pos; e.place(h.x + ${dx}, h.z + ${dz}, 0); ${combat ? "e.dormant = false; e.brain.state = 'combat'; e.brain.awareness = 1; e.fighter.aware = true;" : ''} })()`);
  const killScout = () => v(`(() => { const g = __valley.game, e = g.enemies.find(e => e.id === 'road_scout'); e.fighter.hp = 0; e.fighter.alive = false; e.fighter.state = 'down'; e.die(); g.reportDown(e, 'killed'); })()`);
  const probe = () => v(`(() => { const h = __valley.game.hero, r = h.character.hands.sides.Right; window.__hgRun.sample(null); return [h.swordLayer.snapshot().mode, +r.last.g.toFixed(3), r.last.reached, +(r.last.error * 1000).toFixed(1)]; })()`);
  const run = async (n, per = async () => {}) => { const trail = []; for (let i = 0; i < n; i++) { await per(i); await step(1); trail.push(await probe()); } return trail; };
  const finish = () => v(`(() => { const R = window.__hgRun.finish(null); const { tipTrace, ...rest } = R; return rest; })()`);
  const fails = [];
  // 跳びは、抜く途中に倒れる場面では見ない（8.2の層が、倒れたコマで抜き切った状態へ確定する設計。regress-draw-sheathe-game.mjs と同じ扱い）
  const judge = (name, R, trail, { pops = true } = {}) => {
    const chk = (cond, msg) => { if (!cond) fails.push(`${name}: ${msg}`); };
    chk(R.nan === 0, `NaN ${R.nan}`);
    for (const side of ['Right', 'Left']) chk(R.sinkAll[side] <= HAND_LIMITS.sinkMm, `${side} の手の皮のめり込み ${R.sinkAll[side].toFixed(1)}mm`);
    chk(R.maxArmDevMm <= HAND_LIMITS.armLenMm, `腕の写しの長さ ${R.maxArmDevMm.toFixed(3)}mm`);
    chk(R.copyLeakRad <= HAND_LIMITS.leakRad, `握っていない手の写しが動作の骨と違う ${R.copyLeakRad}`);
    if (pops) for (const k of ['wristR', 'wristRotR', 'tipR', 'wristL', 'wristRotL', 'tipL']) { const p = popScore(R.steps[k], /Rot/.test(k) ? HAND_LIMITS.popFloorRad : HAND_LIMITS.popFloorM).worst; chk(p <= HAND_LIMITS.popRatio, `${k} が1コマだけ跳ぶ（${p.toFixed(2)}倍）`); }
    const gripped = trail.filter(t => t[1] >= 0.999).length;
    log(`${name}: frames ${trail.length} gripped ${gripped} contact R ${R.contactFrames.Right} L ${R.contactFrames.Left} sink R ${R.sinkAll.Right.toFixed(1)} L ${R.sinkAll.Left.toFixed(1)}mm unreached ${R.unreached} (${R.maxReachErrMm.toFixed(1)}mm) → ${JSON.stringify(trail.at(-1))}`);
    return gripped;
  };

  // 1 敵が離れた所で気づく → 落ち着いた抜刀。抜き切ったら右手は柄を握り切り、抜く途中は左手が鞘を持つ
  await prepare(); await placeScout(14, 6, true);
  let trail = await run(100), R = await finish();
  if (!(judge('alertDraw', R, trail) > 30 && trail.at(-1)[0] === 'drawn' && R.contactFrames.Left > 0)) fails.push(`alertDraw: 握り切らない・鞘を持たない ${JSON.stringify(trail.at(-1))} 左手 ${R.contactFrames.Left}`);
  // 2 納刀のまま攻撃入力 → 速い抜刀と斬り。右手は最後まで柄を握る
  await prepare(); await placeScout(2.4, 0.9, false);
  trail = await run(60, async i => { if (i === 5) await click(0, true); if (i === 7) await release(0); }); R = await finish();
  if (!(judge('attackFromSheathed', R, trail) > 30 && trail.slice(20).every(t => t[1] >= 0.999))) fails.push('attackFromSheathed: 攻撃の間に柄を握り切らないコマがある');
  // 3 戦闘が終わって自動の納刀 → 納め切ったら握りが解け、写しは動作の骨へ戻る
  await prepare(); await placeScout(2.4, 0.9, false);
  await run(5, async i => { if (i === 1) await click(0, true); if (i === 3) await release(0); });
  await killScout(); await v(`(() => { __valley.game.hero.sheatheIn = 0.004; return true; })()`);
  await v(`(() => { window.__hgRun = window.__hgMake(__valley.game.hero.character); return true; })()`);
  trail = await run(150); R = await finish(); judge('autoSheathe', R, trail);
  if (!(trail.at(-1)[0] === 'sheathed' && trail.at(-1)[1] === 0)) fails.push(`autoSheathe: 納め切ったのに握りが残る ${JSON.stringify(trail.at(-1))}`);
  // 4 抜く途中に倒れる → 値が壊れず、層が終わる
  await prepare(); await placeScout(14, 6, true);
  await run(12); await call('god', false);
  await v(`(() => { const f = __valley.game.hero.fighter; f.hp = 0; f.alive = false; f.state = 'down'; return true; })()`);
  trail = await run(60); R = await finish(); judge('dieMidDraw', R, trail, { pops: false });
  if (!['drawn', 'sheathed'].includes(trail.at(-1)[0])) fails.push(`dieMidDraw: 途中のまま ${trail.at(-1)[0]}`);

  if (fails.length) throw new Error('実ゲームの握りの回帰が不合格:\n  ' + fails.join('\n  '));
  log('OK: 4 game cases');
}
