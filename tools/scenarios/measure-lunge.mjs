// 8.3a 第3周の実測：見た目だけの踏み込み（lunge.js）で、判定の始め（停止のコマ）に刃が相手の胴へ入るか。
// 技ごとに、相手を前へ距離 D（1.2m・1.6m・間合いの端＝reach＋相手の半径−0.05）に置き、本物の結線で技を出して、
// 判定の始めのコマで、刃の中ほど〜切先（刀の枠 y=0.52〜0.88）と相手の胴の軸（胸の骨 Spine02 の上下0.28m）の最も近い距離を測る。
// 胴の半径（0.22m）以内なら「入った」。あわせて、模型の根の前進・回す角・見た目の中心どうしの距離・論理の位置が動いていないことを記録する。
//   KZ_OUT=<json> PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/measure-lunge.mjs --seed 1333 --out <フォルダ>
// 技は論理の状態を予備の始めにして結線（beginMove）を呼ぶ（検査だけの近道。measure-combat-trail.mjs と同じ）。主人公は神の守りで倒れない。
import fs from 'node:fs';

const MOVES_LIST = [
  ['hero', 'light1'], ['hero', 'light2'], ['hero', 'light3'], ['hero', 'heavy'], ['hero', 'counter'], ['hero', 'finisher'],
  ['road_scout', 'soldier_slash'], ['road_scout', 'soldier_thrust'], ['officer', 'officer_a'], ['officer', 'officer_b'], ['officer', 'officer_c'],
];

