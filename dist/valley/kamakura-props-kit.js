// Original procedural silhouettes, metres. +z is the face/bow; skirts hide ground seams.
import * as THREE from '../vendor/three.module.min.js';
import { propHash } from './kamakura-props.js';
const STONE = '#968f82', WOOD = '#64513a';
function builder() {
  const parts = [];
  function add(g, x, y, z, color, rx = 0, ry = 0, rz = 0) {
    g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z);
    const flat = g.index ? g.toNonIndexed() : g; if (flat !== g) g.dispose();
    const p = flat.attributes.position, colors = new Float32Array(p.count * 3), c = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) c.toArray(colors, i * 3);
    flat.setAttribute('color', new THREE.BufferAttribute(colors, 3)); parts.push(flat);
  }
  function box(x, y, z, w, h, d, color = WOOD, rx = 0, ry = 0, rz = 0) { add(new THREE.BoxGeometry(w, h, d), x, y, z, color, rx, ry, rz); }
  function round(x, y, z, r0, r1, h, color = STONE, sides = 8, rx = 0) { add(new THREE.CylinderGeometry(r1, r0, h, sides), x, y, z, color, rx); }
  function sphere(x, y, z, r, color = STONE, sy = 1, half = false) {
    const g = new THREE.SphereGeometry(r, 8, 4, 0, Math.PI * 2, 0, half ? Math.PI / 2 : Math.PI); g.scale(1, sy, 1); add(g, x, y, z, color);
  }
  function finish(stone = false, variant = 0) {
    let count = 0; for (const g of parts) count += g.attributes.position.count;
    const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), colors = new Float32Array(count * 3);
    let offset = 0;
    for (const g of parts) { positions.set(g.attributes.position.array, offset); normals.set(g.attributes.normal.array, offset); colors.set(g.attributes.color.array, offset); offset += g.attributes.position.array.length; g.dispose(); }
    if (stone) for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2], age = propHash(x, z + y, 41 + variant);
      const gain = .86 + .22 * age, moss = Math.max(0, .35 - y) * (.5 + age) + (variant ? .08 : 0);
      // The same local vertex gets the same chip and tint, so adjacent faces stay joined.
      positions[i] *= 1 - .055 * age; positions[i + 2] *= 1 - .055 * age;
      colors[i] *= gain * (1 - moss * .22); colors[i + 1] *= gain; colors[i + 2] *= gain * (1 - moss * .3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3)); g.setAttribute('normal', new THREE.BufferAttribute(normals, 3)); g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (stone) g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  }
  return { add, box, round, sphere, finish };
}
export function propGeometry(kind, variant = 0) {
  const b = builder();
  if (kind === 'paver') {
    // Eight-sided cut slab: clipped corners, not an unmodified box. Unit x/z, 6cm thick.
    const ring = [[-.44,-.5],[.44,-.5],[.5,-.44],[.5,.44],[.44,.5],[-.44,.5],[-.5,.44],[-.5,-.44]], vertices = [];
    const vertex = (i, y) => [ring[i][0], y, ring[i][1]];
    for (let i = 1; i < 7; i++) {
      vertices.push(...vertex(0,.03), ...vertex(i + 1,.03), ...vertex(i,.03));
      vertices.push(...vertex(0,-.03), ...vertex(i,-.03), ...vertex(i + 1,-.03));
    }
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      vertices.push(...vertex(i,-.03), ...vertex(i,.03), ...vertex(j,.03), ...vertex(i,-.03), ...vertex(j,.03), ...vertex(j,-.03));
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); g.computeVertexNormals();
    // Parent (real Chrome, noon): at #a69f93 the level slabs took the full sun and read as white tiles. A darker, slightly warm grey.
    b.add(g, 0, 0, 0, '#7f786b'); return b.finish();
  }
  if (kind === 'lantern') {
    b.box(0, .07, 0, .66, .26, .66, STONE); b.round(0, .48, 0, .12, .11, .62);
    b.box(0, .87, 0, .52, .17, .52, STONE); b.box(0, 1.04, 0, .43, .17, .43, STONE);
    // Four corner columns leave actual openings on every side of the fire box.
    for (const x of [-.17, .17]) for (const z of [-.17, .17]) b.box(x, 1.28, z, .08, .36, .08, STONE);
    b.box(0, 1.49, 0, .53, .08, .53, STONE);
    const roof = new THREE.ConeGeometry(.53, .22, 4); roof.rotateY(Math.PI / 4); b.add(roof, 0, 1.64, 0, STONE);
    b.sphere(0, 1.78, 0, .1, STONE); b.round(0, 1.88, 0, .07, 0, .12);
    const g = b.finish(true); g.scale(1, 1.8 / 1.94, 1); g.computeBoundingBox(); return g;
  }
  if (kind === 'gorinto') {
    const s = variant ? .95 : .66;
    b.box(0, .12 * s, 0, .55 * s, .34 * s, .55 * s, STONE);
    b.sphere(0, .42 * s, 0, .21 * s);
    const cone = new THREE.ConeGeometry(.35 * s, .25 * s, 4); cone.rotateY(Math.PI / 4); b.add(cone, 0, .70 * s, 0, STONE);
    b.sphere(0, .83 * s, 0, .18 * s, STONE, .7, true); b.sphere(0, 1.00 * s, 0, .095 * s); b.round(0, 1.08 * s, 0, .07 * s, 0, .10 * s);
    return b.finish(true, variant);
  }
  if (kind === 'jizo') {
    b.box(0, .045, 0, .46, .19, .40, STONE); b.round(0, .31, 0, .18, .11, .40);
    b.sphere(0, .48, 0, .155, STONE, .55); b.sphere(0, .66, 0, .13);
    b.box(0, .355, .153, .23, .22, .018, '#963e32', -.12); b.box(0, .48, .137, .20, .035, .024, '#963e32');
    return b.finish(true);
  }
  if (kind === 'pole') { b.round(0, 1.97, 0, .035, .028, 4.06, WOOD); b.box(.25, 3.73, 0, .55, .028, .028); return b.finish(); }
  if (kind === 'cloth') {
    const g = new THREE.PlaneGeometry(.45, 2.6, 6, 18); g.translate(.265, 2.4, 0);
    const p = g.attributes.position, colors = new Float32Array(p.count * 3), c = new THREE.Color('#d8d1bd');
    for (let i = 0; i < p.count; i++) c.toArray(colors, i * 3); g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); g.computeBoundingBox(); return g;
  }
  if (kind === 'glow') { b.box(0, 1.28, 0, .16, .22, .16, '#ffc074'); return b.finish(); }
  if (kind === 'yard') {
    if (!variant) {
      for (let row = 0; row < 3; row++) for (let n = 0; n < 4 - row; n++) b.round((n - (3 - row) / 2) * .27, .075 + row * .20, 0, .13, .10, .95, WOOD, 5, Math.PI / 2);
      b.box(.49, .48, -.34, .2, 1.1, .055, '#796647', 0, 0, -.27);
    } else {
      // A hollow stave bucket: no solid disk at the rim.
      b.round(0, -.005, 0, .31, .31, .09, WOOD, 12);
      for (let n = 0; n < 12; n++) { const a = n * Math.PI / 6; b.box(Math.sin(a) * .29, .22, Math.cos(a) * .29, .14, .48, .045, n % 2 ? '#726048' : WOOD, 0, a); }
      b.round(0, .04, 0, .327, .327, .025, '#3f392c', 12); // low dark binding below the open rim
      b.box(.64, .34, -.10, .38, .8, .045, '#817052', -.2, 0, .32);
    }
    return b.finish();
  }
  if (kind === 'boat') {
    // Open lapstrake hull, curved keel and raised bow. +z points toward the sea.
    const vertices = [], quad = (a, c, d, e) => vertices.push(...a, ...c, ...d, ...a, ...d, ...e);
    const sections = 10;
    for (let n = 0; n < sections; n++) {
      const z0 = (n / sections - .5) * 7, z1 = ((n + 1) / sections - .5) * 7;
      for (const side of [-1, 1]) for (let level = 0; level < 3; level++) {
        const vertex = (z, l) => { const t = Math.abs(z / 3.5), w = Math.max(.06, .90 * (1 - t * t)); return [side * w * (.24 + .38 * l), -.08 + .32 * l + .54 * t * t * t, z]; };
        quad(vertex(z0, level), vertex(z1, level), vertex(z1, level + 1), vertex(z0, level + 1));
      }
      b.box(0, -.015 + .44 * (Math.abs(z0) / 3.5) ** 3, z0 + .35, .17, .13, .70);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); g.computeVertexNormals(); b.add(g, 0, 0, 0, WOOD);
    for (const z of [-1.8, 0, 1.8]) b.box(0, .59, z, 1.24, .09, .25, '#79644b');
    // Drying net beside the boat, bundled into the same draw; dark thin threads cannot sparkle.
    for (const z of [-1.5, 1.5]) b.box(2.05, .80, z, .08, 1.72, .08);
    b.box(2.05, 1.64, 0, .08, .07, 3.1);
    for (let n = 0; n < 9; n++) b.box(2.05, .96, -1.4 + n * .35, .019, 1.15, .019, '#4c4a38');
    for (let n = 0; n < 5; n++) b.box(2.05, .44 + n * .27, 0, .019, .019, 2.8, '#4c4a38');
    return b.finish();
  }
  if (kind === 'smoke') {
    const count = 24, positions = [], layers = [], normals = [];
    for (let n = 0; n < count; n++) for (const [x, y] of [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, -.5], [.5, .5], [-.5, .5]]) { positions.push(x, y, 0); normals.push(0, 0, 1); layers.push(n / count); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); g.setAttribute('aPropLayer', new THREE.Float32BufferAttribute(layers, 1)); return g;
  }
  if (kind === 'debug') { b.box(0, 1, 0, .15, 2.1, .15, '#ffffff'); return b.finish(); }
  throw new RangeError(`Unknown prop geometry: ${kind}`);
}
