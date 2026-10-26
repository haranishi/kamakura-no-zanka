// vegetation.js — 杉・広葉・松・草・稲の形状と、距離ごとの切り替え（LOD）・風を持つ（view層）。
// 配置は scatter.js（純関数）から受ける。外部素材なし。形と葉の絵は手続きで作る。
import * as THREE from 'three';
import { mulberry32 } from './scatter.js';

const TAU = Math.PI * 2;

// ---- 葉の絵（アルファつき） ----
function needleTexture() {
  // 杉の枝先：根元（下中央）から扇状に伸びる小枝に、短い針を密につける。内側ほど暗く、先ほど明るい。
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const rnd = mulberry32(4401);
  g.clearRect(0, 0, 256, 256);
  g.lineCap = 'round';
  const twig = (x0, y0, ang, len, depth) => {
    const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
    g.strokeStyle = `rgb(${46 + rnd() * 12},${34 + rnd() * 8},${22 + rnd() * 6})`; g.lineWidth = depth ? 1.2 : 2.2;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    const n = Math.floor(len / 2.1);
    for (let i = 1; i < n; i++) {
      const t = i / n, px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
      const k = Math.max(0.15, Math.min(1, depth ? t : 0.25 + t * 0.6));            // 内側は暗く、先は明るく
      for (const side of [-1, 1]) {
        const a = ang + side * (0.55 + rnd() * 0.55), l = (depth ? 8 : 12) * (0.55 + rnd() * 0.6) * (1 - t * 0.25);
        const r = 15 + 22 * k + rnd() * 8, gr = 26 + 36 * k + rnd() * 10, b = 15 + 14 * k + rnd() * 6;
        g.strokeStyle = `rgb(${r | 0},${gr | 0},${b | 0})`; g.lineWidth = 1.9;
        g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke();
      }
    }
    return [x1, y1];
  };
  const base = [128, 246], up = -Math.PI / 2;
  for (let i = 0; i < 9; i++) {
    const f = i / 8 - 0.5, ang = up + f * 1.9 + (rnd() - 0.5) * 0.12, len = 150 + rnd() * 70 - Math.abs(f) * 60;
    twig(base[0], base[1], ang, len, 0);
    for (let k = 0; k < 4; k++) {                                                    // 脇の小枝
      const t = 0.28 + k * 0.17, px = base[0] + Math.cos(ang) * len * t, py = base[1] + Math.sin(ang) * len * t;
      for (const side of [-1, 1]) twig(px, py, ang + side * (0.75 + rnd() * 0.3), 34 + rnd() * 30, 1);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function leafTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const rnd = mulberry32(991);
  for (let i = 0; i < 260; i++) {
    const a = rnd() * TAU, r = Math.sqrt(rnd()) * 104;
    const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r * 0.85;
    const hue = 70 + rnd() * 30, sat = 36 + rnd() * 22, lit = 26 + rnd() * 20;
    g.fillStyle = `hsl(${hue},${sat}%,${lit}%)`;
    g.save(); g.translate(x, y); g.rotate(rnd() * TAU);
    g.beginPath(); g.ellipse(0, 0, 11 + rnd() * 5, 5 + rnd() * 3, 0, 0, TAU); g.fill(); g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// ---- 形状づくりの小道具 ----
class Mesher {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.uv = []; this.idx = []; }
  vert(p, n, c, uv = [0, 0]) { this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.col.push(c[0], c[1], c[2]); this.uv.push(uv[0], uv[1]); return this.pos.length / 3 - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

function addTrunk(m, { H, r0, r1, sides = 7, rings = 12, lean = 0, rnd, color = [0.05, 0.04, 0.032], flare = 0.22, canopyDark = 0 }) {
  const first = m.pos.length / 3;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, y = t * H;
    const r = (r0 + (r1 - r0) * Math.pow(t, 0.8)) + flare * Math.exp(-t * 26);
    const cx = Math.sin(t * 2.2 + lean) * lean * 0.35 * t, cz = Math.cos(t * 1.7) * lean * 0.2 * t;
    for (let k = 0; k <= sides; k++) {
      const a = k / sides * TAU, nx = Math.cos(a), nz = Math.sin(a);
      const shade = (0.75 + rnd() * 0.3 + (k % 2) * 0.08) * (1 - canopyDark * Math.min(1, Math.max(0, (t - 0.12) / 0.15)));   // 樹冠の中の幹は暗く（葉の隙間から茶色の線が透けた）
      m.vert([cx + nx * r, y, cz + nz * r], [nx, 0.1, nz], [color[0] * shade, color[1] * shade, color[2] * shade], [k / sides, t * 4]);
    }
  }
  for (let i = 0; i < rings; i++) for (let k = 0; k < sides; k++) {
    const a = first + i * (sides + 1) + k;
    m.quad(a, a + 1, a + sides + 2, a + sides + 1);
  }
}

// 枝葉の板：根元 base から方向 dir へ length、幅 width。drop で先が垂れる。segs 分割。
function addFrond(m, { base, dir, length, width, drop, segs, up = [0, 1, 0], center, tint, rnd, roll = 0 }) {
  const side = norm([dir[1] * up[2] - dir[2] * up[1], dir[2] * up[0] - dir[0] * up[2], dir[0] * up[1] - dir[1] * up[0]]);
  const upv = norm([side[1] * dir[2] - side[2] * dir[1], side[2] * dir[0] - side[0] * dir[2], side[0] * dir[1] - side[1] * dir[0]]);
  for (const rot of [roll, roll + Math.PI / 2]) {
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const w = [side[0] * cs + upv[0] * sn, side[1] * cs + upv[1] * sn, side[2] * cs + upv[2] * sn];
    const first = m.pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs, wid = width * (0.35 + 0.65 * Math.sin(Math.min(1, t * 1.25 + 0.15) * Math.PI * 0.5)) * (1 - t * 0.35);
      const p = [base[0] + dir[0] * length * t, base[1] + dir[1] * length * t - drop * length * t * t, base[2] + dir[2] * length * t];
      const lum = Math.min(1.05, (0.6 + 0.5 * t) * tint);
      for (const sd of [-1, 1]) {
        const q = [p[0] + w[0] * wid * sd * 0.5, p[1] + w[1] * wid * sd * 0.5, p[2] + w[2] * wid * sd * 0.5];
        let n = norm([q[0] - center[0], q[1] - center[1] + 0.4, q[2] - center[2]]);   // 横へ向ける：低い太陽でも日の当たる側が明るく、反対側は陰になる
        m.vert(q, n, [0.92 * lum, lum, 0.86 * lum], [sd < 0 ? 0 : 1, t]);
      }
    }
    for (let s = 0; s < segs; s++) { const a = first + s * 2; m.quad(a, a + 1, a + 3, a + 2); }
  }
}

function cedarGeometry(level) {
  const rnd = mulberry32(2211 + level * 17);
  const H = 20, wood = new Mesher(), leaf = new Mesher();
  addTrunk(wood, { H, r0: 0.5, r1: 0.07, sides: level === 0 ? 8 : level === 1 ? 5 : 4, rings: level === 0 ? 12 : 5, lean: 0.4, rnd, canopyDark: 0.6 });
  const W = level === 0 ? 26 : level === 1 ? 20 : 0;
  if (level < 2) {
    for (let i = 0; i < W; i++) {
      const f = i / (W - 1), y = 2.8 + f * (H - 2.8 - 0.3);
      const L = (level === 0 ? 0.8 : 1.3) + (level === 0 ? 2.6 : 3.2) * Math.pow(1 - f, 0.85);   // 下ほど長く、上は短い（細い円錐）
      const n = Math.max(3, Math.round((level === 0 ? 8 : 6) * Math.pow(1 - f, 0.45)));
      const off = i * 2.399 + rnd() * 0.5;                                                            // 黄金角でずらして螺旋に
      for (let b = 0; b < n; b++) {
        const th = off + b / n * TAU + (rnd() - 0.5) * 0.35, droop = 0.10 + 0.16 * (1 - f);
        const dir = norm([Math.cos(th), -droop, Math.sin(th)]);
        addFrond(leaf, { base: [dir[0] * 0.2, y + (rnd() - 0.5) * 0.5, dir[2] * 0.2], dir, length: L, width: L * (0.78 + rnd() * 0.2), drop: 0.28 + 0.2 * (1 - f), segs: level === 0 ? 2 : 1, center: [0, y, 0], tint: 0.8 + rnd() * 0.35 + 0.1 * f, rnd, roll: rnd() * 0.5 });
      }
    }
    // 内側の暗い芯（透けを防ぐ）。絵を使わない幹のメッシュ（頂点色のみ）に入れる。色は葉の針の平均より暗く（明るいと、日の当たる側が緑の縦筋になった）。
    const first = wood.pos.length / 3, sides = 10;
    for (let i = 0; i <= 5; i++) { const t = i / 5, y = 3.0 + t * (H - 3.4), r = 2.1 * Math.pow(1 - t, 0.9) + 0.05;
      for (let k = 0; k <= sides; k++) { const a = k / sides * TAU; wood.vert([Math.cos(a) * r, y, Math.sin(a) * r], [Math.cos(a), 0.45, Math.sin(a)], [0.008, 0.016, 0.009], [0.5, 0.5]); } }
    for (let i = 0; i < 5; i++) for (let k = 0; k < sides; k++) { const a = first + i * (sides + 1) + k; wood.quad(a, a + 1, a + sides + 2, a + sides + 1); }
  } else {
    // 遠景：重ねた円錐（透過なし）
    const layers = 4, sides = 6;
    for (let i = 0; i < layers; i++) {
      const y0 = 2.5 + i * 4.2, y1 = y0 + 8.5 - i * 1.4, r = 3.1 - i * 0.58, first = leaf.pos.length / 3;
      leaf.vert([0, y1, 0], [0, 1, 0], [0.075, 0.13, 0.06], [0.5, 1]);          // 頂は日が当たって明るく、すそは暗い（一様な暗緑の円錐が、一本ずつ切り絵に見えた）
      for (let k = 0; k < sides; k++) { const a = k / sides * TAU; leaf.vert([Math.cos(a) * r, y0, Math.sin(a) * r], [Math.cos(a) * 0.8, 0.5, Math.sin(a) * 0.8], [0.014 + 0.008 * (i % 2), 0.032, 0.02], [0.5, 0]); }
      for (let k = 0; k < sides; k++) leaf.tri(first, first + 1 + k, first + 1 + (k + 1) % sides);
    }
  }
  return { wood: wood.build(), leaf: leaf.build() };
}

function broadleafGeometry(level) {
  const rnd = mulberry32(3301 + level * 29);
  const wood = new Mesher(), leaf = new Mesher();
  const H = 6.2;
  addTrunk(wood, { H, r0: 0.55, r1: 0.22, sides: level === 0 ? 8 : 5, rings: level === 0 ? 8 : 4, lean: 0.8, rnd, color: [0.1, 0.075, 0.055], flare: 0.3 });
  const clusters = level === 0 ? 34 : level === 1 ? 26 : 6;
  for (let i = 0; i < clusters; i++) {
    const a = rnd() * TAU, r = Math.sqrt(rnd()) * 3.4, y = H + 0.6 + rnd() * 3.6 - r * 0.25;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r, size = 2.0 + rnd() * 1.4;
    const tint = 0.75 + rnd() * 0.45;
    for (const rot of [0, Math.PI / 2, Math.PI / 4]) {
      const cs = Math.cos(rot), sn = Math.sin(rot);
      const first = leaf.pos.length / 3;
      const corners = [[-1, -0.8], [1, -0.8], [1, 0.8], [-1, 0.8]];
      corners.forEach(([u, v], k) => {
        const p = [cx + cs * u * size * 0.5, y + v * size * 0.45, cz + sn * u * size * 0.5];
        const n = norm([p[0], p[1] - (H + 1.8) + 1.4, p[2]]);
        leaf.vert(p, n, [0.2 * tint, 0.27 * tint, 0.1 * tint], [k === 1 || k === 2 ? 1 : 0, k > 1 ? 1 : 0]);
      });
      leaf.quad(first, first + 1, first + 2, first + 3);
    }
  }
  if (level > 1) {
    // 内側の塊（幹のメッシュ＝頂点色のみ）。中景では葉の房を増やして透けを防ぐ（芯は秋の色が掛からず、暗い八角の板に見えた）
    const first = wood.pos.length / 3, sides = 8;
    for (let i = 0; i <= 3; i++) { const t = i / 3, y = H + 0.2 + t * 4.6, r = 2.9 * Math.sin(Math.min(1, t * 1.15 + 0.15) * Math.PI * 0.85);
      for (let k = 0; k <= sides; k++) { const a = k / sides * TAU; wood.vert([Math.cos(a) * r, y, Math.sin(a) * r], [Math.cos(a), 0.3, Math.sin(a)], [0.09, 0.14, 0.04], [0.5, 0.5]); } }
    for (let i = 0; i < 3; i++) for (let k = 0; k < sides; k++) { const a = first + i * (sides + 1) + k; wood.quad(a, a + 1, a + sides + 2, a + sides + 1); }
  }
  return { wood: wood.build(), leaf: leaf.build() };
}

function pineGeometry(level) {
  const rnd = mulberry32(5501 + level * 31);
  const wood = new Mesher(), leaf = new Mesher();
  const H = 13;
  addTrunk(wood, { H, r0: 0.4, r1: 0.14, sides: level === 0 ? 7 : 5, rings: level === 0 ? 10 : 4, lean: 1.6, rnd, color: [0.12, 0.06, 0.035], flare: 0.2 });
  const layers = level === 0 ? 5 : 3;
  for (let i = 0; i < layers; i++) {
    const y = H - 1.2 - i * 2.1, reach = 3.2 - i * 0.35;
    const n = level === 0 ? 6 : 4;
    for (let b = 0; b < n; b++) {
      const th = b / n * TAU + i * 0.7 + rnd() * 0.4, dir = norm([Math.cos(th), 0.1, Math.sin(th)]);
      addFrond(leaf, { base: [0, y, 0], dir, length: reach, width: 2.0, drop: 0.2, segs: 2, center: [0, y - 1, 0], tint: 0.9 + rnd() * 0.3, rnd, roll: 0.5 });
    }
  }
  return { wood: wood.build(), leaf: leaf.build() };
}

function grassGeometry() {
  // 低く細い葉をたくさん。根もとは暗く、先は明るい（風で先ほど大きく揺れる）。
  const rnd = mulberry32(8101);
  const m = new Mesher();
  const blades = 11;
  for (let b = 0; b < blades; b++) {
    const th = rnd() * TAU, lean = 0.25 + rnd() * 0.5, h = 0.13 + rnd() * 0.17, w = 0.011 + rnd() * 0.008;
    const r = 0.035 + rnd() * 0.05;
    const cx = Math.cos(th) * r, cz = Math.sin(th) * r;
    const dir = [Math.cos(th + 1.2 + (rnd() - 0.5) * 0.8), Math.sin(th + 1.2 + (rnd() - 0.5) * 0.8)];
    const first = m.pos.length / 3, segs = 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs, bend = lean * t * t * h, ww = w * (1 - t * 0.92);
      const y = t * h, px = cx + dir[0] * bend, pz = cz + dir[1] * bend;
      const sx = -Math.sin(th), sz = Math.cos(th);
      const shade = 0.5 + 0.55 * t;
      for (const sd of [-1, 1]) m.vert([px + sx * ww * sd, y, pz + sz * ww * sd], [0, 1, 0.2], [shade, shade, shade], [sd < 0 ? 0 : 1, t]);
    }
    for (let s = 0; s < segs; s++) { const a = first + s * 2; m.quad(a, a + 1, a + 3, a + 2); }
  }
  return m.build();
}

function cropGeometry() {
  // 野菜の株：根もとから広がる幅広の葉を輪にする（畝に並べる）。内側は暗く、先は明るい緑。
  const rnd = mulberry32(9301), m = new Mesher();
  for (let i = 0; i < 7; i++) {
    const th = i / 7 * TAU + rnd() * 0.5, len = 0.26 + rnd() * 0.1, wid = 0.17 + rnd() * 0.05, rise = 0.14 + rnd() * 0.12;
    const dir = [Math.cos(th), Math.sin(th)], sx = -dir[1], sz = dir[0], first = m.pos.length / 3, segs = 2;
    for (let k = 0; k <= segs; k++) {
      const t = k / segs, ww = wid * Math.sin(Math.min(1, t * 1.5 + 0.15) * Math.PI * 0.62) * (1 - t * 0.3);
      const px = dir[0] * (0.03 + len * t), pz = dir[1] * (0.03 + len * t), y = 0.03 + rise * Math.sin(t * Math.PI * 0.55) - 0.05 * t * t, shade = 0.55 + 0.6 * t;
      for (const sd of [-1, 1]) m.vert([px + sx * ww * sd, y, pz + sz * ww * sd], [0, 1, 0.2], [0.48 * shade, 0.64 * shade, 0.42 * shade], [sd < 0 ? 0 : 1, t]);
    }
    for (let k = 0; k < segs; k++) { const a = first + k * 2; m.quad(a, a + 1, a + 3, a + 2); }
  }
  return m.build();
}

function riceGeometry() {
  const rnd = mulberry32(9201);
  const m = new Mesher();
  for (let b = 0; b < 7; b++) {
    const th = rnd() * TAU, h = 0.75 + rnd() * 0.25, bend = 0.22 + rnd() * 0.25, w = 0.032;
    const dir = [Math.cos(th), Math.sin(th)], sx = -dir[1], sz = dir[0];
    const first = m.pos.length / 3, segs = 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs, ww = w * (1 - t * 0.6);
      const px = dir[0] * bend * t * t * h, pz = dir[1] * bend * t * t * h, y = t * h * (1 - 0.18 * t);
      const col = t > 0.62 ? [0.84, 0.64, 0.27] : [0.5, 0.5, 0.22];     // 実る穂は黄土色、茎はまだ緑が残る
      for (const sd of [-1, 1]) m.vert([px + sx * ww * sd, y, pz + sz * ww * sd], [0, 1, 0.1], [col[0] * (0.7 + 0.5 * t), col[1] * (0.7 + 0.5 * t), col[2] * (0.6 + 0.5 * t)], [sd < 0 ? 0 : 1, t]);
    }
    for (let s = 0; s < segs; s++) { const a = first + s * 2; m.quad(a, a + 1, a + 3, a + 2); }
  }
  return m.build();
}

// 風：時間・向き・揺れの強さを uniforms で受ける。高さの2乗で揺れ、葉は細かくはためく。
export function windUniforms() { return { uTime: { value: 0 }, uWind: { value: 1 } }; }
function patchWind(material, uniforms, { height = 20, flutter = 0, fadeStart = 0, fadeEnd = 0 }) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      uniform float uTime; uniform float uWind;`).replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 iPos = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      #else
        vec3 iPos = vec3(0.0);
      #endif
      float ph = iPos.x * 0.37 + iPos.z * 0.21;
      float hf = clamp(transformed.y / ${height.toFixed(2)}, 0.0, 1.0);
      float sway = (sin(uTime * 1.15 + ph) + 0.5 * sin(uTime * 2.4 + ph * 1.7)) * 0.045 * hf * hf * uWind;
      transformed.x += sway * ${height.toFixed(2)} * 0.5; transformed.z += sway * ${height.toFixed(2)} * 0.28;
      transformed += vec3(sin(uTime * 3.6 + position.y * 1.9 + ph), 0.0, cos(uTime * 3.1 + position.x * 1.7 + ph)) * ${flutter.toFixed(3)} * hf * uWind;
      ${fadeEnd > 0 ? `{ float dd = distance(iPos, cameraPosition); transformed *= 1.0 - smoothstep(${fadeStart.toFixed(1)}, ${fadeEnd.toFixed(1)}, dd); }` : ''}`);
  };
  material.customProgramCacheKey = () => 'wind-' + height + '-' + flutter + '-' + fadeEnd;
}

