// 固定画角の前後を画素で比べる（依存なし）。同じ名前のPNGを組にして、違う画素の数・最大差・平均差・違う範囲を出す。
// 使い方: node tools/compare-shots.mjs <前のフォルダ> <後のフォルダ> [--diff <差の画像の出力先>] [--json <結果.json>] [--only 08,09,19] [--masks --pad 2]
//   差の画像は、違う画素を赤（差が大きいほど明るい）、同じ画素を後の画像の薄い灰色で描く。違いが無い組は書かない。
//   --masks：両方のフォルダの masks/<名前>.png（capture-calls.mjs の KZ_MASK=1。調べる物だけを白で描いた輪郭）を合わせ、
//   pad 画素ふくらませた範囲の内と外で、違う画素（差が2より大きい）を数える。外の差は、その物の影か、別の原因。
//   終了コード: 0＝比べ終えた（違いの有無は問わない）、1＝組が無い・大きさが違う・読めない、2＝引数の誤り。
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG, encodePNG } from './lib/png.mjs';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : null; };
const dirs = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (dirs.length !== 2) { console.error('usage: compare-shots.mjs <before-dir> <after-dir> [--diff dir] [--json file] [--only 08,09]'); process.exit(2); }
const [before, after] = dirs.map(d => path.resolve(d)), diffDir = flag('diff'), only = flag('only')?.split(','), pad = Number(flag('pad') ?? 2);
// 輪郭の白（両方の和）を pad 画素ふくらませた印。無ければ null
function maskOf(name, width, height) {
  const files = [before, after].map(d => path.join(d, 'masks', name)).filter(f => fs.existsSync(f));
  if (!args.includes('--masks') || !files.length) return null;
  let m = new Uint8Array(width * height);
  for (const f of files) { const img = decodePNG(fs.readFileSync(f)); if (img.width !== width || img.height !== height) throw Error(`${f}: mask size differs`); for (let p = 0; p < m.length; p++) if (img.data[p * 4] > 127) m[p] = 1; }
  for (const horizontal of [true, false]) {
    const out = new Uint8Array(m.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (!m[y * width + x]) continue;
      for (let k = -pad; k <= pad; k++) { const xx = horizontal ? x + k : x, yy = horizontal ? y : y + k; if (xx >= 0 && yy >= 0 && xx < width && yy < height) out[yy * width + xx] = 1; }
    }
    m = out;
  }
  return m;
}
const names = fs.readdirSync(before).filter(f => f.endsWith('.png') && fs.existsSync(path.join(after, f)) && (!only || only.some(p => f.startsWith(p)))).sort();
if (!names.length) { console.error('no PNG pairs with the same name'); process.exit(1); }
if (diffDir) fs.mkdirSync(diffDir, { recursive: true });

const THRESHOLDS = [0, 2, 8, 32];           // 「違う」と数える色の差（0〜255）。0は少しでも違う画素
const rows = [];
for (const name of names) {
  const a = decodePNG(fs.readFileSync(path.join(before, name))), b = decodePNG(fs.readFileSync(path.join(after, name)));
  if (a.width !== b.width || a.height !== b.height) { console.error(`${name}: size differs (${a.width}x${a.height} vs ${b.width}x${b.height})`); process.exit(1); }
  const over = THRESHOLDS.map(() => 0), pixels = a.width * a.height, mask = maskOf(name, a.width, a.height);
  let inMask = 0, outMask = 0;
  let maxDelta = 0, sum = 0, x0 = a.width, y0 = a.height, x1 = -1, y1 = -1;
  const diff = diffDir ? new Uint8Array(pixels * 4) : null;
  for (let p = 0; p < pixels; p++) {
    const o = p * 4, d = Math.max(Math.abs(a.data[o] - b.data[o]), Math.abs(a.data[o + 1] - b.data[o + 1]), Math.abs(a.data[o + 2] - b.data[o + 2]));
    sum += Math.abs(a.data[o] - b.data[o]) + Math.abs(a.data[o + 1] - b.data[o + 1]) + Math.abs(a.data[o + 2] - b.data[o + 2]);
    if (d > maxDelta) maxDelta = d;
    if (mask && d > 2) { if (mask[p]) inMask++; else outMask++; }
    THRESHOLDS.forEach((t, i) => { if (d > t) over[i]++; });
    if (d > 0) { const x = p % a.width, y = (p / a.width) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (diff) {
      if (d > 0) { diff[o] = 128 + Math.min(127, d * 4); diff[o + 1] = 0; diff[o + 2] = 0; }
      else { const g = (b.data[o] * 0.3 + b.data[o + 1] * 0.59 + b.data[o + 2] * 0.11) * 0.35; diff[o] = diff[o + 1] = diff[o + 2] = g; }
      diff[o + 3] = 255;
    }
  }
  const row = { name, width: a.width, height: a.height, changed: over[0], over: Object.fromEntries(THRESHOLDS.map((t, i) => ['>' + t, over[i]])),
    changedRatio: +(over[0] / pixels).toFixed(6), maxDelta, meanDelta: +(sum / (pixels * 3)).toFixed(5), bbox: x1 >= 0 ? [x0, y0, x1, y1] : null,
    ...(mask ? { mask: { pad, over2InMask: inMask, over2OutsideMask: outMask } } : {}) };
  rows.push(row);
  if (diff && row.changed) fs.writeFileSync(path.join(diffDir, name.replace(/\.png$/, '-diff.png')), encodePNG({ width: a.width, height: a.height, data: diff }));
  console.log(`${row.changed ? 'DIFF' : 'same'}  ${name}  changed=${row.changed} (>2: ${over[1]}, >8: ${over[2]}, >32: ${over[3]})  max=${maxDelta}  mean=${row.meanDelta}${row.bbox ? '  bbox=' + row.bbox.join(',') : ''}${mask ? `  >2 near the mask ${inMask} / elsewhere ${outMask}` : ''}`);
}
const summary = { before: path.relative(process.cwd(), before), after: path.relative(process.cwd(), after), pairs: rows.length, identical: rows.filter(r => !r.changed).length, rows };
if (flag('json')) fs.writeFileSync(flag('json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`${summary.identical}/${summary.pairs} pairs identical`);
