// opening-scenes.js — オープニングの場面A〜D（燃える鎌倉）の配置と規則（data層＋純粋関数）。Three.js・乱数・時計・DOMに触れない。
// 場面の組み立て（opening-stage.js）は、ここで決めた置き場・炎・火の粉・煙・カメラの道筋を読むだけ。乱数の代わりに、番号から決まる
// 系列（cellRand）を使うので、同じ時刻・同じ刻みなら同じ絵になる。座標は場面の組の中（origin からの相対）でメートル。
// 史実の範囲（design-opening.md §1）：燃えるのは寺と数棟の家、逃げ道のまわりだけ。町全体が焼け落ちた姿にしない。
import { cellRand } from './scatter.js';

const freeze = o => { for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v); return Object.freeze(o); };
const smooth = k => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const lerp = (a, b, k) => a + (b - a) * k;
const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

// fog は線形の霧の [近, 遠]（m）。色は空の地平の色（horizonColor）に合わせる。
// 炎の源：area は箱の中へ、line は線分に沿って舌を並べる。n=舌の数、w/h=板の幅と高さの範囲、power=明るさ、pull=カメラ側へ寄せる量（屋根に刺さる線を隠す）
// 粒子の源：kind=ember（火の粉・加算）／smoke（煙・通常）。rate=1秒あたりの数、up=上向きの速さ、life=寿命、size→sizeEnd、box=出る範囲
export const SCENES = freeze({
  // A 燃える通り：通りの両側に家並み（手前は谷のモデルの複製、奥と裏の列はインスタンス）。燃えるのは2棟だけ。地面は乾いた土に灰と瓦礫、
  // 倒れた無地の幟は地面に伏せて皺を作る（帆に見えないように）
  A: {
    origin: [0, 0, 0], fov: 40, wind: [0.9, 0.25],
    camera: { from: [0.4, 1.15, 10.5], to: [0.35, 1.22, 6.5], look0: [-0.6, 3.5, -20], look1: [-0.4, 3.65, -20] },
    sky: { top: '#060708', mid: '#1f1d1b', hor: '#7f776a', glow: '#a3876a', glowDir: [-0.15, -1], glowAmt: 0.45, glowSpread: 2.5, glowRise: 4, smoke: 0.8, smokeDark: '#141210', smokeLit: '#5a4a3c' },
    fog: [10, 85], ground: { base: '#3b342c', dark: '#1c1814', light: '#5a4e42', scale: 0.45, ash: 0.55, ashColor: '#77716a' }, env: 0.36,
    key: { color: '#cdbfa6', intensity: 0.6, at: [-4, 16, -44] },
    glow: { color: '#ff7a32', intensity: 95, at: [-4.0, 3.0, -11.5], distance: 28 },
    models: [
      { key: 'naya', at: [-8.0, 0, 4.5], rotY: Math.PI / 2, scale: 6.6, tint: '#e8d2a8' },
      { key: 'farmhouse', at: [-8.2, 0, -12], rotY: -Math.PI / 2, scale: 1.02, burning: true, deco: { ember: { y: 3.6, x: [-11, -5.5], power: 1.0 } } },
      { key: 'naya', at: [-8.5, 0, -23.5], rotY: Math.PI / 2, scale: 6.4, tint: '#cdb894' },
      { key: 'farmhouse', at: [-8.2, 0, -33.5], rotY: -Math.PI / 2, scale: 0.95 },
      { key: 'naya', at: [-8.4, 0, -43.5], rotY: Math.PI / 2, scale: 6.0, tint: '#cdb894' },
      { key: 'farmhouse', at: [8.2, 0, 1.5], rotY: Math.PI / 2, scale: 1.0 },
      { key: 'naya', at: [8.5, 0, -9.5], rotY: -Math.PI / 2, scale: 6.2, tint: '#e8d2a8' },
      { key: 'farmhouse', at: [8.2, 0, -19.5], rotY: Math.PI / 2, scale: 0.96, burning: true, deco: { ember: { y: 3.4, x: [5.5, 11], power: 0.8 } } },
      { key: 'naya', at: [8.5, 0, -30.5], rotY: -Math.PI / 2, scale: 6.2, tint: '#cdb894' },
      { key: 'naya', at: [8.4, 0, -41], rotY: -Math.PI / 2, scale: 6.0, tint: '#cdb894' },
      { key: 'cart', at: [3.2, 0.32, -4.5], rotY: 2.3, scale: 1.0, tilt: [0, 0, 1.2] },
      { key: 'firewood', at: [4.0, 0, 2.6], rotY: 1.1, scale: 1.2 },
      { key: 'fence', at: [-3.9, 0.16, -2.2], rotY: 0.35, scale: 1.0, tilt: [1.52, 0, 0] },
      { key: 'firewood', at: [-2.6, 0, -9.5], rotY: 2.4, scale: 1.0 },
    ],
    // 通りの奥と、家の裏の列（インスタンス）。通りを家で埋め、奥は霧に溶かす
    rows: [
      { key: 'naya', list: [[-8.6, -53, 1.57, 6.0, 0.7], [8.6, -51, -1.57, 6.0, 0.7], [-8.8, -63, 1.57, 6.2, 0.6], [8.8, -62, -1.57, 6.0, 0.6], [0.5, -72, 0, 8.0, 0.55], [-17, -6, 1.57, 6.4, 0.6], [-17.5, -28, 1.57, 6.6, 0.55], [17, -2, -1.57, 6.4, 0.6], [17.5, -25, -1.57, 6.2, 0.55], [-17, -46, 1.57, 6.4, 0.5], [17.5, -44, -1.57, 6.4, 0.5]] },
      { key: 'dozo', list: [[-9, -58, 1.57, 5.4, 0.65], [9, -56.5, -1.57, 5.6, 0.65], [-16.5, -17, 1.57, 5.6, 0.55], [16.5, -14, -1.57, 5.4, 0.55], [-16.8, -37, 1.57, 5.8, 0.5], [17, -35, -1.57, 5.6, 0.5]] },
    ],
    flag: { pole: [[-1.5, 0.05, -1.2], [2.5, 0.06, -3.9]], cloth: [1.2, 2.0] },          // 竿も布も地面に伏せる。布は竿の脇に皺を寄せて広がる
    debris: { n: 45, area: [-6.5, 6.5, -16, 4], size: [0.05, 0.22], avoid: [-0.8, 1.8, 2, 12], color: '#3b332c', seed: 3 },   // 焼けた木片と石（地面に置く）
    fires: [
      { shape: 'line', from: [-8.2, 5.45, -13.9], to: [-8.2, 5.45, -10.1], n: 8, w: [1.3, 2.4], h: [1.0, 2.6], power: 0.75, pull: 0.2, sink: 0.25, top: 7.8,
        smoke: { rate: 10, up: [1.0, 1.6], life: [7, 10], size: [1.2, 1.9], sizeEnd: [5, 7.5], lit: [0.16, 0.056, 0.02], dark: [0.008, 0.0072, 0.0066], alpha: 0.7 } },
      { shape: 'line', from: [-6.7, 4.45, -15.4], to: [-6.7, 4.45, -8.8], n: 10, w: [0.9, 1.9], h: [0.7, 2.6], power: 0.7, pull: 0.4, sink: 0.2, top: 7.6 },
      { shape: 'line', from: [-5.0, 1.6, -15.2], to: [-5.0, 1.9, -9.0], n: 6, w: [0.7, 1.4], h: [0.6, 2.0], power: 0.65, pull: 0.4, sink: 0.15, top: 4.4 },
      { shape: 'line', from: [8.2, 5.1, -20.9], to: [8.2, 5.1, -18.6], n: 5, w: [1.0, 1.9], h: [1.0, 3.2], power: 0.7, pull: 0.2, sink: 0.25, top: 9.5,
        smoke: { rate: 7, up: [1.0, 1.5], life: [7, 10], size: [1.1, 1.8], sizeEnd: [4.5, 7], lit: [0.15, 0.052, 0.018], dark: [0.008, 0.0072, 0.0066], alpha: 0.7 } },
      { shape: 'line', from: [6.8, 4.15, -22.2], to: [6.8, 4.15, -18.4], n: 5, w: [0.8, 1.5], h: [0.7, 2.4], power: 0.65, pull: 0.4, sink: 0.2, top: 8.5 },
      { shape: 'glow', at: [-6.8, 4.4, -12], size: 8, power: 0.1 },
      { shape: 'glow', at: [6.8, 4.0, -20.2], size: 6, power: 0.08 },
    ],
    particles: [
      { kind: 'ember', at: [-7.0, 5.4, -12], box: [2.4, 1.0, 4.5], rate: 34, up: [1.4, 3.6], life: [2.0, 4.2], size: [0.035, 0.07], color: [1.0, 0.45, 0.1], alpha: 0.95 },
      { kind: 'ember', at: [7.2, 5.0, -20], box: [1.6, 0.8, 3.0], rate: 16, up: [1.2, 3.2], life: [2.0, 4.0], size: [0.035, 0.065], color: [1.0, 0.45, 0.1], alpha: 0.95 },
    ],
  },
  // B 燃える寺：石段の下から少し引いて、基壇の上の寺と、左右の瓦の付いた塀・杉の木立を入れる。屋根は瓦の筋と熾火で焦げて光り、
  // 炎の根元は屋根に埋め、先は画面の上の帯に届かない。屋根の炎から煙の柱が風下へ立つ
  B: {
    origin: [200, 0, 0], fov: 46, wind: [0.75, 0.1],
    camera: { from: [0, 1.25, 19], to: [0, 1.25, 19], look0: [0, 7.0, -6], look1: [0, 7.0, -6] },
    sky: { top: '#060708', mid: '#1f1d1b', hor: '#7c7468', glow: '#a3866a', glowDir: [0, -1], glowAmt: 0.5, glowSpread: 5, glowRise: 1.6, smoke: 0.8, smokeDark: '#131110', smokeLit: '#56473a' },
    fog: [20, 110], ground: { base: '#36302a', dark: '#1a1714', light: '#544a40', scale: 0.5, ash: 0.35 }, env: 0.38,
    key: { color: '#cdbfa6', intensity: 0.55, at: [-12, 22, -26] },
    glow: { color: '#ff7330', intensity: 130, at: [0, 4.4, -5.4], distance: 28 },
    terrace: { size: [24, 2.1, 18], front: 0, steps: { n: 9, rise: 0.233, run: 0.5, width: 4.6 } },
    models: [
      { key: 'temple', at: [0, 2.1, -8.0], rotY: 0, scale: 1.45, burning: true, deco: { roof: { y: 7.4, pitch: 0.3, course: 0.24 }, ember: { y: 7.4, x: [-8, 8], power: 1.1 } } },
      { key: 'lantern', at: [-3.4, 0, 6.6], rotY: 0.2, scale: 1.25, deco: { stone: true } },
      { key: 'lantern', at: [3.4, 0, 6.6], rotY: -0.2, scale: 1.25, deco: { stone: true } },
    ],
    walls: { runs: [[[-2.9, 1.0], [-34, 1.0]], [[2.9, 1.0], [34, 1.0]]], h: 2.3 },
    trees: { n: 26, x: [8.5, 30], z: [-3, -17], y: 2.1, h: [9, 15], seed: 11 },
    fires: [
      { shape: 'area', at: [0, 10.1, -8.2], box: [9.4, 0.3, 1.2], n: 12, w: [1.6, 3.4], h: [1.6, 5.4], power: 0.68, pull: 0.1, sink: 0.25, top: 14.0,
        smoke: { rate: 12, up: [1.6, 2.4], life: [10, 14], size: [1.8, 2.8], sizeEnd: [8, 12], lit: [0.17, 0.058, 0.02], dark: [0.008, 0.0072, 0.0066], alpha: 0.65 } },
      { shape: 'area', at: [0.4, 10.5, -9.8], box: [8.0, 0.3, 1.0], n: 7, w: [2.0, 3.8], h: [2.0, 5.0], power: 0.55, pull: 0, sink: 0.25, top: 15.6,
        smoke: { rate: 6, up: [1.5, 2.2], life: [10, 14], size: [1.8, 2.6], sizeEnd: [8, 12], lit: [0.15, 0.05, 0.018], dark: [0.008, 0.0072, 0.0066], alpha: 0.6 } },
      { shape: 'area', at: [-2.8, 9.0, -5.8], box: [3.4, 0.5, 1.2], n: 6, w: [0.9, 1.9], h: [0.8, 3.0], power: 0.7, pull: 0.3, sink: 0.2, top: 12.5 },
      { shape: 'area', at: [3.4, 9.0, -5.8], box: [2.6, 0.5, 1.2], n: 4, w: [0.9, 1.9], h: [0.8, 2.6], power: 0.7, pull: 0.3, sink: 0.2, top: 12.5 },
      { shape: 'area', at: [-5.6, 8.4, -4.6], box: [1.4, 0.3, 1.4], n: 4, w: [0.9, 1.7], h: [0.9, 3.0], power: 0.7, pull: 0.3, sink: 0.2, top: 12.5 },
      { shape: 'area', at: [5.8, 8.4, -5.0], box: [1.2, 0.3, 1.4], n: 3, w: [0.9, 1.6], h: [0.9, 2.8], power: 0.7, pull: 0.3, sink: 0.2, top: 12.5 },
      { shape: 'area', at: [-1.6, 3.5, -3.6], box: [3.2, 0.3, 0.4], n: 4, w: [0.8, 1.5], h: [0.7, 2.6], power: 0.65, pull: 0.35, sink: 0.25, top: 6.6 },
      { shape: 'area', at: [2.6, 3.5, -3.6], box: [2.0, 0.3, 0.4], n: 3, w: [0.8, 1.4], h: [0.7, 2.3], power: 0.6, pull: 0.35, sink: 0.25, top: 6.6 },
      { shape: 'glow', at: [0, 11.0, -8.5], size: 12, power: 0.09 },
      { shape: 'glow', at: [0, 4.4, -3.4], size: 7, power: 0.09 },
    ],
    particles: [
      { kind: 'ember', at: [0, 10.4, -7.5], box: [8, 1.0, 3.5], rate: 90, up: [2.2, 5.2], life: [2.5, 5.0], size: [0.05, 0.1], color: [1.0, 0.48, 0.12], alpha: 0.95 },
      { kind: 'ember', at: [0, 7.8, -3.4], box: [12, 0.6, 0.6], rate: 24, up: [1.4, 3.2], life: [2.0, 4.0], size: [0.035, 0.07], color: [1.0, 0.5, 0.12], alpha: 0.9 },
    ],
  },
  // C 橋を渡る影：川を上流へ見通し、橋の上を、荷を担いだ人・子を抱いた人・老人・武士が左から右へ渡る。橋の向こうの両岸に家並み、
  // 右岸と左岸の家が1棟ずつ燃える（根元から煙）。いちばん明るいのは、炎と人影のあいだの川面の照り返し（人影はその前に黒く抜ける）
  C: {
    origin: [400, 0, 0], fov: 36, wind: [0.6, 0.15],
    camera: { from: [-3.4, 2.55, 15.5], to: [-3.4, 2.55, 15.5], look0: [-2.0, 1.55, 0], look1: [0.4, 1.55, 0] },
    sky: { top: '#060708', mid: '#1f1d1b', hor: '#7d7567', glow: '#a88b6a', glowDir: [0.3, -1], glowAmt: 0.5, glowSpread: 2.6, glowRise: 3.4, smoke: 0.7, smokeDark: '#151311', smokeLit: '#5a4a3c' },
    fog: [26, 175], ground: { base: '#2a2621', dark: '#141210', light: '#3d362f', scale: 0.4 }, env: 0.26,
    key: { color: '#efc89c', intensity: 0.7, at: [10, 9, -44] },
    glow: { color: '#ff7030', intensity: 110, at: [11, 7.6, -31.5], distance: 40 },
    bridgeHalf: 7.27,                                                     // 橋の半分の長さ（模型の長さ6.06m×2.4倍の半分）
    water: { y: -0.35, x: [-6.4, 6.4], color: '#030405', reflect: [[11, 7.0, -30, 1.5], [-13, 6.6, -44, 0.95], [11, 4.4, -28.6, 0.7]] },
    models: [
      { key: 'bridge', at: [0, 0, 0], rotY: 0, scale: [2.4, 1.0, 1.1] },
      { key: 'farmhouse', at: [11, 0, -30], rotY: Math.PI, scale: 1.0, burning: true, deco: { ember: { y: 3.4, x: [7.6, 14.4], power: 1.2 } } },
      { key: 'farmhouse', at: [-13, 0, -44], rotY: Math.PI, scale: 0.95, burning: true, deco: { ember: { y: 3.2, x: [-16.2, -9.8], power: 0.9 } } },
    ],
    // 両岸の家並み（谷のモデルのインスタンス。種類ごとに1呼出）。shade は霧と夜に沈む暗さ
    rows: [
      { key: 'naya', list: [[9.8, -15.5, -1.57, 6.0, 0.8], [10.4, -40, -1.57, 6.2, 0.7], [10.2, -56, -1.4, 6.0, 0.7], [21.5, -22, 0, 6.5, 0.6], [22, -46, 0.2, 6.5, 0.55], [-10, -18, 1.57, 6.2, 0.8], [-10.4, -30, 1.57, 6.0, 0.7], [-22, -26, 0.1, 6.6, 0.55], [-10.6, -60, 1.5, 6.4, 0.6], [-24, -58, 0, 7, 0.5], [0.5, -84, 0, 7.5, 0.5]] },
      { key: 'dozo', list: [[10.6, -22.5, -1.57, 5.4, 0.75], [10.8, -48, -1.57, 5.6, 0.65], [11, -66, -1.57, 5.4, 0.6], [-10.8, -36.5, 1.57, 5.4, 0.7], [-11.2, -70, 1.57, 5.6, 0.55], [23, -34, 0, 5.8, 0.5], [-24, -40, 0, 6, 0.5]] },
    ],
    // 橋を渡る影。load は荷（pole=天秤棒・pack=背負った包み・baby=抱いた子）。from は橋の上の始まり（場面に入った時刻）、速さは m/s
    figures: [
      { who: 'villager_m', style: 'villager', from: [-1.8, 0.63, 0.3], speed: 0.9, load: 'pole' },
      { who: 'villager_f', style: 'villager', from: [-4.2, 0.63, -0.35], speed: 0.78, load: 'baby' },
      { who: 'child', style: 'villager', from: [-3.6, 0.63, 0.4], speed: 0.78 },
      { who: 'villager_m', style: 'villager', from: [-6.6, 0.63, 0.05], speed: 0.55, load: 'pack' },
      { who: 'soldier', style: 'relaxed', from: [-9.6, 0.63, -0.4], speed: 0.82 },
      { who: 'villager_f', style: 'villager', from: [-11.6, 0.63, 0.35], speed: 0.86, load: 'pack' },
      { who: 'villager_m', style: 'villager', from: [-14.2, 0.63, -0.1], speed: 0.9, load: 'pack' },
      { who: 'child', style: 'villager', from: [-14.9, 0.63, 0.5], speed: 0.9 },
    ],
    rim: { color: '#ffb276', power: 0.85, base: '#040405' },
    fires: [
      { shape: 'line', from: [9.0, 5.45, -30.2], to: [13.0, 5.45, -30.2], n: 8, w: [1.4, 2.6], h: [2.2, 5.2], power: 0.8, pull: 0, sink: 0.25, top: 11,
        smoke: { rate: 10, up: [1.5, 2.3], life: [9, 13], size: [1.4, 2.2], sizeEnd: [7, 11], lit: [0.17, 0.058, 0.02], dark: [0.008, 0.0072, 0.0066], alpha: 0.7 } },
      { shape: 'line', from: [7.9, 4.4, -28.7], to: [14.1, 4.4, -28.7], n: 9, w: [1.0, 2.0], h: [1.2, 3.4], power: 0.72, pull: 0.3, sink: 0.2, top: 9 },
      { shape: 'line', from: [-14.8, 5.2, -44.2], to: [-11.2, 5.2, -44.2], n: 6, w: [1.4, 2.4], h: [1.8, 4.2], power: 0.7, pull: 0, sink: 0.25, top: 10,
        smoke: { rate: 7, up: [1.4, 2.1], life: [9, 13], size: [1.3, 2.0], sizeEnd: [6, 10], lit: [0.15, 0.052, 0.018], dark: [0.008, 0.0072, 0.0066], alpha: 0.65 } },
      { shape: 'glow', at: [11, 6.5, -29.4], size: 13, power: 0.1 },
      { shape: 'glow', at: [-13, 6.0, -43.6], size: 10, power: 0.07 },
    ],
    particles: [
      { kind: 'ember', at: [11, 6.4, -29.6], box: [5, 1.2, 2.4], rate: 26, up: [1.6, 3.8], life: [2.5, 4.5], size: [0.05, 0.1], color: [1.0, 0.48, 0.12], alpha: 0.9 },
      { kind: 'ember', at: [-13, 6.0, -44], box: [4, 1.0, 2.0], rate: 12, up: [1.4, 3.4], life: [2.5, 4.5], size: [0.05, 0.1], color: [1.0, 0.48, 0.12], alpha: 0.9 },
    ],
  },
  // D 山道の見返り：景継が山道の縁で振り返り、眼下の谷の町を見る。町は家並みと灯の帯で、燃えるのは一か所（朱の焦点）と小さな火が2つ。
  // 中景に霧の層、奥と左右に山並み。空は町の上だけが淡い生成りの煙明かり。遠い火（町の方角の低い鍵の光）が景継の輪郭を細く照らす
  D: {
    origin: [600, 0, 0], fov: 42, wind: [0.5, 0.1],
    camera: { from: [2.2, 3.4, 8.5], to: [1.85, 3.2, 7.3], look0: [-3, -6, -70], look1: [-2.7, -6.3, -70] },
    sky: { top: '#060708', mid: '#1d1c1a', hor: '#857b6b', glow: '#b49a78', glowDir: [0.1, -1], glowAmt: 0.6, glowSpread: 4, glowRise: 7, smoke: 0.45, smokeDark: '#161411', smokeLit: '#6e5a48' }, fogGlow: 0.5,
    fog: [70, 720], ground: { base: '#2f2a24', dark: '#17140f', light: '#4d4337', scale: 0.5, path: [-0.9, 1.3] }, env: 0.3,
    key: { color: '#f2c99a', intensity: 2.6, at: [-5, 5, -48] },
    glow: { color: '#ff6a2a', intensity: 650, at: [12, -24, -150], distance: 55 },
    cliff: { edge: -1.6, drop: -32, run: 26, floor: { base: '#1d1a16', dark: '#0f0d0b', light: '#2a251f', scale: 0.12 } },
    town: { x: [-190, 200], z: [-95, -335], y: -32, n: 620, lights: 230, band: { z: -168, amp: 26, width: 52 }, burn: { at: [12, -150], r: 24 }, seed: 41 },
    ridges: [
      { from: [-780, -380], to: [780, -380], base: -40, peak: 26, seed: 1.3, top: '#4a443d', foot: '#7a7062' },
      { from: [-420, -320], to: [-60, -360], base: -40, peak: 14, seed: 5.5, top: '#3b3631', foot: '#6c6255' },
      { from: [-340, 60], to: [-250, -430], base: -40, peak: 42, seed: 2.6, top: '#25221f', foot: '#4f473e' },
      { from: [280, -430], to: [370, 60], base: -40, peak: 48, seed: 4.1, top: '#25221f', foot: '#4f473e' },
    ],
    mist: [
      { y: -20, x: [-280, 280], z: [-18, -320], color: '#8e806c', opacity: 0.2 },
      { y: -27.5, x: [-240, 260], z: [-70, -330], color: '#9c8770', opacity: 0.26 },
    ],
    models: [
      { key: 'boulder_lo', at: [-4.8, -0.4, -2.4], rotY: 0.4, scale: [1.9, 1.15, 1.4] },
      { key: 'boulder_lo', at: [-2.2, -0.25, -2.05], rotY: 2.1, scale: [0.62, 0.36, 0.5], tilt: [0.15, 0, 0.1] },
      { key: 'boulder_lo', at: [4.4, -0.45, -2.3], rotY: 1.2, scale: [1.5, 0.72, 1.1] },
      { key: 'boulder_lo', at: [7.0, -0.35, -1.1], rotY: 3.0, scale: [1.5, 0.95, 1.25] },
      { key: 'boulder_lo', at: [2.7, -0.1, 2.1], rotY: 0.7, scale: [0.42, 0.24, 0.34] },
    ],
    stones: { n: 80, area: [-6, 8, -1.5, 3.8], size: [0.05, 0.2], avoid: [-0.6, 0.6, -0.6, 0.6], color: '#5d554b', seed: 7 },
    tufts: { n: 320, areas: [[-7, 9, -1.75, -0.95], [-7, 9, 1.35, 4.5], [-7, -3.5, -0.95, 1.35]], h: [0.22, 0.55], color: '#4a4a2a', seed: 9 },
    hero: { at: [0, 0, 0], face: [-0.15, -1], turnTo: [-0.85, -0.5], speed: 0.9, turnTime: 1.1, lead: 2.6 },   // カメラは右肩の後ろ。左へ向き直るので顔はカメラへ向かない
    fires: [
      { shape: 'area', at: [12, -31.2, -150], box: [30, 1.4, 18], n: 16, w: [4, 8], h: [5, 13], power: 0.62, pull: 0, sink: 0.15,
        smoke: { rate: 10, up: [2.8, 3.8], life: [24, 32], size: [4, 6], sizeEnd: [18, 30], lit: [0.2, 0.066, 0.022], dark: [0.012, 0.011, 0.010], alpha: 0.5, drag: 0.02 } },
      { shape: 'area', at: [-7, -31.4, -158], box: [8, 1, 6], n: 4, w: [3, 5], h: [3, 6], power: 0.5, pull: 0, sink: 0.15,
        smoke: { rate: 2.5, up: [2.2, 3.0], life: [18, 24], size: [2.5, 4], sizeEnd: [10, 16], lit: [0.15, 0.05, 0.018], dark: [0.012, 0.011, 0.010], alpha: 0.42, drag: 0.03 } },
      { shape: 'area', at: [46, -31.4, -178], box: [8, 1, 6], n: 3, w: [3, 5], h: [3, 5], power: 0.48, pull: 0, sink: 0.15 },
      { shape: 'glow', at: [12, -25, -150], size: 62, power: 0.12 },
      { shape: 'glow', at: [-7, -28, -158], size: 20, power: 0.06 },
    ],
    particles: [
      { kind: 'ember', at: [12, -25, -150], box: [26, 4, 16], rate: 36, up: [3, 7], life: [3, 6], size: [0.25, 0.45], color: [1.0, 0.48, 0.12], alpha: 0.9 },
    ],
  },
});
export const SCENE_IDS = Object.keys(SCENES);

