import { adaptPolicy } from './kamakura-adapt.js';
import { vegPolicy } from './kamakura-veg.js';
import { STAND_COLOR } from './kamakura-stands.js';
import { createFarGroundField } from './kamakura-ground-density.js';
import { smooth } from './kamakura-ground-pattern.js';
import { groundContactFor } from './kamakura-ground-contact.js';
import { groundPathFor } from './kamakura-ground-path.js';
import { toneChannel } from './kamakura-ground-tone-rules.js';

// W2c-18 G1–G5: all new visual/bake controls live here. Distances include camera height.
export const GROUND_FAR = Object.freeze({
  fadeFrom: 250, // m: preserve all walking detail up to this slant distance.
  fadeTo: 700, // m: remove procedural patches completely here.
  airFrom: 12, airTo: 70, airKeep: .3, // m / m / fraction: the 43 m relief noise was tuned at eye height (grazing views flatten it).
  // Parent (real Chrome, 60–150 m up): seen from above it swung the plain between 15% and 185% of its colour and read as dark stains.
  // Height of the eye above the ground point scales it down to airKeep.
  canopyBand: 100, // m: transition after vegPolicy(quality).range.
  densityFrom: .25, // fraction: no canopy tint below this coverage.
  densityTo: .6, // fraction: full canopy tint above this coverage.
  canopyMix: .9, // fraction: maximum replacement by the canopy mean.
  standLightGain: 1.1, // existing stand palette lighting calibration, before linear decoding.
  canopyShade: 1.05, // linear gain relative to the stand palette. Far crowns are now about twice that palette (STANDS2.gain), so this is
  // roughly half a sunlit crown: the shade between crowns nearby, and a believable average where only the ground carries the forest.
  crownMeters: 7, // m: world-anchored crown cell size.
  crownContrast: .18, // gain: symmetric sun-facing crown relief.
  crownFilterFrom: .35, // crown widths per pixel: begin removing unresolved relief.
  crownFilterTo: 1, // crown widths per pixel: return the exact mean.
  rockNormalFrom: .55, // normal Y: cliffs have no canopy.
  rockNormalTo: .72, // normal Y: canopy fully allowed on gentler slopes.
  texelMeters: 24, // m: maximum field texel width (all quality levels).
  maxSize: 512, // texels per edge: the packed R8 atlas with all mips stays below 2 MB.
  densitySaturation: .65, // cover/area: Poisson coverage saturation, matching slope7.
  roadFilter: 2, // texel widths: prefilter support prevents gaps along diagonals.
  roadGain: 1.22, // linear gain: packed-earth road relative to town soil.
  soilGain: 1.08, // linear gain: same packed-earth baseline as the existing yard.
  soilLift: .008, // linear light: same neutral lift as the existing yard.
  bankMargin: 6, // m: preserve river banks as well as the channel.
  fineFadeStart: .8, // fraction of the grain range where distance fading starts.
  fineDistance: 5000, // m: maximum standard crown-grain distance.
  lightDistance: 3000, // m: maximum light crown-grain distance.
  adaptDistance: .7, // multiplier: shorten grain range at adaptation step 1.
  sliceMs: 1.5, // ms: shared-style deferred preparation budget.
  sliceWork: 64, // field operations between clock checks.
  debugCanopy: Object.freeze([1, 0, 1]), // diagnostic RGB: canopy replacement weight.
  debugRoad: Object.freeze([1, 1, 0]), // diagnostic RGB: filtered road coverage.
  debugTone: Object.freeze([0, 1, 1]) // diagnostic RGB: remaining patch amplitude.
});
const C = GROUND_FAR;
export const groundFarEnabled = search => new URLSearchParams(search).get('gfar') !== '0';
export const groundFarToneWeight = d => 1 - smooth(C.fadeFrom, C.fadeTo, d);
export function groundFarChannel(base, channel, relief, steep, grass, use, dist, enabled = true) {
  const w = enabled ? groundFarToneWeight(dist) : 1;
  return toneChannel(base, channel, relief * w, steep, grass * w, use);
}
export const groundFarCanopy = (density, dist, normalY = 1, code = 3, quality = 'standard') =>
  code === 0 || code === 1 || code === 5 ? 0 : C.canopyMix * smooth(C.densityFrom, C.densityTo, density) *
    smooth(vegPolicy(quality).range, vegPolicy(quality).range + C.canopyBand, dist) * smooth(C.rockNormalFrom, C.rockNormalTo, normalY);
