import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../dist/audio.js';

class FakeParam {
  constructor(value = 0) { this.value = value; this.automation = []; }
  record(method, value, time, timeConstant) { this.value = value; this.automation.push({ method, value, time, timeConstant }); }
  setValueAtTime(value, time) { this.record('set', value, time); }
  linearRampToValueAtTime(value, time) { this.record('linear', value, time); }
  exponentialRampToValueAtTime(value, time) { this.record('exponential', value, time); }
  setTargetAtTime(value, time, timeConstant) { this.record('target', value, time, timeConstant); }
}
class FakeNode {
  constructor(context, kind) { this.context = context; this.kind = kind; this.connections = []; this.disconnects = 0; context.nodes.push(this); }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.disconnects++; this.connections = []; }
}
class FakeSource extends FakeNode {
  constructor(context, kind) { super(context, kind); this.stopCalls = []; this.loop = false; if (kind === 'oscillator') this.frequency = new FakeParam(); }
  start() {
    if (this.context.failFeedbackStart && !this.loop) throw new Error('source start failed');
    this.started = true;
    this.context.maxActiveLoops = Math.max(this.context.maxActiveLoops, this.context.activeLoops.length);
  }
  stop(time) { this.stopCalls.push(time); if (time === undefined || time <= this.context.currentTime) this.stopped = true; }
}
class FakeContext {
  constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; this.sampleRate = 8000; this.created = []; this.nodes = []; this.maxActiveLoops = 0; }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  createGain() { const node = new FakeNode(this, 'gain'); node.gain = new FakeParam(1); return node; }
  createBiquadFilter() { const node = new FakeNode(this, 'filter'); node.frequency = new FakeParam(); node.Q = new FakeParam(); return node; }
  source(kind) { const source = new FakeSource(this, kind); this.created.push(source); return source; }
  createOscillator() { return this.source('oscillator'); }
  createBuffer(_channels, length) { const data = new Float32Array(length); return { getChannelData: () => data }; }
  createBufferSource() { return this.source('buffer'); }
  get activeLoops() { return this.created.filter(source => source.loop && source.started && !source.stopped && !source.disconnects); }
}
class DeferredContext extends FakeContext {
  constructor() { super(); this.pending = []; }
  request(kind) { return new Promise((resolve, reject) => this.pending.push({ kind, resolve, reject })); }
  resume() { return this.request('resume'); }
  suspend() { return this.request('suspend'); }
  complete(kind) {
    const index = this.pending.findIndex(operation => operation.kind === kind);
    assert.notEqual(index, -1, `no pending ${kind}`);
    const [operation] = this.pending.splice(index, 1);
    this.state = kind === 'resume' ? 'running' : 'suspended'; operation.resolve();
  }
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
async function drain(context) {
  for (let i = 0; i < 12; i++) { await flush(); if (!context.pending.length) return; context.complete(context.pending.at(-1).kind); }
  assert.fail('audio transitions did not converge');
}
async function withContext(Context, run) {
  const previous = globalThis.AudioContext; const previousWebkit = globalThis.webkitAudioContext;
  globalThis.AudioContext = Context; globalThis.webkitAudioContext = undefined;
  try { return await run(); } finally { globalThis.AudioContext = previous; globalThis.webkitAudioContext = previousWebkit; }
}
function assertReleased(nodes) {
  for (const node of nodes) { assert.equal(node.disconnects, 1, `${node.kind} must disconnect exactly once`); assert.equal(node.connections.length, 0); }
}

test('audio creates no context or ambient sources before an explicit gesture', async () => {
  let contexts = 0;
  await withContext(class extends FakeContext { constructor() { super(); contexts++; } }, async () => {
    const audio = new GameAudio(); audio.setPaused(false); audio.setMuted(false);
    audio.updateAmbient({ distanceToWater: 1, flowing: true });
    assert.equal(audio.context, null); assert.equal(contexts, 0); assert.equal(audio.play('pickup'), false);
    assert.equal(audio.state.ambientVoices, 0);
  });
});
test('unlock at title or while muted stays silent until playing is allowed', () => withContext(FakeContext, async () => {
  const audio = new GameAudio(); await audio.unlock();
  assert.equal(audio.state.contextState, 'suspended'); assert.equal(audio.state.ambientVoices, 0); assert.equal(audio.context.nodes.length, 0);
  audio.setMuted(true); audio.setPaused(false); await flush();
  assert.equal(audio.state.ambientVoices, 0); assert.equal(audio.context.created.length, 0);
  audio.setMuted(false); await flush();
  assert.equal(audio.state.contextState, 'running'); assert.equal(audio.state.ambientVoices, 2);
}));
test('gesture unlock, mute, pause and resume govern feedback and release nodes immediately', () => withContext(FakeContext, async () => {
  const audio = new GameAudio(); audio.setPaused(false); await audio.unlock();
  assert.equal(audio.play('pickup'), true); assert.equal(audio.sources.size, 1); assert.equal(audio.state.ambientVoices, 2);
  const nodes = [...audio.context.nodes]; const source = audio.context.created.find(node => !node.loop);
  audio.setPaused(true);
  assert.equal(source.stopped, true); assert.equal(audio.sources.size, 0); assert.equal(audio.state.ambientVoices, 0);
  assertReleased(nodes); assert.equal(audio.play('fill'), false); await flush(); assert.equal(audio.context.state, 'suspended');
  audio.setPaused(false); audio.setMuted(true); await flush();
  assert.equal(audio.play('deliver'), false); assert.equal(audio.context.state, 'suspended'); assert.equal(audio.state.ambientVoices, 0);
  audio.setMuted(false); await flush();
  assert.equal(audio.play('deliver'), true); assert.equal(audio.context.state, 'running'); assert.equal(audio.state.ambientVoices, 2);
  audio.setPaused(true);
}));
test('feedback voices stay bounded separately from ambient loops and ended voices release connections', () => withContext(FakeContext, async () => {
  const audio = new GameAudio(); audio.setPaused(false); await audio.unlock();
  for (let i = 0; i < 8; i++) assert.equal(audio.play('pickup'), true);
  assert.equal(audio.play('pickup'), false); assert.equal(audio.state.voices, 8); assert.equal(audio.state.ambientVoices, 2);
  const source = audio.context.created.find(node => !node.loop); const gain = source.connections[0]; const filter = gain.connections[0]; const ended = source.onended;
  ended(); ended(); assertReleased([source, gain, filter]);
  assert.equal(audio.sources.size, 7); assert.equal(audio.play('pickup'), true);
  audio.setPaused(true); assert.equal(audio.sources.size, 0); assert.equal(audio.state.ambientVoices, 0); assertReleased(audio.context.nodes);
}));
test('ambient updates and repeated mute/pause/resume never exceed two loops or retain stopped nodes', () => withContext(FakeContext, async () => {
  const audio = new GameAudio(); audio.setPaused(false); await audio.unlock();
  for (let i = 0; i < 12; i++) {
    audio.updateAmbient({ distanceToWater: i / 2, flowing: i > 3 }); audio.setPaused(false); await audio.unlock();
    assert.equal(audio.state.ambientVoices, 2); assert.equal(audio.context.activeLoops.length, 2);
    const nodes = [...audio.context.nodes]; const loops = [...audio.context.activeLoops];
    audio.setMuted(true); assert.equal(audio.state.ambientVoices, 0); assert.equal(audio.context.activeLoops.length, 0);
    assert.ok(loops.every(source => source.stopped)); assertReleased(nodes);
    audio.setMuted(false); await flush(); assert.equal(audio.state.ambientVoices, 2);
    audio.setPaused(true); assert.equal(audio.state.ambientVoices, 0); await flush();
    audio.setPaused(false); await flush();
  }
  audio.setPaused(true); assert.equal(audio.context.maxActiveLoops, 2); assertReleased(audio.context.nodes);
}));
test('water gain changes smoothly with distance and restored flow without recreating loops', () => withContext(FakeContext, async () => {
  const audio = new GameAudio(); audio.setPaused(false); audio.updateAmbient({ distanceToWater: 1, flowing: false }); await audio.unlock();
  const water = audio.context.created.filter(source => source.loop)[1]; const gain = water.connections[0].gain;
  const blocked = gain.value; const sourceCount = audio.context.created.length;
  audio.updateAmbient({ distanceToWater: 1, flowing: true }); const near = gain.value;
  audio.updateAmbient({ distanceToWater: 20, flowing: true }); const far = gain.value;
  assert.ok(near > blocked && near > far && far >= 0); assert.ok(near < .1);
  assert.equal(audio.context.created.length, sourceCount);
  assert.ok(gain.automation.filter(event => event.method === 'target').every(event => event.timeConstant > 0));
  assert.ok(gain.automation.filter(event => event.method === 'target').length >= 3);
  audio.updateAmbient({ distanceToWater: NaN, flowing: false }); assert.ok(Number.isFinite(gain.value) && gain.value >= 0);
  audio.setPaused(true);
}));
test('pending resume creates no sources until allowed, and mute releases them before suspend completes', () => withContext(DeferredContext, async () => {
  const audio = new GameAudio(); audio.setPaused(false); const unlocking = audio.unlock(); const context = audio.context;
  assert.equal(audio.state.ambientVoices, 0); assert.equal(context.created.length, 0);
  context.complete('resume'); await unlocking; assert.equal(audio.state.ambientVoices, 2);
  audio.setMuted(true); assert.equal(audio.state.ambientVoices, 0); assertReleased(context.nodes);
  assert.equal(context.state, 'running'); await drain(context); assert.equal(context.state, 'suspended');
}));
for (const stop of ['pause', 'mute']) {
  test(`late resume after ${stop} converges to suspended even when suspend completes first`, () => withContext(DeferredContext, async () => {
    const audio = new GameAudio(); await audio.unlock(); const context = audio.context;
    audio.setPaused(false);
    if (stop === 'pause') audio.setPaused(true); else audio.setMuted(true);
    context.complete('suspend'); await flush(); context.complete('resume'); await flush();
    assert.equal(context.created.length, 0); await drain(context);
    assert.equal(context.state, 'suspended'); assert.equal(audio.state.voices, 0); assert.equal(audio.state.ambientVoices, 0);
  }));
}
test('late suspend after a newer resume converges to running without duplicating ambient sources', () => withContext(DeferredContext, async () => {
  const audio = new GameAudio(); await audio.unlock(); const context = audio.context;
  audio.setPaused(false); context.complete('resume'); await flush(); assert.equal(audio.state.ambientVoices, 2);
  const previousNodes = [...context.nodes]; audio.setPaused(true); assertReleased(previousNodes); audio.setPaused(false);
  context.complete('resume'); await flush(); context.complete('suspend'); await drain(context);
  assert.equal(audio.state.paused, false); assert.equal(context.state, 'running'); assert.equal(audio.state.ambientVoices, 2); assert.equal(context.maxActiveLoops, 2);
  audio.setPaused(true); await drain(context); assertReleased(context.nodes);
}));
test('rapid mixed intent changes converge after reversed asynchronous completions', () => withContext(DeferredContext, async () => {
  const audio = new GameAudio(); await audio.unlock(); const context = audio.context;
  for (let i = 0; i < 8; i++) {
    audio.setPaused(false); audio.setMuted(true); audio.setPaused(true); audio.setMuted(false); audio.setPaused(false);
    await drain(context); assert.equal(context.state, 'running'); assert.equal(audio.state.ambientVoices, 2);
    audio.setPaused(true); audio.setMuted(true); await drain(context);
    assert.equal(context.state, 'suspended'); assert.equal(audio.state.ambientVoices, 0); assertReleased(context.nodes);
    audio.setMuted(false);
  }
  assert.equal(context.maxActiveLoops, 2);
}));
test('failed feedback source creation releases partial nodes and keeps the game usable', () => withContext(FakeContext, async () => {
  const audio = new GameAudio(); audio.setPaused(false); await audio.unlock(); const previous = audio.context.nodes.length;
  audio.context.failFeedbackStart = true; assert.equal(audio.play('pickup'), false); assert.equal(audio.state.voices, 0);
  assertReleased(audio.context.nodes.slice(previous));
  audio.context.failFeedbackStart = false; assert.equal(audio.play('pickup'), true);
  audio.setPaused(true); assertReleased(audio.context.nodes);
}));
test('unavailable audio reports once and does not prevent play', () => withContext(undefined, async () => {
  const notices = []; const audio = new GameAudio(notice => notices.push(notice)); await audio.unlock(); await audio.unlock();
  assert.equal(notices.length, 1); assert.equal(audio.play('pickup'), false); assert.equal(audio.state.ambientVoices, 0);
}));
test('rejected resumes notify once, schedule no loops and leave the session usable', () => withContext(class extends FakeContext {
  async resume() { throw new DOMException('User gesture required', 'NotAllowedError'); }
}, async () => {
  const notices = []; const audio = new GameAudio(notice => notices.push(notice)); await audio.unlock(); audio.setPaused(false); await flush();
  assert.equal(notices.length, 1); assert.equal(audio.play('pickup'), false); assert.equal(audio.state.ambientVoices, 0); assert.equal(audio.context.created.length, 0);
  audio.setPaused(false); await flush(); assert.equal(notices.length, 1);
}));
