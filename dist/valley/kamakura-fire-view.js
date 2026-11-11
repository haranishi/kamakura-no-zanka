import * as THREE from '../vendor/three.module.min.js';
import { atmosphereOptions } from './kamakura-atmosphere.js';
import { FIRE as C, prepareFires, fireCounts, fireDayGain, FIRE_SMOKE_GLSL } from './kamakura-fire.js';
const gl=n=>Number(n).toFixed(8), rgb=a=>'vec3('+a.map(gl).join(',')+')';
// Value noise follows opening-fire; no textures, geometry animation, clocks or random state on the CPU.
export const FIRE_NOISE_GLSL=`
float fireHash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float fireNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);
return mix(mix(fireHash(i),fireHash(i+vec2(1.0,0.0)),u.x),mix(fireHash(i+vec2(0.0,1.0)),fireHash(i+vec2(1.0,1.0)),u.x),u.y);}
float fireFbm(vec2 p){return fireNoise(p)*0.57+fireNoise(p*2.03+vec2(1.7,9.2))*0.28+fireNoise(p*4.13+vec2(7.1,2.4))*0.15;}
`;
export const FIRE_VERTEX=`
attribute vec4 fireAnchor;
attribute vec4 fireSize;
attribute vec2 fireSeed;
uniform vec3 uCam;
uniform vec2 uWind;
uniform float uTime;
varying vec2 vUv;
varying vec4 vData;
varying float vDepth,vPlume;
${FIRE_SMOKE_GLSL}
void main(){
  vUv=uv;vData=vec4(fireSeed,fireSize.zw);vPlume=0.0;
  vec3 origin=fireAnchor.xyz;float kind=fireSize.z;
  float vertical=kind<0.5?uv.y:uv.y-0.5;
  float width=fireSize.x,height=fireSize.y;
  if(kind>1.5&&kind<2.5){
    vec4 plume=fireSmokeProfile(fireSize.w,fireAnchor.w,uWind);
    origin+=vec3(plume.y,fireSize.w*fireAnchor.w,plume.z);
    width=plume.x*2.0;height=max(width*${gl(C.smokeAspect)},fireSize.y);
  }
  if(kind>2.5){
    float life=fract(uTime*${gl(C.emberSpeed)}+fireSeed.x);
    origin.y+=life*${gl(C.emberHeightM)};
    origin.xz+=uWind*life*${gl(C.emberHeightM*C.emberWind)};
    origin.xz+=vec2(sin(life*8.0+fireSeed.x*31.0),cos(life*6.0+fireSeed.x*17.0))*life*2.0;
    vData.w=sin(life*3.14159265);width*=vData.w;height*=vData.w;
  }
  vec3 toward=uCam-origin;
  vec3 facing=normalize(toward+vec3(0.0001,0.0001,0.0));
  vec3 right=normalize(vec3(facing.z,0.0,-facing.x)+vec3(0.0001,0.0,0.0));
  vec3 up=kind<0.5?vec3(0.0,1.0,0.0):normalize(cross(facing,right));
  vec3 p=origin+right*(uv.x-0.5)*width+up*vertical*height;
  if(kind<0.5)p.xz+=uWind*uv.y*uv.y*height*${gl(C.flameWind)};
  if(kind>1.5&&kind<2.5)vPlume=(p.y-fireAnchor.y)/fireAnchor.w;
  vec4 mv=viewMatrix*vec4(p,1.0);vDepth=-mv.z;gl_Position=projectionMatrix*mv;
}`;
export const FIRE_FRAGMENT=`
uniform float uTime,uDay,uPaint;
uniform vec2 uFog;
uniform vec3 uFogColor,uSmoke,uSmokeLit;
varying vec2 vUv;
varying vec4 vData;
varying float vDepth,vPlume;
${FIRE_NOISE_GLSL}
${FIRE_SMOKE_GLSL}
void main(){
  float fog=exp(-max(0.0,vDepth-uFog.x)/max(uFog.y,1.0));
  float keep=max(${gl(C.fogKeep)},fog);
  float kind=vData.z,seed=vData.x*31.7;
  vec2 q=(vUv-0.5)*2.0;
  if(kind>1.5&&kind<2.5){
    float n=fireFbm(q*${gl(C.smokeNoiseScale)}+vec2(seed,seed*0.71-uTime*${gl(C.smokeRise)}));
    float edge=1.0-length(q)+(n-0.5)*${gl(C.smokeEdge)};
    float alpha=smoothstep(0.0,0.4,edge)*fireSmokeProfile(vPlume,1.0,vec2(0.0)).w;
    alpha*=smoothstep(0.0,0.035,vPlume)*mix(0.65,1.0,n)*fog;
    vec3 color=mix(uSmokeLit,uSmoke,smoothstep(0.0,0.23,vPlume));
    if(uPaint>0.5){color=${rgb(new THREE.Color(C.debugSmoke).toArray())};alpha=smoothstep(0.0,0.25,edge)*0.75;}
    gl_FragColor=vec4(mix(uFogColor,color,fog),alpha);return;
  }
  vec3 color;float amount;
  if(kind>2.5){color=${rgb(C.flameCore)};amount=(1.0-smoothstep(0.1,1.0,length(q)))*vData.w;
    if(uPaint>0.5)color=${rgb(new THREE.Color(C.debugEmber).toArray())};
  }else if(kind>0.5){float r=length(q);amount=exp(-r*r*3.2)*(1.0-smoothstep(0.75,1.0,r))*${gl(C.glowGain)};
    color=${rgb(C.glowColor)};if(uPaint>0.5)color=${rgb(new THREE.Color(C.debugGlow).toArray())};
  }else{
    float y=vUv.y,x=q.x;
    float n=fireFbm(vec2(x*1.4+seed,y*2.0-uTime*1.5+seed));
    float detail=fireFbm(vec2(x*3.1-seed*0.7,y*3.8-uTime*2.3+seed*1.9));
    float shape=1.0-abs(x+(n-0.5)*0.9*y)*(1.0+y*1.25)-pow(y,1.5)*0.95+(detail-0.5)*0.7*(0.15+y);
    float bottom=fireNoise(vec2(x*2.6+seed*1.3,uTime*0.5+seed));
    amount=smoothstep(0.0,0.24,shape)*smoothstep(0.0,0.16+0.2*bottom,y);
    float core=smoothstep(0.2,0.75,shape);
    color=mix(${rgb(C.flameLow)},${rgb(C.flameMid)},smoothstep(0.0,0.5,core));
    color=mix(color,${rgb(C.flameCore)},smoothstep(0.6,1.0,core));
    if(uPaint>0.5)color=${rgb(new THREE.Color(C.debugFlame).toArray())};
  }
  float pulse=1.0+${gl(C.flickerAmount)}*sin(uTime*${gl(C.flickerHz*2*Math.PI)}+seed);
  gl_FragColor=vec4(color*amount*vData.y*uDay*keep*pulse,1.0);
}`;
export const FIRE_POOL_VERTEX=`
attribute vec2 fireUv;
attribute float firePower;
varying vec2 vUv;varying float vPower,vDepth;
void main(){vUv=fireUv;vPower=firePower;vec4 mv=modelViewMatrix*vec4(position,1.0);vDepth=-mv.z;gl_Position=projectionMatrix*mv;}`;
export const FIRE_POOL_FRAGMENT=`
uniform float uDay,uPaint;uniform vec2 uFog;
varying vec2 vUv;varying float vPower,vDepth;
void main(){float r=length(vUv);float a=exp(-r*r*2.4)*(1.0-smoothstep(0.7,1.0,r));
vec3 color=${rgb(C.flameLow)};if(uPaint>0.5)color=${rgb(new THREE.Color(C.debugPool).toArray())};
float fog=max(${gl(C.fogKeep)},exp(-max(0.0,vDepth-uFog.x)/max(uFog.y,1.0)));
gl_FragColor=vec4(color*a*vPower*${gl(C.poolGain)}*uDay*fog,1.0);}`;

