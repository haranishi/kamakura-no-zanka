// 遠景（L2）の木の「絵の板」（impostor）の純粋な計算。Three.js・DOM・乱数・時計に触れない（焼き付けと材質は tree-bake.js）。
// 8方向から焼いた絵を、木の向き（個体の回転）とカメラの向きで選び、隣の2枚を中央の帯だけで混ぜる（跳ばない）。
// 重ねた円錐（7.9）は見晴らしで「段の針葉樹」に見え、三角形の約半分を使っていた（8.1a第2周の盲検）。
export const TAU = Math.PI * 2;
// views：焼く方向の数。cell：1枚の画素（幅・高さ）。pad：枠の内側の余白（ミップで隣の絵がにじまない）。
// band：隣の絵を混ぜる帯（1方向の刻みに対する割合）。帯の外は1枚だけを見せる（二重像を出さない）。
export const IMPOSTOR = Object.freeze({ views: 8, cell: Object.freeze([64, 128]), pad: 4, band: .5 });
const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// 焼く家族：成木4種の形ごとに1行（杉5・欅3・松2・楓3＝13行）。若木・灌木は遠景に出ない。
export function impostorFamilies(variants) {
  const out = [];
  ['cedar', 'zelkova', 'pine', 'maple'].forEach((name, species) => {
    const n = variants[name] ?? 1;
    if (!Number.isInteger(n) || n < 1) throw new RangeError('impostor family count');
    for (let shape = 0; shape < n; shape++) out.push({ species, shape, row: out.length });
  });
  return out;
}
// 絵の帳：横に方向、縦に家族。WebGL2は2の冪でなくてもミップを作れるので、高さは行数ぶんだけ取る。
export function impostorLayout(rows, cfg = IMPOSTOR) {
  if (!Number.isInteger(rows) || rows < 1) throw new RangeError('impostor rows');
  return { width: cfg.views * cfg.cell[0], height: rows * cfg.cell[1], step: 1 / cfg.views, views: cfg.views };
}
// 木の局所の向き（木→カメラ）の方位。0は +Z、+X へ増える（three の Y 回転と同じ向き）。0〜2π。
export function localAzimuth(dx, dz) { const a = Math.atan2(dx, dz); return a < 0 ? a + TAU : a; }
export function viewAzimuth(k, views = IMPOSTOR.views) { return ((k % views) + views) % views * TAU / views; }
// 方位から、見せる2枚（a・b）と混ぜる重み t（0＝a だけ、1＝b だけ）。焼いた方位の±(.5−band/2)刻みは1枚だけ。
export function impostorView(azimuth, views = IMPOSTOR.views, band = IMPOSTOR.band) {
  if (!Number.isFinite(azimuth) || !Number.isInteger(views) || views < 2) throw new RangeError('impostor view');
  const u = ((azimuth / TAU * views) % views + views) % views, base = Math.floor(u), f = u - base;
  const a = base % views, b = (a + 1) % views;
  const t = band > 0 ? smooth(.5 - band / 2, .5 + band / 2, f) : f >= .5 ? 1 : 0;
  return { a, b, t };
}
// 家族の大きさ（m）を枠に収める：縦横同じ倍率（歪めない）、幹を枠の中央・根元を枠の下に置く。
// extent = { half：幹の軸からの最大の水平距離, bottom, top }。返す値は画素（px/m の倍率と、使う幅・高さ）。
export function frameFit(extent, cfg = IMPOSTOR) {
  const { half, bottom, top } = extent;
  if (![half, bottom, top].every(Number.isFinite) || half <= 0 || top <= bottom) throw new RangeError('impostor extent');
  const cw = cfg.cell[0] - 2 * cfg.pad, ch = cfg.cell[1] - 2 * cfg.pad, scale = Math.min(cw / (2 * half), ch / (top - bottom));
  return { scale, width: 2 * half * scale, height: (top - bottom) * scale, half, bottom, top };
}
// 枠の左下（画素）と、その家族の0番の絵の UV（左下 u・v と、幅・高さ）。帳の原点は左下（描画先の画像と同じ）。
export function frameOrigin(row, column, fit, cfg = IMPOSTOR) {
  return [column * cfg.cell[0] + (cfg.cell[0] - fit.width) / 2, row * cfg.cell[1] + cfg.pad];
}
export function frameUV(row, fit, layout, cfg = IMPOSTOR) {
  const [x, y] = frameOrigin(row, 0, fit, cfg);
  return [x / layout.width, y / layout.height, fit.width / layout.width, fit.height / layout.height];
}
// 焼くときの木の置き方：枠の中の幹の根元（画素）・倍率・Y回転（−方位：カメラの +Z から、その方位の側を見る）。
export function bakePlacement(row, column, fit, cfg = IMPOSTOR) {
  const [x, y] = frameOrigin(row, column, fit, cfg);
  return { x: x + fit.width / 2, y: y - fit.bottom * fit.scale, scale: fit.scale, yaw: -viewAzimuth(column, cfg.views) };
}
