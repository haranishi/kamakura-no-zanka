// なぜ失敗したか: 優先順・最古優先が崩れると戦闘が足音に押し出される。
// フェード中の束を数えないと28を超え、解放漏れは長時間遊ぶと無音を生む。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceBank, request, tick, stats, release, clear, endChild, endTail, PRIORITY, AMBIENT_KINDS } from '../dist/valley/voice-bank.js';
const req = (b, id, priority = 0, now = 0, extra = {}) => request(b, { id: String(id), priority, kind: 'step', now, ...extra });
const fill = (b, priority = 0) => { for (let i = 0; i < b.limit; i++) assert.equal(req(b, i, priority).accepted, true, 'fill: accepted'); };
test('29束は足28成功とUI置換成功、10msまで28を保つ [capacity]', () => {
  const b = createVoiceBank(); fill(b);
  const r = req(b, 'ui', PRIORITY.ui);
  assert.equal(r.action, 'steal', 'capacity: replace'); assert.equal(r.victim, '0', 'oldest: first'); assert.equal(r.startAt, 10, 'fade: reserved time');
  assert.deepEqual(stats(b), { requested: 29, started: 29, rejected: 0, stolen: 1, active: 28, pending: 1, ambient: 0 }, 'counters: reservation success');
  assert.deepEqual(tick(b, 9.999), [], 'fade: still counted');
  assert.deepEqual(tick(b, 10).map(e => [e.action, e.id]), [['stop', '0'], ['start', 'ui']], 'fade: stop before start');
  assert.equal(stats(b).active, 28, 'capacity: boundary');
  for (const voice of [...b.active]) { endChild(b, voice.id); endTail(b, voice.id); }
  assert.equal(stats(b).active + stats(b).pending + stats(b).ambient, 0, 'release: natural endings leave zero registrations');
  assert.equal(stats(b).requested, stats(b).started + stats(b).rejected, 'counters: every request accounted for');
});
test('UI28の満杯は他者の足を拒否、成功28拒否1 [priority]', () => {
  const b = createVoiceBank(); fill(b, PRIORITY.ui);
  assert.equal(req(b, 'foot').accepted, false, 'priority: cannot evict UI');
  assert.equal(stats(b).started, 28, 'counters: successes'); assert.equal(stats(b).rejected, 1, 'counters: reject');
});
test('優先順5段を守り同順以下の最古を選ぶ [priority-oldest]', () => {
  assert.deepEqual(Object.values(PRIORITY), [0, 1, 2, 3, 4], 'priority: explicit order');
  for (let incoming = 0; incoming <= 4; incoming++) for (let active = 0; active <= 4; active++) {
    const b = createVoiceBank({ limit: 1 }); req(b, 'old', active);
    assert.equal(req(b, 'new', incoming).accepted, incoming >= active, 'priority: ordered eligibility');
  }
  const b = createVoiceBank({ limit: 3 }); req(b, 'older-high', 2); req(b, 'new-low', 0); req(b, 'newest', 1);
  assert.equal(req(b, 'incoming', 2).victim, 'older-high', 'oldest: across eligible priorities');
  const c = createVoiceBank({ limit: 2 }); req(c, 'z', 1); req(c, 'a', 1);
  assert.equal(req(c, 'new', 1).victim, 'z', 'oldest: insertion order, not id');
});
test('待機28の満杯は拒否、全過程でactiveとpending各28以下 [pending]', () => {
  const b = createVoiceBank(); fill(b);
  for (let i = 0; i < 28; i++) assert.equal(req(b, `wait${i}`, 4).accepted, true, 'pending: reserved');
  assert.equal(req(b, 'overflow', 4).action, 'reject', 'pending: full');
  assert.equal(stats(b).pending, 28, 'pending: boundary');
  for (let t = 0; t <= 20; t++) { tick(b, t); assert.ok(stats(b).active <= 28 && stats(b).pending <= 28, 'capacity: every tick'); }
  assert.equal(stats(b).started, 56, 'counters: scheduled starts'); assert.equal(stats(b).rejected, 1, 'counters: pending refusal');
});
test('予約の連鎖も開始時刻を確定し大きなtickで順に実行 [wait]', () => {
  const b = createVoiceBank({ limit: 1, waitLimit: 2 }); req(b, 'first'); req(b, 'second');
  const r = req(b, 'third'); assert.equal(r.action, 'wait', 'wait: chained reservation'); assert.equal(r.startAt, 20, 'wait: after fade');
  assert.equal(req(b, 'fourth').accepted, false, 'wait: full');
  assert.deepEqual(tick(b, 100).map(e => [e.action, e.id, e.at]), [['stop', 'first', 10], ['start', 'second', 10], ['fade', 'second', 10], ['stop', 'second', 20], ['start', 'third', 20]], 'wait: chronological commands');
  assert.equal(stats(b).active, 1, 'wait: capacity');
});
test('早い解放や予約取消でも将来の枠を二重に使わない [reservation]', () => {
  const b = createVoiceBank({ limit: 1 }); req(b, 'a'); req(b, 'b'); release(b, 'a');
  assert.equal(req(b, 'c').startAt, 20, 'reservation: released slot still reserved');
  release(b, 'b'); tick(b, 20);
  assert.deepEqual(b.active.map(v => v.id), ['c'], 'reservation: cancellation keeps successor');
});
test('子音源の全終了と響き末尾の両方を待つ [lifecycle]', () => {
  for (const tailFirst of [false, true]) {
    const b = createVoiceBank(); req(b, 'layered', 0, 0, { children: 3 });
    if (tailFirst) endTail(b, 'layered');
    endChild(b, 'layered'); endChild(b, 'layered'); assert.equal(stats(b).active, 1, 'lifecycle: last child retained');
    endChild(b, 'layered');
    if (!tailFirst) { assert.equal(stats(b).active, 1, 'lifecycle: resonance retained'); endTail(b, 'layered'); }
    assert.equal(stats(b).active, 0, 'lifecycle: release after both');
    assert.equal(release(b, 'layered'), false, 'lifecycle: idempotent');
  }
});
test('環境7種は別枠・種類ごと1束、停止は予約も全解放 [ambient-clear]', () => {
  const b = createVoiceBank(); fill(b);
  for (const kind of AMBIENT_KINDS) assert.equal(req(b, kind, 0, 0, { ambient: true, kind }).accepted, true, 'ambient: separate capacity');
  assert.equal(req(b, 'duplicate', 0, 0, { ambient: true, kind: 'wind' }).accepted, false, 'ambient: unique kind');
  assert.equal(stats(b).ambient, 7, 'ambient: seven kinds'); assert.equal(stats(b).active, 28, 'ambient: excluded from 28');
  req(b, 'pending', 4); const ids = clear(b); assert.equal(ids.length, 36, 'clear: all bundles and reservations');
  assert.deepEqual(tick(b, 100), [], 'clear: no delayed starts'); assert.deepEqual(clear(b), [], 'clear: idempotent');
});
test('不正入力は状態を変えずTypeError、状態はJSON可能 [invalid-state]', () => {
  const b = createVoiceBank(); req(b, 'one', 0, 1);
  for (const extra of [{ now: NaN }, { now: Infinity }, { now: 0 }, { priority: NaN }, { priority: 5 }, { priority: -1 }, { priority: 0.5 }, { children: 0 }, { id: 'one' }, { ambient: true, kind: 'unknown' }]) {
    const before = JSON.stringify(b);
    assert.throws(() => request(b, { id: 'bad', priority: 0, kind: 'step', now: 1, ...extra }), TypeError, 'invalid: rejected');
    assert.equal(JSON.stringify(b), before, 'invalid: atomic validation');
  }
  for (const now of [NaN, Infinity, 0]) assert.throws(() => tick(b, now), TypeError, 'invalid: tick');
  for (const options of [{ limit: 29 }, { limit: 0 }, { waitLimit: 29 }, { fadeMs: NaN }]) assert.throws(() => createVoiceBank(options), TypeError, 'invalid: options');
  assert.deepEqual(JSON.parse(JSON.stringify(b)), b, 'state: serializable');
});

test('古さは予約要求順でなく実際の開始時刻で比較 [start-age]', () => {
  const b = createVoiceBank({ limit: 2 }); req(b, 'a'); req(b, 'b');
  req(b, 'reserved'); release(b, 'b'); req(b, 'earlier-start', 0, 1); tick(b, 10);
  assert.equal(req(b, 'next', 0, 10).victim, 'earlier-start', 'oldest: audible start precedes reservation order');
});
