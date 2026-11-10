// Procedural voice scores. Seconds / Hz / linear amplitude, with seeded variation.
// Components are mathematical oscillators or filtered noise, rendered into a Web Audio buffer.
// Baking the envelopes keeps even a bell's ten beating modes below the live-node budget.
import { mulberry32 } from './scatter.js';

export const VOICE_NAMES = Object.freeze(['higurashi', 'aburazemi', 'minmin', 'uguisu', 'tobi', 'suzume', 'karasu', 'kaeru', 'koorogi', 'kane']);
const between = (rng, lo, hi) => lo + (hi - lo) * rng();
const count = (rng, lo, hi) => Math.floor(between(rng, lo, hi + 1));
function part(type, start, duration, hz, gain = 1, attack = .006) {
  return { type, start, duration, frequency: [[0, hz], [duration, hz]],
    gain: [[0, 0], [attack, gain], [duration * .65, gain * .65], [duration, 0]] };
}
export function voicePlan(name, rng) {
  if (typeof rng !== 'function') throw new TypeError('voicePlan needs a seeded rng');
  const out = [], tone = (s, d, f, g = 1, a = .006) => { const p = part('tone', s, d, f, g, a); out.push(p); return p; };
  const noise = (s, d, f, q, g) => { const p = part('noise', s, d, f, g); p.seed = (rng() * 4294967296) >>> 0; p.filter = { type: 'bandpass', frequency: f, q }; out.push(p); return p; };
  switch (name) {
    case 'higurashi': {
      const n = count(rng, 25, 35), f = between(rng, 3700, 4150), d = between(rng, .07, .11);
      let s = 0;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1), hz = f * (1 - .05 * u), g = 1 - .65 * u;
        tone(s, d, hz, g, .003); tone(s, d, hz * 2, g * .12, .003).harmonic = true;
        s += 1 / (6 + 3 * u);
      }
      break;
    }
    case 'aburazemi': {
      const d = between(rng, 10, 18), p = noise(0, d, between(rng, 5000, 7000), 3, 1);
      p.gain = [[0, 0], [d * .25, 1], [d * .7, .8], [d, 0]];
      p.tremolo = { rate: between(rng, 86, 94), depth: .8 }; break;
    }
    case 'minmin': {
      const f = between(rng, 3850, 4150), n = count(rng, 3, 6);
      const call = (s, d, last = false) => {
        const p = tone(s, d, f); p.frequency = [[0, f], [d * .4, f * 1.08], [d, f * (last ? .88 : 1)]];
        p.tremolo = { rate: between(rng, 105, 115), depth: .85 };
      };
      call(0, .6); let s = .72;
      for (let i = 0; i < n; i++, s += between(rng, .32, .38)) call(s, .25);
      call(s, 1.5, true); break;
    }
    case 'uguisu': {
      const d = between(rng, .9, 1.3), f = between(rng, 950, 1050), p = tone(0, d, f, .75, d * .7);
      p.gain[2] = [d * .85, .75];
      let s = d + .025;
      for (const hz of [2200, 3200, 2600]) {
        const length = between(rng, .08, .12), note = tone(s, length, hz * between(rng, .98, 1.02), 1, .01);
        note.frequency[1][1] *= .94; s += length + .006;
      }
      break;
    }
    case 'tobi': {
      const f = between(rng, 3120, 3280), p = tone(0, .5, f, 1, .035);
      p.frequency[1][1] = f * .96;
      const d = between(rng, .8, 1.2), tail = tone(.5, d, 3000, .85, .02);
      tail.frequency[1][1] = 2200; tail.vibrato = { rate: between(rng, 12, 15), depth: .045 }; break;
    }
    case 'suzume': {
      const n = count(rng, 2, 5); let s = 0;
      for (let i = 0; i < n; i++) {
        const p = tone(s, between(rng, .04, .06), between(rng, 4500, 5000));
        p.frequency[1][1] = between(rng, 3500, 3900); s += between(rng, .16, .25);
      }
      break;
    }
    case 'karasu': {
      const n = count(rng, 2, 3); let s = 0;
      for (let i = 0; i < n; i++) {
        const d = between(rng, .3, .4), f = between(rng, 450, 600), p = tone(s, d, f);
        p.wave = 'sawtooth'; p.frequency[1][1] *= .87;
        p.filter = { type: 'bandpass', frequency: between(rng, 1200, 1800), q: 1.3 };
        noise(s, d, p.filter.frequency, 1.3, .22); s += d + between(rng, .18, .28);
      }
      break;
    }
    case 'kaeru': {
      const d = between(rng, 1, 3), rate = between(rng, 8, 12);
      for (let frog = 0; frog < 3; frog++) {
        const hz = between(rng, 1500, 2500), offset = frog * .037;
        for (let s = offset; s + .025 <= d; s += 1 / rate) tone(s, .025, hz, .45, .002);
      }
      break;
    }
    case 'koorogi': {
      const d = between(rng, 12, 17), n = count(rng, 3, 5), hz = between(rng, 4000, 4500);
      for (let s = 0; s < d; s += between(rng, .48, .54)) for (let i = 0; i < n; i++) {
        const p = tone(s + i * .048, .035, hz, .7, .003);
        p.tremolo = { rate: between(rng, 30, 60), depth: .85 };
      }
      break;
    }
    case 'kane': {
      const base = between(rng, 110, 130), low = between(rng, 12, 18);
      for (const [i, ratio] of [1, 2, 2.7, 3.6, 5.1].entries()) {
        const f = base * ratio, beat = between(rng, .4, 1.2), d = i < 2 ? low : between(rng, 2, 5);
        for (let pair = 0; pair < 2; pair++) {
          const p = tone(0, d, f + pair * beat, .5 / (1 + i * .65), .008);
          p.decay = true; p.pair = i;
        }
      }
      noise(0, .075, 220, .7, .25); break;
    }
    case 'flockBurst':
      for (let i = 0; i < 8; i++) noise(i * .07, .11, between(rng, 600, 1300), .7, .55);
      break;
    default: throw new RangeError(`Unknown soundscape voice: ${name}`);
  }
  return out;
}
export function voiceDuration(parts) {
  let end = 0; for (const p of parts) end = Math.max(end, p.start + p.duration); return end;
}
// RBJ constant-skirt bandpass. State belongs to one component, never to a listener/frame.
function bandpass(spec, rate) {
  const w = 2 * Math.PI * spec.frequency / rate, alpha = Math.sin(w) / (2 * spec.q), a = 1 + alpha;
  return [alpha / a, -alpha / a, -2 * Math.cos(w) / a, (1 - alpha) / a];
}
function renderBellMode(samples, p, rate, n, offset) {
  // A small separate kernel avoids compiling the general noise/chirp renderer for every bell mode.
  const w = 2 * Math.PI * p.frequency[0][1] / rate, c = 2 * Math.cos(w), decay = Math.exp(-6 / (rate * p.duration));
  let previous = 0, current = Math.sin(w), amplitude = p.gain[1][1];
  const attack = rate * p.gain[1][0], duration = rate * p.duration, fade = rate * .03;
  for (let i = 0; i < n && offset + i < samples.length; i++) {
    samples[offset + i] += current * amplitude * Math.min(1, i / attack, (duration - i) / fade);
    const next = c * current - previous; previous = current; current = next; amplitude *= decay;
  }
}
export function renderVoice(parts, rate = 24000) {
  const samples = new Float32Array(Math.ceil(voiceDuration(parts) * rate));
  for (const p of parts) {
    const n = Math.ceil(p.duration * rate), offset = Math.round(p.start * rate), rng = mulberry32(p.seed ?? 0);
    const b = p.filter ? bandpass(p.filter, rate) : null;
    if (p.decay) {
      renderBellMode(samples, p, rate, n, offset);
      continue;
    }
    let phase = 0, fi = 0, gi = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < n && offset + i < samples.length; i++) {
      const t = i / rate;
      while (fi < p.frequency.length - 2 && t > p.frequency[fi + 1][0]) fi++;
      while (gi < p.gain.length - 2 && t > p.gain[gi + 1][0]) gi++;
      const fa = p.frequency[fi], fb = p.frequency[fi + 1], ga = p.gain[gi], gb = p.gain[gi + 1];
      let hz = fa[1] + (fb[1] - fa[1]) * (t - fa[0]) / (fb[0] - fa[0]);
      if (p.vibrato) hz *= 1 + p.vibrato.depth * Math.sin(2 * Math.PI * p.vibrato.rate * t);
      phase += hz / rate;
      let v = p.type === 'noise' ? rng() * 2 - 1 : p.wave === 'sawtooth'
        // Six band-limited harmonics keep the crow's rasp below Nyquist.
        ? (Math.sin(phase * 2 * Math.PI) + Math.sin(phase * 4 * Math.PI) / 2 + Math.sin(phase * 6 * Math.PI) / 3
          + Math.sin(phase * 8 * Math.PI) / 4 + Math.sin(phase * 10 * Math.PI) / 5 + Math.sin(phase * 12 * Math.PI) / 6) * .6
        : Math.sin(phase * 2 * Math.PI);
      if (b) { const y = b[0] * v + b[1] * x2 - b[2] * y1 - b[3] * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; v = y; }
      let g = ga[1] + (gb[1] - ga[1]) * (t - ga[0]) / (gb[0] - ga[0]);
      if (p.tremolo) g *= 1 - p.tremolo.depth * (.5 - .5 * Math.sin(2 * Math.PI * p.tremolo.rate * t));
      samples[offset + i] += v * g;
    }
  }
  let peak = 0; for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak) for (let i = 0; i < samples.length; i++) samples[i] /= peak;
  return samples;
}
