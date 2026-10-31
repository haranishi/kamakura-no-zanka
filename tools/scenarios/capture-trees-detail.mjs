// 木の作り込み（第3弾 8.1a）の前後比較：近景（3〜10m）・中景（20〜40m）・遠景の木を、同じ条件で撮る。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-trees-detail.mjs --w 1280 --h 720 --seed 1333 [--q light] --out .captures/trees-detail
// 第2周（2026-10-31）：盲検で、画角の重複（固定画角23・24・08と同じ絵が2組ずつ）、体力などの表示の写り込み、
// 太陽を向かない「逆光」を指摘された。全ての画をHUDなしで撮り、重複を外し、逆光は太陽の方位へ低い仰角で向けた。
// 太陽（高さ9.8°）は、谷のどこからも尾根（11°以上）の陰になる（Nodeで地形から計算）。逆光の画は、尾根の上の明るい空を背に撮る。
// 林道の斥候（固定画角04と同じ構図）と、楓の寄り（8m・Nodeで周りの開けた赤い楓を選んだ）を足した。
// 軽量品質（--q light）では、同じ名前に light- を付けて5枚だけ撮る。座標と仰角は画像を見て決めた未測定の撮影設計値。
const SUN = [0.50, 0.85], AT = [3, 75];
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const LIGHT = ['n1-cedar-road', 'n4-broadleaf', 'm1-forest-edge', 'f1-overlook', 's1-cedars-30m'];
export default async function ({ v, freeze, start, step, call, shot: save, log }) {
  await start('new'); await freeze(true); await step(30); await call('god', true);
  await v("document.body.classList.add('hide-hud')");
  const light = (await v('__valley.game.post.quality')) === 'light';
  const shot = async name => { if (!light) return save(name); if (LIGHT.includes(name)) return save('light-' + name); };
  const fix = () => v(`(async()=>{
    const {mulberry32}=await import('/valley/scatter.js'); const {createWind}=await import('/valley/wind.js');
    const g=__valley.game; Math.random=mulberry32(1333); g.rng=mulberry32(1333); g.time=12; g.wind=createWind();
    g.aiPaused=true; g.fxT=0; g.chimneyT=0; g.fx.add.count=0; g.fx.norm.count=0; g.veg.wind.uTime.value=5;
    document.body.classList.add('hide-hud');
  })()`);
  const original = await v('(window.__treesRandom = Math.random, 0)');
  // 主人公はカメラの4m後ろ（向きは視線と同じ）に置く。影は主人公に追従するが、体は画面に入らない。
  const cam = async (name, pos, look, fov) => {
    const dx = look[0] - pos[0], dz = look[2] - pos[2], len = Math.hypot(dx, dz) || 1;
    await fix(); await call('teleport', pos[0] - 4 * dx / len, pos[2] - 4 * dz / len, yawTo(dx, dz));
    await call('camera', pos, look, fov); await step(6); await v('__valley.game.veg.trees.update(__valley.game.camera, true)'); await step(2); await shot(name);
  };
  try {
    // 近景：林道の中から（固定画角23）、道ばたの杉の根元から見上げる、幹と根元の寄り。
    const cedar = await v(`(() => { const t = __valley.game.veg.trees, d = t.data, sp = t.species.species; let best = null;
      for (let i = 0; i < d.x.length; i++) { if (sp[i] !== 0) continue; const dist = Math.hypot(d.x[i] + 38, d.z[i] + 52); if (!best || dist < best.dist) best = { x: d.x[i], z: d.z[i], s: d.s[i], dist }; }
      return best; })()`);
    log('near cedar', JSON.stringify(cedar));
    await cam('n1-cedar-road', [-36, 1.7, -48], [-33.6, 1.8, -59.8], 58);
    const away = [cedar.x + 5.5, cedar.z + 2.5];
    await cam('n2-cedar-crown-from-below', [away[0], 1.6, away[1]], [cedar.x, 7, cedar.z], 62);
    await cam('n3-bark-close', [cedar.x + 2.4, 1.2, cedar.z + 1.0], [cedar.x, .9, cedar.z], 50);
    // 近景の広葉（固定画角24）・開始の庭・楓の寄り（赤い楓、8m西から）。
    await cam('n4-broadleaf', [-17.3, 2, -91.2], [-34.6, 6.5, -95.9], 50);
    await cam('n5-start-garden', [-98.8, 2.6, -84.6], [-84, 4.5, -73], 58);
    await cam('n6-maple-close', [-48.33, 1.7, -75.18], [-40.33, 5.2, -75.18], 60);
    // 林道の斥候（固定画角04と同じ構図：斥候の手前6・5mから、三人称のカメラで）。
    // 斥候は物語の進みで現れる（b2）。撮影では出現の位置（world-data.js）に直接出し、AIは止めたまま撮る。
    await v(`(() => { const g = __valley.game; if (!g.enemies.some(e => e.id === 'road_scout')) g.makeEnemies('road_scout', { alert: 'unaware' }); })()`);
    const scout = (await v('__valley.state()')).enemies.find(e => e.id === 'road_scout');
    await fix(); await call('camera', null); await call('teleport', scout.x - 6, scout.z - 5, yawTo(6, 5)); await call('look', yawTo(6, 5), 0.22);
    await step(25); await v('__valley.game.veg.trees.update(__valley.game.camera, true)'); await step(2); await shot('n7-scout-road');
    // 中景：林の縁を25〜40mから。遠景：見晴らし岩（固定画角08）と、谷の川から奥の山腹（固定画角20）。
    await cam('m1-forest-edge', [-30, 2.2, -6], [-55, 7, -30], 54);
    await cam('f1-overlook', [-46, 2.4, -30], [20, 8, 2], 56);
    await cam('f2-valley-river', [20, 6.0, 40], [120, 14, -20], 42);
    // 逆光：本物の森を太陽の方位へ（見晴らし岩の下から、仰角約9°。尾根の上が明るい）。
    const V = [SUN[0] / Math.hypot(...SUN), SUN[1] / Math.hypot(...SUN)], ROW = [-V[1], V[0]];
    await cam('f3-forest-backlit', [-58, 2.0, -52], [-58 + V[0] * 60, 11, -52 + V[1] * 60], 58);
    // 標本：同じ杉（形0・3・4）と広葉を、順光（太陽を背に）で。逆光は太陽の方位へ低く向け、樹冠を尾根の上の空に重ねる。
    for (const [name, items, dist, spacing, fov, backlit] of [
      ['s1-cedars-30m', [[0, 0], [0, 3], [0, 4]], 30, 9, 46, false], ['s2-cedar-12m', [[0, 0]], 12, 1, 70, false],
      ['s4-cedar-backlit-20m', [[0, 0]], 20, 1, 62, true], ['s3-broadleaf-14m', [[1, 0, .55], [3, 0, .55]], 14, 9, 60, false],
      ['s5-broadleaf-backlit-16m', [[1, 0, .55], [3, 0, .55]], 16, 9, 64, true]]) {
      await fix();
      const r = await call('treeSpecimens', { at: AT, yaw: Math.atan2(-ROW[1], ROW[0]), spacing, items: items.map(([species, shape, stage]) => ({ species, level: 0, shape, stage: stage ?? .5 })) });
      const cx = r.items.reduce((s, i) => s + i.x, 0) / r.items.length, cz = r.items.reduce((s, i) => s + i.z, 0) / r.items.length, tall = Math.max(...r.items.map(i => i.height));
      const side = backlit ? -1 : 1, lookY = backlit ? tall * .3 : tall * .45;
      await call('teleport', cx + side * V[0] * (dist + 4), cz + side * V[1] * (dist + 4), 0);
      await call('camera', [cx + side * V[0] * dist, 1.5, cz + side * V[1] * dist], [cx, lookY, cz], fov); await step(6); await shot(name);
    }
    await call('clearTreeSpecimens');
  } finally { await v('Math.random = window.__treesRandom || Math.random'); await call('camera', null); }
  log('trees detail done', original);
}