// 葉・幹・草は艶消しの Lambert にする。標準の材質（PBR）だと、低い太陽に向かって見る遠景の木が、
// 掠める角度のフレネル反射（日なたの面ほど強い）で琥珀色に光り、暗い樹冠が明るい「型押しの壁紙」に見えた（第2周の評価・材質を黒にしても残った）。
function foliageMaterial(map, uniforms, { height, flutter = 0.03, alphaTest = 0.42 }) {
  const m = new THREE.MeshLambertMaterial({ map, vertexColors: true, side: THREE.DoubleSide, alphaTest, alphaToCoverage: true, emissive: 0x2a3826 });   // emissive：Lambert は環境光の拡散を受けないので、日陰の葉が真っ黒にならない下駄
  patchWind(m, uniforms, { height, flutter });
  return m;
}
function solidMaterial(uniforms, { height, color = 0xffffff }) {
  const m = new THREE.MeshLambertMaterial({ color, vertexColors: true, emissive: 0x1b2217 });
  patchWind(m, uniforms, { height, flutter: 0 });
  return m;
}

// 木の群れ：種類ごとに近・中・遠の InstancedMesh を持ち、カメラの位置で振り分ける。
export class TreeField {
  constructor({ data, wind, quality = 'standard', lod = [80, 220] }) {
    this.data = data; this.baseLod = lod; this.lod = quality === 'light' ? [lod[0] * 0.6, lod[1] * 0.7] : lod; this.light = quality === 'light'; this.group = new THREE.Group(); this.group.name = 'trees';
    const needle = needleTexture(), leaf = leafTexture();
    const kinds = [
      { geo: [cedarGeometry(0), cedarGeometry(1), cedarGeometry(2)], tex: needle, h: 20, alpha: 0.42 },
      { geo: [broadleafGeometry(0), broadleafGeometry(1), broadleafGeometry(1)], tex: leaf, h: 12, alpha: 0.4 },
      { geo: [pineGeometry(0), pineGeometry(1), cedarGeometry(2)], tex: needle, h: 13, alpha: 0.42 },
    ];
    this.sets = [];
    const counts = [0, 0, 0];
    for (const k of data.kind) counts[k]++;
    kinds.forEach((kd, kind) => {
      for (let level = 0; level < 3; level++) {
        const cap = counts[kind];
        if (!cap) { this.sets.push(null); continue; }
        const g = kd.geo[level];
        const leafMat = level === 2 && kind !== 1 ? solidMaterial(wind, { height: kd.h }) : foliageMaterial(kd.tex, wind, { height: kd.h, alphaTest: kd.alpha, flutter: kind === 1 ? 0.05 : 0.03 });
        const woodMat = solidMaterial(wind, { height: kd.h, color: 0xffffff });
        const leafMesh = new THREE.InstancedMesh(g.leaf, leafMat, cap), woodMesh = level < 2 ? new THREE.InstancedMesh(g.wood, woodMat, cap) : null;
        for (const mesh of [leafMesh, woodMesh]) if (mesh) { mesh.frustumCulled = false; mesh.castShadow = level === 0; mesh.receiveShadow = level < 2; mesh.count = 0; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(mesh); }
        leafMesh.name = `tree-${kind}-${level}-leaf`;
        this.sets.push({ leaf: leafMesh, wood: woodMesh, kind, level });
      }
    });
    this.last = new THREE.Vector2(1e9, 1e9);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.p = new THREE.Vector3(); this.up = new THREE.Vector3(0, 1, 0);
    this.color = new THREE.Color();
    this.stats = { near: 0, mid: 0, far: 0 };
  }

