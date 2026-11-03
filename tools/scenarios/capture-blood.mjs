// 撮影：設定「血の表現」（8.4b）の3段階を、固定カメラ・同じ入力で並べる（盲検の採点用。既定では段階の名前を画像に書かない＝KZ_TITLE=1 で書く）。
//   KZ_SHEETS=<フォルダ> PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-blood.mjs --out <フォルダ>
// 場面：A ひとつ斬る（弱の一太刀）を3段階で、命中の0.05・0.2・0.6秒後（実時間。60コマ/秒で3・12・36コマ後）
//       B とどめ（崩してとどめ）を3段階で、倒れる命中の0.2・1.0・2.5秒後（標準はしみが残る）
//       C 軽量品質の「ひかえめ」と標準品質の「ひかえめ」の一太刀（0.05・0.2秒後）
import fs from 'node:fs';
import path from 'node:path';

export default async function ({ page, out, st, step, v, call, freeze, start, log }) {
  await start('new'); await freeze(true); await step(40); await call('god', true);
  const adv = async () => { for (let i = 0; i < 60; i++) { const s = await st(); if (s.talking) { await call('advanceDialogue', true); await step(10); } else if (s.pending) await step(30); else break; } };
  for (const e of [{ type: 'enter_zone', zone: 'temple_yard' }, { type: 'dialogue_end', id: 'boy_arrives' }]) await call('dispatch', e);
  await adv(); await step(20);
  await v(`(async () => {
    const g = __valley.game, { finish } = await import('/valley/combat.js');
    g.makeEnemies('village_enemies', { alert: 'unaware', dormant: true });
    for (const e of g.enemies) { e.dormant = true; e.place(-80, -80, 0); }
    let hits = 0; const real = g.battle.onStrike.bind(g.battle);
    g.battle.onStrike = (att, def, res, o) => { if (res.outcome === 'hit') hits++; return real(att, def, res, o); };
    window.__cb = {
      hits: () => hits,
      reset() {
        g.input.mouse.clear(); g.input.held.clear();
        const h = g.hero; h.place(-30, -6, -Math.PI / 2); h.fighter.yaw = h.yaw; h.sheatheIn = 30; g.rig.yaw = h.yaw; g.rig.snap();
        const hf = h.fighter; hf.state = 'idle'; hf.move = null; hf.hp = hf.hpMax; hf.posture = hf.postureMax; h.lunge = null; h.queued = null;
        const e = g.enemies.find(e => e.id === 'road_scout'), f = e.fighter;
        e.place(h.pos.x + 2.0, h.pos.z, Math.PI / 2); e.dormant = false; e.brain.state = 'combat'; e.brain.awareness = 1; f.aware = true;
        e.apply = function (intent, dt) { return Object.getPrototypeOf(this).apply.call(this, { ...intent, startMove: null, move: null }, dt); };
        f.hp = f.hpMax; f.posture = f.postureMax; f.state = 'idle'; f.move = null; f.alive = true; f.staggerT = 0; e.lunge = null; e.recoverT = 0; e.deadT = 0;
        h.drawSword({ fast: true }); g.fx.clearBlood();
        const mx = h.pos.x + 1.3; __valley.camera([mx - 0.3, 1.75, h.pos.z + 4.0], [mx + 0.2, 0.75, h.pos.z], 44);   // 少し上から：とどめのあとの地面のしみも入る
        return true;
      },
      stagger() { const e = g.enemies.find(e => e.id === 'road_scout'), f = e.fighter; e.place(g.hero.pos.x + 1.6, g.hero.pos.z, Math.PI / 2); f.state = 'stagger'; f.staggerT = 2.2; f.posture = 0; e.onCombatEvent({ type: 'stagger_start' }); return true; },
      finish() { const h = g.hero, e = g.enemies.find(e => e.id === 'road_scout'), f = h.fighter; h.faceTo(e); f.x = h.pos.x; f.z = h.pos.z; e.fighter.x = e.pos.x; e.fighter.z = e.pos.z; if (!finish(f, e.fighter)) return false; h.foe = e; h.beginMove('finisher', { aim: false }); return true; },
    };
    __valley.setWaymarks('off');
    return true;
  })()`);
  const click = `(() => { const i = __valley.game.input; i.mousePressed.add(0); i.mouse.add(0); return true; })()`;
  const up = `(() => { __valley.game.input.mouse.delete(0); return true; })()`;
  const clip = { x: 240, y: 110, width: 800, height: 450 };
  // 入力 act を出し、命中（hit）が起きたコマから after の各コマ数ののちに撮る
  const scene = async (level, act, after, setup = null) => {
    await v(`__valley.setBlood(${JSON.stringify(level)})`); await v('__cb.reset()'); await step(40);
    if (setup) { await v(setup); await step(60); }
    const h0 = await v('__cb.hits()'); await v(act); await step(1); await v(up);
    let n = 0; while ((await v('__cb.hits()')) === h0 && n++ < 120) await step(1);
    const shots = [], stats = []; let t = 0;
    for (const a of after) { await step(a - t); t = a; shots.push((await page.screenshot({ clip })).toString('base64')); stats.push(await v('__valley.game.fx.bloodStats()')); }
    log(level, act.slice(0, 20), 'stats', JSON.stringify(stats));
    return { shots, stats };
  };
  const levels = ['off', 'subtle', 'standard'], names = { off: 'なし', subtle: 'ひかえめ', standard: '標準' };
  const sheets = { A: [], B: [], C: [] }, numbers = {};
  for (const lv of levels) { const r = await scene(lv, click, [3, 12, 36]); sheets.A.push({ row: names[lv], times: ['0.05秒', '0.2秒', '0.6秒'], ...r }); numbers['A-' + lv] = r.stats; }
  for (const lv of levels) { const r = await scene(lv, '__cb.finish()', [12, 60, 150], '__cb.stagger()'); sheets.B.push({ row: names[lv], times: ['0.2秒', '1.0秒', '2.5秒'], ...r }); numbers['B-' + lv] = r.stats; }
  { const r = await scene('subtle', click, [3, 12]); sheets.C.push({ row: '標準品質・ひかえめ', times: ['0.05秒', '0.2秒'], ...r }); numbers['C-standard'] = r.stats; }
  await call('quality', 'light'); await step(5);
  { const r = await scene('subtle', click, [3, 12]); sheets.C.push({ row: '軽量品質・ひかえめ', times: ['0.05秒', '0.2秒'], ...r }); numbers['C-light'] = r.stats; }
  await call('quality', 'standard'); await v('__valley.camera(null)');
  const dir = process.env.KZ_SHEETS || out; fs.mkdirSync(dir, { recursive: true });
  const titled = !!process.env.KZ_TITLE, sheetPage = await page.context().browser().newPage();
  const label = { A: 'ひとつ斬る', B: 'とどめ', C: '品質' };
  for (const [key, rows] of Object.entries(sheets)) {
    const w = 400, h = 225, cols = Math.max(...rows.map(r => r.shots.length));
    const html = `<html><body style="margin:0;background:#111;width:${cols * w}px">${rows.map((r, ri) => `<div style="display:flex">${r.shots.map((png, i) => `<div style="position:relative;width:${w}px;height:${h}px"><img style="width:${w}px;height:${h}px" src="data:image/png;base64,${png}"><div style="position:absolute;left:6px;top:4px;color:#fff;font:13px sans-serif;text-shadow:0 0 3px #000">${key} ${label[key]}　${titled || key === 'C' ? r.row : '段' + 'ABC'[ri]}　命中の${r.times[i]}後</div></div>`).join('')}</div>`).join('')}</body></html>`;
    await sheetPage.setViewportSize({ width: cols * w, height: rows.length * h });
    await sheetPage.setContent(html); await sheetPage.waitForTimeout(150);
    const file = path.join(dir, `blood-${key}.jpg`);
    await sheetPage.screenshot({ path: file, type: 'jpeg', quality: 85, fullPage: true });
    log('sheet', file);
  }
  await sheetPage.close();
  fs.writeFileSync(path.join(dir, 'blood-numbers.json'), JSON.stringify(numbers) + '\n');
}
