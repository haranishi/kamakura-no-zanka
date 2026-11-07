// Small WebAudio double; shipped ValleyAudio still creates all synthesis nodes.
class Param {
  constructor() { this.value = 0; }
  setValueAtTime(v) { this.value = v; }
  setTargetAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
  exponentialRampToValueAtTime(v) { this.value = v; }
}
export class FakeContext {
  constructor() { this.state = 'suspended'; this.sampleRate = 8000; this.currentTime = 0; this.destination = {}; this.nodes = []; this.closes = 0; }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.closes++; this.state = 'closed'; }
  node() {
    const n = { connections: [], connect(to) { this.connections.push(to); }, disconnect() { this.connections = []; },
      start() { this.started = true; }, stop(t) { if (t === undefined) this.stopped = true; } };
    for (const k of ['gain', 'frequency', 'Q', 'pan', 'threshold', 'ratio', 'attack', 'release', 'knee']) n[k] = new Param();
    this.nodes.push(n); return n;
  }
  createGain() { return this.node(); }
  createBiquadFilter() { return this.node(); }
  createDynamicsCompressor() { return this.node(); }
  createStereoPanner() { return this.node(); }
  createBufferSource() { return this.node(); }
  createOscillator() { return this.node(); }
  createBuffer(_channels, length) { const data = new Float32Array(length); return { getChannelData: () => data }; }
}
export class Button extends EventTarget {
  constructor() { super(); this.attributes = {}; }
  setAttribute(k, v) { this.attributes[k] = v; }
}
export const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
