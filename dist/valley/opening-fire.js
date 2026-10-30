// opening-fire.js — オープニングの舞台の絵の部品（view層）：炎の舌と光のにじみ（加算の板）、煙の空、地面の質感、影の人物の材質。
// 画像は使わず、すべて手続き（シェーダーの雑音）で作る。新しい素材を増やさない（design-opening.md §6）。
// 炎の板は場面ごとに1つの描画呼出（インスタンス）。明るさの揺らぎは opening.js の flicker（1.1Hz以下）だけで、
// 雑音は舌の形を動かすが、場面全体の明るさを点滅させない（R22.5）。
import * as THREE from 'three';

const NOISE = `
  float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }`;

// 炎の舌（kind 0）と光のにじみ（kind 1）。舌は縦軸だけカメラへ向ける板、にじみは正面を向く板。
// pull だけカメラ側へ寄せて、屋根や壁に刺さる直線を見せない
export class FlameField {
  constructor(sprites) {
    const base = new THREE.PlaneGeometry(1, 1, 1, 1); base.translate(0.5, 0.5, 0);    // uv と位置を 0〜1 にそろえる
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.getAttribute('position')); g.setAttribute('uv', base.getAttribute('uv'));
    const n = sprites.length, pos = new Float32Array(n * 3), size = new Float32Array(n * 4), seed = new Float32Array(n * 2);
    sprites.forEach((s, i) => { pos.set(s.pos, i * 3); size.set([s.w, s.h, s.pull, s.kind], i * 4); seed.set([s.seed, s.power], i * 2); });
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 3)); g.setAttribute('iSize', new THREE.InstancedBufferAttribute(size, 4)); g.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seed, 2));
    g.instanceCount = n;
    this.base = base; this.geometry = g;
    this.uniforms = { uTime: { value: 0 }, uGain: { value: 1 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2() }, uFog: { value: new THREE.Vector2(10, 100) } };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: `attribute vec3 iPos; attribute vec4 iSize; attribute vec2 iSeed;
        uniform vec3 uCam; uniform vec2 uWind; varying vec2 vUv; varying vec3 vS; varying float vDepth;
        void main(){
          vUv = uv; vS = vec3(iSeed, iSize.w);
          vec3 c0 = (modelMatrix * vec4(iPos, 1.0)).xyz;                       // 場面の組の置き場（平行移動だけ）を足した世界座標
          vec3 toCam = uCam - c0; vec3 flat3 = normalize(vec3(toCam.x, 0.0, toCam.z) + vec3(1e-4, 0.0, 0.0));
          vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), flat3)), up = vec3(0.0, 1.0, 0.0);
          if (iSize.w > 0.5) { vec3 f = normalize(toCam); right = normalize(cross(vec3(0.0, 1.0, 0.0), f)); up = cross(f, right); }
          float y = iSize.w > 0.5 ? uv.y - 0.5 : uv.y;
          vec3 p = c0 + right * (uv.x - 0.5) * iSize.x + up * y * iSize.y;
          if (iSize.w < 0.5) p.xz += uWind * uv.y * uv.y * iSize.y * 0.3;            // 舌の先は風下へ傾く（煙・火の粉と同じ向き）
          p += normalize(toCam) * iSize.z;
          vec4 mv = viewMatrix * vec4(p, 1.0); vDepth = -mv.z;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uTime, uGain; uniform vec2 uFog; varying vec2 vUv; varying vec3 vS; varying float vDepth; ${NOISE}
        void main(){
          float fogK = 1.0 - 0.88 * smoothstep(uFog.x, uFog.y, vDepth);
          if (vS.z > 0.5) {                                                    // 光のにじみ：煙と空気が炎に照らされた明かり
            vec2 q = vUv - 0.5; float r = length(q) * 2.0;
            float a = exp(-r * r * 3.2) * (1.0 - smoothstep(0.75, 1.0, r));
            gl_FragColor = vec4(vec3(1.0, 0.4, 0.13) * a * vS.y * uGain * fogK, 1.0); return; }
          // 舌：根元は太く、上ほど細い涙形。大きな揺れ（n）が舌を左右へ振り、細かい揺れ（n2）が先端をちぎる
          float y = vUv.y, x = (vUv.x - 0.5) * 2.0, sd = vS.x * 31.7, t = uTime;
          float n = fbm(vec2(x * 1.4 + sd, y * 2.0 - t * 1.5 + sd));
          float n2 = fbm(vec2(x * 3.1 - sd * 0.7, y * 3.8 - t * 2.3 + sd * 1.9));
          float shape = 1.0 - abs(x + (n - 0.5) * 0.9 * y) * (1.0 + y * 1.25) - pow(y, 1.5) * 0.95 + (n2 - 0.5) * 0.7 * (0.15 + y);
          float f = smoothstep(0.0, 0.24, shape) * smoothstep(0.0, 0.08, y);
          float core = smoothstep(0.2, 0.75, shape);
          vec3 c = mix(vec3(0.55, 0.06, 0.01), vec3(1.0, 0.3, 0.04), smoothstep(0.0, 0.5, core));
          c = mix(c, vec3(1.0, 0.62, 0.26), smoothstep(0.6, 1.0, core));
          gl_FragColor = vec4(c * f * (0.5 + 0.9 * core) * vS.y * uGain * fogK, 1.0); }`,
    });
    this.mesh = new THREE.Mesh(g, this.material); this.mesh.frustumCulled = false; this.mesh.renderOrder = 6; this.mesh.name = 'flames';
  }
  update(time, camera, gain, wind, fog) {
    const u = this.uniforms; u.uTime.value = time; u.uGain.value = gain; u.uCam.value.copy(camera.position);
    u.uWind.value.set(wind[0], wind[1]); u.uFog.value.set(fog.near, fog.far);
  }
  dispose() { this.mesh.removeFromParent(); this.geometry.dispose(); this.base.dispose(); this.material.dispose(); }
}

