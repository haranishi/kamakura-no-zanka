import { toneStrength, groundUseBoxes, toneTexel, toneWeightGrid } from './kamakura-ground-tone-rules.js';
import { SOIL_GRAIN_GLSL } from './kamakura-ground-pattern.js';

export function installGroundTone(THREE,material,data,owner,{quality='standard',search=''}={}) {
  if(new URLSearchParams(search).get('gtone')==='0'||!data?.ground||!owner.uniforms)return;
  const {width:w,height:h}=data.meta.grid;
  const grid=toneWeightGrid(data),count=grid.width*grid.height;
  const weights=new Uint8Array(count*4),boxes=groundUseBoxes(data);
  // W2c-9r1 ground: the source bytes are uploaded as they are (no CPU copy) and 4m weights are baked in slices.
  // The base stays a plain RGB8 texture and is decoded from sRGB in the shader: WebGL2 cannot generate mipmaps for SRGB8
  // (glGenerateMipmap fails, every level above zero stays empty, and far ground and the whole aerial view turn grey).
  // RGB8 must be named: left to Three.js, RGBFormat asks for the unsized RGB, glTexStorage2D rejects it and the texture is black.
  const baseTexture=new THREE.DataTexture(data.ground,w,h,THREE.RGBFormat);
  baseTexture.internalFormat='RGB8';
  const weightTexture=new THREE.DataTexture(weights,grid.width,grid.height,THREE.RGBAFormat);
  const textures=[baseTexture,weightTexture];
  for(const t of textures){t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;t.unpackAlignment=1;}
  // The base is sampled from the first frame; only the weights wait for the bake.
  baseTexture.needsUpdate=true;
  const uniforms={uToneGrid:{value:new THREE.Vector3(w,h,data.meta.grid.cell_m)},uToneWeightSpan:{value:new THREE.Vector2(grid.width*grid.dx,grid.height*grid.dz)},uToneBase:{value:baseTexture},uToneWeights:{value:weightTexture},uToneReady:{value:0},uToneBlend:{value:0},uToneBaked:{value:material.vertexColors?1:0},uToneStrength:{value:toneStrength(quality)},uToneSoil:{value:new URLSearchParams(search).get('gsoil')==='0'?0:1}};
  Object.assign(owner.uniforms,uniforms);
  let cursor=0,timer,fadeTimer,disposed=false,resolveReady,resolveFaded;
  const ready=new Promise(resolve=>{resolveReady=resolve;}),faded=new Promise(resolve=>{resolveFaded=resolve;});
  const stats={bytes:weights.byteLength,slices:0,maxSliceMs:0};
  // Until the weights exist the shader runs on neutral land weights (relief and grain only); they then fade in, so the
  // ground is never flat while loading and nothing pops when the bake ends.
  function fade(from){
    if(disposed)return;
    const t=Math.min(1,(performance.now()-from)/TONE_FADE_MS);uniforms.uToneBlend.value=t;
    if(t<1)fadeTimer=setTimeout(()=>fade(from),50);else resolveFaded();
  }
  function prepare(){
    if(disposed)return;
    const start=performance.now(),end=Math.min(cursor+4096,count);
    for(;cursor<end;cursor++){toneTexel(data,boxes,cursor,weights,grid);if((cursor&63)===63&&performance.now()-start>=1.5){cursor++;break;}}
    stats.slices++;stats.maxSliceMs=Math.max(stats.maxSliceMs,performance.now()-start);
    if(cursor<count)timer=setTimeout(prepare,0);
    else {
      weightTexture.needsUpdate=true;uniforms.uToneReady.value=1;stats.readyMs=performance.now();resolveReady();fade(performance.now());
      try{performance.mark('kz-tone-ready');}catch{/* marks are optional */}
    }
  }
  prepare();
  const prior=material.onBeforeCompile,priorKey=material.customProgramCacheKey,cacheKey=priorKey.call(material)+'|tone-r4';
  material.onBeforeCompile=shader=>{
    prior(shader);Object.assign(shader.uniforms,uniforms);
    // W2c-9r1 ground round 3: declare after detail's helpers, then multiply
    // their output onto the continuous base. Never re-enable nearest class IDs.
    // The tone runs from the first frame (neutral weights until the bake ends), so the legacy detail never has to stand in.
    shader.fragmentShader=shader.fragmentShader.replace('void main() {',`${TONE_GLSL}\nvoid main() {`)
      .replace('if(uGroundStrength>0.0){','if(uGroundStrength>0.0 && uToneStrength<=0.0){')
      .replace('#include <color_fragment>',`#include <color_fragment>
        if(uToneStrength>0.0)diffuseColor.rgb=groundTone(diffuseColor.rgb,vGroundWorld,vGroundSlope,distance(vGroundWorld,cameraPosition));`);
  };
  material.customProgramCacheKey=()=>cacheKey;
  const oldAdapt=owner.setAdapt,oldDispose=owner.dispose;
  owner.setAdapt=function(policy){oldAdapt.call(this,policy);uniforms.uToneStrength.value=toneStrength(quality,typeof policy==='number'?policy:policy.step);};
  owner.dispose=function(){if(disposed)return;disposed=true;clearTimeout(timer);clearTimeout(fadeTimer);textures.forEach(t=>t.dispose());resolveReady();resolveFaded();oldDispose.call(this);};
  owner.tone={uniforms,textures,ready,faded,stats};
}

