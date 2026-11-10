import test from 'node:test';
import assert from 'node:assert/strict';
import { VOICE_NAMES } from '../dist/valley/kamakura-voices.js';
import { mulberry32 } from '../dist/valley/scatter.js';
import { voiceLikelihood, voiceInterval, VOICE_INTERVALS, bellNear, sourceSpatial, BIRDS,
  createSoundscapeState, stepSoundscape, startSoundscapeVoice, resetSoundscape, soundscapeLimit } from '../dist/valley/kamakura-soundscape.js';

const listener = () => ({ x: 0, y: 1.7, z: 0, yaw: 0, ground: 0, flying: false, high: false });
const habitat = { forest: 1, town: 1, meadow: 1, paddy: 1, river: 1, temple: 1, shore: 1 };
test('habitat/time table excludes beach cicadas, forest kites, daytime crickets; golden frogs are scarce', () => {
  for (const time of ['noon', 'morning', 'golden', 'evening']) {
    const beach = voiceLikelihood({ sand: 1, shore: 1 }, time);
    for (const name of ['higurashi', 'aburazemi', 'minmin', 'uguisu', 'kaeru', 'koorogi']) assert.equal(beach[name], 0);
    assert.equal(voiceLikelihood({ forest: 1 }, time).tobi, 0);
    assert.equal(voiceLikelihood({ forest: 1, shore: 1 }, time).tobi, 0);
    const w = voiceLikelihood(habitat, time, 30);
    for (const name of VOICE_NAMES) assert(w[name] >= 0 && w[name] <= 1);
    assert.equal(w.kane, 1);
    if (time !== 'evening') assert.equal(w.koorogi, 0);
    if (time === 'morning' || time === 'noon') assert.equal(w.kaeru, 0);
  }
  assert(voiceLikelihood({ forest: 1 }, 'noon').higurashi < voiceLikelihood({ forest: 1 }, 'morning').higurashi / 4);
  assert(voiceLikelihood({ paddy: 1 }, 'golden').kaeru < voiceLikelihood({ paddy: 1 }, 'evening').kaeru / 4);
  assert(voiceLikelihood({ shore: 1 }, 'noon').tobi > 0);
  assert(voiceLikelihood({ town: 1 }, 'noon').suzume > 0);
  assert(voiceLikelihood({ pass: 1 }, 'morning').uguisu > 0);
});
test('seeded intervals stay inside their bounds, extend with scarcity, and zero never schedules', () => {
  const rng = mulberry32(42);
  for (const name of VOICE_NAMES) for (let i = 0; i < 100; i++) {
    const [lo, hi] = VOICE_INTERVALS[name], v = voiceInterval(name, 1, 'noon', rng);
    assert(v >= lo && v <= hi); assert.equal(voiceInterval(name, 0, 'evening', rng), Infinity);
    assert.equal(voiceInterval(name, .25, 'noon', mulberry32(i)), 2 * voiceInterval(name, 1, 'noon', mulberry32(i)));
  }
  for (let i = 0; i < 100; i++) { const v = voiceInterval('kane', 1, 'evening', rng); assert(v >= 45 && v <= 80); }
  const s = createSoundscapeState(), l = listener();
  for (let i = 0; i < 5000; i++) { stepSoundscape(s, .1, l, {}, 'evening', null); assert.equal(s.started.length, 0); }
  for (const name of VOICE_NAMES) assert.equal(s.tracks[name].due, Infinity);
});
test('caps 6 plus one bell (light/adapt3 3), no overlapping duplicate species, individuals alternate world anchors', () => {
  const s = createSoundscapeState(), l = listener(), temple = { x: 30, z: 40, distance: 50 };
  for (const name of VOICE_NAMES.slice(0, 6)) assert(startSoundscapeVoice(s, name, l, temple, 6));
  assert.equal(startSoundscapeVoice(s, 'karasu', l, temple, 6), null);
  assert(startSoundscapeVoice(s, 'kane', l, temple, 6));
  assert.equal(s.slots.filter(v => v.active).length, 7);
  assert.equal(startSoundscapeVoice(s, 'kane', l, temple, 6), null);
  assert.equal(startSoundscapeVoice(s, 'higurashi', l, temple, 6), null);
  assert.equal(soundscapeLimit('standard', 0), 6); assert.equal(soundscapeLimit('standard', 2), 4);
  assert.equal(soundscapeLimit('standard', 3), 3); assert.equal(soundscapeLimit('light', 0), 3);
  resetSoundscape(s);
  const coordinates = [];
  for (let i = 0; i < 6; i++) {
    const v = startSoundscapeVoice(s, 'higurashi', l, temple, 6);
    const d = Math.hypot(v.x, v.z); assert(d >= 8 && d <= 60);
    coordinates.push(`${v.x},${v.y},${v.z}`); v.active = false;
  }
  assert.equal(new Set(coordinates).size, 3); assert.equal(coordinates[0], coordinates[3]);
});
test('world position is fixed as listener moves and turns; source distance darkens and attenuates; gust only softens insects', () => {
  const p = { name: 'suzume', x: 12, y: 1.7, z: 0 }, l = listener();
  assert(sourceSpatial(p, l).pan > 0);
  l.yaw = Math.PI; assert(sourceSpatial(p, l).pan < 0);
  l.yaw = 0; l.x = 24; assert(sourceSpatial(p, l).pan < 0);
  const far = { ...p, x: 200 }, near = sourceSpatial(p, listener()), distant = sourceSpatial(far, listener());
  assert(distant.gain < near.gain); assert(distant.hz < near.hz);
  assert.equal(p.x, 12); assert.equal(sourceSpatial(p, listener(), 1).gain, near.gain);
  const insect = { ...p, name: 'higurashi' }; assert(sourceSpatial(insect, listener(), 1).gain < sourceSpatial(insect, listener(), 0).gain);
  assert(sourceSpatial(p, listener(), 0, true).gain < near.gain / 3);
  assert.equal(bellNear(0), 1); assert.equal(bellNear(60), 1); assert.equal(bellNear(900), 0);
  let previous = 1;
  for (let d = 60; d <= 1000; d++) { const v = bellNear(d); assert(v <= previous && v >= 0); previous = v; }
});
test('temple entry rings within 20–40s from the nearest place; ordinary gaps resume and out-of-range bells stay silent', () => {
  for (const time of ['noon', 'evening']) {
    const s = createSoundscapeState(), l = listener(), temple = { x: 32, y: 4, z: -20, distance: 38 };
    let start = null;
    for (let i = 0; i < 420; i++) {
      stepSoundscape(s, .1, l, { temple: 1 }, time, temple);
      for (const v of s.started) if (v.name === 'kane') { start = s.time; assert.equal(v.x, temple.x); assert.equal(v.z, temple.z); assert.equal(v.y, temple.y); }
    }
    assert(start >= 20 && start <= 40.2);
    const remaining = s.tracks.kane.due - start; assert(remaining >= (time === 'evening' ? 45 : 150));
    assert(remaining <= (time === 'evening' ? 80 : 300));
  }
  const s = createSoundscapeState();
  for (let i = 0; i < 4000; i++) { stepSoundscape(s, 1, listener(), {}, 'evening', { x: 1000, z: 0, distance: 1000 }); assert.equal(s.started.length, 0); }
});
test('test mode uses front 12m every 3s, quiet time after teleport/reset, and only birds/bells above 60m', () => {
  const s = createSoundscapeState(), l = listener(), options = { soundtest: 'higurashi' }, starts = [];
  for (let i = 0; i < 80; i++) {
    stepSoundscape(s, .1, l, {}, 'noon', null, options);
    for (const v of s.started) { starts.push(s.time); assert.equal(v.name, 'higurashi'); assert.equal(v.x, 0); assert.equal(v.z, -12); }
  }
  assert.equal(starts.length, 3); assert(Math.abs(starts[0] - 1.5) < 1e-8);
  assert(Math.abs(starts[1] - starts[0] - 3) < 1e-8);
  l.x = 100; stepSoundscape(s, .1, l, {}, 'noon', null, options); assert.equal(s.started.length, 0); assert.equal(s.slots.filter(v => v.active).length, 0);
  for (let i = 0; i < 14; i++) { stepSoundscape(s, .1, l, {}, 'noon', null, options); assert.equal(s.started.length, 0); }
  stepSoundscape(s, .1, l, {}, 'noon', null, options); assert.equal(s.started.length, 1);
  const high = createSoundscapeState(); l.high = true; l.flying = true; l.y = 80;
  for (let i = 0; i < 2000; i++) {
    stepSoundscape(high, .1, l, habitat, 'morning', { x: 5, z: 5, distance: 7 });
    for (const v of high.started) assert(BIRDS.includes(v.name) || v.name === 'kane');
  }
});
test('a synthetic 10-minute walk is deterministic, stays capped, and never reuses an occupied world source', () => {
  function run() {
    const s = createSoundscapeState(), l = listener(), out = [];
    for (let i = 0; i < 6000; i++) {
      l.x += .1; stepSoundscape(s, .1, l, habitat, 'evening', { x: 10, z: 10, distance: 20 });
      const active = s.slots.filter(v => v.active), names = active.map(v => v.name);
      assert(active.filter(v => v.name !== 'kane').length <= 6); assert.equal(names.length, new Set(names).size);
      for (const v of s.started) out.push([s.time, v.name, v.x, v.y, v.z]);
    }
    return JSON.stringify(out);
  }
  assert.equal(run(), run());
});
