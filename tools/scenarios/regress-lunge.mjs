// 回帰：見た目だけの踏み込み（8.3a 第3周・lunge.js）を実ゲームで確かめる。
//   1 停止のコマで、刃（中ほど〜切先）が相手の胴（胸の骨 Spine02 の上下0.28m・半径0.22m）に入る（弓以外の11技・相手まで1.2m／1.6m／間合いの端）
//   2 見た目の中心どうしは0.55m以上、技が終わって0.4秒で根のずれ・向きのずれは0に戻る（論理の位置が変わらないことは regress-attack-timing.mjs で main と比べる）
//   3 壁：建物の壁の前で斬っても、模型の根が壁へめり込まない／4 急な斜面：論理の移動で出られない所へ根を出さない
//   5 そばの別の人：根がその人へ0.55mより近づかない／6 揺れ0・動きを減らすでも踏み込む（揺れではない）
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-lunge.mjs --seed 1333 --strict（KZ_OUT=<json> で記録）
import fs from 'node:fs';

const LIST = [['hero', 'light1'], ['hero', 'light2'], ['hero', 'light3'], ['hero', 'heavy'], ['hero', 'counter'], ['hero', 'finisher'],
  ['road_scout', 'soldier_slash'], ['road_scout', 'soldier_thrust'], ['officer', 'officer_a'], ['officer', 'officer_b'], ['officer', 'officer_c']];

