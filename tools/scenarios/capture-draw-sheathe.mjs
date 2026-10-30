// 抜刀・納刀を、実ゲームで一定間隔のコマ割りに撮る（8.2の前後比較用）。乱数・カメラ・時刻は固定。
// 使い方（変更前と変更後を、それぞれの作業ツリーで同じ条件で撮る）:
//   PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-draw-sheathe.mjs --w 800 --h 450 --seed 1333 --out .captures/draw-sheathe-before
// 撮る3つの場面（どれも斥候の近く）:
//   A 敵が気づく → 落ち着いた抜刀（変更前は、抜刀の動作が無く、最初の攻撃で刃が手に現れる）
//   B 納刀済みで攻撃入力 → 速い抜刀（変更前は、攻撃の開始で刃が手に現れる）
//   C 戦闘が終わって自動で納刀 → 落ち着いた納刀（変更前は、刃が消えて腰の柄が現れるだけ）
// 固定カメラは主人公の左側（鞘と手が見える側）。出力名の数字は、各場面の開始からのコマ数（60コマ/秒）。
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const SHOTS = {
  A: { every: 6, count: 18 },     // 0.1秒おきに1.7秒
  B: { every: 2, count: 16 },     // 約0.033秒おきに0.5秒
  C: { every: 6, count: 16, lead: 6 },
};

export default async function ({ st, step, call, v, shot, freeze, start, log, click, release }) {
  await start('new'); await freeze(true); await step(40); await call('god', true);
  const adv = async () => { for (let i = 0; i < 60; i++) { const s = await st(); if (s.talking) { await call('advanceDialogue', true); await step(10); } else if (s.pending) await step(30); else break; } };
  for (const e of [{ type: 'enter_zone', zone: 'temple_yard' }, { type: 'dialogue_end', id: 'boy_arrives' }]) await call('dispatch', e);   // 斥候が出る段階まで進める
  await adv(); await step(20);
  const s0 = await st(); const sc = s0.enemies.find(e => e.id === 'road_scout');
  if (!sc) throw new Error('road_scout did not appear (quest beat setup failed)');
  await call('camera', null); await call('teleport', sc.x - 6, sc.z - 5, yawTo(6, 5)); await call('look', yawTo(6, 5), 0.22); await step(25);
  const hero = () => v(`(() => { const h = __valley.game.hero; return { x: h.pos.x, z: h.pos.z, yaw: h.yaw, drawn: h.drawn, sword: h.swordLayer ? h.swordLayer.snapshot() : null, state: h.fighter.state }; })()`);
  // 主人公の左側から、胸を見る固定カメラ（鞘・左手・右手・刀が見える）
  const sideCam = async () => {
    const h = await hero(), fx = -Math.sin(h.yaw), fz = -Math.cos(h.yaw), lx = fz, lz = -fx;
    await call('camera', [h.x + lx * 2.3 + fx * 0.5, 1.15, h.z + lz * 2.3 + fz * 0.5], [h.x, 1.0, h.z], 38);
  };
  const timeline = [];
  const mark = async (scene, f, name) => { const h = await hero(); timeline.push({ scene, f, drawn: h.drawn, sword: h.sword, state: h.state }); await shot(`${scene}-${String(f).padStart(3, '0')}-${name}`); };

  // ---- A：敵が気づく → 抜刀
  await shot('A-000-follow-sheathed');
  await sideCam();
  await v(`(() => { const g = __valley.game, e = g.enemies.find(e => e.id === 'road_scout'), h = g.hero.pos; e.place(h.x + 14, h.z + 6, 0); e.brain.state = 'combat'; e.brain.awareness = 1; e.fighter.aware = true; })()`);
  // 敵は14m離れた所で気づいた状態。1.7秒では、まだ主人公へ届かない（主人公は動かさない）。
  for (let i = 0; i < SHOTS.A.count; i++) { await mark('A', i * SHOTS.A.every, 'alert'); await step(SHOTS.A.every); }
  await call('camera', null); await step(2); await shot('A-999-follow-after');
  const afterA = await hero();
  // どの版でも「抜いた状態」にするため、攻撃を1回入れる（変更前は、ここで初めて刃が手に現れる。撮らない）
  await sideCam(); await click(0, 2); await release(0); await step(50);

  // ---- 戦闘を終える（敵を倒れた状態にする）。納刀までの時間を数える
  await v(`(() => { const g = __valley.game; const e = g.enemies.find(e => e.id === 'road_scout'); e.fighter.hp = 0; e.fighter.alive = false; e.fighter.state = 'down'; e.die(); g.reportDown(e, 'killed'); })()`);

  // ---- C：自動で納刀する瞬間まで進める（drawn が変わるコマ）。その前後を撮る
  await sideCam();
  let f = 0, sheatheAt = null;
  for (; f < 1200; f++) { const h = await hero(); if (!h.drawn) { sheatheAt = f; break; } await step(1); }
  log(`sheathe starts after ${sheatheAt} frames (drawn after A: ${afterA.drawn})`);
  // 開始の直前を数コマ戻して撮ることはできないので、開始時点から撮る（変更前は、このコマで刃が消える）
  for (let i = 0; i < SHOTS.C.count; i++) { await mark('C', i * SHOTS.C.every, 'sheathe'); await step(SHOTS.C.every); }
  await call('camera', null); await step(10);

  // ---- B：納刀済みで攻撃入力 → 速い抜刀
  const hb = await hero(); log(`before B: drawn=${hb.drawn} sword=${JSON.stringify(hb.sword)}`);
  await sideCam();
  await click(0, 2); await release(0);
  for (let i = 0; i < SHOTS.B.count; i++) { await mark('B', i * SHOTS.B.every, 'attack'); await step(SHOTS.B.every); }
  await call('camera', null); await step(30); await shot('B-999-follow-after');
  await v(`(() => { document.title = 'capture-draw-sheathe done'; })()`);
  const fs = await import('node:fs');
  if (process.env.KZ_TIMELINE) fs.writeFileSync(process.env.KZ_TIMELINE, JSON.stringify({ afterA, sheatheAt, timeline }, null, 1) + '\n');
}
