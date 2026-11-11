// W2c-19e-2: a shared silhouette and one opaque instanced draw, with no character assets/shadows.
import * as THREE from '../vendor/three.module.min.js';
import { PEOPLE, PEOPLE_ROLES, peopleAmount } from './kamakura-people.js';
import { CROWD, crowdEnabled, crowdRange, crowdNear, crowdScale, crowdMotion, crowdPlacementBatches,
  crowdShape, createCrowdSelection, selectCrowd } from './kamakura-crowd.js';

const gl = n => Number(n).toFixed(8);
export const CROWD_VERTEX_PARS = `
attribute vec4 crowdAnchor;
attribute vec4 crowdWalk;
attribute vec3 crowdPerson;
attribute vec3 crowdCornerA;
attribute vec3 crowdCornerB;
attribute vec3 crowdCornerC;
attribute float crowdPart;
uniform float uCrowdTime;
uniform float uCrowdDebug;
uniform vec2 uCrowdCentre;
uniform vec3 uCrowdCamera;
uniform vec4 uCrowdBands;
uniform vec3 uCrowdSkin;
uniform vec3 uCrowdHair;
uniform vec3 uCrowdStraw;
uniform vec3 uCrowdCloth;
vec3 crowdPose(vec3 p) {
  if (crowdPart > 1.5) {
    float crowdRadius = crowdPerson.z < 0.5 ? ${gl(CROWD.cover[0])} : crowdPerson.z < 1.5 ? ${gl(CROWD.cover[1])} : ${gl(CROWD.cover[2])};
    p.xz *= crowdRadius / ${gl(CROWD.cover[0])};
  }
  if (crowdPerson.y > 0.5 && crowdPerson.y < 1.5) {
    if (p.y <= ${gl(CROWD.hip)}) p.x *= ${gl(CROWD.sitterWidth)};
    p.y *= ${gl(CROWD.sitter)};
  }
  if (crowdPerson.y > 1.5 && p.y > ${gl(CROWD.hip)}) {
    p.z -= (p.y - ${gl(CROWD.hip)}) * ${gl(CROWD.farmerLean)};
    p.y = ${gl(CROWD.hip)} + (p.y - ${gl(CROWD.hip)}) * ${gl(CROWD.farmerBend)};
  }
  p.y *= mix(1.0, ${gl(CROWD.debugHeight)}, uCrowdDebug);
  return p * crowdAnchor.w;
}
`;
export const CROWD_VERTEX_STATE = `
float crowdCycle = mod(uCrowdTime * ${gl(CROWD.speed)} + crowdWalk.w, ${gl(CROWD.walk * 4)});
float crowdSign = mix(1.0, crowdCycle < ${gl(CROWD.walk * 2)} ? 1.0 : -1.0, crowdPerson.x);
float crowdTravel = (${gl(CROWD.walk)} - abs(crowdCycle - ${gl(CROWD.walk * 2)})) * crowdPerson.x;
float crowdBob = sin((uCrowdTime * ${gl(CROWD.speed)} + crowdWalk.w) * ${gl(CROWD.bobRate)}) * ${gl(CROWD.bob)} * crowdPerson.x;
vec3 crowdOrigin = crowdAnchor.xyz + vec3(crowdWalk.x * crowdTravel, crowdWalk.z * crowdTravel + crowdBob, crowdWalk.y * crowdTravel);
float crowdAway = distance(crowdOrigin, uCrowdCamera);
float crowdSize = clamp((distance(crowdOrigin.xz, uCrowdCentre) - uCrowdBands.x) / uCrowdBands.y, 0.0, 1.0)
  * clamp((uCrowdBands.z - crowdAway) / uCrowdBands.w, 0.0, 1.0)
  * mix(1.0, ${gl(CROWD.farScale)}, smoothstep(${gl(CROWD.farFrom)}, ${gl(CROWD.farTo)}, crowdAway));
if (uCrowdDebug < 0.5) {
  if (crowdPart > 0.5 && crowdPart < 1.5) vColor = uCrowdSkin;
  if (crowdPart > 1.5) vColor = crowdPerson.z < 0.5 ? uCrowdHair : crowdPerson.z < 1.5 ? uCrowdStraw : uCrowdCloth;
}
`;
export const CROWD_VERTEX_NORMAL = `
vec3 crowdA = crowdPose(crowdCornerA);
objectNormal = normalize(cross(crowdPose(crowdCornerB) - crowdA, crowdPose(crowdCornerC) - crowdA));
objectNormal.xz = vec2(-crowdWalk.y * objectNormal.x - crowdWalk.x * objectNormal.z,
  crowdWalk.x * objectNormal.x - crowdWalk.y * objectNormal.z) * crowdSign;
`;
export const CROWD_VERTEX_POSITION = `
transformed = crowdPose(position);
transformed.xz = vec2(-crowdWalk.y * transformed.x - crowdWalk.x * transformed.z,
  crowdWalk.x * transformed.x - crowdWalk.y * transformed.z) * crowdSign;
transformed = transformed * crowdSize + crowdOrigin;
`;

