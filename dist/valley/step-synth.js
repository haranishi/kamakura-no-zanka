// Pure synthesis plan; all times in milliseconds. Values are listening controls.
import { mulberry32 } from './scatter.js';
import { SURFACES, GAITS, ROLES, FEET } from './audio-rules.js';
export function stepLayers(step) {
  if (!step || !step.recipe) throw new TypeError('Invalid step recipe');
  const { recipe: r, pitch, gain, seed } = step;
  if (!SURFACES.includes(r.surface) || !GAITS.includes(r.gait) || !ROLES.includes(r.role) || !FEET.includes(r.foot) || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isFinite(pitch) || pitch <= 0 || !Number.isFinite(gain) || gain < 0 || !Number.isFinite(r.density) || r.density < 0 || r.density > 4) throw new TypeError('Invalid step parameters');
  const tuple = (v, n) => { if (!Array.isArray(v) || v.length !== n || !v.every(x => Number.isFinite(x) && x >= 0)) throw new TypeError('Invalid step layer tuple'); return v; };
  const [impactGain, impactHz, decayMs] = tuple(r.material?.impact, 3);
  const grains = r.material?.grains;
  if (!Array.isArray(grains) || grains.length !== 5) throw new TypeError('Invalid step grains');
  const [count, band, grainDecay, spreadMs, jitter] = grains;
  tuple([count, grainDecay, spreadMs, jitter], 4); tuple(band, 2);
  if (!Number.isInteger(count) || count > 128 || band[0] <= 0 || band[1] < band[0] || decayMs <= 0 || grainDecay <= 0 || impactHz <= 0 || jitter > 1) throw new TypeError('Invalid step grain range');
  const [cloth, clothHz] = tuple(r.equipment?.cloth, 2), [equipment, equipmentHz] = tuple(r.equipment?.equipment, 2), [weight, weightHz] = tuple(r.equipment?.weight, 2);
  if (Math.min(clothHz, equipmentHz, weightHz) <= 0) throw new TypeError('Invalid step equipment frequency');
  const rng = mulberry32(seed);
  const layer = (type, startMs, durationMs, level, freq, filter, q = 0.7) => ({ type, startMs, durationMs, gain: level * gain, freq: freq * pitch, q, filter });
  const layers = [layer('impact', 0, decayMs, impactGain, impactHz, 'bandpass', 3)];
  for (let i = 0; i < Math.round(count * r.density); i++) {
    layers.push(layer('grain', rng() * spreadMs, grainDecay * (1 + (rng() * 2 - 1) * jitter * 0.5), 0.12 * (1 + (rng() * 2 - 1) * jitter), band[0] + rng() * (band[1] - band[0]), 'bandpass', 1.2));
  }
  layers.push(layer('cloth', 0, 75, cloth, clothHz, 'lowpass'), layer('equipment', 0, 45, equipment, equipmentHz, 'highpass'), layer('weight', 0, 65, weight, weightHz, null));
  return layers;
}
