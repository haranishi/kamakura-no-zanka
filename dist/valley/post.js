// post.js — 後処理の最小パス：MSAA（HalfFloat）→谷の局所霧→ブルーム→階調（ACES風）＋色調整→ビネット（view層）。
// 依存を増やさず、必要な効果だけを自前で持つ（design.md の判断）。標準／軽量で内容を切り替える。
import * as THREE from 'three';
import { MIST3, MIST3_AMOUNT_GLSL, bakeMistField, mistHeightBounds, mistSteps, mistBlurEnabled, MIST3_DEPTH_GLSL } from './mist-field.js';

export const OUTPUT_DITHER = 1 / 255; // sRGB出力の雑音幅。片側±0.5/255、描画追加なし。

const FULLSCREEN = new THREE.BufferGeometry();
FULLSCREEN.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
const VERT = 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const TONEMAP = `
  vec3 aces(vec3 x){ const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0); }
  vec3 srgb(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
  float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }`;

// 面まで（空なら最遠まで）の視線を、霧の高さ帯に絞って等間隔に積む。
export const MIST3_FRAGMENT = `
  varying vec2 vUv;
  uniform sampler2D depthTex, field;
  uniform mat4 inverseProjection, cameraWorld;
  uniform vec2 mapCenter, heightBounds;
  uniform vec3 eye, sun, cool, warm;
  uniform float clock, sigma, thicknessScale, lightQuality;
  uniform int stepCount;
  float hash(vec2 p){return fract(sin(dot(p,vec2(${MIST3.jitterDot.map(n => n.toFixed(1)).join(',')})))*${MIST3.jitterGain.toFixed(4)});}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0)),f.x),f.y);}
  ${MIST3_AMOUNT_GLSL}
  void main(){
    float depth=texture2D(depthTex,vUv).r;
    vec4 view=inverseProjection*vec4(vUv*2.0-1.0,depth*2.0-1.0,1.0);
    vec3 p=(cameraWorld*vec4(view.xyz/view.w,1.0)).xyz;
    vec3 ray=p-eye;float distance=length(ray);vec3 direction=ray/max(distance,${MIST3.epsilon.toFixed(8)});
    if(depth>=1.0)distance=${MIST3.maxDistance.toFixed(1)};
    vec2 interval=mistInterval(eye.y,direction.y,distance,heightBounds.x,heightBounds.y);
    float transmittance=1.0;vec3 scattering=vec3(0.0);
    if(interval.y>interval.x && sigma>0.0 && thicknessScale>0.0){
      float dt=(interval.y-interval.x)/float(stepCount),jitter=hash(gl_FragCoord.xy);
      float facing=pow(max(0.0,dot(direction,sun)),${MIST3.sunPower.toFixed(1)});
      vec3 sunColour=mix(cool,warm,facing)*mix(${MIST3.backGain.toFixed(3)},${MIST3.sunGain.toFixed(3)},facing);
      for(int i=0;i<${MIST3.steps};i++){
        if(i>=stepCount)break;
        float t=interval.x+(float(i)+jitter)*dt;
        vec3 point=eye+direction*t;
        vec2 uv=(point.xz-mapCenter)/${MIST3.size.toFixed(1)}+0.5;
        if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0))))continue;
        vec4 f=texture2D(field,uv);
        if(f.g<=0.0)continue;
        vec2 moving=point.xz+vec2(clock*${MIST3.speed.toFixed(3)},point.y*${MIST3.heightNoise.toFixed(3)});
        float large=noise(moving/${MIST3.largePeriod.toFixed(1)}),n=large;
        if(lightQuality<0.5)n=mix(large,noise(moving/${MIST3.finePeriod.toFixed(1)}),${MIST3.fineWeight.toFixed(3)});
        float thick=f.a*thicknessScale,h=point.y-(f.r+f.b);
        float profile=mistProfile(h,thick,mix(${MIST3.thicknessMin.toFixed(3)},${MIST3.thicknessMax.toFixed(3)},n));
        float density=sigma*f.g*n*profile*smoothstep(${MIST3.near.toFixed(1)},${MIST3.nearEnd.toFixed(1)},t);
        float a=mistStepAlpha(transmittance,density,dt);
        float heightFraction=clamp(h/max(thick,${MIST3.epsilon.toFixed(8)}),0.0,1.0);
        vec3 colour=mix(cool,sunColour,mix(${(1-MIST3.bottomBlue).toFixed(3)},1.0,heightFraction))*mix(${MIST3.bottomGain.toFixed(3)},${MIST3.topGain.toFixed(3)},heightFraction);
        scattering+=transmittance*a*colour;transmittance*=1.0-a;
      }
    }
    gl_FragColor=vec4(scattering,transmittance);
  }`;