export const groundFarCrownFade = pixel => 1 - smooth(C.crownMeters * C.crownFilterFrom, C.crownMeters * C.crownFilterTo, pixel);
// Exact box-filtered line coverage. Wider footprints conserve width * opacity.
export function groundFarRoadCoverage(distance, width, pixel) {
  const half = width / 2, footprint = Math.max(pixel, Number.EPSILON);
  return Math.max(0, Math.min(half, distance + footprint / 2) - Math.max(-half, distance - footprint / 2)) / footprint;
}
const linear = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
// STAND_COLOR is the existing calibrated conifer/broadleaf palette, not a new colour table.
export const groundFarCanopyColor = () => [0, 1, 2].map(k => C.canopyShade * STAND_COLOR.reduce((s, rgb) => s + linear(rgb[k] / C.standLightGain / 255), 0) / STAND_COLOR.length);
const gl = n => Number.isInteger(n) ? `${n}.0` : String(n);
export const GROUND_FAR_GLSL = `
uniform sampler2D uGroundFarField;
uniform vec2 uGroundFarSpan,uGroundFarCanopyRange;
uniform vec3 uGroundFarCanopyColor,uGroundFarSoil;
uniform float uGroundFarReady,uGroundFarFine,uGroundFarDebug,uGroundFarFineDistance;
vec3 groundFarDebugColor=vec3(0.0);
float groundFarToneWeight(float d){return 1.0-smoothstep(${gl(C.fadeFrom)},${gl(C.fadeTo)},d);}
vec3 groundFarColor(vec3 color,vec3 world,float ny,float dist){
  // Coherent early return: walking fragments do no field, surface or grain work.
  float remaining=groundFarToneWeight(dist);
  groundFarDebugColor=vec3(${C.debugTone.map(gl)})*remaining;
  if(dist<=${gl(C.fadeFrom)})return color;
  if(uGroundFarReady<=0.0)return color;
  vec2 p=world.xz,uv=p/uGroundFarSpan+.5;
  vec2 dx=dFdx(uv),dy=dFdy(uv);
  float pixel=length(fwidth(p));
  vec4 field=textureGrad(uGroundFarField,uv,dx,dy);
  float code=floor(texture2D(uGroundSurface,p/(uGroundGrid.z*uGroundGrid.xy)+.5).r*255.0+.5);
  if(code==0.0 || code==1.0 || field.b>0.0)return color;
  float travel=1.0-remaining;
  float canopy=${gl(C.canopyMix)}*smoothstep(${gl(C.densityFrom)},${gl(C.densityTo)},field.r)
    *smoothstep(uGroundFarCanopyRange.x,uGroundFarCanopyRange.y,dist)*smoothstep(${gl(C.rockNormalFrom)},${gl(C.rockNormalTo)},ny);
  if(code==5.0)canopy=0.0;
  float soil=code==4.0?travel*smoothstep(${gl(C.rockNormalFrom)},${gl(C.rockNormalTo)},ny):0.0;
  color=mix(color,uGroundFarSoil,soil*(1.0-canopy));
  float grainFade=(1.0-smoothstep(${gl(C.crownMeters*C.crownFilterFrom)},${gl(C.crownMeters*C.crownFilterTo)},pixel))*uGroundFarFine;
  grainFade*=1.0-smoothstep(uGroundFarFineDistance*${gl(C.fineFadeStart)},uGroundFarFineDistance,dist);
  float grain=0.0;
  if(canopy*grainFade>0.0){
    vec2 q=fract(p/${gl(C.crownMeters)})*2.0-1.0;
    float radius=dot(q,q),dome=sqrt(max(0.0,1.0-radius));
    vec3 sun=vec3(0.0,1.0,0.0);
    #if NUM_DIR_LIGHTS > 0
      vec3 sunView=directionalLights[0].direction;
      sun=vec3(dot(viewMatrix[0].xyz,sunView),dot(viewMatrix[1].xyz,sunView),dot(viewMatrix[2].xyz,sunView));
    #endif
    // Odd about each crown centre, hence zero mean; no brightness jump at the filter cutoff.
    grain=dot(q,sun.xz)*dome*${gl(C.crownContrast)}*grainFade;
  }
  color=mix(color,uGroundFarCanopyColor*(1.0+grain),canopy);
  float road=field.g*travel;
  if(code==5.0)road=0.0;
  color=mix(color,uGroundFarSoil*${gl(C.roadGain)},road);
  groundFarDebugColor=mix(groundFarDebugColor,vec3(${C.debugCanopy.map(gl)})*canopy,step(.00001,canopy));
  groundFarDebugColor=mix(groundFarDebugColor,vec3(${C.debugRoad.map(gl)}),road);
  return color;
}
`;

