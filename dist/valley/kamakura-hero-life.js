// W2c-16 hero life: deterministic, allocation-free steps; angles are degrees, lengths metres.
import { mulberry32 } from './scatter.js';

export const HERO_LIFE = Object.freeze({ breathHz: .22, tiredHz: .45, breathDeg: 1.2, tiredDeg: 2.4,   // degrees at the chest; .8 could not be seen from the follow camera (real Chrome)
  recovery: 2.2, clothStep: 1 / 120, maxSteps: 12, nodes: 8 });
const clamp = x => Math.max(0, Math.min(1, x));
const ease = x => { const u = clamp(x); return u * u * (3 - 2 * u); };
const follow = (x, y, rate, dt) => y + (x - y) * Math.exp(-rate * dt);

export function createHeroLife(seed = 0x163c) {
  const lookRng = mulberry32(seed), swayRng = mulberry32(seed + 1);
  return { time: 0, phase: 0, effort: 0, weight: 0, lookWeight: 0, breath: 0, look: 0, pitch: 0, sway: 0,
    frequency: HERO_LIFE.breathHz, amplitude: HERO_LIFE.breathDeg,
    lookRng, swayRng, lookAt: 4 + lookRng() * 5, lookStart: 0, lookCount: 0,
    lookFrom: 0, lookTo: 0, pitchFrom: 0, pitchTo: 0,
    swayStart: 0, swayEnd: 8 + swayRng() * 5, swayFrom: 0, swayTo: .4 + swayRng() * .8 };
}

// Mutates and returns the same state. Integrate effort analytically so breathing phase agrees across frame rates.
export function stepHeroLife(s, dt, speed = 0, allowed = true, reduced = false) {
  if (!(dt > 0)) return s;
  dt = Math.min(dt, .1);
  const running = speed >= 2.7, target = running ? 1 : 0, rate = running ? 2 : 1 / HERO_LIFE.recovery;
  const decay = Math.exp(-rate * dt), integral = target * dt + (s.effort - target) * (1 - decay) / rate;
  s.effort = target + (s.effort - target) * decay;
  s.phase = (s.phase + 2 * Math.PI * (HERO_LIFE.breathHz * dt + (HERO_LIFE.tiredHz - HERO_LIFE.breathHz) * integral)) % (2 * Math.PI);
  s.time += dt;
  const idle = allowed && speed < .3;
  s.weight = follow(s.weight, idle ? 1 : 0, idle ? 5 : 24, dt);
  s.lookWeight = follow(s.lookWeight, idle && !reduced ? 1 : 0, idle ? 5 : 18, dt);
  if (s.weight < .001 && !idle) s.weight = 0;
  if (s.lookWeight < .001 && !idle) s.lookWeight = 0;
  while (s.time >= s.lookAt) {
    s.lookFrom = s.lookTo; s.pitchFrom = s.pitchTo; s.lookStart = s.lookAt;
    s.lookCount++;
    s.lookTo = s.lookCount % 3 ? (s.lookRng() * 2 - 1) * 30 : 0;
    s.pitchTo = s.lookCount % 3 ? (s.lookRng() * 2 - 1) * 8 : 0;
    s.lookAt += 4 + s.lookRng() * 5;
  }
  while (s.time >= s.swayEnd) {
    s.swayFrom = s.swayTo; s.swayStart = s.swayEnd;
    s.swayEnd += 8 + s.swayRng() * 5;
    s.swayTo = -Math.sign(s.swayFrom) * (.4 + s.swayRng() * .8);
  }
  s.frequency = HERO_LIFE.breathHz + (HERO_LIFE.tiredHz - HERO_LIFE.breathHz) * s.effort;
  s.amplitude = (HERO_LIFE.breathDeg + (HERO_LIFE.tiredDeg - HERO_LIFE.breathDeg) * s.effort) * (reduced ? .5 : 1);
  s.breath = Math.sin(s.phase) * s.amplitude * s.weight;
  const u = ease(s.time - s.lookStart), v = ease((s.time - s.swayStart) / (s.swayEnd - s.swayStart));
  s.look = (s.lookFrom + (s.lookTo - s.lookFrom) * u) * s.lookWeight;
  s.pitch = (s.pitchFrom + (s.pitchTo - s.pitchFrom) * u) * s.lookWeight;
  s.sway = reduced ? 0 : (s.swayFrom + (s.swayTo - s.swayFrom) * v) * s.weight;
  if (!allowed) s.breath = s.look = s.pitch = s.sway = 0;
  return s;
}

export function createClothChain(length = .42, nodes = HERO_LIFE.nodes) {
  return { p: new Float64Array(nodes * 3), previous: new Float64Array(nodes * 3), root: new Float64Array(3),
    lastRoot: new Float64Array(3), stepRoot: new Float64Array(3), length, nodes, segment: length / (nodes - 1),
    accumulator: 0, ready: false, maxStretch: 0, nan: false, resets: 0, steps: 0 };
}

export function resetCloth(c, root = c.root) {
  for (let j = 0; j < 3; j++) c.root[j] = c.lastRoot[j] = c.stepRoot[j] = root[j];
  for (let i = 0; i < c.nodes; i++) {
    const k = i * 3;
    c.p[k] = c.previous[k] = root[0];
    c.p[k + 1] = c.previous[k + 1] = root[1] - c.segment * i;
    c.p[k + 2] = c.previous[k + 2] = root[2];
  }
  c.accumulator = 0; c.ready = true; c.resets++;
}

