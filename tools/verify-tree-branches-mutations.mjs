// なぜ失敗したか: 枝・房・樹皮の計画（tree-branches.js）の退行を、構文や読み込みの失敗ではなくassertionで検出する（8.1a）。
// Every mutation restores the original bytes, including on interruption/error.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const file = 'dist/valley/tree-branches.js';
const cases = [
  ['inner fill outside the core', 'depth = .25 + .2 * rnd()', 'depth = .85 + .2 * rnd()'],
  ['broad clusters of one size', 'size: [s0, sr] = [.2, .2]', 'size: [s0, sr] = [.3, 0]'],
  ['limbs leave at one fraction', 'leave: [l0, lr] = [.4, .3]', 'leave: [l0, lr] = [.55, 0]'],
  ['tufts back on the outer two thirds', '.27 + .73 * (j + 1) / count + (rnd() - .5) * .1, .24, .97', '.36 + .64 * (j + 1) / count + (rnd() - .5) * .1, .34, .97'],
  ['whorl returned (six limbs per height)', 'const s = (i + .5 + .9 * (rnd() - .5)) / n', 'const s = (Math.floor(i / 6) * 6 + .5) / n'],
  ['regular azimuth step', 'const azimuth = i * GOLDEN + (rnd() - .5) * .9;', 'const azimuth = i * GOLDEN + 0 * (rnd() - .5);'],
  ['tips beyond the middle rim', 'Math.min(length, rim - TUFT_REACH * tipSize)', 'Math.min(length * 1.6, rim * 2)'],
  ['one tuft per limb', 'const count = Math.max(2, Math.min(6, Math.round(b.length / .5)));', 'const count = 1;'],
  ['tufts on the bare inner limb', '.27 + .73 * (j + 1) / count', '.02 + .98 * (j + 1) / count'],
  ['tuft off its limb', 'const center = branchPoint(b, s), along', 'const center = branchPoint(b, s * .5), along'],
  ['limb floats off the trunk', 'root = cedarTrunkAxis(shape, y);', 'root = cedarTrunkAxis(shape, y).map((v, q) => q === 1 ? v : v + 1);'],
  ['one spray image', 'variant = rnd() < .5 ? 0 : 1, hue = rnd() * 2 - 1, shade = rnd() * 2 - 1;\n      b.tufts', 'variant = 0 * rnd(), hue = rnd() * 2 - 1, shade = rnd() * 2 - 1;\n      b.tufts'],
  ['no visible limbs', 'wood: length > 1.05 && t < .8', 'wood: false'],
  ['tuft cards not crossed', 'const a = tuft.roll + k * Math.PI / 3', 'const a = tuft.roll'],
  ['inward crown normal', '[out[0] / l, .55, out[2] / l]', '[-out[0] / l, .55, -out[2] / l]'],
  ['flat tuft exposure', '.62 * smooth(.18, 1.02, radial)', '0 * smooth(.18, 1.02, radial)'],
  ['middle tufts stacked as skirts', 'tufts.push({ s, center: branchPoint(b, s),', 'tufts.push({ s, center: [Math.cos(b.azimuth) * 2, 3 + Math.round(b.y / 3) * 3, Math.sin(b.azimuth) * 2],'],
  ['middle tufts short of the rim', 'cover = .64 * b.length + TUFT_REACH * tip.length', 'cover = .2 * b.length'],
  ['bark brightness bias', 'const gain = clamp(1 + 1.15 * (hv - mean), .45, 1.5);', 'const gain = clamp(1.2 + 1.15 * (hv - mean), .45, 1.5);'],
  ['bark seam around the trunk', 'const x = u * 14 + warp', 'const x = u * 14.5 + warp'],
  ['horizontal bark grain', 'periodicNoise(u * 70 + warp * 4, v * 6, 70, 6, 1)', 'periodicNoise(u * 3, v * 90, 3, 90, 1)'],
  ['one leaf orientation', 'const angle = hash(i, 13) * TAU', 'const angle = 0 * hash(i, 13)'],
  // 8.1a second round: limb clustering, tuft jitter, the broadleaf cluster plan and irregular bark strips.
  ['even limb heights (fishbone)', 'phase: rnd() * TAU, amp: .55 }', 'phase: rnd() * TAU, amp: 0 }'],
  ['folding crown warp accepted', "if (!(amp >= 0 && amp < 1) || !(k > 0)) throw new RangeError('crown warp');", ''],
  ['tufts along their limb', 'along = perturbTuft(branchTangent(b, s), rnd)', 'along = branchTangent(b, s + 0 * rnd())'],
  ['tufts turn only in pitch', 'return norm(add(tilted.map(v => v * Math.cos(w)), side, Math.sin(w)));', 'return norm(tilted);'],
  ['one tip tuft size', '(1 + .95 * u)', '(1.45 + 0 * u)'],
  ['broad clusters buried at the centre', 'const depth = d0 + dr * rnd()', 'const depth = .1 * (d0 + dr * rnd())'],
  ['broad limb off its primary', 'v + (tips[primary][q] - v) * at)', 'v + (tips[primary][q] - v) * at * .5)'],
  ['zelkova clusters narrow upward', 'widen = vase ? 1 + .6 * y : 1', 'widen = vase ? 1 - .6 * y : 1'],
  ['broad clusters swollen together', 'size = s0 + sr * rnd()', 'size = 1.6 * (s0 + sr * rnd())'],
  ['even bark strips', 'export function barkStripWarp(u) { return .22 * Math.sin(TAU * 3 * u + 1.3) + .11 * Math.sin(TAU * 5 * u + .4); }', 'export function barkStripWarp(u) { return 0 * u; }'],
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
