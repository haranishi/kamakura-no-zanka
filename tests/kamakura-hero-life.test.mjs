import test from 'node:test';
import assert from 'node:assert/strict';
import { HERO_LIFE, createHeroLife, stepHeroLife, createClothChain, stepCloth, projectClothPoint } from '../dist/valley/kamakura-hero-life.js';

test('breathing has the requested amplitude/frequency, continuous recovery and exact phase across rates', t => {
  const result = hz => {
    const s = createHeroLife(); let peak = 0, crossings = 0, prev = 0, jump = 0;
    for (let i = 0; i < hz * 30; i++) {
      stepHeroLife(s, 1 / hz); if (i > hz * 5) { peak = Math.max(peak, Math.abs(s.breath)); if (prev <= 0 && s.breath > 0) crossings++; }
      jump = Math.max(jump, Math.abs(s.breath - prev)); prev = s.breath;
    }
    assert(Math.abs(peak - HERO_LIFE.breathDeg) < .001); assert(crossings >= 5 && crossings <= 6); assert(jump < .05 * HERO_LIFE.breathDeg / .8);
    assert.equal(s.frequency, .22);
    for (let i = 0; i < hz * 6; i++) stepHeroLife(s, 1 / hz, 5);
    assert(s.amplitude > HERO_LIFE.tiredDeg - .01 * HERO_LIFE.tiredDeg && s.frequency > .449 && s.weight === 0);
    const tired = s.amplitude;
    for (let i = 0; i < hz * 8; i++) stepHeroLife(s, 1 / hz, 0);
    assert(s.amplitude < HERO_LIFE.breathDeg * 1.03 && s.frequency < .227 && s.amplitude < tired);
    return s;
  };
  const a = result(30), b = result(60), c = result(144);
  for (const other of [b, c]) { assert(Math.abs(a.phase - other.phase) < 1e-10); assert(Math.abs(a.effort - other.effort) < 1e-12); }
  t.diagnostic(`rest amplitude ±0.8°, 0.22Hz; 8s recovery amplitude ${b.amplitude.toFixed(4)}°, ${b.frequency.toFixed(5)}Hz`);
});

test('seeded look/sway targets stay in range, return forward every third look, and move smoothly', t => {
  const a = createHeroLife(), b = createHeroLife(); let lastLook = 0, lastSway = 0, maxLook = 0, maxSway = 0, seen = 0, lastCount = 0;
  for (let i = 0; i < 60 * 180; i++) {
    stepHeroLife(a, 1 / 60); stepHeroLife(b, 1 / 60);
    assert.equal(a.look, b.look); assert.equal(a.sway, b.sway);
    assert(Math.abs(a.look) <= 30 && Math.abs(a.pitch) <= 8 && Math.abs(a.sway) <= 1.2);
    maxLook = Math.max(maxLook, Math.abs(a.look - lastLook)); maxSway = Math.max(maxSway, Math.abs(a.sway - lastSway));
    if (a.lookCount !== lastCount) { assert(a.lookAt - a.lookStart >= 4 && a.lookAt - a.lookStart <= 9); if (a.lookCount % 3 === 0) { assert.equal(a.lookTo, 0); assert.equal(a.pitchTo, 0); seen++; } lastCount = a.lookCount; }
    assert(a.swayEnd - a.swayStart >= 8 - 1e-12 && a.swayEnd - a.swayStart <= 13 + 1e-12);
    lastLook = a.look; lastSway = a.sway;
  }
  assert(seen >= 7); assert(maxLook <= 1.5 && maxSway < .01);
  t.diagnostic(`60Hz max change: look ${maxLook.toFixed(4)}°/frame, sway ${maxSway.toFixed(5)}°/frame`);
  for (let i = 0; i < 18; i++) stepHeroLife(a, 1 / 60, 3);
  assert(Math.abs(a.look) < .14 && Math.abs(a.breath) < .004);
});

test('reduced motion halves breathing and omits look/sway; scripted/actions add nothing; zero dt freezes', () => {
  const a = createHeroLife(), b = createHeroLife();
  for (let i = 0; i < 600; i++) { stepHeroLife(a, 1 / 60); stepHeroLife(b, 1 / 60, 0, true, true); }
  assert.equal(b.sway, 0); assert.equal(b.look, 0); assert(Math.abs(a.breath / 2 - b.breath) < 1e-12);
  const time = a.time; stepHeroLife(a, 0); assert.equal(a.time, time);
  stepHeroLife(a, .01, 0, false); assert.equal(a.breath, 0); assert.equal(a.look, 0); assert.equal(a.sway, 0);
});

