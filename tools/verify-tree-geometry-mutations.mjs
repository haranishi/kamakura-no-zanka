// なぜ失敗したか: 形状の退行を、構文や読み込みの失敗ではなくassertionで検出する。
// Every mutation restores the original bytes, including on interruption/error.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const file = 'dist/valley/tree-geometry.js';
const cases = [
  ['missing middle noise octave', '.05 * wave(1.6)', '0 * wave(1.6)'],
  ['wide slim cedar', 'slim ? .62 : 1', 'slim ? 1 : 1'],
  ['missing irregular cedar lean', '.6 * Math.max(0, y) / 20', '0 * Math.max(0, y) / 20'],
  ['cylindrical UV returned', 'const uv = [u*Math.cos(angle)-v*Math.sin(angle)+shift[0], u*Math.sin(angle)+v*Math.cos(angle)+shift[1]];', 'const uv = [Math.atan2(p[2]-center[2],p[0]-center[0])/TAU, p[1]/tile];'],
  ['aligned clump UV rotation', 'angle = rnd() * TAU', 'angle = 0'],
  ['high far dome', 'level === 2 ? (maple ? 4.7 : 7.4)', 'level === 2 ? (maple ? 6.7 : 10.4)'],
  ['short middle trunk', 'level === 1 ? (maple ? 5.4 : 8.2)', 'level === 1 ? (maple ? 2 : 3.5)'],
  ['thin far trunk', 'level === 2 ? (maple ? .46 : .52)', 'level === 2 ? (maple ? .1 : .1)'],
  ['round sapling candy', '[.92,1.27,.88]', '[1.05,1,1]'],
  ['floating shrub', 'shrub ? .51 : 1.72', 'shrub ? .85 : 1.72'],
  ['missing clump bias', '[exposure * (1 + .9 * delta), exposure, exposure * (1 - delta)]', '[exposure, exposure, exposure]'],

  ['diamond understory shells', 'small ? (level === 0 ? 14 : 8) : level === 0 ? 16 : 10, small ? (level === 0 ? 7 : 4) : level === 0 ? 8 : 5', 'small ? 4 : level === 0 ? 10 : 8, small ? 2 : 4'],
  ['separated understory balls', '(small ? .22 : .56)', '(small ? .85 : .56)'],
  ['three-band middle broadleaf', 'small ? (level === 0 ? 7 : 4) : level === 0 ? 8 : 5, small ? .6', 'small ? (level === 0 ? 5 : 4) : 3, small ? .6'],
  ['three-band far broadleaf', 'dome, 10, 5, 1, false', 'dome, 8, 3, 1, false'],

  ['uniform exposure', 'const exposure = .28 + .72 * Math.pow((facing[1] + 1) / 2, .65) * shelter;', 'const exposure = 1;'],
  ['one clump per branch', 'clustered ? BROAD_CLUSTERS : 6', 'clustered ? 1 : 1'],
  ['one fork branch', 'const branches = small ? (shrub ? 5 : 4) : [4, 3, 5][shape];', 'const branches = 1;'],
  ['unnormalized normals', 'this.n.push(...norm(n))', 'this.n.push(...n)'],
  ['protruding trunk head', '[.12, fork, .1]', '[.12, h * 1.6, .1]'],
  ['triangle budget overflow', 'crown(leaf, c.center, c.radii, 12, 6, 1, false, c.rotation, 0, .09)', 'crown(leaf, c.center, c.radii, 40, 6, 1, false, c.rotation, 0, .09)'],
  ['single far cone', 'i < 4; i++) cone(leaf', 'i < 1; i++) cone(leaf'],
  ['floating trunk foot', '[0, -.1, 0]', '[0, .2, 0]'],
  ['invalid flutter weight', '.2 + .8 * Math.sin(theta)', '.2 + 2 * Math.sin(theta)'],
  ['invalid UV', 'u*Math.cos(angle)-v*Math.sin(angle)+shift[0]', 'NaN'],
  ['thin maple crown', '[3.9,2.9,3.9]', '[3.9,.29,3.9]'],
  ['missing inner shelter', 'const shelter = 1 - .65 *', 'const shelter = 1 - 0 *'],
  ['one UV tile per shell', 'u = p[axes[0]] / tile', 'u = p[axes[0]] / (tile * 8)'],
  ['one vertical UV tile', 'v = p[axes[1]] / tile', 'v = p[axes[1]] / (tile * 8)'],
  ['coplanar branch tips', 'center[1] - 1.4 + b * .65', 'center[1]'],
  ['coarse small leaf tiles', 'small ? .6 : 1, false', '1, false'],
  ['core returned to leaf mesh', 'clump(wood, center, radii.map(v => v * .55)', 'clump(leaf, center, radii.map(v => v * .55)'],
  ['bright core', 'core ? [.06, .05, .03]', 'core ? [.6, .5, .3]'],
  ['broadleaf cards returned', 'const first = m.s.length, indexFirst = m.i.length;\n  m.parts', 'm.vert([0,8,0],[0,1,0],[1,1,1]); m.vert([1,8,0],[0,1,0],[1,1,1]); m.vert([0,9,0],[0,1,0],[1,1,1]); m.tri(m.s.length-3,m.s.length-2,m.s.length-1); const first = m.s.length, indexFirst = m.i.length;\n  m.parts'],
  ['coarse near shell', 'small ? (level === 0 ? 14 : 8) : level === 0 ? 16 : 10', '8'],
  ['single far broadleaf clump', 'crown(leaf, [center[0] + radii[0] * .67, h * .42, center[2] - radii[2] * .24], radii.map(v => v * .49), 8, 4, 1, false, 1.13 + phase, -.09, .12);', '/* missing shoulder */'],
  ['remove shell wobble', 'crownNoise(unit.map((v,q) => center[q] + radii[q] * v))', '0'],
  ['pine back to disks', 'pineFan(leaf, center, k / cards * TAU + i * 2.399 + shape * .7, k % 5 === 0 ? -.25 : .55 + .15 * Math.sin(k * 2.399 + i))', 'clump(leaf, center, [2.4,.1,2.4], 8, 3)'],
  ['inward pine normals', 'const n = [Math.cos(angle) * Math.sin(tilt)', 'const n = [-Math.cos(angle) * Math.sin(tilt)'],
  ['pine cards centred instead of rooted', 'up[q] * t * length', 'up[q] * (t - .5) * length'],
  ['ignore shape argument', 'const key = `${species}/${level}/${shape}`;', 'shape = 0; const key = `${species}/${level}/${shape}`;'],
  ['dome returned to a plate', '[3.9 * aspect,2.7 / aspect,3.9 * aspect]', '[3.9 * aspect,.27 / aspect,3.9 * aspect]'],
  ['understory radial jitter removed', 'small ? .14 : .09', 'small ? 0 : .09'],
  ['short sapling trunk gap', 'small ? 1.8 : level', 'small ? .3 : level'],
  // 8.1a（近景の枝と房・中景の房・樹皮のUV・芯の印）。
  ['near core cone returned', "const plan = cedarBranchPlan(shape);\n", "const plan = cedarBranchPlan(shape); cone(wood, 3, 19.7, 1.35, 8, .3, [.07, .12, .055]);\n"],
  ['near limbs omitted', 'if (b.wood) { const s = [0, .45, .85];', 'if (false) { const s = [0, .45, .85];'],
  ['one card per tuft', 'for (const card of tuftCards(tuft)) {', 'for (const card of tuftCards(tuft).slice(0, 1)) {'],
  ['tuft root sways like its tip', 'uvs[k], k >= 2 ? 1 : .3);', 'uvs[k], 1);'],
  ['middle core cone returned', '  for (const tuft of cedarMidPlan(shape).tufts) cedarTuft(leaf, tuft, shape);\n}', '  for (const tuft of cedarMidPlan(shape).tufts) cedarTuft(leaf, tuft, shape);\n  cone(wood, 3, 19.7, 1.4, 8, .3, [.055, .1, .045]);\n}'],
  ['middle tufts unlit', 'for (const tuft of cedarMidPlan(shape).tufts) cedarTuft(leaf, tuft, shape);', 'for (const tuft of cedarMidPlan(shape).tufts) cedarTuft(leaf, tuft, shape, .5);'],
  ['middle skirts returned', 'for (const tuft of cedarMidPlan(shape).tufts) cedarTuft(leaf, tuft, shape);', `for (let i = 0; i < 9; i++) { const first = leaf.s.length, y = 3 + i * 2.1, r = 3.4 * (1 - i / 9); for (let j = 0; j < 2; j++) for (let k = 0; k <= 12; k++) { const a = k / 12 * TAU; leaf.vert([Math.cos(a) * r * (j ? 1 : .24), y + (j ? -.65 : 1), Math.sin(a) * r * (j ? 1 : .24)], [Math.cos(a), .5, Math.sin(a)], [.6, .6, .6], [k / 12 * 3, j ? 0 : 1], j ? 1 : .4); } for (let k = 0; k < 12; k++) { const v = first + k; leaf.quad(v, v + 1, v + 14, v + 13); } }`],
  ['atlas UV spills into the other spray', 'half = .23,', 'half = .3,'],
  ['bark UV per tube instead of metres', 'barkUV(k, sides, t, length, radius)', '[k / sides, t]'],
  ['core carries bark', "core ? NO_BARK : [circumference / tile * k / sides, p[1] / tile]", "[circumference / tile * k / sides, p[1] / tile]"],
  // 'cedar core carries bark' left with the middle cedar's core cone (8.1a second round); broadleaf cores keep their mark below.
  ['middle broadleaf limbs dropped', 'if (level === 1 && !small) for (const l of broadLimbs', 'if (false) for (const l of broadLimbs'],
  // 8.1a second round: root flare, clustered near broadleaf and sapling crowns.
  ['no root flare rings', 'if (flared) steps.splice(1, 0,', 'if (false) steps.splice(1, 0,'],
  ['flat trunk foot', 'flared ? 1 + .85 * Math.exp(-h / .5)', 'flared ? 1 + 0 * Math.exp(-h / .5)'],
  ['sapling ball returned', 'sapling = species === 4 && level === 0;', 'sapling = false;'],
  ['clusters without limbs', 'tube(wood, c.limb.from, c.limb.to, c.limb.radius, 3, 1); crown(leaf, c.center', 'crown(leaf, c.center'],
  ['dark core behind the near clusters', "    crown(leaf, [0, center[1] - .1 * radii[1], 0], radii.map(v => v * .42), 12, 6, 1, false, .4, 0, .09);\n    return;", "    crown(leaf, [0, center[1] - .1 * radii[1], 0], radii.map(v => v * .42), 12, 6, 1, false, .4, 0, .09);\n    clump(wood, center, radii.map(v => v * .35), 6, 2, 1, true);\n    return;"],
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
