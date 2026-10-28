// Deterministic specimen geometry. Cached templates are borrowed; views clone them.
import * as THREE from 'three';

const TAU = Math.PI * 2, cache = new Map();
const heights = [20, 12, 13, 8, 3, 1.2];
const norm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
function seeded(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
class Mesher {
  constructor() { this.p = []; this.n = []; this.c = []; this.u = []; this.s = []; this.i = []; }
  vert(p, n, c, uv = [0, 0], sway = 0) {
    this.p.push(...p); this.n.push(...norm(n)); this.c.push(...c); this.u.push(...uv); this.s.push(sway); return this.s.length - 1;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  build() {
    const g = new THREE.BufferGeometry();
    for (const [name, a, n] of [['position', this.p, 3], ['normal', this.n, 3], ['color', this.c, 3], ['uv', this.u, 2], ['aSway', this.s, 1]]) g.setAttribute(name, new THREE.Float32BufferAttribute(a, n));
    g.userData.parts = this.parts || []; g.userData.tips = this.tips || []; g.setIndex(this.i); g.computeBoundingSphere(); return g;
  }
}
// Curved tapered tubes, alternating bark ridges and 5 buttresses at the buried foot.
function tube(m, a, b, radius, sides = 6, rings = 3, root = false, color = [.12, .083, .05], taper = .4) {
  const first = m.s.length, axis = norm(b.map((v, k) => v - a[k]));
  const side = norm([axis[1], -axis[0], 0]), cross = new THREE.Vector3(...axis).cross(new THREE.Vector3(...side)).toArray();
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    for (let k = 0; k <= sides; k++) {
      const angle = k / sides * TAU, nx = side.map((v, q) => v * Math.cos(angle) + cross[q] * Math.sin(angle));
      const flare = root ? 1 + .8 * Math.exp(-t * 24) * (.6 + .4 * Math.cos(angle * 5)) : 1;
      const r = radius * (1 - taper * t) * flare * ((k % sides) % 2 ? .91 : 1.09);
      const p = a.map((v, q) => v + (b[q] - v) * t + nx[q] * r);
      p[0] += Math.sin(t * Math.PI) * radius * .8;
      const shade = (.72 + .18 * ((k % sides) % 2)) * (root ? .45 + .55 * Math.min(1, t * 5) : 1);
      m.vert(p, nx, color.map(v => v * shade), [k / sides, t]);
    }
  }
  for (let j = 0; j < rings; j++) for (let k = 0; k < sides; k++) { const v = first + j * (sides + 1) + k; m.quad(v, v + 1, v + sides + 2, v + sides + 1); }
}
// Low polygon ellipsoid, biased toward the upper hemisphere. Outward normal + 30% up.
function clump(m, center, radii, sides, bands, cards, rnd, tile = 1, core = false) {
  const first = m.s.length;
  m.parts ??= [];
  m.parts.push({ first, sides, bands, center, radii, tile, core, cards });
  const circumference = TAU * Math.sqrt((radii[0] ** 2 + radii[2] ** 2) / 2);
  const arc = Math.PI * Math.sqrt((radii[0] ** 2 + radii[1] ** 2) / 2);
  for (let j = 0; j <= bands; j++) {
    const theta = j / bands * Math.PI;
    for (let k = 0; k <= sides; k++) {
      const a = k / sides * TAU, unit = [Math.sin(theta) * Math.cos(a), Math.cos(theta), Math.sin(theta) * Math.sin(a)];
      const p = center.map((v, q) => v + radii[q] * unit[q]);
      const radial = Math.hypot(center[0], center[2]);
      const outward = radial > .01 ? (unit[0] * center[0] + unit[2] * center[2]) / radial : -1;
      const shelter = 1 - .65 * (1 - Math.abs(unit[1])) * (1 - Math.max(0, outward));
      const exposure = .28 + .72 * Math.pow((unit[1] + 1) / 2, .65) * shelter;
      m.vert(p, [unit[0] * .7, unit[1] * .7 + .3, unit[2] * .7], [core ? .3 : exposure, core ? .3 : exposure, core ? .3 : exposure], core ? [.03, .03] : [circumference / tile * k / sides, arc / tile * (1 - j / bands)], .2 + .8 * Math.sin(theta));
    }
  }
  for (let j = 0; j < bands; j++) for (let k = 0; k < sides; k++) {
    const a = first + j * (sides + 1) + k;
    if (j === 0) m.tri(a, a + sides + 2, a + sides + 1);
    else if (j === bands - 1) m.tri(a, a + 1, a + sides + 1);
    else m.quad(a, a + 1, a + sides + 2, a + sides + 1);
  }
  for (let k = 0; k < cards; k++) {
    const a = k * 2.399, y = -.75 + rnd() * 1.65;
    const n = norm([Math.cos(a) * Math.sqrt(1 - y * y), y, Math.sin(a) * Math.sqrt(1 - y * y)]);
    const c = center.map((v, q) => v + radii[q] * n[q]);
    const tangent = norm([-Math.sin(a), 0, Math.cos(a)]);
    const up = new THREE.Vector3(...n).cross(new THREE.Vector3(...tangent)).toArray();
    const size = .9 + rnd() * .4, v = m.s.length, shade = .85 + rnd() * .3, tint = rnd() * .08;
    for (const [s, t] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const e = (.72 + .28 * (t + 1) / 2) * shade;
      m.vert(c.map((v, q) => v + size / 2 * (tangent[q] * s + up[q] * t)), n, [e, e * (1 - tint * .4), e * (1 - tint)], [(s + 1) / 2, (t + 1) / 2], 1);
    }
    m.quad(v, v + 3, v + 2, v + 1);
  }
}
function cone(m, y0, y1, radius, sides, offset, color = null) {
  const first = m.s.length, cx = Math.sin(offset) * .22, cz = Math.cos(offset) * .18;
  m.vert([cx, y1, cz], [0, 1, 0], color || [1, 1, 1], [.5, 1], color ? 0 : .4);
  for (let k = 0; k <= sides; k++) {
    const a = offset + k / sides * TAU, r = radius * (1 + .08 * Math.sin(k * 2.3 + offset));
    m.vert([cx + Math.cos(a) * r, y0, cz + Math.sin(a) * r], [Math.cos(a), .45, Math.sin(a)], color || [.28, .28, .28], [k / sides, 0], color ? 0 : 1);
  }
  for (let k = 0; k < sides; k++) m.tri(first, first + 2 + k, first + 1 + k);
}
function cedar(wood, leaf, level, rnd) {
  tube(wood, [0, -.1, 0], [.25, level === 2 ? 3 : 19, 0], .45, level === 0 ? 8 : 4, level === 0 ? 6 : 1, true, [.12, .083, .05], .97);
  if (level === 2) {
    for (let i = 0; i < 4; i++) cone(leaf, 2.8 + i * 3.8, 11 + i * 3, 3.565 - i * .7475, 6, i * 1.7);
    return;
  }
  if (level === 1) {
    // Nine overlapping fringed skirts; upper UV is dense, lower UV is cut out.
    const rows = 9, sides = 12;
    for (let i = 0; i < rows; i++) {
      const t = i / (rows - 1), y = 3 + t * 16.8, r = .25 + 3.2 * Math.pow(1 - t, .85) * (.9 + .1 * Math.cos(t * Math.PI * 6));
      const first = leaf.s.length, rotation = i * 2.399;
      for (let j = 0; j < 2; j++) for (let k = 0; k <= sides; k++) {
        const a = rotation + k / sides * TAU, radius = r * (j ? 1 : .24) * (1 + .12 * Math.sin((k % sides) * 2.3 + i));
        const e = j ? .42 : .9;
        leaf.vert([Math.cos(a) * radius, y + (j ? -.65 : 1.0), Math.sin(a) * radius], [Math.cos(a), .5, Math.sin(a)], [e,e,e], [k / sides * 3, j ? 0 : 1], j ? 1 : .4);
      }
      for (let k = 0; k < sides; k++) { const v = first + k; leaf.quad(v, v + 1, v + sides + 2, v + sides + 1); }
    }
    cone(wood, 3, 19.7, 1.4, 8, .3, [.022, .045, .020]);
    return;
  }
  // Deep green core: slightly darker than the average needles, never a black void.
  cone(wood, 3, 19.7, 2.15, 8, .3, [.022, .045, .020]);
  const rows = level === 0 ? 26 : 12, branches = level === 0 ? 6 : 8;
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1), y = 3 + t * 16.8, length = .25 + 3.2 * Math.pow(1 - t, .85) * (.9 + .1 * Math.cos(t * Math.PI * 6));
    for (let b = 0; b < branches; b++) {
      const a = i * 2.399 + b / branches * TAU + (rnd() - .5) * .3;
      const reach = length * (.85 + rnd() * .3), drop = .2 + .15 * (1 - t);
      // Folded crossed fronds, evolved from the old addFrond grammar.
      for (let plate = 0; plate < (level === 0 ? 2 : 1); plate++) {
        const start = leaf.s.length;
        const segments = level === 0 ? 2 : 1;
        for (let j = 0; j <= segments; j++) for (const s of [-1, 1]) {
          const q = j / segments, w = reach * (.22 + .18 * Math.sin(q * Math.PI)) * s, r = .12 + reach * q;
          const p = [Math.cos(a) * r - Math.sin(a) * w, y - drop * reach * q * q + (plate ? w * .65 : 0), Math.sin(a) * r + Math.cos(a) * w];
          const e = .28 + .72 * q;
          leaf.vert(p, [Math.cos(a) * .7, .65, Math.sin(a) * .7], [e, e, e], [(s + 1) / 2, q], q);
        }
        for (let j = 0; j < segments; j++) { const v = start + j * 2; leaf.quad(v, v + 1, v + 3, v + 2); }
      }
    }
  }
  if (level === 0) for (let i = 0; i < 5; i++) { const a = i * 2.399; tube(wood, [0, 1 + i * .3, 0], [Math.cos(a) * .9, 1 + i * .3, Math.sin(a) * .9], .06, 4, 1, false, [.12, .083, .05], .97); }
}
function broad(wood, leaf, species, level, rnd) {
  const maple = species === 3, small = species >= 4, shrub = species === 5, h = heights[species];
  const center = [0, small ? (shrub ? .7 : 2.1) : maple ? 5.2 : 8, 0];
  const radii = small ? (shrub ? [.85,.65,.8] : [1.05,1.0,1]) : maple ? [3.9,2.9,3.9] : [4.2,3.6,4.2];
  const fork = shrub ? .18 : small ? .9 : maple ? 2 : 3.5;
  tube(wood, [0, -.1, 0], [.12, fork, .1], small ? (shrub ? .025 : .05) : .48, level === 0 ? (small ? 4 : 8) : 4, level === 0 ? (small ? 2 : 4) : 1, true);
  if (level === 2) {
    clump(leaf, center, radii.map((v,q) => v * (q === 1 ? 1.08 : 1.15)), 12, 3, 0, rnd); return;
  }
  const branches = small ? (shrub ? 5 : 4) : 4;
  wood.tips = [];
  for (let b = 0; b < branches; b++) {
    const a = b * 2.399, spread = small ? .3 : 1.8 + b * .32;
    const tip = [Math.cos(a) * spread, small ? center[1] : center[1] - 1.4 + b * .65, Math.sin(a) * spread];
    wood.tips.push(tip);
    if (!small || level === 0) tube(wood, [.08, fork, .05], tip, small ? .018 : .23, level === 0 ? 4 : 3, level === 0 && !small ? 2 : 1);
  }
  const count = small ? (level === 0 ? (shrub ? 5 : 4) : (shrub ? 5 : 3)) : level === 0 ? (maple ? 11 : 13) : 6;
  for (let i = 0; i < count; i++) {
    const y = 1 - 2 * (i + .5) / count, a = i * 2.399, radial = Math.sqrt(1 - y * y);
    const c = center.map((v,q) => v + radii[q] * (q === 1 ? y : radial * (q === 0 ? Math.cos(a) : Math.sin(a)) * (species === 1 ? 1 + .25 * y : 1)) * (small ? .42 : .56));
    const r = small ? radii.map(v => v * .64) : radii.map(v => v * (level === 0 ? .49 : .62));
    clump(leaf, c, r, small ? (level === 0 && !shrub ? 6 : 3) : 8, small && (shrub || level === 1) ? 2 : 3, !small && level === 0 ? 5 : 0, rnd, small ? .6 : 1);
  }
  if (!small) {
    if (level === 0) for (const y of [-.35, 0]) clump(leaf, [0, center[1] + y * radii[1], 0], radii.map(v => v * .5), 8, 3, 3, rnd);
    clump(leaf, center, radii.map(v => v * .6), 6, 2, 0, rnd, 1, true);
  }
}
function pine(wood, leaf, level, rnd) {
  tube(wood, [0, -.1, 0], [1.4, 11.8, .5], .4, level === 0 ? 7 : 4, level === 0 ? 5 : 1, true, [.16, .09, .045]);
  const clouds = [[1.4,11.6,.5,3.3,1.35,2.6],[-1.3,9.4,1,2.8,1.6,2.5],[1.8,7.8,-1.2,2.4,1.5,2.9]];
  for (const [x,y,z,rx,ry,rz] of clouds) {
    clump(leaf, [x,y,z], [rx,ry,rz], level === 2 ? 6 : 8, level === 2 ? 2 : 3, level === 0 ? 4 : 0, rnd);
    if (level === 0) tube(wood, [.6,y-1.8,0], [x,y,z], .12, 4, 2);
  }
}
export function treeGeometry(species, level) {
  if (!Number.isInteger(species) || species < 0 || species > 5 || !Number.isInteger(level) || level < 0 || level > (species >= 4 ? 1 : 2)) throw new RangeError('tree geometry species/level');
  const key = `${species}/${level}`; if (cache.has(key)) return cache.get(key);
  const wood = new Mesher(), leaf = new Mesher(), rnd = seeded(62011 + species * 307 + level * 17);
  if (species === 0) cedar(wood, leaf, level, rnd);
  else if (species === 2) pine(wood, leaf, level, rnd);
  else broad(wood, leaf, species, level, rnd);
  const result = { wood: wood.build(), leaf: leaf.build(), height: heights[species], tris: { wood: wood.i.length / 3, leaf: leaf.i.length / 3 } };
  cache.set(key, result); return result;
}
