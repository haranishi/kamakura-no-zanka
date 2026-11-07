import test from 'node:test';
import assert from 'node:assert/strict';
import { KamakuraAudio, waveEnvelope, seaNear, SEA_AUDIO } from '../dist/valley/kamakura-sea-audio.js';
import { createKamakuraAudio } from '../dist/valley/kamakura-audio-view.js';
import { FakeContext, Button, flush } from './helpers/kamakura-audio.mjs';
import { ValleyAudio } from '../dist/valley/audio-valley.js';
test('seeded wave envelope stays bounded, varies in 6.8–9.8 s periods and three-wave sets', () => {
  let previous = 0, current = 0, lastPeak = null, peaks = 0, different = false;
  for (let i = 0; i < 100000; i++) {
    const t = i / 100, next = waveEnvelope(t, 1333);
    assert(next >= 0 && next <= 1); assert.equal(next, waveEnvelope(t, 1333));
    different ||= next !== waveEnvelope(t, 42);
    if (current > previous && current > next) {
      if (lastPeak !== null) assert(t - lastPeak >= 6.78 && t - lastPeak <= 9.82);
      lastPeak = t; peaks++;
    }
    previous = current; current = next;
  }
  assert(peaks > 100 && different); assert.equal(waveEnvelope(Infinity), 0); assert.equal(waveEnvelope(-1), 0);
});
async function withContext(fn) {
  const old = globalThis.AudioContext; globalThis.AudioContext = FakeContext;
  try { await fn(); } finally { globalThis.AudioContext = old; }
}
function setup(search = '') {
  const target = new EventTarget(), button = new Button(); let distance = 10;
  const c = createKamakuraAudio({ target, button, search, storage: () => null,
    terrain: { riverDistanceAt: () => 14, seaDistanceAt: () => distance } });
  return { c, target, button, distance: d => { distance = d; } };
}
test('sea distance gain, 10Hz smoothing, three synthesis layers and unchanged valley targets', () => withContext(async () => {
  const { c, target, distance } = setup();
  c.update(.1, { x: 0, z: 0 }); assert.equal(c.audio.context, null);
  target.dispatchEvent(new Event('click')); await flush();
  const ctx = c.audio.context, voice = c.audio.ambient.get('sea'); assert(voice);
  assert.equal(voice.children.length, 2); assert(voice.children.every(n => n.started && n.loop));
  assert.deepEqual(voice.nodes.filter(n => n.type).map(n => [n.type, n.frequency.value]), [['lowpass', 500], ['highpass', 1800], ['bandpass', 3400]]);
  const targets = [], envelope = [];
  voice.gain.gain.setTargetAtTime = (...args) => targets.push(args);
  voice.swell.gain.setTargetAtTime = (...args) => envelope.push(args);
  for (const d of [0, 10, 45, 100, 300, 600, 601, Infinity]) {
    distance(d); ctx.currentTime = 4;
    c.update(.1, { x: 0, z: 0 });
    assert.equal(c.state.seaGain, SEA_AUDIO.gain * seaNear(d));
    assert.equal(targets.at(-1)[2], .25);
  }
  assert(targets.every((v, i) => !i || v[0] <= targets[i - 1][0])); assert.equal(targets.at(-1)[0], 0);
  const count = targets.length;
  for (let i = 0; i < 60; i++) c.update(1 / 60, { x: 0, z: 0 });
  assert.equal(targets.length - count, 10); assert.equal(envelope.at(-1)[0], .85 * waveEnvelope(4));
  assert.equal(voice.foam.gain.value, .5 * waveEnvelope(3.1) ** 3); assert.equal(voice.rumble.gain.value, .12);
  const valley = new ValleyAudio(); valley.context = new FakeContext(); valley.context.state = 'running'; valley.paused = false;
  valley.updateListener({ river: 14, fire: Infinity });
  for (const kind of ['wind', 'river', 'fire']) assert.equal(c.audio.ambient.get(kind).gain.gain.value, valley.ambient.get(kind).gain.gain.value);
  valley.stopAmbient();
  distance(10); c.update(.1, { x: 0, z: 0 }); assert.match(c.debugText(), /海 10m・波on/);
  distance(1000); c.update(.1, { x: 0, z: 0 }); assert.match(c.debugText(), /海 −・波off/);
  const nodes = [...voice.nodes]; c.dispose(); assert(nodes.every(n => n.connections.length === 0)); assert(voice.children.length === 0);
  assert(ctx.nodes.every(n => n.connections.length === 0));
}));
test('pause/mute stop all sea nodes, resume restores; quality does not recreate surf', () => withContext(async () => {
  const { c, target, button } = setup('?q=light'); c.update(.1, { x: 0, z: 0 });
  target.dispatchEvent(new Event('keydown')); await flush();
  const v = c.audio.ambient.get('sea'), children = [...v.children];
  for (let i = 0; i < 30; i++) c.update(.1, { x: 0, z: 0 });
  assert.equal(c.audio.ambient.get('sea'), v);
  c.setPaused(true); await flush(); assert(children.every(n => n.stopped)); assert(!c.audio.ambient.has('sea')); assert.match(c.debugText(), /波off/);
  c.setPaused(false); await flush(); assert(c.audio.ambient.has('sea'));
  button.dispatchEvent(new Event('click')); await flush(); assert(!c.audio.ambient.has('sea'));
  button.dispatchEvent(new Event('click')); await flush(); assert(c.audio.ambient.has('sea')); c.dispose();
}));
test('sea=0 and audio=0 never construct sea; initial mute remains silent', () => withContext(async () => {
  for (const search of ['?sea=0', '?audio=0', '?mute=1']) {
    const { c, target } = setup(search); target.dispatchEvent(new Event('click')); await flush();
    c.update(.1, { x: 0, z: 0 }); assert(!c.audio.ambient?.has('sea'));
    if (search === '?audio=0') assert.equal(c.audio.context, undefined);
    c.dispose();
  }
}));
test('partial sea creation failure stops and disconnects every acquired node', () => withContext(async () => {
  const a = new KamakuraAudio(); a.context = new FakeContext(); a.context.state = 'running'; a.paused = false;
  const noise = a.noiseSource.bind(a); let calls = 0;
  a.noiseSource = (...args) => { if (++calls === 5) throw Error('synthetic foam failure'); return noise(...args); };
  a.startAmbient();
  assert(a.ambientFailed); assert.equal(a.ambient.size, 0); assert(a.context.nodes.filter(n => n.buffer).every(n => n.stopped));
  const masterNodes = [a.master, a.comp, a.limiter];
  assert(a.context.nodes.filter(n => !masterNodes.includes(n)).every(n => n.connections.length === 0));
}));

test('seagain scales the surf level (default 1, bad values fall back, capped at 8)', () => {
  assert.equal(new KamakuraAudio(() => {}).seaScale, 1);
  assert.equal(new KamakuraAudio(() => {}, { gainScale: 2 }).seaScale, 2);
  for (const bad of [NaN, 0, -3, Infinity]) assert.equal(new KamakuraAudio(() => {}, { gainScale: bad }).seaScale, 1);
  assert.equal(new KamakuraAudio(() => {}, { gainScale: 100 }).seaScale, 8);
});
