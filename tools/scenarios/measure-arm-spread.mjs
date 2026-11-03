// 測定：被弾・弾かれ・倒れの動作で、上腕が胴からどれだけ開くか（8.3b）。開き＝上腕（肩→肘）と、胴の下向き（首→腰）のなす角（度）。
// 0度＝腕が体の横に下がる、90度＝水平（T字・前へ突き出す）、180度＝頭の上へまっすぐ。
// 斥候の模型に動作を直接当てて、画面のコマ（60コマ/秒）ごとに左右の角を記録する。腕の開きの層（arm-spread.js）を切った値と入れた値を並べる。
//   KZ_OUT=<json> PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/measure-arm-spread.mjs --seed 1333 --out <フォルダ>
import fs from 'node:fs';

// 測る動作：[名前, 再生の仕方（actors.js と同じ）, 腕の開きの層に渡す状態, コマ数]
const CASES = [
  ['hit2', `ch.playAction('hit2', { timeScale: 2.4 })`, { state: 'hit' }, 40],
  ['parried', `ch.play('Hit_Reaction_to_Waist', { fade: 0.06, from: 0.1, timeScale: 1.9, restart: true })`, { state: 'recoil' }, 50],
  ['die', `ch.playAction('die', { timeScale: 1.25 })`, { dead: true }, 150],
  ['die2', `ch.playAction('die2', { timeScale: 1.25 })`, { dead: true }, 150],
  ['die_kneel', `ch.playAction('die', { timeScale: 1.25, from: 0.6 })`, { dead: true }, 120],
  ['die2_kneel', `ch.playAction('die2', { timeScale: 1.25, from: 0.12 })`, { dead: true }, 120],
];

export default async function ({ st, step, call, v, freeze, start, log }) {
  await start('new'); await freeze(true); await step(40); await call('god', true);
  const adv = async () => { for (let i = 0; i < 60; i++) { const s = await st(); if (s.talking) { await call('advanceDialogue', true); await step(10); } else if (s.pending) await step(30); else break; } };
  for (const e of [{ type: 'enter_zone', zone: 'temple_yard' }, { type: 'dialogue_end', id: 'boy_arrives' }]) await call('dispatch', e);
  await adv(); await step(20);
  await v(`(async () => {
    const g = __valley.game, A = await import('/valley/arm-spread.js').catch(() => null);
    g.makeEnemies('village_enemies', { alert: 'unaware', dormant: true });
    for (const e of g.enemies) { e.dormant = true; e.place(e.pos.x + 40, e.pos.z + 40, 0); }
    const e = g.enemies.find(e => e.id === 'road_scout'), ch = e.character;
    e.animateFree = () => {};   // 待機の動作へ戻させない（検査だけ）
    const P = n => { const b = ch.bone(n); return b ? b.getWorldPosition(new ch.root.position.constructor()) : null; };
    window.__as = {
      has: !!A, S: A?.SPREAD || {},
      bones: [...ch.bones.keys()],
      // tip：'ForeArm'＝上腕（肩→肘）、'Hand'＝腕全体（肩→手首）
      angle(side, tip = 'Hand') {
        const s = P(side + 'Arm'), el = P(side + tip), n = P('neck') || P('Spine02'), h = P('Hips');
        const ax = el.x - s.x, ay = el.y - s.y, az = el.z - s.z, dx = h.x - n.x, dy = h.y - n.y, dz = h.z - n.z;
        const c = (ax * dx + ay * dy + az * dz) / (Math.hypot(ax, ay, az) * Math.hypot(dx, dy, dz));
        return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
      },
      e, ch,
    };
    return true;
  })()`);
  const out = { has: await v('__as.has'), cases: {} };
  log('bones ' + (await v('__as.bones.join(",")')));
  for (const [name, code, state, frames] of CASES) {
    const row = {};
    for (const layer of [false, true]) {
      if (layer && !out.has) continue;
      // 層を入れるとき：人物が毎コマ置く上限（actors.js の spreadCapNow）を、測る状態の上限に替える（検査だけ。相手は生きたまま倒れの動作を当てる）
      await v(`(() => { const e = __as.e, ch = __as.ch, s = ${JSON.stringify(state)}, S = __as.S;
        const cap = ${layer} ? (s.dead ? S.dead : s.state === 'hit' ? (S.hit || 0) : (S.recoil || 0)) : 0;
        e.dormant = true; e.spreadCapNow = () => cap; ch.armRelax = false; ch.spreadW = 0; ch.locoName = null; ch.locomote(0, 'guard'); return true; })()`);
      await step(20);
      await v(`(() => { const ch = __as.ch; ${code}; return true; })()`);
      const L = [], R = [], UL = [], UR = [];
      for (let i = 0; i < frames; i++) { await step(1); const [l, r, ul, ur] = await v(`[__as.angle('Left'), __as.angle('Right'), __as.angle('Left', 'ForeArm'), __as.angle('Right', 'ForeArm')]`); L.push(+l.toFixed(1)); R.push(+r.toFixed(1)); UL.push(+ul.toFixed(1)); UR.push(+ur.toFixed(1)); }
      row[layer ? 'on' : 'off'] = { maxLeft: Math.max(...L), maxRight: Math.max(...R), framesOver60: L.concat(R).filter(a => a > 60).length, upperMax: Math.max(...UL, ...UR), left: L, right: R };
    }
    out.cases[name] = row;
    log(`${name}: off L${row.off.maxLeft} R${row.off.maxRight} >60:${row.off.framesOver60} upper${row.off.upperMax}` + (row.on ? `  on L${row.on.maxLeft} R${row.on.maxRight} >60:${row.on.framesOver60} upper${row.on.upperMax}` : ''));
  }
  if (process.env.KZ_OUT) fs.writeFileSync(process.env.KZ_OUT, JSON.stringify(out) + '\n');
  return out;
}
