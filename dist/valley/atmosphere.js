// atmosphere.js — 空・太陽・環境光・霧を、一つの設定（ATMOS）から作る（view層）。
// 空・環境マップ・霧の色・水面の反射は同じ設定から取る（地平線に継ぎ目を出さない。design.md）。
import * as THREE from 'three';
import { shadowTexel, snapShadowCenter } from './shadow-snap.js';

export const LEGACY_ATMOS = {
  // 夕景：太陽は南南東の低い位置（高さ約10°）。廃寺→里の道を歩くとき右前から逆光が当たり、帰り道は背中から長い影が伸びる。
  // 影は青紫の半球光で持ち上げ、霧は太陽の方向だけ暖かく、ほかは灰紫（空気遠近）。
  sunDir: new THREE.Vector3(0.50, 0.17, 0.85).normalize(),
  // 太陽は緑を残した金色（桃色にすると、土が桃色の砂色になった。第3周の評価）。冷たい色は緑が赤以上の青灰（赤が強いと遠景が藤色になる）
  sunColor: '#ffd890', sunIntensity: 3.4,
  zenith: '#5b6a94', mid: '#9ea4b4', horizon: '#f6c096', below: '#8c7d70',
  fogColor: '#a2a7b8', hazeCool: '#949baf', hazeWarm: '#e8c08c', hazeExp: 6.5, fogDensity: 0.0007,
  mist: { density: 0.0012, base: -4.0, falloff: 0.045 }, // 谷底に濃い霧（高さに指数で薄くなる）。第2周で薄く・谷底へ寄せた（奥の山腹が明るい幕になった）
  hemiSky: '#9ea3b4', hemiGround: '#7a6446', hemiIntensity: 0.85, envIntensity: 0.7,
  fillColor: '#a8b0d0', fillIntensity: 0.4, // カメラが向く向きに弱い青白い光（逆光でも人物・壁の正面が読める。影は落とさない）
  exposure: 1.0,
};

// 方位は北から時計回り、角度は度。谷だけに使う夕景の調整値。
export const SKY = Object.freeze({
  bearingDeg: 55, elevationDeg: 7.5, sunColor: '#ffca85', // 低い北東の金橙色。
  hemiIntensity: 1.12, fillIntensity: 0.58, // 逆光の地面・人物を支える照度。
  cloudAmount: 0.72, cloudLow: 0.40, cloudHigh: 0.75, // 被覆率と連続した雲の閾値。
  cloudSpeed: 0.002, cloudScale: 2.2, // 投影座標/秒、雲塊の尺度。
  cloudShadeMix: 0.32, cloudShadeGain: 0.65, cloudWarmGain: 1.05, // 既存の天頂・中間・地平色から雲色を作る。
  cloudVioletMix: 0.65, skyVioletMix: 0.20, // 既存の青成分を赤へ混ぜる割合。雲と太陽から遠い空を青紫へ。
  rimGain: 0.65, undersideGain: 0.30, // 太陽側の縁と雲の下面の暖色量。
  haloGain: 0.55, discGain: 18, discRadiusDeg: 0.40, // にじみ、円盤の輝度、見かけの半径。
  dither: 1 / 255, // 最終出力の階調雑音幅（片側はこの半分）。
});
const search = () => typeof location === 'undefined' ? '' : location.search;
export function valleyAtmosphere(searchValue = '') {
  const q = new URLSearchParams(searchValue), old = q.get('sun') === 'old';
  const bearing = SKY.bearingDeg * Math.PI / 180, elevation = SKY.elevationDeg * Math.PI / 180;
  return { ...LEGACY_ATMOS, mist: { ...LEGACY_ATMOS.mist },
    sunDir: old ? LEGACY_ATMOS.sunDir.clone() : new THREE.Vector3(Math.sin(bearing) * Math.cos(elevation), Math.sin(elevation), -Math.cos(bearing) * Math.cos(elevation)),
    ...(!old ? { sunColor: SKY.sunColor, hemiIntensity: SKY.hemiIntensity, fillIntensity: SKY.fillIntensity } : {}),
    sky2: q.get('sky2') !== '0', skyDebug: q.get('sky2debug') === '1', mist2: q.get('mist2') !== '0',
  };
}
export const ATMOS = valleyAtmosphere(search());

