// village-yard-view.js — 里のかまどの煙と働く人の影絵（W2c-23e・view層）。
// 座標・当たり・任務は変えない。&yard=0 で消える。見渡し（concept）から読めることを目標にする。
import * as THREE from 'three';
import {
  YARD, yardEnabled, yardSmokeSpots, yardWorkerSpots, yardWorkerCount, yardSmokePuffCount, farScaleAt,
} from './village-yard.js';

const gl = n => Number(n).toFixed(8);
const rgb = a => `vec3(${a.map(gl).join(',')})`;

// ── 煙：十字の板を柱に積み、頂点シェーダーだけで立ち上がる（CPU は動かさない）──
const SMOKE_VERTEX = `
attribute vec4 yardAnchor;   // xyz = 根元、w = 柱の高さ
attribute vec4 yardSize;     // xy = 幅・高さの基準、z = 位相、w = 強さ
attribute vec2 yardSeed;
uniform float uTime;
uniform vec2 uWind;
varying vec2 vUv;
varying float vLift;
varying float vPower;
void main() {
  vUv = uv;
  float t = fract(yardSize.z + uTime * ${gl(YARD.smokeRise)});
  float rise = t * yardAnchor.w;
  float radius = yardSize.x * (1.0 + t * (${gl(YARD.smokeGrowth)} - 1.0));
  float sway = ${gl(YARD.smokeSway)} * sin(uTime * ${gl(YARD.smokeSwayHz * Math.PI * 2)} + yardSeed.x * 6.2831853);
  vec3 origin = yardAnchor.xyz;
  origin.y += rise;
  origin.xz += uWind * rise * ${gl(YARD.smokeWind)} + vec2(sway, sway * 0.7) * rise;
  vLift = t;
  vPower = yardSize.w * (1.0 - smoothstep(0.55, 1.0, t));
  float aspect = mix(1.0, ${gl(YARD.smokeTopAspect)}, smoothstep(0.5, 1.0, t));
  vec3 toward = cameraPosition - origin;
  vec3 facing = normalize(toward + vec3(0.0001, 0.0001, 0.0));
  vec3 right = normalize(vec3(facing.z, 0.0, -facing.x) + vec3(0.0001, 0.0, 0.0));
  vec3 up = normalize(cross(facing, right));
  vec3 p = origin + right * (uv.x - 0.5) * radius * 2.0 + up * (uv.y - 0.5) * radius * 2.0 * aspect;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const SMOKE_FRAGMENT = `
