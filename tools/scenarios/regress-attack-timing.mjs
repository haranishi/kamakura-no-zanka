// 回帰：抜刀・納刀の層（8.2）が、戦闘の論理（攻撃・受け・回避の開始と進み、体力・構え・位置）を変えないこと（R18.9）。
// 同じ種・同じ入力列で、主人公と敵の論理の状態を毎コマ記録し、変更前と変更後を比べる（見た目の層は含めない）。
// 実行（変更前と変更後を、それぞれの作業ツリーで）:
//   KZ_OUT=<json> PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-attack-timing.mjs --seed 1333 --out <フォルダ>
// 比べる:  node tools/scenarios/regress-attack-timing.mjs <変更前.json> <変更後.json>   （同一なら終了コード0）
// KZ_SCENE=officer：相手を侍大将にする（8.3a。連続技の二段目 officer_b の表示を変えたので、その論理も前後で比べる）。既定は斥候。
import fs from 'node:fs';

const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
// コマ番号 → 入力。納刀の状態から、弱の連打・強・受け・回避の順。押す長さ（コマ）も指定し、押している間も1コマずつ記録する
const INPUTS = { 20: ['click', 0, 2], 44: ['click', 0, 2], 68: ['click', 0, 2], 110: ['key', 'KeyF', 2], 160: ['click', 2, 40], 220: ['key', 'Space', 2], 250: ['click', 0, 2] };
// 侍大将の場面：受けを長めに混ぜ、連続技（一段目→二段目→三段目）を出させる
const OFFICER_INPUTS = { 30: ['click', 2, 70], 130: ['click', 0, 2], 150: ['click', 0, 2], 200: ['click', 2, 90], 320: ['key', 'KeyF', 2], 380: ['click', 2, 60], 470: ['key', 'Space', 2] };

export default async function ({ st, step, call, v, freeze, start, click, release, key, log }) {
  await start('new'); await freeze(true); await step(40); await call('god', true);
  const adv = async () => { for (let i = 0; i < 60; i++) { const s = await st(); if (s.talking) { await call('advanceDialogue', true); await step(10); } else if (s.pending) await step(30); else break; } };
  for (const e of [{ type: 'enter_zone', zone: 'temple_yard' }, { type: 'dialogue_end', id: 'boy_arrives' }]) await call('dispatch', e);
  await adv(); await step(20);
  const sc = (await st()).enemies.find(e => e.id === 'road_scout');
  await call('camera', null); await call('teleport', sc.x - 6, sc.z - 5, yawTo(6, 5)); await call('look', yawTo(6, 5), 0.22); await step(25);
  const officer = process.env.KZ_SCENE === 'officer', foe = officer ? 'officer' : 'road_scout';
  if (officer) await v(`(() => { const g = __valley.game; g.makeEnemies('village_enemies', { alert: 'unaware', dormant: true });
    const s = g.enemies.find(e => e.id === 'road_scout'); s.dormant = true; s.place(s.pos.x + 30, s.pos.z + 30, 0); return true; })()`);
  await v(`(() => { const g = __valley.game, e = g.enemies.find(e => e.id === '${foe}'), h = g.hero.pos; e.place(h.x + 2.4, h.z + 0.9, 0); e.dormant = false; e.brain.state = 'combat'; e.brain.awareness = 1; e.fighter.aware = true; })()`);
  const rec = [], releases = {}, frames = officer ? 520 : 320, inputs = officer ? OFFICER_INPUTS : INPUTS;
  for (let f = 0; f < frames; f++) {
    if (releases[f]) for (const fn of releases[f]) await fn();
    const a = inputs[f];
    if (a) {
      if (a[0] === 'click') { await click(a[1], true); (releases[f + a[2]] ||= []).push(() => release(a[1])); }
      else { await key(a[1], true); (releases[f + a[2]] ||= []).push(() => key(a[1], false)); }
    }
    await step(1);                                                  // 入力を押している間も、1コマずつ進めて記録する
    const s = await st(), h = s.hero, e = s.enemies.find(e => e.id === foe);
    // 主人公：状態・体力・構え・位置・向き・受け・屈み・技の id と位相・反撃の猶予／敵：状態・体力・構え・位置・技（id・経過・位相）
    rec.push([f, h.state, h.hp, h.posture, h.speed, h.x, h.z, h.yaw, h.blocking, h.crouch, h.move, h.phase, h.counter, e.state, e.hp, e.posture, e.x, e.z, e.mv ? [e.mv.id, e.mv.t, e.mv.phase] : null]);
  }
  if (process.env.KZ_OUT) fs.writeFileSync(process.env.KZ_OUT, JSON.stringify(rec) + '\n');
  const attackStarts = rec.filter((r, i) => r[1] === 'attack' && (i === 0 || rec[i - 1][1] !== 'attack')).map(r => r[0]);
  const moveStarts = rec.filter((r, i) => r[10] && (i === 0 || rec[i - 1][10] !== r[10] || rec[i - 1][11] === 'end')).map(r => `${r[0]}:${r[10]}`);
  const foeMoves = rec.filter((r, i) => r[18] && (i === 0 || !rec[i - 1][18] || rec[i - 1][18][0] !== r[18][0])).map(r => `${r[0]}:${r[18][0]}`);
  log(`frames ${rec.length}, hero attack starts at frames ${JSON.stringify(attackStarts)}, moves ${JSON.stringify(moveStarts)}, ${foe} moves ${JSON.stringify(foeMoves)}, ${foe} hp ${rec.at(-1)[14]}`);
}

// 比べる（ノードで直接実行したとき）
if (process.argv[1] && process.argv[1].endsWith('regress-attack-timing.mjs') && process.argv.length === 4) {
  const [a, b] = process.argv.slice(2).map(p => JSON.parse(fs.readFileSync(p, 'utf8')));
  let diffs = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) { if (diffs++ < 5) console.log('差', i, JSON.stringify(a[i]), JSON.stringify(b[i])); }
  console.log(diffs === 0 ? `一致：${a.length}コマ` : `不一致：${diffs}コマ`);
  process.exit(diffs === 0 ? 0 : 1);
}
