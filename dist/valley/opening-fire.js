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
          // 根元は平らに切らない：横に揺れる雑音で、根元の消え方の高さを舌ごと・横の位置ごとにずらす（屋根に埋めた根元が覗いても直線にならない）
          float nb = vnoise(vec2(x * 2.6 + sd * 1.3, t * 0.5 + sd));
          float f = smoothstep(0.0, 0.24, shape) * smoothstep(0.02, 0.2 + 0.26 * nb, y);
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

// 地面：乾いた土に、灰・煤の暗い斑と、乾いた明るい土。世界座標の雑音で色と凹凸（法線）を作る（板の継ぎ目や繰り返しが出ない）。
// 凹凸は細かい粒（bumpScale 倍の細かさ）を弱く：大きな波の凹凸は、炎の照り返しで水面に見えた（2周目の講評）。
// ash：白っぽい灰の斑の量。path：[z0, z1]（世界座標）の帯を、踏み固めた明るい道にする（D の山道）。
// flat=false（石段の蹴上げなど、上を向かない面）では凹凸を付けず、色の斑だけを高さにも沿わせる。blocks：[幅, 高さ] の切石の目地（基壇・袖壁）
export function groundMaterial(g, { flat = true, blocks = null } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0 });
  m.envMapIntensity = 0.6;
  const uni = { uBase: { value: new THREE.Color(g.base) }, uDark: { value: new THREE.Color(g.dark) }, uLight: { value: new THREE.Color(g.light) }, uAsh: { value: new THREE.Color(g.ashColor || '#8a847b') },
    uScale: { value: g.scale }, uBump: { value: g.bump ?? 0.12 }, uBumpScale: { value: g.bumpScale ?? 3.2 }, uAshAmt: { value: g.ash ?? 0 }, uPath: { value: new THREE.Vector2(...(g.path || [1, 0])) } };
  const P = flat ? 'vGW.xz' : '(vGW.xz + vGW.yy * vec2(0.83, -0.61))';
  const B = blocks ? `{ vec3 an = abs(vGN); vec2 bp = an.y > 0.6 ? vGW.xz : (an.x > an.z ? vGW.zy : vGW.xy);
      vec2 c = bp / vec2(${blocks[0].toFixed(3)}, ${blocks[1].toFixed(3)}); c.x += mod(floor(c.y), 2.0) * 0.5; vec2 fc = fract(c), id = floor(c);
      float edge = min(min(fc.x, 1.0 - fc.x) * ${blocks[0].toFixed(3)}, min(fc.y, 1.0 - fc.y) * ${blocks[1].toFixed(3)});
      diffuseColor.rgb *= (0.78 + 0.4 * h21(id)) * mix(0.35, 1.0, smoothstep(0.012, 0.05, edge)); }` : '';
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uni);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW; varying vec3 vGN;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz; vGN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vGW; varying vec3 vGN; uniform vec3 uBase, uDark, uLight, uAsh; uniform float uScale, uBump, uBumpScale, uAshAmt; uniform vec2 uPath; ${NOISE}
      float gh(vec2 p){ return fbm(p * uScale) * 0.7 + fbm(p * uScale * 5.3) * 0.3; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 gp = ${P}; float gn = gh(gp), gs = fbm(gp * uScale * 0.31 + 7.0), gf = vnoise(gp * 9.0), ga = fbm(gp * uScale * 0.8 + 21.0);
        float onPath = uPath.x < uPath.y ? smoothstep(uPath.x, uPath.x + 0.35, vGW.z + (vnoise(vGW.xz * 1.3) - 0.5) * 0.5) * (1.0 - smoothstep(uPath.y - 0.35, uPath.y, vGW.z + (vnoise(vGW.xz * 1.1 + 3.0) - 0.5) * 0.5)) : 0.0;
        vec3 gc = mix(uBase, uDark, smoothstep(0.42, 0.7, gs) * (1.0 - 0.6 * onPath)); gc = mix(gc, uLight, max(smoothstep(0.55, 0.85, gn) * 0.6, onPath * 0.55));
        gc = mix(gc, uAsh, smoothstep(0.58, 0.8, ga) * uAshAmt);
        diffuseColor.rgb = gc * (0.82 + 0.36 * gf);
        ${B}`)
      .replace('#include <normal_fragment_maps>', flat ? `#include <normal_fragment_maps>
        { float e = 0.03; vec2 q = vGW.xz * uBumpScale; float h0 = gh(q), hx = gh(q + vec2(e, 0.0)), hz = gh(q + vec2(0.0, e));
          vec3 wn = normalize(vec3(-(hx - h0) / e * uBump, 1.0, -(hz - h0) / e * uBump));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz); }` : '#include <normal_fragment_maps>')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = 1.0;');
  };
  m.customProgramCacheKey = () => 'opening-ground-' + (flat ? 1 : 0) + (blocks ? '-' + blocks.join('x') : '');
  return m;
}

// 石（石段・基壇・袖壁）：灰の御影石の切石。目地と、石ごとの明るさの差、煤の暗い斑
export function stoneMaterial() { return groundMaterial({ base: '#625b53', dark: '#2a2622', light: '#7b7168', scale: 1.4 }, { flat: false, blocks: [1.1, 0.45] }); }

// 谷のモデルの材質の複製に、上乗せの細工をする（複製だけ。共有の材質には使わない）。前の onBeforeCompile（色の補正）の後に足す。
// roof：屋根（上向きの斜面）に瓦の筋と段、ember：焦げた屋根の下から透ける熾火（ゆっくり動く斑。明滅はしない）。stone：灯籠などを石の斑に
export function decorate(material, { roof = null, ember = null, stone = false, time }) {
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey?.() || '';
  const uni = { uTime: time, uEmber: { value: new THREE.Color(ember?.color || '#ff5a1a').multiplyScalar(ember?.power ?? 0) }, uRoofY: { value: roof?.y ?? 1e9 }, uEmberY: { value: ember?.y ?? 1e9 }, uEmberX: { value: new THREE.Vector2(...(ember?.x || [-1e9, 1e9])) } };
  material.onBeforeCompile = (shader, r) => {
    prev?.call(material, shader, r);
    Object.assign(shader.uniforms, uni);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vDW; varying vec3 vDN;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvDW = (modelMatrix * vec4(transformed, 1.0)).xyz; vDN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vDW; varying vec3 vDN; uniform float uTime, uRoofY, uEmberY; uniform vec3 uEmber; uniform vec2 uEmberX; ${NOISE}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float dRoof = ${roof ? '1.0' : '0.0'} * step(uRoofY, vDW.y) * smoothstep(0.2, 0.4, vDN.y) * (1.0 - smoothstep(0.93, 0.99, vDN.y));
        if (dRoof > 0.0) {                                                         // 瓦：斜面を下る丸瓦の列（横の周期）と、重なりの段（高さの周期）
          float along = abs(vDN.x) > abs(vDN.z) ? vDW.z : vDW.x;
          float ridge = abs(fract(along / ${(roof?.pitch || 0.3).toFixed(3)}) - 0.5) * 2.0, course = fract(vDW.y / ${(roof?.course || 0.22).toFixed(3)});
          diffuseColor.rgb *= mix(1.0, (0.55 + 0.45 * smoothstep(0.15, 0.85, ridge)) * (0.7 + 0.3 * smoothstep(0.0, 0.12, course)), dRoof);
        }
        ${stone ? 'diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15))) * vec3(1.0, 0.97, 0.92), diffuseColor.rgb, 0.35) * (0.62 + 0.55 * fbm(vDW.xz * 3.1 + vDW.yy * 2.3));' : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { float roofK = step(uEmberY, vDW.y) * smoothstep(0.15, 0.4, vDN.y) * step(uEmberX.x, vDW.x) * step(vDW.x, uEmberX.y);
          float e = smoothstep(0.55, 0.8, fbm(vDW.xz * 0.9 + vDW.yy * 0.4 + vec2(0.0, uTime * 0.04))) * (0.6 + 0.4 * fbm(vDW.xz * 3.7 - uTime * 0.03));
          totalEmissiveRadiance += uEmber * e * roofK; }`);
  };
  material.customProgramCacheKey = () => prevKey + '|deco-' + (roof ? 1 : 0) + (stone ? 1 : 0) + (ember ? 1 : 0) + (roof ? roof.pitch + '-' + roof.course : '');
  material.needsUpdate = true;
  return material;
}

