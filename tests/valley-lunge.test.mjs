// 見た目だけの踏み込み（8.3a 第3周・lunge.js）・線状の火花（spark-streaks.js）・刃が胴へ入る点（clash.js の entryPoint）の純粋な部分。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { LUNGE_VIEW, LUNGE_IO, CONTACT_POSE, createLungeIO, solveLunge as solveRaw, lungeInReach, easeShare, lungeShare, gapScale, hitTime } from '../dist/valley/lunge.js';
import { STREAK, createStreaks, emitStreak, stepStreaks, buildStreaks, streakIndex, STREAK_VERTS, STREAK_INDICES } from '../dist/valley/spark-streaks.js';
import { STRIKE, entryPoint } from '../dist/valley/clash.js';
import { MOVES } from '../dist/valley/combat.js';

const V = LUNGE_VIEW, DEG = Math.PI / 180, I = LUNGE_IO, out = () => createLungeIO();
// 試験では、止まるコマの姿勢の割合 u（0＝判定の始め・1＝1コマ後）で呼ぶ：判定の始め0.5秒、いま 0.5＋u/60 秒（判定の中）
const solveLunge = (pose, u, scale, tx, tz, depth, o) => {
  o[I.W] = 0.5; o[I.t] = 0.5 + u / 60; o[I.dt] = 1 / 60; o[I.scale] = scale; o[I.tx] = tx; o[I.tz] = tz; o[I.depth] = depth; solveRaw(pose, o);
  return { shift: o[I.shift], turn: o[I.turn], miss: o[I.miss], height: o[I.height] }; };
// 刃の2点を、前からの角 a（度・正＝右）と半径で置く（高さ h）。2つの姿勢は同じ
const pose = (a, r0, r1, h = 1.0) => { const p = r => [r * Math.sin(a * DEG), h, r * Math.cos(a * DEG)]; return { mid: p(r0), tip: p(r1), mid2: p(r0), tip2: p(r1) }; };

test('前進：刃が正面なら回さず、切先を胴の軸の depth 奥へ通す分だけ前へ', () => {
  const o = solveLunge(pose(0, 0.6, 1.0), 0, 1, 0, 1.5, V.depth, out());
  assert(Math.abs(o.turn) < 1e-9 && Math.abs(o.shift - (1.5 + V.depth - 1.0)) < 1e-9 && o.miss < 1e-9, JSON.stringify(o));
});

test('回す：刃が左へ流れていれば、右へ回して（ゲームの向きでは負）刃を相手の向きへ。回す角は上限まで、残りは横ずれ', () => {
  let o = solveLunge(pose(-30, 0.6, 1.0), 0, 1, 0, 1.5, V.depth, out());
  assert(Math.abs(o.turn + 30 * DEG) < 1e-9, `左の刃→右へ回す（ゲームの向きは左が正なので turn＝−30度）${o.turn / DEG}`);
  // 符号の約束：右を正とする局所の角で、体を turn（左が正）だけ回した後の刃の点の角は a − turn。それが相手の角（0）になる
  const r = 1.0, a = -30 * DEG, after = a - o.turn;
  assert(Math.abs(after) < 1e-9 && Math.abs(o.shift - (1.5 + V.depth - r)) < 1e-9);
  o = solveLunge(pose(-80, 0.6, 1.0), 0, 1, 0, 1.5, V.depth, out());
  assert(Math.abs(Math.abs(o.turn) - V.maxTurn) < 1e-9 && o.miss > 0.2, `上限で止まり、横ずれが残る ${o.turn / DEG} ${o.miss}`);
  o = solveLunge(pose(20, 0.6, 1.0), 0, 1, 0.3, 1.5, V.depth, out());                     // 相手が少し右・刃も右
  const aT = Math.atan2(0.3, 1.5) / DEG;
  assert(Math.abs(20 - o.turn / DEG - aT) < 1e-6, `相手の向きへ ${o.turn / DEG} ${aT}`);
});

