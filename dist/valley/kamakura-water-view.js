// Valley water appearance copied unchanged in style; distance gate and standard fog added for Kamakura.
// Keep water.js independent. MeshStandardMaterial includes the installed atmosphere fog chunks.
import * as THREE from 'three';
export function buildKamakuraWater(prepared, { sunDir = new THREE.Vector3(.5, .17, .85) } = {}) {
  const group = new THREE.Group(); group.name = 'kamakura-rivers';
  const uniforms = { uTime: { value: 0 } };
  const material = new THREE.MeshStandardMaterial({ color: 0x23565c, roughness: 0.09, metalness: 0.0, transparent: true, opacity: 0.92, depthWrite: false, envMapIntensity: 0.95 });
  material.fog = true;
  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = uniforms.uTime; shader.uniforms.uWaterDistance = { value: prepared.policy.maxDistance }; shader.uniforms.SUN_DIR_W = { value: sunDir.clone().normalize() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWUv; varying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWUv = uv; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uWaterDistance; uniform float uTime; varying vec2 vWUv; varying vec3 vWPos; uniform vec3 SUN_DIR_W;
        float w_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float w_noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(w_hash(i), w_hash(i + vec2(1., 0.)), f.x), mix(w_hash(i + vec2(0., 1.)), w_hash(i + vec2(1.)), f.x), f.y); }
        float w_fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * w_noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
        float w_height(vec2 p) { return w_fbm(p * vec2(0.9, 0.55) + vec2(0.0, -uTime * 0.55)) + 0.5 * w_fbm(p * 2.1 + vec2(uTime * 0.18, -uTime * 0.9)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float waterDistance = length(vWPos.xz - cameraPosition.xz);
        if (waterDistance >= uWaterDistance) discard;
        diffuseColor.a *= 1.0 - smoothstep(uWaterDistance - 128.0, uWaterDistance, waterDistance);
        float edge = abs(vWUv.x);
        vec3 deep = vec3(0.035, 0.12, 0.15), shallow = vec3(0.14, 0.27, 0.26);
        diffuseColor.rgb = mix(deep, shallow, smoothstep(0.35, 1.0, edge));
        float foam = smoothstep(0.80, 0.98, edge) * smoothstep(0.35, 0.8, w_fbm(vWPos.xz * 1.6 + vec2(0.0, -uTime * 0.6)));
        float streak = smoothstep(0.72, 0.9, w_fbm(vWPos.xz * vec2(2.4, 0.7) + vec2(0.0, -uTime * 0.8))) * 0.35;
        // 白波：流れの筋に沿った細い泡の帯を、中ほどにも散らす（平らな灰青の面に見えた）。瀬の位置は川に沿った低周波のむらで決める
        float rapid = smoothstep(0.55, 0.8, w_fbm(vec2(vWUv.y * 0.035, 3.7))) * smoothstep(0.35, 0.7, w_fbm(vWPos.xz * vec2(3.6, 1.1) + vec2(0.0, -uTime * 1.3))) * (1.0 - smoothstep(0.75, 1.0, edge)) * 0.75;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.88), clamp(foam + rapid + streak * (1.0 - edge), 0.0, 0.88));
        diffuseColor.a *= 1.0 - smoothstep(0.93, 1.0, edge);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 p = vWPos.xz; float e = 0.16;
          float h0 = w_height(p), hx = w_height(p + vec2(e, 0.0)), hz = w_height(p + vec2(0.0, e));
          vec3 nw = normalize(vec3((h0 - hx) * 0.9, 1.0, (h0 - hz) * 0.9));
          normal = normalize(mix(normal, normalize((viewMatrix * vec4(nw, 0.0)).xyz), 0.85));
        }`)
      // 夕日の照り返し：太陽の方向へ細い光の筋が水面に伸びる（波の法線で割れる）。見る角度が浅いほど強い
      .replace('#include <opaque_fragment>', `
        {
          vec3 vdir = normalize(vWPos - cameraPosition);
          vec3 wn = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          vec3 rf = reflect(vdir, wn);
          float glint = pow(max(dot(rf, SUN_DIR_W), 0.0), 90.0) * 3.0 + pow(max(dot(rf, SUN_DIR_W), 0.0), 14.0) * 0.35;
          outgoingLight += vec3(1.0, 0.78, 0.55) * glint * (1.0 - abs(vdir.y));
        }
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'kamakura-water-v1';
  let disposed = false;
  function dispose() {
    if (disposed) return; disposed = true;
    for (const mesh of group.children) mesh.geometry.dispose();
    group.clear(); group.removeFromParent(); material.dispose();
  }
  try {
    for (const chunk of prepared.chunks) {
      const geometry = new THREE.BufferGeometry();
      // Attach before filling so that partial construction is also owned by dispose().
      const mesh = new THREE.Mesh(geometry, material); group.add(mesh);
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(chunk.positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(chunk.uvs, 2));
      geometry.setIndex(chunk.indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      mesh.name = 'kamakura-water'; mesh.renderOrder = 2; mesh.frustumCulled = true;
    }
    return { group, material, uniforms, update(time) { if (!disposed) uniforms.uTime.value = time; }, dispose };
  } catch (error) { dispose(); throw error; }
}
