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
// Third round: the per-pixel fade read as a dotted veil (alpha-to-coverage / dither) in front of the camera. Each tuft,
// cluster and limb now shrinks toward its own pivot (its root on the limb, the cluster centre, the limb base) instead.
// The keep factor of a vertex uses the camera's distance to the segment pivot→vertex, so the side of a cluster facing the
// camera folds in first (pushed aside) and a tuft that points away keeps its far end. The vertex shader repeats this.
export function segmentDistance(c, p, v) {
  const d = [v[0] - p[0], v[1] - p[1], v[2] - p[2]], l = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const t = l > 0 ? Math.max(0, Math.min(1, ((c[0] - p[0]) * d[0] + (c[1] - p[1]) * d[1] + (c[2] - p[2]) * d[2]) / l)) : 0;
  return Math.hypot(c[0] - p[0] - d[0] * t, c[1] - p[1] - d[1] * t, c[2] - p[2] - d[2] * t);
}
export function nearShrink(camera, pivot, vertex, range) {
  const keep = nearFade(segmentDistance(camera, pivot, vertex), range);
  return { keep, position: [0, 1, 2].map(q => pivot[q] + (vertex[q] - pivot[q]) * keep) };
}
