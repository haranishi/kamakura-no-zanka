// 8.4a・8.5a の前後比較：押し戻しと、とどめ・弾きのスローを、実ゲームの固定カメラ・同じ乱数・同じ入力でコマ割りに撮る。
// 変更前（feat/polish3-combat-trail）と変更後を、それぞれの作業ツリー（または書き出した写し）で同じ条件で撮って並べる。
//   KZ_TAG=before PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-combat-impact.mjs --seed 1333 --out <フォルダ>
// 場面（主人公と斥候。里の正面の外の開けた所。カメラは2人を真横から見る）:
//   A 通常三連（弱→弱→三段目）を当てる / D 斥候の袈裟斬りを弾く / F 崩れた斥候へのとどめ
// 各コマの上に、コマ番号（60コマ/秒の画面のコマ）・技と位相・そのコマの時間の速さ・相手が場面の始めから動いた距離（押す向き）を書く。
// 敵の技は、論理の状態をその技の予備の始めにして結線を呼ぶ（検査だけの近道）。とどめも同じく、論理の開始と結線を直接呼ぶ。
import fs from 'node:fs';
import path from 'node:path';

const SCENES = {
  A: { label: '通常三連', frames: [9, 12, 16, 22, 28, 31, 36, 44, 55, 58, 64, 74] },
  D: { label: '弾き', frames: [28, 31, 33, 35, 37, 39, 41, 43, 45, 48, 52, 58] },
  F: { label: 'とどめ', frames: [10, 14, 17, 19, 21, 24, 27, 30, 34, 40, 50, 64] },
};