// three.js の霧の断片を、距離の霧＋高さ依存の霧に差し替える。材質を作る前に一度だけ呼ぶ。
const lin = hex => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };
// 空と霧が共有する色：太陽側は暖色、反対側は青灰（空気遠近）。dir は世界座標の向き。
export function hazeGLSL(a = ATMOS) {
  const sd = a.sunDir;
  return `
    const vec3 HAZE_COOL = ${lin(a.hazeCool)}; const vec3 HAZE_WARM = ${lin(a.hazeWarm)};
    const vec2 SUN_XZ = vec2(${sd.x.toFixed(4)}, ${sd.z.toFixed(4)});
    const vec3 SUN_DIR3 = vec3(${sd.x.toFixed(4)}, ${sd.y.toFixed(4)}, ${sd.z.toFixed(4)});
    vec3 hazeColor(vec3 dir) {                                  // 空の地平線：太陽側の半分が暖色（従来どおり）
      float s = dot(normalize(dir.xz + 1e-5), normalize(SUN_XZ)) * 0.5 + 0.5;
      return mix(HAZE_COOL, HAZE_WARM, pow(max(s, 0.0), ${(a.hazeExp ?? 2.4).toFixed(3)}));
    }
    // 地形・木・山並みにかかる霧：暖色は太陽の周り（高さも含めた角度で約25°以内）に絞り、ほかは灰紫〜青灰（奥ほど冷たい）。
    // 向いた方角だけで色が決まると、太陽側の遠景が全部琥珀色になり奥行きが消えた（第2周の評価）。
    vec3 fogHazeColor(vec3 dir) {
      float s = dot(normalize(dir), SUN_DIR3);
      return mix(HAZE_COOL, HAZE_WARM, clamp(smoothstep(0.93, 0.998, s) * 0.55, 0.0, 0.6));
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
  float fogHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  float fogNoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( fogHash( i ), fogHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( fogHash( i + vec2( 0.0, 1.0 ) ), fogHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }
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
    vec3 fvd = normalize( vFogDirV );
    vec3 fogWorldDir = vec3( dot( viewMatrix[ 0 ].xyz, fvd ), dot( viewMatrix[ 1 ].xyz, fvd ), dot( viewMatrix[ 2 ].xyz, fvd ) );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogHazeColor( fogWorldDir ), fogFactor );
    // 谷の壁にかかる霧の帯：高さ約38m・92m・150mに、横へ流れる淡い帯（ノイズで切れ切れ）。遠い斜面にだけ効く。
    // 奥行きが「暗い森」と「稜線」の2段しか無かった（第3周の評価）。帯の色は青灰より明るい淡い青白で、太陽側は暖色が混ざる。
    ${a.mist2 ? '' : `{
      float bandD = length( vFogDirV );
      vec3 bandP = cameraPosition + fogWorldDir * bandD;
      float bandY = exp( - pow( ( vFogWorldY - 38.0 ) / 11.0, 2.0 ) ) * 0.8 + exp( - pow( ( vFogWorldY - 92.0 ) / 15.0, 2.0 ) ) * 0.7 + exp( - pow( ( vFogWorldY - 150.0 ) / 20.0, 2.0 ) ) * 0.55;
      float bandN = fogNoise( vec2( bandP.x * 0.009 + bandP.z * 0.004, bandP.y * 0.03 ) ) * 0.65 + fogNoise( vec2( bandP.x * 0.031 - bandP.z * 0.012, bandP.y * 0.07 + 3.3 ) ) * 0.35;
      float band = bandY * smoothstep( 70.0, 230.0, bandD ) * smoothstep( 0.36, 0.76, bandN ) * 0.42;
      vec3 bandCol = mix( vec3( 0.46, 0.51, 0.62 ), fogHazeColor( fogWorldDir ), 0.45 );
      gl_FragColor.rgb = mix( gl_FragColor.rgb, bandCol, band );
    }`}
  #else
    // 線形の霧はオープニングの舞台（opening-stage.js）だけが使う。霧は fogColor の一色で、谷の空気遠近（暖色と青灰・霧の帯）はかけない
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
  #endif
#endif`;
}

