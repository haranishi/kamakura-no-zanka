// 木：動きを減らす設定（game.settings.reducedMotion）で、木の揺れが通常より小さくなること（R14.6）。
// 方法：同じ標本（杉・欅・楓・松・若木・灌木）を固定カメラで、時刻だけを変えた2枚（0.7秒離す）を撮り、画素の変化量を比べる。
//       風が強い（通常）ほど2枚の差が大きく、減らす設定では小さい。実ブラウザの描画結果で確かめる（シェーダー文字列の検査とは別）。
//       通常の変化が小さすぎる（風が効いていない）ときは、比べる意味が無いので失敗にする。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-tree-reduced-motion.mjs --strict --out .captures/tree-reduced
const AT = [3, 75], MIN_NORMAL_CHANGED = 1500, MAX_RATIO = 0.35;   // 実測（標本だけ）：通常3,569画素・減らす543（比0.15）。uWind を外す変異では比が0.5を超えて落ちる
export default async function ({ page, v, freeze, start, step, call, log }) {
  await start('new'); await freeze(true); await step(30); await call('god', true);
  await v("document.body.classList.add('hide-hud')");
  await v(`(async () => { const {createWind}=await import('/valley/wind.js'); const g=__valley.game; g.time=12; g.wind=createWind(); g.aiPaused=true; })()`);
  // 草・稲・畑も風で動くので、木だけの差を測るために、この検査では隠す（草の揺れが比に混ざらないように）。
  await v(`(() => { const g = __valley.game; for (const o of [g.veg.grass.group, g.veg.rice, g.veg.crops]) if (o) o.visible = false; })()`);
  // ゲームの木（背景の若木・灌木・杉など）も風で動くので、標本だけの差を測る。背景が変わっても（配置の除外を直しても）比が動かないように、隠す。
  await v(`__valley.game.veg.trees.group.visible = false`);
  const items = [[0, .5], [1, .5], [3, .5], [2, .5], [4, .5], [5, .5]].map(([species, stage]) => ({ species, level: 0, stage, variant: 0 }));
  const placed = await call('treeSpecimens', { at: AT, yaw: Math.atan2(-0.85, 0.5), spacing: 9, items });
  const cx = placed.items.reduce((s, i) => s + i.x, 0) / placed.items.length, cz = placed.items.reduce((s, i) => s + i.z, 0) / placed.items.length;
  await call('camera', [cx - 18, 3, cz - 34], [cx, 5, cz], 46);
  const frame = async (reduced, t) => {
    await v(`(() => { const g = __valley.game; g.settings.reducedMotion = ${reduced}; g.wind = { ...g.wind, t: ${t} }; })()`);
    await step(2);
    return (await page.screenshot()).toString('base64');
  };
  const diff = (a, b) => page.evaluate(async ([a, b]) => {
    const load = async s => { const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob()); const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data; };
    const [x, y] = [await load(a), await load(b)]; let n = 0;
    for (let i = 0; i < x.length; i += 4) if (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]) > 72) n++;
    return n;
  }, [a, b]);
  const nA = await frame(false, 5.0), nB = await frame(false, 5.7), rA = await frame(true, 5.0), rB = await frame(true, 5.7);
  const normal = await diff(nA, nB), reduced = await diff(rA, rB), ratio = reduced / Math.max(1, normal);
  const uWind = await v(`(() => { const g = __valley.game; g.settings.reducedMotion = true; g.update(1/60); const r = g.veg.wind.uWind.value; g.settings.reducedMotion = false; g.update(1/60); return { reduced: r, normal: g.veg.wind.uWind.value }; })()`);
  log(`uWind 通常 ${uWind.normal} / 減らす ${uWind.reduced}  変化した画素: 通常 ${normal} / 減らす ${reduced}  比 ${ratio.toFixed(3)}`);
  await call('clearTreeSpecimens'); await call('camera', null);
  const fail = [];
  if (!(uWind.reduced < uWind.normal)) fail.push('減らす設定で uWind が小さくならない');
  if (normal < MIN_NORMAL_CHANGED) fail.push(`通常の変化が小さすぎて比べられない(${normal} < ${MIN_NORMAL_CHANGED})`);
  if (ratio >= MAX_RATIO) fail.push(`減らす設定の揺れが大きい(比 ${ratio.toFixed(3)} ≥ ${MAX_RATIO})`);
  if (fail.length) { log('FAIL: ' + fail.join(' / ')); throw new Error('tree reduced-motion regression'); }
  log('OK: 動きを減らす設定で、木の揺れ（画素の変化）は通常の ' + (ratio * 100).toFixed(0) + '%');
}
