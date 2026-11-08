// W2c-10 (R4) photo detail: one shared loader for the CC0 detail textures (normals + brightness ratio).
// Houses, facilities, ground and water read the same uniforms, so nothing is loaded twice and nothing needs wiring through
// every builder. THREE is injected (like the other Kamakura view helpers) so this file also runs in Node tests.
//
// Contract with the shipped textures (tools/build-kamakura-photo-textures.py, provenance/kamakura-photo-textures.json):
//   R,G = tangent-space normal xy (OpenGL, 0.5 centred)   B = sqrt(brightness ratio / 3), ratio has mean 1
// Multiplying a base colour by `ratio` therefore keeps its average, so the palette decides every average colour and the
// photograph only adds the texture and unevenness a procedural noise cannot.
import { PHOTO_TEX_DATA, PHOTO_PACK } from './kamakura-photo-tex-data.js';
export { PHOTO_TEX_DATA, PHOTO_PACK };

export const PHOTO_FADE_MS = 1200;
export const PHOTO_ADAPT = Object.freeze([1, 1, .6, 0]); // automatic quality step -> strength; step 3 switches the detail off
export function photoOptions(search = '') { return { enabled: new URLSearchParams(search).get('photo') !== '0' }; }
export function photoStrength(quality = 'standard', step = 0) {
  return (PHOTO_ADAPT[Math.max(0, Math.min(3, step | 0))] ?? 0) * (quality === 'light' ? .8 : 1);
}
export function photoAnisotropy(quality = 'standard', max = 1) { return Math.max(1, Math.min(quality === 'light' ? 2 : 8, max || 1)); }
export function photoUrl(file, base = import.meta.url) { return new URL(`../assets/kamakura/photo/${file}`, base).href; }

// One uniform object per key lives for the whole page, so every material that already compiled sees a later swap.
const samplers = new Map();
export const photoBlendUniform = { value: 0 }; // 0 until every texture is ready, then eases to photoStrength()
export function photoSampler(key) {
  if (!Object.hasOwn(PHOTO_TEX_DATA, key)) throw new RangeError(`unknown photo texture: ${key}`);
  if (!samplers.has(key)) samplers.set(key, { value: null });
  return samplers.get(key);
}

// Stochastic tiling blends three independent patches. Zero-mean data (normals, ratio - 1) blended with weights that sum to 1
// lose contrast; dividing by the weights' L2 norm keeps the variance of independent patches, so no cell looks washed out.
export function photoHexWeights(d2, power = 4) {
  const w = d2.map(v => Math.max(0, .5 - v) ** power), n = Math.hypot(...w);
  return n > 0 ? w.map(v => v / n) : w.map(() => 0);
}
export function photoBlend(samples, weights) {
  let nx = 0, ny = 0, r = 0;
  for (let i = 0; i < samples.length; i++) { nx += samples[i].nx * weights[i]; ny += samples[i].ny * weights[i]; r += (samples[i].ratio - 1) * weights[i]; }
  return { nx, ny, ratio: Math.max(.05, 1 + r) };
}

