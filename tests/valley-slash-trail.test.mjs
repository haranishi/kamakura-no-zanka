// 刃の軌跡（8.3a）の純粋な部分：サンプルの保持・寿命・曲線での補間・頂点の並べ方・新規確保なし。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  TRAIL, TRAIL_STYLES, TRAIL_VERTS, TRAIL_INDICES, trailStyleFor, trailWindow, inTrailWindow, createTrailPool, setTrailTime,
  addSample, closeUntouched, pruneTrails, buildRibbon, clearTrails, trailVelocity, trailStats, speedWeight, openSlotOf,
} from '../dist/valley/slash-trail.js';

const makeOut = () => ({ position: new Float32Array(TRAIL_VERTS * 3), uv: new Float32Array(TRAIL_VERTS * 2), color: new Float32Array(TRAIL_VERTS * 4), index: new Uint16Array(TRAIL_INDICES), vertices: 0, indices: 0 });
const P = new Float64Array(6);
// 1サンプル：内側の縁 A・外側の縁 B
const add = (pool, owner, style, t, a, b) => { setTrailTime(pool, t); P.set([...a, ...b]); return addSample(pool, owner, style, P); };
const frameEnd = (pool, t) => { setTrailTime(pool, t); closeUntouched(pool); pruneTrails(pool); };
// 試験用の見た目：尾を細らせず、速さで薄めない（位置と年齢だけを見る）
const plain = Object.freeze({ life: 1, alpha: 1, inner: 0, outer: 1, taper: 0, pivot: 1, speed: [-2, -1], head: [1, 1, 1], tail: [1, 1, 1] });
const GLINT = [1, 0.92, 0.68];   // battle.js の予兆の光の色

test('帯の見た目は技と陣営から選び、主人公を最も強く、敵は弱く、予兆の金色と分ける', () => {
  for (const id of ['light1', 'light2', 'counter']) assert.equal(trailStyleFor(id, 'hero'), TRAIL_STYLES.light, id);
  assert.equal(trailStyleFor('light3', 'hero'), TRAIL_STYLES.light3);
  for (const id of ['heavy', 'finisher', 'stealth']) assert.equal(trailStyleFor(id, 'hero'), TRAIL_STYLES.heavy, id);
  for (const id of ['soldier_slash', 'officer_a', 'officer_b']) assert.equal(trailStyleFor(id, 'enemy'), TRAIL_STYLES.enemy, id);
  assert.equal(trailStyleFor('officer_c', 'enemy'), TRAIL_STYLES.enemyHeavy);
  assert.equal(trailStyleFor('soldier_thrust', 'enemy'), TRAIL_STYLES.enemyThrust);
  for (const [id, team] of [['archer_shot', 'enemy'], ['ally_shot', 'ally'], ['light1', 'enemy'], ['soldier_slash', 'hero'], ['nope', 'hero']]) assert.equal(trailStyleFor(id, team), null, id + '/' + team);
  const S = TRAIL_STYLES;
  for (const [k, s] of Object.entries(S)) {
    assert(s.life >= 0.12 && s.life <= 0.16, k + ' life');
    assert(s.alpha > 0 && s.alpha <= 0.8 && s.inner >= 0 && s.inner < s.outer && s.outer <= 1 && s.taper >= 0 && s.taper < 1, k);
  }
  // 三段目・強は、通常より長く・幅広く・濃い。主人公の最も弱い帯も、敵の最も強い帯より濃く明るい
  for (const k of ['light3', 'heavy']) assert(S[k].life > S.light.life && S[k].inner < S.light.inner && S[k].alpha > S.light.alpha, k);
  const luma = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  for (const e of ['enemy', 'enemyHeavy', 'enemyThrust']) {
    assert(S.light.alpha > S[e].alpha && luma(S.light.head) > 2 * luma(S[e].head), e);
    // 敵の色は予兆の光（暖かい金色）と違う：暗く、青みがある
    assert(luma(S[e].head) < 0.4 * luma(GLINT) && S[e].head[2] > S[e].head[0], e + ' color');
  }
});

