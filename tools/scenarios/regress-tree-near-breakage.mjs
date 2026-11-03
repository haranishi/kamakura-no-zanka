// 木：至近の破綻（8.1a第3周）を実ブラウザの描画で測る。盲検（第2周）の指摘の4つ：
//   veil  …カメラ直前の葉が網点の半透明の膜になる（Q07・幹の寄り）。1画素の孤立した明暗の点（縦横とも極値）の割合で測る。
//   holes …樹冠の黒い穴・黒いしみ（Q04 林の縁の橙の木）。樹冠の枠の中で、ほぼ黒い画素（明るさ<24/255）の割合。
//   bare  …葉のない枝が空へ突き出す（Q06 樹冠を真下から）。枝だけ・葉だけを別に描き、周り9画素に葉の無い枝の画素の割合。
//   hollow…楓を真下から見た殻の中（Q10）。下面はもともと暗いので、真っ黒（明るさ<8）の画素の割合で測る。
// 画角は capture-trees-detail.mjs の n3・m1・n2・n6 と同じ。閾値は第2周（dee083d）と第3周を同じ条件で測って決めた（下の実測）。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-tree-near-breakage.mjs --strict --seed 1333 --out .captures/tree-near
const LIMIT = { veil: 0.03, holes: 0.025, bare: 0.035, hollow: 0.02 };
// 実測（1280×720、seed 1333）：第2周 veil .0698・holes .0393・bare .0390・hollow .0233 → 第3周 veil .0135・holes .0101・bare .0297・hollow .0173。
// bare と hollow は第3周でも差が小さい（枝の内側はまだ見え、楓の下面はもともと暗い）。上限は第2周を落とせる所に置いた。
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
export default async function ({ page, v, freeze, start, step, call, log }) {
  await start('new'); await freeze(true); await step(30); await call('god', true);
  await v("document.body.classList.add('hide-hud')");
  const fix = () => v(`(async()=>{
    const {mulberry32}=await import('/valley/scatter.js'); const {createWind}=await import('/valley/wind.js');
    const g=__valley.game; Math.random=mulberry32(1333); g.rng=mulberry32(1333); g.time=12; g.wind=createWind();
    g.aiPaused=true; g.fxT=0; g.chimneyT=0; g.fx.add.count=0; g.fx.norm.count=0; g.veg.wind.uTime.value=5;
  })()`);
  const original = await v('(window.__nearRandom = Math.random, 0)');
  const cam = async (pos, look, fov) => {
    const dx = look[0] - pos[0], dz = look[2] - pos[2], len = Math.hypot(dx, dz) || 1;
    await fix(); await call('teleport', pos[0] - 4 * dx / len, pos[2] - 4 * dz / len, yawTo(dx, dz));
    await call('camera', pos, look, fov); await step(6); await v('__valley.game.veg.trees.update(__valley.game.camera, true)'); await step(2);
  };
  const grab = async () => (await page.screenshot()).toString('base64');
  // The frozen game draws only on step(): toggle, then draw one frame before the screenshot.
  const show = async mode => { await v(`__valley.game.veg.trees.group.children.forEach(m => { m.visible = ${JSON.stringify(mode)} === 'all' || m.name.endsWith(${JSON.stringify(mode)}); })`); await step(1); };
  const measure = (kind, shots, box) => page.evaluate(async ([kind, shots, box]) => {
    const load = async s => { const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob()); const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d'); g.drawImage(img, 0, 0); return { w: img.width, h: img.height, d: g.getImageData(0, 0, img.width, img.height).data }; };
    const img = await Promise.all(shots.map(load)), { w, h } = img[0], L = (k, x, y) => { const i = (y * w + x) * 4, d = img[k].d; return .2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]; };
    const [x0, y0, x1, y1] = box ?? [1, 1, w - 1, h - 1]; let hit = 0, n = 0;
    if (kind === 'veil') {
      // An isolated dot: brighter or darker than all four neighbours by 6+ (the alpha-to-coverage and dither screen).
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const c = L(0, x, y), d = [L(0, x - 1, y), L(0, x + 1, y), L(0, x, y - 1), L(0, x, y + 1)].map(q => c - q); n++;
        if (d.every(q => q > 6) || d.every(q => q < -6)) hit++;
      }
    } else if (kind === 'dark' || kind === 'black') {
      const t = kind === 'dark' ? 24 : 8;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { n++; if (L(0, x, y) < t) hit++; }
    } else {
      // shots: [no trees, wood only, leaves only]. Wood pixel: differs from the empty frame. Bare: no leaf within 9 px.
      const differs = (k, x, y) => { const i = (y * w + x) * 4; return Math.abs(img[k].d[i] - img[0].d[i]) + Math.abs(img[k].d[i + 1] - img[0].d[i + 1]) + Math.abs(img[k].d[i + 2] - img[0].d[i + 2]) > 30; };
      const leaf = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) leaf[y * w + x] = differs(2, x, y) ? 1 : 0;
      for (let y = y0 + 9; y < y1 - 9; y++) for (let x = x0 + 9; x < x1 - 9; x++) {
        n++; if (!differs(1, x, y)) continue;
        let near = false; for (let dy = -9; dy <= 9 && !near; dy += 3) for (let dx = -9; dx <= 9; dx += 3) if (leaf[(y + dy) * w + x + dx]) { near = true; break; }
        if (!near) hit++;
      }
    }
    return hit / Math.max(1, n);
  }, [kind, shots, box]);
  const out = {};
  try {
    const cedar = await v(`(() => { const t = __valley.game.veg.trees, d = t.data, sp = t.species.species; let best = null;
      for (let i = 0; i < d.x.length; i++) { if (sp[i] !== 0) continue; const dist = Math.hypot(d.x[i] + 38, d.z[i] + 52); if (!best || dist < best.dist) best = { x: d.x[i], z: d.z[i], dist }; }
      return best; })()`);
    await cam([cedar.x + 2.4, 1.2, cedar.z + 1.0], [cedar.x, .9, cedar.z], 50);
    out.veil = await measure('veil', [await grab()], [0, 0, 560, 720]);
    await cam([-30, 2.2, -6], [-55, 7, -30], 54);
    out.holes = await measure('dark', [await grab()], [850, 200, 1060, 380]);
    await cam([cedar.x + 5.5, 1.6, cedar.z + 2.5], [cedar.x, 7, cedar.z], 62);
    await v('__valley.game.veg.trees.group.visible = false'); await step(1); const empty = await grab(); await v('__valley.game.veg.trees.group.visible = true');
    await show('wood'); const wood = await grab(); await show('leaf'); const leaves = await grab(); await show('all');
    out.bare = await measure('bare', [empty, wood, leaves], [0, 0, 1280, 720]);
    await cam([-48.33, 1.7, -75.18], [-40.33, 5.2, -75.18], 60);
    out.hollow = await measure('black', [await grab()], [200, 0, 1100, 330]);
  } finally { await v('Math.random = window.__nearRandom || Math.random'); await show('all'); await call('camera', null); }
  log('near breakage', JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, x]) => [k, +x.toFixed(4)]))), 'limits', JSON.stringify(LIMIT), original);
  const fail = Object.entries(LIMIT).filter(([k, limit]) => !(out[k] <= limit)).map(([k, limit]) => `${k} ${out[k].toFixed(4)} > ${limit}`);
  if (fail.length) { log('FAIL: ' + fail.join(' / ')); throw new Error('tree near-breakage regression'); }
  log('OK: 網点・黒い穴・葉のない枝・殻の中の黒は、どれも上限以下');
}
