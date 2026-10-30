// 8.3a の前後比較：刃の軌跡と小さな改善を、実ゲームの固定カメラ・同じ乱数・同じ入力でコマ割りに撮る。
// 変更前と変更後を、それぞれの作業ツリーで同じ条件で撮って並べる。
//   KZ_TAG=before PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-combat-trail.mjs --seed 1333 --out <フォルダ>
// 場面（主人公と斥候・侍大将。里の正面の外の開けた所。カメラは2人を真横から見る）:
//   A 通常三連（弱→弱→三段目）を斥候へ当てる / B 強斬りを当てる / C 斥候の突きを受ける（受けない＝当たる）
//   D 斥候の袈裟斬りを弾く / E 侍大将の二段目（officer_b）を受ける
// 各コマの上に、コマ番号・技・位相・技の経過秒を書く。敵の技は、論理の状態をその技の予備の始めにして結線を呼ぶ（検査だけの近道）。
import fs from 'node:fs';
import path from 'node:path';

const SCENES = {
  A: { label: '通常三連', frames: [8, 10, 12, 14, 16, 18, 30, 32, 34, 36, 38, 40, 58, 60, 62, 64, 66, 68, 70, 72] },
  B: { label: '強斬り', frames: [22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44] },
  C: { label: '突き', frames: [30, 34, 38, 40, 42, 44, 46, 48, 50, 52, 56, 60] },
  D: { label: '弾き', frames: [26, 28, 30, 32, 33, 34, 35, 36, 38, 40, 44, 48] },
  E: { label: '侍大将の二段目', frames: [14, 18, 22, 24, 26, 28, 30, 32, 34, 36, 40, 46] },
};

