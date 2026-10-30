// なぜ失敗したか（8.1a第2周）: 遠景の絵の板の純粋な部分（方向の選び方・帳の割り付け・枠への収め方・焼く置き方）と、
// カメラの近くの葉を薄める距離の退行を、構文や読み込みの失敗ではなくassertionで検出する。
// Every mutation restores the original bytes, including on interruption/error.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const plan = 'dist/valley/tree-impostor.js', lod = 'dist/valley/tree-lod.js';
const cases = [
  ['one frame for every view', plan, 'const a = base % views, b = (a + 1) % views;', 'const a = 0, b = 1;'],
  ['hard switch between views', plan, 'const t = band > 0 ? smooth(.5 - band / 2, .5 + band / 2, f) : f >= .5 ? 1 : 0;', 'const t = f >= .5 ? 1 : 0;'],
  ['blend across the whole step', plan, 'smooth(.5 - band / 2, .5 + band / 2, f)', 'f'],
  ['azimuth from the wrong axis', plan, 'const a = Math.atan2(dx, dz);', 'const a = Math.atan2(dz, dx);'],
  ['stretched frame', plan, 'return { scale, width: 2 * half * scale,', 'return { scale, width: cw,'],
  ['frame ignores its padding', plan, 'const cw = cfg.cell[0] - 2 * cfg.pad, ch = cfg.cell[1] - 2 * cfg.pad', 'const cw = cfg.cell[0], ch = cfg.cell[1]'],
  ['bake turns the tree the wrong way', plan, 'yaw: -viewAzimuth(column, cfg.views)', 'yaw: viewAzimuth(column, cfg.views)'],
  ['baked trunk off centre', plan, 'return { x: x + fit.width / 2,', 'return { x: x + fit.width / 3,'],
  ['baked foot above the frame bottom', plan, 'y: y - fit.bottom * fit.scale', 'y: y'],
  ['families out of row order', plan, 'for (let shape = 0; shape < n; shape++) out.push({ species, shape, row: out.length });', 'for (let shape = n - 1; shape >= 0; shape--) out.push({ species, shape, row: out.length });'],
  ['near fade inverted', lod, 'return smooth(a, b, distance); }', 'return 1 - smooth(a, b, distance); }'],
  ['near fade without a band', lod, "if (!(a >= 0 && b > a)) throw new RangeError('near fade');", ''],
];
const originals = new Map([...new Set(cases.map(c => c[1]))].map(f => [f, fs.readFileSync(f)]));
const run = () => spawnSync(process.execPath, ['--test', 'tests/valley-tree-impostor.test.mjs', 'tests/valley-tree-lod.test.mjs'], { encoding: 'utf8', timeout: 60000 });
function baseline() { const r = run(); if (r.status !== 0) throw Error('impostor baseline failed\n' + r.stdout + r.stderr); }
baseline(); let killed = 0;
try {
  for (const [name, file, from, to] of cases) {
    const original = originals.get(file);
    if (!original.toString().includes(from)) throw Error('mutation target missing: ' + name);
    let r; try { fs.writeFileSync(file, original.toString().replace(from, to)); r = run(); } finally { fs.writeFileSync(file, original); }
    const log = r.stdout + r.stderr;
    const ok = r.status !== 0 && /AssertionError/.test(log) && /(?:#|ℹ) fail [1-9]/.test(log) && !/SyntaxError|ERR_MODULE_NOT_FOUND|does not provide an export/.test(log) && !r.error;
    killed += Number(ok); console.log(`${ok ? 'killed' : 'SURVIVED'}: ${name}`);
    if (!ok) console.log(log.slice(-1500));
  }
} finally { for (const [f, b] of originals) { fs.writeFileSync(f, b); if (!fs.readFileSync(f).equals(b)) throw Error('impostor byte restoration failed'); } }
baseline(); console.log(JSON.stringify({ total: cases.length, killed, restored: true }));
if (killed !== cases.length) process.exitCode = 1;
