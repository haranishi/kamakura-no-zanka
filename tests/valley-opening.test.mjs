import test from 'node:test';
import assert from 'node:assert/strict';
import { OPENING } from '../dist/valley/opening-data.js';
import { planOf, createOpening, stepOpening, viewOf, flicker, contrast } from '../dist/valley/opening.js';
import { META_KEY, loadMeta, saveMeta, initialMeta, VALLEY_KEY, initialSave, saveValley, loadValley } from '../dist/valley/save.js';

const DT = 1 / 60;
// 最後まで（または maxT まで）1/60秒ずつ進め、毎コマの出力と出来事を集める
function run(version, { skipAt = null, skipEvery = false, reduced = false, maxT = 120, dt = DT } = {}) {
  let s = createOpening({ version }); const frames = [];
  for (let i = 0; i < maxT / dt && !s.done; i++) {
    const skip = skipEvery || (skipAt !== null && s.t < skipAt && s.t + dt >= skipAt);
    const r = stepOpening(s, { dt, skip, reduced });
    frames.push({ t: r.state.t, out: r.out, events: r.events }); s = r.state;
  }
  return { state: s, frames, events: frames.flatMap(f => f.events.map(e => [e, +f.t.toFixed(4)])) };
}
const storage = () => { const map = new Map(); return { map, getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) }; };

test('語りは設計の案の6画面のまま（id・文・史実と創作の区別）で、各画面40字以内', () => {
  assert.deepEqual(Object.keys(OPENING.lines), ['op_n1', 'op_n2', 'op_n3', 'op_n4', 'op_n5', 'op_n6']);
  assert.deepEqual(Object.values(OPENING.lines).map(l => l.text), [
    '元弘三年五月。鎌倉に、火が上がった。', 'およそ百五十年続いた幕府は、数日の攻防の末に滅んだ。', '東勝寺は焼け、北条一門は、そこで自害した。',
    '主を失った者たちは、散り散りに山へ向かった。', '榊三郎景継も、その一人。あの夜のことを、誰にも語らなかった。', '——その火は、まだ消えていなかった。']);
  assert.deepEqual(Object.values(OPENING.lines).map(l => l.kind), ['history', 'history', 'history', 'fiction', 'fiction', 'fiction']);
  for (const l of Object.values(OPENING.lines)) assert.ok([...l.text].length <= 40, l.text);
  assert.deepEqual(OPENING.title, { text: '残火の鎌倉', note: 'この物語の人物と谷は、創作です。' });
  assert.ok(Object.isFrozen(OPENING) && Object.isFrozen(OPENING.lines.op_n1) && Object.isFrozen(OPENING.versions.full.segments[0]));
});

test('合計の長さ：通常版は45〜75秒、短い版は約15秒（14〜16秒）', () => {
  assert.equal(planOf('full').total, 52.2);
  assert.ok(planOf('full').total >= 45 && planOf('full').total <= 75);
  assert.ok(planOf('short').total >= 14 && planOf('short').total <= 16, String(planOf('short').total));
  assert.equal(planOf('unknown').version, 'full');
  assert.equal(createOpening({ version: 'nope' }).version, 'full');
  for (const v of ['full', 'short']) {
    const r = run(v), end = r.events.find(e => e[0] === 'done')[1];
    assert.ok(Math.abs(end - planOf(v).total) <= 2 * DT, `${v}: done at ${end}`);
  }
});

test('区間は暗転で始まり、すき間なく続き、最後が既存の目覚め（5.2秒）', () => {
  for (const v of ['full', 'short']) {
    const { segments } = planOf(v);
    assert.equal(segments[0].id, 'dark'); assert.equal(segments[0].from, 0);
    assert.equal(segments.at(-1).id, 'wake'); assert.ok(Math.abs(segments.at(-1).to - segments.at(-1).from - 5.2) < 1e-9);
    assert.equal(segments.at(-2).id, 'title');
    for (let i = 1; i < segments.length; i++) { assert.equal(segments[i].from, segments[i - 1].to); assert.ok(segments[i].to > segments[i].from); }
  }
  assert.deepEqual(planOf('full').segments.map(s => s.id), ['dark', 'A', 'B', 'C', 'D', 'title', 'wake']);
  assert.deepEqual(planOf('short').segments.map(s => s.id), ['dark', 'A', 'D', 'title', 'wake']);
});

