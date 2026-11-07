// W2c-9g: flat kit colors -> shared procedural house surfaces (geometry/lighting unchanged).
import * as THREE from 'three';
import { HOUSE_SURFACE as S, HOUSE_PALETTE, houseTextureRows } from './kamakura-house-texture.js';
export async function createHouseTextures() {
  // W2c-9 parent fix: a setTimeout(0) per row (512 rows, 4 ms clamp) cost ~0.9 s of load; yield only after 8 ms of work.
  const rows = houseTextureRows(); let result, start = performance.now();
  do {
    result = rows.next();
    if (!result.done && performance.now() - start >= 8) { await new Promise(resolve => setTimeout(resolve, 0)); start = performance.now(); }
  } while (!result.done);
  const texture = new THREE.DataTexture(result.value, 512, 512, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter; texture.anisotropy = 4; texture.needsUpdate = true;
  return texture;
}
const paletteGLSL = Object.entries(HOUSE_PALETTE).map(([name,c]) => `const vec3 house_${name} = vec3(${c.map(v=>v.toFixed(4)).join(",")});`).join("\n");
const vertexPars = `varying vec3 vHouseObj; varying vec3 vHouseN; varying vec3 vHouseRandom; varying float vHouseNorth;
#ifdef HOUSE_FACILITY
attribute float houseLocalY;
#endif
float houseHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }`;
const vertexBody = `
vHouseObj = transformed;
#ifdef HOUSE_FACILITY
vHouseObj.y = houseLocalY;
#endif
vHouseN = normalize(objectNormal);
vec2 houseOrigin = modelMatrix[3].xz;
vec3 houseWorldN = mat3(modelMatrix) * objectNormal;
#ifdef USE_INSTANCING
 houseOrigin = (modelMatrix * instanceMatrix[3]).xz;
 houseWorldN = mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal;
#endif
vHouseNorth = max(0.0, -normalize(houseWorldN).z);
vHouseRandom = vec3(houseHash(houseOrigin), houseHash(houseOrigin+vec2(19.0,7.0)), houseHash(houseOrigin+vec2(-11.0,31.0)));`;
const fragmentPars = `
varying vec3 vHouseObj; varying vec3 vHouseN; varying vec3 vHouseRandom; varying float vHouseNorth;
uniform sampler2D houseAtlas;
uniform float houseStrength, houseBump, houseDirt;
uniform vec2 houseRoofBand;
uniform float houseRole;
${paletteGLSL}
vec4 houseTri(vec3 p, vec3 w, float flip) {
 return texture2D(houseAtlas,p.zy)*w.x + texture2D(houseAtlas,mix(p.xz,p.zx,flip))*w.y + texture2D(houseAtlas,p.xy)*w.z;
}`;
const fragmentBody = `
// W2c-9g2: role colors and metre-scale patches persist; only fine detail fades.
float houseFade = houseStrength;
float houseFine = houseStrength * (1.0-smoothstep(${S.near.toFixed(1)},${S.far.toFixed(1)},length(vViewPosition)));
float houseHeight = 0.0;
if (houseFade > 0.0) {
 vec3 hn = normalize(vHouseN), hw = pow(abs(hn),vec3(4.0)); hw /= max(dot(hw,vec3(1.0)),.0001);
 vec3 hp = vHouseObj + vec3(vHouseRandom.y*17.0,0.0,vHouseRandom.z*17.0);
 float stone = step(vHouseObj.y,${S.base.toFixed(1)});
 float roof = (1.0-stone)*step(${S.roof.toFixed(2)},hn.y);
 float board = 1.0-step(${S.wood.toFixed(2)},vHouseRandom.z);
 float tile = 0.0, post = 0.0;
 #ifdef HOUSE_FACILITY
 stone = float(houseRole == 3.0);
 roof = (1.0-stone)*max(float(houseRole == 4.0),step(${S.roof.toFixed(2)},hn.y));
 tile = roof; board = float(houseRole == 1.0); post = float(houseRole == 5.0);
 roof *= 1.0-post;
 #endif
 vec3 roofP = hp; roofP.y *= 1.7;
 float flip = step(abs(hn.z),abs(hn.x))*roof;
 vec4 texel = vec4(.5);
 if (houseFine > 0.0) {
  texel = houseTri(roofP,hw,flip);
  #ifndef HOUSE_LIGHT
   vec3 rotated = vec3(hp.z,hp.y,-hp.x)*.371;
   texel = texel*.78 + houseTri(rotated,hw,flip)*.22;
  #endif
 }
 float surface = mix(mix(texel.b,texel.g,board),texel.r,roof);
 surface = mix(surface,texel.a,stone);
 // Integrate fine lines over pixel footprint as well as the existing distance band.
 float pixelFade = 1.0-smoothstep(.015,.12,max(length(dFdx(hp)),length(dFdy(hp))));
 float detail = (surface-.5)*${S.detail.toFixed(2)}*houseFine*pixelFade;
 float overlap = (1.0-smoothstep(.03,.13,abs(sin(hp.y*22.0))))*tile*houseFine*pixelFade;
 float eave = (1.0-smoothstep(0.0,.38,abs(vHouseObj.y-houseRoofBand.x)))*roof;
 float ridge = smoothstep(houseRoofBand.y-.26,houseRoofBand.y,vHouseObj.y)*roof;
 float broad = ${S.broad.toFixed(2)}*(.65*sin(hp.x*2.1+sin(hp.z*1.7)+hp.y*.9)+.35*sin(hp.y*3.1+hp.z*2.3));
 float mud = (1.0-smoothstep(0.0,1.0,vHouseObj.y))*(1.0-roof);
 float stain = houseDirt*(.17*mud+.23*eave);
 float moss = houseDirt*roof*vHouseNorth*max(0.0,broad)*.35;
 vec3 target = mix(house_plaster,house_wood,board);
 target = mix(target,mix(house_roof,house_oldRoof,vHouseRandom.x),roof);
 target = mix(target,house_stone,stone); target = mix(target,house_tile,tile);
 target = mix(target,house_post,post);
 vec3 hc = mix(diffuseColor.rgb,target,.78);
 float brightness = 1.0+(vHouseRandom.x*2.0-1.0)*${S.brightness.toFixed(2)};
 vec3 tone = vec3(brightness*(1.0+broad-stain+.10*ridge)) + moss*vec3(-.4,.12,-.3);
 diffuseColor.rgb = mix(diffuseColor.rgb,hc*tone,houseFade)+hc*(detail-.15*overlap);
 houseHeight = detail;
}`;
// Clone once per source material/kind, share across every chunk, part and LOD.
export function createHouseMaterial(base, { texture, quality = 'standard', eave = 3, top = 4, facilityRole = null } = {}) {
  const material = base.clone(), previous = base.onBeforeCompile.bind(base);
  const uniforms = { houseAtlas: { value: texture }, houseStrength: { value: quality === 'light' ? .7 : 1 },
    houseBump: { value: 1 }, houseDirt: { value: quality === 'light' ? 0 : 1 }, houseRole: { value: facilityRole ?? -1 }, houseRoofBand: { value: new THREE.Vector2(eave,top) } };
  material.userData.houseUniforms = uniforms;
  if (facilityRole !== null) material.defines = { ...material.defines, HOUSE_FACILITY: 1 };
  if (quality === 'light') material.defines = { ...material.defines, HOUSE_LIGHT: 1 };
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer); Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n'+vertexPars)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n'+vertexBody);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n'+fragmentPars)
      .replace('#include <color_fragment>', '#include <color_fragment>\n'+fragmentBody)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      // Screen-space height gradient: two derivatives, no extra texture fetches.
      if (houseBump > 0.0 && houseFine > 0.0) {
        vec3 hx = dFdx(-vViewPosition), hy = dFdy(-vViewPosition);
        vec3 hr1 = cross(hy,normal), hr2 = cross(normal,hx);
        float hd = dot(hx,hr1);
        vec3 hg = sign(hd)*(dFdx(houseHeight)*hr1+dFdy(houseHeight)*hr2);
        normal = normalize(max(abs(hd),.0000001)*normal-hg*.11);
      }`);
  };
  material.customProgramCacheKey = () => `house-9g2-${facilityRole}-${quality}-${base.customProgramCacheKey()}`;
  material.userData.setHouseAdapt = step => {
    uniforms.houseStrength.value = step >= 3 ? 0 : quality === 'light' ? .7 : 1;
    uniforms.houseBump.value = step >= 2 ? 0 : 1;
  };
  return material;
}
