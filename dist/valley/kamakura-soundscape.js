// Habitat/time scheduling and world-space sources; no rendering or live audio objects.
import { mulberry32 } from './scatter.js';
import { VOICE_NAMES, voicePlan, voiceDuration } from './kamakura-voices.js';

export const SOUNDSCAPE_LEVELS = Object.freeze({
  // Peak gains before the limiter. Parent (recorded at the output of real Chrome, meadow at noon): the tonal voices stand clear of
  // the wind at these levels; the broadband sizzle of the aburazemi sat inside the gust noise at .09 and is raised.
  // In the evening forest (recorded for 40 s) the higurashi sang twice, thinly: its level and the cicadas' intervals are tightened
  // so that two or three overlap into a chorus, as they do in a real grove.
  higurashi: .075, aburazemi: .140, minmin: .050, uguisu: .125, tobi: .12,
  suzume: .10, karasu: .11, kaeru: .035, koorogi: .065, kane: .22, flockBurst: .045,
  targets: Object.freeze({ birdPeakDb: [-26, -18], cicadaRmsDb: [-40, -34], insectRmsDb: [-42, -36], bellPeakDb: [-16, -12] })
});
export const VOICE_INTERVALS = Object.freeze({ higurashi: [4, 10], aburazemi: [8, 18], minmin: [6, 14],
  uguisu: [12, 35], tobi: [20, 50], suzume: [6, 20], karasu: [25, 70], kaeru: [5, 12], koorogi: [18, 30], kane: [150, 300] });
