// Stereo cyclic grains: only touched samples are synthesized; tails wrap through the seam.
import { mulberry32 } from './scatter.js';
export function waterLoop(sampleRate, seconds, seed, rate = 12.5) {
  if (!Number.isFinite(sampleRate) || sampleRate < 1000 || !Number.isFinite(seconds) || seconds < 1 || !Number.isFinite(rate) || rate <= 0 || rate > 100) throw new TypeError('Invalid water loop');
  const length = Math.ceil(sampleRate * seconds), left = new Float32Array(length), right = new Float32Array(length);
  const rng = mulberry32(seed), count = Math.round(seconds * rate);
  let work = 0;
  for (let g = 0; g < count; g++) {
    const start = Math.floor(rng() * length), life = .018 + rng() * .052, n = Math.ceil(sampleRate * life);
    // Log-spread pitches (420 Hz to 2.5 kHz) and many moderate grains: with a few loud low ones the stream read as dripping and one
    // grain reached -3.5 dBFS (measured in real Chrome). The loudest grain is now a third of the old one.
    const hz = 420 * 2 ** (rng() * 2.6), ratio = 1.15 + rng() * .45;
    // Cyclic, irregular clusters leave audible quiet gaps between trickles.
    const activity = .08 + .92 * (.5 + .5 * Math.sin(start / length * Math.PI * 8 + .7)) ** 3;
    const gain = (.03 + rng() ** 2.2 * .22) * activity, pan = rng() * 1.8 - .9;
    const lg = Math.sqrt((1 - pan) * .5), rg = Math.sqrt((1 + pan) * .5);
    for (let i = 0; i < n; i++) {
      const u = i / n, t = i / sampleRate;
      const phase = 2 * Math.PI * hz * (t + (ratio - 1) * t * u * .5);
      const envelope = Math.min(1, i / Math.max(1, sampleRate * .0015)) * Math.exp(-5.5 * u) * (1 - u) ** 2;
      const value = Math.sin(phase) * envelope * gain, at = (start + i) % length;
      left[at] += value * lg; right[at] += value * rg;
    }
    work += n;
  }
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  if (peak > .95) for (let i = 0; i < length; i++) { left[i] *= .95 / peak; right[i] *= .95 / peak; }
  return { left, right, grains: count, work };
}
// A periodic FIR noise: wrap the filter history rather than fading both loop ends to zero.
export function cyclicNoise(sampleRate, seconds, seed, color = .2) {
  const n = Math.ceil(sampleRate * seconds), out = new Float32Array(n), rng = mulberry32(seed);
  for (let i = 0; i < n; i++) out[i] = rng() * 2 - 1;
  let low = 0;
  for (let i = Math.max(0, n - 512); i < n; i++) low += color * (out[i] - low);
  for (let i = 0; i < n; i++) { low += color * (out[i] - low); out[i] = low; }
  return out;
}