// The sphere is [x,y,z,r]; capsule [ax,ay,az,bx,by,bz,r]. No transient vectors.
export function projectClothPoint(p, k, sphere, capsule, groundAt) {
  if (sphere) pushOut(p, k, sphere[0], sphere[1], sphere[2], sphere[3]);
  if (capsule) {
    const dx = capsule[3] - capsule[0], dy = capsule[4] - capsule[1], dz = capsule[5] - capsule[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    const t = d2 > 1e-12 ? clamp(((p[k] - capsule[0]) * dx + (p[k + 1] - capsule[1]) * dy + (p[k + 2] - capsule[2]) * dz) / d2) : 0;
    pushOut(p, k, capsule[0] + t * dx, capsule[1] + t * dy, capsule[2] + t * dz, capsule[6]);
  }
  if (groundAt) p[k + 1] = Math.max(p[k + 1], groundAt(p[k], p[k + 2]) + .006);
}
function pushOut(p, k, x, y, z, radius) {
  const dx = p[k] - x, dy = p[k + 1] - y, dz = p[k + 2] - z, d = Math.hypot(dx, dy, dz);
  if (d >= radius) return;
  if (d < 1e-12) { p[k + 2] = z - radius; return; }
  const t = radius / d;
  p[k] = x + dx * t; p[k + 1] = y + dy * t; p[k + 2] = z + dz * t;
}

export function clothSubstep(c, h, root, windX, windZ, sphere, capsule, groundAt, iterations = 16) {
  if (c.flutter) c.time = (c.time || 0) + h;
  const p = c.p, prev = c.previous, damp = Math.exp(-7 * h), hh = h * h;
  for (let k = 3; k < p.length; k += 3) {
    for (let j = 0; j < 3; j++) {
      let a = j === 1 ? -9.81 : j === 0 ? windX : windZ;
      if (c.flutter && j !== 1) a = a * (.35 + .65 * k / (p.length - 3)) + .9 * (c.flutterScale ?? 1) * Math.sin(c.time * (j ? 3.7 : 4.3) + k * .37) * k / (p.length - 3);
      const old = p[k + j];
      p[k + j] += (old - prev[k + j]) * damp + a * hh;
      prev[k + j] = old;
    }
  }
  for (let j = 0; j < 3; j++) p[j] = prev[j] = root[j];
  for (let n = 0; n < iterations; n++) {
    for (let i = 1; i < c.nodes; i++) {
      const k = i * 3, a = k - 3, dx = p[k] - p[a], dy = p[k + 1] - p[a + 1], dz = p[k + 2] - p[a + 2];
      const d = Math.hypot(dx, dy, dz), correction = d > 1e-12 ? (d - c.segment) / d : 0, w = i === 1 ? 1 : .5;
      p[k] -= dx * correction * w; p[k + 1] -= dy * correction * w; p[k + 2] -= dz * correction * w;
      if (i > 1) { p[a] += dx * correction * .5; p[a + 1] += dy * correction * .5; p[a + 2] += dz * correction * .5; }
    }
    if (c.tiltLimit) for (let k = 3; k < p.length; k += 3) {
      const dx = p[k] - p[k - 3], dy = p[k + 1] - p[k - 2], dz = p[k + 2] - p[k - 1], d = Math.hypot(dx, dy, dz);
      const horizontal = Math.hypot(dx, dz), max = Math.sin(c.tiltLimit) * d;
      if (horizontal > max || dy > 0) {
        const ratio = horizontal > 1e-12 ? max / horizontal : 0;
        p[k] = p[k - 3] + dx * ratio; p[k + 1] = p[k - 2] - Math.cos(c.tiltLimit) * d; p[k + 2] = p[k - 1] + dz * ratio;
      }
    }
    for (let k = 3; k < p.length; k += 3) projectClothPoint(p, k, sphere, capsule, groundAt);
  }
}

// Wind is acceleration in m/s²; the view supplies the shared gust, never a second wind clock.
export function stepCloth(c, dt, root, windX = 0, windZ = 0, sphere = null, capsule = null, groundAt = null, iterations = 16) {
  c.steps = 0;
  const jump = Math.hypot(root[0] - c.lastRoot[0], root[1] - c.lastRoot[1], root[2] - c.lastRoot[2]);
  if (!c.ready || jump >= 1) { resetCloth(c, root); c.maxStretch = 0; c.nan = false; return c; }
  if (!(dt > 0)) return c;
  const h = HERO_LIFE.clothStep;
  c.accumulator = Math.min(c.accumulator + Math.min(dt, .1), h * HERO_LIFE.maxSteps);
  const steps = Math.min(HERO_LIFE.maxSteps, Math.floor((c.accumulator + 1e-12) / h));
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < 3; j++) c.stepRoot[j] = c.lastRoot[j] + (root[j] - c.lastRoot[j]) * (i + 1) / steps;
    clothSubstep(c, h, c.stepRoot, windX, windZ, sphere, capsule, groundAt, iterations);
  }
  c.accumulator -= steps * h; c.steps = steps;
  if (steps) for (let j = 0; j < 3; j++) c.lastRoot[j] = root[j];
  c.maxStretch = 0; c.nan = false;
  for (let k = 0; k < c.p.length; k++) if (!Number.isFinite(c.p[k])) c.nan = true;
  for (let k = 3; k < c.p.length; k += 3) c.maxStretch = Math.max(c.maxStretch,
    Math.hypot(c.p[k] - c.p[k - 3], c.p[k + 1] - c.p[k - 2], c.p[k + 2] - c.p[k - 1]) / c.segment - 1);
  return c;
}
