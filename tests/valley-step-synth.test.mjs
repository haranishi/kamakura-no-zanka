// なぜ失敗したか: layer/count/seed/pitch/spread/band/input identify the broken contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stepLayers } from '../dist/valley/step-synth.js';
import { pickStep, SURFACES, GAITS, ROLES } from '../dist/valley/audio-rules.js';
const step = (surface = 'gravel', gait = 'walk', role = 'hero') => pickStep({ surface, gait, role, foot: 'left' }, () => 0.5);
test('layer: four groups including cloth and equipment', () => assert.deepEqual([...new Set(stepLayers(step()).map(l => l.type))], ['impact', 'grain', 'cloth', 'equipment', 'weight'], 'layer: missing synthesis component'));
for (const gait of GAITS) test(`count: density ${gait}`, () => { const s = step('gravel', gait); assert.equal(stepLayers(s).filter(l => l.type === 'grain').length, Math.round(s.recipe.material.grains[0] * s.recipe.density), 'count: round(count*density)'); });
test('seed: deterministic layout and varied seed', () => { const s = step(); assert.deepEqual(stepLayers(s), stepLayers(structuredClone(s)), 'seed: reproducibility'); assert.notDeepEqual(stepLayers(s), stepLayers({ ...s, seed: s.seed + 1 }), 'seed: variation'); });
test('pitch: every frequency scales proportionally', () => { const s = step(), a = stepLayers(s), b = stepLayers({ ...s, pitch: s.pitch * 1.5 }); for (let i = 0; i < a.length; i++) { assert.ok(Math.abs(b[i].freq - a[i].freq * 1.5) < 1e-8, 'pitch: all layers'); assert.equal(b[i].startMs, a[i].startMs, 'pitch: timing preserved'); } });
for (const surface of SURFACES) test(`spread/band: ${surface}`, () => {
  const s = step(surface), layers = stepLayers(s), [, band, , spread] = s.recipe.material.grains;
  for (const l of layers) { assert.ok(l.startMs >= 0 && l.startMs <= spread, 'spread: within scatter window'); assert.ok(l.durationMs > 0, 'layer: positive duration'); if (l.type === 'grain') assert.ok(l.freq >= band[0] * s.pitch && l.freq <= band[1] * s.pitch, 'band: material range'); }
});
test('band: material spectra differ', () => assert.equal(new Set(SURFACES.map(s => JSON.stringify(stepLayers(step(s)).filter(l => l.type === 'grain').map(l => l.freq)))).size, SURFACES.length, 'band: distinct surfaces'));
test('layer: every role, zero gain and gain scaling', () => {
  for (const role of ROLES) assert.ok(stepLayers(step('wood', 'walk', role)).some(l => l.type === 'equipment'), 'layer: role equipment');
  const s = step(), a = stepLayers(s), b = stepLayers({ ...s, gain: s.gain * 2 });
  a.forEach((l, i) => assert.equal(b[i].gain, l.gain * 2, 'layer: whole bundle gain'));
  assert.ok(stepLayers({ ...s, gain: 0 }).every(l => l.gain === 0), 'layer: silence');
});
test('input: invalid recipe and ranges', () => {
  for (const bad of [null, {}, { ...step(), seed: -1 }, { ...step(), seed: 0.5 }, { ...step(), pitch: 0 }, { ...step(), gain: NaN }, { ...step(), recipe: { ...step().recipe, density: Infinity } }, { ...step(), recipe: { ...step().recipe, material: {} } }, { ...step(), recipe: { ...step().recipe, equipment: {} } }, { ...step(), recipe: { ...step().recipe, surface: 'invalid' } }]) assert.throws(() => stepLayers(bad), TypeError, 'input: invalid recipe rejected');
});