// カメラの道筋（世界座標）。k は場面の中の進み（0〜1、opening.js の camera.k）。動きの始めと終わりはなめらかに
export function cameraAt(id, k) {
  const s = SCENES[id]; if (!s) return null;
  const c = s.camera, e = smooth(k), o = s.origin;
  const add = p => [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
  return { pos: add(lerp3(c.from, c.to, e)), look: add(lerp3(c.look0, c.look1, e)), fov: s.fov };
}

// 炎の源を、板（舌）の並びへ展開する。同じ場面なら毎回同じ並び（番号から決まる系列）。kind 0=炎の舌、1=光のにじみ（大きな柔らかい板）
// 2周目：舌の根元が一直線にそろうと「炎の柵」に見えた。高さは短い舌を多めに散らし（長い舌は少数）、根元の高さも舌ごとにずらす。
// sink は舌の高さの何割を屋根の中へ埋めるか（根元は屋根に隠れ、屋根を焦がす）。top は舌の先の上限（場面の組の高さ。画面の上の帯に触れない）
export function flameSprites(id) {
  const s = SCENES[id]; if (!s) return [];
  const out = [];
  s.fires.forEach((f, fi) => {
    if (f.shape === 'glow') { out.push({ pos: [...f.at], w: f.size, h: f.size, seed: (fi * 0.137) % 1, power: f.power, pull: 0, kind: 1 }); return; }
    const jy = f.jitterY ?? 0.35;
    for (let i = 0; i < f.n; i++) {
      const r = cellRand(9100 + SCENE_IDS.indexOf(id), fi, i);
      const a = r(), b = r(), c = r(), d = r(), e = r(), g = r(), y = r();
      let pos;
      if (f.shape === 'line') {
        const k = f.n === 1 ? 0.5 : Math.min(1, Math.max(0, (i + 0.5) / f.n + (a - 0.5) * 1.5 / f.n));
        pos = lerp3(f.from, f.to, k); pos[0] += (b - 0.5) * 0.5; pos[2] += (c - 0.5) * 0.5;
      } else pos = [f.at[0] + (a - 0.5) * f.box[0], f.at[1] + (b - 0.5) * f.box[1], f.at[2] + (c - 0.5) * f.box[2]];
      let h = lerp(f.h[0], f.h[1], e ** 1.7);                       // 短い舌が多く、長い舌は少し
      pos[1] += (y - 0.5) * jy * f.h[0] - h * (f.sink ?? 0);         // 根元の高さをずらし、屋根の中へ埋める
      if (f.top !== undefined) h = Math.max(f.h[0] * 0.4, Math.min(h, f.top - pos[1]));
      out.push({ pos, w: lerp(f.w[0], f.w[1], d) * (0.75 + 0.35 * h / f.h[1]), h, seed: Math.round(g * 997) / 997, power: f.power * (0.8 + 0.4 * r()), pull: f.pull, kind: 0 });
    }
  });
  return out;
}

// 煙の柱は、炎の根元から立てる（離れた所に浮く黒い塊にしない）。smoke を持つ炎ごとに、その炎の足もとの広がりから出す源を作る。
// 色は下（出たばかり）が炎に照らされた朱茶（lit）、上へ昇るほど暗い煙（dark）へ移る（下側を朱に染める）
export function fireRoot(f) {
  if (f.shape === 'line') {
    const c = lerp3(f.from, f.to, 0.5), len = Math.hypot(f.to[0] - f.from[0], f.to[2] - f.from[2]);
    return { at: [c[0], c[1] + f.h[0] * 0.3, c[2]], box: [Math.abs(f.to[0] - f.from[0]) + 0.6, f.h[0] * 0.4, Math.abs(f.to[2] - f.from[2]) + 0.6], len };
  }
  return { at: [f.at[0], f.at[1] + f.h[0] * 0.3, f.at[2]], box: [f.box[0] * 0.8, f.h[0] * 0.4, f.box[2] * 0.8] };
}
export function particleSources(id) {
  const s = SCENES[id]; if (!s) return [];
  const own = (s.particles || []).map(p => p);
  const fromFires = s.fires.filter(f => f.smoke).map(f => {
    const root = fireRoot(f), m = f.smoke;
    return { kind: 'smoke', at: root.at, box: root.box, rate: m.rate, up: m.up, life: m.life, size: m.size, sizeEnd: m.sizeEnd, color: m.lit, colorEnd: m.dark, alpha: m.alpha, drag: m.drag, fire: s.fires.indexOf(f) };
  });
  return [...own, ...fromFires];
}
const SOURCES = Object.fromEntries(Object.keys(SCENES).map(id => [id, particleSources(id)]));

// 粒子（火の粉・煙）の出し方。state は源ごとの {acc, n}（貯まった端数と、出した数）。dt だけ進めて、出す粒子の一覧を返す。
// 速さ・大きさ・寿命は「場面・源・何個目か」で決まる系列から引く。風（場面の wind）へ同じ向きに流す（R17.6：二次運動の風向をそろえる）
export function createParticleState(id) { return (SOURCES[id] || []).map(() => ({ acc: 0, n: 0 })); }
export function particleStep(id, state, dt) {
  const s = SCENES[id]; if (!s) return { state, spawns: [] };
  const spawns = [], next = [], w = s.wind;
  dt = Number.isFinite(dt) && dt > 0 ? dt : 0;
  SOURCES[id].forEach((p, pi) => {
    const prev = state?.[pi] || { acc: 0, n: 0 };
    let acc = prev.acc + p.rate * dt, n = prev.n;
    while (acc >= 1 - 1e-9) {                                  // 端数の足し算の誤差で、細かい刻みのときだけ1つ落ちないように
      acc -= 1;
      const r = cellRand(7300 + SCENE_IDS.indexOf(id), pi, n++);
      const pos = [p.at[0] + (r() - 0.5) * p.box[0], p.at[1] + (r() - 0.5) * p.box[1], p.at[2] + (r() - 0.5) * p.box[2]];
      const up = lerp(p.up[0], p.up[1], r()), side = p.kind === 'ember' ? 0.9 : 0.25;
      const vel = [w[0] * (p.kind === 'ember' ? 1.6 : 1.0) + (r() - 0.5) * side, up, w[1] * (p.kind === 'ember' ? 1.6 : 1.0) + (r() - 0.5) * side];
      const life = lerp(p.life[0], p.life[1], r()), size = lerp(p.size[0], p.size[1], r());
      const sizeEnd = p.sizeEnd ? lerp(p.sizeEnd[0], p.sizeEnd[1], r()) : size * 0.15;
      const vary = 0.85 + 0.3 * r();
      const shade = p.kind === 'ember' ? [p.color[0], p.color[1] * (0.75 + 0.5 * r()), p.color[2]] : p.color.map(c => c * vary);
      spawns.push({ kind: p.kind, pos, vel, life, size, sizeEnd, color: shade, colorEnd: p.colorEnd ? p.colorEnd.map(c => c * vary) : undefined, alpha: p.alpha, gravity: p.kind === 'ember' ? -0.15 : 0.05, drag: p.drag ?? (p.kind === 'ember' ? 0.35 : 0.12) });
    }
    next.push({ acc, n });
  });
  return { state: next, spawns };
}

// 地平の色：空のシェーダーが地平（高さ0）で描く色を、向き（x,z）ごとに同じ式で求める。霧の色にすると、地面の果てが空に溶けて継ぎ目が出ない
// 空のシェーダーは線形の色で混ぜるので、ここも線形で混ぜてから sRGB の16進へ戻す（THREE.Color.set と同じ変換）
const toLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4), toSRGB = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => toLinear(c / 255)); };
export function horizonColor(sky, dir) {
  const [hx, hz] = (l => [dir[0] / l, dir[1] / l])(Math.hypot(dir[0], dir[1]) || 1), gl = Math.hypot(sky.glowDir[0], sky.glowDir[1]) || 1;
  const g = Math.max(0, (hx * sky.glowDir[0] + hz * sky.glowDir[1]) / gl) ** sky.glowSpread, k = 0.0669;          // k = smoothstep(-0.03, 0.16, 0)
  const hor = rgb(sky.hor), mid = rgb(sky.mid), glow = rgb(sky.glow);
  const out = hor.map((c, i) => Math.min(1, c + (mid[i] - c) * k + glow[i] * g * sky.glowAmt));
  return '#' + out.map(c => Math.round(toSRGB(c) * 255).toString(16).padStart(2, '0')).join('');
}

