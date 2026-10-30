// 振りの山を判定へ合わせ直す切り出し（8.3a・表示だけ）：3区間の速さ・使う区間・山の位置・動作の時刻の折れ線。
// 第2周：接触（刃が相手の胴の高さを通って最も近づく動作の時刻）を判定の始めへ置く切り出し（contactSegment・moveSegment）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MOVES } from '../dist/valley/combat.js';
import { MOVE_CLIPS, MOVE_SYNC, CLIP_SEGMENTS, MOVE_CONTACT, CONTACT_MAX_SPEED, segmentFor, syncedSegment, contactSegment, moveSegment, clipTimeAt, timeAtClip } from '../dist/valley/anim-data.js';

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

// ---------------------------------------------------------------------------------------------------- 接触（8.3a 第2周）
const before = id => { const meta = clips[MOVE_CLIPS[id].clip]; return MOVE_SYNC[id] ? syncedSegment(meta, MOVES[id], MOVE_SYNC[id]) : segmentFor(meta, MOVES[id], CLIP_SEGMENTS[MOVE_CLIPS[id].clip]); };
const total = id => MOVES[id].windup + MOVES[id].active + MOVES[id].recover;

test('接触の時刻は弓以外の11技。動作の長さの内で、手首の山の始めの0.1秒前〜山の終わりの0.1秒後', () => {
  assert.deepEqual(Object.keys(MOVE_CONTACT).sort(), Object.keys(MOVE_CLIPS).filter(id => !/shot$/.test(id)).sort());
  for (const [id, c] of Object.entries(MOVE_CONTACT)) {
    const meta = clips[MOVE_CLIPS[id].clip], [a, b] = meta.active;
    assert(c > 0 && c < meta.seconds && c >= a - 0.1 && c <= b + 0.1, `${id}: ${c} vs [${a}, ${b}]`);
  }
  assert.equal(CONTACT_MAX_SPEED, 1.8);
});

test('接触を判定の始めへ：折れ線で判定の始めの動作の時刻が接触。速さは1.8以下（とどめは今の2.0以下）、折れ線は単調、端は0と技の長さ', () => {
  for (const id of Object.keys(MOVE_CONTACT)) {
    const m = MOVES[id], seg = moveSegment(id, clips[MOVE_CLIPS[id].clip], m), old = before(id);
    assert(Math.abs(clipTimeAt(seg.knots, m.windup) - MOVE_CONTACT[id]) < 1e-9, `${id}: contact at the judge start`);
    assert(Math.abs(timeAtClip(seg.knots, MOVE_CONTACT[id]) - m.windup) < 1e-9 && seg.contact === MOVE_CONTACT[id], id);
    assert.equal(seg.knots[0][0], 0); assert(Math.abs(seg.knots.at(-1)[0] - total(id)) < 1e-9, id);
    assert.equal(seg.knots[0][1], seg.from); assert.equal(seg.knots.at(-1)[1], seg.to);
    for (let k = 1; k < seg.knots.length; k++) assert(seg.knots[k][0] > seg.knots[k - 1][0] && seg.knots[k][1] > seg.knots[k - 1][1], `${id}: monotonic ${k}`);
    seg.speeds.forEach((v, k) => assert(Math.abs(v - (seg.knots[k + 1][1] - seg.knots[k][1]) / (seg.knots[k + 1][0] - seg.knots[k][0])) < 1e-9, `${id} speed ${k}`));
    const cap = Math.max(CONTACT_MAX_SPEED, old.speed);
    assert(seg.speed <= cap + 1e-9 && seg.speed === Math.max(...seg.speeds), `${id}: ${seg.speeds}`);
    if (old.speed > CONTACT_MAX_SPEED) assert(seg.speed <= old.speed + 1e-9, `${id}: already above the cap, not raised`);
    assert(seg.from >= 0 && seg.to <= clips[MOVE_CLIPS[id].clip].seconds + 1e-9, id);
  }
});

test('接触の前後（振り）は今の振りの速さより遅くしない。使う長さは今より短くしない（light2 だけ、上限1.8倍で使える最大＝0.954秒）', () => {
  for (const id of Object.keys(MOVE_CONTACT)) {
    const m = MOVES[id], seg = moveSegment(id, clips[MOVE_CLIPS[id].clip], m), old = before(id);
    const k = seg.knots.findIndex(([t]) => Math.abs(t - m.windup) < 1e-9), strike = old.speeds ? old.speeds[1] : old.speed;
    assert(k > 0 && seg.speeds[k] >= strike - 1e-9, `${id}: after the contact ${seg.speeds} vs ${strike}`);
    if ((MOVE_CONTACT[id] - old.from) / m.windup >= strike) assert(seg.speeds[k - 1] >= strike - 1e-9, `${id}: before the contact ${seg.speeds}`);   // 1つの速さで間に合う技は、予備から振りまで遅くしない
    const used = seg.to - seg.from, was = old.to - old.from;
    if (id === 'light2') assert(Math.abs(used - CONTACT_MAX_SPEED * total(id)) < 1e-9 && was - used < 0.015, `light2 ${used} vs ${was}`);
    else assert(used >= was - 1e-9, `${id}: ${used} < ${was}`);
  }
});

test('moveSegment：弓は決め打ちのまま。山の記録が無い・接触が数でないときは今の切り出しのまま', () => {
  for (const id of ['archer_shot', 'ally_shot']) { const meta = clips[MOVE_CLIPS[id].clip]; assert.deepEqual(moveSegment(id, meta, MOVES[id]), segmentFor(meta, MOVES[id], CLIP_SEGMENTS[MOVE_CLIPS[id].clip])); }
  const meta = clips[MOVE_CLIPS.light1.clip], base = segmentFor(meta, MOVES.light1);
  assert.equal(contactSegment({ ...meta, active: null }, MOVES.light1, 0.79, base), base);
  assert.equal(contactSegment(meta, MOVES.light1, NaN, base), base);
  assert.equal(moveSegment('nope', meta, MOVES.light1), null);
});

test('timeAtClip は clipTimeAt の逆（折れ目・あいだ・外）', () => {
  const knots = [[0, 0.11], [0.15, 0.38], [0.2, 0.467], [0.53, 1.06]];
  for (const t of [0, 0.05, 0.15, 0.17, 0.2, 0.4, 0.53, -0.1, 0.7]) assert(Math.abs(timeAtClip(knots, clipTimeAt(knots, t)) - t) < 1e-12, String(t));
});
