import { toneStrength, groundUseBoxes, toneTexel } from './kamakura-ground-tone-rules.js';

export function installGroundTone(THREE,material,data,owner,{quality='standard',search=''}={}) {
  if(new URLSearchParams(search).get('gtone')==='0'||!material.vertexColors||!data?.ground||!owner.uniforms)return;
  const {width:w,height:h}=data.meta.grid;
  const base=new Uint8Array(w*h*4),weights=new Uint8Array(w*h*4),boxes=groundUseBoxes(data);
  const textures=[base,weights].map(bytes=>{const t=new THREE.DataTexture(bytes,w,h,THREE.RGBAFormat);t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;t.unpackAlignment=1;return t;});
  const uniforms={uToneBase:{value:textures[0]},uToneWeights:{value:textures[1]},uToneReady:{value:0},uToneStrength:{value:toneStrength(quality)},uToneSoil:{value:new URLSearchParams(search).get('gsoil')==='0'?0:1}};
  Object.assign(owner.uniforms,uniforms);
  let cursor=0,timer,disposed=false,resolveReady;
  const ready=new Promise(resolve=>{resolveReady=resolve;});
  const stats={bytes:base.byteLength+weights.byteLength,slices:0,maxSliceMs:0};
  function prepare(){
    if(disposed)return;
    const start=performance.now(),end=Math.min(cursor+4096,w*h);
    for(;cursor<end;cursor++){toneTexel(data,boxes,cursor,base,weights);if((cursor&63)===63&&performance.now()-start>=1.5){cursor++;break;}}
    stats.slices++;stats.maxSliceMs=Math.max(stats.maxSliceMs,performance.now()-start);
    if(cursor<w*h)timer=setTimeout(prepare,0);
    else {textures.forEach(t=>{t.needsUpdate=true;});uniforms.uToneReady.value=1;resolveReady();}
  }
  prepare();
  const prior=material.onBeforeCompile,priorKey=material.customProgramCacheKey,cacheKey=priorKey.call(material)+'|tone-r1';
  material.onBeforeCompile=shader=>{
    prior(shader);Object.assign(shader.uniforms,uniforms);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\n${TONE_GLSL}`)
      .replace('if(uGroundStrength>0.0){','if(uGroundStrength>0.0 && uToneReady*uToneStrength<=0.0){')
      .replace('#include <color_fragment>',`#include <color_fragment>
        if(uToneReady*uToneStrength>0.0)diffuseColor.rgb=groundTone(vGroundWorld,vGroundSlope,distance(vGroundWorld,cameraPosition));`);
  };
  material.customProgramCacheKey=()=>cacheKey;
  const oldAdapt=owner.setAdapt,oldDispose=owner.dispose;
  owner.setAdapt=function(policy){oldAdapt.call(this,policy);uniforms.uToneStrength.value=toneStrength(quality,typeof policy==='number'?policy:policy.step);};
  owner.dispose=function(){if(disposed)return;disposed=true;clearTimeout(timer);textures.forEach(t=>t.dispose());resolveReady();oldDispose.call(this);};
  owner.tone={uniforms,textures,ready,stats};
}

export const TONE_GLSL=`
uniform sampler2D uToneBase,uToneWeights;
uniform float uToneReady,uToneStrength,uToneSoil;
float toneHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float toneNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(toneHash(i),toneHash(i+vec2(1,0)),f.x),mix(toneHash(i+vec2(0,1)),toneHash(i+vec2(1,1)),f.x),f.y);}
// Same temporary (x, y, dist) interface as the pure grassTintAt above; y is map south.
float grassTintAt(float x,float y,float dist){return smoothstep(35.0,110.0,dist)*(.035+.025*toneNoise(vec2(x,y)/32.0));}
vec3 groundTone(vec3 world,float normalY,float dist){
  vec2 p=world.xz,uv=p/(uGroundGrid.z*uGroundGrid.xy)+.5;
  vec3 base=texture2D(uToneBase,uv).rgb;
  vec4 weights=texture2D(uToneWeights,uv);
  float px=max(length(fwidth(p)),.0001);
  float noisyDist=max(0.0,dist+(toneNoise(p/29.0)-.5)*18.0);
  float fine=(1.0-smoothstep(12.0,65.0,noisyDist))*(1.0-smoothstep(.025,.12,px));
  float macro=toneNoise(p/43.0),dry=smoothstep(0.0,180.0,world.y),steep=1.0-smoothstep(.55,.95,normalY);
  // Derivatives recover local concavity without extra height-map samples. Physical shadow remains Lambert's job.
  vec3 facing=normalize(cross(dFdx(world),dFdy(world)));if(facing.y<0.0)facing=-facing;
  float cavity=clamp((dFdx(facing.x)+dFdy(facing.z))*.5,-1.0,1.0);
  float shade=clamp(-facing.z,0.0,1.0);
  float relief=clamp(.045*(macro*2.0-1.0)+.025*dry-.045*steep-.04*max(0.0,cavity)-.025*shade,-.12,.12);
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
  vec3 yard=base*vec3(1.13,1.10,1.03)+vec3(.012,.011,.008);
  yard*=1.0+uToneSoil*grain*.3;
  return mix(natural,yard,use*uToneStrength);
}
`;
