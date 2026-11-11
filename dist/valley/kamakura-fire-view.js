import * as THREE from '../vendor/three.module.min.js';
import { atmosphereOptions } from './kamakura-atmosphere.js';
import { FIRE as C, prepareFires, fireCounts, fireDayGain, fireRandom, emberOrigin, fireHouseLayout, flameTongue, FIRE_SMOKE_GLSL, FIRE_SMOKE_LIGHT_GLSL } from './kamakura-fire.js';
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
attribute vec3 fireRight,fireUp;
uniform vec3 uCam;
uniform vec2 uWind;
uniform float uTime;
varying vec2 vUv;
varying vec4 vData;
varying float vDepth,vPlume;
varying vec2 vSize;
${FIRE_SMOKE_GLSL}
void main(){
  vUv=uv;vData=vec4(fireSeed,fireSize.zw);vPlume=0.0;vSize=fireSize.xy;
  vec3 origin=fireAnchor.xyz;float kind=fireSize.z;
  float vertical=kind<0.5?uv.y:uv.y-0.5;
  float width=fireSize.x,height=fireSize.y;
  if(kind>1.5&&kind<2.5){
    float t=fireSize.w<0.0?-fireSize.w:fract(fireSize.w+uTime*${gl(C.smokeRise)});
    vec4 plume=fireSmokeProfile(t,fireAnchor.w,uWind,fireSize.x,uTime,fireSeed.y);
    vData.w=plume.w/${gl(C.smokeDensity)};
    origin+=vec3(plume.y,t*fireAnchor.w,plume.z);
    width=plume.x*2.0*(1.0+${gl(C.smokePuffVariation)}*sin(fireSeed.x*31.7));height=max(width*mix(${gl(C.smokeAspect)},${gl(C.smokeTopAspect)},smoothstep(${gl(C.smokeTopSpreadStart)},1.0,t)),fireSize.y);
  }
  if(kind>2.5&&kind<3.5){
    float life=fract(uTime*${gl(C.emberSpeed)}*(1.0+${gl(C.emberSpeedVariation)}*fireSize.w)+fireSeed.x);
    float rise=life*${gl(C.emberHeightM)}*(1.0+${gl(C.emberHeightVariation)}*fireSize.w);
    float phase=fireSeed.x*${gl(Math.PI*2)},turn=life*${gl(C.emberTurns*Math.PI*2)};
    origin.y+=rise;origin.xz+=uWind*rise*${gl(C.emberWind)};
    origin.xz+=vec2(sin(turn+phase)-sin(phase),cos(turn+phase)-cos(phase))*life*${gl(C.emberSwirlM)};
    vData.w=sin(life*3.14159265);width*=vData.w;height*=vData.w;
  }
  vec3 toward=uCam-origin;
  vec3 facing=normalize(toward+vec3(0.0001,0.0001,0.0));
  vec3 right=normalize(vec3(facing.z,0.0,-facing.x)+vec3(0.0001,0.0,0.0));
  vec3 up=kind<0.5?vec3(0.0,1.0,0.0):normalize(cross(facing,right));
  if(kind<0.5||kind>3.5){right=fireRight;up=fireUp;}
  vec3 p=origin+right*(uv.x-0.5)*width+up*vertical*height;
  if(kind<0.5)p.xz+=uWind*uv.y*uv.y*height*${gl(C.flameWind)};
  if(kind>1.5&&kind<2.5)vPlume=(p.y-fireAnchor.y)/fireAnchor.w;
  vec4 mv=viewMatrix*vec4(p,1.0);vDepth=-mv.z;gl_Position=projectionMatrix*mv;
}`;
export const FIRE_FRAGMENT=`
uniform float uTime,uDay,uPaint;
uniform vec2 uFog;
uniform vec3 uFogColor,uSmoke,uSmokeLit,uSmokeTop;
varying vec2 vUv;
varying vec4 vData;
varying float vDepth,vPlume;
varying vec2 vSize;
${FIRE_NOISE_GLSL}
${FIRE_SMOKE_GLSL}
${FIRE_SMOKE_LIGHT_GLSL}
void main(){
  float fog=exp(-max(0.0,vDepth-uFog.x)/max(uFog.y,1.0));
  float keep=max(${gl(C.fogKeep)},fog);
  float kind=vData.z,seed=vData.x*31.7;
  vec2 q=(vUv-0.5)*2.0;
  if(kind>1.5&&kind<2.5){
    float n=fireFbm(q*${gl(C.smokeNoiseScale)}+vec2(seed,seed*0.71-uTime*${gl(C.smokeRise)}));
    float edge=1.0-length(q)-n*${gl(C.smokeEdge)};
    float alpha=smoothstep(0.0,${gl(C.smokeEdgeSoft)},edge)*fireSmokeProfile(vPlume,1.0,vec2(0.0),0.0,uTime,vData.y).w;
    alpha*=vData.w*mix(${gl(C.smokeDetailKeep)},1.0,n)*fog;
    float inside=1.0-smoothstep(0.0,1.0,length(q));
    vec3 color=mix(uSmoke,uSmokeLit,fireSmokeLight(vPlume,uDay)*inside);
    color=mix(color,uSmokeTop,smoothstep(${gl(C.smokeTopStart)},1.0,vPlume));
    if(uPaint>0.5)color=${rgb(new THREE.Color(C.debugSmoke).toArray())};
    gl_FragColor=vec4(mix(uFogColor,color,fog),alpha);return;
  }
  if(kind>3.5){
    float n=fireFbm(vUv*${gl(C.coalNoiseScale)}+vec2(seed,uTime*${gl(C.coalHz)}));
    float pulse=1.0+${gl(C.coalPulse)}*sin(uTime*${gl(C.coalHz*2*Math.PI)}+seed+n*6.28318531);
    vec3 color;float amount;
    if(kind<4.5){
      float edge=(1.0-smoothstep(${gl(C.coalEdgeStart)},1.0,abs(q.x)))*(1.0-smoothstep(${gl(C.coalEdgeStart)},1.0,abs(q.y)));
      color=mix(${rgb(C.flameLow)},${rgb(C.flameMid)},n*${gl(C.coalHotMix)});
      amount=edge*mix(${gl(C.coalCoolGain)},1.0,n)*${gl(C.coalGain)};
      if(uPaint>0.5)color=${rgb(new THREE.Color(C.debugCoal).toArray())};
    }else{
      // One facade quad carries a door and one/two windows, with no luminous wall in between.
      vec2 m=vec2(q.x*vSize.x*0.5,vUv.y*vSize.y);
      vec2 d=abs(m-vec2(0.0,${gl(C.openingBaseM+C.doorHeightM/2)}))-vec2(${gl(C.doorWidthM/2)},${gl(C.doorHeightM/2)});
      float door=1.0-smoothstep(-${gl(C.openingEdgeM)},0.0,max(d.x,d.y));
      float centre=vSize.x*${gl(C.windowOffset)};
      float across=vSize.x>=${gl(C.twoWindowsM)}?abs(abs(m.x)-centre):abs(m.x-centre);
      vec2 w=vec2(across,abs(m.y-${gl(C.windowYM)}))-vec2(${gl(C.windowWidthM/2)},${gl(C.windowHeightM/2)});
      float windowLight=1.0-smoothstep(-${gl(C.openingEdgeM)},0.0,max(w.x,w.y));
      amount=max(door,windowLight)*${gl(C.openingGain)}*mix(${gl(C.coalCoolGain)},1.0,n);
      color=mix(${rgb(C.flameMid)},${rgb(C.flameCore)},n);
      if(uPaint>0.5)color=${rgb(new THREE.Color(C.debugOpening).toArray())};
    }
    gl_FragColor=vec4(color*amount*vData.y*uDay*keep*pulse,1.0);return;
  }
  vec3 color;float amount;
  if(kind>2.5&&kind<3.5){color=${rgb(C.flameCore)};amount=(1.0-smoothstep(0.1,1.0,length(q)))*vData.w;
    amount*=1.0-${gl(C.emberTwinkleAmount)}+${gl(C.emberTwinkleAmount)}*sin(uTime*${gl(C.emberTwinkleHz*2*Math.PI)}*(1.0+vData.x)+seed);
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
    float border=(1.0-smoothstep(${gl(C.flameTipStart)},1.0,y))*(1.0-smoothstep(${gl(C.flameSideStart)},1.0,abs(x)));
    amount*=border;
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
attribute float fireSource;
varying vec2 vUv;varying float vPower,vDepth,vSource;
void main(){vUv=fireUv;vPower=firePower;vSource=fireSource;vec4 mv=modelViewMatrix*vec4(position,1.0);vDepth=-mv.z;gl_Position=projectionMatrix*mv;}`;
export const FIRE_POOL_FRAGMENT=`
uniform float uDay,uPaint,uTime;uniform vec2 uFog;
uniform vec4 uPoolBlocks[${C.maxSources*C.housesMax}];
uniform vec2 uPoolTurns[${C.maxSources*C.housesMax}];
uniform float uPoolPhases[${C.maxSources}];
varying vec2 vUv;varying float vPower,vDepth,vSource;
void main(){float r=length(vUv);float a=exp(-r*r*${gl(C.poolFalloff)})*(1.0-smoothstep(${gl(C.poolEdgeStart)},1.0,r));
float occlusion=1.0;
for(float j=0.0;j<${gl(C.housesMax)};j+=1.0){
  int slot=int(vSource+0.5)*int(${gl(C.housesMax)})+int(j);vec4 b=uPoolBlocks[slot];vec2 rot=uPoolTurns[slot];
  vec2 c=vec2(rot.x*b.x-rot.y*b.y,rot.y*b.x+rot.x*b.y);
  vec2 ray=vec2(rot.x*vUv.x-rot.y*vUv.y,rot.y*vUv.x+rot.x*vUv.y);
  if(b.z<=0.0||(abs(c.x)<=b.z&&abs(c.y)<=b.w))continue;
  ray=vec2(abs(ray.x)<${gl(C.poolRayEpsilon)}?${gl(C.poolRayEpsilon)}:ray.x,abs(ray.y)<${gl(C.poolRayEpsilon)}?${gl(C.poolRayEpsilon)}:ray.y);
  vec2 t0=(c-b.zw)/ray,t1=(c+b.zw)/ray;
  vec2 lo=min(t0,t1),hi=max(t0,t1);
  float enter=max(max(lo.x,lo.y),0.0),exit=min(hi.x,hi.y);
  occlusion=min(occlusion,1.0-${gl(1-C.poolShadowKeep)}*smoothstep(0.0,${gl(C.poolShadowSoft)},min(1.0,exit)-enter));
}
a*=occlusion*(1.0+${gl(C.poolFlickerAmount)}*sin(uTime*${gl(C.poolFlickerHz*2*Math.PI)}+uPoolPhases[int(vSource+0.5)]));
vec3 color=${rgb(C.flameLow)};if(uPaint>0.5)color=${rgb(new THREE.Color(C.debugPool).toArray())};
float fog=max(${gl(C.fogKeep)},exp(-max(0.0,vDepth-uFog.x)/max(uFog.y,1.0)));
gl_FragColor=vec4(color*a*vPower*${gl(C.poolGain)}*uDay*fog,1.0);}`;

function spriteBatch(capacity,uniforms,smoke,name) {
  const g=new THREE.InstancedBufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute([-.5,0,0,.5,0,0,-.5,1,0,.5,1,0],3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,1,1,1],2));g.setIndex([0,1,2,2,1,3]);
  for(const [name,size] of [['fireAnchor',4],['fireSize',4],['fireSeed',2],['fireRight',3],['fireUp',3]])g.setAttribute(name,new THREE.InstancedBufferAttribute(new Float32Array(capacity*size),size).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount=0;
  const material=new THREE.ShaderMaterial({uniforms,vertexShader:FIRE_VERTEX,fragmentShader:FIRE_FRAGMENT,
    transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:smoke?THREE.NormalBlending:THREE.AdditiveBlending,toneMapped:false});
  material.forceSinglePass=true;
  const mesh=new THREE.Mesh(g,material);mesh.name=name;mesh.frustumCulled=false;mesh.renderOrder=smoke?5:6;
  mesh.castShadow=mesh.receiveShadow=false;return mesh;
}
function put(mesh,x,y,z,sourceHeight,w,h,kind,phase,seed,power,right=null,up=null) {
  const g=mesh.geometry,i=g.instanceCount++;
  g.attributes.fireAnchor.setXYZW(i,x,y,z,sourceHeight);g.attributes.fireSize.setXYZW(i,w,h,kind,phase);g.attributes.fireSeed.setXY(i,seed,power);
  if(right)g.attributes.fireRight.setXYZ(i,...right);if(up)g.attributes.fireUp.setXYZ(i,...up);
}
export function createKamakuraFire(context) {
  const prepared=prepareFires(context);if(!prepared)return null;
  const params=new URLSearchParams(context.search),paint=params.get('firedebug')==='1';
  const fog=context.scene.fog, sky=fog?.color||new THREE.Color(C.smokeDark);
  const uniforms={uTime:{value:0},uCam:{value:new THREE.Vector3().copy(context.camera.position)},uWind:{value:new THREE.Vector2()},
    uDay:{value:fireDayGain(atmosphereOptions(context.search).time)},uPaint:{value:paint?1:0},
    uFog:{value:new THREE.Vector2(fog?.near||0,fog?.far||(fog?.density?1/fog.density:C.fogReachM))},
    uFogColor:{value:new THREE.Color(sky)},uSmoke:{value:new THREE.Color(C.smokeDark).lerp(sky,C.smokeMidMix)},
    uSmokeTop:{value:new THREE.Color(C.smokeDark).lerp(sky,C.smokeSkyMix)},
    uSmokeLit:{value:new THREE.Color().fromArray(C.glowColor)},
    uPoolBlocks:{value:Array.from({length:C.maxSources*C.housesMax},()=>new THREE.Vector4())},
    uPoolTurns:{value:Array.from({length:C.maxSources*C.housesMax},()=>new THREE.Vector2())},
    uPoolPhases:{value:new Float32Array(C.maxSources)}};
  const flame=spriteBatch(C.maxBoards,uniforms,false,'kamakura-fire-flame-glow'),smoke=spriteBatch(C.maxSources*C.smokeCounts[0],uniforms,true,'kamakura-fire-smoke'),
    ember=spriteBatch(C.maxSources*C.emberMax,uniforms,false,'kamakura-fire-ember');
  // A small grid follows actual ground height, so the glow is not a flat disc floating on slopes.
  const positions=[],uvs=[],powers=[],sourceIds=[],indices=[],segments=C.poolSegments;
  for(const s of prepared.sources){
    const radius=C.poolMinM+(C.poolMaxM-C.poolMinM)*s.strength,base=positions.length/3;
    uniforms.uPoolPhases.value[s.index]=s.seed*Math.PI*2;
    s.houses.forEach((h,j)=>{if(h.ground)return;const slot=s.index*C.housesMax+j;
      uniforms.uPoolBlocks.value[slot].set((h.x-s.x)/radius,(h.z-s.z)/radius,h.w/2/radius,h.d/2/radius);
      uniforms.uPoolTurns.value[slot].set(Math.cos(h.rotY),Math.sin(h.rotY));});
    for(let row=0;row<=segments;row++)for(let col=0;col<=segments;col++){
      const u=col/segments*2-1,v=row/segments*2-1,x=s.x+u*radius,z=s.z+v*radius;
      positions.push(x,context.terrain.heightAt(x,z)+C.poolLiftM,z);prepared.work.terrainSamples++;uvs.push(u,v);powers.push(s.strength);sourceIds.push(s.index);
    }
    for(let row=0;row<segments;row++)for(let col=0;col<segments;col++){
      const a=base+row*(segments+1)+col,b=a+segments+1;indices.push(a,b,a+1,a+1,b,b+1);
    }
  }
  const poolGeometry=new THREE.BufferGeometry();poolGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  poolGeometry.setAttribute('fireUv',new THREE.Float32BufferAttribute(uvs,2));poolGeometry.setAttribute('firePower',new THREE.Float32BufferAttribute(powers,1));poolGeometry.setIndex(indices);
  poolGeometry.setAttribute('fireSource',new THREE.Float32BufferAttribute(sourceIds,1));
  const pool=new THREE.Mesh(poolGeometry,new THREE.ShaderMaterial({uniforms,vertexShader:FIRE_POOL_VERTEX,fragmentShader:FIRE_POOL_FRAGMENT,
    transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,toneMapped:false}));pool.material.forceSinglePass=true;pool.name='kamakura-fire-pool';pool.renderOrder=4;pool.frustumCulled=false;
  const light=new THREE.PointLight(new THREE.Color().fromArray(C.glowColor),0,C.pointRangeM,2);light.name='kamakura-fire-light';light.castShadow=false;light.visible=false;
  const meshes=[flame,pool,smoke,ember];for(const mesh of meshes)context.scene.add(mesh);context.scene.add(light);
  let disposed=false,paused=false,time=0,step=0,counts,uploads=0,frames=0,lightScans=0,lightSource=-1;
  const viewer=new THREE.Vector3().copy(context.camera.position);
  function pack(){
    counts=fireCounts(prepared,context.quality,step);for(const mesh of [flame,smoke,ember])mesh.geometry.instanceCount=0;
    for(let i=0;i<prepared.sources.length;i++){
      const s=prepared.sources[i],n=counts.sources[i];
      for(let j=0;j<n.houses;j++){
        const h=s.houses[j];
        for(let k=0;k<n.tongues;k++){
          const t=flameTongue(s,h,k,n.tongues);
          for(let plane=0;plane<n.planes;plane++){
            const angle=t.angle+plane*C.flameCrossRad/n.planes,right=[Math.cos(angle),0,-Math.sin(angle)];
            put(flame,t.x,t.y,t.z,0,t.height*C.flameWidth,t.height,0,t.opening?1:0,t.seed,s.strength/n.planes,right,[0,1,0]);
          }
        }
        if(!h.ground){
          const layout=fireHouseLayout(h),seed=fireRandom((i+1)*4099+j,9);
          for(const face of layout.roofs)put(flame,face.x,face.y,face.z,0,face.w,face.h,4,0,seed,s.strength,face.right,face.up);
          const face=layout.facade;
          put(flame,face.x,face.y,face.z,0,face.w,face.h,5,0,seed,s.strength,face.right,face.up);
        }
        const r=h.height*C.houseGlowRadius;
        put(flame,h.x,h.y+h.height,h.z,0,r*2,r*2,1,0,(i*7+j+1)*.113,s.strength);
      }
      const r=s.radius*(C.glowRadiusMin+(C.glowRadiusMax-C.glowRadiusMin)*s.strength);
      put(flame,s.x,s.y+C.flameMinM,s.z,0,r*2,r*2,1,0,(i+1)*.17,s.strength);
      for(let k=0;k<n.smoke;k++){
        // Root and thin cap stay in place; the intervening puffs rise and recycle invisibly.
        const phase=k===0?-C.smokeRootHeight:k===n.smoke-1?-C.smokeCapHeight:(k-1+fireRandom((i+1)*4099+k,5)*C.smokeSpacingJitter)/(n.smoke-2);
        put(smoke,s.x,s.y,s.z,s.smokeHeight,s.seed,Math.max(s.smokeHeight/n.smoke*C.smokeOverlap,k===0?s.smokeHeight*C.smokeRootHeight*2:k===n.smoke-1?s.smokeHeight*(1-C.smokeCapHeight)*2:0),2,phase,fireRandom((i+1)*4099+k,6),s.strength);
      }
      const origin={};
      for(let k=0;k<n.embers;k++){
        emberOrigin(s,k,origin);
        put(ember,origin.x,origin.y,origin.z,0,C.emberSizeM,C.emberSizeM,3,origin.variation,origin.phase,s.strength);
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
    uniforms.uWind.value.set(0,0);
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