// 深度は線形の視深度(m)で比べる。半解像度のS/Tは必ず離散的に読み、輪郭をまたぐ線形補間を避ける。
const MIST_FILTER = `
  varying vec2 vUv;
  uniform sampler2D fogTex, depthTex;
  uniform mat4 inverseProjection;
  uniform vec2 fogSize;
  ${MIST3_DEPTH_GLSL}
  float depthAt(vec2 uv){
    float d=texture2D(depthTex,uv).r;
    vec4 v=inverseProjection*vec4(uv*2.0-1.0,d*2.0-1.0,1.0);
    return abs(v.z/v.w);
  }
  vec2 fogUV(vec2 pixel){return (clamp(pixel,vec2(0.0),fogSize-1.0)+0.5)/fogSize;}
  void addMist(vec2 uv,float spatial,float center,inout vec4 sum,inout float total){
    float w=spatial*mistDepthWeight(center,depthAt(uv));
    sum+=texture2D(fogTex,uv)*w;total+=w;
  }`;
export const MIST3_BLUR_FRAGMENT = `${MIST_FILTER}
  uniform vec2 blurAxis;
  void main(){
    float center=depthAt(vUv),total=${MIST3.blurCenter.toFixed(8)};
    vec4 sum=texture2D(fogTex,vUv)*total;
    vec2 pixel=floor(vUv*fogSize),axis=blurAxis*${MIST3.blurWidth.toFixed(8)};
    addMist(fogUV(pixel+axis),${MIST3.blurNear.toFixed(8)},center,sum,total);
    addMist(fogUV(pixel-axis),${MIST3.blurNear.toFixed(8)},center,sum,total);
    addMist(fogUV(pixel+axis*2.0),${MIST3.blurFar.toFixed(8)},center,sum,total);
    addMist(fogUV(pixel-axis*2.0),${MIST3.blurFar.toFixed(8)},center,sum,total);
    gl_FragColor=sum/total;
  }`;
export const MIST3_COMPOSITE_FRAGMENT = `${MIST_FILTER}
  uniform sampler2D tex;
  uniform float debug;
  void main(){
    vec2 pixel=vUv*fogSize-0.5,base=floor(pixel),f=fract(pixel);
    float center=depthAt(vUv),total=0.0;vec4 sum=vec4(0.0);
    addMist(fogUV(base),(1.0-f.x)*(1.0-f.y),center,sum,total);
    addMist(fogUV(base+vec2(1.0,0.0)),f.x*(1.0-f.y),center,sum,total);
    addMist(fogUV(base+vec2(0.0,1.0)),(1.0-f.x)*f.y,center,sum,total);
    addMist(fogUV(base+vec2(1.0)),f.x*f.y,center,sum,total);
    vec4 fog=total>${MIST3.epsilon.toFixed(8)}?sum/total:vec4(0.0,0.0,0.0,1.0);
    vec4 original=texture2D(tex,vUv);
    gl_FragColor=debug>0.5?vec4(vec3(1.0-fog.a),1.0):vec4(original.rgb*fog.a+fog.rgb,original.a);
  }`;

