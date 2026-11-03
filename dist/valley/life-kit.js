// life-kit.js — 暮らしの小物の型（S7-A・view層）。形も絵も、ここに書いた手順だけで作る（外部の素材も読み込みも無い）。
// 出所と時代の裏取りは provenance/life-kit-s7a.json。置き方と出し入れは life-view.js、置く表は world-data.js の life。
// 型は「1つの Mesh だけを持つ Group」にして、batch.js の batchParts で型ごとに1回で描けるようにする。
// 質感は 1024px 四方の1枚の絵を16区画に分けて全部の型で共有する（藁・木・縄・鉄・灰・米・石…）。濃淡は頂点の色で足す。
// 小物は影を落とさない（足もとの暗い円は地面の跡の 'blob'）。本物の明かりは足さない（燠は光る材質だけ）。
// 時代の裏取り（research-valley-life-period.md）に合わせた形：曲物の桶（結桶にしない）・鉄の鍋（内耳の土鍋にしない）・足半・柴の束（背負子の枠は出さない）。
import * as THREE from 'three';
import { mulberry32 } from './scatter.js';
import { makeYumi, makeQuiver } from './weapons.js';

export const CELLS = ['straw', 'strawEnd', 'mat', 'rope', 'wood', 'hinoki', 'iron', 'ash', 'rice', 'stone', 'basket', 'plain', 'veg', 'lacquer', 'susuki', 'itabi'];
export const MARKS = ['rut', 'trample', 'steps', 'rice', 'blob', 'path', 'crush', 'ash'];
const PAD = 0.012;
// 区画の UV の範囲（CanvasTexture は上下を返すので、絵の上の段ほど v が大きい）。cols×rows の格子。
const rectOf = (list, name, cols, rows) => {
  const i = list.indexOf(name); if (i < 0) throw Error('unknown cell ' + name);
  const c = i % cols, r = Math.floor(i / cols), pu = PAD, pv = PAD * cols / rows;
  return { u0: c / cols + pu, u1: (c + 1) / cols - pu, v0: 1 - (r + 1) / rows + pv, v1: 1 - r / rows - pv };
};
export const cellRect = name => rectOf(CELLS, name, 4, 4);
export const markRect = name => rectOf(MARKS, name, 4, 2);

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const V2 = (x, y) => new THREE.Vector2(x, y), V3 = (x, y, z) => new THREE.Vector3(x, y, z);
export const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V3(sx, sy, sz));

// 部品を集めて1つの形にする。add(形, { cell: 絵の区画（null なら UV そのまま）, color: 色, shade: (x,y,z)=>濃さ, at: 行列, uv: (u,v,x,y,z)=>[u,v] })
class Parts {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; }
  add(g, { cell = 'plain', color = '#ffffff', shade = null, at = null, uv = null } = {}) {
    if (at) g.applyMatrix4(at);
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv, r = cell ? cellRect(cell) : null, base = this.pos.length / 3;
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      this.pos.push(x, y, z); this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      let u = t ? t.getX(i) : 0, v = t ? t.getY(i) : 0;
      if (uv) [u, v] = uv(u, v, x, y, z);
      u = Math.min(1, Math.max(0, u)); v = Math.min(1, Math.max(0, v));
      this.uv.push(r ? r.u0 + (r.u1 - r.u0) * u : u, r ? r.v0 + (r.v1 - r.v0) * v : v);
      const k = shade ? shade(x, y, z) : 1; this.col.push(c.r * k, c.g * k, c.b * k);
    }
    if (g.index) for (const i of g.index.array) this.idx.push(base + i); else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    g.dispose(); return this;
  }
  // 薄い板（葉・羽・ススキ）は裏面も足す（向きを返した三角形と、逆向きの法線）
  both(g, opts) { g.computeVertexNormals(); const b = g.clone(), idx = b.index ? Array.from(b.index.array) : [...Array(b.attributes.position.count).keys()];
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    b.setIndex(idx); const nn = b.attributes.normal; for (let i = 0; i < nn.count; i++) nn.setXYZ(i, -nn.getX(i), -nn.getY(i), -nn.getZ(i));
    return this.add(g, opts).add(b, opts); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx); g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}
// LatheGeometry は輪郭をたどる向きの右手側を表にする（上へたどると外向き）。閉じた器は外の底→外の壁→口→内の壁→内の底の順に書く。
const lathe = (pts, segs = 12) => new THREE.LatheGeometry(pts.map(([r, y]) => V2(r, y)), segs);
const tube = (pts, r, segs = 24, radial = 6) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => V3(...p))), segs, r, radial, false);

