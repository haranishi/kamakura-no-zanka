// W2c-9g: flat kit colors -> shared procedural house surfaces (geometry/lighting unchanged).
import * as THREE from 'three';
import { HOUSE_SURFACE as S, HOUSE_PALETTE, houseTextureRows, facilityPreservesPigment, facilityInterior, HOUSE_RELIEF as R } from './kamakura-house-texture.js';
// W2c-9p: houses/facilities reuse immutable CPU pixels; each owner retains its own
// DataTexture and disposal. Generation still yields after at most one 8ms slice.
const atlasPixels = new Map();
async function generateAtlas(size) {
  const rows=houseTextureRows(size);let result,start=performance.now();
  do {
    result=rows.next();
    if(!result.done && performance.now()-start>=8){await new Promise(resolve=>setTimeout(resolve,0));start=performance.now();}
  } while(!result.done);
  return result.value;
}
async function atlas(size) {
  if(!atlasPixels.has(size))atlasPixels.set(size,generateAtlas(size).catch(error=>{atlasPixels.delete(size);throw error;}));
  const texture = new THREE.DataTexture(await atlasPixels.get(size), size, size, THREE.RGBAFormat);
  texture.internalFormat = 'RGBA8'; // W2c-9r2 facility: explicit mip-capable storage.
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter; texture.anisotropy = 4; texture.needsUpdate = true;
  return texture;
}
// W2c-9r1 house: allocate final sizes before upload; adaptation only swaps the sampler.
export async function createHouseTextures({quality='standard',parts=false} = {}) {
  const texture=await atlas(parts && quality==='light'?128:512);
  if(parts && quality!=='light') {
    const small=await atlas(128);texture.userData.houseSmall=small;
    texture.addEventListener('dispose',()=>small.dispose());
  }
  return texture;
}
const paletteGLSL = Object.entries(HOUSE_PALETTE).map(([name,c]) => `const vec3 house_${name} = vec3(${c.map(v=>v.toFixed(4)).join(",")});`).join("\n");
const vertexPars = `varying vec3 vHouseObj; varying vec3 vHouseN; varying vec3 vHouseRandom; varying float vHouseNorth;
#ifdef HOUSE_FACILITY
attribute float houseLocalY;
attribute float houseTimber;
varying float vHouseTimber;
#endif
varying vec3 vHouseRoofP; varying vec3 vHouseRoofN;
float houseHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }`;
const vertexBody = `
vHouseObj = transformed;
#ifdef HOUSE_FACILITY
vHouseObj.y = houseLocalY;
vHouseTimber = houseTimber;
#endif
vHouseN = normalize(objectNormal);
vHouseRoofP = vHouseObj; vHouseRoofN = vHouseN;
#ifdef USE_INSTANCING
 // R3: local orientation with metre density even when an instance is enlarged.
 vec3 houseScale=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
 vHouseRoofP *= houseScale; vHouseRoofN=normalize(objectNormal/houseScale);
#endif
vec2 houseOrigin = modelMatrix[3].xz;
vec3 houseWorldN = mat3(modelMatrix) * objectNormal;
#ifdef USE_INSTANCING
 houseOrigin = (modelMatrix * instanceMatrix[3]).xz;
 houseWorldN = mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal;
#endif
vHouseNorth = max(0.0, -normalize(houseWorldN).z);
vHouseRandom = vec3(houseHash(houseOrigin), houseHash(houseOrigin+vec2(19.0,7.0)), houseHash(houseOrigin+vec2(-11.0,31.0)));
#if defined(HOUSE_PARTS) && defined(USE_INSTANCING_COLOR)
 vHouseRandom = instanceColor;
#endif`;
const fragmentPars = `
varying vec3 vHouseObj; varying vec3 vHouseN; varying vec3 vHouseRandom; varying float vHouseNorth;
varying vec3 vHouseRoofP; varying vec3 vHouseRoofN;
#ifdef HOUSE_FACILITY
varying float vHouseTimber;
#endif
uniform float houseRelief, houseInterior;
uniform sampler2D houseAtlas;
uniform float houseStrength, houseBump, houseDirt;
uniform vec2 houseRoofBand;
uniform float houseRole, houseDetail, houseKeepPigment;
uniform vec3 houseFrame;
${paletteGLSL}
float houseHash(vec2 p) { return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }

vec4 houseTri(vec3 p, vec3 w, float flip) {
 return texture2D(houseAtlas,p.zy)*w.x + texture2D(houseAtlas,mix(p.xz,p.zx,flip))*w.y + texture2D(houseAtlas,p.xy)*w.z;
}`;
const fragmentBody = `
// W2c-9g2: role colors and metre-scale patches persist; only fine detail fades.
float houseFade = houseStrength;
float houseFine = houseDetail * houseStrength * (1.0-smoothstep(${S.near.toFixed(1)},${S.far.toFixed(1)},length(vViewPosition)));
float houseHeight = 0.0;
vec3 houseInteriorFill = vec3(0.0);
if (houseFade > 0.0) {
 vec3 hn = normalize(vHouseN), hw = pow(abs(hn),vec3(4.0)); hw /= max(dot(hw,vec3(1.0)),.0001);
 vec3 hp = vHouseObj + vec3(vHouseRandom.y*17.0,0.0,vHouseRandom.z*17.0);
 float stone = step(vHouseObj.y,${S.base.toFixed(1)});
 float roof = (1.0-stone)*step(${S.roof.toFixed(2)},hn.y);
 float board = 1.0-step(${S.wood.toFixed(2)},vHouseRandom.z);
 #ifdef HOUSE_PARTS
 // W2c-9r2 facility: abrupt yellow/wood join -> weathered transition at the eave.
 roof=(1.0-stone)*max(smoothstep(.28,.58,hn.y),smoothstep(houseRoofBand.x-.55,houseRoofBand.x+.55,vHouseObj.y));
 #else
 roof=max(roof,(1.0-stone)*step(houseRoofBand.x-.12,vHouseObj.y));
 #endif
 float tile = 0.0, post = 0.0;
 #ifdef HOUSE_FACILITY
 stone = float(houseRole == 3.0);
 roof = (1.0-stone)*max(float(houseRole == 4.0),step(${S.roof.toFixed(2)},hn.y));
 tile = roof; board = float(houseRole == 1.0); post = float(houseRole == 5.0);
 #ifdef HOUSE_PARTS
 // W2c-9r3 facility: actual slender connected members, never a painted wall grid.
 post=max(post,float(houseRole==2.0)*vHouseTimber*houseRelief);
 #endif
 roof *= 1.0-post;
 #ifdef HOUSE_PARTS
 // Frame band uses each node's actual height, never the default 3m eave.
 float floorY=houseFrame.x;
 // W2c-9r2 facility: painted-on grid/dashes -> uninterrupted plaster.
 stone=max(stone,float(houseRole==2.0)*step(vHouseObj.y,floorY+.4));
 roof=(1.0-stone)*(1.0-post)*roof;
 if(houseRole==6.0 || houseRole==7.0 || houseRole==8.0){stone=0.0;roof=0.0;tile=0.0;post=0.0;}
 #endif
 #endif
 // W2c-9g3: metre dimensions, long smooth warp; avoid rotated board/straw grids.
 vec3 roofP = hp;
 roofP.x += .045*sin(hp.z*.19+sin(hp.x*.13));
 roofP.z += .045*sin(hp.x*.17+sin(hp.z*.11));
 roofP /= 8.0;
 float flip = step(abs(hn.z),abs(hn.x))*roof;
 vec4 texel = vec4(.5);
 if (houseFine > 0.0) {
  texel = houseTri(roofP,hw,flip);
  #ifndef HOUSE_LIGHT
   vec3 rotated = vec3(hp.z,hp.y,-hp.x)*.371;
   vec4 low = houseTri(rotated/8.0,hw,flip);
   texel.b = texel.b*.6+low.b*.4;
  #endif
 }
 // W2c-9r2 facility: all thatch uses coarse straw rather than board seams.
 float roofSurface=texel.r;
 #ifdef HOUSE_PARTS
 roofSurface=texel.r; // R2 thatch never borrows the fine board seams.
 #ifndef HOUSE_FACILITY
 // W2c-9r3 facility: stretched horizontal atlas bands -> slope-aligned dry straw.
 vec3 rn=normalize(vHouseRoofN);
 vec3 down=vec3(0.0,1.0,0.0)-rn*rn.y;
 down=length(down)>.05?normalize(down):vec3(0.0,0.0,1.0);
 vec3 across=normalize(cross(down,rn));
 vec2 strawUV=vec2(dot(vHouseRoofP,across),dot(vHouseRoofP,down));
 strawUV.x+=vHouseRandom.y*17.0;
 float su=strawUV.x+.012*sin(strawUV.y*1.7+sin(strawUV.x*.71));
 float sf=su*${(2*Math.PI/R.straw).toFixed(8)}+.5*sin(strawUV.x*2.3);
 float sc=su*${(2*Math.PI/R.bundle).toFixed(8)}+sin(strawUV.y*.63);
 // Analytic footprint integration tends to the mean without a distance-only seam.
 float strawDetail=${R.fine}*sin(sf)*exp(-.5*pow(fwidth(sf),2.0))+${R.coarse}*sin(sc)*exp(-.5*pow(fwidth(sc),2.0));
 roofSurface=mix(roofSurface,.5+strawDetail,houseRelief);
 #endif
 #endif
 float surface = mix(mix(texel.b,texel.g,board),roofSurface,roof);
 surface = mix(surface,texel.a,stone);
 // Integrate fine lines over pixel footprint as well as the existing distance band.
 float pixelFade = 1.0-smoothstep(.015,.12,max(length(dFdx(hp)),length(dFdy(hp))));
 #if defined(HOUSE_PARTS) && defined(HOUSE_FACILITY)
 // Plaster is smooth; irregular stone channel has weak relief, no black joints.
 surface=mix(surface,.5,float(houseRole==2.0)*(1.0-roof)*(1.0-stone));
 if(houseRole==3.0)surface=mix(.5,texel.a,.28);
 // R3: irregular atlas joints remain weak, but readable on light lime walls.
 if(houseRole==8.0)surface=mix(.5,texel.a,mix(.20,1.15,houseRelief));
 #endif
 // Straw has its own footprint integration; the old .12m cutoff erased readable bundles.
 #if defined(HOUSE_PARTS) && !defined(HOUSE_FACILITY)
 pixelFade=mix(pixelFade,1.0,roof*houseRelief);
 #endif
 float detail = (surface-.5)*${S.detail.toFixed(2)}*houseFine*pixelFade;
 float overlap = (1.0-smoothstep(.03,.13,abs(sin(hp.y*22.0))))*tile*houseFine*pixelFade;
 float eave = (1.0-smoothstep(0.0,.38,abs(vHouseObj.y-houseRoofBand.x)))*roof;
 float ridge = smoothstep(houseRoofBand.y-.26,houseRoofBand.y,vHouseObj.y)*roof;
 float broad = ${S.broad.toFixed(2)}*(.65*sin(hp.x*2.1+sin(hp.z*1.7)+hp.y*.9)+.35*sin(hp.y*3.1+hp.z*2.3));
 float mud = (1.0-smoothstep(0.0,1.0,vHouseObj.y))*(1.0-roof);
 float underEave=(1.0-roof)*(1.0-smoothstep(0.0,.65,abs(vHouseObj.y-houseRoofBand.x)));
 float rain=pow(.5+.5*sin(hp.x*7.3+sin(hp.z*2.7)),8.0)*(1.0-roof)*smoothstep(0.0,1.0,vHouseObj.y);
 #ifdef HOUSE_PARTS
 float relativeY=vHouseObj.y-houseFrame.x;
 mud=(1.0-smoothstep(0.0,1.8,relativeY))*(1.0-roof)*(1.0-abs(hn.y)*.6);
 underEave=(1.0-roof)*(1.0-smoothstep(0.0,.9,abs(vHouseObj.y-houseRoofBand.x)))*(1.0-abs(hn.y)*.6);
 #endif
 float stain = houseDirt*(.17*mud+.23*eave+.15*underEave+.09*rain);
 #ifdef HOUSE_PARTS
 stain += houseDirt*(.18+.22*vHouseRandom.z)*(1.0-smoothstep(0.0,.45,vHouseObj.y-houseFrame.x))*(1.0-roof);
 stain *= .7+.6*vHouseRandom.z;
 #ifdef HOUSE_FACILITY
 // Only soil contact and eaves collect visible wall dirt; no full-height rain dashes.
 stain=houseDirt*(.08*mud+.10*underEave+.12*eave);
 #endif
 #endif
 float moss = houseDirt*roof*vHouseNorth*max(0.0,broad)*.35;
 vec3 target = mix(mix(house_earth,house_oldEarth,vHouseRandom.x),mix(house_wood,house_oldWood,vHouseRandom.y),board);
 #ifdef HOUSE_FACILITY
 target = mix(house_plaster,house_wood,board);
 #endif
 target = mix(target,mix(house_roof,house_oldRoof,vHouseRandom.x),roof);
 target = mix(target,mix(house_stone,house_oldStone,vHouseRandom.y),stone); target = mix(target,house_tile,tile);
 target = mix(target,house_post,post);
 #ifdef HOUSE_PARTS
 #ifndef HOUSE_FACILITY
 target=mix(target,mix(house_thatch,house_oldThatch,vHouseRandom.x),roof);
 #else
 if(houseRole==2.0)target=mix(target,mix(house_lime,house_oldLime,vHouseRandom.x*.3),(1.0-roof)*(1.0-stone)*(1.0-post));
 if(houseRole==8.0)target=mix(house_lime,house_oldLime,vHouseRandom.x*.3);
 #endif
 #endif
 vec3 hc = mix(diffuseColor.rgb,target,.65);
 #ifdef HOUSE_PARTS
 hc=mix(diffuseColor.rgb,target,.92);
 #endif
 float brightness = 1.0+(vHouseRandom.x*2.0-1.0)*${S.brightness.toFixed(2)};
 vec3 tone = vec3(brightness*(1.0+broad-stain+.10*ridge)) + moss*vec3(-.4,.12,-.3);
 float angle=(vHouseRandom.y*2.0-1.0)*${S.hue.toFixed(6)};
 vec3 axis=normalize(vec3(1.0)); hc=hc*cos(angle)+cross(axis,hc)*sin(angle)+axis*dot(axis,hc)*(1.0-cos(angle));
 float high=max(max(diffuseColor.r,diffuseColor.g),diffuseColor.b), low=min(min(diffuseColor.r,diffuseColor.g),diffuseColor.b);
 bool painted=high-low>high*.35 || high<.025;
 #ifdef HOUSE_FACILITY
 painted=painted || houseRole==0.0;
 #endif
 vec3 aged=min(vec3(.45),max(vec3(0.0),hc*(tone+detail-.15*overlap)));
 #ifdef HOUSE_PARTS
 // Earth/wood are not painted accents. Unknown architectural parts get a role above.
 painted=false;
 #ifdef HOUSE_FACILITY
 painted=houseKeepPigment>0.0;
 if(houseRole==6.0){
   float patina=clamp(.5+broad*1.8+.15*hn.y+.13*sin(vHouseObj.y*.7)+detail,0.0,1.0);
   aged=mix(vec3(.065,.047,.027),vec3(.075,.12,.068),patina);
   aged*=1.0-stain*.6;
 }
 #endif
 #endif
 if(painted) aged=diffuseColor.rgb*clamp(1.0+broad*.35-stain+detail*.25,.65,1.0);
 #if defined(HOUSE_PARTS) && defined(HOUSE_FACILITY)
 // W2c-9r2 facility: source vermilion / dark interior -> scalar aging only.
 if(houseKeepPigment>0.0)aged=diffuseColor.rgb*clamp(1.0+broad*.18-stain+detail*.10,.78,1.0);
 // W2c-9r3 facility: flat dark source -> bounded vertical recess, beam shadow, back boards.
 if(houseInterior>0.0 && houseRelief>0.0){
   float iy=clamp((vHouseObj.y-houseFrame.x)/max(.1,houseRoofBand.y-houseFrame.x),0.0,1.0);
   float ix=abs(hn.z)>abs(hn.x)?vHouseObj.x:vHouseObj.z;
   float ib=exp(-pow((iy-.78)/.045,2.0));
   float ip=houseHash(vec2(floor(ix/.32),17.0))-.5;
   float it=clamp(.041-.027*iy-.008*ib+.006*ip,${R.interiorMin},${R.interiorMax});
   vec3 recess=it*vec3(1.06,.99,.89);
   aged=mix(aged,recess,houseRelief);
   // Neutral tone mapping compresses low radiance quadratically. A local fill floor
   // keeps the darkest recess above black even without direct illumination.
   houseInteriorFill=(recess*.65+vec3(.031))*houseRelief*houseFade;
 }

 #endif
 vec3 mixed=mix(diffuseColor.rgb,aged,houseFade);
 diffuseColor.rgb=painted?mixed:min(vec3(.45),mixed);
 houseHeight = detail;
}`;
// Clone once per source material/kind, share across every chunk, part and LOD.
export function createHouseMaterial(base, { texture, quality = 'standard', eave = 3, top = 4, facilityRole = null, parts = false, floor = 0, relief = true } = {}) {
  const material = base.clone(), previous = base.onBeforeCompile.bind(base);
  // W2c-9r2 facility: plastic roof response -> dry diffuse thatch.
  if(parts && facilityRole===null){material.roughness=1;material.metalness=0;}
  const keepPigment=facilityRole!==null && facilityPreservesPigment([base.color.r,base.color.g,base.color.b],facilityRole);
  const uniforms = { houseRelief: {value:parts&&relief?(quality==='light'?.7:1):0}, houseInterior: {value:facilityRole!==null && facilityInterior([base.color.r,base.color.g,base.color.b],facilityRole)?1:0}, houseKeepPigment: {value:keepPigment?1:0}, houseAtlas: { value: texture }, houseStrength: { value: quality === 'light' ? .7 : 1 },
    houseDetail: { value: 1 }, houseFrame: { value: new THREE.Vector3(floor,0,0) }, houseBump: { value: 1 }, houseDirt: { value: quality === 'light' ? 0 : 1 }, houseRole: { value: facilityRole ?? -1 }, houseRoofBand: { value: new THREE.Vector2(eave,top) } };
  material.userData.houseUniforms = uniforms;
  if(parts)material.defines={...material.defines,HOUSE_PARTS:1};
  if (facilityRole !== null) material.defines = { ...material.defines, HOUSE_FACILITY: 1 };
  if (quality === 'light') material.defines = { ...material.defines, HOUSE_LIGHT: 1 };
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer); Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n'+vertexPars)
      .replace('#include <color_vertex>', parts ? THREE.ShaderChunk.color_vertex.replace('vColor.xyz *= instanceColor.xyz;', '// Instance RGB carries the placement seed, not a color multiplier.') : '#include <color_vertex>')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n'+vertexBody);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n'+fragmentPars)
      .replace('#include <color_fragment>', '#include <color_fragment>\n'+fragmentBody)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += houseInteriorFill;')
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
  material.customProgramCacheKey = () => `house-r3-${parts}-${facilityRole}-${quality}-${base.customProgramCacheKey()}`;
  material.userData.setHouseAdapt = step => {
    uniforms.houseStrength.value = step >= 3 ? 0 : quality === 'light' ? .7 : 1;
    uniforms.houseBump.value = step >= 2 ? 0 : 1;
    uniforms.houseRelief.value = parts && relief ? (step >= 3 ? 0 : step >= 2 ? .55 : quality==='light' ? .7 : 1) : 0;
    uniforms.houseDetail.value = step >= 3 ? 0 : step >= 2 ? .55 : 1;
    uniforms.houseAtlas.value = parts && step >= 2 ? texture?.userData.houseSmall ?? texture : texture;
  };
  return material;
}
