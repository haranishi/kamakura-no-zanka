import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAdapt, stepAdapt, adaptOptions, adaptPixelRatio, adaptPolicy } from '../dist/valley/kamakura-adapt.js';
const frames = (s, dt, n = 90, options) => { for (let i = 0; i < n; i++) s = stepAdapt(s, dt, options); return s; };
test('adapt: 90-frame means, strict thresholds, deterministic inputs and bounded steps', () => {
  const initial = createAdapt(); assert.equal(frames(initial, .025, 89).step, 0);
  const slow = frames(initial, .025); assert.equal(slow.step, 1); assert(Math.abs(slow.averageMs - 25) < 1e-10);
  assert.deepEqual(slow, frames(initial, .025)); assert.equal(initial.count, 0);
  assert.equal(frames(initial, .024).step, 0);
  assert.equal(frames(createAdapt(1), .0185).step, 1);
  assert.equal(frames(createAdapt(1), .018).step, 0);
  assert.equal(frames(createAdapt(3), .04).step, 3);
  assert.equal(frames(createAdapt(0), .01).step, 0);
});
test('adapt: pause, hidden, invalid dt do not count; autoscale=0 keeps metrics but fixes quality', () => {
  const s = frames(createAdapt(), .016, 40);
  for (const options of [{ paused: true }, { hidden: true }]) assert.equal(frames(s, 10, 100, options), s);
  for (const dt of [0, -1, NaN, Infinity]) assert.equal(stepAdapt(s, dt), s);
  const fixed = frames(s, .1, 500, { enabled: false }); assert.equal(fixed.step, 0); assert(fixed.averageMs > 90);
});
test('adapt: cooldown, quick failed probes double wait, successful probes recover, wait caps at 90s', () => {
  let s = frames(createAdapt(), .03); assert.equal(s.cool, 10);
  assert.equal(frames(s, .016, 90).step, 1);
  s = frames(s, .016, 720); assert.equal(s.step, 0); assert(s.cool > 0);
  s = frames(s, .03); assert.equal(s.step, 1); assert.equal(s.probeWait, 20); assert.equal(s.cool, 20);
  for (const wait of [40, 80, 90, 90]) {
    s = { ...s, step: 1, cool: 0, count: 0, sum: 0 };
    s = frames(s, .016); assert.equal(s.step, 0);
    s = frames(s, .03); assert.equal(s.step, 1); assert.equal(s.probeWait, wait);
  }
  const recovered = frames(s, .016, 90 * 80); assert.equal(recovered.step, 0);
});
test('adapt: touch/q=light DPR caps, fixed/forced options, no w override, reversible policy', () => {
  assert.equal(adaptOptions('?q=light').quality, 'light'); assert.equal(adaptOptions('', true).quality, 'light');
  assert.equal(adaptOptions('?w=300').enabled, true); assert.equal(adaptOptions('?autoscale=0').enabled, false);
  assert.equal(adaptOptions('?adaptstep=3').step, 3); assert.equal(adaptOptions('?adaptstep=8').step, 0);
  for (const [i, scale] of [1, .85, .7, .58].entries()) {
    assert.equal(adaptPixelRatio(3, 'standard', i), 1.5 * scale); assert.equal(adaptPixelRatio(3, 'light', i), scale);
    assert.equal(adaptPixelRatio(.8, 'light', i), .8 * scale);
  }
  assert.deepEqual(adaptPolicy(3), { scale: .58, standRange: .4, impostorRange: .7, shadows: false });
  assert.equal(adaptPolicy(2).standRange, .6); assert.equal(adaptPolicy(0).shadows, true);
  const world = fs.readFileSync(new URL('../dist/valley/world-kamakura.js', import.meta.url), 'utf8');
  for (const call of ['stepAdapt(adapt, rawDt', 'atmosphere.setAdapt(policy)', 'trees?.setAdapt(policy)', 'stands?.setAdapt(policy)', 'adaptPixelRatio(devicePixelRatio, quality, adapt.step)', 'renderer.info.render', 'paused || skipAdaptFrame', 'hidden: document.hidden']) assert(world.includes(call), call);
  const hud = fs.readFileSync(new URL('../dist/valley/hud-kamakura.js', import.meta.url), 'utf8'); assert(hud.includes('if (debug) coords.textContent')); assert(hud.includes('三角'));
});