// ---------------------------------------------------------------- 絵（16区画を手順で描く。種を固定して毎回同じ絵にする）
function paintAtlas(seed = 1333) {
  const size = 1024, cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d'), rnd = mulberry32(seed), pick = a => a[(rnd() * a.length) | 0], S = 256;
  const cell = (name, fn) => { const i = CELLS.indexOf(name); g.save(); g.beginPath(); g.rect((i % 4) * S, Math.floor(i / 4) * S, S, S); g.clip(); g.translate((i % 4) * S, Math.floor(i / 4) * S); fn(); g.restore(); };
  const fill = c => { g.globalAlpha = 1; g.fillStyle = c; g.fillRect(0, 0, S, S); };
  const line = (x0, y0, x1, y1, w, c, a) => { g.globalAlpha = a; g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  const dot = (x, y, rx, ry, c, a, rot = 0) => { g.globalAlpha = a; g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill(); };
  const strawCols = ['#a3946a', '#7f6f48', '#b5a77a', '#6d5f3f', '#958657', '#c0b285'];
  cell('straw', () => { fill('#8a7b52'); for (let i = 0; i < 900; i++) { const x = rnd() * S, y = rnd() * S - 30; line(x, y, x + (rnd() - 0.5) * 6, y + 30 + rnd() * 80, 1 + rnd() * 2.2, pick(strawCols), 0.55); } });
  cell('strawEnd', () => { fill('#7c6d47'); for (let i = 0; i < 520; i++) { const a = rnd() * Math.PI * 2, r0 = rnd() * 30; line(128 + Math.cos(a) * r0, 128 + Math.sin(a) * r0, 128 + Math.cos(a) * 130, 128 + Math.sin(a) * 130, 1 + rnd() * 2, pick(strawCols), 0.6); } dot(128, 128, 16, 16, '#4f4430', 0.8); });
  cell('mat', () => { fill('#8d7e55'); for (let y = 0; y < S; y += 3) line(0, y + rnd(), S, y + rnd() * 2, 2.2, pick(strawCols), 0.5); for (let x = 8; x < S; x += 18) line(x, 0, x + rnd() * 2, S, 2, '#54472f', 0.55); });
  cell('rope', () => { fill('#857449'); for (let k = -S; k < S * 2; k += 14) { line(k, 0, k - S, S, 7, '#a2915f', 0.75); line(k + 7, 0, k + 7 - S, S, 2, '#4f4430', 0.6); } for (let i = 0; i < 300; i++) { const x = rnd() * S, y = rnd() * S; line(x, y, x - 8, y + 8, 1, pick(strawCols), 0.4); } });
  cell('wood', () => { fill('#6c604f'); for (let i = 0; i < 170; i++) { const x = rnd() * S, w = (rnd() - 0.5) * 8; line(x, 0, x + w, S, 0.8 + rnd() * 1.6, pick(['#5a4f42', '#82755f', '#4c4339', '#766a57']), 0.6); } for (const x of [64, 128, 192]) line(x, 0, x, S, 2, '#3a332b', 0.7); for (let i = 0; i < 5; i++) dot(rnd() * S, rnd() * S, 3 + rnd() * 4, 7 + rnd() * 8, '#3e352b', 0.6); });
  cell('hinoki', () => { fill('#9a7c56'); for (let i = 0; i < 240; i++) { const x = rnd() * S; line(x, 0, x + (rnd() - 0.5) * 3, S, 0.6 + rnd(), pick(['#8a6b46', '#ae8f66', '#7a5d3d', '#b89a70']), 0.55); } });
  cell('iron', () => { fill('#2a2624'); for (let i = 0; i < 420; i++) dot(rnd() * S, rnd() * S, 1 + rnd() * 5, 1 + rnd() * 4, pick(['#5c3c28', '#3d3532', '#191716', '#4a4440']), 0.35); });
  cell('ash', () => { fill('#7a756d'); for (let i = 0; i < 900; i++) dot(rnd() * S, rnd() * S, 0.6 + rnd() * 2.4, 0.6 + rnd() * 2, pick(['#a6a097', '#3a3532', '#8d877e', '#26211f', '#b8b2a8']), 0.6); });
  cell('rice', () => { fill('#cbc2ab'); for (let i = 0; i < 1700; i++) dot(rnd() * S, rnd() * S, 1.6, 0.9, pick(['#ebe4d2', '#b4aa90', '#f4eedf', '#d9d0b9']), 0.85, rnd() * 3); });
  cell('stone', () => { fill('#5c6255'); for (let i = 0; i < 90; i++) { const y = rnd() * S; line(0, y, S, y + (rnd() - 0.5) * 18, 1 + rnd() * 5, pick(['#6d7365', '#4a4f45', '#666b5d']), 0.45); } for (let i = 0; i < 60; i++) dot(rnd() * S, rnd() * S, 2 + rnd() * 6, 2 + rnd() * 5, pick(['#8a8f6a', '#9a9a80', '#7f845f']), 0.4); });
  cell('basket', () => { fill('#6b5435'); for (let k = -S; k < S * 2; k += 11) { line(k, 0, k + S, S, 4, '#8a6c44', 0.8); line(k, 0, k - S, S, 2.5, '#4d3a24', 0.7); } });
  cell('plain', () => { fill('#d2cdc2'); for (let i = 0; i < 400; i++) dot(rnd() * S, rnd() * S, 1 + rnd() * 3, 1 + rnd() * 3, pick(['#c2bcb0', '#dcd8ce']), 0.4); });
  cell('veg', () => { fill('#d3cdb9'); for (let y = 0; y < S; y += 9) line(0, y + rnd() * 3, 128, y + rnd() * 3, 1, '#b5ad97', 0.6);
    g.globalAlpha = 1; g.fillStyle = '#4b6234'; g.fillRect(128, 0, 128, S); for (let i = 0; i < 40; i++) { const x = 136 + rnd() * 112; line(x, 0, x + (rnd() - 0.5) * 10, S, 1.5, pick(['#6b8350', '#5b7343', '#3c512a']), 0.7); } });
  cell('lacquer', () => { fill('#3a1a13'); for (let i = 0; i < 60; i++) { const y = rnd() * S; line(0, y, S, y + (rnd() - 0.5) * 20, 2 + rnd() * 6, pick(['#5a2c1e', '#24100c', '#6a3826']), 0.25); } });
  cell('susuki', () => { fill('#b3a676'); for (let i = 0; i < 400; i++) { const x = rnd() * S, y = rnd() * S; line(x, y, x + (rnd() - 0.5) * 4, y + 20 + rnd() * 40, 1, pick(['#d7caa0', '#9a8d5d', '#c6b989']), 0.5); } });
  // 板碑の面（板の 0.3m×1.15m に引き伸ばして貼るので、円は横長に描く）。紋や文字は架空の印（実在の種子は写さない）。
  cell('itabi', () => { fill('#4c5348'); for (let i = 0; i < 70; i++) { const y = rnd() * S; line(0, y, S, y + (rnd() - 0.5) * 6, 1 + rnd() * 3, pick(['#6b7266', '#535a4f']), 0.4); }
    line(22, 70, 234, 70, 6, '#2f332c', 0.85); line(22, 84, 234, 84, 6, '#2f332c', 0.85); line(22, 74, 234, 74, 2, '#7d8475', 0.6); line(22, 88, 234, 88, 2, '#7d8475', 0.6);
    g.globalAlpha = 0.85; g.strokeStyle = '#2f332c'; g.lineWidth = 5; g.beginPath(); g.ellipse(128, 120, 64, 15, 0, 0, Math.PI * 2); g.stroke(); line(128, 140, 128, 230, 7, '#2f332c', 0.75);
    line(22, 96, 22, 250, 3, '#3a3f36', 0.5); line(234, 96, 234, 250, 3, '#3a3f36', 0.5); for (let i = 0; i < 40; i++) dot(rnd() * S, rnd() * S, 2 + rnd() * 5, 1 + rnd() * 3, '#8f946f', 0.35); });
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

// 地面の跡の絵（4×2区画・1024×512・背景は透明）。帯の絵（轍・足跡・米・踏み跡）は上下がつながるように描く。
function paintMarks(seed = 2024) {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512;
  const g = cv.getContext('2d'), rnd = mulberry32(seed), S = 256, pick = a => a[(rnd() * a.length) | 0];
  const cell = (name, fn) => { const i = MARKS.indexOf(name); g.save(); g.beginPath(); g.rect((i % 4) * S, Math.floor(i / 4) * S, S, S); g.clip(); g.translate((i % 4) * S, Math.floor(i / 4) * S); fn(); g.restore(); };
  const dot = (x, y, rx, ry, c, a, rot = 0) => { for (const oy of [-S, 0, S]) { g.globalAlpha = a; g.fillStyle = c; g.beginPath(); g.ellipse(x, y + oy, rx, ry, rot, 0, Math.PI * 2); g.fill(); } };
  const soft = (x, y, r, c, a) => { for (let k = 8; k >= 1; k--) dot(x, y, r * k / 8, r * k / 8, c, a / 8); };
  cell('rut', () => { for (const x of [28, 228]) { for (let k = 0; k < 6; k++) { g.globalAlpha = 0.07; g.fillStyle = '#4a3826'; g.fillRect(x - 4 - k * 2.5, 0, 8 + k * 5, S); }
    g.globalAlpha = 0.18; g.fillStyle = '#9a8466'; g.fillRect(x + 13, 0, 3, S); g.fillRect(x - 16, 0, 3, S);
    for (let i = 0; i < 40; i++) dot(x + (rnd() - 0.5) * 14, rnd() * S, 2 + rnd() * 4, 3 + rnd() * 8, '#3a2c1e', 0.12); } });
  cell('trample', () => { for (let i = 0; i < 26; i++) { const a = rnd() * Math.PI * 2, r = rnd() * 60; soft(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 22 + rnd() * 34, '#3b2e20', 0.5); } for (let i = 0; i < 70; i++) { const a = rnd() * Math.PI * 2, r = rnd() * 95; dot(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 4, 9, '#2b2117', 0.35, rnd() * 3); } });
  cell('steps', () => { for (let y = 8; y < S; y += 34) { dot(98 + (rnd() - 0.5) * 20, y, 9, 17, '#2d2218', 0.55, (rnd() - 0.5) * 0.4); dot(158 + (rnd() - 0.5) * 20, y + 17, 9, 17, '#2d2218', 0.55, (rnd() - 0.5) * 0.4); } });
  cell('rice', () => { for (let i = 0; i < 900; i++) { const x = 128 + (rnd() + rnd() + rnd() - 1.5) * 90; dot(x, rnd() * S, 2.2, 1.2, pick(['#efe8d6', '#d8cfb8', '#fbf6ea']), 0.95, rnd() * 3); } });
  cell('blob', () => { for (let k = 24; k >= 1; k--) { g.globalAlpha = 0.05; g.fillStyle = '#100c08'; g.beginPath(); g.arc(128, 128, 122 * k / 24, 0, Math.PI * 2); g.fill(); } });
  cell('path', () => { g.globalAlpha = 0.3; g.fillStyle = '#4a3a28'; g.fillRect(70, 0, 116, S); g.globalAlpha = 0.25; g.fillRect(96, 0, 64, S); for (let i = 0; i < 50; i++) dot(128 + (rnd() - 0.5) * 80, rnd() * S, 3 + rnd() * 5, 5 + rnd() * 8, '#3a2d1f', 0.25); });
  cell('crush', () => { for (let i = 0; i < 120; i++) dot(30 + rnd() * 196, 30 + rnd() * 196, 2 + rnd() * 7, 1 + rnd() * 3, pick(['#4f6635', '#6b7f45', '#e0d8c2', '#3c4e28']), 0.8, rnd() * 3); for (let i = 0; i < 10; i++) soft(40 + rnd() * 176, 40 + rnd() * 176, 30, '#33281b', 0.35); });
  cell('ash', () => { for (let i = 0; i < 14; i++) soft(128 + (rnd() - 0.5) * 60, 128 + (rnd() - 0.5) * 60, 50 + rnd() * 40, '#1b1714', 0.45); for (let i = 0; i < 160; i++) dot(60 + rnd() * 136, 60 + rnd() * 136, 1 + rnd() * 3, 1 + rnd() * 2, pick(['#8c867c', '#2a2420', '#aaa499']), 0.7); });
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

// 燠の絵：黒い炭に、橙に光る割れ目。map と emissiveMap に同じ絵を使う。
function paintEmbers(seed = 77) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d'), rnd = mulberry32(seed);
  g.fillStyle = '#151210'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 26; i++) { g.globalAlpha = 0.9; g.strokeStyle = rnd() < 0.5 ? '#ff7a26' : '#ffb04a'; g.lineWidth = 1 + rnd() * 2.5; g.beginPath(); let x = rnd() * 128, y = rnd() * 128; g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (rnd() - 0.5) * 26; y += (rnd() - 0.5) * 26; g.lineTo(x, y); } g.stroke(); }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------- 型（原点は足もとの中心。単位m。+Z が正面）
const ropeBand = (x, centers, w = 0.028) => centers.reduce((a, d) => a + Math.exp(-(((x - d) / w) ** 2)), 0);
// 俵：長さ0.76m・径0.43m。3本の縄で締め、両端に桟俵（丸い藁の蓋）。寝かせて置く（軸は X）。破れた俵は潰れて、脇に米がこぼれる。
function bale(torn) {
  const P = new Parts(), L = 0.36, R = 0.205, body = [], dips = [-0.24, 0, 0.24];
  for (let i = 0; i <= 18; i++) { const y = -L + 2 * L * i / 18; let r = R + 0.02 * (1 - (y / L) ** 2); for (const d of dips) r -= 0.017 * Math.exp(-(((y - d) / 0.022) ** 2)); body.push([r, y]); }
  const squash = torn ? 0.74 : 0.9, lay = M(0, R * squash, 0, 0, 0, 0, 1, squash, 1).multiply(M(0, 0, 0, 0, 0, Math.PI / 2));
  const ao = (x, y) => 0.62 + 0.38 * smooth(0.02, 0.3, y);
  P.add(lathe(body, 14), { cell: 'straw', color: torn ? '#e6dcc4' : '#f4ecd8', at: lay, shade: (x, y, z) => ao(x, y) * (1 - 0.42 * ropeBand(x, dips)) * (torn && y > 0.24 && Math.abs(x) < 0.16 ? 0.45 : 1) });
  for (const s of [-1, 1]) P.add(new THREE.CircleGeometry(R * 1.02, 12), { cell: 'strawEnd', color: '#f0e6cf', at: lay.clone().multiply(M(0, s * (L + 0.004), 0, -s * Math.PI / 2)), shade: (x, y) => ao(x, y) });
  if (torn) P.add(new THREE.SphereGeometry(0.11, 9, 5), { cell: 'rice', color: '#bdb39d', at: M(0.1, 0.0, 0.2, 0.3, 0.6, 0.2, 1.3, 0.28, 0.9), shade: (x, y) => 0.6 + 0.4 * smooth(0, 0.05, y) });
  return P.build();
}
const rice = () => new Parts().add(lathe([[0.3, 0], [0.26, 0.01], [0.18, 0.035], [0.09, 0.06], [0.001, 0.07]], 10), { cell: 'rice', color: '#c4baa4', at: M(0, 0, 0, 0, 0, 0, 1.3, 1, 1), shade: (x, y) => 0.7 + 0.3 * y / 0.07 }).build();
// 筵（0.9×1.8m）。少し波打ち、角がめくれる。
function mat() {
  const g = new THREE.PlaneGeometry(0.9, 1.8, 4, 8).rotateX(-Math.PI / 2), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, 0.012 + 0.01 * Math.sin(x * 9 + z * 2) * Math.cos(z * 5) + 0.035 * smooth(0.33, 0.45, Math.abs(x)) * smooth(0.7, 0.9, Math.abs(z))); }
  return new Parts().add(g, { cell: 'mat', color: '#f6eedb', shade: (x, y, z) => 0.62 + 0.38 * (1 - smooth(0.3, 0.45, Math.abs(x))) * (1 - smooth(0.75, 0.9, Math.abs(z))) }).build();
}
// 鉄の鍋（径0.42m）。外に小さな耳と、横へ倒れた鉉（つる）。中は底まで空。
function pot() {
  const P = new Parts();
  // 内側は底をさらった跡の乾いた灰色（外の黒い鉄と分け、空なのが口から読めるように）。外は煤けた鉄。
  // 第3周：内側が明るいと「茶色の円盤（蓋）」に見えたので、内は煤けた暗い穴にし（底だけ少し明るい＝さらった跡）、口の縁を明るい擦れた鉄の輪で縁取る。
  P.add(lathe([[0.2, 0.2], [0.189, 0.185], [0.175, 0.125], [0.14, 0.07], [0.08, 0.035], [0.001, 0.03]], 16), { cell: 'ash', color: '#c9b49a', shade: (x, y) => 0.22 + 0.6 * (1 - smooth(0.04, 0.1, y)) });
  P.add(new THREE.TorusGeometry(0.2, 0.011, 4, 24), { cell: 'iron', color: '#e8e8e8', at: M(0, 0.2, 0, Math.PI / 2, 0, 0) });
  P.add(lathe([[0.001, 0], [0.11, 0.017], [0.173, 0.064], [0.201, 0.13], [0.213, 0.194], [0.2, 0.2]], 16), { cell: 'iron', color: '#ffffff', shade: (x, y) => 0.8 + 0.2 * smooth(0.02, 0.19, y) });
  for (const s of [-1, 1]) P.add(new THREE.BoxGeometry(0.03, 0.035, 0.03), { cell: 'iron', at: M(s * 0.215, 0.188, 0) });
  P.add(tube([[-0.215, 0.19, 0], [-0.15, 0.26, -0.22], [0, 0.29, -0.3], [0.15, 0.26, -0.22], [0.215, 0.19, 0]], 0.0055, 16, 4), { cell: 'iron', color: '#bbbbbb' });
  return P.build();
}
// 柄杓（曲物の小さな器に柄。柄杓そのものの時代は未確認なので、小さく目立たない形）
const ladle = () => new Parts().add(lathe([[0.001, 0.004], [0.04, 0.006], [0.046, 0.02], [0.046, 0.066], [0.04, 0.066], [0.04, 0.012], [0.001, 0.01]], 10), { cell: 'hinoki', color: '#ffffff' })
  .add(new THREE.BoxGeometry(0.34, 0.014, 0.016), { cell: 'wood', color: '#f2ece2', at: M(0.21, 0.058, 0, 0, 0, 0.12) }).build();
