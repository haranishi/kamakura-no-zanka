// 8.3a 第3周の変異試験：見た目だけの踏み込み（lunge.js）・線状の火花（spark-streaks.js）・刃が胴へ入る点（clash.js の entryPoint）。
// 変異は1件ずつ適用し、成功・失敗のどちらでも元のバイト列へ戻す。各変異に対応する試験の緑を先に確かめる（verify-slash-trail-mutations.mjs と同じ形）。
// どれも「効く変異」（試験が確かめる振る舞いを実際に変える）。全試験の合否は別途 npm test。実ゲームの結線は tools/scenarios/regress-lunge.mjs。
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const lunge = 'dist/valley/lunge.js', streak = 'dist/valley/spark-streaks.js', clash = 'dist/valley/clash.js', T = 'tests/valley-lunge.test.mjs';
// 名前、対象、置換前、置換後、対象の試験名（正規表現）
const cases = [
  ['前進の上限を外す', lunge, 'Math.min(Math.min(V.maxShift, dT - V.minGap), io[O.shift])', 'Math.min(dT - V.minGap, io[O.shift])', '上限'],
  ['中心どうしの距離を見ない', lunge, 'Math.min(Math.min(V.maxShift, dT - V.minGap), io[O.shift])', 'Math.min(V.maxShift, io[O.shift])', '上限'],
  ['近すぎても下がらない', lunge, 'io[O.shift] = Math.max(V.minShift,', 'io[O.shift] = Math.max(0,', '上限'],
  ['回す角の上限を外す', lunge, 'const rot = Math.max(-V.maxTurn, Math.min(V.maxTurn, want)), off = want - rot;', 'const rot = want, off = 0;', '回す'],
  ['回す向きを逆にする', lunge, 'io[O.turn] = -rot;', 'io[O.turn] = rot;', '回す'],
  ['胴の軸の奥へ通さない', lunge, 'shift = dT + depth - along;', 'shift = dT - along;', '前進'],
  ['刃の点の高さを見ない', lunge, '+ 3 * outside;', '+ 0 * outside;', '刃の点は'],
  ['止まるコマ（1コマ後）の姿勢を使わない', lunge, 'const w = Math.max(0, Math.min(1, (th - W) * 60));', 'const w = 0;', '刃の点は'],
  ['間合いの外にも踏み込む', lunge, 'if (!(d <= move.reach + foeRadius + LUNGE_VIEW.reachSlack)) return false;', 'if (!(d <= move.reach + foeRadius + 9)) return false;', '間合い'],
  ['弧の外にも踏み込む', lunge, 'return d < 1e-6 || Math.abs(Math.atan2(lx, lz)) <= move.arcDeg * DEG / 2 + LUNGE_VIEW.arcSlack;', 'return true;', '間合い'],
  ['予備で一定の割合ずつ寄せる（判定の始めに着かない）', lunge, 'return e0 >= 1 ? 1 : Math.max(0, Math.min(1, (ease(u1) - e0) / (1 - e0)));', 'return e0 >= 1 ? 1 : 0.2;', '時間の配り方'],
  ['戻りを戻りの終わりまで延ばす', lunge, 'Math.min(LUNGE_VIEW.returnTime, move.recover * LUNGE_VIEW.returnShare)', 'move.recover * 3', '時間の配り方'],
  ['技の外で元へ戻らない', lunge, 'if (!move) return 1 - Math.exp(-LUNGE_VIEW.settle * Math.max(0, dt));', 'if (!move) return 0;', '時間の配り方'],
  ['近すぎる人へも近づく', lunge, 'if (c <= 0) return (dx + sx)', 'if (false) return (dx + sx)', 'めり込み'],
  ['めり込みを遠い方の交点で止める', lunge, 'const l = (-b - Math.sqrt(disc)) / ss;', 'const l = (-b + Math.sqrt(disc)) / ss;', 'めり込み'],
  ['当たるコマを判定の始めとみなす', lunge, '  return t + Math.ceil((W - t) / dt - 1e-6) * dt;\n}', '  return W;\n}', '当たるコマの見込み'],
  // 線状の火花
  ['尾を速度の向きへ伸ばす', streak, 'const tx = px - dx * L, ty = py - dy * L, tz = pz - dz * L', 'const tx = px + dx * L, ty = py + dy * L, tz = pz + dz * L', '火花の筋：速度'],
  ['筋の長さの上限を外す', streak, 'Math.min(STREAK.maxLen, Math.max(STREAK.minLen, sp * STREAK.lenK))', 'Math.max(STREAK.minLen, sp * STREAK.lenK)', '火花の筋：速度'],
  ['筋をカメラへ向けない', streak, 'const qx = dy * cz - dz * cy, qy = dz * cx - dx * cz, qz = dx * cy - dy * cx', 'const qx = 0, qy = 0, qz = 1', '火花の筋：速度'],
  ['尾を透明にしない', streak, 'C[cc + 3] = tailEnd ? 0 :', 'C[cc + 3] = tailEnd ? 1 :', '火花の筋：速度'],
  ['寿命で消さない', streak, 'if (pool.age[i] >= pool.life[i]) {', 'if (false) {', '火花の筋：寿命'],
  ['上限を超えても足す', streak, 'if (pool.count >= pool.max) return false;', 'if (false) return false;', '火花の筋：寿命'],
  ['重力をかけない', streak, 'pool.vel[k + 1] * d + pool.grav[i] * dt', 'pool.vel[k + 1] * d', '火花の筋：寿命'],
  ['寿命で薄れない', streak, 'pool.alpha[i] * Math.sqrt(fade)', 'pool.alpha[i]', '火花の筋：寿命'],
  // 刃が胴へ入る点
  ['手元が胴の中なら手元の点を返す', clash, "if (!(c > 0) || !(a > 1e-12) || disc < 0) return null;", "if (!(c > 0)) return [from[0], from[1], from[2]]; if (!(a > 1e-12) || disc < 0) return null;", '刃が胴へ入る点'],
  ['胴の向こう側（抜ける点）を返す', clash, 'const s = (-b - Math.sqrt(disc)) / (2 * a)', 'const s = (-b + Math.sqrt(disc)) / (2 * a)', '刃が胴へ入る点'],
  ['胴の高さを見ない', clash, ' || y < Math.min(low[1], high[1]) - 0.05 || y > Math.max(low[1], high[1]) + 0.05) return null;', ') return null;', '刃が胴へ入る点'],
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
console.log(JSON.stringify({ total: cases.length, killed: results.filter(r => r.killed).length, results }, null, 2));
if (results.some(r => !r.killed)) process.exitCode = 1;