export default async function ({ page, out, st, step, call, v, freeze, start, log }) {
  const tag = process.env.KZ_TAG || 'shot';
  await start('new'); await freeze(true); await step(40); await call('god', true);
  const adv = async () => { for (let i = 0; i < 60; i++) { const s = await st(); if (s.talking) { await call('advanceDialogue', true); await step(10); } else if (s.pending) await step(30); else break; } };
  for (const e of [{ type: 'enter_zone', zone: 'temple_yard' }, { type: 'dialogue_end', id: 'boy_arrives' }]) await call('dispatch', e);
  await adv(); await step(20);
  await v(`(async () => {
    const g = __valley.game, { MOVES } = await import('/valley/combat.js');
    g.makeEnemies('village_enemies', { alert: 'unaware', dormant: true });
    for (const e of g.enemies) { e.dormant = true; e.place(e.pos.x + 40, e.pos.z + 40, 0); }
    window.__cc = {
      // passive：相手は自分から技を出さない（主人公の技を最後まで当てて撮るため。apply の意図から startMove だけを外す・検査だけ）
      reset(foeId, active, passive = false) {
        const h = g.hero; h.place(-30, -6, -Math.PI / 2); h.fighter.yaw = h.yaw; h.sheatheIn = 30; g.rig.yaw = h.yaw; g.rig.snap();
        for (const e of g.enemies) if (e.id !== foeId) { e.dormant = true; e.place(-80, -80, 0); }
        const e = g.enemies.find(e => e.id === foeId), f = e.fighter;
        e.place(h.pos.x + 2.2, h.pos.z, Math.PI / 2); e.dormant = !active; e.brain.state = 'combat'; e.brain.awareness = 1; f.aware = true;
        if (passive) e.apply = function (intent, dt) { return Object.getPrototypeOf(this).apply.call(this, { ...intent, startMove: null }, dt); }; else delete e.apply;
        f.hp = f.hpMax; f.posture = f.postureMax; f.state = 'idle'; f.move = null; f.blocking = false; f.staggerT = 0; e.lunge = null; e.speedNow = 0; e.recoverT = 0;
        const hf = h.fighter; hf.hp = hf.hpMax; hf.posture = hf.postureMax;
        // 2人を真横（主人公の右手側）から見る固定カメラ
        const mx = h.pos.x + 1.1, mz = h.pos.z;
        __valley.camera([mx - 0.4, 1.35, mz + 3.9], [mx, 1.05, mz], 40);
        return true;
      },
      force(foeId, moveId) {
        const e = g.enemies.find(e => e.id === foeId), f = e.fighter;
        f.move = { id: moveId, t: 0, phase: 'windup', struck: [], targetId: null }; f.state = 'attack';
        f.telegraphing = MOVES[moveId].telegraph > 0; f.noRegenT = 1.2;
        f.pendingEvents.push({ type: 'phase', id: f.id, moveId, phase: 'windup' });
        e.beginMove(moveId); e.chainRoll = 9;
        return true;
      },
      label(foeId) {
        const h = g.hero.fighter, e = g.enemies.find(e => e.id === foeId).fighter;
        const m = f => f.move ? f.move.id + ' ' + f.move.phase + ' ' + f.move.t.toFixed(2) + 's' : f.state;
        return '主人公: ' + m(h) + '　/　相手: ' + m(e) + (g.stopT > 0 ? '　[停止]' : '');
      },
      trailStats() { return g.fx.trails?.stats ? g.fx.trails.stats() : null; },
    };
    return true;
  })()`);
  await v(`(() => { __cc.reset('road_scout', false); __valley.game.hero.drawSword({ fast: false }); return true; })()`);
  await step(80);
  const sheets = {};
  const run = async (scene, foe, inputs, passive = false) => {
    await v(`__cc.reset(${JSON.stringify(foe)}, false, ${passive})`); await step(40);   // 前の場面の動きを落ち着かせてから、相手を起こす
    await v(`__cc.reset(${JSON.stringify(foe)}, true, ${passive})`); await step(1);
    const want = new Set(SCENES[scene].frames), last = Math.max(...want), shots = [];
    for (let f = 0; f <= last; f++) {
      const act = inputs[f];
      if (act) await v(act);
      await step(1);
      if (want.has(f)) {
        const label = await v(`__cc.label(${JSON.stringify(foe)})`), stats = await v('__cc.trailStats()');
        shots.push({ f, label, stats, png: (await page.screenshot({ clip: { x: 240, y: 110, width: 800, height: 450 } })).toString('base64') });
        // KZ_FULL=A:12,B:36 … のコマは、等倍（1280×720）でも残す（帯の縁・濃さを目で確かめる用）
        if ((process.env.KZ_FULL || '').split(',').includes(`${scene}:${f}`)) await page.screenshot({ path: path.join(out, `${tag}-${scene}-${String(f).padStart(3, '0')}.png`) });
      }
      if (act && !act.includes('mouse.add(2)')) await v(`(() => { const i = __valley.game.input; i.mouse.delete(0); i.held.delete('KeyF'); return true; })()`);   // 押すのは1コマ（受けは離すまで）
    }
    sheets[scene] = shots;
    log(`${scene}: ${shots.map(s => s.f + (s.stats ? '/' + s.stats.vertices : '')).join(' ')}`);
  };
  const click = `(() => { const i = __valley.game.input; i.mousePressed.add(0); i.mouse.add(0); return true; })()`;
  const heavy = `(() => { const i = __valley.game.input; i.pressed.add('KeyF'); i.held.add('KeyF'); return true; })()`;
  const block = `(() => { const i = __valley.game.input; i.mousePressed.add(2); i.mouse.add(2); return true; })()`;
  const unblock = `(() => { __valley.game.input.mouse.delete(2); return true; })()`;
  await run('A', 'road_scout', { 0: click, 20: click, 44: click }, true);
  await run('B', 'road_scout', { 0: heavy }, true);
  await run('C', 'road_scout', { 0: `__cc.force('road_scout', 'soldier_thrust')` });
  await run('D', 'road_scout', { 0: `__cc.force('road_scout', 'soldier_slash')`, 26: block, 60: unblock });
  await run('E', 'officer', { 0: `__cc.force('officer', 'officer_b')` });
  await v(`(() => { __valley.game.input.mouse.delete(2); __valley.camera(null); return true; })()`);
  // コマ割りの1枚にまとめる（1コマ 480×270、4列）
  const sheetPage = await page.context().browser().newPage();
  for (const [scene, shots] of Object.entries(sheets)) {
    const cols = 4, w = 480, h = 270;
    const html = `<html><body style="margin:0;background:#111;width:${cols * w}px;display:flex;flex-wrap:wrap">${shots.map(s => `<div style="position:relative;width:${w}px;height:${h}px"><img style="width:${w}px;height:${h}px" src="data:image/png;base64,${s.png}"><div style="position:absolute;left:6px;top:4px;color:#fff;font:13px sans-serif;text-shadow:0 0 3px #000,0 0 3px #000">${tag} ${scene} ${SCENES[scene].label}　コマ${s.f}</div><div style="position:absolute;left:6px;bottom:4px;color:#fff;font:12px sans-serif;text-shadow:0 0 3px #000,0 0 3px #000">${s.label}</div></div>`).join('')}</body></html>`;
    await sheetPage.setViewportSize({ width: cols * w, height: Math.ceil(shots.length / cols) * h });
    await sheetPage.setContent(html); await sheetPage.waitForTimeout(150);
    const file = path.join(out, `${tag}-${scene}.jpg`);
    await sheetPage.screenshot({ path: file, type: 'jpeg', quality: 82, fullPage: true });
    log('sheet', file);
  }
  await sheetPage.close();
  if (process.env.KZ_STATS) fs.writeFileSync(process.env.KZ_STATS, JSON.stringify(Object.fromEntries(Object.entries(sheets).map(([k, s]) => [k, s.map(x => ({ f: x.f, label: x.label, stats: x.stats }))])), null, 1) + '\n');
}
