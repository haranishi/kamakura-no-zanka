import { ValleyAudio } from './audio-valley.js';
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
  constructor(onUnavailable, { sea = true } = {}) {
    super(onUnavailable); this.seaEnabled = sea; this.seaDistance = Infinity; this.seaGain = 0;
  }
  startAmbient() {
    super.startAmbient();
    const ctx = this.context;
    if (!this.seaEnabled || !ctx || this.paused || this.muted || ctx.state !== 'running' || this.ambientFailed) return;
    let voice = this.ambient.get('sea');
    try {
      if (!voice) {
        voice = { kind: 'sea', nodes: [], children: [] };
        this.ambient.set('sea', voice);
        const gain = () => { const n = ctx.createGain(); n.gain.value = 0; voice.nodes.push(n); return n; };
        const filter = (type, hz) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = hz; n.Q.value = .6; voice.nodes.push(n); return n; };
        voice.gain = gain(); voice.gain.connect(this.ensureMaster());
        const source = (duration, color) => {
          const n = this.noiseSource(duration, true, color); voice.children.push(n); voice.nodes.push(n); return n;
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
      this.seaGain = SEA_AUDIO.gain * seaNear(this.seaDistance);
      voice.gain.gain.setTargetAtTime(this.seaGain, t, smooth);
      voice.swell.gain.setTargetAtTime(.85 * waveEnvelope(t), t, smooth);
      voice.foam.gain.setTargetAtTime(.5 * waveEnvelope(t - .9) ** 3, t, smooth);
      voice.rumble.gain.setTargetAtTime(.12, t, smooth);
    } catch { this.stopAmbient(); this.ambientFailed = true; this.unavailable(); }
  }
  updateListener({ sea = this.seaDistance, river, fire } = {}) {
    this.seaDistance = sea;
    super.updateListener({ river, fire });
  }
  release(voice) {
    if (voice.kind !== 'sea') return super.release(voice);
    if (voice.released) return;
    voice.released = true;
    if (this.ambient.get('sea') === voice) this.ambient.delete('sea');
    for (const n of voice.children) { try { n.stop(); } catch {} }
    for (const n of voice.nodes) { try { n.disconnect(); } catch {} }
    voice.nodes.length = voice.children.length = 0;
    this.seaGain = 0;
  }
}