export default async function ({ st, step, call, v, freeze, start, log }) {
  await start('new'); await freeze(true); await step(40); await call('god', true);
  const adv = async () => { for (let i = 0; i < 60; i++) { const s = await st(); if (s.talking) { await call('advanceDialogue', true); await step(10); } else if (s.pending) await step(30); else break; } };
  for (const e of [{ type: 'enter_zone', zone: 'temple_yard' }, { type: 'dialogue_end', id: 'boy_arrives' }]) await call('dispatch', e);
  await adv(); await step(20);
  await v(`(async () => {
    const g = __valley.game, { MOVES } = await import('/valley/combat.js'), { closestSegments } = await import('/valley/clash.js'), C = await import('/valley/collision.js');
    g.makeEnemies('village_enemies', { alert: 'unaware', dormant: true });
    const at = (holder, y) => { holder.updateWorldMatrix(true, false); const e = holder.matrixWorld.elements; return [e[4] * y + e[12], e[5] * y + e[13], e[6] * y + e[14]]; };
    const freeze = e => { e.apply = function (intent, dt) { return Object.getPrototypeOf(this).apply.call(this, { ...intent, startMove: null, move: null }, dt); }; };
    const ready = (e, x, z, yaw) => { e.place(x, z, yaw); e.dormant = false; e.brain.state = 'combat'; e.brain.awareness = 1; e.fighter.aware = true;
      const f = e.fighter; f.hp = f.hpMax; f.posture = f.postureMax; f.state = 'idle'; f.move = null; f.blocking = false; f.alive = true; e.lunge = null; e.recoverT = 0; freeze(e); };
    const park = () => { for (const e of g.enemies) { e.dormant = true; e.place(-80 + Math.random() * 0.01, -80, 0); delete e.apply; } };
    const heroAt = (x, z, yaw) => { const h = g.hero; h.place(x, z, yaw); h.fighter.yaw = yaw; h.sheatheIn = 30; g.rig.yaw = yaw; g.rig.snap(); const f = h.fighter; f.state = 'idle'; f.move = null; f.blocking = false; h.lunge = null; h.dash = null; h.queued = null; };
    // 技を論理の予備の始めにして、結線（beginMove）を呼ぶ（検査だけの近道）。毎コマ each(att, def, f) を呼ぶ。止まるコマの刃と胴の距離を返す
    const swing = (att, def, moveId, each) => {
      const f = att.fighter, m = MOVES[moveId], heroAtt = att === g.hero;
      f.move = { id: moveId, t: 0, phase: 'windup', struck: [], targetId: moveId === 'finisher' ? def.id : null }; f.state = 'attack'; f.telegraphing = m.telegraph > 0; f.noRegenT = 1.2;
      f.pendingEvents.push({ type: 'phase', id: f.id, moveId, phase: 'windup' });
      if (heroAtt) { if (moveId === 'finisher') att.foe = def; att.beginMove(moveId, { aim: moveId !== 'finisher' }); } else { att.beginMove(moveId); att.chainRoll = 9; }
      let hit = null, endT = null;
      for (let i = 0; i < 150; i++) {
        g.update(1 / 60); each?.(att, def, i);
        const mv = f.move;
        if (!hit && mv && mv.id === moveId && mv.t >= m.windup - 1e-6) {
          const w = att.character.weapons.tachiDrawn, sp = def.character.bones.get('Spine02'); sp.updateWorldMatrix(true, false); const e = sp.matrixWorld.elements;
          const c = closestSegments(at(w.holder, 0.52), at(w.holder, 0.88), [e[12], e[13] - 0.28, e[14]], [e[12], e[13] + 0.28, e[14]]);
          hit = { gap: c.d, shift: Math.hypot(att.vis.x, att.vis.z), turnDeg: att.vis.turn * 180 / Math.PI, stop: g.stopT > 0 };
        }
        if (hit && (!f.move || f.move.id !== moveId)) { endT ??= g.time; if (g.time - endT >= 0.4) break; }
      }
      return { ...(hit || {}), restShift: Math.hypot(att.vis.x, att.vis.z), restTurn: Math.abs(att.vis.turn) };
    };
    window.__rl = {
      // 1・2：開けた所で、相手まで D。見た目の中心どうしの最小距離、論理の位置が見た目のずれで動かないこと
      contact(who, moveId, D) {
        park(); heroAt(-30, -6, -Math.PI / 2); const h = g.hero;
        let att, def;
        if (who === 'hero') { att = h; def = g.enemies.find(e => e.id === 'road_scout'); ready(def, h.pos.x + D, h.pos.z, Math.PI / 2);
          if (moveId === 'finisher') { const f = def.fighter; f.state = 'stagger'; f.staggerT = 2.2; f.posture = 0; def.onCombatEvent({ type: 'stagger_start' }); for (let i = 0; i < 40; i++) g.update(1 / 60); } }
        else { def = h; att = g.enemies.find(e => e.id === who); ready(att, h.pos.x + D, h.pos.z, Math.PI / 2); }
        for (let i = 0; i < 20; i++) g.update(1 / 60);
        let minGap = 9;
        const r = swing(att, def, moveId, (a, d) => { const p = a.character.root.position, q = d.character.root.position; minGap = Math.min(minGap, Math.hypot(p.x - q.x, p.z - q.z)); });
        return { ...r, minGap };
      },
      // 3：建物の壁（当たりの箱）へ向かって斬る。相手は壁の向こう1.4m（論理は壁を見ない）。根が当たりの箱へ入らない
      wall() {
        park(); const h = g.hero, col = g.col;
        const box = col.boxes.filter(b => b.hx > 1.5 && b.hz > 1.5).sort((a, b) => Math.hypot(a.x + 30, a.z + 6) - Math.hypot(b.x + 30, b.z + 6))[0];
        const dir = [Math.SQRT1_2, Math.SQRT1_2], far = [box.x - dir[0] * (Math.max(box.hx, box.hz) + 4), box.z - dir[1] * (Math.max(box.hx, box.hz) + 4)];
        const free = C.moveActor(col, g.terrain, { x: far[0], y: g.terrain.heightAt(far[0], far[1]), z: far[1] }, dir[0] * 12, dir[1] * 12, 0.3);
        const yaw = Math.atan2(-dir[0], -dir[1]); heroAt(free.x, free.z, yaw);
        const foe = g.enemies.find(e => e.id === 'road_scout'); ready(foe, h.pos.x + dir[0] * 1.4, h.pos.z + dir[1] * 1.4, yaw + Math.PI);
        for (let i = 0; i < 10; i++) g.update(1 / 60);
        let worst = 0, shift = 0;
        swing(h, foe, 'light2', a => { const p = a.character.root.position, o = C.pushOut(col, g.terrain, { x: p.x, y: p.y, z: p.z }, 0.25); worst = Math.max(worst, Math.hypot(o.x - p.x, o.z - p.z)); shift = Math.max(shift, Math.hypot(a.vis.x, a.vis.z)); });
        return { blocked: free.blocked, penetration: worst, maxShift: shift, wallGap: Math.hypot(free.x - far[0], free.z - far[1]) };
      },
      // 4：急な斜面（論理の移動が 'slope' で止まる向き）へ向かって斬る。根は、論理の移動で出られる所より先へ出ない
      slope() {
        park(); const h = g.hero, col = g.col; let spot = null;
        for (let r = 6; r < 90 && !spot; r += 3) for (let k = 0; k < 24 && !spot; k++) {
          const x = -30 + Math.cos(k / 24 * Math.PI * 2) * r, z = -6 + Math.sin(k / 24 * Math.PI * 2) * r, y = g.terrain.heightAt(x, z);
          if (!g.terrain.walkable?.(x, z) && g.terrain.slopeAt(x, z) > 40) continue;
          for (let j = 0; j < 8 && !spot; j++) { const a = j / 8 * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
            const m = C.moveActor(col, g.terrain, { x, y, z }, dx * 1.6, dz * 1.6, 0.3), along = (m.x - x) * dx + (m.z - z) * dz;
            if (m.blocked === 'slope' && along > 0.05 && along < 0.8) spot = { x, z, dx, dz, along }; } }
        if (!spot) return { found: false };
        const yaw = Math.atan2(-spot.dx, -spot.dz); heroAt(spot.x, spot.z, yaw);
        const foe = g.enemies.find(e => e.id === 'road_scout'); ready(foe, spot.x + spot.dx * 1.6, spot.z + spot.dz * 1.6, yaw + Math.PI);
        for (let i = 0; i < 10; i++) g.update(1 / 60);
        let over = -9;
        swing(h, foe, 'light2', a => { const p = a.character.root.position; over = Math.max(over, (p.x - spot.x) * spot.dx + (p.z - spot.z) * spot.dz - spot.along); });
        return { found: true, freeAlong: spot.along, overshoot: over };
      },
      // 5：踏み込む先のそば（前0.75m・左0.55m）に別の人が立つ
      bystander() {
        park(); heroAt(-30, -6, -Math.PI / 2); const h = g.hero;
        const foe = g.enemies.find(e => e.id === 'road_scout'); ready(foe, h.pos.x + 2.1, h.pos.z, Math.PI / 2);
        const by = g.enemies.find(e => e.id === 'officer'); ready(by, h.pos.x + 0.75, h.pos.z - 0.55, Math.PI / 2); by.dormant = true;
        for (let i = 0; i < 10; i++) g.update(1 / 60);
        let near = 9, shift = 0;
        swing(h, foe, 'light2', a => { const p = a.character.root.position, q = by.character.root.position; near = Math.min(near, Math.hypot(p.x - q.x, p.z - q.z)); shift = Math.max(shift, Math.hypot(a.vis.x, a.vis.z)); });
        return { nearest: near, maxShift: shift };
      },
      settings(on) { g.settings.shake = on ? 0 : 1; g.rig.shakeScale = on ? 0 : 1; g.settings.reducedMotion = on ? true : undefined; },
    };
    return true;
  })()`);
  const fails = [], results = { contact: [] };
  for (const [who, move] of LIST) {
    const reach = (await v(`(async () => (await import('/valley/combat.js')).MOVES[${JSON.stringify(move)}].reach)()`)) + 0.3 - 0.05;
    for (const D of [1.2, 1.6, +reach.toFixed(2)].filter((d, i, a) => d <= reach + 1e-9 && a.indexOf(d) === i)) {
      const r = await v(`__rl.contact(${JSON.stringify(who)}, ${JSON.stringify(move)}, ${D})`);
      results.contact.push({ move, D, gap: +r.gap.toFixed(3), shift: +r.shift.toFixed(3), turnDeg: +r.turnDeg.toFixed(1), minGap: +r.minGap.toFixed(3), restShift: +r.restShift.toFixed(4) });
      if (!(r.gap <= 0.22)) fails.push(`${move} D${D}: 停止のコマで刃が胴に入らない（${r.gap.toFixed(3)}m）`);
      if (!r.stop) fails.push(`${move} D${D}: 停止のコマでない`);
      if (!(r.minGap >= 0.55 - 1e-3)) fails.push(`${move} D${D}: 見た目の中心どうしが近すぎる（${r.minGap.toFixed(3)}m）`);
      if (!(r.restShift < 1e-3 && r.restTurn < 1e-3)) fails.push(`${move} D${D}: 技のあとで元へ戻らない（${r.restShift} / ${r.restTurn}）`);
      if (!(r.shift <= 0.9 + 1e-6)) fails.push(`${move} D${D}: 前進が0.9mを超えた（${r.shift}）`);
    }
  }
  log(`contact ${results.contact.map(c => `${c.move}@${c.D}:${c.gap}/${c.shift}/${c.turnDeg}°`).join(' ')}`);
  results.wall = await v('__rl.wall()');
  if (!(results.wall.penetration < 0.02)) fails.push(`壁：模型の根が壁へめり込んだ ${JSON.stringify(results.wall)}`);
  results.slope = await v('__rl.slope()');
  if (!results.slope.found) fails.push('急な斜面の場所が見つからない（場面の前提が崩れた）');
  else if (!(results.slope.overshoot < 0.03)) fails.push(`急な斜面：論理で出られない所へ根を出した ${JSON.stringify(results.slope)}`);
  results.bystander = await v('__rl.bystander()');
  if (!(results.bystander.nearest >= 0.55 - 1e-3)) fails.push(`そばの人：根が近づきすぎた ${JSON.stringify(results.bystander)}`);
  await v('__rl.settings(true)');
  results.calm = await v(`__rl.contact('hero', 'light2', 2.15)`);
  await v('__rl.settings(false)');
  if (!(results.calm.shift > 0.3)) fails.push(`揺れ0・動きを減らすで踏み込まない ${JSON.stringify(results.calm)}`);
  log(`wall ${JSON.stringify(results.wall)} slope ${JSON.stringify(results.slope)} bystander ${JSON.stringify(results.bystander)} calm shift ${results.calm.shift.toFixed(3)}`);
  if (process.env.KZ_OUT) fs.writeFileSync(process.env.KZ_OUT, JSON.stringify({ seed: 1333, results, fails }, null, 1) + '\n');
  if (fails.length) throw Error('FAIL\n' + fails.join('\n'));
  log('regress-lunge: all checks passed');
}