// Alter only the enabled variant: the opt-out retains the original text, resources and calls.
export function groundFarToneGLSL(source) {
  return source
    .replace('relief*=1.0-smoothstep(1500.0,5000.0,dist);', `if(dist>${gl(C.fadeFrom)})relief*=groundFarToneWeight(dist);\n  relief*=mix(1.0,${gl(C.airKeep)},smoothstep(${gl(C.airFrom)},${gl(C.airTo)},cameraPosition.y-world.y));`)
    .replace('float distantGrass=grass*grassTintAt(p.x,p.y,dist);', `float distantGrass=grass*grassTintAt(p.x,p.y,dist);\n  if(dist>${gl(C.fadeFrom)})distantGrass*=groundFarToneWeight(dist);`)
    .replace('float r3=uToneR3*(1.0-smoothstep(400.0,1500.0,noisyDist));', `float r3=uToneR3*(1.0-smoothstep(400.0,1500.0,noisyDist));\n  if(dist>${gl(C.fadeFrom)})r3*=groundFarToneWeight(dist);`)
    .replace('result*=groundGrassDetail(p,dist,weights.r*smoothstep(.45,.85,normalY));', `if(dist>${gl(C.fadeFrom)})result*=mix(vec3(1.0),groundGrassDetail(p,dist,weights.r*smoothstep(.45,.85,normalY)),groundFarToneWeight(dist));\n  else result*=groundGrassDetail(p,dist,weights.r*smoothstep(.45,.85,normalY));`)
    .replace('(macro-.5)*.05*weights.g', '(macro-.5)*.05*weights.g*groundFarToneWeight(dist)');
}