test('帯を出す区間は、判定の0.04秒前から戻りの始めの0.1秒後まで', () => {
  const m = { windup: 0.42, active: 0.12, recover: 0.55 };
  assert.deepEqual(trailWindow(m), { start: 0.42 - 0.04, end: 0.42 + 0.12 + 0.1 });
  for (const [t, want] of [[0.37, false], [0.38, true], [0.5, true], [0.64, true], [0.65, false], [NaN, false], [Infinity, false]]) assert.equal(inTrailWindow(m, t), want, String(t));
});

test('命中の停止で時刻が進まないあいだは、サンプルが詰まらず、先頭の位置だけが新しくなる', () => {
  const pool = createTrailPool(), o = {};
  add(pool, o, plain, 1, [0, 1, 0], [0, 2, 0]);
  for (let k = 1; k <= 9; k++) add(pool, o, plain, 1 + k * 0.0008, [0.01 * k, 1, 0], [0.01 * k, 2, 0]);   // 停止中：1コマ0.0008秒
  assert.equal(pool.count[0], 1);
  assert.equal(pool.time[0], 1);
  assert.equal(pool.b[0], Math.fround(0.09));                               // 位置は最後のコマのもの
  add(pool, o, plain, 1 + TRAIL.minGap + 1e-6, [0.1, 1, 0], [0.1, 2, 0]);
  assert.equal(pool.count[0], 2);
});

test('寿命を過ぎたサンプルは尾から捨て、閉じて描けなくなった帯は空きに戻す', () => {
  const pool = createTrailPool(), o = {}, life = TRAIL_STYLES.light.life;
  let t = 0;
  for (let f = 0; f < 30; f++) {
    t = f / 60; add(pool, o, TRAIL_STYLES.light, t, [f * 0.1, 1, 0], [f * 0.1, 2, 0]); frameEnd(pool, t);
    const S = pool.maxSamples, oldest = pool.time[(pool.head[0] - pool.count[0] + 1 + S) % S], second = pool.time[(pool.head[0] - pool.count[0] + 2 + S) % S];
    if (pool.count[0] >= 2) assert(t - second <= life + 1e-9, `frame ${f}: second-oldest age ${t - second}`);
    assert(t - oldest <= life + 1 / 60 + 1e-9, `frame ${f}: oldest age ${t - oldest}`);
  }
  assert(pool.count[0] >= 8 && pool.count[0] <= 10, `kept ${pool.count[0]}`);
  frameEnd(pool, t + 0.01);                                                // 足さなかった：閉じる
  assert.equal(pool.open[0], 0);
  assert.equal(pool.owner[0], o);                                          // 薄れている間は残る
  frameEnd(pool, t + life + 0.02);
  assert.equal(pool.owner[0], null);
  assert.equal(pool.count[0], 0);
});

test('同時の帯は6本まで。7本目は、閉じた帯がなければ、出している途中のいちばん古い帯を譲ってもらう', () => {
  assert.equal(TRAIL.maxTrails, 6);
  const pool = createTrailPool(), owners = Array.from({ length: 7 }, () => ({}));
  owners.forEach((o, k) => add(pool, o, plain, k * 0.01, [k, 1, 0], [k, 2, 0]));
  assert.equal(trailStats(pool).active, 6);
  assert.equal(openSlotOf(pool, owners[0]), -1);                           // いちばん古い帯が譲った
  for (const o of owners.slice(1)) assert(openSlotOf(pool, o) >= 0);
  assert.equal(pool.stats.stolen, 1);
});

