// なぜ失敗したか: 形状の退行を、構文や読み込みの失敗ではなくassertionで検出する。
// Every mutation restores the original bytes, including on interruption/error.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const file = 'dist/valley/tree-geometry.js';
const cases = [
  ['cylindrical UV returned', 'const uv = [u*Math.cos(angle)-v*Math.sin(angle)+shift[0], u*Math.sin(angle)+v*Math.cos(angle)+shift[1]];', 'const uv = [Math.atan2(p[2]-center[2],p[0]-center[0])/TAU, p[1]/tile];'],
  ['aligned clump UV rotation', 'angle = rnd() * TAU', 'angle = 0'],
  ['high far dome', 'level === 2 ? (maple ? 4.7 : 7.4)', 'level === 2 ? (maple ? 6.7 : 10.4)'],
  ['short middle trunk', 'level === 1 ? (maple ? 5.4 : 8.2)', 'level === 1 ? (maple ? 2 : 3.5)'],
  ['thin far trunk', 'level === 2 ? (maple ? .46 : .52)', 'level === 2 ? (maple ? .1 : .1)'],
  ['round sapling candy', '[.92,1.27,.88]', '[1.05,1,1]'],
  ['floating shrub', 'shrub ? .51 : 1.72', 'shrub ? .85 : 1.72'],
  ['missing clump bias', '[exposure * (1 + .9 * delta), exposure, exposure * (1 - delta)]', '[exposure, exposure, exposure]'],

  ['diamond understory shells', 'small ? (level === 0 ? 12 : 8) : level === 0 ? 10 : 8, small ? (level === 0 ? 5 : 4) : 4', 'small ? 4 : level === 0 ? 10 : 8, small ? 2 : 4'],
  ['separated understory balls', '(small ? .22 : .56)', '(small ? .85 : .56)'],
  ['three-band middle broadleaf', 'small ? (level === 0 ? 5 : 4) : 4, small ? .6', 'small ? (level === 0 ? 5 : 4) : 3, small ? .6'],
  ['three-band far broadleaf', 'dome, 8, 5, 1, false', 'dome, 8, 3, 1, false'],
  ['thick near cedar core', '19.7, 1.35, 8', '19.7, 2.15, 8'],
  ['open near cedar core', '[.07, .12, .055], true', '[.07, .12, .055], false'],
  ['black near cedar core', '[.07, .12, .055]', '[.022, .045, .020]'],
  ['inward cedar bottom cap', 'm.tri(bottom, first + 1 + k, first + 2 + k)', 'm.tri(bottom, first + 2 + k, first + 1 + k)'],

  ['flat cedar fronds', 'const segments = level === 0 ? 2 : 1;', 'const segments = 1;'],
  ['uniform exposure', 'const exposure = .28 + .72 * Math.pow((facing[1] + 1) / 2, .65) * shelter;', 'const exposure = 1;'],
  ['one clump per branch', '(maple ? [11, 12, 10][shape] : [13, 12, 13][shape])', '(maple ? 1 : 1)'],
  ['one fork branch', 'const branches = small ? (shrub ? 5 : 4) : [4, 3, 5][shape];', 'const branches = 1;'],
  ['unnormalized normals', 'this.n.push(...norm(n))', 'this.n.push(...n)'],
  ['protruding trunk head', '[.12, fork, .1]', '[.12, h * 1.6, .1]'],
  ['triangle budget overflow', 'level === 0 ? (maple ? [11, 12, 10][shape] : [13, 12, 13][shape]) : 5', 'level === 0 ? 40 : 5'],
  ['single far cone', 'i < 4; i++) cone(leaf', 'i < 1; i++) cone(leaf'],
  ['black needle core', '[.022, .045, .020]', '[.008, .016, .009]'],
  ['floating trunk foot', '[0, -.1, 0]', '[0, .2, 0]'],
  ['invalid flutter weight', '.2 + .8 * Math.sin(theta)', '.2 + 2 * Math.sin(theta)'],
  ['invalid UV', 'u*Math.cos(angle)-v*Math.sin(angle)+shift[0]', 'NaN'],
  ['thin maple crown', '[3.9,2.9,3.9]', '[3.9,.29,3.9]'],
  ['missing inner shelter', 'const shelter = 1 - .65 *', 'const shelter = 1 - 0 *'],
  ['one UV tile per shell', 'u = p[axes[0]] / tile', 'u = p[axes[0]] / (tile * 8)'],
  ['one vertical UV tile', 'v = p[axes[1]] / tile', 'v = p[axes[1]] / (tile * 8)'],
  ['coplanar branch tips', 'center[1] - 1.4 + b * .65', 'center[1]'],
  ['smooth cedar mid cone', 'const rows = [9, 8, 10][shape], sides = 12;', 'cone(leaf, 3, 20.8, 3.45, 12, 0); const rows = 0, sides = 12;'],
  ['black cedar skirt', 'j ? .48 : .85', 'j ? .12 : .85'],
  ['coarse small leaf tiles', 'small ? .6 : 1, false', '1, false'],
  ['core returned to leaf mesh', 'clump(wood, center, radii.map(v => v * .55)', 'clump(leaf, center, radii.map(v => v * .55)'],
  ['bright core', 'core ? [.06, .05, .03]', 'core ? [.6, .5, .3]'],
  ['broadleaf cards returned', 'const first = m.s.length, indexFirst = m.i.length;\n  m.parts', 'm.vert([0,8,0],[0,1,0],[1,1,1]); m.vert([1,8,0],[0,1,0],[1,1,1]); m.vert([0,9,0],[0,1,0],[1,1,1]); m.tri(m.s.length-3,m.s.length-2,m.s.length-1); const first = m.s.length, indexFirst = m.i.length;\n  m.parts'],
  ['coarse near shell', 'small ? (level === 0 ? 12 : 8) : level === 0 ? 10 : 8', '8'],
  ['single far broadleaf clump', 'crown(leaf, [center[0] + radii[0] * .67, h * .42, center[2] - radii[2] * .24], radii.map(v => v * .49), 8, 5, 1, false, 1.13 + phase, -.09, .12);', '/* missing shoulder */'],
  ['remove shell wobble', '1 + jitter * Math.sin', '1 + 0 * Math.sin'],
  ['pine back to disks', 'pineFan(leaf, center, k / cards * TAU + i * 2.399 + shape * .7, k % 5 === 0 ? -.25 : .55 + .15 * Math.sin(k * 2.399 + i))', 'clump(leaf, center, [2.4,.1,2.4], 8, 3)'],
  ['inward pine normals', 'const n = [Math.cos(angle) * Math.sin(tilt)', 'const n = [-Math.cos(angle) * Math.sin(tilt)'],
  ['pine cards centred instead of rooted', 'up[q] * t * length', 'up[q] * (t - .5) * length'],
  ['ignore shape argument', 'const key = `${species}/${level}/${shape}`;', 'shape = 0; const key = `${species}/${level}/${shape}`;'],
  ['dome returned to a plate', '[3.9 * aspect,2.7 / aspect,3.9 * aspect]', '[3.9 * aspect,.27 / aspect,3.9 * aspect]'],
  ['understory radial jitter removed', 'small ? .14 : .09', 'small ? 0 : .09'],
  ['short sapling trunk gap', 'small ? 1.8 : level', 'small ? .3 : level'],
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