export function legacySkyMaterial(a, time) {
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
        col = mix(col, mix(hz, below, 0.5), (1.0 - smoothstep(-0.18, 0.0, h)));
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

// 単調な暖色量。Node の標本検査とシェーダーで同じ式を使う。
export function cloudWarmth(sunDot) { return Math.pow(Math.max(0, Math.min(1, sunDot)), 4); }
export function skyMaterial(a, time) {
  if (!a.sky2) return legacySkyMaterial(a, time);
  const m = legacySkyMaterial(a, time), C = SKY;
  const f = n => n.toFixed(8);
  const begin = m.fragmentShader.indexOf('        // 薄い雲');
  const end = m.fragmentShader.indexOf('        // 地平線は霧', begin);
  if (begin < 0 || end < begin) throw new Error('Sky cloud anchors missing');
  m.fragmentShader = m.fragmentShader.slice(0, begin) + `
        vec2 cp = d.xz / (max(h, 0.0) + 0.18) * ${f(C.cloudScale)} + vec2(uTime * ${f(C.cloudSpeed)}, 0.0);
        float c = fbm(cp);
        float cover = smoothstep(${f(C.cloudLow)}, ${f(C.cloudHigh)}, c) * smoothstep(0.015, 0.12, h) * (1.0 - smoothstep(0.65, 1.0, h));
        float warm = pow(sd, 4.0);
        float edge = 1.0 - smoothstep(${f(C.cloudLow)}, ${f(C.cloudHigh)}, c);
        float underside = 1.0 - smoothstep(0.08, 0.42, h);
        vec3 shade = mix(zenith, mid, ${f(C.cloudShadeMix)}) * ${f(C.cloudShadeGain)};
        shade.r = mix(shade.r, shade.b, ${f(C.cloudVioletMix)});
        vec3 lit = mix(horizon, sunColor, warm) * ${f(C.cloudWarmGain)};
        vec3 cloudCol = mix(shade, lit, warm * clamp(edge * ${f(C.rimGain)} + underside * ${f(C.undersideGain)}, 0.0, 1.0));
        col = mix(col, cloudCol, cover * ${f(C.cloudAmount)});
        ${a.skyDebug ? 'col = mix(vec3(0.12, 0.05, 0.4), vec3(1.0, 0.35, 0.0), cover);' : ''}
  ` + m.fragmentShader.slice(end);
  m.fragmentShader = m.fragmentShader
    .replace('float sd = max(dot(d, normalize(sunDir)), 0.0);', `float sd = max(dot(d, normalize(sunDir)), 0.0);
        col.r = mix(col.r, col.b, ${f(C.skyVioletMix)} * (1.0 - pow(sd, 4.0)));`)
    .replace('pow(sd, 40.0) * 0.55', `pow(sd, 40.0) * ${f(C.haloGain)}`)
    .replace('22.0 * smoothstep(0.99965, 0.9999, sd)', `${f(C.discGain)} * smoothstep(${f(Math.cos((C.discRadiusDeg + 0.06) * Math.PI / 180))}, ${f(Math.cos(C.discRadiusDeg * Math.PI / 180))}, sd)`)
    .replace('(hash(gl_FragCoord.xy) - 0.5) / 255.0', `(hash(gl_FragCoord.xy) - 0.5) * ${f(C.dither)}`);
  return m;
}

export function createAtmosphere({ scene, renderer, quality = 'standard', a = ATMOS, makeSky = skyMaterial }) {
  const time = { value: 0 };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), makeSky(a, time));
  sky.name = 'sky'; sky.renderOrder = -10; sky.frustumCulled = false;
  scene.add(sky);

  // 環境マップ（金属・水・つやの反射）。空だけを描いたものから一度作る。
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), makeSky(a, { value: 0 }));
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
  // radius は書かない：PCFSoftShadowMap（main.js）は radius を読まない（同梱の SHADOWMAP_TYPE_PCF_SOFT の分岐）。
  // 2.2 と書いてあったが効いておらず、柔らかさは解像度と PCF_SOFT の固定の広がりで決まる（2026-11-04 案A）。
  sh.bias = -0.0003; sh.normalBias = 0.05;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(a.fillColor, a.fillIntensity);
  scene.add(fill, fill.target);
  const fwd = new THREE.Vector3();

  const layers = a === ATMOS || a.sky2 ? scene.getObjectByName('ridges') : null;
  let activeQuality = quality, initialPixelRatio = renderer.getPixelRatio?.() ?? 1, tier = -1;
  function syncLayers() {
    if (!a.sky2 && a !== ATMOS) return;
    const pixelRatio = renderer.getPixelRatio?.() ?? initialPixelRatio;
    initialPixelRatio = Math.max(initialPixelRatio, pixelRatio);
    const ratio = pixelRatio / initialPixelRatio;
    const next = ratio < 0.65 ? 3 : ratio < 0.78 ? 2 : ratio < 0.93 ? 1 : 0;
    if (next === tier) return;
    tier = next;
    layers?.userData.configure?.({ quality: activeQuality, tier, a });
  }
  syncLayers();
  const dir = [0, 0, 0], snapped = [0, 0, 0];
  return {
    sky, sun, hemi, fill, params: a,
    // ?qa=1: window.__valley.game.atmosphere.stats()。drawCalls は全周を描く上界、GPU時間ではない。
    stats() { return { sunDir: a.sunDir.toArray(), skyDrawCalls: 1, skyTriangles: sky.geometry.index.count / 3,
      skyAddedDrawCalls: 0, skyDebug: !!a.skyDebug, ...(layers?.userData.stats?.() ?? {}) }; },
    // 影の範囲を注視点に追従させる。光の画面の軸で1画素の倍数へ丸める（shadow-snap.js）。
    // 丸め幅は今の影の解像度から毎回出す（品質切替の後に古い幅が残っていた）。
    follow(target) {
      dir[0] = a.sunDir.x; dir[1] = a.sunDir.y; dir[2] = a.sunDir.z;
      const texel = shadowTexel(sh.camera.right - sh.camera.left, sh.mapSize.x);
      snapShadowCenter(target.x, target.y, target.z, dir, texel, snapped);
      sun.target.position.set(snapped[0], snapped[1], snapped[2]);
      sun.position.copy(sun.target.position).addScaledVector(a.sunDir, 150);
      sun.target.updateMatrixWorld();
    },
    update(camera, dt) {
      syncLayers();
      layers?.userData.update?.(dt);
      time.value += dt;
      sky.position.copy(camera.position);
      camera.getWorldDirection(fwd);
      fill.position.copy(camera.position); fill.target.position.copy(camera.position).add(fwd); fill.target.updateMatrixWorld();
    },
    setQuality(q) {
      activeQuality = q; initialPixelRatio = renderer.getPixelRatio?.() ?? 1; tier = -1; syncLayers();
      const size = q === 'light' ? 2048 : 4096;
      if (sh.mapSize.x !== size) { sh.mapSize.set(size, size); sh.map?.dispose(); sh.map = null; }
      sun.castShadow = true;
    },
  };
}
