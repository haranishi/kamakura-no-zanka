import { groundFarCanopyColor } from './kamakura-ground-far.js';

// All distances are metres; colours are derived from the local ground and existing canopy.
export const CLIFF = Object.freeze({
  startDeg: 40, fullDeg: 55, // slope: start / complete the rock replacement.
  edgeNoise: .055, edgeMeters: 3.7, // normal-Y perturbation / horizontal wavelength; endpoints stay fixed.
  layerMeters: .9, layerTilt: .025, // mean bed spacing / rise per horizontal metre.
  layerWarp: .16, layerWaveMeters: 4.3, layerHeightWave: .18, // bed undulation in cycles / horizontal and vertical wavelengths.
  layerShade: .13, layerChroma: .06, // bed-to-bed luminance / source-colour variation.
  layerVariation: 2.4, crackVariation: 1.7, // phase change between neighbouring beds / cracks (radians).
  seamMeters: .045, seamShade: .28, rimMeters: .07, rimLight: .16, // dark joint / bright lower lip widths and gains.
  crackMeters: 3.1, crackWarp: .07, crackWaveMeters: 5.3, // joint spacing / phase warp / vertical wandering wavelength.
  crackWidthMin: .025, crackWidthMax: .09, crackShade: .42, // variable dark joint width / strength.
  crackBreakMeters: 2.6, crackBreakFrom: -.45, crackBreakTo: .25, // vertical gaps and soft break thresholds.
  macroMeters: 4.8, macroShade: .20, // large bands remain legible at 200m.
  grayMix: .78, rockGain: 1.25, shadeFloor: .08, // desaturation / source-ground gain / minimum overlapping-joint reflectance.
  grassMix: .28, shelfFrom: .35, shelfTo: .72, // canopy-derived grass tint / upward-facing ledge normals.
  crestFrom: .62, crestTo: .76, // fade grass to zero before the unchanged gentle ground.
  filterFrom: .25, filterTo: .8, // footprint as fraction of feature spacing: start / complete filtering.
  fineFrom: 90, fineTo: 220, lightFrom: 45, lightTo: 120, // detail distance fade (standard / light).
  adaptDistance: .7, epsilon: .00001, // shorter detail reach per adaptive step / division guard.
  debugColor: Object.freeze([0, 1, 1]) // cyan: surfaces receiving the cliff replacement (unlit, unfogged).
});
const C = CLIFF, tau = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const fract = v => v - Math.floor(v);
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const startY = Math.cos(C.startDeg * Math.PI / 180), fullY = Math.cos(C.fullDeg * Math.PI / 180);
export const cliffEnabled = search => new URLSearchParams(search).get('cliff') !== '0';
export function cliffWeight(ny, x = 0, z = 0) {
  if (ny >= startY) return 0;
  if (ny <= fullY) return 1;
  const t = clamp((startY - ny) / (startY - fullY), 0, 1);
  const noise = Math.sin(x / C.edgeMeters) * Math.sin(z / C.edgeMeters);
  return smooth(0, 1, clamp(t + noise * C.edgeNoise * t * (1 - t), 0, 1));
}
export const cliffProjectionWeight = (nx, nz) => nx * nx / Math.max(C.epsilon, nx * nx + nz * nz);
export const cliffLayerPhase = (u, h) => h / C.layerMeters + C.layerTilt * u
  + C.layerWarp * Math.sin(u / C.layerWaveMeters) + C.layerHeightWave * Math.sin(h / C.layerWaveMeters);
