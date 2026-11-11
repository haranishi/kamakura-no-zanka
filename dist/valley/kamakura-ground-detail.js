import { installGroundTone } from './kamakura-ground-tone.js';
import { shoreViewFor, SHORE_GLSL } from './kamakura-shore.js';
import { groundPattern } from './kamakura-ground-pattern.js';
import { installGroundCliff } from './kamakura-ground-cliff.js';
// W2c-9b: flat vertex color -> distance-filtered grass/soil, preserving Lambert/fog/shadows.
export function installGroundDetail(THREE, material, data, {quality='standard',search=''}={}) {
  const grid=data?.meta?.grid;
  const enabled=new URLSearchParams(search).get('gdetail')!=='0' && data?.meta?.surface && data.surface instanceof Uint8Array && data.surface.length===grid.width*grid.height;
  if(!enabled)return {setAdapt(){},dispose(){},textures:[]};
  const surface=new THREE.DataTexture(data.surface,grid.width,grid.height,THREE.RedFormat,THREE.UnsignedByteType);
  surface.minFilter=surface.magFilter=THREE.NearestFilter;surface.generateMipmaps=false;surface.unpackAlignment=1;surface.needsUpdate=true;
  const pattern=groundPattern(),texture=new THREE.DataTexture(pattern.data,pattern.size,pattern.size,THREE.RGBAFormat);
  // W2c-9r2 ground: name the mip-capable sized format explicitly.
  texture.internalFormat='RGBA8';
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.anisotropy=4;texture.needsUpdate=true;
  const uniforms={uGroundSurface:{value:surface},uGroundPattern:{value:texture},uGroundGrid:{value:new THREE.Vector3(grid.width,grid.height,grid.cell_m)},uGroundStrength:{value:quality==='light'?.7:1},uGroundSecond:{value:quality==='light'?0:1}};
  const shore=shoreViewFor(data);
  if(shore)Object.assign(uniforms,shore);
  const prior=material.onBeforeCompile;
  material.onBeforeCompile=shader=>{
    prior.call(material,shader);Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vGroundWorld; varying float vGroundSlope;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvGroundWorld=(modelMatrix*vec4(position,1.0)).xyz; vGroundSlope=normalize(mat3(modelMatrix)*normal).y;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec3 vGroundWorld; varying float vGroundSlope;
      uniform sampler2D uGroundSurface; uniform sampler2D uGroundPattern; uniform vec3 uGroundGrid;
      uniform float uGroundStrength; uniform float uGroundSecond;
      float groundGrassAmount(float c){
        if(c==2.0)return 1.0; if(c==3.0)return .45; if(c==7.0)return .7;
        if(c==4.0)return .15; if(c==0.0)return .08; return 0.0;
      }
      vec3 groundGrassDetail(vec2 p,float d,float amount){
        vec2 warp=vec2(sin(p.x*.13+sin(p.y*.09)),sin(p.y*.11+sin(p.x*.07)));
        vec3 a=texture2D(uGroundPattern,p/1.7).rgb;
        vec3 b=a;
        if(uGroundSecond>.5) b=texture2D(uGroundPattern,mat2(.8,.6,-.6,.8)*p/9.0).rgb;
        float blend=.5+.25*sin(p.x*.023+sin(p.y*.031));
        float grain=mix(a.r,b.r,blend)*2.0-1.0;
        float amp=smoothstep(18.0,55.0,d)*(1.0-smoothstep(700.0,2500.0,d));
        float soil=1.0-smoothstep(8.0,18.0,d);
        // Yellow patches have zero-centred chroma; base K7 remains the far mean.
        vec3 detail=vec3(grain*.42)+vec3(.12,.04,-.12)*(a.b-.5);
        return vec3(1.0)+amount*uGroundStrength*(amp*detail-soil*(.23+grain*.10)*vec3(.85,1.0,1.15));
      }
    `).replace('#include <color_fragment>',`#include <color_fragment>
      if(uGroundStrength>0.0){
        vec2 p=vGroundWorld.xz;
        vec2 warp=.85*vec2(sin(p.x*.13+sin(p.y*.09)),sin(p.y*.11+sin(p.x*.07)));
        vec2 uv=(p+warp)/(uGroundGrid.z*uGroundGrid.xy)+.5;
        float code=floor(texture2D(uGroundSurface,uv).r*255.0+.5);
        float amount=groundGrassAmount(code)*smoothstep(.45,.85,vGroundSlope);
        diffuseColor.rgb*=groundGrassDetail(p,distance(vGroundWorld,cameraPosition),amount);
      }`);
  };
  if(shore){
    const groundCompile=material.onBeforeCompile;
    material.onBeforeCompile=shader=>{
      groundCompile(shader);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
        uniform sampler2D uShoreSea;uniform vec4 uShoreGrid;
        uniform float uShoreReady,uShoreTime,uShoreWave,uShoreOldWave,uShoreAnimate,uShoreDetail,uShoreWetReach;
        ${SHORE_GLSL}
        float groundShoreWet=0.0;
      `).replace('#include <color_fragment>',`#include <color_fragment>
        // W2c-9e2: signed sub-cell shore -> aligned wet sand and tide wrack.
        vec2 shoreP=vGroundWorld.xz;
        vec2 shoreUV=shoreP/(uGroundGrid.z*uGroundGrid.xy)+.5;
        float shoreCode=floor(texture2D(uGroundSurface,shoreUV).r*255.0+.5);
        float shoreD=-texture2D(uShoreSea,(shoreP-uShoreGrid.xy+4.0)/uShoreGrid.zw).r;
        if((shoreCode==0.0||shoreCode==1.0)&&uShoreReady>.5){
          float wave=uShoreAnimate>.5?uShoreWave:.45;
          // W2c-9e3: instantaneous reach -> decaying six-second maximum, 1.5m soft edge.
          groundShoreWet=shoreWetReach(shoreD,uShoreAnimate>.5?uShoreWetReach:5.0);
          float footprint=max(length(fwidth(shoreP)),.001);
          float detail=(1.0-smoothstep(.08,.8,footprint))*uShoreAnimate*mix(.35,1.0,uShoreDetail);
          float wind=sin(dot(shoreP,sandWindDirection(shoreP)));
          float grain=texture2D(uGroundPattern,shoreP/1.7).r-.5;
          diffuseColor.rgb*=mix(vec3(1.0),vec3(.48,.55,.59),groundShoreWet);
          diffuseColor.rgb*=1.0+detail*(wind*.055+grain*.12);
          float wrack=tideLine(shoreD)*smoothstep(-.2,.6,sin(shoreP.x*.7+sin(shoreP.y*.9)));
          diffuseColor.rgb*=1.0-.28*wrack;
          float residue=.22*shoreFoam(-shoreD,uShoreOldWave)*uShoreAnimate;
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.65,.70,.62),residue);
        }
      `).replace('#include <opaque_fragment>',`
        // Lambert ground keeps its owner, shadow and fog pipeline; analytic wet sheen.
        vec3 shoreView=normalize(cameraPosition-vGroundWorld);
        outgoingLight+=vec3(.035,.045,.045)*groundShoreWet*pow(1.0-abs(shoreView.y),4.0);
        #include <opaque_fragment>`);
    };
  }
  material.customProgramCacheKey=()=> shore?'kamakura-ground-9e3-v1':'kamakura-ground-9b-v1';
  let disposed=false;
  const owner = {uniforms,textures:[surface,texture],setAdapt(policy){const step=typeof policy==='number'?policy:policy.step;uniforms.uGroundStrength.value=step>=3?0:quality==='light'?.7:1;uniforms.uGroundSecond.value=quality==='light'||step>=2?0:1;},dispose(){if(disposed)return;disposed=true;surface.dispose();texture.dispose();}};
  // W2c-9r1 ground: separate vertex/class bands -> continuous tone owner, gtone=0 keeps legacy.
  installGroundTone(THREE,material,data,owner,{quality,search});
  installGroundCliff(THREE,material,owner,{quality,search});
  return owner;
}
