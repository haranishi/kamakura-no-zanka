// 8.3a の変異試験：刃の軌跡の純粋な部分（slash-trail.js）と、振りの山・接触を判定へ合わせる切り出し（anim-data.js）、
// 当たった点・打ち合う点の幾何（clash.js。第2周）。
// 変異は1件ずつ適用し、成功・失敗のどちらでも元のバイト列へ戻す。各変異に対応する試験の緑を先に確認する（verify-sword-layer-mutations.mjs と同じ形）。
// どれも「効く変異」（試験が確かめる振る舞いを実際に変える）にしてある。全試験の合否は別途 npm test で確認する。
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const trail = 'dist/valley/slash-trail.js', anim = 'dist/valley/anim-data.js', clash = 'dist/valley/clash.js';
const trailTest = 'tests/valley-slash-trail.test.mjs', syncTest = 'tests/valley-move-sync.test.mjs', clashTest = 'tests/valley-clash.test.mjs';
// 名前、対象、置換前、置換後、対象試験、対象の試験名（正規表現）。
const cases = [
  ['区間の始め（判定の前）', trail, 't >= windup - TRAIL.lead - 1e-9', 't >= windup + TRAIL.lead - 1e-9', trailTest, '帯を出す区間'],
  ['区間を戻りへ延ばす', trail, 't <= windup + active + 1e-9', 't <= windup + active + 0.1 + 1e-9', trailTest, '帯を出す区間'],
  ['停止中の置き換えを外す', trail, 'else if (dt < TRAIL.minGap) {', 'else if (false) {', trailTest, '命中の停止で'],
  ['瞬間移動で切らない', trail, 'if (!(dt >= 0 && da <= limit && db <= limit))', 'if (!(dt >= 0))', trailTest, '瞬間移動'],
  ['切る距離をコマの時間で伸ばさない', trail, 'TRAIL.jumpSpeed * Math.max(dt, 1 / 60)', 'TRAIL.jumpSpeed * (1 / 60)', trailTest, '瞬間移動'],
  ['時刻の巻き戻しで切らない', trail, 'if (!(dt >= 0 && da <= limit', 'if (!(da <= limit', trailTest, '瞬間移動'],
  ['寿命を3倍に読む', trail, 'if (now - pool.time[second] > style.life) pool.count[i]--;', 'if (now - pool.time[second] > style.life * 3) pool.count[i]--;', trailTest, '寿命を過ぎた'],
  ['閉じた帯を空きに戻さない', trail, 'if (!pool.open[i] && (pool.count[i] < 2 ||', 'if (false && (pool.count[i] < 2 ||', trailTest, '寿命を過ぎた'],
  ['足さなかった帯を閉じない', trail, 'if (!pool.touched[i] && pool.open[i]) {', 'if (false) {', trailTest, '閉じた帯へは足さない'],
  ['閉じた帯へも足す', trail, 'if (pool.open[i] && pool.owner[i] === owner) return i;', 'if (pool.owner[i] === owner) return i;', trailTest, '閉じた帯へは足さない'],
  ['いちばん新しい帯を譲る', trail, 'pool.born[i] < pool.born[pick]', 'pool.born[i] > pool.born[pick]', trailTest, '同時の帯は6本まで'],
  ['上限を7本にする', trail, 'maxTrails: 6,', 'maxTrails: 7,', trailTest, '同時の帯は6本まで'],
  ['内側の接線を0にする（折れ線）', trail, 'for (let c = 0; c < 3; c++) dst[at * 3 + c] = (arr[b * 3 + c] - arr[a * 3 + c]) / dt;\n    }\n  }', 'for (let c = 0; c < 3; c++) dst[at * 3 + c] = 0;\n    }\n  }', trailTest, '曲線'],
  ['端の接線を片側の差にする', trail, "dst[at * 3 + c] = !(Math.abs(dab) > 1e-9", "dst[at * 3 + c] = true ? (pc - pa) / Math.max(1e-6, tc - ta) : !(Math.abs(dab) > 1e-9", trailTest, '曲線'],
  ['最後の区間の終わりの点を落とす', trail, 'last = j === count - 2 ? sub : sub - 1', 'last = sub - 1', trailTest, '頂点'],
  ['尾を細らせない', trail, 'k = taper * Math.pow(age, 1.5)', 'k = 0 * Math.pow(age, 1.5)', trailTest, '尾は細る'],
  ['年齢の向きを逆にする', trail, 'const age = Math.min(1, Math.max(0, (now - t) / life))', 'const age = Math.min(1, Math.max(0, 1 - (now - t) / life))', trailTest, '頂点'],
  ['速さで薄めない', trail, 'style.alpha * fade * (w1 + (w2 - w1) * s)', 'style.alpha * fade', trailTest, '速さで濃さ'],
  ['閉じても薄れない', trail, 'const fade = pool.open[i] ? 1 : Math.max(0, 1 - (now - pool.closedAt[i]) / TRAIL.closeFade);', 'const fade = 1;', trailTest, '寿命を過ぎた'],
  ['閉じてから消えた帯を空きに戻さない', trail, ' || now - pool.closedAt[i] >= TRAIL.closeFade)) reset(pool, i);', ')) reset(pool, i);', trailTest, '寿命を過ぎた'],
  ['刃の軸に沿う動きも濃く描く（柱）', trail, 'pool.speed[base + head] = dist(mx - along * ux, my - along * uy, mz - along * uz) / dt;', 'pool.speed[base + head] = dist(mx, my, mz) / dt;', trailTest, '柱にしない'],
  ['長さの上限を外す', trail, 'const x = Math.min(1, Math.max(0, (d1 + (d2 - d1) * s - half) / half));', 'const x = 0;', trailTest, '長さの上限'],
  ['幅の上限を外す', trail, 'out[0] = Math.max(root + len * style.inner, y1 - TRAIL.maxWidth);', 'out[0] = root + len * style.inner;', trailTest, '帯の幅'],
  ['突きの線を出さない', trail, '    if (style.streak) {', '    if (false) {', trailTest, '突きの光の線'],
  ['突きの線をカメラへ向けない', trail, 'sl = dist(qx, qy, qz) || 1, sx = qx / sl, sy = qy / sl, sz = qz / sl;', 'sl = 1, sx = 0, sy = 0, sz = 1;', trailTest, '突きの光の線'],
  ['芯を白から金色へ', trail, "head: scale(WHITE, 1.15), tail: scale(AO), streak: false }),", "head: scale([1, 0.78, 0.34], 1.15), tail: scale(AO), streak: false }),", trailTest, '帯の見た目'],
  ['速度の向きを逆にする', trail, 'out[c] = (pool.b[h * 3 + c] - pool.b[p * 3 + c]) / dt;', 'out[c] = (pool.b[p * 3 + c] - pool.b[h * 3 + c]) / dt;', trailTest, '速度'],
  ['閉じた古い帯の速度を使う', trail, 'pool.open[i] > pool.open[pick]', 'pool.open[i] < pool.open[pick]', trailTest, '速度'],
  ['三段目を通常の見た目にする', trail, "light3: 'light3'", "light3: 'light'", trailTest, '帯の見た目'],
  ['敵の突きを通常の見た目にする', trail, "soldier_thrust: 'enemyThrust'", "soldier_thrust: 'enemy'", trailTest, '帯の見た目'],
  ['敵を主人公の見た目にする', trail, "const key = (team === 'enemy' ? ENEMY : HERO)[moveId];", "const key = (team === 'enemy' ? HERO : HERO)[moveId] || ENEMY[moveId];", trailTest, '帯の見た目'],
  ['clear で空にしない', trail, 'export function clearTrails(pool) { for (let i = 0; i < pool.maxTrails; i++) reset(pool, i); }', 'export function clearTrails(pool) { }', trailTest, 'clear で'],
  ['山を判定の始めへ寄せる（中央にしない）', anim, 'mid = windup + active / 2;', 'mid = windup;', syncTest, '3区間の切り出し'],
  ['振りの速さの上限を外す', anim, 'const strike = Math.min(spec.maxSpeed, (b - a) / Math.max(1e-3, active))', 'const strike = ((b - a) / Math.max(1e-3, active))', syncTest, '3区間の切り出し'],
  ['使う区間の終わりを変える', anim, '[total, base.to]]', '[total, base.to * 0.9]]', syncTest, '3区間の切り出し'],
  ['合わせる技から二段目を外す', anim, '  officer_b: Object.freeze({ maxSpeed: 1.8 }),\n', '', syncTest, '合わせ直すのは'],
  ['合わせられない動作でも合わせる', anim, 'if (!(t1 > 0 && a > base.from && t2 < total && base.to > b)) return base;', 'if (!(t1 > 0 && t2 < total)) return base;', syncTest, '合わせられない'],
  ['折れ線のあいだを階段にする', anim, 'return c0 + (c1 - c0) * (t - t0) / (t1 - t0);', 'return c0;', syncTest, '折れ線'],
  // 接触（第2周）
  ['接触を判定の始めの30ms後へ置く', anim, 'let from = base.from, tc = windup;', 'let from = base.from, tc = windup + 0.03;', syncTest, '接触を判定の始めへ'],
  ['接触の速さの上限を外す', anim, 'cap = Math.max(CONTACT_MAX_SPEED, base.speed);', 'cap = 99;', syncTest, '接触を判定の始めへ'],
  ['使う長さを延ばさない', anim, 'const want = Math.max(base.to, from + (base.to - base.from));', 'const want = base.to;', syncTest, '使う長さ'],
  ['3区間の振りを1倍にする', anim, '    S = strike;\n', '    S = 1;\n', syncTest, '接触の前後'],
  ['接触の表から突きを外す', anim, 'soldier_slash: 1.053, soldier_thrust: 0.336, ', 'soldier_slash: 1.053, ', syncTest, '接触の時刻は弓以外'],
  ['逆の折れ線を階段にする', anim, 'return t0 + (t1 - t0) * (c - c0) / (c1 - c0);', 'return t0;', syncTest, 'timeAtClip'],
  ['山の記録が無くても合わせる', anim, "if (!meta?.active || !Number.isFinite(contact) || !base || base.approximate) return base;", "if (!Number.isFinite(contact) || !base) return base; if (!meta.active) meta = { ...meta, active: [0, 0] };", syncTest, 'moveSegment'],
  // 当たった点・打ち合う点（第2周）
  ['胴の外でも刃の点に火花を置く', clash, 'if (c.d <= radius) return { point: c.p, inside: true, gap: c.d };', 'if (true) return { point: c.p, inside: true, gap: c.d };', clashTest, '当たった点'],
  ['線分の端で切り詰めない', clash, 'if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }', '', clashTest, '線分どうし'],
  ['打ち合う点を手の中にも置く', clash, 'clamp01((dot(sub(shoulder, root), d) / L - 0.2) / 0.8)', 'clamp01(dot(sub(shoulder, root), d) / L)', clashTest, '弾きの打ち合う点'],
  ['ひるみに刃の向きを混ぜない', clash, 'const w = bx || bz ? STRIKE.push : 0', 'const w = 0', clashTest, 'ひるみの押す向き'],
];
const run = (file, pattern) => spawnSync(process.execPath, ['--test', '--test-name-pattern', pattern, file], { encoding: 'utf8', timeout: 60000 });
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
