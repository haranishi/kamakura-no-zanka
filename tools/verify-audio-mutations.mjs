// One mutation at a time. Always restore the original bytes, even on a failed test.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const rules = 'dist/valley/audio-rules.js', bank = 'dist/valley/voice-bank.js';
const tests = ['tests/valley-audio-rules.test.mjs', 'tests/valley-voice-bank.test.mjs'];
const cases = [
  ['step repetition', rules, 'if (seed === last?.seed)', 'if (false)'],
  ['gain ordering', 'dist/valley/config.js', 'radius: 11, gain: 0.8', 'radius: 11, gain: 0.1'],
  ['priority', bank, 'v.priority <= priority', 'v.priority >= priority'],
  ['oldest', bank, '.sort((a, b) => a.startAt - b.startAt || a.order - b.order)', '.sort((a, b) => b.startAt - a.startAt || b.order - a.order)'],
  ['28 boundary', bank, 'VOICE_LIMIT = 28', 'VOICE_LIMIT = 29'],
  ['pitch range', rules, '(random(rng) * 2 - 1) * 0.05', '(random(rng) * 2 - 1) * 0.07'],
  ['22m boundary', rules, 'audible: distance < 22', 'audible: distance <= 22'],
  ['radius table', 'dist/valley/config.js', 'radius: 11, gain: 0.8', 'radius: 10, gain: 0.8'],
  ['variant repetition', rules, 'return n === last ?', 'return false ?'],
  ['pending boundary', bank, 'bank.pending.length >= bank.waitLimit', 'bank.pending.length > bank.waitLimit'],
  ['tail release', bank, 'v.children === 0 && v.tailDone', 'v.children === 0'],
  ['reserved slot', bank, 'usedSlots.size < bank.limit', 'bank.active.length < bank.limit'],
];
// Establish a green baseline; syntax/import failures never count as detection.
const run = () => spawnSync(process.execPath, ['--test', ...tests], { encoding: 'utf8', timeout: 30000 });
const baseline = run();
if (baseline.status !== 0) throw Error('Audio mutation baseline failed\n' + baseline.stdout + baseline.stderr);
const results = [];
for (const [name, file, original, replacement] of cases) {
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
