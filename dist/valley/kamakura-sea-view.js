import { shore4Enabled, SHORE_R4_GLSL } from './kamakura-shore-r4.js';
import * as THREE from 'three';
import { createSignedShoreJob, registerShoreView, unregisterShoreView, SHORE_GLSL, SEA_PALETTE, SEA_CHROMA, BREAKERS, wetReachAt, shore2Enabled, shore3Enabled } from './kamakura-shore.js';
import { ATMOS } from './atmosphere.js';
import { atmosphereOptions, kamakuraAtmosphere, eveningEnabled } from './kamakura-atmosphere.js';
import { waveEnvelope } from './kamakura-sea-audio.js';
import { buildBankWet } from './kamakura-bank-wet.js';
import { prepareRivers, waterEnabled } from './kamakura-rivers.js';
import { buildShoreProps } from './kamakura-shore-props.js';
const SHORE_FRAME_BUDGET_MS=3;
// W2c-9e2: coarse unsigned coast -> sub-cell signed surf and atmosphere-derived sea.
export function buildKamakuraSea(terrain, data, {search='',quality='standard',sunDir=new THREE.Vector3(.5,.17,.85)}={}) {
  const shore2=shore2Enabled(search),shore3=shore3Enabled(search),shore4=shore4Enabled(search);
  const enabled=new URLSearchParams(search).get('seav')!=='0', b=terrain.bounds;
  const geometry=new THREE.PlaneGeometry(enabled?200000:(b.maxX-b.minX)*1.2,enabled?200000:(b.maxZ-b.minZ)*1.2);geometry.rotateX(-Math.PI/2);
  const material=enabled?new THREE.MeshStandardMaterial({color:0xffffff,roughness:.22,envMapIntensity:.5}):new THREE.MeshLambertMaterial({color:0x426f83});material.fog=true;
  const group=new THREE.Group(),mesh=new THREE.Mesh(geometry,material);mesh.updateMatrix();mesh.matrixAutoUpdate=false;group.add(mesh);
  let disposed=false,elapsed=0,jobIndex=0,step=0,packed=null,packCursor=0;
  const textures=[],jobs=enabled?[createSignedShoreJob(terrain)]:[];
  const sky=kamakuraAtmosphere(atmosphereOptions(search).time,{...ATMOS,sunDir:ATMOS.sunDir.toArray()},shore4?eveningEnabled(search):true,shore4&&quality==='light'?.55:1);
  const daylight=Math.max(.28,Math.min(1,sky.sunDir[1]/.7));
  function textureFor(field, packed = null) {
    if(!packed){packed=new Uint16Array(field.data.length);
      for(let i=0;i<packed.length;i++)packed[i]=THREE.DataUtils.toHalfFloat(Math.min(3000,field.data[i]));}
    const texture=new THREE.DataTexture(packed,field.w,field.h,THREE.RedFormat,THREE.HalfFloatType);
    texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.unpackAlignment=1;texture.needsUpdate=true;textures.push(texture);return texture;
  }
  // W2c-9r3 shore: blank startup sea -> bounded coarse signed preview (<=65x65).
  // Textures keep their original dimensions throughout their lifetime.
  const preview=enabled&&shore3?createSignedShoreJob(terrain,{cell:Math.max(16,Math.ceil(Math.max(b.maxX-b.minX,b.maxZ-b.minZ)/64))}):null;
  if(preview)while(!preview.done)preview.step(4096);
  const fallback=enabled?textureFor(preview?.field??{data:new Float32Array([3000]),w:1,h:1}):null;
  const palette=SEA_PALETTE.map(([distance,color])=>{const c=new THREE.Color(color),l=.2126*c.r+.7152*c.g+.0722*c.b;return [distance,c.lerp(new THREE.Color(l,l,l),1-SEA_CHROMA)];});
  const colorGLSL=palette.map(([d,c])=>`vec3(${c.r.toFixed(6)},${c.g.toFixed(6)},${c.b.toFixed(6)})`);
  const u={uShore4:{value:+shore4},uShore4Detail:{value:quality==='light'?0:1},uWaterSkyMid:{value:new THREE.Color(sky.mid)},uWaterSkyHorizon:{value:new THREE.Color(sky.horizon)},uShore3:{value:+shore3},uShore2:{value:+shore2},uShoreBands:{value:quality==='light'?1:3},uShoreWetReach:{value:0},uShoreWaves:{value:new THREE.Vector3()},uSeaSky:{value:new THREE.Color(sky.mid)},uSeaSun:{value:new THREE.Color(sky.sunColor)},uSeaDay:{value:daylight},uShoreSea:{value:fallback},uShoreLand:{value:fallback},uShoreGrid:{value:new THREE.Vector4()},uShoreTime:{value:0},uShoreWave:{value:0},uShoreOldWave:{value:0},uShoreReady:{value:preview?1:0},uShoreDetail:{value:quality==='light'?0:1},uShoreAnimate:{value:1},SUN_DIR_W:{value:sunDir.clone().normalize()}};
  // W2c-9e3: fine terrain-conforming bank geometry passed Node acceptance;
  // nearby-only split preparation replaces the disabled 4m ribbon.
  const bank=enabled&&waterEnabled(search)&&new URLSearchParams(search).get('bankwet')!=='0'?buildBankWet(THREE,prepareRivers(data.rivers,terrain.vscale??1,quality),terrain,{search,defer:true,sunDir}):null;if(bank){group.add(bank.group);bank.setAdapt(quality==='light'?2:0);}
  const props=enabled?buildShoreProps(THREE,terrain,data,quality,{shore2}):null;if(props)group.add(props.group);
  if(enabled) {
    const field=preview?.field??jobs[0].field;
    // Ground's shared sampler uses +4m (half the final 8m cell). Offset the preview grid accordingly.
    u.uShoreGrid.value.set(field.x0+4-field.cell/2,field.z0+4-field.cell/2,field.cell*field.w,field.cell*field.h);
    if(preview)terrain.shoreSigned=field;
    registerShoreView(data,u);
    material.onBeforeCompile=shader=>{
      Object.assign(shader.uniforms,u);
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vSeaWorld;').replace('#include <begin_vertex>','#include <begin_vertex>\nvSeaWorld=(modelMatrix*vec4(position,1.0)).xyz;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
        varying vec3 vSeaWorld;uniform sampler2D uShoreLand;uniform vec4 uShoreGrid;
        uniform vec3 uSeaSky,uSeaSun,uShoreWaves; uniform float uSeaDay,uShoreBands;
        uniform float uShoreReady,uShoreTime,uShoreWave,uShoreOldWave,uShoreDetail,uShoreAnimate;uniform vec3 SUN_DIR_W;
        ${SHORE_GLSL}
        ${SHORE_R4_GLSL}
      `).replace('#include <color_fragment>',`#include <color_fragment>
        vec2 seaUV=(vSeaWorld.xz-uShoreGrid.xy+4.0)/uShoreGrid.zw;
        float landDistance=texture2D(uShoreLand,seaUV).r;
        float seaFoam=0.0;
        float shoreFootprint=max(fwidth(landDistance),.001);
        float seaRange=distance(vSeaWorld,cameraPosition);
        if(uShoreReady>.5){
          // W2c-9e3: tropical cyan -> shared Sagami Bay green-grey depth table.
          diffuseColor.rgb=mix(${colorGLSL[0]},${colorGLSL[1]},smoothstep(0.0,6.0,landDistance));
          diffuseColor.rgb=mix(diffuseColor.rgb,${colorGLSL[2]},smoothstep(6.0,40.0,landDistance));
          diffuseColor.rgb=mix(diffuseColor.rgb,${colorGLSL[3]},smoothstep(40.0,200.0,landDistance));
          // W2c-9r2 shore: wider broken surf / steeper wave fronts, pixel-integrated at distance.
          // W2c-9r1 shore: sand-visible shallows -> muted deep water, same d as surf/wetness.
          if(uShore2>.5)diffuseColor.rgb=mix(vec3(.22,.21,.15),diffuseColor.rgb,shoreDepth(landDistance));
          diffuseColor.rgb*=uSeaDay;
          diffuseColor.rgb=mix(diffuseColor.rgb,uSeaSky*.16,(1.0-uSeaDay)*.4);
          // Different audio-envelope phases; low-frequency gaps break every front.
          // W2c-10 shore4: broad stepped depth bands, converging to the actual horizon colour.
          if(uShore4>.0)diffuseColor.rgb=seaColor4(landDistance,shoreFootprint);
          vec3 waves=uShoreAnimate>.5?uShoreWaves:vec3(.45);
          float foam=0.0;
          if(uShore2<.5){
          foam=breakerFoam(landDistance,waves.x,vSeaWorld.xz,0.0);
          foam+=.7*breakerFoam(landDistance,waves.y,vSeaWorld.xz,14.0);
          foam+=.5*breakerFoam(landDistance,waves.z,vSeaWorld.xz,29.0);
          // Fine bright advancing edge, followed by thinner residual foam.
          foam+=.32*breakerFoam(landDistance,uShoreOldWave,vSeaWorld.xz,0.0);
          if(uShoreDetail>.5&&landDistance>=0.0&&landDistance<15.0)foam+=.08*(1.0-smoothstep(0.0,15.0,landDistance))*smoothstep(.6,.85,shoreNoise(vSeaWorld.xz*.8+uShoreTime*.07));
          }else if(uShore3<.5){
            if(uShoreBands>.5)foam=shoreSurf(landDistance,waves.x,vSeaWorld.xz,0.0);
            if(uShoreBands>1.5)foam+=.7*shoreSurf(landDistance,waves.y,vSeaWorld.xz,4.6);
            if(uShoreBands>2.5)foam+=.5*shoreSurf(landDistance,waves.z,vSeaWorld.xz,11.4);
          }
          // W2c-9r3 shore: distant thin line -> three separate moving, broken fronts.
          if(uShore3>.5){
            foam=0.0;
            if(uShoreBands>.5)foam=shoreSurf3(landDistance,waves.x,vSeaWorld.xz,0.0,shoreFootprint);
            if(uShoreBands>1.5)foam+=.8*shoreSurf3(landDistance,waves.y,vSeaWorld.xz,3.4,shoreFootprint);
            if(uShoreBands>2.5)foam+=.6*shoreSurf3(landDistance,waves.z,vSeaWorld.xz,7.2,shoreFootprint);
          }
          if(uShore2<.5)foam*=1.0-smoothstep(1.0,8.0,fwidth(landDistance));
          if(uShore4>.0){
            // 3–15m broken fronts; phase increases inward, never a repeated dashed line.
            foam=shoreSurf3(landDistance,waves.x,vSeaWorld.xz,3.0,shoreFootprint);
            if(uShore4Detail>.5)foam+=.75*shoreSurf3(landDistance,waves.y,vSeaWorld.xz,9.0,shoreFootprint);
          }
          seaFoam=clamp(foam*(uShore2>.5?1.25:1.0),0.0,.9)*(uShoreAnimate>.5?1.0:.5);
        }else diffuseColor.rgb=vec3(.055,.16,.22);
      `).replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        // Distance gradient points offshore: 12m swell travels toward land.
          vec2 dd=vec2(dFdx(landDistance),dFdy(landDistance));
          vec2 px=dFdx(vSeaWorld.xz),py=dFdy(vSeaWorld.xz);
          float det=px.x*py.y-px.y*py.x;
          vec2 direction=abs(det)>.000001?vec2(dd.x*py.y-dd.y*px.y,px.x*dd.y-py.x*dd.x)/det:vec2(0.0,1.0);
          direction=length(direction)>.01?normalize(direction):vec2(0.0,1.0);
          if(uShoreAnimate>.5){
          float swellFilter=1.0-smoothstep(1.0,6.0,length(fwidth(vSeaWorld.xz)));
          vec2 p=vSeaWorld.xz;
          vec2 oblique=normalize(mix(vec2(.72,.69),direction,1.0-smoothstep(0.0,80.0,landDistance)));
          float swell=(cos(dot(p,direction)*.524+uShoreTime*.65)*.035+cos(dot(p,oblique)*.71+uShoreTime*.83)*.026)*swellFilter;
          if(uShore4>.0)swell=(cos(landDistance*.524+uShoreTime*.65)*.045+uShore4Detail*cos(landDistance*.91+uShoreTime*.83+shoreNoise(p/19.0)*.3)*.014)*swellFilter*(1.0-smoothstep(80.0,500.0,seaRange))*uShore4;
          float filterWidth=max(length(fwidth(vSeaWorld.xz)),.001);
          float ripple=uShoreDetail*(1.0-smoothstep(.12,.7,filterWidth))*(1.0-smoothstep(80.0,500.0,seaRange));
          vec2 slopes=direction*swell;
          if(uShore2>.5)slopes+=direction*seaFoam*.16;
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
        // Match the final lit far sea to the sky too (diffuse alone is relit by PBR).
        if(uShore4>.0){
          float horizon4=seaBand4(landDistance,200.0,shoreFootprint);
          outgoingLight=mix(outgoingLight,uWaterSkyHorizon,horizon4);
        }
        // Foam is a white surface film, independent of the light on the water.
        outgoingLight=mix(outgoingLight,(uShore3>.5?vec3(.56,.63,.60):vec3(.72,.78,.76))*mix(.55,1.0,uSeaDay),seaFoam);
        #include <opaque_fragment>`).replace('#include <premultiplied_alpha_fragment>',`
        if(uShore3>.5&&seaFoam>.04)gl_FragColor.rgb=min(gl_FragColor.rgb,vec3(.85));
        #include <premultiplied_alpha_fragment>`);
    };
    material.customProgramCacheKey=()=> 'kamakura-sea-10-shore4';
  }
  return {group,mesh,uniforms:u,textures,jobs,props,bank,get preparedShore(){return jobIndex>=jobs.length;},
    update(dt,pos,audioTime) {
      if(disposed||!enabled)return;
      elapsed+=dt;const time=Number.isFinite(audioTime)?audioTime:elapsed;
      u.uShoreTime.value=time;u.uShoreWave.value=waveEnvelope(time);u.uShoreOldWave.value=waveEnvelope(time-.9);
      u.uShoreWetReach.value=wetReachAt(time,waveEnvelope);
      u.uShoreWaves.value.set(waveEnvelope(time),waveEnvelope(time*BREAKERS[1].speed+BREAKERS[1].phase),waveEnvelope(time*BREAKERS[2].speed+BREAKERS[2].phase));
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
        u.uShoreGrid.value.set(f.x0,f.z0,f.cell*f.w,f.cell*f.h);
        u.uShoreReady.value=1;terrain.shoreSigned=f;props?.setAdapt(step);
        jobIndex++;
      }
      props.update(pos);bank?.update(pos);
    },
    setAdapt(value){step=typeof value==='number'?value:value.step;u.uShore4.value=shore4&&step<3?(step>=2?.45:1):0;u.uShore4Detail.value=quality==='light'||step>=2?0:1;u.uShore3.value=shore3&&step<3?1:0;u.uShoreBands.value=step>=3?0:quality==='light'||step>=2?1:3;u.uShoreDetail.value=quality==='light'||step>=2?0:1;u.uShoreAnimate.value=step>=3?0:1;if(enabled)material.envMapIntensity=step>=3?0:.5;props?.setAdapt(step);bank?.setAdapt(quality==='light'?Math.max(2,step):step);},
    dispose(){if(disposed)return;disposed=true;if(enabled){unregisterShoreView(data);if(terrain.shoreSigned===jobs[0].field||terrain.shoreSigned===preview?.field)delete terrain.shoreSigned;}props?.dispose();bank?.dispose();group.removeFromParent();geometry.dispose();material.dispose();for(const texture of textures)texture.dispose();}
  };
}
