// 刃の軌跡（8.3a）の純粋な部分：サンプルの保持・寿命・曲線での補間・頂点の並べ方・新規確保なし。
// 第2周：戻りに足さない・閉じたら0.05秒で消す・刃の軸に沿う動きは描かない（柱）・幅と長さの上限・突きの光の線。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  TRAIL, TRAIL_STYLES, TRAIL_VERTS, TRAIL_INDICES, trailStyleFor, trailWindow, inTrailWindow, createTrailPool, setTrailTime,
  addSample, closeUntouched, pruneTrails, buildRibbon, clearTrails, trailVelocity, trailStats, speedWeight, openSlotOf, trailEdges, lengthWeight, closeFade,
} from '../dist/valley/slash-trail.js';

const makeOut = () => ({ position: new Float32Array(TRAIL_VERTS * 3), uv: new Float32Array(TRAIL_VERTS * 2), color: new Float32Array(TRAIL_VERTS * 4), index: new Uint16Array(TRAIL_INDICES), vertices: 0, indices: 0 });
const P = new Float64Array(6);
// 1サンプル：内側の縁 A・外側の縁 B
const add = (pool, owner, style, t, a, b) => { setTrailTime(pool, t); P.set([...a, ...b]); return addSample(pool, owner, style, P); };
const frameEnd = (pool, t) => { setTrailTime(pool, t); closeUntouched(pool); pruneTrails(pool); };
// 試験用の見た目：尾を細らせず、速さで薄めない（位置と年齢だけを見る）
const plain = Object.freeze({ life: 1, alpha: 1, inner: 0, outer: 1, taper: 0, pivot: 1, speed: [-2, -1], head: [1, 1, 1], tail: [1, 1, 1] });
const GLINT = [1, 0.78, 0.34];   // battle.js の予兆の光の色（金色）

test('帯の見た目は技と陣営から選び、主人公を最も強く、敵は弱く、予兆の金色と色で分ける', () => {
  for (const id of ['light1', 'light2', 'counter']) assert.equal(trailStyleFor(id, 'hero'), TRAIL_STYLES.light, id);
  assert.equal(trailStyleFor('light3', 'hero'), TRAIL_STYLES.light3);
  for (const id of ['heavy', 'finisher', 'stealth']) assert.equal(trailStyleFor(id, 'hero'), TRAIL_STYLES.heavy, id);
  for (const id of ['soldier_slash', 'officer_a', 'officer_b']) assert.equal(trailStyleFor(id, 'enemy'), TRAIL_STYLES.enemy, id);
  assert.equal(trailStyleFor('officer_c', 'enemy'), TRAIL_STYLES.enemyHeavy);
  assert.equal(trailStyleFor('soldier_thrust', 'enemy'), TRAIL_STYLES.enemyThrust);
  for (const [id, team] of [['archer_shot', 'enemy'], ['ally_shot', 'ally'], ['light1', 'enemy'], ['soldier_slash', 'hero'], ['nope', 'hero']]) assert.equal(trailStyleFor(id, team), null, id + '/' + team);
  const S = TRAIL_STYLES;
  for (const [k, s] of Object.entries(S)) {
    assert(s.life >= 0.06 && s.life <= TRAIL.maxLife, k + ' life');                       // 一瞬（約0.1秒）で消える
    assert(s.alpha > 0 && s.alpha <= 1 && s.inner >= 0 && s.inner < s.outer && s.outer <= 1 && s.taper >= 0 && s.taper < 1, k);
  }
  // 三段目・強は、通常より長く・幅広く・濃く、尾に朱。主人公の最も弱い帯も、敵の最も強い帯より濃く明るい
  for (const k of ['light3', 'heavy']) assert(S[k].life > S.light.life && S[k].inner < S.light.inner && S[k].alpha > S.light.alpha && S[k].tail[0] > 2 * S[k].tail[2], k);
  const luma = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  for (const e of ['enemy', 'enemyHeavy', 'enemyThrust']) assert(S.light.alpha > S[e].alpha && luma(S.light.head) > luma(S[e].head), e);
  // 芯は白（色の偏りが小さい）、尾は青白（青が赤より強い）。予兆の金色（赤＞緑＞青）とは逆の偏り。朱の尾（強い技）だけが例外
  for (const [k, s] of Object.entries(S)) {
    assert(Math.max(...s.head) - Math.min(...s.head) < 0.05 && luma(s.head) >= 0.9, k + ' head white');
    if (k !== 'light3' && k !== 'heavy') assert(s.tail[2] > s.tail[0] && s.tail[2] > s.tail[1], k + ' tail bluish');
  }
  assert(GLINT[0] > GLINT[1] && GLINT[1] > GLINT[2]);
  assert.equal(S.enemyThrust.streak, true);
  for (const k of ['light', 'light3', 'heavy', 'enemy', 'enemyHeavy']) assert(!S[k].streak, k);
});