// 既存色の出どころを保って空色を混ぜ、線形光で20%下げる。品質切替では作り直さない。
export function mistColours(a) {
  const sky=new THREE.Color(a.mid).lerp(new THREE.Color(a.horizon),MIST3.skyHorizonMix);
  return {
    cool:new THREE.Color(a.fogColor).multiplyScalar(1+MIST3.coolLift).lerp(sky,MIST3.skyMix).multiplyScalar(MIST3.colourGain),
    warm:new THREE.Color(a.hazeWarm).lerp(new THREE.Color(a.mid),MIST3.warmMix).lerp(sky,MIST3.skyMix).multiplyScalar(MIST3.colourGain),
  };
}

function pass(fragment, uniforms, extra = {}) {
  return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: fragment, uniforms, depthTest: false, depthWrite: false, ...extra });
}

export class Post {
  constructor(renderer, { quality = 'standard' } = {}) {
    this.renderer = renderer; this.quality = quality;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(FULLSCREEN, null); this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.levels = []; this.target = null;
    this.params = { exposure: 1.0, bloomStrength: 0.34, bloomThreshold: 0.95, vignette: 0.26, saturation: 0.95, contrast: 1.06, warmth: 1.0, grain: 0.012 };

    this.matDown = pass(`varying vec2 vUv; uniform sampler2D tex; uniform vec2 texel; uniform float threshold; uniform float first; ${TONEMAP}
      vec3 s(vec2 o){ return texture2D(tex, vUv + o * texel).rgb; }
      void main(){
        vec3 c = s(vec2(0.0)) * 0.25 + (s(vec2(-1,-1)) + s(vec2(1,-1)) + s(vec2(-1,1)) + s(vec2(1,1))) * 0.125
          + (s(vec2(-2,0)) + s(vec2(2,0)) + s(vec2(0,-2)) + s(vec2(0,2))) * 0.03125 * 0.0 + (s(vec2(-2,-2)) + s(vec2(2,-2)) + s(vec2(-2,2)) + s(vec2(2,2))) * 0.03125;
        if (!(c.r >= 0.0 && c.g >= 0.0 && c.b >= 0.0)) c = vec3(0.0);
        if (first > 0.5) { float l = luma(c); c *= smoothstep(threshold * 0.6, threshold * 1.4, l); c = min(c, vec3(24.0)); }
        gl_FragColor = vec4(c, 1.0);
      }`, { tex: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 0.95 }, first: { value: 1 } });
    this.matUp = pass(`varying vec2 vUv; uniform sampler2D tex; uniform vec2 texel; uniform float strength;
      void main(){
        vec3 c = texture2D(tex, vUv).rgb * 4.0
          + (texture2D(tex, vUv + vec2(texel.x, 0.0)).rgb + texture2D(tex, vUv - vec2(texel.x, 0.0)).rgb + texture2D(tex, vUv + vec2(0.0, texel.y)).rgb + texture2D(tex, vUv - vec2(0.0, texel.y)).rgb) * 2.0
          + texture2D(tex, vUv + texel).rgb + texture2D(tex, vUv - texel).rgb + texture2D(tex, vUv + vec2(texel.x, -texel.y)).rgb + texture2D(tex, vUv + vec2(-texel.x, texel.y)).rgb;
        gl_FragColor = vec4(c / 16.0 * strength, 1.0);
      }`, { tex: { value: null }, texel: { value: new THREE.Vector2() }, strength: { value: 1 } },
      { blending: THREE.AdditiveBlending, transparent: true });
    this.matFinal = pass(`varying vec2 vUv; uniform sampler2D scene; uniform sampler2D bloom; uniform float exposure, bloomStrength, vignette, saturation, contrast, warmth, grain, uBloom, uTime; ${TONEMAP}
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec3 c = texture2D(scene, vUv).rgb;
        if (!(c.r >= 0.0 && c.g >= 0.0 && c.b >= 0.0)) c = vec3(0.0);
        if (uBloom > 0.5) c += texture2D(bloom, vUv).rgb * bloomStrength;
        c *= exposure;
        c = aces(c);
        // 暖かい光と青い影の色分け
        float l = luma(c);
        c *= mix(1.0 + (vec3(0.96, 0.99, 1.05) - 1.0) * warmth, 1.0 + (vec3(1.05, 1.0, 0.93) - 1.0) * warmth, smoothstep(0.12, 0.8, l));
        c = mix(vec3(luma(c)), c, saturation);
        // 明暗の強調は、中間の灰(0.18)を軸に比で伸ばす。線形の値へ (c-0.5)*k+0.5 を掛けると、0.028未満が0へ切り捨てられ、日陰が真っ黒に潰れた（第3周の評価）
        c *= pow(max(luma(c), 1e-4) / 0.18, contrast - 1.0);
        vec2 q = vUv - 0.5; float v = 1.0 - vignette * smoothstep(0.25, 0.95, length(q * vec2(1.15, 1.0)) * 1.25);
        c *= v;
        c = srgb(max(c, vec3(0.0)));
        c += (hash(gl_FragCoord.xy + uTime) - 0.5) * max(grain, ${(typeof location !== 'undefined' && new URLSearchParams(location.search).get('sky2') === '0' ? 0 : OUTPUT_DITHER).toFixed(8)});
        gl_FragColor = vec4(c, 1.0);
      }`, { scene: { value: null }, bloom: { value: null }, exposure: { value: 1 }, bloomStrength: { value: 0.3 }, vignette: { value: 0.25 }, saturation: { value: 1 }, contrast: { value: 1 }, warmth: { value: 1 }, grain: { value: 0.01 }, uBloom: { value: 1 }, uTime: { value: 0 } });
    // 溶け合い（オープニングの場面転換）で、仕上がった絵をそのまま写す。copy は不透明、over は前の1枚を薄く重ねる
    const COPY = 'varying vec2 vUv; uniform sampler2D tex; uniform float opacity; void main(){ gl_FragColor = vec4(texture2D(tex, vUv).rgb, opacity); }';
    this.matCopy = pass(COPY, { tex: { value: null }, opacity: { value: 1 } });
    this.matOver = pass(COPY, { tex: { value: null }, opacity: { value: 0 } }, { transparent: true });
    this.hold = null;
    this.mist = null; this.mistTarget = null; this.mistAccum = null; this.mistBlur = null; this.mistReason = 'not-configured'; this.mistActive = false;
  }

  // scene の同一性で限定する。オープニングと world.js の場面へ霧を掛けない。
  configureMist({ scene, world, terrain, a, look = {}, search = '', tier = () => 0 }) {
    this.disposeMist();
    const q = new URLSearchParams(search);
    this.mist = { scene, world, a, tier, enabled: q.get('mist3') !== '0', debug: q.get('mist3debug') === '1',
      sigma: Math.max(0, look.mist3 ?? MIST3.sigma), thicknessScale: Math.max(0, look.mist3t ?? 1), map: null, texture: null, material: null, blurMaterial: null, compositeMaterial: null };
    const m = this.mist;
    this.mistReason = !m.enabled ? 'flag' : this.depthSupportReason();
    if (!this.mistReason) {
      m.map = bakeMistField(world, terrain);
      const half = new Uint16Array(m.map.data.length);
      for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(m.map.data[i]);
      m.texture = new THREE.DataTexture(half, MIST3.resolution, MIST3.resolution, THREE.RGBAFormat, THREE.HalfFloatType);
      m.texture.minFilter = m.texture.magFilter = THREE.LinearFilter; m.texture.generateMipmaps = false; m.texture.needsUpdate = true;
      const colours = mistColours(a);
      m.material = pass(MIST3_FRAGMENT, { depthTex: { value: null }, field: { value: m.texture },
        inverseProjection: { value: new THREE.Matrix4() }, cameraWorld: { value: new THREE.Matrix4() },
        mapCenter: { value: new THREE.Vector2(world.valley.cx, world.valley.cz) }, eye: { value: new THREE.Vector3() }, sun: { value: a.sunDir.clone().normalize() },
        cool: { value: colours.cool }, warm: { value: colours.warm },
        heightBounds: { value: new THREE.Vector2(...mistHeightBounds(m.map.stats.heightRange, m.thicknessScale)) }, stepCount: { value: mistSteps(this.quality, tier()) },
        clock: { value: 0 }, sigma: { value: m.sigma }, thicknessScale: { value: m.thicknessScale }, lightQuality: { value: 0 } });
      const filterUniforms = () => ({ fogTex: { value: null }, depthTex: { value: null }, inverseProjection: { value: new THREE.Matrix4() }, fogSize: { value: new THREE.Vector2() } });
      m.blurMaterial = pass(MIST3_BLUR_FRAGMENT, { ...filterUniforms(), blurAxis: { value: new THREE.Vector2(1, 0) } });
      m.compositeMaterial = pass(MIST3_COMPOSITE_FRAGMENT, { ...filterUniforms(), tex: { value: null }, debug: { value: +m.debug } });
    }
    scene.getObjectByName('ridges')?.userData.setMist3?.(!this.mistReason);
    if (this.size) this.setSize(this.size.w, this.size.h, 1);
  }
  depthSupportReason() {
    const gl = this.renderer.getContext?.();
    if (!gl || gl.DEPTH_COMPONENT32F === undefined) return 'depth-texture-unavailable';
    if (!this.renderer.extensions?.has('EXT_color_buffer_float')) return 'float-target-unavailable';
    return '';
  }
  disposeMist() {
    const m = this.mist;
    m?.scene.getObjectByName('ridges')?.userData.setMist3?.(false);
    m?.texture?.dispose(); m?.material?.dispose(); m?.blurMaterial?.dispose(); m?.compositeMaterial?.dispose(); this.disposeMistTargets();
    if (this.target?.depthTexture) { this.target.depthTexture.dispose(); this.target.depthTexture = null; }
    this.mist = null; this.mistActive = false;
  }
  disposeMistTargets() {
    for (const key of ['mistTarget', 'mistAccum', 'mistBlur']) { this[key]?.dispose(); this[key] = null; }
  }
  stats() {
    const blur = mistBlurEnabled(this.quality, this.mist?.tier() ?? 0), calls = this.mistActive ? (blur ? 4 : 2) : 0;
    const targetBytes = [this.mistTarget, this.mistAccum, this.mistBlur].reduce((sum,t) => sum + (t ? t.width*t.height*8 : 0), 0);
    const halfFraction = this.mistAccum ? this.mistAccum.width*this.mistAccum.height/(this.size.w*this.size.h) : 0;
    return { mist3: { ...this.mist?.map?.stats, enabled: !!this.mist?.material && !this.mistReason, active: this.mistActive, reason: this.mistReason,
      steps: mistSteps(this.quality, this.mist?.tier() ?? 0), noiseOctaves: this.quality === 'light' ? 1 : 2,
      maxFieldReads: mistSteps(this.quality, this.mist?.tier() ?? 0), maxNoiseReads: mistSteps(this.quality, this.mist?.tier() ?? 0) * (this.quality === 'light' ? 1 : 2),
      heightBounds: this.mist?.material?.uniforms.heightBounds.value.toArray(), maxDistance: MIST3.maxDistance, maxOpacity: MIST3.maxOpacity,
      sigma: this.mist?.sigma, thicknessScale: this.mist?.thicknessScale, drawCalls: calls, triangles: calls,
      resolutionScale: MIST3.resolutionScale, blur: this.mistActive && blur, blurPasses: this.mistActive && blur ? 2 : 0,
      accumulationSize: this.mistAccum ? [this.mistAccum.width, this.mistAccum.height] : null,
      blurSize: this.mistBlur ? [this.mistBlur.width, this.mistBlur.height] : null,
      compositeSize: this.mistTarget ? [this.mistTarget.width, this.mistTarget.height] : null,
      targetBytes, depthBytes: this.target?.depthTexture ? this.size.w*this.size.h*4 : 0,
      maxTextureReadsPerFullPixel: halfFraction ? (1 + mistSteps(this.quality, this.mist?.tier() ?? 0)) * halfFraction + (blur ? 20*halfFraction : 0) + 10 : 0 } };
  }

  // オープニングの場面の溶け合い（ディゾルブ）。使う間だけ、仕上げを画面でなく8bitの絵（cur）へ描いて画面へ写す。
  // holdFrame() で直前に描いた1枚（frozen）を残し、setDissolve(mix) の割合で新しい場面の上へ重ねる。残した1枚は溶け終わるまで持ち、
  // 画面の大きさが変わっても捨てない（引き伸ばして重ねる）。谷（hold が無い間）は何も変えない
  beginDissolve() { if (!this.hold) this.hold = { cur: null, frozen: null, mix: 0 }; this.sizeHold(); }
  sizeHold() {
    const h = this.hold; if (!h || !this.size) return;
    if (h.cur && h.cur.width === this.size.w && h.cur.height === this.size.h) return;
    h.cur?.dispose(); h.cur = new THREE.WebGLRenderTarget(this.size.w, this.size.h, { depthBuffer: false });
  }
  holdFrame() { const h = this.hold; if (!h?.cur) return; h.frozen?.dispose(); h.frozen = h.cur; h.cur = null; this.sizeHold(); }
  setDissolve(mix) {
    const h = this.hold; if (!h) return;
    h.mix = Math.max(0, Math.min(1, mix));
    if (h.mix === 0 && h.frozen) { h.frozen.dispose(); h.frozen = null; }          // 溶け終わったら、残した1枚を返す
  }
  endDissolve() { const h = this.hold; if (!h) return; h.cur?.dispose(); h.frozen?.dispose(); this.hold = null; }

  setSize(width, height, pixelRatio) {
    const w = Math.max(2, Math.floor(width * pixelRatio)), h = Math.max(2, Math.floor(height * pixelRatio));
    this.size = { w, h }; this.depthChecked = false;
    const depth = this.target?.depthTexture;
    if (this.target) this.target.depthTexture = null;
    this.target?.dispose(); depth?.dispose();
    this.disposeMistTargets();
    const samples = this.quality === 'light' ? 0 : 4;
    this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples, depthBuffer: true, stencilBuffer: false });
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    if (this.mist?.material && !this.mistReason) {
      this.target.depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType);
      this.mistTarget = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
      this.mistTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
      const fw = Math.max(1, Math.ceil(w * MIST3.resolutionScale)), fh = Math.max(1, Math.ceil(h * MIST3.resolutionScale));
      this.mistAccum = new THREE.WebGLRenderTarget(fw, fh, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      if (this.quality !== 'light') this.mistBlur = this.mistAccum.clone();
    }
    for (const l of this.levels) l.dispose();
    this.levels = [];
    let lw = w, lh = h;
    for (let i = 0; i < 5; i++) {
      lw = Math.max(2, lw >> 1); lh = Math.max(2, lh >> 1);
      const rt = new THREE.WebGLRenderTarget(lw, lh, { type: THREE.HalfFloatType, depthBuffer: false });
      rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
      this.levels.push(rt);
    }
    this.sizeHold();
  }

  setQuality(q) { this.quality = q; if (this.size) this.setSize(this.size.w, this.size.h, 1); }

  run(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  prepareMistFilter(material, fogTexture, camera) {
    const f = material.uniforms; f.fogTex.value = fogTexture; f.depthTex.value = this.target.depthTexture;
    f.inverseProjection.value.copy(camera.projectionMatrixInverse); f.fogSize.value.set(this.mistAccum.width, this.mistAccum.height);
  }

  render(scene, camera, dt = 0) {
    const r = this.renderer, p = this.params;
    const prevTone = r.toneMapping, prevAuto = r.autoClear;
    r.toneMapping = THREE.NoToneMapping;
    r.setRenderTarget(this.target); r.clear();
    // 深度用の framebuffer が成立しない環境では旧い帯へ戻す。例外は握りつぶさない。
    if (this.mist?.material && !this.mistReason && this.target.depthTexture && !this.depthChecked) {
      const gl = r.getContext();
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        this.mistReason = 'depth-framebuffer-incomplete'; this.mist.scene.getObjectByName('ridges')?.userData.setMist3?.(false);
        this.setSize(this.size.w, this.size.h, 1); r.setRenderTarget(this.target); r.clear();
      }
      this.depthChecked = true;
    }
    r.render(scene, camera);
    r.toneMapping = prevTone;
    let sceneTexture = this.target.texture;
    this.mistActive = !!(this.mist?.material && !this.mistReason && scene === this.mist.scene && this.mistTarget);
    if (this.mistActive) {
      const u = this.mist.material.uniforms;
      u.depthTex.value = this.target.depthTexture;
      u.inverseProjection.value.copy(camera.projectionMatrixInverse); u.cameraWorld.value.copy(camera.matrixWorld);
      u.eye.value.setFromMatrixPosition(camera.matrixWorld); u.clock.value += dt; u.lightQuality.value = +(this.quality === 'light');
      u.stepCount.value = mistSteps(this.quality, this.mist.tier());
      this.run(this.mist.material, this.mistAccum);
      let fogTexture = this.mistAccum.texture;
      if (mistBlurEnabled(this.quality, this.mist.tier())) {
        const b = this.mist.blurMaterial;
        this.prepareMistFilter(b, fogTexture, camera); b.uniforms.blurAxis.value.set(1, 0); this.run(b, this.mistBlur);
        this.prepareMistFilter(b, this.mistBlur.texture, camera); b.uniforms.blurAxis.value.set(0, 1); this.run(b, this.mistAccum);
      }
      this.prepareMistFilter(this.mist.compositeMaterial, fogTexture, camera); this.mist.compositeMaterial.uniforms.tex.value = sceneTexture;
      this.run(this.mist.compositeMaterial, this.mistTarget); sceneTexture = this.mistTarget.texture;
    }
    const mistDebug = this.mistActive && this.mist.debug;
    const bloom = !mistDebug && this.quality !== 'light' && p.bloomStrength > 0;
    if (bloom) {
      // ダウンサンプル（最初に明るい所だけ抜く）
      let src = sceneTexture;
      for (let i = 0; i < this.levels.length; i++) {
        const dst = this.levels[i], u = this.matDown.uniforms;
        u.tex.value = src; u.texel.value.set(1 / (i === 0 ? this.size.w : this.levels[i - 1].width), 1 / (i === 0 ? this.size.h : this.levels[i - 1].height));
        u.first.value = i === 0 ? 1 : 0; u.threshold.value = p.bloomThreshold;
        this.run(this.matDown, dst);
        src = dst.texture;
      }
      // アップサンプル（足し込み）
      for (let i = this.levels.length - 1; i > 0; i--) {
        const u = this.matUp.uniforms;
        u.tex.value = this.levels[i].texture; u.texel.value.set(1 / this.levels[i].width, 1 / this.levels[i].height);
        r.autoClear = false;
        this.run(this.matUp, this.levels[i - 1]);
      }
      r.autoClear = prevAuto;
    }
    const f = this.matFinal.uniforms;
    f.scene.value = sceneTexture; f.bloom.value = this.levels[0]?.texture || null; f.uBloom.value = bloom ? 1 : 0;
    f.exposure.value = p.exposure; f.bloomStrength.value = p.bloomStrength; f.vignette.value = p.vignette;
    f.saturation.value = p.saturation; f.contrast.value = p.contrast; f.warmth.value = p.warmth; f.grain.value = p.grain; f.uTime.value = (f.uTime.value + dt) % 100;
    const h = this.hold?.cur ? this.hold : null;
    if (mistDebug) { this.matCopy.uniforms.tex.value = sceneTexture; this.run(this.matCopy, h ? h.cur : null); }
    else this.run(this.matFinal, h ? h.cur : null);
    if (!h) return;
    this.matCopy.uniforms.tex.value = h.cur.texture; this.run(this.matCopy, null);
    if (h.mix > 0 && h.frozen) {
      const u = this.matOver.uniforms; u.tex.value = h.frozen.texture; u.opacity.value = h.mix;
      r.autoClear = false; this.run(this.matOver, null); r.autoClear = prevAuto;
    }
  }
}
