import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../dist/audio.js';

class FakeContext {
  constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; this.sampleRate = 8000; this.created = []; }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  createBiquadFilter() { return { frequency: {}, connect() {}, disconnect() {} }; }
  source() { const s = { connect() {}, disconnect() {}, start() {}, stop() { this.stopped = true; }, frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; this.created.push(s); return s; }
  createOscillator() { return this.source(); }
  createBuffer() { return { getChannelData: () => new Float32Array(8000) }; }
  createBufferSource() { return this.source(); }
}

test('audio is silent and creates no context before an explicit gesture', () => {
  const audio = new GameAudio(); audio.setPaused(false);
  assert.equal(audio.context, null); assert.equal(audio.play('pickup'), false);
});
test('gesture unlock, mute, pause and resume govern actual scheduled sources', async () => {
  const original = globalThis.AudioContext; globalThis.AudioContext = FakeContext;
  try {
    const audio = new GameAudio(); audio.setPaused(false); await audio.unlock();
    assert.equal(audio.play('pickup'), true); assert.equal(audio.sources.size, 1);
    const source = audio.context.created[0]; audio.setPaused(true);
    assert.equal(source.stopped, true); assert.equal(audio.sources.size, 0); assert.equal(audio.context.state, 'suspended'); assert.equal(audio.play('fill'), false);
    audio.setPaused(false); audio.setMuted(true); assert.equal(audio.play('deliver'), false); assert.equal(audio.context.state, 'suspended');
    audio.setMuted(false); assert.equal(audio.play('deliver'), true); assert.equal(audio.context.state, 'running');
  } finally { globalThis.AudioContext = original; }
});
test('feedback voices are bounded, and ended voices release connections', async () => {
  const original = globalThis.AudioContext; globalThis.AudioContext = FakeContext;
  try {
    const audio = new GameAudio(); audio.setPaused(false); await audio.unlock();
    for (let i = 0; i < 8; i++) assert.equal(audio.play('pickup'), true);
    assert.equal(audio.play('pickup'), false); assert.equal(audio.sources.size, 8);
    audio.context.created[0].onended(); assert.equal(audio.sources.size, 7); assert.equal(audio.play('pickup'), true);
    audio.setPaused(true); assert.equal(audio.sources.size, 0);
  } finally { globalThis.AudioContext = original; }
});
test('unavailable audio reports once and does not prevent play', async () => {
  const original = globalThis.AudioContext; globalThis.AudioContext = undefined;
  try { const notices = []; const audio = new GameAudio(n => notices.push(n)); await audio.unlock(); await audio.unlock(); assert.equal(notices.length, 1); assert.equal(audio.play('pickup'), false); }
  finally { globalThis.AudioContext = original; }
});
test('a rejected resume after unlock notifies once and leaves the session usable', async () => {
  const original = globalThis.AudioContext;
  class RefusingContext extends FakeContext { async resume() { throw new DOMException('User gesture required', 'NotAllowedError'); } }
  globalThis.AudioContext = RefusingContext;
  try {
    const notices = []; const audio = new GameAudio(n => notices.push(n));
    await audio.unlock(); audio.setPaused(false); await Promise.resolve(); await Promise.resolve();
    assert.equal(notices.length, 1); assert.equal(audio.play('pickup'), false);
    audio.setPaused(false); await Promise.resolve(); await Promise.resolve(); assert.equal(notices.length, 1);
  } finally { globalThis.AudioContext = original; }
});
