// 影の前後比較（2026-11-04・案A）：木が風で揺れたとき影も揺れるか、歩いたとき影がちらつかないかを、同じ条件で撮る。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-shadows.mjs --w 1280 --h 720 --seed 1333 [--q light] --out <出力先>
// 林道の杉と廃寺の庭に近い広葉樹（庭から約30m東）の影の落ちる地面を、高い所から見下ろす。風は時計を進めずに風の値だけ書き換えて
// game.render を呼ぶ（人物の動作・AIは進まない）ので、同じ画の中で動くのは木と、木の影だけ。
// 無風（uWind=0）／通常風の2つの位相（A・B、ゆっくりした揺れの半周期違い）／案内の突風（uGuideMix=1、帯が木に来る時刻）。
// 歩きの帯：林道を同じ入力で歩き、10コマ置きに10枚を撮る（帯に並べるのは撮影の外の作業）。
// 軽量品質（--q light）では、名前に light- を付けて木の8枚だけ撮る（歩きの帯は標準だけ）。座標・画角は画像を見て決めた未測定の撮影設計値。
const SUN = [0.50, 0.17, 0.85];
export default async function ({ v, freeze, start, step, call, shot: save, log }) {
  await start('new'); await freeze(true); await step(30); await call('god', true);
  await v("document.body.classList.add('hide-hud')");
  const light = (await v('__valley.game.post.quality')) === 'light';
  const shot = name => save(light ? 'light-' + name : name);
  await v(`(async()=>{
    const {mulberry32}=await import('/valley/scatter.js'); const {createWind}=await import('/valley/wind.js');
    const g=__valley.game; Math.random=mulberry32(1333); g.rng=mulberry32(1333); g.time=12; g.wind=createWind();
    g.aiPaused=true; g.fxT=0; g.chimneyT=0; g.fx.add.count=0; g.fx.norm.count=0;
  })()`);
  const pick = (x, z, kinds) => v(`(() => { const t = __valley.game.veg.trees, d = t.data, sp = t.species.species; let best = null;
    for (let i = 0; i < d.x.length; i++) { if (!${JSON.stringify(kinds)}.includes(sp[i])) continue; const dist = Math.hypot(d.x[i] - ${x}, d.z[i] - ${z});
      if (!best || dist < best.dist) best = { x: d.x[i], z: d.z[i], s: d.s[i], sp: sp[i], dist }; } return best; })()`);
  // 影は太陽と逆（-sunDir の水平成分）へ伸びる。カメラは木の太陽側の上、影の伸びる先を見下ろす。
  const sx = -SUN[0] / Math.hypot(SUN[0], SUN[2]), sz = -SUN[2] / Math.hypot(SUN[0], SUN[2]);
  const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
  const render = (uTime, uWind, uGuideMix) => v(`(() => { const g = __valley.game, w = g.veg.wind;
    w.uTime.value = ${uTime}; w.uWind.value = ${uWind}; w.uGuideMix.value = ${uGuideMix}; w.uWindDir.value.set(1, 0); g.render(1 / 60); })()`);
  // 突風の帯が木の位置に来る時刻（tree-materials.js の bandPhase と treeNoise を同じ式で）。
  const gustTime = (x, z) => { const noise = (px, pz) => {
      const ax = Math.floor(px), az = Math.floor(pz); let fx = px - ax, fz = pz - az; fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
      const h = (a, b) => Math.sin(a * 12.9898 + b * 78.233), mix = (a, b, t) => a + (b - a) * t;
      return mix(mix(h(ax, az), h(ax + 1, az), fx), mix(h(ax, az + 1), h(ax + 1, az + 1), fx), fz); };
    let best = 0, bestT = 5; for (let t = 5; t < 12; t += .01) { const s = Math.sin(x * .045 - t * .9 + noise(x * .025, z * .025) * .65); if (s > best) { best = s; bestT = t; } }
    return bestT; };
  // 見下ろし：影の伸びる先（木から ahead m）の真上 height m から、太陽側へ back m ずらして見る。
  const scene = async (name, tree, back, height, ahead, fov) => {
    const look = [tree.x + sx * ahead, 0, tree.z + sz * ahead], cam = [look[0] - sx * back, height, look[2] - sz * back];
    // 主人公は見る先の8m手前に置く（影の中心＝主人公の8m先＝見る先）。体は画の手前下に入ることがある。
    const yaw = yawTo(sx, sz); await call('teleport', look[0] - 8 * sx, look[2] - 8 * sz, yaw);
    await call('camera', cam, look, fov); await step(8); await v('__valley.game.veg.trees.update(__valley.game.camera, true)'); await step(2);
    const tg = gustTime(tree.x, tree.z);
    log(name, JSON.stringify(tree), 'gust t', tg.toFixed(2));
    for (const [suffix, t, w, g] of [['calm', 5, 0, 0], ['wind', 5, 1, 0], ['wind-b', 5 + Math.PI / .8, 1, 0], ['gust', tg, 1, 1]]) { await render(t, w, g); await shot(`${name}-${suffix}`); }
  };
  try {
    const cedar = await pick(-38, -52, [0]), broad = await pick(-92, -80, [1, 3]);
    await scene('cedar', cedar, 6, 42, 9, 50);
    await scene('broadleaf', broad, 6, 36, 7, 50);
    // 追従のちらつき：同じ見下ろしの画を固定し、無風のまま主人公（影の中心）だけを画の外で横へ少しずつ動かす。
    // 影を作る物は動かないので、変わる画素は影の範囲の追従による縁の揺れだけ（帯の外の作業で隣り合う画を引き比べる）。
    {
      const look = [broad.x + sx * 7, 0, broad.z + sz * 7], px = -sz, pz = sx;
      await v(`(async()=>{ const {createWind}=await import('/valley/wind.js'); __valley.game.wind=createWind({strength:0}); })()`);
      for (let k = 0; k < 10; k++) {
        const o = -2 + k * 0.137;   // 1コマに約0.14m（歩きの速さの目安）
        await call('teleport', look[0] + sx * 16 + px * o, look[2] + sz * 16 + pz * o, yawTo(px, pz));
        await call('camera', [look[0] - sx * 6, 36, look[2] - sz * 6], look, 50); await step(1); await shot(`follow-${String(k).padStart(2, '0')}`);
      }
    }
    if (!light) {
      // 歩きの帯：林道の上で、三人称のカメラのまま北東へ同じ入力で歩く。
      await call('camera', null); await call('teleport', -40, -40, yawTo(.45, -.9)); await call('look', yawTo(.45, -.9), 0.42); await step(30);
      await call('key', 'KeyW', true);
      for (let k = 0; k < 10; k++) { await step(10); await shot(`walk-${String(k).padStart(2, '0')}`); }
      await call('key', 'KeyW', false);
    }
  } finally { await call('camera', null); }
  log('shadow captures done');
}