test('語りは場面の中にだけ出し、重ならず、文の長さに見合う時間を残す', () => {
  for (const v of ['full', 'short']) {
    const plan = planOf(v);
    for (const [i, l] of plan.lines.entries()) {
      const seg = plan.segments.filter(s => ['A', 'B', 'C', 'D'].includes(s.id)).find(s => l.at >= s.from && l.at < s.to);
      assert.ok(seg, `${v} ${l.id} starts inside a scene`);
      assert.ok(l.until <= plan.segments.find(s => s.id === 'title').from, `${l.id} ends before the title`);
      assert.ok(l.until - l.at >= Math.max(2.5, 0.15 * [...l.text].length), `${l.id} is on screen long enough`);
      if (i) assert.ok(l.at >= plan.lines[i - 1].until, `${l.id} does not overlap`);
    }
  }
  assert.deepEqual(planOf('short').lines.map(l => l.id), ['op_n1', 'op_n6']);
});

test('通しで見ると、語りが時刻どおりに出て消え、出来事は cut×3・seen・wake・getup・done の順', () => {
  const r = run('full');
  assert.deepEqual(r.events.map(e => e[0]), ['cut', 'cut', 'cut', 'seen', 'wake', 'getup', 'done']);
  const at = name => r.events.find(e => e[0] === name)[1];
  assert.ok(Math.abs(at('wake') - 47) <= 2 * DT); assert.ok(Math.abs(at('getup') - 49.7) <= 2 * DT);
  for (const l of planOf('full').lines) {
    const shown = r.frames.filter(f => f.out.line?.id === l.id && f.out.line.alpha > 0);
    assert.ok(shown.length > 0, l.id);
    assert.ok(shown[0].t >= l.at && shown.at(-1).t < l.until, `${l.id}: ${shown[0].t}..${shown.at(-1).t}`);
    assert.ok(shown.some(f => f.out.line.alpha === 1), `${l.id} reaches full opacity`);
  }
  const ids = [...new Set(r.frames.map(f => f.out.segment))];
  assert.deepEqual(ids, ['dark', 'A', 'B', 'C', 'D', 'title', 'wake']);
  assert.equal(r.frames.at(-1).out.done, true); assert.equal(r.frames.at(-1).out.skipped, false);
});

test('字の色は史実が生成り、創作が朱。帯の上で4.5:1以上', () => {
  const c = OPENING.colors;
  for (const l of planOf('full').lines) assert.equal(l.color, l.kind === 'history' ? c.history : c.fiction);
  assert.notEqual(c.history, c.fiction);
  for (const k of ['history', 'fiction', 'title', 'note', 'hint']) assert.ok(contrast(c[k], c.bar) >= 4.5, `${k}: ${contrast(c[k], c.bar).toFixed(2)}`);
  assert.ok(Math.abs(contrast('#ffffff', '#000000') - 21) < 1e-9); assert.ok(Math.abs(contrast('#777777', '#ffffff') - 4.4783) < 1e-3);
  assert.equal(contrast('#123456', '#123456'), 1); assert.ok(Math.abs(contrast('#ff0000', '#000000') - 5.252) < 1e-3);
});

test('開始から0.6秒は飛ばせない。0.6秒を過ぎた飛ばしは0.6秒で暗転して目覚めへ', () => {
  const early = run('full', { skipAt: 0.5, maxT: 3 });
  assert.equal(early.events.some(e => e[0] === 'skip'), false); assert.equal(early.frames.at(-1).out.skipped, false);
  const r = run('full', { skipAt: 10 });
  const at = name => r.events.find(e => e[0] === name)?.[1];
  assert.ok(Math.abs(at('skip') - 10) <= 2 * DT, String(at('skip')));
  assert.ok(Math.abs(at('wake') - 47) <= 2 * DT, 'the timeline jumps to the wake segment');
  const skipFrame = r.frames.findIndex(f => f.events.includes('skip')), wakeFrame = r.frames.findIndex(f => f.events.includes('wake'));
  assert.ok(Math.abs((wakeFrame - skipFrame) * DT - 0.6) <= 1.5 * DT, `${(wakeFrame - skipFrame) * DT}s from skip to wake`);
  const fading = r.frames.slice(skipFrame, wakeFrame);
  for (let i = 1; i < fading.length; i++) assert.ok(fading[i].out.black >= fading[i - 1].out.black);
  assert.ok(fading.at(-1).out.black > 0.95); assert.ok(fading.every(f => (f.out.line?.alpha ?? 0) <= 1 - (f.out.black - 0.001)));
  assert.deepEqual(r.events.map(e => e[0]), ['skip', 'seen', 'wake', 'getup', 'done'], 'no cut: the skip at 10s leaves before scene B');
  assert.equal(r.frames.at(-1).out.skipped, true);
  for (const t of [0.6, 0.61]) {
    const s = { ...createOpening(), t: t - DT };
    assert.equal(stepOpening(s, { dt: DT, skip: true }).events.includes('skip'), t - DT + DT > 0.6, `skip at ${t}`);
  }
});

