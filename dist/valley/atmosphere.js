// atmosphere.js — 空・太陽・環境光・霧を、一つの設定（ATMOS）から作る（view層）。
// 空・環境マップ・霧の色・水面の反射は同じ設定から取る（地平線に継ぎ目を出さない。design.md）。
import * as THREE from 'three';

export const ATMOS = {
  // 夕景：太陽は南南東の低い位置（高さ約10°）。廃寺→里の道を歩くとき右前から逆光が当たり、帰り道は背中から長い影が伸びる。
  // 影は青紫の半球光で持ち上げ、霧は太陽の方向だけ暖かく、ほかは灰紫（空気遠近）。
  sunDir: new THREE.Vector3(0.50, 0.17, 0.85).normalize(),
  sunColor: '#ffc088', sunIntensity: 3.4,
  zenith: '#5b6a94', mid: '#a69cb2', horizon: '#f6c096', below: '#8c7d70',
  fogColor: '#a8a3b6', hazeCool: '#a39fb8', hazeWarm: '#f2c090', hazeExp: 6.5, fogDensity: 0.0010,
  mist: { density: 0.0032, base: -4.0, falloff: 0.03 }, // 谷底に濃い霧（高さに指数で薄くなる）
  hemiSky: '#8f96bc', hemiGround: '#7a6446', hemiIntensity: 0.9, envIntensity: 0.7,
  fillColor: '#a8b0d8', fillIntensity: 0.55, // カメラが向く向きに弱い青白い光（逆光でも人物・壁の正面が読める。影は落とさない）
  exposure: 1.0,
};

// three.js の霧の断片を、距離の霧＋高さ依存の霧に差し替える。材質を作る前に一度だけ呼ぶ。
const lin = hex => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };
// 空と霧が共有する色：太陽側は暖色、反対側は青灰（空気遠近）。dir は世界座標の向き。
export function hazeGLSL(a = ATMOS) {
  const sd = a.sunDir;
  return `
    const vec3 HAZE_COOL = ${lin(a.hazeCool)}; const vec3 HAZE_WARM = ${lin(a.hazeWarm)};
    const vec2 SUN_XZ = vec2(${sd.x.toFixed(4)}, ${sd.z.toFixed(4)});
    vec3 hazeColor(vec3 dir) {
      float s = dot(normalize(dir.xz + 1e-5), normalize(SUN_XZ)) * 0.5 + 0.5;
      return mix(HAZE_COOL, HAZE_WARM, pow(max(s, 0.0), ${(a.hazeExp ?? 2.4).toFixed(3)}));
    }`;
}

