import test from 'node:test';
import assert from 'node:assert/strict';
import { percentile, summarize, judgeRun, judgeAll } from '../dist/valley/perf-stats.js';
const run = (ms = [20], quality = 'standard') => ({ ms, calls: ms.map(() => 900), tris: ms.map(() => 5_000_000), quality });

test('percentile uses ceil(q*n)-1 without sorting caller samples', () => {
  const samples = Array.from({ length: 100 }, (_, i) => 100 - i), before = [...samples];
  assert.equal(percentile(samples, .95), 95);
  assert.equal(percentile(samples, .99), 99);
  assert.equal(percentile([7], .95), 7);
  assert.deepEqual(samples, before);
  for (const invalid of [[], [1, NaN], [Infinity], [-Infinity], Array(2)]) assert.equal(percentile(invalid, .95), null);
});
test('summarize retains diagnostics and reports unavailable empty or invalid statistics', () => {
  assert.deepEqual(summarize([4, 1, 3, 2]), { n: 4, mean: 2.5, min: 1, p50: 2, p95: 4, p99: 4, max: 4 });
  for (const samples of [[], [NaN]]) assert.deepEqual(summarize(samples), { n: samples.length, mean: null, min: null, p50: null, p95: null, p99: null, max: null });
});
test('p95 decides each quality at the inclusive boundary, never mean or maximum ms', () => {
  assert.equal(judgeRun(run(), 'standard').pass, true);
  assert.equal(judgeRun(run([33.3]), 'light').pass, true);
  assert.equal(judgeRun(run([33.31]), 'light').pass, false);
  // Mean is below 20, while p95 is above 20.
  assert.equal(judgeRun(run([...Array(94).fill(1), ...Array(6).fill(21)]), 'standard').pass, false);
  // Maximum and mean exceed 20, but exactly 95% are at the limit.
  assert.equal(judgeRun(run([...Array(95).fill(20), ...Array(5).fill(1000)]), 'standard').pass, true);
});
test('calls and triangles use every frame maximum, never their average', () => {
  const calls = run(Array(100).fill(1)); calls.calls.fill(1); calls.calls[99] = 901;
  assert.deepEqual(judgeRun(calls, 'standard').reasons, ['毎コマの描画呼出が900を超えています']);
  const tris = run([1, 1]); tris.tris = [1, 5_000_001];
  assert.deepEqual(judgeRun(tris, 'standard').reasons, ['毎コマの三角形が500万を超えています']);
});
test('invalid or missing frame samples and unknown quality cannot pass', () => {
  for (const bad of [run([]), { ...run(), calls: [] }, { ...run(), tris: [NaN] }]) assert.equal(judgeRun(bad, 'standard').pass, false);
  assert.equal(judgeRun(run(), 'unknown').pass, false);
});
test('all eight runs pass individually; a failure cannot be offset by seven cheap runs', () => {
  const runs = Array.from({ length: 8 }, (_, i) => run([1], i < 4 ? 'standard' : 'light'));
  assert.equal(judgeAll(runs).pass, true);
  runs[7].ms = [34];
  assert.equal(judgeAll(runs).pass, false);
  assert.match(judgeAll(runs).reasons[0], /8回目/);
  for (const n of [0, 7, 9]) assert.equal(judgeAll(Array.from({ length: n }, () => run())).pass, false);
});

test('QA samples exactly the requested frames through GPU readback and captures per-render counters and metadata', async t => {
  const { installQA } = await import('../dist/valley/qa.js');
  const oldWindow = globalThis.window;
  globalThis.window = {};
  let clock = 0, frame = 0, phase = 'idle';
  t.mock.method(performance, 'now', () => clock);
  const gl = { RGBA: 1, UNSIGNED_BYTE: 2, readPixels() { assert.equal(phase, 'rendered'); clock += 3; phase = 'read'; } };
  const game = { input: {}, post: { quality: 'light' },
    update(dt) { assert.equal(dt, .02); clock += 2; },
    render(dt) { assert.equal(dt, .02); frame++; clock += 5; phase = 'rendered'; },
    renderer: { getContext: () => gl, getPixelRatio: () => 1.5, domElement: { width: 1920, height: 1080 },
      info: { render: { get calls() { assert.equal(phase, 'rendered'); return frame * 10; }, get triangles() { assert.equal(phase, 'rendered'); return frame * 100; } } } } };
  try {
    const api = installQA(game, {}), result = api.perfSamples(3, .02);
    assert.deepEqual(result, { frames: 3, dt: .02, ms: [10, 10, 10], calls: [10, 20, 30], tris: [100, 200, 300], quality: 'light', w: 1920, h: 1080, dpr: 1.5 });
    assert.equal(frame, 3);
    for (const n of [0, -1, 1.5, Infinity]) assert.throws(() => api.perfSamples(n), RangeError);
  } finally { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; }
});
