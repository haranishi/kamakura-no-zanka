// Web Audio ownership only. Listener calculations and tuning live in kamakura-mix.
import { MIX, waterNear, riverBrightness, windGain } from './kamakura-mix.js';
import { waterLoop, cyclicNoise } from './kamakura-water-synth.js';
const bank = new WeakMap();
function soundBank(ctx) {
  let value = bank.get(ctx);
  if (value) return value;
  const rate = Math.min(ctx.sampleRate, 12000);
  const stereo = (seconds, seed, density) => {
    const wave = waterLoop(rate, seconds, seed, density), buffer = ctx.createBuffer(2, wave.left.length, rate);
    buffer.getChannelData(0).set(wave.left); buffer.getChannelData(1).set(wave.right); return buffer;
  };
  const noise = (seconds, seed, color, sampleRate = ctx.sampleRate) => {
    const data = cyclicNoise(sampleRate, seconds, seed, color), buffer = ctx.createBuffer(1, data.length, sampleRate);
    buffer.getChannelData(0).set(data); return buffer;
  };
  // Keep low-frequency noise power when using the cheaper 12kHz surf beds.
  const surf = (seconds, seed, color) => {
    const buffer = noise(seconds, seed, 1 - (1 - color) ** (ctx.sampleRate / rate), rate), data = buffer.getChannelData(0);
    const scale = Math.sqrt(rate / ctx.sampleRate);
    for (let i = 0; i < data.length; i++) data[i] *= scale;
    return buffer;
  };
  value = { water: MIX.river.seconds.map((s, i) => stereo(s, MIX.river.seeds[i], MIX.river.rates[i])),
    air: noise(MIX.wind.seconds.air, 0x616972, .12), leaves: noise(MIX.wind.seconds.leaves, 0x6c656166, .8),
    swell: surf(MIX.wind.seconds.swell, 0x7377656c, .08), foam: surf(MIX.wind.seconds.foam, 0x666f616d, .7) };
  bank.set(ctx, value); return value;
}
export function mixSurfSource(audio, color) {
  const ctx = audio.context, sounds = soundBank(ctx), n = ctx.createBufferSource();
  n.buffer = color < .5 ? sounds.swell : sounds.foam; n.loop = true; return n;
}
function makeVoice(audio, kind) {
  const v = { kind, mixNodes: [], children: [] };
  audio.ambient.set(kind, v); return v;
}
function node(v, n) { v.mixNodes.push(n); return n; }
function gain(ctx, v, value = 0) { const n = node(v, ctx.createGain()); n.gain.value = value; return n; }
function filter(ctx, v, type, hz) { const n = node(v, ctx.createBiquadFilter()); n.type = type; n.frequency.value = hz; n.Q.value = .5; return n; }
function source(ctx, v, buffer) { const n = node(v, ctx.createBufferSource()); n.buffer = buffer; n.loop = true; v.children.push(n); return n; }
export function startMixAmbience(audio) {
  const ctx = audio.context, sounds = soundBank(ctx), bus = audio.ensureBuses().ambience;
  let wind = audio.ambient.get('wind'), river = audio.ambient.get('river');
  if (!wind) {
    wind = makeVoice(audio, 'wind'); wind.gain = gain(ctx, wind);
    wind.filter = filter(ctx, wind, 'lowpass', 520);
    wind.source = source(ctx, wind, sounds.air); wind.source.connect(wind.filter); wind.filter.connect(wind.gain); wind.gain.connect(bus);
    const leaves = source(ctx, wind, sounds.leaves);
    wind.meadow = gain(ctx, wind); wind.forest = gain(ctx, wind);
    wind.meadowFilter = filter(ctx, wind, 'bandpass', MIX.wind.meadowHz[0] + MIX.wind.meadowHz[1] * .5); wind.forestFilter = filter(ctx, wind, 'bandpass', MIX.wind.forestHz[0] + MIX.wind.forestHz[1] * .5);
    wind.meadowFilter.Q.value = wind.forestFilter.Q.value = MIX.wind.q;   // a narrower band: Q .5 let the hiss through up to 12 kHz and it read as static
    leaves.connect(wind.meadowFilter); wind.meadowFilter.connect(wind.meadow); wind.meadow.connect(bus);
    leaves.connect(wind.forestFilter); wind.forestFilter.connect(wind.forest); wind.forest.connect(bus);
    for (const s of wind.children) s.start();
  }
  if (!river) {
    river = makeVoice(audio, 'river'); river.gain = gain(ctx, river);
    river.filter = filter(ctx, river, 'lowpass', MIX.river.nearHz); river.pan = node(river, ctx.createStereoPanner());
    river.filter.connect(river.gain); river.gain.connect(river.pan); river.pan.connect(bus);
    for (const b of sounds.water) { const s = source(ctx, river, b); s.connect(river.filter); s.start(); }
    river.floor = gain(ctx, river); river.floorFilter = filter(ctx, river, 'bandpass', 620);
    // Reuse the air source; no extra oscillator for the flow floor.
    wind.source.connect(river.floorFilter); river.floorFilter.connect(river.floor); river.floor.connect(river.pan);
  }
  const t = ctx.currentTime, smooth = MIX.smoothing, near = waterNear(audio.listener.river), w = audio.mixState;
  wind.gain.gain.setTargetAtTime(MIX.wind.floor * (1 + MIX.wind.floorBoost * Math.max(0, w.wind - .32)), t, smooth);
  wind.meadow.gain.setTargetAtTime(windGain(w.wind, 'meadow') * w.meadow, t, smooth);
  wind.forest.gain.setTargetAtTime(windGain(w.wind, 'forest') * w.forest, t, smooth);
  wind.meadowFilter.frequency.setTargetAtTime(MIX.wind.meadowHz[0] + MIX.wind.meadowHz[1] * w.wind, t, smooth);
  wind.forestFilter.frequency.setTargetAtTime(MIX.wind.forestHz[0] + MIX.wind.forestHz[1] * w.wind, t, smooth);
  w.riverGain = MIX.river.gain * near;
  river.gain.gain.setTargetAtTime(w.riverGain, t, smooth);
  river.floor.gain.setTargetAtTime(MIX.river.floor * near, t, smooth);
  river.filter.frequency.setTargetAtTime(riverBrightness(audio.listener.river), t, smooth);
  river.pan.pan.setTargetAtTime(w.riverPan, t, smooth);
}
export function releaseMixVoice(audio, voice) {
  if (voice.released) return;
  voice.released = true;
  if (audio.ambient.get(voice.kind) === voice) audio.ambient.delete(voice.kind);
  for (const n of voice.children) { n.onended = null; try { n.stop(); } catch {} }
  for (const n of voice.mixNodes) { try { n.disconnect(); } catch {} }
  voice.children.length = voice.mixNodes.length = 0;
}
