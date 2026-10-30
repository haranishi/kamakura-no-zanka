// 振りの山を判定へ合わせ直す切り出し（8.3a・表示だけ）：3区間の速さ・使う区間・山の位置・動作の時刻の折れ線。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MOVES } from '../dist/valley/combat.js';
import { MOVE_CLIPS, MOVE_SYNC, segmentFor, syncedSegment, clipTimeAt } from '../dist/valley/anim-data.js';

const clips = JSON.parse(fs.readFileSync(new URL('../dist/assets/characters/clips.json', import.meta.url), 'utf8')).clips;
const synced = id => syncedSegment(clips[MOVE_CLIPS[id].clip], MOVES[id], MOVE_SYNC[id]);

test('合わせ直すのは突き（soldier_thrust）と侍大将の二段目（officer_b）だけ。上限の速さは1.8', () => {
  assert.deepEqual(Object.keys(MOVE_SYNC).sort(), ['officer_b', 'soldier_thrust']);
  for (const spec of Object.values(MOVE_SYNC)) assert.equal(spec.maxSpeed, 1.8);
});

test('3区間の切り出し：使う区間（from・to）は segmentFor のまま、山（active）を判定の区間の中央へ置き、山は判定の±40ms', () => {
  for (const id of Object.keys(MOVE_SYNC)) {
    const m = MOVES[id], meta = clips[MOVE_CLIPS[id].clip], base = segmentFor(meta, m), seg = synced(id), [a, b] = meta.active;
    assert.equal(seg.from, base.from, id); assert.equal(seg.to, base.to, id);
    assert.equal(seg.knots.length, 4, id);
    assert.deepEqual(seg.knots.map(k => k[1]), [base.from, a, b, base.to], id);
    const [t0, t1, t2, t3] = seg.knots.map(k => k[0]), total = m.windup + m.active + m.recover;
    assert.equal(t0, 0, id); assert(Math.abs(t3 - total) < 1e-12, id);
    assert(t0 < t1 && t1 < t2 && t2 < t3, id);
    assert(Math.abs((t1 + t2) / 2 - (m.windup + m.active / 2)) < 1e-9, `${id}: peak centred`);
    assert(Math.abs(t1 - m.windup) <= 0.040 && Math.abs(t2 - (m.windup + m.active)) <= 0.040, `${id}: ${t1} ${t2}`);
    assert.equal(seg.speeds.length, 3, id);
    for (const s of seg.speeds) assert(s > 0 && s <= MOVE_SYNC[id].maxSpeed + 1e-12, `${id}: ${seg.speeds}`);
    assert.equal(seg.speed, Math.max(...seg.speeds), id);
    // 区間ごとの速さは、折れ線の傾きと一致する
    seg.speeds.forEach((s, k) => assert(Math.abs(s - (seg.knots[k + 1][1] - seg.knots[k][1]) / (seg.knots[k + 1][0] - seg.knots[k][0])) < 1e-9, `${id} speed ${k}`));
  }
  // 侍大将の二段目は、上限に当たらず、山がちょうど判定の区間に重なる（前は山の終わりが判定の終わりより0.18秒遅かった）
  const ob = synced('officer_b');
  assert(Math.abs(ob.knots[1][0] - 0.40) < 1e-9 && Math.abs(ob.knots[2][0] - 0.52) < 1e-9);
  // 突きは振りの速さが上限（1.8）に当たり、山は判定の前後に15msずつはみ出す（前は山の始めが判定の0.367秒前）
  const th = synced('soldier_thrust');
  assert.equal(th.speeds[1], 1.8);
  assert(Math.abs(th.knots[1][0] - 0.685) < 1e-3 && Math.abs(th.knots[2][0] - 0.815) < 1e-3);
});

test('合わせられない動作・指定が無い技は、segmentFor のまま', () => {
  const meta = clips[MOVE_CLIPS.light2.clip];
  assert.deepEqual(syncedSegment(meta, MOVES.light2, null), segmentFor(meta, MOVES.light2));
  const noPeak = { ...meta, active: null };
  assert.deepEqual(syncedSegment(noPeak, MOVES.officer_b, MOVE_SYNC.officer_b), segmentFor(noPeak, MOVES.officer_b));
  // 山の前に動作が無い（from が山の始めと同じ）なら合わせない
  const late = { ...meta, active: [0, 0.2] };
  assert.equal(syncedSegment(late, MOVES.officer_b, MOVE_SYNC.officer_b).knots, undefined);
});

test('動作の時刻の折れ線：折れ目では値そのもの、あいだは直線、外は端の傾きで延ばし、単調に増える', () => {
  const knots = [[0, 0], [0.4, 0.267], [0.52, 0.467], [0.82, 0.667]];
  for (const [t, c] of knots) assert(Math.abs(clipTimeAt(knots, t) - c) < 1e-12, String(t));
  assert(Math.abs(clipTimeAt(knots, 0.2) - 0.1335) < 1e-12);
  assert(Math.abs(clipTimeAt(knots, 0.46) - 0.367) < 1e-12);
  assert(Math.abs(clipTimeAt(knots, -0.1) - -0.06675) < 1e-12);
  assert(Math.abs(clipTimeAt(knots, 1.12) - (0.667 + 0.3 * 0.2 / 0.3)) < 1e-12);
  let prev = -Infinity;
  for (let t = 0; t <= 1; t += 0.01) { const c = clipTimeAt(knots, t); assert(c > prev); prev = c; }
});
