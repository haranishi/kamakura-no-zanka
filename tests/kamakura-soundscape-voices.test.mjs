import test from 'node:test';
import assert from 'node:assert/strict';
import { VOICE_NAMES, voicePlan, voiceDuration, renderVoice } from '../dist/valley/kamakura-voices.js';
import { SOUNDSCAPE_LEVELS } from '../dist/valley/kamakura-soundscape.js';
import { mulberry32 } from '../dist/valley/scatter.js';

const within = (v, lo, hi) => assert(v >= lo - 1e-8 && v <= hi + 1e-8, `${v} outside ${lo}..${hi}`);
const plan = (name, seed = 1) => voicePlan(name, mulberry32(seed));
test('all ten voice scores are seeded, finite, ordered, and vary in pitch/duration/count across seeds', () => {
  for (const name of VOICE_NAMES) {
    assert.equal(JSON.stringify(plan(name)), JSON.stringify(plan(name)));
    assert.notEqual(JSON.stringify(plan(name)), JSON.stringify(plan(name, 2)));
    for (let seed = 0; seed < 40; seed++) {
      const parts = plan(name, seed); assert(parts.length);
      for (const p of parts) {
        assert(['tone', 'noise'].includes(p.type)); assert(p.start >= 0 && p.duration > 0);
        for (const curve of [p.frequency, p.gain]) {
          let last = -1;
          for (const [time, value] of curve) { within(time, 0, p.duration); assert(time > last); assert(Number.isFinite(value)); last = time; }
          assert.equal(curve[0][0], 0); assert.equal(curve.at(-1)[0], p.duration);
        }
        for (const [, hz] of p.frequency) within(hz, 100, 9000);
        assert.equal(p.gain[0][1], 0); assert.equal(p.gain.at(-1)[1], 0);
      }
    }
  }
  assert.throws(() => plan('unknown'), RangeError);
});
test('cicada scores: accelerating descending 25–45 higurashi grains; broadband 90Hz abura; minmin phrase', () => {
  for (let seed = 0; seed < 80; seed++) {
    const h = plan('higurashi', seed), main = h.filter(p => !p.harmonic);
    within(main.length, 25, 45); within(voiceDuration(h), 3, 5);
    for (let i = 0; i < main.length; i++) {
      const p = main[i]; within(p.duration, .07, .11); within(p.frequency[0][1], 3500, 4200);
      assert.equal(h[i * 2 + 1].frequency[0][1], p.frequency[0][1] * 2);
      assert(h[i * 2 + 1].gain[1][1] < p.gain[1][1] * .2);
      if (i) { assert(p.frequency[0][1] < main[i - 1].frequency[0][1]); assert(p.gain[1][1] < main[i - 1].gain[1][1]); }
      if (i > 1) assert(p.start - main[i - 1].start < main[i - 1].start - main[i - 2].start);
    }
    within(main.at(-1).frequency[0][1] / main[0].frequency[0][1], .949, .951);
    const [a] = plan('aburazemi', seed); assert.equal(a.type, 'noise'); within(a.filter.frequency, 5000, 7000);
    within(a.duration, 10, 18); within(a.tremolo.rate, 86, 94);
    const m = plan('minmin', seed); within(m.length - 2, 3, 6); assert.equal(m[0].duration, .6); assert.equal(m.at(-1).duration, 1.5);
    for (const p of m) { within(p.frequency[0][1], 3850, 4150); within(p.tremolo.rate, 105, 115); }
    assert(m.slice(1, -1).every(p => p.duration === .25));
  }
});
test('bird phrases, frog chorus and cricket trains match the requested time/frequency shapes', () => {
  for (let seed = 0; seed < 40; seed++) {
    const u = plan('uguisu', seed); within(u[0].duration, .9, 1.3); within(u[0].frequency[0][1], 950, 1050);
    assert.equal(u.length, 4); for (const p of u.slice(1)) within(p.duration, .08, .12);
    const t = plan('tobi', seed); assert.equal(t[0].duration, .5); within(t[1].duration, .8, 1.2); within(t[1].vibrato.rate, 12, 15);
    assert.equal(t[1].frequency[0][1], 3000); assert.equal(t[1].frequency.at(-1)[1], 2200);
    const s = plan('suzume', seed); within(s.length, 2, 5);
    for (const p of s) { within(p.duration, .04, .06); within(p.frequency[0][1], 3500, 5000); assert(p.frequency[0][1] > p.frequency[1][1]); }
    const c = plan('karasu', seed), tones = c.filter(p => p.type === 'tone'); within(tones.length, 2, 3);
    for (const p of tones) { within(p.frequency[0][1], 450, 600); within(p.duration, .3, .4); within(p.filter.frequency, 1200, 1800); assert.equal(p.wave, 'sawtooth'); }
    const f = plan('kaeru', seed); within(voiceDuration(f), .95, 3);
    for (const p of f) { within(p.frequency[0][1], 1500, 2500); assert.equal(p.duration, .025); }
    const firstFrog = f.filter(p => p.frequency[0][1] === f[0].frequency[0][1]); within(1 / (firstFrog[1].start - firstFrog[0].start), 8, 12);
    const k = plan('koorogi', seed); within(voiceDuration(k), 11.8, 17.3);
    for (const p of k) { within(p.frequency[0][1], 4000, 4500); within(p.tremolo.rate, 30, 60); }
    let firstTrain = 1; while (k[firstTrain].start < .3) firstTrain++; within(firstTrain, 3, 5);
    within(k[firstTrain].start, .48, .54);
  }
});
test('bell has five nonharmonic mode pairs separated by .4–1.2Hz, low long tails and high short tails', () => {
  for (let seed = 0; seed < 80; seed++) {
    const b = plan('kane', seed); assert.equal(b.length, 11); within(b[0].frequency[0][1], 110, 130);
    for (let i = 0; i < 10; i += 2) {
      const a = b[i], p = b[i + 1]; assert.equal(a.pair, p.pair); assert.equal(a.duration, p.duration);
      within(p.frequency[0][1] - a.frequency[0][1], .4, 1.2);
      within(a.duration, i < 4 ? 12 : 2, i < 4 ? 18 : 5);
    }
    assert.equal(b.at(-1).type, 'noise'); assert(b.at(-1).duration < .1);
  }
});
test('PCM rendering is deterministic, bounded and finite; near-source provisional peaks/RMS are measurable', t => {
  const metrics = [];
  for (const name of VOICE_NAMES) {
    const score = plan(name), rate = name === 'kane' ? 12000 : 24000;
    const samples = renderVoice(score, rate), again = renderVoice(score, rate);
    assert.equal(Buffer.compare(Buffer.from(samples.buffer), Buffer.from(again.buffer)), 0);
    assert.equal(samples.length, Math.ceil(voiceDuration(score) * rate));
    let peak = 0, energy = 0;
    for (const v of samples) { assert(Number.isFinite(v)); peak = Math.max(peak, Math.abs(v)); energy += v * v; }
    within(peak, .9999, 1.0001); assert.equal(samples[0], 0); assert(Math.abs(samples.at(-1)) < .003);
    const gain = SOUNDSCAPE_LEVELS[name];
    metrics.push({ name, parts: score.length, seconds: +(samples.length / rate).toFixed(3),
      peakDb: +(20 * Math.log10(peak * gain)).toFixed(2), rmsDb: +(20 * Math.log10(Math.sqrt(energy / samples.length) * gain)).toFixed(2) });
  }
  t.diagnostic(JSON.stringify(metrics));
});
