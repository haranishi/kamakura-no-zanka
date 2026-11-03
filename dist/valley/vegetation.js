// vegetation.js — 草・稲・畑と共有風を作り、木はTreeFieldへ渡す（view層）。
// 配置は scatter.js（純関数）から受ける。外部素材なし。形と葉の絵は手続きで作る。
import * as THREE from 'three';
import { mulberry32 } from './scatter.js';
import { TreeField } from './tree-view.js';
import { buildGrass } from './grass-view.js';

const TAU = Math.PI * 2;

// ---- 形状づくりの小道具 ----
class Mesher {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.uv = []; this.idx = []; }
  vert(p, n, c, uv = [0, 0]) { this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.col.push(c[0], c[1], c[2]); this.uv.push(uv[0], uv[1]); return this.pos.length / 3 - 1; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

function cropGeometry() {
  // 野菜の株：根もとから広がる幅広の葉を輪にする（畝に並べる）。内側は暗く、先は明るい緑。
  const rnd = mulberry32(9301), m = new Mesher();
  for (let i = 0; i < 7; i++) {
    const th = i / 7 * TAU + rnd() * 0.5, len = 0.26 + rnd() * 0.1, wid = 0.17 + rnd() * 0.05, rise = 0.14 + rnd() * 0.12;
    const dir = [Math.cos(th), Math.sin(th)], sx = -dir[1], sz = dir[0], first = m.pos.length / 3, segs = 2;
    for (let k = 0; k <= segs; k++) {
      const t = k / segs, ww = wid * Math.sin(Math.min(1, t * 1.5 + 0.15) * Math.PI * 0.62) * (1 - t * 0.3);
      const px = dir[0] * (0.03 + len * t), pz = dir[1] * (0.03 + len * t), y = 0.03 + rise * Math.sin(t * Math.PI * 0.55) - 0.05 * t * t, shade = 0.55 + 0.6 * t;
      for (const sd of [-1, 1]) m.vert([px + sx * ww * sd, y, pz + sz * ww * sd], [0, 1, 0.2], [0.48 * shade, 0.64 * shade, 0.42 * shade], [sd < 0 ? 0 : 1, t]);
    }
    for (let k = 0; k < segs; k++) { const a = first + k * 2; m.quad(a, a + 1, a + 3, a + 2); }
  }
  return m.build();
}

function riceGeometry() {
  const rnd = mulberry32(9201);
  const m = new Mesher();
  for (let b = 0; b < 7; b++) {
    const th = rnd() * TAU, h = 0.75 + rnd() * 0.25, bend = 0.22 + rnd() * 0.25, w = 0.032;
    const dir = [Math.cos(th), Math.sin(th)], sx = -dir[1], sz = dir[0];
    const first = m.pos.length / 3, segs = 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs, ww = w * (1 - t * 0.6);
      const px = dir[0] * bend * t * t * h, pz = dir[1] * bend * t * t * h, y = t * h * (1 - 0.18 * t);
      const col = t > 0.62 ? [0.84, 0.64, 0.27] : [0.5, 0.5, 0.22];     // 実る穂は黄土色、茎はまだ緑が残る
      for (const sd of [-1, 1]) m.vert([px + sx * ww * sd, y, pz + sz * ww * sd], [0, 1, 0.1], [col[0] * (0.7 + 0.5 * t), col[1] * (0.7 + 0.5 * t), col[2] * (0.6 + 0.5 * t)], [sd < 0 ? 0 : 1, t]);
    }
    for (let s = 0; s < segs; s++) { const a = first + s * 2; m.quad(a, a + 1, a + 3, a + 2); }
  }
  return m.build();
}

