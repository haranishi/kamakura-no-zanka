// なぜ失敗したか: 形状の退行を、構文や読み込みの失敗ではなくassertionで検出する。
// Every mutation restores the original bytes, including on interruption/error.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const file = 'dist/valley/tree-geometry.js';
const cases = [
  ['flat cedar fronds', 'const segments = level === 0 ? 2 : 1;', 'const segments = 1;'],
  ['uniform exposure', 'const exposure = .28 + .72 * Math.pow((unit[1] + 1) / 2, .65) * shelter;', 'const exposure = 1;'],
  ['one clump per branch', '(maple ? 11 : 13)', '(maple ? 1 : 1)'],
  ['one fork branch', 'const branches = small ? (shrub ? 5 : 4) : 4;', 'const branches = 1;'],
  ['unnormalized normals', 'this.n.push(...norm(n))', 'this.n.push(...n)'],
  ['protruding trunk head', '[.12, fork, .1]', '[.12, h * 1.6, .1]'],
  ['triangle budget overflow', 'level === 0 ? (maple ? 11 : 13) : 6', 'level === 0 ? 40 : 6'],
  ['single far cone', 'i < 4; i++) cone(leaf', 'i < 1; i++) cone(leaf'],
  ['black needle core', '[.022, .045, .020]', '[.008, .016, .009]'],
  ['floating trunk foot', '[0, -.1, 0]', '[0, .2, 0]'],
  ['invalid flutter weight', '.2 + .8 * Math.sin(theta)', '.2 + 2 * Math.sin(theta)'],
  ['invalid UV', 'circumference / tile * k / sides', 'NaN * k / sides'],
  ['thin maple crown', '[3.9,2.9,3.9]', '[3.9,.29,3.9]'],
  ['missing inner shelter', 'const shelter = 1 - .65 *', 'const shelter = 1 - 0 *'],
  ['one UV tile per shell', 'circumference / tile * k / sides', 'k / sides'],
  ['one vertical UV tile', 'arc / tile * (1 - j / bands)', '(1 - j / bands)'],
  ['coplanar branch tips', 'center[1] - 1.4 + b * .65', 'center[1]'],
  ['six-sided far crown', ')), 12, 3, 0, rnd)', ')), 6, 3, 0, rnd)'],
  ['smooth cedar mid cone', 'const rows = 9, sides = 12;', 'cone(leaf, 3, 20.8, 3.45, 12, 0); const rows = 0, sides = 12;'],
  ['core UV outside opaque corner', 'core ? [.03, .03]', 'core ? [.5, .5]'],
  ['black cedar skirt', 'j ? .42 : .9', 'j ? .12 : .9'],
  ['coarse small leaf tiles', 'rnd, small ? .6 : 1', 'rnd, 1'],
];
const original = fs.readFileSync(file);
const run = () => spawnSync(process.execPath, ['--test', 'tests/valley-tree-geometry.test.mjs'], { encoding: 'utf8', timeout: 30000 });
function baseline() { const r = run(); if (r.status !== 0) throw Error('geometry baseline failed\n' + r.stdout + r.stderr); }
baseline(); let killed = 0;
try {
  for (const [name, from, to] of cases) {
    if (!original.toString().includes(from)) throw Error('mutation target missing: ' + name);
    let r; try { fs.writeFileSync(file, original.toString().replace(from, to)); r = run(); } finally { fs.writeFileSync(file, original); }
    const log = r.stdout + r.stderr;
    const ok = r.status !== 0 && /AssertionError/.test(log) && /(?:#|ℹ) fail [1-9]/.test(log) && !/SyntaxError|ERR_MODULE_NOT_FOUND|does not provide an export/.test(log) && !r.error;
    killed += Number(ok); console.log(`${ok ? 'killed' : 'SURVIVED'}: ${name}`);
  }
} finally { fs.writeFileSync(file, original); if (!fs.readFileSync(file).equals(original)) throw Error('geometry byte restoration failed'); }
baseline(); console.log(JSON.stringify({ total: cases.length, killed, restored: true }));
if (killed !== cases.length) process.exitCode = 1;
