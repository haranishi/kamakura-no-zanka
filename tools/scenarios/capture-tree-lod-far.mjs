// 遠景の溶かしの帯（標準150m±8・軽量100m±6）を、同じ木へ近づきながら細い画角で撮る（8.1a第2周：遠景を絵の板にした）。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-tree-lod-far.mjs --out .captures/lod-far [--q light]
// 中景（L1）と遠景の板（L2）が帯の中で入れ替わる様子と、明るさ・大きさの跳びを並べて見る。画角10°・カメラは地面から30m上。
// 木は、開けた所（杉は里の北西、楓は川の南）から175〜230m先の大きな1本を選ぶ（Nodeで世界のデータから決めた未測定の撮影設計値）。
export default async function ({ v, freeze, start, step, call, shot, log }) {
  await start('new'); await freeze(true); await step(30); await call('god', true);
  await v("document.body.classList.add('hide-hud')");
  const light = (await v('__valley.game.post.quality')) === 'light';
  const DIST = light ? [118, 108, 103, 100, 97, 92, 84] : [176, 162, 154, 150, 146, 138, 126];
  log('boards', await v('!!__valley.game.veg.trees.impostors'), 'bake ms', await v('__valley.game.veg.trees.bakeMs'));
  await v(`(async () => { const {createWind}=await import('/valley/wind.js'); const g=__valley.game; g.time=12; g.wind=createWind(); g.aiPaused=true; g.veg.wind.uTime.value=5; })()`);
  for (const [species, AT] of [[0, [-60, 20]], [3, [20, 40]]]) {
    const tree = await v(`(() => { const t = __valley.game.veg.trees, d = t.data, sp = t.species.species; let best = null;
      for (let i = 0; i < d.x.length; i++) { if (sp[i] !== ${species}) continue; const dist = Math.hypot(d.x[i] - ${AT[0]}, d.z[i] - ${AT[1]}); if (dist < 175 || dist > 230) continue; if (!best || d.s[i] > best.s) best = { i, x: d.x[i], z: d.z[i], y: d.y[i], s: d.s[i], dist }; }
      return best; })()`);
    if (!tree) { log('no tree for species', species); continue; }
    const dx = AT[0] - tree.x, dz = AT[1] - tree.z, n = Math.hypot(dx, dz), ux = dx / n, uz = dz / n;
    log('species', species, 'tree', JSON.stringify(tree));
    for (const d of DIST) {
      const cx = tree.x + ux * d, cz = tree.z + uz * d;
      await call('teleport', cx, cz, 0);
      await call('camera', [cx, tree.y + 30, cz], [tree.x, tree.y + (species === 0 ? 8 : 5), tree.z], 10, true);
      await step(3); await v('__valley.game.veg.trees.update(__valley.game.camera, true)'); await step(2);
      await shot(`lodfar-s${species}-d${String(d).padStart(3, '0')}`);
    }
  }
  await call('camera', null);
  log('far lod walk done');
}
