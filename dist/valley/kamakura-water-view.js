import { PHOTO_GLSL, PHOTO_TEX_DATA, photoSampler, photoBlendUniform } from './kamakura-photo-tex.js';
import { shore6Enabled, SHORE_R6_GLSL } from './kamakura-shore-r6.js';
// Valley water appearance copied unchanged in style; distance gate and standard fog added for Kamakura.
// Keep water.js independent. MeshStandardMaterial includes the installed atmosphere fog chunks.
import * as THREE from 'three';
import { shore2Enabled, shore3Enabled, FOAM_LINEAR_MAX, SHORE_GLSL, bankCrossingDistance } from './kamakura-shore.js';
import { WATER_ALPHA } from './kamakura-fx.js';
import { shore4Enabled, riverFlow, FOAM_LINEAR_MAX5, SHORE_R4_GLSL } from './kamakura-shore-r4.js';
import { atmosphereOptions, kamakuraAtmosphere, eveningEnabled } from './kamakura-atmosphere.js';
import { ATMOS } from './atmosphere.js';
export function buildKamakuraWater(prepared, { sunDir = new THREE.Vector3(.5, .17, .85), terrain = null, search = '', quality = 'standard' } = {}) {
  const shore6=shore6Enabled(search),shore2=shore2Enabled(search),shore3=shore3Enabled(search),shore4=shore4Enabled(search);
  const sky=kamakuraAtmosphere(atmosphereOptions(search).time,{...ATMOS,sunDir:ATMOS.sunDir.toArray()},eveningEnabled(search),quality==='light'?.55:1);
  const flows=new Map((shore4?prepared.ribbons||[]:[]).map(r=>[r.id,riverFlow(r,terrain)]));
  const group = new THREE.Group(); group.name = 'kamakura-rivers';
  const uniforms = { uRiverPebbles6:photoSampler('groundPebbles'),uPhotoBlend:photoBlendUniform, uShore6:{value:shore6?(quality==='light'?.5:1):0}, uShore4:{value:+shore4},uShore4Detail:{value:quality==='light'?0:1},uWaterSkyMid:{value:new THREE.Color(sky.mid)},uWaterSkyHorizon:{value:new THREE.Color(sky.horizon)},uWaterSun:{value:new THREE.Color(sky.sunColor)}, uShore3:{value:+shore3},uShore2:{value:+shore2},uRiverBands:{value:quality==='light'?1:2}, uTime: { value: 0 } };
  const material = new THREE.MeshStandardMaterial({ color: shore4?0xffffff:0x23565c, roughness: 0.09, metalness: 0.0, transparent: true, opacity: 1, depthWrite: false, envMapIntensity: shore3?.95:shore2?(quality==='light'?1.2:1.65):0.95 });
  material.fog = true;
  material.onBeforeCompile = shader => {
    shader.uniforms.uWaterAlpha = { value: new THREE.Vector3(WATER_ALPHA.shallow, WATER_ALPHA.deep, WATER_ALPHA.depth) };
    Object.assign(shader.uniforms,uniforms); shader.uniforms.uTime = uniforms.uTime; shader.uniforms.uWaterDistance = { value: prepared.policy.maxDistance }; shader.uniforms.SUN_DIR_W = { value: sunDir.clone().normalize() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 waterFlow;varying vec4 vWFlow;attribute float waterTurn;varying float vWTurn;attribute vec3 waterFoamShape;varying vec3 vWFoamShape;attribute vec2 waterBanks; varying vec2 vWBanks; attribute float waterDepth; attribute float waterHalfWidth; varying float vWHalf; varying vec2 vWUv; varying vec3 vWPos; varying float vWDepth;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWFlow=waterFlow;vWTurn=waterTurn;vWFoamShape=waterFoamShape;vWBanks=waterBanks; vWHalf=waterHalfWidth; vWDepth = waterDepth; vWUv = uv; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${SHORE_GLSL}
        ${SHORE_R4_GLSL}
        ${SHORE_R6_GLSL}
        ${PHOTO_GLSL}
        uniform sampler2D uRiverPebbles6;uniform float uPhotoBlend;
        varying vec4 vWFlow;varying float vWTurn;uniform vec3 uWaterSun;
        uniform float uRiverBands;varying vec3 vWFoamShape;varying float vWHalf;varying vec2 vWBanks;
        uniform vec3 uWaterAlpha; uniform float uWaterDistance; uniform float uTime; varying vec2 vWUv; varying vec3 vWPos; varying float vWDepth; uniform vec3 SUN_DIR_W;
        float w_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float w_noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(w_hash(i), w_hash(i + vec2(1., 0.)), f.x), mix(w_hash(i + vec2(0., 1.)), w_hash(i + vec2(1.)), f.x), f.y); }
        float w_fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * w_noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
        float w_height(vec2 p) { return w_fbm(p * vec2(0.9, 0.55) + vec2(0.0, -uTime * 0.55)) + 0.5 * w_fbm(p * 2.1 + vec2(uTime * 0.18, -uTime * 0.9)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // Derivatives precede the distance discard and all effect branches.
        float riverPixel6=max(length(fwidth(vWPos.xz)),.001);
        vec2 bedUv6=vWPos.xz/${PHOTO_TEX_DATA.groundPebbles.meters.toFixed(2)};
        vec2 bedDx6=dFdx(bedUv6),bedDy6=dFdy(bedUv6);
        float waterDistance = length(vWPos.xz - cameraPosition.xz);
        if (waterDistance >= uWaterDistance) discard;
        diffuseColor.a *= 1.0 - smoothstep(uWaterDistance - 128.0, uWaterDistance, waterDistance);
        float edge = abs(vWUv.x);
        // W2c-9d: uniform opacity -> depth/edge transparency, retain the existing distance and bank fades.
        diffuseColor.a *= mix(uWaterAlpha.x, uWaterAlpha.y, (1.0-clamp(edge,0.0,1.0))*clamp(vWDepth/uWaterAlpha.z,0.0,1.0));
        vec3 deep = vec3(0.035, 0.12, 0.15), shallow = vec3(0.14, 0.27, 0.26);
        diffuseColor.rgb = mix(deep, shallow, smoothstep(0.35, 1.0, edge));
        // W2c-9r2 shore: lower diffuse wash / gentler ripples restore PMREM cloud contrast.
        // W2c-9r1 shore: normalized channel edge -> shared bank distance in metres.
        float bankD=max(0.0,min(vWBanks.x+vWUv.x*vWHalf,vWBanks.y-vWUv.x*vWHalf));
        if(uShore2>.5)diffuseColor.rgb=mix(vec3(.11,.14,.12),deep,smoothstep(0.0,5.0,bankD));
        // W2c-9r3 shore: blue-green depth pigment, translucent sand at shallow banks.
        float tone3=smoothstep(0.0,1.0,min(bankD/3.0,vWDepth/.8));
        if(uShore3>.5){diffuseColor.rgb=mix(vec3(.16,.21,.13),vec3(.025,.145,.20),tone3);diffuseColor.a=mix(.32,.85,tone3)*(1.0-smoothstep(uWaterDistance-128.0,uWaterDistance,waterDistance));}
        // W2c-10 shore4: opaque fixed bank pigment -> depth absorption with sky-derived light.
        float waterCosine=abs(normalize(cameraPosition-vWPos).y);
        if(uShore4>.0){
          float depth4=max(0.0,min(vWDepth,bankD*.6));
          diffuseColor.rgb=mix(riverColor4(depth4),riverColor5(depth4),uShore4);
          diffuseColor.a=mix(waterAlpha4(vWDepth,bankD,waterCosine),waterOpacity5(vWDepth,bankD,waterCosine),uShore4)*(1.0-smoothstep(uWaterDistance-128.0,uWaterDistance,waterDistance));
        }
        // W2c-11 shore6: uniform pigment -> sand-visible shallows and blue-green depth.
        if(uShore6>0.0){
          float depthTone6=riverDepth6(vWDepth,bankD);
          vec3 depthColor6=mix(vec3(.18,.20,.12),vec3(.02,.085,.105),depthTone6);
          // Photo-derived bottom detail: mean-one ratio only, no source photograph colour.
          float bedGain6=.35*uPhotoBlend*(1.0-depthTone6)*(1.0-smoothstep(.15,1.0,riverPixel6));
          if(bedGain6>0.0){vec3 bed6=kzPhotoHexGrad(uRiverPebbles6,bedUv6,1.2,1.0,bedDx6,bedDy6);depthColor6*=mix(1.0,bed6.z,bedGain6);}
          diffuseColor.rgb=mix(diffuseColor.rgb,depthColor6,uShore6);
        }
        float foam=0.0,streak=0.0,rapid=0.0;
        if(uShore2<.5){
        foam = smoothstep(0.80, 0.98, edge) * smoothstep(0.35, 0.8, w_fbm(vWPos.xz * 1.6 + vec2(0.0, -uTime * 0.6)));
        streak = smoothstep(0.72, 0.9, w_fbm(vWPos.xz * vec2(2.4, 0.7) + vec2(0.0, -uTime * 0.8))) * 0.35;
        // 白波：流れの筋に沿った細い泡の帯を、中ほどにも散らす（平らな灰青の面に見えた）。瀬の位置は川に沿った低周波のむらで決める
        rapid = smoothstep(0.55, 0.8, w_fbm(vec2(vWUv.y * 0.035, 3.7))) * smoothstep(0.35, 0.7, w_fbm(vWPos.xz * vec2(3.6, 1.1) + vec2(0.0, -uTime * 1.3))) * (1.0 - smoothstep(0.75, 1.0, edge)) * 0.75;
        }
        if(uShore2>.5&&uShore3<.5){
          foam=0.0;rapid=0.0;streak=0.0;
          if(uRiverBands>.5)foam=riverBankFoam(bankD,vWPos.xz,uTime,length(fwidth(vWPos.xz)));
          if(uRiverBands>1.5)foam+=.22*riverBankFoam(bankD-.7,vWPos.xz+vec2(13.7,8.3),uTime,length(fwidth(vWPos.xz)));
        }
        if(uShore3>.5){
          float slope3=vWBanks.x+vWUv.x*vWHalf<vWBanks.y-vWUv.x*vWHalf?vWFoamShape.y:vWFoamShape.z;
          float bend3=vWFoamShape.x;
          if(uShore4>.0){
            // Positive turn bends toward ribbon right (+across): outer bank is the opposite side.
            bend3*=1.0+max(0.0,-sign(vWTurn)*vWUv.x)*1.4;
            slope3=max(slope3,min(1.0,abs(vWFlow.z)/max(1.0,vWHalf)));
          }
          foam=uRiverBands>.5?riverBankFoam3(bankD,vWPos.xz,uTime,length(fwidth(vWPos.xz)),bend3,slope3)*(uRiverBands>1.5?1.0:.55):0.0;
        }
        // W2c-10b shore5: uniform luminous rim -> energetic shallow patches only.
        if(uShore4>.0){
          float bankSlope5=vWBanks.x+vWUv.x*vWHalf<vWBanks.y-vWUv.x*vWHalf?vWFoamShape.y:vWFoamShape.z;
          float depth5=max(0.0,min(vWDepth,bankD*.6));
          float localSpeed5=abs(vWFlow.z)*(1.0-.6*edge*edge);
          foam*=riverFoam5(depth5,bankSlope5,localSpeed5,vWTurn)*uShore4;
          rapid=0.0;streak=0.0;
        }
        if(uShore6>0.0)foam=mix(foam,riverFoam6(bankD,vWPos.xz,uTime,riverPixel6,vWTurn,vWUv.x)*uShore4,uShore6);
        if(uShore4<=0.0)diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.88), clamp(foam + rapid + streak * (1.0 - edge), 0.0, 0.88));
        if(uShore3>.5&&uShore4<=0.0)diffuseColor.rgb=mix(mix(vec3(.16,.21,.13),vec3(.025,.145,.20),tone3),vec3(.53,.59,.57),foam*.65);
        if(uShore4>.0)diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.32,.36,.33),foam*.45);
        // W2c-11 shore6: fixed .18m rim -> irregular .15–.4m feather; physical buffers unchanged.
        float rim6=uShore2>.5?smoothstep(0.0,.18,bankD):1.0-smoothstep(0.93,1.0,edge);
        diffuseColor.a *= uShore6>0.0?mix(rim6,edgeAlpha6(bankD,vWPos.xz),uShore6):rim6;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 p = vWPos.xz; float e = 0.16;
          float flowPixel6=max(length(fwidth(vec2(vWUv.x*vWHalf,vWUv.y))),.001);
          // W2c-10 shore4: finite differences in channel metres, then rotate slopes back to world XZ.
          if(uShore4>.0){
            vec2 channel=vec2(vWUv.x*vWHalf,vWUv.y);
            // W2c-10b shore5: equal stripes -> 48m strength/spacing variation.
            float broad5=riverMacro5(vWPos.xz);
            channel.x=channel.x*(.65+.7*broad5)+3.0*(broad5-.5);
            float h,ha,hl;
            if(uShore6>0.0){
              vec2 gains6=vec2(.35+.65*shoreNoise(p/16.0),.65*(.35+.65*shoreNoise(p/16.0+11.0)));
              vec2 channel6=vec2(vWUv.x*vWHalf,vWUv.y);
              gains6*=uShore6;
              float speed6=vWFlow.z*(1.0-.6*edge*edge);
              h=riverHeight6(channel6,uTime,speed6,gains6);
              ha=riverHeight6(channel6+vec2(e,0.0),uTime,speed6,gains6);
              hl=riverHeight6(channel6+vec2(0.0,e),uTime,speed6,gains6);
            }else{
              h=riverHeight4(channel,uTime,vWFlow.z,vWUv.x);
              ha=riverHeight4(channel+vec2(e,0.0),uTime,vWFlow.z,vWUv.x);
              hl=riverHeight4(channel+vec2(0.0,e),uTime,vWFlow.z,vWUv.x);
            }
            vec2 tangent=normalize(vWFlow.xy),acrossDir=vec2(-tangent.y,tangent.x);
            vec2 slope=(acrossDir*(h-ha)+tangent*(h-hl))*vWFlow.w/e;
            slope*=riverStreak5(vWFlow.z,vWUv.x,broad5)*uShore4*(1.0-smoothstep(60.0,200.0,waterDistance));
            slope*=mix(1.0,1.0-smoothstep(.16,.9,flowPixel6),uShore6);
            vec3 nw4=normalize(vec3(slope.x,1.0,slope.y));
            normal=normalize(mix(normal,normalize((viewMatrix*vec4(nw4,0.0)).xyz),.65));
          }else{
          float h0 = w_height(p), hx = w_height(p + vec2(e, 0.0)), hz = w_height(p + vec2(0.0, e));
          vec3 nw = normalize(vec3((h0 - hx) * (uShore2>.5?.45:.9), 1.0, (h0 - hz) * (uShore2>.5?.45:.9)));
          normal = normalize(mix(normal, normalize((viewMatrix * vec4(nw, 0.0)).xyz), uShore2>.5?.65:.85));
          }
        }`)
      // 夕日の照り返し：太陽の方向へ細い光の筋が水面に伸びる（波の法線で割れる）。見る角度が浅いほど強い
      .replace('#include <opaque_fragment>', `
        {
          vec3 vdir = normalize(vWPos - cameraPosition);
          vec3 wn = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          vec3 rf = reflect(vdir, wn);
          float glint = pow(max(dot(rf, SUN_DIR_W), 0.0), 90.0) * 3.0 + pow(max(dot(rf, SUN_DIR_W), 0.0), 14.0) * 0.35;
          // W2c-10b shore5: retain PMREM sky reflection; grazing sky fills its horizon.
          if(uShore4>.0){float f4=waterFresnel4(dot(-vdir,wn));outgoingLight=mix(outgoingLight,mix(uWaterSkyMid,uWaterSkyHorizon,1.0-abs(vdir.y)),f4*.42);}

          outgoingLight += (uShore4>.0?uWaterSun:vec3(1.0, 0.78, 0.55)) * glint * (1.0 - abs(vdir.y));
        }
        // Bound the complete reflected/lit foam film before tone mapping; water reflection stays intact.
        if(uShore3>.5){outgoingLight=mix(outgoingLight,uShore4>.0?vec3(.32,.36,.33):vec3(.49,.56,.53),foam*.65);if(foam>.04)outgoingLight=min(outgoingLight,vec3(uShore4>.0?${FOAM_LINEAR_MAX5}:${FOAM_LINEAR_MAX}));}
        #include <opaque_fragment>`).replace('#include <premultiplied_alpha_fragment>',`
        if(uShore3>.5&&foam>.04)gl_FragColor.rgb=min(gl_FragColor.rgb,vec3(.85));
        #include <premultiplied_alpha_fragment>`);
  };
  material.customProgramCacheKey = () => 'kamakura-water-11-shore6';
  let disposed = false,bankCursor=0,bankBudget=quality==='light'?.15:.35;
  const bankJobs=[];
  function dispose() {
    if (disposed) return; disposed = true;
    for (const mesh of group.children) mesh.geometry.dispose();
    group.clear(); group.removeFromParent(); material.dispose();bankJobs.length=0;
  }
  try {
    for (const chunk of prepared.chunks) {
      const geometry = new THREE.BufferGeometry();
      // Attach before filling so that partial construction is also owned by dispose().
      const mesh = new THREE.Mesh(geometry, material); group.add(mesh);
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(chunk.positions, 3));
      const banks=new Float32Array(chunk.positions.length/3*2);
      const widths=new Float32Array(chunk.positions.length/3);
      const shapes=new Float32Array(chunk.positions.length);
      const flowData=new Float32Array(chunk.positions.length/3*4),turns=new Float32Array(chunk.positions.length/3);
      const flow=shore4?(flows.get(chunk.riverId)||riverFlow(chunk,terrain)):{sign:1,speed:.12,amplitude:.18};
      const depths = new Float32Array(chunk.positions.length / 3);
      // Ribbon vertices are stored in left/right pairs, so sample the channel bed once per pair.
      for (let i = 0; i < depths.length; i += 2) {
        const k = i * 3, x = (chunk.positions[k] + chunk.positions[k + 3]) / 2, z = (chunk.positions[k + 2] + chunk.positions[k + 5]) / 2;
        widths[i]=widths[i+1]=Math.hypot(chunk.positions[k]-chunk.positions[k+3],chunk.positions[k+2]-chunk.positions[k+5])/2;
        // W2c-9r3 shore: physical bend and each bank slope modulate the irregular foam.
        const prev=Math.max(0,k-6),next=Math.min(chunk.positions.length-6,k+6),p=chunk.positions;
        const ax=x-(p[prev]+p[prev+3])/2,az=z-(p[prev+2]+p[prev+5])/2;
        const bx=(p[next]+p[next+3])/2-x,bz=(p[next+2]+p[next+5])/2-z;
        const bend=Math.abs(ax*bz-az*bx)/Math.max(.001,Math.hypot(ax,az)*Math.hypot(bx,bz));
        const turn=(ax*bz-az*bx)/Math.max(.001,Math.hypot(ax,az)*Math.hypot(bx,bz));
        const tx=(p[k+5]-p[k+2])/(2*Math.max(.001,widths[i])),tz=-(p[k+3]-p[k])/(2*Math.max(.001,widths[i]));
        for(let side=0;side<2;side++){const f=(i+side)*4;flowData[f]=tx;flowData[f+1]=tz;flowData[f+2]=flow.sign*flow.speed;flowData[f+3]=flow.amplitude;turns[i+side]=turn;}
        for(let side=0;side<2;side++){const q=(i+side)*3;shapes[q]=bend;shapes[q+1]=shapes[q+2]=.3;}
        banks[i*2]=banks[i*2+1]=banks[(i+1)*2]=banks[(i+1)*2+1]=widths[i];
        depths[i] = depths[i + 1] = terrain ? Math.max(0, chunk.positions[k + 1] - terrain.heightAt(x, z)) : .5;
      }
      geometry.setAttribute('waterFlow',new THREE.Float32BufferAttribute(flowData,4));
      geometry.setAttribute('waterTurn',new THREE.Float32BufferAttribute(turns,1));
      geometry.setAttribute('waterFoamShape',new THREE.Float32BufferAttribute(shapes,3));
      geometry.setAttribute('waterBanks',new THREE.Float32BufferAttribute(banks,2));
      geometry.setAttribute('waterHalfWidth',new THREE.Float32BufferAttribute(widths,1));
      geometry.setAttribute('waterDepth', new THREE.Float32BufferAttribute(depths, 1));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(chunk.uvs, 2));
      geometry.setIndex(chunk.indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
      if(shore2&&terrain)bankJobs.push({geometry,positions:chunk.positions,banks:geometry.attributes.waterBanks.array,shapes:geometry.attributes.waterFoamShape.array,widths,cursor:0});
      mesh.name = 'kamakura-water'; mesh.renderOrder = 2; mesh.frustumCulled = true;
    }
    return { group, material, uniforms, setAdapt(step){uniforms.uShore6.value=shore6&&step<3?(quality==='light'||step>=2?.5:1):0;uniforms.uShore4.value=shore4&&step<3?(step>=2?.45:1):0;uniforms.uShore4Detail.value=quality==='light'||step>=2?0:1;uniforms.uShore3.value=shore3&&step<3?1:0;bankBudget=step>=3?0:quality==='light'||step>=2?.15:.35;material.envMapIntensity=shore3||!shore2||step>=3?.95:quality==='light'||step>=2?1.2:1.65;uniforms.uRiverBands.value=step>=3?0:quality==='light'||step>=2?1:2;}, get preparedBanks(){return bankCursor>=bankJobs.length;}, update(time) {
      if(disposed)return;uniforms.uTime.value=time;if(bankCursor>=bankJobs.length||bankBudget===0)return;
      // W2c-9r2 shore: avoid blocking startup on all cross-sections; neutral nominal
      // widths render immediately, each completed chunk publishes once, no frame allocations.
      const start=performance.now();
      for(let n=0;n<64&&bankCursor<bankJobs.length&&performance.now()-start<bankBudget;n++){
        const job=bankJobs[bankCursor],i=job.cursor,k=i*3,p=job.positions;
        const x=(p[k]+p[k+3])/2,z=(p[k+2]+p[k+5])/2,half=job.widths[i];
        for(let side=0;side<2;side++){
          const nx=(p[k+side*3]-x)/half,nz=(p[k+side*3+2]-z)/half;
          const reach=bankCrossingDistance(terrain,x,z,p[k+1],nx,nz,half);
          if(shore3){
            const a=terrain.heightAt(x+nx*(reach+.3),z+nz*(reach+.3)),b=terrain.heightAt(x+nx*(reach-.3),z+nz*(reach-.3));
            const slope=Math.min(1,Math.abs(a-b)/.6);
            job.shapes[i*3+1+side]=job.shapes[(i+1)*3+1+side]=slope;
          }
          job.banks[i*2+side]=job.banks[(i+1)*2+side]=reach;
        }
        job.cursor+=2;
        if(job.cursor===job.widths.length){job.geometry.attributes.waterBanks.needsUpdate=true;job.geometry.attributes.waterFoamShape.needsUpdate=true;bankCursor++;}
      }
    }, dispose };
  } catch (error) { dispose(); throw error; }
}
