// なぜ失敗したか: 平均密度・正方形の板・葉の陰影の退行を、構文エラーと区別して検出する。
// Mutations must cause assertion failures, never syntax/import failures. Restore exact bytes.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const rules = 'dist/valley/grass-field.js', config = 'dist/valley/config.js';
const cases = [
  ['start exclusion restored', rules, 'if (circles.some', 'if (Math.hypot(x - world.start.x, z - world.start.z) < 3 + halfDiagonal) continue;\n    if (circles.some'],
  ['small patch omitted', rules, 'noise(world.seed, x, z, 1 / 3, 593)', '0'],
  ['large patch omitted', rules, 'noise(world.seed, x, z, 1 / 14, 599)', '0'],
  ['patch range narrowed', rules, '1 + .8 * (field.midPatch[k] - mean) / span', '1 + .3 * (field.midPatch[k] - mean) / span'],
  ['tall tufts omitted', rules, 'rng() < .12 ? 1.5 : 1', 'rng() < .12 ? 1 : 1'],
  ['card tilt omitted', rules, '(2 * rng() - 1) * Math.PI / 15', '0 * rng()'],
  ['card brightness omitted', rules, '.8 + .4 * rng()', '1 + 0 * rng()'],
  ['long leaves omitted', rules, 'longRng() < .08 ? 1.5 : 1', 'longRng() < .08 ? 1 : 1'],
  ['near height uniform', rules, '0.75 + 0.55 * rng()', '0.9 + 0.2 * rng()'],
  ['near bend uniform', rules, '.5 + .5 * Math.sin((rng() - .5) * Math.PI)', 'rng()'],
  ['cell budget cap removed', config, 'midMaxCards: 3', 'midMaxCards: 4'],
  ['patch mean correction removed', rules, 'total < weight', 'total < 0'],
  ['mid rate reduced', config, 'midCardRate: 2.0', 'midCardRate: .55'],
  ['mid accounting changed', config, 'cardLeaves: 14', 'cardLeaves: 40'],
  ['mid count ceiling', rules, 'Math.floor(average * patch + rng())', 'Math.ceil(average * patch)'],
  ['mid patch ignored', rules, 'average * patch + rng()', 'average + rng()'],
  ['mid tile keyed count', rules, 'cellRand(field.seed + GRASS.midSeed, x, z)', 'cellRand(field.seed + GRASS.midSeed, tx, tz)'],
  ['mid scale fixed', rules, '.5 + 1.4 * u * u', '1'],
  ['mid width fixed', rules, '1 + GRASS.card.aspect * (2 * rng() - 1)', '1'],
  ['mid height fixed', rules, 'out.sy[i] = (1 + GRASS.card.aspect * (2 * rng() - 1)) * (rng() < .12 ? 1.5 : 1)', 'out.sy[i] = 1'],
  ['mid reflection fixed', rules, 'rng() < .5 ? -1 : 1', '1'],
  ['mid patch target biased', rules, 'total < weight', 'total < weight * 1.2'],
  ['mid triangles omitted', rules, 'q.density * 1.8)), 6', 'q.density * 1.8)), 4'],
  ['density floor', rules, 'const density = 1 +', 'const density = 0.2 +'],
  ['clearing threshold', config, 'clearingFraction: 0.10', 'clearingFraction: 0.01'],
  ['road exclusion', rules, 'if (road && (road.w > 0.35 || road.dist < 2.8))', 'if (false)'],
  ['water exclusion', rules, 'terrain.waterAt(x, z) > 0.05', 'false'],
  ['footprint exclusion', rules, 'if (world.buildings.some(b => insideFootprint(b, x, z, 0.4 + halfDiagonal)))', 'if (false)'],
  ['slope exclusion', rules, 'if (terrain.slopeAt(x, z, 1) > 32)', 'if (false)'],
  ['species threshold', config, 'tallThreshold: 0.30', 'tallThreshold: 2'],
  ['position-independent stream', rules, 'cellRand(field.seed + GRASS.seed, x, z)', 'cellRand(field.seed + GRASS.seed, 0, 0)'],
  ['light density', config, 'density: 0.4, distance: 0.6', 'density: 0.3, distance: 0.6'],
  ['light distance', config, 'density: 0.4, distance: 0.6', 'density: 0.4, distance: 0.8'],
  ['height multiplier', rules, '(0.8 + field.height[k] * 0.55 / 255) * (0.75', '(1.35 + field.height[k] * 0.55 / 255) * (0.75'],
  ['tile ordinal stream', rules, 'cellRand(field.seed + GRASS.seed, x, z)', 'cellRand(field.seed + GRASS.seed, tx, tz)'],
  ['forest exclusion', rules, 'if (forest > 0.80)', 'if (false)'],
  ['plot exclusion', rules, 'if ((world.plots || []).some(p => insidePlot(p, x, z, 0.4 + halfDiagonal)))', 'if (false)'],
  ['mid density', config, 'midDensity: 20', 'midDensity: 2'],
  ['root sink', config, 'sink: 0.02', 'sink: 0'],
  ['unclustered species', rules, 'const s = noise(world.seed, x, z, GRASS.speciesScale, 557);', 'const s = cellRand(world.seed + 557, Math.floor(x), Math.floor(z))() * 2 - 1;'],
  ['tangent tile omission', rules, 'Math.ceil((z - outer) / size) - 1', 'Math.floor((z - outer) / size)'],
  ['ribbon width', config, 'w: [0.022, 0.032]', 'w: [0.04, 0.05]'],
];
const run = () => spawnSync(process.execPath, ['--test', '--test-name-pattern=^(?!legacy)', 'tests/valley-grass-field.test.mjs'], { encoding: 'utf8', timeout: 30000 });
const files = [...new Set(cases.map(c => c[1]))], originals = new Map(files.map(file => [file, fs.readFileSync(file)]));
const baseline = run();
if (baseline.status !== 0) throw Error('Grass mutation baseline failed\n' + baseline.stdout + baseline.stderr);
const results = [];
try {
  for (const [name, file, from, to] of cases) {
    const source = originals.get(file).toString();
    if (!source.includes(from)) throw Error(`Mutation not found: ${name}`);
    let result;
    try { fs.writeFileSync(file, source.replace(from, to)); result = run(); }
    finally { fs.writeFileSync(file, originals.get(file)); }
    const log = result.stdout + result.stderr;
    const failures = Number(log.match(/(?:#|ℹ) fail (\d+)/)?.[1] || 0);
    const killed = result.status !== 0 && failures > 0 && /AssertionError/.test(log) && !/SyntaxError|ERR_MODULE_NOT_FOUND|does not provide an export/.test(log) && !result.error;
    results.push({ name, killed: !!killed, failures });
    console.log(`${killed ? 'killed' : 'SURVIVED'}: ${name} (${failures})`);
  }
} finally {
  for (const [file, source] of originals) {
    fs.writeFileSync(file, source);
    if (!fs.readFileSync(file).equals(source)) throw Error(`Restoration failed: ${file}`);
  }
}
const restored = run();
if (restored.status !== 0) throw Error('Restored grass baseline failed\n' + restored.stdout + restored.stderr);
console.log(JSON.stringify({ total: cases.length, killed: results.filter(r => r.killed).length, restored: true, results }, null, 2));
if (results.some(r => !r.killed)) process.exitCode = 1;