export const cliffCrackPhase = (u, h) => u / C.crackMeters + C.crackWarp * Math.sin(h / C.crackWaveMeters + Math.sin(u / C.crackWaveMeters));
export const cliffFilter = (spacing, pixel) => 1 - smooth(spacing * C.filterFrom, spacing * C.filterTo, pixel);
export const cliffDistance = (d, from = C.fineFrom, to = C.fineTo) => 1 - smooth(from, to, d);
export function cliffSignals(u, h, pixel = 0, detail = 1, fine = 1) {
  const phase = cliffLayerPhase(u, h), bed = Math.floor(phase), f = fract(phase);
  const layerFade = detail * cliffFilter(C.layerMeters, pixel);
  const seam = (1 - smooth(0, C.seamMeters / C.layerMeters, Math.min(f, 1 - f))) * layerFade;
  // Below a bed boundary (in height), so the illuminated lip is below the dark joint.
  const rim = (1 - smooth(0, C.rimMeters / C.layerMeters, Math.abs(f - (1 - C.rimMeters / C.layerMeters)))) * layerFade;
  const band = Math.sin(bed * C.layerVariation) * layerFade;
  const macro = Math.sin(tau * h / C.macroMeters + C.layerTilt * u) * cliffFilter(C.macroMeters, pixel);
  const cp = cliffCrackPhase(u, h), cf = fract(cp);
  const width = mix(C.crackWidthMin, C.crackWidthMax, .5 + .5 * Math.sin(h / C.crackBreakMeters + Math.floor(cp)));
  const broken = smooth(C.crackBreakFrom, C.crackBreakTo, Math.sin(h / C.crackBreakMeters + Math.floor(cp) * C.crackVariation));
  const crack = fine * detail * broken * (1 - smooth(width, width + Math.max(pixel, C.epsilon), Math.min(cf, 1 - cf) * C.crackMeters)) * cliffFilter(width, pixel);
  return { band, seam, rim, macro, crack };
}
export function cliffColor(base, world, normal, { pixel = 0, distance = 0, fine = 1, enabled = true, grass = groundFarCanopyColor() } = {}) {
  const w = enabled ? cliffWeight(normal.y, world.x, world.z) : 0;
  if (w === 0) return base.slice();
  const detail = cliffDistance(distance), a = cliffSignals(world.z, world.y, pixel, detail, fine), b = cliffSignals(world.x, world.y, pixel, detail, fine);
  const q = cliffProjectionWeight(normal.x, normal.z), s = {};
  for (const k of Object.keys(a)) s[k] = mix(b[k], a[k], q);
  const luminance = base[0] * .2126 + base[1] * .7152 + base[2] * .0722;
  const shade = Math.max(C.shadeFloor, 1 + s.macro * C.macroShade + s.band * C.layerShade - s.seam * C.seamShade + s.rim * C.rimLight - s.crack * C.crackShade);
  const shelf = fine * detail * C.grassMix * smooth(C.shelfFrom, C.shelfTo, normal.y) * (1 - smooth(C.crestFrom, C.crestTo, normal.y));
  return base.map((v, k) => mix(v, mix(mix(v, luminance, C.grayMix - s.band * C.layerChroma) * C.rockGain * shade, grass[k], shelf), w));
}
const gl = n => Number.isInteger(n) ? n + '.0' : String(n);
// Scalar equations are mirrored by the pure functions above and compared by executing these bodies in tests.
export const CLIFF_SCALAR_GLSL = `
float cliffWeight(float ny,float x,float z){
  if(ny>=${gl(startY)})return 0.0;
  if(ny<=${gl(fullY)})return 1.0;
  float t=clamp((${gl(startY)}-ny)/(${gl(startY - fullY)}),0.0,1.0);
  float noise=sin(x/${gl(C.edgeMeters)})*sin(z/${gl(C.edgeMeters)});
  return smoothstep(0.0,1.0,clamp(t+noise*${gl(C.edgeNoise)}*t*(1.0-t),0.0,1.0));
}
float cliffProjectionWeight(float nx,float nz){return nx*nx/max(${gl(C.epsilon)},nx*nx+nz*nz);}
float cliffLayerPhase(float u,float h){return h/${gl(C.layerMeters)}+${gl(C.layerTilt)}*u+${gl(C.layerWarp)}*sin(u/${gl(C.layerWaveMeters)})+${gl(C.layerHeightWave)}*sin(h/${gl(C.layerWaveMeters)});}
float cliffCrackPhase(float u,float h){return u/${gl(C.crackMeters)}+${gl(C.crackWarp)}*sin(h/${gl(C.crackWaveMeters)}+sin(u/${gl(C.crackWaveMeters)}));}
float cliffFilter(float spacing,float pixel){return 1.0-smoothstep(spacing*${gl(C.filterFrom)},spacing*${gl(C.filterTo)},pixel);}
float cliffDistance(float d,float fromD,float toD){return 1.0-smoothstep(fromD,toD,d);}
`;
export const CLIFF_GLSL = `
uniform float uCliffEnabled,uCliffFine,uCliffDebug;
uniform vec2 uCliffDistance;
uniform vec3 uCliffGrass;
float cliffDrawWeight=0.0;
${CLIFF_SCALAR_GLSL}
vec4 cliffSignals(float u,float h,float pixel,float detail,float fine){
  float phase=cliffLayerPhase(u,h),bed=floor(phase),f=fract(phase);
  float layerFade=detail*cliffFilter(${gl(C.layerMeters)},pixel);
  float seam=(1.0-smoothstep(0.0,${gl(C.seamMeters / C.layerMeters)},min(f,1.0-f)))*layerFade;
  float rim=(1.0-smoothstep(0.0,${gl(C.rimMeters / C.layerMeters)},abs(f-${gl(1 - C.rimMeters / C.layerMeters)})))*layerFade;
  float band=sin(bed*${gl(C.layerVariation)})*layerFade;
  float macro=sin(${gl(tau)}*h/${gl(C.macroMeters)}+${gl(C.layerTilt)}*u)*cliffFilter(${gl(C.macroMeters)},pixel);
  float crack=0.0;
  if(fine>0.0 && detail>0.0){
    float cp=cliffCrackPhase(u,h),cf=fract(cp);
    float width=mix(${gl(C.crackWidthMin)},${gl(C.crackWidthMax)},.5+.5*sin(h/${gl(C.crackBreakMeters)}+floor(cp)));
    float broken=smoothstep(${gl(C.crackBreakFrom)},${gl(C.crackBreakTo)},sin(h/${gl(C.crackBreakMeters)}+floor(cp)*${gl(C.crackVariation)}));
    crack=fine*detail*broken*(1.0-smoothstep(width,width+max(pixel,${gl(C.epsilon)}),min(cf,1.0-cf)*${gl(C.crackMeters)}))*cliffFilter(width,pixel);
  }
  return vec4(band,seam,rim,macro*${gl(C.macroShade)}-crack*${gl(C.crackShade)});
}
vec3 cliffRock(vec3 base,vec3 world,vec3 facing,vec2 pixel,float dist){
  float detail=cliffDistance(dist,uCliffDistance.x,uCliffDistance.y);
  vec4 a=cliffSignals(world.z,world.y,pixel.x,detail,uCliffFine);
  vec4 b=cliffSignals(world.x,world.y,pixel.y,detail,uCliffFine);
  vec4 s=mix(b,a,cliffProjectionWeight(facing.x,facing.z));
  float luminance=dot(base,vec3(.2126,.7152,.0722));
  float shade=max(${gl(C.shadeFloor)},1.0+s.w+s.x*${gl(C.layerShade)}-s.y*${gl(C.seamShade)}+s.z*${gl(C.rimLight)});
  vec3 rock=mix(base,vec3(luminance),${gl(C.grayMix)}-s.x*${gl(C.layerChroma)})*${gl(C.rockGain)}*shade;
  if(uCliffFine>0.0 && detail>0.0){
    float shelf=uCliffFine*detail*${gl(C.grassMix)}*smoothstep(${gl(C.shelfFrom)},${gl(C.shelfTo)},facing.y)*(1.0-smoothstep(${gl(C.crestFrom)},${gl(C.crestTo)},facing.y));
    rock=mix(rock,uCliffGrass,shelf);
  }
  return rock;
}
`;

