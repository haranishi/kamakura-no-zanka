// 押し戻し（8.4a・knockback.js）と、とどめ・弾きの軽いスロー（8.5a・time-warp.js）の純粋な部分。
// 実ゲームの結線（壁・崖・ほかの人・三連の間合い・揺れ0）は tools/scenarios/regress-impact.mjs。
import test from 'node:test';
import assert from 'node:assert/strict';
import { KNOCK, knockDistance, createKnock, startKnock, endKnock, knockStep, knockEase, knockGap } from '../dist/valley/knockback.js';
import { SLOW, slowCurve, requestSlow, warpScale } from '../dist/valley/time-warp.js';
import { MOVES } from '../dist/valley/combat.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
// 1コマずつ押して、合計の距離と、押し終えたコマ数を返す
const pushAll = (dist, dt, frames = 400) => {
  const k = createKnock(); startKnock(k, 1, 0, dist);
  let sum = 0, n = 0;
  for (let i = 0; i < frames; i++) { const d = knockStep(k, dt); if (d > 0) { sum += d; n++; } }
  return { sum, n, k };
};

test('押し戻しの距離：約0.2m、強い技は0.25m、侍大将（重い鎧）は半分', () => {
  for (const id of ['light1', 'light2']) assert(near(knockDistance(id, 'light'), 0.2), id);
  for (const id of ['light3', 'heavy', 'counter', 'finisher']) assert(near(knockDistance(id, 'light'), 0.25), id);
  assert(near(knockDistance('light1', 'none'), 0.2));
  assert(near(knockDistance('light1', 'heavy'), 0.1) && near(knockDistance('heavy', 'heavy'), 0.125));
  assert(near(knockDistance('nope', 'light'), KNOCK.dist), '知らない技は基本の距離');
  for (const id of ['light1', 'light2', 'light3', 'heavy', 'counter', 'finisher']) assert(Object.hasOwn(MOVES, id), `combat.js の技の名前 ${id}`);
});

test('押し戻しの時間：合計は指定の距離で、刻み幅（30・60・144コマ/秒）によらない。始めが速い', () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 144, 0.05]) {
    const r = pushAll(0.2, dt);
    assert(near(r.sum, 0.2, 1e-12), `dt ${dt} 合計 ${r.sum}`);
    assert.equal(r.n, Math.ceil(KNOCK.dur / dt - 1e-9), `dt ${dt} のコマ数 ${r.n}`);
    assert.equal(r.k.dist, 0, '押し終えたら止まる');
  }
  assert(knockEase(0.5) > 0.7 && knockEase(0) === 0 && knockEase(1) === 1 && knockEase(2) === 1 && knockEase(-1) === 0, '始めが速い曲線');
  const k = createKnock(); startKnock(k, 0, 1, 0.2);
  const first = knockStep(k, 1 / 60), second = knockStep(k, 1 / 60);
  assert(first > second && second > 0, `1コマ目 ${first} ＞ 2コマ目 ${second}`);
});

test('押し戻しの向きと止め方：向きは正規化、向きなし・距離0・dt0以下・終えた後は押さない', () => {
  const k = createKnock();
  assert.equal(startKnock(k, 3, 4, 0.2), true);
  assert(near(k.dx, 0.6) && near(k.dz, 0.8) && k.dist === 0.2 && k.t === 0);
  assert.equal(knockStep(k, 0), 0); assert.equal(knockStep(k, -1), 0); assert.equal(knockStep(k, NaN), 0);
  assert(knockStep(k, 1 / 60) > 0);
  endKnock(k); assert.equal(knockStep(k, 1 / 60), 0, '止めた後は押さない');
  assert.equal(startKnock(k, 0, 0, 0.2), false); assert.equal(knockStep(k, 1 / 60), 0, '向きが無い');
  assert.equal(startKnock(k, 1, 0, 0), false); assert.equal(knockStep(k, 1 / 60), 0, '距離0');
  assert.equal(startKnock(k, 1, 0, NaN), false);
  // 押している途中に次の当たり：始めからやり直す（合計は新しい距離）
  startKnock(k, 1, 0, 0.2); for (let i = 0; i < 3; i++) knockStep(k, 1 / 60);
  startKnock(k, 0, 1, 0.25); let sum = 0; for (let i = 0; i < 60; i++) sum += knockStep(k, 1 / 60);
  assert(near(sum, 0.25, 1e-12) && near(k.dz, 1));
});