export const PHOTO_GLSL = `
// W2c-10 photo detail helpers. Every lookup returns (normal.xy, ratio); ratio has mean 1.
float kzPhotoHash(vec2 p){ p=fract(p*vec2(.1031,.1030)); p+=dot(p,p.yx+33.33); return fract((p.x+p.y)*p.x); }
vec3 kzPhotoUnpack(vec3 s){ return vec3(s.rg*2.-1.,3.*s.b*s.b); }
vec3 kzPhoto(sampler2D photoMap,vec2 uv){ return kzPhotoUnpack(texture2D(photoMap,uv).rgb); }
// Anti-tiling: a simplex (triangle) lattice gives every fragment three neighbouring vertices; each vertex picks its own random
// offset (and, for isotropic materials, rotation) into the tile, and the three lookups are blended with the simplex kernel.
// Written from the idea of hex-tiling; weights are L2-normalised so the blended patches keep their contrast.
// cells = lattice cells per tile (about 1.2 gives patches a little smaller than one tile); rotate>.5 for isotropic materials.
vec3 kzPhotoHex(sampler2D photoMap,vec2 uv,float cells,float rotate){
  vec2 p=uv*cells;
  float skew=(p.x+p.y)*.3660254;
  vec2 cell=floor(p+skew);
  vec2 d0=p-(cell-(cell.x+cell.y)*.2113249);
  vec2 step1=d0.x>d0.y?vec2(1.,0.):vec2(0.,1.);
  vec2 d1=d0-step1+.2113249,d2=d0-1.+.4226497;
  vec3 w=vec3(max(.5-dot(d0,d0),0.),max(.5-dot(d1,d1),0.),max(.5-dot(d2,d2),0.));
  w*=w; w*=w;
  w/=max(length(w),1e-6);
  vec2 g1=dFdx(uv),g2=dFdy(uv);
  vec2 id0=cell,id1=cell+step1,id2=cell+vec2(1.);
  vec2 o0=vec2(kzPhotoHash(id0),kzPhotoHash(id0+17.3)),o1=vec2(kzPhotoHash(id1),kzPhotoHash(id1+17.3)),o2=vec2(kzPhotoHash(id2),kzPhotoHash(id2+17.3));
  float a0=rotate>.5?o0.x*6.2831853:0.,a1=rotate>.5?o1.x*6.2831853:0.,a2=rotate>.5?o2.x*6.2831853:0.;
  mat2 r0=mat2(cos(a0),sin(a0),-sin(a0),cos(a0)),r1=mat2(cos(a1),sin(a1),-sin(a1),cos(a1)),r2=mat2(cos(a2),sin(a2),-sin(a2),cos(a2));
  vec3 s0=kzPhotoUnpack(textureGrad(photoMap,r0*uv+o0*8.,r0*g1,r0*g2).rgb);
  vec3 s1=kzPhotoUnpack(textureGrad(photoMap,r1*uv+o1*8.,r1*g1,r1*g2).rgb);
  vec3 s2=kzPhotoUnpack(textureGrad(photoMap,r2*uv+o2*8.,r2*g1,r2*g2).rgb);
  // The lookup sees the tile turned by R, so its normal turns back by R-transpose.
  s0.xy=vec2(dot(r0[0],s0.xy),dot(r0[1],s0.xy)); s1.xy=vec2(dot(r1[0],s1.xy),dot(r1[1],s1.xy)); s2.xy=vec2(dot(r2[0],s2.xy),dot(r2[1],s2.xy));
  return vec3(s0.xy*w.x+s1.xy*w.y+s2.xy*w.z,max(1.+(s0.z-1.)*w.x+(s1.z-1.)*w.y+(s2.z-1.)*w.z,.05));
}
// Tangent frame from screen-space derivatives (no tangents needed). N and P must share a space (view space inside Three).
vec3 kzPerturbNormal(vec3 N,vec3 P,vec2 uv,vec2 nxy,float strength){
  vec3 dp1=dFdx(P),dp2=dFdy(P); vec2 duv1=dFdx(uv),duv2=dFdy(uv);
  vec3 dp2perp=cross(dp2,N),dp1perp=cross(N,dp1);
  vec3 T=dp2perp*duv1.x+dp1perp*duv2.x,B=dp2perp*duv1.y+dp1perp*duv2.y;
  float inv=inversesqrt(max(max(dot(T,T),dot(B,B)),1e-12));
  vec2 xy=nxy*strength;
  return normalize(mat3(T*inv,B*inv,N)*vec3(xy,sqrt(max(1.-dot(xy,xy),.04))));
}
`;

function neutralTexture(THREE) {
  // Flat normal and ratio 1 (sqrt(1/3) = 147/255): sampling it changes nothing, so a material never needs a null sampler.
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 147, 255]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true; return t;
}

// Starts loading every texture at once. All swap in together once the last one has arrived (no half-detailed world), then the
// shared blend eases up; a failed load leaves the procedural look untouched. Never throws.
export function startPhoto(THREE, { search = '', quality = 'standard', keys = Object.keys(PHOTO_TEX_DATA), maxAnisotropy = 1,
  loadTexture = url => new THREE.TextureLoader().loadAsync(url), baseUrl } = {}) {
  const options = photoOptions(search), loaded = new Map();
  const stats = { requested: 0, loaded: 0, failed: 0, enabled: options.enabled, ready: false };
  let step = 0, disposed = false, neutral = null, resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const handle = {
    stats, ready,
    setAdapt(next) { step = next | 0; },
    step(dt) {
      if (!stats.ready || disposed || !(dt >= 0)) return;
      const target = photoStrength(quality, step), move = dt * 1000 / PHOTO_FADE_MS;
      const v = photoBlendUniform.value;
      photoBlendUniform.value = v < target ? Math.min(target, v + move) : Math.max(target, v - move);
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const [key, texture] of loaded) { texture.dispose(); const s = samplers.get(key); if (s) s.value = null; }
      if (neutral) neutral.dispose();
      for (const s of samplers.values()) s.value = null;
      loaded.clear(); photoBlendUniform.value = 0; stats.ready = false;
      resolveReady(false);
    },
  };
  photoBlendUniform.value = 0;
  neutral = neutralTexture(THREE);
  for (const key of keys) photoSampler(key).value = neutral;
  if (!options.enabled) { resolveReady(false); return handle; }
  const anisotropy = photoAnisotropy(quality, maxAnisotropy);
  const urlOf = file => photoUrl(file, baseUrl);
  stats.requested = keys.length;
  Promise.all(keys.map(async key => {
    try {
      const texture = await loadTexture(urlOf(PHOTO_TEX_DATA[key].file));
      if (disposed) { texture.dispose?.(); return false; }
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true; texture.anisotropy = anisotropy; texture.colorSpace = THREE.NoColorSpace;
      loaded.set(key, texture); stats.loaded++; return true;
    } catch { stats.failed++; return false; }
  })).then(results => {
    if (disposed) return;
    if (results.every(Boolean)) {
      for (const [key, texture] of loaded) photoSampler(key).value = texture;
      stats.ready = true; resolveReady(true);
    } else resolveReady(false);
  });
  return handle;
}
