import test from 'node:test';
import assert from 'node:assert/strict';
import { kamakuraStepSurface, kamakuraStepLayers } from '../dist/valley/kamakura-step-rules.js';
import { STEP_PEAK_CEILING } from '../dist/valley/kamakura-step-audio.js';
import { createKamakuraAudio } from '../dist/valley/kamakura-audio-view.js';
import { KamakuraAudio } from '../dist/valley/kamakura-sea-audio.js';
import { ValleyAudio } from '../dist/valley/audio-valley.js';
import { pickStep } from '../dist/valley/audio-rules.js';
import { mulberry32 } from '../dist/valley/scatter.js';
import { surfaceWeights } from '../dist/valley/kamakura-surface.js';
import { FakeContext, flush } from './helpers/kamakura-audio.mjs';
// Record actual node types, AudioParam automation and audio-clock scheduling.
class RecordingContext extends FakeContext {
  constructor() { super(); this.sampleRate = 48000; }
  node() {
    const n = super.node();
    n.starts = []; n.stops = [];
    n.start = (...a) => n.starts.push(a); n.stop = (...a) => n.stops.push(a);
    for (const key of ['gain', 'frequency', 'pan']) {
      const p = n[key]; p.events = [];
      for (const method of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime']) {
        p[method] = (value, time) => { p.value = value; p.events.push({ method, value, time }); };
      }
    }
    return n;
  }
  createOscillator() { const n = this.node(); n.kind = 'oscillator'; return n; }
  createBufferSource() { const n = this.node(); n.kind = 'buffer'; return n; }
  createBiquadFilter() { const n = this.node(); n.kind = 'filter'; return n; }
  createStereoPanner() { const n = this.node(); n.kind = 'panner'; return n; }
}
const recipe = (surface, gait = 'walk', seed = 123) => pickStep({ surface, gait, role: 'hero', foot: 'left' }, mulberry32(seed));
function audio() {
  const a = new KamakuraAudio(() => {}, { steps9: true });
  a.context = new RecordingContext(); a.context.state = 'running'; a.paused = a.muted = false;
  return a;
}
const fingerprint = ctx => ctx.nodes.map(n => ({ kind: n.kind, type: n.type, freq: n.frequency.events, starts: n.starts, stops: n.stops, pan: n.pan.value, gain: n.gain.events }));

test('SO2 pure density threshold, continuous monotone blend, river and hard material priority', () => {
  const weights = surfaceWeights(2);
  let last = -1;
  for (let i = 0; i <= 1000; i++) {
    const d = i / 1000, p = kamakuraStepSurface(weights, { density: d });
    assert.equal(p.surface, d >= .35 ? 'grass' : 'dirt');
    assert(p.grassMix >= last && p.grassMix <= 1); last = p.grassMix;
    assert.equal(kamakuraStepSurface(weights, { density: d, water: .4 }).surface, 'water');
  }
  for (const [d, expected] of [[.2, 0], [.35, .5], [.5, 1]]) assert(Math.abs(kamakuraStepSurface(weights, { density: d }).grassMix - expected) < 1e-12);
  for (const [code, expected] of [[0, 'gravel'], [1, 'water'], [3, 'leaves'], [5, 'stone']]) assert.equal(kamakuraStepSurface(surfaceWeights(code), { density: 0 }).surface, expected);
  assert.equal(kamakuraStepSurface(weights, { wood: true }).surface, 'wood');
  assert.throws(() => kamakuraStepSurface(weights, { density: NaN }));
});

test('SO1 real scheduled nodes: water thud, splash and 2–4 spaced spatial droplets; running is longer/louder/more', () => {
  for (const gait of ['walk', 'run']) {
    const a = audio(), step = recipe('water', gait), plan = kamakuraStepLayers(step);
    assert(a.playStep(step));
    const nodes = a.context.nodes, tones = nodes.filter(n => n.kind === 'oscillator');
    const thud = tones[0], drops = tones.filter(n => n.frequency.events[0].value >= 2000), splash = plan.find(l => l.kind === 'splash');
    assert(thud.frequency.events[0].value >= 150 && thud.frequency.events[0].value <= 400);
    assert(Math.abs(thud.stops[0][0] - .064) < 1e-9);
    assert(drops.length >= 2 && drops.length <= 4);
    assert.equal(drops.length, gait === 'run' ? 4 : plan.filter(l => l.kind === 'drop').length);
    assert(splash.durationMs >= 200 && splash.durationMs <= 350);
    assert(nodes.some(n => n.kind === 'filter' && n.type === 'bandpass' && n.frequency.value >= 800 && n.frequency.value <= 4000));
    for (const n of drops) {
      assert(n.starts[0][0] >= .08 && n.starts[0][0] <= .3);
      assert(n.frequency.events[0].value >= 2000 && n.frequency.events[0].value <= 5000);
    }
    assert(new Set(nodes.filter(n => n.kind === 'panner').map(n => n.pan.value)).size >= 3);
    const same = audio(); same.playStep(step); assert.equal(JSON.stringify(fingerprint(a.context)), JSON.stringify(fingerprint(same.context)));
    const different = audio(); different.playStep(recipe('water', gait, 124)); assert.notEqual(JSON.stringify(fingerprint(a.context)), JSON.stringify(fingerprint(different.context)));
  }
  const walk = kamakuraStepLayers(recipe('water')), run = kamakuraStepLayers(recipe('water', 'run'));
  assert(run.find(l => l.kind === 'splash').durationMs > walk.find(l => l.kind === 'splash').durationMs);
  assert(run.reduce((n,l) => n+l.gain, 0) > walk.reduce((n,l) => n+l.gain, 0));
  const effectiveSplash = gait => {
    const a = audio(); a.playStep(recipe('water', gait));
    const v = [...a.sources.values()][0];
    const peak = Math.max(...v.stepNodes.flatMap(n => n.gain.events.map(e => e.method === 'linearRampToValueAtTime' ? e.value : 0)));
    return peak * v.gain.gain.value;
  };
  assert(effectiveSplash('run') > effectiveSplash('walk') * 1.2);
});

