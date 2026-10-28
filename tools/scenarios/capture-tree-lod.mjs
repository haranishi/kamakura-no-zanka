// 同じ杉を、遠くから近くへカメラを寄せながら撮り、LODの溶かしの帯（標準：48m±帯）を通る様子を並べて見る。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-tree-lod.mjs --out .captures/lod-r1 [--q light]
// 棚田の南（約46m先まで木が無い）を背にして、周りの杉のうち一番大きい1本へ寄る。画面の中央の木を見る。
const AT = [3, 75], DISTANCES = [90, 75, 64, 58, 54, 50, 46, 42, 38, 33, 28];
export default async function ({ v, freeze, start, step, call, shot, log }) {
  await start('new'); await freeze(true); await step(30); await call('god', true);
  await v("document.body.classList.add('hide-hud')");
  await v(`(async () => { const {createWind}=await import('/valley/wind.js'); const g=__valley.game; g.time=12; g.wind=createWind(); g.aiPaused=true; g.veg.wind.uTime.value=5; })()`);
  // 若木・灌木は、近づく経路をふさぐので、この撮影では見えなくする（対象は中央の1本）。
  await v(`__valley.game.veg.trees.group.children.forEach(m => { if (/^tree-[45]-/.test(m.name)) m.visible = false; })`);
  for (const species of [0, 1, 3]) {                                   // 杉・欅・楓
    const tree = await v(`(() => { const t = __valley.game.veg.trees, d = t.data, sp = t.species.species; let best = null;
      for (let i = 0; i < d.x.length; i++) { if (sp[i] !== ${species}) continue; const dist = Math.hypot(d.x[i] - ${AT[0]}, d.z[i] - ${AT[1]}); if (dist < 50 || dist > 70 || d.x[i] < -125 || d.x[i] > 95 || d.z[i] < -125 || d.z[i] > 105) continue; if (!best || d.s[i] > best.s) best = { i, x: d.x[i], z: d.z[i], s: d.s[i], dist }; }
      return best; })()`);
    if (!tree) { log('no tree for species', species); continue; }
    const dx = AT[0] - tree.x, dz = AT[1] - tree.z, n = Math.hypot(dx, dz), ux = dx / n, uz = dz / n;
    log('species', species, 'tree', JSON.stringify(tree));
    for (const d of DISTANCES) {
      const cx = tree.x + ux * d, cz = tree.z + uz * d;
      await call('teleport', cx - ux * 3, cz - uz * 3, Math.atan2(ux, uz));
      await call('camera', [cx, 1.8, cz], [tree.x, species === 0 ? 8 : 4, tree.z], 40);
      await step(4); await v(`__valley.game.veg.trees.update(__valley.game.camera, true)`); await step(2);
      await shot(`lod-s${species}-d${String(d).padStart(3, '0')}`);
    }
  }
  await call('camera', null);
  log('lod walk done');
}