export function installGroundCliff(THREE, material, owner, { quality = 'standard', search = '' } = {}) {
  if (!cliffEnabled(search) || !owner.uniforms) return;
  const params = new URLSearchParams(search), uniforms = {
    uCliffEnabled: { value: 1 }, uCliffFine: { value: quality === 'light' ? 0 : 1 },
    uCliffDebug: { value: params.get('cliffdebug') === '1' ? 1 : 0 },
    uCliffDistance: { value: new THREE.Vector2(quality === 'light' ? C.lightFrom : C.fineFrom, quality === 'light' ? C.lightTo : C.fineTo) },
    uCliffGrass: { value: new THREE.Vector3(...groundFarCanopyColor()) }
  };
  Object.assign(owner.uniforms, uniforms);
  const prior = material.onBeforeCompile, priorKey = material.customProgramCacheKey, key = priorKey.call(material);
  function compile(shader) {
    prior.call(material, shader); Object.assign(shader.uniforms, uniforms);
    for (const anchor of ['#include <common>', '#include <normal_fragment_begin>', '#include <normal_fragment_maps>', '#include <dithering_fragment>']) {
      if (!shader.fragmentShader.includes(anchor)) throw new Error('Missing ground cliff shader anchor: ' + anchor);
    }
    const sourceColor = owner.tone ? 'uToneBaked>.5?toneLinear(texture2D(uToneBase,vGroundWorld.xz/(uToneGrid.z*uToneGrid.xy)+.5).rgb):diffuseColor.rgb' : 'diffuseColor.rgb';
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', CLIFF_GLSL + '\nvoid main() {')
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        vec3 cliffOriginalNormal=normal;
        vec3 cliffFacing=inverseTransformDirection(normal,viewMatrix);
        // Derivatives must run before divergent slope and distance branches; neither projection uses top-down UVs.
        vec2 cliffPixel=vec2(max(length(dFdx(vGroundWorld.zy)),length(dFdy(vGroundWorld.zy))),max(length(dFdx(vGroundWorld.xy)),length(dFdy(vGroundWorld.xy))));
        cliffDrawWeight=uCliffEnabled>0.0?cliffWeight(cliffFacing.y,vGroundWorld.x,vGroundWorld.z):0.0;
        if(cliffDrawWeight>0.0){
          vec3 cliffBase=${sourceColor};
          #if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
          ${owner.tone ? '' : 'cliffBase=vColor.rgb;'}
          #endif
          diffuseColor.rgb=mix(diffuseColor.rgb,cliffRock(cliffBase,vGroundWorld,cliffFacing,cliffPixel,distance(vGroundWorld,cameraPosition)),cliffDrawWeight);
        }`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>\nif(uCliffDebug>.5 && cliffDrawWeight>0.0)gl_FragColor.rgb=vec3(${C.debugColor.map(gl)});`);
    // Drop the stretched, top-projected photographic normal on rock, preserving Lambert light and shadows.
    const photoNormalEnd = '  .45*groundPhotoAmount*groundPhotoNormalFade);';
    if (owner.tone) {
      if (!shader.fragmentShader.includes(photoNormalEnd)) throw new Error('Missing ground photographic normal anchor');
      shader.fragmentShader = shader.fragmentShader.replace(photoNormalEnd, photoNormalEnd + '\nif(cliffDrawWeight>0.0)normal=normalize(mix(normal,cliffOriginalNormal,cliffDrawWeight));');
    }
  }
  material.onBeforeCompile = compile;
  material.customProgramCacheKey = () => key + '|ground-cliff-1';
  let disposed = false;
  const oldAdapt = owner.setAdapt, oldDispose = owner.dispose, priorRender = material.onBeforeRender;
  owner.setAdapt = function(policy) {
    oldAdapt.call(this, policy);
    const step = typeof policy === 'number' ? policy : policy.step;
    uniforms.uCliffEnabled.value = step >= 3 ? 0 : 1;
    uniforms.uCliffFine.value = quality === 'light' || step >= 2 ? 0 : 1;
    const scale = C.adaptDistance ** step;
    uniforms.uCliffDistance.value.set((quality === 'light' ? C.lightFrom : C.fineFrom) * scale, (quality === 'light' ? C.lightTo : C.fineTo) * scale);
  };
  // Debug only: remember existing meshes without clearing/reallocating a frame buffer.
  // Post passes also increment renderer.info.render.frame, so use the terrain camera's current frustum when queried.
  const submitted = new Set(), cache = new WeakMap();
  if (params.get('debug') === '1') material.onBeforeRender = function(renderer, scene, camera, geometry, object, group) {
    priorRender.call(this, renderer, scene, camera, geometry, object, group);
    submitted.add(object);
    owner.cliff.camera = camera;
  };
  const debug = () => {
    let count = 0, triangles = 0, work = 0, draws = 0, nearest = null;
    const camera = owner.cliff.camera, eye = camera?.position, point = new THREE.Vector3();
    const frustum = camera ? new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)) : null;
    if (uniforms.uCliffEnabled.value > 0) for (const object of submitted) {
      if (!object.visible || !object.layers.test(camera.layers) || !frustum.intersectsObject(object)) continue;
      draws++;
      const g = object.geometry;
      let samples = cache.get(g);
      if (!samples) {
        samples = []; const p = g.getAttribute('position'), n = g.getAttribute('normal'), index = g.index;
        const end = index ? index.count : p.count;
        for (let i = 0; i < end; i += 3) {
          let x = 0, y = 0, z = 0, ny = 0;
          for (let j = 0; j < 3; j++) { const k = index ? index.getX(i + j) : i + j; x += p.getX(k) / 3; y += p.getY(k) / 3; z += p.getZ(k) / 3; ny += n.getY(k) / 3; }
          if (cliffWeight(ny, x, z) > 0) samples.push(x, y, z);
        }
        cache.set(g, samples); work += end;
      }
      if (samples.length) count++;
      triangles += samples.length / 3;
      if (eye) for (let i = 0; i < samples.length; i += 3) {
        point.set(samples[i], samples[i + 1], samples[i + 2]).applyMatrix4(object.matrixWorld);
        const distance = point.distanceTo(eye);
        if (!nearest || distance < nearest.distance) nearest = { distance, bearing: (Math.atan2(point.x - eye.x, eye.z - point.z) * 180 / Math.PI + 360) % 360 };
      }
    }
    return { enabled: !disposed && uniforms.uCliffEnabled.value > 0, count, triangles, drawCalls: 0, addedTriangles: 0, textureBytes: 0, work,
      submittedGroundDraws: draws, fine: uniforms.uCliffFine.value, nearest, countsAre: 'known ground meshes in terrain-camera frustum, steep triangle centroids; not visible pixels' };
  };
  if (params.get('debug') === '1') globalThis.__kzCliff = debug;
  owner.cliff = { uniforms, debug, camera: null };
  owner.dispose = function() {
    if (disposed) return; disposed = true; submitted.clear(); owner.cliff.camera = null;
    if (globalThis.__kzCliff === debug) delete globalThis.__kzCliff;
    material.onBeforeRender = priorRender;
    if (material.onBeforeCompile === compile) { material.onBeforeCompile = prior; material.customProgramCacheKey = priorKey; }
    oldDispose.call(this);
  };
}
