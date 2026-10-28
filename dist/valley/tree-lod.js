// Pure distance policy. Adjacent transition bands must not overlap.
const smooth = (a, b, d) => { const t = Math.max(0, Math.min(1, (d - a) / (b - a))); return t * t * (3 - 2 * t); };
export function lodWeights(distance, { lod: [a, b], blend: w }) {
  const enter = smooth(a - w, a + w, distance), far = smooth(b - w, b + w, distance);
  return [1 - enter, enter * (1 - far), far];
}
export function lodMembership(distance, { lod: [a, b], blend: w }, margin = 6) {
  return [distance - margin < a + w, distance + margin > a - w && distance - margin < b + w, distance + margin > b - w];
}
export function uLodFor(level, { lod: [a, b], blend: w }) {
  return level === 0 ? [-1, -1, a - w, a + w] : level === 1 ? [a - w, a + w, b - w, b + w] : [b - w, b + w, -1, -1];
}
export function fadeWeight(distance, range, blend) { return 1 - smooth(range - blend, range + blend, distance); }