test('瞬間移動・時刻の巻き戻しでは帯を切り、低いコマ速度の速い振りは切らない', () => {
  const pool = createTrailPool(), o = {};
  add(pool, o, plain, 0, [0, 1, 0], [0, 2, 0]);
  add(pool, o, plain, 1 / 60, [5, 1, 0], [5, 2, 0]);                       // 1コマで5m：瞬間移動
  assert.equal(pool.count[0], 1);
  assert.equal(pool.stats.cuts, 1);
  add(pool, o, plain, 1 / 60 + 0.05, [5, 1, 2.4], [5, 2, 2.4]);           // 20コマ/秒で2.4m（切先の実測の最大約47m/秒の範囲）
  assert.equal(pool.count[0], 2);
  add(pool, o, plain, 0.01, [5, 1, 2.4], [5, 2, 2.4]);                     // 時刻が戻った（やり直しの時計）
  assert.equal(pool.count[0], 1);
  assert.equal(pool.stats.cuts, 2);
});

test('閉じた帯へは足さない：同じ持ち主でも、間が空いたら別の帯にして、空白を直線でつながない', () => {
  const pool = createTrailPool(), o = {};
  const first = add(pool, o, plain, 0, [0, 1, 0], [0, 2, 0]); frameEnd(pool, 0);
  add(pool, o, plain, 1 / 60, [0.1, 1, 0], [0.1, 2, 0]); frameEnd(pool, 1 / 60);
  frameEnd(pool, 2 / 60);                                                  // このコマは足さなかった（刀が見えない・抜刀の層など）
  assert.equal(pool.open[first], 0);
  const second = add(pool, o, plain, 3 / 60, [0.3, 1, 0], [0.3, 2, 0]);
  assert.notEqual(second, first);
  assert.equal(pool.count[second], 1);
  assert.equal(pool.count[first], 2);
});

test('頂点：サンプルのあいだを subdiv で割り、1点2頂点・年齢は尾が古く・縁は0と1・添字は帯の中で閉じる', () => {
  const pool = createTrailPool(), out = makeOut();
  for (let k = 0; k < 5; k++) add(pool, 'a', plain, k / 60, [k * 0.1, 1, 0], [k * 0.1, 2, 0]);
  for (let k = 0; k < 3; k++) add(pool, 'b', plain, k / 60, [0, 1, k * 0.1], [0, 2, k * 0.1]);
  setTrailTime(pool, 4 / 60);
  const indices = buildRibbon(pool, out), pa = (5 - 1) * TRAIL.subdiv + 1, pb = (3 - 1) * TRAIL.subdiv + 1;
  assert.equal(out.vertices, 2 * (pa + pb));
  assert.equal(indices, 6 * (pa - 1 + pb - 1));
  assert.equal(out.indices, indices);
  for (let v = 0; v < out.vertices; v++) {
    assert.equal(out.uv[v * 2 + 1], v % 2);
    for (let c = 0; c < 3; c++) assert(Number.isFinite(out.position[v * 3 + c]));
  }
  for (let p = 1; p < pa; p++) assert(out.uv[p * 4] <= out.uv[(p - 1) * 4] + 1e-7, `age ${p}`);   // 尾（古い）→先頭（新しい）
  assert(out.uv[0] > out.uv[(pa - 1) * 4]);
  for (let k = 0; k < indices; k++) {
    const vtx = out.index[k], inA = vtx < 2 * pa;
    assert.equal(inA, Math.floor(k / 6) < pa - 1, `index ${k} crosses ribbons`);
  }
});

