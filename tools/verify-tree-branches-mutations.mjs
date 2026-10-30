// なぜ失敗したか: 枝・房・樹皮の計画（tree-branches.js）の退行を、構文や読み込みの失敗ではなくassertionで検出する（8.1a）。
// Every mutation restores the original bytes, including on interruption/error.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const file = 'dist/valley/tree-branches.js';
const cases = [
  ['whorl returned (six limbs per height)', 'const s = (i + .5 + .9 * (rnd() - .5)) / n', 'const s = (Math.floor(i / 6) * 6 + .5) / n'],
  ['regular azimuth step', 'const azimuth = i * GOLDEN + (rnd() - .5) * .9;', 'const azimuth = i * GOLDEN + 0 * (rnd() - .5);'],
  ['tips beyond the middle rim', 'Math.min(length, rim - TUFT_REACH * tipSize)', 'Math.min(length * 1.6, rim * 2)'],
  ['one tuft per limb', 'const count = Math.max(2, Math.min(6, Math.round(b.length / .55)));', 'const count = 1;'],
  ['tufts on the bare inner limb', '.22 + .78 * (j + 1) / count', '.02 + .98 * (j + 1) / count'],
  ['tuft off its limb', 'const center = branchPoint(b, s), along', 'const center = branchPoint(b, s * .5), along'],
  ['limb floats off the trunk', 'root = cedarTrunkAxis(shape, y);', 'root = cedarTrunkAxis(shape, y).map((v, q) => q === 1 ? v : v + 1);'],
  ['one spray image', 'variant = rnd() < .5 ? 0 : 1, hue = rnd() * 2 - 1, shade = rnd() * 2 - 1;\n      b.tufts', 'variant = 0 * rnd(), hue = rnd() * 2 - 1, shade = rnd() * 2 - 1;\n      b.tufts'],
  ['no visible limbs', 'wood: length > 1.35 && t < .72', 'wood: false'],
  ['tuft cards not crossed', 'const a = tuft.roll + k * Math.PI / 3', 'const a = tuft.roll'],
  ['inward crown normal', '[out[0] / l, .55, out[2] / l]', '[-out[0] / l, .55, -out[2] / l]'],
  ['flat tuft exposure', '.58 * smooth(.12, 1.02, radial)', '0 * smooth(.12, 1.02, radial)'],
  ['middle tufts stacked as skirts', 'const t = clamp((i + .5 + .7 * (rnd() - .5)) / n)', 'const t = clamp((Math.floor(i / 4) * 4 + .5 + 0 * rnd()) / n)'],
  ['middle tufts short of the rim', '1.1 * rim - TUFT_REACH * size', '.3 * rim - TUFT_REACH * size'],
  ['bark brightness bias', 'const gain = clamp(1 + 1.15 * (hv - mean), .45, 1.5);', 'const gain = clamp(1.2 + 1.15 * (hv - mean), .45, 1.5);'],
  ['bark seam around the trunk', 'const x = u * 14 + warp', 'const x = u * 14.5 + warp'],
  ['horizontal bark grain', 'periodicNoise(u * 70 + warp * 4, v * 6, 70, 6, 1)', 'periodicNoise(u * 3, v * 90, 3, 90, 1)'],
  ['one leaf orientation', 'const angle = hash(i, 13) * TAU', 'const angle = 0 * hash(i, 13)'],
];
const original = fs.readFileSync(file);
const run = () => spawnSync(process.execPath, ['--test', 'tests/valley-tree-branches.test.mjs'], { encoding: 'utf8', timeout: 60000 });
function baseline() { const r = run(); if (r.status !== 0) throw Error('branches baseline failed\n' + r.stdout + r.stderr); }
baseline(); let killed = 0;
try {
  for (const [name, from, to] of cases) {
    if (!original.toString().includes(from)) throw Error('mutation target missing: ' + name);
    let r; try { fs.writeFileSync(file, original.toString().replace(from, to)); r = run(); } finally { fs.writeFileSync(file, original); }
    const log = r.stdout + r.stderr;
    const ok = r.status !== 0 && /AssertionError/.test(log) && /(?:#|ℹ) fail [1-9]/.test(log) && !/SyntaxError|ERR_MODULE_NOT_FOUND|does not provide an export/.test(log) && !r.error;
    killed += Number(ok); console.log(`${ok ? 'killed' : 'SURVIVED'}: ${name}`);
  }
} finally { fs.writeFileSync(file, original); if (!fs.readFileSync(file).equals(original)) throw Error('branches byte restoration failed'); }
baseline(); console.log(JSON.stringify({ total: cases.length, killed, restored: true }));
if (killed !== cases.length) process.exitCode = 1;