export default async function ({ page, out, st, step, call, v, freeze, start, log }) {
  const tag = process.env.KZ_TAG || 'shot';
  await start('new'); await freeze(true); await step(40); await call('god', true);
  const adv = async () => { for (let i = 0; i < 60; i++) { const s = await st(); if (s.talking) { await call('advanceDialogue', true); await step(10); } else if (s.pending) await step(30); else break; } };
  for (const e of [{ type: 'enter_zone', zone: 'temple_yard' }, { type: 'dialogue_end', id: 'boy_arrives' }]) await call('dispatch', e);
  await adv(); await step(20);
  await v(`(async () => {
    const g = __valley.game, { MOVES, finish } = await import('/valley/combat.js');
    g.makeEnemies('village_enemies', { alert: 'unaware', dormant: true });
    for (const e of g.enemies) { e.dormant = true; e.place(e.pos.x + 40, e.pos.z + 40, 0); }
    window.__ci = {
      // passive：相手は自分から技を出さず、歩かない（主人公の技を最後まで当てて撮るため。検査だけ）
      reset(foeId, active, passive = false) {
        g.input.mouse.delete(2);
        const h = g.hero; h.place(-30, -6, -Math.PI / 2); h.fighter.yaw = h.yaw; h.sheatheIn = 30; g.rig.yaw = h.yaw; g.rig.snap();
        for (const e of g.enemies) if (e.id !== foeId) { e.dormant = true; e.place(-80, -80, 0); }
        const e = g.enemies.find(e => e.id === foeId), f = e.fighter;
        e.place(h.pos.x + 2.2, h.pos.z, Math.PI / 2); e.dormant = !active; e.brain.state = 'combat'; e.brain.awareness = 1; f.aware = true;
        if (passive) e.apply = function (intent, dt) { return Object.getPrototypeOf(this).apply.call(this, { ...intent, startMove: null, move: null }, dt); }; else delete e.apply;
        f.hp = f.hpMax; f.posture = f.postureMax; f.state = 'idle'; f.move = null; f.blocking = false; f.staggerT = 0; e.lunge = null; e.speedNow = 0; e.recoverT = 0;
        const hf = h.fighter; hf.hp = hf.hpMax; hf.posture = hf.postureMax;
        // 2人を真横から。押されて下がる相手（三連で最大0.65m）も画面に収まるよう、8.3a の撮影より少し右・少し引いて見る
        const mx = h.pos.x + 1.45, mz = h.pos.z;
        __valley.camera([mx - 0.4, 1.4, mz + 4.6], [mx, 1.05, mz], 40);
        this.x0 = e.pos.x;
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
      stagger(foeId) {
        const e = g.enemies.find(e => e.id === foeId), f = e.fighter;
        e.place(g.hero.pos.x + 1.6, g.hero.pos.z, Math.PI / 2); this.x0 = e.pos.x;
        f.state = 'stagger'; f.staggerT = 2.2; f.posture = 0; e.onCombatEvent({ type: 'stagger_start' });
        return true;
      },
      // とどめを、論理の開始と結線の呼び出しで始める（E の詰めは使わない：変更前の版は、詰め終えの比べ方の丸めで、とどめが出ないことがあった）
      finish(foeId) {
        const h = g.hero, e = g.enemies.find(e => e.id === foeId), f = h.fighter;
        h.faceTo(e); f.x = h.pos.x; f.z = h.pos.z; e.fighter.x = e.pos.x; e.fighter.z = e.pos.z;
        if (!finish(f, e.fighter)) return false;
        h.foe = e; h.beginMove('finisher', { aim: false });
        return true;
      },
      label(foeId) {
        const h = g.hero.fighter, e = g.enemies.find(e => e.id === foeId);
        const m = f => f.move ? f.move.id + ' ' + f.move.phase : f.state;
        const s = g.contactTimeScale ?? 1, speed = s < 0.06 ? '停止' : s < 0.999 ? '速さ×' + s.toFixed(2) : '速さ×1';
        return '主人公: ' + m(h) + '　相手: ' + m(e.fighter) + '　' + speed + '　相手の位置 ' + (e.pos.x - this.x0 >= 0 ? '+' : '') + (e.pos.x - this.x0).toFixed(2) + 'm';
      },
    };
    return true;
  })()`);
  // 道しるべ（地面の矢印）は消す：撮る場所によって画面の隅に大きく写り、比べる所から目をそらした（第1周の採点）。両方の版で同じ
  await v(`(() => { __valley.setWaymarks('off'); __ci.reset('road_scout', false); __valley.game.hero.drawSword({ fast: false }); return true; })()`);
  await step(80);
  const sheets = {}, numbers = {};
  const run = async (scene, foe, inputs, passive = false, setup = null) => {
    await v(`__ci.reset(${JSON.stringify(foe)}, false, ${passive})`); await step(40);
    await v(`__ci.reset(${JSON.stringify(foe)}, true, ${passive})`);
    if (setup) { await v(setup); await step(60); }   // とどめの場面：膝をつき終えるまで待つ（膝つきの動作は約0.65秒。崩れは2.2秒続く）
    await step(1);
    const want = new Set(SCENES[scene].frames), last = Math.max(...want), shots = [], track = [];
    for (let f = 0; f <= last; f++) {
      const act = inputs[f];
      if (act) await v(act);
      await step(1);
      track.push(await v(`(() => { const g = __valley.game, e = g.enemies.find(e => e.id === ${JSON.stringify(foe)}); return [+(g.contactTimeScale ?? 1).toFixed(3), +(e.pos.x - __ci.x0).toFixed(3)]; })()`));
      if (want.has(f)) {
        const label = await v(`__ci.label(${JSON.stringify(foe)})`);
        shots.push({ f, label, png: (await page.screenshot({ clip: { x: 240, y: 110, width: 800, height: 450 } })).toString('base64') });
      }
      if (act && !act.includes('mouse.add(2)')) await v(`(() => { const i = __valley.game.input; i.mouse.delete(0); for (const k of ['KeyF', 'KeyE']) i.held.delete(k); return true; })()`);
    }
    sheets[scene] = shots;
    // 数値：停止・スローのコマ数と、相手が動いた距離（最後のコマ）
    const stop = track.filter(t => t[0] < 0.06).length, slow = track.filter(t => t[0] >= 0.06 && t[0] < 0.999).length;
    numbers[scene] = { stopFrames: stop, slowFrames: slow, slowSeconds: +(slow / 60).toFixed(3), foeMoved: track.at(-1)[1], track };
    log(`${scene}: stop ${stop} slow ${slow} foeMoved ${track.at(-1)[1]}`);
  };
  const click = `(() => { const i = __valley.game.input; i.mousePressed.add(0); i.mouse.add(0); return true; })()`;
  const block = `(() => { const i = __valley.game.input; i.mousePressed.add(2); i.mouse.add(2); return true; })()`;
  const unblock = `(() => { __valley.game.input.mouse.delete(2); return true; })()`;
  await run('A', 'road_scout', { 0: click, 20: click, 44: click }, true);
  await run('D', 'road_scout', { 0: `__ci.force('road_scout', 'soldier_slash')`, 26: block, 70: unblock });
  await run('F', 'road_scout', { 0: `__ci.finish('road_scout')` }, true, `__ci.stagger('road_scout')`);
  await v(`(() => { __valley.game.input.mouse.delete(2); __valley.camera(null); return true; })()`);
  const sheetPage = await page.context().browser().newPage();
  for (const [scene, shots] of Object.entries(sheets)) {
    const cols = 4, w = 480, h = 270, title = process.env.KZ_TITLE ?? '';   // 盲検の採点に使うので、既定では前後の名前を画像に書かない
    const html = `<html><body style="margin:0;background:#111;width:${cols * w}px;display:flex;flex-wrap:wrap">${shots.map(s => `<div style="position:relative;width:${w}px;height:${h}px"><img style="width:${w}px;height:${h}px" src="data:image/png;base64,${s.png}"><div style="position:absolute;left:6px;top:4px;color:#fff;font:13px sans-serif;text-shadow:0 0 3px #000">${title} ${scene} ${SCENES[scene].label}　コマ${s.f}</div><div style="position:absolute;left:6px;bottom:4px;color:#fff;font:12px sans-serif;text-shadow:0 0 3px #000">${s.label}</div></div>`).join('')}</body></html>`;
    await sheetPage.setViewportSize({ width: cols * w, height: Math.ceil(shots.length / cols) * h });
    await sheetPage.setContent(html); await sheetPage.waitForTimeout(150);
    const file = path.join(out, `${tag}-${scene}.jpg`);
    await sheetPage.screenshot({ path: file, type: 'jpeg', quality: 82, fullPage: true });
    log('sheet', file);
  }
  await sheetPage.close();
  if (process.env.KZ_STATS) fs.writeFileSync(process.env.KZ_STATS, JSON.stringify(numbers) + '\n');
}
