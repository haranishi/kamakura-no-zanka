// オープニングの純粋層（opening.js・opening-data.js）と、見たかの記録（save.js の meta）の変異試験。
// 変異は1件ずつ適用し、成功・失敗のどちらでも元のバイト列へ戻す。各変異に対応する試験の緑を先に確認する。
// 実行：node tools/verify-opening-mutations.mjs（全試験の合否は別途 npm test で確認する）
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const op = 'dist/valley/opening.js', data = 'dist/valley/opening-data.js', save = 'dist/valley/save.js', test = 'tests/valley-opening.test.mjs';
// 名前、対象、置換前、置換後、対象の試験名（正規表現）。
const cases = [
  ['飛ばしの開始0.6秒の締め出し', op, 't > data.skip.lockout) { skipAt = t;', 't >= 0) { skipAt = t;', '開始から0.6秒は飛ばせない'],
  ['飛ばしの暗転の長さ', data, 'skip: { lockout: 0.6, fade: 0.6 }', 'skip: { lockout: 0.6, fade: 0.3 }', '開始から0.6秒は飛ばせない'],
  ['飛ばしても目覚めへ移らない', op, 'if (skipAt !== null && t < W.from && t >= skipAt + data.skip.fade) t = W.from + (t - skipAt - data.skip.fade);', '', '開始から0.6秒は飛ばせない'],
  ['飛ばしで語りを消さない', op, '* (1 - skipK) };', '};', '開始から0.6秒は飛ばせない'],
  ['目覚めの飛ばしの締め出し', op, 'wakeT > data.wake.skipAfter', 'wakeT >= 0', '目覚めの区間は'],
  ['立ち上がりの時刻', data, 'getupAt: 2.7', 'getupAt: 3.7', '通しで見ると'],
  ['語りの消え際の向き', op, '1 - ramp(t, l.until - F.line, l.until)', 'ramp(t, l.until - F.line, l.until)', '通しで見ると'],
  ['cutの重複', op, 'isScene(from) && isScene(to) && from !== to', 'isScene(from) && isScene(to)', '通しで見ると'],
  ['短い版を選ばない', op, "const key = Object.hasOwn(data.versions, version) ? version : 'full';", "const key = 'full';", '短い版は'],
  ['語りの字の色を取り違える', op, 'color: data.colors[data.lines[id].kind]', 'color: data.colors.history', '字の色は'],
  ['朱の字が暗すぎる', data, "fiction: '#e36b48'", "fiction: '#8a3a22'", '字の色は'],
  ['輝度の係数', op, 'return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];', 'return (c[0] + c[1] + c[2]) / 3;', '字の色は'],
  ['暗転の区間を黒にしない', op, "let black = seg.id === 'dark' || seg.id === 'title' ? 1 : 0;", "let black = seg.id === 'title' ? 1 : 0;", '暗転：'],
  ['題名を題名の区間に出さない', op, "const title = seg.id === 'title' ?", "const title = seg.id === 'D' ?", '暗転：'],
  ['暗転からも溶け合わせる', op, 'const dissolve = scene && prev && isScene(prev.id) ?', 'const dissolve = scene && prev ?', '場面から場面へは'],
  ['溶け合いの長さ', data, 'dissolve: 1.0', 'dissolve: 2.0', '場面から場面へは'],
  ['動きを減らしてもカメラを動かす', op, 'k: reduced ? data.shots[seg.id].still : ramp(t, seg.from, seg.to)', 'k: ramp(t, seg.from, seg.to)', 'カメラの鍵'],
  ['dtの負値防御を削除', op, 'dt = Number.isFinite(dt) && dt > 0 ? dt : 0;', 'dt = Number.isFinite(dt) ? dt : 0;', 'dtの0・負'],
  ['終わったあとも進める', op, 'if (state.done) return { state, out: viewOf(state, { reduced }, data), events };', '', 'dtの0・負'],
  ['大きなdtで立ち上がりを落とす', op, 'if (!stood && wakeT > data.wake.getupAt) {', 'if (!stood && wakeT > data.wake.getupAt && wakeT <= W.to - W.from) {', '大きなdt'],
  ['揺らぎの周波数', op, 'Math.sin(t * w * 1.1 + seed)', 'Math.sin(t * w * 4.1 + seed)', '炎の揺らぎ'],
  ['揺らぎの幅', op, '1 + 0.07 * Math.sin', '1 + 0.17 * Math.sin', '炎の揺らぎ'],
  ['語りの文を変える', data, '元弘三年五月。鎌倉に、火が上がった。', '元弘三年五月、鎌倉に火が上がった。', '語りは設計の案'],
  ['目覚めの長さを変える', data, "['wake', 47, 52.2]", "['wake', 47, 50]", '区間は暗転で始まり'],
  ['短い版が長すぎる', data, "['title', 8, 10.5], ['wake', 10.5, 15.7]", "['title', 8, 12.5], ['wake', 12.5, 17.7]", '合計の長さ'],
  ['語りの重なり', data, "['op_n2', 6, 11]", "['op_n2', 5.5, 11]", '語りは場面の中にだけ'],
  ['記録の版を確かめない', save, 'if (raw.schema !== META_KEY || raw.version !== META_VERSION) fail();', 'if (raw.schema !== META_KEY) fail();', '見たかの記録は進行の保存と別のキー'],
  ['記録のキーを進行と同じにする', save, "export const META_KEY = 'kamakura-valley-meta';", "export const META_KEY = 'kamakura-valley-progress';", '見たかの記録は'],
  ['記録の書き込みの例外を外へ出す', save, "return { ok: false, notice: '記録を保存できない' };", "throw Error('quota');", '書けない環境でも'],
];
const run = pattern => spawnSync(process.execPath, ['--test', '--test-name-pattern', pattern, test], { encoding: 'utf8', timeout: 30000 });
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