// 曲物の桶（薄板を曲げた桶。径0.34m・高さ0.3m）。樺の皮で綴じた帯を2本。
function bucket() {
  const band = y => (Math.abs(y - 0.06) < 0.014 || Math.abs(y - 0.245) < 0.014 ? 0.48 : 1);
  return new Parts().add(lathe([[0.001, 0], [0.167, 0], [0.169, 0.3], [0.16, 0.3], [0.157, 0.022], [0.001, 0.022]], 16),
    { cell: 'hinoki', color: '#ffffff', shade: (x, y, z) => (Math.hypot(x, z) > 0.163 ? band(y) : 0.72) * (0.78 + 0.22 * smooth(0, 0.2, y)) }).build();
}
// 籠（樹皮や竹で編んだ籠。口が広い）
const basket = () => new Parts().add(lathe([[0.001, 0], [0.155, 0], [0.216, 0.12], [0.244, 0.27], [0.235, 0.28], [0.225, 0.27], [0.2, 0.12], [0.14, 0.02], [0.001, 0.02]], 14),
  { cell: 'basket', color: '#ffffff', shade: (x, y, z) => (Math.hypot(x, z) < 0.21 && y > 0.02 ? 0.6 : 0.85 + 0.15 * smooth(0, 0.25, y)) }).build();
