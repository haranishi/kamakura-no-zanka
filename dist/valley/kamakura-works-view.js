// Up to seven fixed batches; static rock matrices, shader LOD, and one reused pose/matrix for each moored hull.
import * as THREE from '../vendor/three.module.min.js';
import { WORKS as W, worksEnabled, worksPlacementBatches, worksPolicy, worksMotion, worksCircles, fenceCircles } from './kamakura-works.js';
import { WORKS_ART as A, worksRockGeometry, worksPierGeometry, worksBoatGeometry, worksFenceGeometry } from './kamakura-works-kit.js';
import { addColliderCircles } from './collision.js';
export const WORKS_SHADER_PARS = `
uniform vec3 uWorksViewer;
uniform float uWorksNear, uWorksFar, uWorksKeep;
#ifdef WORKS_FENCE
attribute float aWorksFenceRank;
#endif
#ifdef WORKS_PIER
attribute vec3 aWorksCenter;
#else
attribute float aWorksRank, aWorksDetailed;
#endif
#ifdef WORKS_ROCK
varying float vWorksHeight;
varying float vWorksTone;
#ifndef WORKS_FAR
attribute float aWorksVariant;
attribute vec3 aWorksShape1, aWorksShape2, aWorksShape3;
#endif
#endif
#ifdef WORKS_BOAT
attribute float aWorksSail, aWorksSailPart;
#endif
`;
// Parent (real Chrome): the near boulders carried a second normal for each of the three alternative shapes. With the instance matrix
// that came to sixteen vertex attributes, and the program was refused ("Too many attributes"). The boulders are faceted now: the face
// normal comes from screen-space derivatives (flatShading), so no shape needs a normal attribute at all.
export const WORKS_ATTRIBUTE_SLOTS = 12; // the most vertex-attribute slots one works program may use (WebGL guarantees 16; a mat4 takes 4).
export const WORKS_BEGIN_VERTEX = `
vec3 transformed = vec3(position);
#if defined(WORKS_ROCK) && !defined(WORKS_FAR)
transformed = mix(transformed, aWorksShape1, step(0.5, aWorksVariant));
transformed = mix(transformed, aWorksShape2, step(1.5, aWorksVariant));
transformed = mix(transformed, aWorksShape3, step(2.5, aWorksVariant));
#endif
#ifdef WORKS_BOAT
transformed *= 1.0 - max(aWorksSailPart, 0.0) * (1.0 - aWorksSail) - max(-aWorksSailPart, 0.0) * aWorksSail;
#endif
#ifdef WORKS_PIER
vec3 worksCenter = aWorksCenter;
float worksRank = 0.0;
float worksDetailed = 1.0;
#else
vec3 worksCenter = instanceMatrix[3].xyz;
float worksRank = aWorksRank;
float worksDetailed = aWorksDetailed;
#endif
float worksDistance = distance(worksCenter, uWorksViewer);
float worksNear = (1.0 - step(uWorksNear, worksDistance)) * worksDetailed;
#ifdef WORKS_FAR
float worksVisible = 1.0 - worksNear;
#else
float worksVisible = worksNear;
#endif

#ifdef WORKS_FENCE
worksVisible = 1.0;
worksRank = aWorksFenceRank;
#endif
worksVisible *= (1.0 - step(uWorksFar, worksDistance)) * (1.0 - step(uWorksKeep, worksRank));
#ifdef WORKS_ROCK
vWorksHeight = (instanceMatrix * vec4(transformed, 1.0)).y;
vWorksTone = ${A.toneMin.toFixed(3)} + ${A.toneRange.toFixed(3)} * fract(sin(dot(worksCenter.xz, vec2(12.9898, 78.233))) * 43758.5453);
#endif
transformed *= worksVisible;
`;
export const WORKS_WET_FRAGMENT = `
#ifndef WORKS_MASK
float worksWet = 1.0 - step(${A.wetHeight.toFixed(3)}, vWorksHeight);
diffuseColor.rgb *= mix(1.0, ${A.wetRatio.toFixed(6)}, worksWet) * vWorksTone;
#endif
`;
export function installWorksShader(material,uniforms,kind,far=false,debug=false) {
  material.defines={...material.defines,['WORKS_'+kind.toUpperCase()]:1,...(kind==='fence'?{WORKS_PIER:1}:{}),...(far?{WORKS_FAR:1}:{}),...(debug?{WORKS_MASK:1}:{})};
  material.onBeforeCompile=shader=>{
    for(const hook of ['common','begin_vertex'])if(!shader.vertexShader.includes('#include <'+hook+'>'))throw new Error('Works shader hook missing: '+hook);
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+WORKS_SHADER_PARS)
      .replace('#include <begin_vertex>',WORKS_BEGIN_VERTEX);
    if(kind==='rock')shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vWorksHeight;\nvarying float vWorksTone;')
      .replace('#include <color_fragment>','#include <color_fragment>\n'+WORKS_WET_FRAGMENT);
  };
  material.customProgramCacheKey=()=>`works-${kind}-${+far}-${+debug}-3`;
}
export function createKamakuraWorks(context) {
  if(!worksEnabled(context.search)||!context.data?.works)return null;
  const q=new URLSearchParams(context.search),debug=q.get('worksdebug')==='1';
  if(debug)context.post?.setAdapt?.(2);
  const group=new THREE.Group();group.name='kamakura-works';context.scene.add(group);
  const job=worksPlacementBatches(context.data.works,context.terrain),sets=[],dummy=new THREE.Object3D(),viewer=new THREE.Vector3();
  const policy=worksPolicy(context.quality),uniforms={uWorksViewer:{value:viewer},uWorksNear:{value:policy.near},uWorksFar:{value:policy.far},uWorksKeep:{value:policy.keep}};
  const drawn={near:0,far:0,triangles:0,draws:0},work={distanceTests:0,matrixWrites:0};
  let result=null,ready=false,started=false,disposed=false,paused=false,clock=0,release=null,nearLimit=0,text='石 配置中';
  function setMatrix(mesh,index,p,boat=false) {
    const at=boat?p.pose:p;
    dummy.position.set(at.x,boat?at.y:p.y+p.size*p.sy/2,at.z);dummy.rotation.set(at.tiltX||0,at.yaw,at.tiltZ||0,'YXZ');
    dummy.scale.set(boat?p.w:p.size*p.sx,boat?1:p.size*p.sy,boat?p.d:p.size*p.sz);dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);
  }
  function add(kind,far,geometry,items) {
    if(!geometry.attributes.position.count||!items.length){geometry.dispose();return;}
    if(kind==='rock'&&debug) {const c=new THREE.Color(A.rockDebug),a=new Float32Array(geometry.attributes.position.count*3);for(let i=0;i<a.length;i+=3){a[i]=c.r;a[i+1]=c.g;a[i+2]=c.b;}geometry.setAttribute('color',new THREE.BufferAttribute(a,3));}
    const material=debug?new THREE.MeshBasicMaterial({vertexColors:true,fog:false,toneMapped:false,side:THREE.DoubleSide}):new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide});
    if(kind==='rock'&&!debug)material.flatShading=true;
    material.forceSinglePass=true;installWorksShader(material,uniforms,kind,far,debug);
    const mesh=(kind==='pier'||kind==='fence')?new THREE.Mesh(geometry,material):new THREE.InstancedMesh(geometry,material,items.length);
    mesh.name=`works-${kind}-${far?'far':'near'}`;mesh.frustumCulled=false;mesh.visible=false;mesh.castShadow=!far;mesh.receiveShadow=!far;
    if(!far) {mesh.customDepthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide});installWorksShader(mesh.customDepthMaterial,uniforms,kind,far,debug);}
    if(kind!=='pier'&&kind!=='fence') {
      geometry.setAttribute('aWorksRank',new THREE.InstancedBufferAttribute(Float32Array.from(items,p=>p.rank),1));
      geometry.setAttribute('aWorksDetailed',new THREE.InstancedBufferAttribute(Float32Array.from(items,(p,i)=>kind==='rock'?+(i<nearLimit):1),1));
      if(kind==='rock'&&!far)geometry.setAttribute('aWorksVariant',new THREE.InstancedBufferAttribute(Float32Array.from(items,p=>p.variant),1));
      if(kind==='boat'){geometry.setAttribute('aWorksSail',new THREE.InstancedBufferAttribute(Float32Array.from(items,p=>+(p.kind==='sail')),1));mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);}
      for(let i=0;i<items.length;i++)setMatrix(mesh,i,items[i],kind==='boat');mesh.instanceMatrix.needsUpdate=true;
    }
    const triangles=(geometry.index?geometry.index.count:geometry.attributes.position.count)/3*((kind==='pier'||kind==='fence')?1:items.length);
    group.add(mesh);sets.push({kind,far,mesh,items,triangles});
  }
  function build() {
    const pn=worksPierGeometry(result.piers,false,debug),pf=worksPierGeometry(result.piers,true,debug),bn=worksBoatGeometry(false,debug),bf=worksBoatGeometry(true,debug);
    const tris=g=>(g.index?g.index.count:g.attributes.position.count)/3;
    const fixed=tris(pn)+tris(pf)+(tris(bn)+tris(bf))*result.moorings.length;
    let fenceCost=0;for(const f of result.fences)fenceCost+=f.posts.length*(A.fenceSides*3-2)+f.rails.length*A.fenceSides*2;
    const fence=worksFenceGeometry(result.fences,debug,fixed+fenceCost>W.nearTriangles?A.fenceCoarseSides:A.fenceSides);
    const infrastructureNear=tris(fence)+tris(pn)+tris(bn)*result.moorings.length,infrastructureFar=tris(pf)+tris(bf)*result.moorings.length;
    const farLimit=Math.max(0,Math.min(result.rocks.length,Math.floor((W.farTriangles-infrastructureFar)/12),Math.floor((W.nearTriangles-infrastructureNear-infrastructureFar)/12)));
    nearLimit=Math.min(farLimit,Math.max(0,Math.floor((W.nearTriangles-infrastructureNear-infrastructureFar-farLimit*12)/42)));
    result.rocks.sort((a,b)=>a.rank-b.rank);
    result.moorings.sort((a,b)=>a.rank-b.rank);
    for(let i=0;i<result.rocks.length;i++)result.rocks[i].rank=i/result.rocks.length;
    add('rock',false,worksRockGeometry(),result.rocks.slice(0,nearLimit));add('rock',true,worksRockGeometry(true),result.rocks.slice(0,farLimit));
    add('pier',false,pn,result.piers);add('pier',true,pf,result.piers);
    add('boat',false,bn,result.moorings);add('boat',true,bf,result.moorings);
    add('fence',false,fence,result.fences.flatMap(f=>f.posts));
    let total=0,far=0;for(const s of sets){total+=s.triangles;if(s.far)far+=s.triangles;}
    if(total>W.nearTriangles||far>W.farTriangles||sets.length>W.draws)throw new Error('港の描画予算を超えました');
    if(context.colliders)release=addColliderCircles(context.colliders,[...worksCircles(result.rocks),...fenceCircles(result.fences)]);
    text=`石 ${result.rocks.length}・桟 ${result.piers.length}・繋 ${result.moorings.length}・柵 ${result.fences.length}・杭 ${result.fences.reduce((n,f)=>n+f.posts.length,0)}`;
  }
  function visible(s,p,i) {
    const at=s.kind==='boat'?p.pose:p,d=Math.hypot(at.x-viewer.x,(at.y+(s.kind==='rock'?p.size/2:0))-viewer.y,at.z-viewer.z);
    if(d>=uniforms.uWorksFar.value||(p.rank??0)>=uniforms.uWorksKeep.value)return false;
    if(s.kind==='fence')return true;
    const detailed=s.kind!=='rock'||i<nearLimit,near=d<uniforms.uWorksNear.value&&detailed;return s.far?!near:near;
  }
  function inspect() {
    let nearest=null;
    for(const s of sets)for(let i=0;i<s.items.length;i++)if(visible(s,s.items[i],i)) {
      const p=s.items[i],at=s.kind==='boat'?p.pose:p,d=Math.hypot(at.x-viewer.x,at.y+(s.kind==='rock'?p.size/2:0)-viewer.y,at.z-viewer.z);
      if(!nearest||d<nearest.distance)nearest={kind:s.kind==='boat'?p.kind:s.kind,distance:d,bearing:(Math.atan2(at.x-viewer.x,viewer.z-at.z)*180/Math.PI+360)%360};
    }
    return {rocks:{groups:result?.groups??0,placed:result?.rocks.length??0,skipped:result?.skipped??0},piers:result?.piers.length??0,moorings:result?.moorings.length??0,
      fences:result?.fences.length??0,posts:result?.fences.reduce((n,f)=>n+f.posts.length,0)??0,drawn:{...drawn},nearest,ready,supplemental:result?.supplemental??0,work:{...result?.work,...work},limits:{near:nearLimit}};
  }
  if(q.get('debug')==='1')globalThis.__kzWorks=inspect;
  return {
    update(frame) {
      if(disposed||paused)return;
      if(!started){started=true;return;}
      if(!ready){const next=job.next();result=next.value;if(!next.done)return;build();ready=true;}
      const pos=frame.camera?.position||context.camera?.position||frame.pos;viewer.set(pos.x,pos.y??0,pos.z);
      clock+=frame.dt;drawn.near=0;drawn.far=0;drawn.triangles=0;drawn.draws=0;work.distanceTests=0;work.matrixWrites=0;
      for(const p of result.moorings)worksMotion(p,clock,p.pose);
      for(const s of sets) {
        let count=0,kept=0;
        for(let i=0;i<s.items.length;i++){const p=s.items[i];if(s.kind!=='pier'&&s.kind!=='fence'&&p.rank>=uniforms.uWorksKeep.value)break;kept++;if(s.kind==='boat'){setMatrix(s.mesh,i,p,true);work.matrixWrites++;}work.distanceTests++;if(visible(s,p,i))count++;}
        if(s.kind==='boat')s.mesh.instanceMatrix.needsUpdate=true;
        if(s.kind!=='pier'&&s.kind!=='fence')s.mesh.count=kept;
        s.mesh.visible=count>0;
        if(s.far)drawn.far+=count;else drawn.near+=count;
        if(count){drawn.triangles+=s.triangles*((s.kind==='pier'||s.kind==='fence')?1:kept/s.items.length);drawn.draws++;}
      }
    },
    setAdapt(step){const p=worksPolicy(context.quality,Math.max(0,Math.min(3,step)));uniforms.uWorksNear.value=p.near;uniforms.uWorksFar.value=p.far;uniforms.uWorksKeep.value=p.keep;},
    setPaused(on){paused=!!on;},debugText(){return disposed?'':text;},
    dispose(){if(disposed)return;disposed=true;job.return();release?.();group.removeFromParent();for(const s of sets){s.mesh.dispose?.();s.mesh.geometry.dispose();s.mesh.material.dispose();s.mesh.customDepthMaterial?.dispose();}if(globalThis.__kzWorks===inspect)delete globalThis.__kzWorks;},
  };
}
