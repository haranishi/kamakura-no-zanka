// 節目の演出の枠（C0a後半）の純粋な部品と、演出の記録の読み書き（save.js）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReturnRegistry, skipDown, cinematicView } from '../dist/valley/cinematics-frame.js';
import { createCinematicPlayer, stepCinematic, CINEMATICS_STORAGE_KEY } from '../dist/valley/cinematics.js';
import { validateCinematicTable } from '../dist/valley/cinematics-data.js';
import { loadCinematicsRecord, saveCinematicsRecord, META_KEY, saveMeta, loadMeta } from '../dist/valley/save.js';

const cam = (from, to) => ({ anchor: 'hero', from, to, lookAt: [0, 1.4, 0], fov: 40 });
const shot = (sec, id) => ({ durationSec: sec, camera: cam([0, 2, 4], [2, 2, 4]), subtitleIds: [id], gestures: ['look'], scenery: [],
  still: { camera: cam([1, 1.6, 3], [1, 1.6, 3]), gestures: ['still'] } });
const entry = () => ({ id: 'qa', chapter: 1, kind: 'event', trigger: 'qa', stage: 'valley', prepareSec: 0.2, transitionSec: 0.3,
  returnSec: 0.5, returnTarget: 'play', shots: [shot(3, 'a'), shot(2, 'b')] });
const text = { a: '一つ目', b: '二つ目' };
const run = (s, sec, dt = 1 / 60) => { for (let t = 0; t < sec - 1e-9; t += dt) stepCinematic(s, dt, { down: {} }); return s; };
const fresh = () => { const s = createCinematicPlayer(entry()); stepCinematic(s, 0, { down: {} }); return s; };

test('return registry resolves only registered names and feeds the table check', () => {
  const r = createReturnRegistry(), calls = [];
  r.register('play', x => calls.push(x));
  assert.deepEqual(r.names(), ['play']);
  assert.equal(r.resolve('battle'), null);
  r.resolve('play')(1); assert.deepEqual(calls, [1]);
  assert.throws(() => r.register('', () => {})); assert.throws(() => r.register('x', null));
  assert.deepEqual(validateCinematicTable([entry()], { textById: text, returnTargets: r.names() }), []);
  assert.ok(validateCinematicTable([{ ...entry(), returnTarget: 'battle' }], { textById: text, returnTargets: r.names() }).some(e => e.includes('return target')));
});

test('skipDown counts a press released within the frame and ignores other keys', () => {
  const sets = (held = [], mouse = [], pressed = [], mousePressed = []) => ({ held: new Set(held), mouse: new Set(mouse), pressed: new Set(pressed), mousePressed: new Set(mousePressed) });
  assert.deepEqual(skipDown(sets()), { KeyE: false, Space: false, Mouse0: false });
  assert.deepEqual(skipDown(sets(['KeyE'], [2], ['KeyF'])), { KeyE: true, Space: false, Mouse0: false });
  assert.deepEqual(skipDown(sets([], [], ['Space'], [0])), { KeyE: false, Space: true, Mouse0: true });
});

test('a tap shorter than one frame still skips after the hint (pressed edge, then released)', () => {
  const s = fresh(); run(s, 0.7);
  const r = stepCinematic(s, 1 / 60, { down: skipDown({ held: new Set(), mouse: new Set(), pressed: new Set(['KeyE']), mousePressed: new Set() }) });
  assert.ok(r.events.some(e => e.type === 'skip'));
});

test('view weight: 0→1 over preparation, 1 while playing, 1→0 while returning', () => {
  const s = fresh();
  assert.equal(cinematicView(s).weight, 0);
  run(s, 0.25); assert.ok(Math.abs(cinematicView(s).weight - 0.5) < 0.04);
  run(s, 0.5); const v = cinematicView(s, { textById: text });
  assert.equal(s.phase, 'playing'); assert.equal(v.weight, 1); assert.equal(v.subtitle, '一つ目'); assert.equal(v.shotIndex, 0);
  run(s, 3); const w = cinematicView(s, { textById: text });
  assert.equal(w.subtitle, '二つ目'); assert.equal(w.shotIndex, 1); assert.equal(w.subtitleKey, 'b');
  run(s, 2.05); assert.equal(s.phase, 'returning');
  const back = cinematicView(s); assert.ok(back.weight < 1 && back.weight > 0); assert.equal(back.subtitle, ''); assert.equal(back.hint, false);
});

