import test from 'node:test';
import assert from 'node:assert/strict';
import { DRIFT, DRIFT_KINDS, DRIFT_SHARE, DRIFT_SIZE, DRIFT_SPEED, DRIFT_GUST, DRIFT_FALL, DRIFT_FLUTTER, DRIFT_GLSL, driftAmounts, driftSeeds, driftPosition } from '../dist/valley/kamakura-drift.js';
import { GUST, gustBand } from '../dist/valley/kamakura-gust.js';

test('habitat selects restrained leaves/petals/dust and strictly evening river/paddy fireflies', () => {
  const forest = driftAmounts({ forest: 1 }, 'noon'), meadow = driftAmounts({ meadow: 1 }, 'noon');
  assert(forest.leaf > meadow.leaf && forest.leaf > driftAmounts({ town: 1, temple: 1 }, 'noon').leaf);
  assert(forest.petal < .01 && meadow.petal > .3 && meadow.dust > forest.dust);
  assert(driftAmounts({ temple: 1 }, 'noon').petal > .2);
  for (const h of [{ sand: 1, forest: 1 }, { shore: 1, forest: 1 }]) assert.equal(driftAmounts(h, 'noon').leaf, 0);
  for (const time of ['noon', 'morning', 'golden', '', undefined]) assert.equal(driftAmounts({ river: 1, paddy: 1 }, time).firefly, 0);
  assert(driftAmounts({ river: 1 }, 'evening').firefly > .5);
  assert(driftAmounts({ paddy: 1 }, 'evening').firefly > .5);
  assert.equal(driftAmounts({}, 'evening').firefly, 0);
  assert(driftAmounts({ meadow: 1 }, 'morning').dust > meadow.dust);
  assert(driftAmounts({ meadow: 1 }, 'evening').dust > meadow.dust);
  const out = {};
  assert.equal(driftAmounts({}, 'noon', out), out);
  for (let n = 0; n <= 100; n++) {
    const h = { forest: n / 100, meadow: 1 - n / 100, river: n / 100, paddy: .3, temple: .7, town: .6, sand: .1 };
    for (const time of ['noon', 'morning', 'evening']) for (const a of Object.values(driftAmounts(h, time))) assert(a >= 0 && a <= 1);
    if (n) assert(driftAmounts({ forest: n / 100 }, 'noon').leaf >= driftAmounts({ forest: (n - 1) / 100 }, 'noon').leaf);
  }
});

test('seeds are deterministic, have exact fixed proportions, bounded sizes and unit rotation axes', () => {
  for (const count of [DRIFT.standard, DRIFT.light]) {
    const seeds = driftSeeds(count, 17), again = driftSeeds(count, 17), counts = [0, 0, 0, 0];
    assert.equal(JSON.stringify(seeds), JSON.stringify(again));
    assert.notEqual(seeds[0].phase, driftSeeds(count, 18)[0].phase);
    for (const s of seeds) {
      counts[s.kind]++;
      const half = DRIFT.width / 2;
      assert(s.x >= -half && s.x < half && s.z >= -half && s.z < half && s.y >= DRIFT.bottom && s.y < DRIFT.bottom + DRIFT.height);
      assert(s.phase >= 0 && s.phase < Math.PI * 2 && s.roll >= 0 && s.roll < 1 && s.tint >= 0 && s.tint < 1);
      assert(s.size >= DRIFT_SIZE[s.kind][0] && s.size <= DRIFT_SIZE[s.kind][1]);
      assert(Math.abs(Math.hypot(s.ax, s.ay, s.az) - 1) < 1e-12);
    }
    assert.equal(counts.join(','), DRIFT_SHARE.map(x => Math.round(x * count)).join(','));
  }
  assert.equal(driftSeeds(0).length, 0);
  assert.equal(driftSeeds(7).length, 7);
});

test('the JS motion stays in the box that moves with the viewer, including long times and negative world positions', () => {
  const out = {}, seeds = driftSeeds(240), half = DRIFT.width / 2;
  for (const viewer of [{ x: 0, y: 0, z: 0 }, { x: -173, y: 43, z: -287 }, { x: 270, y: 901, z: 320 }]) {
    for (const dir of [[1, 0], [.6, .8], [-.8, -.6]]) for (const s of seeds) for (const t of [0, .01, 19, 10000]) {
      assert.equal(driftPosition(s, t, dir, viewer, out), out);
      assert(out.x >= viewer.x - half && out.x < viewer.x + half);
      assert(out.z >= viewer.z - half && out.z < viewer.z + half);
      assert(out.y >= viewer.y + DRIFT.bottom && out.y < viewer.y + DRIFT.bottom + DRIFT.height);
      assert(out.fade >= 0 && out.fade <= 1);
    }
  }
});