// D の景継：場面の終わりの lead 秒前に、見返っていた向き（face）から先の道（turnTo）へ向き直り、歩き出す。顔はカメラへ向けない
// segT は場面に入ってからの秒、duration は場面の長さ。戻り値の yaw は人物の根の回転（向き (dx,dz) は atan2(dx, dz)）、walk は歩いた距離（m）
export function heroAt(segT, duration, hero = SCENES.D.hero) {
  const turnAt = Math.max(0, duration - hero.lead), k = smooth((segT - turnAt) / hero.turnTime);
  const a0 = Math.atan2(hero.face[0], hero.face[1]); let a1 = Math.atan2(hero.turnTo[0], hero.turnTo[1]);
  if (a1 - a0 > Math.PI) a1 -= 2 * Math.PI; else if (a0 - a1 > Math.PI) a1 += 2 * Math.PI;      // 近い側へ回る
  const walkT = Math.max(0, segT - turnAt - hero.turnTime * 0.6);
  const l = Math.hypot(hero.turnTo[0], hero.turnTo[1]);
  const walk = hero.speed * walkT;
  return { yaw: a0 + (a1 - a0) * k, walk, moving: segT > turnAt, pos: [hero.at[0] + hero.turnTo[0] / l * walk, hero.at[1], hero.at[2] + hero.turnTo[1] / l * walk] };
}

