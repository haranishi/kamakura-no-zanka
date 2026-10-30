// オープニングの固定画角を撮る（O1〜O4＝場面A〜D、題名、目覚め）。通常版を初めから流し、決めた時刻で撮る。
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-opening.mjs --intro 1 --seed 1333 --out <フォルダ>
//   KZ_SHOTS=O1a,O3a,title,wake のように名前を並べると、その画角だけを撮る（省略時はすべて）。
//   KZ_REDUCED=1 で「動きを減らす」。粒子の乱数は種で固定する（同じ条件なら同じ絵）。
const SHOTS = [
  ['O1a', 4.0], ['O1b', 9.6], ['O2a', 14.0], ['O2b', 19.0], ['O3a', 23.5], ['O3b', 28.5],
  ['O4a', 34.0], ['O4b', 40.2], ['title', 44.5], ['wake', 48.6], ['wake2', 51.0],
];
export default async function ({ v, step, start, freeze, shot, st, log }) {
  const want = process.env.KZ_SHOTS ? new Set(process.env.KZ_SHOTS.split(',')) : null;
  await v("localStorage.removeItem('kamakura-valley-meta')");
  await v(`(async () => { const { mulberry32 } = await import('/valley/scatter.js'); Math.random = mulberry32(1333); __valley.game.settings.reducedMotion = ${process.env.KZ_REDUCED === '1'}; })()`);
  await start('new'); await freeze(true);
  let t = 0;
  for (const [name, at] of SHOTS) {
    if (want && !want.has(name)) continue;
    const frames = Math.round((at - t) * 60); if (frames > 0) await step(frames); t = at;
    const q = await st();
    log(name, JSON.stringify({ t: q.opening?.t ?? null, segment: q.opening?.segment ?? q.flow, line: q.opening?.line ?? null, calls: q.render.calls, tris: q.render.tris }));
    await shot(name);
  }
}