// 菜（大根。白い根と葉）。寝かせて置く。
function veg() {
  const P = new Parts(), lay = M(0, 0.036, 0, 0, 0, Math.PI / 2);
  P.add(lathe([[0.001, 0], [0.012, 0.02], [0.028, 0.08], [0.036, 0.18], [0.037, 0.27], [0.03, 0.32], [0.001, 0.335]], 8), { cell: 'veg', at: lay, uv: (u, v) => [u * 0.48, v], color: '#ffffff' });
  for (let k = 0; k < 4; k++) {
    const g = new THREE.PlaneGeometry(0.075, 0.3, 1, 3).translate(0, 0.15, 0), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const t = p.getY(i) / 0.3; p.setZ(i, -0.06 * t * t); }
    P.both(g, { cell: 'veg', color: '#ffffff', uv: (u, v) => [0.52 + u * 0.48, v], at: M(-0.335, 0.04, 0, 0.3 + k * 0.5 - 0.75, 0, Math.PI / 2 + 0.1 * k) });
  }
  return P.build();
}
// 柴の束（細い枝を2か所で縄にくくった束。背負子の枠は出さない＝裏取りが無いため）。寝かせて置く。
function brush() {
  const P = new Parts(), rnd = mulberry32(31);
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.085, len = 0.85 + rnd() * 0.25;
    P.add(new THREE.CylinderGeometry(0.007 + rnd() * 0.006, 0.01 + rnd() * 0.007, len, 4), { cell: 'wood', color: ['#f4ece0', '#d9cfc2', '#ffffff'][i % 3],
      at: M((rnd() - 0.5) * 0.12, 0.1 + Math.sin(a) * r, Math.cos(a) * r, (rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.08, Math.PI / 2 + (rnd() - 0.5) * 0.08) });
  }
  for (const x of [-0.22, 0.2]) P.add(new THREE.TorusGeometry(0.105, 0.013, 4, 10), { cell: 'rope', color: '#fff8e8', at: M(x, 0.1, 0, 0, Math.PI / 2, 0) });
  return P.build();
}
// 足半（かかとの無い短い藁草履。長さ0.16m）。片方だけ落ちている。
const sandal = () => new Parts().add(new THREE.CylinderGeometry(0.048, 0.05, 0.014, 10), { cell: 'mat', color: '#fbf3e0', at: M(0, 0.007, 0, 0, 0, 0, 1.65, 1, 1) })
  .add(new THREE.TorusGeometry(0.028, 0.006, 4, 8, Math.PI), { cell: 'rope', color: '#f0e6cc', at: M(0.03, 0.014, 0, 0, Math.PI / 2, 0) }).build();