uniform float uTime;
uniform vec3 uFogColor;
varying vec2 vUv;
varying float vLift;
varying float vPower;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),u.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0)),u.x),u.y);}
void main() {
  vec2 q = (vUv - 0.5) * 2.0;
  float n = noise(q * ${gl(YARD.smokeNoise)} + vec2(vLift * 2.0, -uTime * ${gl(YARD.smokeRise)}));
  float edge = 1.0 - length(q) - n * ${gl(YARD.smokeEdge)};
  float alpha = smoothstep(0.0, ${gl(YARD.smokeEdgeSoft)}, edge) * ${gl(YARD.smokeDensity)} * vPower;
  if (alpha < 0.01) discard;
  vec3 color = mix(${rgb([...YARD.smokeDark])}, ${rgb([...YARD.smokeMid])}, smoothstep(0.0, 0.45, vLift));
  color = mix(color, ${rgb([...YARD.smokeLit])}, (1.0 - smoothstep(0.0, 0.25, vLift)) * 0.35);
  color = mix(color, uFogColor, smoothstep(0.4, 1.0, vLift) * 0.45);
  gl_FragColor = vec4(color, alpha);
}`;

// ── 働く人：胴・頭・脚の簡易影絵。遠景では実物より大きく（farScale）──
function workerGeometry(role = 'talk') {
  const positions = [], normals = [];
  const pushBox = (cx, cy, cz, w, h, d) => {
    const hx = w / 2, hy = h / 2, hz = d / 2;
    const faces = [
      [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [0, 0, 1]],
      [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [0, 0, -1]],
      [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz], [0, 1, 0]],
      [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz], [0, -1, 0]],
      [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [1, 0, 0]],
      [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-1, 0, 0]],
    ];
    for (const [a, b, c, d, n] of faces) {
      for (const p of [a, b, c, a, c, d]) {
        positions.push(cx + p[0], cy + p[1], cz + p[2]);
        normals.push(n[0], n[1], n[2]);
      }
    }
  };
  const bend = role === 'rice' || role === 'thresh' || role === 'dry' || role === 'wood';
  const torsoH = bend ? 0.55 * YARD.bend + 0.2 : 0.7;
  const torsoY = bend ? 0.55 + torsoH / 2 : 0.9;
  pushBox(0, 0.28, 0, 0.22, 0.55, 0.18);                 // 脚の塊
  pushBox(0, torsoY, bend ? -0.12 : 0, 0.34, torsoH, 0.22); // 胴
  pushBox(0, torsoY + torsoH / 2 + 0.14, bend ? -0.18 : 0, 0.22, 0.22, 0.22); // 頭
  if (role === 'carry') pushBox(0, 1.15, -0.18, 0.38, 0.22, 0.18); // 荷
  if (role === 'wood') pushBox(0.28, 0.85, 0, 0.08, 0.7, 0.08);    // 薪束の棒
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return g;
}

function smokeBatch(capacity, fogColor) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  for (const [name, size] of [['yardAnchor', 4], ['yardSize', 4], ['yardSeed', 2]]) {
    g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size));
  }
  g.instanceCount = 0;
  const uniforms = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(0.9, 0.2) },
    uFogColor: { value: fogColor.clone() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: SMOKE_VERTEX, fragmentShader: SMOKE_FRAGMENT,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  material.forceSinglePass = true;
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'village-yard-smoke';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.castShadow = mesh.receiveShadow = false;
  return { mesh, uniforms, capacity };
}

function putSmoke(batch, i, x, y, z, height, base, phase, strength, seed) {
  const g = batch.mesh.geometry;
  g.attributes.yardAnchor.setXYZW(i, x, y, z, height);
  g.attributes.yardSize.setXYZW(i, base, base, phase, strength);
  g.attributes.yardSeed.setXY(i, seed, seed * 0.71);
}

export function buildVillageYard({ world, terrain, quality = () => 'standard', search = '' }) {
  const group = new THREE.Group();
  group.name = 'village-yard';
  if (!yardEnabled(search)) return { group, update() {}, dispose() {}, stats: () => ({ smoke: 0, workers: 0, puffs: 0 }) };

  const smokeSpots = yardSmokeSpots(world);
  const workerSpots = yardWorkerSpots(world);
  const fogColor = new THREE.Color(0xb8c0c4);
  const maxPuffs = YARD.smokePuffs;
  const smoke = smokeBatch(smokeSpots.length * maxPuffs, fogColor);
  group.add(smoke.mesh);

  // 煙のインスタンスを一度だけ置く（位相だけずらす）。品質で本数を落とす。
  function packSmoke(q) {
    const n = yardSmokePuffCount(q);
    let i = 0;
    for (const s of smokeSpots) {
      const y0 = terrain.heightAt(s.x, s.z) + (s.lift || 0.4);
      const h = YARD.smokeHeight * (0.85 + 0.3 * s.strength);
      const base = YARD.smokeBase * (0.7 + 0.4 * s.strength);
      for (let k = 0; k < n; k++) {
        const phase = (k + 0.5) / n;
        const seed = (s.id.charCodeAt(0) * 0.01 + k * 0.17) % 1;
        putSmoke(smoke, i++, s.x, y0, s.z, h, base * (0.85 + 0.3 * ((k * 17) % 5) / 5), phase, s.strength, seed);
      }
    }
    smoke.mesh.geometry.instanceCount = i;
    for (const a of ['yardAnchor', 'yardSize', 'yardSeed']) smoke.mesh.geometry.attributes[a].needsUpdate = true;
  }

  // 働く人：役割ごとに形を分け、InstancedMesh で置く。
  const roles = ['rice', 'thresh', 'dry', 'wood', 'carry', 'talk'];
  const byRole = Object.fromEntries(roles.map(r => [r, []]));
  for (const w of workerSpots) (byRole[w.role] || byRole.talk).push(w);
  const clothes = YARD.clothes.map(c => new THREE.Color(c));
  const workerMeshes = [];
  const dummy = new THREE.Object3D();
  const colorAttr = [];

  for (const role of roles) {
    const list = byRole[role];
    if (!list.length) continue;
    const geo = workerGeometry(role);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, fog: true });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    mesh.name = `village-yard-worker-${role}`;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.count = 0;
    const colors = new Float32Array(list.length * 3);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    group.add(mesh);
    workerMeshes.push({ mesh, list, colors, role });
    colorAttr.push(mesh);
  }

  function packWorkers(q, camera) {
    const limit = yardWorkerCount(q);
    const range = q === 'light' ? YARD.lightRange : YARD.range;
    const cam = camera?.position;
    let placed = 0;
    for (const batch of workerMeshes) {
      let n = 0;
      for (let i = 0; i < batch.list.length && placed < limit; i++) {
        const w = batch.list[i];
        if (cam && Math.hypot(w.x - cam.x, w.z - cam.z) > range) continue;
        const y = terrain.heightAt(w.x, w.z);
        const dist = cam ? Math.hypot(w.x - cam.x, y - cam.y, w.z - cam.z) : 150;
        const scale = YARD.workerHeight * farScaleAt(dist);
        dummy.position.set(w.x, y, w.z);
        dummy.rotation.set(0, w.yaw || 0, 0);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        batch.mesh.setMatrixAt(n, dummy.matrix);
        const c = clothes[(w.id.charCodeAt(2) + i) % clothes.length];
        batch.colors[n * 3] = c.r; batch.colors[n * 3 + 1] = c.g; batch.colors[n * 3 + 2] = c.b;
        n++; placed++;
      }
      batch.mesh.count = n;
      batch.mesh.instanceMatrix.needsUpdate = true;
      batch.mesh.instanceColor.needsUpdate = true;
    }
    return placed;
  }

  let lastQ = null, lastCam = new THREE.Vector3(1e9, 0, 1e9), disposed = false, workerCount = 0;
  packSmoke(quality());
  workerCount = packWorkers(quality(), null);

  return {
    group,
    update(t, camera, wind) {
      if (disposed) return;
      smoke.uniforms.uTime.value = t;
      if (wind?.uWindDir?.value) smoke.uniforms.uWind.value.set(wind.uWindDir.value.x, wind.uWindDir.value.z ?? wind.uWindDir.value.y);
      else if (wind?.uWind) smoke.uniforms.uWind.value.set(0.9 * (wind.uWind.value || 1), 0.25);
      const q = quality();
      if (q !== lastQ) { lastQ = q; packSmoke(q); workerCount = packWorkers(q, camera); lastCam.copy(camera?.position || lastCam); }
      else if (camera && camera.position.distanceToSquared(lastCam) > 25) {
        lastCam.copy(camera.position);
        workerCount = packWorkers(q, camera);
      }
    },
    dispose() {
      disposed = true;
      smoke.mesh.geometry.dispose();
      smoke.mesh.material.dispose();
      for (const b of workerMeshes) { b.mesh.geometry.dispose(); b.mesh.material.dispose(); }
      group.clear();
    },
    stats: () => ({
      smoke: smokeSpots.length,
      workers: workerCount,
      puffs: smoke.mesh.geometry.instanceCount,
      spots: smokeSpots.length,
    }),
  };
}
