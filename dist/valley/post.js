// post.js — 後処理の最小パス：MSAA（HalfFloat）→ブルーム→階調（ACES風）＋色調整→ビネット（view層）。
// 依存を増やさず、必要な効果だけを自前で持つ（design.md の判断）。標準／軽量で内容を切り替える。
import * as THREE from 'three';

const FULLSCREEN = new THREE.BufferGeometry();
FULLSCREEN.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
const VERT = 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const TONEMAP = `
  vec3 aces(vec3 x){ const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0); }
  vec3 srgb(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
  float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }`;

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
    this.params = { exposure: 1.0, bloomStrength: 0.34, bloomThreshold: 0.95, vignette: 0.26, saturation: 1.06, contrast: 1.04, warmth: 1.0, grain: 0.012 };

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
        c *= mix(vec3(0.96, 0.99, 1.05), vec3(1.05, 1.0, 0.93), smoothstep(0.12, 0.8, l)) ;
        c = mix(vec3(luma(c)), c, saturation);
        c = (c - 0.5) * contrast + 0.5;
        vec2 q = vUv - 0.5; float v = 1.0 - vignette * smoothstep(0.25, 0.95, length(q * vec2(1.15, 1.0)) * 1.25);
        c *= v;
        c = srgb(max(c, vec3(0.0)));
        c += (hash(gl_FragCoord.xy + uTime) - 0.5) * grain;
        gl_FragColor = vec4(c, 1.0);
      }`, { scene: { value: null }, bloom: { value: null }, exposure: { value: 1 }, bloomStrength: { value: 0.3 }, vignette: { value: 0.25 }, saturation: { value: 1 }, contrast: { value: 1 }, warmth: { value: 1 }, grain: { value: 0.01 }, uBloom: { value: 1 }, uTime: { value: 0 } });
  }

  setSize(width, height, pixelRatio) {
    const w = Math.max(2, Math.floor(width * pixelRatio)), h = Math.max(2, Math.floor(height * pixelRatio));
    this.size = { w, h };
    this.target?.dispose();
    const samples = this.quality === 'light' ? 0 : 4;
    this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples, depthBuffer: true, stencilBuffer: false });
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    for (const l of this.levels) l.dispose();
    this.levels = [];
    let lw = w, lh = h;
    for (let i = 0; i < 5; i++) {
      lw = Math.max(2, lw >> 1); lh = Math.max(2, lh >> 1);
      const rt = new THREE.WebGLRenderTarget(lw, lh, { type: THREE.HalfFloatType, depthBuffer: false });
      rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
      this.levels.push(rt);
    }
  }

  setQuality(q) { this.quality = q; if (this.size) this.setSize(this.size.w, this.size.h, 1); }

  run(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  render(scene, camera, dt = 0) {
    const r = this.renderer, p = this.params;
    const prevTone = r.toneMapping, prevAuto = r.autoClear;
    r.toneMapping = THREE.NoToneMapping;
    r.setRenderTarget(this.target); r.clear();
    r.render(scene, camera);
    r.toneMapping = prevTone;
    const bloom = this.quality !== 'light' && p.bloomStrength > 0;
    if (bloom) {
      // ダウンサンプル（最初に明るい所だけ抜く）
      let src = this.target.texture;
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
    f.scene.value = this.target.texture; f.bloom.value = this.levels[0]?.texture || null; f.uBloom.value = bloom ? 1 : 0;
    f.exposure.value = p.exposure; f.bloomStrength.value = p.bloomStrength; f.vignette.value = p.vignette;
    f.saturation.value = p.saturation; f.contrast.value = p.contrast; f.warmth.value = p.warmth; f.grain.value = p.grain; f.uTime.value = (f.uTime.value + dt) % 100;
    this.run(this.matFinal, null);
  }
}