test('上限：前進は maxShift まで、見た目の中心どうしは minGap 以上、近すぎる相手には minShift まで下がる', () => {
  assert.equal(solveLunge(pose(0, 0.6, 1.0), 0, 1, 0, 3.0, V.depth, out()).shift, V.maxShift);
  let o = solveLunge(pose(0, 0.16, 0.2), 0, 1, 0, 1.0, V.depth, out());                     // 刃が短い：中心どうしの距離で止まる
  assert(Math.abs(o.shift - (1.0 - V.minGap)) < 1e-9, `${o.shift}`);
  o = solveLunge(pose(0, 0.6, 1.0), 0, 1, 0, 0.6, V.depth, out());                         // 相手が近い：刃の中ほどで届く（下がらない）
  assert(o.shift >= 0 && o.shift <= 0.6 - V.minGap + 1e-12, `${o.shift}`);
  o = solveLunge(pose(0, 0.9, 1.1), 0, 1, 0, 0.6, V.depth, out());                         // 刃の全部が相手より遠い：下がる（下限まで）
  assert(o.shift < 0 && o.shift >= V.minShift - 1e-12, `${o.shift}`);
  assert.equal(solveLunge(pose(0, 1.2, 1.4), 0, 1, 0, 0.6, V.depth, out()).shift, V.minShift);
  o = solveLunge(pose(0, 0.6, 1.0), 0, 1, 0, 1.5, -V.guard, out());                        // 受けている相手：刀の所で止める
  assert(Math.abs(o.shift - (1.5 - V.guard - 1.0)) < 1e-9);
});

test('刃の点は、高さが band に入る点を選ぶ（腰〜肩）。止まるコマの姿勢（u=1）は2つめの姿勢', () => {
  // 中ほどは低い（脚の高さ）が前へ遠く、前進が少なくて済む。高さを見なければ中ほどを選ぶ
  const p = { mid: [0, 0.2, 1.1], tip: [0, 1.0, 0.9], mid2: [-0.5, 1.0, 0.86], tip2: [-0.5, 1.0, 0.86] };
  const o = solveLunge(p, 0, 1, 0, 1.5, V.depth, out());
  assert(o.height >= V.band[0] - 1e-9 && o.height <= V.band[1], `${o.height}`);
  const o2 = solveLunge(p, 1, 1, 0, 1.5, V.depth, out());
  assert(Math.abs(o2.turn + Math.atan2(0.5, 0.86)) < 1e-9, `u=1 は2つめの姿勢（左の刃→右へ回す）${o2.turn}`);
  const o3 = solveLunge(p, 0.5, 1, 0, 1.5, V.depth, out());
  assert(Math.abs(o3.turn) > 1e-3 && Math.abs(o3.turn) < Math.abs(o2.turn), 'u=0.5 は間');
});

test('姿勢の表：弓以外の11技。刃の点は立ち位置から0.2〜1.6m、前へ0〜1.4m（測り違いで桁がずれていない）', () => {
  assert.deepEqual(Object.keys(CONTACT_POSE).sort(), Object.keys(MOVES).filter(id => MOVES[id].kind === 'melee').sort());
  for (const [id, p] of Object.entries(CONTACT_POSE)) for (const q of [p.mid, p.tip, p.mid2, p.tip2]) {
    assert(q.length === 3 && q.every(Number.isFinite) && q[1] > 0.2 && q[1] < 1.6 && q[2] > 0 && q[2] < 1.4 && Math.abs(q[0]) < 1.3, `${id} ${q}`);
  }
});

test('間合い：論理の間合い（reach＋相手の半径＋reachSlack）と弧の内だけ踏み込む', () => {
  const m = MOVES.light1, edge = m.reach + 0.3 + V.reachSlack;
  assert(lungeInReach(m, 0.3, 0, edge - 0.01) && !lungeInReach(m, 0.3, 0, edge + 0.01));
  const side = (m.arcDeg / 2) * DEG + V.arcSlack;
  assert(lungeInReach(m, 0.3, Math.sin(side - 0.02), Math.cos(side - 0.02)) && !lungeInReach(m, 0.3, Math.sin(side + 0.02), Math.cos(side + 0.02)));
  assert(!lungeInReach(m, 0.3, 0, -1), '後ろの相手には踏み込まない');
});

