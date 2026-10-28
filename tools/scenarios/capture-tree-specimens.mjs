// 木の標本（種×段）を、逆光と順光で1本ずつ撮る。形・葉の絵・色づき・風・逆光を、森の中の他の木に隠されずに確かめるための撮影。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-tree-specimens.mjs --out .captures/specimens-r1 [--w 1280 --h 720 --seed 1333]
// 場所は棚田の南（平らで、半径約45mに木と建物が無い）。太陽は南南東の低い位置（ATMOS.sunDir）なので、
// 北西から南東を見ると逆光、南東から北西を見ると順光になる。風の位相は固定する。
const SUN = [0.50, 0.85], AT = [3, 75], AT_UNDER = [75, 12];
const len = Math.hypot(...SUN), V = [SUN[0] / len, SUN[1] / len], ROW = [-V[1], V[0]];   // 視線方向と、それに直交する行の向き
const ALL = [[0, .5], [2, .5], [1, .15], [1, .55], [1, .9], [3, .2], [3, .55], [3, .95]];
// 近い段は実寸の距離で、中・遠景の段は同じ距離のまま画角だけ変える（棚田の周りは約46m先まで木が無い）。実際の見えの大きさは、後で縮小して比べる。
const ROWS = [
  { name: 'a-broadleaf-L0', level: 0, spacing: 11, dist: 46, fov: 42, items: [[1, .15], [1, .55], [1, .9], [3, .2], [3, .55], [3, .95]] },
  { name: 'b-conifer-L0', level: 0, spacing: 10, dist: 40, fov: 42, items: [[0, .5], [2, .5], [0, .3]] },
  { name: 'c-understory', at: AT_UNDER, level: 0, spacing: 3.2, dist: 11, fov: 42, camY: 1.3, items: [[4, .3, 0], [4, .7, 1], [5, .2], [5, .6], [5, .95]] },
  { name: 'd-all-L1', level: 1, spacing: 7, dist: 46, fov: 40, items: ALL },
  { name: 'e-all-L2', level: 2, spacing: 7, dist: 46, fov: 40, items: ALL },
  { name: 'f-maple-close', level: 0, spacing: 1, dist: 17, fov: 46, items: [[3, .55]] },
  { name: 'g-zelkova-close', level: 0, spacing: 1, dist: 22, fov: 46, items: [[1, .55]] },
  { name: 'h-cedar-close', level: 0, spacing: 1, dist: 30, fov: 46, items: [[0, .5]] },
];
export default async function ({ v, freeze, start, step, call, shot, log }) {
  await start('new'); await freeze(true); await step(30); await call('god', true);
  await v("document.body.classList.add('hide-hud')");
  await v(`(async () => { const {createWind}=await import('/valley/wind.js'); const g=__valley.game; g.time=12; g.wind=createWind(); g.aiPaused=true; g.veg.wind.uTime.value=5; })()`);
  for (const row of ROWS) {
    const items = row.items.map(([species, stage, variant]) => ({ species, level: row.level, stage, variant: variant ?? 0 }));
    // 行の向きを、視線に直交させる（yawの規約が実装により違っても、返った位置から確かめて選ぶ）
    let placed = null;
    for (const yaw of [Math.atan2(-ROW[1], ROW[0]), Math.atan2(ROW[1], ROW[0]), Math.atan2(ROW[1], -ROW[0]), Math.atan2(-ROW[1], -ROW[0])]) {
      const r = await call('treeSpecimens', { at: row.at || AT, yaw, spacing: row.spacing, items });
      const a = r.items[0], b = r.items[r.items.length - 1];
      const ax = [b.x - a.x, b.z - a.z], n = Math.hypot(...ax) || 1;
      if (r.items.length < 2 ? true : Math.abs((ax[0] * ROW[0] + ax[1] * ROW[1]) / n) > 0.98) { placed = r; break; }
    }
    if (!placed) throw new Error('標本の行の向きを視線に直交させられない: ' + row.name);
    const cx = placed.items.reduce((s, i) => s + i.x, 0) / placed.items.length, cz = placed.items.reduce((s, i) => s + i.z, 0) / placed.items.length;
    const tall = Math.max(...placed.items.map(i => i.height || 1));
    for (const [side, sign] of [['backlit', -1], ['frontlit', 1]]) {
      // sign=-1: 北西（太陽と反対側）から南東を見る＝逆光。sign=+1: 南東から北西を見る＝順光。
      const cam = [cx + sign * V[0] * row.dist, row.camY ?? (row.level === 0 ? 1.8 : 3.5), cz + sign * V[1] * row.dist];
      const look = [cx, Math.max(0.5, tall * 0.4), cz];
      await call('camera', cam, look, row.fov); await step(6);
      await shot(`${row.name}-${side}`);
    }
  }
  await call('clearTreeSpecimens'); await call('camera', null);
  log('specimens done');
}