test('cloth hangs down, stays within 3% stretch, follows wind and lags a moving anchor', t => {
  const calm = createClothChain(), windy = createClothChain(), moving = createClothChain(), root = [0, 2, 0], movingRoot = [0, 2, 0];
  let stretch = 0;
  for (let i = 0; i < 600; i++) {
    stepCloth(calm, 1 / 60, root); stepCloth(windy, 1 / 60, root, 8, 0);
    movingRoot[0] += 3 / 60; stepCloth(moving, 1 / 60, movingRoot);
    stretch = Math.max(stretch, calm.maxStretch, windy.maxStretch, moving.maxStretch);
  }
  assert(Math.abs(calm.p.at(-2) - (2 - .42)) < .01); assert(Math.abs(calm.p.at(-3)) < 1e-12);
  assert(windy.p.at(-3) > .15); assert(moving.p.at(-3) < movingRoot[0] - .15); assert(stretch < .03);
  t.diagnostic(`600 frames, peak stretch ${(stretch * 100).toFixed(4)}%; wind tip ${windy.p.at(-3).toFixed(4)}m; moving tip lag ${(movingRoot[0] - moving.p.at(-3)).toFixed(4)}m`);
});

test('sphere/capsule projection includes degenerate centres, and terrain stops penetration', () => {
  const p = new Float64Array([0, 0, 0]), sphere = [0, 0, 0, .15], capsule = [0, -.5, 0, 0, .5, 0, .2];
  projectClothPoint(p, 0, sphere, null, null); assert(Math.hypot(...p) >= .15 - 1e-12);
  p.fill(0); projectClothPoint(p, 0, null, capsule, null); assert(Math.hypot(p[0], p[2]) >= .2 - 1e-12);
  p.set([0, -5, 0]); projectClothPoint(p, 0, null, null, () => .25); assert(p[1] >= .25);
  const c = createClothChain(), root = [0, .55, -.22], ground = () => 0;
  for (let i = 0; i < 600; i++) {
    stepCloth(c, 1 / 60, root, 0, 8, [0, .45, 0, .15], [0, .1, 0, 0, .3, 0, .14], ground);
    for (let k = 3; k < c.p.length; k += 3) {
      assert(Math.hypot(c.p[k], c.p[k + 1] - .45, c.p[k + 2]) >= .15 - 1e-10);
      const cy = Math.max(.1, Math.min(.3, c.p[k + 1]));
      assert(Math.hypot(c.p[k], c.p[k + 1] - cy, c.p[k + 2]) >= .14 - 1e-10);
      assert(c.p[k + 1] >= .006);
    }
    assert(c.maxStretch < .03 && !c.nan);
  }
});

test('fixed cloth steps are bounded for 0.1s frames; teleports reset exactly below the root; buffers are reused', t => {
  const c = createClothChain(), root = [0, 2, 0], p = c.p, previous = c.previous; let maxStretch = 0;
  for (let i = 0; i < 600; i++) {
    root[0] += .2;
    stepCloth(c, .1, root, 8, 2, null, null, null, 10);
    assert(c.steps <= HERO_LIFE.maxSteps && !c.nan); maxStretch = Math.max(maxStretch, c.maxStretch);
  }
  assert(maxStretch < .03); assert.equal(c.p, p); assert.equal(c.previous, previous);
  root[0] += 1; const resets = c.resets; stepCloth(c, .1, root, 8, 2);
  assert.equal(c.resets, resets + 1);
  for (let i = 0; i < c.nodes; i++) { assert.equal(c.p[i * 3], root[0]); assert.equal(c.p[i * 3 + 1], root[1] - c.segment * i); }
  t.diagnostic(`0.1s frames/10 iterations: peak stretch ${(maxStretch * 100).toFixed(4)}%, max ${HERO_LIFE.maxSteps} steps/frame, NaN false`);
});

test('cloth converges to the same position with 30/60/144Hz frame partitioning', () => {
  const run = hz => { const c = createClothChain(), root = [0, 2, 0]; stepCloth(c, 0, root); for (let i = 0; i < hz * 4; i++) stepCloth(c, 1 / hz, root, 5, 1); return c; };
  const a = run(30), b = run(60), c = run(144);
  for (let i = 0; i < a.p.length; i++) { assert(Math.abs(a.p[i] - b.p[i]) < 1e-10); assert(Math.abs(a.p[i] - c.p[i]) < 1e-10); }
});