// 戸板（0.88×1.74m の板戸。裏に桟3本）。立てて置き、傾けて壁に寄せる。
const door = () => {
  const P = new Parts(), age = (x, y) => 0.68 + 0.32 * smooth(0, 0.7, y);
  P.add(new THREE.BoxGeometry(0.88, 1.74, 0.03), { cell: 'wood', color: '#f2ebe0', at: M(0, 0.87, 0), shade: age });
  for (const y of [0.25, 0.87, 1.5]) P.add(new THREE.BoxGeometry(0.8, 0.07, 0.022), { cell: 'wood', color: '#ddd3c4', at: M(0, y, -0.026), shade: age });
  return P.build();
};
// 杭（畑の縁。0.9m）と、祠の前の杭（1.5m。注連縄を大きくした第3周から）。根元は湿って暗い。
const stake = (h, r) => new Parts().add(new THREE.CylinderGeometry(r * 0.78, r, h + 0.05, 5), { cell: 'wood', color: '#f0e8dc', at: M(0, h / 2 - 0.025, 0), shade: (x, y) => (0.6 + 0.4 * smooth(0, 0.3, y)) * (y > h - 0.03 ? 0.75 : 1) }).build();
// 板碑（高さ1m・幅0.3m・厚さ3.5cm の板石。頭は山形。15cm は土に埋める）。飯田市の1294年の板碑（緑泥片岩）に倣う。
function itabi() {
  const s = new THREE.Shape(); s.moveTo(-0.15, -0.15); s.lineTo(0.15, -0.15); s.lineTo(0.15, 0.92); s.lineTo(0, 1.0); s.lineTo(-0.15, 0.92); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: false }).translate(0, 0, -0.0175);
  return new Parts().add(g, { cell: 'itabi', color: '#d2d6cc', uv: (u, v, x, y) => [(x + 0.15) / 0.3, (y + 0.15) / 1.15], shade: (x, y) => 0.7 + 0.3 * smooth(-0.05, 0.4, y) }).build();
}
// 炉：石7つの輪と、灰の小山。煤で内側が黒い。
function hearth() {
  const P = new Parts(), rnd = mulberry32(19);
  for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2 + (rnd() - 0.5) * 0.4, r = 0.34 + rnd() * 0.05;
    P.add(new THREE.IcosahedronGeometry(0.085 + rnd() * 0.03, 0), { cell: 'ash', color: '#b5a48c', at: M(Math.cos(a) * r, 0.035, Math.sin(a) * r, rnd() * 3, rnd() * 3, rnd() * 3, 1.3, 0.62, 1), shade: (x, y, z) => 0.45 + 0.55 * smooth(0.27, 0.42, Math.hypot(x, z)) }); }
  P.add(lathe([[0.32, 0], [0.27, 0.012], [0.15, 0.03], [0.001, 0.035]], 12), { cell: 'ash', color: '#ffffff' });
  return P.build();
}
// 燠（炭のかけら。光る材質で描く。炎は出さない）
function embers() {
  const P = new Parts(), rnd = mulberry32(23);
  for (let k = 0; k < 9; k++) { const a = rnd() * Math.PI * 2, r = rnd() * 0.13;
    P.add(new THREE.BoxGeometry(0.06 + rnd() * 0.06, 0.03 + rnd() * 0.025, 0.04 + rnd() * 0.04), { cell: null, at: M(Math.cos(a) * r, 0.045, Math.sin(a) * r, (rnd() - 0.5) * 0.6, rnd() * 3, (rnd() - 0.5) * 0.6) }); }
  return P.build();
}
// 注連縄（祠の前の杭2本の間。張った姿と、切れて垂れた姿）。杭は縄の中心から ±SPAN m（world-data の表と合わせる）。
// 第3周（2026-11-03）：盲検で「拡大して初めて気づく」と言われたので、杭の間を1.6→2.1m、結ぶ高さを1.0→1.35m、縄の太さを1.7倍、房を大きくした。
const SPAN = 1.05, TIE = 1.35, ROPE = 0.075, sx = SPAN / 0.8, sy = TIE / 1.0;
function ropeTied() {
  const P = new Parts(), y = x => TIE - 0.17 * (1 - (x / SPAN) ** 2);
  P.add(tube([[-SPAN, TIE, 0], [-0.52, y(0.52), 0.04], [0, y(0), 0.05], [0.52, y(0.52), 0.04], [SPAN, TIE, 0]], ROPE, 40, 8), { cell: 'rope', color: '#fffaeb', uv: (u, v) => [v, u] });
  for (const s of [-1, 1]) P.add(new THREE.TorusGeometry(0.09, 0.024, 4, 10), { cell: 'rope', color: '#fffaeb', at: M(s * SPAN, TIE, 0, Math.PI / 2, 0, 0) });
  for (const x of [-0.55, 0, 0.55]) {
    P.add(new THREE.ConeGeometry(0.085, 0.52, 7), { cell: 'straw', color: '#fffbf0', at: M(x, y(x) - 0.32, 0.06, Math.PI, 0, 0) });
    P.add(new THREE.SphereGeometry(0.04, 6, 4), { cell: 'rope', color: '#f2ead6', at: M(x, y(x) - 0.05, 0.06) });
  }
  return P.build();
}
function ropeCut() {
  const P = new Parts(), dirty = '#fff6e2', at = (x, h, z) => [x * sx, h > 0.05 ? h * sy : h, z * sx];   // 第2周の形を、杭の間と高さに合わせて引き伸ばす（地面に落ちた所は地面のまま）
  P.add(tube([[-SPAN, TIE, 0], at(-0.75, 0.72, 0.05), at(-0.71, 0.32, 0.1), at(-0.66, 0.05, 0.19), at(-0.46, 0.06, 0.32), at(-0.3, 0.06, 0.4)], ROPE, 30, 8), { cell: 'rope', color: dirty, uv: (u, v) => [v, u] });
  P.add(tube([[SPAN, TIE, 0], at(0.78, 0.76, 0.06), at(0.74, 0.36, 0.12), at(0.7, 0.055, 0.21), at(0.55, 0.06, 0.37), at(0.42, 0.06, 0.5)], ROPE, 30, 8), { cell: 'rope', color: dirty, uv: (u, v) => [v, u] });
  for (const s of [-1, 1]) P.add(new THREE.TorusGeometry(0.09, 0.024, 4, 10), { cell: 'rope', color: dirty, at: M(s * SPAN, TIE, 0, Math.PI / 2, 0, 0) });
  for (const [x, z] of [[-0.3, 0.4], [0.42, 0.5]]) P.add(new THREE.ConeGeometry(0.05, 0.14, 6), { cell: 'straw', color: '#efe6d0', at: M((x + Math.sign(x) * -0.03) * sx, 0.05, z * sx, 0, 0, Math.sign(x) * Math.PI / 2) });   // ほつれた切り口
  for (const [x, z, ry] of [[-0.05, 0.62, 0.4], [0.22, 0.78, -0.7]]) P.add(new THREE.ConeGeometry(0.1, 0.6, 7), { cell: 'straw', color: '#e2d8c0', at: M(x * sx, 0.06, z * sx, 0, ry, Math.PI / 2) });
  return P.build();
}
// 流れ旗（見3・正面の道の口に兵が立てた旗）。竿3.2m・横木0.5m・布は横木から垂らす（幅0.42m・長さ1.9m）。props.js の流れ旗と同じ考えの形で、
// 襲撃中だけ出す（救ったあとは抜かれる）ので life の表に置く。布はゆるく波打たせ、風では動かさない（遠くで旗と読めれば足りる）。
function flag() {
  const P = new Parts(), H = 3.2, W = 0.42, L = 1.9;
  P.add(new THREE.CylinderGeometry(0.026, 0.034, H, 6), { cell: 'wood', color: '#e2d6c4', at: M(0, H / 2, 0), shade: (x, y) => 0.6 + 0.4 * smooth(0, 0.6, y) });
  P.add(new THREE.CylinderGeometry(0.018, 0.018, W + 0.12, 5), { cell: 'wood', color: '#e2d6c4', at: M(W / 2, H - 0.06, 0, 0, 0, Math.PI / 2) });
  const g = new THREE.PlaneGeometry(W, L, 2, 8), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const yy = p.getY(i), t = (L / 2 - yy) / L; p.setZ(i, 0.07 * Math.sin(t * 5.5) * t + 0.05 * t * t); }
  P.both(g, { cell: 'plain', color: '#7b2a22', at: M(W / 2 + 0.02, H - 0.08 - L / 2, 0), shade: (x, y) => 0.72 + 0.28 * smooth(H - 2.1, H - 0.2, y) });
  return P.build();
}
// 柴垣（見3・脇道の縁。雑木の枝を立て並べ、横木2本で押さえた低い垣。research-valley-life-period.md の「柵（柴垣）」〇）。
// 長さ1.6m・高さ0.85m を1区画とし、置く表の scale[0] で杭と杭の間へ伸ばす。道を外から隠す「脇道」を遠くから読ませる。
function hedge() {
  const P = new Parts(), rnd = mulberry32(53), N = 30;
  for (let i = 0; i < N; i++) {
    const x = -0.78 + 1.56 * (i + rnd() * 0.6) / N, h = 0.72 + rnd() * 0.22;
    P.add(new THREE.CylinderGeometry(0.008 + rnd() * 0.006, 0.013 + rnd() * 0.007, h, 4), { cell: 'wood', color: ['#cdbfa9', '#b8a993', '#ddd2bf'][i % 3],
      at: M(x, h / 2 - 0.03, (rnd() - 0.5) * 0.08, (rnd() - 0.5) * 0.16, rnd() * 3, (rnd() - 0.5) * 0.2), shade: (xx, y) => 0.55 + 0.45 * smooth(0, 0.6, y) });
  }
  for (const y of [0.24, 0.62]) for (const z of [-0.055, 0.055]) P.add(new THREE.CylinderGeometry(0.022, 0.022, 1.62, 5), { cell: 'wood', color: '#efe5d4', at: M(0, y, z, 0, 0, Math.PI / 2) });
  return P.build();
}
// 草の葉の束（ススキ・道の縁の草むら）。葉は根元から外へ反り、穂は先で垂れる。裏面も足す。
function blades(P, rnd, { n, h0, h1, lean0, lean1, width, base, tip, cell, plumes = 0 }) {
  const cb = new THREE.Color(base), ct = new THREE.Color(tip), seg = 3;
  const leaf = (a, h, lean, w, colA, colB, droop = 0, y0 = 0) => {
    const pos = [], uv = [], idx = [], dir = [Math.cos(a), Math.sin(a)], side = [-Math.sin(a), Math.cos(a)];
    for (let j = 0; j <= seg; j++) { const t = j / seg, o = lean * t ** 1.6, y = y0 + h * t - droop * t * t, ww = w * (1 - 0.85 * t);
      for (const s of [-1, 1]) { pos.push(dir[0] * o + side[0] * ww * s, y, dir[1] * o + side[1] * ww * s); uv.push(s < 0 ? 0 : 1, t); } }
    for (let j = 0; j < seg; j++) { const k = j * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    P.both(g, { cell, shade: (x, yy) => 0.55 + 0.45 * smooth(0, h0, yy), color: colA.clone().lerp(colB, 0.5) });
  };
  for (let k = 0; k < n; k++) leaf(k / n * Math.PI * 2 + (rnd() - 0.5) * 0.6, h0 + rnd() * (h1 - h0), lean0 + rnd() * (lean1 - lean0), width, cb, ct);
  for (let k = 0; k < plumes; k++) { const a = rnd() * Math.PI * 2, h = h1 * (1.05 + rnd() * 0.2), lean = 0.08 + rnd() * 0.1;
    leaf(a, h, lean, 0.006, cb, ct);                                                                   // 茎
    leaf(a, 0.34, lean * 0.6 + 0.12, 0.035, new THREE.Color('#ffffff'), new THREE.Color('#fffaf0'), 0.12, h - 0.02); }          // 穂（明るく、先が垂れる）
}
function susuki() { const P = new Parts(); blades(P, mulberry32(41), { n: 11, h0: 0.9, h1: 1.35, lean0: 0.18, lean1: 0.38, width: 0.022, base: '#a8b88c', tip: '#d6d8a8', cell: 'susuki', plumes: 4 }); return P.build(); }
function tuft() { const P = new Parts(); blades(P, mulberry32(43), { n: 9, h0: 0.2, h1: 0.42, lean0: 0.06, lean1: 0.16, width: 0.018, base: '#98b47e', tip: '#c4cc94', cell: 'susuki' }); return P.build(); }
// 烏（翼を広げた形。翼の先は物の中心から離れた頂点＝はばたきで上下する）。色は材質だけ。
function crow() {
  const pos = [0.17, 0, 0, 0, 0.035, 0, -0.12, 0, 0, 0, 0, 0.05, 0, 0, -0.05, 0, -0.03, 0,                     // 胴（前・背・後・左右・腹）
    0.05, 0, 0.05, -0.07, 0, 0.05, -0.05, 0, 0.44, 0.05, 0, 0.4, 0.05, 0, -0.05, -0.07, 0, -0.05, -0.05, 0, -0.44, 0.05, 0, -0.4,   // 翼
    -0.12, 0, 0.035, -0.12, 0, -0.035, -0.27, 0, 0.07, -0.27, 0, -0.07];                                       // 尾
  const idx = [0, 1, 3, 0, 4, 1, 1, 2, 3, 1, 4, 2, 0, 3, 5, 0, 5, 4, 5, 3, 2, 5, 2, 4, 6, 7, 8, 6, 8, 9, 10, 12, 11, 10, 13, 12, 14, 16, 15, 15, 16, 17];
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0.5), 2));
  return new Parts().both(g, { cell: 'plain', color: '#ffffff' }).build();
}
// 弓と矢筒は weapons.js の形をそのまま使い、部品ごとの色を頂点の色へ移して1つの形にする（1回で描くため）。
function fromGroup(group) {
  const P = new Parts(); group.updateMatrixWorld(true);
  group.traverse(o => { if (!o.isMesh) return; const g = o.geometry.clone().applyMatrix4(o.matrixWorld), col = o.material.map ? new THREE.Color('#5a4630') : o.material.color.clone();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 2).fill(0.5), 2));
    if (o.geometry.type === 'PlaneGeometry') P.both(g, { cell: 'plain', color: col }); else P.add(g, { cell: 'plain', color: col }); });
  return P.build();
}