test('camera moves from→to within a shot; reduced motion uses the still camera, cuts and never moves', () => {
  const s = fresh(); run(s, 0.5 + 1.5);
  const mid = cinematicView(s); assert.ok(mid.pos[0] > 0.9 && mid.pos[0] < 1.1, String(mid.pos));
  const still = cinematicView(s, { reduced: true });
  assert.deepEqual(still.pos, [1, 1.6, 3]); assert.equal(still.weight, 1); assert.deepEqual(still.gestures, ['still']);
  const p0 = fresh(); assert.equal(cinematicView(p0, { reduced: true }).weight, 1);   // 準備中でも混ぜない（切り替え）
  run(s, 3.6); assert.equal(s.phase, 'returning'); assert.equal(cinematicView(s, { reduced: true }).weight, 0);
});

test('skip hint shows from 0.6s until the skip', () => {
  const s = fresh(); run(s, 0.55); assert.equal(cinematicView(s).hint, false);
  run(s, 0.1); assert.equal(cinematicView(s).hint, true);
  stepCinematic(s, 1 / 60, { down: { KeyE: true } }); assert.equal(s.phase, 'returning'); assert.equal(cinematicView(s).hint, false);
});

const store = (init = {}, { failGet = false, failSet = false } = {}) => {
  const m = new Map(Object.entries(init));
  return { m, getItem: k => { if (failGet) throw new Error('blocked'); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { if (failSet) throw new Error('quota'); m.set(k, String(v)); } };
};
const rec = v => JSON.stringify({ schema: CINEMATICS_STORAGE_KEY, version: 1, ...v });

test('record: missing is not seen without a notice; a valid record is read', () => {
  assert.deepEqual(loadCinematicsRecord(store()), { record: { schema: CINEMATICS_STORAGE_KEY, version: 1, chapter1EndSeen: false }, notice: '' });
  assert.equal(loadCinematicsRecord(store({ [CINEMATICS_STORAGE_KEY]: rec({ chapter1EndSeen: true }) })).record.chapter1EndSeen, true);
  assert.equal(loadCinematicsRecord(store({ [CINEMATICS_STORAGE_KEY]: rec({}) })).record.chapter1EndSeen, false);   // 旧形（項目なし）
});
for (const [label, raw] of [['wrong type', rec({ chapter1EndSeen: 'yes' })], ['null value', rec({ chapter1EndSeen: null })], ['broken JSON', '{'],
  ['unknown version', JSON.stringify({ schema: CINEMATICS_STORAGE_KEY, version: 2, chapter1EndSeen: true })], ['array', '[]']]) {
  test(`record: ${label} falls back to not seen with a notice`, () => {
    const r = loadCinematicsRecord(store({ [CINEMATICS_STORAGE_KEY]: raw }));
    assert.equal(r.record.chapter1EndSeen, false); assert.ok(r.notice.length > 0);
  });
}
test('record: unreadable storage gives a notice and does not throw', () => {
  const r = loadCinematicsRecord(store({}, { failGet: true }));
  assert.equal(r.record.chapter1EndSeen, false); assert.ok(r.notice);
  assert.ok(loadCinematicsRecord(null).notice);
});
test('record: save writes only the normalized shape under its own key and keeps openingSeen', () => {
  const s = store(); saveMeta(s, { openingSeen: true });
  assert.deepEqual(saveCinematicsRecord(s, { chapter1EndSeen: true }), { ok: true, notice: '' });
  assert.deepEqual(JSON.parse(s.m.get(CINEMATICS_STORAGE_KEY)), { schema: CINEMATICS_STORAGE_KEY, version: 1, chapter1EndSeen: true });
  assert.equal(loadMeta(s).meta.openingSeen, true); assert.ok(s.m.has(META_KEY));
  assert.equal(saveCinematicsRecord(s, { chapter1EndSeen: false }).ok, true);
  assert.equal(loadCinematicsRecord(s).record.chapter1EndSeen, false); assert.equal(loadMeta(s).meta.openingSeen, true);
});
test('record: invalid patch, write failure and missing storage report without throwing', () => {
  const s = store({ [CINEMATICS_STORAGE_KEY]: rec({ chapter1EndSeen: true }) });
  assert.equal(saveCinematicsRecord(s, { chapter1EndSeen: 1 }).ok, false);
  assert.equal(loadCinematicsRecord(s).record.chapter1EndSeen, true);                   // 不正な書込で前の記録を壊さない
  assert.equal(saveCinematicsRecord(store({}, { failSet: true }), { chapter1EndSeen: true }).ok, false);
  assert.equal(saveCinematicsRecord(null, { chapter1EndSeen: true }).ok, false);
});
