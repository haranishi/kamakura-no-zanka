import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createKamakuraSoundscape } from '../dist/valley/kamakura-soundscape-view.js';
import { VOICE_NAMES } from '../dist/valley/kamakura-voices.js';
import { FakeContext } from './helpers/kamakura-audio.mjs';

class SoundContext extends FakeContext {
  constructor() { super(); this.state = 'running'; this.sampleRate = 48000; this.buffers = []; }
  node() {
    const n = super.node(); n.disconnections = 0; n.starts = []; n.stops = [];
    n.disconnect = () => { n.disconnections++; n.connections.length = 0; };
    n.start = t => { n.starts.push(t); n.started = true; };
    n.stop = t => { if (!n.started) throw Error('stop before start'); n.stops.push(t); if (t === undefined) n.stopped = true; };
    return n;
  }
  createBuffer(channels, length, rate) {
    const data = new Float32Array(length), b = { length, sampleRate: rate, numberOfChannels: channels, getChannelData: () => data };
    this.buffers.push(b); return b;
  }
  createBufferSource() { const n = this.node(); n.kind = 'source'; return n; }
}
function fixture(search = '?debug=1&soundtest=higurashi', { locked = false, weights = { forest: 1 }, quality = 'standard', mix10 = true } = {}) {
  const ctx = new SoundContext(); let life = null, habitatReads = 0;
  const audio = { context: locked ? null : ctx, mix10, paused: false, muted: false, listening: { received: true },
    ensureBuses() { if (!life) life = ctx.createGain(); return { life }; } };
  const context = { search, quality, audioView: { audio }, terrain: { heightAt: () => 0 }, lifeEvents: [],
    habitat: { at(_x, _z, out) { habitatReads++; for (const k of Object.keys(out)) out[k] = weights[k] || 0; },
      nearestPlace: () => ({ name: 'Synthetic temple', x: 30, z: 40, distance: 50 }) } };
  const layer = createKamakuraSoundscape(context);
  const frame = { dt: 1 / 60, pos: { x: 0, y: 1.7, z: 0 }, yaw: 0, flying: false, time: 0, windDir: [1, 0] };
  return { audio, ctx, context, layer, frame, weights, get life() { return life; }, get habitatReads() { return habitatReads; },
    advance(seconds, hz = 60) {
      frame.dt = 1 / hz;
      for (let i = 0; i < Math.round(seconds * hz); i++) { ctx.currentTime += frame.dt; frame.time += frame.dt; layer.update(frame); }
    },
    debug: () => globalThis.__kzSoundscape(),
    sources: () => ctx.nodes.filter(n => n.kind === 'source'),
    active: () => ctx.nodes.filter(n => n.kind === 'source' && n.connections.length),
    connected: () => ctx.nodes.filter(n => n !== life && n.connections.length) };
}
test('off flags return null; old mix stays instantiated but silent; 1000 locked/paused/muted/unreceived frames allocate zero nodes', () => {
  for (const search of ['?soundscape=0', '?audio=0']) assert.equal(createKamakuraSoundscape({ search }), null);
  for (const mode of ['locked', 'paused', 'muted', 'received', 'mix']) {
    const f = fixture('?debug=1&soundtest=higurashi', { locked: mode === 'locked', mix10: mode !== 'mix' });
    if (mode === 'paused') f.audio.paused = true;
    if (mode === 'muted') f.audio.muted = true;
    if (mode === 'received') f.audio.listening.received = false;
    for (let i = 0; i < 1000; i++) f.layer.update(f.frame);
    assert.equal(f.ctx.nodes.length, 0); assert.equal(f.debug().time, 0); assert.equal(f.habitatReads, 0); f.layer.dispose();
  }
});
test('unlock starts a fresh 1.5s quiet period, only higurashi uses the life bus, retriggers each 3s with four live nodes', () => {
  const f = fixture(undefined, { locked: true });
  f.advance(20); assert.equal(f.ctx.nodes.length, 0);
  f.audio.context = f.ctx; f.advance(1.4); assert.equal(f.sources().length, 0);
  f.advance(.1); assert.equal(f.sources().length, 1); assert.equal(f.debug().playing[0].name, 'higurashi');
  assert.equal(f.connected().length, 4); assert.equal(f.active().length, 1);
  const first = f.sources()[0], direct = f.ctx.nodes.filter(n => n.connections.includes(f.life)); assert.equal(direct.length, 1);
  assert.equal(f.debug().playing[0].z, -12);
  f.advance(3); assert.equal(f.sources().length, 2); assert(first.stopped); assert.equal(first.disconnections, 1); assert.equal(first.buffer, null);
  assert.equal(f.connected().length, 4); assert.equal(f.debug().playing.length, 1);
  f.layer.dispose(); f.layer.dispose(); assert.equal(f.connected().length, 0); assert.equal(globalThis.__kzSoundscape, undefined);
  assert(f.ctx.nodes.every(n => n === f.life || n.disconnections === 1));
});
test('pause, native audio pause, mute and suspended context stop voices, freeze schedules and dispose every acquired node once', () => {
  for (const mode of ['layer', 'paused', 'muted', 'suspended']) {
    const f = fixture(); f.advance(1.6); assert.equal(f.active().length, 1);
    if (mode === 'layer') f.layer.setPaused(true);
    else if (mode === 'suspended') f.ctx.state = 'suspended';
    else f.audio[mode] = true;
    f.advance(.1); assert.equal(f.active().length, 0); assert.equal(f.connected().length, 0);
    const time = f.debug().time, count = f.ctx.nodes.length;
    f.advance(30); assert.equal(f.debug().time, time); assert.equal(f.ctx.nodes.length, count);
    if (mode === 'layer') f.layer.setPaused(false);
    else if (mode === 'suspended') f.ctx.state = 'running';
    else f.audio[mode] = false;
    f.advance(1.4); assert.equal(f.active().length, 0); f.advance(.1); assert.equal(f.active().length, 1);
    f.layer.dispose(); assert.equal(f.connected().length, 0); assert(f.ctx.nodes.every(n => n === f.life || n.disconnections === 1));
  }
  const f = fixture('?debug=1'); f.advance(3);
  const before = f.debug(); f.audio.muted = true; f.advance(30);
  assert.equal(f.debug().time, before.time);
  for (const name of VOICE_NAMES) assert.equal(f.debug().next[name], before.next[name]);
  f.audio.muted = false; f.advance(.1);
  for (const name of VOICE_NAMES) assert.equal(f.debug().next[name], before.next[name]);
  f.layer.dispose();
});
test('soundtest all visits all ten names in order; overlapping tails are bounded and complete in audio time without setTimeout', () => {
  const f = fixture('?debug=1&soundtest=all'), names = [];
  for (let i = 0; i < 10; i++) {
    f.advance(i ? 3 : 1.5);
    names.push(f.debug().playing.reduce((latest, v) => v.id > latest.id ? v : latest, { id: -1 }).name);
    assert(f.active().length <= 7); assert(f.connected().length <= 28);
  }
  assert.equal(f.sources().length, 10);
  assert.equal(f.ctx.buffers.length, 10); assert.equal(f.debug().playing.filter(v => v.name === 'kane').length, 1);
  assert.deepEqual(names, VOICE_NAMES);
  const source = f.active()[0], callback = source.onended; callback(); assert.equal(source.connections.length, 0);
  assert.equal(source.buffer, null); assert.equal(source.disconnections, 1);
  f.layer.dispose(); assert.equal(f.connected().length, 0);
});
test('position and camera changes preserve world anchors/pan, then teleport silences for 1.5s; high flight keeps birds/bell quietly', () => {
  const f = fixture('?debug=1&soundtest=tobi'); f.advance(1.5);
  const anchor = f.debug().playing[0], pan = f.ctx.nodes.find(n => n !== f.life && n.pan && n.connections.includes(f.life));
  f.frame.pos.x = -5; f.advance(.1); assert(pan.pan.value > 0); assert.equal(f.debug().playing[0].x, anchor.x);
  f.frame.yaw = Math.PI; f.advance(.1); assert(pan.pan.value < 0);
  f.frame.pos.x = 100; f.advance(.1); assert.equal(f.active().length, 0);
  f.advance(1.4); assert.equal(f.active().length, 0); f.advance(.1); assert.equal(f.active().length, 1); f.layer.dispose();
  const g = fixture('?debug=1', { weights: { forest: 1, town: 1, meadow: 1, paddy: 1, temple: 1 } });
  g.frame.flying = true; g.frame.pos.y = 80; g.advance(100);
  for (const v of g.debug().playing) assert(['uguisu', 'tobi', 'suzume', 'karasu', 'kane'].includes(v.name));
  g.layer.dispose();
});
test('flock events are optional, consumed at their world position, respect caps, and never replay after mute', () => {
  const f = fixture('?debug=1'); delete f.context.lifeEvents; f.advance(2);
  f.context.lifeEvents = [{ type: 'other' }, { type: 'flockBurst', x: 8, y: 3, z: -6 }]; f.advance(.1);
  const v = f.debug().playing.find(s => s.name === 'flockBurst'); assert(v); assert.equal(v.x, 8); assert.equal(v.z, -6);
  assert.equal(f.context.lifeEvents.length, 1); assert.equal(f.context.lifeEvents[0].type, 'other');
  f.audio.muted = true; f.context.lifeEvents.push({ type: 'flockBurst', x: 8, y: 3, z: -6 }); f.advance(.1);
  assert.equal(f.context.lifeEvents.length, 1); assert.equal(f.active().length, 0); f.layer.dispose();
});
test('audio-clock cleanup, quality/adapt caps, habitat read cadence and failing partial node allocation', () => {
  const f = fixture('?debug=1', { weights: { forest: 1, town: 1, meadow: 1, paddy: 1, temple: 1, river: 1 } });
  f.advance(90); assert(f.habitatReads <= 181); f.layer.setAdapt(3); assert(f.active().length <= 4);
  f.layer.dispose();
  const g = fixture('?debug=1&soundtest=suzume'); g.advance(1.5); assert.equal(g.active().length, 1);
  g.ctx.currentTime += 2; g.advance(.1); assert.equal(g.active().length, 0); assert.equal(g.connected().length, 0); g.layer.dispose();
  for (const fail of ['createBufferSource', 'createGain', 'createBiquadFilter', 'createStereoPanner']) {
    const h = fixture(); h.ctx[fail] = () => { throw Error(`synthetic ${fail} failure`); };
    assert.throws(() => h.advance(1.5), /synthetic/); h.layer.dispose(); assert.equal(h.connected().length, 0);
  }
});
test('frame values are copied as scalars, hot frame branch creates no objects, no timers or external dependencies', () => {
  const source = readFileSync(new URL('../dist/valley/kamakura-soundscape-view.js', import.meta.url), 'utf8');
  const hot = source.split('update(frame) {')[1].split('const dt = elapsed')[0];
  assert.doesNotMatch(hot, /\bnew\b|\.\.\.|=\s*\[|=\s*\{|=\s*frame\s*[;,]/);
  assert.doesNotMatch(source, /setTimeout|setInterval|fetch\(|https?:/);
  const f = fixture(); f.advance(1.5); const x = f.debug().playing[0].x;
  f.frame.pos.x = 300; assert.equal(f.debug().playing[0].x, x); f.layer.dispose();
});
