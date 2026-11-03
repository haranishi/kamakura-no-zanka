// なぜ作ったか（2026-11-03）: 戦いの金属音（キーン・カーン・ガン・カラン・ジッ）の設計図が、聴き分けの狙いと揺らぎの約束を守ることを、音を出さずに確かめる。
// 聴感そのものは本人の試聴。ここは「種類ごとの高さと余韻の順」「整数倍でない部分音」「毎回の揺らぎ」「同じ変奏を続けない」「肉の音に金属を混ぜない」だけ。
import test from 'node:test';
import assert from 'node:assert/strict';
import { COMBAT_KINDS, combatLayers, layersEndMs } from '../dist/valley/combat-synth.js';
import { ValleyAudio, scheduleCombat } from '../dist/valley/audio-valley.js';
import { mulberry32 } from '../dist/valley/scatter.js';

const modes = l => l.layers.filter(x => x.type === 'mode');
const lowest = l => Math.min(...modes(l).map(m => m.freq));
const longest = l => Math.max(...modes(l).map(m => m.decayMs));
const plan = (kind, seed = 1, o = {}) => combatLayers(kind, { rng: mulberry32(seed), ...o });

test('combat: every kind gives finite, audible layers below Nyquist', () => {
  for (const kind of COMBAT_KINDS) for (let seed = 0; seed < 8; seed++) {
    const { layers } = plan(kind, seed);
    assert.ok(layers.length > 0, kind);
    for (const l of layers) {
      for (const k of ['startMs', 'gain', 'freq']) assert.ok(Number.isFinite(l[k]), `${kind} ${k}`);
      assert.ok(l.gain > 0 && l.freq > 20 && l.freq < 20000, `${kind} range`);
    }
    assert.ok(layersEndMs(layers) > 20 && layersEndMs(layers) < 2500, `${kind} length`);
  }
});
test('combat: same seed is identical, another seed differs', () => {
  for (const kind of COMBAT_KINDS) { assert.deepEqual(plan(kind, 3), plan(kind, 3), kind); assert.notDeepEqual(plan(kind, 3), plan(kind, 4), kind); }
});
test('combat: kiin (parry) is higher and rings longer than kaan (block), which is higher than gan (armor)', () => {
  for (let seed = 0; seed < 12; seed++) {
    const p = plan('parry', seed), b = plan('block', seed), a = plan('hit_armor', seed);
    assert.ok(lowest(p) > lowest(b) * 1.6 && lowest(b) > lowest(a) * 1.2, 'pitch order');
    assert.ok(longest(p) > longest(b) * 2 && longest(p) >= 1300, 'parry tail');
  }
});
test('combat: partials are not integer multiples (blade and plate, not a tuned tone)', () => {
  for (const kind of ['parry', 'block', 'clash', 'hit_armor']) {
    const m = modes(plan(kind, 5)), f0 = lowest(plan(kind, 5));
    const off = m.filter(x => Math.abs(x.freq / f0 - Math.round(x.freq / f0)) > 0.1).length;
    assert.ok(off >= Math.floor(m.length / 2), `${kind}: ${off}/${m.length} inharmonic`);
  }
});
test('combat: beating pairs exist on the blade sounds', () => {
  for (const kind of ['parry', 'block', 'clash']) {
    const f = modes(plan(kind, 2)).map(m => m.freq).sort((x, y) => x - y);
    assert.ok(f.some((x, i) => i && x / f[i - 1] - 1 < 0.012), kind);
  }
});
test('combat: every play varies (pitch within +-3%) and never repeats the variant', () => {
  for (const kind of COMBAT_KINDS) {
    const rng = mulberry32(9); let last = null; const firsts = [];
    for (let i = 0; i < 30; i++) { const r = combatLayers(kind, { rng, last }); assert.notEqual(r.variant, last, kind); last = r.variant; firsts.push(r.layers[0].freq); }
    assert.ok(new Set(firsts.map(x => x.toFixed(3))).size > 20, `${kind} varies`);
  }
  const base = Array.from({ length: 40 }, (_, s) => lowest(plan('parry', s)));
  assert.ok(Math.max(...base) / Math.min(...base) < 1.03 / 0.97 * 1.07, 'parry jitter bounded (incl. variants)');
});
test('combat: light armor rings shorter than heavy, strong hit lower and longer', () => {
  const h = plan('hit_armor', 7), l = plan('hit_armor', 7, { armor: 'light' }), s = plan('hit_armor_heavy', 7);
  assert.ok(longest(l) < longest(h) * 0.7 && lowest(l) > lowest(h));
  assert.ok(lowest(s) < lowest(h) && longest(s) > longest(h));
});
test('combat: sword drop is three impacts in time order; spark is short and high', () => {
  const d = plan('sword_drop', 1), starts = [...new Set(modes(d).map(m => m.startMs))];
  assert.equal(starts.length, 3); assert.ok(starts[0] === 0 && starts[1] > 60 && starts[2] > starts[1] + 40);
  const s = plan('spark', 1);
  assert.ok(layersEndMs(s.layers) < 120 && s.layers.every(l => l.type === 'noise' && l.freq >= 6000));
});
test('combat: unknown kind and missing rng throw', () => {
  assert.throws(() => combatLayers('hit', { rng: Math.random }), /Unknown/);
  assert.throws(() => combatLayers('parry', {}), /rng/);
});

