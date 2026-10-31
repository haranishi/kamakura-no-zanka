// 回帰と測定：命中した敵の押し戻し（8.4a・knockback.js）と、とどめ・弾きの軽いスロー（8.5a・time-warp.js）を実ゲームで確かめる（R18.12）。
//   1 押す距離：弱0.2m・強い技0.25m・侍大将は半分（相手は動かさない。主人公の踏み込みは届かない2.0mから）
//   2 三連の間合い：相手まで1.2／1.6／2.0／間合いの端で、弱→弱→三段目の3発とも当たる（押しても3発目が空振りしない）
//   3 壁：背を壁に付けた相手を斬っても、当たりの箱へめり込まない／4 崖：歩ける斜度（46度）より急な下りへ押さない
//   5 そばの人：押された人は、ほかの人（休んでいる人も）へ中心0.72mより近づかない。ほかの人は押されない
//   6 スロー：弾き・とどめで、停止（0.05倍）のあとに約0.25秒（60コマ/秒で15コマ）。停止と掛け算しない。普通の当たりでは出ない
//   7 揺れ0・動きを減らす：スローの長さと押す距離は同じ（停止は前から半分）
//   8 難度の測定（合否なし）：同じ操作の手（受け・弾き・弱の連打・とどめ）で斥候・侍大将と4回ずつ戦い、押し戻し・スローの有無で、
//     受けた当たり・三連の成立・弾き・倒すまでの秒を比べる
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-impact.mjs --seed 1333 --strict（KZ_OUT=<json> で記録）
import fs from 'node:fs';

