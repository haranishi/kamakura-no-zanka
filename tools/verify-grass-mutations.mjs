// Mutations must cause assertion failures, never syntax/import failures. Restore exact bytes.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const rules = 'dist/valley/grass-field.js', config = 'dist/valley/config.js';
const cases = [
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
  ['height multiplier', rules, '(0.8 + field.height[k] * 0.55 / 255) * (0.9', '(1.35 + field.height[k] * 0.55 / 255) * (0.9'],
  ['tile ordinal stream', rules, 'cellRand(field.seed + GRASS.seed, x, z)', 'cellRand(field.seed + GRASS.seed, tx, tz)'],
  ['forest exclusion', rules, 'if (forest > 0.80)', 'if (false)'],
  ['plot exclusion', rules, 'if ((world.plots || []).some(p => insidePlot(p, x, z, 0.4 + halfDiagonal)))', 'if (false)'],
  ['mid density', config, 'midDensity: 20', 'midDensity: 2'],
  ['root sink', config, 'sink: 0.02', 'sink: 0'],
  ['unclustered species', rules, 'const s = noise(world.seed, x, z, GRASS.speciesScale, 557);', 'const s = cellRand(world.seed + 557, Math.floor(x), Math.floor(z))() * 2 - 1;'],
  ['tangent tile omission', rules, 'Math.ceil((z - outer) / size) - 1', 'Math.floor((z - outer) / size)'],
  ['ribbon width', config, 'w: [0.015, 0.022]', 'w: [0.04, 0.05]'],
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