// D の谷の町：手続きの家（遠い町）。谷を左右に流れる帯（band）に沿って密に、帯から離れるほどまばらに。燃える区画（burn）の家は煤けて暗い
export function townHouses(t) {
  const out = [], r = cellRand(8800, 1, t.seed);
  for (let tries = 0; out.length < t.n && tries < t.n * 8; tries++) {
    const x = lerp(t.x[0], t.x[1], r()), z = lerp(t.z[0], t.z[1], r()), u = r();
    const bz = t.band.z + t.band.amp * Math.sin(x / 70 + 0.6), d = (z - bz) / t.band.width;
    if (u > Math.exp(-d * d) * 0.92 + 0.05) continue;
    const w = 5 + r() * 5, dd = 4 + r() * 3.5, h = 2.4 + r() * 1.4, rotY = (r() - 0.5) * 0.4 + (r() < 0.5 ? 0 : Math.PI / 2);
    const burn = Math.hypot(x - t.burn.at[0], z - t.burn.at[1]) < t.burn.r;
    out.push({ at: [x, t.y, z], size: [w, h, dd], rotY, shade: burn ? 0.32 : 0.55 + 0.45 * r(), burn });
  }
  return out;
}
// 町の灯：燃える区画のまわりは朱の熾火（明るく大きい）、帯に沿ってはまばらな暗い灯（軒の灯・窓）。明るさは動かさない
export function townLights(t) {
  const out = [], r = cellRand(8810, 2, t.seed), nearN = Math.round(t.lights * 0.45);
  for (let i = 0; i < t.lights; i++) {
    const near = i < nearN; let x, z;
    if (near) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * t.burn.r * 1.5; x = t.burn.at[0] + Math.cos(a) * d; z = t.burn.at[1] + Math.sin(a) * d * 0.7; }
    else { x = lerp(t.x[0], t.x[1], r()); z = t.band.z + t.band.amp * Math.sin(x / 70 + 0.6) + (r() - 0.5) * t.band.width * 1.2; }
    const k = r(), color = near ? [1.0, 0.42, 0.12].map(c => c * (0.7 + 0.5 * k)) : [0.95, 0.62, 0.3].map(c => c * (0.3 + 0.32 * k));
    out.push({ at: [x, t.y + 0.4 + r() * 2.6, z], size: near ? 1.5 + r() * 2.2 : 1.0 + r() * 1.2, color, near });
  }
  return out;
}
// 地面に散らす小物（草むら・小石）。areas の箱 [x0, x1, z0, z1] の中に、avoid の箱を避けて置く
export function scatterGround(spec, kind) {
  const out = [], r = cellRand(8820 + (kind === 'tuft' ? 1 : 0), 3, spec.seed), areas = spec.areas || [spec.area];
  for (let i = 0, tries = 0; i < spec.n && tries < spec.n * 6; tries++) {
    const a = areas[Math.floor(r() * areas.length)], x = lerp(a[0], a[1], r()), z = lerp(a[2], a[3], r());
    const v = spec.avoid; if (v && x > v[0] && x < v[1] && z > v[2] && z < v[3]) continue;
    const k = r(), size = lerp(spec.size?.[0] ?? spec.h[0], spec.size?.[1] ?? spec.h[1], k * k);
    out.push(kind === 'tuft' ? { at: [x, 0, z], h: size, rotY: r() * Math.PI * 2 }
      : { at: [x, size * 0.25, z], size: [size * (0.8 + 0.6 * r()), size * (0.45 + 0.4 * r()), size * (0.8 + 0.6 * r())], rotY: r() * Math.PI * 2, tilt: (r() - 0.5) * 0.5, shade: 0.55 + 0.5 * r() });
    i++;
  }
  return out;
}