// 影の人物（C）：艶のない黒（光・映り込みを受けない）に、逆光の側の輪郭だけを細く暖色で照らす。式は opening-scenes.js の rimShade と同じ。
// 1周目は「カメラへ向かない法線」（裏向きの補間法線）で縁が最大になり、体じゅうに白い粒が散った。カメラを向く面の縁だけに限る。uLight はカメラ空間での光の向き
export function silhouetteMaterial(rim) {
  const m = new THREE.MeshStandardMaterial({ color: '#000000', roughness: 1, metalness: 0 });
  m.envMapIntensity = 0;
  const u = { uRim: { value: new THREE.Color(rim.color).multiplyScalar(rim.power) }, uBase: { value: new THREE.Color(rim.base || '#050506') }, uLight: { value: new THREE.Vector3(0, 0.4, -1).normalize() } };
  m.userData.rim = u;
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uRim, uLight, uBase;')
      .replace('#include <opaque_fragment>', `{ vec3 vn = normalize(normal), vv = normalize(vViewPosition); float ndv = dot(vn, vv);
          float edge = smoothstep(0.0, 0.1, ndv) * pow(1.0 - clamp(ndv, 0.0, 1.0), 5.0), side = smoothstep(0.05, 0.6, dot(vn, normalize(uLight)));
          outgoingLight = uBase + uRim * edge * side; }
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'opening-silhouette-2';
  return m;
}