test('目覚めの区間は、入って0.6秒を過ぎてから飛ばせる（既存の目覚めと同じ）', () => {
  const wake = planOf('full').wake.from;
  const at = t => ({ ...createOpening(), t, stood: t - wake > 2.7 });
  assert.deepEqual(stepOpening(at(wake + 0.3), { dt: DT, skip: true }).events, []);
  assert.deepEqual(stepOpening(at(wake + 0.65), { dt: DT, skip: true }).events, ['done']);
  assert.deepEqual(stepOpening(at(wake + 0.65), { dt: DT, skip: false }).events, []);
  const mashed = run('full', { skipEvery: true });
  assert.deepEqual(mashed.events.map(e => e[0]), ['skip', 'seen', 'wake', 'done']);
  const done = mashed.events.find(e => e[0] === 'done')[1];
  assert.ok(done > wake + 0.6 && done < wake + 0.6 + 2 * DT, String(done));
});

test('短い版は、暗転・n1・n6・題名・目覚めで約15秒。飛ばしも同じ規則', () => {
  const r = run('short');
  assert.deepEqual([...new Set(r.frames.map(f => f.out.segment))], ['dark', 'A', 'D', 'title', 'wake']);
  assert.deepEqual([...new Set(r.frames.filter(f => f.out.line).map(f => f.out.line.id))], ['op_n1', 'op_n6']);
  assert.deepEqual(r.events.map(e => e[0]), ['cut', 'seen', 'wake', 'getup', 'done']);
  const s = run('short', { skipAt: 2 });
  assert.ok(Math.abs(s.events.find(e => e[0] === 'wake')[1] - 10.5) <= 2 * DT);
});

test('暗転：暗転と題名は真っ黒、場面の中ほどは0、暗転からは明け、題名へは暮れる。目覚めは既存の暗転に任せる', () => {
  const r = run('full'), at = t => r.frames.find(f => f.t >= t).out;
  for (const t of [0.5, 1.9, 42.5, 44, 46.9]) assert.equal(at(t).black, 1, `t=${t}`);
  for (const t of [5, 15, 25, 35]) assert.equal(at(t).black, 0, `t=${t}`);
  assert.ok(at(2.5).black > 0 && at(2.5).black < 1); assert.ok(at(41.5).black > 0 && at(41.5).black < 1);
  for (const t of [47.1, 50]) assert.equal(at(t).black, 0, `wake t=${t}`);
  const a = r.frames.filter(f => f.t >= 2 && f.t <= 3.3);
  for (let i = 1; i < a.length; i++) assert.ok(a[i].out.black <= a[i - 1].out.black);
  assert.ok(at(44).title === 1 && at(41).title === 0 && at(46.99).title < 0.1);
});

test('場面から場面へは溶け合わせる（1.0秒）。暗転からと、題名へは溶けない', () => {
  const r = run('full'), at = t => r.frames.find(f => f.t >= t).out;
  for (const t of [11.5, 21, 30.5]) { assert.ok(at(t).dissolve > 0.95, `cut at ${t}`); assert.equal(at(t + 1.05).dissolve, 0); }
  for (const t of [2.01, 2.5, 42.01]) assert.equal(at(t).dissolve, 0, `t=${t}`);
  assert.deepEqual(r.frames.filter(f => f.events.includes('cut')).map(f => f.out.camera.shot), ['B', 'C', 'D']);
});

test('カメラの鍵：通常は区間の進みで動き、「動きを減らす」では止まる', () => {
  const normal = run('full', { maxT: 12 }).frames.filter(f => f.out.camera?.shot === 'A');
  assert.ok(normal[0].out.camera.k < 0.01 && normal.at(-1).out.camera.k > 0.99);
  for (let i = 1; i < normal.length; i++) assert.ok(normal[i].out.camera.k > normal[i - 1].out.camera.k);
  const still = run('full', { reduced: true }).frames.filter(f => f.out.camera);
  for (const f of still) assert.equal(f.out.camera.k, OPENING.shots[f.out.camera.shot].still);
  assert.equal(run('full').frames.find(f => f.t >= 0.5).out.camera, null);
});

