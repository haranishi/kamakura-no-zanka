// 固定画角の撮影セット（画面の採点・改善の前後比較に使う）。乱数・カメラ・時刻は固定。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-set.mjs --out .captures/set-r1
// design-validation.mdの既存10＋新3。画像を見て選んだ（会話の枠が被る03・06と、14に近い15は外した）。
export const FIXED_13 = [1, 4, 8, 9, 11, 12, 14, 19, 20, 21, 22, 23, 24];
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
export default async function ({ st, step, call, v, shot, freeze, start, log, tap, click, key, release }) {
  const adv = async () => { for (let i = 0; i < 60; i++) { const s = await st(); if (s.talking) { await call('advanceDialogue', true); await step(10); } else if (s.pending) await step(30); else break; } };
  const cam = async (name, pos, look, fov = 54, settle = 4) => { await call('camera', pos, look, fov); await step(settle); await shot(name); };
  await start('new'); await freeze(true); await step(40); await call('god', true);
  // 1 主人公の三人称（開始直後）
  await shot('01-start-thirdperson');
  await cam('02-hero-closeup', [-98.3, 1.7, -86.4], [-100.5, 1.15, -89], 36, 30); await call('camera', null);
  // 2 庭と穂太
  await call('teleport', -86, -75, -2.2); await step(5);
  for (let i = 0; i < 160; i++) { await step(3); const s = await st(); if (s.talking) break; }
  await shot('03-boy-dialogue'); await adv();
  // 3 林道・斥候
  const s0 = await st(); const sc = s0.enemies.find(e => e.id === 'road_scout');
  await call('camera', null); await call('teleport', sc.x - 6, sc.z - 5, yawTo(6, 5)); await call('look', yawTo(6, 5), 0.22); await step(25); await shot('04-forest-road-scout');
  // 4 斥候との戦い（予兆の瞬間を狙う）
  await v(`(()=>{ const g=__valley.game; const e=g.enemies.find(e=>e.id==='road_scout'); const h=g.hero.pos; e.place(h.x+2.4, h.z+0.9, 0); e.brain.state='combat'; e.brain.awareness=1; e.fighter.aware=true; })()`);
  let got = 0;
  for (let f = 0; f < 600 && got < 2; f++) { await step(3); const s = await st(); const e = s.enemies.find(e => e.id === 'road_scout'); if (e.state === 'attack' && e.alive) { await shot('05-duel-telegraph-' + got++); await step(10); } }
  await v(`(()=>{ const g=__valley.game; const e=g.enemies.find(e=>e.id==='road_scout'); e.fighter.hp=0; e.fighter.alive=false; e.fighter.state='down'; e.die(); g.reportDown(e,'killed'); })()`);
  // 5 見晴らし岩
  await call('teleport', -51, -34, -2.3); await call('look', -2.1, 0.05); await step(20); await shot('06-viewpoint-dialogue'); await adv();
  await shot('07-viewpoint-choice');
  await v("document.getElementById('choice-front').click()"); await step(5);
  await call('camera', [-46, 2.4, -30], [20, 8, 2], 56); await step(4); await v("document.body.classList.add('hide-hud')"); await shot('08-overlook-village'); await v("document.body.classList.remove('hide-hud')");
  // 6 里：入口と戦闘
  await call('camera', null); await call('teleport', -33, -3, -1.6); await call('look', -1.5, 0.18); await step(40); await shot('09-village-front');
  let a = 0;
  for (let f = 0; f < 700 && a < 2; f++) { await step(4); const s = await st(); const e = s.enemies.find(e => e.id === 'village_archer'); if (e && e.state === 'attack' && e.alive) { await call('camera', [e.x + 4.5, 1.9, e.z + 3.5], [e.x, 1.3, e.z], 44); await step(1); await shot('10-enemy-archer-' + a++); await call('camera', null); await step(8); } }
  await call('camera', [-14, 2.6, 6], [-7, 1.0, 4], 52); await step(4); await shot('11-village-fight-wide'); await call('camera', null);
  // 7 全員倒す → 弥十郎
  await v(`(()=>{ const g=__valley.game; for (const e of g.enemies) if (e.group==='village_enemies' && e.fighter.alive) { e.fighter.hp=0; e.fighter.alive=false; e.fighter.state='down'; e.die(); g.reportDown(e,'killed'); } })()`);
  await step(30); await adv(); await step(20);
  const s1 = await st(); const al = s1.ally;
  await call('teleport', al.x + 1.4, al.z + 1.4, yawTo(-1.4, -1.4)); await step(20); await shot('12-captive-prompt');
  await tap('KeyE'); await step(5); await adv(); await step(200); await shot('13-ally-joined');
  // 8 待ち伏せ
  await call('teleport', -50, -18, 0.93); await call('look', 0.93, 0.12); await step(70); await shot('14-ambush');
  await step(40); await shot('15-ambush-ally-shot');
  // 9 結果（廃寺・焚き火）
  await v(`(()=>{ const g=__valley.game; for (const e of g.enemies) if (e.fighter.alive) { e.fighter.hp=0; e.fighter.alive=false; e.fighter.state='down'; e.die(); g.reportDown(e,'killed'); } })()`);
  await step(30); await adv();
  await call('teleport', -73, -65, 2.4); await step(80); await shot('16-result-scene-dialogue');
  await adv(); await step(120); await shot('17-result-screen');
  // 10 小道具・遠景
  await v(`(()=>{ const g = __valley.game; g.hud.hideResult(); g.hud.showHUD(true); g.flow = 'play'; })()`);
  await call('teleport', -6, -5, 0); await call('camera', [-6, 2.0, -5], [0, 0.9, 0.5], 40); await step(6); await shot('18-well-closeup');
  await call('teleport', -34, 1, 0); await call('camera', [-34, 2.2, 1], [-27, 1.0, 5], 46); await step(6); await shot('19-cart-banners');
  await call('teleport', 20, 40, 0); await call('camera', [20, 6.0, 40], [120, 14, -20], 42); await step(6); await shot('20-valley-river-distance');
  await call('teleport', -30, 20, 0); await call('camera', [-30, 4, 20], [260, 50, -140], 34); await step(6); await shot('21-far-mountains');
  // 以下だけ追加。座標・FOV・時刻12秒・seed1333・待機6コマは未測定の撮影設計値。
  // scatter/terrainのNode調査で決定。選定条件と密度はREADME-valley-qa.md。
  const vegetation = [
    // 座標はNodeで世界のデータから計算し、画像を見て確かめた。草は6m内の草が最多の平地・杉は林道の中心から道なりに見る（左右に杉の列）・広葉樹は周りの杉が少ない固まりを18m離れた開けた側から見る。
    ['22-grass-closeup', [66, 0.7, -9], [54, 0.4, -8.6], 54],
    ['23-cedar-interior', [-36, 1.7, -48], [-33.6, 1.8, -59.8], 58],
    ['24-maple-broadleaf', [-17.3, 2, -91.2], [-34.6, 6.5, -95.9], 50],
  ];
  for (const [name, pos, look, fov] of vegetation) {
    await v(`(async()=>{
      const {mulberry32}=await import('/valley/scatter.js');
      const {createWind}=await import('/valley/wind.js');
      const g=__valley.game; window.__captureRandom=Math.random;
      Math.random=mulberry32(1333); g.rng=mulberry32(1333); g.time=12; g.wind=createWind();
      g.aiPaused=true; g.fxT=0; g.chimneyT=0; g.fx.add.count=0; g.fx.norm.count=0;
    })()`);
    // 主人公は、カメラの4m後ろ（向きは視線と同じ）に置く。影は主人公に追従するが、体は画面に入らない。
    const dx = look[0] - pos[0], dz = look[2] - pos[2], len = Math.hypot(dx, dz) || 1;
    try { await call('teleport', pos[0] - 4 * dx / len, pos[2] - 4 * dz / len, yawTo(dx, dz)); await cam(name, pos, look, fov, 6); }
    finally { await v('Math.random=window.__captureRandom; delete window.__captureRandom'); }
  }
  log('capture set done');
}
