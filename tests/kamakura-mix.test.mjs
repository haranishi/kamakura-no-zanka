import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MIX, waterNear, riverBrightness, windGain, waterPan, duckDepth, duckPlan, duckAt, dbGain } from '../dist/valley/kamakura-mix.js';
import { KamakuraAudio } from '../dist/valley/kamakura-sea-audio.js';
import { createKamakuraAudio } from '../dist/valley/kamakura-audio-view.js';
import { kamakuraStepLayers } from '../dist/valley/kamakura-step-rules.js';
import { pickStep } from '../dist/valley/audio-rules.js';
import { mulberry32 } from '../dist/valley/scatter.js';
import { gustLevel, GUST_PERIOD_S } from '../dist/valley/kamakura-gust.js';
import { FakeContext, flush, Button } from './helpers/kamakura-audio.mjs';
class MixContext extends FakeContext {
  constructor() { super(); this.sampleRate = 48000; }
  node() {
    const n = super.node(); n.kind = 'gain'; n.starts = []; n.stops = []; n.disconnections = 0;
    n.start = (...a) => n.starts.push(a); n.stop = (...a) => n.stops.push(a);
    n.disconnect = () => { n.disconnections++; n.connections.length = 0; };
    for (const key of ['gain', 'frequency', 'pan', 'Q', 'threshold', 'ratio', 'attack', 'release', 'knee']) {
      n[key].events = [];
      for (const method of ['setValueAtTime', 'setTargetAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues']) {
        n[key][method] = (...args) => { if (method !== 'cancelScheduledValues') n[key].value = args[0]; n[key].events.push([method, ...args]); };
      }
    }
    return n;
  }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: c => data[c], length, sampleRate, numberOfChannels: channels };
  }
  createBiquadFilter() { const n = this.node(); n.kind = 'filter'; return n; }
  createDynamicsCompressor() { const n = this.node(); n.kind = 'compressor'; return n; }
  createStereoPanner() { const n = this.node(); n.kind = 'panner'; return n; }
  createBufferSource() { const n = this.node(); n.kind = 'buffer'; return n; }
  createOscillator() { const n = this.node(); n.kind = 'oscillator'; return n; }
}
function fingerprint(ctx) {
  return ctx.nodes.map(n => ({ kind: n.kind, type: n.type, loop: n.loop,
    starts: n.starts, stops: n.stops, connections: n.connections.map(c => ctx.nodes.indexOf(c)),
    params: Object.fromEntries(['gain', 'frequency', 'pan', 'Q', 'threshold', 'ratio', 'attack', 'release', 'knee'].map(k => [k, [n[k].value, n[k].events]])),
    buffer: n.buffer ? [n.buffer.length, n.buffer.sampleRate, n.buffer.numberOfChannels] : undefined }));
}