test('SO2 grass rustle nodes differ from dirt and interpolate without losing the thud/sand', () => {
  const a = audio(); a.grassMix = 1; a.playStep(recipe('grass'));
  const b = audio(); b.grassMix = 0; b.playStep(recipe('dirt'));
  assert.notEqual(JSON.stringify(fingerprint(a.context)), JSON.stringify(fingerprint(b.context)));
  for (const gait of ['walk', 'run']) {
    const plan = kamakuraStepLayers(recipe('grass', gait), .5), rustle = plan.find(l => l.kind === 'rustle');
    assert(rustle.freq >= 2000 && rustle.freq <= 6000); assert(rustle.durationMs >= 120 && rustle.durationMs <= 220);
    assert(plan.some(l => l.kind === 'cloth')); assert(plan.some(l => l.kind === 'equipment')); assert(plan.some(l => l.kind === 'weight'));
    assert(plan.find(l => l.kind === 'sand').gain > 0); assert(plan.find(l => l.kind === 'thud').gain > 0);
  }
});

test('SO3 aggregate conservative peak stays below -6dBFS for 28 voices, releases and stops every node', () => {
  const a = audio();
  for (let i = 0; i < 28; i++) {
    assert(a.playStep(recipe(i % 2 ? 'water' : 'grass', 'run', i)));
    const bound = [...a.sources.values()].reduce((s,v) => s + v.stepPeakBound * v.gain.gain.value, 0);
    assert(bound <= STEP_PEAK_CEILING + 1e-12); assert(bound <= 10 ** (-6 / 20));
  }
  assert.equal(a.playStep(recipe('water')), false); assert.equal(a.stepRejectReason, 'limit');
  const first = [...a.sources.values()][0]; first.source.onended(); assert.equal(a.sources.size, 27);
  a.setPaused(true); assert.equal(a.sources.size, 0);
  assert(a.context.nodes.every(n => n.connections.length === 0 || [a.master, a.comp, a.limiter].includes(n)));
  const count = a.context.nodes.length; assert.equal(a.playStep(recipe('water')), false); assert.equal(a.context.nodes.length, count);
});

test('steps9=0 preserves inherited synthesis nodes exactly, including other surfaces', () => {
  for (const surface of ['water', 'grass', 'dirt', 'gravel', 'leaves', 'stone', 'wood']) {
    const a = audio(); a.steps9 = false;
    const b = new ValleyAudio(); b.context = new RecordingContext(); b.context.state = 'running'; b.paused = b.muted = false;
    const step = recipe(surface); assert(a.playStep(step)); assert(b.playStep(step));
    assert.equal(JSON.stringify(fingerprint(a.context)), JSON.stringify(fingerprint(b.context)));
  }
});

test('production control resamples hero at contact, debug current/last names, mute/pause/audio=0 allocate nothing', async () => {
  const original = globalThis.AudioContext; globalThis.AudioContext = RecordingContext;
  try {
    for (const search of ['', '?steps9=0', '?mute=1', '?audio=0']) {
      const target = new EventTarget(); let density = .1, water = 0;
      const terrain = { surfaceAt: () => surfaceWeights(2), waterAt: () => water, grassDensityAt: () => density, riverDistanceAt: () => Infinity };
      const c = createKamakuraAudio({ search, target, terrain, storage: () => null });
      const g = { hero: { pos: { x: 0, z: 0 } } }; c.attach(g);
      target.dispatchEvent(new Event('click')); await flush();
      const ctx = c.audio.context, before = ctx?.nodes.length;
      if (search.includes('mute=1') || search.includes('audio=0')) {
        assert.equal(c.audio.playStep(recipe('grass')), false); assert.equal(ctx?.nodes.length, before);
      } else {
        c.audio.playStep(recipe('grass'));
        if (!search) {
          assert.match(c.debugText(), /足元土・直近土/);
          density = .8; c.update(.1, g.hero.pos); assert.match(c.debugText(), /足元草・直近土/);
          water = .4; c.audio.playStep(recipe('grass')); assert.match(c.debugText(), /足元川・直近川/);
          c.setPaused(true); const count = ctx.nodes.length;
          assert.equal(c.audio.playStep(recipe('water')), false); assert.equal(ctx.nodes.length, count);
        } else assert.doesNotMatch(c.debugText(), /足元/);
      }
      c.dispose();
      if (ctx) assert(ctx.nodes.every(n => n.connections.length === 0));
    }
  } finally { globalThis.AudioContext = original; }
});