function fakeContext() {
  const nodes = [], param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => { const n = { gain: param(), frequency: param(), Q: param(), pan: param(), connect() {}, disconnect() { this.disconnected = true; } }; nodes.push(n); return n; };
  const source = kind => () => Object.assign(node(), { kind, start(t) { this.startTime = t; }, stop(t) { this.stopTime = t; } });
  let buffers = 0;
  return { nodes, get buffers() { return buffers; }, currentTime: 10, sampleRate: 48000, state: 'running', createGain: node, createBiquadFilter: node, createStereoPanner: node, createDynamicsCompressor: () => Object.assign(node(), { threshold: param(), ratio: param(), attack: param(), release: param(), knee: param() }),
    createOscillator: source('osc'), createBufferSource: source('buf'), destination: {}, createBuffer(ch, n) { buffers++; return { getChannelData: () => new Float32Array(n) }; } };
}
test('adapter: schedules every layer once, stops at the planned end, shares one noise buffer per context', () => {
  const ctx = fakeContext(), p = plan('parry', 1), nodes = [];
  const end = scheduleCombat(ctx, {}, 10, p.layers, nodes);
  assert.equal(nodes.filter(n => n.startTime !== undefined).length, p.layers.length);
  assert.ok(Math.abs(end - (10 + layersEndMs(p.layers) / 1000 + 0.02)) < 1e-9);
  assert.ok(nodes.every(n => n.stopTime === undefined || n.stopTime <= end + 1e-9));
  scheduleCombat(ctx, {}, 11, plan('block', 2).layers); assert.equal(ctx.buffers, 1, 'one noise buffer');
});
test('adapter: play() uses the seeded plan for metal kinds and keeps flesh hits free of metal', () => {
  const a = new ValleyAudio(); a.context = fakeContext(); a.paused = false;
  assert.equal(a.play('hit_armor', { armor: 'light' }), true);
  assert.equal(a.sources.size, 1);
  const before = a.context.nodes.length; a.play('hit_heavy');
  const osc = a.context.nodes.slice(before).filter(n => n.kind === 'osc');
  assert.equal(osc.length, 1, 'hit_heavy: a single body tone, no metal partials');
  const b = new ValleyAudio(); b.context = fakeContext(); b.paused = false;
  assert.deepEqual(b.fxLast, {}); b.play('parry'); b.play('parry'); assert.ok(Number.isInteger(b.fxLast.parry));
});
