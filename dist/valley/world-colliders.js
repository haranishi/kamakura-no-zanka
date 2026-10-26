// world-colliders.js — world-data の飾り（柵・薪・幟・遠景の柵）から、当たりの円と箱を作る（純粋。Three.js非依存）。
// 見た目は props.js が置く。当たりは同じ表から作るので、見た目と当たりがずれない。buildColliders の extraCircles / extraBoxes へ渡す。
import { ROCK_MODEL } from './scatter.js';
export function propColliders(world) {
  const circles = [], boxes = [];
  for (const d of world.dress || []) {
    if (d.kind === 'fence_line') {
      const [x0, z0] = d.from, [x1, z1] = d.to, len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 2.5)), rot = Math.atan2(-(z1 - z0), x1 - x0);
      for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; boxes.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, rotY: rot, w: len / n, d: 0.3, height: 1.2, id: 'fence' }); }
    } else if (d.kind === 'firewood') circles.push({ x: d.x, z: d.z, r: 0.55, height: 0.6, id: 'firewood' });
    else if (d.kind === 'banner') circles.push({ x: d.x, z: d.z, r: 0.12, height: 3.6, id: 'banner' });
  }
  for (const d of world.distant || []) if (d.collider) boxes.push({ x: d.x, z: d.z, rotY: d.rotY || 0, w: d.collider.w, d: d.collider.d, height: d.collider.height, id: d.id });
  return { circles, boxes };
}

// 散らした岩の当たり（円）。岩の模型は幅約2.7m・奥行き約2m・高さ約1.5m（boulder.glb）。幅が1.4mを超える岩だけに付ける。
// 付けないと、里の入口の大岩の中に主人公も敵も入って見えなくなった（第2周の評価）。
// 細長い岩（長辺が短辺の1.4倍以上）は、長い軸に沿って円を並べる。1つの円だと、長い軸の端で見た目の端から1.4mほど岩の中へ入れた（第3周の評価）。
// 向きは buildings.js の置き方（Y軸まわりに rot 回し、x を s*sx、z を s*sz に伸ばす）と同じ。各円の rock は岩の番号。
export { ROCK_MODEL };
export function rockColliders(rocks) {
  const circles = [];
  for (let i = 0; i < rocks.x.length; i++) {
    const w = ROCK_MODEL.width * rocks.s[i] * rocks.sx[i], d = ROCK_MODEL.depth * rocks.s[i] * rocks.sz[i], L = Math.max(w, d), S = Math.min(w, d);
    if (L < 1.4) continue;
    const height = ROCK_MODEL.height * rocks.s[i] * 0.8, x = rocks.x[i], z = rocks.z[i];
    if (L / S < 1.4) { circles.push({ x, z, r: S * 0.42 + L * 0.08, height, id: 'rock', rock: i }); continue; }
    const rr = S * 0.46, n = Math.min(8, Math.max(2, Math.ceil((L - 2 * rr) / (rr * 1.3)) + 1)), rot = rocks.rot[i];
    const along = w >= d ? [Math.cos(rot), -Math.sin(rot)] : [Math.sin(rot), Math.cos(rot)];
    for (let k = 0; k < n; k++) { const t = (k / (n - 1) - 0.5) * (L - 2 * rr); circles.push({ x: x + along[0] * t, z: z + along[1] * t, r: rr, height, id: 'rock', rock: i }); }
  }
  return circles;
}