// 空：上は墨、地平は灰がかった生成り、炎の方角だけ朱のにじみ。煙の雲が風下へゆっくり流れ、下から炎に照らされる
export function skyMaterial() {
  const C = () => ({ value: new THREE.Color() });
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { top: C(), mid: C(), hor: C(), glow: C(), smokeDark: C(), smokeLit: C(), glowDir: { value: new THREE.Vector2(0, -1) }, glowAmt: { value: 0.5 }, glowSpread: { value: 3 }, glowRise: { value: 7 }, smoke: { value: 0.8 }, time: { value: 0 }, wind: { value: new THREE.Vector2(0.9, 0.2) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vDir; uniform vec3 top, mid, hor, glow, smokeDark, smokeLit; uniform vec2 glowDir, wind; uniform float glowAmt, glowSpread, glowRise, smoke, time; ${NOISE}
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 c = mix(hor, mid, smoothstep(-0.03, 0.16, h)); c = mix(c, top, smoothstep(0.14, 0.62, h));
        vec2 hz = normalize(d.xz + vec2(1e-4)); float g = pow(max(dot(hz, normalize(glowDir)), 0.0), glowSpread) * exp(-max(h, 0.0) * glowRise) * smoothstep(-0.2, 0.0, h);
        vec2 uv = d.xz / (max(h, 0.0) + 0.16) * 0.55 - wind * time * 0.035;
        float n = fbm(uv), n2 = fbm(uv * 2.6 + 3.1);
        float s = smoothstep(0.38, 0.78, n * 0.75 + n2 * 0.35) * smoke * smoothstep(-0.04, 0.08, h);
        vec3 sc = mix(smokeDark, smokeLit, clamp(g * 1.4 + (1.0 - smoothstep(0.0, 0.3, h)) * 0.25, 0.0, 1.0) * (0.6 + 0.4 * n2));
        c = mix(c, sc, s);
        c += glow * g * glowAmt * (1.0 - 0.55 * s);
        gl_FragColor = vec4(c, 1.0); }`,
  });
}
export function paintSky(material, sky, wind) {
  const u = material.uniforms;
  for (const k of ['top', 'mid', 'hor', 'glow', 'smokeDark', 'smokeLit']) u[k].value.set(sky[k]);
  u.glowDir.value.set(sky.glowDir[0], sky.glowDir[1]); u.glowAmt.value = sky.glowAmt; u.glowSpread.value = sky.glowSpread; u.glowRise.value = sky.glowRise ?? 7; u.smoke.value = sky.smoke;
  if (wind) u.wind.value.set(wind[0], wind[1]);
}

// 地面：踏み固めた土に、灰・煤の暗い斑と、乾いた明るい土。世界座標の雑音で色と凹凸（法線）を作る（板の継ぎ目や繰り返しが出ない）
// flat=false（石段の蹴上げなど、上を向かない面）では凹凸を付けず、色の斑だけを高さにも沿わせる
export function groundMaterial(g, { flat = true } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.94, metalness: 0 });
  const uni = { uBase: { value: new THREE.Color(g.base) }, uDark: { value: new THREE.Color(g.dark) }, uLight: { value: new THREE.Color(g.light) }, uScale: { value: g.scale } };
  const P = flat ? 'vGW.xz' : '(vGW.xz + vGW.yy * vec2(0.83, -0.61))';
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uni);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vGW; uniform vec3 uBase, uDark, uLight; uniform float uScale; ${NOISE}
      float gh(vec2 p){ return fbm(p * uScale) * 0.7 + fbm(p * uScale * 5.3) * 0.3; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 gp = ${P}; float gn = gh(gp), gs = fbm(gp * uScale * 0.31 + 7.0), gf = vnoise(gp * 9.0);
        vec3 gc = mix(uBase, uDark, smoothstep(0.42, 0.7, gs)); gc = mix(gc, uLight, smoothstep(0.55, 0.85, gn) * 0.6);
        diffuseColor.rgb = gc * (0.82 + 0.36 * gf);`)
      .replace('#include <normal_fragment_maps>', flat ? `#include <normal_fragment_maps>
        { float e = 0.04; float h0 = gh(vGW.xz), hx = gh(vGW.xz + vec2(e, 0.0)), hz = gh(vGW.xz + vec2(0.0, e));
          vec3 wn = normalize(vec3(-(hx - h0) / e * 0.35, 1.0, -(hz - h0) / e * 0.35));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz); }` : '#include <normal_fragment_maps>')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(0.86 + 0.12 * gn, 0.0, 1.0);');
  };
  m.customProgramCacheKey = () => 'opening-ground-' + (flat ? 1 : 0);
  return m;
}

// 石（石段・基壇）：灰の御影石に、煤の暗い斑
export function stoneMaterial() { return groundMaterial({ base: '#5a544e', dark: '#26231f', light: '#776d64', scale: 1.4 }, { flat: false }); }