test('帯を出す区間は、判定の始め（接触）の0.08秒前から判定の終わりまで。戻りには出さない', () => {
  const m = { windup: 0.42, active: 0.12, recover: 0.55 };
  assert.deepEqual(trailWindow(m), { start: 0.42 - 0.08, end: 0.42 + 0.12 });
  for (const [t, want] of [[0.33, false], [0.34, true], [0.42, true], [0.54, true], [0.545, false], [0.6, false], [NaN, false], [Infinity, false]]) assert.equal(inTrailWindow(m, t), want, String(t));
});

test('帯の幅：刃の inner〜outer。上限（maxWidth）を超えない', () => {
  const ys = new Float64Array(2);
  for (const [k, s] of Object.entries(TRAIL_STYLES)) { trailEdges(s, 0.16, 0.88, ys); assert(ys[1] - ys[0] <= TRAIL.maxWidth + 1e-12 && ys[1] - ys[0] > 0.1 && Math.abs(ys[1] - 0.88) < 1e-12, k); }
  trailEdges({ inner: 0, outer: 1 }, 0.16, 0.88, ys);                      // 刃いっぱいを頼まれても、上限まで
  assert(Math.abs(ys[1] - ys[0] - TRAIL.maxWidth) < 1e-12);
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

test('寿命を過ぎたサンプルは尾から捨て、閉じた帯は closeFade 秒で薄れて空きに戻る（戻りに残さない）', () => {
  const pool = createTrailPool(), o = {}, life = TRAIL_STYLES.light.life;
  let t = 0;
  for (let f = 0; f < 30; f++) {
    t = f / 60; add(pool, o, TRAIL_STYLES.light, t, [f * 0.1, 1, 0], [f * 0.1, 2, 0]); frameEnd(pool, t);
    const S = pool.maxSamples, oldest = pool.time[(pool.head[0] - pool.count[0] + 1 + S) % S], second = pool.time[(pool.head[0] - pool.count[0] + 2 + S) % S];
    if (pool.count[0] >= 2) assert(t - second <= life + 1e-9, `frame ${f}: second-oldest age ${t - second}`);
    assert(t - oldest <= life + 1 / 60 + 1e-9, `frame ${f}: oldest age ${t - oldest}`);
  }
  assert(pool.count[0] >= 5 && pool.count[0] <= 7, `kept ${pool.count[0]}`);
  frameEnd(pool, t + 0.01);                                                // 足さなかった：閉じる
  assert.equal(pool.open[0], 0);
  assert.equal(pool.owner[0], o);                                          // 薄れている間は残る
  assert.equal(closeFade(pool, 0), 1);                                    // 閉じた瞬間は1、そこから closeFade 秒で0へ
  setTrailTime(pool, t + 0.03); assert(Math.abs(closeFade(pool, 0) - (1 - 0.02 / TRAIL.closeFade)) < 1e-9);
  const out = makeOut(); setTrailTime(pool, t + 0.01); buildRibbon(pool, out);
  const before = Math.max(...Array.from({ length: out.vertices }, (_, v) => out.color[v * 4 + 3]));
  setTrailTime(pool, t + 0.045); buildRibbon(pool, out);
  const later = Math.max(...Array.from({ length: out.vertices }, (_, v) => out.color[v * 4 + 3]));
  assert(later < before * 0.5 && later > 0, `close fade ${before} -> ${later}`);
  frameEnd(pool, t + 0.01 + TRAIL.closeFade + 0.001);                      // 閉じてから closeFade 秒：消えて空きに
  assert.equal(pool.owner[0], null);
  assert.equal(pool.count[0], 0);
  assert(TRAIL.closeFade <= 0.05 && TRAIL.maxLife <= 0.11);
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

test('柱にしない：刃が自分の軸に沿って動く（突き・引き）ときは濃さ0、同じ速さで横へ振れば最も濃い', () => {
  const st = TRAIL_STYLES.light, out = makeOut();
  const axial = createTrailPool(), side = createTrailPool();
  for (let k = 0; k < 3; k++) {
    add(axial, 'a', st, k / 60, [0, 1 + k * 0.5, 0], [0, 2 + k * 0.5, 0]);   // 刃（+Y）の向きへ毎秒30m
    add(side, 's', st, k / 60, [k * 0.5, 1, 0], [k * 0.5, 2, 0]);            // 刃に直交して毎秒30m
  }
  assert(axial.tipSpeed[2] > 29 && axial.speed[2] < 1e-3, `axial ${axial.tipSpeed[2]} ${axial.speed[2]}`);
  assert(Math.abs(side.speed[2] - 30) < 1e-3);
  setTrailTime(axial, 2 / 60); buildRibbon(axial, out);
  for (let v = 0; v < out.vertices; v++) assert.equal(out.color[v * 4 + 3], 0, `axial vertex ${v}`);
  setTrailTime(side, 2 / 60); buildRibbon(side, out);
  assert(Math.abs(out.color[(2 * TRAIL.subdiv) * 8 + 3] - st.alpha) < 1e-6);
});

test('長さの上限：先頭から切先の道のりが maxLength の半分を超えると薄れ、maxLength で0', () => {
  assert.equal(lengthWeight(0), 1); assert.equal(lengthWeight(TRAIL.maxLength * 0.5), 1); assert.equal(lengthWeight(TRAIL.maxLength), 0); assert.equal(lengthWeight(9), 0);
  assert(lengthWeight(TRAIL.maxLength * 0.75) > 0.3 && lengthWeight(TRAIL.maxLength * 0.75) < 0.7);
  const st = { ...TRAIL_STYLES.heavy, life: 1, speed: [-2, -1] }, pool = createTrailPool(), out = makeOut();
  for (let k = 0; k < 8; k++) add(pool, 'v', st, k / 60, [k * 0.4, 1, 0], [k * 0.4, 2, 0]);   // 1コマ0.4m：2.8mの道のり
  setTrailTime(pool, 7 / 60); buildRibbon(pool, out);
  const alpha = p => out.color[p * 8 + 3], last = 7 * TRAIL.subdiv;
  assert(Math.abs(alpha(last) - st.alpha) < 1e-6, 'head');
  for (let p = 0; p <= last; p++) { const d = (last - p) / TRAIL.subdiv * 0.4; if (d >= TRAIL.maxLength) assert(alpha(p) < 1e-9, `point ${p} at ${d}m: ${alpha(p)}`); }
});

test('突きの光の線：切先から刃の軸の向きへ、速さに応じた長さ（上限・下限）。カメラへ面を向け、突き以外には出さない', () => {
  const out = makeOut(), pool = createTrailPool(), st = TRAIL_STYLES.enemyThrust;
  pool.camera.set([0, 1.5, 5]);
  for (let k = 0; k < 3; k++) add(pool, 'th', st, k / 60, [k * 0.3, 1.4, 0], [0.7 + k * 0.3, 1.4, 0]);   // +X（刃の向き）へ毎秒18m
  setTrailTime(pool, 2 / 60);
  const n = buildRibbon(pool, out), ribbon = 2 * ((3 - 1) * TRAIL.subdiv + 1);
  assert.equal(out.vertices, ribbon + 4);
  assert.equal(n, 6 * ((3 - 1) * TRAIL.subdiv) + 6);
  const P = k => [out.position[k * 3], out.position[k * 3 + 1], out.position[k * 3 + 2]], tip = [1.3, 1.4, 0];
  const near = [0, 1].map(e => P(ribbon + e)), far = [2, 3].map(e => P(ribbon + e));
  const L = (far[0][0] + far[1][0]) / 2 - tip[0];
  assert(Math.abs(L - Math.min(TRAIL.streak.max, Math.max(TRAIL.streak.min, 18 * TRAIL.streak.k))) < 1e-4, `length ${L}`);
  for (let c = 0; c < 3; c++) assert(Math.abs((near[0][c] + near[1][c]) / 2 - tip[c]) < 1e-4, 'starts at the tip');
  assert(Math.abs(Math.abs(near[0][1] - near[1][1]) - 2 * TRAIL.streak.width) < 1e-4, 'faces the camera (spread in Y, not Z)');
  assert(out.color[(ribbon) * 4 + 3] > 0 && out.uv[(ribbon + 2) * 2] > out.uv[ribbon * 2], 'bright at the tip, fading forward');
  // 突きでない帯・遅い突きには出さない
  const slow = createTrailPool(); for (let k = 0; k < 3; k++) add(slow, 'th', st, k / 60, [k * 0.01, 1.4, 0], [0.7 + k * 0.01, 1.4, 0]);
  setTrailTime(slow, 2 / 60); buildRibbon(slow, out); assert.equal(out.vertices, ribbon);
  const cut = createTrailPool(); for (let k = 0; k < 3; k++) add(cut, 'c', TRAIL_STYLES.enemy, k / 60, [k * 0.3, 1.4, 0], [0.7 + k * 0.3, 1.4, 0]);
  setTrailTime(cut, 2 / 60); buildRibbon(cut, out); assert.equal(out.vertices, ribbon);
});

// 別のプロセスで測る（同じプロセスの他の試験が型の記録を混ぜると、最適化が外れて数の箱が作られ、測り違えた）
const ALLOC_PROBE = `
import v8 from 'node:v8';
const m = await import(process.argv[1]);
const space = () => v8.getHeapSpaceStatistics().find(s => s.space_name === 'new_space');
if (!space()) { console.log('skip'); process.exit(0); }
const pool = m.createTrailPool(), owners = [{}, {}, {}, {}, {}, {}], styles = Object.values(m.TRAIL_STYLES), p = new Float64Array(6);
const out = { position: new Float32Array(m.TRAIL_VERTS * 3), uv: new Float32Array(m.TRAIL_VERTS * 2), color: new Float32Array(m.TRAIL_VERTS * 4), index: new Uint16Array(m.TRAIL_INDICES), vertices: 0, indices: 0 };
const frame = f => {
  pool.clock[0] += 1 / 60;
  for (let k = 0; k < 6; k++) { const a = f * 0.3 + k; p[0] = Math.cos(a) * 0.4; p[1] = 1.2; p[2] = Math.sin(a) * 0.4; p[3] = Math.cos(a); p[4] = 1.2; p[5] = Math.sin(a); m.addSample(pool, owners[k], styles[k % styles.length], p); }
  m.closeUntouched(pool); m.pruneTrails(pool); m.buildRibbon(pool, out);
};
for (let f = 0; f < 20000; f++) frame(f);
globalThis.gc(); const before = space().space_used_size, N = 5000;
for (let f = 0; f < N; f++) frame(f);
console.log(JSON.stringify({ perFrame: (space().space_used_size - before) / N, vertices: out.vertices }));`;
// 第2周：6本に主人公・敵・突きの見た目をすべて混ぜる（第1周の試験は1つの見た目だけで、混ざると68バイト/コマ作っていたのを見逃した）
test('毎コマの新規確保なし：6本の帯（見た目をすべて混ぜる・突きの線を含む）へ足して作り直しても、若い世代の確保が増えない', () => {
  const r = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', ALLOC_PROBE, new URL('../dist/valley/slash-trail.js', import.meta.url).href], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  if (r.stdout.trim() === 'skip') return;                                  // この版の V8 に若い世代の統計が無ければ測らない
  const { perFrame, vertices } = JSON.parse(r.stdout);
  assert(vertices > 0);
  assert(perFrame < 8, `young-generation growth ${perFrame.toFixed(2)} bytes/frame`);   // 物1つ（16バイト以上）×6本を作れば100を超える
});