  update(camera, force = false) {
    const cx = camera.position.x, cz = camera.position.z;
    if (!force && Math.hypot(cx - this.last.x, cz - this.last.y) < 5) return;
    this.last.set(cx, cz);
    const d = this.data, n = d.x.length, [n0, n1] = this.lod, a2 = n0 * n0, b2 = n1 * n1;
    for (const set of this.sets) if (set) { set.leaf.count = 0; if (set.wood) set.wood.count = 0; }
    this.stats = { near: 0, mid: 0, far: 0 };
    for (let i = 0; i < n; i++) {
      const dx = d.x[i] - cx, dz = d.z[i] - cz, dd = dx * dx + dz * dz;
      const level = dd < a2 ? 0 : dd < b2 ? 1 : 2;
      if (this.light && level === 2 && (i & 1)) continue;                 // 軽量は、遠くの木を半分にする
      const set = this.sets[d.kind[i] * 3 + level];
      if (!set) continue;
      const k = set.leaf.count;
      this.q.setFromAxisAngle(this.up, d.rot[i]);
      const tv = d.tint[i], f1 = (tv * 7.31) % 1, f2 = (tv * 3.17) % 1, f3 = (tv * 11.9) % 1;
      // 遠景は幅・高さ・色をばらつかせる（同じ形の型押しに見えない）。幅広に重ねて地面をのぞかせない
      if (level === 2) this.s.set(d.s[i] * (1.2 + 0.8 * f1), d.s[i] * (0.9 + 0.55 * f2), d.s[i] * (1.2 + 0.8 * f1)); else this.s.setScalar(d.s[i]);
      this.p.set(d.x[i], d.y[i] - 0.15, d.z[i]);
      this.m.compose(this.p, this.q, this.s);
      set.leaf.setMatrixAt(k, this.m);
      if (set.wood) set.wood.setMatrixAt(k, this.m);
      if (set.kind === 1) {
        // 秋の広葉樹：緑・黄・橙・赤茶がまだらに（実る稲と同じ季節。夕日の下で色の差し色になる）
        const t = d.tint[i], pick = (t * 9301 + d.x[i] * 0.37) % 1;
        if (pick < 0.30) this.color.setRGB(1.55, 0.62, 0.22);          // 紅葉（橙〜赤）
        else if (pick < 0.52) this.color.setRGB(1.35, 1.12, 0.3);      // 黄葉
        else this.color.setRGB(0.85 + t * 0.4, 0.8 + t * 0.15, 0.5 + t * 0.25);
        set.leaf.setColorAt(k, this.color);
      }
      else if (level === 2) { const v = 0.55 + 0.9 * f3; this.color.setRGB(v * (0.9 + 0.2 * f1), v, v * (0.8 + 0.4 * f2)); set.leaf.setColorAt(k, this.color); }
      else { const v = 0.85 + d.tint[i] * 0.3; this.color.setRGB(v, v * 1.02, v * 0.95); set.leaf.setColorAt(k, this.color); }
      set.leaf.count = k + 1; if (set.wood) set.wood.count = k + 1;
      this.stats[level === 0 ? 'near' : level === 1 ? 'mid' : 'far']++;
    }
    for (const set of this.sets) if (set) {
      set.leaf.instanceMatrix.needsUpdate = true; if (set.leaf.instanceColor) set.leaf.instanceColor.needsUpdate = true;
      if (set.wood) set.wood.instanceMatrix.needsUpdate = true;
    }
  }
}

