// Apply sequentially and restore the exact bytes in finally, including failed runs.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const file = new URL('../dist/valley/step-surface.js', import.meta.url);
const test = new URL('../tests/valley-step-surface.test.mjs', import.meta.url);
const cases = [
  ['water priority', "if (water >= 0.02 || weights.mud > 0.5)", "if (!wood && (water >= 0.02 || weights.mud > 0.5))"],
  ['wood priority', 'if (wood)', 'if (wood && !stone)'],
  ['stone priority', 'if (stone || weights.rock > 0.5)', 'if ((stone || weights.rock > 0.5) && weights.gravel <= 0.4)'],
  ['gravel priority', 'if (weights.gravel > 0.4)', 'if (weights.gravel > 0.4 && weights.litter <= 0.4)'],
  ['leaves priority', 'if (weights.litter > 0.4)', 'if (weights.litter > 0.4 && weights.dirt <= 0.45)'],
  ['gravel boundary', 'weights.gravel > 0.4', 'weights.gravel >= 0.4'],
  ['dirt boundary', 'weights.dirt > 0.45', 'weights.dirt >= 0.45'],
  ['water boundary', 'water >= 0.02', 'water > 0.02'],
  ['mud boundary', 'weights.mud > 0.5', 'weights.mud >= 0.5'],
  ['rock boundary', 'weights.rock > 0.5', 'weights.rock >= 0.5'],
  ['litter boundary', 'weights.litter > 0.4', 'weights.litter >= 0.4'],
  ['rotation ignored', 'rot = b.rotY ?? 0', 'rot = 0'],
  ['rotation sign', 'c * dx - s * dz', 'c * dx + s * dz'],
  ['margin removed', 'w / 2 + 1', 'w / 2'],
];
const run = () => spawnSync(process.execPath, ['--test', test.pathname], { encoding: 'utf8', timeout: 30000 });
const baseline = run();
if (baseline.status !== 0) throw Error('Step surface mutation baseline failed\n' + baseline.stdout + baseline.stderr);
const results = [];
for (const [name, original, replacement] of cases) {
  const source = fs.readFileSync(file);
  if (!source.toString().includes(original)) throw Error(`Mutation not found: ${name}`);
  let result;
  try {
    fs.writeFileSync(file, source.toString().replace(original, replacement));
    result = run();
  } finally { fs.writeFileSync(file, source); }
  const log = result.stdout + result.stderr;
  const failed = Number(log.match(/(?:#|ℹ) fail (\d+)/)?.[1] || 0);
  const killed = result.status !== 0 && failed > 0 && !/SyntaxError|ERR_MODULE_NOT_FOUND|does not provide an export/.test(log) && !result.error;
  results.push({ name, killed: Boolean(killed), failed });
  console.error(`${killed ? 'killed' : 'SURVIVED'}: ${name} (${failed})`);
}
console.log(JSON.stringify({ total: cases.length, killed: results.filter(r => r.killed).length, results }, null, 2));
if (results.some(r => !r.killed)) process.exitCode = 1;
