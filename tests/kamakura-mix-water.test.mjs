import test from 'node:test';
import assert from 'node:assert/strict';
import { waterLoop, cyclicNoise } from '../dist/valley/kamakura-water-synth.js';
import { MIX } from '../dist/valley/kamakura-mix.js';
function stats(data, rate) {
  let peak = 0, energy = 0, adjacent = 0; const windows = [], size = Math.round(rate * .01);
  for (let i = 0; i < data.length; i++) {
    assert(Number.isFinite(data[i])); peak = Math.max(peak, Math.abs(data[i])); energy += data[i] ** 2;
    if (i) adjacent = Math.max(adjacent, Math.abs(data[i] - data[i - 1]));
  }
  for (let i = 0; i + size <= data.length; i += size) { let e = 0; for (let j = i; j < i + size; j++) e += data[j] ** 2; windows.push(Math.sqrt(e / size)); }
  windows.sort((a, b) => a - b);
  return { peak, rms: Math.sqrt(energy / data.length), adjacent, seam: Math.abs(data[0] - data.at(-1)), p10: windows[Math.floor(windows.length * .1)], p95: windows[Math.floor(windows.length * .95)] };
}
test('pure stereo water: deterministic, finite, bounded, cyclic wrap, variable 10ms levels and distinct channels', () => {
  for (const rate of [8000, 12000, 48000]) for (let i = 0; i < 2; i++) {
    const seconds = MIX.river.seconds[i], seed = MIX.river.seeds[i], density = MIX.river.rates[i], a = waterLoop(rate, seconds, seed, density), b = waterLoop(rate, seconds, seed, density);
    assert.equal(a.left.length, Math.ceil(rate * seconds)); assert.equal(a.right.length, a.left.length);
    assert.equal(a.grains, Math.round(seconds * MIX.river.rates[i]));
    // Typed array byte equality avoids giant assertion diffs on a waveform failure.
    assert(Buffer.from(a.left.buffer).equals(Buffer.from(b.left.buffer)));
    assert(Buffer.from(a.right.buffer).equals(Buffer.from(b.right.buffer)));
    assert(!Buffer.from(a.left.buffer).equals(Buffer.from(a.right.buffer)));
    assert(!Buffer.from(a.left.buffer).equals(Buffer.from(waterLoop(rate, seconds, seed + 1, density).left.buffer)));
    for (const channel of [a.left, a.right]) {
      const s = stats(channel, rate); assert(s.peak <= 1); assert(s.rms > .003 && s.rms < .07);
      assert(s.seam <= s.adjacent);
      // Sparse grains intentionally leave gaps; including the separately synthesized floor is tested below.
      assert(s.p95 >= s.p10 * 10 ** (6 / 20));
    }
  }
  for (const args of [[NaN, 8, 1], [48000, 0, 1], [48000, 8, 1, Infinity]]) assert.throws(() => waterLoop(...args));
});
test('combined 8s/12s river keeps dynamics over 60s with a nonzero floor and stays under unlock grain-work budget', () => {
  const rate = 12000, waves = MIX.river.seconds.map((s, i) => waterLoop(rate, s, MIX.river.seeds[i]));
  const n = rate * 60, mixed = new Float32Array(n), floor = cyclicNoise(rate, 1.73, 0x616972, .12);
  for (let i = 0; i < n; i++) mixed[i] = MIX.river.gain * (waves[0].left[i % waves[0].left.length] + waves[1].left[i % waves[1].left.length]) + floor[i % floor.length] * .012;
  const s = stats(mixed, rate); assert(s.p10 > 0); assert(20 * Math.log10(s.p95 / s.p10) >= 6); assert(s.peak < 1);
  const work = waves.reduce((sum, w) => sum + w.work, 0);
  assert(work * 2 <= 4 * 2 * 48000);
  assert(waves.reduce((sum, w) => sum + w.grains, 0) / MIX.river.seconds.reduce((a, b) => a + b) * 2 >= 20);
});
test('air noise has no edge fade or seam dip, deterministic periodic history', () => {
  const rate = 48000;
  for (const color of [.12, .8]) {
    const a = cyclicNoise(rate, 1.73, 123, color), b = cyclicNoise(rate, 1.73, 123, color), s = stats(a, rate);
    assert(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))); assert(s.seam <= s.adjacent); assert(s.peak <= 1);
    let edge = 0, middle = 0;
    for (let i = 0; i < 2400; i++) { edge += a[i] ** 2 + a[a.length - 1 - i] ** 2; middle += a[4800 + i] ** 2 + a[10000 + i] ** 2; }
    assert(edge / middle > .75 && edge / middle < 1.3);
  }
});