// 草・稲：近くだけ見える（距離で縮めて消す）。空間の区画ごとに InstancedMesh を分け、視錐台と距離で区画ごと描かない。
export function makeTufts({ data, geometry, wind, height, fadeStart, fadeEnd, tintA, tintB, flutter = 0, chunk = 24 }) {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, alphaToCoverage: false, emissive: 0x24351c });
  patchWind(material, wind, { height, flutter: flutter + 0.01, fadeStart, fadeEnd });
  const n = data.x.length, buckets = new Map();
  for (let i = 0; i < n; i++) {
    const key = Math.floor(data.x[i] / chunk) + ',' + Math.floor(data.z[i] / chunk);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color(), a = new THREE.Color(tintA), b = new THREE.Color(tintB);
  const group = new THREE.Group(), chunks = [];
  for (const idx of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geometry, material, idx.length);
    idx.forEach((i, k) => {
      q.setFromAxisAngle(up, data.rot[i]); s.setScalar(data.s[i]); p.set(data.x[i], data.y[i] - 0.02, data.z[i]);
      m.compose(p, q, s); mesh.setMatrixAt(k, m);
      c.copy(a).lerp(b, data.tint[i]); mesh.setColorAt(k, c);
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = true;
    mesh.computeBoundingSphere();
    chunks.push({ mesh, x: mesh.boundingSphere.center.x, z: mesh.boundingSphere.center.z, r: mesh.boundingSphere.radius });
    group.add(mesh);
  }
  // カメラから fadeEnd より遠い区画は、縮んで見えないので描かない
  group.update = camera => { const cx = camera.position.x, cz = camera.position.z; for (const k of chunks) k.mesh.visible = Math.hypot(k.x - cx, k.z - cz) - k.r < fadeEnd; };
  group.userData.instances = n;
  return group;
}

export function buildVegetation({ scatter, quality = 'standard' }) {
  const wind = windUniforms();
  const group = new THREE.Group(); group.name = 'vegetation';
  const trees = new TreeField({ data: scatter.trees, wind, quality });
  group.add(trees.group);
  const grass = makeTufts({ data: scatter.grass, geometry: grassGeometry(), wind, height: 0.3, fadeStart: quality === 'light' ? 16 : 28, fadeEnd: quality === 'light' ? 26 : 46, tintA: '#4a6a2a', tintB: '#8c8c45' });
  const rice = makeTufts({ data: scatter.rice, geometry: riceGeometry(), wind, height: 1.0, fadeStart: 60, fadeEnd: 95, tintA: '#b8963c', tintB: '#d6b658', flutter: 0.02 });
  group.add(grass, rice);
  const crops = scatter.crops?.x.length ? makeTufts({ data: scatter.crops, geometry: cropGeometry(), wind, height: 0.4, fadeStart: 55, fadeEnd: 90, tintA: '#3d5230', tintB: '#617548', flutter: 0.01 }) : null;   // 家のそばの野菜畑
  if (crops) group.add(crops);
  return { group, trees, grass, rice, crops, wind };
}
