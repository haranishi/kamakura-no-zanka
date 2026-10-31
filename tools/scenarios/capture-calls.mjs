// 固定画角の撮影（capture-set.mjs と同じ手順・同じ画角）を、乱数を固定して回し、画角ごとの描画の呼び出し回数と、
// 置き物の種類ごとの内訳を残す（S7-0「まとめ描き」の前後比較。画素の比較は tools/compare-shots.mjs）。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-calls.mjs --w 1280 --h 720 --seed 1333 --strict --out .captures/life0-before
// 出力: <out>/NN-*.png と <out>/calls.json。main＝画面への描画、shadow＝太陽の影の描画。種類は下の KINDS。
//   画角ごとの値は、その撮影の直前に描いた1コマのもの。static は場面に置かれた形の数（画面に入るかは問わない上限）。
//   KZ_MASK=1 のときは、同じコマで KINDS の物だけを白で描いた輪郭を <out>/masks/NN-*.png に残す（差がどの物の縁かを数える。compare-shots.mjs --mask）。
import fs from 'node:fs/promises';
import path from 'node:path';
import captureSet from './capture-set.mjs';

// まとめ描きの対象（S7-0）。distant（関所・砦・馬防柵）と building（寺・蔵・納屋・橋・大岩）は対象外として別に数える。
export const KINDS = ['fence', 'firewood', 'meshy', 'banner', 'farmhouse'];

const TALLY = `(() => {
  const g = __valley.game, r = g.renderer, info = r.info, shadowCam = g.atmosphere.sun.shadow.camera;
  const BATCH = { fences: 'fence', firewood: 'firewood', banners: 'banner', 'yard-props': 'meshy', farmhouses: 'farmhouse' };
  const cache = new WeakMap();
  const classify = obj => {
    if (cache.has(obj)) return cache.get(obj);
    let o = obj, top = null;
    while (o && o.parent) { if (o.parent.name === 'props' || o.parent.name === 'buildings') { top = o; break; } o = o.parent; }
    let kind = 'other';
    if (top) {
      if (BATCH[top.name]) kind = BATCH[top.name];                                   // まとめ描きのあと
      else if (top.parent.name === 'buildings') kind = /^house\\d+$/.test(top.name) ? 'farmhouse' : 'building';
      else if (top.name === 'banner') kind = 'banner';
      else if (/^prop-(gatehouse|fort|barricade)$/.test(top.name)) kind = 'distant';
      else if (top.name.startsWith('prop-')) kind = 'meshy';
      else { kind = 'props-other'; top.traverse(m => { if (/rustic_fence/.test(m.name)) kind = 'fence'; else if (/split_firewood/.test(m.name)) kind = 'firewood'; }); }
    }
    cache.set(obj, kind); return kind;
  };
  let tally = { main: {}, shadow: {} };
  const reset = info.reset.bind(info);
  info.reset = () => { reset(); tally = { main: {}, shadow: {} }; };
  const draw = r.renderBufferDirect;
  r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    const before = info.render.calls, out = draw.call(this, camera, scene, geometry, material, object, group), n = info.render.calls - before;
    if (n > 0) { const t = camera === shadowCam ? tally.shadow : tally.main, k = classify(object); t[k] = (t[k] || 0) + n; }
    return out;
  };
  // 輪郭：KINDS の物だけを、霧・後処理なしの白で描き、キャンバスの画素を返す（画面の文字は入らない）。描いたあと元へ戻す。
  window.__kindsMask = async kinds => {
    const THREE = await import('/vendor/three.module.min.js'), scene = g.scene, hidden = [];
    scene.traverse(o => { if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.visible && !kinds.includes(classify(o))) { o.visible = false; hidden.push(o); } });
    const keep = { background: scene.background, fog: scene.fog, overrideMaterial: scene.overrideMaterial }, white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    Object.assign(scene, { background: new THREE.Color(0), fog: null, overrideMaterial: white });
    try { r.setRenderTarget(null); r.render(scene, g.camera); return r.domElement.toDataURL('image/png'); }
    finally { Object.assign(scene, keep); for (const o of hidden) o.visible = true; white.dispose(); }
  };
  window.__drawTally = () => ({ calls: info.render.calls, tris: info.render.triangles, main: { ...tally.main }, shadow: { ...tally.shadow } });
  window.__drawStatic = () => {
    const s = {};
    g.scene.traverse(o => {
      if (!o.isMesh) return;
      const k = classify(o); if (k === 'other') return;
      const draws = Array.isArray(o.material) ? o.geometry.groups.length : 1;
      s[k] ??= { meshes: 0, draws: 0, shadowDraws: 0, placed: 0, tris: 0 };
      const tris = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3, copies = o.isInstancedMesh ? o.count : o.isBatchedMesh ? o.instanceCount : 1;
      s[k].meshes++; s[k].draws += draws; if (o.castShadow) s[k].shadowDraws += draws; s[k].placed += copies; s[k].tris += tris * copies;
    });
    return s;
  };
  return 0;
})()`;