test('motion is continuous at 60 Hz; every recycling jump is fully hidden at both ends', t => {
  const viewer = { x: 0, y: 0, z: 0 }, a = {}, b = {};
  let jumps = 0, maxVisibleStep = 0;
  for (const s of driftSeeds(240)) for (const dir of [[1, 0], [.6, .8]]) for (let frame = 0; frame < 2400; frame++) {
    driftPosition(s, frame / 60, dir, viewer, a);
    driftPosition(s, (frame + 1) / 60, dir, viewer, b);
    const distance = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (a.fade > 0 || b.fade > 0) {
      maxVisibleStep = Math.max(maxVisibleStep, distance);
      assert(distance < .06, `visible step ${distance}`);
    }
    if (distance >= .06) { jumps++; assert.equal(a.fade, 0); assert.equal(b.fade, 0); }
  }
  assert(jumps > 100);
  // At the exact face, even a stationary seed with no falling/flow has zero fade.
  for (const x of [-DRIFT.width / 2, DRIFT.width / 2]) assert.equal(driftPosition({ ...driftSeeds(1)[0], x, y: 12, z: 0 }, 0, [0, 0], viewer, a).fade, 0);
  t.diagnostic(JSON.stringify({ maxVisibleStepMetres: maxVisibleStep, hiddenRecyclingSteps: jumps }));
});

test('moving the viewer changes only the selected copy, never drags visible particles', () => {
  const a = {}, b = {}, viewer = { x: 0, y: 0, z: 0 }, moved = { x: 1, y: .3, z: -.7 };
  let checked = 0;
  for (const s of driftSeeds(2400)) {
    driftPosition(s, 12.3, [.6, .8], viewer, a); driftPosition(s, 12.3, [.6, .8], moved, b);
    if (a.fade < .99 || b.fade < .99) continue;
    assert(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-10); checked++;
  }
  assert(checked > 500);
});

test('the travelling band locally increases downwind speed; reduced motion lowers speed', t => {
  const viewer = { x: 0, y: 0, z: 0 }, a = {}, b = {};
  let inside = 0, outside = 0, ni = 0, no = 0, reduced = 0, nr = 0, normal = 0;
  for (const s of driftSeeds(240)) for (let i = 0; i < 1200; i++) {
    if (s.kind !== 0) continue;
    const time = i / 60;
    driftPosition(s, time, [1, 0], viewer, a); driftPosition(s, time + 1 / 60, [1, 0], viewer, b);
    if (a.fade < .5 || b.fade < .5) continue;
    const band = gustBand(a.x, a.z, time, 1, 0), speed = (b.x - a.x) * 60;
    if (band > .8) { inside += speed; ni++; }
    else if (band === 0) { outside += speed; no++; }
    normal += speed; nr++;
  }
  let reducedCount = 0;
  for (const s of driftSeeds(240)) for (let i = 0; i < 1200; i++) {
    if (s.kind !== 0) continue;
    driftPosition(s, i / 60, [1, 0], viewer, a, .5); driftPosition(s, (i + 1) / 60, [1, 0], viewer, b, .5);
    if (a.fade > .5 && b.fade > .5) { reduced += (b.x - a.x) * 60; reducedCount++; }
  }
  assert(ni > 100 && no > 100);
  assert(inside / ni > outside / no * 1.5);
  assert(reduced / reducedCount < normal / nr * .65);
  t.diagnostic(JSON.stringify({ gustSpeed: inside / ni, outsideSpeed: outside / no, reducedSpeed: reduced / reducedCount }));
});

test('GLSL embeds the JS constants once and uses the shared band at each particle', () => {
  for (const list of [DRIFT_SPEED, DRIFT_GUST, DRIFT_FALL, DRIFT_FLUTTER]) assert(DRIFT_GLSL.includes(`vec4(${list.map(x => x.toFixed(6)).join(', ')})`));
  for (const value of [DRIFT.width, DRIFT.height, DRIFT.bottom, DRIFT.edge, DRIFT.deadEdge, GUST.wave, GUST.speed, GUST.noiseScale, GUST.noiseAmount]) assert(DRIFT_GLSL.includes(value.toFixed(6)));
  assert.equal((DRIFT_GLSL.match(/float kzGustBand\(/g) || []).length, 1);
  assert.equal(DRIFT_KINDS.length, 4);
});