export function installFog(a = ATMOS) {
  const m = a.mist;
  THREE.ShaderChunk.fog_pars_vertex = `
#ifdef USE_FOG
  varying float vFogDepth; varying float vFogWorldY; varying vec3 vFogDirV;
#endif`;
  THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorldY = dot( viewMatrix[ 1 ].xyz, mvPosition.xyz ) + cameraPosition.y;
  vFogDirV = mvPosition.xyz;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor; varying float vFogDepth; varying float vFogWorldY; varying vec3 vFogDirV;
  ${hazeGLSL(a)}
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear; uniform float fogFar;
  #endif
#endif`;
  THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float distFog = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    const float MIST_K = ${m.falloff.toFixed(5)}; const float MIST_D = ${m.density.toFixed(5)}; const float MIST_B = ${m.base.toFixed(3)};
    float h0 = cameraPosition.y - MIST_B, h1 = vFogWorldY - MIST_B, dyF = h1 - h0;
    float attenF = abs( dyF * MIST_K ) < 0.01 ? exp( - MIST_K * 0.5 * ( h0 + h1 ) ) : ( exp( - MIST_K * h0 ) - exp( - MIST_K * h1 ) ) / ( MIST_K * dyF );
    float mistF = 1.0 - exp( - MIST_D * vFogDepth * attenF );
    float fogFactor = 1.0 - ( 1.0 - distFog ) * ( 1.0 - mistF );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  vec3 fvd = normalize( vFogDirV );
  vec3 fogWorldDir = vec3( dot( viewMatrix[ 0 ].xyz, fvd ), dot( viewMatrix[ 1 ].xyz, fvd ), dot( viewMatrix[ 2 ].xyz, fvd ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, hazeColor( fogWorldDir ), fogFactor );
#endif`;
}

function skyMaterial(a, time) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: {
      sunDir: { value: a.sunDir.clone() }, sunColor: { value: new THREE.Color(a.sunColor) },
      zenith: { value: new THREE.Color(a.zenith) }, mid: { value: new THREE.Color(a.mid) },
      horizon: { value: new THREE.Color(a.horizon) }, below: { value: new THREE.Color(a.below) },
      fogColor: { value: new THREE.Color(a.fogColor) }, uTime: time,
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      varying vec3 vDir; uniform vec3 sunDir, sunColor, zenith, mid, horizon, below, fogColor; uniform float uTime;
      ${hazeGLSL(a)}
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1.,0.)), f.x), mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.)), f.x), f.y); }
      float fbm(vec2 p){ return noise(p)*0.5 + noise(p*2.07+3.1)*0.28 + noise(p*4.3-7.7)*0.16 + noise(p*8.9+1.9)*0.06; }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        // 地平線の暖色→中間の青灰→天頂
        vec3 hz = hazeColor(d);
        vec3 col = mix(hz, mid, smoothstep(0.0, 0.22, h));
        col = mix(col, zenith, smoothstep(0.12, 0.85, h));
        col = mix(col, mix(hz, below, 0.5), smoothstep(0.0, -0.18, h));
        float sd = max(dot(d, normalize(sunDir)), 0.0);
        // 太陽のまわり（暖色の散乱）と円盤
        col += sunColor * (pow(sd, 5.0) * 0.20 + pow(sd, 40.0) * 0.55);
        col += sunColor * 22.0 * smoothstep(0.99965, 0.9999, sd);
        // 薄い雲（高い層）。太陽側は縁が明るい
        vec2 cp = d.xz / (max(h, 0.0) + 0.18) * 2.2 + vec2(uTime * 0.0035, 0.0);
        float c = fbm(cp * 1.15);
        float cover = smoothstep(0.50, 0.78, c) * smoothstep(0.02, 0.2, h) * (1.0 - smoothstep(0.7, 1.0, h));
        vec3 cloudCol = mix(vec3(0.78, 0.74, 0.74), sunColor * 1.15, pow(sd, 1.6) * 0.85 + 0.15);
        col = mix(col, cloudCol, cover * 0.55);
        // 地平線は霧の色へなじませる（地形の遠景との継ぎ目を消す）
        col = mix(col, hz, (1.0 - smoothstep(0.0, 0.09, abs(h))) * 0.7);
        col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

export function createAtmosphere({ scene, renderer, quality = 'standard', a = ATMOS }) {
  const time = { value: 0 };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), skyMaterial(a, time));
  sky.name = 'sky'; sky.renderOrder = -10; sky.frustumCulled = false;
  scene.add(sky);

  // 環境マップ（金属・水・つやの反射）。空だけを描いたものから一度作る。
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMaterial(a, { value: 0 }));
  envScene.add(envSky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(envScene, 0.0, 1, 500);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = a.envIntensity;

  scene.fog = new THREE.FogExp2(a.fogColor, a.fogDensity);

  const hemi = new THREE.HemisphereLight(a.hemiSky, a.hemiGround, a.hemiIntensity);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(a.sunColor, a.sunIntensity);
  sun.castShadow = true;
  const sh = sun.shadow;
  sh.mapSize.set(quality === 'light' ? 2048 : 4096, quality === 'light' ? 2048 : 4096);
  Object.assign(sh.camera, { left: -46, right: 46, top: 46, bottom: -46, near: 1, far: 260 });
  sh.bias = -0.0003; sh.normalBias = 0.05; sh.radius = 2.2;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(a.fillColor, a.fillIntensity);
  scene.add(fill, fill.target);
  const fwd = new THREE.Vector3();

  const texel = 92 / sh.mapSize.x;
  return {
    sky, sun, hemi, fill, params: a,
    // 影の範囲を注視点に追従させる（テクセルへ合わせて揺れを防ぐ）
    follow(target) {
      const sx = Math.round(target.x / texel) * texel, sz = Math.round(target.z / texel) * texel;
      sun.target.position.set(sx, target.y, sz);
      sun.position.set(sx, target.y, sz).addScaledVector(a.sunDir, 150);
      sun.target.updateMatrixWorld();
    },
    update(camera, dt) {
      time.value += dt;
      sky.position.copy(camera.position);
      camera.getWorldDirection(fwd);
      fill.position.copy(camera.position); fill.target.position.copy(camera.position).add(fwd); fill.target.updateMatrixWorld();
    },
    setQuality(q) {
      const size = q === 'light' ? 2048 : 4096;
      if (sh.mapSize.x !== size) { sh.mapSize.set(size, size); sh.map?.dispose(); sh.map = null; }
      sun.castShadow = true;
    },
  };
}
