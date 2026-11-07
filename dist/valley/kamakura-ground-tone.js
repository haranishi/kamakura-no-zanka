import { toneStrength, groundUseBoxes, toneTexel, toneWeightGrid } from './kamakura-ground-tone-rules.js';

export function installGroundTone(THREE,material,data,owner,{quality='standard',search=''}={}) {
  if(new URLSearchParams(search).get('gtone')==='0'||!data?.ground||!owner.uniforms)return;
  const {width:w,height:h}=data.meta.grid;
  const grid=toneWeightGrid(data),count=grid.width*grid.height;
  const weights=new Uint8Array(count*4),boxes=groundUseBoxes(data);
  // W2c-9r1 ground round 2: 45.7MiB copied linear RGB+weights -> zero-copy sRGB and 4m weights.
  const baseTexture=new THREE.DataTexture(data.ground,w,h,THREE.RGBFormat);
  baseTexture.internalFormat='SRGB8';
  const weightTexture=new THREE.DataTexture(weights,grid.width,grid.height,THREE.RGBAFormat);
  const textures=[baseTexture,weightTexture];
  // Sized SRGB8 makes hardware decode before bilinear/mipmap filtering; no CPU RGB copy.
  for(const t of textures){t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;t.unpackAlignment=1;}
  const uniforms={uToneGrid:{value:new THREE.Vector3(w,h,data.meta.grid.cell_m)},uToneWeightSpan:{value:new THREE.Vector2(grid.width*grid.dx,grid.height*grid.dz)},uToneBase:{value:baseTexture},uToneWeights:{value:weightTexture},uToneReady:{value:0},uToneBaked:{value:material.vertexColors?1:0},uToneStrength:{value:toneStrength(quality)},uToneSoil:{value:new URLSearchParams(search).get('gsoil')==='0'?0:1}};
  Object.assign(owner.uniforms,uniforms);
  let cursor=0,timer,disposed=false,resolveReady;
  const ready=new Promise(resolve=>{resolveReady=resolve;});
  const stats={bytes:weights.byteLength,slices:0,maxSliceMs:0};
  function prepare(){
    if(disposed)return;
    const start=performance.now(),end=Math.min(cursor+4096,count);
    for(;cursor<end;cursor++){toneTexel(data,boxes,cursor,weights,grid);if((cursor&63)===63&&performance.now()-start>=1.5){cursor++;break;}}
    stats.slices++;stats.maxSliceMs=Math.max(stats.maxSliceMs,performance.now()-start);
    if(cursor<count)timer=setTimeout(prepare,0);
    else {textures.forEach(t=>{t.needsUpdate=true;});uniforms.uToneReady.value=1;resolveReady();}
  }
  prepare();
  const prior=material.onBeforeCompile,priorKey=material.customProgramCacheKey,cacheKey=priorKey.call(material)+'|tone-r2';
  material.onBeforeCompile=shader=>{
    prior(shader);Object.assign(shader.uniforms,uniforms);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\n${TONE_GLSL}`)
      .replace('if(uGroundStrength>0.0){','if(uGroundStrength>0.0 && uToneStrength<=0.0){')
      .replace('#include <color_fragment>',`#include <color_fragment>
        if(uToneReady*uToneStrength>0.0)diffuseColor.rgb=groundTone(diffuseColor.rgb,vGroundWorld,vGroundSlope,distance(vGroundWorld,cameraPosition));`);
  };
  material.customProgramCacheKey=()=>cacheKey;
  const oldAdapt=owner.setAdapt,oldDispose=owner.dispose;
  owner.setAdapt=function(policy){oldAdapt.call(this,policy);uniforms.uToneStrength.value=toneStrength(quality,typeof policy==='number'?policy:policy.step);};
  owner.dispose=function(){if(disposed)return;disposed=true;clearTimeout(timer);textures.forEach(t=>t.dispose());resolveReady();oldDispose.call(this);};
  owner.tone={uniforms,textures,ready,stats};
}

export const TONE_GLSL=`
// W2c-9r1 ground round 2: continuous filtered class weights, visible relief, independent uniforms.
uniform vec3 uToneGrid;
uniform vec2 uToneWeightSpan;
uniform sampler2D uToneBase,uToneWeights;
uniform float uToneReady,uToneStrength,uToneSoil,uToneBaked;
float toneHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float toneNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(toneHash(i),toneHash(i+vec2(1,0)),f.x),mix(toneHash(i+vec2(0,1)),toneHash(i+vec2(1,1)),f.x),f.y);}
// Same temporary (x, y, dist) interface as the pure grassTintAt above; y is map south.
float grassTintAt(float x,float y,float dist){return smoothstep(35.0,110.0,dist)*(.035+.025*toneNoise(vec2(x,y)/32.0));}
vec3 groundTone(vec3 fallback,vec3 world,float normalY,float dist){
  vec2 p=world.xz,uv=p/(uToneGrid.z*uToneGrid.xy)+.5;
  vec3 base=mix(fallback,texture2D(uToneBase,uv).rgb,uToneBaked);
  // Warp the continuous weights, never interpolate numeric class IDs.
  vec2 warp=1.6*(vec2(toneNoise(p/23.0),toneNoise((p+vec2(71.0,-37.0))/23.0))-.5);
  vec4 weights=texture2D(uToneWeights,(p+warp)/uToneWeightSpan+.5);
  float px=max(length(fwidth(p)),.0001);
  float noisyDist=max(0.0,dist+(toneNoise(p/29.0)-.5)*18.0);
  float fine=(1.0-smoothstep(12.0,65.0,noisyDist))*(1.0-smoothstep(.025,.12,px));
  float macro=toneNoise(p/43.0),dry=smoothstep(0.0,180.0,world.y),steep=1.0-smoothstep(.55,.95,normalY);
  // Screen derivatives approximate cavity; existing Lambert still supplies physical cast shadows.
  vec3 facing=normalize(cross(dFdx(world),dFdy(world)));if(facing.y<0.0)facing=-facing;
  float cavity=clamp((dFdx(facing.x)+dFdy(facing.z))*.5,-1.0,1.0);
  float shade=clamp(-facing.z,0.0,1.0);
  float relief=clamp(1.15*(macro*2.0-1.0)+.12*dry-.18*steep-.14*max(0.0,cavity)-.10*shade,-.85,.85);
  vec2 pebbleCell=p/.09,pebbleOffset=fract(pebbleCell)-.5;
  float pebbleSeed=toneHash(floor(pebbleCell));
  float pebble=1.0-smoothstep(mix(.15,.32,pebbleSeed),.44,length(pebbleOffset));
  float grain=(pebbleSeed-.5)*pebble*fine;
  float use=weights.b*smoothstep(.55,.9,normalY)*weights.a;
  float grass=weights.r*(1.0-use)*(1.0-steep);
  float distantGrass=grass*grassTintAt(p.x,p.y,noisyDist);
  vec3 natural=base*(vec3(1.0)+weights.a*uToneStrength*(vec3(relief)+vec3(.015,-.005,-.02)*steep+vec3(-.25,.3,-.15)*distantGrass));
  natural*=1.0+uToneSoil*weights.a*uToneStrength*(grain*.18+(macro-.5)*.05*weights.g);
  // Packed earth and gravel use the same base hue; pebbles integrate to zero at subpixel scale.
  vec3 yard=base*vec3(1.30,1.25,1.13)+vec3(.035,.032,.022);
  yard*=1.0+uToneSoil*grain*.65;
  return clamp(mix(natural,yard,use*uToneStrength),0.0,1.0);
}
`;
