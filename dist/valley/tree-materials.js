// Lambert specimen materials. Only the color pass receives the quality-specific LOD fade.
import * as THREE from 'three';
import { TREES } from './config.js';
import { needleTexture, mapleLeafTexture, zelkovaLeafTexture, cedarSprayTexture, leafDetailTexture, barkTexture } from './tree-textures.js';
const heights = [20, 12, 13, 8, 3, 1.2];
// A solid far crown keeps the alpha-weighted mean of its near texture, not white. Each sRGB
// byte decodes to linear light first, as the GPU samples it; averaging bytes was about 5% dark.
const linear = Array.from({ length: 256 }, (_, k) => new THREE.Color().setRGB(k / 255, k / 255, k / 255, THREE.SRGBColorSpace).r);
function meanColor(texture) {
  const a = texture.image.data, sum = [0, 0, 0]; let weight = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i + 3] >= 77) {
    const w = a[i + 3] / 255; weight += w;
    for (let k = 0; k < 3; k++) sum[k] += linear[a[i + k]] * w;
  }
  return new THREE.Color().setRGB(...sum.map(v => v / (weight || 1)), THREE.LinearSRGBColorSpace);
}
// Image routing: 0 needle (pine fans), 1 zelkova, 2 maple, 3 cedar spray atlas (near and middle tufts).
// Cedar tufts no longer share the pine needle image; the middle skirts' fringe image left with the skirts.
// A far crown takes the mean of its own near image.
export function leafImage(species, level, variant = 0) {
  if (species === 0) return 3;
  if (species === 2) return 0;
  return species === 3 || species === 4 && variant === 1 ? 2 : 1;
}
export function farImage(species, variant = 0) { return leafImage(species, 0, variant); }
export function treeMaterials({ wind, sunDir, quality = 'standard' }) {
  const textures = [needleTexture(), zelkovaLeafTexture(), mapleLeafTexture(), cedarSprayTexture()], owned = [], sets = new Map();
  // Broadleaf images carry a per-leaf detail map (tilted normal + colour jitter); wood shares one bark image.
  const details = { 1: leafDetailTexture('zelkova'), 2: leafDetailTexture('maple') }, bark = barkTexture();
  const means = textures.map(meanColor);
  const sun = { value: sunDir }, disabled = () => ({ value: new THREE.Vector4(-1, -1, -1, -1) });
  const barkUniform = { value: bark }, barkRelief = { value: TREES.bark.relief };
  function material(species, level, leaf, variant, shape) {
    const conifer = species === 0 || species === 2, image = leafImage(species, level, variant);
    const map = !leaf || level === 2 ? null : textures[image];
    const m = new THREE.MeshLambertMaterial({ map, vertexColors: true, side: leaf ? THREE.DoubleSide : THREE.FrontSide,
      alphaTest: map ? .3 : 0, alphaToCoverage: quality !== 'light', emissive: 0x000000 });
    if (leaf && level === 2) m.color.copy(means[farImage(species, variant)]);
    // Far broadleaf keeps the near gain so the dissolve band has no brightness step; conifers have none.
    if (leaf && !conifer) m.color.multiplyScalar(species >= 4 ? TREES.understoryLeafGain : TREES.leafGain);
    // Each broadleaf leaf faces its own way: the shell normal only carries the crown's volume.
    const detail = leaf && map && details[image] ? details[image] : null;
    if (detail) { m.normalMap = detail; m.normalScale.set(TREES.leafDetail.normal, TREES.leafDetail.normal); }
    // Cedar tufts are lit as one crown: back faces keep the outward crown normal instead of flipping per card.
    const crownLit = leaf && species === 0 && level < 2;
    const fadeMode = quality === 'light' ? 'dither' : 'coverage';
    const lod = disabled(); m.userData.uLod = lod;
    m.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, wind, { uSunDir: sun, uLod: lod }, leaf ? {} : { uBark: barkUniform, uBarkRelief: barkRelief });
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        attribute float aSway;
        uniform float uTime; uniform float uWind; uniform vec2 uWindDir; uniform float uGuideMix;
        uniform vec4 uLod;
        varying vec3 vTreeWorld; varying float vTreeDistance; varying float vTreeWeight;
        ${leaf ? '' : 'varying vec2 vBarkUv; varying float vBarkHeight;'}
        float treeNoise(vec2 p) {
          vec2 a=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(sin(dot(a,vec2(12.9898,78.233))),sin(dot(a+vec2(1,0),vec2(12.9898,78.233))),f.x),
            mix(sin(dot(a+vec2(0,1),vec2(12.9898,78.233))),sin(dot(a+vec2(1,1),vec2(12.9898,78.233))),f.x),f.y);
        }`).replace('#include <begin_vertex>', `#include <begin_vertex>
        ${leaf ? '' : 'vBarkUv = uv; vBarkHeight = position.y;'}
        vec3 treeOrigin = vec3(0.0);
        #ifdef USE_INSTANCING
          treeOrigin = instanceMatrix[3].xyz;
        #endif
        treeOrigin = (modelMatrix*vec4(treeOrigin,1.0)).xyz;
        ${species === 0 ? `// Position-stable cedar profile, shared by foliage and wood before wind.
        float ph1 = fract(sin(dot(treeOrigin.xz,vec2(12.9898,78.233)))*43758.5453)*6.283185;
        float ph2 = fract(sin(dot(treeOrigin.xz,vec2(39.346,11.135)))*24634.6345)*6.283185;
        float prof = 1.0 + ${[.06,.12,.16][level].toFixed(2)} * (0.6*sin(ph1 + position.y*0.55) + 0.4*sin(ph2 + position.y*1.3));
        transformed.xz *= prof;
        // Each height band of each tree leans its own way: neighbouring tiers never stack as level rings.
        float tierTurn = ph1*1.7 + position.y*0.43;
        transformed.y += dot(transformed.xz, vec2(cos(tierTurn), sin(tierTurn))) * ${TREES.tierTilt[level].toFixed(3)} * (0.55 + 0.45*sin(ph2 + position.y*0.91));` : ''}
        float ph = treeOrigin.x*.37+treeOrigin.z*.21;
        float heightRatio = clamp(position.y/${heights[species].toFixed(1)},0.0,1.0);
        float slow = sin(uTime*.8+ph)*.12*heightRatio*heightRatio;
        float flutter = sin(uTime*7.1+ph*2.3+position.y*4.0)*.025*aSway;
        float bandPhase = dot(treeOrigin.xz,uWindDir)*.045-uTime*.9;
        float band = smoothstep(.55,.95,sin(bandPhase+treeNoise(treeOrigin.xz*.025)*.65));
        float gust = band*.18*step(.5,uWind)*(1.0+.6*uGuideMix)*heightRatio*heightRatio;
        vec2 treeMotion = (uWindDir*(slow+gust)+vec2(-uWindDir.y,uWindDir.x)*flutter)*uWind;
        // Convert the world wind into local mesh coordinates, including instance yaw/scale.
        mat3 treeBasis = mat3(modelMatrix);
        #ifdef USE_INSTANCING
          treeBasis = mat3(modelMatrix)*mat3(instanceMatrix);
        #endif
        vec3 worldMotion = vec3(treeMotion.x,0.0,treeMotion.y);
        transformed += vec3(dot(treeBasis[0],worldMotion)/max(dot(treeBasis[0],treeBasis[0]),.0001),
          dot(treeBasis[1],worldMotion)/max(dot(treeBasis[1],treeBasis[1]),.0001),
          dot(treeBasis[2],worldMotion)/max(dot(treeBasis[2],treeBasis[2]),.0001));
        vec4 treeWorld = vec4(transformed,1.0);
        #ifdef USE_INSTANCING
          treeWorld = instanceMatrix*treeWorld;
        #endif
        vTreeWorld = (modelMatrix*treeWorld).xyz;
        vTreeDistance = distance(treeOrigin,cameraPosition);
        float enter = uLod.x < 0.0 ? 1.0 : smoothstep(uLod.x,uLod.y,vTreeDistance);
        float leave = uLod.z < 0.0 ? 1.0 : 1.0-smoothstep(uLod.z,uLod.w,vTreeDistance);
        vTreeWeight = enter*leave;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        uniform vec3 uSunDir;
        varying vec3 vTreeWorld; varying float vTreeDistance; varying float vTreeWeight;
        ${leaf ? '' : 'uniform sampler2D uBark; uniform float uBarkRelief; varying vec2 vBarkUv; varying float vBarkHeight;'}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        ${leaf ? (detail ? `// Per-leaf colour jitter (detail alpha, mean 0): some leaves warmer, some cooler, never a new hue.
        vec4 leafDetail = texture2D(normalMap, vNormalMapUv);
        float leafHue = leafDetail.a*2.0-1.0;
        diffuseColor.rgb *= vec3(1.0+${TREES.leafDetail.hue.toFixed(3)}*leafHue, 1.0+${(TREES.leafDetail.hue / 6).toFixed(4)}*leafHue, 1.0-${TREES.leafDetail.hue.toFixed(3)}*leafHue);
        // Rim erosion: near a shell's silhouette each leaf survives by its own random value, so the outline breaks into leaves.
        diffuseColor.a *= smoothstep(.12, .46, abs(dot(normalize(vNormal), normalize(vViewPosition))) + (leafDetail.a-.5)*${TREES.leafDetail.rim.toFixed(2)});` : crownLit ? `// A tuft card seen edge-on fades out instead of drawing a thin board edge (no normalize: a zero cross product stays finite).
        vec3 cardFace = cross(dFdx(vViewPosition), dFdy(vViewPosition));
        diffuseColor.a *= smoothstep(.04, .22, abs(dot(cardFace, normalize(vViewPosition))) / max(length(cardFace), 1e-8));` : '') : `// Bark: one shared image (mean gain 1, so far trunks keep their brightness); foliage cores carry UV (-1,-1).
        float barkOn = step(-0.5, vBarkUv.x);
        vec4 barkTexel = texture2D(uBark, vBarkUv);
        diffuseColor.rgb *= mix(1.0, barkTexel.r*2.0, barkOn);
        // Ground contact: the first metre of every trunk darkens toward the soil.
        diffuseColor.rgb *= mix(1.0, ${TREES.bark.contact.toFixed(2)} + ${(1 - TREES.bark.contact).toFixed(2)}*smoothstep(-0.15, 1.1, vBarkHeight), barkOn);${species === 0 ? `
        // Inside the cedar crown the trunk and limbs stand in the tufts' shade.
        diffuseColor.rgb *= mix(1.0, ${TREES.bark.crownShade.toFixed(2)}, smoothstep(2.6, 5.5, vBarkHeight)*barkOn);` : ''}`}`)
        .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
        ${fadeMode === 'coverage' ? 'diffuseColor.a *= vTreeWeight;' : `float n = fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
        if (n >= vTreeWeight) discard;`}`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        ${crownLit ? 'normal = normalize(vNormal); nonPerturbedNormal = normal;' : ''}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        ${leaf ? '' : `// Bark relief: the strips' grooves catch the low sun (derivative tangent frame, as Three's getTangentFrame).
        vec3 barkQ0 = dFdx(-vViewPosition), barkQ1 = dFdy(-vViewPosition);
        vec2 barkSt0 = dFdx(vBarkUv), barkSt1 = dFdy(vBarkUv);
        vec3 barkQ1p = cross(barkQ1, normal), barkQ0p = cross(normal, barkQ0);
        vec3 barkT = barkQ1p*barkSt0.x + barkQ0p*barkSt1.x, barkB = barkQ1p*barkSt0.y + barkQ0p*barkSt1.y;
        float barkDet = max(dot(barkT,barkT), dot(barkB,barkB));
        float barkScale = barkDet == 0.0 ? 0.0 : inversesqrt(barkDet);
        vec2 barkTilt = (barkTexel.gb*2.0-1.0)*uBarkRelief;
        normal = normalize(mix(normal, normalize(barkT*(barkTilt.x*barkScale) + barkB*(barkTilt.y*barkScale) + normal), barkOn));`}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // diffuseColor includes map, exposure vertex color and instanceColor (color_fragment).
        totalEmissiveRadiance += diffuseColor.rgb*${leaf ? '.24' : '.10'};
        ${leaf ? `vec3 sight = normalize(vTreeWorld-cameraPosition);
        float backlight = pow(max(0.0,dot(sight,normalize(uSunDir))),3.0);
        backlight *= 1.0-smoothstep(30.0,100.0,vTreeDistance);
        // Thin leaves turned away from the sun pass more light; the shell's inner leaves stay dark (exposure).
        float leafThrough = ${detail ? `.55 + .45*max(0.0, dot(normal, -normalize((viewMatrix*vec4(uSunDir,0.0)).xyz)))` : '1.0'};
        totalEmissiveRadiance += min(vec3(.35),diffuseColor.rgb*vec3(1.0,.82,.52)*backlight*${conifer ? '.2' : '1.0'}*leafThrough);` : ''}`);
    };
    m.customProgramCacheKey = () => `tree-specimen-v2-${species}-${level}-${leaf}-${variant}-${shape}-${quality}-${fadeMode}`;
    owned.push(m); return m;
  }
  let disposed = false;
  return {
    get(species, level, variant = 0, shape = 0) {
      if (disposed) throw new Error('tree materials disposed');
      const key = `${species}/${level}/${variant}/${shape}`;
      if (!sets.has(key)) sets.set(key, { leaf: material(species, level, true, variant, shape), wood: material(species, level, false, variant, shape) });
      return sets.get(key);
    },
    dispose() { if (disposed) return; disposed = true; for (const m of owned) m.dispose(); for (const t of [...textures, ...Object.values(details), bark]) t.dispose(); sets.clear(); },
  };
}
