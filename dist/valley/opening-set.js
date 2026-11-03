// opening-set.js — オープニングの舞台の大道具（view層）：川面、家並み（谷のモデルのインスタンス／手続きの遠い町）、山並み、霧の層、
// 杉の木立、瓦の付いた塀、草むら、小石、人影の荷。画像は使わず、すべて手続き（新しい素材を増やさない。design-opening.md §6）。
// 置き場と数は opening-scenes.js（純粋層）が決め、ここは形と材質を作るだけ。自分で作った形・材質は呼び出し側（opening-stage.js）が
// own() で控えて解放する。谷のモデルの形と材質は共有なので、インスタンスにしても解放しない（インスタンスの行列の箱だけを返す）。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cellRand } from './scatter.js';

const NOISE = `
  float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }`;

// 川面：暗い水に、波で砕けた炎の照り返し（縦に伸びる切れ切れの光）と、空の照り返し。場面の光源は受けない（板のように光る反射を出さない）。
// fires は照り返す炎の [x, y, z, 強さ]（世界座標）。波は流れと直角に長い（照り返しが縦の筋に砕ける）
export class WaterSurface {
  constructor({ width, length, center, y, color, fires }) {
    this.geometry = new THREE.PlaneGeometry(width, length, 1, 1).rotateX(-Math.PI / 2).translate(center[0], y, center[2]);
    const f4 = Array.from({ length: 4 }, (_, i) => new THREE.Vector4(...(fires[i] || [0, 0, 0, 0])));
    this.uniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uDeep: { value: new THREE.Color(color) }, uHor: { value: new THREE.Color() }, uTop: { value: new THREE.Color() },
      uFire: { value: f4 }, uFireCol: { value: new THREE.Color('#ff8a3c') }, uFogCol: { value: new THREE.Color() }, uFog: { value: new THREE.Vector2(10, 100) }, uOrigin: { value: new THREE.Vector3() } };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, fog: false,
      vertexShader: 'varying vec3 vW; varying float vDepth; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: `varying vec3 vW; varying float vDepth; uniform float uTime; uniform vec3 uCam, uDeep, uHor, uTop, uFireCol, uFogCol, uOrigin; uniform vec2 uFog; uniform vec4 uFire[4]; ${NOISE}
        void main(){
          vec2 q = vW.xz, a = vec2(q.x * 0.5, q.y * 2.2 - uTime * 0.55), b = vec2(q.x * 1.9, q.y * 6.0 + uTime * 0.9); float e = 0.04;
          a += vec2(fbm(q * vec2(0.09, 0.3)) * 3.0, fbm(q * vec2(0.2, 0.07) + 9.0) * 2.0);                       // 波の列を歪めて、縞の繰り返しを崩す
          float h0 = fbm(a), hx = fbm(a + vec2(e * 0.5, 0.0)), hz = fbm(a + vec2(0.0, e * 2.6));
          float g0 = vnoise(b), gx = vnoise(b + vec2(e * 1.9, 0.0)), gz = vnoise(b + vec2(0.0, e * 7.0));
          vec3 n = normalize(vec3(-((hx - h0) + 0.45 * (gx - g0)) / e * 0.1, 1.0, -((hz - h0) + 0.45 * (gz - g0)) / e * 0.1));
          vec3 V = normalize(uCam - vW), R = reflect(-V, n);
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
          vec3 col = uDeep + mix(uHor, uTop, smoothstep(0.0, 0.45, R.y)) * fres * 0.2;
          float glint = 0.0;
          for (int i = 0; i < 4; i++) {
            vec4 f = uFire[i]; if (f.w <= 0.0) continue;
            vec3 d = f.xyz + uOrigin - vW; float dist = length(d); d /= dist;
            float ang = clamp(7.0 / dist, 0.04, 0.4), c = dot(R, d);
            glint += f.w * 2.0 * smoothstep(cos(ang), cos(ang * 0.25), c) * (0.35 + 0.65 * smoothstep(0.55, 0.85, fbm(b * 0.7 + 4.0)));
          }
          col += uFireCol * glint * (0.2 + 0.8 * fres) * (0.3 + 0.7 * smoothstep(4.0, 22.0, vDepth));     // 手前ほど暗く、照り返しは切れ切れ
          gl_FragColor = vec4(mix(col, uFogCol, smoothstep(uFog.x, uFog.y, vDepth)), 1.0); }`,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material); this.mesh.name = 'river';
  }
  update(time, camera, sky, fog, origin) {
    const u = this.uniforms; u.uTime.value = time; u.uCam.value.copy(camera.position); u.uOrigin.value.fromArray(origin);
    u.uHor.value.set(sky.hor); u.uTop.value.set(sky.mid); u.uFogCol.value.copy(fog.color); u.uFog.value.set(fog.near, fog.far);
  }
  dispose() { this.mesh.removeFromParent(); this.geometry.dispose(); this.material.dispose(); }
}

// 谷のモデル（家・納屋・土蔵）を、場面の家並みとしてインスタンスで並べる（1種類につき部品の数だけの描画呼出）。形と材質は共有のまま。
// list は [{ at, rotY, scale, shade }]。shade は色の掛け算（煤けた・霧に沈む家を暗くする）。返すのは自分で作った InstancedMesh の一覧（解放はその dispose だけ）
export function instanceModel(src, list, { castShadow = true } = {}) {
  const out = [], root = new THREE.Matrix4(), part = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), color = new THREE.Color();
  src.updateMatrixWorld(true);
  const inv = src.matrixWorld.clone().invert();
  src.traverse(o => {
    if (!o.isMesh) return;
    const local = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const im = new THREE.InstancedMesh(o.geometry, o.material, list.length); im.castShadow = castShadow; im.receiveShadow = true; im.name = 'row-' + (src.name || 'model');
    list.forEach((h, i) => {
      q.setFromEuler(new THREE.Euler(0, h.rotY || 0, 0)); s.setScalar(h.scale || 1); p.fromArray(h.at);
      root.compose(p, q, s); part.multiplyMatrices(root, local); im.setMatrixAt(i, part);
      im.setColorAt(i, color.setScalar(h.shade ?? 1));
    });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere(); out.push(im);
  });
  return out;
}

// 手続きの家（箱の母屋と切妻の屋根）。遠い町を安く並べる。単位の箱（幅・奥行・高さ1）を、インスタンスの行列で伸ばす
function houseUnit() {
  const body = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0).toNonIndexed();
  const r = [-0.62, 1, -0.56, 0.62, 1, -0.56, 0, 1.62, -0.56, -0.62, 1, 0.56, 0.62, 1, 0.56, 0, 1.62, 0.56];
  const tri = (a, b, c) => [...r.slice(a * 3, a * 3 + 3), ...r.slice(b * 3, b * 3 + 3), ...r.slice(c * 3, c * 3 + 3)];
  const roofPos = [...tri(0, 2, 1), ...tri(3, 4, 5), ...tri(0, 3, 5), ...tri(0, 5, 2), ...tri(1, 2, 5), ...tri(1, 5, 4)];
  const roof = new THREE.BufferGeometry(); roof.setAttribute('position', new THREE.Float32BufferAttribute(roofPos, 3)); roof.computeVertexNormals();
  roof.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(roofPos.length / 3 * 2), 2));
  const paint = (g, c) => g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: g.attributes.position.count }, () => c).flat(), 3));
  paint(body, [0.13, 0.11, 0.095]); paint(roof, [0.065, 0.06, 0.056]);
  const g = mergeGeometries([body, roof]); body.dispose(); roof.dispose();
  return g;
}

// 遠い町：手続きの家をインスタンスで（1呼出）。houses は [{ at, size:[w,h,d], rotY, shade }]（opening-scenes.js の townHouses）
export function townField(houses) {
  const geo = houseUnit(), mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const im = new THREE.InstancedMesh(geo, mat, houses.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  houses.forEach((h, i) => { q.setFromEuler(new THREE.Euler(0, h.rotY, 0)); m.compose(new THREE.Vector3(...h.at), q, new THREE.Vector3(...h.size)); im.setMatrixAt(i, m); im.setColorAt(i, c.setScalar(h.shade)); });
  im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); im.receiveShadow = false; im.castShadow = false; im.name = 'town';
  return { mesh: im, geometry: geo, material: mat };
}

// 町の灯（窓・軒の火・燃え移った小さな火）。加算の点。明るさは動かさない（明滅させない）
export function lightDots(dots) {
  const n = dots.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  dots.forEach((d, i) => { pos.set(d.at, i * 3); col.set(d.color, i * 3); size[i] = d.size; });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aColor', new THREE.BufferAttribute(col, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const uniforms = { uScale: { value: 600 } };
  const m = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: 'attribute vec3 aColor; attribute float aSize; varying vec3 vC; uniform float uScale; void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = max(1.5, aSize * uScale / max(0.1, -mv.z)); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying vec3 vC; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = exp(-r * r * 4.0) * (1.0 - smoothstep(0.8, 1.0, r)); gl_FragColor = vec4(vC * a, 1.0); }',
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 5; pts.name = 'town-lights';
  return { points: pts, geometry: g, material: m, uniforms };
}

// 山並み：稜線を雑音で作った帯。ridges は [{ from:[x,z], to:[x,z], base, peak, seed, top, foot }]。色は頂（top）が濃く、裾（foot）が霧で淡い
// （線形の霧に任せると、遠い山は霧の色に溶けて砂丘のように見えた。山ごとの色を頂点の色で持ち、霧はかけない）
export function ridgeGeometry(ridges) {
  const parts = ridges.map((r, ri) => {
    const n = 64, pos = [], idx = [], col = [], cTop = new THREE.Color(r.top), cFoot = new THREE.Color(r.foot);
    for (let i = 0; i <= n; i++) {
      const k = i / n, x = r.from[0] + (r.to[0] - r.from[0]) * k, z = r.from[1] + (r.to[1] - r.from[1]) * k;
      const w = Math.sin(k * Math.PI * (2.1 + ri * 0.7) + r.seed) * 0.5 + Math.sin(k * Math.PI * 5.3 + r.seed * 2.1) * 0.3 + Math.sin(k * Math.PI * 11.7 + r.seed * 0.7) * 0.12;
      const top = r.base + (r.peak - r.base) * (0.55 + 0.45 * w) * Math.sin(Math.PI * Math.min(1, k * 1.15 + 0.05)) ** 0.35;
      pos.push(x, r.base - 30, z, x, top, z); col.push(cFoot.r, cFoot.g, cFoot.b, cTop.r, cTop.g, cTop.b);
      if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  });
  const g = mergeGeometries(parts); for (const p of parts) p.dispose();
  return g;
}

// 霧の層：谷の中景に横たわる薄い霧。下から炎の明かりを受けた淡い色。雑音の濃淡が風下へゆっくり流れる
export function mistMaterial({ color, opacity }) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uFogCol: { value: new THREE.Color() }, uFog: { value: new THREE.Vector2(10, 100) }, uWind: { value: new THREE.Vector2(0.5, 0.1) } },
    vertexShader: 'varying vec3 vW; varying vec2 vUv; varying float vDepth; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }',
    fragmentShader: `varying vec3 vW; varying vec2 vUv; varying float vDepth; uniform float uTime, uOpacity; uniform vec3 uColor, uFogCol; uniform vec2 uFog, uWind; ${NOISE}
      void main(){
        vec2 p = vW.xz * vec2(0.012, 0.03) - uWind * uTime * 0.01;
        float n = fbm(p) * 0.7 + fbm(p * 3.1 + 5.0) * 0.3;
        vec2 e = min(vUv, 1.0 - vUv);
        float a = smoothstep(0.35, 0.75, n) * smoothstep(0.0, 0.18, e.x) * smoothstep(0.0, 0.3, e.y) * uOpacity;
        gl_FragColor = vec4(mix(uColor, uFogCol, smoothstep(uFog.x, uFog.y, vDepth) * 0.6), a); }`,
  });
}

// 杉の木立：重ねた円錐の木（1本の形）をインスタンスで。trees は [{ at, h, r }]
export function treeField(trees) {
  const parts = [];
  for (let k = 0; k < 5; k++) { const y = 0.22 + k * 0.15, h = 0.36 - k * 0.03, r = 0.26 - k * 0.042; parts.push(new THREE.ConeGeometry(r, h, 7, 1).translate(0, y + h / 2, 0).toNonIndexed()); }
  parts.push(new THREE.CylinderGeometry(0.018, 0.026, 0.3, 5).translate(0, 0.15, 0).toNonIndexed());
  const geo = mergeGeometries(parts); for (const p of parts) p.dispose();
  const mat = new THREE.MeshStandardMaterial({ color: '#10140f', roughness: 1, metalness: 0 });
  const im = new THREE.InstancedMesh(geo, mat, trees.length), m = new THREE.Matrix4(), q = new THREE.Quaternion();
  trees.forEach((t, i) => { q.setFromEuler(new THREE.Euler(0, t.rotY || 0, 0)); m.compose(new THREE.Vector3(...t.at), q, new THREE.Vector3(t.h * t.r, t.h, t.h * t.r)); im.setMatrixAt(i, m); });
  im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.castShadow = true; im.receiveShadow = true; im.name = 'trees';
  return { mesh: im, geometry: geo, material: mat };
}

// 瓦の付いた塀（築地塀）：土壁の帯、白い漆喰の上部、瓦の小屋根（波打つ瓦の筋は材質で）。runs は [{ from:[x,z], to:[x,z] }]、h は壁の高さ
export function wallGeometry(runs, h) {
  const parts = [];
  for (const r of runs) {
    const dx = r.to[0] - r.from[0], dz = r.to[1] - r.from[1], len = Math.hypot(dx, dz), yaw = Math.atan2(-dz, dx), cx = (r.from[0] + r.to[0]) / 2, cz = (r.from[1] + r.to[1]) / 2;
    const place = g => g.rotateY(yaw).translate(cx, 0, cz).toNonIndexed();
    const wall = new THREE.BoxGeometry(len, h, 0.7).translate(0, h / 2, 0), base = new THREE.BoxGeometry(len, 0.35, 0.82).translate(0, 0.175, 0);
    const roof = new THREE.CylinderGeometry(0.78, 0.78, len + 0.2, 3, 1).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 0.42, 1).translate(0, h + 0.07, 0);   // 三角柱の頂を上へ
    const paint = (g, c) => { g = place(g); g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: g.attributes.position.count }, () => c).flat(), 3)); return g; };
    parts.push(paint(wall, [0.25, 0.21, 0.175]), paint(base, [0.12, 0.11, 0.1]), paint(roof, [0.075, 0.075, 0.085]));
  }
  for (const p of parts) for (const k of Object.keys(p.attributes)) if (!['position', 'normal', 'color'].includes(k)) p.deleteAttribute(k);
  const g = mergeGeometries(parts); for (const p of parts) p.dispose();
  return g;
}

// 草むら：細い葉を数枚、根元から外へ開いた株（1株の形）をインスタンスで。tufts は [{ at, h, rotY }]
export function tuftField(tufts, color) {
  const pos = [], col = [];
  for (let b = 0; b < 9; b++) {
    const a = b / 9 * Math.PI * 2 + b * 0.7, lean = 0.2 + (b % 3) * 0.14, w = 0.05, hh = 0.75 + (b % 4) * 0.12;
    const ox = Math.cos(a) * 0.04, oz = Math.sin(a) * 0.04, tx = Math.cos(a) * lean, tz = Math.sin(a) * lean, px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    pos.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, ox + tx * hh, hh, oz + tz * hh);
    col.push(0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 1, 1, 1);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  const im = new THREE.InstancedMesh(geo, mat, tufts.length), m = new THREE.Matrix4(), q = new THREE.Quaternion();
  tufts.forEach((t, i) => { q.setFromEuler(new THREE.Euler(0, t.rotY, 0)); m.compose(new THREE.Vector3(...t.at), q, new THREE.Vector3(t.h, t.h, t.h)); im.setMatrixAt(i, m); });
  im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.name = 'tufts';
  return { mesh: im, geometry: geo, material: mat };
}

// 小石・瓦礫：歪めた多面体をインスタンスで。stones は [{ at, size:[x,y,z], rotY, shade }]
export function stoneField(stones, color, seed = 5) {
  const geo = new THREE.IcosahedronGeometry(1, 0), p = geo.attributes.position, r = cellRand(seed, 1, 1);
  const moved = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = [p.getX(i), p.getY(i), p.getZ(i)].map(v => v.toFixed(3)).join();
    if (!moved.has(key)) moved.set(key, 0.75 + 0.45 * r());
    const k = moved.get(key); p.setXYZ(i, p.getX(i) * k, Math.max(-0.35, p.getY(i) * k), p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 });
  const im = new THREE.InstancedMesh(geo, mat, stones.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  stones.forEach((s, i) => { q.setFromEuler(new THREE.Euler(s.tilt || 0, s.rotY, 0)); m.compose(new THREE.Vector3(...s.at), q, new THREE.Vector3(...s.size)); im.setMatrixAt(i, m); im.setColorAt(i, c.setScalar(s.shade ?? 1)); });
  im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); im.castShadow = true; im.receiveShadow = true; im.name = 'stones';
  return { mesh: im, geometry: geo, material: mat };
}

// 人影の荷：背負った包み（pack）・抱いた子（baby）・天秤棒（pole）。人物の根の向き（前＝+z、上＝+y）で作り、骨（胸）に付ける
export function loadGeometry(kind) {
  const parts = [];
  if (kind === 'pack') {
    parts.push(new THREE.SphereGeometry(0.26, 10, 7).scale(1.05, 1.15, 0.72).translate(0, 1.18, -0.27));
    parts.push(new THREE.SphereGeometry(0.15, 8, 6).scale(1.2, 0.8, 0.9).translate(0, 1.5, -0.24));
  } else if (kind === 'baby') {
    parts.push(new THREE.SphereGeometry(0.13, 10, 7).scale(1.15, 1.35, 0.95).translate(0.02, 1.13, 0.2));
    parts.push(new THREE.SphereGeometry(0.075, 8, 6).translate(0.05, 1.33, 0.2));
  } else if (kind === 'pole') {
    parts.push(new THREE.CylinderGeometry(0.022, 0.022, 1.9, 6).rotateX(Math.PI / 2).translate(-0.17, 1.42, 0.02));
    for (const z of [-0.88, 0.9]) {
      parts.push(new THREE.CylinderGeometry(0.006, 0.006, 0.55, 3).translate(-0.17, 1.15, z));
      parts.push(new THREE.CylinderGeometry(0.2, 0.15, 0.3, 9).translate(-0.17, 0.75, z));
      parts.push(new THREE.SphereGeometry(0.17, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1).translate(-0.17, 0.9, z));
    }
  }
  const g = mergeGeometries(parts.map(x => x.toNonIndexed())); for (const p of parts) p.dispose();
  return g;
}
