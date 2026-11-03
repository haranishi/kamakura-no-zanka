import test from 'node:test';
import assert from 'node:assert/strict';
import { CINEMATIC_LIMITS, CINEMATICS, validateCinematicTable } from '../dist/valley/cinematics-data.js';
import { createCinematicPlayer, stepCinematic, planSafeStart, createPlayedSet, canReserve,
  markReserved, markEnded, CINEMATICS_STORAGE_KEY, normalizeCinematicsRecord, planResume } from '../dist/valley/cinematics.js';

const camera = () => ({ anchor: 'hero', from: [0, 1, 2], to: [1, 1, 2], lookAt: [0, 1, 0], fov: 50 });
const shot = durationSec => ({ durationSec, camera: camera(), subtitleIds: ['line'], gestures: ['look'],
  scenery: ['wind'], still: { camera: camera(), gestures: ['look'] } });
const entry = (total = 5) => ({ id: 'test', chapter: 1, kind: 'event', trigger: 'confirmed', stage: 'valley',
  prepareSec: 0.2, transitionSec: 0.3, returnSec: 0.5, returnTarget: 'battle', shots: [shot(total - 1)] });
const ctx = { textById: { line: '帰ろう。' }, returnTargets: ['battle'] };
const validate = e => validateCinematicTable([e], ctx);
const player = (battle = false) => createCinematicPlayer(entry(), { fromBattle: battle });
const tick = (s, dt, down = {}, flags = {}) => stepCinematic(s, dt, { down, ...flags });
const ended = r => r.events.filter(e => e.type === 'ended');
const skipped = r => r.events.some(e => e.type === 'skip');
const near = (a, b) => assert(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('limits are fixed and the production table is empty/frozen', () => {
  assert.deepEqual(CINEMATIC_LIMITS, { minDurationSec: 5, maxDurationSec: 10, skipHintSec: 0.6,
    skipHoldSec: 0.6, maxSkipReturnSec: 0.6, safeWaitSec: 3, maxTextChars: 40 });
  assert(Object.isFrozen(CINEMATIC_LIMITS)); assert(Object.isFrozen(CINEMATICS));
  assert.deepEqual(CINEMATICS, []); assert.deepEqual(validateCinematicTable(CINEMATICS, ctx), []);
});
for (const [sec, valid] of [[4.99, false], [5, true], [10, true], [10.01, false], [11, false]]) {
  test(`total duration ${sec}s includes preparation, transition and return`, () => {
    assert.equal(validate(entry(sec)).length === 0, valid);
  });
}
test('only explicitly marked open entries are exempt from the duration range', () => {
  const e = { ...entry(52.2), kind: 'open', opening: true };
  assert.deepEqual(validate(e), []);
  assert(validate({ ...e, opening: false }).length);
  for (const kind of ['event', 'end']) assert(validate({ ...e, kind }).length);
});
test('reject duplicate ids, invalid chapters/kinds, empty and malformed scenes', () => {
  assert(validateCinematicTable([entry(), entry()], ctx).some(e => e.includes('duplicate')));
  for (const chapter of [0, -1, 1.1, '1', NaN]) assert(validate({ ...entry(), chapter }).length);
  for (const kind of ['start', '', null]) assert(validate({ ...entry(), kind }).length);
  for (const chapter of [1, 2]) assert(validate({ ...entry(), chapter, shots: [] }).length);
  for (const v of [null, {}, 2]) assert(validateCinematicTable(v, ctx).length);
  assert(validateCinematicTable([null], ctx).length);
  const e = { ...entry(), chapter: 2 };
  assert.deepEqual(validate(e), [], 'real later-chapter content is allowed');
});
test('reject unknown references, invalid timing/cameras/cues/still shots', () => {
  assert(validate({ ...entry(), returnTarget: 'missing' }).length);
  for (const field of ['prepareSec', 'transitionSec', 'returnSec']) {
    for (const value of [-1, NaN, Infinity, '1', undefined]) assert(validate({ ...entry(), [field]: value }).length);
  }
  assert(validate({ ...entry(), returnSec: 0.61 }).length);
  for (const patch of [{ durationSec: 0 }, { durationSec: -1 }, { durationSec: Infinity },
    { camera: null }, { camera: { ...camera(), from: [NaN, 0, 0] } }, { camera: { ...camera(), fov: 180 } },
    { subtitleIds: ['missing'] }, { subtitleIds: null }, { gestures: null }, { scenery: [3] }, { still: null }]) {
    assert(validate({ ...entry(), shots: [{ ...shot(4), ...patch }] }).length, JSON.stringify(patch));
  }
  assert(validate({ ...entry(), shots: [null] }).length);
});
for (const [length, valid] of [[40, true], [41, false]]) {
  test(`subtitle screen of ${length} Unicode characters`, () => {
    assert.equal(validateCinematicTable([entry()], { ...ctx, textById: { line: '灯'.repeat(length) } }).length === 0, valid);
    assert.equal(validateCinematicTable([entry()], { ...ctx, textById: { line: '𠮷'.repeat(length) } }).length === 0, valid);
  });
}
test('multiple subtitles share one 40-character screen allowance', () => {
  const e = entry(); e.shots[0].subtitleIds = ['a', 'b'];
  assert(validateCinematicTable([e], { ...ctx, textById: { a: '灯'.repeat(21), b: '帰'.repeat(20) } }).length);
});
test('skip hint occurs once at 0.6s, never at 0.3 or 0.59s', () => {
  const s = player();
  assert.deepEqual(tick(s, 0.3).events, []);
  assert.deepEqual(tick(s, 0.29).events, []);
  assert.deepEqual(tick(s, 0.01).events, [{ type: 'skip-hint' }]);
  assert.deepEqual(tick(s, 0.3).events, []);
});
for (const key of ['KeyE', 'Space', 'Mouse0']) {
  test(`ordinary ${key}: initial hold ignored; new press at 0.6 consumes input`, () => {
    const s = player();
    assert(!skipped(tick(s, 0.6, { [key]: true })));
    assert(!skipped(tick(s, 0.2, { [key]: true })));
    tick(s, 0, {});
    const r = tick(s, 0, { [key]: true });
    assert(skipped(r)); assert.deepEqual(r.consumed, [key]); assert.equal(s.phase, 'returning');
    const done = tick(s, 0.5, { [key]: true });
    assert.deepEqual(ended(done), [{ type: 'ended', skipped: true }]);
    assert.deepEqual(done.consumed, [key]);
    assert.deepEqual(tick(s, 10).events, []);
  });
  test(`battle ${key}: initial hold and tapping do not skip; fresh 0.6s hold does`, () => {
    const s = player(true);
    assert(!skipped(tick(s, 0.8, { [key]: true })));
    assert(!skipped(tick(s, 0.8, { [key]: true })));
    tick(s, 0, {});
    for (let i = 0; i < 5; i++) {
      assert(!skipped(tick(s, 0.01, { [key]: true })));
      assert(!skipped(tick(s, 0.1, { [key]: true })));
      assert(!skipped(tick(s, 0.01, {})));
    }
    tick(s, 0, { [key]: true });
    assert(!skipped(tick(s, 0.59, { [key]: true })));
    const r = tick(s, 0.01, { [key]: true });
    assert(skipped(r)); assert.deepEqual(r.consumed, [key]);
    assert.deepEqual(ended(tick(s, 0.5)), [{ type: 'ended', skipped: true }]);
  });
}
test('ordinary press before 0.6 is not queued and holding it past the hint does not skip', () => {
  const s = player(); tick(s, 0);
  assert(!skipped(tick(s, 0.59, { KeyE: true })));
  assert(!skipped(tick(s, 0.01, { KeyE: true })));
  tick(s, 0); assert(skipped(tick(s, 0, { KeyE: true })));
});
test('battle requires simultaneous release of all three operations after starting', () => {
  const s = player(true);
  tick(s, 0.7, { KeyE: true, Mouse0: true });
  tick(s, 0, { Mouse0: true });
  tick(s, 0, { KeyE: true });
  assert(!skipped(tick(s, 0.7, { KeyE: true })));
  assert.equal(s.released, false);
  tick(s, 0); tick(s, 0, { Space: true });
  assert(skipped(tick(s, 0.6, { Space: true })));
});
test('battle hold durations are per operation and not added across keys', () => {
  const s = player(true); tick(s, 0.7); tick(s, 0, { KeyE: true });
  tick(s, 0.4, { KeyE: true }); tick(s, 0, { Space: true });
  assert(!skipped(tick(s, 0.4, { Space: true })));
  assert(skipped(tick(s, 0.2, { Space: true })));
});
test('skip reaches the return destination within 0.6s even with maximal return time', () => {
  const e = entry(); e.returnSec = 0.6;
  const s = createCinematicPlayer(e); tick(s, 0.6);
  assert(skipped(tick(s, 0, { KeyE: true })));
  assert.equal(s.phase, 'returning');
  assert.deepEqual(ended(tick(s, 0.6)), [{ type: 'ended', skipped: true }]);
});
test('preparing, playing, shot boundaries, returning and ended honor total time', () => {
  const e = entry(); e.shots = [shot(1), shot(3)];
  const original = structuredClone(e), s = createCinematicPlayer(e), notices = [];
  assert.equal(s.phase, 'preparing'); tick(s, 0.49); assert.equal(s.phase, 'preparing');
  tick(s, 0.01); assert.equal(s.phase, 'playing'); assert.equal(s.shotIndex, 0);
  tick(s, 1); assert.equal(s.shotIndex, 1); near(s.shotTimeSec, 0);
  tick(s, 3); assert.equal(s.phase, 'returning');
  notices.push(...ended(tick(s, 0.5)));
  for (let i = 0; i < 5; i++) notices.push(...ended(tick(s, 10)));
  assert.equal(s.phase, 'ended'); assert.deepEqual(notices, [{ type: 'ended', skipped: false }]);
  assert.deepEqual(e, original, 'source data remains intact');
});
test('large steps carry time across phases and still emit completion exactly once', () => {
  const s = player();
  assert.deepEqual(tick(s, 10).events, [{ type: 'skip-hint' }, { type: 'ended', skipped: false }]);
  assert.deepEqual(tick(s, 10).events, []);
});
for (const flag of ['paused', 'hidden']) {
  test(`${flag} freezes time and holds; resume discards elapsed time and does not forge a press`, () => {
    const s = player(true); tick(s, 0.6); tick(s, 0, { KeyE: true }); tick(s, 0.3, { KeyE: true });
    const before = s.elapsedSec;
    assert.deepEqual(tick(s, 100, { KeyE: true }, { [flag]: true }).events, []);
    near(s.elapsedSec, before);
    assert.deepEqual(tick(s, 100, { KeyE: true }).events, []); near(s.elapsedSec, before);
    assert(!skipped(tick(s, 0.3, { KeyE: true })));
    assert(skipped(tick(s, 0.3, { KeyE: true })));
  });
  test(`${flag} freezes returning and never duplicates ending`, () => {
    const s = player(); tick(s, 4.5);
    tick(s, 10, {}, { [flag]: true }); assert.equal(s.phase, 'returning');
    tick(s, 10); assert.equal(s.phase, 'returning');
    assert.equal(ended(tick(s, 0.5)).length, 1); assert.equal(ended(tick(s, 10)).length, 0);
  });
}
test('paused ordinary inputs cannot turn into a fresh press on resume', () => {
  const s = player(); tick(s, 0.6);
  tick(s, 50, { KeyE: true }, { paused: true }); tick(s, 50, { KeyE: true });
  assert(!skipped(tick(s, 0.1, { KeyE: true })));
  tick(s, 0); assert(skipped(tick(s, 0, { KeyE: true })));
});
test('invalid dt does not move the clock', () => {
  const s = player();
  for (const dt of [-1, NaN, Infinity, undefined, '1']) tick(s, dt);
  assert.equal(s.elapsedSec, 0); assert.equal(s.phase, 'preparing');
});
test('safe start boundaries and cancellation precedence', () => {
  for (const waitedSec of [0, 2.99, 3]) {
    assert.equal(planSafeStart({ waitedSec, safe: false }), 'wait');
    assert.equal(planSafeStart({ waitedSec, safe: true }), 'start');
  }
  for (const safe of [false, true]) assert.equal(planSafeStart({ waitedSec: 3.01, safe }), 'give-up');
  assert.equal(planSafeStart({ waitedSec: 3.01, safe: true, cancelled: true }), 'cancel');
  assert.equal(planSafeStart({ waitedSec: 2.99, safe: false, cancelled: true }), 'cancel');
});
test('reservation and ending happen once per id/attempt, including retry', () => {
  const set = createPlayedSet();
  assert.equal(markEnded(set, 'end', 1), false);
  assert.equal(canReserve(set, 'end', 1), true); assert.equal(markReserved(set, 'end', 1), true);
  assert.equal(markReserved(set, 'end', 1), false); assert.equal(canReserve(set, 'end', 1), false);
  assert.equal(markEnded(set, 'end', 1), true); assert.equal(markEnded(set, 'end', 1), false);
  assert.equal(markReserved(set, 'end', 1), false); assert.equal(markReserved(set, 'end', 2), true);
  assert.equal(markReserved(set, 'other', 1), true);
  assert.equal(markReserved(set, 'a:1', 2), true); assert.equal(markReserved(set, 'a', '1:2'), true);
  assert.equal(canReserve(createPlayedSet(), 'end', 1), true);
});
const record = value => ({ schema: CINEMATICS_STORAGE_KEY, version: 1, chapter1EndSeen: value });
test('record absent or optional flag absent defaults to false; true and false round-trip', () => {
  for (const raw of [null, undefined, { schema: CINEMATICS_STORAGE_KEY, version: 1 }]) {
    assert.deepEqual(normalizeCinematicsRecord(raw), { record: record(false), notice: '' });
  }
  for (const seen of [true, false]) {
    for (const raw of [record(seen), JSON.stringify(record(seen))]) {
      assert.deepEqual(normalizeCinematicsRecord(raw), { record: record(seen), notice: '' });
    }
  }
});
test('present optional flag of a non-boolean type rejects the entire record', () => {
  for (const value of [undefined, null, 0, 1, 'true', [], {}]) {
    const r = normalizeCinematicsRecord(record(value));
    assert.deepEqual(r.record, record(false)); assert(r.notice);
  }
});
test('unknown versions, broken values and unreadable values reset with a notice', () => {
  const unreadable = { get schema() { throw new Error('unreadable'); } };
  for (const raw of [{ ...record(true), version: 2 }, { ...record(true), schema: 'other' }, {}, [],
    true, 1, '', '{', 'null', '[]', new Error('read failed'), unreadable]) {
    const r = normalizeCinematicsRecord(raw);
    assert.deepEqual(r.record, record(false)); assert(r.notice);
  }
});
test('resume only replays an unfinished cp_result, never opening or passed milestones', () => {
  for (const checkpoint of ['cp_start', 'cp_village', 'cp_viewpoint', null]) {
    assert.equal(planResume({ checkpoint, record: record(false) }), 'none');
  }
  for (const raw of [undefined, record(false), record('true')]) {
    assert.equal(planResume({ checkpoint: 'cp_result', record: raw }), 'play-end');
  }
  assert.equal(planResume({ checkpoint: 'cp_result', record: record(true) }), 'to-result');
});
for (const rate of [30, 60, 144]) {
  test(`completion at 5s and exactly one hint/ending at ${rate} updates per second`, () => {
    const s = player(), events = [];
    for (let i = 0; i < rate * 5 - 1; i++) events.push(...tick(s, 1 / rate).events);
    assert.notEqual(s.phase, 'ended');
    events.push(...tick(s, 1 / rate).events);
    assert.equal(s.phase, 'ended'); near(s.elapsedSec, 5);
    assert.deepEqual(events, [{ type: 'skip-hint' }, { type: 'ended', skipped: false }]);
  });
}
test('ordinary new press on the exact 0.6s boundary skips, including during preparation', () => {
  const e = entry(); e.prepareSec = 1; e.shots = [shot(3.2)];
  const s = createCinematicPlayer(e); tick(s, 0);
  const r = tick(s, 0.6, { KeyE: true });
  assert(skipped(r)); assert.equal(s.phase, 'returning');
});
test('a long dt on a new battle press is not counted as time held', () => {
  const s = player(true); tick(s, 0.6);
  assert(!skipped(tick(s, 1, { KeyE: true })));
  assert(skipped(tick(s, 0.6, { KeyE: true })));
});
