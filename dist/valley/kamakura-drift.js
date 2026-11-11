import { isEveningLike } from './kamakura-atmosphere.js';
// W2c-16: deterministic airborne seeds and the CPU twin of the vertex motion.
import { mulberry32 } from './scatter.js';
import { GUST, GUST_GLSL, gustPhase } from './kamakura-gust.js';

export const DRIFT = Object.freeze({
  // Sizes are larger than life on purpose: at game resolution a 3 cm petal is under one pixel beyond 12 m, and a 72 m box left only a
  // handful of particles near the camera (measured in real Chrome: no visible difference from drift=0). 44 m keeps them where they read.
  // The floor of the box sits below the ground and fades over a short distance only: with the same 2-4 m rim as the sides, everything
  // within 2.5 m of the ground was hidden, which is exactly where the camera looks (measured: one leaf on screen in the cedar wood).
  // Counts are set from what should be on screen. Measured in real Chrome: only 3 to 6 % of the particles in the box are on screen
  // (the rest are behind the camera, above the view or behind trunks). Aim: about 40 leaves in a calm wood and 140 in a gust,
  // 20 to 80 petals and 40 to 120 motes in a meadow. calm is the share that stays outside a gust band.
  width: 32, height: 12, bottom: -2.5, edge: 4, deadEdge: 2, floorEdge: 1.5, floorDead: .15,
  standard: 9800, light: 3600, calm: .3, sampleSeconds: .25, smoothSeconds: 1.5,
  cameraNear: 2, cameraFull: 3, minPixels: 1.2, fullPixels: 2.2, glowPixels: 2.4,
  flutterRate: 1.3, liftRate: .8, liftScale: .45, rotationRate: 1.4,
  windFloor: .65, windGain: .35, windMax: 2,
});
export const DRIFT_KINDS = Object.freeze(['leaf', 'petal', 'dust', 'firefly']);
export const DRIFT_SHARE = Object.freeze([.33, .28, .31, .08]);
export const DRIFT_SPEED = Object.freeze([1.35, 1.1, .32, .16]);
export const DRIFT_GUST = Object.freeze([1, .8, .22, .1]);
export const DRIFT_FALL = Object.freeze([.45, .22, .035, 0]);
export const DRIFT_FLUTTER = Object.freeze([.48, .36, .13, .28]);
export const DRIFT_SIZE = Object.freeze([[.10, .18], [.07, .12], [.05, .10], [.06, .10]].map(Object.freeze));
const clamp = x => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const wrap = (x, low, span) => x - Math.floor((x - low) / span) * span;

export function driftAmounts(habitat, timeOfDay, out = {}) {
  const forest = clamp(habitat.forest || 0), meadow = clamp(habitat.meadow || 0);
  const land = 1 - Math.max(clamp(habitat.sand || 0), clamp(habitat.shore || 0));
  out.leaf = clamp(.85 * forest + .15 * (habitat.town || 0) + .2 * (habitat.temple || 0) + .22 * meadow) * land;
  out.petal = clamp(.9 * meadow + .6 * (habitat.temple || 0) + .12 * (habitat.town || 0)) * (1 - forest * .97) * land;
  // Blind critique of stills (R10): evenly spread bright motes read as snow or dust over a meadow. A third fewer.
  out.dust = clamp((.2 + .4 * meadow + .2 * (habitat.bare || 0)) * (1 - forest * .7)
    * (timeOfDay === 'morning' || isEveningLike(timeOfDay) ? 1.3 : 1)) * land;
  out.firefly = isEveningLike(timeOfDay) ? clamp(.85 * (habitat.river || 0) + .65 * (habitat.paddy || 0)) * land : 0;
  return out;
}

export function driftSeeds(count, seed = 1601) {
  const rand = mulberry32(seed), out = [];
  let kind = 0, boundary = Math.round(count * DRIFT_SHARE[0]);
  for (let i = 0; i < count; i++) {
    while (i >= boundary && kind < 3) { kind++; boundary = Math.round(count * DRIFT_SHARE.slice(0, kind + 1).reduce((a, b) => a + b, 0)); }
    const x = (rand() - .5) * DRIFT.width, y = DRIFT.bottom + rand() ** 2 * DRIFT.height, z = (rand() - .5) * DRIFT.width;
    const phase = rand() * Math.PI * 2, size = DRIFT_SIZE[kind][0] + rand() * (DRIFT_SIZE[kind][1] - DRIFT_SIZE[kind][0]);
    const roll = rand(), tint = rand(), ay = rand() * 2 - 1, angle = rand() * Math.PI * 2, r = Math.sqrt(1 - ay * ay);
    out.push({ x, y, z, phase, size, kind, roll, tint, ax: r * Math.cos(angle), ay, az: r * Math.sin(angle) });
  }
  return out;
}

