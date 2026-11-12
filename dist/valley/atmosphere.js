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
  // 高さ 7.5 度では、谷を囲む山の縁（日の方向で約 14.65 度）に隠れて、谷のどこからも夕日が見えなかった。縁のすぐ上へ上げた。
  // 3 周目：見渡しを南の高い所（地面から 86m）へ移し、日を、谷の奥の切れ目の上（方位 40 度・高さ 16.5 度）へ寄せた。方位 55 度では、
  // 日が画面の右上の外に出て、講評で「夕日が見えない」と言われた。この位置なら、日は、尾根の木の上・画面の右上に入る。
  bearingDeg: 40, elevationDeg: 16.5, sunColor: '#ffca85', // 北東の山の端にかかる、金橙色の日。
  hemiIntensity: 1.12, fillIntensity: 0.7, // 逆光の地面・人物を支える照度（0.58 では、手前を向いた斜面が暗すぎた）。
  fogDensity: 0.0011, // 遠くの霞（1/m）。0.0007 では、奥の尾根まで同じ濃さで、奥行きの段が出なかった。
  horizon: '#ff9050', mid: '#d59a9c', zenith: '#4d568c', // 谷専用：金橙・珊瑚桃・青紫。lkのhorc/midc/zencで上書き。
  // 色の帯は、山の縁（里から見て約 15 度）でなく、遠い山並みのすぐ上（約 4 度）から始める。高い所からの見渡しでは、空は仰角 3〜18 度しか
  // 写らず、縁から始めると、写る空の全体が同じ淡い金色になった（絵と並べて確かめた）。日の色の混合率も下げ、地平線の橙を濃く残す。
  rimDeg: 4, lowTopDeg: 22, midTopDeg: 52, // 色の帯が始まる仰角、そこからの低い帯／中間帯の上端(度)。
  sunSideDeg: 50, sunFadeDeg: 95, goldMix: 0.3, backGain: 0.72, // 暖色が満ちる／消える方位差(度)、日の色の混合率、反対側の明るさ。
  // 地平線の近くの細長い雲（層雲）。方位と仰角で作る、横に長い縞。本体は暗い紫、日の側の縁と下の面は、焼けた橙〜桃。
  streakAmount: 0.9, streakLowDeg: [1.5, 5], streakHighDeg: [14, 26], // 濃さ、出始める／消える仰角の幅(度)。
  streakAzimuth: 2.6, streakElevation: 0.34, streakSpeed: 0.0012, // 方位(円周の座標)・仰角(度)に対する縞の細かさ、流れる速さ(座標/秒)。
  streakLow: 0.46, streakHigh: 0.62, streakShade: 0.55, streakLit: 1.25, streakRim: 1.25, streakBase: 0.08, // 雲になる閾値、本体の暗さ、焼けた色の明るさ、縁の光り方、縁以外に残る光。
  cloudAmount: 0.72, cloudLow: 0.40, cloudHigh: 0.75, // 被覆率と連続した雲の閾値。
  cloudSpeed: 0.002, cloudScale: 2.2, // 投影座標/秒、雲塊の尺度。
  cloudShadeMix: 0.32, cloudShadeGain: 0.65, cloudWarmGain: 1.05, // 既存の天頂・中間・地平色から雲色を作る。
  cloudVioletMix: 0.65, cloudWarmFullDeg: 45, cloudWarmEndDeg: 90, // 雲の紫の混合率、暖色が最大／消える方位差(度)。
  rimGain: 0.95, undersideGain: 0.78, undersideLowDeg: 8, undersideHighDeg: 38, // 縁／下面の暖色量、下面が光る仰角の範囲(度)。
  haloRadiusDeg: 26, haloGain: 0.65, coreRadiusDeg: 4, coreGain: 0.35, // 広いにじみ／円盤の近傍の半径(度)と線形輝度。
  discGain: 2.4, discRadiusDeg: 0.40, discSoftDeg: 0.06, radianceMax: 3.0, // 円盤の線形輝度・半径／縁の幅(度)、空の各成分の上限。
  dither: 1 / 255, // 最終出力の階調雑音幅（片側はこの半分）。
  // 仕上げの色調。日を北東の低い位置へ動かしただけでは、日なたの地面がくすんだ黄土色で、金色の夕方に見えなかった（実際の画面で
  // 見比べた）。露出を少し上げ、暖色と彩度を足す。歩く視点で、地面と主人公が白く飛ばない値。`&sun=old` では使わない。
  grade: Object.freeze({ exposure: 1.08, warmth: 1.1, saturation: 1.05 }),
});
const search = () => typeof location === 'undefined' ? '' : location.search;
export function valleyAtmosphere(searchValue = '') {
  const q = new URLSearchParams(searchValue), old = q.get('sun') === 'old';
  const bearing = SKY.bearingDeg * Math.PI / 180, elevation = SKY.elevationDeg * Math.PI / 180;
  return { ...LEGACY_ATMOS, mist: { ...LEGACY_ATMOS.mist },
    sunDir: old ? LEGACY_ATMOS.sunDir.clone() : new THREE.Vector3(Math.sin(bearing) * Math.cos(elevation), Math.sin(elevation), -Math.cos(bearing) * Math.cos(elevation)),
    ...(!old ? { sunColor: SKY.sunColor, hemiIntensity: SKY.hemiIntensity, fillIntensity: SKY.fillIntensity, fogDensity: SKY.fogDensity } : {}),
    ...(!old && q.get('sky2') !== '0' ? { horizon: SKY.horizon, mid: SKY.mid, zenith: SKY.zenith } : {}),
    sky2: q.get('sky2') !== '0', skyDebug: q.get('sky2debug') === '1', mist2: q.get('mist2') !== '0',
    grade: old ? null : SKY.grade,
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

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const cosDeg = angle => Math.cos(angle * Math.PI / 180);
// 以下のスカラー式はGLSLの同名関数と照合する。角度は度、azimuthDotは水平な方位の内積。
export function skyChannel(horizon, mid, zenith, sunColor, elevation, azimuthDot) {
  const altitude = Math.max(0, elevation - SKY.rimDeg);
  const low = smooth(0, SKY.lowTopDeg, altitude), high = smooth(SKY.lowTopDeg, SKY.midTopDeg, altitude);
  const side = smooth(cosDeg(SKY.sunFadeDeg), cosDeg(SKY.sunSideDeg), azimuthDot);
  const gold = horizon + (sunColor - horizon) * SKY.goldMix * side;
  const front = gold + (mid - gold) * low;
  const back = mid * SKY.backGain;
  const lower = back + (front - back) * side;
  return lower + (zenith - lower) * high;
}
export function cloudWarmth(azimuthDot) { return smooth(cosDeg(SKY.cloudWarmEndDeg), cosDeg(SKY.cloudWarmFullDeg), azimuthDot); }
export function sunGlow(sunDot) {
  const wide = smooth(cosDeg(SKY.haloRadiusDeg), 1, sunDot);
  const core = smooth(cosDeg(SKY.coreRadiusDeg), 1, sunDot);
  return wide * wide * SKY.haloGain + core * SKY.coreGain;
}
export function sunDisc(sunDot) { return smooth(cosDeg(SKY.discRadiusDeg + SKY.discSoftDeg), cosDeg(SKY.discRadiusDeg), sunDot) * SKY.discGain; }
export function skyRadiance(base, sunColor, sunDot, discVisibility = 1) { return Math.min(SKY.radianceMax, Math.max(0, base + sunColor * (sunGlow(sunDot) + sunDisc(sunDot) * discVisibility))); }

const f = n => n.toFixed(15);
export const SUNSET_GLSL = `
  float skyChannel(float horizon, float mid, float zenith, float sunColor, float elevation, float azimuthDot) {
    float altitude = max(0.0, elevation - ${f(SKY.rimDeg)});
    float low = smoothstep(0.0, ${f(SKY.lowTopDeg)}, altitude), high = smoothstep(${f(SKY.lowTopDeg)}, ${f(SKY.midTopDeg)}, altitude);
    float side = smoothstep(${f(cosDeg(SKY.sunFadeDeg))}, ${f(cosDeg(SKY.sunSideDeg))}, azimuthDot);
    float gold = horizon + (sunColor - horizon) * ${f(SKY.goldMix)} * side;
    float front = gold + (mid - gold) * low;
    float back = mid * ${f(SKY.backGain)};
    float lower = back + (front - back) * side;
    return lower + (zenith - lower) * high;
  }
  float cloudWarmth(float azimuthDot) { return smoothstep(${f(cosDeg(SKY.cloudWarmEndDeg))}, ${f(cosDeg(SKY.cloudWarmFullDeg))}, azimuthDot); }
  float sunGlow(float sunDot) {
    float wide = smoothstep(${f(cosDeg(SKY.haloRadiusDeg))}, 1.0, sunDot);
    float core = smoothstep(${f(cosDeg(SKY.coreRadiusDeg))}, 1.0, sunDot);
    return wide * wide * ${f(SKY.haloGain)} + core * ${f(SKY.coreGain)};
  }
  float sunDisc(float sunDot) { return smoothstep(${f(cosDeg(SKY.discRadiusDeg + SKY.discSoftDeg))}, ${f(cosDeg(SKY.discRadiusDeg))}, sunDot) * ${f(SKY.discGain)}; }
  float skyRadiance(float base, float sunColor, float sunDot, float discVisibility) { return min(${f(SKY.radianceMax)}, max(0.0, base + sunColor * (sunGlow(sunDot) + sunDisc(sunDot) * discVisibility))); }
`;
export function skyMaterial(a, time) {
  if (!a.sky2) return legacySkyMaterial(a, time);
  // 色はmainのlk適用後にuniformへ読む。旧い空の地平線の霞でhorizonを上書きしない。
  const m = legacySkyMaterial(a, time), C = SKY;
  m.fragmentShader = `
    varying vec3 vDir; uniform vec3 sunDir, sunColor, zenith, mid, horizon, below, fogColor; uniform float uTime;
    ${SUNSET_GLSL}
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(hash(i), hash(i+vec2(1.,0.)), f.x), mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.)), f.x), f.y); }
    float fbm(vec2 p){ return noise(p)*0.5 + noise(p*2.07+3.1)*0.28 + noise(p*4.3-7.7)*0.16 + noise(p*8.9+1.9)*0.06; }
    void main(){
      vec3 d = normalize(vDir);
      float h = d.y, elevation = degrees(asin(clamp(h, -1.0, 1.0)));
      float azimuthDot = dot(normalize(d.xz + vec2(1e-5)), normalize(sunDir.xz));
      float sd = dot(d, normalize(sunDir));
      vec3 col = vec3(skyChannel(horizon.r, mid.r, zenith.r, sunColor.r, elevation, azimuthDot),
        skyChannel(horizon.g, mid.g, zenith.g, sunColor.g, elevation, azimuthDot),
        skyChannel(horizon.b, mid.b, zenith.b, sunColor.b, elevation, azimuthDot));
      col = mix(below, col, smoothstep(-0.18, 0.0, h));
      vec2 cp = d.xz / (max(h, 0.0) + 0.18) * ${f(C.cloudScale)} + vec2(uTime * ${f(C.cloudSpeed)}, 0.0);
      float c = fbm(cp);
      float cover = smoothstep(${f(C.cloudLow)}, ${f(C.cloudHigh)}, c) * smoothstep(0.015, 0.12, h) * (1.0 - smoothstep(0.65, 1.0, h));
      float warm = cloudWarmth(azimuthDot);
      float edge = 1.0 - smoothstep(${f(C.cloudLow)}, ${f(C.cloudHigh)}, c);
      float underside = 1.0 - smoothstep(${f(C.undersideLowDeg)}, ${f(C.undersideHighDeg)}, elevation);
      vec3 shade = mix(zenith, mid, ${f(C.cloudShadeMix)}) * ${f(C.cloudShadeGain)};
      shade.r = mix(shade.r, shade.b, ${f(C.cloudVioletMix)});
      vec3 lit = mix(horizon, sunColor, warm) * ${f(C.cloudWarmGain)};
      vec3 cloudCol = mix(shade, lit, warm * clamp(edge * ${f(C.rimGain)} + underside * ${f(C.undersideGain)}, 0.0, 1.0));
      col = mix(col, cloudCol, cover * ${f(C.cloudAmount)});
      // 地平線の近くの細長い雲。円筒の座標（方位の cos・sin）で 2 回引いて混ぜる（真南に継ぎ目を作らない）。
      vec2 ring = normalize(d.xz + vec2(1e-5));
      vec2 streakP = vec2(uTime * ${f(C.streakSpeed)}, elevation * ${f(C.streakElevation)});
      float streakN = fbm(vec2(ring.x * ${f(C.streakAzimuth)}, 0.0) + streakP) * ring.y * ring.y + fbm(vec2(ring.y * ${f(C.streakAzimuth)} + 9.1, 4.7) + streakP) * ring.x * ring.x;
      float streakBand = smoothstep(${f(C.streakLowDeg[0])}, ${f(C.streakLowDeg[1])}, elevation) * (1.0 - smoothstep(${f(C.streakHighDeg[0])}, ${f(C.streakHighDeg[1])}, elevation));
      float streakCover = smoothstep(${f(C.streakLow)}, ${f(C.streakHigh)}, streakN) * streakBand * ${f(C.streakAmount)};
      float streakEdge = 1.0 - smoothstep(${f(C.streakLow)}, ${f(C.streakHigh + 0.1)}, streakN);
      vec3 streakCol = mix(shade * ${f(C.streakShade)}, mix(horizon, sunColor, 0.3) * ${f(C.streakLit)}, warm * clamp(streakEdge * ${f(C.streakRim)} + ${f(C.streakBase)}, 0.0, 1.0));
      col = mix(col, streakCol, streakCover);
      cover = max(cover, streakCover / ${f(C.cloudAmount)});
      // 大きなにじみは雲の後にも届く。円盤は雲で薄まり、HDRの上限で白い塊を防ぐ。
      float discVisibility = 1.0 - cover * ${f(C.cloudAmount)};
      col = vec3(skyRadiance(col.r, sunColor.r, sd, discVisibility), skyRadiance(col.g, sunColor.g, sd, discVisibility), skyRadiance(col.b, sunColor.b, sd, discVisibility));
      ${a.skyDebug ? 'col = mix(vec3(0.12, 0.05, 0.4), vec3(1.0, 0.35, 0.0), cover);' : ''}
      col += (hash(gl_FragCoord.xy) - 0.5) * ${f(C.dither)};
      gl_FragColor = vec4(col, 1.0);
    }`;
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