export default async function ({ st, step, call, v, freeze, start, log }) {
  await start('new'); await freeze(true); await step(40); await call('god', true);
  const adv = async () => { for (let i = 0; i < 60; i++) { const s = await st(); if (s.talking) { await call('advanceDialogue', true); await step(10); } else if (s.pending) await step(30); else break; } };
  for (const e of [{ type: 'enter_zone', zone: 'temple_yard' }, { type: 'dialogue_end', id: 'boy_arrives' }]) await call('dispatch', e);
  await adv(); await step(20);
  await v(`(async () => {
    const g = __valley.game, { MOVES } = await import('/valley/combat.js'), { closestSegments } = await import('/valley/clash.js');
    g.makeEnemies('village_enemies', { alert: 'unaware', dormant: true });
    const at = (holder, y) => { holder.updateWorldMatrix(true, false); const e = holder.matrixWorld.elements; return [e[4] * y + e[12], e[5] * y + e[13], e[6] * y + e[14]]; };
    const park = () => { for (const e of g.enemies) { e.dormant = true; e.place(-80 + Math.random() * 0.01, -80, 0); delete e.apply; } };
    window.__lg = {
      run(who, moveId, D) {
        park();
        const h = g.hero; h.place(-30, -6, -Math.PI / 2); h.fighter.yaw = h.yaw; h.sheatheIn = 30; g.rig.yaw = h.yaw; g.rig.snap();
        const hf = h.fighter; hf.state = 'idle'; hf.move = null; hf.blocking = false; hf.hp = hf.hpMax; hf.posture = hf.postureMax; h.lunge = null; h.dash = null; h.queued = null;
        const heroAtt = who === 'hero', foeId = heroAtt ? (moveId === 'finisher' ? 'road_scout' : 'road_scout') : null;
        let att, def;
        if (heroAtt) {
          att = h; def = g.enemies.find(e => e.id === foeId);
          def.place(h.pos.x + D, h.pos.z, Math.PI / 2); def.dormant = false; def.brain.state = 'combat'; def.brain.awareness = 1; def.fighter.aware = true;
          const f = def.fighter; f.hp = f.hpMax; f.posture = f.postureMax; f.state = 'idle'; f.move = null; f.blocking = false; f.alive = true; def.lunge = null; def.recoverT = 0;
          def.apply = function (intent, dt) { return Object.getPrototypeOf(this).apply.call(this, { ...intent, startMove: null, move: null }, dt); };
          if (moveId === 'finisher') { f.state = 'stagger'; f.staggerT = 2.2; f.posture = 0; def.onCombatEvent({ type: 'stagger_start' }); for (let i = 0; i < 40; i++) g.update(1 / 60); }
        } else {
          def = h; att = g.enemies.find(e => e.id === who);
          att.place(h.pos.x + D, h.pos.z, Math.PI / 2); att.dormant = false; att.brain.state = 'combat'; att.brain.awareness = 1; att.fighter.aware = true;
          const f = att.fighter; f.hp = f.hpMax; f.posture = f.postureMax; f.state = 'idle'; f.move = null; f.blocking = false; f.alive = true; att.lunge = null; att.recoverT = 0;
          att.apply = function (intent, dt) { return Object.getPrototypeOf(this).apply.call(this, { ...intent, startMove: null, move: null }, dt); };
        }
        for (let i = 0; i < 20; i++) g.update(1 / 60);
        const f = att.fighter, m = MOVES[moveId];
        f.move = { id: moveId, t: 0, phase: 'windup', struck: [], targetId: moveId === 'finisher' ? def.id : null }; f.state = 'attack';
        f.telegraphing = m.telegraph > 0; f.noRegenT = 1.2; f.pendingEvents.push({ type: 'phase', id: f.id, moveId, phase: 'windup' });
        if (heroAtt) { if (moveId === 'finisher') h.foe = def; att.beginMove(moveId, { aim: moveId !== 'finisher' }); } else { att.beginMove(moveId); att.chainRoll = 9; }
        const logical0 = [att.pos.x, att.pos.z];
        let out = null, maxShift = 0, maxTurn = 0, minGapSeen = 9;
        const rec = () => {
          const r = att.character.root.position, dr = def.character.root.position, sh = Math.hypot(att.vis.x, att.vis.z);
          maxShift = Math.max(maxShift, sh); maxTurn = Math.max(maxTurn, Math.abs(att.vis.turn)); minGapSeen = Math.min(minGapSeen, Math.hypot(r.x - dr.x, r.z - dr.z));
        };
        for (let i = 0; i < 90; i++) {
          g.update(1 / 60); rec();
          const mv = f.move;
          if (!out && mv && mv.id === moveId && mv.t >= m.windup - 1e-6) {
            const w = att.character.weapons.tachiDrawn, sp = def.character.bones.get('Spine02'); sp.updateWorldMatrix(true, false);
            const e = sp.matrixWorld.elements, c = closestSegments(at(w.holder, 0.52), at(w.holder, 0.88), [e[12], e[13] - 0.28, e[14]], [e[12], e[13] + 0.28, e[14]]);
            const r = att.character.root.position, dr = def.character.root.position;
            out = { gap: +c.d.toFixed(3), inside: c.d <= 0.22, bladeAt: +c.s.toFixed(2), hitY: +(c.p[1] - def.pos.y).toFixed(2), shift: +Math.hypot(att.vis.x, att.vis.z).toFixed(3),
              turnDeg: +(att.vis.turn * 180 / Math.PI).toFixed(1), visualGap: +Math.hypot(r.x - dr.x, r.z - dr.z).toFixed(3), logicalGap: +Math.hypot(att.pos.x - def.pos.x, att.pos.z - def.pos.z).toFixed(3),
              stop: g.stopT > 0, struck: mv.struck.length };
          }
          if (out && (!f.move || f.move.id !== moveId)) break;
        }
        const back = Math.hypot(att.vis.x, att.vis.z);
        return { ...(out || { gap: null }), maxShift: +maxShift.toFixed(3), maxTurnDeg: +(maxTurn * 180 / Math.PI).toFixed(1), minVisualGap: +minGapSeen.toFixed(3), shiftAfter: +back.toFixed(3), turnAfterDeg: +(att.vis.turn * 180 / Math.PI).toFixed(2), moved: +Math.hypot(att.pos.x - logical0[0], att.pos.z - logical0[1]).toFixed(3) };
      },
    };
    return true;
  })()`);
  const results = [];
  for (const [who, move] of MOVES_LIST) {
    const reach = (await v(`(async () => (await import('/valley/combat.js')).MOVES[${JSON.stringify(move)}].reach)()`)) + 0.3 - 0.05;
    for (const D of [...new Set([1.2, 1.6, +reach.toFixed(2)])].filter(d => d <= reach + 1e-9)) {
      const r = await v(`__lg.run(${JSON.stringify(who)}, ${JSON.stringify(move)}, ${D})`);
      results.push({ who, move, D, ...r });
      log(`${move.padEnd(15)} D ${D.toFixed(2)}  gap ${r.gap}${r.inside ? ' 入る' : ''}  at ${r.bladeAt} y ${r.hitY}  shift ${r.shift} turn ${r.turnDeg}°  visualGap ${r.visualGap} (min ${r.minVisualGap})  stop ${r.stop}  after ${r.shiftAfter}/${r.turnAfterDeg}°`);
    }
  }
  if (process.env.KZ_OUT) fs.writeFileSync(process.env.KZ_OUT, JSON.stringify({ seed: 1333, results }, null, 1) + '\n');
}
