/** Short, bounded feedback. AudioContext is created only by a user gesture. */
export class GameAudio {
  constructor(onUnavailable = () => {}) {
    this.context = null;
    this.muted = false;
    this.paused = true;
    this.sources = new Set();
    this.onUnavailable = onUnavailable;
    this.reported = false;
  }
  async unlock() {
    try {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) throw new Error('Audio unavailable');
      this.context ||= new Context();
      if (!this.paused && !this.muted) await this.context.resume();
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
    this.sync();
  }
  setPaused(paused) {
    this.paused = !!paused;
    this.sync();
  }
  sync() {
    if (!this.context) return;
    if (this.paused || this.muted) {
      for (const source of this.sources) { try { source.stop(); } catch {} }
      this.sources.clear();
      this.context.suspend().catch(() => {});
    } else this.context.resume().catch(() => this.unavailable());
  }
  play(kind) {
    const ctx = this.context;
    if (!ctx || this.paused || this.muted || ctx.state !== 'running' || this.sources.size >= 8) return false;
    try {
      const duration = kind === 'fill' ? .66 : kind === 'deliver' ? .8 : .17;
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const time = ctx.currentTime;
      filter.type = 'lowpass';
      filter.frequency.value = kind === 'fill' ? 2200 : 750;
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(kind === 'step' ? .022 : .075, time + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
      gain.connect(filter); filter.connect(ctx.destination);
      const source = kind === 'fill' || kind === 'step' ? this.noise(duration) : ctx.createOscillator();
      if (source.frequency) {
        source.type = 'sine';
        source.frequency.setValueAtTime(kind === 'deliver' ? 392 : 210, time);
        source.frequency.exponentialRampToValueAtTime(kind === 'deliver' ? 523.25 : 110, time + duration);
      }
      source.connect(gain);
      this.sources.add(source);
      source.onended = () => { this.sources.delete(source); source.disconnect(); gain.disconnect(); filter.disconnect(); };
      source.start(time); source.stop(time + duration);
      return true;
    } catch { return false; }
  }
  noise(duration) {
    const ctx = this.context;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let low = 0;
    for (let i = 0; i < data.length; i++) { low = .85 * low + .15 * (Math.random() * 2 - 1); data[i] = low; }
    const source = ctx.createBufferSource(); source.buffer = buffer;
    return source;
  }
  get state() {
    return { unlocked: !!this.context, contextState: this.context?.state || 'uninitialized', muted: this.muted, paused: this.paused, voices: this.sources.size };
  }
}