export function installGroundFar(THREE, material, data, owner, { quality = 'standard', search = '' } = {}) {
  if(!groundFarEnabled(search))return;
  const field=createFarGroundField(data,C,groundFarRoadCoverage),contact=groundContactFor(data);
  const packed=contact?packGroundFarContact(THREE,contact,groundPathFor(data),field):null;
  const texture=packed?.texture||new THREE.DataTexture(field.bytes,field.size,field.size,THREE.RGBAFormat);
  texture.internalFormat=packed?'R8':'RGBA8';texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
  texture.generateMipmaps=true;texture.unpackAlignment=1;texture.needsUpdate=true;
  const range=vegPolicy(quality).range;
  const uniforms={uGroundFarField:{value:texture},uGroundFarSpan:{value:new THREE.Vector2(field.spanX,field.spanZ)},
    uGroundFarCanopyRange:{value:new THREE.Vector2(range,range+C.canopyBand)},uGroundFarCanopyColor:{value:new THREE.Vector3(...groundFarCanopyColor())},
    uGroundFarSoil:{value:new THREE.Vector3()},uGroundFarReady:{value:0},uGroundFarFine:{value:quality==='light'?0:1},
    uGroundFarDebug:{value:new URLSearchParams(search).get('gfardebug')==='1'?1:0},uGroundFarFineDistance:{value:quality==='light'?C.lightDistance:C.fineDistance}};
  if(packed){delete uniforms.uGroundFarField;Object.assign(uniforms,packed.uniforms);}
  Object.assign(owner.uniforms,uniforms);
  let disposed=false,timer,resolveReady,eye=null;
  const ready=new Promise(resolve=>{resolveReady=resolve;});
  const stats={slices:0,maxSliceMs:0,work:0,bytes:texture.image.data.byteLength,mipBytes:Math.ceil(texture.image.data.byteLength*4/3),triangles:0,drawCalls:0};
  function prepare(){
    if(disposed)return;
    const start=performance.now();
    do{field.step(C.sliceWork);}while(!field.done&&performance.now()-start<C.sliceMs);
    stats.work=field.work;stats.slices++;stats.maxSliceMs=Math.max(stats.maxSliceMs,performance.now()-start);
    if(!field.done)timer=setTimeout(prepare,0);
    else{texture.needsUpdate=true;uniforms.uGroundFarReady.value=1;uniforms.uGroundFarSoil.value.set(...field.soil.map(v=>v*C.soilGain+C.soilLift));resolveReady();}
  }
  // Defer even the first slice so field construction cannot hold up the first scene.
  timer=setTimeout(prepare,0);
  const prior=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.onBeforeCompile=shader=>{
    prior(shader);Object.assign(shader.uniforms,uniforms);
    if(packed)shader.fragmentShader=packed.rewrite(shader.fragmentShader);
    const farGLSL=packed?packed.glsl:GROUND_FAR_GLSL;
    shader.fragmentShader=shader.fragmentShader.replace('// W2c-9r1 ground round 2:',farGLSL+'\n// W2c-9r1 ground round 2:')
      .replace('#include <normal_fragment_begin>', 'diffuseColor.rgb=groundFarColor(diffuseColor.rgb,vGroundWorld,vGroundSlope,distance(vGroundWorld,cameraPosition));\n#include <normal_fragment_begin>')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\nif(uGroundFarDebug>0.5)gl_FragColor.rgb=groundFarDebugColor;');
    // The previous forest tint would otherwise change the floor before the new hand-off.
    shader.fragmentShader=shader.fragmentShader.replace('.4*density*a);', '.4*density*a*(1.0-smoothstep(uGroundFarCanopyRange.x,uGroundFarCanopyRange.y,dist)));');
  };
  material.customProgramCacheKey=()=>key+'|ground-far-18';
  const debug=()=>({enabled:!disposed,density:{size:field.size,metersPerTexel:field.metersPerTexel,forestShare:field.forestShare},
    fade:{from:C.fadeFrom,to:C.fadeTo},canopy:{from:uniforms.uGroundFarCanopyRange.value.x,to:uniforms.uGroundFarCanopyRange.value.y},roads:{count:field.roadCount,texels:field.roadTexels},
    ready:field.done,nearest:eye?field.nearest(eye):null,triangles:stats.triangles,drawCalls:stats.drawCalls,work:stats.work});
  if(new URLSearchParams(search).get('debug')==='1')globalThis.__kzGroundFar=debug;
  const oldDispose=owner.dispose,oldAdapt=owner.setAdapt;
  owner.setAdapt=function(policy){oldAdapt.call(this,policy);const step=typeof policy==='number'?policy:policy.step;
    const treeRange=range*adaptPolicy(step).impostorRange;
    uniforms.uGroundFarCanopyRange.value.set(treeRange,treeRange+C.canopyBand);
    uniforms.uGroundFarFine.value=quality==='light'||step>=2?0:1;
    uniforms.uGroundFarFineDistance.value=(quality==='light'?C.lightDistance:C.fineDistance)*(step>=1?C.adaptDistance:1);
  };
  owner.dispose=function(){if(disposed)return;disposed=true;clearTimeout(timer);packed?.dispose();texture.dispose();resolveReady();
    if(globalThis.__kzGroundFar===debug)delete globalThis.__kzGroundFar;oldDispose.call(this);};
  owner.far={uniforms,textures:[texture],field,stats,ready,update(pos){eye=pos;}};
}

