// 回帰：刃の軌跡（8.3a）を実ゲームで毎コマ確かめる。主人公・斥候・侍大将を本物の結線で動かし、帯の決まりを見る:
//   区間の外（戻りを含む）では帯を足さない／技が判定を抜ける・死ぬと0.05秒＋1コマで消える／命中の停止中に詰まらない・引き伸ばさない／ちらつかない
//   第2周：停止のコマで刃が頭の上にない／火花は刃が体を通る点から刃の進む向きへ／弾きは刃同士が触れる点／敵の刃は予兆の間だけ照る／ひるみは相手から離れる向き
//   抜刀の層が動いている間は主人公の帯を足さない／やり直しで全部消える／揺れ0・動きを減らすでも出る
//   同時6本・頂点の上限／毎コマ配列を作り直さない（同じ配列・形の数が増えない）／描画呼出の増加は1
//   三段目：停止の長さは前と同じ（0.07秒）・強い当たりの音／弾き：火花が相手の刃の向きへ偏る（22粒）
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-slash-trail.mjs --seed 1333 --strict
// KZ_OUT=<json> で毎コマの記録と結果を残す。
import fs from 'node:fs';

export default async function ({ st, step, call, v, freeze, start, log }) {
  await start('new'); await freeze(true); await step(40); await call('god', true);
  const adv = async () => { for (let i = 0; i < 60; i++) { const s = await st(); if (s.talking) { await call('advanceDialogue', true); await step(10); } else if (s.pending) await step(30); else break; } };
  for (const e of [{ type: 'enter_zone', zone: 'temple_yard' }, { type: 'dialogue_end', id: 'boy_arrives' }]) await call('dispatch', e);
  await adv(); await step(20);
  const fails = [], results = {};
  const ok = await v(`(async () => {
    const g = __valley.game, T = g.fx.trails, { MOVES } = await import('/valley/combat.js'), ST = await import('/valley/slash-trail.js'), { FEEL } = await import('/valley/config.js');
    g.makeEnemies('village_enemies', { alert: 'unaware', dormant: true });
    const arrays = { position: T.out.position, attr: T.geometry.attributes.position.array, index: T.geometry.index.array };
    const sampled = [];                                           // このコマに足した帯の持ち主
    const realSample = T.sample.bind(T);
    T.sample = (owner, style, holder) => { sampled.push(owner); realSample(owner, style, holder); };
    const sounds = []; const realPlay = g.audio.play.bind(g.audio); g.audio.play = (name, o) => { sounds.push([g.time, name]); return realPlay(name, o); };
    // 当たりの火花（第2周）：点・刃の進む向き・出た粒の速度と、そのときの主人公の刀の切先の高さを控える
    const hits = [], realHit = g.fx.hit.bind(g.fx), V3 = g.hero.character.root.position.constructor;
    g.fx.hit = (pos, dir, o = {}) => { const n0 = g.fx.add.count; realHit(pos, dir, o); const vel = []; for (let k = n0; k < g.fx.add.count - 1; k++) vel.push([g.fx.add.vel[k * 3], g.fx.add.vel[k * 3 + 1], g.fx.add.vel[k * 3 + 2]]);
      const hw = g.hero.character.weapons.tachiDrawn.holder; hw.updateWorldMatrix(true, false); const e = hw.matrixWorld.elements;
      hits.push({ t: g.time, pos: [pos.x, pos.y, pos.z], travel: o.travel ? Array.from(o.travel) : null, vel, heroMove: g.hero.fighter.move ? g.hero.fighter.move.id : null, heroTipAboveGround: e[5] * 0.88 + e[13] - g.hero.pos.y }); };
    const actors = () => [g.hero, ...g.enemies];
    window.__rt = {
      MOVES, ST, FEEL, sounds, hits, arrays, geometries0: g.renderer.info.memory.geometries, V3,
      park() { for (const e of g.enemies) { e.dormant = true; e.place(-80, -80, 0); delete e.apply; } },
      hero() { const h = g.hero; h.place(-30, -6, -Math.PI / 2); h.fighter.yaw = h.yaw; h.sheatheIn = 30; g.rig.yaw = h.yaw; g.rig.snap(); },
      foe(id, passive) {
        const h = g.hero, e = g.enemies.find(e => e.id === id), f = e.fighter;
        e.place(h.pos.x + 2.2, h.pos.z, Math.PI / 2); e.dormant = false; e.brain.state = 'combat'; e.brain.awareness = 1; f.aware = true;
        f.hp = f.hpMax; f.posture = f.postureMax; f.state = 'idle'; f.move = null; f.blocking = false; f.alive = true; e.lunge = null; e.recoverT = 0;
        if (passive) e.apply = function (intent, dt) { return Object.getPrototypeOf(this).apply.call(this, { ...intent, startMove: null }, dt); }; else delete e.apply;
        return e;
      },
      force(id, moveId) {
        const e = g.enemies.find(e => e.id === id), f = e.fighter;
        f.move = { id: moveId, t: 0, phase: 'windup', struck: [], targetId: null }; f.state = 'attack'; f.telegraphing = MOVES[moveId].telegraph > 0; f.noRegenT = 1.2;
        f.pendingEvents.push({ type: 'phase', id: f.id, moveId, phase: 'windup' }); e.beginMove(moveId); e.chainRoll = 9;
      },
      // 1コマ進めて、そのコマの記録を返す
      frame() {
        sampled.length = 0;
        __valley.step(1);
        const s = T.stats(), inWindow = [], layer = g.hero.character.sword?.active || false;
        for (const a of actors()) { const f = a.fighter, m = f.move && MOVES[f.move.id]; if (f.alive && m && m.kind === 'melee' && f.state === 'attack' && ST.inTrailWindow(m, f.move.t)) inWindow.push(f.move); }
        const heroMove = g.hero.fighter.move;
        return { t: g.time, stop: g.stopT > 0, open: s.open, active: s.active, samples: s.samples, vertices: s.vertices, triangles: s.triangles, cuts: s.cuts,
          sampledOutside: sampled.filter(o => !inWindow.includes(o) && !(o && o.t0 !== undefined)).length, sampledCount: sampled.length,
          heroSampledInLayer: layer && sampled.includes(heroMove) ? 1 : 0, layer, inWindow: inWindow.length,
          heroMove: heroMove ? heroMove.id + ':' + heroMove.phase : g.hero.fighter.state };
      },
      same() { return T.out.position === arrays.position && T.geometry.attributes.position.array === arrays.attr && T.geometry.index.array === arrays.index; },
      press(kind) { const i = g.input; if (kind === 'click') { i.mousePressed.add(0); i.mouse.add(0); } else if (kind === 'heavy') { i.pressed.add('KeyF'); i.held.add('KeyF'); } else if (kind === 'block') { i.mousePressed.add(2); i.mouse.add(2); } },
      unpress(all) { const i = g.input; i.mouse.delete(0); i.held.delete('KeyF'); if (all) i.mouse.delete(2); },
      callsDelta() {                                               // 帯を見せたままと、隠したときの描画呼出の差（同じコマを2回描く）
        g.render(0); const a = g.renderer.info.render.calls; const was = T.mesh.visible; T.mesh.visible = false; g.render(0); const b = g.renderer.info.render.calls; T.mesh.visible = was; g.render(0); return [a, b];
      },
    };
    __rt.park(); __rt.hero(); g.hero.drawSword({ fast: false });
    return true;
  })()`);
  if (!ok) throw Error('setup failed');
  const limits = await v('({ vertices: __rt.ST.TRAIL_VERTS, triangles: __rt.ST.TRAIL_INDICES / 3, closeFade: __rt.ST.TRAIL.closeFade })');
  await step(80);
  const run = async (n, per = async () => {}) => { const rec = []; for (let i = 0; i < n; i++) { await per(i); rec.push(await v('__rt.frame()')); } return rec; };
  const check = (name, rec, { allowOutside = 0 } = {}) => {
    const bad = (cond, msg) => { if (!cond) fails.push(`${name}: ${msg}`); };
    bad(rec.every(r => r.active <= 6 && r.vertices <= limits.vertices && r.triangles <= limits.triangles), '上限を超えた');
    bad(rec.reduce((n, r) => n + r.sampledOutside, 0) <= allowOutside, `区間の外で足した ${rec.reduce((n, r) => n + r.sampledOutside, 0)}`);
    bad(rec.every(r => r.heroSampledInLayer === 0), '抜刀の層の間に主人公の帯を足した');
    bad(rec.every(r => r.inWindow > 0 || r.open === 0), '区間の外なのに帯が開いたまま');
    // ちらつかない：誰かが区間の中にいるあいだに、帯が1コマだけ消えてまた出ることがない
    for (let i = 1; i < rec.length - 1; i++) if (rec[i - 1].inWindow && rec[i].inWindow && rec[i + 1].inWindow && rec[i - 1].vertices > 0 && rec[i].vertices === 0 && rec[i + 1].vertices > 0) bad(false, `帯が1コマ消えた（コマ${i}）`);
    // 停止中は、帯のサンプルが毎コマは増えない（詰まらない・引き伸ばさない）
    for (let i = 1; i < rec.length; i++) if (rec[i].stop && rec[i - 1].stop && rec[i].samples > rec[i - 1].samples + 1) bad(false, `停止中にサンプルが${rec[i].samples - rec[i - 1].samples}増えた（コマ${i}）`);
    // 最後に開いていたコマから、閉じたあとの薄れ（closeFade 0.05秒）＋1コマのうちに、帯が消える（戻りに残さない）
    const lastOpen = rec.findLastIndex(r => r.open > 0), gone = rec.findIndex((r, i) => i > lastOpen && r.vertices === 0);
    if (lastOpen >= 0) bad(gone > 0 && rec[gone].t - rec[lastOpen].t <= limits.closeFade + 2 / 60 + 1e-6, `消えるまで ${gone > 0 ? (rec[gone].t - rec[lastOpen].t).toFixed(3) : '消えない'}秒`);
    const maxV = Math.max(...rec.map(r => r.vertices)), stopFrames = rec.filter(r => r.stop).length, drawn = rec.filter(r => r.vertices > 0).length;
    results[name] = { frames: rec.length, drawnFrames: drawn, maxVertices: maxV, maxTriangles: Math.max(...rec.map(r => r.triangles)), maxActive: Math.max(...rec.map(r => r.active)), stopFrames, cuts: rec.at(-1).cuts };
    log(`${name}: frames ${rec.length} drawn ${drawn} maxVerts ${maxV} stop ${stopFrames} cuts ${rec.at(-1).cuts}`);
    return results[name];
  };

  // 1 主人公の三連（弱→弱→三段目）を、自分からは技を出さない斥候へ当てる。三段目の停止と音を見る
  await v(`(() => { __rt.park(); __rt.hero(); __rt.foe('road_scout', true); return true; })()`); await step(5);
  const t0 = await v('__valley.game.time');
  let rec = await run(110, async i => { if ([0, 20, 44].includes(i)) await v(`__rt.press('click')`); if ([1, 21, 45].includes(i)) await v('__rt.unpress()'); });
  const combo = check('combo', rec);
  if (combo.drawnFrames < 20) fails.push(`combo: 帯が見えたコマが少ない（${combo.drawnFrames}）`);
  if (combo.stopFrames < 3) fails.push(`combo: 命中の停止が起きていない（${combo.stopFrames}）`);
  const sounds = await v(`__rt.sounds.filter(s => s[0] >= ${t0}).map(s => s[1])`);
  results.combo.sounds = sounds.filter(s => /hit|swing/.test(s));
  if (!sounds.includes('hit_heavy')) fails.push('combo: 三段目の当たりが強い当たりの音にならない');
  if (sounds.filter(s => s === 'swing_heavy').length !== 1) fails.push(`combo: 三段目の振りの音が1回でない（${sounds.filter(s => s === 'swing_heavy').length}）`);

  // 2 三段目の停止の長さは前と同じ（hit=0.07秒）：三段目が当たったコマの直後の stopT を読む
  await v(`(() => { __rt.park(); __rt.hero(); __rt.foe('road_scout', true); return true; })()`); await step(40);
  const stop = await v(`(() => {
    const g = __valley.game, out = []; let seen = null;
    const real = g.hitStop.bind(g); g.hitStop = sec => { out.push([g.hero.fighter.move ? g.hero.fighter.move.id : null, sec]); real(sec); };
    for (let i = 0; i < 110; i++) { if ([0, 20, 44].includes(i)) __rt.press('click'); __valley.step(1); if ([0, 20, 44].includes(i)) __rt.unpress(); }
    g.hitStop = real; return out;
  })()`);
  results.hitStops = stop;
  const l3 = stop.find(s => s[0] === 'light3');
  if (!l3 || Math.abs(l3[1] - 0.07) > 1e-9) fails.push(`三段目の停止が0.07秒でない ${JSON.stringify(stop)}`);

  // 3 強斬り（一番強い帯）
  await v(`(() => { __rt.park(); __rt.hero(); __rt.foe('road_scout', true); return true; })()`); await step(40);
  rec = await run(80, async i => { if (i === 0) await v(`__rt.press('heavy')`); if (i === 1) await v('__rt.unpress()'); });
  check('heavy', rec);

  // 4 敵の技：斥候の袈裟・突き、侍大将の二段目（主人公は受けない＝当たる。神の守りで倒れない）。
  //   相手は自分からは次の技を出さない（出すと次の帯が続き、「技が終わると寿命のうちに消える」を確かめられない）
  for (const [who, move] of [['road_scout', 'soldier_slash'], ['road_scout', 'soldier_thrust'], ['officer', 'officer_b']]) {
    await v(`(() => { __rt.park(); __rt.hero(); __rt.foe(${JSON.stringify(who)}, true); __rt.force(${JSON.stringify(who)}, ${JSON.stringify(move)}); return true; })()`);
    rec = await run(110);
    const r = check(move, rec);
    if (r.drawnFrames < 5) fails.push(`${move}: 敵の帯が出ていない（${r.drawnFrames}）`);
  }

  // 5 兵の振りの途中で倒す → 帯は寿命のうちに消える（倒れた兵は刀を落とすので、以降の場面には使わない）
  await v(`(() => { __rt.park(); __rt.hero(); __rt.foe('village_soldier_1', true); __rt.force('village_soldier_1', 'soldier_slash'); return true; })()`);
  rec = await run(60, async i => { if (i === 36) await v(`(() => { const g = __valley.game, e = g.enemies.find(e => e.id === 'village_soldier_1'); e.fighter.hp = 0; e.fighter.alive = false; e.fighter.state = 'down'; e.die(); return true; })()`); });
  check('death-mid-swing', rec);
  if (rec[35].vertices === 0) fails.push('death-mid-swing: 倒す前に帯が出ていない');

  // 6 納刀のまま攻撃 → 速い抜刀の間（層が動いている間）は主人公の帯を足さない
  await v(`(async () => { const { GRIP } = await import('/valley/config.js'), h = __valley.game.hero; __rt.park(); __rt.hero();
    h.character.sword.reset(); h.swordLayer.reset('sheathed'); h.character.setTachi(GRIP, false); h.drawn = false; h.sheatheIn = 0; return true; })()`);
  await step(3);
  if (!(await v('(() => { const h = __valley.game.hero; return h.swordLayer.snapshot().mode === "sheathed" && !h.drawn && !h.character.weapons.tachiDrawn.holder.visible; })()'))) fails.push('attack-from-sheathed: 納刀から始まっていない');
  rec = await run(50, async i => { if (i === 0) await v(`__rt.press('click')`); if (i === 1) await v('__rt.unpress()'); });
  const draw = check('attack-from-sheathed', rec);
  results['attack-from-sheathed'].layerFrames = rec.filter(r => r.layer).length;
  if (!rec.some(r => r.layer)) fails.push('attack-from-sheathed: 抜刀の層が動いていない（場面の前提が崩れた）');
  if (draw.drawnFrames < 5) fails.push('attack-from-sheathed: 抜き終えたあとの帯が出ていない');

  // 7 揺れ0・動きを減らす：帯は出る
  await v(`(() => { const g = __valley.game; g.settings.shake = 0; g.rig.shakeScale = 0; g.settings.reducedMotion = true; __rt.park(); __rt.hero(); g.hero.drawSword({ fast: true }); __rt.foe('road_scout', true); return true; })()`); await step(20);
  rec = await run(60, async i => { if (i === 0) await v(`__rt.press('click')`); if (i === 1) await v('__rt.unpress()'); });
  const calm = check('shake0-reduced', rec);
  if (calm.drawnFrames < 5) fails.push('shake0-reduced: 帯が出ない');
  const shake = await v(`(() => { const g = __valley.game; return g.rig.shake; })()`);
  if (shake > 1e-6) fails.push(`shake0-reduced: 揺れ0なのに画面が揺れた（${shake}）`);
  await v(`(() => { const g = __valley.game; g.settings.shake = 1; g.rig.shakeScale = 1; g.settings.reducedMotion = undefined; return true; })()`);

  // 8 描画呼出の増加は1（帯を見せたまま／隠して同じコマを描く）
  await v(`(() => { __rt.park(); __rt.hero(); __rt.foe('road_scout', true); return true; })()`); await step(20);
  await v(`__rt.press('click')`); await step(1); await v('__rt.unpress()'); await step(12);
  const calls = await v('(() => { const s = __valley.game.fx.trails.stats(); return { vertices: s.vertices, calls: __rt.callsDelta() }; })()');
  results.calls = calls;
  if (!(calls.vertices > 0 && calls.calls[0] - calls.calls[1] === 1)) fails.push(`描画呼出の差が1でない ${JSON.stringify(calls)}`);

  // 9 弾き：火花（22粒）が相手の切先の速度の向きへ偏る
  await v(`(() => { __rt.park(); __rt.hero(); __rt.foe('road_scout', false); __rt.force('road_scout', 'soldier_slash'); return true; })()`);
  for (let i = 0; i < 26; i++) await step(1);
  await v(`__rt.press('block')`);
  const parry = await v(`(() => {
    const g = __valley.game, add = g.fx.add; let before = add.count, out = null; const real = g.fx.parry.bind(g.fx);
    g.fx.parry = (pos, dir, swing) => { const n0 = add.count; real(pos, dir, swing); out = { swing: swing ? Array.from(swing) : null, dir, emitted: add.count - n0, vel: [] }; for (let k = n0 + 1; k < add.count; k++) out.vel.push([add.vel[k * 3], add.vel[k * 3 + 1], add.vel[k * 3 + 2]]); };
    for (let i = 0; i < 20 && !out; i++) __valley.step(1);
    g.fx.parry = real; return out;
  })()`);
  await v('__rt.unpress(true)');
  if (!parry) fails.push('弾きが起きなかった');
  else {
    const s = parry.swing, mean = [0, 1, 2].map(c => parry.vel.reduce((a, p) => a + p[c], 0) / parry.vel.length);
    const unit = x => { const l = Math.hypot(...x) || 1; return x.map(c => c / l); };
    const ref = s && Math.hypot(...s) > 0.5 ? unit(s) : unit([parry.dir.x, 0, parry.dir.z]);
    const horiz = unit([mean[0], 0, mean[2]]), refH = unit([ref[0], 0, ref[2]]);
    const cos = horiz[0] * refH[0] + horiz[2] * refH[2], meanH = Math.hypot(mean[0], mean[2]);
    results.parry = { emitted: parry.emitted, swing: s && s.map(x => +x.toFixed(2)), meanVelocity: mean.map(x => +x.toFixed(2)), horizontalCos: +cos.toFixed(3), meanHorizontalSpeed: +meanH.toFixed(2) };
    log(`parry: ${JSON.stringify(results.parry)}`);
    if (parry.emitted !== 23) fails.push(`弾きの粒の数が前と違う（光1＋火花22＝23のはず：${parry.emitted}）`);
    if (!s) fails.push('弾き：相手の刃の速度が渡っていない（帯が無い）');
    if (!(cos > 0.7 && meanH > 2)) fails.push(`弾きの火花が刃の向きへ偏っていない ${JSON.stringify(results.parry)}`);
  }

  // 9b 弾き（第2周）：主人公の刀を相手の刃へ伸ばして打ち合わせる。2本の刃の距離が3cm以内
  const clash = await v('__valley.game.battle.lastClash');
  results.parryClash = clash;
  if (!(clash && clash.gap < 0.03)) fails.push(`弾き：刃同士が触れていない ${JSON.stringify(clash)}`);

  // 9c 当たりの火花（第2周）：三連・強斬りの当たりで、火花の8割が刃の進む向き（余弦0.5以上）へ散り、点は受けた人の胴の軸から0.25m以内。
  //    停止のコマ（当たり）で、主人公の刀の切先は地面から1.75m未満（頭の上ではない。第1周は2.06m）
  const hitsAll = await v('__rt.hits.map(h => ({ ...h }))');
  const strikes = hitsAll.filter(h => h.travel && h.heroMove);
  results.hitSparks = strikes.map(h => {
    const tl = Math.hypot(...h.travel), u = h.travel.map(x => x / tl);
    const along = h.vel.filter(q => (q[0] * u[0] + q[1] * u[1] + q[2] * u[2]) / (Math.hypot(...q) || 1) > 0.5).length;
    return { move: h.heroMove, alongShare: +(along / h.vel.length).toFixed(2), tipAboveGround: +h.heroTipAboveGround.toFixed(2) };
  });
  log(`hit sparks ${JSON.stringify(results.hitSparks)}`);
  if (strikes.length < 3) fails.push(`火花：刃の進む向きのある当たりが少ない（${strikes.length}）`);
  for (const h of results.hitSparks) {
    if (h.alongShare < 0.6) fails.push(`火花：刃の進む向きへ散っていない ${JSON.stringify(h)}`);
    if (['light1', 'light2', 'heavy'].includes(h.move) && h.tipAboveGround >= 1.75) fails.push(`停止のコマで刃が頭の上 ${JSON.stringify(h)}`);
  }

  // 9d 敵の刃の照り返し（第2周）：予兆の間（光の粒）は元の鋼、戻りの間は地の色を落とす
  await v(`(() => { __rt.park(); __rt.hero(); __rt.foe('road_scout', true); __rt.force('road_scout', 'soldier_slash'); return true; })()`);
  const blade = await v(`(() => { const g = __valley.game, e = g.enemies.find(e => e.id === 'road_scout'), m = e.character.weapons.tachiDrawn.object.getObjectByName('blade').material, out = [];
    for (let i = 0; i < 90; i++) { __valley.step(1); const f = e.fighter; out.push({ phase: f.move ? f.move.phase : f.state, glint: g.battle.glints.some(x => x.actor === e), color: m.color.getHex() }); }
    return out; })()`);
  const lit = blade.filter(b => b.glint), dark = blade.filter(b => b.phase === 'recover');
  results.bladeDim = { glintFrames: lit.length, glintColors: [...new Set(lit.map(b => b.color.toString(16)))], recoverFrames: dark.length, recoverColors: [...new Set(dark.map(b => b.color.toString(16)))] };
  if (!(lit.length > 5 && lit.every(b => b.color === 0xffffff))) fails.push(`予兆の間に刃が元の鋼でない ${JSON.stringify(results.bladeDim)}`);
  if (!(dark.length > 5 && dark.every(b => b.color === 0x9a9a9a))) fails.push(`戻りの間に刃が照っている ${JSON.stringify(results.bladeDim)}`);

  // 9e ひるみ（第2周）：鎧でひるまない一段目の当たりでも、相手の頭が主人公から離れる向きへ動く（0.15秒のうちに3cm以上）
  await v(`(() => { __rt.park(); __rt.hero(); __rt.foe('road_scout', true); return true; })()`); await step(20);
  const kick = await v(`(() => { const g = __valley.game, e = g.enemies.find(e => e.id === 'road_scout'), head = e.character.bones.get('Head');
    const at = () => { head.updateWorldMatrix(true, false); const m = head.matrixWorld.elements; return [m[12] - e.pos.x, m[14] - e.pos.z]; };
    const ux = e.pos.x - g.hero.pos.x, uz = e.pos.z - g.hero.pos.z, ul = Math.hypot(ux, uz);
    let hitAt = -1, base = null, best = -9, state = null; const hp0 = e.fighter.hp;
    __rt.press('click');
    for (let i = 0; i < 60; i++) { if (i === 1) __rt.unpress(); const before = at(); __valley.step(1);
      if (hitAt < 0 && e.fighter.hp < hp0) { hitAt = i; base = before; state = e.fighter.state; }
      if (hitAt >= 0 && i - hitAt <= 12) { const p = at(); best = Math.max(best, ((p[0] - base[0]) * ux + (p[1] - base[1]) * uz) / ul); } }
    return { hitAt, state, awayM: +best.toFixed(3) }; })()`);
  results.kick = kick;
  if (!(kick.hitAt >= 0 && kick.state !== 'hit' && kick.awayM > 0.03)) fails.push(`ひるみ：相手の頭が離れる向きへ動かない ${JSON.stringify(kick)}`);

  // 10 同時6本：主人公と敵5人（無理に出させる）で上限を超えない
  const many = await v(`(() => {
    const g = __valley.game; __rt.park(); __rt.hero();
    const ids = g.enemies.filter(e => e.kind !== 'archer' && e.character.weapons.tachiDrawn?.holder.visible).map(e => e.id);   // 刀を持っている兵だけ（倒した兵は刀を落としている）
    ids.forEach((id, k) => { const e = __rt.foe(id, false); e.place(g.hero.pos.x + 3 + k * 0.9, g.hero.pos.z + (k % 2 ? 2 : -2), Math.PI / 2); });
    ids.forEach(id => __rt.force(id, g.enemies.find(e => e.id === id).kind === 'officer' ? 'officer_a' : 'soldier_slash'));
    __rt.press('click'); __valley.step(1); __rt.unpress();
    let worst = 0, open = 0; for (let i = 0; i < 70; i++) { __valley.step(1); const s = g.fx.trails.stats(); worst = Math.max(worst, s.active); open = Math.max(open, s.open); }
    return { swingers: ids.length + 1, worst, maxOpen: open, stolen: g.fx.trails.stats().stolen };
  })()`);
  results.many = many;
  if (many.worst > 6) fails.push(`同時の帯が6本を超えた ${JSON.stringify(many)}`);

  // 11 やり直し：作り直しで全部消える。配列は作り直していない・形の数は増えていない
  await v(`(() => { __rt.park(); __rt.hero(); __rt.foe('road_scout', true); __rt.press('click'); return true; })()`); await step(1); await v('__rt.unpress()'); await step(14);
  const beforeReset = await v('__valley.game.fx.trails.stats().vertices');
  await v('(() => { __valley.game.startNew(); return true; })()');
  const afterReset = await v('(() => { const g = __valley.game; return { vertices: g.fx.trails.stats().vertices, active: g.fx.trails.stats().active, visible: g.fx.trails.mesh.visible }; })()');
  results.reset = { beforeReset, afterReset };
  if (!(beforeReset > 0 && afterReset.vertices === 0 && afterReset.active === 0 && !afterReset.visible)) fails.push(`やり直しで帯が残った ${JSON.stringify(results.reset)}`);
  const same = await v('__rt.same()'), geoms = await v('[__rt.geometries0, __valley.game.renderer.info.memory.geometries]');
  results.buffers = { sameArrays: same, geometries: geoms };
  if (!same) fails.push('帯の配列を作り直した');

  log(`results ${JSON.stringify(results)}`);
  if (process.env.KZ_OUT) fs.writeFileSync(process.env.KZ_OUT, JSON.stringify({ results, fails }, null, 1) + '\n');
  if (fails.length) throw Error('FAIL\n' + fails.join('\n'));
  log('regress-slash-trail: all checks passed');
}
