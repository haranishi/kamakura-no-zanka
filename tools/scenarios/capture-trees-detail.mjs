// 木の作り込み（第3弾 8.1a）の前後比較：近景（3〜10m）・中景（20〜40m）・遠景の木を、同じ条件で撮る。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-trees-detail.mjs --w 1280 --h 720 --seed 1333 [--q light] --out .captures/trees-detail
// 森の画角は capture-set.mjs の植生3枚と同じ固定（時刻12秒・乱数1333・風の位相）。標本は棚田の南（半径約45mに木が無い）に1本ずつ立てる。
// 撮影の座標はNodeで世界のデータから選び、画像を見て決めた（未測定の撮影設計値）。
const SUN = [0.50, 0.85], AT = [3, 75];
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
export default async function ({ v, freeze, start, step, call, shot, log }) {
  await start('new'); await freeze(true); await step(30); await call('god', true);
  await v("document.body.classList.add('hide-hud')");
  const fix = () => v(`(async()=>{
    const {mulberry32}=await import('/valley/scatter.js'); const {createWind}=await import('/valley/wind.js');
    const g=__valley.game; Math.random=mulberry32(1333); g.rng=mulberry32(1333); g.time=12; g.wind=createWind();
    g.aiPaused=true; g.fxT=0; g.chimneyT=0; g.fx.add.count=0; g.fx.norm.count=0; g.veg.wind.uTime.value=5;
  })()`);
  const original = await v('(window.__treesRandom = Math.random, 0)');
  const cam = async (name, pos, look, fov) => {
    const dx = look[0] - pos[0], dz = look[2] - pos[2], len = Math.hypot(dx, dz) || 1;
    await fix(); await call('teleport', pos[0] - 4 * dx / len, pos[2] - 4 * dz / len, yawTo(dx, dz));
    await call('camera', pos, look, fov); await step(6); await v('__valley.game.veg.trees.update(__valley.game.camera, true)'); await step(2); await shot(name);
  };
  try {
    // 近景：林道の中から（FIXED_13の23と同じ）、道ばたの杉の根元から見上げる、幹の寄り。
    const cedar = await v(`(() => { const t = __valley.game.veg.trees, d = t.data, sp = t.species.species; let best = null;
      for (let i = 0; i < d.x.length; i++) { if (sp[i] !== 0) continue; const dist = Math.hypot(d.x[i] + 38, d.z[i] + 52); if (!best || dist < best.dist) best = { x: d.x[i], z: d.z[i], s: d.s[i], dist }; }
      return best; })()`);
    log('near cedar', JSON.stringify(cedar));
    await cam('n1-cedar-road', [-36, 1.7, -48], [-33.6, 1.8, -59.8], 58);
    const away = [cedar.x + 5.5, cedar.z + 2.5];
    await cam('n2-cedar-crown-from-below', [away[0], 1.6, away[1]], [cedar.x, 7, cedar.z], 62);
    await cam('n3-bark-close', [cedar.x + 2.4, 1.4, cedar.z + 1.0], [cedar.x, 1.6, cedar.z], 50);
    // 近景の広葉（FIXED_13の24）と開始地点の三人称に近い画角。
    await cam('n4-broadleaf', [-17.3, 2, -91.2], [-34.6, 6.5, -95.9], 50);
    await cam('n5-start-garden', [-98.8, 2.6, -84.6], [-84, 4.5, -73], 58);
    // 中景：林の縁を25〜40mから（里の入口から北西の杉林）、遠景：見晴らし岩（FIXED_13の08）。
    await cam('m1-forest-edge', [-30, 2.2, -6], [-55, 7, -30], 54);
    await cam('f1-overlook', [-46, 2.4, -30], [20, 8, 2], 56);
    // 標本：同じ杉（形0・3・4）と広葉を、12mと30mから順光で（太陽と反対側から見る）。
    const len = Math.hypot(...SUN), V = [SUN[0] / len, SUN[1] / len], ROW = [-V[1], V[0]];
    for (const [name, items, dist, spacing, fov] of [
      ['s1-cedars-30m', [[0, 0], [0, 3], [0, 4]], 30, 9, 46], ['s2-cedar-12m', [[0, 0]], 12, 1, 70],
      ['s3-broadleaf-14m', [[1, 0, .55], [3, 0, .55]], 14, 9, 60]]) {
      await fix();
      const r = await call('treeSpecimens', { at: AT, yaw: Math.atan2(-ROW[1], ROW[0]), spacing, items: items.map(([species, shape, stage]) => ({ species, level: 0, shape, stage: stage ?? .5 })) });
      const cx = r.items.reduce((s, i) => s + i.x, 0) / r.items.length, cz = r.items.reduce((s, i) => s + i.z, 0) / r.items.length, tall = Math.max(...r.items.map(i => i.height));
      await call('teleport', cx + V[0] * (dist + 4), cz + V[1] * (dist + 4), 0);
      await call('camera', [cx + V[0] * dist, 1.8, cz + V[1] * dist], [cx, tall * .45, cz], fov); await step(6); await shot(name);
      await call('camera', [cx - V[0] * dist, 1.8, cz - V[1] * dist], [cx, tall * .45, cz], fov); await step(6); await shot(name + '-backlit');
    }
    await call('clearTreeSpecimens');
  } finally { await v('Math.random = window.__treesRandom || Math.random'); await call('camera', null); }
  log('trees detail done', original);
}