// The shadow pass draws the same bodies laid flat on the ground, away from the sun (uCrowdSun points towards it).
export const CROWD_SHADOW_PARS = 'uniform vec3 uCrowdSun;\n';
export const CROWD_SHADOW_POSITION = `
float crowdUp = max(0.0, transformed.y - crowdOrigin.y);
transformed.xz -= uCrowdSun.xz * crowdUp * min(${gl(CROWD.shadowReach)}, 1.0 / max(uCrowdSun.y, 0.05));
transformed.y = crowdOrigin.y + ${gl(CROWD.shadowLift)};
`;
export function createKamakuraCrowd(context) {
  if (!crowdEnabled(context.search)) return null;
  const params = new URLSearchParams(context.search), debug = params.get('debug') === '1', paint = params.get('crowddebug') === '1';
  const selection = createCrowdSelection(), job = crowdPlacementBatches(context, peopleAmount(context.search) * CROWD.density);
  const shape = crowdShape(), vertices = shape.parts.length, geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(shape.positions,3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(shape.normals,3));
  geometry.setAttribute('crowdPart', new THREE.BufferAttribute(new Float32Array(shape.parts),1));
  // Recompute flat normals after posing. This also handles the wider seated hem and bent sleeves correctly.
  for (const [name,corner] of [['crowdCornerA',0],['crowdCornerB',1],['crowdCornerC',2]]) {
    const data=new Float32Array(vertices*3);
    for(let i=0;i<vertices;i++) {
      const j=(Math.floor(i/3)*3+corner)*3;
      data[i*3]=shape.positions[j];data[i*3+1]=shape.positions[j+1];data[i*3+2]=shape.positions[j+2];
    }
    geometry.setAttribute(name,new THREE.BufferAttribute(data,3));
  }
  const color = new THREE.InstancedBufferAttribute(new Float32Array(CROWD.max*3),3).setUsage(THREE.DynamicDrawUsage);
  const anchor = new THREE.InstancedBufferAttribute(new Float32Array(CROWD.max*4),4).setUsage(THREE.DynamicDrawUsage);
  const walk = new THREE.InstancedBufferAttribute(new Float32Array(CROWD.max*4),4).setUsage(THREE.DynamicDrawUsage);
  const person = new THREE.InstancedBufferAttribute(new Float32Array(CROWD.max*3),3).setUsage(THREE.DynamicDrawUsage);
  const attributes = [color,anchor,walk,person];
  geometry.setAttribute('color',color);geometry.setAttribute('crowdAnchor',anchor);geometry.setAttribute('crowdWalk',walk);geometry.setAttribute('crowdPerson',person);
  geometry.instanceCount=0;geometry.setDrawRange(0,vertices);
  const clothes=CROWD.clothes.map(c=>new THREE.Color(c)),debugColors=CROWD.debug.map(c=>new THREE.Color(c));
  const uniforms = { uCrowdTime: { value: 0 }, uCrowdDebug:{value:paint?1:0}, uCrowdCentre: { value: new THREE.Vector2() },
    uCrowdCamera: { value: new THREE.Vector3() }, uCrowdBands: { value: new THREE.Vector4(crowdNear(context.quality), PEOPLE.fade, crowdRange(context.quality,0), CROWD.fade) },
    uCrowdSkin:{value:new THREE.Color(CROWD.skin)},uCrowdHair:{value:new THREE.Color(CROWD.hair)},
    uCrowdStraw:{value:clothes[4]},uCrowdCloth:{value:clothes[2]} };
  const material = paint ? new THREE.MeshBasicMaterial({ vertexColors:true, fog:false, toneMapped:false })
    : new THREE.MeshLambertMaterial({ vertexColors:true, fog:true });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + CROWD_VERTEX_PARS)
      .replace('#include <batching_vertex>', '#include <batching_vertex>\n' + CROWD_VERTEX_STATE)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + CROWD_VERTEX_NORMAL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + CROWD_VERTEX_POSITION);
  };
  material.customProgramCacheKey = () => 'kamakura-crowd-1';
  const mesh = new THREE.Mesh(geometry, material); mesh.name = 'kamakura-crowd'; mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = false; mesh.visible = false; context.scene.add(mesh);
  // The same instances once more, flattened: no shadow map reaches this far, and without a shadow a figure does not stand on the ground.
  const sun = context.sunDir, shadowUniforms = { ...uniforms, uCrowdSun: { value: sun ? new THREE.Vector3(sun.x, sun.y, sun.z).normalize() : new THREE.Vector3(0, 1, 0) } };
  const shadowMaterial = paint || !sun ? null : new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: CROWD.shadow, depthWrite: false, fog: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  if (shadowMaterial) {
    shadowMaterial.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, shadowUniforms);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + CROWD_VERTEX_PARS.replace('uniform vec3 uCrowdCloth;', 'uniform vec3 uCrowdCloth;\nvarying vec3 vColor;') + CROWD_SHADOW_PARS)
        .replace('#include <batching_vertex>', '#include <batching_vertex>\n' + CROWD_VERTEX_STATE)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + CROWD_VERTEX_POSITION + CROWD_SHADOW_POSITION);
    };
    shadowMaterial.customProgramCacheKey = () => 'kamakura-crowd-shadow-1';
  }
  const shadowMesh = shadowMaterial ? new THREE.Mesh(geometry, shadowMaterial) : null;
  if (shadowMesh) { shadowMesh.name = 'kamakura-crowd-shadow'; shadowMesh.frustumCulled = false; shadowMesh.castShadow = shadowMesh.receiveShadow = false; shadowMesh.visible = false; shadowMesh.renderOrder = 1; context.scene.add(shadowMesh); }
  const centre = {x:0,z:0}, camera = {x:0,y:0,z:0}, motion = {travel:0,bob:0,direction:1};
  let bodies = [], ready = false, disposed = false, paused = false, step = 0, refresh = true, time = 0;
  let cx = Infinity, cz = Infinity, vx = Infinity, vy = Infinity, vz = Infinity, preparations = 0, selections = 0, uploads = 0;
  function pack() {
    for (let k=0;k<selection.count;k++) {
      const b=bodies[selection.chosen[k]],p=b.spot,j3=k*3,j4=k*4,c=paint?debugColors[PEOPLE_ROLES.indexOf(p.role)]:clothes[b.cloth];
      color.array[j3]=c.r;color.array[j3+1]=c.g;color.array[j3+2]=c.b;
      anchor.array[j4]=p.x;anchor.array[j4+1]=b.y;anchor.array[j4+2]=p.z;anchor.array[j4+3]=b.height*(p.role==='child'?CROWD.child:1);
      walk.array[j4]=b.dx;walk.array[j4+1]=b.dz;walk.array[j4+2]=b.slope;walk.array[j4+3]=b.phase;
      person.array[j3]=p.role==='walker'?1:0;person.array[j3+1]=p.role==='sitter'?1:p.role==='farmer'?2:0;person.array[j3+2]=b.head;
    }
    for (const attribute of attributes) attribute.needsUpdate=true;
    geometry.instanceCount=selection.count;mesh.visible=selection.count>0;if(shadowMesh)shadowMesh.visible=mesh.visible;uploads+=selection.count;
  }
  function update(frame) {
    if(disposed || paused) return;
    if(!ready) {
      const start=performance.now();
      for(let i=0;i<CROWD.batch;i++) {
        const next=job.next(); preparations++; bodies=next.value;
        if(next.done) {ready=true;refresh=true;break;}
        if(performance.now()-start>=CROWD.budget) break;
      }
    }
    time+=Math.max(0,frame.dt); uniforms.uCrowdTime.value=time;
    centre.x=frame.pos.x; centre.z=frame.pos.z;
    const eye=frame.camera?.position || context.camera?.position || frame.pos;
    camera.x=eye.x; camera.y=eye.y; camera.z=eye.z;
    uniforms.uCrowdCentre.value.set(centre.x,centre.z); uniforms.uCrowdCamera.value.set(camera.x,camera.y,camera.z);
    if(!ready || step>=3) return;
    if(refresh || Math.hypot(centre.x-cx,centre.z-cz)>=CROWD.refresh || Math.hypot(camera.x-vx,camera.y-vy,camera.z-vz)>=CROWD.refresh) {
      selectCrowd(bodies,centre,camera,context.quality,step,selection); selections++; pack(); refresh=false;
      cx=centre.x; cz=centre.z; vx=camera.x; vy=camera.y; vz=camera.z;
    }
  }
  const snapshot = () => {
    const byRole=Object.fromEntries(PEOPLE_ROLES.map(role=>[role,0])); let nearest=null,drawn=0;
    for(let k=0;k<selection.count;k++) {
      const b=bodies[selection.chosen[k]],p=b.spot;crowdMotion(b,time,motion);
      const x=p.x+b.dx*motion.travel,y=b.y+b.slope*motion.travel+motion.bob,z=p.z+b.dz*motion.travel;
      const distance=Math.hypot(x-camera.x,y-camera.y,z-camera.z),horizontal=Math.hypot(x-centre.x,z-centre.z);
      if(!mesh.visible || crowdScale(horizontal,distance,context.quality,step)<=0) continue;
      byRole[p.role]++;drawn++;
      if(!nearest || distance<nearest.distance) nearest={role:p.role,distance,bearing:(Math.atan2(x-camera.x,camera.z-z)*180/Math.PI+360)%360};
    }
    return {ready,spots:bodies.length,drawn,selected:selection.count,triangles:mesh.visible?shape.triangles*geometry.instanceCount:0,
      draws:mesh.visible?(shadowMesh?2:1):0,nearest,byRole,time,work:{preparations,selections,scans:selection.scans,comparisons:selection.comparisons,uploadedInstances:uploads}};
  };
  if(debug) globalThis.__kzCrowd=snapshot;
  return {update,
    setAdapt(value) {
      if(disposed) return;step=value;refresh=true;uniforms.uCrowdBands.value.z=crowdRange(context.quality,step);
      if(step>=3) {selection.count=0;geometry.instanceCount=0;mesh.visible=false;if(shadowMesh)shadowMesh.visible=false;}
    },
    setPaused(on) {paused=!!on;},
    debugText() {return disposed?'':`影 ${selection.count}/${bodies.length}`;},
    dispose() {
      if(disposed) return;disposed=true;job.return();mesh.visible=false;mesh.removeFromParent();geometry.dispose();material.dispose();
      if(shadowMesh){shadowMesh.visible=false;shadowMesh.removeFromParent();shadowMaterial.dispose();}
      bodies.length=0;selection.count=0;
      if(globalThis.__kzCrowd===snapshot) delete globalThis.__kzCrowd;
    },
  };
}
