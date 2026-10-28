// なぜ失敗したか: 各テスト名とassertのメッセージに [原因の型] を付け、
// 欠落・二重通知・境界・混合・抑止・復帰・入力のどの契約が壊れたかを示す。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createContactTracker, observeContacts } from '../dist/valley/foot-contacts.js';

// Synthetic timings only; these are not measured animation phases.
const table = {
  walk: { duration: 1, loop: true, contacts: [{ foot: 'left', t: 0.2 }, { foot: 'right', t: 0.7 }] },
  run: { duration: 0.4, loop: true, contacts: [{ foot: 'left', t: 0.04 }, { foot: 'right', t: 0.24 }] },
  crouch: { duration: 1.6, loop: true, contacts: [{ foot: 'left', t: 0.5 }, { foot: 'right', t: 1.4 }] },
};
const src = (clip, time, weight = 1, target = false, speed = 1) => ({ clip, time, weight, target, speed });
const obs = (time, extra = {}) => ({ actor: 'hero', sources: [src('walk', time)], moving: true, airborne: false, near: true, reset: false, ...extra });
function tracker(t = table) {
  let state = createContactTracker();
  return { at(time, extra = {}) { const result = observeContacts(state, obs(time, extra), t); state = result.state; return result.contacts; }, state: () => state };
}
const ids = cs => cs.map(c => `${c.clip}/${c.loop}/${c.foot}`);
const eq = (actual, expected, kind) => assert.deepEqual(actual, expected, `[${kind}]`);
function simulate(clip, steps, speedAt = () => 1) {
  const tr = tracker(), duration = table[clip].duration, end = duration * 5;
  let time = 0, i = 0;
  const contacts = tr.at(0, { sources: [src(clip, 0)] });
  while (time < end) {
    const speed = speedAt(i), next = Math.min(end, time + steps[i % steps.length] * speed);
    time = next; i++;
    contacts.push(...tr.at(0, { sources: [src(clip, time % duration, 1, false, speed)] }));
  }
  return contacts;
}
for (const clip of Object.keys(table)) test(`5周で10接地・左右交互・重複0 ${clip} [cycles]`, () => {
  const cs = simulate(clip, [1 / 60]);
  eq(cs.length, 10, 'missing-contact'); eq(new Set(ids(cs)).size, 10, 'duplicate');
  eq(cs.map(c => c.foot), Array.from({ length: 10 }, (_, i) => i % 2 ? 'right' : 'left'), 'alternation');
  eq(cs.map(c => c.loop), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4], 'loop-count');
});
test('60/30/15Hz・不規則の同じ接地集合 [sampling]', () => {
  for (const clip of Object.keys(table)) for (const steps of [[1 / 30], [1 / 15], [0.013, 0.071, 0.021, 0.049]])
    eq(ids(simulate(clip, steps)), ids(simulate(clip, [1 / 60])), 'sampling-loss');
});
test('0.05秒で複数接地を跨いでも全列挙 [large-step]', () => {
  const dense = { walk: { duration: 0.2, loop: true, contacts: [{ foot: 'left', t: 0.01 }, { foot: 'right', t: 0.03 }] } };
  const tr = tracker(dense); tr.at(0);
  eq(tr.at(0.05).map(c => c.foot), ['left', 'right'], 'multiple-contacts');
});
test('開区間の下端・閉区間の上端と同一観測 [interval]', () => {
  const baseline = tracker(); baseline.at(0.2); eq(baseline.at(0.21), [], 'baseline-lower-bound');
  const tr = tracker(); tr.at(0);
  eq(tr.at(0.2).length, 1, 'upper-bound'); eq(tr.at(0.2), [], 'repeat-observation');
  eq(tr.at(0.21), [], 'lower-bound'); eq(tr.at(0.7).length, 1, 'upper-bound');
});
test('t=0とduration直前とdurationそのもの [wrap-boundary]', () => {
  const t = { walk: { duration: 1, loop: true, contacts: [{ foot: 'left', t: 0 }, { foot: 'right', t: 0.999 }] } };
  for (const endpoint of [0, 1]) {
    const tr = tracker(t); tr.at(0.9);
    eq(ids(tr.at(0.999)), ['walk/0/right'], 'before-duration');
    eq(ids(tr.at(endpoint)), ['walk/1/left'], 'zero-contact');
    eq(tr.at(0), [], 'duration-zero-alias'); eq(tr.at(0.01), [], 'zero-repeat');
  }
});
test('一度の周回跨ぎで末尾と次周の先頭を時刻順に出す [wrap-span]', () => {
  const tr = tracker({ walk: { duration: 1, loop: true, contacts: [{ foot: 'left', t: 0.01 }, { foot: 'right', t: 0.99 }] } });
  tr.at(0.98);
  const cs = tr.at(0.02);
  eq(ids(cs), ['walk/0/right', 'walk/1/left'], 'wrap-span-missing');
  eq(cs.map(c => c.contactTime), [0.99, 1.01], 'monotonic-contact-time');
  assert.ok(cs[0].ago > cs[1].ago, '[wrap-ago-order]');
});
test('速度0.55〜2とヒットストップ0.05倍でも集合不変 [speed]', () => {
  for (const clip of Object.keys(table)) eq(ids(simulate(clip, [1 / 60], i => [0.55, 2, 0.05, 1.2][Math.floor(i / 13) % 4])), ids(simulate(clip, [1 / 60])), 'speed-loss');
});
test('agoは今回の実効速度で実秒へ換算 [ago]', () => {
  for (const speed of [0.55, 2, 0.05]) {
    const tr = tracker(); tr.at(0.19);
    const [c] = tr.at(0, { sources: [src('walk', 0.21, 1, false, speed)] });
    assert.ok(Math.abs(c.ago - 0.01 / speed) < 1e-12, '[ago-speed]');
    eq(c.contactTime, 0.2, 'contact-time'); eq(c.actor, 'hero', 'actor');
  }
});
test('歩き→走り→屈み、最大重みだけが発音 [mix-weight]', () => {
  const tr = tracker();
  const mix = (a, b, wa, wb) => tr.at(0, { sources: [src('walk', a, wa), src('run', b, wb, true)] });
  mix(0.1, 0.01, 0.8, 0.2);
  eq(ids(mix(0.25, 0.1, 0.8, 0.2)), ['walk/0/left'], 'maximum-weight');
  eq(mix(0.6, 0.25, 0.2, 0.8), [], 'switch-backlog');
  eq(ids(mix(0.8, 0.05, 0.2, 0.8)), ['run/1/left'], 'source-selection');
  eq(tr.at(0, { sources: [src('run', 0.3, 0.2), src('crouch', 1.5, 0.8, true)] }), [], 'crouch-backlog');
  eq(tr.at(0, { sources: [src('crouch', 0.1)] }), [], 'crouch-wrap');
  eq(ids(tr.at(0, { sources: [src('crouch', 0.6)] })), ['crouch/1/left'], 'crouch-source');
});
test('同率では移行先、入力の順序に依存しない [mix-tie]', () => {
  for (const reverse of [false, true]) {
    const tr = tracker();
    const sample = (w, r) => { const sources = [src('walk', w, 0.5), src('run', r, 0.5, true)]; return tr.at(0, { sources: reverse ? sources.reverse() : sources }); };
    sample(0.1, 0.01);
    eq(ids(sample(0.25, 0.1)), ['run/0/left'], 'tie-target');
  }
});
test('同じ周の足は発音元を往復しても一度だけ [dedup-ledger]', () => {
  const tr = tracker(); tr.at(0.1); tr.at(0.25);
  tr.at(0, { sources: [src('run', 0.1)] });
  tr.at(0.1); // A reset action time in the same loop is a new baseline, not a contact.
  eq(tr.at(0.25), [], 'consumed-identity');
});
for (const flags of [{ moving: false }, { airborne: true }]) test(`停止/空中の時刻追跡と復帰 ${JSON.stringify(flags)} [suppression]`, () => {
  const tr = tracker(); tr.at(0.1);
  eq(tr.at(0.8, flags), [], 'silent-state');
  eq(tr.at(0.9), [], 'resume-backlog');
  eq(tr.at(0.1), [], 'resume-wrap'); eq(ids(tr.at(0.25)), ['walk/1/left'], 'resume-next-contact');
});
test('速度0・逆再生は無音、正転復帰で遡らない [nonpositive-speed]', () => {
  for (const speed of [0, -1]) {
    const tr = tracker(); tr.at(0.1);
    eq(tr.at(0, { sources: [src('walk', 0.8, 1, false, speed)] }), [], 'nonpositive-speed');
    eq(tr.at(0.9), [], 'speed-resume-backlog');
  }
});
test('resetによる前進/後退の時刻飛び・休止復帰 [reset]', () => {
  for (const jump of [0.8, 0.05]) {
    const tr = tracker(); tr.at(0.1);
    eq(tr.at(jump, { reset: true }), [], 'reset-backlog');
    eq(tr.at(jump), [], 'reset-repeat');
  }
  const tr = tracker(); tr.at(0.1); tr.at(0.25);
  tr.at(0.1, { reset: true }); eq(tr.at(0.25), [], 'reset-consumed-identity');
});
test('画面外でcursorを消し、復帰は現在時刻から [near]', () => {
  const tr = tracker(); tr.at(0.1);
  eq(tr.at(0.15, { near: false }), [], 'far-silent');
  eq(tr.state().actors[0].clips[0].time, null, 'far-cursor-clear');
  eq(tr.at(0.8), [], 'near-backlog');
  eq(tr.at(0.9), [], 'near-repeat');
});
test('無重み・sourceなしからの復帰は起点を作り直す [inactive]', () => {
  const tr = tracker(); tr.at(0.1);
  eq(tr.at(0.3, { sources: [src('walk', 0.3, 0)] }), [], 'zero-weight');
  eq(tr.at(0.8), [], 'zero-weight-backlog');
  eq(tr.at(0, { sources: [] }), [], 'empty-source');
  eq(tr.at(0.2), [], 'empty-source-backlog');
});
test('actor間で状態と通知を混ぜない [actor-isolation]', () => {
  const tr = tracker(); tr.at(0.1); tr.at(0.1, { actor: 'ally' });
  eq(tr.at(0.25).map(c => c.actor), ['hero'], 'hero-identity');
  eq(tr.at(0.25, { actor: 'ally' }).map(c => c.actor), ['ally'], 'ally-identity');
});
function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
test('入力state・obs・tableを変更せず同じ結果を返す [purity]', () => {
  const state = freeze(observeContacts(createContactTracker(), obs(0.1), table).state);
  const input = freeze(obs(0.8)), t = freeze(structuredClone(table)), before = JSON.stringify({ state, input, t });
  const a = observeContacts(state, input, t), b = observeContacts(state, input, t);
  eq(a, b, 'determinism'); eq(JSON.stringify({ state, input, t }), before, 'input-mutation');
});
test('非有限値・未知clip・不正な表はTypeError、状態を壊さない [invalid-input]', () => {
  const state = freeze(createContactTracker());
  const fails = (o, t = table) => assert.throws(() => observeContacts(state, o, t), TypeError, '[invalid-input]');
  for (const key of ['time', 'weight', 'speed']) for (const n of [NaN, Infinity, -Infinity, '1']) fails(obs(0, { sources: [{ ...src('walk', 0), [key]: n }] }));
  for (const s of [src('unknown', 0), src('walk', -0.1), src('walk', 1.1), src('walk', 0, -1), { ...src('walk', 0), target: 1 }]) fails(obs(0, { sources: [s] }));
  fails(obs(0, { sources: [src('walk', 0), src('walk', 0)] }));
  for (const o of [null, {}, obs(0, { actor: '' }), obs(0, { moving: 1 }), obs(0, { sources: null })]) fails(o);
  for (const t of [null, [], { walk: null }, { walk: { ...table.walk, duration: 0 } }, { walk: { ...table.walk, duration: Infinity } }, { walk: { ...table.walk, loop: false } }, { walk: { ...table.walk, contacts: null } }]) fails(obs(0), t);
  for (const contacts of [[{ foot: 'heel', t: 0 }], [{ foot: 'left', t: NaN }], [{ foot: 'left', t: -1 }], [{ foot: 'left', t: 1 }], [...table.walk.contacts].reverse()]) fails(obs(0), { walk: { ...table.walk, contacts } });   // 同じ足が複数回着く表は正しい（[multi-contact]）
  eq(state, createContactTracker(), 'error-state-mutation');
});