// Wrap the advected anchor BEFORE asking the shared wind about this world location.
// Adding viewer to the seed would drag the air with the hero. Here viewer only selects
// a world-space copy. The 2 m dead rim hides both anchor and final-position recycling.
export function driftPosition(seed, time, windDir, viewer, out = {}, speedScale = 1, wind = 1) {
  const k = seed.kind, t = time * speedScale, flow = DRIFT.windFloor + Math.max(0, Math.min(DRIFT.windMax, wind)) * DRIFT.windGain;
  const lowX = viewer.x - DRIFT.width / 2, lowY = viewer.y + DRIFT.bottom, lowZ = viewer.z - DRIFT.width / 2;
  const bx = wrap(seed.x + windDir[0] * DRIFT_SPEED[k] * flow * t, lowX, DRIFT.width);
  const by = wrap(seed.y - DRIFT_FALL[k] * t, lowY, DRIFT.height);
  const bz = wrap(seed.z + windDir[1] * DRIFT_SPEED[k] * flow * t, lowZ, DRIFT.width);
  const phase = gustPhase(bx, bz, time, windDir[0], windDir[1]);
  // Integral of the shared sinusoidal phase: derivative is positive at the band crest.
  // Unlike band*time this never jumps at the entry/exit of a gust.
  const push = DRIFT_GUST[k] * speedScale * Math.cos(phase);
  const flutter = DRIFT_FLUTTER[k] * Math.sin(t * DRIFT.flutterRate + seed.phase);
  out.x = wrap(bx + windDir[0] * push - windDir[1] * flutter, lowX, DRIFT.width);
  out.y = wrap(by + DRIFT_FLUTTER[k] * DRIFT.liftScale * Math.sin(t * DRIFT.liftRate + seed.phase), lowY, DRIFT.height);
  out.z = wrap(bz + windDir[1] * push + windDir[0] * flutter, lowZ, DRIFT.width);
  const edge = Math.min(bx - lowX, lowX + DRIFT.width - bx, lowY + DRIFT.height - by, bz - lowZ, lowZ + DRIFT.width - bz,
    out.x - lowX, lowX + DRIFT.width - out.x, lowY + DRIFT.height - out.y, out.z - lowZ, lowZ + DRIFT.width - out.z);
  const floor = Math.min(by - lowY, out.y - lowY);
  out.fade = smooth(DRIFT.deadEdge, DRIFT.edge, edge) * smooth(DRIFT.floorDead, DRIFT.floorEdge, floor);
  return out;
}

// One source for every motion constant in JS and GLSL. All interpolated numbers
// include a decimal point, including negative bounds and integer-valued constants.
const f = n => n.toFixed(6);
const v4 = values => `vec4(${values.map(f).join(', ')})`;
export const DRIFT_GLSL = `
${GUST_GLSL}
const vec3 kzDriftBox = vec3(${f(DRIFT.width)}, ${f(DRIFT.height)}, ${f(DRIFT.width)});
const vec4 kzDriftSpeed = ${v4(DRIFT_SPEED)};
const vec4 kzDriftPush = ${v4(DRIFT_GUST)};
const vec4 kzDriftFall = ${v4(DRIFT_FALL)};
const vec4 kzDriftFlutter = ${v4(DRIFT_FLUTTER)};
vec3 kzDriftPosition(vec3 origin, int kind, float phaseSeed, out float fade) {
  float t = uDriftTime * uDriftMotion;
  vec3 low = uDriftViewer + vec3(-${f(DRIFT.width / 2)}, ${f(DRIFT.bottom)}, -${f(DRIFT.width / 2)});
  float flow = ${f(DRIFT.windFloor)} + clamp(uDriftWind, 0.0, ${f(DRIFT.windMax)}) * ${f(DRIFT.windGain)};
  vec3 anchor = origin + vec3(uDriftDir.x * kzDriftSpeed[kind] * flow * t, -kzDriftFall[kind] * t, uDriftDir.y * kzDriftSpeed[kind] * flow * t);
  anchor = low + mod(anchor - low, kzDriftBox);
  float phase = dot(anchor.xz, uDriftDir) * ${f(GUST.wave)} - uDriftTime * ${f(GUST.speed)}
    + kzGustNoise(anchor.xz * ${f(GUST.noiseScale)}) * ${f(GUST.noiseAmount)};
  float push = kzDriftPush[kind] * uDriftMotion * cos(phase);
  float flutter = kzDriftFlutter[kind] * sin(t * ${f(DRIFT.flutterRate)} + phaseSeed);
  vec3 point = anchor + vec3(uDriftDir.x * push - uDriftDir.y * flutter,
    kzDriftFlutter[kind] * ${f(DRIFT.liftScale)} * sin(t * ${f(DRIFT.liftRate)} + phaseSeed), uDriftDir.y * push + uDriftDir.x * flutter);
  point = low + mod(point - low, kzDriftBox);
  vec3 rimLow = min(anchor - low, point - low), rimHigh = min(low + kzDriftBox - anchor, low + kzDriftBox - point);
  fade = smoothstep(${f(DRIFT.deadEdge)}, ${f(DRIFT.edge)}, min(min(rimLow.x, rimLow.z), min(rimHigh.x, min(rimHigh.y, rimHigh.z))))
    * smoothstep(${f(DRIFT.floorDead)}, ${f(DRIFT.floorEdge)}, rimLow.y);
  return point;
}
vec3 kzDriftRotate(vec3 p) {
  float angle = aDriftShape.z + uDriftTime * uDriftMotion * (${f(DRIFT.rotationRate)} + aDriftShape.w);
  float c = cos(angle), s = sin(angle);
  return p * c + cross(aDriftAxis, p) * s + aDriftAxis * dot(aDriftAxis, p) * (1.0 - c);
}
`;
