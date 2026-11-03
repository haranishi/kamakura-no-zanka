// 8.3b の変異試験：被弾・弾かれ・倒れの腕の開きの上限（arm-spread.js）。
// 変異は1件ずつ適用し、成功・失敗のどちらでも元のバイト列へ戻す。各変異に対応する試験の緑を先に確かめる（verify-impact-mutations.mjs と同じ形）。
// 実ゲームの測り（焼き込んだ動作の開きの角）は tools/scenarios/measure-arm-spread.mjs。
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const A = 'dist/valley/arm-spread.js', T = 'tests/valley-arm-spread.test.mjs';
// 名前、対象、置換前、置換後、対象の試験名（正規表現）
const cases = [
  ['倒れの上限を90度にする', A, 'dead: 40,', 'dead: 90,', '上限の選び方'],
  ['生きている人にも上限をかける', A, '  if (dead) return SPREAD.dead;\n', '  return SPREAD.dead;\n', '上限の選び方'],
  ['越えた分でなく角の全部を寄せる', A, 'const over = theta - capDeg * Math.PI / 180;', 'const over = theta;', '寄せる角'],
  ['軸の向きを逆にする（腕を外へ開く）', A, 'out[0] = cx / lc; out[1] = cy / lc; out[2] = cz / lc;', 'out[0] = -cx / lc; out[1] = -cy / lc; out[2] = -cz / lc;', '寄せる角'],
  ['軸を正規化しない', A, 'out[0] = cx / lc; out[1] = cy / lc; out[2] = cz / lc;', 'out[0] = cx; out[1] = cy; out[2] = cz;', '寄せる角'],
  ['胴の下向きを見ずに世界の下を使う', A, 'const c = (ax * dx + ay * dy + az * dz) / (la * ld)', 'const c = -ay / la', '寄せる角'],
  ['上限の内でも寄せる', A, '  if (!(over > 0)) return out;\n', '', '上限の内'],
  ['平行の腕を見分けない', A, '  if (!(lc > 1e-6 * la * ld)) return out;', '  if (!(lc > 0)) return out;', '上限の内'],
  ['上限0でも寄せる', A, "if (!(capDeg > 0) || !(weight > 0)", "if (!(weight > 0)", '上限の内'],
  ['効きを掛けない', A, 'out[3] = over * Math.min(1, weight);', 'out[3] = over;', '効き：'],
  ['効きの頭打ちを外す', A, 'out[3] = over * Math.min(1, weight);', 'out[3] = over * weight;', '効き：'],
  ['効きを1コマで1へ跳ばす', A, 'return w + ((on ? 1 : 0) - w) * k;', 'return on ? 1 : 0;', '効きの追い方'],
  ['効きの速さを刻み幅に比例させる', A, 'const k = 1 - Math.exp(-SPREAD.rate * dt);', 'const k = Math.min(1, SPREAD.rate / 60);', '効きの追い方'],
  ['負の刻みでも効きを進める', A, '  if (!(dt > 0)) return w;\n', '', '効きの追い方'],
  ['受け渡しの配列でなく新しい配列を返す', A, '  out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0;\n', '  out = [0, 0, 0, 0];\n', '新規確保'],
];
const run = pattern => spawnSync(process.execPath, ['--test', '--test-name-pattern', pattern, T], { encoding: 'utf8', timeout: 120000 });
const logOf = r => (r.stdout || '') + (r.stderr || '');
const failedCount = r => Number(logOf(r).match(/(?:#|ℹ) fail (\d+)/)?.[1] || 0);
const testsCount = r => Number(logOf(r).match(/(?:#|ℹ) pass (\d+)/)?.[1] || 0);
const baselines = new Set(), results = [];
for (const [name, file, original, replacement, pattern] of cases) {
  if (!baselines.has(pattern)) {
    const baseline = run(pattern);
    if (baseline.status !== 0 || baseline.error || testsCount(baseline) < 1) throw Error('対象試験の基準が不合格: ' + name + '\n' + logOf(baseline));
    baselines.add(pattern);
  }
  const source = fs.readFileSync(file), text = source.toString('utf8');
  if (text.split(original).length !== 2) throw Error('置換箇所は1件必要: ' + name);
  let result;
  try {
    fs.writeFileSync(file, text.replace(original, replacement));
    result = run(pattern);
  } finally {
    fs.writeFileSync(file, source);
  }
  if (!fs.readFileSync(file).equals(source)) throw Error('元のバイト列へ戻せなかった: ' + file);
  const log = logOf(result), failed = failedCount(result);
  const killed = result.status !== 0 && failed > 0 && !/SyntaxError|ERR_MODULE_NOT_FOUND|does not provide an export/.test(log) && !result.error;
  results.push({ name, killed: Boolean(killed), failed });
  console.error(`${killed ? 'killed' : 'SURVIVED'}: ${name} (${failed})`);
}
console.log(JSON.stringify({ total: cases.length, killed: results.filter(r => r.killed).length, results: results.map(r => `${r.killed ? '○' : '×'} ${r.name}`) }, null, 1));
if (results.some(r => !r.killed)) process.exitCode = 1;
