// kamakura-gust.js — W2c-16: the gust band, as one pure function, for everything that should move or sound with the same gust.
// Why: grass and trees already bend in travelling gust bands, but each shader carried its own copy of the formula and nothing outside a
// vertex shader could ask "is a gust passing here now?". Drifting particles, cloth and the wind sound read this, so a gust is seen, felt
// and heard at the same moment. The numbers mirror grassWind() in grass-view.js and the tree sway in tree-materials.js (tests pin them).
// Coordinates: x east, z south, metres; time is the shared wind clock (wind.js uTime); dir is the unit wind direction [x, z].
export const GUST = Object.freeze({ wave: .045, speed: .9, noiseScale: .025, noiseAmount: .65, lo: .55, hi: .95 });
// Derived, for callers that plan ahead: one band every period seconds, travelling at frontSpeed metres per second.
export const GUST_PERIOD_S = 2 * Math.PI / GUST.speed;
export const GUST_FRONT_SPEED = GUST.speed / GUST.wave;

const lattice = (i, j) => Math.sin(i * 12.9898 + j * 78.233);
// Same value noise as grassNoise(): a sine-hashed lattice with smoothstep interpolation, in [-1, 1].
export function gustNoise(x, z) {
  const ax = Math.floor(x), az = Math.floor(z);
  let fx = x - ax, fz = z - az;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const top = lattice(ax, az) + (lattice(ax + 1, az) - lattice(ax, az)) * fx;
  const bottom = lattice(ax, az + 1) + (lattice(ax + 1, az + 1) - lattice(ax, az + 1)) * fx;
  return top + (bottom - top) * fz;
}
export function gustPhase(x, z, time, dirX, dirZ) {
  return (x * dirX + z * dirZ) * GUST.wave - time * GUST.speed + gustNoise(x * GUST.noiseScale, z * GUST.noiseScale) * GUST.noiseAmount;
}
// 0 outside a gust, 1 at its crest. About a fifth of the time is inside a band.
export function gustBand(x, z, time, dirX, dirZ) {
  const u = Math.max(0, Math.min(1, (Math.sin(gustPhase(x, z, time, dirX, dirZ)) - GUST.lo) / (GUST.hi - GUST.lo)));
  return u * u * (3 - 2 * u);
}
// A soft 0–1 "how windy is it here now" for sound and particles: the band plus the slow swell under it, never fully still.
export function gustLevel(x, z, time, dirX, dirZ) {
  const phase = gustPhase(x, z, time, dirX, dirZ);
  return Math.max(0, Math.min(1, .28 + .14 * Math.sin(phase * .5 + 1.3) + .58 * gustBand(x, z, time, dirX, dirZ)));
}
// GLSL twin for shaders that need the band (declare once; names are prefixed to avoid collisions and reserved words).
export const GUST_GLSL = `
float kzGustNoise(vec2 p) {
  vec2 a = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sin(dot(a, vec2(12.9898, 78.233))), sin(dot(a + vec2(1.0, 0.0), vec2(12.9898, 78.233))), f.x),
    mix(sin(dot(a + vec2(0.0, 1.0), vec2(12.9898, 78.233))), sin(dot(a + vec2(1.0, 1.0), vec2(12.9898, 78.233))), f.x), f.y);
}
float kzGustBand(vec2 xz, float time, vec2 dir) {
  float phase = dot(xz, dir) * ${GUST.wave.toFixed(3)} - time * ${GUST.speed.toFixed(1)} + kzGustNoise(xz * ${GUST.noiseScale.toFixed(3)}) * ${GUST.noiseAmount.toFixed(2)};
  return smoothstep(${GUST.lo.toFixed(2)}, ${GUST.hi.toFixed(2)}, sin(phase));
}`;
