// life-rules.js の変異試験：規則をわざと1か所ずつ壊し、tests/valley-life-rules.test.mjs が落ちることを確かめる。
// 使い方: node tools/verify-life-rules-mutations.mjs。順に当て、失敗した回も含めて finally で元のバイト列へ戻す。
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const file = new URL('../dist/valley/life-rules.js', import.meta.url);
const test = new URL('../tests/valley-life-rules.test.mjs', import.meta.url);
const cases = [
  ['before entering', 'if (!entered) return 1;', 'if (!entered) return 2;'],
  ['entered stage', 'entered: stage >= 4,', 'entered: stage >= 5,'],
  ['front boundary', "if (route === 'front') return food >= FOOD_MEAGER ? 2 : 3;", "if (route === 'front') return food > FOOD_MEAGER ? 2 : 3;"],
  ['flank boundary', "if (route === 'flank') return food >= FOOD_PLENTIFUL ? 1 : 2;", "if (route === 'flank') return food > FOOD_PLENTIFUL ? 1 : 2;"],
  ['front level', 'food >= FOOD_MEAGER ? 2 : 3;', 'food >= FOOD_MEAGER ? 1 : 3;'],
  ['old save route', 'return food >= FOOD_PLENTIFUL ? 1 : food >= FOOD_MEAGER ? 2 : 3;', 'return 2;'],
  ['phase raid', "stage <= 4 ? 'raid'", "stage <= 3 ? 'raid'"],
  ['phase saved', "stage <= 6 ? 'saved'", "stage <= 7 ? 'saved'"],
  ['short beat names', '/^b([0-7])$/', '/^b([0-6])$/'],
  ['food default', 'Math.max(0, finite(r.food, STORY.resources.food))', 'Math.max(0, finite(r.food, 0))'],
  ['trust clamp', 'Math.min(100, Math.max(0, finite(r.trust, STORY.trust)))', 'Math.max(0, finite(r.trust, STORY.trust))'],
  ['route from plan', 'ROUTES.includes(r.plan) ? r.plan : null', 'null'],
  ['joined implies freed', 'captiveFreed: r.captiveFreed === true || archerJoined,', 'captiveFreed: r.captiveFreed === true,'],
  ['gate ruin changes', "rule: () => ({ show: true, state: 'quiet' })", "rule: c => ({ show: c.stage > 0, state: 'quiet' })"],
  ['fire ring threshold', "trust >= TRUST_HIGH ? 'inner'", "trust > TRUST_HIGH ? 'inner'"],
  ['fire ring before ending', "state: c.phase === 'ending' ? fireRing(c.trust) : 'unused'", 'state: fireRing(c.trust)'],
  ['temple lantern early', "rule: c => lantern(c.phase === 'ending')", "rule: c => lantern(c.phase !== 'raid')"],
  ['steps lantern early', 'rule: c => lantern(c.stage >= 6)', 'rule: c => lantern(c.stage >= 5)'],
  ['result rice tier', "['bales', 2]", "['bales', 3]"],
  ['result rice boundary', "food >= FOOD_PLENTIFUL ? ['bales', 3]", "food > FOOD_PLENTIFUL ? ['bales', 3]"],
  ['result rice early', "if (c.phase !== 'ending') return { show: false, state: 'none' };", "if (c.phase === 'raid') return { show: false, state: 'none' };"],
  ['fire in the raid', "rule: c => ({ show: true, state: c.phase === 'raid' ? 'embers' : 'cold' })", "rule: c => ({ show: true, state: c.phase === 'raid' ? 'embers' : 'cold', flame: c.phase === 'raid' })"],
  ['house smoke in the raid', "rule: c => ({ show: c.phase !== 'raid', state: c.phase === 'raid' ? 'stopped' : 'rising' })", "rule: c => ({ show: true, state: c.phase === 'raid' ? 'stopped' : 'rising' })"],
  ['camp smoke stays', "rule: c => ({ show: c.phase === 'raid', state: c.phase === 'raid' ? 'rising' : 'none' })", "rule: c => ({ show: c.stage <= 5, state: c.stage <= 5 ? 'rising' : 'none' })"],
  ['crows early', "state: c.phase === 'ending' ? 'to_peak' : 'circling'", "state: c.phase !== 'raid' ? 'to_peak' : 'circling'"],
  ['fallen fence', 'count: c.damage >= 3 ? 2 : 1', 'count: c.damage >= 2 ? 2 : 1'],
  ['raid marks count', 'count: c.damage })', 'count: 1 })'],
  ['bale count', 'count: 3 + c.damage', 'count: 4 + c.damage'],
  ['bales state', "state: c.phase === 'raid' ? 'carried_out' : 'left_behind'", "state: 'carried_out'"],
  ['rope retied early', "state: c.phase === 'raid' ? 'cut' : 'retied'", "state: c.stage <= 3 ? 'cut' : 'retied'"],
  ['bow follows freed', "show: !c.archerJoined, state: c.archerJoined ? 'none' : 'on_cart'", "show: !c.captiveFreed, state: c.captiveFreed ? 'none' : 'on_cart'"],
  ['threshing', "state: c.phase === 'raid' ? 'scattered' : 'tidy'", "state: 'tidy'"],
  ['laundry', "state: c.phase === 'raid' ? 'fallen' : 'hung'", "state: 'hung'"],
  ['workers boundary', 'count: c.food >= FOOD_PLENTIFUL ? 3 : 2', 'count: c.food >= FOOD_MEAGER ? 3 : 2'],
  ['workers in the raid', "c.phase === 'raid' ? { show: false, state: 'away', count: 0 }", "c.stage <= 3 ? { show: false, state: 'away', count: 0 }"],
  ['paddy', "state: c.phase === 'raid' ? 'hiding' : 'working'", "state: 'working'"],
  ['captive rope', "state: c.captiveFreed ? 'cut' : 'tied'", "state: c.archerJoined ? 'cut' : 'tied'"],
  ['birds stay', "state: c.ambush === null ? 'perched' : 'flown'", "state: c.ambush !== 'cleared' ? 'perched' : 'flown'"],
  ['birds shown', 'show: c.stage === 6,', 'show: c.stage >= 6,'],
  ['scout sword', "show: c.scoutDown, state: c.scoutDown ? 'dropped' : 'none'", "show: c.stage >= 3, state: c.stage >= 3 ? 'dropped' : 'none'"],
  ['hidden count', 'count: r.show ? (r.count ?? 1) : 0', 'count: r.count ?? 1'],
  ['flame flag', 'flame: r.flame === true', 'flame: Boolean(r.show)'],
  ['quest approach', 'approach: s.flags?.approach ?? null', 'approach: s.flags?.plan ?? null'],
  ['quest freed', 'captiveFreed: s.captiveFreed === true', 'captiveFreed: false'],
  ['quest scout', 'scoutDown: scoutDown === true };', 'scoutDown: false };'],
];
const run = () => spawnSync(process.execPath, ['--test', test.pathname], { encoding: 'utf8', timeout: 60000 });
const baseline = run();
if (baseline.status !== 0) throw Error('Life rules mutation baseline failed\n' + baseline.stdout + baseline.stderr);
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