test('時間の配り方：予備は判定の始めでちょうど望みに着く（途中で望みが変わっても）、判定は望みのまま、戻りは returnTime で0、技の外は settle で0へ', () => {
  const m = MOVES.heavy, dt = 1 / 60;
  let x = 0, t = 0, want = 0.8;
  while (t + dt < m.windup) { const k = lungeShare(m, t, t + dt, dt); assert(k >= 0 && k <= 1); x += (want - x) * k; t += dt; if (t > 0.2) want = 0.5; }
  x += (want - x) * lungeShare(m, t, m.windup, dt);
  assert(Math.abs(x - want) < 1e-12, `判定の始めで望み ${x}`);
  assert.equal(lungeShare(m, m.windup, m.windup + 0.05, dt), 1);
  t = m.windup + m.active; const R = Math.min(V.returnTime, m.recover * V.returnShare);
  let y = 0.6, prev = y, steps = 0;
  while (t < m.windup + m.active + R + 1e-9) { const k = lungeShare(m, t, t + dt, dt); y += (0 - y) * k; t += dt; assert(y <= prev + 1e-12, '戻りは単調'); prev = y; steps++; }
  assert(Math.abs(y) < 1e-12 && steps > 3, `戻り切る ${y}`);
  assert(Math.abs(lungeShare(null, 0, 0, dt) - (1 - Math.exp(-V.settle * dt))) < 1e-12);
  assert.equal(easeShare(0, 1), 1); assert.equal(easeShare(1, 1.2), 1); assert.equal(easeShare(0, 0), 0);
  // 戻りが短い技（三段目の戻り0.46秒）でも、戻りの returnShare のうちに戻る
  const s = MOVES.light2, Rs = Math.min(V.returnTime, s.recover * V.returnShare);
  assert(Rs <= s.recover * V.returnShare + 1e-12);
});

test('めり込み：見た目の中心が、ほかの人の見た目の中心から minGap 以上に保たれる最大の割合', () => {
  const g = V.minGap;
  assert.equal(gapScale(0, 0, 0.5, 0, 3, 0, g), 1);                                     // 遠い：そのまま
  const l = gapScale(0, 0, 1, 0, 1.2, 0, g);                                           // 1m出ると0.2まで近づく → 0.65で止める
  assert(Math.abs(l - (1.2 - g)) < 1e-12, `${l}`);
  assert.equal(gapScale(0, 0, 0.5, 0, 0.3, 0, g), 0);                                  // もう近い：近づく向きは0
  assert.equal(gapScale(0, 0, -0.3, 0, 0.3, 0, g), 1);                                 // もう近い：離れる向きは許す
  assert.equal(gapScale(0, 0, 0.5, 0, 0.25, 1.0, g), 1);                               // 横を通り過ぎる（円に入らない）
  assert.equal(gapScale(0, 0, 0, 0, 1, 0, g), 1);                                      // 動かない
});

test('当たるコマの見込み：判定の始めを越える最初のコマ（60コマ/秒で最大1コマ後）', () => {
  assert(Math.abs(hitTime(0.17, 0, 1 / 60) - 11 / 60) < 1e-12);                        // 0.17 → 0.1833
  assert(Math.abs(hitTime(0.2, 0, 1 / 60) - 0.2) < 1e-9);                              // 格子の上 → そのまま
  assert.equal(hitTime(0.2, 0.25, 1 / 60), 0.25);                                      // もう判定の中：いま
  assert.equal(hitTime(0.2, 0.1, 0), 0.2);
});

// 別のプロセスで測る（slash-trail の試験と同じ形）：6人が毎コマ、量を解いて、時間の配りと、めり込みの割合を計算する
const LUNGE_PROBE = `
import v8 from 'node:v8';
const L = await import(process.argv[1]);
const space = () => v8.getHeapSpaceStatistics().find(s => s.space_name === 'new_space');
if (!space()) { console.log('skip'); process.exit(0); }
const poses = Object.values(L.CONTACT_POSE), outs = [0, 1, 2, 3, 4, 5].map(() => L.createLungeIO()), st = outs.map(() => ({ x: 0.5, z: 0.5, turn: 0.5, t: 0.5 })), I = L.LUNGE_IO;
const m = { windup: 0.3, active: 0.1, recover: 0.5 }, mv = { reach: 1.9, arcDeg: 100 };
let sink = 0;
const frame = f => {
  for (let k = 0; k < 6; k++) {
    const o = outs[k], s = st[k], t1 = (f % 60) / 60, t0 = s.t;
    o[I.W] = 0.3; o[I.t] = t1; o[I.dt] = 1 / 60 + (f % 3) * 0.004; o[I.scale] = 1 + k * 0.01; o[I.tx] = Math.sin(f * 0.1 + k) * 0.4; o[I.tz] = 1.2 + Math.cos(f * 0.07) * 0.6; o[I.depth] = 0.1;
    L.solveLunge(poses[(k + f) % poses.length], o);
    const kk = L.lungeShare(t1 < t0 ? null : m, t0, t1, 1 / 60);
    s.x += (o[I.shift] - s.x) * kk; s.turn += (o[I.turn] - s.turn) * kk; s.t = t1;
    s.x *= L.gapScale(0, 0, s.x, 0.1, 1.3, 0, 0.55); sink += L.lungeInReach(mv, 0.3, 0.2, 1.4) ? 1 : 0;
  }
};
for (let f = 0; f < 20000; f++) frame(f);
globalThis.gc(); const before = space().space_used_size, N = 5000;
for (let f = 0; f < N; f++) frame(f);
console.log(JSON.stringify({ perFrame: (space().space_used_size - before) / N, sink }));`;
test('毎コマの新規確保なし：6人が量を解き、時間の配り・めり込みの割合を計算しても、若い世代の確保が増えない', () => {
  const r = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', LUNGE_PROBE, new URL('../dist/valley/lunge.js', import.meta.url).href], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  if (r.stdout.trim() === 'skip') return;
  const { perFrame } = JSON.parse(r.stdout);
  assert(perFrame < 8, `young-generation growth ${perFrame.toFixed(2)} bytes/frame`);
});

