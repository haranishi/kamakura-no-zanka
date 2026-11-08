import { groundAxes, yardTexel, YARD_GLSL } from './kamakura-ground-yard.js';
import { toneStrength, groundUseBoxes, toneTexel, toneWeightGrid } from './kamakura-ground-tone-rules.js';
import { groundPhotoUniforms, GROUND_PHOTO_DECL, GROUND_PHOTO_GLSL, GROUND_PHOTO_NORMAL } from './kamakura-ground-photo.js';
import { SOIL_GRAIN_GLSL, SCATTER_GLSL } from './kamakura-ground-pattern.js';

export function installGroundTone(THREE,material,data,owner,{quality='standard',search=''}={}) {
  if(new URLSearchParams(search).get('gtone')==='0'||!data?.ground||!owner.uniforms)return;
  const r3Enabled=new URLSearchParams(search).get('gyard')!=='0';
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
  weightTexture.internalFormat='RGBA8';
  const yardBytes=new Uint8Array(count*4),axes=groundAxes(data,boxes);
  const yardTexture=new THREE.DataTexture(yardBytes,grid.width,grid.height,THREE.RGBAFormat);
  yardTexture.internalFormat='RGBA8';
  const classA=new Uint8Array(count*4),classB=new Uint8Array(count*4);
  const classTextures=[classA,classB].map(bytes=>{const t=new THREE.DataTexture(bytes,grid.width,grid.height,THREE.RGBAFormat);t.internalFormat='RGBA8';return t;});
  const textures=[baseTexture,weightTexture,yardTexture,...classTextures];
  for(const t of textures){t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;t.unpackAlignment=1;}
  // The base is sampled from the first frame; only the weights wait for the bake.
  baseTexture.needsUpdate=true;
  const uniforms={uToneGrid:{value:new THREE.Vector3(w,h,data.meta.grid.cell_m)},uToneWeightSpan:{value:new THREE.Vector2(grid.width*grid.dx,grid.height*grid.dz)},uToneBase:{value:baseTexture},uToneWeights:{value:weightTexture},uToneYard:{value:yardTexture},uToneYardDebug:{value:new URLSearchParams(search).get('gyard')==='2'?1:0},uToneR3:{value:r3Enabled?toneStrength(quality):0},uToneReady:{value:0},uToneBlend:{value:0},uToneBaked:{value:material.vertexColors?1:0},uToneStrength:{value:toneStrength(quality)},uToneSoil:{value:new URLSearchParams(search).get('gsoil')==='0'?0:1}};
  Object.assign(uniforms,groundPhotoUniforms(classTextures,quality,search,owner.uniforms));
  Object.assign(owner.uniforms,uniforms);
  let cursor=0,timer,fadeTimer,disposed=false,resolveReady,resolveFaded;
  const ready=new Promise(resolve=>{resolveReady=resolve;}),faded=new Promise(resolve=>{resolveFaded=resolve;});
  const stats={bytes:weights.byteLength,slices:0,maxSliceMs:0,yardBytes:yardBytes.byteLength,classBytes:classA.byteLength+classB.byteLength};
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
    for(;cursor<end;cursor++){toneTexel(data,boxes,cursor,weights,grid,classA,classB);
      const x=(cursor%grid.width-(grid.width-1)/2)*grid.dx,z=(Math.floor(cursor/grid.width)-(grid.height-1)/2)*grid.dz;
      yardTexel(boxes,axes,x,z,yardBytes,cursor*4);if((cursor&63)===63&&performance.now()-start>=1.5){cursor++;break;}}
    stats.slices++;stats.maxSliceMs=Math.max(stats.maxSliceMs,performance.now()-start);
    if(cursor<count)timer=setTimeout(prepare,0);
    else {
      classTextures.forEach(t=>{t.needsUpdate=true;});yardTexture.needsUpdate=true;weightTexture.needsUpdate=true;uniforms.uToneReady.value=1;stats.readyMs=performance.now();resolveReady();fade(performance.now());
      try{performance.mark('kz-tone-ready');}catch{/* marks are optional */}
    }
  }
  prepare();
  const prior=material.onBeforeCompile,priorKey=material.customProgramCacheKey,cacheKey=priorKey.call(material)+'|tone-r4-photo';
  material.onBeforeCompile=shader=>{
    prior(shader);Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vGroundPhotoView;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvGroundPhotoView=-(modelViewMatrix*vec4(position,1.0)).xyz;');
    // W2c-9r1 ground round 3: declare after detail's helpers, then multiply
    // their output onto the continuous base. Never re-enable nearest class IDs.
    // The tone runs from the first frame (neutral weights until the bake ends), so the legacy detail never has to stand in.
    shader.fragmentShader=shader.fragmentShader.replace('void main() {',`${owner.uniforms.uShoreSea?'#define GROUND_PHOTO_SHORE\n':''}${GROUND_PHOTO_DECL}\n${TONE_GLSL}\n${GROUND_PHOTO_GLSL}\nvoid main() {`)
      .replace('if(uGroundStrength>0.0){','if(uGroundStrength>0.0 && uToneStrength<=0.0){')
      .replace('#include <color_fragment>',`#include <color_fragment>
        groundPhotoPrepare(vGroundWorld,distance(vGroundWorld,cameraPosition));
        if(uToneStrength>0.0)diffuseColor.rgb=groundTone(diffuseColor.rgb,vGroundWorld,vGroundSlope,distance(vGroundWorld,cameraPosition));`)
      .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>\n${GROUND_PHOTO_NORMAL}`)
      .replace('wind*.055+grain*.12','wind*.055*(1.0-groundPhotoAmount)+grain*.12')
      .replace('#include <opaque_fragment>',`
        // W2c-10 ground: Lambert has no roughness channel; a restrained sky sheen stands in for damp soil.
        #ifdef GROUND_PHOTO_SHORE
        outgoingLight+=uGroundPhotoSky*groundPhotoWet*groundPhotoAmount*groundPhotoEarth*.035
          *pow(1.0-abs(normalize(cameraPosition-vGroundWorld).y),4.0);
        #endif
        // W2c-9r3 ground: grain at PCF edges -> suppress its amplitude using the
        // already-lit direct irradiance gradient; no second shadow-map lookup.
        if(uToneR3>0.0){
        vec3 toneIrradiance=reflectedLight.directDiffuse/max(diffuseColor.rgb,vec3(.00001));
        float toneShadowEdge=smoothstep(.02,.12,length(fwidth(toneIrradiance)));
        outgoingLight*=mix(1.0,1.0/toneFineMultiplier,toneShadowEdge*uToneR3);
        }
        #include <opaque_fragment>`);
    // Keep absent shore uniforms out of the source too (Node's declaration check expands all branches).
    if(!owner.uniforms.uShoreSea)shader.fragmentShader=shader.fragmentShader.replace(/#ifdef GROUND_PHOTO_SHORE[\s\S]*?#endif/g,'');
    // Diagnostic colours bypass lighting, fog and output transforms. No new shader variant.
    shader.fragmentShader=shader.fragmentShader.replace('#include <dithering_fragment>',`#include <dithering_fragment>
      if(uToneYardDebug>0.5 && uToneR3>0.0 && uToneStrength>0.0)gl_FragColor.rgb=toneYardDebug;
    `);
  };
  material.customProgramCacheKey=()=>cacheKey;
  const oldAdapt=owner.setAdapt,oldDispose=owner.dispose;
  owner.setAdapt=function(policy){oldAdapt.call(this,policy);uniforms.uToneR3.value=r3Enabled?toneStrength(quality,typeof policy==='number'?policy:policy.step):0;uniforms.uToneStrength.value=toneStrength(quality,typeof policy==='number'?policy:policy.step);};
  owner.dispose=function(){if(disposed)return;disposed=true;clearTimeout(timer);clearTimeout(fadeTimer);textures.forEach(t=>t.dispose());resolveReady();resolveFaded();oldDispose.call(this);};
  owner.tone={uniforms,textures,ready,faded,stats};
}