// なぜ失敗したか（2026-10-27）: 村人の歩き（Casual_Walk）は、4.2秒に同じ足が3回着く。最初の実装は、通知の識別を (actor, clip, loop, foot) とし、
// 表の検証で「同じ足の重複」を弾いたので、実データの表で例外になり、表全体が使えなくなった。識別に、表の中の番号（index）を足した。
test('同じ足が1周に3回着く表でも、全部・一度ずつ・左右交互 [multi-contact]', () => {
  const multi = { casual: { duration: 4.2, loop: true, contacts: [
    { foot: 'left', t: 0.07 }, { foot: 'right', t: 0.74 }, { foot: 'left', t: 1.4 }, { foot: 'right', t: 2.1 }, { foot: 'left', t: 2.77 }, { foot: 'right', t: 3.53 }] } };
  for (const steps of [[1 / 60], [1 / 30], [0.013, 0.071, 0.021, 0.049]]) {
    const tr = tracker(multi), end = 4.2 * 3 - 0.01, cs = tr.at(0, { sources: [src('casual', 0)] });
    let time = 0, i = 0;
    while (time < end) { time = Math.min(end, time + steps[i++ % steps.length]); cs.push(...tr.at(0, { sources: [src('casual', time % 4.2)] })); }
    const key = c => `${c.loop}/${c.index}`;
    eq(cs.length, 18, 'multi-contact-loss'); eq(new Set(cs.map(key)).size, 18, 'duplicate');
    eq(cs.map(c => c.foot), Array.from({ length: 18 }, (_, k) => k % 2 ? 'right' : 'left'), 'alternation');
    eq(cs.map(c => c.contactTime), [...cs.map(c => c.contactTime)].sort((a, b) => a - b), 'order');
  }
});

