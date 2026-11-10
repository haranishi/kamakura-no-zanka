// W2c-16f: deterministic wildlife rules. All hot-path outputs are caller-owned.
import { gustBand, gustPhase } from './kamakura-gust.js';

export const FAUNA = Object.freeze({
  // Parent (real Chrome, counted in pixels with the debug colours at 1080p): life-size animals at real distances cannot be seen.
  // A 1.6 m kite 150 m away was 10 px, a crow at 70 m 6 px, a dragonfly's body 1 px, and the walking camera shows only the
  // lowest 12 degrees of the sky. So the birds fly low, the kites keep a share of the frame height, and the small animals are
  // drawn about twice life-size in a 16 m box around the viewer.
  kiteCell: 130, kiteReach: 380, kiteFade: 50, kiteLow: 16, kiteHigh: 40, kiteNear: 30, kiteFar: 65, kiteSlow: 7, kiteFast: 11,
  kiteSize: 2.4, kitePixels: .026, kiteDihedral: .1, kiteStroke: .42, kiteBeat: 2.4, kiteSlots: 49,
  crowCell: 130, crowWindow: 26, crowRate: .3, crowLow: 6, crowHigh: 13, crowSlow: 9, crowFast: 12, crowReach: 220, crowFade: 50,
  crowSize: 1.3, crowBeat: 3.6, crowStroke: .55, crowSlots: 49, crowBirds: 5, crowCapacity: 60,
  // The birds on the ground are doves (half a metre across the wings), pale grey so that they show on dark grass. Sparrows
  // were 16 px at ten metres and left the frame in a second: the take-off now stays low (the walking camera sees only the lowest
  // 12 degrees of the sky), starts slowly and lasts longer.
  flockCell: 24, flockSlots: 12, flockBirds: 12,
  flockReach: 25, burstNear: 7, burstRun: 10, runSpeed: 3, returnRange: 30, returnWait: 40,
  flightSeconds: 3.2, flightDistance: 42, flightRise: 9, flightFade: 2.4, flightAngle: 14 * Math.PI / 180,
  box: 16, deadEdge: 1, edge: 3.5, minPixels: 1.2, fullPixels: 2.2, cameraNear: 1.5, cameraFull: 2.5,
  birdRate: 7, birdRateRange: 2, butterflyRate: 8, butterflyRateRange: 3, wingAmplitude: .85,
  butterflySize: .16, birdSize: .5, dragonflySize: .2, butterflies: 18, dragonflies: 20,
  butterflySlots: 72, dragonflySlots: 80,
});
const TAU = Math.PI * 2;
const clamp = x => Math.max(0, Math.min(1, x));
const smooth = (lo, hi, x) => { const u = clamp((x - lo) / (hi - lo)); return u * u * (3 - 2 * u); };
const hash = (x, z, salt) => { const n = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453; return n - Math.floor(n); };
const wrap = (p, lo) => p - Math.floor((p - lo) / FAUNA.box) * FAUNA.box;

export function faunaAmounts(h, time, out = {}) {
  const forest = clamp(h.forest || 0), land = (1 - forest) * (1 - clamp(h.sand || 0));
  // Kamakura's kites gather over the beach and the town; the shore gets more of them.
  out.kites = clamp(.3 * (h.town || 0) + .5 * (h.shore || 0)) * (1 - forest);
  out.crows = FAUNA.crowRate * (1 - .5 * forest);
  out.flocks = .5 * clamp((h.meadow || 0) + (h.town || 0) + (h.temple || 0)) * land;
  const flower = clamp((h.meadow || 0) + (h.temple || 0)) * land;
  const wet = clamp((h.river || 0) + (h.paddy || 0)) * (1 - forest);
  out.butterflies = time === 'evening' ? 0 : FAUNA.butterflies * flower;
  out.dragonflies = time === 'morning' ? 0 : FAUNA.dragonflies * wet;
  return out;
}

