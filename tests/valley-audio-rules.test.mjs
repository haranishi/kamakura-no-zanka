// なぜ失敗したか: 連続回避が無いと機械的に聞こえる(R15.3)。音量と半径の順が
// 崩れると走っても気づかれず、屈んでも聞こえる。境界漏れは遠くの音を残す。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as a from '../dist/valley/audio-rules.js';
import { AUDIO_NOISE } from '../dist/valley/config.js';
import { mulberry32 } from '../dist/valley/scatter.js';
const input = { surface: 'dirt', gait: 'walk', role: 'hero', foot: 'left' };
test('面・歩容・役割・左右を全て選べる [coverage]', () => {
  assert.ok(a.SURFACES.length >= 7, 'coverage: seven surfaces');
  for (const surface of a.SURFACES) for (const gait of a.GAITS) for (const role of a.ROLES) for (const foot of a.FEET) {
    const s = a.pickStep({ surface, gait, role, foot }, mulberry32(1));
    assert.deepEqual([s.recipe.surface, s.recipe.gait, s.recipe.role, s.recipe.foot], [surface, gait, role, foot], 'coverage: recipe identity');
    assert.ok(s.recipe.material.grains[0] >= 1 && s.recipe.equipment.weight[1] <= 180, 'layers: grains and body');
  }
});
test('1000歩は直前と異なり固定rngでも停止する [repetition]', () => {
  for (const rng of [mulberry32(1), () => 0, () => 0.999999]) {
    let last;
    for (let i = 0; i < 1000; i++) { const s = a.pickStep(input, rng, last); assert.notDeepEqual(s, last, 'repetition: same step'); last = s; }
  }
});
test('揺らぎは高さ±6%・大きさ±2dB [variation-range]', () => {
  const rng = mulberry32(2);
  for (const foot of a.FEET) for (const gait of a.GAITS) for (const edge of [() => 0, () => 1 - Number.EPSILON, rng]) for (let i = 0; i < 100; i++) {
    const s = a.pickStep({ ...input, foot, gait }, edge), db = 20 * Math.log10(s.gain / a.noiseGain(a.STEP_TABLE.gaits[gait].noise));
    assert.ok(s.pitch >= 0.94 - 1e-12 && s.pitch <= 1.06 + 1e-12, 'pitch-range: ±6%');
    assert.ok(Math.abs(db) <= 2 + 1e-12, 'gain-range: ±2dB');
  }
});
test('左右の高さとseedが異なる [feet]', () => {
  const l = a.pickStep(input, () => 0.5), r = a.pickStep({ ...input, foot: 'right' }, () => 0.5);
  assert.notEqual(l.pitch, r.pitch, 'feet: pitch'); assert.notEqual(l.seed, r.seed, 'feet: grains');
});
test('seedと入力が同じなら同じ系列 [determinism]', () => {
  const series = () => { const rng = mulberry32(42); let last; return Array.from({ length: 1000 }, () => (last = a.pickStep(input, rng, last))); };
  assert.deepEqual(series(), series(), 'determinism: replay');
});
test('共通表の半径とgainは走り＞歩き＞屈み [noise-order]', () => {
  assert.deepEqual(['run', 'walk', 'crouch', 'clash', 'hit', 'stealth'].map(a.noiseRadius), [11, 5, 1.5, 18, 12, 3], 'noise-radius: preserved behavior');
  for (const k of Object.keys(AUDIO_NOISE)) assert.equal(a.noiseGain(k), AUDIO_NOISE[k].gain, 'noise-table: shared gain');
  for (const fn of [a.noiseRadius, a.noiseGain]) assert.ok(fn('run') > fn('walk') && fn('walk') > fn('crouch'), 'noise-order: run > walk > crouch');
  const peaks = ['run', 'walk', 'crouch'].map(gait => a.pickStep({ ...input, gait }, () => 0.5).gain);
  assert.ok(peaks[0] > peaks[1] && peaks[1] > peaks[2], 'step-gain: shared ordering');
  assert.ok(a.noiseGain('run') / a.noiseGain('walk') > 10 ** (4 / 20), 'gain-order: even jitter extremes');
});
test('22m境界・減衰・高域と定位 [distance]', () => {
  assert.equal(a.distanceRule(21.999).audible, true, 'distance: below boundary');
  assert.deepEqual(a.distanceRule(22), { audible: false, gain: 0, lowpassHz: 1200 }, 'distance: 22m silent');
  assert.equal(a.distanceRule(100).gain, 0, 'distance: far silent');
  const near = a.distanceRule(0), far = a.distanceRule(10);
  assert.ok(near.gain > far.gain && near.lowpassHz > far.lowpassHz, 'distance: damping');
  const listener = { x: 0, z: 0, yaw: 0 };
  assert.equal(a.panOf({ x: 1, z: 0 }, listener), 1, 'pan: right');
  assert.equal(a.panOf({ x: -1, z: 0 }, listener), -1, 'pan: left');
  assert.equal(a.panOf({ x: 0, z: 0 }, listener), 0, 'pan: coincident');
  assert.ok(a.panOf({ x: 0, z: -1 }, { ...listener, yaw: Math.PI / 2 }) > 0.999, 'pan: relative yaw');
});
test('8効果音に3変種以上・連続回避・材質 [variants]', () => {
  assert.equal(Object.keys(a.VARIANTS).length, 8, 'variants: eight kinds');
  for (const [kind, count] of Object.entries(a.VARIANTS)) {
    assert.ok(count >= 3, 'variants: minimum three'); let last; const seen = new Set(), rng = mulberry32(1);
    for (let i = 0; i < 1000; i++) { const v = a.pickVariant(kind, rng, last); assert.notEqual(v, last, 'variants: repetition'); assert.ok(v >= 0 && v < count, 'variants: bounds'); seen.add(v); last = v; }
    assert.equal(seen.size, count, 'variants: reachable');
    assert.notEqual(a.pickVariant(kind, () => 0, 0), 0, 'variants: constant rng');
  }
  assert.equal(new Set(Object.values(a.HIT_MATERIAL).map(JSON.stringify)).size, 4, 'material: distinct resonance');
});
test('4バスと設定・duck・ピーク定数 [mix]', () => {
  assert.deepEqual(Object.keys(a.BUSES), ['ambient', 'steps', 'combat', 'ui'], 'mix: four buses');
  assert.ok(a.PEAK_LIMIT > 0 && a.PEAK_LIMIT < 0.99, 'mix: peak ceiling');
  assert.equal(a.duckAmbient(), 1, 'duck: idle');
  for (const flags of [{ combat: true }, { dialogue: true }, { combat: true, dialogue: true }]) assert.ok(a.duckAmbient(flags) < 1, 'duck: activity');
  for (const [kind, [bus, level]] of Object.entries(a.KIND_LEVELS)) {
    assert.equal(a.mixGain(kind), level * a.BUSES[bus], 'mix: base level');
    assert.equal(a.mixGain(kind, { effects: 0, ambient: 0 }), 0, 'mix: mute');
    assert.equal(a.mixGain(kind, { effects: 0.5, ambient: 0.5 }), level * a.BUSES[bus] * 0.5, 'mix: settings multiply');
    if (bus !== 'ambient') assert.equal(a.mixGain(kind, { ambient: 0, combat: true }), a.mixGain(kind), 'mix: separate effects');
    else assert.equal(a.mixGain(kind, { effects: 0, combat: true }), a.mixGain(kind) * 0.55, 'mix: ambient duck');
  }
});
test('未知入力・非有限値・壊れたrngを拒否 [invalid-input]', () => {
  for (const key of Object.keys(input)) for (const value of ['unknown', '__proto__', null]) assert.throws(() => a.pickStep({ ...input, [key]: value }, () => 0), TypeError, 'input: unknown enum');
  for (const rng of [null, () => NaN, () => Infinity, () => -1, () => 1]) assert.throws(() => a.pickStep(input, rng), TypeError, 'input: rng');
  for (const fn of [a.noiseRadius, a.noiseGain, k => a.pickVariant(k, () => 0), a.mixGain]) assert.throws(() => fn('unknown'), TypeError, 'input: kind');
  for (const v of [NaN, Infinity, -1]) assert.throws(() => a.distanceRule(v), TypeError, 'input: distance');
  assert.throws(() => a.panOf({ x: NaN, z: 0 }, { x: 0, z: 0, yaw: 0 }), TypeError, 'input: pan');
  assert.throws(() => a.mixGain('ui', { effects: NaN }), TypeError, 'input: mix');
});
