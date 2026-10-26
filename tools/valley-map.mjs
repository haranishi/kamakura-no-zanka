// 開発用：地形・道・川・建物・ゾーンを2Dの地図画像（PNG）にする。レイアウトの確認と地形の検査に使う。
// 使い方: node tools/valley-map.mjs <出力.png> [--x0 -250 --x1 350 --z0 -250 --z1 250 --res 2 --contour 5]
import fs from 'node:fs';
import zlib from 'node:zlib';
import { WORLD } from '../dist/valley/world-data.js';
import { createTerrain, smooth } from '../dist/valley/terrain-height.js';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? Number(args[i + 1]) : d; };
const out = args.find(a => !a.startsWith('--') && !/^-?\d/.test(a)) || 'valley-map.png';
const x0 = flag('x0', -250), x1 = flag('x1', 350), z0 = flag('z0', -250), z1 = flag('z1', 250), res = flag('res', 2), contour = flag('contour', 5);
const W = Math.round((x1 - x0) / res), H = Math.round((z1 - z0) / res);
const t = createTerrain(WORLD);
const hts = new Float32Array(W * H);
let lo = 1e9, hi = -1e9;
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const h = t.heightAt(x0 + i * res, z0 + j * res); hts[j * W + i] = h; lo = Math.min(lo, h); hi = Math.max(hi, h); }
const px = new Uint8Array(W * H * 3);
const set = (i, j, r, g, b) => { if (i < 0 || j < 0 || i >= W || j >= H) return; const k = (j * W + i) * 3; px[k] = r; px[k + 1] = g; px[k + 2] = b; };
const sun = [-0.55, 0.7, -0.45];
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const x = x0 + i * res, z = z0 + j * res, h = hts[j * W + i];
  const dx = ((hts[j * W + Math.min(W - 1, i + 1)] - hts[j * W + Math.max(0, i - 1)]) / (2 * res)), dz = ((hts[Math.min(H - 1, j + 1) * W + i] - hts[Math.max(0, j - 1) * W + i]) / (2 * res));
  const l = Math.hypot(dx, 1, dz), shade = Math.max(0.15, (-dx * sun[0] + sun[1] - dz * sun[2]) / l / 1.0);
  const s = t.surfaceAt(x, z);
  let r = 96 * s.grass + 150 * s.dirt + 110 * s.rock + 150 * s.gravel + 100 * s.mud + 70 * s.litter;
  let g = 130 * s.grass + 120 * s.dirt + 105 * s.rock + 140 * s.gravel + 85 * s.mud + 95 * s.litter;
  let b = 70 * s.grass + 80 * s.dirt + 100 * s.rock + 120 * s.gravel + 60 * s.mud + 55 * s.litter;
  const w = t.waterAt(x, z);
  if (w > 0.01) { const k = Math.min(1, w / 2.5); r = 60 - 20 * k; g = 120 - 30 * k; b = 170 - 30 * k; }
  const f = 0.55 + 0.6 * shade * (1 + (t.forestDensity(x, z) - 0.5) * -0.25);
  const c = Math.floor((h - lo) / contour);
  const cn = Math.floor((hts[j * W + Math.min(W - 1, i + 1)] - lo) / contour), cs = Math.floor((hts[Math.min(H - 1, j + 1) * W + i] - lo) / contour);
  const line = (c !== cn || c !== cs) ? 0.82 : 1;
  set(i, j, Math.min(255, r * f * line), Math.min(255, g * f * line), Math.min(255, b * f * line));
}
const toPx = (x, z) => [Math.round((x - x0) / res), Math.round((z - z0) / res)];
const disc = (x, z, rad, col) => { const [cx, cz] = toPx(x, z), R = Math.max(1, Math.round(rad / res)); for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) if (i * i + j * j <= R * R) set(cx + i, cz + j, ...col); };
const ring = (x, z, rad, col) => { const [cx, cz] = toPx(x, z), R = Math.round(rad / res); for (let a = 0; a < 720; a++) { const th = a / 720 * 2 * Math.PI; set(cx + Math.round(Math.cos(th) * R), cz + Math.round(Math.sin(th) * R), ...col); } };
const rect = (x, z, w, d, rot, col) => { for (let u = -w / 2; u <= w / 2; u += res * 0.5) for (let v = -d / 2; v <= d / 2; v += res * 0.5) { const c = Math.cos(rot), s = Math.sin(rot); const [i, j] = toPx(x + u * c + v * s, z - u * s + v * c); set(i, j, ...col); } };
for (const r of t.roads) for (const p of r.line) disc(p.x, p.z, 0.8, [235, 210, 150]);
for (const b of WORLD.buildings) rect(b.x, b.z, b.footprint.w, b.footprint.d, b.rotY, [200, 60, 50]);
for (const p of WORLD.props) disc(p.x, p.z, p.r || 1, [240, 240, 100]);
for (const d of WORLD.distant) disc(d.x, d.z, 4, [255, 140, 40]);
for (const [k, zn] of Object.entries(WORLD.zones)) ring(zn.x, zn.z, zn.r, [40, 255, 255]);
const bd = WORLD.bounds; for (let x = bd.minX; x <= bd.maxX; x += res) { for (const z of [bd.minZ, bd.maxZ]) { const [i, j] = toPx(x, z); set(i, j, 255, 255, 255); } }
for (let z = bd.minZ; z <= bd.maxZ; z += res) { for (const x of [bd.minX, bd.maxX]) { const [i, j] = toPx(x, z); set(i, j, 255, 255, 255); } }
for (const [k, list] of Object.entries(WORLD.spawns)) for (const e of (Array.isArray(list) ? list : [list])) disc(e.x, e.z, 1.2, e.kind === 'officer' ? [255, 0, 255] : [255, 80, 80]);
disc(WORLD.start.x, WORLD.start.z, 1.6, [0, 255, 0]);
// PNG書き出し
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let j = 0; j < H; j++) { raw[j * (W * 3 + 1)] = 0; Buffer.from(px.buffer, j * W * 3, W * 3).copy(raw, j * (W * 3 + 1) + 1); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));
console.log(`map ${W}x${H} height ${lo.toFixed(1)}..${hi.toFixed(1)} m -> ${out}`);
