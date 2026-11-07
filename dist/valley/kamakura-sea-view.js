import * as THREE from 'three';
import { createDistanceJob, registerShoreView, unregisterShoreView, SHORE_GLSL } from './kamakura-shore.js';
import { waveEnvelope } from './kamakura-sea-audio.js';
import { buildShoreProps } from './kamakura-shore-props.js';
// W2c-9e: single blue Lambert plane -> depth, filtered normals and audio-clock surf.
export function buildKamakuraSea(terrain, data, {search='',quality='standard',sunDir=new THREE.Vector3(.5,.17,.85)}={}) {
  const enabled=new URLSearchParams(search).get('seav')!=='0', b=terrain.bounds;
  const geometry=new THREE.PlaneGeometry((b.maxX-b.minX)*1.2,(b.maxZ-b.minZ)*1.2);geometry.rotateX(-Math.PI/2);
  const material=enabled?new THREE.MeshStandardMaterial({color:0xffffff,roughness:.1,envMapIntensity:.95}):new THREE.MeshLambertMaterial({color:0x426f83});material.fog=true;
  const group=new THREE.Group(),mesh=new THREE.Mesh(geometry,material);mesh.updateMatrix();mesh.matrixAutoUpdate=false;group.add(mesh);
  let disposed=false,elapsed=0,jobIndex=0,step=0,packed=null,packCursor=0;
  const textures=[],jobs=enabled?[createDistanceJob(terrain),createDistanceJob(terrain,{river:true})]:[];
  function textureFor(field, packed = null) {
    if(!packed){packed=new Uint16Array(field.data.length);
      for(let i=0;i<packed.length;i++)packed[i]=THREE.DataUtils.toHalfFloat(Math.min(3000,field.data[i]));}
    const texture=new THREE.DataTexture(packed,field.w,field.h,THREE.RedFormat,THREE.HalfFloatType);
    texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.unpackAlignment=1;texture.needsUpdate=true;textures.push(texture);return texture;
  }
  const fallback=enabled?textureFor({data:new Float32Array([3000]),w:1,h:1}):null;
  const u={uShoreSea:{value:fallback},uShoreLand:{value:fallback},uShoreRiver:{value:fallback},uShoreGrid:{value:new THREE.Vector4()},uShoreRiverGrid:{value:new THREE.Vector4()},uShoreTime:{value:0},uShoreWave:{value:0},uShoreOldWave:{value:0},uShoreReady:{value:0},uShoreRiverReady:{value:0},uShoreDetail:{value:quality==='light'?0:1},uShoreAnimate:{value:1},SUN_DIR_W:{value:sunDir.clone().normalize()}};
  const props=enabled?buildShoreProps(THREE,terrain,data,quality):null;if(props)group.add(props.group);
  if(enabled) {
    const field=terrain.shoreField;
    if(field){u.uShoreSea.value=textureFor(field);u.uShoreGrid.value.set(field.x0,field.z0,field.cell*field.w,field.cell*field.h);}
    registerShoreView(data,u);
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,u);
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vSeaWorld;').replace('#include <begin_vertex>','#include <begin_vertex>\nvSeaWorld=(modelMatrix*vec4(position,1.0)).xyz;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
        varying vec3 vSeaWorld;uniform sampler2D uShoreLand;uniform vec4 uShoreGrid;
        uniform float uShoreReady,uShoreTime,uShoreWave,uShoreOldWave,uShoreDetail,uShoreAnimate;uniform vec3 SUN_DIR_W;
        ${SHORE_GLSL}
      `).replace('#include <color_fragment>',`#include <color_fragment>
        vec2 seaUV=(vSeaWorld.xz-uShoreGrid.xy)/uShoreGrid.zw+vec2(${terrain.shoreField ? .5/terrain.shoreField.w : 0},${terrain.shoreField ? .5/terrain.shoreField.h : 0});
        float landDistance=texture2D(uShoreLand,seaUV).r;
        float seaRange=distance(vSeaWorld,cameraPosition);
        if(uShoreReady>.5){
          diffuseColor.rgb=mix(vec3(.115,.38,.37),vec3(.012,.068,.125),smoothstep(0.0,240.0,landDistance));
          float broken=.85;
          if(uShoreDetail>.5)broken=.65+.35*sin(vSeaWorld.x*1.7+sin(vSeaWorld.z*2.1));
          float foam=shoreFoam(landDistance,uShoreWave)*broken;
          foam+=.22*shoreFoam(landDistance,uShoreOldWave);
          foam*=1.0-smoothstep(1.0,8.0,fwidth(landDistance));
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.8,.87,.82),clamp(foam,0.0,.85));
        }else diffuseColor.rgb=vec3(.055,.16,.22);
      `).replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        if(uShoreAnimate>.5){
          // Distance gradient points offshore: 12m swell travels toward land.
          vec2 dd=vec2(dFdx(landDistance),dFdy(landDistance));
          vec2 px=dFdx(vSeaWorld.xz),py=dFdy(vSeaWorld.xz);
          float det=px.x*py.y-px.y*py.x;
          vec2 direction=abs(det)>.000001?vec2(dd.x*py.y-dd.y*px.y,px.x*dd.y-py.x*dd.x)/det:vec2(0.0,1.0);
          direction=length(direction)>.01?normalize(direction):vec2(0.0,1.0);
          float swell=cos(landDistance*.524+uShoreTime*.65)*.07;
          float filterWidth=max(length(fwidth(vSeaWorld.xz)),.001);
          float ripple=uShoreDetail*(1.0-smoothstep(.12,.7,filterWidth))*(1.0-smoothstep(80.0,500.0,seaRange));
          vec2 slopes=direction*swell+ripple*.045*vec2(cos(vSeaWorld.x*9.0+uShoreTime*1.3),sin(vSeaWorld.z*7.0-uShoreTime*1.1));
          vec3 nw=normalize(vec3(slopes.x,1.0,slopes.y));normal=normalize((viewMatrix*vec4(nw,0.0)).xyz);
        }
      `).replace('#include <opaque_fragment>',`
        if(uShoreAnimate>.5){
          vec3 vd=normalize(vSeaWorld-cameraPosition),wn=normalize((vec4(normal,0.0)*viewMatrix).xyz);
          float alignment=max(dot(reflect(vd,wn),SUN_DIR_W),0.0);
          outgoingLight+=vec3(1.0,.78,.55)*(pow(alignment,90.0)*2.0+pow(alignment,14.0)*.25)*(1.0-abs(vd.y));
        }
        #include <opaque_fragment>`);
    };
    material.customProgramCacheKey=()=> 'kamakura-sea-9e-v1';
  }
  return {group,mesh,uniforms:u,textures,jobs,props,
    update(dt,pos,audioTime) {
      if(disposed||!enabled)return;
      elapsed+=dt;const time=Number.isFinite(audioTime)?audioTime:elapsed;
      u.uShoreTime.value=time;u.uShoreWave.value=waveEnvelope(time);u.uShoreOldWave.value=waveEnvelope(time-.9);
      // 0.25ms preparation target leaves room under the 0.5ms incremental goal.
      const start=performance.now();
      while(jobIndex<jobs.length&&performance.now()-start<.25) {
        const job=jobs[jobIndex];if(!job.step(32))continue;
        const f=job.field;
        if(!packed){packed=new Uint16Array(f.data.length);packCursor=0;}
        const end=Math.min(packCursor+256,packed.length);
        for(;packCursor<end;packCursor++)packed[packCursor]=THREE.DataUtils.toHalfFloat(f.data[packCursor]);
        if(packCursor<packed.length)continue;
        const texture=textureFor(f,packed);packed=null;
        if(jobIndex===0){u.uShoreLand.value=texture;u.uShoreReady.value=1;if(!terrain.shoreField)u.uShoreGrid.value.set(f.x0,f.z0,f.cell*f.w,f.cell*f.h);}
        else{u.uShoreRiver.value=texture;u.uShoreRiverGrid.value.set(f.x0,f.z0,f.cell*f.w,f.cell*f.h);u.uShoreRiverReady.value=1;}
        jobIndex++;
      }
      props.update(pos);
    },
    setAdapt(value){step=typeof value==='number'?value:value.step;u.uShoreDetail.value=quality==='light'||step>=2?0:1;u.uShoreAnimate.value=step>=3?0:1;if(enabled)material.envMapIntensity=step>=3?0:.95;props?.setAdapt(step);},
    dispose(){if(disposed)return;disposed=true;if(enabled)unregisterShoreView(data);props?.dispose();group.removeFromParent();geometry.dispose();material.dispose();for(const texture of textures)texture.dispose();}
  };
}
