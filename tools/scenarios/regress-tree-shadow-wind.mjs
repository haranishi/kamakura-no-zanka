// 回帰（2026-11-04・案A）：木が風で揺れたら、木の影も動く。無風なら影は動かない。標準（影4096）と軽量（2048）の両方。
// 木の風は色の材質にしか入っておらず、影は Three.js の既定の深度材質で描かれて止まっていた（Nodeの検査では見えない）。
// 太陽の影の画像そのものを、風の位相だけを変えた2回で読み比べる。時計を進めずに風の値だけを書き換えて game.render を呼ぶので、
// 人物の動作・AIは進まず、変わるのは風で動く物だけ。範囲は影の中心の四方約11.5m（影の画像の中央 1/4 角）。
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-tree-shadow-wind.mjs --strict
// しきい値：無風は0画素（完全一致）。風・突風は中央の正方形の0.5%以上（4096なら5243画素）。値は林道の杉で測った撮影設計値。
export default async function ({ v, freeze, start, step, call, log }) {
  await start('new'); await freeze(true); await step(30);
  const yaw = Math.atan2(0.507, 0.862);   // 太陽を背に、影の伸びる向き
  const measure = async quality => {
    // 林道の杉の並び（capture-shadows.mjs の杉の近く）。主人公の8m先が影の中心。
    await call('teleport', -36, -62, yaw); await step(10);
    await v('__valley.game.veg.trees.update(__valley.game.camera, true)'); await step(2);
    return v(`(() => {
      const g = __valley.game, r = g.renderer, sun = g.atmosphere.sun, w = g.veg.wind;
      const grab = (t, wind, gust) => {
        w.uTime.value = t; w.uWind.value = wind; w.uGuideMix.value = gust; w.uWindDir.value.set(1, 0); g.render(1 / 60);
        const rt = sun.shadow.map, S = rt.width, n = S / 4, buf = new Uint8Array(n * n * 4);
        r.readRenderTargetPixels(rt, (S - n) / 2, (S - n) / 2, n, n, buf); return { S, n, buf };
      };
      const diff = (a, b) => { let c = 0; for (let i = 0; i < a.buf.length; i += 4) if (a.buf[i] !== b.buf[i] || a.buf[i + 1] !== b.buf[i + 1] || a.buf[i + 2] !== b.buf[i + 2] || a.buf[i + 3] !== b.buf[i + 3]) c++; return c; };
      const covered = a => { let c = 0; for (let i = 0; i < a.buf.length; i += 4) if (a.buf[i] + a.buf[i + 1] + a.buf[i + 2] + a.buf[i + 3] < 1020) c++; return c; };
      const calmA = grab(5, 0, 0), calmB = grab(8.93, 0, 0), windA = grab(5, 1, 0), windB = grab(8.93, 1, 0), gust = grab(8.93, 1, 1);
      return { quality: g.post.quality, size: calmA.S, n: calmA.n, covered: covered(calmA), calm: diff(calmA, calmB), wind: diff(windA, windB), gust: diff(windB, gust), calmVsWind: diff(calmA, windA) };
    })()`);
  };
  const results = [];
  for (const quality of ['standard', 'light']) {
    if (quality === 'light') { await call('quality', 'light'); await step(10); }
    const r = await measure(quality); results.push(r);
    log('tree shadow wind', JSON.stringify(r));
    const want = { standard: 4096, light: 2048 }[quality], area = r.n * r.n, min = Math.ceil(area * 0.005);
    if (r.quality !== quality || r.size !== want) throw new Error(`${quality}: shadow map is ${r.size} (want ${want})`);
    if (r.covered < area * 0.05) throw new Error(`${quality}: only ${r.covered} texels covered by casters; the view misses the trees`);
    if (r.calm !== 0) throw new Error(`${quality}: the shadow moved without wind (${r.calm} texels)`);
    for (const k of ['wind', 'gust', 'calmVsWind']) if (r[k] < min) throw new Error(`${quality}: tree shadows do not follow the ${k} (${r[k]} texels changed, need ${min})`);
  }
  log('tree shadow wind ok', results.length);
}