function spriteBatch(capacity,uniforms,smoke,name) {
  const g=new THREE.InstancedBufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute([-.5,0,0,.5,0,0,-.5,1,0,.5,1,0],3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,1,1,1],2));g.setIndex([0,1,2,2,1,3]);
  for(const [name,size] of [['fireAnchor',4],['fireSize',4],['fireSeed',2]])g.setAttribute(name,new THREE.InstancedBufferAttribute(new Float32Array(capacity*size),size).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount=0;
  const material=new THREE.ShaderMaterial({uniforms,vertexShader:FIRE_VERTEX,fragmentShader:FIRE_FRAGMENT,
    transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:smoke?THREE.NormalBlending:THREE.AdditiveBlending,toneMapped:false});
  const mesh=new THREE.Mesh(g,material);mesh.name=name;mesh.frustumCulled=false;mesh.renderOrder=smoke?5:6;
  mesh.castShadow=mesh.receiveShadow=false;return mesh;
}
function put(mesh,x,y,z,sourceHeight,w,h,kind,phase,seed,power) {
  const g=mesh.geometry,i=g.instanceCount++;
  g.attributes.fireAnchor.setXYZW(i,x,y,z,sourceHeight);g.attributes.fireSize.setXYZW(i,w,h,kind,phase);g.attributes.fireSeed.setXY(i,seed,power);
}
export function createKamakuraFire(context) {
  const prepared=prepareFires(context);if(!prepared)return null;
  const params=new URLSearchParams(context.search),paint=params.get('firedebug')==='1';
  const fog=context.scene.fog, sky=fog?.color||new THREE.Color(C.smokeDark);
  const uniforms={uTime:{value:0},uCam:{value:new THREE.Vector3().copy(context.camera.position)},uWind:{value:new THREE.Vector2()},
    uDay:{value:fireDayGain(atmosphereOptions(context.search).time)},uPaint:{value:paint?1:0},
    uFog:{value:new THREE.Vector2(fog?.near||0,fog?.far||(fog?.density?1/fog.density:C.fogReachM))},
    uFogColor:{value:new THREE.Color(sky)},uSmoke:{value:new THREE.Color(C.smokeDark).lerp(sky,C.smokeSkyMix)},
    uSmokeLit:{value:new THREE.Color(C.smokeDark).lerp(new THREE.Color().fromArray(C.glowColor),C.smokeLitMix)}};
  const flame=spriteBatch(C.maxBoards,uniforms,false,'kamakura-fire-flame-glow'),smoke=spriteBatch(C.maxSources*C.smokeCounts[0],uniforms,true,'kamakura-fire-smoke'),
    ember=spriteBatch(C.maxSources*C.emberMax,uniforms,false,'kamakura-fire-ember');
  // A small grid follows actual ground height, so the glow is not a flat disc floating on slopes.
  const positions=[],uvs=[],powers=[],indices=[],segments=C.poolSegments;
  for(const s of prepared.sources){
    const radius=C.poolMinM+(C.poolMaxM-C.poolMinM)*s.strength,base=positions.length/3;
    for(let row=0;row<=segments;row++)for(let col=0;col<=segments;col++){
      const u=col/segments*2-1,v=row/segments*2-1,x=s.x+u*radius,z=s.z+v*radius;
      positions.push(x,context.terrain.heightAt(x,z)+C.poolLiftM,z);prepared.work.terrainSamples++;uvs.push(u,v);powers.push(s.strength);
    }
    for(let row=0;row<segments;row++)for(let col=0;col<segments;col++){
      const a=base+row*(segments+1)+col,b=a+segments+1;indices.push(a,b,a+1,a+1,b,b+1);
    }
  }
  const poolGeometry=new THREE.BufferGeometry();poolGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  poolGeometry.setAttribute('fireUv',new THREE.Float32BufferAttribute(uvs,2));poolGeometry.setAttribute('firePower',new THREE.Float32BufferAttribute(powers,1));poolGeometry.setIndex(indices);
  const pool=new THREE.Mesh(poolGeometry,new THREE.ShaderMaterial({uniforms,vertexShader:FIRE_POOL_VERTEX,fragmentShader:FIRE_POOL_FRAGMENT,
    transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,toneMapped:false}));pool.name='kamakura-fire-pool';pool.renderOrder=4;pool.frustumCulled=false;
  const light=new THREE.PointLight(new THREE.Color().fromArray(C.glowColor),0,C.pointRangeM,2);light.name='kamakura-fire-light';light.castShadow=false;light.visible=false;
  const meshes=[flame,pool,smoke,ember];for(const mesh of meshes)context.scene.add(mesh);context.scene.add(light);
  let disposed=false,paused=false,time=0,step=0,counts,uploads=0,frames=0,lightScans=0,lightSource=-1;
  const viewer=new THREE.Vector3().copy(context.camera.position);
  function pack(){
    counts=fireCounts(prepared,context.quality,step);for(const mesh of [flame,smoke,ember])mesh.geometry.instanceCount=0;
    for(let i=0;i<prepared.sources.length;i++){
      const s=prepared.sources[i],n=counts.sources[i];
      for(let j=0;j<n.houses;j++){
        const h=s.houses[j],tall=Math.max(C.flameMinM,Math.min(C.flameMaxM,h.height*(C.flameScaleMin+(C.flameScaleMax-C.flameScaleMin)*s.strength)));
        for(let k=0;k<n.tongues;k++){
          const angle=k/n.tongues*Math.PI*2,dx=Math.cos(angle)*h.w*C.roofInset,dz=Math.sin(angle)*h.d*C.roofInset;
          const eave=k%2===1&&!h.ground,rot=h.rotY,x=h.x+Math.cos(rot)*dx+Math.sin(rot)*dz,z=h.z-Math.sin(rot)*dx+Math.cos(rot)*dz;
          const y=h.y+(h.ground?0:h.height*(eave?C.eaveHeight:1))-tall*C.roofEmbed;
          put(flame,x,y,z,0,tall*C.flameWidth,tall,0,0,(i*47+j*13+k+1)*.137,s.strength);
        }
        const r=h.height*C.houseGlowRadius;
        put(flame,h.x,h.y+h.height,h.z,0,r*2,r*2,1,0,(i*7+j+1)*.113,s.strength);
      }
      const r=s.radius*(C.glowRadiusMin+(C.glowRadiusMax-C.glowRadiusMin)*s.strength);
      put(flame,s.x,s.y+C.flameMinM,s.z,0,r*2,r*2,1,0,(i+1)*.17,s.strength);
      for(let k=0;k<n.smoke;k++)put(smoke,s.x,s.y,s.z,s.smokeHeight,0,s.smokeHeight/n.smoke*C.smokeOverlap,2,k/(n.smoke-1),(i*17+k+1)*.193,s.strength);
      for(let k=0;k<n.embers;k++){
        const angle=k*2.39996323,radius=s.radius*Math.sqrt((k+.5)/n.embers);
        put(ember,s.x+Math.cos(angle)*radius,s.y+C.flameMinM,s.z+Math.sin(angle)*radius,0,C.emberSizeM,C.emberSizeM,3,0,(k*.61803399+i*.37)%1,s.strength);
      }
    }
    for(const mesh of [flame,smoke,ember]){for(const a of Object.values(mesh.geometry.attributes))if(a.isInstancedBufferAttribute)a.needsUpdate=true;uploads+=mesh.geometry.instanceCount;}
  }
  pack();
  function update(frame){
    if(disposed||paused)return;
    frames++;time+=Math.max(0,frame.dt);uniforms.uTime.value=time;
    const eye=frame.camera?.position||context.camera.position;viewer.copy(eye);uniforms.uCam.value.copy(eye);
    const wind=context.wind;
    if(wind?.uWindDir){uniforms.uWind.value.copy(wind.uWindDir.value).multiplyScalar(wind.uWind?.value??1);}
    else if(frame.windDir)uniforms.uWind.value.set(frame.windDir[0],frame.windDir[1]).multiplyScalar(frame.wind??1);
    let nearest=-1,distance=C.pointNearM;
    if(!frame.flying&&frame.pos)for(let i=0;i<prepared.sources.length;i++){
      lightScans++;const s=prepared.sources[i],d=Math.hypot(s.x-frame.pos.x,s.y-(frame.pos.y??s.y),s.z-frame.pos.z);
      if(d<=distance){nearest=i;distance=d;}
    }
    lightSource=nearest;light.visible=nearest>=0;
    if(nearest>=0){const s=prepared.sources[nearest];light.position.set(s.x,s.y+C.pointHeightM,s.z);light.intensity=C.pointGain*s.strength*uniforms.uDay.value;}
  }
  const snapshot=()=>{
    let nearest=null;
    for(const s of prepared.sources){const distance=Math.hypot(s.x-viewer.x,s.y-viewer.y,s.z-viewer.z);
      if(!nearest||distance<nearest.distance)nearest={source:s.index,distance,bearing:(Math.atan2(s.x-viewer.x,viewer.z-s.z)*180/Math.PI+360)%360};}
    const sprites=flame.geometry.instanceCount+smoke.geometry.instanceCount+ember.geometry.instanceCount;
    return {sources:disposed?0:prepared.sources.length,bySource:disposed?[]:counts.sources,boards:disposed?0:counts.boards,triangles:disposed?0:sprites*2+indices.length/3,draws:disposed?0:4,
      light:light.visible&&!disposed?1:0,lightSource,nearest:disposed?null:nearest,time,step,tier:counts.tier,
      work:{houseScans:prepared.work.scans,terrainSamples:prepared.work.terrainSamples,uploadedInstances:uploads,frames,lightScans,perFrameBoardUpdates:0}};
  };
  if(params.get('debug')==='1')globalThis.__kzFire=snapshot;
  return {update,setPaused(on){if(!disposed)paused=!!on;},setAdapt(value){if(disposed)return;value=Math.max(0,Math.min(3,Math.floor(value)));if(value!==step){step=value;pack();}},
    debugText(){return disposed?'':`火 ${prepared.sources.length}・板 ${counts.boards}`;},
    dispose(){if(disposed)return;disposed=true;for(const mesh of meshes){mesh.visible=false;mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();}light.removeFromParent();light.dispose();
      if(globalThis.__kzFire===snapshot)delete globalThis.__kzFire;},
  };
}
