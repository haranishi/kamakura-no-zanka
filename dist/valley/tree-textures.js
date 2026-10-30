// Procedural foliage only. Raw RGBA preserves neutral RGB underneath zero alpha.
import * as THREE from 'three';
import { barkPixels, leafTilt } from './tree-branches.js';
const TAU = Math.PI * 2;
const hash = (i, k) => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); };
function canvas(width = 256, height = 256) { const c = document.createElement('canvas'); c.width = width; c.height = height; return c; }
function upload(c, g, pad = [190, 190, 190]) {
  const pixels = g.getImageData(0, 0, c.width, c.height);
  if (pad === 'mean') {
    const sum = [0, 0, 0]; let n = 0;
    for (let i = 0; i < pixels.data.length; i += 4) if (pixels.data[i + 3] >= 77) { n++; for (let k = 0; k < 3; k++) sum[k] += pixels.data[i + k]; }
    pad = sum.map(v => Math.round(v / (n || 1)));
  }
  for (let i = 0; i < pixels.data.length; i += 4) if (pixels.data[i + 3] < 6) [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]] = pad;
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
// One layout feeds the leaf image and its detail map, so each leaf keeps its own orientation and colour.
function leafLayout(kind) {
  const maple = kind === 'maple', pts = darts(maple ? 300 : 215, maple ? 9.5 : 11, maple ? 31 : 47);
  const order = pts.map((_, i) => i).sort((a, b) => hash(a, 77) - hash(b, 77));
  return { maple, count: pts.length, leaves: order.map(i => ({ i, x: pts[i][0], y: pts[i][1], size: maple ? 22 + 8.5 * hash(i, 3) : 30 + 11.25 * hash(i, 3), rot: hash(i, 4) * TAU, v: .55 + .45 * hash(i, 5) })) };
}
function leafTile(kind) {
  const layout = leafLayout(kind), maple = layout.maple, c = canvas(), g = c.getContext('2d');
  g.lineJoin = 'round'; g.lineCap = 'round';
  for (const { x: cx, y: cy, size, rot, v } of layout.leaves) {
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
      g.strokeStyle = gray(v * .72); g.lineWidth = .8; g.beginPath();
      if (maple) { for (const a of [-172, -131, -90, -49, -8]) { g.moveTo(0, 0); g.lineTo(Math.cos(a * Math.PI / 180) * size * .78, Math.sin(a * Math.PI / 180) * size * .78); } }
      else { g.moveTo(0, 0); g.lineTo(0, -size * .92); for (let k = 1; k < 5; k++) for (const s of [-1, 1]) { g.moveTo(0, -size * k * .19); g.lineTo(s * size * .3, -size * (k * .19 + .13)); } }
      g.stroke(); g.restore();
    });
  }
  const map = repeat(c, g); map.userData.leafCount = layout.count; return map;
}
// Leaf detail map on the same layout: RGB is a tangent-space normal (+y up the image after flipY), so every
// leaf tilts its own way and folds about its midrib; A is the leaf's colour jitter (128 = none).
function leafDetail(kind) {
  const layout = leafLayout(kind), nc = canvas(), ng = nc.getContext('2d'), hc = canvas(), hg = hc.getContext('2d');
  const path = layout.maple ? maplePath : zelkovaPath;
  const encode = n => { const l = Math.hypot(...n); return `rgb(${n.map(v => Math.round((v / l * .5 + .5) * 255)).join(',')})`; };
  ng.fillStyle = 'rgb(128,128,255)'; ng.fillRect(0, 0, S, S); hg.fillStyle = gray(.5); hg.fillRect(0, 0, S, S);
  for (const leaf of layout.leaves) {
    const { angle, tilt, fold, hue } = leafTilt(hash, leaf.i);
    const base = [Math.sin(tilt) * Math.cos(angle), Math.sin(tilt) * Math.sin(angle), Math.cos(tilt)];
    const across = [Math.cos(leaf.rot), -Math.sin(leaf.rot), 0], lean = k => base.map((v, q) => v + across[q] * k * Math.sin(fold));
    eachWrap(leaf.x, leaf.y, leaf.size * 1.2, (x, y) => {
      ng.save(); ng.translate(x, y); ng.rotate(leaf.rot);
      const grad = ng.createLinearGradient(-leaf.size * .6, 0, leaf.size * .6, 0);
      grad.addColorStop(0, encode(lean(1))); grad.addColorStop(.5, encode(base)); grad.addColorStop(1, encode(lean(-1)));
      ng.fillStyle = grad; path(ng, leaf.size); ng.fill(); ng.restore();
      hg.save(); hg.translate(x, y); hg.rotate(leaf.rot); hg.fillStyle = gray(.5 + .5 * hue); path(hg, leaf.size); hg.fill(); hg.restore();
    });
  }
  const pixels = ng.getImageData(0, 0, S, S).data, jitter = hg.getImageData(0, 0, S, S).data;
  for (let i = 0; i < pixels.length; i += 4) pixels[i + 3] = jitter[i];
  const map = new THREE.DataTexture(pixels, S, S, THREE.RGBAFormat);
  map.flipY = true; map.colorSpace = THREE.NoColorSpace; map.generateMipmaps = true; map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.minFilter = THREE.LinearMipmapLinearFilter; map.magFilter = THREE.LinearFilter; map.needsUpdate = true;
  map.userData.leafCount = layout.count; return map;
}
// Sugi foliage: rope-like cords of short awl needles fan out from one root and fork forward. Two sprays share one
// 512×256 atlas (one per half). A dry pass measures the spray and scales it about its root so it fits its card
// (±116px of the cell centre, 8px from the top): a spray wider than the card showed straight cut sides on the tufts.
function spray(g, ox, variant) {
  const colour = (t, r) => `rgb(${Math.round(33 + 44 * t + 15 * r)},${Math.round(58 + 56 * t + 13 * r)},${Math.round(37 + 31 * t + 8 * r)})`;
  const draw = (k, line) => {
    // A cord bends a little at each of its three joints; needles point forward on both sides.
    const cord = (x, y, a, length, t0, t1, seed, depth) => {
      for (let part = 0; part < 3; part++) {
        const l = length / 3, dx = Math.cos(a), dy = Math.sin(a), n = Math.max(2, Math.floor(l / (2.5 * k)));
        line(x, y, x + dx * l, y + dy * l, '#4d5a3a', depth ? 1.9 : 1.3);
        for (let j = 0; j <= n; j++) {
          const f = (part + j / n) / 3, px = x + dx * l * j / n, py = y + dy * l * j / n;
          for (const side of [-1, 1]) {
            const na = a + side * (.5 + .32 * hash(seed + part * 31 + j, side + 3)), nl = k * (6.5 + 5.5 * hash(seed + part * 31 + j, side + 5)) * (1 - .3 * f);
            line(px, py, px + Math.cos(na) * nl, py + Math.sin(na) * nl, colour(t0 + (t1 - t0) * f, hash(seed + part * 31 + j, side + 7)), 2.1 + .7 * hash(seed + j, 9));
          }
        }
        if (depth) for (const [f, side] of [[.35, 1], [.75, -1]]) if (length > 40 * k) {
          const sa = a + side * (.55 + .25 * hash(seed + part, f * 10));
          cord(x + dx * l * f, y + dy * l * f, sa, length * (.42 - .1 * part), t0 + (t1 - t0) * (part + f) / 3, t1, seed * 7 + part * 13 + f * 100, depth - 1);
        }
        x += dx * l; y += dy * l; a += (hash(seed + part, 41) - .5) * .5;
      }
    };
    // The fan opens upward like its card (narrow at the root, wide at the tip).
    const cords = variant ? 6 : 7, spread = variant ? .46 : .55;
    for (let c = 0; c < cords; c++) {
      const f = c / (cords - 1) - .5, a = -Math.PI / 2 + f * 2 * spread + (hash(c, variant + 3) - .5) * .18;
      const length = k * (variant ? 214 : 226) * (1 - .18 * Math.abs(f)) * (.88 + .2 * hash(c, variant + 5));
      cord(128, 247, a, length, .2, 1, 300 + c * 17 + variant * 131, 2);
    }
  };
  let half = 0, top = 247;
  draw(1, (x0, y0, x1, y1, style, width) => { half = Math.max(half, Math.abs(x0 - 128) + width, Math.abs(x1 - 128) + width); top = Math.min(top, y0 - width, y1 - width); });
  const k = Math.min(1, 116 / half, (247 - 8) / (247 - top));
  draw(k, (x0, y0, x1, y1, style, width) => { g.strokeStyle = style; g.lineWidth = width; g.beginPath(); g.moveTo(ox + x0, y0); g.lineTo(ox + x1, y1); g.stroke(); });
}
export function cedarSprayTexture() {
  const c = canvas(512, 256), g = c.getContext('2d'); g.lineCap = 'round';
  spray(g, 0, 0); spray(g, 256, 1);
  // Transparent texels take the needles' mean colour, so mip levels do not grow pale (snowy) rims.
  const map = upload(c, g, 'mean'); map.userData.variants = 2; return map;
}
export function leafDetailTexture(kind) { return leafDetail(kind); }
export function barkTexture() {
  const { width, height, data } = barkPixels();
  const map = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  map.colorSpace = THREE.NoColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter; map.magFilter = THREE.LinearFilter; map.needsUpdate = true; return map;
}
export function mapleLeafTexture() { return leafTile('maple'); }
export function zelkovaLeafTexture() { return leafTile('zelkova'); }
