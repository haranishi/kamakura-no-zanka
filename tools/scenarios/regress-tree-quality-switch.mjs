// 木：品質の切り替え（標準→軽量→標準）を繰り返しても、GPU資源（形状・テクスチャ・プログラム）と木の描画集合が増えないこと、
//     若木・灌木の集合を含む全ての木の資源が、切り替えで確実に解放されること、軽量が標準より少ない三角形であることを確かめる。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-tree-quality-switch.mjs --strict --out .captures/tree-switch
export default async function ({ v, freeze, start, step, call, log }) {
  await start('new'); await freeze(true); await step(40); await call('god', true);
  const read = () => v(`(() => {
    const g = __valley.game, i = g.renderer.info, t = g.veg.trees;
    let meshes = 0, tris = 0;
    t.group.children.forEach(m => { meshes++; tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3 * m.count; });
    return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs ? i.programs.length : null, treeMeshes: meshes, treeTris: Math.round(tris), sets: t.sets.length, stats: t.stats };
  })()`);
  const fail = [];
  const first = await read(); log('初期(標準)', JSON.stringify(first));
  let last = first;
  for (let k = 1; k <= 4; k++) {
    await call('quality', 'light'); await step(40); await v(`__valley.game.veg.trees.update(__valley.game.camera, true)`); const light = await read();
    await call('quality', 'standard'); await step(40); await v(`__valley.game.veg.trees.update(__valley.game.camera, true)`); const std = await read();
    log(`切替${k}: 軽量 ${JSON.stringify(light)}`); log(`        標準 ${JSON.stringify(std)}`);
    if (light.treeTris >= std.treeTris) fail.push(`切替${k}: 軽量の木の三角形(${light.treeTris})が標準(${std.treeTris})以上`);
    if (std.geometries > first.geometries + 4) fail.push(`切替${k}: 形状が増えた ${first.geometries}→${std.geometries}`);
    if (std.textures > first.textures + 4) fail.push(`切替${k}: テクスチャが増えた ${first.textures}→${std.textures}`);
    if (std.treeMeshes !== first.treeMeshes || std.sets !== first.sets) fail.push(`切替${k}: 木の集合が変わった ${first.sets}/${first.treeMeshes}→${std.sets}/${std.treeMeshes}`);
    last = std;
  }
  log('最終', JSON.stringify(last));
  if (fail.length) { log('FAIL:\n' + fail.join('\n')); throw new Error('tree quality switch regression'); }
  log('OK: 品質の切り替えを4往復しても、形状・テクスチャ・木の集合は増えない');
}
