// 回帰：設定「血の表現」（R18.11・8.4b・blood.js）を実ゲームで確かめる。
//   1 同じ入力の戦い（三連→強斬り→崩してとどめ）を「なし／ひかえめ／標準」で回す：
//     なし＝血の粒0・しみ0／ひかえめ＝粒が0より多く64以下・しみ0／標準＝ひかえめより多く、しみが1以上16以下
//     描画呼出を足さない（物の数が同じ・血だけで点群が描かれるコマが無い）／戦闘の結果（体力・構え・状態・技・位置・当たりの結果の並び）が3段階で完全に一致
//   2 受けた・弾いた当たりでは血が出ない（刃が体に入った hit だけ）
//   3 軽量品質でも「ひかえめ」の粒が0にならない
//   4 乱戦の最悪（4人を連続して斬る＋1コマに30回の命中を詰める）でも、飛沫64・しみ16を超えない
//   5 保存→再読込で段階が戻る。未知の値は既定「ひかえめ」に戻る。揺れ0・動きを減らすでも段階は変わらない
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-blood.mjs --strict --out <フォルダ>（KZ_OUT=<json> で記録）
import fs from 'node:fs';

export default async function ({ page, st, step, v, call, freeze, start, log }) {
  const fails = [];
  const check = (ok, msg) => { if (!ok) fails.push(msg); log((ok ? 'ok   ' : 'FAIL ') + msg); };
  const boot = async () => {
    await start('new'); await freeze(true); await step(40); await call('god', true);
    const adv = async () => { for (let i = 0; i < 60; i++) { const s = await st(); if (s.talking) { await call('advanceDialogue', true); await step(10); } else if (s.pending) await step(30); else break; } };
    for (const e of [{ type: 'enter_zone', zone: 'temple_yard' }, { type: 'dialogue_end', id: 'boy_arrives' }]) await call('dispatch', e);
    await adv(); await step(20);
    await v(`(async () => {
      const g = __valley.game, { finish } = await import('/valley/combat.js');
      g.makeEnemies('village_enemies', { alert: 'unaware', dormant: true });
      for (const e of g.enemies) { e.dormant = true; e.place(-80, -80, 0); }
      const outcomes = [], real = g.battle.onStrike.bind(g.battle);
      g.battle.onStrike = (att, def, res, o) => { outcomes.push([att.id || 'hero', def.id || 'hero', res.moveId, res.outcome, !!res.dead]); return real(att, def, res, o); };
      const passive = e => { e.apply = function (intent, dt) { return Object.getPrototypeOf(this).apply.call(this, { ...intent, startMove: null, move: null }, dt); }; };
      window.__rb = {
        outcomes,
        reset(ids, dx = 2.0) {
          g.input.mouse.clear(); g.input.held.clear();
          const h = g.hero; h.place(-30, -6, -Math.PI / 2); h.fighter.yaw = h.yaw; h.sheatheIn = 30; g.rig.yaw = h.yaw; g.rig.snap();
          const hf = h.fighter; hf.state = 'idle'; hf.move = null; hf.blocking = false; hf.hp = hf.hpMax; hf.posture = hf.postureMax; hf.counterT = 0; hf.staggerT = 0;
          h.lunge = null; h.dash = null; h.queued = null; h.dodge = null; h.recoverT = 0; g.lock = null; h.lockTarget = null;
          g.enemies.forEach((e, i) => { e.dormant = true; e.place(-80 - i * 2, -80, 0); delete e.apply; });
          ids.forEach((id, k) => {
            const e = g.enemies.find(e => e.id === id), f = e.fighter;
            e.place(h.pos.x + dx + (k >> 1) * 0.5, h.pos.z + (k === 0 ? 0 : k % 2 ? 0.75 : -0.75) * Math.min(1, k), Math.PI / 2);
            e.dormant = false; e.brain.state = 'combat'; e.brain.awareness = 1; f.aware = true; passive(e);
            f.hp = f.hpMax; f.posture = f.postureMax; f.state = 'idle'; f.move = null; f.blocking = false; f.alive = true; f.staggerT = 0; f.pendingEvents.length = 0;
            e.lunge = null; e.recoverT = 0; e.deadT = 0; e.speedNow = 0;
          });
          h.drawSword({ fast: true });
          g.fx.clearBlood(); outcomes.length = 0;
          const mx = h.pos.x + 1.45; __valley.camera([mx - 0.4, 1.4, h.pos.z + 4.6], [mx, 1.05, h.pos.z], 40);
          return true;
        },
        stagger(id) { const e = g.enemies.find(e => e.id === id), f = e.fighter; f.state = 'stagger'; f.staggerT = 2.2; f.posture = 0; e.onCombatEvent({ type: 'stagger_start' }); return true; },
        finish(id) { const h = g.hero, e = g.enemies.find(e => e.id === id), f = h.fighter; h.faceTo(e); f.x = h.pos.x; f.z = h.pos.z; e.fighter.x = e.pos.x; e.fighter.z = e.pos.z; if (!finish(f, e.fighter)) return false; h.foe = e; h.beginMove('finisher', { aim: false }); return true; },
        row(ids) {
          const g2 = g, h = g2.hero.fighter, b = g2.fx.bloodStats(), r = n => Math.round(n * 1000) / 1000;
          return { calls: g2.renderer.info.render.calls, drops: b.drops, stains: b.stains, norm: g2.fx.norm.count,
            logic: [h.state, Math.round(h.hp * 100), Math.round(h.posture * 100), h.move?.id || null, h.move?.phase || null, r(g2.hero.pos.x), r(g2.hero.pos.z),
              ...ids.flatMap(id => { const e = g2.enemies.find(e => e.id === id), f = e.fighter; return [f.state, Math.round(f.hp * 100), Math.round(f.posture * 100), f.alive, r(e.pos.x), r(e.pos.z)]; })] };
        },
      };
      return true;
    })()`);
    await v(`(() => { __valley.setWaymarks('off'); return true; })()`);
  };
  await boot();

  const click = `(() => { const i = __valley.game.input; i.mousePressed.add(0); i.mouse.add(0); return true; })()`;
  const heavy = `(() => { const i = __valley.game.input; i.pressed.add('KeyF'); i.held.add('KeyF'); return true; })()`;
  const up = `(() => { const i = __valley.game.input; i.mouse.delete(0); i.held.delete('KeyF'); return true; })()`;
  // 1回の戦い：三連（0・20・44コマ）→強斬り（100）→崩してとどめ（170・175）。毎コマ記録
  const fight = async (level, ids = ['road_scout'], script = null) => {
    await v(`__valley.setBlood(${JSON.stringify(level)})`);
    await v(`__rb.reset(${JSON.stringify(ids)})`); await step(30);
    const plan = script || { 0: click, 20: click, 44: click, 100: heavy, 170: `__rb.stagger('road_scout')`, 176: `__rb.finish('road_scout')` };
    const last = script ? Math.max(...Object.keys(script).map(Number)) + 60 : 260, rows = [];
    for (let f = 0; f <= last; f++) {
      if (plan[f]) await v(plan[f]);
      await step(1);
      rows.push(await v(`__rb.row(${JSON.stringify(ids)})`));
      if (plan[f]) await v(up);
    }
    const outcomes = await v('__rb.outcomes.slice()');
    const objects = await v(`(() => { let n = 0; __valley.game.scene.traverse(() => n++); return n; })()`);
    return { rows, outcomes, objects, maxDrops: Math.max(...rows.map(r => r.drops)), maxStains: Math.max(...rows.map(r => r.stains)) };
  };

  const res = {};
  for (const lv of ['off', 'subtle', 'standard']) { res[lv] = await fight(lv); log(lv, 'maxDrops', res[lv].maxDrops, 'maxStains', res[lv].maxStains, 'outcomes', JSON.stringify(res[lv].outcomes)); }
  check(res.off.outcomes.some(o => o[3] === 'hit') && res.off.outcomes.some(o => o[4]), '戦いに刃の当たりと倒れがある');
  check(res.off.maxDrops === 0 && res.off.maxStains === 0, `なし：粒0・しみ0（${res.off.maxDrops}・${res.off.maxStains}）`);
  check(res.subtle.maxDrops > 0 && res.subtle.maxDrops <= 64 && res.subtle.maxStains === 0, `ひかえめ：粒 1〜64・しみ0（${res.subtle.maxDrops}・${res.subtle.maxStains}）`);
  check(res.standard.maxDrops > res.subtle.maxDrops && res.standard.maxDrops <= 64 && res.standard.maxStains >= 1 && res.standard.maxStains <= 16, `標準：粒がひかえめより多く64以下・しみ1〜16（${res.standard.maxDrops}・${res.standard.maxStains}）`);
  // 描画呼出：3回の戦いは別の時刻に回るので、景色（煙・人の動き・影）で呼出が毎コマ数個ゆれる（なしの段階どうしでもゆれる）。
  // そこで「血が呼出を足さない」ことを構造で確かめる：(a) 場面の物の数が3段階で同じ（新しい物を足していない）
  // (b) 血が出ているコマでは、通常の点群に血以外の粒（煙・土煙）もあり、その点群はどの段階でも描かれている（血だけで点群が描かれるコマが無い）
  const range = lv => `${Math.min(...res[lv].rows.map(r => r.calls))}〜${Math.max(...res[lv].rows.map(r => r.calls))}`;
  const sameObjects = res.subtle.objects === res.off.objects && res.standard.objects === res.off.objects;
  const alone = ['subtle', 'standard'].reduce((n, lv) => n + res[lv].rows.filter(r => r.drops + r.stains > 0 && r.norm <= r.drops + r.stains).length, 0);
  const offEmpty = res.off.rows.filter(r => r.norm === 0).length;
  check(sameObjects && alone === 0, `描画呼出を足さない：場面の物の数 ${res.off.objects}/${res.subtle.objects}/${res.standard.objects}・血だけで点群が描かれるコマ ${alone}（なしの段階で点群が空のコマ ${offEmpty}）・呼出の範囲 なし${range('off')} ひかえめ${range('subtle')} 標準${range('standard')}`);
  const logicSame = ['subtle', 'standard'].every(lv => JSON.stringify(res[lv].rows.map(r => r.logic)) === JSON.stringify(res.off.rows.map(r => r.logic)) && JSON.stringify(res[lv].outcomes) === JSON.stringify(res.off.outcomes));
  check(logicSame, `戦闘の結果（体力・構え・状態・技・位置・当たりの並び）が3段階で一致（${res.off.rows.length}コマ・当たり${res.off.outcomes.length}）`);

  // 2 受け・弾きでは出ない：敵に受けさせる（構えて受ける）。主人公の三連を受けで止める
  await v(`__valley.setBlood('standard')`); await v(`__rb.reset(['road_scout'])`); await step(30);
  const blocked = await v(`(async () => { const g = __valley.game, { setBlock } = await import('/valley/combat.js'), e = g.enemies.find(e => e.id === 'road_scout');
    e.apply = function (intent, dt) { const r = Object.getPrototypeOf(this).apply.call(this, { ...intent, startMove: null, move: null }, dt); setBlock(this.fighter, true); return r; }; setBlock(e.fighter, true); return e.fighter.blocking; })()`);
  let blockMax = 0; const before = (await v('__rb.outcomes.length'));
  for (let f = 0; f < 80; f++) { if (f === 0 || f === 20) await v(click); await step(1); blockMax = Math.max(blockMax, (await v('__valley.game.fx.bloodStats()')).drops); if (f === 0 || f === 20) await v(up); }
  const blockOut = (await v('__rb.outcomes.slice()')).slice(before);
  log('block outcomes', JSON.stringify(blockOut), blocked);
  check(blockOut.length > 0 && blockOut.every(o => o[3] !== 'hit') && blockMax === 0, `受けた当たりでは血が出ない（${blockOut.map(o => o[3]).join(',') || 'なし'}・粒${blockMax}）`);
  // 弾き：結線を直接呼ぶ（論理の結果 parried を渡す）。火花は出るが血は出ない
  const parryDrops = await v(`(() => { const g = __valley.game, e = g.enemies.find(e => e.id === 'road_scout'); g.fx.clearBlood(); g.battle.onStrike(e, g.hero, { outcome: 'parried', moveId: 'soldier_slash', damage: 0 }, {}); return g.fx.bloodStats().drops; })()`);
  check(parryDrops === 0, `弾いた当たりでは血が出ない（${parryDrops}）`);
  // 矢：刃ではないので出さない（判断：刃が体に入ったときだけ）
  const arrowDrops = await v(`(() => { const g = __valley.game, e = g.enemies.find(e => e.id === 'road_scout'); g.fx.clearBlood(); g.battle.onStrike(e, g.hero, { outcome: 'hit', moveId: 'soldier_shot', damage: 1, dead: false }, { arrow: true }); return g.fx.bloodStats().drops; })()`);
  check(arrowDrops === 0, `矢の当たりでは血が出ない（${arrowDrops}）`);

  // 4 乱戦の最悪：4人を並べ、標準で連続して斬る＋1コマに30回の強い命中を詰める
  const crowd = ['road_scout', ...(await v(`__valley.game.enemies.filter(e => e.kind === 'soldier' && e.id !== 'road_scout').slice(0, 3).map(e => e.id)`))];
  const melee = await fight('standard', crowd, { 0: click, 20: click, 44: click, 90: heavy, 140: click, 160: click, 184: click, 230: heavy });
  const stress = await v(`(() => { const g = __valley.game, h = g.hero, e = g.enemies.find(e => e.id === 'road_scout'); let md = 0, ms = 0;
    for (let i = 0; i < 30; i++) { g.fx.blood({ x: e.pos.x, y: e.pos.y + 1.2, z: e.pos.z }, { x: 1, z: 0 }, { level: 'standard', kind: i % 3 ? 'strong' : 'kill', travel: [0, 0, 1], ground: e.pos.y }); const b = g.fx.bloodStats(); md = Math.max(md, b.drops); ms = Math.max(ms, b.stains); }
    __valley.step(1); const b = g.fx.bloodStats(); return { md: Math.max(md, b.drops), ms: Math.max(ms, b.stains) }; })()`);
  log('melee', melee.maxDrops, melee.maxStains, JSON.stringify(melee.outcomes.map(o => o[3])), 'stress', JSON.stringify(stress));
  check(melee.outcomes.filter(o => o[3] === 'hit').length >= 4, `乱戦で4回以上斬った（${melee.outcomes.filter(o => o[3] === 'hit').length}）`);
  check(melee.maxDrops <= 64 && melee.maxStains <= 16 && stress.md <= 64 && stress.ms <= 16 && stress.md === 64 && stress.ms === 16, `同時の上限：乱戦 粒${melee.maxDrops}・しみ${melee.maxStains}／詰めた命中 粒${stress.md}・しみ${stress.ms}（64・16ちょうどで止まる）`);

  // 3 軽量品質でも、ひかえめの粒が見える
  await call('quality', 'light'); await step(5);
  const light = await fight('subtle');
  check(light.maxDrops > 0 && light.maxDrops < res.subtle.maxDrops + 1, `軽量のひかえめ：粒が0でない（${light.maxDrops}・標準品質は${res.subtle.maxDrops}）`);
  await call('quality', 'standard'); await step(5);

  // 5 揺れ0・動きを減らすでも段階は独立。保存→再読込で戻る。未知の値は既定へ
  const indep = await v(`(() => { const g = __valley.game; g.settings.shake = 0; g.rig.shakeScale = 0; g.settings.reducedMotion = true; __valley.setBlood('standard'); const a = g.settings.blood;
    g.fx.clearBlood(); const e = g.enemies.find(e => e.id === 'road_scout'); g.battle.onStrike(g.hero, e, { outcome: 'hit', moveId: 'light1', damage: 1, dead: false }, {}); const d = g.fx.bloodStats().drops; g.settings.shake = 1; g.rig.shakeScale = 1; delete g.settings.reducedMotion; return { a, d, sel: document.getElementById('set-blood').value }; })()`);
  check(indep.a === 'standard' && indep.d > 0 && indep.sel === 'standard', `揺れ0・動きを減らすでも標準のまま血が出る（${JSON.stringify(indep)}）`);
  const reload = async () => { await page.reload(); await page.waitForFunction('window.__valleyReady===true', null, { timeout: 180000 }); return v(`({ s: __valley.game.settings.blood, sel: document.getElementById('set-blood').value, saved: JSON.parse(localStorage.getItem('kamakura-valley-settings') || '{}').blood })`); };
  const r1 = await reload();
  check(r1.s === 'standard' && r1.sel === 'standard', `保存→再読込で「標準」が戻る（${JSON.stringify(r1)}）`);
  await v(`(() => { const k = 'kamakura-valley-settings', s = JSON.parse(localStorage.getItem(k) || '{}'); s.blood = 'gore'; localStorage.setItem(k, JSON.stringify(s)); return true; })()`);
  const r2 = await reload();
  check(r2.s === 'subtle' && r2.sel === 'subtle', `未知の値は既定「ひかえめ」に戻る（${JSON.stringify(r2)}）`);
  await v(`(() => { const k = 'kamakura-valley-settings', s = JSON.parse(localStorage.getItem(k) || '{}'); delete s.blood; localStorage.setItem(k, JSON.stringify(s)); return true; })()`);
  const r3 = await reload();
  check(r3.s === 'subtle', `未設定は既定「ひかえめ」（${JSON.stringify(r3)}）`);

  const summary = { fails, off: { maxDrops: res.off.maxDrops, maxStains: res.off.maxStains }, subtle: { maxDrops: res.subtle.maxDrops, maxStains: res.subtle.maxStains }, standard: { maxDrops: res.standard.maxDrops, maxStains: res.standard.maxStains },
    light: light.maxDrops, melee: { maxDrops: melee.maxDrops, maxStains: melee.maxStains, hits: melee.outcomes.filter(o => o[3] === 'hit').length }, stress, outcomes: res.off.outcomes, frames: res.off.rows.length,
    calls: Object.fromEntries(['off', 'subtle', 'standard'].map(lv => [lv, [Math.min(...res[lv].rows.map(r => r.calls)), Math.max(...res[lv].rows.map(r => r.calls))]])), objects: res.off.objects };
  if (process.env.KZ_OUT) fs.writeFileSync(process.env.KZ_OUT, JSON.stringify(summary, null, 1) + '\n');
  if (fails.length) throw new Error(`regress-blood: ${fails.length} 件の不合格\n` + fails.join('\n'));
  log('regress-blood: すべて合格');
}
