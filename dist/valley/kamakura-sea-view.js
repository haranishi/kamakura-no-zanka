import * as THREE from 'three';
import { createSignedShoreJob, registerShoreView, unregisterShoreView, SHORE_GLSL } from './kamakura-shore.js';
import { ATMOS } from './atmosphere.js';
import { atmosphereOptions, kamakuraAtmosphere } from './kamakura-atmosphere.js';
import { waveEnvelope } from './kamakura-sea-audio.js';
import { buildBankWet } from './kamakura-bank-wet.js';
import { prepareRivers, waterEnabled } from './kamakura-rivers.js';
import { buildShoreProps } from './kamakura-shore-props.js';
const SHORE_FRAME_BUDGET_MS=3;
// W2c-9e2: coarse unsigned coast -> sub-cell signed surf and atmosphere-derived sea.
export function buildKamakuraSea(terrain, data, {search='',quality='standard',sunDir=new THREE.Vector3(.5,.17,.85)}={}) {
  const enabled=new URLSearchParams(search).get('seav')!=='0', b=terrain.bounds;
  const geometry=new THREE.PlaneGeometry(enabled?200000:(b.maxX-b.minX)*1.2,enabled?200000:(b.maxZ-b.minZ)*1.2);geometry.rotateX(-Math.PI/2);
  const material=enabled?new THREE.MeshStandardMaterial({color:0xffffff,roughness:.22,envMapIntensity:.5}):new THREE.MeshLambertMaterial({color:0x426f83});material.fog=true;
  const group=new THREE.Group(),mesh=new THREE.Mesh(geometry,material);mesh.updateMatrix();mesh.matrixAutoUpdate=false;group.add(mesh);
  let disposed=false,elapsed=0,jobIndex=0,step=0,packed=null,packCursor=0;
  const textures=[],jobs=enabled?[createSignedShoreJob(terrain)]:[];
  const sky=kamakuraAtmosphere(atmosphereOptions(search).time,{...ATMOS,sunDir:ATMOS.sunDir.toArray()});
  const daylight=Math.max(.28,Math.min(1,sky.sunDir[1]/.7));
  function textureFor(field, packed = null) {
    if(!packed){packed=new Uint16Array(field.data.length);
      for(let i=0;i<packed.length;i++)packed[i]=THREE.DataUtils.toHalfFloat(Math.min(3000,field.data[i]));}
    const texture=new THREE.DataTexture(packed,field.w,field.h,THREE.RedFormat,THREE.HalfFloatType);
    texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.unpackAlignment=1;texture.needsUpdate=true;textures.push(texture);return texture;
  }
  const fallback=enabled?textureFor({data:new Float32Array([3000]),w:1,h:1}):null;
  const u={uSeaSky:{value:new THREE.Color(sky.mid)},uSeaSun:{value:new THREE.Color(sky.sunColor)},uSeaDay:{value:daylight},uShoreSea:{value:fallback},uShoreLand:{value:fallback},uShoreGrid:{value:new THREE.Vector4()},uShoreTime:{value:0},uShoreWave:{value:0},uShoreOldWave:{value:0},uShoreReady:{value:0},uShoreDetail:{value:quality==='light'?0:1},uShoreAnimate:{value:1},SUN_DIR_W:{value:sunDir.clone().normalize()}};
  // W2c-9 parent: the bank wet ribbon drew large dark translucent triangles on river banks (4 m quads draped on 30 deg slopes; found by toggling &seav=0 / &water=0). Off by default until 9e3 redoes it; &bankwet=1 turns it on.
  const bank=enabled&&waterEnabled(search)&&new URLSearchParams(search).get('bankwet')==='1'?buildBankWet(THREE,prepareRivers(data.rivers,terrain.vscale??1,quality),terrain,{search}):null;if(bank)group.add(bank.group);
  const props=enabled?buildShoreProps(THREE,terrain,data,quality):null;if(props)group.add(props.group);
  if(enabled) {
    const field=jobs[0].field;
    u.uShoreGrid.value.set(field.x0,field.z0,field.cell*field.w,field.cell*field.h);
    registerShoreView(data,u);
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,u);
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vSeaWorld;').replace('#include <begin_vertex>','#include <begin_vertex>\nvSeaWorld=(modelMatrix*vec4(position,1.0)).xyz;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
        varying vec3 vSeaWorld;uniform sampler2D uShoreLand;uniform vec4 uShoreGrid;
        uniform vec3 uSeaSky,uSeaSun; uniform float uSeaDay;
        uniform float uShoreReady,uShoreTime,uShoreWave,uShoreOldWave,uShoreDetail,uShoreAnimate;uniform vec3 SUN_DIR_W;
        ${SHORE_GLSL}
      `).replace('#include <color_fragment>',`#include <color_fragment>
        vec2 seaUV=(vSeaWorld.xz-uShoreGrid.xy)/uShoreGrid.zw+vec2(${.5/jobs[0].field.w},${.5/jobs[0].field.h});
        float landDistance=texture2D(uShoreLand,seaUV).r;
        float seaFoam=0.0;
        float seaRange=distance(vSeaWorld,cameraPosition);
        if(uShoreReady>.5){
          diffuseColor.rgb=mix(vec3(.050,.275,.262),vec3(.005,.036,.080),smoothstep(0.0,240.0,landDistance));
          diffuseColor.rgb*=uSeaDay;
          diffuseColor.rgb=mix(diffuseColor.rgb,uSeaSky*.16,(1.0-uSeaDay)*.4);
          float broken=.85;
          if(uShoreDetail>.5)broken=.55+.45*shoreNoise(vSeaWorld.xz*1.6+vec2(uShoreTime*.12));
          float foam=shoreFoam(landDistance,uShoreAnimate>.5?uShoreWave:.45)*broken;
          foam+=.22*shoreFoam(landDistance,uShoreAnimate>.5?uShoreOldWave:.45);
          if(uShoreDetail>.5)foam+=.18*(1.0-smoothstep(0.0,15.0,landDistance))*smoothstep(.55,.8,shoreNoise(vSeaWorld.xz*.8+uShoreTime*.07));
          foam*=1.0-smoothstep(1.0,8.0,fwidth(landDistance));
          seaFoam=clamp(foam,0.0,.85)*(uShoreAnimate>.5?1.0:.5);
        }else diffuseColor.rgb=vec3(.055,.16,.22);
      `).replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        if(uShoreAnimate>.5){
          // Distance gradient points offshore: 12m swell travels toward land.
          vec2 dd=vec2(dFdx(landDistance),dFdy(landDistance));
          vec2 px=dFdx(vSeaWorld.xz),py=dFdy(vSeaWorld.xz);
          float det=px.x*py.y-px.y*py.x;
          vec2 direction=abs(det)>.000001?vec2(dd.x*py.y-dd.y*px.y,px.x*dd.y-py.x*dd.x)/det:vec2(0.0,1.0);
          direction=length(direction)>.01?normalize(direction):vec2(0.0,1.0);
          float swellFilter=1.0-smoothstep(1.0,6.0,length(fwidth(vSeaWorld.xz)));
          vec2 p=vSeaWorld.xz;
          vec2 oblique=normalize(mix(vec2(.72,.69),direction,1.0-smoothstep(0.0,80.0,landDistance)));
          float swell=(cos(dot(p,direction)*.524+uShoreTime*.65)*.035+cos(dot(p,oblique)*.71+uShoreTime*.83)*.026)*swellFilter;
          float filterWidth=max(length(fwidth(vSeaWorld.xz)),.001);
          float ripple=uShoreDetail*(1.0-smoothstep(.12,.7,filterWidth))*(1.0-smoothstep(80.0,500.0,seaRange));
          vec2 slopes=direction*swell;
          if(uShoreDetail>.5){
            vec2 warp=vec2(shoreNoise(p*.12),shoreNoise(p*.12+7.3))*2.0;
            slopes+=ripple*.07*vec2(shoreNoise(p*1.8+warp+uShoreTime*.2)-.5,shoreNoise(p*1.8+warp-uShoreTime*.17+8.0)-.5);
          }
          vec3 nw=normalize(vec3(slopes.x,1.0,slopes.y));normal=normalize((viewMatrix*vec4(nw,0.0)).xyz);
        }
      `).replace('#include <opaque_fragment>',`
        if(uShoreAnimate>.5){
          vec3 vd=normalize(vSeaWorld-cameraPosition),wn=normalize((vec4(normal,0.0)*viewMatrix).xyz);
          float alignment=max(dot(reflect(vd,wn),SUN_DIR_W),0.0);
          float path=pow(max(dot(normalize(vd.xz),normalize(SUN_DIR_W.xz)),0.0),48.0);
          outgoingLight+=uSeaSun*(pow(alignment,90.0)*2.0+path*pow(alignment,12.0)*.7)*pow(1.0-abs(vd.y),2.0);
        }
        // Foam is a white surface film, independent of the light on the water.
        outgoingLight=mix(outgoingLight,vec3(.72,.78,.76)*mix(.55,1.0,uSeaDay),seaFoam);
        #include <opaque_fragment>`);
    };
    material.customProgramCacheKey=()=> 'kamakura-sea-9e2-v2';
  }
  return {group,mesh,uniforms:u,textures,jobs,props,bank,
    update(dt,pos,audioTime) {
      if(disposed||!enabled)return;
      elapsed+=dt;const time=Number.isFinite(audioTime)?audioTime:elapsed;
      u.uShoreTime.value=time;u.uShoreWave.value=waveEnvelope(time);u.uShoreOldWave.value=waveEnvelope(time-.9);
      // W2c-9 parent fix: the 0.25 ms/frame budget and 256-value packing never finished (1.42M cells: ~190 ms of job work + ~70 ms of
      // half-float packing = 0.25 ms x 1000s of frames; ready stayed 0 after 10 s, so no foam / wet sand ever showed). 3 ms/frame finishes in ~1.5 s.
      const start=performance.now();
      while(jobIndex<jobs.length&&performance.now()-start<SHORE_FRAME_BUDGET_MS) {
        const job=jobs[jobIndex];if(!job.step(2048))continue;
        const f=job.field;
        if(!packed){packed=new Uint16Array(f.data.length);packCursor=0;}
        const end=Math.min(packCursor+8192,packed.length);
        for(;packCursor<end;packCursor++)packed[packCursor]=THREE.DataUtils.toHalfFloat(f.data[packCursor]);
        if(packCursor<packed.length)continue;
        // W2c-9 parent fix: swapping the image of the 1x1 placeholder does not resize its GPU storage (WebGL2 texStorage2D is immutable),
        // so the shader kept sampling the placeholder (landDistance = 3000 everywhere: deep colour, no foam, no wet sand). Make a NEW texture;
        // sea and sand share this R16F.
        const done=new THREE.DataTexture(packed,f.w,f.h,THREE.RedFormat,THREE.HalfFloatType);
        done.minFilter=done.magFilter=THREE.LinearFilter;done.generateMipmaps=false;done.unpackAlignment=1;done.needsUpdate=true;textures.push(done);
        u.uShoreSea.value=done;u.uShoreLand.value=done;packed=null;
        u.uShoreReady.value=1;terrain.shoreSigned=f;props?.setAdapt(step);
        jobIndex++;
      }
      props.update(pos);
    },
    setAdapt(value){step=typeof value==='number'?value:value.step;u.uShoreDetail.value=quality==='light'||step>=2?0:1;u.uShoreAnimate.value=step>=3?0:1;if(enabled)material.envMapIntensity=step>=3?0:.5;props?.setAdapt(step);},
    dispose(){if(disposed)return;disposed=true;if(enabled){unregisterShoreView(data);if(terrain.shoreSigned===jobs[0].field)delete terrain.shoreSigned;}props?.dispose();bank?.dispose();group.removeFromParent();geometry.dispose();material.dispose();for(const texture of textures)texture.dispose();}
  };
}
