import * as THREE from '../vendor/three.module.min.js';
import { atmosphereOptions, KAMAKURA_TIMES } from './kamakura-atmosphere.js';
import { MIST_NOISE_GLSL } from './kamakura-mist.js';
import { WISP as C, validateWisps, wispEnabled, wispTime, wispNear, buildWisps } from './kamakura-wisp.js';
const f=n=>Number(n).toFixed(8);
export const WISP_VERTEX=`
attribute float wispDepth,wispSource;
attribute vec2 wispUv;
varying float vWispDepth,vWispFade;
varying vec2 vWispUv;
varying vec3 vWispWorld;
uniform float wispFades[${C.maxItems}];
#include <fog_pars_vertex>
void main(){
  vWispDepth=wispDepth;vWispFade=wispFades[int(wispSource+.5)];vWispUv=wispUv;vWispWorld=position;
  vec4 mvPosition=modelViewMatrix*vec4(position,1.0);
  gl_Position=projectionMatrix*mvPosition;
  #include <fog_vertex>
}`;
export const WISP_FRAGMENT=`
uniform float wispClock,wispGain,wispDebug,wispHazeExp;
uniform vec2 wispWind;
uniform vec3 wispCool,wispWarm,wispSun;
varying float vWispDepth,vWispFade;
varying vec2 vWispUv;
varying vec3 vWispWorld;
#include <fog_pars_fragment>
${MIST_NOISE_GLSL}
void main(){
  float radial=length(vWispUv);
  if(radial>=1.0)discard;
  vec2 p=(vWispWorld.xz-wispWind*wispClock*${f(C.noiseSpeedMps)})/vec2(${f(C.noiseM*C.noiseStretch)},${f(C.noiseM)});
  float grain=${f(C.noiseBase)}+${f(1-C.noiseBase)}*kzMistNoise(p);
  float alpha=${f(C.opacityCap)}*vWispDepth*(1.0-smoothstep(${f(C.edgeStart)},1.0,radial))*grain*vWispFade*wispGain;
  vec3 ray=normalize(vWispWorld-cameraPosition);
  float warm=clamp(pow(max(0.0,dot(ray,wispSun)),wispHazeExp)+${f(C.warmBase)},0.0,1.0);
  gl_FragColor=vec4(mix(wispCool,wispWarm,warm),alpha);
  #include <fog_fragment>
  if(wispDebug>.5){gl_FragColor=vec4(${C.debugRGB.map(f).join(',')},1.0);}
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
export function createKamakuraWisp({scene,camera,data,terrain,atmosphere,search='',quality='standard'}){
  if(!wispEnabled(search))return null;
  const items=validateWisps(data?.meta?.wisps);if(!items?.length)return null;
  const q=new URLSearchParams(search),paint=q.get('wispdebug')==='1',time=wispTime(atmosphereOptions(search).time);
  const a=atmosphere?.atmosphere?.params??{...KAMAKURA_TIMES.noon,...KAMAKURA_TIMES[atmosphereOptions(search).time]};
  const prepared=buildWisps(items,terrain,quality),geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(prepared.positions,3));
  geometry.setAttribute('wispDepth',new THREE.BufferAttribute(prepared.depths,1));
  geometry.setAttribute('wispSource',new THREE.BufferAttribute(prepared.sources,1));
  geometry.setAttribute('wispUv',new THREE.BufferAttribute(prepared.uvs,2));geometry.setIndex(new THREE.BufferAttribute(prepared.indices,1));
  const cool=new THREE.Color(a.fogColor).multiplyScalar(C.brightness),warm=cool.clone().lerp(new THREE.Color(a.hazeWarm??a.fogColor).multiplyScalar(C.brightness),C.warmShare);
  const fades=new Float32Array(C.maxItems);fades.fill(1);
  const uniforms={...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),wispFades:{value:fades},wispClock:{value:0},wispGain:{value:time},wispDebug:{value:+paint},wispWind:{value:new THREE.Vector2(1,0)},wispCool:{value:cool},wispWarm:{value:warm},wispHazeExp:{value:a.hazeExp??4},wispSun:{value:atmosphere?.sunDir?.clone()??new THREE.Vector3(...a.sunDir)}};
  const material=new THREE.ShaderMaterial({vertexShader:WISP_VERTEX,fragmentShader:WISP_FRAGMENT,uniforms,transparent:true,depthTest:true,depthWrite:false,fog:true,side:THREE.DoubleSide,forceSinglePass:true});
  const mesh=new THREE.Mesh(geometry,material);mesh.name='kamakura-wisp';mesh.frustumCulled=false;scene.add(mesh);
  let step=0,disposed=false,paused=false,clock=0;
  function apply(){const lod=prepared.lods[step];geometry.setDrawRange(lod.start,lod.indices);mesh.visible=lod.count>0&&(paint||time>0);}
  function refresh(){
    const lod=prepared.lods[step],eye=camera.position;
    for(let i=0;i<lod.count;i++){
      const c=prepared.centres[i],distance=Math.hypot(eye.x-c.x,eye.z-c.z);
      const vertical=Math.min(Math.abs(eye.y-c.top),lod.layers===2?Math.abs(eye.y-c.lower):Infinity);
      const t=Math.max(0,Math.min(1,(distance-lod.range*C.rangeFade)/(lod.range*(1-C.rangeFade))));
      fades[i]=wispNear(distance,vertical)*(1-t*t*(3-2*t));
    }
  }
  apply();refresh();
  const reader=()=>{
    const lod=prepared.lods[step];let nearest=null,dist=Infinity,visible=0;
    for(let i=0;i<lod.count;i++){
      const c=prepared.centres[i],d=Math.hypot(c.x-camera.position.x,c.top-camera.position.y,c.z-camera.position.z);
      if(mesh.visible&&(paint||fades[i]>0))visible++;
      if(d<dist){dist=d;nearest={distance:d,bearing:(Math.atan2(c.x-camera.position.x,-(c.z-camera.position.z))*180/Math.PI+360)%360};}
    }
    return {count:disposed?0:visible,preparedCount:items.length,triangles:disposed||!mesh.visible?0:lod.triangles,draws:disposed||!mesh.visible?0:lod.draws,nearest,timeMultiplier:time,step,preparationWork:prepared.work,frameWork:disposed?0:lod.count};
  };
  if(q.get('debug')==='1')globalThis.__kzWisp=reader;
  return {mesh,prepared,uniforms,
    update(frame){if(disposed)return;if(!paused)clock+=frame.dt;uniforms.wispClock.value=clock;if(frame.windDir)uniforms.wispWind.value.set(frame.windDir[0],frame.windDir[1]);refresh();},
    setAdapt(value){if(disposed)return;step=Math.max(0,Math.min(3,Math.floor(typeof value==='number'?value:value.step)));apply();refresh();},
    setPaused(value){paused=!!value;},
    dispose(){if(disposed)return;disposed=true;mesh.removeFromParent();geometry.dispose();material.dispose();if(globalThis.__kzWisp===reader)delete globalThis.__kzWisp;},
  };
}