// 風：時間・向き・揺れの強さを uniforms で受ける。高さの2乗で揺れ、葉は細かくはためく。
export function windUniforms() { return { uTime: { value: 0 }, uWind: { value: 1 }, uWindDir: { value: new THREE.Vector2(1, 0) }, uGuideMix: { value: 0 } }; }
function patchWind(material, uniforms, { height = 20, flutter = 0, fadeStart = 0, fadeEnd = 0 }) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      uniform float uTime; uniform float uWind;`).replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 iPos = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      #else
        vec3 iPos = vec3(0.0);
      #endif
      float ph = iPos.x * 0.37 + iPos.z * 0.21;
      float hf = clamp(transformed.y / ${height.toFixed(2)}, 0.0, 1.0);
      float sway = (sin(uTime * 1.15 + ph) + 0.5 * sin(uTime * 2.4 + ph * 1.7)) * 0.045 * hf * hf * uWind;
      transformed.x += sway * ${height.toFixed(2)} * 0.5; transformed.z += sway * ${height.toFixed(2)} * 0.28;
      transformed += vec3(sin(uTime * 3.6 + position.y * 1.9 + ph), 0.0, cos(uTime * 3.1 + position.x * 1.7 + ph)) * ${flutter.toFixed(3)} * hf * uWind;
      ${fadeEnd > 0 ? `{ float dd = distance(iPos, cameraPosition); transformed *= 1.0 - smoothstep(${fadeStart.toFixed(1)}, ${fadeEnd.toFixed(1)}, dd); }` : ''}`);
  };
  material.customProgramCacheKey = () => 'wind-' + height + '-' + flutter + '-' + fadeEnd;
}

// 草・稲：近くだけ見える（距離で縮めて消す）。空間の区画ごとに InstancedMesh を分け、視錐台と距離で区画ごと描かない。
export function makeTufts({ data, geometry, wind, height, fadeStart, fadeEnd, tintA, tintB, flutter = 0, chunk = 24 }) {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, alphaToCoverage: false, emissive: 0x24351c });
  patchWind(material, wind, { height, flutter: flutter + 0.01, fadeStart, fadeEnd });
  const n = data.x.length, buckets = new Map();
  for (let i = 0; i < n; i++) {
    const key = Math.floor(data.x[i] / chunk) + ',' + Math.floor(data.z[i] / chunk);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color(), a = new THREE.Color(tintA), b = new THREE.Color(tintB);
  const group = new THREE.Group(), chunks = [];
  for (const idx of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geometry, material, idx.length);
    idx.forEach((i, k) => {
      q.setFromAxisAngle(up, data.rot[i]); s.setScalar(data.s[i]); p.set(data.x[i], data.y[i] - 0.02, data.z[i]);
      m.compose(p, q, s); mesh.setMatrixAt(k, m);
      c.copy(a).lerp(b, data.tint[i]); mesh.setColorAt(k, c);
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = true;
    mesh.computeBoundingSphere();
    chunks.push({ mesh, x: mesh.boundingSphere.center.x, z: mesh.boundingSphere.center.z, r: mesh.boundingSphere.radius });
    group.add(mesh);
  }
  // カメラから fadeEnd より遠い区画は、縮んで見えないので描かない
  group.update = camera => { const cx = camera.position.x, cz = camera.position.z; for (const k of chunks) k.mesh.visible = Math.hypot(k.x - cx, k.z - cz) - k.r < fadeEnd; };
  group.userData.instances = n;
  return group;
}

export function buildVegetation({ scatter, quality = 'standard', field, sunDir, renderer = null }) {
  const wind = windUniforms();
  const group = new THREE.Group(); group.name = 'vegetation';
  const trees = new TreeField({ data: scatter.trees, species: scatter.species, understory: scatter.understory, wind, sunDir, quality, renderer });
  group.add(trees.group);
  const grass = buildGrass({ field, wind, quality, sunDir });
  const rice = makeTufts({ data: scatter.rice, geometry: riceGeometry(), wind, height: 1.0, fadeStart: 60, fadeEnd: 95, tintA: '#b8963c', tintB: '#d6b658', flutter: 0.02 });
  group.add(grass.group, rice);
  const crops = scatter.crops?.x.length ? makeTufts({ data: scatter.crops, geometry: cropGeometry(), wind, height: 0.4, fadeStart: 55, fadeEnd: 90, tintA: '#3d5230', tintB: '#617548', flutter: 0.01 }) : null;   // 家のそばの野菜畑
  if (crops) group.add(crops);
  return { group, trees, grass, rice, crops, wind };
}