test('同じ入力なら同じ出力。入力の状態は書き換えない。dtの0・負・NaN・無限は進めない', () => {
  assert.deepEqual(run('full', { skipAt: 20 }).frames, run('full', { skipAt: 20 }).frames);
  const s = createOpening(), copy = structuredClone(s);
  const r = stepOpening(s, { dt: 0.5, skip: true });
  assert.deepEqual(s, copy); assert.notEqual(r.state, s); assert.equal(r.state.t, 0.5);
  for (const dt of [0, -1, NaN, Infinity, -Infinity, undefined]) assert.equal(stepOpening(s, { dt }).state.t, 0, `dt=${dt}`);
  const done = run('full').state;
  const again = stepOpening(done, { dt: 1, skip: true });
  assert.deepEqual(again.events, []); assert.equal(again.state, done);
  assert.deepEqual(viewOf(createOpening()).segment, 'dark');
});

test('大きなdtでも出来事を落とさず順に出す（wake→getup→done）', () => {
  const r = stepOpening({ ...createOpening(), t: 46 }, { dt: 10 });
  assert.deepEqual(r.events, ['seen', 'wake', 'getup', 'done']);
  const cut = stepOpening({ ...createOpening(), t: 11 }, { dt: 1 });
  assert.deepEqual(cut.events, ['cut']); assert.equal(cut.out.camera.shot, 'B');
});

test('炎の揺らぎは1秒に3回以下の山で、明るさの幅は±15%', () => {
  for (const seed of [0, 1.3, 2.7, 5.1, 9.9]) {
    const step = 1 / 240, v = Array.from({ length: 60 / step }, (_, i) => flicker(i * step, seed));
    for (const x of v) assert.ok(x >= 0.85 && x <= 1.15, String(x));
    const peaks = []; for (let i = 1; i < v.length - 1; i++) if (v[i] > v[i - 1] && v[i] >= v[i + 1]) peaks.push(i * step);
    for (let w = 0; w < 59; w += 0.25) assert.ok(peaks.filter(p => p >= w && p < w + 1).length <= 3, `seed ${seed} window ${w}`);
  }
});

test('見たかの記録は進行の保存と別のキー。無い・壊れた・知らない版・読めない記録は初回として扱う', () => {
  assert.equal(META_KEY, 'kamakura-valley-meta'); assert.notEqual(META_KEY, VALLEY_KEY);
  assert.equal(loadMeta(storage()).meta.openingSeen, false);
  for (const text of ['{broken', 'null', '[]', '4', JSON.stringify({ ...initialMeta(), version: 2, openingSeen: true }), JSON.stringify({ ...initialMeta(), schema: 'other', openingSeen: true }), JSON.stringify({ ...initialMeta(), openingSeen: 'yes' })]) {
    const st = storage(); st.setItem(META_KEY, text);
    const r = loadMeta(st); assert.equal(r.meta.openingSeen, false, text); assert.ok(r.notice, text);
  }
  for (const st of [undefined, null, {}, { getItem() { throw Error('denied'); } }]) assert.equal(loadMeta(st).meta.openingSeen, false);
  const st = storage(); st.setItem(META_KEY, JSON.stringify({ ...initialMeta(), openingSeen: true, extra: 1 }));
  assert.deepEqual(loadMeta(st), { meta: { schema: META_KEY, version: 1, openingSeen: true }, notice: '' });
});

test('見たかの記録は「はじめから」の保存で消えず、書けない環境でも例外を出さない', () => {
  const st = storage();
  assert.deepEqual(saveMeta(st, { openingSeen: true }), { ok: true, notice: '' });
  assert.equal(loadMeta(st).meta.openingSeen, true);
  const fresh = initialSave(); fresh.checkpoint = 'cp_leave_temple'; fresh.beat = 'b2_road';
  assert.equal(saveValley(st, fresh, { fresh: true }).ok, true);
  assert.equal(loadMeta(st).meta.openingSeen, true); assert.equal(loadValley(st).hasSave, true);
  assert.deepEqual(JSON.parse(st.map.get(META_KEY)), { schema: META_KEY, version: 1, openingSeen: true });
  for (const bad of [undefined, null, {}, { getItem: () => null, setItem() { throw Error('quota'); } }]) {
    const r = saveMeta(bad, { openingSeen: true }); assert.equal(r.ok, false); assert.ok(r.notice);
  }
  assert.equal(saveMeta(st, { openingSeen: 'yes' }).ok, false); assert.equal(loadMeta(st).meta.openingSeen, true);
  const broken = storage(); broken.setItem(META_KEY, '{broken');
  assert.equal(saveMeta(broken, { openingSeen: true }).ok, true); assert.equal(loadMeta(broken).meta.openingSeen, true);
});
