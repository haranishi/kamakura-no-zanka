// 8.4a・8.5a の変異試験：押し戻し（knockback.js）と、とどめ・弾きの軽いスロー（time-warp.js）。
// 変異は1件ずつ適用し、成功・失敗のどちらでも元のバイト列へ戻す。各変異に対応する試験の緑を先に確かめる（verify-lunge-mutations.mjs と同じ形）。
// どれも「効く変異」（試験が確かめる振る舞いを実際に変える）。全試験の合否は別途 npm test。実ゲームの結線は tools/scenarios/regress-impact.mjs。
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const knock = 'dist/valley/knockback.js', warp = 'dist/valley/time-warp.js', T = 'tests/valley-impact.test.mjs';
// 名前、対象、置換前、置換後、対象の試験名（正規表現）
const cases = [
  ['押す距離を0.3mにする', knock, 'dist: 0.2,', 'dist: 0.3,', '押し戻しの距離'],
  ['強い技でも同じ距離', knock, '(STRONG.has(moveId) ? KNOCK.strong : 1)', '1', '押し戻しの距離'],
  ['侍大将も同じ距離', knock, "(armor === 'heavy' ? KNOCK.heavyArmor : 1)", '1', '押し戻しの距離'],
  ['三段目を強い技に数えない', knock, "new Set(['light3', 'heavy', 'counter', 'finisher'])", "new Set(['heavy', 'counter', 'finisher'])", '押し戻しの距離'],
  ['曲線を一定の速さにする', knock, 'return 1 - (1 - v) * (1 - v);', 'return v;', '押し戻しの時間'],
  ['曲線の上限を外す（終わりを過ぎると戻る）', knock, 'const v = Math.max(0, Math.min(1, u));', 'const v = Math.max(0, u);', '押し戻しの時間'],
  ['押し終えても距離を残す', knock, '  if (t1 >= KNOCK.dur) k.dist = 0;\n', '', '押し戻しの時間'],
  ['向きを正規化しない', knock, 'k.dx = dirX / l; k.dz = dirZ / l;', 'k.dx = dirX; k.dz = dirZ;', '押し戻しの向き'],
  ['向きが無くても押す', knock, "if (!(l > 1e-9) || !(dist > 0))", "if (!(dist > 0))", '押し戻しの向き'],
  ['dt0以下でも進める', knock, "if (!(k.dist > 0) || !(dt > 0) || k.t >= KNOCK.dur) return 0;", "if (!(k.dist > 0) || k.t >= KNOCK.dur) return 0;", '押し戻しの向き'],
  ['ほかの人との距離を0.55mにする', knock, 'minGap: 0.72,', 'minGap: 0.55,', 'ほかの人'],
  ['ほかの人を見ない', knock, 'gapScale(px, pz, sx, sz, ox, oz, KNOCK.minGap)', '1', 'ほかの人'],
  // スロー
  ['スローを長くする（0.4秒）', warp, 'dur: 0.25,', 'dur: 0.4,', '停止とスロー'],
  ['スローを停止と掛け算する', warp, '  if (w.stopT > 0) { w.stopT -= dt; return stopScale; }\n', "  if (w.stopT > 0) { w.stopT -= dt; if (w.slowT > 0) { w.slowT = Math.max(0, w.slowT - dt); return stopScale * SLOW.scale; } return stopScale; }\n", '停止とスロー'],
  ['停止の間もスローを減らす', warp, '  if (w.stopT > 0) { w.stopT -= dt; return stopScale; }\n', '  if (w.stopT > 0) { w.stopT -= dt; w.slowT = Math.max(0, w.slowT - dt); return stopScale; }\n', '停止とスロー'],
  ['いちばん遅い速さを保たない', warp, 'if (!(u > SLOW.hold)) return SLOW.scale;', 'if (!(u > 0)) return SLOW.scale;', 'スローの速さの曲線'],
  ['終わりで1倍へ跳ぶ（滑らかに戻さない）', warp, 'const k = (u - SLOW.hold) / (1 - SLOW.hold), s = k * k * (3 - 2 * k);', 'const k = 0, s = 0;', 'スローの速さの曲線'],
  ['頼み直しで始めから戻さない', warp, '  w.slowT = sec; w.slowDur = sec;\n', '  if (!(w.slowT > 0)) { w.slowT = sec; w.slowDur = sec; }\n', '頼み直し'],
  ['長さ0以下のスローも受ける', warp, '  if (!(sec > 0)) return false;\n', '', '頼み直し'],
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
