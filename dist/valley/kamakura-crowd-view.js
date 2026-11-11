// Shared rounded silhouettes in two distance batches; gait and lighting run in the vertex shader.
import { atmosphereOptions } from './kamakura-atmosphere.js';
import * as THREE from '../vendor/three.module.min.js';
import { PEOPLE, PEOPLE_ROLES, peopleAmount, prepareFlight, sampleFlight } from './kamakura-people.js';
import { CROWD, crowdEnabled, crowdRange, crowdNear, crowdScale, crowdMotion, crowdPlacementBatches,
  crowdShape, crowdTraits, travellerTraits, TRAVELLER, createCrowdSelection, selectCrowd } from './kamakura-crowd.js';

const EVENING = Object.freeze(['evening','dusk']);
const gl = n => Number(n).toFixed(8);
export const CROWD_VERTEX_PARS = `
attribute vec4 crowdAnchor;
attribute vec4 crowdWalk;
attribute vec4 crowdPerson;
attribute float crowdJoint;
attribute float crowdPackGain;
attribute vec3 crowdCornerA;
attribute vec3 crowdCornerB;
attribute vec3 crowdCornerC;
attribute float crowdPart;
uniform float uCrowdTraveller;
uniform float uCrowdTime;
uniform float uCrowdDebug;
uniform vec2 uCrowdCentre;
uniform vec3 uCrowdCamera;
uniform vec4 uCrowdBands;
uniform vec3 uCrowdSkin;
uniform vec3 uCrowdHair;
uniform vec3 uCrowdStraw;
uniform vec3 uCrowdTravellerStraw;
uniform vec3 uCrowdCloth;
uniform vec3 uCrowdPack0;
uniform vec3 uCrowdPack1;
uniform vec3 uCrowdPack2;
uniform vec3 uCrowdWood;
uniform float uCrowdClothGain;
vec3 crowdPose(vec3 p) {
  float walking = (uCrowdTraveller > 0.5 || crowdPerson.x > 0.5) ? 1.0 : 0.0;
  float swing = sin(uCrowdTime * ${gl(CROWD.gaitRate)} + crowdWalk.w) * walking;
  if (crowdJoint > 0.5 && crowdJoint < 2.5) {
    float leg = swing * (crowdJoint < 1.5 ? 1.0 : -1.0);
    float weight = max(0.0, 1.0 - p.y / ${gl(CROWD.legTop)});
    p.z += leg * ${gl(CROWD.stride)} * weight;
    p.y += max(0.0, leg) * ${gl(CROWD.footLift)} * weight;
  }
  if (crowdJoint > 2.5) p.z += swing * (crowdJoint < 3.5 ? -1.0 : 1.0) * ${gl(CROWD.armSwing)} * max(0.0, (${gl(CROWD.shoulder)} - p.y) / ${gl(CROWD.shoulder-CROWD.armLow)});
  if (p.y > ${gl(CROWD.hip)}) p.z -= (p.y - ${gl(CROWD.hip)}) * ${gl(CROWD.lean)} * walking;
  if (uCrowdTraveller < 0.5 && crowdPart > 1.5) {
    float crowdRadius = crowdPerson.z < 0.5 ? ${gl(CROWD.cover[0])} : crowdPerson.z < 1.5 ? ${gl(CROWD.cover[1])} : ${gl(CROWD.cover[2])};
    p.xz *= crowdRadius / ${gl(CROWD.cover[0])};
  }
  if (uCrowdTraveller < 0.5 && crowdPerson.y > 0.5 && crowdPerson.y < 1.5) {
    if (p.y <= ${gl(CROWD.hip)}) p.x *= ${gl(CROWD.sitterWidth)};
    p.y *= ${gl(CROWD.sitter)};
  }
  if (uCrowdTraveller < 0.5 && crowdPerson.y > 1.5 && p.y > ${gl(CROWD.hip)}) {
    p.z -= (p.y - ${gl(CROWD.hip)}) * ${gl(CROWD.farmerLean)};
    p.y = ${gl(CROWD.hip)} + (p.y - ${gl(CROWD.hip)}) * ${gl(CROWD.farmerBend)};
  }
  p.y *= mix(1.0, ${gl(CROWD.debugHeight)}, uCrowdDebug);
  return p * crowdAnchor.w;
}
`;
export const CROWD_VERTEX_STATE = `
float crowdHandoff = crowdPerson.x < -1.5 ? 0.0 : 1.0;
float crowdCycle = mod(uCrowdTime * ${gl(CROWD.speed)} + crowdWalk.w, ${gl(CROWD.walk * 4)});
float crowdSign = mix(1.0, crowdCycle < ${gl(CROWD.walk * 2)} ? 1.0 : -1.0, max(0.0,crowdPerson.x));
float crowdTravel = (${gl(CROWD.walk)} - abs(crowdCycle - ${gl(CROWD.walk * 2)})) * max(0.0,crowdPerson.x);
float crowdBob = 0.0;
vec3 crowdOrigin = crowdAnchor.xyz + vec3(crowdWalk.x * crowdTravel, crowdWalk.z * crowdTravel + crowdBob, crowdWalk.y * crowdTravel);
float crowdAway = distance(crowdOrigin, uCrowdCamera);
float crowdSize = mix(1.0, clamp((distance(crowdOrigin.xz, uCrowdCentre) - uCrowdBands.x) / uCrowdBands.y, 0.0, 1.0), crowdHandoff)
  * clamp((uCrowdBands.z - crowdAway) / uCrowdBands.w, 0.0, 1.0)
  * (1.0 - crowdPerson.w)
  * mix(1.0, ${gl(CROWD.farScale)}, smoothstep(${gl(CROWD.farFrom)}, ${gl(CROWD.farTo)}, crowdAway));
if (uCrowdDebug < 0.5) {
  vColor *= uCrowdClothGain;
  if (crowdPart > 0.5 && crowdPart < 1.5) vColor = uCrowdSkin;
  if (crowdPart > 1.5 && crowdPart < 2.5) vColor = uCrowdTraveller > 0.5 ? uCrowdTravellerStraw : crowdPerson.z < 0.5 ? uCrowdHair : crowdPerson.z < 1.5 ? uCrowdStraw : uCrowdCloth;
  if (uCrowdTraveller > 0.5 && (crowdPart > 2.5 && crowdPart < 3.5 || crowdPart > 4.5)) vColor = (crowdPerson.z < 0.5 ? uCrowdPack0 : crowdPerson.z < 1.5 ? uCrowdPack1 : uCrowdPack2) * crowdPackGain * uCrowdClothGain;
  if (uCrowdTraveller > 0.5 && crowdPart > 3.5 && crowdPart < 4.5) vColor = uCrowdWood;
}
`;
export const CROWD_VERTEX_NORMAL = `
vec3 crowdA = crowdPose(crowdCornerA);
vec3 crowdNormal = cross(crowdPose(crowdCornerB) - crowdA, crowdPose(crowdCornerC) - crowdA);
objectNormal = crowdNormal / max(length(crowdNormal), 0.00000001);
objectNormal.xz = vec2(-crowdWalk.y * objectNormal.x - crowdWalk.x * objectNormal.z,
  crowdWalk.x * objectNormal.x - crowdWalk.y * objectNormal.z) * crowdSign;
`;
export const CROWD_VERTEX_POSITION = `
transformed = crowdPose(position);
if (uCrowdTraveller > 0.5) {
  if (crowdPart > 2.5 && crowdPart < 3.5 && abs(crowdPerson.y - 1.0) > 0.5) transformed *= 0.0;
  if (crowdPart > 3.5 && crowdPart < 4.5 && abs(crowdPerson.y - 2.0) > 0.5) transformed *= 0.0;
  if (crowdPart > 4.5 && abs(crowdPerson.y - 3.0) > 0.5) transformed *= 0.0;
}
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
export function createKamakuraCrowd(context, travellers = false) {
  if (!crowdEnabled(context.search)) return null;
  const params = new URLSearchParams(context.search), debug = params.get('debug') === '1', paint = params.get('crowddebug') === '1' || travellers && params.get('flightdebug') === '1';
  const flightSpots = travellers ? prepareFlight(context) : [];
  if (travellers && !flightSpots.length) return null;
  const companion = travellers ? null : createKamakuraCrowd(context, true);

  const capacity = travellers ? flightSpots.length : CROWD.max;
  const selection = createCrowdSelection(capacity), job = travellers ? null : crowdPlacementBatches(context, peopleAmount(context.search) * CROWD.density);
  const shape=travellers?crowdShape('traveller',1,true):crowdShape();
  const lowShape=travellers?crowdShape('traveller',1,true,true):crowdShape('chat',0,false,true);
  function makeBatch(shape) {
    const geometry=new THREE.InstancedBufferGeometry(),vertices=shape.parts.length;
    geometry.setAttribute('position',new THREE.BufferAttribute(shape.positions,3));
    geometry.setAttribute('normal',new THREE.BufferAttribute(shape.normals,3));
    geometry.setAttribute('crowdPart',new THREE.BufferAttribute(new Float32Array(shape.parts),1));
    geometry.setAttribute('crowdJoint',new THREE.BufferAttribute(new Float32Array(shape.joints),1));
    for(const [name,corner] of [['crowdCornerA',0],['crowdCornerB',1],['crowdCornerC',2]]) {
      const data=new Float32Array(vertices*3);
      for(let i=0;i<vertices;i++) {const j=(Math.floor(i/3)*3+corner)*3;data[i*3]=shape.positions[j];data[i*3+1]=shape.positions[j+1];data[i*3+2]=shape.positions[j+2];}
      geometry.setAttribute(name,new THREE.BufferAttribute(data,3));
    }
    const dynamic=(name,size)=>{const attribute=new THREE.InstancedBufferAttribute(new Float32Array(capacity*size),size).setUsage(THREE.DynamicDrawUsage);geometry.setAttribute(name,attribute);return attribute;};
    const color=dynamic('color',3),anchor=dynamic('crowdAnchor',4),walk=dynamic('crowdWalk',4),person=dynamic('crowdPerson',4),packGain=dynamic('crowdPackGain',1);
    geometry.instanceCount=0;geometry.setDrawRange(0,vertices);
    return {shape,geometry,color,anchor,walk,person,packGain,attributes:[color,anchor,walk,person,packGain],count:0,mesh:null,shadowMesh:null};
  }
  const batches=[makeBatch(shape),makeBatch(lowShape)];
  const travellerColor=new THREE.Color(CROWD.travellerDebug),clothes=CROWD.clothes.map(c=>new THREE.Color(c)),debugColors=CROWD.debug.map(c=>new THREE.Color(c));
  const uniforms = { uCrowdClothGain:{value:EVENING.includes(atmosphereOptions(context.search).time)?CROWD.duskGain:1}, uCrowdTraveller: {value:travellers?1:0}, uCrowdTime: { value: 0 }, uCrowdDebug:{value:paint?1:0}, uCrowdCentre: { value: new THREE.Vector2() },
    uCrowdCamera: { value: new THREE.Vector3() }, uCrowdBands: { value: new THREE.Vector4(crowdNear(context.quality), PEOPLE.fade, crowdRange(context.quality,0), CROWD.fade) },
    uCrowdSkin:{value:new THREE.Color(CROWD.skin)},uCrowdHair:{value:new THREE.Color(CROWD.hair)},
    uCrowdStraw:{value:clothes[4]},uCrowdTravellerStraw:{value:new THREE.Color().fromArray(TRAVELLER.straw)},uCrowdCloth:{value:clothes[2]},
    uCrowdPack0:{value:clothes[0]},uCrowdPack1:{value:clothes[1]},uCrowdPack2:{value:clothes[2]},uCrowdWood:{value:new THREE.Color().fromArray(TRAVELLER.wood)} };
  const material = paint ? new THREE.MeshBasicMaterial({ vertexColors:true, fog:false, toneMapped:false })
    : new THREE.MeshLambertMaterial({ vertexColors:true, fog:true });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + CROWD_VERTEX_PARS)
      .replace('#include <batching_vertex>', '#include <batching_vertex>\n' + CROWD_VERTEX_STATE)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + CROWD_VERTEX_NORMAL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + CROWD_VERTEX_POSITION);
  };
  material.customProgramCacheKey = () => 'kamakura-crowd-4';
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
    shadowMaterial.customProgramCacheKey = () => 'kamakura-crowd-shadow-4';
  }
  for(let i=0;i<batches.length;i++) {
    const batch=batches[i],mesh=new THREE.Mesh(batch.geometry,material);
    mesh.name=(travellers?'kamakura-travellers':'kamakura-crowd')+(i?'-far':'');mesh.frustumCulled=false;
    mesh.castShadow=mesh.receiveShadow=false;mesh.visible=false;context.scene.add(mesh);batch.mesh=mesh;
    if(shadowMaterial) {
      const shadowMesh=new THREE.Mesh(batch.geometry,shadowMaterial);
      shadowMesh.name=(travellers?'kamakura-travellers-shadow':'kamakura-crowd-shadow')+(i?'-far':'');
      shadowMesh.frustumCulled=false;shadowMesh.castShadow=shadowMesh.receiveShadow=false;shadowMesh.visible=false;shadowMesh.renderOrder=1;
      context.scene.add(shadowMesh);batch.shadowMesh=shadowMesh;
    }
  }
  const centre = {x:0,z:0}, camera = {x:0,y:0,z:0}, motion = {travel:0,bob:0,direction:1};
  let bodies = travellers ? flightSpots.map(spot => ({spot, ...crowdTraits(spot), ...travellerTraits(spot), y:spot.y,slope:0,coverage:0})) : [], ready = travellers, disposed = false, paused = false, step = 0, refresh = true, time = 0;
  let cx = Infinity, cz = Infinity, vx = Infinity, vy = Infinity, vz = Infinity, preparations = 0, selections = 0, uploads = 0;
  function pack() {
    for(const batch of batches)batch.count=0;
    for (let k=0;k<selection.count;k++) {
      const b=bodies[selection.chosen[k]],batch=batches[selection.distances[k]>=CROWD.lodDistance?1:0],index=batch.count++;
      const {color,anchor,walk,person,packGain}=batch;
      const p=b.spot,j3=index*3,j4=index*4,c=paint?(p.flight ? (p.child?debugColors[5]:p.pole?debugColors[4]:p.staff?debugColors[3]:p.carry==='pack'?travellerColor:debugColors[6]) : debugColors[PEOPLE_ROLES.indexOf(p.role)]):clothes[b.cloth];
      color.array[j3]=c.r;color.array[j3+1]=c.g;color.array[j3+2]=c.b;
      anchor.array[j4]=p.x;anchor.array[j4+1]=b.y;anchor.array[j4+2]=p.z;anchor.array[j4+3]=b.height*(p.role==='child'||p.child?CROWD.child:1)*(p.flight?p.alpha:1);
      walk.array[j4]=b.dx;walk.array[j4+1]=b.dz;walk.array[j4+2]=b.slope;walk.array[j4+3]=b.phase;
      person.array[j4]=p.flight?-2:p.role==='walker'?1:0;
      person.array[j4+1]=p.flight?(p.carry==='pack'?1:p.staff?2:p.pole?3:0):p.role==='sitter'?1:p.role==='farmer'?2:0;
      person.array[j4+2]=p.flight?b.packCloth:b.head;person.array[j4+3]=p.flight?b.coverage:0;
      packGain.array[index]=p.flight?b.packGain:1;
    }
    for(const batch of batches) {
      for(const attribute of batch.attributes)attribute.needsUpdate=true;
      batch.geometry.instanceCount=batch.count;batch.mesh.visible=batch.count>0;
      if(batch.shadowMesh)batch.shadowMesh.visible=batch.mesh.visible;
    }
    uploads+=selection.count;
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
    companion?.update(frame);
    time = travellers && Number.isFinite(frame.time) ? frame.time : time + Math.max(0,frame.dt); uniforms.uCrowdTime.value=time;
    centre.x=frame.pos.x; centre.z=frame.pos.z;
    const eye=frame.camera?.position || context.camera?.position || frame.pos;
    camera.x=eye.x; camera.y=eye.y; camera.z=eye.z;
    uniforms.uCrowdCentre.value.set(centre.x,centre.z); uniforms.uCrowdCamera.value.set(camera.x,camera.y,camera.z);
    if(!ready || step>=3) return;
    if (travellers) {
      for (const b of bodies) {
        const p=b.spot; sampleFlight(p,time,context.terrain,p); b.y=p.y;b.dx=-Math.sin(p.yaw);b.dz=-Math.cos(p.yaw);
      }
      for(const b of bodies) {
        b.coverage=0;
        if(context.flightPeople)for(const slot of context.flightPeople)if(b.spot.alpha>0 && slot.live && slot.state.spot.id===b.spot.id) {
          const target=b.height*(b.spot.child?CROWD.child:1)/slot.ch.height;
          b.coverage=Math.max(0,Math.min(1,slot.ch.root.scale.x / target / b.spot.alpha));
        }
      }
      // At most 144 moving bodies; the static crowd still does no selection/uploads at rest.
      selectCrowd(bodies,centre,camera,context.quality,step,selection,true,0,Math.floor(capacity*(context.quality==='light'?CROWD.travellerLight:1)*(step>=2?CROWD.adaptCount:1)));selections++;pack();return;
    }
    if(refresh || Math.hypot(centre.x-cx,centre.z-cz)>=CROWD.refresh || Math.hypot(camera.x-vx,camera.y-vy,camera.z-vz)>=CROWD.refresh) {
      selectCrowd(bodies,centre,camera,context.quality,step,selection,false,companion?.capacity || 0); selections++; pack(); refresh=false;
      cx=centre.x; cz=centre.z; vx=camera.x; vy=camera.y; vz=camera.z;
    }
  }
  const snapshot = () => {
    const byRole=Object.fromEntries(PEOPLE_ROLES.map(role=>[role,0]));byRole.traveller=0; let nearest=null,drawn=0;const groups=new Set();
    for(let k=0;k<selection.count;k++) {
      const b=bodies[selection.chosen[k]],p=b.spot;if(!travellers)crowdMotion(b,time,motion);else{motion.travel=motion.bob=0;}
      const x=p.x+b.dx*motion.travel,y=b.y+b.slope*motion.travel+motion.bob,z=p.z+b.dz*motion.travel;
      const distance=Math.hypot(x-camera.x,y-camera.y,z-camera.z),horizontal=Math.hypot(x-centre.x,z-centre.z);
      if(step>=3 || (travellers ? p.alpha * (1-b.coverage)*Math.max(0,Math.min(1,(crowdRange(context.quality,step)-distance)/CROWD.fade)) : crowdScale(horizontal,distance,context.quality,step))<=0) continue;
      byRole[p.role]++;drawn++;if(p.flight)groups.add(p.group);
      if(!nearest || distance<nearest.distance) nearest={role:p.role,distance,bearing:(Math.atan2(x-camera.x,camera.z-z)*180/Math.PI+360)%360};
    }
    const flight=companion?.snapshot();
    let triangles=0,shadowTriangles=0,draws=0;
    for(const batch of batches)if(batch.mesh.visible) {
      triangles+=batch.shape.triangles*batch.count;draws++;
      if(batch.shadowMesh?.visible){shadowTriangles+=batch.shape.triangles*batch.count;draws++;}
    }
    return {flight,groups:groups.size,ready,spots:bodies.length,drawn,selected:selection.count,triangles,shadowTriangles,draws,
      lod:batches.map(batch=>({count:batch.count,triangles:batch.shape.triangles})),nearest,byRole,time,
      work:{preparations,selections,scans:selection.scans,comparisons:selection.comparisons,uploadedInstances:uploads}};
  };
  if(debug && !travellers) globalThis.__kzCrowd=snapshot;
  if(debug && travellers) globalThis.__kzFlight=snapshot;
  return {update,snapshot,capacity:flightSpots.length,
    setAdapt(value) {
      if(disposed) return;companion?.setAdapt(value);step=value;refresh=true;uniforms.uCrowdBands.value.z=crowdRange(context.quality,step);
      if(step>=3) {selection.count=0;for(const batch of batches){batch.count=0;batch.geometry.instanceCount=0;batch.mesh.visible=false;if(batch.shadowMesh)batch.shadowMesh.visible=false;}}
    },
    setPaused(on) {paused=!!on;companion?.setPaused(on);},
    debugText() {return disposed?'':`影 ${selection.count}/${bodies.length}`;},
    dispose() {
      if(disposed) return;disposed=true;job?.return();companion?.dispose();
      for(const batch of batches){batch.mesh.removeFromParent();batch.geometry.dispose();batch.shadowMesh?.removeFromParent();}
      material.dispose();shadowMaterial?.dispose();
      bodies.length=0;selection.count=0;
      if(globalThis.__kzFlight===snapshot) delete globalThis.__kzFlight;
      if(globalThis.__kzCrowd===snapshot) delete globalThis.__kzCrowd;
    },
  };
}
