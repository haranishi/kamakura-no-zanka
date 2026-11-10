// W2c-15 sound: classification fallback -> density blend; no rendering ecology dependency.
import { classifySurface } from './step-surface.js';
import { stepLayers } from './step-synth.js';
import { mulberry32 } from './scatter.js';
import { MIX } from './kamakura-mix.js';
export const STEP_NAMES = Object.freeze({ water: '川', grass: '草', dirt: '土', gravel: '砂利', leaves: '落ち葉', stone: '石', wood: '木' });
export function kamakuraStepSurface(weights, { water = 0, density = weights.grass, wood = false, stone = false } = {}) {
  const base = classifySurface(weights, { water, wood, stone });
  if (!Number.isFinite(density) || density < 0 || density > 1) throw new TypeError('Invalid grass density');
  if (base !== 'grass' && base !== 'dirt') return { surface: base, grassMix: 0 };
  return { surface: density >= .35 ? 'grass' : 'dirt', grassMix: Math.max(0, Math.min(1, (density - .2) / .3)) };
}
// Times are ms. Q=.5 filters have a conservative impulse absolute-sum bound of 2.
// The node scheduler budgets twice the sum of layer peaks, including overlapping steps.
export function kamakuraStepLayers(step, grassMix = +(step.recipe.surface === 'grass'), { mix10 = false } = {}) {
  if (mix10) return mixStepLayers(step, grassMix);
  const rng = mulberry32(step.seed), run = step.recipe.gait === 'run', crouch = step.recipe.gait === 'crouch';
  const strength = (run ? 1 : crouch ? .18 : .34) * (.92 + rng() * .16);
  const layers = [];
  const add = (kind, startMs, durationMs, gain, freq, filter = null) => layers.push({ kind, startMs, durationMs, gain: gain * strength, freq, filter, pan: (rng() * 2 - 1) * .28 });
  const surface = step.recipe.surface;
  if (surface === 'water') {
    add('thud', 0, 60, .12, 150 + rng() * 250);
    add('splash', 0, (run ? 290 : 200) + rng() * 60, .21, 800 + rng() * 3200, 'bandpass');
    const count = run ? 4 : 2 + Math.floor(rng() * 2);
    for (let i = 0; i < count; i++) add('drop', 80 + rng() * 220, 18 + rng() * 22, .025, 2000 + rng() * 3000);
  } else {
    add('thud', 0, 55, .15 * (1 - grassMix) + .035 * grassMix, 140 + rng() * 80);
    add('sand', 0, 65, .075 * (1 - grassMix), 1300 + rng() * 900, 'bandpass');
    add('rustle', 0, (run ? 180 : 120) + rng() * 40, .24 * grassMix, 2000 + rng() * 4000, 'bandpass');
  }
  // Keep the old cloth, equipment and body-weight detail; replace only the material layers.
  for (const l of stepLayers(step).slice(-3)) layers.push({ ...l, kind: l.type, gain: l.gain * .65, pan: 0 });
  return layers;
}

function mixStepLayers(step, grassMix) {
  const rng = mulberry32(step.seed), run = step.recipe.gait === 'run', p = MIX.steps;
  const strength = (run ? p.run : step.recipe.gait === 'crouch' ? p.crouch : p.walk) * (.94 + rng() * .12);
  const layers = [], add = (kind, startMs, durationMs, gain, freq, filter = null) => {
    layers.push({ kind, startMs, durationMs, gain: gain * strength, freq, filter, pan: (rng() * 2 - 1) * .38 });
  };
  if (step.recipe.surface === 'water') {
    add('thud', 0, 75, .09, 180 + rng() * 190);
    add('splash', 0, (run ? 340 : 240) + rng() * (run ? 120 : 80), p.splash, 600 + rng() * 2900, 'bandpass');
    const count = run ? 5 + Math.floor(rng() * 3) : 3 + Math.floor(rng() * 2);
    for (let i = 0; i < count; i++) add('drop', 45 + rng() * (run ? 330 : 230), 18 + rng() * 30, p.drop * (.6 + rng() * .8), 2000 + rng() * 3000);
  } else {
    add('thud', 0, 55, .10 * (1 - grassMix) + .018 * grassMix, 140 + rng() * 80);
    add('body', 0, 40 + rng() * 30, p.body * (1 - grassMix), 300 + rng() * 600, 'bandpass');
    add('sand', 6, 60 + rng() * 30, p.sand * (1 - grassMix), 1300 + rng() * 1200, 'bandpass');
    add('rustle', 0, (run ? 220 : 150) + rng() * (run ? 100 : 70), p.rustle * grassMix, 2000 + rng() * 3000, 'bandpass');
    if (grassMix > 0) for (let i = 0, count = 2 + Math.floor(rng() * 3); i < count; i++) add('leaf', 20 + rng() * 140, 20 + rng() * 30, p.leaf * grassMix, 2200 + rng() * 2600, 'bandpass');
  }
  for (const l of stepLayers(step).slice(-3)) layers.push({ ...l, kind: l.type, gain: l.gain * p.detail, pan: 0 });
  return layers;
}
