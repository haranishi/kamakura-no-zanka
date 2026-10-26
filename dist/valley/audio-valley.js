// audio-valley.js — 縦切りの音（合成のみ・外部素材なし）。庭のしごとの GameAudio（解錠・停止・ミュートの安全な遷移）を継承し、
// 風・川・虫・焚き火の環境音と、刃・被弾・受け・弓・足音・鐘・太鼓の効果音を足す。音量は master 1か所で調整する。
import { GameAudio } from '../audio.js';

export class ValleyAudio extends GameAudio {
  constructor(onUnavailable) {
    super(onUnavailable);
    this.volume = 0.8; this.master = null; this.listener = { river: Infinity, fire: Infinity }; this.crackle = 0;
  }

  ensureMaster() {
    const ctx = this.context;
    if (!ctx) return null;
    if (!this.master) {
      this.master = ctx.createGain(); this.master.gain.value = this.volume;
      this.comp = ctx.createDynamicsCompressor(); this.comp.threshold.value = -16; this.comp.ratio.value = 4; this.comp.attack.value = 0.004; this.comp.release.value = 0.18;
      this.master.connect(this.comp); this.comp.connect(ctx.destination);
    }
    return this.master;
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.context.currentTime, 0.05); }

  noiseSource(duration, loop = false, color = 0.2) {
    const ctx = this.context;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate), data = buffer.getChannelData(0);
    let low = 0; const edge = loop ? Math.max(1, Math.floor(ctx.sampleRate * 0.05)) : 1;
    for (let i = 0; i < data.length; i++) { low = (1 - color) * low + color * (Math.random() * 2 - 1); data[i] = low * (loop ? Math.min(1, i / edge, (data.length - i - 1) / edge) : 1); }
    const s = ctx.createBufferSource(); s.buffer = buffer; s.loop = loop; return s;
  }

  // 環境音：風・川・虫・焚き火
  startAmbient() {
    const ctx = this.context;
    if (!ctx || this.paused || this.muted || ctx.state !== 'running' || this.ambientFailed) return;
    const master = this.ensureMaster();
    try {
      const spec = {
        wind: { type: 'lowpass', f: 520, q: 0.6, color: 0.12, dur: 5.5 },
        river: { type: 'bandpass', f: 1250, q: 0.5, color: 0.45, dur: 4.2 },
        fire: { type: 'bandpass', f: 2100, q: 0.9, color: 0.8, dur: 3.1 },
      };
      for (const [kind, s] of Object.entries(spec)) {
        if (this.ambient.has(kind)) continue;
        const voice = { kind };
        this.ambient.set(kind, voice);
        voice.gain = ctx.createGain(); voice.gain.gain.setValueAtTime(0, ctx.currentTime);
        voice.filter = ctx.createBiquadFilter(); voice.filter.type = s.type; voice.filter.frequency.value = s.f; voice.filter.Q.value = s.q;
        voice.source = this.noiseSource(s.dur, true, s.color);
        voice.source.connect(voice.filter); voice.filter.connect(voice.gain); voice.gain.connect(master);
        voice.source.onended = () => this.release(voice);
        voice.source.start();
      }
      const near = d => 1 / (1 + (d / 14) ** 2.2);
      const targets = { wind: 0.05, river: 0.16 * near(this.listener.river), fire: 0.07 * (1 / (1 + (this.listener.fire / 4) ** 2)) };
      for (const [kind, voice] of this.ambient) {
        if (voice.target === targets[kind]) continue;
        voice.gain.gain.setTargetAtTime(targets[kind], ctx.currentTime, 0.4); voice.target = targets[kind];
        // 風はゆっくり強弱をつける
        if (kind === 'wind') voice.filter.frequency.setTargetAtTime(380 + 260 * Math.abs(Math.sin(ctx.currentTime * 0.17)), ctx.currentTime, 1.2);
      }
    } catch { this.stopAmbient(); this.ambientFailed = true; this.unavailable(); }
  }
  updateListener({ river = this.listener.river, fire = this.listener.fire } = {}) { this.listener = { river, fire }; this.startAmbient(); }

  // 効果音。戻りは鳴らせたか。同時に鳴る数は上限つき。
  play(kind, { gain = 1, pitch = 1, pan = 0 } = {}) {
    const ctx = this.context;
    if (!ctx || this.paused || this.muted || ctx.state !== 'running' || this.sources.size >= 28) return false;
    const master = this.ensureMaster();
    const t = ctx.currentTime;
    const nodes = [];
    const bus = ctx.createGain(); bus.gain.value = gain; nodes.push(bus);
    let out = bus;
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); bus.connect(p); p.connect(master); nodes.push(p); } else bus.connect(master);
    const env = (g, peak, attack, decay) => { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay); };
    const tone = (freq, f2, dur, type, peak, attack = 0.004) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(freq * pitch, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2 * pitch, t + dur);
      env(g, peak, attack, dur); o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + attack + 0.02); nodes.push(o, g); return o;
    };
    const noise = (dur, type, f, q, peak, f2 = 0, attack = 0.004, color = 0.3) => {
      const s = this.noiseSource(dur + 0.05, false, color), fl = ctx.createBiquadFilter(), g = ctx.createGain();
      fl.type = type; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur); fl.Q.value = q;
      env(g, peak, attack, dur); s.connect(fl); fl.connect(g); g.connect(out); s.start(t); s.stop(t + dur + 0.06); nodes.push(s, fl, g); return s;
    };
    const metal = (partials, decay, peak) => partials.forEach(([f, k], i) => tone(f * (1 + 0.012 * i), 0, decay * (1 - i * 0.12), 'sine', peak * k, 0.002));
    switch (kind) {
      case 'swing': noise(0.2, 'bandpass', 700, 1.1, 0.3, 2600, 0.07); break;
      case 'swing_heavy': noise(0.3, 'bandpass', 380, 1.0, 0.4, 2100, 0.11); tone(110, 70, 0.25, 'sine', 0.12, 0.08); break;
      case 'hit': tone(130, 52, 0.14, 'sine', 0.55); noise(0.09, 'lowpass', 1500, 0.7, 0.32); noise(0.05, 'highpass', 2400, 0.5, 0.1); break;
      case 'hit_heavy': tone(95, 40, 0.22, 'sine', 0.75); noise(0.14, 'lowpass', 1100, 0.7, 0.42); metal([[620, 0.5], [1480, 0.3]], 0.18, 0.1); break;
      case 'clash': metal([[1250, 1], [2230, 0.7], [3170, 0.55], [4900, 0.3]], 0.5, 0.2); noise(0.04, 'highpass', 3200, 0.6, 0.18); break;
      case 'block': metal([[620, 1], [1480, 0.6], [2300, 0.35]], 0.3, 0.22); tone(150, 80, 0.1, 'sine', 0.3); break;
      case 'parry': metal([[1560, 1], [2780, 0.8], [3900, 0.6], [5600, 0.4]], 0.75, 0.24); noise(0.05, 'highpass', 3600, 0.6, 0.22); tone(3400, 3300, 0.5, 'sine', 0.07); break;
      case 'hurt': noise(0.22, 'bandpass', 650, 3.5, 0.28, 480); tone(150, 100, 0.2, 'sawtooth', 0.05); break;
      case 'die': noise(0.5, 'bandpass', 520, 3, 0.26, 260); tone(120, 60, 0.5, 'sawtooth', 0.06); tone(70, 38, 0.5, 'sine', 0.3); break;
      case 'bow_draw': noise(0.4, 'bandpass', 300, 2.2, 0.08, 900, 0.3, 0.5); break;
      case 'bow_release': tone(190, 80, 0.13, 'triangle', 0.4); noise(0.08, 'highpass', 1800, 0.6, 0.18); break;
      case 'arrow_hit': tone(170, 70, 0.1, 'sine', 0.45); noise(0.07, 'lowpass', 1400, 0.7, 0.3); break;
      case 'taiko': tone(95, 42, 0.38, 'sine', 0.7); noise(0.14, 'bandpass', 280, 1.2, 0.3); break;
      case 'bell': [[220, 1], [478, 0.5], [730, 0.4], [1031, 0.22], [1320, 0.15]].forEach(([f, k]) => tone(f, 0, 4.2 - k, 'sine', 0.16 * k, 0.012)); break;
      case 'alert': tone(520, 380, 0.16, 'square', 0.05); break;
      case 'step_grass': noise(0.09, 'lowpass', 620, 0.7, 0.06, 0, 0.01, 0.6); break;
      case 'step_dirt': noise(0.08, 'lowpass', 950, 0.8, 0.08, 0, 0.006, 0.4); break;
      case 'step_gravel': noise(0.12, 'highpass', 2200, 0.7, 0.07, 0, 0.004, 0.2); noise(0.07, 'lowpass', 700, 0.7, 0.05); break;
      case 'step_wood': noise(0.07, 'bandpass', 420, 1.6, 0.1, 0, 0.005); tone(120, 90, 0.07, 'sine', 0.1); break;
      case 'roll': noise(0.35, 'lowpass', 900, 0.7, 0.14, 300, 0.08, 0.5); break;
      case 'draw': noise(0.18, 'bandpass', 2400, 3, 0.1, 5200, 0.05); break;
      case 'sheathe': noise(0.2, 'bandpass', 3800, 3, 0.07, 2000, 0.04); tone(900, 600, 0.06, 'sine', 0.05); break;
      case 'ui': tone(740, 880, 0.08, 'sine', 0.08); break;
      case 'dialogue': tone(560, 0, 0.05, 'sine', 0.04); break;
      default: break;
    }
    const voice = { source: nodes.find(n => n.start), gain: bus, filter: null, extra: nodes };
    this.sources.set(voice.source || voice, voice);
    const finish = () => { for (const n of nodes) { try { n.disconnect(); } catch {} } this.sources.delete(voice.source || voice); };
    setTimeout(finish, kind === 'bell' ? 5200 : 1800);
    return true;
  }
}
