// Mutations must cause assertion failures, never syntax/import failures. Restore exact bytes.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const rules = 'dist/valley/grass-schedule.js';
const cases = [
  ['negative tile ownership', rules, 'Math.floor(tx / n)', 'Math.trunc(tx / n)'],
  ['near chunk size', rules, 'near: 3, mid: 6', 'near: 2, mid: 6'],
  ['chunk tile omission', rules, 'x < n; x++', 'x < n - 1; x++'],
  ['nearest chunk distance', rules, 't.dist < old.dist', 't.dist > old.dist'],
  ['wanted distance ordering', rules, 'a.dist - b.dist || a.cz', 'b.dist - a.dist || a.cz'],
  ['unbounded builds', rules, 'Math.floor(maxBuild)', 'Math.floor(maxBuild) + 1'],
  ['resident rebuilt', rules, '!have.has(c.key)', 'true'],
  ['active chunk eviction', rules, '!active.has(c.key) && c.dist > hysteresis', 'c.dist > hysteresis'],
  ['hysteresis boundary', rules, 'c.dist > hysteresis', 'c.dist >= hysteresis'],
  ['hysteresis ignored', rules, 'c.dist > hysteresis', 'c.dist > 0'],
  ['clump budget omitted', rules, 'base.near.tiles * 13 * 6', '0'],
  ['duplicate builds', rules, '[...new Set(build)]', 'build'],
];
const run = () => spawnSync(process.execPath, ['--test', 'tests/valley-grass-schedule.test.mjs'], { encoding: 'utf8', timeout: 30000 });
const files = [...new Set(cases.map(c => c[1]))], originals = new Map(files.map(file => [file, fs.readFileSync(file)]));
const baseline = run();
if (baseline.status !== 0) throw Error('Grass schedule mutation baseline failed\n' + baseline.stdout + baseline.stderr);
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
if (restored.status !== 0) throw Error('Restored grass schedule baseline failed\n' + restored.stdout + restored.stderr);
console.log(JSON.stringify({ total: cases.length, killed: results.filter(r => r.killed).length, restored: true, results }, null, 2));
if (results.some(r => !r.killed)) process.exitCode = 1;
