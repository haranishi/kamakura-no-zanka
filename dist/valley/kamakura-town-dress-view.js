// One instanced draw per kind/LOD, plus faint near-only smoke. Selection uses prebuilt spatial buckets.
import * as THREE from '../vendor/three.module.min.js';
import { buildColliders } from './collision.js';
import { TOWN_DRESS, DRESS_KINDS, townDressEnabled, townDressBatches, dressNear, dressRange, dressKeep, dressKey } from './kamakura-town-dress.js';
import { DRESS_ART, dressPalette, townDressGeometry } from './kamakura-town-dress-kit.js';
const C = TOWN_DRESS, A = DRESS_ART;
export const DRESS_VERTEX_PARS = `
attribute float aDressCloth, aDressStake, aDressTag;
attribute vec3 aDressGround;
attribute float aDressStakes;
uniform float uDressTime, uDressWind;
uniform vec2 uDressDir, uDressViewport, uDressExtent;
uniform float uDressFar, uDressNear, uDressFence, uDressSmoke;
varying vec3 vDressLocal;
varying float vDressCoverage, vDressNearWeight;
varying vec2 vDressSmokeUV;
`;
export const DRESS_BEGIN_VERTEX = `
vec3 transformed = vec3(position);
vec3 dressOrigin = (modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
vDressLocal = position;
vDressCoverage = 1.0;
vDressSmokeUV = vec2(0.0);
vDressNearWeight = 1.0 - smoothstep(uDressNear - ${(C.blend/2).toFixed(1)}, uDressNear + ${(C.blend/2).toFixed(1)}, aDressGround.z);
if (aDressStake > aDressStakes) transformed = vec3(0.0);
float dressWave = ${C.clothAmplitude.toFixed(3)} * clamp(uDressWind,0.0,1.0) * sin(uDressTime * ${C.clothFrequency.toFixed(2)} + (dressOrigin.x+dressOrigin.z) * ${C.clothPhase.toFixed(2)});
transformed.y += aDressCloth * dressWave * sin(clamp(position.x + 0.5,0.0,1.0) * 3.14159265);
transformed.y += position.x * aDressGround.x + position.z * aDressGround.y;
if (uDressFar > 0.5 && uDressFence > 0.5) {
  float dressThickness = length(instanceMatrix[2].xyz);
  float dressPixelWidth = ${C.minPixels.toFixed(1)} * 2.0 * aDressGround.z / (uDressViewport.y * projectionMatrix[1][1]);
  transformed.z *= max(1.0,dressPixelWidth / dressThickness);
  vDressCoverage = min(1.0,dressThickness / max(dressThickness,dressPixelWidth));
}
if (uDressSmoke > 0.5) {
  float dressLife = fract(aDressTag + uDressTime * ${C.smokeSpeed.toFixed(3)} + fract(dressOrigin.x + dressOrigin.z));
  float dressRise = dressLife * ${C.smokeHeight.toFixed(1)};
  float dressWidth = ${C.smokeWidth.toFixed(2)} + dressLife * ${C.smokeSpread.toFixed(2)};
  vec3 dressRight = vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);
  vec3 dressUp = vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
  // Convert the world-facing billboard back through the yaw-only instance basis.
  vec3 dressWorld = (dressRight * position.x + dressUp * position.y) * dressWidth;
  dressWorld += vec3(uDressDir.x * dressLife * dressLife * ${C.smokeDrift.toFixed(1)},dressRise,uDressDir.y * dressLife * dressLife * ${C.smokeDrift.toFixed(1)});
  transformed = vec3(dot(dressWorld,instanceMatrix[0].xyz),dressWorld.y,dot(dressWorld,instanceMatrix[2].xyz));
  vDressCoverage = smoothstep(0.0,0.1,dressLife) * (1.0-smoothstep(0.6,1.0,dressLife));
  vDressSmokeUV = position.xy * 2.0;
}
`;
export const DRESS_PIXEL_VERTEX = `
if (uDressFar > 0.5 && uDressFence < 0.5) {
  vec4 dressCentre = viewMatrix * vec4(dressOrigin,1.0);
  float dressDepth = max(0.1,-dressCentre.z);
  vec4 dressAxisX = modelViewMatrix * instanceMatrix * vec4(1.0,0.0,0.0,0.0);
  vec4 dressAxisZ = modelViewMatrix * instanceMatrix * vec4(0.0,0.0,1.0,0.0);
  vec2 dressExtent = (abs(dressAxisX.xy) * uDressExtent.x + abs(dressAxisZ.xy) * uDressExtent.y) * vec2(projectionMatrix[0][0],projectionMatrix[1][1]) * uDressViewport * 0.5 / dressDepth;
  vec2 dressExtra = max(vec2(0.0),vec2(${C.minPixels.toFixed(1)})-dressExtent);
  float dressOffsetX = abs(dressAxisX.x) >= abs(dressAxisZ.x) ? position.x / uDressExtent.x * sign(dressAxisX.x) : position.z / uDressExtent.y * sign(dressAxisZ.x);
  float dressOffsetY = (abs(dressAxisX.y)+abs(dressAxisZ.y)<0.000001) ? position.z/uDressExtent.y : abs(dressAxisX.y) >= abs(dressAxisZ.y) ? position.x / uDressExtent.x * sign(dressAxisX.y) : position.z / uDressExtent.y * sign(dressAxisZ.y);
  gl_Position.xy += vec2(dressOffsetX,dressOffsetY) * dressExtra * 2.0 / uDressViewport * gl_Position.w;
  vDressCoverage = (max(0.01,dressExtent.x)/max(${C.minPixels.toFixed(1)},dressExtent.x)) * (max(0.01,dressExtent.y)/max(${C.minPixels.toFixed(1)},dressExtent.y));
}
`;
function insert(source, hook, code, replace = false) { if (!source.includes(hook)) throw new Error(`Town dress shader hook missing: ${hook}`); return source.replace(hook, replace ? code : hook+'\n'+code); }
export function installDressShader(material, uniforms, { far = false, garden = false, fence = false, smoke = false, debug = false } = {}) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = insert(shader.vertexShader,'#include <common>',DRESS_VERTEX_PARS);
    shader.vertexShader = insert(shader.vertexShader,'#include <begin_vertex>',DRESS_BEGIN_VERTEX,true);
    if(far)shader.vertexShader=insert(shader.vertexShader,'#include <project_vertex>',DRESS_PIXEL_VERTEX);
    shader.fragmentShader = insert(shader.fragmentShader,'#include <common>','varying vec3 vDressLocal; varying float vDressCoverage, vDressNearWeight; varying vec2 vDressSmokeUV; uniform float uDressFar; uniform vec3 uDressGardenCrop;');
    const depth = material.isMeshDepthMaterial;
    let code = `float dressPattern = mod(floor(gl_FragCoord.x)+floor(gl_FragCoord.y)*4.0,16.0)/16.0;
if (uDressFar < 0.5) { if (dressPattern >= vDressNearWeight) discard; }
else if (dressPattern < vDressNearWeight) discard;`;
    if(!depth){
      if(far || smoke)code+='\ndiffuseColor.a *= vDressCoverage;';
      if(smoke)code+='\ndiffuseColor.a *= pow(max(0.0,1.0-dot(vDressSmokeUV,vDressSmokeUV)),2.0); if (diffuseColor.a < 0.001) discard;';
      if(!debug && fence && far)code+=`\ndiffuseColor.rgb *= mix(${A.stripeDark.toFixed(2)},1.0,step(${(1-A.fenceStripeFill).toFixed(2)},fract(vDressLocal.x * ${(A.fenceReference/A.fenceStripe).toFixed(2)})));`;
      if(!debug && garden && far)code+=`\ndiffuseColor.rgb = mix(diffuseColor.rgb,uDressGardenCrop,step(${(1-A.gardenStripeFill).toFixed(2)},fract(vDressLocal.x * ${A.ridgeRows.toFixed(1)})));`;
    }
    shader.fragmentShader=insert(shader.fragmentShader,depth?'#include <clipping_planes_fragment>':'#include <color_fragment>',code);
  };
  material.customProgramCacheKey=()=>`kz-town-dress-${far}-${garden}-${fence}-${smoke}-${debug}-${material.type}-1`;
}
// Same registration protocol as ruin-hall: preserve the shared grid and remove only our own boxes.
export function addDressBoxes(col, boxes) {
  const own=buildColliders({bounds:col.bounds,extraBoxes:boxes}),owned=new Set(own.boxes);
  for(const b of own.boxes)col.boxes.push(b);
  for(const [key,list]of own.grid){if(col.grid.has(key))for(const b of list)col.grid.get(key).push(b);else col.grid.set(key,list);}
  let released=false;
  return ()=>{if(released)return;released=true;let write=0;for(const b of col.boxes)if(!owned.has(b))col.boxes[write++]=b;col.boxes.length=write;
    for(const key of own.grid.keys()){const next=col.grid.get(key)?.filter(b=>!owned.has(b));if(next?.length)col.grid.set(key,next);else col.grid.delete(key);}};
}
export function createKamakuraTownDress(context) {
  if(!townDressEnabled(context.search)||!context.data?.townPlots?.length)return null;
  const query=new URLSearchParams(context.search),debug=query.get('towndressdebug')==='1';
  const group=new THREE.Group();group.name='kamakura-town-dress';context.scene.add(group);
  const job=townDressBatches(context),sets=[],viewer=new THREE.Vector3(),viewport=new THREE.Vector2(C.viewport,C.viewport),dir=new THREE.Vector2(1,0);
  const shared={uDressTime:{value:0},uDressWind:{value:0},uDressDir:{value:dir},uDressViewport:{value:viewport}};
  const nearSets=new Array(DRESS_KINDS.length).fill(null),farSets=new Array(DRESS_KINDS.length).fill(null);
  let order=null,distances=null,selected=0;
  let result=null,building=false,buildCursor=0,ready=false,first=true,disposed=false,paused=false,step=0,release=null,nearestId=-1,nearestDistance=Infinity;
  let drawnNear=0,drawnFar=0,nearTriangles=0,farTriangles=0,draws=0,budgetNear=0,budgetFar=0,checks=0,buckets=0,preparedFrames=0,text='';
  let built=false,builtStep=-1;const builtAt=new THREE.Vector3();
  function buildKind(kind) {
    const k=DRESS_KINDS.indexOf(kind);let capacity=0;for(const p of result.items)if(p.kind===kind)capacity++;
    if(!capacity)return;
    for(let level=0;level<(kind==='smoke'?1:2);level++){
      const far=level===1,fence=!!C.fenceHeights[kind],smoke=kind==='smoke',g=townDressGeometry(kind,far);
      g.setAttribute('aDressGround',new THREE.InstancedBufferAttribute(new Float32Array(capacity*3),3));
      g.setAttribute('aDressStakes',new THREE.InstancedBufferAttribute(new Float32Array(capacity),1));
      const opts={color:debug?new THREE.Color(A.debug[kind]).multiplyScalar(far?A.farDebugGain:1):0xffffff,vertexColors:!debug,fog:!debug,side:THREE.DoubleSide,transparent:far||smoke,depthWrite:!far&&!smoke,opacity:smoke?C.smokeOpacity:far&&fence&&!debug?A.fenceCoverage[kind]:1,toneMapped:!debug};
      const m=debug||smoke?new THREE.MeshBasicMaterial(opts):new THREE.MeshLambertMaterial(opts);m.forceSinglePass=true;
      const uniforms={...shared,uDressExtent:{value:new THREE.Vector2(g.boundingBox.max.x-g.boundingBox.min.x,Math.max(.01,g.boundingBox.max.z-g.boundingBox.min.z))},uDressGardenCrop:{value:new THREE.Color(...dressPalette().crop)},uDressFar:{value:far?1:0},uDressNear:{value:dressNear(kind)},uDressFence:{value:fence?1:0},uDressSmoke:{value:smoke?1:0}};
      // Per-instance camera distance shares the third ground component; smoke phase comes from its origin.
      installDressShader(m,uniforms,{far,garden:kind==='garden',fence,smoke,debug});
      const mesh=new THREE.InstancedMesh(g,m,capacity);mesh.name=`town-dress-${kind}-${far?'far':'near'}`;mesh.count=0;mesh.frustumCulled=false;
      mesh.castShadow=!far&&!smoke;mesh.receiveShadow=!smoke;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if(mesh.castShadow){mesh.customDepthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide});installDressShader(mesh.customDepthMaterial,uniforms,{debug});}
      const set={kind,k,far,mesh,uniforms,triangles:g.attributes.position.count/3};sets.push(set);(far?farSets:nearSets)[k]=set;group.add(mesh);
    }
  }
  function buildMatrices(){
    order=new Int32Array(result.items.length);distances=new Float64Array(result.items.length);
    for(const p of result.items){const c=Math.cos(p.yaw),s=Math.sin(p.yaw);p.k=DRESS_KINDS.indexOf(p.kind);
      p.matrix=new Float32Array([c*p.w,0,-s*p.w,0,0,1,0,0,s*p.d,0,c*p.d,0,p.x,p.y,p.z,1]);}
  }
  function submit(set,p,distance){
    if(!set)return false;
    if(set.far){if(farTriangles+set.triangles>C.farTriangles){budgetFar++;return false;}farTriangles+=set.triangles;drawnFar++;}
    else{if(nearTriangles+set.triangles>C.nearTriangles){budgetNear++;return false;}nearTriangles+=set.triangles;drawnNear++;}
    const mesh=set.mesh,n=mesh.count++;mesh.instanceMatrix.array.set(p.matrix,n*16);
    const ground=mesh.geometry.attributes.aDressGround.array;ground[n*3]=p.gx*p.w;ground[n*3+1]=p.gz*p.d;ground[n*3+2]=distance;
    mesh.geometry.attributes.aDressStakes.array[n]=p.stakes?1:0;return true;
  }
  // Reused binary min-heap: budget cuts always discard the farthest eligible segments first.
  function enqueue(id,d){
    let at=selected++;distances[id]=d;
    while(at>0){const parent=(at-1)>>1,other=order[parent];if(distances[other]<=d)break;order[at]=other;at=parent;}order[at]=id;
  }
  function dequeue(){
    const id=order[0],last=order[--selected];let at=0;
    while(at*2+1<selected){let child=at*2+1;if(child+1<selected&&distances[order[child+1]]<distances[order[child]])child++;if(distances[last]<=distances[order[child]])break;order[at]=order[child];at=child;}order[at]=last;return id;
  }
  const inspect=()=>({ready,plots:{...(result?.plots||{})},fences:{...(result?.fences||{}),byKind:{...(result?.fences.byKind||{})}},tents:result?.tents||0,
    drawn:{near:drawnNear,far:drawnFar,triangles:nearTriangles+farTriangles,nearTriangles,farTriangles,draws},
    nearest:nearestId<0?null:{kind:result.items[nearestId].kind,distance:nearestDistance,bearing:(Math.atan2(result.items[nearestId].x-viewer.x,viewer.z-result.items[nearestId].z)*180/Math.PI+360)%360},
    skipped:{...(result?.skipped||{}),nearBudget:budgetNear,farBudget:budgetFar},work:{...(result?.work||{}),preparedFrames,distanceChecks:checks,buckets}});
  if(query.get('debug')==='1')globalThis.__kzTownDress=inspect;
  return {
    update(frame){
      if(disposed||paused)return;
      if(first){first=false;return;}
      if(!ready){
        preparedFrames++;
        if(!building){const next=job.next();result=next.value;if(!next.done)return;buildMatrices();building=true;return;}
        if(buildCursor<DRESS_KINDS.length){buildKind(DRESS_KINDS[buildCursor++]);return;}
        if(context.colliders)release=addDressBoxes(context.colliders,result.boxes);
        ready=true;text=`焼 ${result.plots.burnt}・直 ${result.plots.repair}・畑 ${result.plots.garden}・柵 ${result.fences.plots}・幕 ${result.tents}`;
      }
      viewer.copy(frame.camera?.position||context.camera?.position||frame.pos);
      shared.uDressTime.value=frame.time||0;shared.uDressWind.value=frame.wind||0;if(frame.windDir)dir.set(frame.windDir[0],frame.windDir[1]);
      context.renderer?.getDrawingBufferSize?.(viewport);
      // Steady state: time and wind above are all that changes. Rebuild only after the eye has moved, or the quality step changed.
      if(built&&step===builtStep&&Math.abs(viewer.x-builtAt.x)<C.refresh&&Math.abs(viewer.y-builtAt.y)<C.refresh&&Math.abs(viewer.z-builtAt.z)<C.refresh)return;
      built=true;builtStep=step;builtAt.copy(viewer);
      drawnNear=0;drawnFar=0;nearTriangles=0;farTriangles=0;draws=0;budgetNear=0;budgetFar=0;checks=0;buckets=0;nearestId=-1;nearestDistance=Infinity;selected=0;
      for(let s=0;s<sets.length;s++)sets[s].mesh.count=0;
      const range=dressRange('burnt',context.quality,step),keep=dressKeep(context.quality,step),ix0=Math.floor(viewer.x/C.cell),iz0=Math.floor(viewer.z/C.cell),rings=Math.ceil(range/C.cell);
      // Visit nearest cells first so budget pressure never replaces close fences with distant ruins.
      for(let ring=0;ring<=rings;ring++)for(let ox=-ring;ox<=ring;ox++)for(let oz=-ring;oz<=ring;oz++){
        if(Math.max(Math.abs(ox),Math.abs(oz))!==ring)continue;
        const list=result.index.get(dressKey(ix0+ox,iz0+oz));buckets++;if(!list)continue;
        for(let j=0;j<list.length;j++){
          const id=list[j],p=result.items[id];
          const max=dressRange(p.kind,context.quality,step);if(Math.abs(p.x-viewer.x)>max||Math.abs(p.z-viewer.z)>max||Math.abs(p.y-viewer.y)>max)continue;
          const d=Math.hypot(p.x-viewer.x,p.y-viewer.y,p.z-viewer.z);checks++;if(d>max)continue;
          const near=dressNear(p.kind);if(p.rank>=keep&&(!C.fenceHeights[p.kind]||d>=near-C.blend/2))continue;
          enqueue(id,d);
        }
      }
      while(selected){
        const id=dequeue(),p=result.items[id],d=distances[id],near=dressNear(p.kind);let shown=false;
        if(d<near+C.blend/2)shown=submit(nearSets[p.k],p,d);
        if(d>=near-C.blend/2)shown=submit(farSets[p.k],p,d)||shown;
        if(shown&&d<nearestDistance){nearestId=id;nearestDistance=d;}
      }
      for(let s=0;s<sets.length;s++){const mesh=sets[s].mesh;mesh.visible=mesh.count>0;if(mesh.visible){draws++;mesh.instanceMatrix.needsUpdate=true;mesh.geometry.attributes.aDressGround.needsUpdate=true;mesh.geometry.attributes.aDressStakes.needsUpdate=true;}}
    },
    setAdapt(next){step=Math.max(0,Math.min(3,next));},setPaused(on){paused=!!on;},
    debugText(){return disposed?'':ready?text:'町の物 配置中';},
    dispose(){if(disposed)return;disposed=true;job.return();release?.();group.removeFromParent();for(const s of sets){s.mesh.dispose();s.mesh.geometry.dispose();s.mesh.material.dispose();s.mesh.customDepthMaterial?.dispose();}if(globalThis.__kzTownDress===inspect)delete globalThis.__kzTownDress;},
  };
}
