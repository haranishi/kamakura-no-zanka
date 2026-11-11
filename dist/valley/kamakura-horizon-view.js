import * as THREE from '../vendor/three.module.min.js';
import { HORIZON, validateHorizon, buildHorizon } from './kamakura-horizon.js';
import { atmosphereOptions, KAMAKURA_TIMES } from './kamakura-atmosphere.js';
// Infinite-distance directions bypass camera translation; far depth lets every real surface occlude them.
export function createKamakuraHorizon({scene,camera,data,atmosphere,search='',quality='standard'}) {
  if(new URLSearchParams(search).get('horizon')==='0')return null;
  const items=validateHorizon(data?.meta?.horizon);if(!items?.length)return null;
  const q=new URLSearchParams(search),debug=q.get('debug')==='1',colors=q.get('horizondebug')==='1';
  const a=atmosphere?.atmosphere?.params??{...KAMAKURA_TIMES.noon,...KAMAKURA_TIMES[atmosphereOptions(search).time]};
  const prepared=buildHorizon(items,quality),geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(prepared.positions,3));
  geometry.setAttribute('horizonKind',new THREE.BufferAttribute(prepared.kinds,1));
  geometry.setAttribute('horizonHeight',new THREE.BufferAttribute(prepared.heights,1));
  const skyHaze=new THREE.Color(a.horizon),haze=new THREE.Color(a.hazeCool??a.fogColor),base=new THREE.Color(a.mid).lerp(new THREE.Color(a.fogColor),HORIZON.skyMix);
  const palette=['range','headland','island'].map(kind=>colors?new THREE.Color(HORIZON.debug[kind]):base.clone().multiplyScalar(HORIZON.gain[kind]).lerp(haze,HORIZON.haze[kind]));
  const material=new THREE.ShaderMaterial({depthTest:true,depthWrite:false,fog:false,side:THREE.DoubleSide,
    uniforms:{horizonPalette:{value:palette},horizonHaze:{value:skyHaze},horizonDebug:{value:+colors}},
    vertexShader:`attribute float horizonKind,horizonHeight; varying float vHorizonKind,vHorizonHeight;
      void main(){vHorizonKind=horizonKind;vHorizonHeight=horizonHeight;
        vec4 horizonClip=projectionMatrix*vec4(mat3(viewMatrix)*position,1.0);
        gl_Position=vec4(horizonClip.xy,horizonClip.w*${HORIZON.depth.toFixed(8)},horizonClip.w);
      }`,
    fragmentShader:`uniform vec3 horizonPalette[3],horizonHaze;uniform float horizonDebug;
      varying float vHorizonKind,vHorizonHeight;
      void main(){
        vec3 horizonColor=vHorizonKind<.5?horizonPalette[0]:vHorizonKind<1.5?horizonPalette[1]:horizonPalette[2];
        float horizonFade=smoothstep(0.0,${HORIZON.baseFade.toFixed(8)},vHorizonHeight);
        gl_FragColor=vec4(mix(horizonHaze,horizonColor,max(horizonFade,horizonDebug)),1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
  const mesh=new THREE.Mesh(geometry,material);mesh.name='kamakura-horizon';mesh.frustumCulled=false;mesh.renderOrder=HORIZON.renderOrder;scene.add(mesh);
  let step=0,disposed=false;
  function apply(){const lod=prepared.lods[step];geometry.setDrawRange(lod.start,lod.vertices);mesh.visible=lod.count>0;}
  apply();
  const reader=()=>{
    const lod=prepared.lods[step];let nearest=null,delta=Infinity;
    const e=camera?.matrixWorld?.elements,bearing=e?(Math.atan2(-e[8],e[10])*180/Math.PI+360)%360:0;
    for(let i=0;i<lod.count;i++){
      const d=Math.abs(((items[i].bearing_deg-bearing+540)%360)-180);
      if(d<delta){delta=d;nearest=items[i];}
    }
    return {count:disposed?0:lod.count,triangles:disposed?0:lod.triangles,draws:disposed?0:lod.draws,step,
      preparationWork:prepared.work,verticesPrepared:prepared.positions.length/3,frameWork:0,nearest:{distance:null,bearing:nearest?.bearing_deg??null,infinite:true}};
  };
  if(debug)globalThis.__kzHorizon=reader;
  return {mesh,prepared,setAdapt(value){if(disposed)return;step=Math.max(0,Math.min(3,Math.floor(typeof value==='number'?value:value.step)));apply();},
    dispose(){if(disposed)return;disposed=true;mesh.removeFromParent();geometry.dispose();material.dispose();if(globalThis.__kzHorizon===reader)delete globalThis.__kzHorizon;}};
}