const recipe = (surface, gait = 'walk', seed = 123) => pickStep({ surface, gait, role: 'hero', foot: 'left' }, mulberry32(seed));
const audio = (options = {}) => {
  const a = new KamakuraAudio(() => {}, { mix10: true, steps9: true, ...options });
  a.context = new MixContext(); a.context.state = 'running'; a.paused = false; return a;
};
const digest = ctx => createHash('sha256').update(JSON.stringify(fingerprint(ctx))).digest('hex');
// Captured from HEAD's original KamakuraAudio before the change; includes graph edges and every AudioParam event.
const golden = {
  'false:water': 'a3e891280949bc6c96026beed759a12108aa599a1817320242072d4a8c9fb4d9',
  'false:grass': '33f5511b9a357c489ec6580e8eece31a4265f612ac7aa39997fa8c7bcecfc2ca',
  'false:dirt': 'c80dd44c6d549abf4f8279355a32b5dbe1ee8395a06432f19b2d58cd2a9e345c',
  'false:gravel': '2f23b5cf8f2a47e1e78678cf7a3d03ddbc0f28acb22f95edbf83efc55e25098d',
  'false:leaves': 'd95a44696038f4ad6638b28c182c94465ff63603fc63ea13133e7feb31641446',
  'false:stone': '9599166eb1eb5b1f4f592e2dead8a4d21bc598c43d581f0c91a771652d1d46dc',
  'false:wood': '24835742994bd1352bfe74fa748bf1ee8ae129c607a4d73d3d5bddd81418a5cc',
  'true:water': 'd66917e95afd6992d29efef78c07a605614414958dbb1187a9c11e86e18aeb8a',
  'true:grass': '74edde4eacdeb1bbfb268fb75ab42789b5029f7def83e05faf2b86f525088311',
  'true:dirt': 'ab0e6131d5b19b8bcbc9b88e2b97e4d286fd45780075d51e1d1183f26b714946'
};
test('mix10=0 preserves original graph, frequencies, scheduling and gains for every step surface and both steps9 modes', () => {
  for (const steps9 of [false, true]) for (const surface of ['water', 'grass', 'dirt', 'gravel', 'leaves', 'stone', 'wood']) {
    const a = audio({ mix10: false, steps9 }); assert(a.playStep(recipe(surface)));
    assert.equal(digest(a.context), golden[`${steps9}:${surface}`] ?? golden[`false:${surface}`]);
    assert.equal(a.buses, null); a.setPaused(true);
  }
  for (const [sea, expected] of [[false, 'bfbce6dd3db4ed0e74915ce171ef3fa237d4db402fba4aa3905a5ea7284616f2'], [true, 'e0dae40609ac5c3d9d82d700f38863597bf8b2a73fa445c4dbb86f3cd397a32d']]) {
    const a = audio({ mix10: false, sea }); a.updateListener({ river: 14, sea: 27, fire: Infinity });
    assert.equal(digest(a.context), expected); a.setPaused(true);
  }
});
test('mix rules: monotone smooth attenuation, brightness, bounded orientation and gust gains', () => {
  for (const kind of ['river', 'sea']) {
    let last = 1;
    for (let d = 0; d <= 650; d += .25) { const g = waterNear(d, kind); assert(g >= 0 && g <= last); assert(last - g < .03); last = g; }
    assert.equal(waterNear(Infinity, kind), 0);
  }
  assert(riverBrightness(0) > riverBrightness(100));
  assert.equal(waterPan(6, 14, 10, 10, 0), .7);
  assert.equal(waterPan(6, 14, 10, 10, Math.PI), -.7);
  assert.equal(waterPan(6, 14, 10, 10, 0, 0), 0);
  assert.equal(waterPan(Infinity, 14, 10, 10, 0), 0);
  for (const kind of ['meadow', 'forest']) {
    let last = 0;
    for (let i = 0; i <= 1000; i++) { const g = windGain(i / 1000, kind); assert(g >= last); last = g; }
    assert(20 * Math.log10(windGain(1, kind) / windGain(.2, kind)) >= 6);
  }
  assert(Math.abs(GUST_PERIOD_S - 6.98) < .01);
});
test('duck timing: quiet unchanged, loud -6dB, 12ms attack / 100ms hold / 160ms release; twenty contacts never accumulate', () => {
  assert.equal(duckDepth(Infinity, Infinity), 0); assert.equal(duckDepth(0, Infinity), 6);
  const a = audio(); a.startAmbient();
  const g = a.buses.ambience.gain, count = g.events.length;
  a.playStep(recipe('grass')); assert.equal(g.events.length, count);
  a.listener.river = 3;
  for (let i = 0; i < 20; i++) {
    a.context.currentTime = i * .04; assert(a.playStep(recipe('water', 'walk', i)));
    const events = g.events.slice(-5), t = i * .04;
    assert.equal(events[0][0], 'cancelScheduledValues');
    assert(Math.abs(events[2][2] - t - .012) < 1e-9);
    assert(Math.abs(events[3][2] - t - .112) < 1e-9);
    assert(Math.abs(events[4][2] - t - .272) < 1e-9);
    assert(events.slice(1).every(e => e[1] >= dbGain(-6) - 1e-12));
  }
  const d = duckPlan(2, 6);
  assert.equal(duckAt(3, 2, 1, d.gain, d.attack, d.hold, d.end), 1);
  assert.equal(duckAt(2.05, 2, 1, d.gain, d.attack, d.hold, d.end), d.gain);
  a.setPaused(true);
});
test('all seven step surfaces route through steps; wind/river/sea through ambience; empty life bus; cap and complete pause cleanup', async () => {
  const a = audio(); a.updateListener({ river: 8, sea: 27 });
  const { steps, ambience, life } = a.buses;
  assert.equal(a.context.nodes.filter(n => n.connections.includes(life)).length, 0);
  for (const v of a.ambient.values()) {
    const nodes = v.mixNodes || v.nodes;
    assert(nodes.some(n => n.connections.includes(ambience)));
  }
  const continuous = [...a.ambient.values()].flatMap(v => v.children || []).length;
  assert(continuous <= 16); assert.equal(continuous, 6);
  for (const surface of ['water', 'grass', 'dirt', 'gravel', 'leaves', 'stone', 'wood']) {
    const before = a.context.nodes.length; assert(a.playStep(recipe(surface)));
    const nodes = a.context.nodes.slice(before); assert(nodes.some(n => n.connections.includes(steps)));
    assert(!nodes.some(n => n.connections.includes(a.master)));
  }
  for (let i = 7; i < 28; i++) assert(a.playStep(recipe('water', 'run', i)));
  assert.equal(a.playStep(recipe('water')), false); assert.equal(a.sources.size, 28);
  assert(a.stepPeakBound <= MIX.steps.ceiling + 1e-12);
  a.setPaused(true); await flush(); assert.equal(a.ambient.size, 0); assert.equal(a.sources.size, 0); assert.equal(a.buses, null);
  assert(a.context.nodes.every(n => n.connections.length === 0 || [a.master, a.comp, a.limiter].includes(n)));
  a.setPaused(false); await flush(); assert(a.buses); assert.equal(a.ambient.size, 3);
  a.setMuted(true); await flush(); assert.equal(a.buses, null); assert.equal(a.ambient.size, 0);
});
test('M2 seeded plans: audible bands, sustained durations, water and grass grains, running distinction', () => {
  for (const surface of ['grass', 'dirt', 'water']) for (const gait of ['walk', 'run']) {
    const s = recipe(surface, gait), layers = kamakuraStepLayers(s, +(surface === 'grass'), { mix10: true });
    assert.equal(JSON.stringify(layers), JSON.stringify(kamakuraStepLayers(s, +(surface === 'grass'), { mix10: true })));
    assert.notEqual(JSON.stringify(layers), JSON.stringify(kamakuraStepLayers(recipe(surface, gait, 124), +(surface === 'grass'), { mix10: true })));
    const a = audio(); a.playStep(s); const v = [...a.sources.values()][0];
    assert(v.stepPeakBound <= (gait === 'run' ? MIX.steps.ceiling : MIX.steps.walkCeiling) + 1e-12);
    if (surface === 'water') {
      const splash = layers.find(l => l.kind === 'splash'), drops = layers.filter(l => l.kind === 'drop');
      assert(splash.freq >= 600 && splash.freq <= 3500);
      assert(splash.durationMs >= (gait === 'run' ? 340 : 240) && splash.durationMs <= (gait === 'run' ? 460 : 320));
      assert(drops.length >= (gait === 'run' ? 5 : 3) && drops.length <= (gait === 'run' ? 7 : 4));
    } else if (surface === 'grass') {
      const rustle = layers.find(l => l.kind === 'rustle'), grains = layers.filter(l => l.kind === 'leaf');
      assert(rustle.freq >= 2000 && rustle.freq <= 5000);
      assert(rustle.durationMs >= (gait === 'run' ? 220 : 150) && rustle.durationMs <= (gait === 'run' ? 320 : 220));
      assert(grains.length >= 2 && grains.length <= 4);
    } else {
      const body = layers.find(l => l.kind === 'body'), sand = layers.find(l => l.kind === 'sand');
      assert(body.freq >= 300 && body.freq <= 900 && body.durationMs >= 40 && body.durationMs <= 70);
      assert(sand.freq >= 1300 && sand.freq <= 2500 && sand.durationMs >= 60 && sand.durationMs <= 90);
    }
    assert(v.stepNodes.some(n => n.gain.events.filter(e => e[0] === 'linearRampToValueAtTime').length === 3));
    a.setPaused(true);
  }
  for (const surface of ['grass', 'dirt', 'water']) {
    const peakBudget = gait => { const a = audio(); a.playStep(recipe(surface, gait)); const v = [...a.sources.values()][0]; const p = v.stepPeakBound; a.setPaused(true); return p; };
    assert(20 * Math.log10(peakBudget('run') / peakBudget('walk')) >= 2);
  }
});
const terrain = { riverDistanceAt: (x, z, reach) => { assert(reach <= 300); return Math.max(0, 20 - x); }, seaDistanceAt: (_x, z) => Math.max(0, 40 - z), surfaceAt: () => ({ grass: 1, dirt: 0, rock: 0, gravel: 0, mud: 0, litter: 0 }), waterAt: () => 0 };
test('listen stores only scalar values in place 1000 times while locked/muted/paused, leaves no frame references and exposes debug safely', async () => {
  const old = globalThis.AudioContext; globalThis.AudioContext = MixContext;
  try {
    for (const search of ['?mixdebug=1', '?mute=1&mixdebug=1', '?audio=0&mixdebug=1', '?mix10=0']) {
      const target = new EventTarget(), button = new Button(), c = createKamakuraAudio({ search, terrain, target, button, storage: () => null });
      const l = c.audio.listening, keys = l && Object.keys(l), pos = { x: 0, y: 1, z: 0 }, frame = { pos, yaw: 0, time: 3, wind: 1, windDir: [1, 0], flying: true };
      for (let i = 0; i < 1000; i++) { frame.time = i / 60; c.listen(frame); }
      if (l) { assert.equal(c.audio.listening, l); assert.equal(Object.keys(l).join(), keys.join()); assert(Object.values(l).every(v => typeof v !== 'object')); }
      assert.equal(c.audio.context, search.includes('audio=0') ? undefined : null);
      // Guard the hot method itself against new collections or captured frame objects.
      const src = readFileSync(new URL('../dist/valley/kamakura-audio-view.js', import.meta.url), 'utf8').split('listen(frame) {')[1].split('\n    },')[0];
      assert.doesNotMatch(src, /\bnew\b|\.\.\.|=\s*\[|=\s*\{|=\s*frame\s*[;,]/);
      c.update(.1, pos); target.dispatchEvent(new Event('click')); await flush(); c.update(.1, pos);
      if (c.audio.mix10 && !c.audio.muted) {
        const w = c.audio.mixState; assert.equal(w.wind, gustLevel(0, 0, frame.time, 1, 0));
        assert.equal(w.riverPan, .7); assert.equal(w.seaPan, 0);
        assert.equal(c.audio.listening.time, frame.time);
        frame.pos.x = 500; frame.windDir[0] = -1; assert.equal(c.audio.listening.x, 0); assert.equal(c.audio.listening.windX, 1);
        assert.equal(target.__kzMix().river.pan, .7); assert(target.__kzMix().buses.life === 1);
      }
      c.setPaused(true); const count = c.audio.context?.nodes.length;
      for (let i = 0; i < 1000; i++) c.listen(frame);
      assert.equal(c.audio.context?.nodes.length, count);
      c.dispose(); assert.equal(target.__kzMix, undefined);
      assert(c.audio.context?.nodes.every(n => n.connections.length === 0) ?? true);
    }
  } finally { globalThis.AudioContext = old; }
});
test('partial new ambience failure disconnects every acquired child and bus, reports unavailability', () => {
  const a = audio(); const create = a.context.createStereoPanner.bind(a.context); let calls = 0;
  a.context.createStereoPanner = () => { if (++calls === 1) throw Error('river pan failure'); return create(); };
  a.startAmbient(); assert.equal(a.ambientFailed, true); assert.equal(a.ambient.size, 0); assert.equal(a.buses, null);
  assert(a.context.nodes.every(n => n.connections.length === 0 || [a.master, a.comp, a.limiter].includes(n)));
});
test('new surf uses cached seamless beds, retains wave envelope and sea gain controls, never builds faded legacy loops', async () => {
  const a = audio({ gainScale: 2 }); a.noiseSource = () => { throw Error('legacy ambience was called'); };
  a.context.currentTime = 4; a.updateListener({ river: Infinity, sea: 27 });
  assert.equal(a.ambientFailed, false); const v = a.ambient.get('sea'); assert(v);
  // Cheap 12 kHz beds, several seconds long (a loop under a few seconds is heard as a repeating flutter).
  assert(v.children.every(n => n.buffer.sampleRate === 12000 && n.buffer.length >= 12000 * 5 && n.buffer.length <= 12000 * 12));
  assert.equal(a.seaGain, MIX.sea.gain * 2 / (1 + (27 / 60) ** 1.6));
  const buffers = v.children.map(n => n.buffer);
  a.setMuted(true); await flush(); a.setMuted(false); await flush();
  a.ambient.get('sea').children.forEach((n, i) => assert.equal(n.buffer, buffers[i])); a.setPaused(true);
  const off = audio({ sea: false }); off.startAmbient(); assert(!off.ambient.has('sea')); off.setPaused(true);
});