test('押し戻しとほかの人：中心0.72mより近づかない。離れる向きと遠い人は止めない。もう近ければ近づく向きだけ止める', () => {
  assert.equal(KNOCK.minGap, 0.72);
  // 押される人(0,0)が+xへ0.2m、ほかの人が+xの0.85m：0.13mで止まる
  let s = knockGap(0, 0, 0.2, 0, 0.85, 0);
  assert(near(s * 0.2, 0.85 - 0.72, 1e-9), `止まる所 ${s * 0.2}`);
  assert.equal(knockGap(0, 0, 0.2, 0, 3, 0), 1, '遠い人');
  assert.equal(knockGap(0, 0, -0.2, 0, 0.85, 0), 1, '離れる向き');
  assert.equal(knockGap(0, 0, 0.2, 0, 0.5, 0), 0, 'もう近い：近づく向きは止める');
  assert.equal(knockGap(0, 0, -0.2, 0, 0.5, 0), 1, 'もう近い：離れる向きは許す');
  s = knockGap(0, 0, 0.2, 0, 0.9, 0.5);                                      // 斜め前の人：その人へ0.72m以上
  const px = 0.2 * s; assert(Math.hypot(0.9 - px, 0.5) >= 0.72 - 1e-9);
});

test('スローの速さの曲線：始めはいちばん遅く、保ったあと滑らかに1倍へ戻る（単調・跳びなし）', () => {
  assert.equal(slowCurve(0), SLOW.scale); assert.equal(slowCurve(SLOW.hold), SLOW.scale); assert.equal(slowCurve(1), 1);
  let prev = slowCurve(0), maxJump = 0;
  for (let i = 1; i <= 1000; i++) { const v = slowCurve(i / 1000); assert(v >= prev - 1e-12, `単調 ${i}`); maxJump = Math.max(maxJump, v - prev); prev = v; }
  assert(maxJump < 0.01, `1/1000 刻みの跳び ${maxJump}`);
  assert(SLOW.dur >= 0.2 && SLOW.dur <= 0.3, '本人の指定「約0.25秒」');
  assert(SLOW.scale >= 0.2 && SLOW.scale < 1);
});

test('停止とスロー：重ねない。停止の間は停止の速さだけで、スローは停止が明けてから約0.25秒', () => {
  const STOP = 0.05, dt = 1 / 60, w = { stopT: 0.09, slowT: 0, slowDur: 0 };
  requestSlow(w);
  const scales = [];
  for (let i = 0; i < 40; i++) scales.push(warpScale(w, dt, STOP));
  const stops = scales.filter(s => s === STOP).length, slows = scales.filter(s => s > STOP && s < 1 - 1e-9).length;
  assert.equal(stops, Math.ceil(0.09 / dt), `停止のコマ ${stops}`);
  assert(scales.slice(0, stops).every(s => s === STOP), '停止は先に、停止の速さだけ（掛け算しない）');
  assert(scales.every(s => s === STOP || s >= SLOW.scale - 1e-12), `停止×スローの速さが無い ${Math.min(...scales)}`);
  assert(slows >= 14 && slows <= 15, `スローのコマ ${slows}（0.25秒＝60コマ/秒で15コマ）`);
  assert.equal(scales[stops], SLOW.scale, '明けた最初のコマからいちばん遅い');
  assert.equal(scales.at(-1), 1, 'その後は1倍');
  const game = scales.slice(stops).reduce((a, s) => a + s * dt, 0) - (scales.length - stops - slows) * dt;
  assert(game > 0.09 && game < 0.14, `スローの0.25秒で進むゲームの時間 ${game}`);
});

test('スローの頼み直し・停止なし・刻み幅', () => {
  const w = { stopT: 0, slowT: 0, slowDur: 0 };
  assert.equal(warpScale(w, 1 / 60, 0.05), 1, '何もなければ1倍');
  assert.equal(requestSlow(w, 0), false); assert.equal(requestSlow(w, -1), false); assert.equal(warpScale(w, 1 / 60, 0.05), 1);
  requestSlow(w); for (let i = 0; i < 10; i++) warpScale(w, 1 / 60, 0.05);
  requestSlow(w); assert.equal(warpScale(w, 1 / 60, 0.05), SLOW.scale, '途中で頼み直すと、始めから');
  for (const dt of [1 / 30, 1 / 144]) {
    const v = { stopT: 0, slowT: 0, slowDur: 0 }; requestSlow(v);
    let real = 0; while (warpScale(v, dt, 0.05) < 1 - 1e-9 && real < 1) real += dt;
    assert(Math.abs(real - SLOW.dur) <= dt + 1e-9, `dt ${dt}：スローの実時間 ${real}`);
  }
  // 停止の途中で新しい停止：停止が長くなるだけで、スローの残りは減らない
  const u = { stopT: 0.05, slowT: 0, slowDur: 0 }; requestSlow(u);
  warpScale(u, 1 / 60, 0.05); u.stopT = Math.max(u.stopT, 0.07); warpScale(u, 1 / 60, 0.05);
  assert.equal(u.slowT, SLOW.dur, '停止の間はスローを減らさない');
});