// 円（半径1）の上を角速度 w で回る切先を、時刻 times で取って、区間ごとの円からの外れの最大を返す
const arcErrors = (times, w) => {
  const pool = createTrailPool(), out = makeOut();
  times.forEach(t => add(pool, 'arc', plain, t, [0.5 * Math.cos(w * t), 1, 0.5 * Math.sin(w * t)], [Math.cos(w * t), 1, Math.sin(w * t)]));
  setTrailTime(pool, times.at(-1)); buildRibbon(pool, out);
  const errs = [];
  for (let seg = 0; seg < times.length - 1; seg++) {
    let e = 0;
    for (let q = 0; q <= TRAIL.subdiv; q++) { const v = (seg * TRAIL.subdiv + q) * 2 + 1; e = Math.max(e, Math.abs(Math.hypot(out.position[v * 3], out.position[v * 3 + 2]) - 1)); }
    errs.push(e);
  }
  return { errs, out };
};
test('曲線：円弧上のサンプルのあいだを、弦（折れ線）ではなく円弧に近くつなぐ（両端の区間も）', () => {
  const step = 0.5, chord = 1 - Math.cos(step / 2);                      // 1コマに0.5rad（切先が0.5m動く）。弦の中点の外れは約3%
  const { errs, out } = arcErrors([0, 1, 2, 3, 4, 5].map(k => k / 60), step * 60);
  errs.forEach((e, k) => assert(e < chord / 8, `segment ${k}: ${e} vs chord ${chord}`));
  for (let k = 0; k < 6; k++) { const v = (k * TRAIL.subdiv) * 2 + 1, a = k * step; assert(Math.abs(out.position[v * 3] - Math.cos(a)) < 1e-6 && Math.abs(out.position[v * 3 + 2] - Math.sin(a)) < 1e-6, `knot ${k}`); }
  // コマの間隔がそろわなくても（30〜120コマ/秒が混ざる）、行き過ぎずに、いちばん長い区間の弦の外れより小さい
  const dts = [1 / 60, 1 / 30, 1 / 60, 1 / 110, 1 / 40, 1 / 60], times = dts.map((_, k) => dts.slice(0, k + 1).reduce((a, b) => a + b, 0));
  const uneven = arcErrors(times, 20).errs, worstChord = 1 - Math.cos(20 * Math.max(...dts) / 2);
  assert(Math.max(...uneven) < worstChord, `uneven ${uneven.map(e => e.toFixed(4))} vs ${worstChord}`);
});

test('尾は細る：寿命へ向かって、帯の幅が taper だけ外側の縁へ縮む', () => {
  const style = { ...plain, life: 0.1, taper: 0.8 }, pool = createTrailPool(), out = makeOut();
  add(pool, 't', style, 0, [0, 1, 0], [0, 2, 0]);
  add(pool, 't', style, 0.1, [0.5, 1, 0], [0.5, 2, 0]);
  setTrailTime(pool, 0.1); buildRibbon(pool, out);
  const width = p => Math.hypot(out.position[p * 6] - out.position[p * 6 + 3], out.position[p * 6 + 1] - out.position[p * 6 + 4]);
  const last = TRAIL.subdiv;
  assert(Math.abs(width(last) - 1) < 1e-6, 'newest keeps full width');
  assert(Math.abs(width(0) - (1 - 0.8)) < 1e-6, `oldest ${width(0)}`);
  assert(Math.abs(out.position[1 * 3 + 1] - 2) < 1e-6, 'the outer edge stays on the tip path');
});

test('速さで濃さ：遅い刃は帯を残さず、速い刃は最も濃い', () => {
  const st = TRAIL_STYLES.light;
  assert.equal(speedWeight(st, 0), 0); assert.equal(speedWeight(st, st.speed[0]), 0); assert.equal(speedWeight(st, st.speed[1]), 1); assert.equal(speedWeight(st, 100), 1);
  assert(speedWeight(st, (st.speed[0] + st.speed[1]) / 2) > 0.4 && speedWeight(st, (st.speed[0] + st.speed[1]) / 2) < 0.6);
  const pool = createTrailPool(), out = makeOut();
  add(pool, 's', st, 0, [0, 1, 0], [0, 2, 0]);
  add(pool, 's', st, 1 / 60, [0.01, 1, 0], [0.01, 2, 0]);                 // 0.6m/秒：遅い
  add(pool, 's', st, 2 / 60, [0.51, 1, 0], [0.51, 2, 0]);                 // 30m/秒：速い
  setTrailTime(pool, 2 / 60); buildRibbon(pool, out);
  const alphaAt = p => out.color[p * 8 + 3];
  assert.equal(alphaAt(TRAIL.subdiv), 0);
  assert(Math.abs(alphaAt(2 * TRAIL.subdiv) - st.alpha) < 1e-6);
});

