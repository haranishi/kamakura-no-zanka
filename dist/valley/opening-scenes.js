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
  A: {
    origin: [0, 0, 0], fov: 40, wind: [0.9, 0.25],
    camera: { from: [0.4, 1.15, 10.5], to: [0.35, 1.22, 6.5], look0: [-0.6, 3.5, -20], look1: [-0.4, 3.65, -20] },
    sky: { top: '#050608', mid: '#1b1715', hor: '#4e443b', glow: '#5e4a3c', glowDir: [-0.15, -1], glowAmt: 0.45, glowSpread: 2.5, glowRise: 4, smoke: 0.9, smokeDark: '#0e0c0b', smokeLit: '#4a3628' },
    fog: [8, 70], ground: { base: '#3a3129', dark: '#1b1714', light: '#5b4b3c', scale: 0.45 }, env: 0.4,
    key: { color: '#cdbfa6', intensity: 0.6, at: [-4, 16, -44] },
    glow: { color: '#ff7a32', intensity: 110, at: [-4.0, 2.8, -11.5], distance: 30 },
    models: [
      { key: 'naya', at: [-8.0, 0, 4.5], rotY: Math.PI / 2, scale: 6.6, tint: '#e8d2a8' },
      { key: 'farmhouse', at: [-8.2, 0, -12], rotY: -Math.PI / 2, scale: 1.02, burning: true },
      { key: 'naya', at: [-8.5, 0, -23.5], rotY: Math.PI / 2, scale: 6.4, tint: '#cdb894' },
      { key: 'farmhouse', at: [-8.2, 0, -33.5], rotY: -Math.PI / 2, scale: 0.95 },
      { key: 'naya', at: [-8.4, 0, -43.5], rotY: Math.PI / 2, scale: 6.0, tint: '#cdb894' },
      { key: 'farmhouse', at: [8.2, 0, 1.5], rotY: Math.PI / 2, scale: 1.0 },
      { key: 'naya', at: [8.5, 0, -9.5], rotY: -Math.PI / 2, scale: 6.2, tint: '#e8d2a8' },
      { key: 'farmhouse', at: [8.2, 0, -19.5], rotY: Math.PI / 2, scale: 0.96, burning: true },
      { key: 'naya', at: [8.5, 0, -30.5], rotY: -Math.PI / 2, scale: 6.2, tint: '#cdb894' },
      { key: 'naya', at: [8.4, 0, -41], rotY: -Math.PI / 2, scale: 6.0, tint: '#cdb894' },
      { key: 'naya', at: [0.5, 0, -53], rotY: 0, scale: 8.0, tint: '#cdb894' },
      { key: 'cart', at: [3.2, 0.32, -4.5], rotY: 2.3, scale: 1.0, tilt: [0, 0, 1.2] },
      { key: 'wara', at: [-3.4, 0.3, -7.0], rotY: 0.6, scale: 0.8, tilt: [1.45, 0, 0] },
      { key: 'firewood', at: [4.0, 0, 2.6], rotY: 1.1, scale: 1.2 },
      { key: 'fence', at: [-3.9, 0.16, -2.2], rotY: 0.35, scale: 1.0, tilt: [1.52, 0, 0] },
      { key: 'firewood', at: [-2.6, 0, -9.5], rotY: 2.4, scale: 1.0 },
    ],
    flag: { pole: [[-1.4, 0.05, -1.0], [2.75, 1.32, -4.1]], cloth: [1.2, 2.0] },          // 竿は倒れた荷車に掛かり、布は竿から垂れて地面に広がる
    fires: [
      { shape: 'line', from: [-8.2, 5.45, -13.9], to: [-8.2, 5.45, -10.1], n: 8, w: [1.4, 2.6], h: [2.2, 4.2], power: 0.75, pull: 0.5 },
      { shape: 'line', from: [-6.7, 4.45, -15.4], to: [-6.7, 4.45, -8.8], n: 10, w: [1.0, 2.0], h: [1.4, 3.0], power: 0.7, pull: 0.7 },
      { shape: 'line', from: [-5.0, 1.6, -15.2], to: [-5.0, 1.9, -9.0], n: 6, w: [0.8, 1.5], h: [1.0, 2.2], power: 0.65, pull: 0.5 },
      { shape: 'line', from: [8.2, 5.1, -20.9], to: [8.2, 5.1, -18.6], n: 4, w: [1.1, 2.0], h: [1.6, 3.0], power: 0.7, pull: 0.4 },
      { shape: 'line', from: [6.8, 4.15, -22.2], to: [6.8, 4.15, -18.4], n: 5, w: [0.9, 1.6], h: [1.2, 2.4], power: 0.65, pull: 0.6 },
      { shape: 'glow', at: [-6.8, 4.4, -12], size: 8, power: 0.1 },
      { shape: 'glow', at: [6.8, 4.0, -20.2], size: 6, power: 0.08 },
    ],
    particles: [
      { kind: 'smoke', at: [-7.8, 8.0, -12], box: [2.6, 1.0, 4.5], rate: 12, up: [1.0, 1.6], life: [7, 10], size: [1.6, 2.4], sizeEnd: [5.5, 8], color: [0.006, 0.0052, 0.0048], alpha: 0.7 },
      { kind: 'smoke', at: [-7.0, 5.8, -12], box: [2.6, 1.2, 5.0], rate: 6, up: [0.8, 1.4], life: [2.0, 3.2], size: [1.3, 1.9], sizeEnd: [3.2, 4.8], color: [0.1, 0.038, 0.013], alpha: 0.32 },
      { kind: 'smoke', at: [7.8, 7.2, -20], box: [1.8, 1.0, 3.0], rate: 8, up: [1.0, 1.5], life: [7, 10], size: [1.4, 2.2], sizeEnd: [5, 7.5], color: [0.006, 0.0052, 0.0048], alpha: 0.7 },
      { kind: 'smoke', at: [7.2, 5.2, -20], box: [1.6, 1.0, 3.0], rate: 3, up: [0.8, 1.3], life: [2.0, 3.0], size: [1.0, 1.6], sizeEnd: [2.6, 4], color: [0.1, 0.038, 0.013], alpha: 0.3 },
      { kind: 'ember', at: [-7.0, 5.4, -12], box: [2.4, 1.0, 4.5], rate: 34, up: [1.4, 3.6], life: [2.0, 4.2], size: [0.035, 0.07], color: [1.0, 0.45, 0.1], alpha: 0.95 },
      { kind: 'ember', at: [7.2, 5.0, -20], box: [1.6, 0.8, 3.0], rate: 16, up: [1.2, 3.2], life: [2.0, 4.0], size: [0.035, 0.065], color: [1.0, 0.45, 0.1], alpha: 0.95 },
    ],
  },
  B: {
    origin: [200, 0, 0], fov: 50, wind: [0.75, 0.1],
    camera: { from: [0, 1.0, 12.5], to: [0, 1.0, 12.5], look0: [0, 6.0, -6], look1: [0, 6.0, -6] },
    sky: { top: '#050608', mid: '#1a1614', hor: '#463d35', glow: '#5c4838', glowDir: [0, -1], glowAmt: 0.55, glowSpread: 5, glowRise: 1.6, smoke: 0.9, smokeDark: '#0d0b0a', smokeLit: '#463224' },
    fog: [16, 95], ground: { base: '#36302a', dark: '#1a1714', light: '#544a40', scale: 0.5 }, env: 0.38,
    key: { color: '#cdbfa6', intensity: 0.55, at: [-12, 22, -26] },
    glow: { color: '#ff7330', intensity: 130, at: [0, 4.4, -5.4], distance: 28 },
    terrace: { size: [24, 2.1, 18], front: 0, steps: { n: 9, rise: 0.233, run: 0.5, width: 4.6 } },
    models: [
      { key: 'temple', at: [0, 2.1, -8.0], rotY: 0, scale: 1.45, burning: true },
      { key: 'lantern', at: [-3.4, 0, 6.6], rotY: 0.2, scale: 1.25 },
      { key: 'lantern', at: [3.4, 0, 6.6], rotY: -0.2, scale: 1.25 },
    ],
    fires: [
      { shape: 'area', at: [0, 10.1, -8.2], box: [9.4, 0.3, 1.2], n: 12, w: [1.8, 3.6], h: [2.6, 6.0], power: 0.68, pull: 0.3 },
      { shape: 'area', at: [0.4, 10.5, -9.8], box: [8.0, 0.3, 1.0], n: 7, w: [2.4, 4.2], h: [3.6, 7.0], power: 0.55, pull: 0 },
      { shape: 'area', at: [-2.8, 9.0, -5.8], box: [3.4, 0.5, 1.2], n: 5, w: [1.0, 2.0], h: [1.4, 2.8], power: 0.7, pull: 0.8 },
      { shape: 'area', at: [3.4, 9.0, -5.8], box: [2.6, 0.5, 1.2], n: 4, w: [1.0, 2.0], h: [1.4, 2.8], power: 0.7, pull: 0.8 },
      { shape: 'area', at: [-5.6, 8.4, -4.6], box: [1.4, 0.3, 1.4], n: 4, w: [1.0, 1.8], h: [1.8, 3.2], power: 0.7, pull: 0.5 },
      { shape: 'area', at: [5.8, 8.4, -5.0], box: [1.2, 0.3, 1.4], n: 3, w: [1.0, 1.7], h: [1.6, 3.0], power: 0.7, pull: 0.5 },
      { shape: 'area', at: [-1.6, 3.5, -3.6], box: [3.2, 0.3, 0.4], n: 4, w: [0.9, 1.6], h: [1.4, 2.8], power: 0.65, pull: 0.6 },
      { shape: 'area', at: [2.6, 3.5, -3.6], box: [2.0, 0.3, 0.4], n: 3, w: [0.9, 1.5], h: [1.2, 2.4], power: 0.6, pull: 0.6 },
      { shape: 'glow', at: [0, 11.0, -8.5], size: 14, power: 0.1 },
      { shape: 'glow', at: [0, 4.4, -3.4], size: 7, power: 0.09 },
    ],
    particles: [
      { kind: 'smoke', at: [0.6, 13.0, -8.5], box: [8, 1.5, 4], rate: 16, up: [1.3, 2.0], life: [8, 12], size: [2.4, 3.4], sizeEnd: [7.5, 10], color: [0.006, 0.0052, 0.0048], alpha: 0.7 },
      { kind: 'smoke', at: [0, 10.8, -7.5], box: [9, 1.0, 4], rate: 8, up: [1.0, 1.6], life: [2.0, 3.0], size: [1.6, 2.4], sizeEnd: [4, 6], color: [0.11, 0.042, 0.014], alpha: 0.3 },
      { kind: 'ember', at: [0, 10.4, -7.5], box: [8, 1.0, 3.5], rate: 110, up: [2.2, 5.2], life: [2.5, 5.0], size: [0.05, 0.1], color: [1.0, 0.48, 0.12], alpha: 0.95 },
      { kind: 'ember', at: [0, 7.8, -3.4], box: [12, 0.6, 0.6], rate: 24, up: [1.4, 3.2], life: [2.0, 4.0], size: [0.035, 0.07], color: [1.0, 0.5, 0.12], alpha: 0.9 },
    ],
  },
  // C・D は仮（二段目の後半で作り込む）：橋と遠くの火、遠くの火と煙だけ。色は A・B と同じ墨・生成り・朱にそろえてある
  C: {
    origin: [400, 0, 0], fov: 38, wind: [0.6, 0.15],
    camera: { from: [-0.8, 2.6, 21], to: [0.8, 2.6, 21], look0: [-1.6, 2.6, 0], look1: [1.6, 2.6, 0] },
    sky: { top: '#050608', mid: '#1b1715', hor: '#4e443b', glow: '#5e4a3c', glowDir: [0.1, -1], glowAmt: 0.6, glowSpread: 2.2, glowRise: 3, smoke: 0.7, smokeDark: '#0e0c0b', smokeLit: '#4a3628' },
    fog: [16, 150], ground: { base: '#2a2621', dark: '#141210', light: '#433a32', scale: 0.4 }, env: 0.35,
    key: { color: '#d8c4a4', intensity: 1.1, at: [0, 7, -40] },
    glow: { color: '#ff7030', intensity: 40, at: [0, 3, -14], distance: 40 },
    models: [{ key: 'bridge', at: [0, 1.2, 0], rotY: 0, scale: 2.4 }],
    fires: [
      { shape: 'area', at: [-14, 2.0, -70], box: [6, 1, 2], n: 8, w: [3, 5], h: [5, 9], power: 0.7, pull: 0 },
      { shape: 'glow', at: [-14, 5, -70], size: 40, power: 0.16 },
    ],
    particles: [{ kind: 'smoke', at: [-14, 9, -70], box: [5, 1, 2], rate: 3, up: [1.6, 2.4], life: [12, 16], size: [6, 8], sizeEnd: [16, 22], color: [0.006, 0.0052, 0.0048], alpha: 0.7 }],
  },
  D: {
    origin: [600, 0, 0], fov: 42, wind: [0.5, 0.1],
    camera: { from: [1.9, 2.05, 5.6], to: [1.25, 1.9, 3.3], look0: [-1.2, 1.9, -40], look1: [-0.9, 1.7, -40] },
    sky: { top: '#050608', mid: '#1a1719', hor: '#4a4038', glow: '#5e4a3c', glowDir: [-0.1, -1], glowAmt: 0.55, glowSpread: 4, glowRise: 4, smoke: 0.55, smokeDark: '#0e0c0c', smokeLit: '#4a3628' },
    fog: [30, 260], ground: { base: '#2c2822', dark: '#141210', light: '#433c33', scale: 0.4 }, env: 0.35,
    key: { color: '#cdbfa6', intensity: 0.7, at: [-10, 12, -30] },
    glow: { color: '#ff6a2a', intensity: 20, at: [0, 6, -60], distance: 80 },
    models: [],
    fires: [
      { shape: 'area', at: [-30, -18, -160], box: [8, 1, 3], n: 6, w: [5, 8], h: [6, 10], power: 0.6, pull: 0 },
      { shape: 'area', at: [12, -20, -190], box: [6, 1, 3], n: 5, w: [5, 8], h: [6, 10], power: 0.55, pull: 0 },
    ],
    particles: [
      { kind: 'smoke', at: [-30, -10, -160], box: [6, 1, 2], rate: 2.5, up: [2.0, 3.0], life: [14, 18], size: [8, 10], sizeEnd: [22, 30], color: [0.006, 0.0052, 0.0048], alpha: 0.7 },
      { kind: 'smoke', at: [12, -12, -190], box: [5, 1, 2], rate: 2, up: [2.0, 3.0], life: [14, 18], size: [8, 10], sizeEnd: [22, 30], color: [0.006, 0.0052, 0.0048], alpha: 0.7 },
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
export function flameSprites(id) {
  const s = SCENES[id]; if (!s) return [];
  const out = [];
  s.fires.forEach((f, fi) => {
    if (f.shape === 'glow') { out.push({ pos: [...f.at], w: f.size, h: f.size, seed: (fi * 0.137) % 1, power: f.power, pull: 0, kind: 1 }); return; }
    for (let i = 0; i < f.n; i++) {
      const r = cellRand(9100 + SCENE_IDS.indexOf(id), fi, i);
      const a = r(), b = r(), c = r(), d = r(), e = r(), g = r();
      let pos;
      if (f.shape === 'line') {
        const k = f.n === 1 ? 0.5 : Math.min(1, Math.max(0, (i + 0.5) / f.n + (a - 0.5) * 1.5 / f.n));
        pos = lerp3(f.from, f.to, k); pos[0] += (b - 0.5) * 0.5; pos[2] += (c - 0.5) * 0.5;
      } else pos = [f.at[0] + (a - 0.5) * f.box[0], f.at[1] + (b - 0.5) * f.box[1], f.at[2] + (c - 0.5) * f.box[2]];
      out.push({ pos, w: lerp(f.w[0], f.w[1], d), h: lerp(f.h[0], f.h[1], e), seed: Math.round(g * 997) / 997, power: f.power * (0.8 + 0.4 * r()), pull: f.pull, kind: 0 });
    }
  });
  return out;
}

// 粒子（火の粉・煙）の出し方。state は源ごとの {acc, n}（貯まった端数と、出した数）。dt だけ進めて、出す粒子の一覧を返す。
// 速さ・大きさ・寿命は「場面・源・何個目か」で決まる系列から引く。風（場面の wind）へ同じ向きに流す（R17.6：二次運動の風向をそろえる）
export function createParticleState(id) { return (SCENES[id]?.particles || []).map(() => ({ acc: 0, n: 0 })); }
export function particleStep(id, state, dt) {
  const s = SCENES[id]; if (!s) return { state, spawns: [] };
  const spawns = [], next = [], w = s.wind;
  dt = Number.isFinite(dt) && dt > 0 ? dt : 0;
  s.particles.forEach((p, pi) => {
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
      const shade = p.kind === 'ember' ? [p.color[0], p.color[1] * (0.75 + 0.5 * r()), p.color[2]] : p.color.map(c => c * (0.85 + 0.3 * r()));
      spawns.push({ kind: p.kind, pos, vel, life, size, sizeEnd, color: shade, alpha: p.alpha, gravity: p.kind === 'ember' ? -0.15 : 0.05, drag: p.kind === 'ember' ? 0.35 : 0.12 });
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
