// 変異は1件ずつ適用し、成功・失敗のどちらでも元のバイト列へ戻す。
// 各変異に対応する試験の緑を先に確認する。全試験の合否は別途 npm test で確認する。
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const pathFile = 'dist/valley/sword-path.js', ikFile = 'dist/valley/arm-ik.js', layerFile = 'dist/valley/sword-layer.js';
const pathTest = 'tests/valley-sword-path.test.mjs', ikTest = 'tests/valley-arm-ik.test.mjs', layerTest = 'tests/valley-sword-layer.test.mjs';
// 名前、対象、置換前、置換後、対象試験、対象の試験名（正規表現）。
const cases = [
  ['鞘の反りの符号', pathFile, 'return SWORD.sayaSori * 4', 'return -SWORD.sayaSori * 4', pathTest, '寸法と抜ける境界'],
  ['刃の反りの符号', pathFile, 'return SWORD.bladeSori * 4', 'return -SWORD.bladeSori * 4', pathTest, '寸法と抜ける境界'],
  ['抜ける境界', pathFile, '- SWORD.koiguchiY;', '+ SWORD.koiguchiY;', pathTest, '寸法と抜ける境界'],
  ['抜き切る量', pathFile, 'S_OUT = 0.74', 'S_OUT = 0.70', pathTest, '寸法と抜ける境界'],
  ['sの下限クランプ', pathFile, 's = clamp(s, 0, S_OUT);', 's = Math.min(s, S_OUT);', pathTest, 's=0は恒等'],
  ['sの上限クランプ', pathFile, 's = clamp(s, 0, S_OUT);', 's = Math.max(s, 0);', pathTest, 's=0は恒等'],
  ['円弧の回転方向', pathFile, 'const cosine = Math.cos(angle), sine = Math.sin(angle);', 'const cosine = Math.cos(angle), sine = -Math.sin(angle);', pathTest, 'S_CLEAR以後'],
  ['円弧の中心の側', pathFile, 'centerZ = SWORD.sayaSori - radius', 'centerZ = SWORD.sayaSori + radius', pathTest, '姿勢は単調'],
  ['断面の幅を無視する', pathFile, 'return { halfWidth: w / 2, halfThickness: th / 2 };', 'return { halfWidth: 0, halfThickness: th / 2 };', pathTest, '刃の断面は鞘の管'],
  ['先端の絞りを削除', pathFile, 'const taper = t > BLADE_SECTION.taperStart ?', 'const taper = false ?', pathTest, '刃の断面は根元で'],
  ['前のコマに沿う選択を外す', pathFile, 'prev[0] * short[0] + prev[1] * short[1] + prev[2] * short[2] + prev[3] * short[3] >= prev[0] * long[0] + prev[1] * long[1] + prev[2] * long[2] + prev[3] * long[3] ? short : long', 'true ? short : long', pathTest, 'memoがあれば連続'],
  ['球面線形を線形へ', pathFile, 'q = qa.map((v, i) => v * wa + qb[i] * wb);', 'q = qa.map((v, i) => v * (1 - w) + qb[i] * w);', pathTest, 'blendPoseは端点'],
  ['球面線形の重みクランプ', pathFile, 'w = clamp(w, 0, 1);', 'w = w;', pathTest, 'blendPoseは端点'],
  ['hintの向きを反転', ikFile, 'scale(bend, height)', 'scale(bend, -height)', ikTest, 'hint側の符号'],
  ['現在の肘への代替を削除', ikFile, 'if (length(bend) <= 1e-12) bend = sub(upper, scale(direction, dot(upper, direction)));', 'if (false) bend = sub(upper, scale(direction, dot(upper, direction)));', ikTest, 'hintが軸上なら'],
  ['等長折りたたみの縮退分岐を削除', ikFile, 'if (reach === 0)', 'if (false)', ikTest, '目標が根元と一致'],
  ['目標と根元の縮退方向を削除', ikFile, 'distance > 0 ? unit(delta)', 'distance >= 0 ? unit(delta)', ikTest, '目標が根元と一致'],
  ['近すぎる距離のクランプを削除', ikFile, 'Math.max(near, Math.min(far, distance))', 'Math.min(far, distance)', ikTest, '近すぎる目標'],
  ['遠い距離のクランプを削除', ikFile, 'Math.max(near, Math.min(far, distance))', 'Math.max(near, distance)', ikTest, '遠い目標では'],
  ['前腕長の取り違え', ikFile, 'b = length(lower)', 'b = length(upper)', ikTest, '届く目標には'],
  ['反対向きの回転を恒等にする', ikFile, 'return [...perpendicular(a), 0];', 'return [0, 0, 0, 1];', ikTest, 'shortestArcの反対向き'],
  ['smoothstepの上端', layerFile, 'return t * t * (3 - 2 * t);', 'return t * t * (2 - 2 * t);', layerTest, 'poseAtの区間境界'],
  ['納刀直後の抜刀要求を拒否', layerFile, 'if (u === 1 && direction >= 0) return false;', 'if (u === 1) return false;', layerTest, '納刀を要求した直後'],
  ['clearの閾値', layerFile, 'before <= S_CLEAR && after > S_CLEAR', 'before <= S_CLEAR - 0.02 && after > S_CLEAR - 0.02', layerTest, 'clearはsが'],
  ['clearの重複', layerFile, 'before <= S_CLEAR && after > S_CLEAR', 'after > S_CLEAR', layerTest, 'clearはsが'],
  ['seatの閾値', layerFile, 'before > 0.03 && after <= 0.03', 'before > 0.06 && after <= 0.06', layerTest, 'seatは納刀で'],
  ['fastの引く区間の速さ', layerFile, 'LAYER.pullEnd / LAYER.snapPullSeconds', 'LAYER.pullEnd / (LAYER.snapPullSeconds * 3)', layerTest, '全進捗でfastは'],
  ['fastの振る区間の速さ', layerFile, '(1 - LAYER.pullEnd) / LAYER.snapSettleSeconds', '(1 - LAYER.pullEnd) / (LAYER.snapSettleSeconds * 3)', layerTest, '全進捗でfastは'],
  ['納刀の取り消し方向', layerFile, 'direction = 1;', 'direction = reversing ? -1 : 1;', layerTest, '納刀の全進捗で'],
  ['通常の反転で高速化しない', layerFile, 'if (fast || reversing)', 'if (fast)', layerTest, '納刀の全進捗で'],
  ['終端イベントの重複', layerFile, "events.push('drawn'); direction = 0;", "events.push('drawn'); direction = 1;", layerTest, '大きなdtも端点へ'],
  ['dtの負値防御を削除', layerFile, 'dt = dt >= 0 ? dt : 0;', 'dt = Math.abs(dt);', layerTest, 'dt=0・負・NaN'],
  ['数値姿勢の連続性', layerFile, 's: S_OUT * smoothstep(reachEnd, pullEnd, u)', 's: u < 0.5 ? 0 : S_OUT', layerTest, 'poseAtの全数値成分'],
];
const run = (file, pattern) => spawnSync(process.execPath, ['--test', '--test-name-pattern', pattern, file], { encoding: 'utf8', timeout: 30000 });
const logOf = r => (r.stdout || '') + (r.stderr || '');
const failedCount = r => Number(logOf(r).match(/(?:#|ℹ) fail (\d+)/)?.[1] || 0);
const testsCount = r => Number(logOf(r).match(/(?:#|ℹ) pass (\d+)/)?.[1] || 0);
const baselines = new Set(), results = [];
for (const [name, file, original, replacement, testFile, pattern] of cases) {
  const key = testFile + ':' + pattern;
  if (!baselines.has(key)) {
    const baseline = run(testFile, pattern);
    if (baseline.status !== 0 || baseline.error || testsCount(baseline) < 1) throw Error('対象試験の基準が不合格: ' + name + '\n' + logOf(baseline));
    baselines.add(key);
  }
  const source = fs.readFileSync(file), text = source.toString('utf8');
  if (text.split(original).length !== 2) throw Error('置換箇所は1件必要: ' + name);
  let result;
  try {
    fs.writeFileSync(file, text.replace(original, replacement));
    result = run(testFile, pattern);
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
