import { SOIL, soilEdge, SOIL_GRAIN_GLSL } from './kamakura-ground-pattern.js';

// W2c-9b2: single-colour soil/walls -> world-anchored, pixel-filtered material detail.
// Reuse 9b's surface/grid; pre-average grass on CPU instead of nine GPU lookups per pixel.
export function installGroundSoil(THREE, material, groundDetail, {quality='standard',search=''}={}) {
  const shared=groundDetail?.uniforms;
  if(new URLSearchParams(search).get('gsoil')==='0'||new URLSearchParams(search).get('gdetail')==='0'||!shared?.uGroundSurface||!shared.uGroundGrid||!shared.uGroundPattern)
    return {textures:[],setAdapt(){},dispose(){},ready:Promise.resolve()};
  // W2c-9r1 ground round 2: tone owns the filtered class path; avoid an unused full-resolution edge copy.
  if(groundDetail.tone)return {textures:[],setAdapt(){},dispose(){},ready:groundDetail.tone.ready};
  const image=shared.uGroundSurface.value.image,w=image.width,h=image.height;
  const edgeData=new Uint8Array(w*h),edge=new THREE.DataTexture(edgeData,w,h,THREE.RedFormat,THREE.UnsignedByteType);
  edge.minFilter=edge.magFilter=THREE.LinearFilter;edge.generateMipmaps=false;edge.unpackAlignment=1;
  const uniforms={uSoilEdge:{value:edge},uSoilEdgeMean:{value:new THREE.Vector2()},uSoilReady:{value:0},uSoilDetail:{value:quality==='light'?0:1},uSoilLayers:{value:1}};
  const stats={slices:0,maxSliceMs:0,bytes:edgeData.byteLength};
  let soilSum=0,soilCount=0,gravelSum=0,gravelCount=0;
  let disposed=false,timer=null,cursor=0,resolveReady;
  const ready=new Promise(resolve=>{resolveReady=resolve;});
  function prepare() {
    if(disposed)return;
    const start=performance.now(),end=Math.min(cursor+8192,edgeData.length);
    for(;cursor<end;cursor++){
      const v=Math.round(soilEdge(image.data,w,h,cursor)*255),code=image.data[cursor];edgeData[cursor]=v;
      if(code===4||code===255){soilSum+=v/255;soilCount++;}else if(code===6){gravelSum+=v/255;gravelCount++;}
      if((cursor&127)===127&&performance.now()-start>=1.5){cursor++;break;}
    }
    stats.slices++;stats.maxSliceMs=Math.max(stats.maxSliceMs,performance.now()-start);
    if(cursor<edgeData.length)timer=setTimeout(prepare,0);
    else {uniforms.uSoilEdgeMean.value.set(soilSum/Math.max(1,soilCount),gravelSum/Math.max(1,gravelCount));edge.needsUpdate=true;uniforms.uSoilReady.value=1;resolveReady();}
  }
  prepare();
  const prior=material.onBeforeCompile,priorKey=material.customProgramCacheKey;
  const cacheKey=priorKey.call(material)+'|soil-9b2-v1';
  // W2c-9r1 ground: stacked soil correction -> legacy only while the unified tone is inactive.
  const compile=function(shader,...args){
    prior.call(this,shader,...args);Object.assign(shader.uniforms,shared,uniforms);
    shader.fragmentShader=shader.fragmentShader.replace('void main() {',`${SOIL_GLSL}\nvoid main() {`)
      .replace('#include <color_fragment>',`#include <color_fragment>
        if(${shared.uToneStrength ? 'uToneReady*uToneStrength<=0.0' : 'true'})diffuseColor.rgb=soilColor(diffuseColor.rgb*soilMaterial(vGroundWorld,vGroundSlope,distance(vGroundWorld,cameraPosition)),vGroundWorld.xz,distance(vGroundWorld,cameraPosition));`);
  };
  material.onBeforeCompile=compile;material.customProgramCacheKey=()=>cacheKey;material.needsUpdate=true;
  function setAdapt(policy){const step=typeof policy==='number'?policy:policy.step;uniforms.uSoilDetail.value=quality==='light'||step>=2?0:1;uniforms.uSoilLayers.value=step>=3?0:1;}
  function dispose(){if(disposed)return;disposed=true;clearTimeout(timer);edge.dispose();resolveReady();if(material.onBeforeCompile===compile){material.onBeforeCompile=prior;material.customProgramCacheKey=priorKey;}}
  // Decorate the existing owner: chunk wiring remains one call, all lifetimes stay together.
  const oldAdapt=groundDetail.setAdapt,oldDispose=groundDetail.dispose;
  groundDetail.setAdapt=function(policy){oldAdapt.call(this,policy);setAdapt(policy);};
  groundDetail.dispose=function(){dispose();oldDispose.call(this);};
  return {uniforms,textures:[edge],setAdapt,dispose,ready,stats};
}