export default async function ({ st, step, call, v, freeze, start, log }) {
  await start('new'); await freeze(true); await step(40); await call('god', true);
  const adv = async () => { for (let i = 0; i < 60; i++) { const s = await st(); if (s.talking) { await call('advanceDialogue', true); await step(10); } else if (s.pending) await step(30); else break; } };
  for (const e of [{ type: 'enter_zone', zone: 'temple_yard' }, { type: 'dialogue_end', id: 'boy_arrives' }]) await call('dispatch', e);
  await adv(); await step(20);
  await v(`(async () => {
    const g = __valley.game, C = await import('/valley/collision.js'), { mulberry32 } = await import('/valley/scatter.js'), { SLOW } = await import('/valley/time-warp.js');
    const { FEEL } = await import('/valley/config.js'), { MOVES } = await import('/valley/combat.js');
    g.makeEnemies('village_enemies', { alert: 'unaware', dormant: true });
    const inp = g.input, H = -Math.PI / 2, ActorProto = Object.getPrototypeOf(Object.getPrototypeOf(g.hero)), knockReal = ActorProto.knockBack;
    const freeze = e => { e.apply = function (intent, dt) { return Object.getPrototypeOf(this).apply.call(this, { ...intent, startMove: null, move: null }, dt); }; };
    const ready = (e, x, z, yaw, frozen = true) => { e.place(x, z, yaw); e.dormant = false; e.brain.state = 'combat'; e.brain.awareness = 1; e.fighter.aware = true;
      const f = e.fighter; f.hp = f.hpMax; f.posture = f.postureMax; f.state = 'idle'; f.move = null; f.blocking = false; f.alive = true; f.staggerT = 0; f.pendingEvents.length = 0;
      e.lunge = null; e.recoverT = 0; e.deadT = 0; e.speedNow = 0; if (frozen) freeze(e); else delete e.apply; };
    const park = () => { g.lock = null; g.hero.lockTarget = null; g.enemies.forEach((e, i) => { e.dormant = true; e.place(-80 - i * 2, -80, 0); delete e.apply; delete e.knockBack; }); };
    const heroAt = (x, z, yaw) => { const h = g.hero; h.place(x, z, yaw); h.fighter.yaw = yaw; h.sheatheIn = 30; g.rig.yaw = yaw; g.rig.snap();
      const f = h.fighter; f.state = 'idle'; f.move = null; f.blocking = false; f.hp = f.hpMax; f.posture = f.postureMax; f.counterT = 0; f.staggerT = 0;
      h.lunge = null; h.dash = null; h.queued = null; h.dodge = null; h.lockT = 0; h.recoverT = 0; h.drawSword({ fast: true }); };
    const up = () => { inp.mouse.delete(0); for (const k of ['KeyF', 'KeyE', 'Space']) inp.held.delete(k); };
    const allUp = () => { up(); inp.mouse.delete(2); inp.held.delete('KeyW'); };
    const click = () => { inp.mousePressed.add(0); inp.mouse.add(0); };
    const press = k => { inp.pressed.add(k); inp.held.add(k); };
    // 1コマ＝ g.update(1/60)。スロー・停止の速さは contactTimeScale（そのコマの dt ÷ 実時間）
    const scales = [];
    const frames = (n, each) => { for (let i = 0; i < n; i++) { each?.(i); g.update(1 / 60); scales.push(g.contactTimeScale); up(); } };
    const hits = [], realStrike = g.battle.onStrike.bind(g.battle);
    g.battle.onStrike = (att, def, res, o) => { hits.push({ att: att.id, def: def.id, move: res.moveId, outcome: res.outcome, d: Math.hypot(att.pos.x - def.pos.x, att.pos.z - def.pos.z) }); return realStrike(att, def, res, o); };
    const scout = () => g.enemies.find(e => e.id === 'road_scout'), byId = id => g.enemies.find(e => e.id === id);
    const others = () => g.enemies.filter(e => e.id !== 'road_scout' && e.kind === 'soldier');
    const timing = () => {   // 停止・スローのコマ数（60コマ/秒）
      const stop = scales.filter(s => Math.abs(s - FEEL.hitStopScale) < 1e-9).length, slow = scales.filter(s => s > FEEL.hitStopScale + 1e-9 && s < 1 - 1e-9);
      return { stop, slow: slow.length, slowMin: slow.length ? +Math.min(...slow).toFixed(4) : null, minScale: +Math.min(...scales).toFixed(4) };
    };
    window.__ri = {
      // 1：押す距離
      knock(id, key, D = 2.0) {
        park(); heroAt(-30, -6, H); const h = g.hero, e = byId(id); ready(e, h.pos.x + D, h.pos.z, -H);
        frames(10); const p0 = { ...e.pos }; hits.length = 0;
        frames(70, i => { if (i === 0) key === 'heavy' ? press('KeyF') : click(); });
        const hit = hits.find(x => x.def === e.id);
        return { outcome: hit?.outcome || null, move: hit?.move || null, push: +(e.pos.x - p0.x).toFixed(4), side: +(e.pos.z - p0.z).toFixed(4) };
      },
      // 2：三連（相手は動かず、技も出さない）
      combo(D) {
        park(); heroAt(-30, -6, H); const h = g.hero, e = scout(); ready(e, h.pos.x + D, h.pos.z, -H);
        frames(10); hits.length = 0;
        frames(110, i => { if (i === 0 || i === 20 || i === 44) click(); });
        const got = hits.filter(x => x.def === e.id && x.outcome === 'hit');
        return { D, moves: got.map(x => x.move), dists: got.map(x => +x.d.toFixed(3)) };
      },
      // 3：壁（大きな当たりの箱へ +x で寄って止まった所に相手。主人公はその手前1.8m）
      wall() {
        park(); const col = g.col;
        const box = col.boxes.filter(b => b.hx > 1.5 && b.hz > 1.5).sort((a, b) => Math.hypot(a.x + 30, a.z + 6) - Math.hypot(b.x + 30, b.z + 6))[0];
        const fx = box.x - Math.max(box.hx, box.hz) - 5, fz = box.z;
        const free = C.moveActor(col, g.terrain, { x: fx, y: g.terrain.heightAt(fx, fz), z: fz }, 14, 0, 0.3);
        heroAt(free.x - 1.8, free.z, H); const e = scout(); ready(e, free.x, free.z, -H);
        frames(10); const p0 = { ...e.pos }; hits.length = 0; let worst = 0;
        frames(60, i => { if (i === 0) click(); const o = C.pushOut(col, g.terrain, e.pos, e.radius); worst = Math.max(worst, Math.hypot(o.x - e.pos.x, o.z - e.pos.z)); });
        return { blocked: free.blocked, hit: hits.some(x => x.def === e.id && x.outcome === 'hit'), moved: +Math.hypot(e.pos.x - p0.x, e.pos.z - p0.z).toFixed(4), penetration: +worst.toFixed(4) };
      },
      // 4：崖（押す向きへ、歩ける斜度より急な下り）。土手のある所を中心に探す。押す前に、押す向きへ出られる長さを測る
      cliff() {
        park(); const col = g.col, T = g.terrain; let spot = null;
        const opt = { maxDownSlope: 46 };
        for (const [cx, cz] of [[-64.2, -25], [-38.4, -43.5], [-30, -6]]) for (let r = 0.5; r < 24 && !spot; r += 0.5) for (let k = 0; k < 48 && !spot; k++) {
          const x = cx + Math.cos(k / 48 * Math.PI * 2) * r, z = cz + Math.sin(k / 48 * Math.PI * 2) * r, y = T.heightAt(x, z);
          if (T.slopeAt(x, z) > 40 || T.waterAt(x, z) > 0.2) continue;
          for (let j = 0; j < 16 && !spot; j++) { const a = j / 16 * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
            const m = C.moveActor(col, T, { x, y, z }, dx, dz, 0.3, opt), along = (m.x - x) * dx + (m.z - z) * dz;
            if (m.blocked !== 'slope' || !(along > 0.02 && along < 0.15)) continue;                                  // 押す距離（0.2m）より手前で止まる所
            if (!(T.heightAt(x + dx * (along + 0.4), z + dz * (along + 0.4)) < y - 0.15)) continue;          // 先は下り
            const loose = C.moveActor(col, T, { x, y, z }, dx, dz, 0.3), looseAlong = (loose.x - x) * dx + (loose.z - z) * dz;
            const back = C.moveActor(col, T, { x, y, z }, -dx * 1.8, -dz * 1.8, 0.3);
            if (!back.blocked && looseAlong > along + 0.1) spot = { x, z, dx, dz, along, looseAlong }; } }
        if (!spot) return { found: false };
        const yaw = Math.atan2(-spot.dx, -spot.dz); heroAt(spot.x - spot.dx * 1.8, spot.z - spot.dz * 1.8, yaw);
        const e = scout(); ready(e, spot.x, spot.z, yaw + Math.PI);
        frames(10); hits.length = 0; let over = -9, steepest = 0;
        frames(60, i => { if (i === 0) click(); over = Math.max(over, (e.pos.x - spot.x) * spot.dx + (e.pos.z - spot.z) * spot.dz - spot.along); steepest = Math.max(steepest, T.slopeAt(e.pos.x, e.pos.z)); });
        return { found: true, at: [+spot.x.toFixed(2), +spot.z.toFixed(2)], freeAlong: +spot.along.toFixed(3), walkAlong: +spot.looseAlong.toFixed(3), hit: hits.some(x => x.def === e.id && x.outcome === 'hit'),
          overshoot: +over.toFixed(4), steepest: +steepest.toFixed(1), startSlope: +T.slopeAt(spot.x, spot.z).toFixed(1) };
      },
      // 5：そばの人（押す向きの0.85m先に、休んでいる兵＝人どうしの押し分けの外）
      bystander() {
        park(); heroAt(-30, -6, H); const h = g.hero, e = scout(), by = others()[0]; ready(e, h.pos.x + 2.0, h.pos.z, -H);   // そばの人は主人公の間合いの外（2.85m）
        ready(by, e.pos.x + 0.85, e.pos.z + 0.05, -H); by.dormant = true;
        frames(10); const b0 = { ...by.pos }, p0 = { ...e.pos }; hits.length = 0; let nearest = 9;
        frames(60, i => { if (i === 0) click(); nearest = Math.min(nearest, Math.hypot(e.pos.x - by.pos.x, e.pos.z - by.pos.z)); });
        return { hit: hits.some(x => x.def === e.id && x.outcome === 'hit'), nearest: +nearest.toFixed(4), pushed: +(e.pos.x - p0.x).toFixed(4), bystanderMoved: +Math.hypot(by.pos.x - b0.x, by.pos.z - b0.z).toFixed(4) };
      },
      // 6：弾き（斥候の袈裟を、振りの7コマ前に受けて弾く）
      parry() {
        park(); heroAt(-30, -6, H); const h = g.hero, e = scout(); ready(e, h.pos.x + 1.8, h.pos.z, -H);
        frames(10); hits.length = 0;
        const f = e.fighter; f.move = { id: 'soldier_slash', t: 0, phase: 'windup', struck: [], targetId: null }; f.state = 'attack'; f.telegraphing = true; f.noRegenT = 1.2;
        f.pendingEvents.push({ type: 'phase', id: f.id, moveId: 'soldier_slash', phase: 'windup' }); e.beginMove('soldier_slash'); e.chainRoll = 9;
        scales.length = 0;
        frames(90, i => { if (i === 26) { inp.mousePressed.add(2); inp.mouse.add(2); } if (i === 70) inp.mouse.delete(2); });
        inp.mouse.delete(2);
        return { outcome: hits.find(x => x.def === 'hero')?.outcome || null, ...timing() };
      },
      // 6：とどめ（崩れた斥候の前で E）
      finisher() {
        park(); heroAt(-30, -6, H); const h = g.hero, e = scout(); ready(e, h.pos.x + 1.6, h.pos.z, -H);
        const f = e.fighter; f.state = 'stagger'; f.staggerT = 2.2; f.posture = 0; e.onCombatEvent({ type: 'stagger_start' });
        frames(30); hits.length = 0; scales.length = 0; const p0 = { ...e.pos }, dbg = [];
        frames(120, i => { if (i === 0) press('KeyE'); if (i < 4 || i === 20) { const c = g.controlFrame(); dbg.push([i, h.fighter.state, !!h.dash, f.state, c.talking, c.frozen, h.lockT, g.flow, +Math.hypot(e.pos.x - h.pos.x, e.pos.z - h.pos.z).toFixed(2)]); } });
        const hit = hits.find(x => x.def === e.id);
        return { outcome: hit?.outcome || null, move: hit?.move || null, dead: !f.alive, push: +(e.pos.x - p0.x).toFixed(4), ...timing(), dbg: hit ? undefined : dbg };
      },
      // 6：普通の当たり（弱）にはスローが出ない
      plain() {
        park(); heroAt(-30, -6, H); const h = g.hero, e = scout(); ready(e, h.pos.x + 2.0, h.pos.z, -H);
        frames(10); hits.length = 0; scales.length = 0;
        frames(60, i => { if (i === 0) click(); });
        return { outcome: hits.find(x => x.def === e.id)?.outcome || null, ...timing() };
      },
      settings(on) { g.settings.shake = on ? 0 : 1; g.rig.shakeScale = on ? 0 : 1; g.settings.reducedMotion = on ? true : undefined; },
      // 8：難度の測定。cfg.knock / cfg.slow が false なら止める。手：相手の技の6割に応じる（どの技に応じるかは試行ごとの別の乱数で決め、
      // 押し戻しの有無で変えない）。応じる技の予備の間は斬りに行かず、振りの0.12秒前に受ける（弾き）。崩れたらとどめ、間合い（2.1m）なら弱を20コマごと（三連）、遠ければ前へ。
      // 相手は普通に考えて動く。主人公は倒れない（受けた当たりを数える）
      fight(id, trial, cfg) {
        // 任務は進めない（倒した知らせで里が片づいたことになり、会話や結果の画面で操作が止まって、後の試行が戦えなかった）
        const quest = { reportDown: g.reportDown, dispatch: g.dispatch }; g.reportDown = () => {}; g.dispatch = () => {};
        if (g.flow !== 'play' || g.hud.talking || g.pendingDialogue) return { id, trial, error: 'not-playing:' + g.flow };
        park(); heroAt(-30, -6, H); const h = g.hero, e = byId(id);
        g.rng = mulberry32(4000 + trial * 17);
        ready(e, h.pos.x + 3.2 + 0.3 * trial, h.pos.z + ((trial % 3) - 1) * 0.9, -H, false);
        if (cfg.knock === false) e.knockBack = () => false;
        if (cfg.slow === false) g.slowMo = () => {};
        g.lock = e; h.lockTarget = e;
        hits.length = 0; scales.length = 0;
        let n = 0, lastClick = -99, real = 0, lastMv = null, react = false;
        const hf = h.fighter, ef = e.fighter, t0 = g.time, coin = mulberry32(9000 + trial * 31);
        for (; n < 1800 && ef.alive; n++) {
          const d = Math.hypot(e.pos.x - h.pos.x, e.pos.z - h.pos.z), mv = ef.move;
          if (mv && mv !== lastMv) { lastMv = mv; react = coin() < 0.6; }
          const winding = react && ef.state === 'attack' && mv && mv.phase === 'windup' && d < 3.2, threat = winding && MOVES[mv.id].windup - mv.t <= 0.12;
          if (threat) { if (!inp.mouse.has(2)) inp.mousePressed.add(2); inp.mouse.add(2); inp.held.delete('KeyW'); }
          else if (inp.mouse.has(2) && !(ef.state === 'attack' && mv && mv.phase === 'active')) inp.mouse.delete(2);
          if (!inp.mouse.has(2)) {
            if (ef.state === 'stagger' && d < 3.3) { press('KeyE'); inp.held.delete('KeyW'); }
            else if (d <= 2.1) { inp.held.delete('KeyW'); if (!winding && n - lastClick >= 20 && hf.state !== 'stagger') { click(); lastClick = n; } }
            else { g.rig.yaw = Math.atan2(-(e.pos.x - h.pos.x), -(e.pos.z - h.pos.z)); inp.held.add('KeyW'); }
          }
          g.update(1 / 60); real += 1 / 60; scales.push(g.contactTimeScale); up();
        }
        allUp(); delete e.knockBack; delete g.slowMo; g.lock = null; h.lockTarget = null; g.reportDown = quest.reportDown; g.dispatch = quest.dispatch;
        const mine = hits.filter(x => x.att === 'hero' && x.def === e.id), taken = hits.filter(x => x.def === 'hero');
        const l1 = mine.filter(x => x.move === 'light1' && x.outcome === 'hit').length, l3 = mine.filter(x => x.move === 'light3' && x.outcome === 'hit').length;
        return { id, trial, killed: !ef.alive, seconds: +real.toFixed(2), gameSeconds: +(g.time - t0).toFixed(2), taken: taken.filter(x => x.outcome === 'hit').length,
          blocked: taken.filter(x => x.outcome === 'blocked').length, parried: taken.filter(x => x.outcome === 'parried').length,
          light1: l1, light3: l3, finisher: mine.filter(x => x.move === 'finisher').length, landed: mine.filter(x => x.outcome === 'hit').length, slowFrames: timing().slow };
      },
    };
    return true;
  })()`);
  const fails = [], R = {};
  const check = (ok, msg) => { if (!ok) fails.push(msg); };
  // 1
  R.knock = {
    soldierLight: await v(`__ri.knock('road_scout', 'light')`), soldierHeavy: await v(`__ri.knock('road_scout', 'heavy')`),
    officerLight: await v(`__ri.knock('officer', 'light')`), officerHeavy: await v(`__ri.knock('officer', 'heavy')`),
  };
  for (const [k, want] of [['soldierLight', 0.2], ['soldierHeavy', 0.25], ['officerLight', 0.1], ['officerHeavy', 0.125]]) {
    const r = R.knock[k];
    check(r.outcome === 'hit' && Math.abs(r.push - want) < 0.01 && Math.abs(r.side) < 0.01, `押す距離 ${k}: ${JSON.stringify(r)}（${want}m）`);
  }
  // 2
  R.combo = [];
  for (const D of [1.2, 1.6, 2.0, 2.15]) R.combo.push(await v(`__ri.combo(${D})`));
  for (const c of R.combo) check(c.moves.join() === 'light1,light2,light3', `三連が切れた D${c.D}: ${JSON.stringify(c)}`);
  // 3〜5
  R.wall = await v('__ri.wall()');
  check(R.wall.hit && R.wall.penetration < 0.01, `壁：${JSON.stringify(R.wall)}`);
  R.cliff = await v('__ri.cliff()');
  check(R.cliff.found, '崖の場所が見つからない（場面の前提が崩れた）');
  if (R.cliff.found) check(R.cliff.hit && R.cliff.overshoot < 0.02, `崖：${JSON.stringify(R.cliff)}`);
  R.bystander = await v('__ri.bystander()');
  check(R.bystander.hit && R.bystander.nearest >= 0.72 - 1e-3 && R.bystander.bystanderMoved < 1e-6, `そばの人：${JSON.stringify(R.bystander)}`);
  // 6
  R.parry = await v('__ri.parry()'); R.finisher = await v('__ri.finisher()'); R.plain = await v('__ri.plain()');
  check(R.parry.outcome === 'parried' && R.parry.slow >= 14 && R.parry.slow <= 16 && R.parry.slowMin >= 0.3 - 1e-6 && R.parry.minScale >= 0.05 - 1e-9, `弾きのスロー：${JSON.stringify(R.parry)}`);
  check(R.finisher.outcome === 'hit' && R.finisher.move === 'finisher' && R.finisher.slow >= 14 && R.finisher.slow <= 16 && R.finisher.slowMin >= 0.3 - 1e-6, `とどめのスロー：${JSON.stringify(R.finisher)}`);
  check(R.finisher.dead && R.finisher.push > 0.2, `とどめで倒れた体も押す：${JSON.stringify(R.finisher)}`);
  check(R.plain.outcome === 'hit' && R.plain.slow === 0 && R.plain.stop > 0, `普通の当たりにスローが出た：${JSON.stringify(R.plain)}`);
  // 7
  await v('__ri.settings(true)');
  R.calm = { parry: await v('__ri.parry()'), knock: await v(`__ri.knock('road_scout', 'light')`) };
  await v('__ri.settings(false)');
  check(R.calm.parry.outcome === 'parried' && R.calm.parry.slow === R.parry.slow && R.calm.parry.stop < R.parry.stop, `揺れ0・動きを減らす：スロー ${JSON.stringify(R.calm.parry)}`);
  check(Math.abs(R.calm.knock.push - 0.2) < 0.01, `揺れ0・動きを減らす：押す距離 ${JSON.stringify(R.calm.knock)}`);
  log(`knock ${JSON.stringify(R.knock)}\ncombo ${JSON.stringify(R.combo)}\nwall ${JSON.stringify(R.wall)}\ncliff ${JSON.stringify(R.cliff)}\nbystander ${JSON.stringify(R.bystander)}`);
  log(`parry ${JSON.stringify(R.parry)} finisher ${JSON.stringify(R.finisher)} plain ${JSON.stringify(R.plain)} calm ${JSON.stringify(R.calm)}`);
  // 8 難度（合否なし。記録して比べる）
  if (process.env.KZ_FIGHT !== '0') {
    R.fights = {};
    for (const [name, cfg] of [['off', { knock: false, slow: false }], ['knock', { knock: true, slow: false }], ['on', { knock: true, slow: true }]]) {
      R.fights[name] = [];
      for (const id of ['road_scout', 'officer']) for (let t = 0; t < 4; t++) R.fights[name].push(await v(`__ri.fight(${JSON.stringify(id)}, ${t}, ${JSON.stringify(cfg)})`));
    }
    const sum = (list, id) => { const l = list.filter(r => r.id === id), s = k => l.reduce((a, r) => a + r[k], 0);
      return { fights: l.length, killed: l.filter(r => r.killed).length, seconds: +(s('seconds') / l.length).toFixed(2), taken: s('taken'), blocked: s('blocked'), parried: s('parried'), light1: s('light1'), light3: s('light3'), comboRate: s('light1') ? +(s('light3') / s('light1')).toFixed(2) : null, finisher: s('finisher') }; };
    R.difficulty = Object.fromEntries(Object.entries(R.fights).map(([k, list]) => [k, { scout: sum(list, 'road_scout'), officer: sum(list, 'officer') }]));
    log(`difficulty ${JSON.stringify(R.difficulty)}`);
  }
  if (process.env.KZ_OUT) fs.writeFileSync(process.env.KZ_OUT, JSON.stringify({ seed: 1333, results: R, fails }, null, 1) + '\n');
  if (fails.length) throw Error('FAIL\n' + fails.join('\n'));
  log('regress-impact: all checks passed');
}
