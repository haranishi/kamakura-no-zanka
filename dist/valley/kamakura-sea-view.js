import { duskSeaColor, seaDuskFragment, seaDiscFragment, sea4Fragment, seaSurfScaleFragment, sea4GlitterEnabled, seaShelterFragment, SEA3, sea3Enabled, sea3Count, sea3Fragment, SEA_FAR, sea2Enabled, seaGrazing, seaSwellGain, seaLineCount, seaFarFragment } from './kamakura-sea-far.js';
import { shore6Enabled, SHORE_R6_GLSL } from './kamakura-shore-r6.js';
import { shore4Enabled, SHORE_R4_GLSL } from './kamakura-shore-r4.js';
import * as THREE from 'three';
import { SHELTER, shelterEnabled, swellEnabled, createSignedShoreJob, registerShoreView, unregisterShoreView, SHORE_GLSL, SEA_PALETTE, SEA_CHROMA, BREAKERS, wetReachAt, shore2Enabled, shore3Enabled } from './kamakura-shore.js';
import { LEGACY_ATMOS as ATMOS } from './atmosphere.js';
import { atmosphereOptions, kamakuraAtmosphere, eveningEnabled, visualSun, sunPlace, SUN_DISC, duskAirEnabled } from './kamakura-atmosphere.js';
import { waveEnvelope } from './kamakura-sea-audio.js';
import { buildBankWet } from './kamakura-bank-wet.js';
import { prepareRivers, waterEnabled } from './kamakura-rivers.js';
import { buildShoreProps } from './kamakura-shore-props.js';
const SHORE_FRAME_BUDGET_MS=3; // original budget when shelter=0
// W2c-9e2: coarse unsigned coast -> sub-cell signed surf and atmosphere-derived sea.
export function buildKamakuraSea(terrain, data, {search='',quality='standard',sunDir=new THREE.Vector3(.5,.17,.85),disc=undefined}={}) {
  const sunPath=new URLSearchParams(search).get('sunpath2')!=='0',duskSea=duskAirEnabled(search);
  const shelter=shelterEnabled(search),swell=data.meta?.sea?.swell_from_deg!==undefined&&swellEnabled(search),withOpen=shelter||swell;
  const sea2=sea2Enabled(search)&&new URLSearchParams(search).get('seav')!=='0';
  const sea3=sea2&&sea3Enabled(search),sea3Colors=new URLSearchParams(search).get('sea3debug')==='1';
  const debugSea2=new URLSearchParams(search).get('debug')==='1',sea2Colors=new URLSearchParams(search).get('sea2debug')==='1';
  const surfScale=data.meta?.sea?.surf_scale??1,sea4=sea3&&data.meta?.sea?.surf_scale!==undefined;
  const glitter=sea4GlitterEnabled(search,quality);
  let lastCamera=null;
  const shore6=shore6Enabled(search),shore2=shore2Enabled(search),shore3=shore3Enabled(search),shore4=shore4Enabled(search);
  const enabled=new URLSearchParams(search).get('seav')!=='0', b=terrain.bounds;
  const geometry=new THREE.PlaneGeometry(enabled?200000:(b.maxX-b.minX)*1.2,enabled?200000:(b.maxZ-b.minZ)*1.2);geometry.rotateX(-Math.PI/2);
  const material=enabled?new THREE.MeshStandardMaterial({color:0xffffff,roughness:.22,envMapIntensity:.5}):new THREE.MeshLambertMaterial({color:0x426f83});material.fog=true;
  const group=new THREE.Group(),mesh=new THREE.Mesh(geometry,material);mesh.updateMatrix();mesh.matrixAutoUpdate=false;group.add(mesh);
  let disposed=false,elapsed=0,jobIndex=0,step=0,packed=null,packCursor=0,distanceShown=false,interim=null;
  const channels=swell?4:shelter?(sea2?4:2):(sea2?2:1),format=swell?THREE.RGBAFormat:shelter?(sea2?THREE.RGBAFormat:THREE.RGFormat):(sea2?THREE.RGFormat:THREE.RedFormat);
  const textures=[],jobs=enabled?[createSignedShoreJob(terrain,{...(sea3?{}:{cell:8}),shelter,...(swell?{sea:data.meta.sea}:{})})]:[];
  const sky=kamakuraAtmosphere(atmosphereOptions(search).time,{...ATMOS,sunDir:ATMOS.sunDir.toArray()},shore4?eveningEnabled(search):true,shore4&&quality==='light'?.55:1);
  disc ??= visualSun(atmosphereOptions(search).time, sunDir.toArray(), sunPlace(data.meta, search));
  const daylight=Math.max(.28,Math.min(1,sky.sunDir[1]/.7));
  // Add beach/cliff gain to the existing distance texture; every shared sampler still reads .r.
  function beachGain(field,i) {
    const d=field.data[i];
    if(Math.abs(d)>SEA_FAR.linePositionsM.at(-1)*surfScale+SEA_FAR.cliffProbeM)return 0;
    const col=i%field.w,row=Math.floor(i/field.w),cell=field.cell;
    const dx=field.data[row*field.w+Math.min(field.w-1,col+1)]-field.data[row*field.w+Math.max(0,col-1)];
    const dz=field.data[Math.min(field.h-1,row+1)*field.w+col]-field.data[Math.max(0,row-1)*field.w+col];
    const length=Math.hypot(dx,dz);if(length<1e-6)return 0;
    const nx=dx/length,nz=dz/length,x=field.x0+col*cell-nx*d,z=field.z0+row*cell-nz*d;
    const slope=Math.max(0,terrain.heightAt(x-nx*SEA_FAR.cliffProbeM,z-nz*SEA_FAR.cliffProbeM))/SEA_FAR.cliffProbeM;
    const t=Math.max(0,Math.min(1,(slope-SEA_FAR.cliffSlopeStart)/(SEA_FAR.cliffSlopeEnd-SEA_FAR.cliffSlopeStart)));
    return 1-(1-SEA_FAR.cliffGain)*t*t*(3-2*t);
  }
  function textureFor(field, packed = null) {
    if(!packed){packed=new Uint16Array(field.data.length*channels);
      for(let i=0;i<field.data.length;i++){
        packed[i*channels]=THREE.DataUtils.toHalfFloat(Math.min(3000,field.data[i]));
        if(sea2)packed[i*channels+1]=THREE.DataUtils.toHalfFloat(beachGain(field,i));
        if(withOpen)packed[i*channels+(sea2?2:1)]=THREE.DataUtils.toHalfFloat(1); // the start-up field has no openness yet: open everywhere
        if(swell)packed[i*channels+3]=THREE.DataUtils.toHalfFloat(1);
      }}
    const texture=new THREE.DataTexture(packed,field.w,field.h,format,THREE.HalfFloatType);
    texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.unpackAlignment=1;texture.needsUpdate=true;textures.push(texture);return texture;
  }
  // W2c-9r3 shore: blank startup sea -> bounded coarse signed preview (<=65x65).
  // Textures keep their original dimensions throughout their lifetime.
  const preview=enabled&&shore3?createSignedShoreJob(terrain,{cell:Math.max(16,Math.ceil(Math.max(b.maxX-b.minX,b.maxZ-b.minZ)/64)),shelter:false,...(swell?{sea:data.meta.sea}:{})}):null;
  if(preview)while(!preview.done)preview.step(4096);
  const fallback=enabled?textureFor(preview?.field??{data:new Float32Array([3000]),w:1,h:1}):null;
  const palette=SEA_PALETTE.map(([distance,color])=>{const c=new THREE.Color(color),l=.2126*c.r+.7152*c.g+.0722*c.b;return [distance,c.lerp(new THREE.Color(l,l,l),1-SEA_CHROMA)];});
  const colorGLSL=palette.map(([d,c])=>`vec3(${c.r.toFixed(6)},${c.g.toFixed(6)},${c.b.toFixed(6)})`);
  const u={uShore6:{value:shore6?(quality==='light'?.5:1):0},uShoreWet5:{value:+shore4},uShore4:{value:+shore4},uShore4Detail:{value:quality==='light'?0:1},uWaterSkyMid:{value:new THREE.Color(sky.mid)},uWaterSkyHorizon:{value:new THREE.Color(sky.horizon)},uShore3:{value:+shore3},uShore2:{value:+shore2},uShoreBands:{value:quality==='light'?1:3},uShoreWetReach:{value:0},uShoreWaves:{value:new THREE.Vector3()},uSeaSky:{value:new THREE.Color(sky.mid)},uSeaSun:{value:new THREE.Color(sky.sunColor)},uSeaDay:{value:daylight},uShoreSea:{value:fallback},uShoreLand:{value:fallback},uShoreGrid:{value:new THREE.Vector4()},uShoreTime:{value:0},uShoreWave:{value:0},uShoreOldWave:{value:0},uShoreReady:{value:preview?1:0},uShoreDetail:{value:quality==='light'?0:1},uShoreAnimate:{value:1},SUN_DIR_W:{value:sunDir.clone().normalize()}};
  if(disc){
    u.SUN_DIR_W.value.fromArray(disc.dir);
    if(!disc.enabled)u.uSeaSun.value.setRGB(0,0,0);
    u.uDiscPath={value:disc.enabled?(quality==='light'?SUN_DISC.seaReduced:1):0};
    u.uDiscPathDetail={value:quality==='light'?0:1};
    u.uDiscPathDebug={value:+(new URLSearchParams(search).get('sundebug')==='1')};
  }
  if(sea2){
    u.uSea2={value:1};u.uSea2Swell={value:quality==='light'?SEA_FAR.reducedSwell:1};
    u.uSea2Lines={value:seaLineCount(quality)};u.uSea2Debug={value:+sea2Colors};
  }
  if(sea2&&data.meta?.sea?.surf_scale!==undefined)u.uSurfScale={value:surfScale};
  if(sea4)u.uSea4Glitter={value:+(glitter&&disc?.enabled!==false)};
  if(sea3){u.uSea3={value:1};u.uSea3Lines={value:sea3Count(quality)};u.uSea3Detail={value:quality==='light'?0:1};u.uSea3Debug={value:+sea3Colors};}
  const sunReader=()=>({enabled:enabled&&!!u.uDiscPath?.value,count:enabled&&u.uDiscPath?.value?1:0,triangles:enabled?2:0,draws:enabled?1:0,addedDraws:0,preparationWork:0,step,path2:sunPath,
    nearest:{distance:lastCamera?Math.abs(lastCamera.position.y):null,bearing:disc?(Math.atan2(disc.dir[0],-disc.dir[2])*180/Math.PI+360)%360:null},
    direction:u.SUN_DIR_W.value.toArray(),strength:u.uDiscPath?.value??0});
  if(debugSea2&&disc)globalThis.__kzSunPath=sunReader;
  const sea3Reader=()=>{
    const field=terrain.shoreSigned;let distance=Infinity,bearing=null;
    if(lastCamera&&field){
      for(let row=0;row<field.h;row++)for(let col=0;col<field.w;col++){
        const d=field.data[row*field.w+col];if(d<0||d>field.cell)continue;
        const dx=field.x0+col*field.cell-lastCamera.position.x,dz=field.z0+row*field.cell-lastCamera.position.z;
        const r=Math.hypot(dx,lastCamera.position.y,dz);
        if(r<distance){distance=r;bearing=(Math.atan2(dx,-dz)*180/Math.PI+360)%360;}
      }
    }
    return {surfScale,glitter:sea4&&!!u.uSea4Glitter.value,...(swell?{swellReducedFraction:jobs[0]?.swellReducedFraction??0,swellFromDeg:data.meta.sea.swell_from_deg}:{}),shelteredFraction:shelter?jobs[0]?.shelteredFraction??0:0,shelterReady:jobIndex>=jobs.length,preparationWork:jobs[0]?.work??0,lines:u.uSea3Lines?.value??0,fieldCell:field?.cell??jobs[0]?.field.cell??null,range:{from:SEA3.fromM,to:SEA3.toM},nearest:{distance:Number.isFinite(distance)?distance:null,bearing},triangles:enabled?2:0,draws:enabled?1:0};
  };
  const debugReader=()=>{
    const cosine=lastCamera?Math.abs(lastCamera.matrixWorld.elements[9]):0;
    const range=lastCamera?Math.abs(lastCamera.position.y)/Math.max(cosine,1e-6):0;
    return {enabled:sea2&&(sea3||step<3),grazing:seaGrazing(cosine),swell:sea2&&step<3?seaSwellGain(range)*u.uSea2Swell.value:0,lines:sea2?u.uSea2Lines.value:0,step,triangles:enabled?2:0,draws:enabled?1:0,nearest:{distance:lastCamera?Math.abs(lastCamera.position.y):null,bearing:null}};
  };
  if(debugSea2){globalThis.__kzSea2=debugReader;mesh.onBeforeRender=(_renderer,_scene,camera)=>{lastCamera=camera;};}
  if(debugSea2&&sea3)globalThis.__kzSea3=sea3Reader;
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
        ${SHORE_R6_GLSL}
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
          if(uShore6>0.0){
            vec3 bands6=mix(vec3(.20,.205,.14),vec3(.07,.18,.17),smoothstep(0.0,5.0,landDistance));
            bands6=mix(bands6,vec3(.025,.085,.12),seaDepth6(landDistance));
            bands6=mix(bands6,seaColor4(landDistance,shoreFootprint),seaBand4(landDistance,60.0,shoreFootprint));
            diffuseColor.rgb=mix(diffuseColor.rgb,bands6,uShore6);
          }
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
            // W2c-10b shore5: thin far line -> 2px core and three advancing fronts.
            foam=shoreSurf5(landDistance,waves.x,vSeaWorld.xz,0.0,shoreFootprint);
            if(uShore4Detail>.5)foam+=.7*shoreSurf5(landDistance,waves.y,vSeaWorld.xz,5.5,shoreFootprint);
            if(uShore4Detail>.5)foam+=.45*shoreSurf5(landDistance,waves.z,vSeaWorld.xz,11.5,shoreFootprint);
            foam*=uShore4;
          }
          // W2c-11 shore6: equal-width rails -> three fronts of independent width and gaps.
          if(uShore6>0.0){
            float fronts6=surf6(landDistance,waves.x,vSeaWorld.xz,0.0,shoreFootprint);
            if(uShore4Detail>.5)fronts6+=.7*surf6(landDistance,waves.y,vSeaWorld.xz,4.7,shoreFootprint);
            if(uShore4Detail>.5)fronts6+=.45*surf6(landDistance,waves.z,vSeaWorld.xz,10.3,shoreFootprint);
            foam=mix(foam,fronts6*uShore4,uShore6);
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
          if(uShore6<=0.0)outgoingLight+=uSeaSun*(pow(alignment,90.0)*2.0+path*pow(alignment,12.0)*.7)*pow(1.0-abs(vd.y),2.0);
        }
        // Match the final lit far sea to the sky too (diffuse alone is relit by PBR).
        if(uShore4>.0){
          float horizon4=seaBand4(landDistance,200.0,shoreFootprint);
          outgoingLight=mix(outgoingLight,uWaterSkyHorizon,horizon4);
        }
        // W2c-11 shore6: old glint was erased by the far-horizon mix; bounded reflection follows it.
        if(uShore6>0.0&&uShoreAnimate>.5){
          vec3 eye6=normalize(cameraPosition-vSeaWorld);
          vec3 worldN6=normalize((vec4(normal,0.0)*viewMatrix).xyz);
          outgoingLight+=clamp(uSeaSun,vec3(0.0),vec3(1.0))*seaGlint6(eye6,worldN6,SUN_DIR_W)*uShore6;
        }
        // Foam is a white surface film, independent of the light on the water.
        outgoingLight=mix(outgoingLight,(uShore3>.5?vec3(.56,.63,.60):vec3(.72,.78,.76))*mix(.55,1.0,uSeaDay),seaFoam);
        #include <opaque_fragment>`).replace('#include <premultiplied_alpha_fragment>',`
        if(uShore3>.5&&seaFoam>.04)gl_FragColor.rgb=min(gl_FragColor.rgb,vec3(.85));
        #include <premultiplied_alpha_fragment>`);
    };
    if(sea2){
      const legacyCompile=material.onBeforeCompile;
      material.onBeforeCompile=shader=>{legacyCompile(shader);shader.fragmentShader=seaFarFragment(shader.fragmentShader);if(sea3)shader.fragmentShader=sea3Fragment(shader.fragmentShader);if(sea4)shader.fragmentShader=sea4Fragment(shader.fragmentShader);if(data.meta?.sea?.surf_scale!==undefined)shader.fragmentShader=seaSurfScaleFragment(shader.fragmentShader,{sea3});};
    }
    if(withOpen){const compile=material.onBeforeCompile;material.onBeforeCompile=shader=>{compile(shader);shader.fragmentShader=seaShelterFragment(shader.fragmentShader,{sea2,sea3,...(swell?{swell:true}:{})});};}
    if(duskSea){
      const color=duskSeaColor(new THREE.Color(sky.zenith).toArray(),new THREE.Color(sky.fogColor).toArray(),new THREE.Color(sky.hazeCool??sky.fogColor).toArray());
      u.uDuskSea={value:new THREE.Color().fromArray(color)};
      u.uDuskSkyCool={value:new THREE.Color(sky.hazeCool??sky.fogColor)};
      u.uDuskSkyWarm={value:new THREE.Color(sky.hazeWarm??sky.fogColor)};
      u.uDuskSkyPower={value:sky.hazeExp};
      const compile=material.onBeforeCompile;
      material.onBeforeCompile=shader=>{compile(shader);Object.assign(shader.uniforms,{uDuskSea:u.uDuskSea,uDuskSkyCool:u.uDuskSkyCool,uDuskSkyWarm:u.uDuskSkyWarm,uDuskSkyPower:u.uDuskSkyPower});shader.fragmentShader=seaDuskFragment(shader.fragmentShader,search);};
    }
    if(disc){const compile=material.onBeforeCompile;material.onBeforeCompile=shader=>{compile(shader);shader.fragmentShader=seaDiscFragment(shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float uDiscPath; uniform float uDiscPathDebug; uniform float uDiscPathDetail;'),{path:sunPath});};}
    const legacyCacheKey=()=> swell?'kamakura-sea-19-swell-'+(+shelter)+(+sea2)+(+sea3):shelter?'kamakura-sea-19-shelter-'+(+sea2)+(+sea3):sea3?'kamakura-sea-19-foam':sea2?'kamakura-sea-18-far':'kamakura-sea-11-shore6';
    material.customProgramCacheKey=()=>legacyCacheKey()+(sea2&&data.meta?.sea?.surf_scale!==undefined?'-surf-scale':'')+(disc?'-disc'+(sunPath?'-path2':''):'')+(duskSea?'-dusk-sea':'');
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
      // Parent (real Chrome, the real-size map): with the openness in the same throttled job the whole field arrived after
      // 20-60 s instead of 1.5 s, and until then the sea had no surf at all (the start-up field read as closed everywhere).
      // The distance keeps its original pace and is shown first, open everywhere; the openness follows at its own slow pace.
      const start=performance.now();let frameWork=0;
      while(jobIndex<jobs.length) {
        // withOpen: the job has a slow part after the distance (openness, and the facing to the swell).
        const job=jobs[jobIndex],slow=withOpen&&distanceShown;
        if(performance.now()-start>=(slow?SHELTER.budgetMs:SHORE_FRAME_BUDGET_MS)||(slow&&frameWork>=SHELTER.maxFrameWork))break;
        const batch=slow?SHELTER.batchCells:2048;frameWork+=batch;
        if(!(slow||!withOpen?job.step(batch):job.step(batch,5)))continue;
        const f=job.field;
        if(!packed){packed=new Uint16Array(f.data.length*channels);packCursor=0;}
        const end=Math.min(packCursor+(slow?SHELTER.packCells:8192),f.data.length);
        for(;packCursor<end;packCursor++){
          packed[packCursor*channels]=THREE.DataUtils.toHalfFloat(f.data[packCursor]);
          if(sea2)packed[packCursor*channels+1]=THREE.DataUtils.toHalfFloat(beachGain(f,packCursor));
          if(withOpen)packed[packCursor*channels+(sea2?2:1)]=THREE.DataUtils.toHalfFloat(slow?f.openness[packCursor]:1);
          if(swell)packed[packCursor*channels+3]=THREE.DataUtils.toHalfFloat(slow?f.swellGain[packCursor]:1);
        }
        if(packCursor<f.data.length)continue;
        // W2c-9 parent fix: swapping the image of the 1x1 placeholder does not resize its GPU storage (WebGL2 texStorage2D is immutable),
        // so the shader kept sampling the placeholder (landDistance = 3000 everywhere: deep colour, no foam, no wet sand). Make a NEW texture;
        // Sea and sand share its red distance channel (RG16F with sea2; legacy R16F otherwise).
        const done=new THREE.DataTexture(packed,f.w,f.h,format,THREE.HalfFloatType);
        done.minFilter=done.magFilter=THREE.LinearFilter;done.generateMipmaps=false;done.unpackAlignment=1;done.needsUpdate=true;textures.push(done);
        u.uShoreSea.value=done;u.uShoreLand.value=done;packed=null;
        u.uShoreGrid.value.set(f.x0+4-f.cell/2,f.z0+4-f.cell/2,f.cell*f.w,f.cell*f.h);
        u.uShoreReady.value=1;terrain.shoreSigned=f;props?.setAdapt(step);
        // The texture that showed the distance alone is released once the one with the openness has taken its place.
        if(interim){textures.splice(textures.indexOf(interim),1);interim.dispose();interim=null;}
        if(withOpen&&!distanceShown){distanceShown=true;interim=done;}else jobIndex++;
      }
      props.update(pos);bank?.update(pos);
    },
    setAdapt(value){step=typeof value==='number'?value:value.step;if(disc){u.uDiscPath.value=disc.enabled?(quality==='light'||step>=2?SUN_DISC.seaReduced:1):0;u.uDiscPathDetail.value=quality==='light'||step>=2?0:1;}if(sea4)u.uSea4Glitter.value=+(disc?.enabled!==false&&sea4GlitterEnabled(search,quality,step));if(sea3){u.uSea3.value=step<3?1:0;u.uSea3Lines.value=sea3Count(quality,step);u.uSea3Detail.value=quality==='light'||step>=2?0:1;}if(sea2){u.uSea2.value=sea3||step<3?1:0;u.uSea2Swell.value=quality==='light'||step>=2?SEA_FAR.reducedSwell:1;u.uSea2Lines.value=seaLineCount(quality,sea3&&step>=3?2:step);}u.uShore6.value=shore6&&step<3?(quality==='light'||step>=2?.5:1):0;u.uShore4.value=shore4&&step<3?(step>=2?.45:1):0;u.uShoreWet5.value=u.uShore4.value;u.uShore4Detail.value=quality==='light'||step>=2?0:1;u.uShore3.value=shore3&&step<3?1:0;u.uShoreBands.value=step>=3?0:quality==='light'||step>=2?1:3;u.uShoreDetail.value=quality==='light'||step>=2?0:1;u.uShoreAnimate.value=step>=3?0:1;if(enabled)material.envMapIntensity=step>=3?0:.5;props?.setAdapt(step);bank?.setAdapt(quality==='light'?Math.max(2,step):step);},
    dispose(){if(disposed)return;disposed=true;if(globalThis.__kzSunPath===sunReader)delete globalThis.__kzSunPath;if(globalThis.__kzSea3===sea3Reader)delete globalThis.__kzSea3;if(globalThis.__kzSea2===debugReader)delete globalThis.__kzSea2;if(enabled){unregisterShoreView(data);if(terrain.shoreSigned===jobs[0].field||terrain.shoreSigned===preview?.field)delete terrain.shoreSigned;}props?.dispose();bank?.dispose();group.removeFromParent();geometry.dispose();material.dispose();for(const texture of textures)texture.dispose();}
  };
}