export const BIRDS = Object.freeze(['uguisu', 'tobi', 'suzume', 'karasu']);
export const INSECTS = Object.freeze(['higurashi', 'aburazemi', 'minmin', 'koorogi']);
const clamp = v => Math.max(0, Math.min(1, v || 0));
const range = (rng, a, b) => a + (b - a) * rng();
const habitatGate = v => v > .1 ? clamp(v) : 0;
export function bellNear(distance) {
  if (!Number.isFinite(distance) || distance >= 900) return 0;
  return distance <= 60 ? 1 : ((900 - distance) / 840) ** 2;
}
export function voiceLikelihood(weights, time, templeDistance = Infinity, out = {}) {
  const w = weights, morning = time === 'morning', noon = time === 'noon', golden = time === 'golden', evening = time === 'evening';
  const trees = habitatGate(Math.max(w.forest || 0, (w.town || 0) * .6, (w.temple || 0) * .8));
  out.higurashi = habitatGate(w.forest) * (evening || morning ? 1 : noon ? .12 : .4);
  out.aburazemi = trees * (noon || golden ? 1 : 0);
  out.minmin = habitatGate(Math.max(w.forest || 0, w.temple || 0)) * (noon ? 1 : morning ? .7 : 0);
  out.uguisu = habitatGate(Math.max(w.forest || 0, (w.pass || 0) * .6)) * (morning ? 1 : noon ? .55 : 0);
  // A forest at the coast still suppresses the open-sky kite call.
  out.tobi = habitatGate(Math.max(w.shore || 0, w.town || 0)) * (1 - clamp((w.forest || 0) * 2)) * (morning || noon || golden ? 1 : 0);
  out.suzume = habitatGate(Math.max(w.town || 0, w.meadow || 0)) * (morning ? 1 : noon ? .75 : 0);
  out.karasu = trees * (evening ? .8 : morning ? .6 : 0);
  out.kaeru = habitatGate(Math.max(w.paddy || 0, w.river || 0)) * (evening ? 1 : golden ? .15 : 0);
  out.koorogi = habitatGate(Math.max(w.meadow || 0, (w.town || 0) * .6)) * (evening ? 1 : 0);
  out.kane = bellNear(templeDistance);
  return out;
}
export function voiceInterval(name, likelihood, time, rng) {
  if (!(likelihood > 0)) return Infinity;
  const bounds = name === 'kane' && time === 'evening' ? [45, 80] : VOICE_INTERVALS[name];
  return range(rng, bounds[0], bounds[1]) / Math.sqrt(likelihood);
}
export function sourceSpatial(source, listener, gust = 0, high = false, out = {}) {
  const dx = source.x - listener.x, dz = source.z - listener.z, dy = source.y - listener.y;
  const horizontal = Math.hypot(dx, dz), distance = Math.hypot(horizontal, dy);
  out.pan = horizontal > .001 ? .85 * (dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw)) / horizontal : 0;
  const bell = source.name === 'kane';
  out.gain = (bell ? bellNear(distance) : 1 / (1 + Math.max(0, distance - 12) / 35)) * (high ? .28 : 1);
  if (INSECTS.includes(source.name)) out.gain *= 1 - .25 * clamp(gust);
  out.hz = bell ? 180 + 3200 * bellNear(distance) : 1600 + 8400 / (1 + distance / 75);
  return out;
}
export function createSoundscapeState(seed = 0x6b7a7363) {
  const rng = mulberry32(seed), tracks = {};
  for (const name of VOICE_NAMES) tracks[name] = { due: Infinity, eligible: false, person: 0, individuals: [] };
  return { rng, time: 0, quietUntil: 1.5, likelihood: {}, tracks, enteredTemple: false, testDue: 1.5, testIndex: 0,
    serial: 0, started: [], slots: Array.from({ length: 7 }, (_, index) => ({ index, active: false })),
    lastX: NaN, lastY: 0, lastZ: 0, lastFlying: false };
}
export function resetSoundscape(state) {
  state.quietUntil = state.time + 1.5; state.testDue = state.quietUntil;
  state.enteredTemple = false; state.lastX = NaN;
  for (const name of VOICE_NAMES) { const t = state.tracks[name]; t.due = Infinity; t.eligible = false; t.individuals.length = 0; }
  for (const slot of state.slots) slot.active = false;
}
export function soundscapeLimit(quality, adapt) { return quality === 'light' || adapt >= 3 ? 3 : adapt >= 2 ? 4 : 6; }
export function startSoundscapeVoice(state, name, listener, temple, limit, test = false, event = null) {
  let slot = null, playing = 0;
  for (const s of state.slots) {
    if (s.active && s.name === name) return null; // Individuals of a species take turns.
    if (s.active && s.name !== 'kane') playing++;
    if (!s.active && !slot) slot = s;
  }
  if (!slot || (name !== 'kane' && playing >= limit)) return null;
  let x, y, z;
  if (event) { x = event.x; y = event.y; z = event.z; }
  else if (test) { x = listener.x - Math.sin(listener.yaw) * 12; y = listener.y; z = listener.z - Math.cos(listener.yaw) * 12; }
  else if (name === 'kane') {
    if (!temple) return null;
    x = temple.x; z = temple.z; y = temple.y ?? listener.ground + 3;
  } else {
    const track = state.tracks[name], multiple = INSECTS.includes(name) || name === 'kaeru';
    const person = multiple ? track.person++ % 3 : 0;
    let p = track.individuals[person];
    if (!p || Math.hypot(p.x - listener.x, p.z - listener.z) > 120) {
      const angle = state.rng() * Math.PI * 2, distance = multiple ? range(state.rng, 8 + person * 14, 22 + person * 19) : range(state.rng, 8, 60);
      p = { x: listener.x + Math.cos(angle) * distance, z: listener.z + Math.sin(angle) * distance,
        y: listener.ground + (BIRDS.includes(name) ? range(state.rng, 8, name === 'tobi' ? 45 : 18) : name === 'kaeru' || name === 'koorogi' ? .4 : 5) };
      track.individuals[person] = p;
    }
    x = p.x; y = p.y; z = p.z;
  }
  const parts = voicePlan(name, state.rng);
  Object.assign(slot, { active: true, id: ++state.serial, name, x, y, z, parts, end: state.time + voiceDuration(parts) });
  state.started.push(slot); return slot;
}
// listener is reusable scalar data; weights/temple are refreshed by the view every .5 seconds.
export function stepSoundscape(state, dt, listener, weights, time, temple, { limit = 6, soundtest = '' } = {}) {
  state.started.length = 0;
  state.time += Math.max(0, dt);
  const jump = Number.isFinite(state.lastX) && (Math.hypot(listener.x - state.lastX, listener.y - state.lastY, listener.z - state.lastZ) > 40 || listener.flying !== state.lastFlying);
  if (jump) resetSoundscape(state);
  state.lastX = listener.x; state.lastY = listener.y; state.lastZ = listener.z; state.lastFlying = listener.flying;
  for (const s of state.slots) if (s.active && s.end <= state.time) s.active = false;
  voiceLikelihood(weights, time, temple?.distance ?? Infinity, state.likelihood);
  if (soundtest) {
    if (state.time + 1e-8 >= state.testDue) {
      const name = soundtest === 'all' ? VOICE_NAMES[state.testIndex++ % VOICE_NAMES.length] : soundtest;
      // Test retriggers replace the previous same-species tail, keeping the exact 3s cadence.
      for (const s of state.slots) if (s.name === name) s.active = false;
      startSoundscapeVoice(state, name, listener, temple, limit, true);
      state.testDue += 3;
    }
    return jump;
  }
  if (weights.temple > 0 && !state.enteredTemple && temple) {
    state.tracks.kane.due = state.time + range(state.rng, 20, 40); state.tracks.kane.eligible = true;
  }
  state.enteredTemple = weights.temple > 0;
  for (const name of VOICE_NAMES) {
    const track = state.tracks[name], allowed = !listener.high || BIRDS.includes(name) || name === 'kane';
    const likelihood = allowed ? state.likelihood[name] : 0;
    if (!likelihood) { track.due = Infinity; track.eligible = false; continue; }
    if (!track.eligible) {
      track.eligible = true;
      track.due = state.time + voiceInterval(name, likelihood, time, state.rng);
    }
    if (state.time + 1e-8 < state.quietUntil || state.time < track.due) continue;
    if (startSoundscapeVoice(state, name, listener, temple, limit)) track.due = state.time + voiceInterval(name, likelihood, time, state.rng);
  }
  return jump;
}
