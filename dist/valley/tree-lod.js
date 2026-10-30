// Enter fully before the outgoing alpha-cut crown starts to leave: no dither holes.
const smooth = (a, b, d) => { const t = Math.max(0, Math.min(1, (d - a) / (b - a))); return t * t * (3 - 2 * t); };
export function lodWeights(distance, { lod: [a, b], blend: w }) {
  return [1 - smooth(a, a + 2 * w, distance), smooth(a - 2 * w, a, distance) * (1 - smooth(b, b + 2 * w, distance)), smooth(b - 2 * w, b, distance)];
}
export function lodMembership(distance, { lod: [a, b], blend: w }, margin = 6) {
  return [distance - margin < a + 2 * w, distance + margin > a - 2 * w && distance - margin < b + 2 * w, distance + margin > b - 2 * w];
}
export function uLodFor(level, { lod: [a, b], blend: w }) {
  return level === 0 ? [-1, -1, a, a + 2 * w] : level === 1 ? [a - 2 * w, a, b, b + 2 * w] : [b - 2 * w, b, -1, -1];
}
export function fadeWeight(distance, range, blend) { return 1 - smooth(range - blend, range + blend, distance); }
// The camera-near foliage fade (8.1a, second round): 0 inside a, 1 beyond b. The leaf shader evaluates the same smoothstep.
export function nearFade(distance, [a, b]) { if (!(a >= 0 && b > a)) throw new RangeError('near fade'); return smooth(a, b, distance); }
