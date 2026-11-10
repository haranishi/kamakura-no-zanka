// B2/B4: local original geometry; colours inherit the existing props wood/stone and river foam.
import * as THREE from '../vendor/three.module.min.js';
import { BRIDGES, deckHeight, bridgeRailBoxes } from './kamakura-bridges.js';
import { RIVER_ROCKS, riverlifeHash } from './kamakura-river-rocks.js';
import { propGeometry } from './kamakura-props-kit.js';
import { FOAM_LINEAR_MAX5 } from './kamakura-shore-r4.js';
export const RIVERLIFE_ART = Object.freeze({
  woodGrey: .32, woodGain: 1.12, plankVariation: .13, // linear mix / gain: weather the existing wood pigment.
  wetGain: .42, dryGain: .9, mossGain: .24, // linear gains: wet stone, dry stone, upper-face moss.
  foamColor: Object.freeze([.32, .36, .33]), foamMax: FOAM_LINEAR_MAX5, foamOpacity: .7, // existing water-view foam pigment / linear ceiling / alpha.
  deckDebug: '#ffff00', railDebug: '#ff0000', pierDebug: '#ff8000', rockDebug: '#ff00ff', foamDebug: '#00ffff', // unlit masks.
  plankLength: .65, plankMax: 24, plankGap: .015, // m / count / m: transverse boards and budget.
  postSpacing: 3, postMax: 6, postWidth: .12, mainPostWidth: .2, // m / count per side / m: low handrail posts.
  beamWidth: .18, beamDepth: .22, railLevels: 2, railDepth: .09, // m / m / count / m: girders and rails.
  pierWidth: .22, // m: square timber piles.
  rockSides: 7, rockRings: 4, rockWarp: .09, // tessellation / fraction: 42 triangles, four rounded profiles.
  noiseScale: 2.1, noiseEdge: .18, arcThickness: .16, // 1/m / normalized: frayed foam edges and upstream arc.
});
function sourceColor(kind) {
  const g = propGeometry(kind), a = g.attributes.color;
  const c = new THREE.Color(a.getX(0), a.getY(0), a.getZ(0)); g.dispose(); return c;
}
function builder() {
  const p = [], c = [], origins = [];
  function add(geometry, s, tint) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const v = g.attributes.position;
    for (let i = 0; i < v.count; i++) {
      const x = v.getX(i), y = v.getY(i), z = v.getZ(i);
      p.push(s.x + s.ux * x - s.uz * z, y, s.z + s.uz * x + s.ux * z);
      c.push(tint.r, tint.g, tint.b); origins.push(s.x, s.deck, s.z);
    }
    g.dispose(); if (g !== geometry) geometry.dispose();
  }
  function box(s, x, y, z, w, h, d, tint, angle = 0) {
    const g = new THREE.BoxGeometry(w, h, d); g.rotateZ(angle); g.translate(x, y, z); add(g, s, tint);
  }
  function finish() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    g.setAttribute('aRiverlifeCenter', new THREE.Float32BufferAttribute(origins, 3));
    g.computeVertexNormals(); g.computeBoundingSphere(); return g;
  }
  return { add, box, finish };
}
export function bridgeGeometry(sites, terrain, debug = false) {
  const deck = builder(), rail = builder(), pier = builder(), far = builder(), collision = builder();
  const wood = sourceColor('pole'), grey = (wood.r + wood.g + wood.b) / 3;
  wood.lerp(new THREE.Color(grey, grey, grey), RIVERLIFE_ART.woodGrey).multiplyScalar(RIVERLIFE_ART.woodGain);
  const yellow = new THREE.Color(RIVERLIFE_ART.deckDebug), red = new THREE.Color(RIVERLIFE_ART.railDebug), orange = new THREE.Color(RIVERLIFE_ART.pierDebug);
  for (const [si, s] of sites.entries()) {
    const length = s.end - s.start, boards = Math.min(RIVERLIFE_ART.plankMax, Math.ceil(length / RIVERLIFE_ART.plankLength));
    for (let i = 0; i < boards; i++) {
      const a = s.start + length * i / boards, b = s.start + length * (i + 1) / boards, u = (a + b) / 2;
      const slope = Math.atan2(deckHeight(s, b) - deckHeight(s, a), b - a);
      deck.box(s, u, deckHeight(s, u) - BRIDGES.thickness / 2, 0, (b - a) - RIVERLIFE_ART.plankGap, BRIDGES.thickness, s.width,
        debug ? yellow : wood.clone().multiplyScalar(1 - RIVERLIFE_ART.plankVariation + riverlifeHash(i, si) * RIVERLIFE_ART.plankVariation * 2), slope);
    }
    for (const sign of [-1, 1]) {
      const v = sign * s.width / 2;
      deck.box(s, (s.left + s.right) / 2, s.deck - BRIDGES.thickness - RIVERLIFE_ART.beamDepth / 2, v * .75,
        s.span, RIVERLIFE_ART.beamDepth, RIVERLIFE_ART.beamWidth, debug ? yellow : wood);
      const n = Math.min(RIVERLIFE_ART.postMax - 1, Math.ceil(length / RIVERLIFE_ART.postSpacing));
      for (let i = 0; i <= n; i++) {
        const u = s.start + length * i / n, width = (i === 0 || i === n) && s.roadWidth >= BRIDGES.maxWidth ? RIVERLIFE_ART.mainPostWidth : RIVERLIFE_ART.postWidth;
        rail.box(s, u, deckHeight(s, u) + BRIDGES.railHeight / 2, v, width, BRIDGES.railHeight, width, debug ? red : wood);
      }
      // Three following segments keep handrails near the curved deck, with open ends.
      for (let j = 0; j < 3; j++) for (let level = 1; level <= RIVERLIFE_ART.railLevels; level++) {
        const a = s.start + length * j / 3, b = s.start + length * (j + 1) / 3, ya = deckHeight(s, a), yb = deckHeight(s, b);
        rail.box(s, (a + b) / 2, (ya + yb) / 2 + BRIDGES.railHeight * level / RIVERLIFE_ART.railLevels, v,
          Math.hypot(b - a, yb - ya), RIVERLIFE_ART.railDepth, RIVERLIFE_ART.railDepth, debug ? red : wood, Math.atan2(yb - ya, b - a));
      }
      far.box(s, (s.start + s.end) / 2, s.deck + s.rise / 2 + BRIDGES.railHeight, v, length, RIVERLIFE_ART.railDepth, RIVERLIFE_ART.railDepth, debug ? red : wood);
    }
    for (const p of s.piers) pier.box(s, p.u, (p.bottom + p.top) / 2, p.v, RIVERLIFE_ART.pierWidth, Math.max(.01, p.top - p.bottom), RIVERLIFE_ART.pierWidth, debug ? orange : wood);
    // Three deck segments + two rail boxes = 60 triangles in the distant form.
    for (let j = 0; j < 3; j++) {
      const a = s.start + length * j / 3, b = s.start + length * (j + 1) / 3;
      far.box(s, (a + b) / 2, deckHeight(s, (a + b) / 2) - BRIDGES.thickness / 2, 0, b - a, BRIDGES.thickness, s.width, debug ? yellow : wood,
        Math.atan2(deckHeight(s, b) - deckHeight(s, a), b - a));
    }
  }
  if (debug) for (const b of bridgeRailBoxes(sites, terrain)) {
    const s = { x: b.x, z: b.z, ux: Math.cos(-b.rotY), uz: Math.sin(-b.rotY), deck: terrain.heightAt(b.x, b.z) };
    collision.box(s, 0, s.deck + b.height / 2, 0, b.w, b.height, b.d, red);
  }
  return { deck: deck.finish(), rail: rail.finish(), pier: pier.finish(), far: far.finish(), collision: collision.finish() };
}
export function rockGeometry(variant = 0) {
  const g = new THREE.SphereGeometry(.5, RIVERLIFE_ART.rockSides, RIVERLIFE_ART.rockRings), p = g.attributes.position;
  const stone = sourceColor('gorinto'), colors = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), warp = 1 - RIVERLIFE_ART.rockWarp * (.5 + .5 * Math.sin(x * (variant + 2) * 4 + z * 3 + y * 5));
    p.setXYZ(i, x * warp, y + .5, z * warp * (1 - variant * .055));
    const c = stone.clone().multiplyScalar(y < -.16 ? RIVERLIFE_ART.wetGain : RIVERLIFE_ART.dryGain);
    if (y > .2) { c.r *= 1 - RIVERLIFE_ART.mossGain; c.b *= 1 - RIVERLIFE_ART.mossGain; }
    colors.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); g.computeVertexNormals(); return g;
}
export function rocksGeometry(rocks, debug = false) {
  const models = Array.from({ length: 4 }, (_, v) => rockGeometry(v)), magenta = new THREE.Color(RIVERLIFE_ART.rockDebug);
  const positions = [], colors = [], centers = [];
  for (const r of rocks) {
    const g = models[r.variant], p = g.attributes.position, c = g.attributes.color;
    for (const i of g.index.array) {
      positions.push(r.x + p.getX(i) * r.width, r.y + p.getY(i) * r.height, r.z + p.getZ(i) * r.width);
      colors.push(debug ? magenta.r : c.getX(i), debug ? magenta.g : c.getY(i), debug ? magenta.b : c.getZ(i));
      centers.push(r.x, r.y, r.z);
    }
  }
  for (const g of models) g.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('aRiverlifeCenter', new THREE.Float32BufferAttribute(centers, 3)); g.computeVertexNormals(); g.computeBoundingSphere(); return g;
}
export function foamGeometry(items) {
  const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
  const out = new THREE.InstancedBufferGeometry(); out.index = g.index.clone();
  for (const key of ['position', 'normal', 'uv']) out.setAttribute(key, g.attributes[key].clone()); g.dispose();
  const origins = [], shape = [], motion = [];
  for (const f of items) { origins.push(f.x, f.y, f.z); shape.push(f.width, f.length, f.tx, f.tz); motion.push(f.speed, f.kind, f.slope ?? 0); }
  out.setAttribute('aFoamOrigin', new THREE.InstancedBufferAttribute(new Float32Array(origins), 3));
  out.setAttribute('aFoamShape', new THREE.InstancedBufferAttribute(new Float32Array(shape), 4));
  out.setAttribute('aFoamMotion', new THREE.InstancedBufferAttribute(new Float32Array(motion), 3)); out.instanceCount = items.length; return out;
}
