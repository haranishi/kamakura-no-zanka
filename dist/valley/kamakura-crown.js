// W2c-11 veg6: stable card identity and bounded, spatial crown detail. No clocks or RNG.
const clamp = x => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const CROWN_TILT_RADIANS = 25 * Math.PI / 180;
export const crownLookEnabled = search => new URLSearchParams(search).get('veg6') !== '0';
export function cardHash(x, y, z, salt = 0) {
  const n = Math.sin(x * 12.9898 + y * 37.719 + z * 78.233 + salt) * 43758.5453;
  return n - Math.floor(n);
}
export const cardVariation = (x, y, z) => [1 + .24 * (cardHash(x, y, z) - .5), .06 * (cardHash(x, y, z, 19.7) - .5)];
export const crownHeight = y => 1 + .06 * Math.max(-1, Math.min(1, y));
export const crownDistance = distance => 1 - smooth(60, 150, distance);
export const crownTransmission = (sun, rim, facing, back, strength = 1) => .08 * clamp(sun) * clamp(rim) * clamp(facing) * clamp(back) * clamp(strength);
export function crownNoise(x, y, z) {
  const p = [x, y, z].map(v => v / 1.1), base = p.map(Math.floor), f = p.map((v, i) => smooth(0, 1, v - base[i]));
  let value = 0;
  for (let k = 0; k < 8; k++) value += cardHash(base[0] + (k & 1), base[1] + ((k >> 1) & 1), base[2] + ((k >> 2) & 1)) * ((k & 1) ? f[0] : 1 - f[0]) * ((k & 2) ? f[1] : 1 - f[1]) * ((k & 4) ? f[2] : 1 - f[2]);
  return value;
}
export function crownGap(x, y, z, radius, distance, width = .005) {
  return smooth(.65, .8, radius) * crownDistance(distance) * smooth(.68 - width, .68 + width, crownNoise(x, y, z));
}
// Indexed quads have four consecutive vertices (cedar/pine); broadleaf shells emit
// separate triples. Cones and shared stand spheres use position as spatial identity.
export function crownAttributes(geometry) {
  const p = geometry.attributes.position, n = geometry.attributes.normal, ids = geometry.index?.array;
  const card = new Float32Array(p.count * 3), normals = new Float32Array(p.count * 3);
  const read = i => [p.getX(i), p.getY(i), p.getZ(i)];
  const unit = v => { const d = Math.hypot(...v) || 1; return v.map(c => c / d); };
  geometry.computeBoundingBox(); const box = geometry.boundingBox;
  const centre = [0, 1, 2].map(k => (box.min.getComponent(k) + box.max.getComponent(k)) / 2);
  // Start with the smooth shell normal, so seam/pole duplicates stay together.
  for (let i = 0; i < p.count; i++) { card.set(read(i), i * 3); normals.set([n.getX(i), n.getY(i), n.getZ(i)], i * 3); }
  for (let t = 0; ids && t < ids.length;) {
    const a = ids[t], b = ids[t + 1], c = ids[t + 2];
    const quad = t + 5 < ids.length && ids[t + 3] === a && ids[t + 4] === c && Math.max(a,b,c,ids[t+5]) - Math.min(a,b,c,ids[t+5]) === 3;
    const vertices = quad ? [a,b,c,ids[t+5]] : [a,b,c];
    // Only independently emitted faces can carry constant card attributes.
    const independent = quad || (a === t && b === t + 1 && c === t + 2);
    if (independent) {
      const points = vertices.map(read), mid = [0,1,2].map(k => points.reduce((sum, v) => sum + v[k], 0) / points.length);
      const e = points[1].map((v,k) => v - points[0][k]), f = points[2].map((v,k) => v - points[0][k]);
      let face = unit([e[1]*f[2]-e[2]*f[1], e[2]*f[0]-e[0]*f[2], e[0]*f[1]-e[1]*f[0]]);
      if (face.reduce((sum,v,k) => sum + v*(mid[k]-centre[k]),0) < 0) face = face.map(v => -v);
      // Crossed cards can share a centre; a small geometric offset separates their
      // world anchors without using vertex numbers or clone/insertion order.
      const edge = unit(e), anchor = mid.map((v,k) => v + .0137*face[k] + .021*edge[k]);
      for (const i of vertices) {
        const radial = unit(read(i).map((v,k) => v - centre[k]));
        // Replace (do not stack on) the shared cedar's existing .65 crown blend.
        normals.set(unit(face.map((v,k) => .4*v + .6*radial[k])), i*3); card.set(anchor,i*3);
      }
    }
    t += quad ? 6 : 3;
  }
  return { card, normals };
}