// Reuse the near contact sampler: three R8 far planes follow its unchanged LOD0 data.
// Only the enabled owner changes the texture; old bytes and update functions remain live.
function packGroundFarContact(THREE,contact,path,field){
  const near=contact.texture.image,w=Math.max(near.width,field.size),h=near.height+field.size*3;
  const bytes=new Uint8Array(w*h),texture=new THREE.DataTexture(bytes,w,h,THREE.RedFormat);
  field.attachAtlas(bytes,w,near.height);
  const rows=Array.from({length:near.height},(_,j)=>near.data.subarray(j*near.width,(j+1)*near.width));
  const uniforms={uGroundFarNearScale:{value:new THREE.Vector2(near.width/w,near.height/h)},
    uGroundFarAtlas:{value:new THREE.Vector4(field.size/w,field.size/h,near.height/h,field.size)}};
  contact.uniforms.uGroundContact.value=texture;
  let version=-1;
  function syncNear(){if(version===contact.texture.version)return;version=contact.texture.version;
    for(let j=0;j<rows.length;j++)bytes.set(rows[j],j*w);texture.needsUpdate=true;
  }
  const contactUpdate=contact.update,pathUpdate=path?.update;
  contact.update=function(pos,boxes,circles){const changed=contactUpdate.call(this,pos,boxes,circles);syncNear();return changed;};
  if(path)path.update=function(pos,paths){const changed=pathUpdate.call(this,pos,paths);syncNear();return changed;};
  syncNear();
  // Wrap every pre-existing LOD0 lookup, parsing balanced arguments rather than matching nested vec2s with a regex.
  function rewrite(source){
    const needle='textureLod(uGroundContact,';let offset=0;
    while((offset=source.indexOf(needle,offset))>=0){let end=offset+needle.length,depth=1;
      for(;depth&&end<source.length;end++){if(source[end]==='(')depth++;else if(source[end]===')')depth--;}
      const args=source.slice(offset+needle.length,end-1),uv=args.slice(0,args.lastIndexOf(','));
      const call='groundFarContact('+uv+')';source=source.slice(0,offset)+call+source.slice(end);offset+=call.length;
    }
    const decl=`uniform vec2 uGroundFarNearScale; uniform vec4 uGroundFarAtlas;
vec4 groundFarContact(vec2 uv){return textureLod(uGroundContact,uv*uGroundFarNearScale,0.0);}
vec4 groundFarField(vec2 uv,vec2 dx,vec2 dy){
  vec2 margin=min(vec2(.5),max(vec2(.5/uGroundFarAtlas.w),abs(dx)+abs(dy)));
  uv=clamp(uv,margin,vec2(1.0)-margin);
  vec2 q=uv*uGroundFarAtlas.xy+vec2(0.0,uGroundFarAtlas.z);
  vec2 gx=dx*uGroundFarAtlas.xy,gy=dy*uGroundFarAtlas.xy;
  return vec4(textureGrad(uGroundContact,q,gx,gy).r,
    textureGrad(uGroundContact,q+vec2(0.0,uGroundFarAtlas.y),gx,gy).r,
    textureGrad(uGroundContact,q+vec2(0.0,2.0*uGroundFarAtlas.y),gx,gy).r,1.0);
}
`;
    // uGroundContact is declared inside GROUND6_GLSL; insert helpers immediately after it.
    return source.replace('uniform sampler2D uGroundContact;', 'uniform sampler2D uGroundContact;\n'+decl);
  }
  const glsl=GROUND_FAR_GLSL.replace('uniform sampler2D uGroundFarField;','vec4 groundFarField(vec2 uv,vec2 dx,vec2 dy);').replace('textureGrad(uGroundFarField,uv,dx,dy)','groundFarField(uv,dx,dy)');
  return {texture,uniforms,glsl,rewrite,dispose(){contact.update=contactUpdate;if(path)path.update=pathUpdate;contact.uniforms.uGroundContact.value=contact.texture;}};
}
