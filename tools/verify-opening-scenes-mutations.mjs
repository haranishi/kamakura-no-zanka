// オープニングの場面（opening-scenes.js：置き場・カメラの道筋・炎の並び・粒子の出し方・画面の測り方）の変異試験。
// 変異は1件ずつ適用し、成功・失敗のどちらでも元のバイト列へ戻す。各変異に対応する試験の緑を先に確認する。
// 実行：node tools/verify-opening-scenes-mutations.mjs（全試験の合否は別途 npm test で確認する）
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const sc = 'dist/valley/opening-scenes.js', test = 'tests/valley-opening-scenes.test.mjs';
// 名前、置換前、置換後、対象の試験名（正規表現）。対象はすべて opening-scenes.js
const cases = [
  ['カメラの動きをなめらかにしない', 'const c = s.camera, e = smooth(k), o = s.origin;', 'const c = s.camera, e = k, o = s.origin;', 'カメラ'],
  ['カメラの道筋に場面の置き場を足さない', 'const add = p => [p[0] + o[0], p[1] + o[1], p[2] + o[2]];', 'const add = p => [...p];', 'カメラ'],
  ['進みを0〜1に収めない', 'const smooth = k => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));', 'const smooth = k => k * k * (3 - 2 * k);', 'カメラ'],
  ['Aの前進が約4mでない', 'camera: { from: [0.4, 1.15, 10.5], to: [0.35, 1.22, 6.5]', 'camera: { from: [0.4, 1.15, 12.5], to: [0.35, 1.22, 6.5]', 'カメラ'],
  ['燃える家を3棟にする', "{ key: 'naya', at: [-8.0, 0, 4.5], rotY: Math.PI / 2, scale: 6.6, tint: '#e8d2a8' },", "{ key: 'naya', at: [-8.0, 0, 4.5], rotY: Math.PI / 2, scale: 6.6, tint: '#e8d2a8', burning: true },", '燃えるのは寺と数棟の家だけ'],
  ['谷に無いモデルを置く', "{ key: 'cart', at: [3.2, 0.32, -4.5]", "{ key: 'cart2', at: [3.2, 0.32, -4.5]", '場面は A〜D'],
  ['場面の組を近づける', 'origin: [200, 0, 0]', 'origin: [100, 0, 0]', '場面は A〜D'],
  ['線の炎が線から外れる', 'pos[0] += (b - 0.5) * 0.5;', 'pos[0] += (b - 0.5) * 3;', '炎の板'],
  ['炎の幅が範囲を出る', 'w: lerp(f.w[0], f.w[1], d)', 'w: lerp(f.w[0], f.w[1] * 2, d)', '炎の板'],
  ['炎の明るさのばらつきが大きすぎる', 'power: f.power * (0.8 + 0.4 * r())', 'power: f.power * (0.8 + 0.8 * r())', '炎の板'],
  ['光のにじみを舌として描く', "pull: 0, kind: 1 }); return; }", "pull: 0, kind: 0 }); return; }", '炎の板'],
  ['粒子の系列が刻みに依存する', 'const r = cellRand(7300 + SCENE_IDS.indexOf(id), pi, n++);', 'const r = cellRand(7300 + SCENE_IDS.indexOf(id), pi, (n++) + Math.round(acc * 1e6));', '火の粉・煙'],
  ['端数の誤差を許さない', 'while (acc >= 1 - 1e-9) {', 'while (acc >= 1) {', '火の粉・煙'],
  ['1秒あたりの数を見ない', 'let acc = prev.acc + p.rate * dt, n = prev.n;', 'let acc = prev.acc + 10 * dt, n = prev.n;', '火の粉・煙'],
  ['負のdtを通す', 'dt = Number.isFinite(dt) && dt > 0 ? dt : 0;', 'dt = Number.isFinite(dt) ? dt : 0;', '火の粉・煙'],
  ['風上へ流す', 'const vel = [w[0] * (p.kind', 'const vel = [-w[0] * (p.kind', '風下へ流れる'],
  ['火の粉が落ちる', "const up = lerp(p.up[0], p.up[1], r()), side", "const up = -lerp(p.up[0], p.up[1], r()), side", '風下へ流れる'],
  ['地平に炎のにじみを足さない', 'c + (mid[i] - c) * k + glow[i] * g * sky.glowAmt', 'c + (mid[i] - c) * k + 0 * g * sky.glowAmt', '地平の色'],
  ['地平の色を線形で混ぜない', '.map(c => toLinear(c / 255)); };', '.map(c => c / 255); };', '地平の色'],
  ['朱の色相の範囲が広すぎる', 'return h >= 345 || h <= 45;', 'return h >= 345 || h <= 90;', '朱の画素'],
  ['朱の彩度の下限が低すぎる', 'if (sat < 0.45) return false;', 'if (sat < 0.2) return false;', '朱の画素'],
  ['暗い赤茶も朱と数える', 'if (v < 0.25 || mx === 0) return false;', 'if (mx === 0) return false;', '朱の画素'],
  ['上下の帯も数える', 'const y0 = Math.round(height * bar), y1 = height - y0;', 'const y0 = 0, y1 = height;', '朱の画素'],
  ['明滅を変化の数で数える', 'return swings / 2 / (lumas.length / fps);', 'return swings / (lumas.length / fps);', '明滅の数え方'],
  ['景継がカメラの側へ向き直る', 'turnTo: [-0.85, -0.5]', 'turnTo: [0.75, -0.65]', 'D：景継'],
  ['向き直りを遠回りにする', 'if (a1 - a0 > Math.PI) a1 -= 2 * Math.PI; else if (a0 - a1 > Math.PI) a1 += 2 * Math.PI;', '', 'D：景継'],
  ['向き直る前から歩く', 'const walkT = Math.max(0, segT - turnAt - hero.turnTime * 0.6);', 'const walkT = Math.max(0, segT - hero.turnTime * 0.6);', 'D：景継'],
  ['場面の終わりに向き直らない', 'const turnAt = Math.max(0, duration - hero.lead)', 'const turnAt = Math.max(0, duration + hero.lead)', 'D：景継'],
  ['影の人物が橋から出る', "{ who: 'soldier', style: 'relaxed', from: [-9.6, 0.63, -0.4], speed: 0.82 },", "{ who: 'soldier', style: 'relaxed', from: [-9.6, 0.63, -0.4], speed: 2.2 },", 'C：橋を渡る影'],
  ['子どもを渡らせない', "{ who: 'child', style: 'villager', from: [-3.6, 0.63, 0.4], speed: 0.78 },\n", "{ who: 'villager_f', style: 'villager', from: [-3.6, 0.63, 0.4], speed: 0.78 },\n", 'C：橋を渡る影'],
  ['子を抱く人を消す', "speed: 0.78, load: 'baby' },", "speed: 0.78 },", 'C：橋を渡る影'],
  ['岸でも床の高さに浮かせる', 'return [x, over <= 0 ? f.from[1] : f.from[1] * Math.max(0, 1 - over / ramp), f.from[2]];', 'return [x, f.from[1], f.from[2]];', 'C：橋を渡る影'],
  ['輪郭の明かりが正面でも光る', 'return (1 - Math.min(1, Math.abs(ndv))) ** 3 *', 'return (1 - Math.min(1, Math.abs(ndv))) ** 0.5 *', '影の人物'],
  ['輪郭の明かりが裏向きの法線で最大になる', 'return (1 - Math.min(1, Math.abs(ndv))) ** 3 *', 'return (1 - Math.min(1, Math.max(0, ndv))) ** 3 *', '影の人物'],
  ['輪郭の明かりが炎の反対側でも光る', '** 3 * sstep(-0.35, 0.55, ndl); }', '** 3 * sstep(-1.6, -1.2, ndl); }', '影の人物'],
  ['法線をならさない', 'for (let p = 0; p < passes; p++) {', 'for (let p = 0; p < 0; p++) {', '人物の法線をならす'],
  ['向きの違う隣も混ぜる', 'if (ux * nx + uy * ny + uz * nz >= minDot) { sx += ux;', 'if (true) { sx += ux;', '人物の法線をならす'],
  ['布の表と裏を1つの頂点にまとめる', 'nor[r * 3 + 2] * nor[i * 3 + 2] > 0);', 'nor[r * 3 + 2] * nor[i * 3 + 2] > -2);', '人物の法線をならす'],
  ['継ぎ目の頂点をまとめない', 'let w = reps.find(r =>', 'let w = undefined && reps.find(r =>', '人物の法線をならす'],
  ['舌の高さを散らさない', 'let h = lerp(f.h[0], f.h[1], e ** 1.7);', 'let h = lerp(f.h[0], f.h[1], 0.5);', '炎の柵にしない'],
  ['根元を一直線にそろえる', "pos[1] += (y - 0.5) * jy * f.h[0] - h * (f.sink ?? 0);", "pos[1] += 0;", '炎の柵にしない'],
  ['舌の先の上限を見ない', 'if (f.top !== undefined) h = Math.max', 'if (false) h = Math.max', '炎の柵にしない'],
  ['煙を炎の上に浮かせる', "return { at: [f.at[0], f.at[1] + f.h[0] * 0.3, f.at[2]], box:", "return { at: [f.at[0], f.at[1] + f.h[1] * 2, f.at[2]], box:", '煙は炎の根元'],
  ['煙の下を朱に染めない', 'color: m.lit, colorEnd: m.dark,', 'color: m.dark, colorEnd: m.dark,', '煙は炎の根元'],
  ['町の燃える区画を広げる', 'const burn = Math.hypot(x - t.burn.at[0], z - t.burn.at[1]) < t.burn.r;', 'const burn = Math.hypot(x - t.burn.at[0], z - t.burn.at[1]) < t.burn.r * 6;', '燃えるのは寺と数棟'],
  ['熾火を暗くする', 'color = near ? [1.0, 0.42, 0.12].map(c => c * (0.7 + 0.5 * k))', 'color = near ? [1.0, 0.42, 0.12].map(c => c * (0.2 + 0.5 * k))', 'D：眼下の町'],
  ['小石が足もとに入る', 'const v = spec.avoid; if (v && x > v[0]', 'const v = null; if (v && x > v[0]', 'D：眼下の町'],
  ['小さな揺れも明滅と数える', 'if (hi - l >= threshold) { swings++; dir = -1; lo = l; }', 'if (hi - l > 0) { swings++; dir = -1; lo = l; }', '明滅の数え方'],
];
const run = pattern => spawnSync(process.execPath, ['--test', '--test-name-pattern', pattern, test], { encoding: 'utf8', timeout: 30000 });
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
  const source = fs.readFileSync(sc), text = source.toString('utf8');
  if (text.split(original).length !== 2) throw Error('置換箇所は1件必要: ' + name);
  let result;
  try {
    fs.writeFileSync(sc, text.replace(original, replacement));
    result = run(pattern);
  } finally {
    fs.writeFileSync(sc, source);
  }
  if (!fs.readFileSync(sc).equals(source)) throw Error('元のバイト列へ戻せなかった: ' + sc);
  const log = logOf(result), failed = failedCount(result);
  const killed = result.status !== 0 && failed > 0 && !/SyntaxError|ERR_MODULE_NOT_FOUND|does not provide an export/.test(log) && !result.error;
  results.push({ name, killed: Boolean(killed), failed });
  console.error(`${killed ? 'killed' : 'SURVIVED'}: ${name} (${failed})`);
}
console.log(JSON.stringify({ total: cases.length, killed: results.filter(r => r.killed).length }, null, 0));
if (results.some(r => !r.killed)) process.exitCode = 1;
