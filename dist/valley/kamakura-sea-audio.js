import { ValleyAudio } from './audio-valley.js';
import { playKamakuraStep, balanceSteps } from './kamakura-step-audio.js';
import { MIX, duckDepth, duckPlan, duckAt } from './kamakura-mix.js';
import { startMixAmbience, releaseMixVoice, mixSurfSource } from './kamakura-ambience-view.js';
// W2c-9a: Kamakura-only surf. Valley synthesis and its wind/river targets stay unchanged.
// Retuned by the parent after measuring the real output (analyser at the limiter): gain .14/scale 45 left the surf at -42 dBFS (about the wind floor; the river at 3 m is -30). W2c-9a: .14 -> .5, 45 -> 60.
export const SEA_AUDIO = Object.freeze({ gain: .5, scale: 60, power: 1.6, reach: 600, smoothing: .25, seed: 1333 });
export const seaNear = d => d > SEA_AUDIO.reach ? 0 : 1 / (1 + (Math.max(0, d) / SEA_AUDIO.scale) ** SEA_AUDIO.power);
function hash(n, seed) {
  let x = Math.imul((n | 0) ^ (seed | 0), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
// Six waves per block, paired +/- jitter: bounded random access, no time-dependent state.
// Each three-wave set has a seeded strength. Every period is in [6.8, 9.8] seconds.
export function waveEnvelope(t, seed = SEA_AUDIO.seed) {
  if (!Number.isFinite(t) || t < 0) return 0;
  const block = Math.floor(t / 49.8);
  let phase = t - block * 49.8;
  for (let i = 0; i < 6; i++) {
    const jitter = (hash(block * 3 + Math.floor(i / 2), seed) * 2 - 1) * 1.5;
    const period = 8.3 + (i % 2 ? -jitter : jitter);
    if (phase < period || i === 5) {
      const strength = .55 + .45 * hash(block * 2 + Math.floor(i / 3), seed ^ 0x736561);
      return strength * Math.sin(Math.PI * Math.max(0, Math.min(1, phase / period))) ** 2;
    }
    phase -= period;
  }
  return 0;
}
export class KamakuraAudio extends ValleyAudio {
  // gainScale: 1 = the tuned level; ?seagain=2 in the URL doubles it (for the listener to tune the surf by ear).
  constructor(onUnavailable, { sea = true, gainScale = 1, steps9 = false, mix10 = false } = {}) {
    super(onUnavailable); this.steps9 = steps9; this.grassMix = null; this.seaEnabled = sea; this.seaDistance = Infinity; this.seaGain = 0; this.seaScale = Number.isFinite(gainScale) && gainScale > 0 ? Math.min(gainScale, 8) : 1;
    this.mix10 = mix10; this.buses = null; this.stepRouting = false;
    this.listening = { x: 0, y: 0, z: 0, yaw: 0, time: 0, windX: 1, windZ: 0, wind: 0, flying: false, received: false };
    this.mixState = { wind: 0, meadow: 0, forest: 0, riverGain: 0, riverPan: 0, seaPan: 0, steps: 0 };
    this.duck = { start: 0, from: 1, target: 1, attack: 0, hold: 0, end: 0 };
  }
  ensureBuses() {
    if (!this.buses && this.context) {
      const master = super.ensureMaster(); this.buses = {};
      for (const kind of ['ambience', 'steps', 'life']) {
        const n = this.context.createGain(); this.buses[kind] = n;
        n.gain.value = MIX.buses[kind]; n.connect(master);
      }
    }
    return this.buses;
  }
  ensureMaster() {
    return this.mix10 && this.stepRouting ? this.ensureBuses().steps : super.ensureMaster();
  }
  duckAmbience() {
    const depth = duckDepth(this.listener.river, this.seaEnabled ? this.seaDistance : Infinity);
    if (!depth) return;
    const t = this.context.currentTime, d = this.duck, plan = duckPlan(t, depth);
    const from = duckAt(t, d.start, d.from, d.target, d.attack, d.hold, d.end);
    const gain = this.ensureBuses().ambience.gain;
    gain.cancelScheduledValues(t); gain.setValueAtTime(from * MIX.buses.ambience, t);
    gain.linearRampToValueAtTime(plan.gain * MIX.buses.ambience, plan.attack);
    gain.setValueAtTime(plan.gain * MIX.buses.ambience, plan.hold);
    gain.linearRampToValueAtTime(MIX.buses.ambience, plan.end);
    Object.assign(d, { start: t, from, target: plan.gain, attack: plan.attack, hold: plan.hold, end: plan.end });
  }
  playStep(step, options) {
    const custom = this.steps9 && ['water', 'grass', 'dirt'].includes(step.recipe.surface);
    // steps9=0 preserves every old step node and its gain, even with the new ambience.
    const routed = this.mix10 && this.steps9;
    this.stepRouting = routed;
    let played;
    try {
      played = custom ? playKamakuraStep(this, step, this.grassMix ?? +(step.recipe.surface === 'grass'), options)
        : super.playStep(step, routed ? { ...options, gainScale: (options?.gainScale ?? 1) * MIX.steps.legacyGain } : options);
    } finally { this.stepRouting = false; }
    if (played && this.mix10) { this.mixState.steps++; this.duckAmbience(); }
    return played;
  }
  startAmbient() {
    if (!this.mix10) super.startAmbient();
    else {
      const ctx = this.context;
      if (!ctx || this.paused || this.muted || ctx.state !== 'running' || this.ambientFailed) return;
      try { startMixAmbience(this); }
      catch { this.stopAmbient(); this.ambientFailed = true; this.unavailable(); return; }
    }
    const ctx = this.context;
    if (!this.seaEnabled || !ctx || this.paused || this.muted || ctx.state !== 'running' || this.ambientFailed) return;
    let voice = this.ambient.get('sea');
    try {
      if (!voice) {
        voice = { kind: 'sea', nodes: [], children: [] };
        this.ambient.set('sea', voice);
        const gain = () => { const n = ctx.createGain(); n.gain.value = 0; voice.nodes.push(n); return n; };
        const filter = (type, hz) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = hz; n.Q.value = .6; voice.nodes.push(n); return n; };
        voice.gain = gain();
        if (this.mix10) {
          voice.pan = ctx.createStereoPanner(); voice.nodes.push(voice.pan);
          voice.gain.connect(voice.pan); voice.pan.connect(this.ensureBuses().ambience);
        } else voice.gain.connect(this.ensureMaster());
        const source = (duration, color) => {
          const n = this.mix10 ? mixSurfSource(this, color) : this.noiseSource(duration, true, color);
          voice.children.push(n); voice.nodes.push(n); return n;
        };
        const swell = source(11.3, .08), foam = source(13.1, .7);
        const low = filter('lowpass', 500), high = filter('highpass', 1800), band = filter('bandpass', 3400);
        voice.swell = gain(); voice.foam = gain(); voice.rumble = gain();
        swell.connect(low); low.connect(voice.swell); low.connect(voice.rumble);
        foam.connect(high); high.connect(band); band.connect(voice.foam);
        for (const n of [voice.swell, voice.foam, voice.rumble]) n.connect(voice.gain);
        swell.start(); foam.start();
      }
      const t = ctx.currentTime, smooth = SEA_AUDIO.smoothing;
      this.seaGain = (this.mix10 ? MIX.sea.gain : SEA_AUDIO.gain) * this.seaScale * seaNear(this.seaDistance);
      voice.gain.gain.setTargetAtTime(this.seaGain, t, smooth);
      voice.swell.gain.setTargetAtTime(.85 * waveEnvelope(t), t, smooth);
      voice.foam.gain.setTargetAtTime(.5 * waveEnvelope(t - .9) ** 3, t, smooth);
      voice.rumble.gain.setTargetAtTime(.12, t, smooth);
      if (this.mix10) voice.pan.pan.setTargetAtTime(this.mixState.seaPan, t, MIX.smoothing);
    } catch { this.stopAmbient(); this.ambientFailed = true; this.unavailable(); }
  }
  updateListener({ sea = this.seaDistance, river, fire } = {}) {
    this.seaDistance = sea;
    super.updateListener({ river, fire });
  }
  release(voice) {
    if (voice.mixNodes) { releaseMixVoice(this, voice); return; }
    if (voice.kind !== 'sea') { const result = super.release(voice); balanceSteps(this); return result; }
    if (voice.released) return;
    voice.released = true;
    if (this.ambient.get('sea') === voice) this.ambient.delete('sea');
    for (const n of voice.children) { try { n.stop(); } catch {} }
    for (const n of voice.nodes) { try { n.disconnect(); } catch {} }
    voice.nodes.length = voice.children.length = 0;
    this.seaGain = 0;
  }
  stop(voice) {
    if (voice.mixNodes) { releaseMixVoice(this, voice); return; }
    return super.stop(voice);
  }
  stopAmbient() {
    super.stopAmbient();
    if (this.buses) {
      for (const n of Object.values(this.buses)) n.disconnect();
      this.buses = null;
    }
    this.duck.target = this.duck.from = 1;
    this.duck.start = this.duck.attack = this.duck.hold = this.duck.end = 0;
    this.mixState.riverGain = 0;
  }
}
