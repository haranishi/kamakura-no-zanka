// 握り（hand-grip.js・8.6a）の変異試験。verify-sword-layer-mutations.mjs と同じ形：変異は1件ずつ当て、成功・失敗のどちらでも元のバイト列へ戻す。
// 各変異に対応する試験の緑を先に確認する。全試験の合否は別途 npm test で確認する。実行：node tools/verify-hand-grip-mutations.mjs
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const F = 'dist/valley/hand-grip.js', T = 'tests/valley-hand-grip.test.mjs';
// 名前、置換前、置換後、対象の試験名（正規表現）
const cases = [
  ['手のひらの向きを決めない', 'if (dot(n, down) < 0) n = n.map(v => -v);', 'if (false) n = n.map(v => -v);', '実際の手'],
  ['左右の手の向きの決まりを取り違える', "const w = side === 'Left' ? cross(n, f) : cross(f, n);", "const w = side === 'Left' ? cross(f, n) : cross(n, f);", '実際の手'],
  ['親指の側の符号', 'smoothstep(m.wHi + HAND.thumbEdge[0], m.wHi + HAND.thumbEdge[1], pw)', 'smoothstep(m.wHi + HAND.thumbEdge[0], m.wHi + HAND.thumbEdge[1], -pw)', '重みの分け方'],
  ['先の節の重みを中の節の境で切る', 'f2: fing * s2,', 'f2: fing * s1,', '重みの分け方'],
  ['量子化の端数を戻さない', 'out[0][1] += total - out.reduce((s, [, w]) => s + w, 0);', 'out[0][1] += 0;', '影響の量子化'],
  ['影響を5つ残す', '.slice(0, slots);', '.slice(0, slots + 1);', '影響の量子化'],
  ['同じ重みの並びを逆にする', '|| x[0] - y[0])', '|| y[0] - x[0])', '影響の量子化'],
  ['IKの肘を hint の逆へ', 'out.mid[0] = root[0] + dx * along + bx * height;', 'out.mid[0] = root[0] + dx * along - bx * height;', '配列を作らない二関節IK'],
  ['IKの近すぎる距離のクランプを削除', 'const reach = Math.max(near, Math.min(far, distance));', 'const reach = Math.min(far, distance);', '配列を作らない二関節IK'],
  ['届かなくても want のまま', 'return want - (d - clamp(d, -half, half));', 'return want;', '柄のまわりの回り'],
  ['最も近い向きの符号', 'const best = Math.atan2(Q, P)', 'const best = Math.atan2(-Q, P)', '柄のまわりの回り'],
  ['2πずれた同じ向きを返す', 'return want - (d - clamp(d, -half, half));', 'return best + clamp(d, -half, half);', '柄のまわりの回り'],
  ['巻きつけの接線を後ろ側にする', 'const cands = [-beta + spread, -beta - spread]', 'const cands = [-beta - spread, -beta - spread]', '巻きつけの角'],
  ['関節の上限を外す', 'const bend = clamp(want - heading, 0, limits[i]);', 'const bend = Math.max(0, want - heading);', '巻きつけの角'],
  ['中の節の回転の合成を取り違える', 'f1: pose(R12, [[p0, I, R1], [p1, R1, R12]]),', 'f1: pose(R12, [[p0, I, R1], [p1, I, R12]]),', '指の姿勢'],
  ['皮で手のひらの重みを無視する', 'let x = v[0] * split.palm, y = v[1] * split.palm, z = v[2] * split.palm;', 'let x = v[0], y = v[1], z = v[2];', '指の姿勢'],
  ['親指の曲げの軸を逆にする', 'return unit(cross(d, m.n));', 'return unit(cross(m.n, d));', '指の姿勢'],
  ['柄を手のひらの中へ置く', 'nC0 = Math.max(nC0, pn + Math.sqrt(radius * radius - (pf - fC) ** 2));', 'nC0 = Math.max(nC0, pn);', '実際の頂点で握りを合わせる'],
  ['めり込みを重く数えない', 'e += err < 0 ? FIT.sinkWeight * err * err : err * err;', 'e += err * err;', '実際の頂点で握りを合わせる'],
  ['親指がめり込む姿勢も採る', 'if (sink < -FIT.sinkLimit) continue;', 'if (false) continue;', '実際の頂点で握りを合わせる'],
];
const run = pattern => spawnSync(process.execPath, ['--test', '--test-name-pattern', pattern, T], { encoding: 'utf8', timeout: 120000 });
const logOf = r => (r.stdout || '') + (r.stderr || '');
const failedCount = r => Number(logOf(r).match(/(?:#|ℹ) fail (\d+)/)?.[1] || 0);
const testsCount = r => Number(logOf(r).match(/(?:#|ℹ) pass (\d+)/)?.[1] || 0);
const baselines = new Set(), results = [];
for (const [name, original, replacement, pattern] of cases) {
  if (!baselines.has(pattern)) {
    const baseline = run(pattern);
    if (baseline.status !== 0 || baseline.error || testsCount(baseline) < 1) throw Error('対象試験の基準が不合格: ' + name + '\n' + logOf(baseline));
    baselines.add(pattern);
  }
  const source = fs.readFileSync(F), text = source.toString('utf8');
  if (text.split(original).length !== 2) throw Error('置換箇所は1件必要: ' + name);
  let result;
  try {
    fs.writeFileSync(F, text.replace(original, replacement));
    result = run(pattern);
  } finally {
    fs.writeFileSync(F, source);
  }
  if (!fs.readFileSync(F).equals(source)) throw Error('元のバイト列へ戻せなかった: ' + F);
  const log = logOf(result), failed = failedCount(result);
  const killed = result.status !== 0 && failed > 0 && !/SyntaxError|ERR_MODULE_NOT_FOUND|does not provide an export/.test(log) && !result.error;
  results.push({ name, killed: Boolean(killed), failed });
  console.error(`${killed ? 'killed' : 'SURVIVED'}: ${name} (${failed})`);
}
console.log(JSON.stringify({ total: cases.length, killed: results.filter(r => r.killed).length, results }, null, 2));
if (results.some(r => !r.killed)) process.exitCode = 1;
