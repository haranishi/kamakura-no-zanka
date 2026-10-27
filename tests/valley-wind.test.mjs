import test from 'node:test';
import assert from 'node:assert/strict';
import { createWind, requestGuide, stepWind, windVector, particleCount, toUniforms } from '../dist/valley/wind.js';
const guided = () => requestGuide(createWind(), [0, 9]).state;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

test('guide mix at 0, .5, 1, 2, 4, 4.5, 5, 5.01, 7, 7.01 seconds', () => {
  for (const [t, mix] of [[0, 0], [.5, .5], [1, 1], [2, 1], [4, 1], [4.5, .5], [5, 0], [5.01, 0], [7, 0], [7.01, 0]]) {
    const state = stepWind(guided(), t);
    assert.equal(state.t, t); near(state.guideMix, mix);
    assert.equal(state.guideElapsed === null, t >= 5);
    near(state.cooldown, t >= 5 ? Math.max(0, 7 - t) : 0);
  }
});
test('repeated requests are refused during the guide and until two seconds after its end', () => {
  for (const t of [0, .5, 4.99, 5, 5.01, 6.99]) assert.equal(requestGuide(stepWind(guided(), t), [1, 1]).accepted, false);
  for (const t of [7, 7.01]) assert.equal(requestGuide(stepWind(guided(), t), [1, 1]).accepted, true);
  let state = stepWind(guided(), 5);
  state = stepWind(state, 1); assert.equal(requestGuide(state, [1, 1]).accepted, false);
  state = stepWind(state, 1); assert.equal(requestGuide(state, [1, 1]).accepted, true);
});
test('paused freezes activity time, transition and cooldown; dt never creates NaN', () => {
  for (const state of [createWind(), stepWind(guided(), .5), stepWind(guided(), 5.5)]) {
    assert.deepEqual(stepWind(state, 10, { paused: true }), state);
    for (const dt of [NaN, Infinity, -1]) assert.deepEqual(stepWind(state, dt), state);
  }
});
test('JSON round trip preserves all future values without mutating the input', () => {
  const state = stepWind(guided(), .5), before = JSON.stringify(state);
  const restored = JSON.parse(before);
  for (const dt of [.5, 4.5, 6.51]) assert.deepEqual(stepWind(restored, dt), stepWind(state, dt));
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(toUniforms(restored), toUniforms(state));
});
test('directions normalize, zero base falls back, invalid guide requests are refused', () => {
  assert.deepEqual(createWind({ baseDir: [0, 0] }).baseDir, [1, 0]);
  assert.deepEqual(createWind({ baseDir: [0, 8] }).baseDir, [0, 1]);
  for (const dir of [[0, 0], [NaN, 1], [1, Infinity], [-Infinity, 0], [], Array(2), null]) {
    const state = createWind(), result = requestGuide(state, dir);
    assert.equal(result.accepted, false); assert.deepEqual(result.state, state); assert.ok(result.reason);
  }
  assert.deepEqual(createWind({ baseDir: [NaN, 0], t: NaN, strength: Infinity }), createWind());
  const huge = requestGuide(createWind(), [Number.MAX_VALUE, Number.MAX_VALUE]);
  near(huge.state.guideDir[0], Math.SQRT1_2);
});
test('vector normalizes the lerp before strength; opposing directions and zero strength stay finite', () => {
  const state = stepWind(guided(), .5), vector = windVector(state);
  near(vector.x, Math.SQRT1_2); near(vector.z, Math.SQRT1_2);
  const opposing = stepWind(requestGuide(createWind(), [-1, 0]).state, .5);
  assert.ok(Object.values(windVector(opposing)).every(Number.isFinite));
  assert.deepEqual(windVector(createWind({ strength: 0 })), { x: 0, z: 0, strength: 0 });
  const calmGuide = stepWind(requestGuide(createWind({ strength: 0 }), [0, 1]).state, 1);
  assert.deepEqual(toUniforms(calmGuide).uWindDir, [0, 1]);
});
test('reduced changes amplitude and particles only, preserving direction and clocks', () => {
  const state = stepWind(guided(), .5), normal = windVector(state), reduced = windVector(state, { reduced: true });
  near(reduced.x, normal.x * .4); near(reduced.z, normal.z * .4); near(reduced.strength, normal.strength * .4);
  assert.deepEqual(stepWind(state, .5, { reduced: true }), stepWind(state, .5));
  const a = toUniforms(state), b = toUniforms(state, { reduced: true });
  assert.deepEqual(a.uWindDir, b.uWindDir); assert.equal(a.uTime, b.uTime); assert.equal(a.uGuideMix, b.uGuideMix); near(b.uWind, a.uWind * .4);
  assert.equal(particleCount(101), 101); assert.equal(particleCount(101, { reduced: true }), 40);
});
test('without a guide the legacy time and strength uniforms are unchanged', () => {
  let state = createWind(), legacy = 0;
  for (let i = 0; i < 1800; i++) { state = stepWind(state, 1 / 60); legacy += 1 / 60; }
  assert.deepEqual(toUniforms(state), { uTime: legacy, uWind: 1, uWindDir: [1, 0], uGuideMix: 0 });
});

test('QA wind snapshots are isolated, null does nothing and guide requests update the game', async () => {
  const { installQA } = await import('../dist/valley/qa.js');
  const oldWindow = globalThis.window;
  globalThis.window = {};
  try {
    const game = { input: {}, wind: createWind() }, api = installQA(game, {});
    api.windState().baseDir[0] = 9;
    assert.deepEqual(game.wind, createWind());
    const before = game.wind;
    assert.equal(api.guideWind(null).accepted, false); assert.equal(game.wind, before);
    const result = api.guideWind([0, 1]); assert.equal(result.accepted, true);
    assert.deepEqual(game.wind.guideDir, [0, 1]); result.state.guideDir[0] = 9;
    assert.deepEqual(game.wind.guideDir, [0, 1]);
    assert.equal(api.guideWind([1, 0]).accepted, false);
  } finally { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; }
});
