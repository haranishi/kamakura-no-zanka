// Deterministic specimen geometry. Cached templates are borrowed; views clone them.
import * as THREE from 'three';
import { TREES } from './config.js';
import { cedarBranchPlan, cedarMidPlan, cedarExposure, cedarTrunkAxis, tuftCards, crownNormal, branchPoint, broadLimbs, broadClusterPlan, BROAD_CLUSTERS } from './tree-branches.js';
const SAPLING_CLUSTERS = 9;
const names = ['cedar', 'zelkova', 'pine', 'maple', 'sapling', 'shrub'];

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
// Bark UV in metres: u wraps the circumference in ~1.4m repeats, v keeps the bark image's 1:2 texel aspect.
const barkUV = (k, sides, t, length, radius) => { const repeat = Math.max(1, Math.round(TAU * radius / 1.4)); return [k / sides * repeat, t * length * repeat / (2 * TAU * radius)]; };
// Curved tapered tubes, alternating bark ridges and 5 buttresses at the buried foot.
// Second round: near trunks (six sides or more, over 1.8 m) get three extra rings at 0.25/0.6/1.1 m, so the buttresses
// spread visibly over the first metre (they lived only on the buried ring before). The flare and the soil shade are in metres.
export const ROOT_RINGS = Object.freeze([.25, .6, 1.1]);
function tube(m, a, b, radius, sides = 6, rings = 3, root = false, color = [.12, .083, .05], taper = .4) {
  const first = m.s.length, axis = norm(b.map((v, k) => v - a[k])), length = Math.hypot(...b.map((v, k) => v - a[k]));
  const side = norm([axis[1], -axis[0], 0]), cross = new THREE.Vector3(...axis).cross(new THREE.Vector3(...side)).toArray();
  const flared = root && sides >= 6 && length > 1.8;
  const steps = Array.from({ length: rings + 1 }, (_, j) => j / rings);
  if (flared) steps.splice(1, 0, ...ROOT_RINGS.map(h => h / length).filter(t => t < steps[1]));
  for (const t of steps) {
    const h = t * length;
    for (let k = 0; k <= sides; k++) {
      const angle = k / sides * TAU, nx = side.map((v, q) => v * Math.cos(angle) + cross[q] * Math.sin(angle));
      const flare = !root ? 1 : flared ? 1 + .85 * Math.exp(-h / .5) * (.5 + .5 * Math.cos(angle * 5 + .6)) : 1 + .8 * Math.exp(-t * 24) * (.6 + .4 * Math.cos(angle * 5));
      const r = radius * (1 - taper * t) * flare * ((k % sides) % 2 ? .91 : 1.09);
      const p = a.map((v, q) => v + (b[q] - v) * t + nx[q] * r);
      p[0] += Math.sin(t * Math.PI) * radius * .8;
      const shade = (.72 + .18 * ((k % sides) % 2)) * (root ? .45 + .55 * Math.min(1, flared ? h / 1.2 : t * 5) : 1);
      m.vert(p, nx, color.map(v => v * shade), barkUV(k, sides, t, length, radius));
    }
  }
  for (let j = 0; j < steps.length - 1; j++) for (let k = 0; k < sides; k++) { const v = first + j * (sides + 1) + k; m.quad(v, v + 1, v + sides + 2, v + sides + 1); }
}
// A tapered limb along a curve of ring centres (each ring keeps a horizontal side axis, so limbs never twist).
function limb(m, centres, radii, sides = 3, color = [.12, .083, .05], shade = .8) {
  const first = m.s.length; let along = 0;
  for (let j = 0; j < centres.length; j++) {
    if (j) along += Math.hypot(...centres[j].map((v, q) => v - centres[j - 1][q]));
    const next = centres[Math.min(j + 1, centres.length - 1)], prev = centres[Math.max(j - 1, 0)];
    const axis = norm(next.map((v, q) => v - prev[q])), flat = norm([-axis[2], 0, axis[0]]);
    const side = Math.hypot(flat[0], flat[2]) > 1e-4 ? flat : [1, 0, 0], up = new THREE.Vector3(...axis).cross(new THREE.Vector3(...side)).toArray();
    for (let k = 0; k <= sides; k++) {
      const angle = k / sides * TAU, nx = side.map((v, q) => v * Math.cos(angle) + up[q] * Math.sin(angle));
      m.vert(centres[j].map((c, q) => c + nx[q] * radii[j]), nx, color.map(c => c * shade * (.86 + .14 * (k % 2))), [k / sides, along / (2 * TAU * Math.max(radii[0], .02))]);
    }
  }
  for (let j = 0; j < centres.length - 1; j++) for (let k = 0; k < sides; k++) { const v = first + j * (sides + 1) + k; m.quad(v, v + 1, v + sides + 2, v + sides + 1); }
}
// Face box projection avoids pinched polar UVs. The wood core keeps its untextured grid.
// Smooth position noise: the same three spatial frequencies survive tessellation changes.
function crownNoise(p) {
  const wave = f => Math.sin(p[0] * f + .7) * Math.cos(p[1] * f * .83 - .4) * Math.sin(p[2] * f * .71 + 1.2);
  return .10 * wave(.8) + .05 * wave(1.6) + .03 * wave(3.2);
}
function clump(m, center, radii, sides, bands, tile = 1, core = false, rotation = 0, tilt = 0, jitter = .09, rnd = null, delta = 0) {
  const first = m.s.length, indexFirst = m.i.length;
  m.parts ??= [];
  const part = { first, sides, bands, center, radii, tile, core, rotation, tilt, jitter, cards: 0, indexFirst, delta };
  m.parts.push(part);
  const circumference = TAU * Math.sqrt((radii[0] ** 2 + radii[2] ** 2) / 2);
  for (let j = 0; j <= bands; j++) {
    const theta = j / bands * Math.PI;
    for (let k = 0; k <= sides; k++) {
      const a = (k % sides) / sides * TAU, unit = [Math.sin(theta) * Math.cos(a), Math.cos(theta), Math.sin(theta) * Math.sin(a)];
      // Matching seam vertices, deterministic from the unperturbed position.
      const wobble = !core && rnd ? 1 + (jitter === 0 ? 0 : crownNoise(unit.map((v,q) => center[q] + radii[q] * v))) : 1 + jitter * Math.sin((center[0] + radii[0] * unit[0]) * 7.13 + (center[1] + radii[1] * unit[1]) * 3.71 + (center[2] + radii[2] * unit[2]) * 5.37);
      const local = radii.map((v, q) => v * unit[q] * (q === 1 ? 1 : wobble));
      const turn = v => {
        if (rotation === 0 && tilt === 0) return v;
        const x = v[0] * Math.cos(tilt) - v[1] * Math.sin(tilt), y = v[0] * Math.sin(tilt) + v[1] * Math.cos(tilt);
        return [x * Math.cos(rotation) - v[2] * Math.sin(rotation), y, x * Math.sin(rotation) + v[2] * Math.cos(rotation)];
      };
      const p = turn(local).map((v, q) => v + center[q]);
      const facing = turn(unit), radial = Math.hypot(center[0], center[2]);
      const outward = radial > .01 ? (facing[0] * center[0] + facing[2] * center[2]) / radial : -1;
      const shelter = 1 - .65 * (1 - Math.abs(facing[1])) * (1 - Math.max(0, outward));
      const exposure = .28 + .72 * Math.pow((facing[1] + 1) / 2, .65) * shelter;
      m.vert(p, turn([unit[0] * .7, unit[1] * .7 + .3, unit[2] * .7]), core ? [.06, .05, .03] : [exposure * (1 + .9 * delta), exposure, exposure * (1 - delta)], core ? NO_BARK : [circumference / tile * k / sides, p[1] / tile], core ? 0 : .2 + .8 * Math.sin(theta));
    }
  }
  for (let j = 0; j < bands; j++) for (let k = 0; k < sides; k++) {
    const a = first + j * (sides + 1) + k;
    if (j === 0) m.tri(a, a + sides + 2, a + sides + 1);
    else if (j === bands - 1) m.tri(a, a + 1, a + sides + 1);
    else m.quad(a, a + 1, a + sides + 2, a + sides + 1);
  }
  part.indexCount = m.i.length - indexFirst;
  if (!core && rnd) {
    const angle = rnd() * TAU, shift = [rnd() * 8, rnd() * 8];
    part.uvAngle = angle; part.uvShift = shift;
    const indices = m.i.splice(indexFirst), grid = {};
    for (const [key, width] of [['p',3],['n',3],['c',3],['u',2],['s',1]]) grid[key] = m[key].splice(first * width);
    part.vertices = [];
    for (let t = 0; t < indices.length; t += 3) {
      const ids = indices.slice(t,t+3).map(i => i-first);
      const points = ids.map(i => grid.p.slice(i*3,i*3+3));
      const edge = points[1].map((v,q)=>v-points[0][q]), other = points[2].map((v,q)=>v-points[0][q]);
      const normal = new THREE.Vector3(...edge).cross(new THREE.Vector3(...other)).toArray();
      const axis = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
      const axes = [0,1,2].filter(q=>q!==axis);
      for (const i of ids) {
        const p = grid.p.slice(i*3,i*3+3), u = p[axes[0]] / tile, v = p[axes[1]] / tile;
        const uv = [u*Math.cos(angle)-v*Math.sin(angle)+shift[0], u*Math.sin(angle)+v*Math.cos(angle)+shift[1]];
        const id = m.vert(p,grid.n.slice(i*3,i*3+3),grid.c.slice(i*3,i*3+3),uv,grid.s[i]);
        part.vertices[i] ??= id;
        m.i.push(id);
      }
    }
    // Pole seam duplicates share position, normal, exposure and sway.
    for (let i=0;i<grid.s.length;i++) if (part.vertices[i] === undefined) {
      const twin = grid.p.findIndex((_,q)=>q%3===0 && part.vertices[q/3]!==undefined && grid.p.slice(q,q+3).every((v,k)=>Math.abs(v-grid.p[i*3+k])<1e-8));
      part.vertices[i] = part.vertices[twin/3];
    }
    part.vertexCount = m.s.length-first;
  }
}
// Wood cores carry UV (-1,-1): bark-free for the wood shader (broadleaf cores; the cedar's middle core cone left in 8.1a round two).
const NO_BARK = [-1, -1];
// The far cedar's cones (the fallback when the far boards cannot be baked).
function cone(m, y0, y1, radius, sides, offset) {
  const first = m.s.length, cx = Math.sin(offset) * .22, cz = Math.cos(offset) * .18;
  m.vert([cx, y1, cz], [0, 1, 0], [1, 1, 1], [.5, 1], .4);
  for (let k = 0; k <= sides; k++) {
    const a = offset + k / sides * TAU, r = radius * (1 + .08 * Math.sin(k * 2.3 + offset));
    m.vert([cx + Math.cos(a) * r, y0, cz + Math.sin(a) * r], [Math.cos(a), .45, Math.sin(a)], [.28, .28, .28], [k / sides, 0], 1);
  }
  for (let k = 0; k < sides; k++) m.tri(first, first + 2 + k, first + 1 + k);
}
// Near cedar (L0): trunk, irregular spiral limbs and overlapping three-card tufts along their outer three quarters
// (tree-branches.js). No row of six fronds, no metre-wide board and no solid core cone survives: the old tiers read as
// shingles, and a core cone seen between sparse tufts read as papier-mâché (its cap hung as a disc overhead).
function cedarNear(wood, leaf, shape) {
  const plan = cedarBranchPlan(shape);
  tube(wood, [0, -.1, 0], shape < 3 ? [.25 + shape * .16, 19, shape * -.12] : [0, 19, 0], .45, 8, 6, true, [.12, .083, .05], .97);
  for (const b of plan.branches) {
    if (b.wood) { const s = [0, .45, .85]; limb(wood, s.map(v => branchPoint(b, v)), s.map(v => b.radius * (1 - .7 * v)), 3, [.12, .083, .05], .78); }
    for (const tuft of b.tufts) cedarTuft(leaf, tuft, shape);
  }
  // Dead stubs on the clear lower trunk.
  for (let i = 0; i < 5; i++) { const a = i * 2.399; tube(wood, [0, 1 + i * .3, 0], [Math.cos(a) * .9, 1 + i * .3, Math.sin(a) * .9], .06, 4, 1, false, [.12, .083, .05], .97); }
}
// Three crossed cards per tuft; UVs follow the trapezoid inside one cell of the two-spray atlas.
function cedarTuft(leaf, tuft, shape, lift = 1) {
  // Per-tuft hue: warmer tufts against cooler, bluer ones (second round: ±5%/7% read as one flat green). The mean leans
  // cool (red -3%, blue +4%): in the low gold sun the lit tufts read yellow-green against the evening (blind review: set-04, f1).
  const centre = tuft.variant * .5 + .25, half = .23, tint = [.97 + .08 * tuft.hue, 1 + .03 * tuft.hue, 1.04 - .1 * tuft.hue].map(v => v * lift);
  const uvs = [[centre - half * .55, 0], [centre + half * .55, 0], [centre + half, 1], [centre - half, 1]];
  for (const card of tuftCards(tuft)) {
    const first = leaf.s.length;
    card.corners.forEach((p, k) => {
      const e = cedarExposure(p, shape, tuft.shade);
      leaf.vert(p, crownNormal(p, card.normal, cedarTrunkAxis(shape, p[1])), tint.map(c => Math.max(.3, Math.min(1.15, c * e))), uvs[k], k >= 2 ? 1 : .3);
    });
    leaf.quad(first, first + 1, first + 2, first + 3);
  }
}
function cedar(wood, leaf, level, shape) {
  if (shape >= 3) { cedarNew(wood, leaf, level, shape); return; }
  if (level === 0) { cedarNear(wood, leaf, shape); return; }
  tube(wood, [0, -.1, 0], [.25 + shape * .16, level === 2 ? 3 : 19, shape * -.12], .45, 4, 1, true, [.12, .083, .05], .97);
  if (level === 2) {
    if (shape === 0) for (let i = 0; i < 4; i++) cone(leaf, 2.8 + i * 3.8, 11 + i * 3, 3.565 - i * .7475, 6, i * 1.7);
    else {
      const rows = shape === 1 ? 3 : 4;
      for (let i = 0; i < rows; i++) {
        const t = i / (rows - 1);
        cone(leaf, 2.8 + t * 11.4, 11 + t * 9, (3.565 - t * 2.2425) * (shape === 1 ? 1.06 : .94), 6, i * 1.7 + shape * .43);
      }
    }
    return;
  }
  if (level === 1) cedarMid(wood, leaf, shape);
}
// Middle cedar (L1): one large tuft per near limb (two on long limbs), on the near branch plan, with no core cone.
// Nine identical skirts read as a stack of lampshades (7.9); the spiral of 36-40 large tufts around a smooth green core
// read as paper stars on a cone from the overlook (8.1a, second round). The outline and tips now match the near tree.
function cedarMid(wood, leaf, shape) {
  for (const tuft of cedarMidPlan(shape).tufts) cedarTuft(leaf, tuft, shape);
}
// New families keep their own middle and far grammar; near limbs come from the shared branch plan.
function cedarNew(wood, leaf, level, shape) {
  const slim = shape === 3, width = slim ? .62 : 1;
  const lean = y => slim ? 0 : .6 * Math.max(0, y) / 20;
  if (level === 0) cedarNear(wood, leaf, shape);
  else tube(wood, [0, -.1, 0], [0, level === 2 ? 3 : 19, 0], .45, 4, 1, true, [.12, .083, .05], .97);
  if (level === 2) {
    const rows = slim ? 4 : 3;
    for (let i = 0; i < rows; i++) {
      const t = i / (rows - 1);
      cone(leaf, 2.8 + t * 11.4, 11 + t * 9, (3.565 - t * 2.2425) * width * (slim ? 1 : 1.04 + .18 * Math.sin(i * 2.7)), 6, i * 1.7 + shape * .43);
    }
  } else if (level === 1) cedarMid(wood, leaf, shape);
  // A gentle shared lean preserves the family across all levels.
  for (const m of [wood, leaf]) for (let i = 0; i < m.s.length; i++) {
    const y = m.p[i*3+1]; m.p[i*3] += lean(y); m.p[i*3+2] -= lean(y) * .5;
  }
}
function broad(wood, leaf, species, level, rnd, shape) {
  const maple = species === 3, small = species >= 4, shrub = species === 5, h = heights[species];
  const center = [0, small ? (shrub ? .51 : 1.72) : level === 2 ? (maple ? 4.7 : 7.4) : maple ? 5.2 : 8, 0];
  const radii = small ? (shrub ? [.85,.65,.8] : [.92,1.27,.88]) : maple ? [3.9,2.9,3.9] : [4.2,3.6,4.2];
  // Keep each shape's proportions through all distance levels.
  const aspect = [1, .94, 1.06][shape];
  if (!small) { radii[0] *= aspect; radii[2] *= aspect; radii[1] /= aspect; }
  const fork = shrub ? .18 : small ? 1.8 : level === 2 ? (maple ? 3.8 : 5.5) : level === 1 ? (maple ? 5.4 : 8.2) : maple ? 2 : 3.5;
  const clustered = !small && level === 0, sapling = species === 4 && level === 0;
  const count = small ? (level === 0 ? (shrub ? 6 : sapling ? SAPLING_CLUSTERS : 8) : 3) : level === 2 ? 2 : clustered ? BROAD_CLUSTERS : 6;
  const total = count + (clustered || sapling ? 1 : 0), biases = [];
  for (let i=0;i<Math.floor(total/2);i++) { const d = (rnd() * 2 - 1) * .1; biases.push(d,-d); }
  if (total % 2) biases.push(0);
  const crown = (...args) => clump(...args, rnd, biases.shift());
  tube(wood, [0, -.1, 0], [.12, fork, .1], small ? (shrub ? .025 : .08) : level === 2 ? (maple ? .46 : .52) : .48, level === 0 ? (small ? 4 : 8) : 4, level === 0 ? (small ? (shrub ? 1 : 2) : 4) : (species === 4 ? 2 : 1), true);
  if (level === 2) {
    // One full rounded dome and a smaller shoulder, rather than stacked plates.
    const phase = shape * .73;
    const dome = maple ? [3.9 * aspect,2.7 / aspect,3.9 * aspect] : [4.6 * aspect,3.6 / aspect,4.6 * aspect];
    crown(leaf, center, dome, 10, 5, 1, false, .24 + phase, .07, .12);
    crown(leaf, [center[0] + radii[0] * .67, h * .42, center[2] - radii[2] * .24], radii.map(v => v * .49), 8, 4, 1, false, 1.13 + phase, -.09, .12);
    return;
  }
  const branches = small ? (shrub ? 5 : 4) : [4, 3, 5][shape];
  wood.tips = [];
  for (let b = 0; b < branches; b++) {
    const a = b * 2.399 + shape * .73, spread = small ? .3 : (1.8 + b * .32) * aspect;
    const tip = [Math.cos(a) * spread, small ? center[1] : center[1] - 1.4 + b * .65, Math.sin(a) * spread];
    wood.tips.push(tip);
    if (level === 0 && (!small || shrub || b === 0)) tube(wood, [.08, small && !shrub ? 1 : fork, .05], small && !shrub ? [.55,1.5,0] : tip, small ? .018 : .23, level === 0 ? 4 : 3, level === 0 && !small ? 2 : 1);
  }
  // Middle broadleaf keeps the near fork's limbs (three-sided), so the crown is held by branches, not a stick.
  if (level === 1 && !small) for (const l of broadLimbs(wood.tips, maple ? 2 : 3.5, aspect)) tube(wood, l.from, l.to, l.radius, 3, 1);
  if (sapling) {
    // Near sapling (second round): nine small clusters on short limbs around one inner cluster that holds the trunk top.
    // Eight shells packed within 0.22 of the crown read as one ball on a stick at 2-5 m (blind review: set-04).
    // Horizontal reach stays inside the old drawn crown (TREES.sapling.crown keeps it off road treads and dress).
    const plan = broadClusterPlan({ center, radii: [radii[0] * .9, radii[1], radii[2] * .9], tips: wood.tips, fork: 1.2, shape, count: SAPLING_CLUSTERS, depth: [.62, .16], size: [.36, .1], salt: 401 });
    for (const c of plan.clusters) { tube(wood, c.limb.from, c.limb.to, .022, 3, 1); crown(leaf, c.center, c.radii, 12, 6, .6, false, c.rotation, 0, .14); }
    crown(leaf, [center[0], center[1] + .2, center[2]], [radii[0] * .44, radii[1] * .56, radii[2] * .44], 12, 6, .6, false, .9, 0, .14);
    return;
  }
  if (clustered) {
    // Near crown (8.1a, second round): small leaf clusters on secondary limbs, with sky and limbs between them, and one
    // dark inner cluster. Ten large shells read as a ball on a stick at 3-15 m (blind review: detail-n4, set-04, set-24).
    const plan = broadClusterPlan({ center, radii, tips: wood.tips, fork, vase: species === 1, flat: maple, shape });
    for (const c of plan.clusters) { tube(wood, c.limb.from, c.limb.to, c.limb.radius, 3, 1); crown(leaf, c.center, c.radii, 12, 6, 1, false, c.rotation, 0, .09); }
    crown(leaf, [0, center[1] - .1 * radii[1], 0], radii.map(v => v * .42), 12, 6, 1, false, .4, 0, .09);
    return;
  }
  for (let i = 0; i < count; i++) {
    const y = 1 - 2 * (i + .5) / count, a = i * 2.399 + shape * .73, radial = Math.sqrt(1 - y * y);
    const c = center.map((v,q) => v + radii[q] * (q === 1 ? y : radial * (q === 0 ? Math.cos(a) : Math.sin(a)) * (species === 1 ? 1 + .45 * y : 1)) * (small ? .22 : .56));
    const r = small ? radii.map(v => v * (level === 0 ? .78 : .84)) : radii.map((v,q) => v * (level === 0 ? .49 : (.63 + .035 * Math.sin(i * 2.3 + q)) * (shape === 2 ? .97 : 1)));
    crown(leaf, c, r, small ? (level === 0 ? 14 : 8) : level === 0 ? 16 : 10, small ? (level === 0 ? 7 : 4) : level === 0 ? 8 : 5, small ? .6 : 1, false, !small && level === 1 ? i * .73 : 0, 0, small ? .14 : .09);
  }
  clump(wood, center, radii.map(v => v * .55), small ? 3 : 6, 2, 1, true);
}
// Fan cards grow from their bottom centre, with normals pointing away from each tuft.
function pineFan(leaf, center, angle, tilt) {
  const first = leaf.s.length, width = 2.4, length = 2.4;
  const sign = Math.sign(tilt);
  const n = [Math.cos(angle) * Math.sin(tilt) * sign, -Math.cos(tilt) * sign, Math.sin(angle) * Math.sin(tilt) * sign];
  const tangent = [-Math.sin(angle), 0, Math.cos(angle)];
  const up = [Math.cos(angle) * Math.cos(tilt), Math.sin(tilt), Math.sin(angle) * Math.cos(tilt)];
  leaf.parts ??= []; leaf.parts.push({ first, center, angle, tilt, cards: 1 });
  for (const [s,t] of [[-1,0],[1,0],[1,1],[-1,1]]) {
    const e = .55 + .4 * t;
    leaf.vert(center.map((v,q) => v + tangent[q] * s * width / 2 + up[q] * t * length), n, [e,e,e], [(s+1)/2,t], .3 + .7*t);
  }
  if (sign > 0) leaf.quad(first, first+3, first+2, first+1);
  else leaf.quad(first, first+1, first+2, first+3);
}
function pine(wood, leaf, level, rnd, shape) {
  tube(wood, [0, -.1, 0], [1.4 - shape * .5, level === 2 ? 5 : 11.8, .5 + shape * .35], .4, level === 0 ? 7 : 4, level === 0 ? 5 : 1, true, [.16, .09, .045]);
  if (level === 2) {
    clump(leaf, [.4,10.5,.1], [3.8,2.78,3.7], 8, 4, 1, false, shape * .4, 0, .12);
    clump(leaf, [1.5 - shape * .5,8.0,-.5], [2.7,1.8,2.6], 6, 4, 1, false, .8, 0, .12);
    return;
  }
  const tufts = [[1.4,11.6,.5],[-1.3,9.4,1],[1.8,7.8,-1.2],[-.8,8,-.9],[1.0,10.1,-1.4]];
  const count = level === 0 ? 5 : 4, cards = level === 0 ? 8 : 5;
  for (let i = 0; i < count; i++) {
    const center = tufts[i].map((v,q) => v + shape * (q === 0 ? Math.sin(i * 2.399) * .45 : q === 1 ? Math.cos(i) * .25 : Math.cos(i * 2.399) * .4));
    tube(wood, [.6,center[1]-1.8,0], center, .12, level === 0 ? 4 : 3, 2);
    for (let k = 0; k < cards; k++) pineFan(leaf, center, k / cards * TAU + i * 2.399 + shape * .7, k % 5 === 0 ? -.25 : .55 + .15 * Math.sin(k * 2.399 + i));
  }
}

export function treeGeometry(species, level, shape = 0) {
  if (!Number.isInteger(species) || species < 0 || species > 5 || !Number.isInteger(level) || level < 0 || level > (species >= 4 ? 1 : 2)) throw new RangeError('tree geometry species/level');
  if (!Number.isInteger(shape) || shape < 0 || shape >= (TREES.variants[names[species]] ?? 1)) throw new RangeError('tree geometry shape');
  const key = `${species}/${level}/${shape}`; if (cache.has(key)) return cache.get(key);
  const wood = new Mesher(), leaf = new Mesher(), rnd = seeded(62011 + species * 307 + level * 17 + shape * 113);
  if (species === 0) cedar(wood, leaf, level, shape);
  else if (species === 2) pine(wood, leaf, level, rnd, shape);
  else broad(wood, leaf, species, level, rnd, shape);
  const result = { wood: wood.build(), leaf: leaf.build(), height: heights[species], tris: { wood: wood.i.length / 3, leaf: leaf.i.length / 3 } };
  cache.set(key, result); return result;
}
