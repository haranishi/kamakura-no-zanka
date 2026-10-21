/** Bounded feedback and ambience, created only after an explicit user gesture. */
export class GameAudio {
  constructor(onUnavailable = () => {}) {
    this.context = null;
    this.muted = false;
    this.paused = true;
    this.sources = new Map();
    this.ambient = new Map();
    this.transitions = new Map();
    this.distanceToWater = Infinity;
    this.flowing = false;
    this.ambientFailed = false;
    this.onUnavailable = onUnavailable;
    this.reported = false;
  }
  async unlock() {
    try {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) throw new Error('Audio unavailable');
      this.context ||= new Context();
      this.ambientFailed = false;
      await this.sync();
    } catch {
      this.unavailable();
    }
  }
  unavailable() {
    if (!this.reported) this.onUnavailable('音を開始できませんでした。無音で続けられます');
    this.reported = true;
  }
  setMuted(muted) {
    this.muted = !!muted;
    return this.sync();
  }
  setPaused(paused) {
    this.paused = !!paused;
    return this.sync();
  }
  sync() {
    const ctx = this.context;
    if (!ctx) return Promise.resolve();
    const wanted = this.paused || this.muted ? 'suspended' : 'running';
    if (wanted === 'suspended') {
      for (const voice of this.sources.values()) this.stop(voice);
      this.stopAmbient();
    }
    if (this.transitions.has(wanted)) return this.transitions.get(wanted);
    if (ctx.state === wanted && !this.transitions.size) {
      if (wanted === 'running') this.startAmbient();
      return Promise.resolve();
    }
    let operation;
    try { operation = ctx[wanted === 'running' ? 'resume' : 'suspend'](); }
    catch { if (wanted === 'running') this.unavailable(); return Promise.resolve(); }
    const transition = Promise.resolve(operation).then(() => {
      this.transitions.delete(wanted);
      const latest = this.paused || this.muted ? 'suspended' : 'running';
      // Even an old operation can change the real context after a newer one settled.
      if (ctx.state !== latest) return this.sync();
      if (latest === 'running') this.startAmbient();
    }, () => {
      this.transitions.delete(wanted);
      if (wanted === 'running') this.unavailable();
      if ((this.paused || this.muted ? 'suspended' : 'running') !== wanted) return this.sync();
    });
    this.transitions.set(wanted, transition);
    return transition;
  }
  release(voice) {
    if (voice.released) return;
    voice.released = true;
    this.sources.delete(voice.source);
    if (this.ambient.get(voice.kind) === voice) this.ambient.delete(voice.kind);
    if (voice.source) voice.source.onended = null;
    for (const node of [voice.source, voice.gain, voice.filter]) { try { node?.disconnect(); } catch {} }
    voice.source = voice.gain = voice.filter = null;
  }
  stop(voice) {
    if (voice.released) return;
    try { voice.source?.stop(); } catch {}
    this.release(voice);
  }
  stopAmbient() {
    for (const voice of this.ambient.values()) this.stop(voice);
  }
  updateAmbient({ distanceToWater = this.distanceToWater, flowing = this.flowing } = {}) {
    this.distanceToWater = Number.isFinite(distanceToWater) ? Math.max(0, distanceToWater) : Infinity;
    this.flowing = flowing === true;
    this.startAmbient();
  }
  startAmbient() {
    const ctx = this.context;
    if (!ctx || this.paused || this.muted || ctx.state !== 'running' || this.ambientFailed) return;
    try {
      for (const kind of ['wind', 'water']) {
        if (this.ambient.has(kind)) continue;
        const voice = { kind };
        this.ambient.set(kind, voice);
        voice.gain = ctx.createGain(); voice.filter = ctx.createBiquadFilter();
        voice.gain.gain.setValueAtTime(0, ctx.currentTime);
        voice.filter.type = kind === 'wind' ? 'lowpass' : 'bandpass';
        voice.filter.frequency.value = kind === 'wind' ? 420 : 1100;
        voice.filter.Q.value = .65;
        voice.source = this.noise(kind === 'wind' ? 4.6 : 3.8, true);
        voice.source.loop = true;
        voice.source.connect(voice.gain); voice.gain.connect(voice.filter); voice.filter.connect(ctx.destination);
        voice.source.onended = () => this.release(voice);
        voice.source.start();
      }
      const proximity = 1 / (1 + (this.distanceToWater / 5) ** 2);
      for (const [kind, voice] of this.ambient) {
        const gain = kind === 'wind' ? .026 : (this.flowing ? .05 : .018) * proximity;
        if (voice.targetGain === gain) continue;
        voice.gain.gain.setTargetAtTime(gain, ctx.currentTime, .3);
        voice.targetGain = gain;
      }
    } catch {
      this.stopAmbient(); this.ambientFailed = true; this.unavailable();
    }
  }
  play(kind) {
    const ctx = this.context;
    if (!ctx || this.paused || this.muted || ctx.state !== 'running' || this.sources.size >= 8) return false;
    const voice = {};
    try {
      const duration = kind === 'fill' ? .66 : kind === 'deliver' ? .8 : kind === 'clear' ? .35 : kind === 'light' ? .65 : .17;
      const gain = voice.gain = ctx.createGain();
      const filter = voice.filter = ctx.createBiquadFilter();
      const time = ctx.currentTime;
      filter.type = 'lowpass';
      filter.frequency.value = kind === 'fill' ? 2200 : kind === 'clear' ? 1400 : 750;
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(kind === 'step' ? .022 : .075, time + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
      gain.connect(filter); filter.connect(ctx.destination);
      const source = voice.source = ['fill', 'step', 'clear'].includes(kind) ? this.noise(duration) : ctx.createOscillator();
      if (source.frequency) {
        source.type = 'sine';
        source.frequency.setValueAtTime(kind === 'deliver' ? 392 : kind === 'light' ? 659.25 : 210, time);
        source.frequency.exponentialRampToValueAtTime(kind === 'deliver' ? 523.25 : kind === 'light' ? 783.99 : 110, time + duration);
      }
      source.connect(gain);
      this.sources.set(source, voice);
      source.onended = () => this.release(voice);
      source.start(time); source.stop(time + duration);
      return true;
    } catch { this.stop(voice); return false; }
  }
  noise(duration, loop = false) {
    const ctx = this.context;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const edge = loop ? Math.max(1, Math.floor(ctx.sampleRate * .04)) : 1;
    let low = 0;
    for (let i = 0; i < data.length; i++) {
      low = .85 * low + .15 * (Math.random() * 2 - 1);
      data[i] = low * (loop ? Math.min(1, i / edge, (data.length - i - 1) / edge) : 1);
    }
    const source = ctx.createBufferSource(); source.buffer = buffer;
    return source;
  }
  get state() {
    return { unlocked: !!this.context, contextState: this.context?.state || 'uninitialized', muted: this.muted, paused: this.paused, voices: this.sources.size, ambientVoices: this.ambient.size };
  }
}