// Seeds are keyed by cell coordinates, never the camera or visitation order.
export function kiteCell(ix, iz, out = {}) {
  out.ix = ix; out.iz = iz;
  out.x = (ix + .2 + .6 * hash(ix, iz, 1)) * FAUNA.kiteCell;
  out.z = (iz + .2 + .6 * hash(ix, iz, 2)) * FAUNA.kiteCell;
  out.height = FAUNA.kiteLow + (FAUNA.kiteHigh - FAUNA.kiteLow) * hash(ix, iz, 3);
  out.radius = FAUNA.kiteNear + (FAUNA.kiteFar - FAUNA.kiteNear) * hash(ix, iz, 4);
  // A soaring kite keeps its air speed: wide circles take longer (a fixed period made the widest circle fly at 25 m/s).
  out.period = TAU * out.radius / (FAUNA.kiteSlow + (FAUNA.kiteFast - FAUNA.kiteSlow) * hash(ix, iz, 5));
  out.phase = TAU * hash(ix, iz, 6);
  out.roll = hash(ix, iz, 7); return out;
}
export function kitePosition(s, time, dir, out = {}) {
  const angle = s.phase + time * TAU / s.period;
  // Bounded migration keeps the orbit in its original cell for arbitrarily long sessions.
  const drift = 12 * Math.sin(time * .012 + s.phase) + .3 * Math.cos(gustPhase(s.x, s.z, time, dir[0], dir[1]));
  out.centerX = s.x + dir[0] * drift; out.centerZ = s.z + dir[1] * drift;
  out.x = out.centerX + s.radius * Math.cos(angle); out.z = out.centerZ + s.radius * Math.sin(angle);
  // Slow rise and sink on the thermal, and a bank that leans into the circle so the wings show their face.
  out.y = s.height + 2.5 * Math.sin(time * .19 + s.phase * 3);
  out.yaw = Math.PI - angle; out.bank = -(.2 + .06 * Math.sin(time * .43 + s.phase)); out.fade = 1; return out;
}
// Crows cross overhead in twos to fives. A crossing belongs to a cell and a time window, never to the camera.
const hash3 = (x, z, w, salt) => hash(x + w * 7.31, z - w * 3.17, salt);
export const crowWindow = (ix, iz, time) => Math.floor(time / FAUNA.crowWindow + hash(ix, iz, 30));
export function crowCrossing(ix, iz, window, out = {}) {
  out.ix = ix; out.iz = iz; out.window = window; out.roll = hash3(ix, iz, window, 31);
  out.x = (ix + .2 + .6 * hash3(ix, iz, window, 32)) * FAUNA.crowCell;
  out.z = (iz + .2 + .6 * hash3(ix, iz, window, 33)) * FAUNA.crowCell;
  const heading = TAU * hash3(ix, iz, window, 34);
  out.dx = Math.cos(heading); out.dz = Math.sin(heading);
  out.count = 2 + Math.floor((FAUNA.crowBirds - 1) * hash3(ix, iz, window, 35));
  out.height = FAUNA.crowLow + (FAUNA.crowHigh - FAUNA.crowLow) * hash3(ix, iz, window, 36);
  out.speed = FAUNA.crowSlow + (FAUNA.crowFast - FAUNA.crowSlow) * hash3(ix, iz, window, 37);
  out.phase = TAU * hash3(ix, iz, window, 38);
  out.start = (window - hash(ix, iz, 30)) * FAUNA.crowWindow; return out;
}
export const crowSpan = c => FAUNA.crowWindow * c.speed / 2;
export function crowPosition(c, index, time, out = {}) {
  const u = (time - c.start) / FAUNA.crowWindow, along = (u - .5) * FAUNA.crowWindow * c.speed;
  const side = index - (c.count - 1) / 2, sway = Math.sin(time * .31 + c.phase + index * 1.7);
  const a = along - Math.abs(side) * 1.8 - .9 * Math.sin(c.phase + index * 2.1), l = side * 2.4 + 1.1 * sway;
  out.x = c.x + c.dx * a - c.dz * l; out.z = c.z + c.dz * a + c.dx * l;
  out.y = c.height + .7 * Math.sin(time * .9 + c.phase + index * 2.3);
  out.yaw = Math.atan2(-c.dx, -c.dz); out.bank = .12 * Math.cos(time * .31 + c.phase + index * 1.7);
  out.flap = 1; out.fade = smooth(0, .06, u) * (1 - smooth(.94, 1, u)); return out;
}
export function flockCell(ix, iz, out = {}) {
  out.ix = ix; out.iz = iz; out.x = (ix + .15 + .7 * hash(ix, iz, 11)) * FAUNA.flockCell;
  out.z = (iz + .15 + .7 * hash(ix, iz, 12)) * FAUNA.flockCell;
  out.count = FAUNA.flockBirds - 5 + Math.floor(6 * hash(ix, iz, 13)); out.roll = hash(ix, iz, 14);
  out.phase = hash(ix, iz, 15) * TAU; return out;
}
export function flockAllowed(s, h, terrain) {
  return (h.forest || 0) < .8 && (h.sand || 0) < .25 && terrain.waterAt(s.x, s.z) <= .01
    && terrain.slopeAt(s.x, s.z) < 28 && terrain.walkable(s.x, s.z);
}
export function createFlockState() {
  // The queue holds at most 16 events. Seventeen preallocated records guarantee one
  // free record even if the sound layer has not drained old events before a slot is reused.
  const eventPool = Array.from({ length: 17 }, () => ({ type: 'flockBurst', x: 0, y: 0, z: 0 }));
  return { used: false, ix: 0, iz: 0, x: 0, y: 0, z: 0, count: 0, phase: 0, roll: 0,
    mode: 0, started: 0, awaySince: -1, dx: 1, dz: 0, quiet: false, probability: 0,
    eventPool, event: eventPool[0] };
}
export function resetFlock(s, cell, y) {
  s.used = true; s.ix = cell.ix; s.iz = cell.iz; s.x = cell.x; s.z = cell.z; s.y = y;
  s.count = cell.count; s.phase = cell.phase; s.roll = cell.roll;
  s.mode = 0; s.started = 0; s.awaySince = -1; s.quiet = false; return s;
}
// mode: 0 grounded, 1 taking off, 2 absent. A single transition owns the sound event.
export function updateFlock(s, hero, time, flying, reduced, events) {
  const dx = s.x - hero.pos.x, dz = s.z - hero.pos.z, d = Math.hypot(dx, dz);
  if (s.mode === 0) {
    if (flying || !(d <= FAUNA.burstNear || (hero.speed >= FAUNA.runSpeed && d <= FAUNA.burstRun))) return false;
    s.mode = 1; s.started = time; s.quiet = reduced; s.awaySince = -1;
    s.dx = d > .001 ? dx / d : Math.cos(s.phase); s.dz = d > .001 ? dz / d : Math.sin(s.phase);
    if (!reduced) {
      if (events.length >= 16) {
        const drop = events.length - 15;
        for (let i = 0; i < 15; i++) events[i] = events[i + drop];
        events.length = 15;
      }
      for (const event of s.eventPool) if (!events.includes(event)) { s.event = event; break; }
      s.event.x = s.x; s.event.y = s.y; s.event.z = s.z;
      events.push(s.event);
    }
    return true;
  }
  if (time - s.started >= FAUNA.flightSeconds + .25) s.mode = 2;
  if (d >= FAUNA.returnRange) {
    if (s.awaySince < 0) s.awaySince = time;
    if (time - s.awaySince >= FAUNA.returnWait) { s.mode = 0; s.awaySince = -1; }
  } else s.awaySince = -1;
  return false;
}
export function flockBirdPosition(s, index, time, out = {}) {
  const phase = s.phase + index * 2.39996, ox = Math.cos(phase) * (.4 + index * .22), oz = Math.sin(phase) * (.4 + index * .22);
  out.x = s.x + ox; out.z = s.z + oz; out.y = s.y + .08;
  out.yaw = phase + Math.floor(time / 2 + index * .3) * .7;
  out.bank = 0; out.flap = 0; out.fade = s.mode === 2 ? 0 : 1;
  if (s.mode === 0) {
    out.y += .025 * Math.max(0, Math.sin(time * 3.7 + phase)) ** 6;
    out.bank = .15 * Math.max(0, Math.sin(time * 2 + phase)) ** 10;
  } else if (s.quiet) out.fade *= 1 - smooth(0, .4, time - s.started);
  else {
    const elapsed = Math.max(0, time - s.started - index / 6 * .25), u = Math.min(1, elapsed / FAUNA.flightSeconds);
    // A fan of courses away from the walker; each bird leaves a moment after the one before it.
    const angle = (index - (s.count - 1) / 2) * .09, dx = s.dx * Math.cos(angle) - s.dz * Math.sin(angle), dz = s.dz * Math.cos(angle) + s.dx * Math.sin(angle);
    // Slow off the ground and then away: a steep first climb that levels out below the top of the walking camera's frame.
    const travel = FAUNA.flightDistance * (.35 * u + .65 * u * u);
    out.x += dx * travel; out.z += dz * travel; out.y += FAUNA.flightRise * (1 - (1 - u) * (1 - u)) * (.75 + .5 * ((index * .618) % 1));
    out.yaw = Math.atan2(-dx, -dz); out.bank = -.25;
    out.flap = elapsed > 0 ? .85 : 0; out.fade *= 1 - smooth(FAUNA.flightFade, FAUNA.flightSeconds, elapsed);
  }
  return out;
}
export function insectSeed(index, kind, out = {}) {
  out.x = (hash(index, kind, 21) - .5) * FAUNA.box; out.z = (hash(index, kind, 22) - .5) * FAUNA.box;
  out.phase = hash(index, kind, 23) * TAU; out.roll = hash(index, kind, 24);
  out.hold = .6 + .9 * hash(index, kind, 25); out.step = 1 + 2 * hash(index, kind, 26);
  out.dx = Math.cos(out.phase); out.dz = Math.sin(out.phase); out.kind = kind; return out;
}
export function insectPosition(s, time, dir, viewer, out = {}) {
  let x, z, y;
  if (s.kind === 0) {
    const t = time + s.phase;
    x = s.x + time * .18 + 1.2 * Math.sin(t * .7) + .5 * Math.sin(t * 1.9);
    z = s.z + .9 * Math.cos(t * .9) + .6 * Math.sin(t * 1.3);
    y = 1.1 + .7 * Math.sin(t * .83);
    out.yaw = Math.atan2(-(.18 + .84 * Math.cos(t * .7) + .95 * Math.cos(t * 1.9)), .81 * Math.sin(t * .9) - .78 * Math.cos(t * 1.3));
  } else {
    const period = s.hold + .3, t = time + s.phase, cycle = Math.floor(t / period), within = t - cycle * period;
    const progress = smooth(s.hold, period, within), travel = s.step * (cycle + progress);
    x = s.x + s.dx * travel; z = s.z + s.dz * travel; y = .8 + 1.7 * s.roll;
    out.yaw = Math.atan2(-s.dx, -s.dz);
  }
  const lowX = viewer.x - FAUNA.box / 2, lowZ = viewer.z - FAUNA.box / 2;
  out.x = wrap(x, lowX); out.z = wrap(z, lowZ);
  const rim = Math.min(out.x - lowX, lowX + FAUNA.box - out.x, out.z - lowZ, lowZ + FAUNA.box - out.z);
  const band = gustBand(out.x, out.z, time, dir[0], dir[1]);
  out.y = s.kind === 0 ? .4 + (y - .4) * (1 - .65 * band) : y;
  out.fade = smooth(FAUNA.deadEdge, FAUNA.edge, rim) * (s.kind === 0 ? 1 - .65 * band : 1);
  out.bank = s.kind === 0 ? .25 * Math.sin(time * 2 + s.phase) : 0; return out;
}
// Only articulation happens in GLSL; path positions above have no second implementation.
const f = n => n.toFixed(6);
export const FAUNA_GLSL = `
const float kzFaunaBirdRate = ${f(FAUNA.birdRate)};
const float kzFaunaBirdRange = ${f(FAUNA.birdRateRange)};
const float kzFaunaButterflyRate = ${f(FAUNA.butterflyRate)};
const float kzFaunaButterflyRange = ${f(FAUNA.butterflyRateRange)};
const float kzFaunaWing = ${f(FAUNA.wingAmplitude)};
const float kzFaunaKiteDihedral = ${f(FAUNA.kiteDihedral)};
const float kzFaunaKiteStroke = ${f(FAUNA.kiteStroke)};
const float kzFaunaKiteBeat = ${f(FAUNA.kiteBeat)};
const float kzFaunaCrowStroke = ${f(FAUNA.crowStroke)};
const float kzFaunaCrowBeat = ${f(FAUNA.crowBeat)};
// kind: 0 kite, 1 small bird, 2 butterfly, 3 dragonfly, 4 crow.
float kzFaunaWingAngle(float kind, float phase, float roll, float flap, float time) {
  if (kind < 0.5) {
    // A kite glides on raised wings and gives a few slow beats now and then.
    float cycle = fract((time + phase * 3.0) / (9.0 + 6.0 * roll));
    float beat = smoothstep(0.0, 0.03, cycle) * (1.0 - smoothstep(0.13, 0.17, cycle));
    return kzFaunaKiteDihedral + beat * kzFaunaKiteStroke * sin(time * 6.283185 * kzFaunaKiteBeat + phase);
  }
  if (kind > 3.5) return 0.08 + flap * kzFaunaCrowStroke * sin(time * 6.283185 * (kzFaunaCrowBeat + roll * 0.6) + phase);
  float rate = kind < 1.5 ? kzFaunaBirdRate + roll * kzFaunaBirdRange : kzFaunaButterflyRate + roll * kzFaunaButterflyRange;
  return flap * kzFaunaWing * sin(time * 6.283185 * rate + phase);
}
`;
