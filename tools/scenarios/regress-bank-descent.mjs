// 回帰：待ち伏せの斜面の土手を、斜面と道のあいだで行き来できる。
// 以前は42度を超える斜面へは入れず、道の西の土手（41〜46度）が見えない壁になって、斜面の弓兵を追った主人公が道へ戻れなかった。
// 歩けるのは46度まで（岩の質感に変わる47度の手前）。それより急な斜面も、下りだけは56度まで歩いて降りられる（登れない土手は残る）。
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-bank-descent.mjs --strict
export default async function ({ v, freeze, start, step, call, log }) {
  await start('new'); await freeze(true); await step(30);
  const hold = async (key, frames) => { await call('key', key, true); for (let i = 0; i < frames / 10; i++) await step(10); await call('key', key, false); };
  const where = () => v("(() => { const h = __valley.game.hero.pos; return { x: h.x, z: h.z, y: h.y }; })()");
  // 土手の西側（斜面）に立って、東（道）へ歩く。yaw 0 のとき D が東
  await call('teleport', -64.2, -25.0, 0); await step(20);
  const p0 = await where(); await hold('KeyD', 150); const p1 = await where();
  log('slope → road', p0.x.toFixed(1), '→', p1.x.toFixed(1), 'y', p0.y.toFixed(1), '→', p1.y.toFixed(1));
  if (p1.x < -61.5) throw new Error(`the hero could not cross the bank to the road (stopped at x ${p1.x.toFixed(1)}, started ${p0.x.toFixed(1)})`);
  // 林道のS字の西の縁（傾斜45度の帯）に立っても、道（東）へ出られる。斜面の縁で身動きが取れなくならない
  await call('teleport', -38.4, -43.5, 0); await step(20);
  const q0 = await where(); await hold('KeyD', 150); const q1 = await where();
  log('S-curve edge → road', q0.x.toFixed(1), '→', q1.x.toFixed(1));
  if (q1.x < -36.5) throw new Error(`the hero is stuck on the edge of the road bank (stopped at x ${q1.x.toFixed(1)})`);
}
