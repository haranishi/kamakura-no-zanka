// W2c-15 sound: short generic water grains -> splash, weight and spatial droplets.
import { mulberry32 } from './scatter.js';
import { kamakuraStepLayers } from './kamakura-step-rules.js';
const buffers = new WeakMap();
export const STEP_PEAK_CEILING = .48; // -6.38 dBFS before master/compression; all active new steps combined.
function noise(ctx) {
  let buffer = buffers.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0), rng = mulberry32(0x73706c);
    for (let i = 0; i < data.length; i++) data[i] = rng() * 2 - 1;
    buffers.set(ctx, buffer);
  }
  return buffer;
}
export function balanceSteps(audio) {
  let bound = 0;
  for (const v of audio.sources.values()) bound += v.stepPeakBound || 0;
  const scale = Math.min(1, STEP_PEAK_CEILING / (bound || 1));
  for (const v of audio.sources.values()) if (v.stepPeakBound) v.gain.gain.value = scale;
  audio.stepPeakBound = bound * scale;
}
export function playKamakuraStep(audio, step, grassMix, { pan = 0, lowpassHz = 20000, gainScale = 1 } = {}) {
  if (![pan, lowpassHz, gainScale].every(Number.isFinite) || lowpassHz <= 0 || gainScale < 0) throw new TypeError('Invalid step output');
  const ctx = audio.context;
  audio.stepRejectReason = null;
  if (!ctx || audio.paused || audio.muted || ctx.state !== 'running') return false;
  if (audio.sources.size >= 28) { audio.stepRejectReason = 'limit'; return false; }
  const layers = kamakuraStepLayers(step, grassMix), nodes = [], children = [];
  const voice = { stepNodes: nodes, children, stepPeakBound: 0 };
  try {
    const t = ctx.currentTime, bus = ctx.createGain(); nodes.push(bus); voice.gain = bus;
    const low = ctx.createBiquadFilter(); low.type = 'lowpass'; low.Q.value = -6.1; // Web Audio lowpass Q is dB: overdamped; cutoff <= .2 sampleRate keeps impulse nonnegative (L1=1)
    low.frequency.value = Math.min(lowpassHz, ctx.sampleRate * .2); nodes.push(low);
    // Normalize after filtering, so old filter tails also obey a newly reduced voice budget.
    low.connect(bus); bus.connect(audio.ensureMaster());
    for (const l of layers) {
      if (!l.gain) continue;
      const start = t + l.startMs / 1000, end = start + l.durationMs / 1000;
      const source = l.filter ? ctx.createBufferSource() : ctx.createOscillator();
      nodes.push(source); children.push(source);
      if (l.filter) { source.buffer = noise(ctx); source.loop = true; }
      else { source.type = 'sine'; source.frequency.setValueAtTime(Math.min(l.freq, ctx.sampleRate * .45), start); }
      let output = source;
      if (l.filter) {
        const f = ctx.createBiquadFilter(); f.type = l.filter; f.Q.value = l.filter === 'bandpass' ? .5 : -6.1;
        f.frequency.value = Math.min(l.freq, ctx.sampleRate * (l.filter === 'bandpass' ? .45 : .2)); nodes.push(f); source.connect(f); output = f;
      }
      const g = ctx.createGain(), p = ctx.createStereoPanner(); nodes.push(g, p);
      const level = l.gain * Math.min(1, gainScale);
      g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(level, start + .002);
      g.gain.exponentialRampToValueAtTime(Math.max(1e-8, level * .0001), end);
      p.pan.value = Math.max(-1, Math.min(1, pan + l.pan));
      output.connect(g); g.connect(p); p.connect(low);
      voice.stepPeakBound += level * (l.filter ? 2 : 1);
      if (l.filter) source.start(start, (step.seed % 1000) / 1000); else source.start(start);
      source.stop(end + .004);
    }
    const tail = ctx.createBufferSource(); nodes.push(tail); children.push(tail); voice.source = tail;
    tail.buffer = ctx.createBuffer(1, 1, ctx.sampleRate); tail.loop = true; tail.connect(bus);
    tail.onended = () => audio.release(voice);
    audio.sources.set(tail, voice); balanceSteps(audio);
    tail.start(t); tail.stop(t + Math.max(...layers.map(l => l.startMs + l.durationMs)) / 1000 + .04);
    return true;
  } catch { audio.stop(voice); return false; }
}
