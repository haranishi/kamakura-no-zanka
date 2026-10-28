// なぜ失敗したか: exercise the actual adapter methods with Node doubles, without claiming audio/render validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ValleyAudio } from '../dist/valley/audio-valley.js';
import { pickStep, distanceRule } from '../dist/valley/audio-rules.js';
import { stepLayers } from '../dist/valley/step-synth.js';
import { roleOf, gaitOfClip, stepSurfaceAt } from '../dist/valley/step-surface.js';
import { AUDIO_NOISE } from '../dist/valley/config.js';
import { createContactTracker, observeContacts } from '../dist/valley/foot-contacts.js';
import { FOOT_CONTACTS } from '../dist/valley/anim-contacts.js';
import { installQA } from '../dist/valley/qa.js';
const read = name => fs.readFileSync(new URL(`../dist/valley/${name}.js`, import.meta.url), 'utf8');
const strip = s => s.replace(/^import .*;\n/gm, '').replace(/export /g, '').replace(/import\.meta\.url/g, JSON.stringify(new URL('../dist/valley/characters.js', import.meta.url).href));
// Imports are replaced only in this test harness; methods remain production source.
const dummy = class { constructor() {} set() {} };
const Character = new Function('THREE', 'createContactTracker', 'observeContacts', 'FOOT_CONTACTS', `${strip(read('characters'))}; return Character;`)({ Quaternion: dummy, Vector3: dummy }, createContactTracker, observeContacts, FOOT_CONTACTS);
const Actor = new Function('pickStep', 'distanceRule', 'roleOf', 'gaitOfClip', 'stepSurfaceAt', 'AUDIO_NOISE', `${strip(read('actors'))}; return Actor;`)(pickStep, distanceRule, roleOf, gaitOfClip, stepSurfaceAt, AUDIO_NOISE);
function observer() {
  const c = Object.create(Character.prototype), events = [];
  const a = { time: 0, getEffectiveWeight: () => 1, getEffectiveTimeScale: () => 1 };
  Object.assign(c, { id: 'test-character', contacts: createContactTracker(), time: 0, rate: 0.9, contactTimeScale: 0.2, contactNear: true, contactAirborne: false, contactReset: false, contactRestart: new Set(), actions: new Map([['Casual_Walk', a]]), current: a, locoName: 'Casual_Walk', gait: 'walk', flinch: { x: 0, v: 0 }, armRelax: false, mixer: { timeScale: 1, update(dt) { a.time += dt; } }, onContact: e => events.push(e) });
  return { c, a, events };
}
test('wiring: mixer before contact, rate and hit stop, same foot multiple times', () => {
  const { c, events } = observer();
  for (let i = 0; i < 270; i++) c.update(1 / 60);
  assert.equal(events.length, 6, 'wiring: all six contacts in first cycle');
  assert.deepEqual(events.map(e => e.index), [0, 1, 2, 3, 4, 5], 'wiring: identity is index, not foot');
  assert.ok(events.every(e => e.actor === c.id && e.ago >= 0 && e.ago < 1 / 60 / 0.2 + 1e-8), 'wiring: real-time ago includes rate and hitstop');
});
test('wiring: far, airborne, idle, reset suppress and rebase', () => {
  for (const flags of [{ contactNear: false }, { contactAirborne: true }, { gait: 'idle' }, { locoName: null }]) {
    const { c, events } = observer(); Object.assign(c, flags); for (let i = 0; i < 60; i++) c.update(1 / 60);
    assert.equal(events.length, 0, 'wiring: suppressed contacts');
  }
  const { c, a, events } = observer(); c.update(0.01); a.time = 2; c.resetContacts(); c.update(0.01);
  assert.equal(events.length, 0, 'wiring: reset does not backfill'); assert.equal(c.contactReset, false, 'wiring: reset consumed');
});
test('wiring: rounded GLB duration tail does not throw', () => { const { c, a } = observer(); c.actions = new Map([['CMU_Run', a]]); a.time = 0.73332; c.mixer.update = () => {}; assert.doesNotThrow(() => c.update(0)); });
test('wiring: play marks only the rewound action as a new stride', () => {
  const c = Object.create(Character.prototype);
  const a = { time: 2, reset() { this.time = 0; }, setEffectiveWeight() {}, fadeIn() {}, play() {} };
  Object.assign(c, { current: a, action: () => a, contactReset: false, contactRestart: new Set() });
  c.play('Casual_Walk'); assert.equal(c.contactRestart.size, 0, 'wiring: speed-only update keeps baseline');
  c.play('Casual_Walk', { from: 0.1 }); assert.equal(a.time, 0.1, 'wiring: explicit seek honored'); assert.ok(c.contactRestart.has('Casual_Walk'), 'wiring: seek restarts the stride');
  c.contactRestart.clear(); c.play('Casual_Walk', { restart: true }); assert.ok(c.contactRestart.has('Casual_Walk'), 'wiring: restart starts a new stride');
  assert.equal(c.contactReset, false, 'wiring: play never drops the other actions baselines');
});
test('wiring: a gait switch keeps the outgoing contact in the same frame and gives the restarted clip fresh identities', () => {
  // なぜ失敗したか（2026-10-27）: play() が全動作の起点を捨てていたため、切り替えのコマに当たった出ていく動作の接地が落ち、短く繰り返した走りの最初の接地も鳴らなかった。
  const c = Object.create(Character.prototype), events = [];
  const mk = w => ({ time: 0, w, getEffectiveWeight() { return this.w; }, getEffectiveTimeScale: () => 1 });
  const run = mk(1), jog = mk(0);
  Object.assign(c, { id: 'gait-switch', contacts: createContactTracker(), time: 0, rate: 1, contactTimeScale: 1, contactNear: true, contactAirborne: false, contactReset: false, contactRestart: new Set(), actions: new Map([['CMU_Run', run], ['CMU_Jog', jog]]), current: run, locoName: 'CMU_Run', gait: 'run', flinch: { x: 0, v: 0 }, armRelax: false, mixer: { timeScale: 1, update(dt) { for (const x of [run, jog]) if (x.w > 0) x.time += dt; } }, onContact: e => events.push(e) });
  run.time = 0.02; c.update(0.001);                                     // 走りが定常（起点）
  jog.w = 0.08; run.w = 0.92; jog.time = 0; c.current = jog; c.contactRestart.add('CMU_Jog');   // play(Jog) 相当：Run はまだ9割
  c.update(0.02);                                                         // Run は 0.021→0.041 で左の接地（0.033）を通る
  assert.deepEqual(events.map(e => `${e.clip}/${e.foot}`), ['CMU_Run/left'], 'wiring: outgoing contact kept in the switch frame');
  assert.equal(c.contactRestart.size, 0, 'wiring: restart flags are consumed by one update');
});
function actor(who = 'hero') {
  const plays = [], noises = [], dust = [], a = Object.create(Actor.prototype);
  const terrain = { surfaceAt: () => ({ grass: 0, dirt: 1, rock: 0, mud: 0, gravel: 0, litter: 0 }), waterAt: () => 0 };
  const game = { terrain, world: { buildings: [] }, hero: { pos: { x: 0, z: 0 } }, rng: () => 0.5, audio: { playStep(...args) { plays.push(args); return false; } }, emitNoise: (...args) => noises.push(args), fx: { dust: (...args) => dust.push(args) }, pan: () => 0.7 };
  Object.assign(a, { who, game, pos: { x: 5, z: 0 }, stepGait: 'walk' });
  return { a, plays, noises, dust };
}
const contact = { actor: 'individual', clip: 'CMU_Jog', loop: 0, index: 0, foot: 'left', contactTime: 0.0664, ago: 0.005 };
for (const gait of ['walk', 'run', 'crouch']) test(`wiring: hero ${gait} noise survives failed audio`, () => {
  const { a, plays, noises, dust } = actor(); a.stepGait = gait; a.crouch = gait === 'crouch'; a.onFootContact(contact);
  assert.equal(noises[0][2], AUDIO_NOISE[gait].radius, 'wiring: unchanged discovery radius');
  assert.equal(plays[0][0].recipe.gait, gait, 'wiring: hero gait'); assert.equal(dust.length, gait === 'run' ? 1 : 0, 'wiring: running dust');
  const seed = a.lastStep.seed; a.onFootContact(contact); assert.notEqual(a.lastStep.seed, seed, 'wiring: previous step feeds selection');
});
test('wiring: nonhero distance, pan, role and near boundary', () => {
  const { a, plays, noises } = actor('officer'); a.onFootContact(contact);
  assert.equal(plays[0][0].recipe.role, 'enemy_heavy'); assert.deepEqual(plays[0][1], { pan: 0.7, lowpassHz: distanceRule(5).lowpassHz, gainScale: distanceRule(5).gain });
  assert.equal(noises.length, 0, 'wiring: no enemy discovery noise');
  a.pos.x = 22; a.onFootContact(contact); assert.equal(plays.length, 1, 'wiring: 22m silent');
  let ticks = 0; a.character = { update() { ticks++; } }; a.tickCharacter(1 / 60); assert.equal(a.character.contactNear, false);
  a.pos.x = 21.99; for (let i = 0; i < 60; i++) a.tickCharacter(1 / 60); assert.equal(ticks, 61, 'wiring: every-frame updates'); assert.equal(a.character.contactNear, true);
});
function fakeContext() {
  const nodes = [];
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => { const n = { gain: param(), frequency: param(), Q: param(), pan: param(), connect() {}, disconnect() { this.disconnected = true; } }; nodes.push(n); return n; };
  const source = () => Object.assign(node(), { start(t) { this.startTime = t; }, stop(t) { this.stopTime = t; } });
  return { nodes, currentTime: 10, sampleRate: 48000, state: 'running', createGain: node, createBiquadFilter: node, createStereoPanner: node, createOscillator: source, createBufferSource: source, createBuffer(ch, n) { return { getChannelData: () => new Float32Array(n) }; } };
}
function audio() { const a = new ValleyAudio(); a.context = fakeContext(); a.paused = false; a.ensureMaster = () => ({}); return a; }
const selected = () => pickStep({ surface: 'gravel', gait: 'run', role: 'hero', foot: 'left' }, () => 0.5);
test('audio adapter: 28 bundles, rejected 29th, audio-time cleanup and stop', () => {
  const a = audio(); for (let i = 0; i < 28; i++) assert.equal(a.playStep(selected()), true, 'audio: successful bundle');
  assert.equal(a.sources.size, 28); assert.equal(a.playStep(selected()), false); assert.equal(a.stepRejectReason, 'limit');
  const voice = [...a.sources.values()][0], nodes = [...voice.stepNodes];
  const plannedEnd = 10 + Math.max(...stepLayers(selected()).map(l => l.startMs + l.durationMs)) / 1000 + 0.04;
  assert.equal(voice.source.stopTime, plannedEnd, 'audio: actual longest layer plus tail');
  voice.source.onended(); assert.equal(a.sources.size, 27); assert.ok(nodes.every(n => n.disconnected), 'audio: all nodes detached');
  for (const v of a.sources.values()) a.stop(v); assert.equal(a.sources.size, 0, 'audio: explicit stop clears all bundles');
});
test('audio adapter: partial construction failure stops children and detaches nodes', () => {
  const a = audio(); let count = 0; const create = a.context.createBufferSource;
  a.context.createBufferSource = () => { if (++count === 3) throw Error('injected'); return create(); };
  assert.equal(a.playStep(selected()), false); assert.equal(a.sources.size, 0); assert.ok(a.context.nodes.every(n => n.disconnected), 'audio: failure cleanup');
});
test('audio adapter: muted, paused, unavailable do not reserve bundles', () => {
  for (const flag of ['muted', 'paused']) { const a = audio(); a[flag] = true; assert.equal(a.playStep(selected()), false); assert.equal(a.sources.size, 0); }
  const a = audio(); a.context = null; assert.equal(a.playStep(selected()), false);
});
test('qa: record contact/output/play timestamps, success and limit separately; stop/get', () => {
  const prior = globalThis.window; globalThis.window = {};
  try {
    const game = { input: {}, audio: { context: { currentTime: 3, getOutputTimestamp: () => ({ contextTime: 2.99, performanceTime: 42 }) } } };
    const api = installQA(game, {}); api.footLog(true);
    const r = game.footQA.contact(contact); game.footQA.played(r, game.footQA.playTime(), { surface: 'grass', gait: 'walk', role: 'hero', pitch: 1, gain: 0.5, seed: 42, success: true, rejected: false });
    game.footQA.contact(contact); game.footQA.played(null, null, { success: false, rejected: true });
    assert.deepEqual(api.stepStats(), { contacts: 2, played: 1, rejected: 1 });
    const records = api.footLog(false); assert.equal(records[0].outputTs.contextTime, 2.99); assert.equal(records[0].playStep.audioTime, 3); assert.ok(Number.isFinite(records[0].perf));
    game.footQA.contact(contact); assert.equal(api.footLog().length, 2, 'qa: recording stopped');
  } finally { globalThis.window = prior; }
});
test('audio adapter: early filter and late tail allocation failures clean every created node', () => {
  for (const failure of ['filter', 'tail']) {
    const a = audio();
    if (failure === 'filter') a.context.createBiquadFilter = () => { throw Error('injected'); };
    else { const create = a.context.createBuffer; a.context.createBuffer = (ch, n, rate) => { if (n === 1) throw Error('injected tail'); return create(ch, n, rate); }; }
    assert.equal(a.playStep(selected()), false); assert.equal(a.sources.size, 0);
    assert.ok(a.context.nodes.every(n => n.disconnected), 'audio: every allocated node detached on error');
  }
});