// ---------------------------------------------------------------------------------------------- 線状の火花
const hot = [1.5, 1.3, 0.9], warm = [1, 0.4, 0.1];
const outS = () => ({ position: new Float32Array(STREAK_VERTS * 3), uv: new Float32Array(STREAK_VERTS * 2), color: new Float32Array(STREAK_VERTS * 4), vertices: 0, indices: 0 });

test('火花の筋：速度の向きへ伸び（先＝いまの位置・尾＝速度の逆向き）、速いほど長く（上限あり）、カメラへ面を向け、尾は透明', () => {
  const pool = createStreaks(), o = outS();
  pool.camera.set([0, 1, 10]);                                                               // 筋と同じ高さから見る
  emitStreak(pool, [0, 1, 0], [10, 0, 0], { life: 0.2, head: hot, tail: warm, gravity: 0, drag: 0 });
  assert.equal(buildStreaks(pool, o), 6);
  const P = k => [o.position[k * 3], o.position[k * 3 + 1], o.position[k * 3 + 2]], L = Math.min(STREAK.maxLen, Math.max(STREAK.minLen, 10 * STREAK.lenK));
  const headMid = [(P(0)[0] + P(1)[0]) / 2, (P(0)[1] + P(1)[1]) / 2], tailMid = [(P(2)[0] + P(3)[0]) / 2, (P(2)[1] + P(3)[1]) / 2];
  assert(Math.abs(headMid[0]) < 1e-6 && Math.abs(headMid[1] - 1) < 1e-6, '先は今の位置');
  assert(Math.abs(tailMid[0] + L) < 1e-6, `尾は速度の逆向きに長さ ${L}`);
  assert(Math.abs(P(0)[2]) < 1e-6 && Math.abs(Math.abs(P(0)[1] - P(1)[1]) - 2 * STREAK.width) < 1e-6, '幅はカメラの視線と速度の両方に直交（y方向）');
  assert(o.color[3] > 0.9 && o.color[2 * 4 + 3] === 0 && o.color[3 * 4 + 3] === 0, '先は濃く、尾は透明');
  const slow = createStreaks(); slow.camera.set([0, 0, 10]); emitStreak(slow, [0, 1, 0], [0.5, 0, 0], { life: 0.2, head: hot, tail: warm, gravity: 0, drag: 0 });
  const fast = createStreaks(); fast.camera.set([0, 0, 10]); emitStreak(fast, [0, 1, 0], [100, 0, 0], { life: 0.2, head: hot, tail: warm, gravity: 0, drag: 0 });
  const o2 = outS(), o3 = outS(); buildStreaks(slow, o2); buildStreaks(fast, o3);
  assert(Math.abs(o2.position[6] - (0 - STREAK.minLen)) < 1e-6 && Math.abs(o3.position[6] + STREAK.maxLen) < 1e-6, '長さの下限と上限');
});