test('速度：外側の縁の最新の速度（弾きの火花の向き）。出している途中の帯を使う', () => {
  const pool = createTrailPool(), out = new Float64Array(3), o = {};
  assert.equal(trailVelocity(pool, o, out), false);
  const first = add(pool, o, plain, 0, [0, 1, 0], [0, 2, 0]); frameEnd(pool, 0);
  assert.equal(trailVelocity(pool, o, out), false);
  add(pool, o, plain, 1 / 60, [0, 1, 0], [0.5, 2, 0]); frameEnd(pool, 1 / 60);   // +X へ30m/秒
  frameEnd(pool, 2 / 60);                                                  // 足さなかった：閉じた（古い）帯になる
  assert.equal(pool.open[first], 0);
  const second = add(pool, o, plain, 3 / 60, [0, 1, 0], [0, 2, 0]); frameEnd(pool, 3 / 60);
  add(pool, o, plain, 4 / 60, [0, 1, 0], [0, 2, -0.2]);                   // 出している途中の帯：-Z へ12m/秒
  assert.notEqual(second, first);
  assert.equal(trailVelocity(pool, o, out), true);
  assert(Math.abs(out[0]) < 1e-4 && Math.abs(out[2] + 12) < 1e-3, JSON.stringify(Array.from(out)));
});

test('clear で全部の帯が消える', () => {
  const pool = createTrailPool(), out = makeOut();
  for (let k = 0; k < 3; k++) { add(pool, k, plain, 0, [k, 1, 0], [k, 2, 0]); add(pool, k, plain, 1 / 60, [k, 1, 0.1], [k, 2, 0.1]); }
  clearTrails(pool);
  assert.deepEqual([trailStats(pool).active, trailStats(pool).open, buildRibbon(pool, out), out.vertices], [0, 0, 0, 0]);
});

// 別のプロセスで測る（同じプロセスの他の試験が型の記録を混ぜると、最適化が外れて数の箱が作られ、測り違えた）
const ALLOC_PROBE = `
import v8 from 'node:v8';
const m = await import(process.argv[1]);
const space = () => v8.getHeapSpaceStatistics().find(s => s.space_name === 'new_space');
if (!space()) { console.log('skip'); process.exit(0); }
const pool = m.createTrailPool(), owners = [{}, {}, {}, {}, {}, {}], st = m.TRAIL_STYLES.heavy, p = new Float64Array(6);
const out = { position: new Float32Array(m.TRAIL_VERTS * 3), uv: new Float32Array(m.TRAIL_VERTS * 2), color: new Float32Array(m.TRAIL_VERTS * 4), index: new Uint16Array(m.TRAIL_INDICES), vertices: 0, indices: 0 };
const frame = f => {
  pool.clock[0] += 1 / 60;
  for (let k = 0; k < 6; k++) { const a = f * 0.3 + k; p[0] = Math.cos(a) * 0.4; p[1] = 1.2; p[2] = Math.sin(a) * 0.4; p[3] = Math.cos(a); p[4] = 1.2; p[5] = Math.sin(a); m.addSample(pool, owners[k], st, p); }
  m.closeUntouched(pool); m.pruneTrails(pool); m.buildRibbon(pool, out);
};
for (let f = 0; f < 20000; f++) frame(f);
globalThis.gc(); const before = space().space_used_size, N = 5000;
for (let f = 0; f < N; f++) frame(f);
console.log(JSON.stringify({ perFrame: (space().space_used_size - before) / N, vertices: out.vertices }));`;
test('毎コマの新規確保なし：6本の帯へ足して作り直しても、若い世代の確保が増えない', () => {
  const r = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', ALLOC_PROBE, new URL('../dist/valley/slash-trail.js', import.meta.url).href], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  if (r.stdout.trim() === 'skip') return;                                  // この版の V8 に若い世代の統計が無ければ測らない
  const { perFrame, vertices } = JSON.parse(r.stdout);
  assert(vertices > 0);
  assert(perFrame < 8, `young-generation growth ${perFrame.toFixed(2)} bytes/frame`);   // 物1つ（16バイト以上）×6本を作れば100を超える
});
