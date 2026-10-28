// Apply sequentially and restore the exact bytes in finally, including failed runs.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const file = new URL('../dist/valley/foot-contacts.js', import.meta.url);
const test = new URL('../tests/valley-foot-contacts.test.mjs', import.meta.url);
const cases = [
  ['duplicate identity', '(cursor.emitted[index] ?? -1) < loop', 'true'],
  ['identity by foot (multi-contact loss)', 'forEach((c, index) => {', 'forEach((c, index0) => { const index = c.foot;'],
  ['source switch backlog', 'actor.selected === s.clip', 'true'],
  ['tie target', 's.target && !source.target', '!s.target && source.target'],
  ['open lower boundary', 'contactTime > previous', 'contactTime >= previous'],
  ['closed upper boundary', 'contactTime <= now', 'contactTime < now'],
  ['reset baseline', 'obs.reset || !obs.near', 'false || !obs.near'],
  ['far cursor discard', 'obs.reset || !obs.near', 'obs.reset || false'],
  ['stopped suppression', '&& obs.moving &&', '&& true &&'],
  ['maximum weight', 's.weight > source.weight', 's.weight < source.weight'],
  ['airborne suppression', '!obs.airborne', 'true'],
  ['speed conversion', '(now - contactTime) / s.speed', '(now - contactTime)'],
  ['wrap detection', 'cursor.loop++', 'cursor.loop += 0'],
  ['nonpositive speed', '&& s.speed > 0) {', '&& true) {'],
  ['restart ignored', 'else if (s.restart)', 'else if (false)'],
  ['restart keeps old baseline', '{ cursor.loop++; cursor.time = null; }', '{ cursor.loop++; }'],
  ['restart without new identities', '{ cursor.loop++; cursor.time = null; }', '{ cursor.time = null; }'],
];
const run = () => spawnSync(process.execPath, ['--test', test.pathname], { encoding: 'utf8', timeout: 30000 });
const baseline = run();
if (baseline.status !== 0) throw Error('Foot contact mutation baseline failed\n' + baseline.stdout + baseline.stderr);
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
