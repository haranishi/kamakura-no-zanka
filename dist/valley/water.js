// water.js — 川（清瀬川）の水面（view層）。川の中心線に沿った帯に、空を映して流れる水の面を張る。
// 岸との境目は、水面が地面より下になるところで自然に切れる（深度で隠れる）。帯の縁だけ透かし、浅いところは淡く・縁は白く泡立てる。
import * as THREE from 'three';

export function buildWater({ terrain, world }) {
  const L = terrain.riverLine, hw = world.river.halfWidth + 2.2;
  const pos = [], uv = [], idx = [];
  let along = 0;
  for (let i = 0; i < L.length; i++) {
    const p = L[i], a = L[Math.max(0, i - 1)], b = L[Math.min(L.length - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;
    if (i > 0) along += Math.hypot(p.x - L[i - 1].x, p.z - L[i - 1].z);
    const y = terrain.waterLevelAt(p.x, p.z);
    for (const s of [-1, 1]) { pos.push(p.x + nx * hw * s, y, p.z + nz * hw * s); uv.push(s, along); }
    if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(idx);
  geometry.computeVertexNormals();
  // 面が下向きなら巻き順を反転する（どちら向きの川でも上を向く）
  if (geometry.attributes.normal.getY(0) < 0) { const a = geometry.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } geometry.index.needsUpdate = true; geometry.computeVertexNormals(); }

  const uniforms = { uTime: { value: 0 } };
  const material = new THREE.MeshStandardMaterial({ color: 0x23565c, roughness: 0.09, metalness: 0.0, transparent: true, opacity: 0.92, depthWrite: false, envMapIntensity: 0.95 });
  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWUv; varying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWUv = uv; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; varying vec2 vWUv; varying vec3 vWPos;
        float w_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float w_noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(w_hash(i), w_hash(i + vec2(1., 0.)), f.x), mix(w_hash(i + vec2(0., 1.)), w_hash(i + vec2(1.)), f.x), f.y); }
        float w_fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * w_noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
        float w_height(vec2 p) { return w_fbm(p * vec2(0.9, 0.55) + vec2(0.0, -uTime * 0.55)) + 0.5 * w_fbm(p * 2.1 + vec2(uTime * 0.18, -uTime * 0.9)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float edge = abs(vWUv.x);
        vec3 deep = vec3(0.035, 0.12, 0.15), shallow = vec3(0.14, 0.27, 0.26);
        diffuseColor.rgb = mix(deep, shallow, smoothstep(0.35, 1.0, edge));
        float foam = smoothstep(0.80, 0.98, edge) * smoothstep(0.35, 0.8, w_fbm(vWPos.xz * 1.6 + vec2(0.0, -uTime * 0.6)));
        float streak = smoothstep(0.72, 0.9, w_fbm(vWPos.xz * vec2(2.4, 0.7) + vec2(0.0, -uTime * 0.8))) * 0.35;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.88), clamp(foam + streak * (1.0 - edge), 0.0, 0.85));
        diffuseColor.a *= 1.0 - smoothstep(0.93, 1.0, edge);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 p = vWPos.xz; float e = 0.16;
          float h0 = w_height(p), hx = w_height(p + vec2(e, 0.0)), hz = w_height(p + vec2(0.0, e));
          vec3 nw = normalize(vec3((h0 - hx) * 0.9, 1.0, (h0 - hz) * 0.9));
          normal = normalize(mix(normal, normalize((viewMatrix * vec4(nw, 0.0)).xyz), 0.85));
        }`);
  };
  material.customProgramCacheKey = () => 'valley-water-v1';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'water'; mesh.renderOrder = 2; mesh.receiveShadow = false; mesh.castShadow = false; mesh.frustumCulled = false;
  return { mesh, update(time) { uniforms.uTime.value = time; } };
}
