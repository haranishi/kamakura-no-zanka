// Lambert specimen materials. Only the color pass receives the quality-specific LOD fade.
import * as THREE from 'three';
import { TREES } from './config.js';
import { needleTexture, needleFringeTexture, mapleLeafTexture, zelkovaLeafTexture } from './tree-textures.js';
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
export function treeMaterials({ wind, sunDir, quality = 'standard' }) {
  const textures = [needleTexture(), zelkovaLeafTexture(), mapleLeafTexture(), needleFringeTexture()], owned = [], sets = new Map();
  const means = textures.map(meanColor);
  const sun = { value: sunDir }, disabled = () => ({ value: new THREE.Vector4(-1, -1, -1, -1) });
  function material(species, level, leaf, variant, shape) {
    const conifer = species === 0 || species === 2;
    const map = !leaf || level === 2 ? null : textures[conifer ? (species === 2 || level === 0 ? 0 : 3) : species === 3 || species === 4 && variant === 1 ? 2 : 1];
    const m = new THREE.MeshLambertMaterial({ map, vertexColors: true, side: leaf ? THREE.DoubleSide : THREE.FrontSide,
      alphaTest: map ? .3 : 0, alphaToCoverage: quality !== 'light', emissive: 0x000000 });
    if (leaf && level === 2) m.color.copy(means[conifer ? 0 : species === 3 ? 2 : 1]);
    // Far broadleaf keeps the near gain so the dissolve band has no brightness step; conifers have none.
    if (leaf && !conifer) m.color.multiplyScalar(species >= 4 ? TREES.understoryLeafGain : TREES.leafGain);
    const fadeMode = quality === 'light' ? 'dither' : 'coverage';
    const lod = disabled(); m.userData.uLod = lod;
    m.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, wind, { uSunDir: sun, uLod: lod });
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        attribute float aSway;
        uniform float uTime; uniform float uWind; uniform vec2 uWindDir; uniform float uGuideMix;
        uniform vec4 uLod;
        varying vec3 vTreeWorld; varying float vTreeDistance; varying float vTreeWeight;
        float treeNoise(vec2 p) {
          vec2 a=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(sin(dot(a,vec2(12.9898,78.233))),sin(dot(a+vec2(1,0),vec2(12.9898,78.233))),f.x),
            mix(sin(dot(a+vec2(0,1),vec2(12.9898,78.233))),sin(dot(a+vec2(1,1),vec2(12.9898,78.233))),f.x),f.y);
        }`).replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 treeOrigin = vec3(0.0);
        #ifdef USE_INSTANCING
          treeOrigin = instanceMatrix[3].xyz;
        #endif
        treeOrigin = (modelMatrix*vec4(treeOrigin,1.0)).xyz;
        ${species === 0 ? `// Position-stable cedar profile, shared by foliage and wood before wind.
        float ph1 = fract(sin(dot(treeOrigin.xz,vec2(12.9898,78.233)))*43758.5453)*6.283185;
        float ph2 = fract(sin(dot(treeOrigin.xz,vec2(39.346,11.135)))*24634.6345)*6.283185;
        float prof = 1.0 + ${[.06,.12,.16][level].toFixed(2)} * (0.6*sin(ph1 + position.y*0.55) + 0.4*sin(ph2 + position.y*1.3));
        transformed.xz *= prof;` : ''}
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
        varying vec3 vTreeWorld; varying float vTreeDistance; varying float vTreeWeight;`)
        .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
        ${fadeMode === 'coverage' ? 'diffuseColor.a *= vTreeWeight;' : `float n = fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
        if (n >= vTreeWeight) discard;`}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // diffuseColor includes map, exposure vertex color and instanceColor (color_fragment).
        totalEmissiveRadiance += diffuseColor.rgb*${leaf ? '.24' : '.10'};
        ${leaf ? `vec3 sight = normalize(vTreeWorld-cameraPosition);
        float backlight = pow(max(0.0,dot(sight,normalize(uSunDir))),3.0);
        backlight *= 1.0-smoothstep(30.0,100.0,vTreeDistance);
        totalEmissiveRadiance += min(vec3(.35),diffuseColor.rgb*vec3(1.0,.82,.52)*backlight*${conifer ? '.2' : '1.0'});` : ''}`);
    };
    m.customProgramCacheKey = () => `tree-specimen-v1-${species}-${level}-${leaf}-${variant}-${shape}-${quality}-${fadeMode}`;
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
    dispose() { if (disposed) return; disposed = true; for (const m of owned) m.dispose(); for (const t of textures) t.dispose(); sets.clear(); },
  };
}
