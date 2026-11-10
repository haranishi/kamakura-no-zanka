// Kamakura-only fittings. Three merged meshes: metal, leather/waist cord, diamond wrap.
// All lengths are metres in the existing sword/hip frames. No change to the saya or its path.
import * as THREE from 'three';

export const HERO_GEAR = Object.freeze({
  mouth: .17, feet: Object.freeze([.325, .39]), bandWidth: .014, radius: .0245,
  // The requested first foot (.26) is exactly LEFT_HOLD. Keep the gripping area empty.
  hold: .26, holdClearance: .05, middle: .58, butt: .925, buttLength: .05,
  strapWidth: .012, strapThickness: .003, waistY: .06, waistWidth: .018, clearance: .011, waistSegments: 48,
});
const curve = y => .018 * 4 * ((y - .17) / .78) * (1 - (y - .17) / .78);

// Slice the bind mesh into a torso section. Each ray meets actual triangle edges, so
// the cord follows the garment's asymmetric waist rather than a guessed ellipse.
export function measureHeroWaist(ch) {
  const mesh = ch.hands?.mesh;
  if (!mesh) return null;
  const sk = mesh.skeleton, hi = sk.bones.findIndex(b => b.name === 'Hips');
  if (hi < 0) return null;
  const mat = sk.boneInverses[hi].clone().multiply(mesh.bindMatrix), geo = mesh.geometry;
  const pos = geo.attributes.position, ix = geo.index, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const verts = Array.from({ length: pos.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mat));
  const rings = [], cfg = HERO_GEAR, n = cfg.waistSegments;
  for (const y of [cfg.waistY - cfg.waistWidth / 2, cfg.waistY, cfg.waistY + cfg.waistWidth / 2]) {
    const segments = [];
    for (let i = 0; i < (ix ? ix.count : pos.count); i += 3) {
      const tri = [verts[ix ? ix.getX(i) : i], verts[ix ? ix.getX(i + 1) : i + 1], verts[ix ? ix.getX(i + 2) : i + 2]], hit = [];
      if (tri.some(p => Math.abs(p.x) > .29 || Math.abs(p.z) > .29)) continue;
      for (let j = 0; j < 3; j++) {
        a.copy(tri[j]); b.copy(tri[(j + 1) % 3]);
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) { c.copy(a).lerp(b, (y - a.y) / (b.y - a.y)); hit.push(c.clone()); }
      }
      if (hit.length === 2) segments.push(hit);
    }
    if (!segments.length) throw new Error('hero gear: waist slice is empty');
    const ring = [];
    for (let i = 0; i < n; i++) {
      const angle = i * Math.PI * 2 / n, dx = Math.cos(angle), dz = Math.sin(angle); let radius = 0;
      for (const [p, q] of segments) {
        const sx = q.x - p.x, sz = q.z - p.z, den = dx * sz - dz * sx;
        if (Math.abs(den) < 1e-10) continue;
        const r = (p.x * sz - p.z * sx) / den, t = (p.x * dz - p.z * dx) / den;
        if (r > .04 && r < .27 && t >= 0 && t <= 1) radius = Math.max(radius, r);
      }
      if (!radius) throw new Error('hero gear: incomplete waist section');
      ring.push(new THREE.Vector3(dx * (radius + cfg.clearance), y, dz * (radius + cfg.clearance)));
    }
    rings.push(ring);
  }
  return { rings, segments: n, clearance: cfg.clearance };
}
function diamondTexture() {
  const size = 128, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const a = (x + y) % 32, b = (x - y + size * 2) % 32, cord = a < 15 || b < 15, k = (y * size + x) * 4;
    pixels[k] = cord ? 26 : 105; pixels[k + 1] = cord ? 34 : 100; pixels[k + 2] = cord ? 51 : 87; pixels[k + 3] = 255;
  }
  const t = new THREE.DataTexture(pixels, size, size); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 2); t.needsUpdate = true; return t;
}
function batch() { return { positions: [], colors: [], uv: [], indices: [], parts: [] }; }
function append(out, geo, color, name, matrix = null) {
  const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position, uv = g.attributes.uv, v = new THREE.Vector3();
  const first = out.positions.length / 3, col = new THREE.Color(color);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); if (matrix) v.applyMatrix4(matrix);
    out.positions.push(v.x, v.y, v.z); out.colors.push(col.r, col.g, col.b); out.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
  }
  out.parts.push({ name, first, count: p.count }); if (g !== geo) g.dispose(); geo.dispose();
}
function geometry(out) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(out.positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(out.colors, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  g.computeVertexNormals(); return g;
}
function quad(out, a, b, c, d, color, name) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...b, ...d, ...c], 3)); append(out, g, color, name);
}

