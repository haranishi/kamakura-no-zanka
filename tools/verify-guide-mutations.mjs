// 開発用: 1変異ずつ適用し、落ちることを確認してfinallyで必ず元へ戻す。並列で実行しない。
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const guide = 'dist/valley/guide.js', story = 'dist/valley/story-data.js';
const unit = ['tests/valley-guide.test.mjs'], world = ['tests/valley-guide-world.test.mjs'];
const cases = [
  ['route bearing', guide, 'TURN_DEG = 30', 'TURN_DEG = 181', unit],
  ['mandatory points', guide, 'for (const index of indices)', 'for (const index of indices.slice(1))', unit],
  ['road corridor', guide, 'return Math.min(...ps.slice(1)', 'return 0 * Math.min(...ps.slice(1)', unit],
  ['correction log', guide, 'meters: dist(to, stop.point)', 'meters: 0', unit],
  ['25m boundary', guide, 'distance >= OFF_ROAD', 'distance > OFF_ROAD', unit],
  ['30s window', guide, 'WINDOW = 30', 'WINDOW = 31', unit],
  ['10m boundary', guide, 'progress30 < PROGRESS', 'progress30 <= PROGRESS', unit],
  ['mode clears history', guide, "prev && mode === 'free' && prev.mode === 'free' ?", 'prev ? ', unit],
  ['mode clock stops', guide, "mode === 'free' && prev?.mode === 'free' ? t - prev.t : 0", 'prev ? t - prev.t : 0', unit],
  ['objective reset', guide, 'JSON.stringify([objectiveId, plan, baselineId])', 'JSON.stringify([plan, baselineId])', unit],
  ['plan reset', guide, 'JSON.stringify([objectiveId, plan, baselineId])', 'JSON.stringify([objectiveId, baselineId])', unit],
  ['restart reset', guide, 'JSON.stringify([objectiveId, plan, baselineId])', 'JSON.stringify([objectiveId, plan])', unit],
  ['result clears emphasis', guide, " || mode === 'result'", '', unit],
  ['release needs distance AND progress', guide, 'distance < RELEASE_DISTANCE && progress30 !== null && progress30 >= PROGRESS', 'distance < RELEASE_DISTANCE || (progress30 !== null && progress30 >= PROGRESS)', unit],
  ['20m release boundary', guide, 'distance < RELEASE_DISTANCE &&', 'distance <= RELEASE_DISTANCE &&', unit],
  ['emphasis keeps samples', guide, 'history.push({ t: clock, remaining });', 'if (prev?.emphasized) history = []; history.push({ t: clock, remaining });', unit],
  ['crossing projection order', guide, 'prev ? Math.min(baseline.points.length - 2, prev.segment + 1) : baseline.points.length - 2', 'baseline.points.length - 2', unit],
  ['passed progress preserved', guide, 'Math.max(prev?.progress || 0, p.s)', 'p.s', unit],
  ['recovery unpassed only', guide, 'baseline.points.length - 2, progress)', 'baseline.points.length - 2, 0)', unit],
  ['fixed baseline off-road', guide, 'const offRoad = distance >= OFF_ROAD;', 'const offRoad = false;', unit],
  ['finite state rejection', guide, "if (typeof v === 'number' && !Number.isFinite(v)) throw new TypeError('Non-finite guide data');", '', unit],
  ['physical obstacle check', 'tools/measure-guide-baselines.mjs', 'nearestFree(data.col, data.terrain, x, z, 0.3, 0) !== null', 'true', world],
  ['center target data', story, "b4_village: 'village_center'", "b4_village: 'village_front'", world],
  ['objective text', story, '見晴らし岩へ——石段を下り、林道を南東へ', '水穂の里へ向かう', world],
];
const results = [];
for (const [name, file, original, replacement, tests] of cases) {
  const source = fs.readFileSync(file, 'utf8');
  if (!source.includes(original)) throw Error(`Mutation not found: ${name}`);
  let result;
  try {
    fs.writeFileSync(file, source.replace(original, replacement));
    result = spawnSync(process.execPath, ['--test', ...tests], { encoding: 'utf8' });
  } finally { fs.writeFileSync(file, source); }
  const log = result.stdout + result.stderr;
  const failed = Number(log.match(/(?:#|ℹ) fail (\d+)/)?.[1] || 0);
  // 構文エラーで落ちたものを規則の検証成功と呼ばない。
  const killed = result.status !== 0 && failed > 0 && !/SyntaxError/.test(log);
  results.push({ name, killed, failed });
  console.error(`${killed ? 'killed' : 'SURVIVED'}: ${name} (${failed})`);
  if (!killed) { console.error(log); break; }
}
console.log(JSON.stringify({ total: results.length, killed: results.filter(r => r.killed).length, results }, null, 2));
if (results.length !== cases.length || results.some(r => !r.killed)) process.exitCode = 1;
