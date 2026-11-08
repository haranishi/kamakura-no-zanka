// W2c-10b veg5: flat trunks/crowns -> metric bark and species-aware foliage, Kamakura only.
import { PHOTO_GLSL, PHOTO_TEX_DATA, photoSampler, photoBlendUniform } from './kamakura-photo-tex.js';
export const vegLookEnabled = search => new URLSearchParams(search).get('veg5') !== '0';
const clamp = x => Math.max(0, Math.min(1, x));
export const crownGradient = radius => { const t = clamp(radius); return .72 + .28 * t * t * (3 - 2 * t); };
export function vegVariation(x, z, species) {
  const hash = salt => { const n = Math.sin(x * 12.9898 + z * 78.233 + salt) * 43758.5453; return n - Math.floor(n); };
  const gain = .85 + .3 * hash(0), hue = (hash(19.7) - .5) * .05;
  return [gain * (1 + hue + (species === 0 ? -.025 : .025)), gain, gain * (1 - hue + (species === 0 ? .04 : -.025))];
}
export function foliageColor(rgb) {
  // HSV saturation reduction of 18%, preserving the maximum channel (value).
  const hi = Math.max(...rgb); return rgb.map(v => v * .82 + hi * .18);
}
export const leafTransmission = (sunVisible, rim, facing, backlight, strength = 1) => Math.min(.035, .035 * clamp(rim) * clamp(facing) * (.35 + .65 * clamp(backlight))) * clamp(sunVisible) * strength;
// Decode each original tube's rings on the CLONED geometry. Its old UV rounds the
// circumference to repeats; arc length and ring-centre distance recover metres instead.
// Cores have UV (-1,-1), and remain untextured. No changes to cached valley templates.
export function barkMeters(geometry) {
  const p = geometry.attributes.position, uv = geometry.attributes.uv, result = new Float32Array(p.count * 2);
  let previous = null, along = 0;
  for (let start = 0; start < p.count;) {
    if (uv.getX(start) < 0) { result[start * 2] = -1; start++; previous = null; continue; }
    let end = start + 1;
    while (end < p.count && Math.abs(uv.getY(end) - uv.getY(start)) < 1e-6 && uv.getX(end) > uv.getX(end - 1)) end++;
    const centre = [0, 0, 0], n = Math.max(1, end - start - 1);
    for (let i = start; i < start + n; i++) { centre[0] += p.getX(i) / n; centre[1] += p.getY(i) / n; centre[2] += p.getZ(i) / n; }
    if (!previous || uv.getY(start) <= 1e-6) along = 0;
    else along += Math.hypot(...centre.map((v, k) => v - previous[k]));
    let arc = 0;
    for (let i = start; i < end; i++) {
      if (i > start) arc += Math.hypot(p.getX(i) - p.getX(i - 1), p.getY(i) - p.getY(i - 1), p.getZ(i) - p.getZ(i - 1));
      result[i * 2] = arc; result[i * 2 + 1] = along;
    }
    previous = centre; start = end;
  }
  return result;
}
// The caller supplies THREE's vector as the live sun uniform; all new effects share
// the photo blend (neutral before readiness, reduced in light/step 2, off in step 3).
export function applyVegLook(material, { species, leaf, geometry, sunDir, strength, impostor = false, stand = false, lightsChunk }) {
  const original = material.onBeforeCompile, key = material.customProgramCacheKey();
  geometry.computeBoundingBox(); const b = geometry.boundingBox;
  const center = [0, 1, 2].map(k => (b.min.getComponent(k) + b.max.getComponent(k)) / 2);
  const radius = center.map((v, k) => Math.max(.01, b.max.getComponent(k) - v));
  material.onBeforeCompile = shader => {
    original(shader);
    Object.assign(shader.uniforms, { uKzVeg: strength, uKzPhoto: photoBlendUniform, uKzSun: { value: sunDir } });
    const decl = 'uniform float uKzVeg; uniform float uKzPhoto; uniform vec3 uKzSun; varying vec3 vKzCrown; varying vec3 vKzTint;';
    shader.vertexShader = (stand ? 'attribute float aKzSpecies;\n' : '') + decl + (leaf ? '' : 'attribute vec2 aKzBarkMeters; varying vec2 vKzBark;') + '\n' + shader.vertexShader;
    shader.fragmentShader = decl + (leaf ? '' : 'uniform sampler2D uKzBark; varying vec2 vKzBark;') + '\n' + shader.fragmentShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 kzOrigin = vec3(0.0);
      #ifdef USE_INSTANCING
        kzOrigin = (modelMatrix*instanceMatrix[3]).xyz;
      #endif
      float kzSeed = dot(kzOrigin.xz,vec2(12.9898,78.233));
      float kzGain = .85+.3*fract(sin(kzSeed)*43758.5453);
      float kzHue = (fract(sin(kzSeed+19.7)*43758.5453)-.5)*.05;
      float kzCedar = ${stand ? '1.0-step(.5,aKzSpecies)' : species === 0 ? '1.0' : '0.0'};
      vKzTint = kzGain*vec3(1.0+kzHue+mix(.025,-.025,kzCedar),1.0,1.0-kzHue+mix(-.025,.04,kzCedar));
      vKzCrown = (position - vec3(${center.map(v => v.toFixed(6)).join(',')})) / vec3(${radius.map(v => v.toFixed(6)).join(',')});
      ${leaf ? '' : `float kzScale = 1.0;
      #ifdef USE_INSTANCING
        kzScale = length(instanceMatrix[0].xyz);
      #endif
      vKzBark = aKzBarkMeters * kzScale / ${PHOTO_TEX_DATA[species === 0 ? 'barkCedar' : 'barkPine'].meters.toFixed(2)};`}`);
    if (!leaf) {
      shader.uniforms.uKzBark = photoSampler(species === 0 ? 'barkCedar' : 'barkPine');
      shader.fragmentShader = PHOTO_GLSL + '\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 kzBarkDetail = kzPhoto(uKzBark, vKzBark);
        float kzBarkWeight = uKzVeg * uKzPhoto * step(0.0, vKzBark.x);
        normal = kzPerturbNormal(normal, -vViewPosition, vKzBark, kzBarkDetail.xy,
          .65 * kzBarkWeight * (1.0-smoothstep(15.0,60.0,length(vViewPosition))));
        diffuseColor.rgb *= mix(1.0,kzBarkDetail.z,.65*kzBarkWeight*(1.0-smoothstep(40.0,150.0,length(vViewPosition))));`);
      return;
    }
    // Fade the old backlight only as the new look arrives; readiness/step 3 keep the old light.
    shader.fragmentShader = shader.fragmentShader.replace(/(totalEmissiveRadiance \+= min\([^;]+)\;/, '$1 * (1.0-uKzVeg*uKzPhoto);');
    // Actual shadow visibility, before the shared leaf shadow floor (.4), gates new light.
    if (lightsChunk) shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', lightsChunk);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_lambert_fragment>', 'float kzSunVisibility = 1.0;\n#include <lights_lambert_fragment>')
      .replace(/getShadow\( directionalShadowMap\[ i \],[^;]+?vDirectionalShadowCoord\[ i \] \)/g, '(kzSunVisibility = $&)');
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `
      float kzLeafMask = ${impostor ? 'step(.5,impNormal.a)' : '1.0'};
      float kzLook = uKzVeg*uKzPhoto*kzLeafMask;
      float kzOuter = smoothstep(0.0,1.0,length(vKzCrown));
      diffuseColor.rgb *= mix(vec3(1.0),vKzTint,kzLook);
      float kzValue = max(diffuseColor.r,max(diffuseColor.g,diffuseColor.b));
      diffuseColor.rgb = mix(diffuseColor.rgb,mix(diffuseColor.rgb,vec3(kzValue),.18)*(.72+.28*kzOuter),kzLook);
      #include <normal_fragment_begin>`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      vec3 kzSunView = normalize((viewMatrix*vec4(uKzSun,0.0)).xyz);
      float kzFacing = max(0.0,dot(normal,kzSunView));
      float kzRim = pow(1.0-abs(dot(normal,normalize(vViewPosition))),2.0)*kzOuter;
      float kzBack = pow(max(0.0,dot(-normalize(vViewPosition),kzSunView)),3.0);
      float kzVisible = kzSunVisibility;
      // Small multiplicative cool shade; never adds light in shadow.
      reflectedLight.indirectDiffuse *= mix(vec3(1.0),vec3(.96,.98,1.0),kzLook*(1.0-kzFacing));
      reflectedLight.directDiffuse += min(vec3(.035),diffuseColor.rgb*vec3(1.0,.85,.48)*kzRim*(.35+.65*kzBack)) * kzFacing*kzVisible*kzLook;
    `);
  };
  material.customProgramCacheKey = () => `${key}-veg5-${species}-${leaf}-${impostor}-${stand}`;
}