export const KIT = {
  bale: { make: () => bale(false), blob: [0.95, 0.62] }, bale_torn: { make: () => bale(true), blob: [1.0, 0.7] }, rice: { make: rice, small: true },
  mat: { make: mat }, pot: { make: pot, blob: [0.55, 0.55] }, ladle: { make: ladle, small: true },
  bucket: { make: bucket, blob: [0.6, 0.45] }, basket: { make: basket, blob: [0.65, 0.5] }, veg: { make: veg, small: true }, brush: { make: brush, small: true, blob: [1.0, 0.35] },
  sandal: { make: sandal, small: true }, door: { make: door, blob: [0.95, 0.35] }, stake: { make: () => stake(0.9, 0.04), blob: [0.2, 0.2] }, post: { make: () => stake(1.5, 0.065), blob: [0.3, 0.3] },
  itabi: { make: itabi, blob: [0.55, 0.3] }, hearth: { make: hearth }, embers: { make: embers, material: 'ember' }, rope_tied: { make: ropeTied }, rope_cut: { make: ropeCut },
  flag: { make: flag, blob: [0.3, 0.3] }, hedge: { make: hedge, blob: [1.7, 0.3] },
  susuki: { make: susuki, material: 'sway' }, tuft: { make: tuft, material: 'sway', small: true }, crow: { make: crow, material: 'crow' },
  bow: { make: () => fromGroup(makeYumi()) }, quiver: { make: () => fromGroup(makeQuiver()) },
};

