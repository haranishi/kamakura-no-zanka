// Procedural foliage only. Raw RGBA preserves neutral RGB underneath zero alpha.
import * as THREE from 'three';
const TAU = Math.PI * 2;
const hash = (i, k) => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); };
function canvas() { const c = document.createElement('canvas'); c.width = c.height = 256; return c; }
function upload(c, g) {
  const pixels = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < pixels.data.length; i += 4) if (pixels.data[i + 3] < 6) pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 190;
  const map = new THREE.DataTexture(pixels.data, c.width, c.height, THREE.RGBAFormat);
  map.flipY = true; map.colorSpace = THREE.SRGBColorSpace; map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter; map.magFilter = THREE.LinearFilter; map.needsUpdate = true; return map;
}
export function needleTexture() {
  const c = canvas(), g = c.getContext('2d'); g.lineCap = 'round';
  // Nine fans and their lateral twigs follow the old needleTexture's grammar.
  const twig = (x, y, a, len, seed) => {
    g.strokeStyle = '#687657'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
    const n = Math.floor(len / 2.1);
    for (let j = 1; j < n; j++) for (const side of [-1, 1]) {
      const t = j / n, k = .55 + .45 * t, px = x + Math.cos(a) * len * t, py = y + Math.sin(a) * len * t;
      const ang = a + side * (.55 + hash(seed + j, 3) * .55), l = (7 + hash(seed + j, 4) * 6) * (1 - .25 * t);
      g.strokeStyle = `rgb(${Math.round(50 + 32 * k)},${Math.round(76 + 47 * k)},${Math.round(46 + 27 * k)})`; g.lineWidth = 1.9;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(ang) * l, py + Math.sin(ang) * l); g.stroke();
    }
  };
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + (i / 8 - .5) * 1.9, len = 150 + hash(i, 11) * 60;
    twig(128, 246, a, len, i * 37);
    for (let k = 0; k < 4; k++) for (const side of [-1, 1]) { const t = .28 + k * .17; twig(128 + Math.cos(a) * len * t, 246 + Math.sin(a) * len * t, a + side * .85, 34 + hash(i, k) * 28, i * 71 + k); }
  }
  return upload(c, g);
}
const S = 256;
const gray = v => { const n = Math.max(0, Math.min(255, Math.round(255 * v))); return `rgb(${n},${n},${n})`; };
function eachWrap(cx, cy, r, fn) {
  for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
    const x = cx + ox, y = cy + oy;
    if (x < -r || x > S + r || y < -r || y > S + r) continue;
    fn(x, y);
  }
}
function maplePath(g, R) {
  const lobes = [-172, -131, -90, -49, -8].map(d => d * Math.PI / 180), lens = [.6, .88, 1, .88, .6];
  g.beginPath(); g.moveTo(0, R * .06);
  for (let k = 0; k < 5; k++) {
    if (k) { const a = (lobes[k - 1] + lobes[k]) / 2; g.lineTo(Math.cos(a) * R * .4, Math.sin(a) * R * .4); }
    const a = lobes[k], L = lens[k] * R;
    for (const [offset, scale] of [[-.16,.8],[-.07,.9],[0,1],[.07,.9],[.16,.8]]) g.lineTo(Math.cos(a + offset) * L * scale, Math.sin(a + offset) * L * scale);
  }
  g.closePath();
}
function zelkovaPath(g, L) {
  const W = L * .46, n = 8;
  g.beginPath(); g.moveTo(0, 0);
  for (let i = 1; i <= n; i++) { const t = i / n; g.lineTo(W * Math.pow(Math.sin(Math.PI * Math.pow(t, .75)), .9) * (i % 2 ? .86 : 1), -L * t); }
  for (let i = n - 1; i >= 1; i--) { const t = i / n; g.lineTo(-W * Math.pow(Math.sin(Math.PI * Math.pow(t, .75)), .9) * (i % 2 ? .86 : 1), -L * t); }
  g.closePath();
}
function darts(n, minDist, salt) {
  const pts = [];
  for (let k = 0; k < n * 60 && pts.length < n; k++) {
    const x = hash(k, salt) * S, y = hash(k, salt + 1) * S;
    let ok = true;
    for (const p of pts) { let dx = Math.abs(p[0] - x), dy = Math.abs(p[1] - y); if (dx > S / 2) dx = S - dx; if (dy > S / 2) dy = S - dy; if (dx * dx + dy * dy < minDist * minDist) { ok = false; break; } }
    if (ok) pts.push([x, y]);
  }
  return pts;
}
function repeat(c, g) {
  const map = upload(c, g); map.wrapS = map.wrapT = THREE.RepeatWrapping; return map;
}
function leafTile(kind) {
  const c = canvas(), g = c.getContext('2d');
  g.lineJoin = 'round'; g.lineCap = 'round';
  const maple = kind === 'maple', pts = darts(maple ? 300 : 215, maple ? 9.5 : 11, maple ? 31 : 47);
  const order = pts.map((_, i) => i).sort((a, b) => hash(a, 77) - hash(b, 77));
  for (const i of order) {
    const [cx, cy] = pts[i];
    const size = maple ? 22 + 8.5 * hash(i, 3) : 30 + 11.25 * hash(i, 3), rot = hash(i, 4) * TAU, v = .55 + .45 * hash(i, 5);
    eachWrap(cx, cy, size * 1.2, (x, y) => {
      g.save(); g.translate(x, y); g.rotate(rot);
      const grad = g.createLinearGradient(-size * .6, 0, size * .6, 0);
      grad.addColorStop(0, gray(v * .82)); grad.addColorStop(.5, gray(v)); grad.addColorStop(1, gray(v * .86));
      g.fillStyle = grad; g.strokeStyle = gray(Math.min(1, v * 1.12)); g.lineWidth = .9;
      (maple ? maplePath : zelkovaPath)(g, size);
      // A narrow transparent outline keeps overlapping leaves individually legible.
      // Erase before filling so the leaf itself retains its original shape and veins.
      g.globalCompositeOperation = 'destination-out'; g.lineWidth = 3.8; g.stroke();
      g.globalCompositeOperation = 'source-over'; g.lineWidth = .9; g.fill(); g.stroke();
      g.strokeStyle = gray(v * .55); g.lineWidth = .8; g.beginPath();
      if (maple) { for (const a of [-172, -131, -90, -49, -8]) { g.moveTo(0, 0); g.lineTo(Math.cos(a * Math.PI / 180) * size * .78, Math.sin(a * Math.PI / 180) * size * .78); } }
      else { g.moveTo(0, 0); g.lineTo(0, -size * .92); for (let k = 1; k < 5; k++) for (const s of [-1, 1]) { g.moveTo(0, -size * k * .19); g.lineTo(s * size * .3, -size * (k * .19 + .13)); } }
      g.stroke(); g.restore();
    });
  }
  const map = repeat(c, g); map.userData.leafCount = pts.length; return map;
}
export function needleFringeTexture() {
  const c = canvas(), g = c.getContext('2d'); g.lineCap = 'round';
  const green = (t, r) => `rgb(${Math.round(30 + 40 * t + 10 * r)},${Math.round(54 + 62 * t + 12 * r)},${Math.round(26 + 30 * t + 8 * r)})`;
  g.fillStyle = green(.15, .5); g.fillRect(0, 0, S, 150);
  const strokes = (n, y0min, y0max, kind) => {
    for (let i = 0; i < n; i++) {
      const x = hash(i, kind + 1) * S, y = y0min + hash(i, kind + 2) * (y0max - y0min);
      if (kind === 3 && hash(i, 9) > 1 - Math.max(0, (y - 150) / 110) * 1.1) continue;
      const len = (kind === 1 ? 12 : 16) + hash(i, kind + 4) * (kind === 1 ? 16 : 30) * (.5 + (y / S)), a = Math.PI / 2 + (hash(i, kind + 5) - .5) * 1.1;
      const t = Math.min(1, y / S + hash(i, kind + 6) * .35);
      for (const ox of [-S, 0, S]) {
        const px = x + ox; if (px < -len || px > S + len) continue;
        g.strokeStyle = green(t, hash(i, kind + 7)); g.lineWidth = 1.6 + 1.2 * hash(i, kind + 8);
        g.beginPath(); g.moveTo(px, y); g.lineTo(px + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
      }
    }
  };
  strokes(900, 0, 150, 1);
  strokes(1500, 100, 255, 3);
  return repeat(c, g);
}
export function mapleLeafTexture() { return leafTile('maple'); }
export function zelkovaLeafTexture() { return leafTile('zelkova'); }