test('火花の筋：寿命で消え（残りは詰める）、重力で落ち、寿命へ向かって薄く短くなる。上限を超えては足さない', () => {
  const pool = createStreaks(4), o = outS();
  for (let i = 0; i < 4; i++) assert(emitStreak(pool, [i, 0, 0], [0, 5, 0], { life: 0.1 + i * 0.1, head: hot, tail: warm, gravity: -9, drag: 0 }));
  assert.equal(emitStreak(pool, [9, 0, 0], [0, 1, 0], { life: 1, head: hot, tail: warm }), false);
  pool.camera.set([0, 0, 10]); buildStreaks(pool, o); const a0 = o.color[3];
  stepStreaks(pool, 0.05); buildStreaks(pool, o);
  assert(o.color[3] < a0 && pool.vel[1] < 5, '薄れ、重力で遅くなる');
  stepStreaks(pool, 0.1);
  assert.equal(pool.count, 3);
  const xs = [0, 1, 2].map(i => Math.round(pool.pos[i * 3])).sort();
  assert.deepEqual(xs, [1, 2, 3], '寿命の来た筋だけが消え、残りは詰める');
  const idx = streakIndex(new Uint16Array(STREAK_INDICES));
  assert.deepEqual(Array.from(idx.slice(6, 12)), [4, 5, 6, 5, 7, 6]);
});

const STREAK_PROBE = `
import v8 from 'node:v8';
const S = await import(process.argv[1]);
const space = () => v8.getHeapSpaceStatistics().find(s => s.space_name === 'new_space');
if (!space()) { console.log('skip'); process.exit(0); }
const pool = S.createStreaks(), out = { position: new Float32Array(S.STREAK_VERTS * 3), uv: new Float32Array(S.STREAK_VERTS * 2), color: new Float32Array(S.STREAK_VERTS * 4), vertices: 0, indices: 0 };
const opt = { life: 1e9, head: [1, 1, 1], tail: [1, 0.5, 0], gravity: -9, drag: 1 };
for (let i = 0; i < S.STREAK.max; i++) S.emitStreak(pool, [i * 0.01, 1, 0], [Math.cos(i), 2, Math.sin(i)], opt);
pool.camera[0] = 3; pool.camera[1] = 2; pool.camera[2] = 5;
const frame = () => { S.stepStreaks(pool, 1 / 60); S.buildStreaks(pool, out); };
for (let f = 0; f < 20000; f++) frame();
globalThis.gc(); const before = space().space_used_size, N = 5000;
for (let f = 0; f < N; f++) frame();
console.log(JSON.stringify({ perFrame: (space().space_used_size - before) / N, count: pool.count }));`;
test('毎コマの新規確保なし：筋96本を進めて頂点を作り直しても、若い世代の確保が増えない', () => {
  const r = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', STREAK_PROBE, new URL('../dist/valley/spark-streaks.js', import.meta.url).href], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  if (r.stdout.trim() === 'skip') return;
  const { perFrame, count } = JSON.parse(r.stdout);
  assert.equal(count, STREAK.max);
  assert(perFrame < 8, `young-generation growth ${perFrame.toFixed(2)} bytes/frame`);
});

// ---------------------------------------------------------------------------------------------- 刃が胴へ入る点
test('刃が胴へ入る点：手元からたどって、胴の円柱の表面を初めて越える点（胴の中・届かない・高さの外は null）', () => {
  const low = [0, 0.6, 0], high = [0, 1.2, 0], R = STRIKE.torsoRadius;
  const p = entryPoint([-1, 1.0, 0], [0.5, 1.0, 0], low, high);
  assert(p && Math.abs(p[0] + R) < 1e-9 && Math.abs(p[1] - 1.0) < 1e-9, `手前の表面 ${p}`);
  const d = entryPoint([-1, 1.0, 0.1], [0.5, 1.0, 0.1], low, high);
  assert(d && Math.abs(Math.hypot(d[0], d[2]) - R) < 1e-9 && d[0] < 0, '斜めに横切っても表面の上');
  assert.equal(entryPoint([0.05, 1.0, 0], [1, 1.0, 0], low, high), null, '手元がもう胴の中');
  assert.equal(entryPoint([-1, 1.0, 0], [-0.5, 1.0, 0], low, high), null, '届かない');
  assert.equal(entryPoint([-1, 1.6, 0], [0.5, 1.6, 0], low, high), null, '胴の高さの外');
  assert.equal(entryPoint([-1, 1.0, 0.5], [0.5, 1.0, 0.5], low, high), null, '横を通る');
});