// C の影の人物の位置：橋の上は床の高さ（from の y）、橋の手前の岸では地面（0）。岸から床へは橋の端の手前 ramp m で上がる（宙に浮かない）
export function figureAt(f, segT, half = SCENES.C.bridgeHalf, ramp = 1.4) {
  const x = f.from[0] + f.speed * segT, over = Math.abs(x) - (half - ramp);
  return [x, over <= 0 ? f.from[1] : f.from[1] * Math.max(0, 1 - over / ramp), f.from[2]];
}

// B の杉の木立：基壇の左右（x の絶対値が x[0]〜x[1]）に、高さの違う杉を並べる
export function groveTrees(t) {
  const out = [], r = cellRand(8830, 4, t.seed);
  for (let i = 0; i < t.n; i++) {
    const side = i % 2 ? 1 : -1, x = side * lerp(t.x[0], t.x[1], r()), z = lerp(t.z[0], t.z[1], r());
    out.push({ at: [x, t.y, z], h: lerp(t.h[0], t.h[1], r()), r: 0.85 + 0.35 * r(), rotY: r() * Math.PI * 2 });
  }
  return out;
}

// 影の人物の輪郭の明かり（opening-fire.js の silhouetteMaterial と同じ式）。ndv は法線と視線の内積、ndl は法線と光の向きの内積。
// カメラを向かない法線（ndv≤0）・正面を向く面（ndv が大きい）・光の反対の側では0。縁だけが細く明るい（最大1）
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function rimShade(ndv, ndl) { return sstep(0, 0.1, ndv) * (1 - Math.max(0, Math.min(1, ndv))) ** 5 * sstep(0.05, 0.6, ndl); }