// 草の揺れ（vegetation.js の草と同じ式。BatchedMesh では置き場所の行列から揺れの位相を取る）
function patchSway(material, u, height) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;').replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_BATCHING
        vec3 sPos = batchingMatrix[3].xyz;
      #else
        vec3 sPos = vec3(0.0);
      #endif
      float sPh = sPos.x * 0.37 + sPos.z * 0.21, sHf = clamp(transformed.y / ${height.toFixed(2)}, 0.0, 1.0);
      float sSw = (sin(uTime * 1.15 + sPh) + 0.5 * sin(uTime * 2.4 + sPh * 1.7)) * 0.06 * sHf * sHf * uWind;
      transformed.x += sSw * ${height.toFixed(2)}; transformed.z += sSw * ${(height * 0.6).toFixed(2)};`);
  };
  material.customProgramCacheKey = () => 'life-sway-' + height;
}
// 烏のはばたき：翼の先（|z| が胴の幅より外）ほど上下する。位相は置き場所から取り、1羽ずつずらす。
function patchFlap(material, u) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_BATCHING
        vec3 fPos = batchingMatrix[3].xyz;
      #else
        vec3 fPos = vec3(0.0);
      #endif
      float fPh = fPos.x * 1.7 + fPos.z * 1.3, fGlide = step(0.35, sin(uTime * 0.6 + fPh * 0.5));
      transformed.y += sin(uTime * 11.0 + fPh) * max(0.0, abs(position.z) - 0.05) * mix(0.9, 0.12, fGlide);`);
  };
  material.customProgramCacheKey = () => 'life-crow-flap';
}