const sum = (o, keys) => keys.reduce((a, k) => a + (o[k] || 0), 0);

export default async function (ctx) {
  // 同じコードなら同じ絵になるよう、実時間と乱数で変わる所を止めて読み込み直す（2026-11-01。止めずに2回撮ると26組中5組しか一致しなかった）。
  // 進行：画面の繰り返し（requestAnimationFrame）を最初から止め、時間は step だけで進める。止めないと、読み込みから撮影開始までの
  //   実時間の分だけ、題名画面の間に煙・空・風・時刻が進み、回ごとに絵が変わる（煙の粒の並びが変わり、重なりの色が変わった）。
  // 乱数：読み込みの前から固定し、さらにページへの1回の指示（進める・呼ぶ・式）ごとに、その回の番号から作り直す。
  //   音の雑音づくりなど、指示の合間に非同期で乱数を使う物があっても、煙・火の粉・砂ぼこりの出方が変わらない。
  // 時計：草の区画を作る量が1コマの実時間の予算で決まる（grass-view.js）。時計を止めると、要る区画を毎コマ作り切る。
  // 画面の文字：CSSの移り変わりは実時間で進むので切る（字幕や案内の出入りは、最後の姿で写る）。
  await ctx.page.addInitScript(() => {
    const seeded = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    let n = 0; Math.random = seeded(20261101); window.__reseed = () => { Math.random = seeded(20261101 + (++n) * 7919); };
    const now = performance.now(); performance.now = () => now;
    window.requestAnimationFrame = () => 0;
    addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'; document.head.append(s); });
  });
  await ctx.page.reload();
  await ctx.page.waitForFunction('window.__valleyReady===true', null, { timeout: 180000, polling: 100 });
  await ctx.freeze(true);
  const ev = expr => ctx.page.evaluate(`__reseed(); ${expr}`);
  Object.assign(ctx, {
    v: expr => ev(expr),
    step: (n = 1, dt = 1 / 60) => ev(`__valley.step(${n}, ${dt})`),
    start: (mode = 'new') => ev(`__valley.start(${JSON.stringify(mode)}), 0`),
    key: (code, down = true) => ev(`__valley.key(${JSON.stringify(code)}, ${down}), 0`),
    tap: (code, frames = 1) => ev(`__valley.tap(${JSON.stringify(code)}, ${frames})`),
    click: (button = 0, hold = false) => ev(`__valley.click(${button}, ${hold})`),
    release: (button = 0) => ev(`__valley.release(${button}), 0`),
    call: (fn, ...a) => ev(`__valley.${fn}(${a.map(x => JSON.stringify(x)).join(',')})`),
  });
  await ctx.v(TALLY);
  const shots = [], shot = ctx.shot;
  ctx.shot = async name => {
    const file = await shot(name), t = await ctx.v('window.__drawTally()');
    if (process.env.KZ_MASK === '1') {
      const url = await ctx.v(`window.__kindsMask(${JSON.stringify(KINDS)})`);
      await fs.mkdir(path.join(ctx.out, 'masks'), { recursive: true });
      await fs.writeFile(path.join(ctx.out, 'masks', name + '.png'), Buffer.from(url.split(',')[1], 'base64'));
    }
    const total = { main: Object.values(t.main).reduce((a, b) => a + b, 0), shadow: Object.values(t.shadow).reduce((a, b) => a + b, 0) };
    shots.push({ name, calls: t.calls, tris: t.tris, counted: total.main + total.shadow,
      props: { main: sum(t.main, KINDS), shadow: sum(t.shadow, KINDS), total: sum(t.main, KINDS) + sum(t.shadow, KINDS) }, main: t.main, shadow: t.shadow });
    return file;
  };
  const placed = await ctx.v('window.__drawStatic()');
  await captureSet(ctx);
  const staticTotal = KINDS.reduce((a, k) => a + (placed[k] ? placed[k].draws + placed[k].shadowDraws : 0), 0);
  const result = { note: '画角ごとの値は撮影の直前の1コマ。props＝KINDSの合計（main＋shadow）。static は置かれた形の数の上限（同時に全部が画面と影に入るとは限らない）。',
    kinds: KINDS, static: placed, staticPropsDrawsWithShadow: staticTotal,
    maxCalls: Math.max(...shots.map(s => s.calls)), maxProps: Math.max(...shots.map(s => s.props.total)), shots };
  await fs.writeFile(path.join(ctx.out, 'calls.json'), JSON.stringify(result, null, 2) + '\n');
  ctx.log(`calls: max ${result.maxCalls}, props max ${result.maxProps}, props static upper bound ${staticTotal}`);
}