export const TONE_FADE_MS=1200;
export const TONE_GLSL=`
// W2c-9r1 ground round 2: continuous filtered class weights, visible relief, independent uniforms.
uniform vec3 uToneGrid;
uniform vec2 uToneWeightSpan;
uniform sampler2D uToneBase,uToneWeights,uToneYard;
uniform float uToneR3,uToneYardDebug;
float toneFineMultiplier=1.0;
vec3 toneYardDebug=vec3(0.0);
uniform float uToneReady,uToneBlend,uToneStrength,uToneSoil,uToneBaked;
${SOIL_GRAIN_GLSL}
${SCATTER_GLSL}
// The base texture holds the source sRGB bytes (mipmaps need a plain RGB8 format); decode after filtering.
vec3 toneLinear(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(.04045,c));}
float toneHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float toneNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(toneHash(i),toneHash(i+vec2(1,0)),f.x),mix(toneHash(i+vec2(0,1)),toneHash(i+vec2(1,1)),f.x),f.y);}
${YARD_GLSL}
// W2c-9r2 ground: root-coloured, zero-centred variation; y is map south.
float grassTintAt(float x,float y,float dist){
  if(dist<=20.0 || dist>=1500.0)return 0.0;
  vec2 p=vec2(x,y);
  float n=(toneNoise(p/5.0)-.5)*.10+(toneNoise(p/20.0)-.5)*mix(.6,.85,uToneR3)+(toneNoise(p/80.0)-.5)*mix(1.3,1.9,uToneR3);
  float streak=sin(x*.25+y*.7+toneNoise(p/20.0)*4.0)*.025;
  return clamp(n+streak,-mix(.28,.40,uToneR3),mix(.28,.40,uToneR3))*smoothstep(20.0,60.0,dist)*(1.0-smoothstep(400.0,1500.0,dist));}
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
  float macro=toneNoise(p/43.0),dry=smoothstep(0.0,180.0,world.y),steep=1.0-smoothstep(.55,.95,normalY);
  // Screen derivatives approximate cavity; existing Lambert still supplies physical cast shadows.
  vec3 facing=normalize(cross(dFdx(world),dFdy(world)));if(facing.y<0.0)facing=-facing;
  float cavity=clamp((dFdx(facing.x)+dFdy(facing.z))*.5,-1.0,1.0);
  float shade=clamp(-facing.z,0.0,1.0);
  float relief=clamp(1.15*(macro*2.0-1.0)+.12*dry-.18*steep-.14*max(0.0,cavity)-.10*shade,-.85,.85);
  relief*=mix(.1,1.0,smoothstep(12.0,65.0,noisyDist));
  // The 43 m noise is about four pixels wide from the air: it read as a mosaic. Walking ranges keep all of it.
  relief*=1.0-smoothstep(1500.0,5000.0,dist);
  // W2c-9r2 ground: regular 6/14cm dots -> three independently filtered irregular sizes.
  float grain=0.0,pebble=0.0;
  if(uToneSoil>0.0 && dist<312.0 && px<.288){
  float density=uToneR3>0.0?mix(1.18,yardDensity(p),uToneR3):1.18;
  grain=(uToneR3>0.0?yardStone(p,.08,density):groundScatter(p,.08))*groundScatterFade(p,dist,px,.08)*1.2
    +(uToneR3>0.0?yardStone(p+vec2(13.7,-9.3),.16,density):groundScatter(p+vec2(13.7,-9.3),.16))*groundScatterFade(p,dist,px,.16)*.95
    +(uToneR3>0.0?yardStone(p+vec2(-5.1,17.9),.32,density):groundScatter(p+vec2(-5.1,17.9),.32))*groundScatterFade(p,dist,px,.32)*.8;
  pebble=groundScatter(p+vec2(37.1,-21.3),.24)*groundScatterFade(p,dist,px,.24);
  }
  float use=weights.b*smoothstep(.55,.9,normalY)*weights.a;
  float grass=weights.r*(1.0-use)*(1.0-steep);
  float distantGrass=grass*grassTintAt(p.x,p.y,dist);
  vec3 natural=base*(vec3(1.0)+weights.a*uToneStrength*(vec3(relief)+vec3(.015,-.005,-.02)*steep+vec3(.26,.34,.12)*distantGrass));
  // Packed earth and gravel use the same base hue. Apply near detail AFTER
  // both tone branches so neither relief nor the yard mix can overwrite it.
  // W2c-9r3 ground: flat yard -> zero-centred 37/113m moisture and wear.
  // Fade additions from walking range to an exact zero at aerial distances.
  float r3=uToneR3*(1.0-smoothstep(400.0,1500.0,noisyDist));
  vec3 wear=vec3(32.0,0.0,0.0);
  if(uToneBlend>0.0 && r3>0.0 && use>.001){
    vec3 encoded=texture2D(uToneYard,p/uToneWeightSpan+.5).rgb;
    wear=vec3((encoded.r-.5)*64.0,encoded.g,encoded.b)*vec3(1.0,uToneBlend,uToneBlend);
  }
  float track=0.0,broad=0.0;
  if(r3>0.0 && use>.001){
    track=yardTrack(wear.x,p,px)*wear.y*(1.0-smoothstep(1.0,5.0,px));
    broad=yardMacro(p);
  }
  float margin=wear.z*(.95+.1*(macro-.5));
  if(uToneYardDebug>0.5)toneYardDebug=use*vec3(track,wear.z,clamp(.5+broad*4.0,0.0,1.0))*uToneBlend;
  // W2c-9r3 ground fix: imperceptible linear +7%/-4.5% -> visible +18%/-9% wear.
  vec3 yard=yardColor(base*1.08+vec3(.008),track,margin,broad,r3);
  vec3 result=mix(natural,yard,use*uToneStrength);
  result*=groundGrassDetail(p,dist,weights.r*smoothstep(.45,.85,normalY));

  // Larger margin stones reuse the irregular kernel; no regular centred disks.
  if(r3>0.0 && margin>.001 && uToneSoil>0.0 && dist<312.0 && px<.288)
    pebble+=groundScatter(p+vec2(-11.3,49.7),.48)*groundScatterFade(p,dist,px,.48)*margin*.22*r3;
  // W2c-10 ground: round procedural yard/gravel spots -> photographic gravel (6% residual).
  float photoStones=mix(1.0,.06,groundPhotoAmount*clamp(use+groundPhotoGravel,0.0,1.0));
  grain*=photoStones;pebble*=photoStones;
  toneFineMultiplier=1.0+uToneSoil*weights.a*uToneStrength*clamp((grain*.8+pebble*.22*use)*(1.0-track*.35*r3),-.35,.35);
  result*=toneFineMultiplier+uToneSoil*weights.a*uToneStrength*(macro-.5)*.05*weights.g;

  // W2c-10 ground: retain the source palette and all earlier relief; detail is an achromatic mean-1 ratio.
  result=clamp(result,0.0,1.0);
  result*=mix(1.0,groundPhotoRatio,groundPhotoAmount);
  result*=1.0-.24*groundPhotoWet*groundPhotoAmount*groundPhotoEarth;
  return result;
}
`;