export const SOIL_GLSL=`
uniform sampler2D uSoilEdge;
uniform vec2 uSoilEdgeMean;
uniform float uSoilReady,uSoilDetail,uSoilLayers;
${SOIL_GRAIN_GLSL}
float soilHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float soilNoise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(soilHash(i),soilHash(i+vec2(1,0)),f.x),mix(soilHash(i+vec2(0,1)),soilHash(i+vec2(1,1)),f.x),f.y);
}
float soilFine(float d,float px,float scale){
  return (1.0-smoothstep(${SOIL.fineNear}.0,${SOIL.fineFar}.0,d))*(1.0-smoothstep(scale*.35,scale,px));
}
float soilSlope(float y){return 1.0-smoothstep(${SOIL.slopeFull},${SOIL.slopeStart},y);}
vec3 soilMacro(vec2 p,float d){
  float warp=soilNoise(p/300.0)*16.0;
  float n=(soilNoise((p+vec2(warp,-warp))/40.0)*.45+soilNoise(mat2(.8,-.6,.6,.8)*p/170.0)*.55)*2.0-1.0;
  float fade=1.0-smoothstep(${SOIL.macroNear}.0,${SOIL.macroFar}.0,d);
  // Bounded, zero-centred light/chroma coefficients; K7 remains the mean.
  return vec3(n*.08*fade,n*.10*fade,radians(n*3.0*fade));
}
vec3 soilMaterial(vec3 world,float normalY,float d){
  vec2 p=world.xz;float px=max(length(fwidth(p)),.0001);
  vec3 result=vec3(1.0);
  float wallPixel=length(fwidth(world));
  vec3 facing=normalize(cross(dFdx(world),dFdy(world)));if(facing.y<0.0)facing=-facing;
  if(uSoilLayers<.5||d>=2500.0)return result;
  vec2 warp=.85*vec2(sin(p.x*.13+sin(p.y*.09)),sin(p.y*.11+sin(p.x*.07)));
  vec2 uv=(p+warp)/(uGroundGrid.z*uGroundGrid.xy)+.5;
  float code=floor(texture2D(uGroundSurface,uv).r*255.0+.5);
  if(code==0.0||code==1.0)return result;
  float edge=0.0;
  if(uSoilReady>.5&&(code==4.0||code==255.0||code==6.0))edge=texture2D(uSoilEdge,uv).r;
  float fade=1.0-smoothstep(700.0,2500.0,d);
  vec2 q=p+vec2(sin(p.y*.11),sin(p.x*.09))*.22;
  float soilPatch=(soilNoise(q/.75)*.55+soilNoise(mat2(.8,-.6,.6,.8)*q/1.5)*.45)*2.0-1.0;
  float broad=0.0;vec3 tint=vec3(0.0);
  if(code==4.0||code==255.0){broad=soilPatch*.12+(uSoilEdgeMean.x-edge)*.16*uSoilReady;tint=vec3(-.015,.02,-.005)*(edge-uSoilEdgeMean.x)*uSoilReady;}
  if(code==3.0)broad=(soilNoise(q/5.0)*2.0-1.0)*.12;
  if(code==5.0){broad=soilPatch*.14;tint=vec3(-.04,.045,-.005)*(soilNoise(q/2.0)*2.0-1.0);}
  if(code==6.0)broad=soilPatch*.08+(uSoilEdgeMean.y-edge)*.10*uSoilReady;
  if(code==7.0)broad=(soilNoise(q/2.5)*2.0-1.0)*.10;
  float fine=0.0;
  if(uSoilDetail>.5&&d<60.0){
    if(code==4.0||code==255.0||code==6.0||code==3.0){
      float cell=code==3.0?.09:code==6.0?.05:.06;
      vec2 g=q/cell,i=floor(g),f=fract(g)-.5;
      float hash=soilHash(i),grain=groundSoilGrain(q,cell);
      fine+=grain*(code==6.0?.8:.45)*soilFine(d,px,cell);
      if(code==3.0){
        tint+=vec3(.16,.04,-.18)*grain*soilFine(d,px,cell);
        float twig=(1.0-smoothstep(.018,.045,abs(f.y+f.x*.23)))*step(.94,hash);
        fine+=(.004-twig*.22)*soilFine(d,px,.025);
      }
    }
    if(code==4.0||code==255.0){
      float track=sin(q.y*8.0+sin(q.x*.18)*2.0+soilNoise(q/9.0));
      float crack=(1.0-smoothstep(.008,.025,abs(sin(q.x*5.0+sin(q.y*2.0)))))*step(.8,soilNoise(q));
      fine+=track*.035*soilFine(d,px,.4)+(.002-crack*.10)*soilFine(d,px,.025);
    }
    if(code==5.0){
      vec2 g=q/.65;float crack=1.0-smoothstep(.014,.055,min(abs(sin(g.x+sin(g.y))),abs(sin(g.y+sin(g.x)))));
      fine+=((soilHash(floor(g))-.5)*.22+.009-crack*.17)*soilFine(d,px,.09);
    }
    if(code==7.0){
      float furrow=sin(q.y*20.943951+sin(q.x*.17)*1.8+world.y*.45);
      fine+=furrow*.13*soilFine(d,px,.3);
    }
  }
  float slope=soilSlope(normalY);
  if(slope>0.0){
    float layers=sin(world.y*5.0+sin(p.x*.4)+sin(p.y*.32)*.6);
    float rain=sin((p.x+p.y)*7.0+sin(world.y*.2));
    // A north-facing surface rises toward south (+Z). Derivatives recover that aspect.
    float north=clamp(-facing.z,0.0,1.0),low=1.0-smoothstep(0.0,70.0,world.y);
    float damp=(soilNoise(q/3.0)*2.0-1.0)*(.025+.04*max(low,north));
    float wall=layers*.12*(1.0-smoothstep(.3,1.3,wallPixel))+rain*.045*soilFine(d,px,.9);
    if(uSoilDetail>.5){
      float split=1.0-smoothstep(.015,.05,abs(sin((p.x+p.y)*2.7+world.y*.25)));
      wall+=(.006-split*.12)*soilFine(d,px,.05);
    }
    broad=mix(broad,wall+damp,slope);fine*=1.0-slope;
    tint=mix(tint,vec3(.04,.005,-.045)*layers*.5+vec3(-.08,.1,-.02)*damp,slope);
  }
  // Keep multipliers bounded, including evening illumination. No absolute recolouring.
  return result*(vec3(1.0)+clamp(vec3(broad+fine)+tint,vec3(-.28),vec3(.28))*fade);
}
vec3 soilColor(vec3 base,vec2 p,float d){
  vec3 macro=soilMacro(p,d),luma=vec3(.2126,.7152,.0722);
  float y=dot(base,luma),c=cos(macro.z),s=sin(macro.z);
  vec3 chroma=base-vec3(y);
  vec3 rotated=chroma*c+cross(normalize(vec3(1.0)),chroma)*s;
  rotated-=vec3(dot(rotated,luma));
  // Rotate hue and scale saturation around the K7 luminance; no absolute palette override.
  return max(vec3(0.0),(vec3(y)+rotated*(1.0+macro.y))*(1.0+macro.x));
}
`;