// ---- 画面の測り方（試験と回帰で使う） ----
// 朱の画素：色相が赤〜橙（345°〜45°）、彩度0.45以上、明るさ0.25以上（sRGB 8bit）。暗い赤茶（墨に沈む色）と、白っぽい炎の芯は数えない
export function isVermilion(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = mx / 255;
  if (v < 0.25 || mx === 0) return false;
  const sat = (mx - mn) / mx; if (sat < 0.45) return false;
  let h;
  if (mx === r) h = (60 * ((g - b) / (mx - mn)) + 360) % 360; else if (mx === g) h = 60 * ((b - r) / (mx - mn)) + 120; else h = 60 * ((r - g) / (mx - mn)) + 240;
  return h >= 345 || h <= 45;
}
// 絵（上下の帯を除く行）のうち、朱の画素の割合。data は RGBA の並び。bar は上下それぞれの帯の高さ（画面の割合）
export function vermilionShare(data, width, height, { bar = 0 } = {}) {
  const y0 = Math.round(height * bar), y1 = height - y0;
  let hit = 0, all = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4; all++;
    if (isVermilion(data[i], data[i + 1], data[i + 2])) hit++;
  }
  return all ? hit / all : 0;
}
// 明滅の回数（1秒あたり）。明るさの列（0〜1）で、向きの逆な変化の組を「1回」と数える（WCAGの一般的な閃光の数え方を、
// 画面の平均の明るさに当てた簡易版）。threshold 未満の揺れは数えない
export function flashRate(lumas, fps, threshold = 0.1) {
  if (lumas.length < 2 || !(fps > 0)) return 0;
  let lo = lumas[0], hi = lumas[0], dir = 0, swings = 0;          // swings：threshold 以上の一方向の変化の数。2つで1回の明滅
  for (const l of lumas) {
    if (dir >= 0) { hi = Math.max(hi, l); if (hi - l >= threshold) { swings++; dir = -1; lo = l; } }
    if (dir <= 0) { lo = Math.min(lo, l); if (l - lo >= threshold) { swings++; dir = 1; hi = l; } }
  }
  return swings / 2 / (lumas.length / fps);
}
