// 木の枝・房・樹皮の計画（純粋な層）。Three.js・DOM・乱数・時計に触れない。形の生成（tree-geometry.js）と画像（tree-textures.js）が使う。
// 杉の近景（L0）：枝は段（輪生）にせず、黄金角の螺旋に沿って一本ずつ違う高さに出す。房（3枚の交差カード）は枝の外側3/4に重なり、最後は枝先。
// 張りぼての原因（大きな板・水平の段・枝のない棒・芯の円錐）を、枝の不規則さと、枝に沿って重なる房で消す。数値は固定13画角と標本を見て決めた設計値。
export const TAU = Math.PI * 2, GOLDEN = Math.PI * (3 - Math.sqrt(5));
export function seeded(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const add = (a, b, k = 1) => a.map((v, q) => v + b[q] * k);
const norm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// 樹冠は y=3〜19.8m。5つの形（0〜2は従来の幅と幹の傾き、3は細長い、4は乱れた）。
export const CEDAR_CROWN = Object.freeze({ base: 3, top: 19.8 });
export const CEDAR_FAMILIES = Object.freeze([
  Object.freeze({ width: 1, branches: 84, lean: [.25, 0] }),
  Object.freeze({ width: 1.06, branches: 78, lean: [.41, -.12] }),
  Object.freeze({ width: .94, branches: 88, lean: [.57, -.24] }),
  Object.freeze({ width: .62, branches: 74, lean: [0, 0] }),
  Object.freeze({ width: .96, branches: 80, lean: [0, 0], ragged: true }),
]);
// 外形の半径（m）。旧L0の枝の長さの包絡から段の波（cos 6πt）を外した。中景の裾（L1）と同じ大きさに収める。
export function cedarEnvelope(t, width = 1) { return (.25 + 2.9 * Math.pow(1 - clamp(t), .9)) * width; }
// 中景の裾（tree-geometry.js の L1）の外周の半径。近景の房の先は、これを超えない（溶かしの帯で樹冠の大きさが跳ねない）。
export function cedarSkirtRadius(shape, y) {
  const t = clamp((y - CEDAR_CROWN.base) / 16.8), fam = CEDAR_FAMILIES[shape];
  if (shape < 3) return .25 + 3.2 * fam.width * Math.pow(1 - t, .85) * (.9 + .1 * Math.cos(t * Math.PI * 6));
  return (.25 + 3.2 * Math.pow(1 - t, .85)) * fam.width * (fam.ragged ? 1 + .15 * Math.sin(y * 2.17) : 1);
}
const TUFT_REACH = .55;   // 房のカードは中心から根元側へ .45、先へ .55（枝先の房の張り出し）
// 幹の中心線（tree-geometry.js の tube と同じ式：両端の直線＋弓なり .8×半径）。3・4は全体の傾きを後で足すので、ここでは直立。
export function cedarTrunkAxis(shape, y) {
  const f = CEDAR_FAMILIES[shape], t = clamp((y + .1) / 19.1);
  return [f.lean[0] * t + Math.sin(t * Math.PI) * .45 * .8, y, f.lean[1] * t];
}
export function cedarTrunkRadius(y) { return .45 * (1 - .97 * clamp((y + .1) / 19.1)); }
// 2次ベジエの枝。根元は幹の中心、先は少し垂れてから上を向く（杉の枝）。
export function branchPoint(b, s) { const u = 1 - s; return [0, 1, 2].map(q => u * u * b.base[q] + 2 * s * u * b.ctrl[q] + s * s * b.tip[q]); }
export function branchTangent(b, s) { return norm([0, 1, 2].map(q => 2 * (1 - s) * (b.ctrl[q] - b.base[q]) + 2 * s * (b.tip[q] - b.ctrl[q]))); }

// 房の大きさ（m）：長い枝・枝先ほど大きい。細長い家族は小さくする。
function tuftSize(u, length, s, fam) { return (1.25 + .55 * u) * (.55 + .45 * clamp(length / 2.6)) * (.72 + .28 * s) * (fam.width < .8 ? .7 : 1); }
// 杉の枝と房の計画。同じ形番号なら同じ結果（形のテンプレートは5つだけ。個体差は位置で決めるシェーダーの揺らぎが足す）。
export function cedarBranchPlan(shape) {
  const fam = CEDAR_FAMILIES[shape];
  if (!fam) throw new RangeError('cedar branch family');
  const rnd = seeded(77003 + shape * 131), n = fam.branches, { base, top } = CEDAR_CROWN, span = top - base - .4;
  const branches = [];
  for (let i = 0; i < n; i++) {
    // 高さ：層化した乱択（同じ高さに並ばない）。上ほど枝が短いので、少し密にする。
    const s = (i + .5 + .9 * (rnd() - .5)) / n, t = clamp(Math.pow(clamp(s), .93)), y = base + span * t;
    // 向き：黄金角の螺旋に ±0.45rad の揺らぎ。輪生（同じ高さに6本）を作らない。
    const azimuth = i * GOLDEN + (rnd() - .5) * .9;
    // 長さ：包絡×個体の揺らぎ×螺旋の房（低周波の膨らみ）。ときどき短い枝で空隙を作る。樹冠の裾（下12%）は張り出しを保つ。
    const skirt = t < .12;
    let length = cedarEnvelope(t, fam.width) * (skirt ? .96 + .14 * rnd() : .8 + .28 * rnd()) * (1 + .12 * Math.sin(2 * azimuth + y * .9 + shape));
    if (rnd() < .12 && !skirt) length *= .62;
    if (fam.ragged) length *= 1 + .15 * Math.sin(y * 2.17);
    // A typical tip tuft may overhang the middle skirt's rim by 12% at most.
    const rim = 1.12 * cedarSkirtRadius(shape, y), tipSize = tuftSize(.5, length, 1, fam);
    length = Math.max(.35, Math.min(length, rim - TUFT_REACH * tipSize));
    const pitch = -.2 + .62 * Math.pow(t, 1.15) + (rnd() - .5) * .22, sag = (.16 - .1 * t) * (.7 + .6 * rnd()), upturn = (.12 - .08 * t) * rnd();
    const dir = [Math.cos(azimuth), 0, Math.sin(azimuth)], root = cedarTrunkAxis(shape, y);
    const reach = length * Math.cos(pitch), rise = length * Math.sin(pitch);
    const tip = add(add(root, dir, reach), [0, 1, 0], rise + upturn * length);
    const ctrl = add(add(root, dir, reach * .55), [0, 1, 0], rise * .55 - sag * length);
    const radius = .04 + .038 * clamp(length / 3) * (1 - .45 * t);
    branches.push({ index: i, y, t, azimuth, length, pitch, base: root, ctrl, tip, radius, wood: length > 1.35 && t < .72, tufts: [] });
  }
  // 房：枝の外側の3/4（s≥.22）に2〜6個が重なる。最後の房は枝先（s=1）。枝先ほど大きく、内側と下ほど暗い（cedarExposure）。
  for (const b of branches) {
    const count = Math.max(2, Math.min(6, Math.round(b.length / .55)));
    for (let j = 0; j < count; j++) {
      const s = j === count - 1 ? 1 : clamp(.22 + .78 * (j + 1) / count + (rnd() - .5) * .07, .2, .97);
      const center = branchPoint(b, s), along = branchTangent(b, s), size = tuftSize(rnd(), b.length, s, fam);
      const roll = (rnd() - .5) * .6, variant = rnd() < .5 ? 0 : 1, hue = rnd() * 2 - 1, shade = rnd() * 2 - 1;
      b.tufts.push({ s, center, along, length: size, width: .9 * size, roll, variant, hue, shade });
    }
  }
  return { shape, family: fam, branches };
}
// 杉の中景（L1・40〜158m）：裾の段（同じ形の笠を9枚重ねる）をやめ、近景と同じ房の絵を螺旋に並べる。三角形の数は旧の裾と同じ。
// 房の中心は樹冠の外周の約半分の深さ、先は外周まで。内側の暗い芯（tree-geometry.js）が、房の間を深い陰に見せる。
export const CEDAR_MID_TUFTS = Object.freeze([36, 32, 40, 37, 40]);
export function cedarMidPlan(shape) {
  const fam = CEDAR_FAMILIES[shape];
  if (!fam) throw new RangeError('cedar middle family');
  const rnd = seeded(91019 + shape * 173), n = CEDAR_MID_TUFTS[shape], tufts = [], { base, top } = CEDAR_CROWN;
  for (let i = 0; i < n; i++) {
    const t = clamp((i + .5 + .7 * (rnd() - .5)) / n), y = base - .2 + (top - base - .3) * Math.pow(t, .95);
    const azimuth = i * GOLDEN + (rnd() - .5) * .8, rim = cedarSkirtRadius(shape, y), axis = cedarTrunkAxis(shape, y);
    const size = Math.max(.9, (.8 + .16 * rnd()) * rim * 1.05), depth = Math.max(.25, 1.1 * rim - TUFT_REACH * size);
    const pitch = -.15 + .55 * t + (rnd() - .5) * .2, dir = [Math.cos(azimuth) * Math.cos(pitch), Math.sin(pitch), Math.sin(azimuth) * Math.cos(pitch)];
    const center = [axis[0] + Math.cos(azimuth) * depth, y, axis[2] + Math.sin(azimuth) * depth];
    tufts.push({ s: 1, center, along: dir, length: size, width: 1.05 * size, roll: (rnd() - .5) * .6, variant: rnd() < .5 ? 0 : 1, hue: rnd() * 2 - 1, shade: rnd() * 2 - 1 });
  }
  return { shape, family: fam, tufts };
}
// 房の明るさ（頂点色の灰色）：幹からの距離（包絡に対する比）と高さで、内側と下を暗くする。黒にはしない（.30以上）。
export function cedarExposure(point, shape, shade = 0) {
  const { base, top } = CEDAR_CROWN, fam = CEDAR_FAMILIES[shape];
  const t = clamp((point[1] - base) / (top - base)), axis = cedarTrunkAxis(shape, point[1]);
  const radial = Math.hypot(point[0] - axis[0], point[2] - axis[2]) / Math.max(.45, cedarEnvelope(t, fam.width));
  return clamp(.3 + .58 * smooth(.12, 1.02, radial) + .14 * t + .05 * shade, .3, 1.1);
}
// 房の3枚のカード：枝の向きに沿い、枝の軸のまわりに60°ずつ回す。どの向きから見ても1枚は面を見せる（板に見せない）。
export function tuftCards(tuft) {
  const T = norm(tuft.along), side0 = cross([0, 1, 0], T), S = Math.hypot(...side0) > 1e-4 ? norm(side0) : [1, 0, 0], U = norm(cross(T, S));
  const cards = [];
  for (let k = 0; k < 3; k++) {
    const a = tuft.roll + k * Math.PI / 3, across = norm(add(S.map(v => v * Math.cos(a)), U, Math.sin(a)));
    const root = add(tuft.center, T, (TUFT_REACH - 1) * tuft.length), end = add(add(tuft.center, T, TUFT_REACH * tuft.length), U, -.12 * tuft.length);
    const half = tuft.width / 2;
    cards.push({ along: T, across, normal: norm(cross(T, across)), corners: [add(root, across, -half * .55), add(root, across, half * .55), add(end, across, half), add(end, across, -half)] });
  }
  return cards;
}
// 頂点の法線：カードの面と、樹冠の外向き（幹から外へ＋上）を混ぜる。カードごとの明暗の段を消し、樹冠を一つの塊として照らす。
export function crownNormal(point, cardNormal, axis) {
  const out = [point[0] - axis[0], 0, point[2] - axis[2]], l = Math.hypot(out[0], out[2]);
  const radial = l > 1e-4 ? [out[0] / l, .55, out[2] / l] : [0, 1, 0];
  const facing = dot(cardNormal, radial) < 0 ? cardNormal.map(v => -v) : cardNormal;
  return norm(add(norm(radial).map(v => v * .65), facing, .35));
}

// 広葉の中景（L1）にも、近景と同じ分岐枝を出す（「棒に玉」を避ける）。根元は近景の分岐の高さ。
export function broadLimbs(tips, fork, aspect = 1) {
  return tips.map((tip, b) => ({ from: [.08, fork, .05], to: tip, radius: .21 * aspect - .02 * (b % 2) }));
}

// 樹皮の画像（128×256、周期的）。R：明るさの倍率（平均1になるよう.5倍で格納）、G/B：法線の傾き、A：溝の深さ。縦に長い繊維と、蛇行する溝。
export const BARK_SIZE = Object.freeze([128, 256]);
function lattice(ix, iy, px, py, salt) {
  const x = ((ix % px) + px) % px, y = ((iy % py) + py) % py;
  const v = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453; return v - Math.floor(v);
}
function periodicNoise(x, y, px, py, salt) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = lattice(ix, iy, px, py, salt), b = lattice(ix + 1, iy, px, py, salt), c = lattice(ix, iy + 1, px, py, salt), d = lattice(ix + 1, iy + 1, px, py, salt);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
export function barkHeight(u, v) {
  // u：周（0〜1）、v：長さ（0〜1）。周期は両方向で1。14本の縦の帯（杉の剥がれる樹皮）が少し蛇行し、帯の境は浅い割れ目。
  // 帯は長さ方向に4つに切れて明るさが変わり、表面は縦に引き延ばした細かい繊維。
  const warp = .55 * periodicNoise(u * 5, v * 3, 5, 3, 3) + .25 * periodicNoise(u * 11, v * 7, 11, 7, 6);
  const x = u * 14 + warp, strip = Math.floor(x), f = x - strip;
  const plate = periodicNoise(strip, v * 4 + lattice(strip, 0, 14, 1, 9) * 4, 14, 4, 2), crack = smooth(0, .18, f) * smooth(0, .18, 1 - f);
  const fibre = periodicNoise(u * 70 + warp * 4, v * 6, 70, 6, 1);
  return clamp(.12 + .38 * plate * crack + .32 * fibre * (.45 + .55 * crack) + .18 * crack);
}
export function barkPixels() {
  const [w, h] = BARK_SIZE, height = new Float32Array(w * h), out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) height[y * w + x] = barkHeight(x / w, y / h);
  let mean = 0; for (const v of height) mean += v; mean /= height.length;
  const at = (x, y) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, hv = at(x, y);
    // 明るさの倍率：平均1（遠景・ミップの最小段でも幹の明るさが変わらない）。溝は暗く、繊維の背は明るい。
    const gain = clamp(1 + 1.15 * (hv - mean), .45, 1.5);
    // 法線：周方向の傾きを強く（縦の溝が低い太陽を受ける）、縦方向は弱く。
    const dx = (at(x + 1, y) - at(x - 1, y)) * 9, dy = (at(x, y + 1) - at(x, y - 1)) * 3;
    const n = norm([-dx, -dy, 1]);
    out[i] = Math.round(clamp(gain / 2) * 255); out[i + 1] = Math.round((n[0] * .5 + .5) * 255); out[i + 2] = Math.round((n[1] * .5 + .5) * 255);
    out[i + 3] = Math.round(clamp(1 - hv) * 255);
  }
  return { width: w, height: h, data: out, mean };
}
// 葉の1枚ごとの向きと色のばらつき（葉の画像の配置と同じ番号）。傾きは .25〜.7rad、色は −1〜1。
export function leafTilt(hash, i) {
  const angle = hash(i, 13) * TAU, tilt = .25 + .45 * hash(i, 17), fold = .18 + .14 * hash(i, 19);
  return { angle, tilt, fold, hue: hash(i, 23) * 2 - 1 };
}