export function createKamakuraHeroGear(ch, { search = '' } = {}) {
  const params = new URLSearchParams(search);
  if (params.get('gear') === '0' || params.get('heromove') === '0' || !ch.weapons?.tachiHip || !ch.hands?.mesh) return null;
  const hip = ch.bone('Hips'), holder = ch.weapons.tachiHip.holder, cfg = HERO_GEAR, waist = measureHeroWaist(ch);
  if (!hip || !waist) return null;
  const debug = params.get('geardebug') === '1', metal = batch(), leather = batch(), wrap = batch(), matrix = new THREE.Matrix4();
  const parts = [], pos = new THREE.Vector3(), q = new THREE.Quaternion(), scale = new THREE.Vector3(1, 1, 1);
  const metalColor = debug ? 0xffbc00 : 0x4b4539;
  for (let i = 0; i < 3; i++) {
    const y = i < 2 ? cfg.feet[i] : cfg.middle;
    matrix.makeTranslation(0, y, curve(y));
    append(metal, new THREE.CylinderGeometry(cfg.radius, cfg.radius, cfg.bandWidth, 12, 1, true), i === 2 && debug ? 0x00cfff : metalColor, i < 2 ? `foot-${i}` : 'middle', matrix);
    parts.push({ kind: i < 2 ? 'foot' : 'middle', y, width: cfg.bandWidth });
    if (i < 2) {
      // The upper side of the existing hip frame is -Z (its edge points down).
      matrix.makeTranslation(0, y, curve(y) - .031);
      append(metal, new THREE.TorusGeometry(.009, .0025, 4, 10), debug ? 0xff44ee : metalColor, `ring-${i}`, matrix);
      parts.push({ kind: 'ring', y, radius: .009 });
    }
  }
  matrix.makeTranslation(0, cfg.butt, curve(cfg.butt));
  append(metal, new THREE.CylinderGeometry(cfg.radius, cfg.radius, cfg.buttLength, 12), debug ? 0xff3838 : metalColor, 'butt', matrix);
  parts.push({ kind: 'butt', length: cfg.buttLength });
  const y0 = cfg.feet[0] + cfg.bandWidth / 2, y1 = cfg.feet[1] - cfg.bandWidth / 2;
  const tube = new THREE.CylinderGeometry(.023, .023, y1 - y0, 12, 1, true); tube.translate(0, (y0 + y1) / 2, curve((y0 + y1) / 2));
  append(wrap, tube, debug ? 0x3060ff : 0xffffff, 'watari'); parts.push({ kind: 'watari', length: y1 - y0 });
  const n = waist.segments, color = debug ? 0x44ff55 : 0x19202a;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    quad(leather, waist.rings[0][i].toArray(), waist.rings[0][j].toArray(), waist.rings[2][i].toArray(), waist.rings[2][j].toArray(), color, 'waist');
  }
  parts.push({ kind: 'waist', width: cfg.waistWidth, clearance: cfg.clearance });
  const strapStart = leather.positions.length / 3, straps = [];
  for (let i = 0; i < 2; i++) {
    const upper = waist.rings[1][i ? 44 : 4].clone();
    append(leather, new THREE.BoxGeometry(cfg.strapWidth, 1, cfg.strapThickness), debug ? (i ? 0x9900ff : 0xff8800) : 0x35241c, `strap-${i}`);
    straps.push({ upper, lower: new THREE.Vector3(0, cfg.feet[i], curve(cfg.feet[i]) - .04), length: 0 });
  }
  const meshes = [new THREE.Mesh(geometry(metal), debug ? new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .55, metalness: .65, side: THREE.DoubleSide })),
    new THREE.Mesh(geometry(leather), debug ? new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }) : new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })),
    new THREE.Mesh(geometry(wrap), debug ? new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }) : new THREE.MeshLambertMaterial({ vertexColors: true, map: diamondTexture(), side: THREE.DoubleSide }))];
  meshes[0].name = 'kamakura-hero-metal'; meshes[1].name = 'kamakura-hero-straps'; meshes[2].name = 'kamakura-hero-wrap';
  holder.add(meshes[0], meshes[2]); hip.add(meshes[1]);
  for (const m of meshes) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; }
  const baseStraps = leather.positions.slice(strapStart * 3), local = new THREE.Matrix4(), inverse = new THREE.Matrix4();
  const lower = new THREE.Vector3(), delta = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3();
  const knot = new THREE.Object3D(); knot.name = 'kamakura-tachi-knot'; knot.position.set(0, cfg.feet[0] + .009, curve(cfg.feet[0]) - .031); holder.add(knot);
  const strapNormals = meshes[1].geometry.attributes.normal.array.slice(strapStart * 3);
  let disposed = false;
  function update() {
    if (disposed) return;
    hip.updateWorldMatrix(true, false); holder.updateWorldMatrix(true, false);
    inverse.copy(hip.matrixWorld).invert().multiply(holder.matrixWorld);
    const attr = meshes[1].geometry.attributes.position, normal = meshes[1].geometry.attributes.normal;
    for (let i = 0; i < 2; i++) {
      const s = straps[i]; lower.copy(s.lower).applyMatrix4(inverse); delta.copy(s.upper).sub(lower); s.length = delta.length();
      pos.copy(lower).add(s.upper).multiplyScalar(.5); q.setFromUnitVectors(up, delta.normalize()); scale.set(1, s.length, 1); local.compose(pos, q, scale);
      for (let k = 0; k < 36; k++) { v.fromArray(baseStraps, (i * 36 + k) * 3).applyMatrix4(local); attr.setXYZ(strapStart + i * 36 + k, v.x, v.y, v.z); v.fromArray(strapNormals, (i * 36 + k) * 3).applyQuaternion(q); normal.setXYZ(strapStart + i * 36 + k, v.x, v.y, v.z); }
    }
    attr.needsUpdate = normal.needsUpdate = true;
  }
  update();
  const triangles = meshes.reduce((sum, m) => sum + m.geometry.attributes.position.count / 3, 0);
  return { meshes, parts, waist, straps, knot, triangles, update,
    stats() { return { on: !disposed, triangles, draws: disposed ? 0 : meshes.length }; },
    dispose() {
      if (disposed) return; disposed = true; knot.removeFromParent();
      for (const m of meshes) { m.removeFromParent(); m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); }
    },
  };
}