export const TONE_FADE_MS=1200;
export const TONE_GLSL=`
// W2c-9r1 ground round 2: continuous filtered class weights, visible relief, independent uniforms.
uniform vec3 uToneGrid;
uniform vec2 uToneWeightSpan;
uniform sampler2D uToneBase,uToneWeights;
uniform float uToneReady,uToneBlend,uToneStrength,uToneSoil,uToneBaked;
${SOIL_GRAIN_GLSL}
// The base texture holds the source sRGB bytes (mipmaps need a plain RGB8 format); decode after filtering.
vec3 toneLinear(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(.04045,c));}
float toneHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float toneNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(toneHash(i),toneHash(i+vec2(1,0)),f.x),mix(toneHash(i+vec2(0,1)),toneHash(i+vec2(1,1)),f.x),f.y);}
// Same temporary (x, y, dist) interface as the pure grassTintAt above; y is map south.
float grassTintAt(float x,float y,float dist){return smoothstep(35.0,110.0,dist)*(.035+.025*toneNoise(vec2(x,y)/32.0));}
vec3 groundTone(vec3 fallback,vec3 world,float normalY,float dist){
  vec2 p=world.xz,uv=p/(uToneGrid.z*uToneGrid.xy)+.5;
  vec3 base=uToneBaked>.5?toneLinear(texture2D(uToneBase,uv).rgb):fallback;
  // Warp the continuous weights, never interpolate numeric class IDs.
  vec2 warp=1.6*(vec2(toneNoise(p/23.0),toneNoise((p+vec2(71.0,-37.0))/23.0))-.5);
  // Neutral land (no grass, rock or yard) until the baked weights fade in: relief and grain are right everywhere.
  vec4 weights=vec4(0.0,0.0,0.0,1.0);
  if(uToneBlend>0.0)weights=mix(weights,texture2D(uToneWeights,(p+warp)/uToneWeightSpan+.5),uToneBlend);
  float px=max(length(fwidth(p)),.0001);
  float noisyDist=max(0.0,dist+(toneNoise(p/29.0)-.5)*18.0);
  float fine=(1.0-smoothstep(12.0,65.0,noisyDist))*(1.0-smoothstep(.025,.12,px));
  float macro=toneNoise(p/43.0),dry=smoothstep(0.0,180.0,world.y),steep=1.0-smoothstep(.55,.95,normalY);
  // Screen derivatives approximate cavity; existing Lambert still supplies physical cast shadows.
  vec3 facing=normalize(cross(dFdx(world),dFdy(world)));if(facing.y<0.0)facing=-facing;
  float cavity=clamp((dFdx(facing.x)+dFdy(facing.z))*.5,-1.0,1.0);
  float shade=clamp(-facing.z,0.0,1.0);
  float relief=clamp(1.15*(macro*2.0-1.0)+.12*dry-.18*steep-.14*max(0.0,cavity)-.10*shade,-.85,.85);
  relief*=mix(.1,1.0,smoothstep(12.0,65.0,noisyDist));
  // The 43 m noise is about four pixels wide from the air: it read as a mosaic. Walking ranges keep all of it.
  relief*=1.0-smoothstep(1500.0,5000.0,dist);
  vec2 q=p+vec2(sin(p.y*.11),sin(p.x*.09))*.22;
  float grain=groundSoilGrain(q,.06)*(1.0-smoothstep(12.0,65.0,noisyDist))*(1.0-smoothstep(.021,.06,px));
  vec2 pebbleCell=q/.14;
  float pebbleSeed=toneHash(floor(pebbleCell));
  float stone=1.0-smoothstep(.18,.38,length(fract(pebbleCell)-.5));
  float pebble=(step(.68,pebbleSeed)*stone-${.32*Math.PI*(.3*.18**2+.4*.18*.38+.3*.38**2)})*fine;
  float use=weights.b*smoothstep(.55,.9,normalY)*weights.a;
  float grass=weights.r*(1.0-use)*(1.0-steep);
  float distantGrass=grass*grassTintAt(p.x,p.y,noisyDist);
  vec3 natural=base*(vec3(1.0)+weights.a*uToneStrength*(vec3(relief)+vec3(.015,-.005,-.02)*steep+vec3(-.25,.3,-.15)*distantGrass));
  // Packed earth and gravel use the same base hue. Apply near detail AFTER
  // both tone branches so neither relief nor the yard mix can overwrite it.
  vec3 yard=base*vec3(1.30,1.25,1.13)+vec3(.035,.032,.022);
  vec3 result=mix(natural,yard,use*uToneStrength);
  result*=groundGrassDetail(p,dist,weights.r*smoothstep(.45,.85,normalY));
  result*=1.0+uToneSoil*weights.a*uToneStrength*(grain*.8+pebble*.85*use+(macro-.5)*.05*weights.g);
  return clamp(result,0.0,1.0);
}
`;
