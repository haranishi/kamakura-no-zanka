// 物語の純粋層（banter.js・narrative.js）と、断片の記録（quest.js）・保存（save.js）の変異試験。
// 変異は1件ずつ適用し、成功・失敗のどちらでも元のバイト列へ戻す。各変異で tests/valley-story.test.mjs の対象試験が落ちること（殺せること）を確かめる。
// 実行：node tools/verify-story-mutations.mjs
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const B = 'dist/valley/banter.js', N = 'dist/valley/narrative.js', Q = 'dist/valley/quest.js', S = 'dist/valley/save.js', T = 'tests/valley-story.test.mjs';
// 名前、対象、置換前、置換後、対象の試験名（正規表現）
const cases = [
  ['掛け合いの間（8秒）を外す', B, 'if (sit.t - s.lastEnd < BANTER_GAP) return none;', 'if (false) return none;', 'waits for calm'],
  ['静まる2秒を外す', B, 'if (sit.t - s.calmSince < BANTER_CALM || ', 'if (', 'only an entry marked overHint'],
  ['同じ台詞を繰り返す', B, '!s.shown.includes(e.id) && ', '', 'waits for calm'],
  ['言い換えの組を無視する', B, '!(e.group && s.groups.includes(e.group)) && ', '', 'waits for calm'],
  ['止められても続きを出す', B, 'if (s.playing) { s.playing = null; s.lastEnd = sit.t; }', 'if (false) { s.playing = null; s.lastEnd = sit.t; }', 'cuts an exchange short'],
  ['案内の表示中も始める', B, '(e.overHint || !sit.held) && ', '', 'a showing hint holds back'],
  ['案内の横に出す一言を止める', B, '(e.overHint || !sit.held) && ', '!sit.held && ', 'only an entry marked overHint'],
  ['案内が消えてすぐ始める', B, '(!entry.overHint && sit.t - s.quietSince < BANTER_CALM)', 'false', 'a showing hint holds back'],
  ['待っている合図を出さない', B, 'return { ...none, waiting: true };\n  s.shown.push', 'return none;\n  s.shown.push', 'a showing hint holds back'],
  ['信頼の段の境目', B, "t >= 58 ? 'high'", "t > 58 ? 'high'", 'conditions read'],
  ['食糧の範囲の下端', B, '(r[0] == null || v >= r[0])', '(r[0] == null || v > r[0])', 'conditions read'],
  ['一行の短い下限', B, 'Math.max(2.4,', 'Math.max(1.4,', 'conditions read'],
  ['結末の段の境目', N, "n >= 3 ? 'deep'", "n > 3 ? 'deep'", 'ending deepens'],
  ['気づいた敵がいても案内を出す', N, 'if (sit.danger) return null;', '', 'relics: the prompt'],
  ['拾った物の案内を消さない', N, "if (r.fragment && (sit.fragments || []).includes(r.fragment)) continue;", '', 'relics: the prompt'],
  ['焚き火の輪の距離', N, 'low: { scale: 1.8', 'low: { scale: 1.0', 'fire ring'],
  ['行の条件を無視する', N, 'return lines.filter(l => matches(l.when, sit));', 'return lines;', 'first word follows'],
  ['断片を二重に数える', Q, "if (!all.some(f => f.id === id) || list.includes(id)) return;", "if (!all.some(f => f.id === id)) return;", 'retry rewinds'],
  ['場面の外でも調べられる', Q, 'if (r && r.beats.includes(s.beat) &&', 'if (r &&', 'examining twice'],
  ['会話で断片を拾わない', Q, 'if (f.dialogue === id) pick(f.id);', 'if (false) pick(f.id);', 'three spoken ones'],
  ['旧い保存を読めない', S, 'if (v === undefined) return [];', 'if (v === undefined) fail();', 'old save without them'],
  ['重なった断片を受け入れる', S, 'new Set(v).size !== v.length || ', '', 'old save without them'],
  ['物語の順に並べ直さない', S, 'return fragmentOrder.filter(id => v.includes(id));', 'return v;', 'old save without them'],
  ['見つかった記録を保存しない', Q, 'seen: !!s.seen }', 'seen: false }', 'Kyusaku welcomes only'],
  ['旧い保存の見つかった記録', S, "seen: flags.seen === undefined ? false : bool(flags.seen) };", "seen: bool(flags.seen) };", 'Kyusaku welcomes only'],
];
const run = pattern => spawnSync(process.execPath, ['--test', '--test-name-pattern', pattern, T], { encoding: 'utf8', timeout: 60000 });
const logOf = r => (r.stdout || '') + (r.stderr || '');
const count = (r, k) => Number(logOf(r).match(new RegExp(`(?:#|ℹ) ${k} (\\d+)`))?.[1] || 0);
const baselines = new Set(), results = [];
for (const [name, file, original, replacement, pattern] of cases) {
  if (!baselines.has(pattern)) {
    const base = run(pattern);
    if (base.status !== 0 || count(base, 'pass') < 1) throw Error('対象試験の基準が不合格: ' + name + '\n' + logOf(base));
    baselines.add(pattern);
  }
  const source = fs.readFileSync(file), text = source.toString('utf8');
  if (text.split(original).length !== 2) throw Error('置換箇所は1件必要: ' + name);
  let result;
  try { fs.writeFileSync(file, text.replace(original, replacement)); result = run(pattern); }
  finally { fs.writeFileSync(file, source); }
  if (!fs.readFileSync(file).equals(source)) throw Error('元のバイト列へ戻せなかった: ' + file);
  const log = logOf(result), failed = count(result, 'fail');
  const killed = result.status !== 0 && failed > 0 && !/SyntaxError|ERR_MODULE_NOT_FOUND|does not provide an export/.test(log);
  results.push({ name, killed, failed });
  console.error(`${killed ? 'killed' : 'SURVIVED'}: ${name} (${failed})`);
}
console.log(JSON.stringify({ total: cases.length, killed: results.filter(r => r.killed).length }));
if (results.some(r => !r.killed)) process.exitCode = 1;