// 型と材質を作る。models[kind] は Mesh を1つだけ持つ Group（batchParts に渡す）。
export function buildLifeKit({ anisotropy = 4 } = {}) {
  const atlas = paintAtlas(), sway = { uTime: { value: 0 }, uWind: { value: 1 } }, flap = { uTime: { value: 0 } };
  atlas.anisotropy = anisotropy;
  const emberTex = paintEmbers();
  const materials = {
    kit: new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.93, metalness: 0 }),
    sway: new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.95, metalness: 0 }),
    ember: new THREE.MeshStandardMaterial({ map: emberTex, emissive: new THREE.Color('#ff5a14'), emissiveMap: emberTex, emissiveIntensity: 1.1, roughness: 1, metalness: 0 }),
    crow: new THREE.MeshLambertMaterial({ color: new THREE.Color('#17171a') }),
  };
  materials.kit.name = 'life-kit'; materials.sway.name = 'life-sway'; materials.ember.name = 'life-embers'; materials.crow.name = 'life-crow';
  patchSway(materials.sway, sway, 1.4); patchFlap(materials.crow, flap);
  const models = {}, info = {};
  for (const [kind, k] of Object.entries(KIT)) {
    const mesh = new THREE.Mesh(k.make(), materials[k.material || 'kit']);
    mesh.name = 'life-' + kind; mesh.castShadow = false; mesh.receiveShadow = k.material !== 'crow';
    const g = new THREE.Group(); g.name = 'kit-' + kind; g.add(mesh); models[kind] = g;
    info[kind] = { small: k.small === true, blob: k.blob || null };
  }
  const marks = new THREE.MeshStandardMaterial({ map: paintMarks(), transparent: true, depthWrite: false, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  marks.name = 'life-marks';
  return { models, info, materials: { ...materials, marks }, uniforms: { sway, flap } };
}

// ---------------------------------------------------------------- 地面の跡（地形に沿わせた薄い板。影は受けるが落とさない）
const LIFT = 0.035;
// path（[x,z] の折れ線）に沿う帯。tile m ごとに絵の区画を1回使う（区画の上下はつながるように描いてある）。
function stripGeometry(out, path, width, rect, tile, terrain) {
  const curve = new THREE.CatmullRomCurve3(path.map(([x, z]) => V3(x, 0, z)), false, 'centripetal'), L = curve.getLength(), pt = new THREE.Vector3(), tg = new THREE.Vector3();
  const at = s => { const u = Math.min(1, Math.max(0, s / L)); curve.getPointAt(u, pt); curve.getTangentAt(u, tg); const l = Math.hypot(tg.x, tg.z) || 1; return { x: pt.x, z: pt.z, dx: tg.x / l, dz: tg.z / l }; };
  const rows = 4, nTiles = Math.max(1, Math.round(L / tile)), tl = L / nTiles;
  for (let k = 0; k < nTiles; k++) {
    const base = out.pos.length / 3;
    for (let j = 0; j <= rows; j++) { const p = at(k * tl + tl * j / rows);
      for (const s of [-1, 1]) { const x = p.x + p.dz * width / 2 * s, z = p.z - p.dx * width / 2 * s; out.pos.push(x, terrain.heightAt(x, z) + LIFT, z); out.uv.push(s < 0 ? rect.u0 : rect.u1, rect.v0 + (rect.v1 - rect.v0) * j / rows); } }
    for (let j = 0; j < rows; j++) { const q = base + j * 2; out.idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
  }
}
function quadGeometry(out, { x, z, w, l, rotY = 0 }, rect, terrain) {
  const n = 5, c = Math.cos(rotY), s = Math.sin(rotY), base = out.pos.length / 3;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const u = i / n - 0.5, v = j / n - 0.5, px = x + u * w * c + v * l * s, pz = z - u * w * s + v * l * c;
    out.pos.push(px, terrain.heightAt(px, pz) + LIFT, pz); out.uv.push(rect.u0 + (rect.u1 - rect.u0) * (i / n), rect.v0 + (rect.v1 - rect.v0) * (j / n));
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const q = base + j * (n + 1) + i; out.idx.push(q, q + n + 1, q + 1, q + 1, q + n + 1, q + n + 2); }
}
const TILE = { rut: 2.2, steps: 1.3, rice: 0.9, path: 1.2 };
// list の跡を、出し入れの組（key）ごとに1つの形へまとめる。戻り値は [{ key, show, mesh }]。
export function buildMarks(list, terrain, material) {
  const groups = new Map();
  for (const m of list) {
    const key = m.show ? JSON.stringify(m.show) : 'always';
    if (!groups.has(key)) groups.set(key, { show: m.show || null, pos: [], uv: [], idx: [] });
    const out = groups.get(key), rect = markRect(m.mark);
    if (m.path) stripGeometry(out, m.path, m.width, rect, TILE[m.mark] || m.width, terrain); else quadGeometry(out, m, rect, terrain);
  }
  return [...groups.entries()].map(([key, o]) => {
    const g = new THREE.BufferGeometry(), n = o.pos.length / 3;
    g.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(o.uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(n * 3).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3)); g.setIndex(o.idx); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material); mesh.name = 'life-marks'; mesh.receiveShadow = true; mesh.castShadow = false; mesh.renderOrder = 1;
    return { key, show: o.show, mesh };
  });
}
