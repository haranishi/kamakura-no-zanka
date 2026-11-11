import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import * as THREE from '../dist/vendor/three.module.min.js';
import { PEOPLE, PEOPLE_ROLES, preparePeople, peopleAmount, prepareFlight, sampleFlight } from '../dist/valley/kamakura-people.js';
import { CROWD, crowdEnabled, crowdTraits, crowdShape, crowdPlacementBatches, createCrowdSelection, selectCrowd,
  crowdGait, crowdScale, crowdRange, crowdLimit, crowdNear, crowdMotion, travellerTraits, TRAVELLER } from '../dist/valley/kamakura-crowd.js';
import { createKamakuraCrowd, CROWD_VERTEX_PARS, CROWD_VERTEX_STATE, CROWD_VERTEX_NORMAL, CROWD_VERTEX_POSITION, CROWD_SHADOW_PARS, CROWD_SHADOW_POSITION } from '../dist/valley/kamakura-crowd-view.js';
import { readPrivateData } from '../tools/lib/kamakura-validation.mjs';
import { readPrivateHouses } from '../tools/lib/kamakura-house-validation.mjs';
import { readPrivateFacilities } from '../tools/lib/kamakura-facility-validation.mjs';
import { decodeRoads } from '../dist/valley/kamakura-roads.js';
import { decodeRivers } from '../dist/valley/kamakura-rivers.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { createHabitat } from '../dist/valley/kamakura-habitat.js';
import { houseBox, houseMatrix } from '../dist/valley/kamakura-houses.js';
import { facilityFootprint } from '../dist/valley/kamakura-facilities.js';

function world() {
  const terrain={bounds:{minX:-400,maxX:400,minZ:-400,maxZ:400},heightAt:(x,z)=>.03*x+.02*z,waterAt:()=>0,walkable:()=>true,slopeAt:()=>3};
  const habitat={at(x,z,o){return Object.assign(o,{town:1,forest:0,pass:0,paddy:0,meadow:0,sand:0});}};
  return {search:'?debug=1',quality:'standard',data:{roads:{main:{kind:'local_road',width_m:6,xyz_m:[[0,-380,0],[0,380,0]]}}},terrain,habitat};
}
function prepare(w) {const job=crowdPlacementBatches(w);let n;do{n=job.next();}while(!n.done);return n.value;}
function body(x,z=0,role='chat',y=0) {return {spot:{x,z,role,yaw:0},y,...crowdTraits({x,z,role,yaw:0}),slope:0};}
function fixture(search='?debug=1',quality='standard') {
  const c={...world(),search,quality,scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera()};c.camera.position.set(0,2,0);
  const layer=createKamakuraCrowd(c),frame={dt:1/60,pos:{x:0,y:0,z:0},camera:c.camera};
  function settle(){for(let i=0;i<2000;i++){layer.update(frame);if(globalThis.__kzCrowd().ready)return;}assert.fail('synthetic placement did not finish');}
  return {c,layer,frame,settle};
}
const source=f=>fs.readFileSync(new URL('../dist/valley/'+f,import.meta.url),'utf8');

test('same generator/amount as near people, deterministic traits and ground slope',t=>{
  for(const amount of [1,2]) {
    const w=world();w.search='?people='+amount;
    const a=prepare(w),b=prepare(w),near=preparePeople(w,peopleAmount(w.search));
    assert.deepEqual(a.map(p=>p.spot),near.spots);assert.deepEqual(a,b);
    for(const p of a){assert(p.height>=CROWD.heightMin&&p.height<=CROWD.heightMax);assert(p.cloth>=0&&p.cloth<5);assert(p.head>=0&&p.head<3);
      if(p.spot.role==='walker'){assert(Math.abs(p.slope-(.03*p.dx+.02*p.dz))<1e-10);assert(p.dz<-.99);}}
    t.diagnostic(`synthetic amount ${amount}: ${a.length} anchors`);
  }
  const heads=[0,0,0];for(let i=0;i<10000;i++)heads[crowdTraits({x:i,z:i*.3,role:'chat'}).head]++;
  heads.forEach((n,i)=>assert(Math.abs(n/10000-[.5,.3,.2][i])<.025));
});

test('selection near cut, complementary fade, continuous far edge, nearest-first cap and altitude',()=>{
  for(const q of ['standard','light']) {
    const r=q==='light'?PEOPLE.lightRange:PEOPLE.range;
    for(let d=r-PEOPLE.fade;d<=r;d+=.125)assert(Math.abs(crowdScale(d,d,q,0)+Math.max(0,Math.min(1,(r-d)/PEOPLE.fade))-1)<1e-12);
    const range=crowdRange(q,0);
    assert.equal(crowdScale(200,range,q,0),0);assert(crowdScale(200,range-1e-6,q,0)<1e-6);
    assert(Math.abs(crowdScale(200,range-CROWD.fade-1e-6,q,0)-crowdScale(200,range-CROWD.fade+1e-6,q,0))<1e-6);
  }
  const list=Array.from({length:2400},(_,i)=>body(20+i*.22)),s=createCrowdSelection(),centre={x:0,z:0},camera={x:0,y:0,z:0};
  selectCrowd(list,centre,camera,'standard',0,s);assert.equal(s.count,CROWD.max);
  const expected=list.map((b,i)=>({i,d:b.spot.x})).filter(v=>v.d>crowdNear('standard')&&v.d<CROWD.range).sort((a,b)=>a.d-b.d).slice(0,CROWD.max);
  assert.deepEqual(Array.from(s.chosen.subarray(0,s.count)),expected.map(v=>v.i));
  for(let i=1;i<s.count;i++)assert(s.distances[i]>=s.distances[i-1]);
  camera.y=CROWD.range+1;selectCrowd(list,centre,camera,'standard',0,s);assert.equal(s.count,0);
  const byHeight=[body(100,0,'chat',500),body(200,0,'chat',0)];camera.y=500;
  selectCrowd(byHeight,centre,camera,'standard',0,s);assert.equal(s.chosen[0],0);
});

test('quality and adaptation reduce distances/counts; step 3 does no scan',()=>{
  const list=Array.from({length:4000},(_,i)=>body(70+i*.1)),s=createCrowdSelection(),eye={x:0,y:0,z:0};
  for(const q of ['standard','light'])for(const step of [0,1,2,3]) {
    selectCrowd(list,eye,eye,q,step,s);assert.equal(s.count,crowdLimit(q,step));
    if(step===3)assert.equal(s.scans,0);else for(let k=0;k<s.count;k++)assert(s.distances[k]<crowdRange(q,step));
  }
  assert(crowdRange('standard',2)<crowdRange('standard',0));assert(crowdLimit('light',0)<CROWD.max);
});

test('shape budget, finite unit normals, outward faces, adult/child/seated/bent heights',t=>{
  let triangles=0;
  for(const role of PEOPLE_ROLES)for(const head of [0,1,2]) {
    const shape=crowdShape(role,head);triangles=shape.triangles;assert(triangles<=180);assert.equal(shape.parts.length,triangles*3);
    let min=Infinity,max=-Infinity;
    for(let i=0;i<shape.positions.length;i+=3){assert(Math.abs(Math.hypot(...shape.normals.subarray(i,i+3))-1)<1e-6);min=Math.min(min,shape.positions[i+1]);max=Math.max(max,shape.positions[i+1]);}
    assert.equal(min,0);assert(Math.abs(max-(role==='sitter'?CROWD.sitter:role==='farmer'?CROWD.hip+(1-CROWD.hip)*CROWD.farmerBend:1))<1e-6);
    if(role==='chat') {
      // Frustum bottom/top point outward; bad winding makes the hat/body vanish with front-face culling.
      for(let i=0;i<shape.parts.length;i+=3) {
        const x=(shape.positions[i*3]+shape.positions[(i+1)*3]+shape.positions[(i+2)*3])/3;
        const z=(shape.positions[i*3+2]+shape.positions[(i+1)*3+2]+shape.positions[(i+2)*3+2])/3;
        if(shape.joints[i]===0 && shape.parts[i]===0)assert(x*shape.normals[i*3]+z*shape.normals[i*3+2]>=-1e-6,'torso faces outward');
      }
      assert(Array.from(shape.normals).some((v,i)=>i%3===1&&v>.99),'top cap faces up');
    }
  }
  const adult=crowdTraits({x:1,z:1,role:'chat'}),child=crowdTraits({x:1,z:1,role:'child'});
  assert.equal(adult.height,child.height);assert(child.height*CROWD.child<1.2);
  assert(CROWD.heightMin*CROWD.sitter>.8&&CROWD.heightMax*CROWD.sitter<1);
  t.diagnostic(`triangles/body ${triangles}; ${CROWD.max} detailed bodies = ${triangles*CROWD.max} triangles; two distance batches share one material`);
});

test('walkers turn on the return, move at specified speed/amplitude, slope and bob remain bounded; other roles static',()=>{
  const b=body(100,0,'walker');b.phase=0;const o={};
  crowdMotion(b,0,o);assert.equal(o.travel,-CROWD.walk);assert.equal(o.direction,1);
  crowdMotion(b,CROWD.walk*2/CROWD.speed,o);assert.equal(o.travel,CROWD.walk);assert.equal(o.direction,-1);
  crowdMotion(b,1,o);assert(Math.abs(o.travel-(-CROWD.walk+CROWD.speed))<1e-10);
  for(let i=0;i<2000;i++){crowdMotion(b,i/60,o);assert(Math.abs(o.travel)<=CROWD.walk);assert(Math.abs(o.bob)<=CROWD.bob);}
  for(const role of PEOPLE_ROLES.filter(r=>r!=='walker')){crowdMotion(body(100,0,role),10,o);assert.deepEqual(o,{travel:0,bob:0,direction:1});}
});

test('with a sun the figures lay flat shadows: the same instances drawn once more, and both passes go away together',()=>{
  const c={...world(),scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),sunDir:new THREE.Vector3(-.8,.37,.47)};c.camera.position.set(0,2,0);
  const layer=createKamakuraCrowd(c),frame={dt:1/60,pos:{x:0,y:0,z:0},camera:c.camera};
  for(let i=0;i<2000&&!globalThis.__kzCrowd().ready;i++)layer.update(frame);layer.update(frame);
  const [body,shadow]=c.scene.children;assert.equal(c.scene.children.length,4);assert.equal(body.name,'kamakura-crowd');assert.equal(shadow.name,'kamakura-crowd-shadow');
  assert.equal(shadow.geometry,body.geometry,'one set of instances');assert(shadow.material.isMeshBasicMaterial&&shadow.material.transparent&&!shadow.material.depthWrite&&shadow.material.fog);
  assert.equal(shadow.material.opacity,CROWD.shadow);assert(!shadow.castShadow&&!shadow.receiveShadow);assert(body.visible&&shadow.visible);
  const snap=globalThis.__kzCrowd();assert.equal(snap.draws,4);assert(snap.drawn>0);
  // The shadow program: the body's own posing and placement, then flattened along the sun.
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.basic.vertexShader,fragmentShader:THREE.ShaderLib.basic.fragmentShader};shadow.material.onBeforeCompile(shader);
  for(const part of [CROWD_VERTEX_STATE,CROWD_VERTEX_POSITION,CROWD_SHADOW_POSITION,CROWD_SHADOW_PARS])assert(shader.vertexShader.includes(part));
  assert(shader.vertexShader.indexOf(CROWD_VERTEX_POSITION)<shader.vertexShader.indexOf(CROWD_SHADOW_POSITION));
  assert(shader.vertexShader.includes('varying vec3 vColor;'),'the shared colour statements still have their varying');
  assert(Math.abs(shader.uniforms.uCrowdSun.value.length()-1)<1e-9);assert(shader.uniforms.uCrowdSun.value.y>0);
  assert.equal(shader.uniforms.uCrowdTime,body.material.onBeforeCompile&&(()=>{const b={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:''};body.material.onBeforeCompile(b);return b.uniforms.uCrowdTime;})(),'both passes share the clock and the bands');
  for(const text of [CROWD_SHADOW_POSITION,CROWD_VERTEX_STATE]){let depth=0;for(const ch of text){if(ch==='(')depth++;if(ch===')')depth--;assert(depth>=0);}assert.equal(depth,0);assert(!/--\d/.test(text));}
  assert.match(CROWD_SHADOW_POSITION,/uCrowdSun\.xz/);assert.match(CROWD_VERTEX_STATE,/smoothstep\(90\.0+, 240\.0+, crowdAway\)/);
  layer.setAdapt(3);assert(!body.visible&&!shadow.visible);layer.setAdapt(0);layer.update(frame);assert(shadow.visible);
  layer.dispose();layer.dispose();assert.equal(c.scene.children.length,0);
});
test('the far crowd places itself denser than the near people, and says so in one constant',()=>{
  assert(CROWD.density>1&&CROWD.density<=3);
  assert.match(source('kamakura-crowd-view.js'),/crowdPlacementBatches\(context, peopleAmount\(context\.search\) \* CROWD\.density\)/);
  const w=world(),base=prepare(w).length;const job=crowdPlacementBatches(world(),peopleAmount(w.search)*CROWD.density);let n;do{n=job.next();}while(!n.done);
  assert(n.value.length>base*1.3,`${n.value.length} vs ${base}`);
});

test('disabled flags never touch world/scene; correct layer order; only debug exposes a hook',()=>{
  for(const search of ['?crowd=0','?people=0','?crowd=0&people=3']) {
    assert(!crowdEnabled(search));assert.equal(createKamakuraCrowd({search,get terrain(){assert.fail('disabled terrain');},get scene(){assert.fail('disabled scene');}}),null);
  }
  const s=source('kamakura-layers.js');assert.match(s,/\['people', createKamakuraPeople\],\s*\['crowd', createKamakuraCrowd\]/);
  const f=fixture('');assert.equal(globalThis.__kzCrowd,undefined);f.layer.dispose();
});

test('two distance batches, capped geometry, no shadows, Lambert/fog, 8m reselection, camera-height refresh, pause and idempotent dispose',t=>{
  const f=fixture();f.settle();let snap=globalThis.__kzCrowd();assert(snap.drawn>0);assert.equal(snap.draws,2);assert(snap.triangles<=CROWD.max*180);
  const mesh=f.c.scene.children[0];assert(mesh.material.isMeshLambertMaterial);assert(mesh.material.fog);assert(!mesh.castShadow&&!mesh.receiveShadow);assert.equal(mesh.geometry.groups.length,0);
  const initial=snap.work.selections,version=mesh.geometry.attributes.crowdAnchor.version;
  const saved=globalThis.Float32Array;globalThis.Float32Array=class extends saved{constructor(...args){super(...args);assert.fail('steady frame allocated a buffer');}};
  const start=performance.now();try{for(let i=0;i<10000;i++)f.layer.update(f.frame);}finally{globalThis.Float32Array=saved;}
  const ms=(performance.now()-start)/10000;
  assert.equal(globalThis.__kzCrowd().work.selections,initial);assert.equal(mesh.geometry.attributes.crowdAnchor.version,version);
  f.frame.pos.x=CROWD.refresh-.01;f.layer.update(f.frame);assert.equal(globalThis.__kzCrowd().work.selections,initial);
  f.frame.pos.x=CROWD.refresh;f.layer.update(f.frame);assert.equal(globalThis.__kzCrowd().work.selections,initial+1);
  snap=globalThis.__kzCrowd();f.layer.setPaused(true);f.layer.update(f.frame);assert.deepEqual(globalThis.__kzCrowd(),snap);f.layer.setPaused(false);
  f.c.camera.position.y=CROWD.range+1;f.layer.update(f.frame);assert.equal(globalThis.__kzCrowd().drawn,0);
  f.c.camera.position.y=2;f.layer.update(f.frame);assert(globalThis.__kzCrowd().drawn>0);
  f.layer.setAdapt(3);assert.equal(globalThis.__kzCrowd().draws,0);assert.equal(globalThis.__kzCrowd().drawn,0);f.layer.setAdapt(0);f.layer.update(f.frame);assert(globalThis.__kzCrowd().drawn>0);
  let released=0;mesh.geometry.addEventListener('dispose',()=>released++);mesh.material.addEventListener('dispose',()=>released++);
  t.diagnostic(`synthetic ${snap.drawn} drawn; steady update ${ms.toFixed(6)}ms/frame; ${JSON.stringify(snap.work)}`);
  assert.match(f.layer.debugText(),/^影 \d+\/\d+$/);f.layer.dispose();f.layer.dispose();assert.equal(released,2);assert.equal(f.c.scene.children.length,0);assert.equal(globalThis.__kzCrowd,undefined);assert.equal(f.layer.debugText(),'');
});

test('debug uses role instance colours and shader triple height; all 21 instanced poses match pure shapes',()=>{
  const f=fixture('?debug=1&crowddebug=1');f.settle();const mesh=f.c.scene.children[0];assert(mesh.material.isMeshBasicMaterial);assert(!mesh.material.fog);assert(!mesh.material.toneMapped);
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.basic.vertexShader};mesh.material.onBeforeCompile(shader);assert.equal(shader.uniforms.uCrowdDebug.value,1);
  assert(shader.vertexShader.includes('p.y *= mix(1.0, '+CROWD.debugHeight.toFixed(8)+', uCrowdDebug)'));
  const colors=CROWD.debug.map(c=>new THREE.Color(c)),c=mesh.geometry.attributes.color.array;
  for(let i=0;i<mesh.geometry.instanceCount;i++)assert(colors.some(v=>Math.abs(v.r-c[i*3])<1e-6&&Math.abs(v.g-c[i*3+1])<1e-6&&Math.abs(v.b-c[i*3+2])<1e-6));
  const base=crowdShape();
  for(const role of PEOPLE_ROLES)for(const head of [0,1,2]) {
    const posed=crowdShape(role,head);
    for(let i=0;i<base.parts.length;i++) {
      let [x,y,z]=base.positions.subarray(i*3,i*3+3);
      if(base.parts[i]===2){x*=CROWD.cover[head]/CROWD.cover[0];z*=CROWD.cover[head]/CROWD.cover[0];}
      if(role==='sitter'){if(y<=Math.fround(CROWD.hip))x*=CROWD.sitterWidth;y*=CROWD.sitter;}
      if(role==='farmer'&&y>Math.fround(CROWD.hip)){z-=(y-CROWD.hip)*CROWD.farmerLean;y=CROWD.hip+(y-CROWD.hip)*CROWD.farmerBend;}
      for(const [j,v] of [x,y,z].entries())assert(Math.abs(v-posed.positions[i*3+j])<1e-6);
    }
  }
  f.layer.dispose();
});

test('synthetic crowded town reaches 600 bodies in two distance batches with bounded buffers',t=>{
  const f=fixture('?debug=1&people=3');f.settle();const s=globalThis.__kzCrowd(),mesh=f.c.scene.children[0],g=mesh.geometry;
  assert.equal(s.drawn,CROWD.max);assert.equal(f.c.scene.children.reduce((n,m)=>n+m.geometry.instanceCount,0),CROWD.max);assert.equal(s.draws,2);assert.equal(s.triangles,s.lod.reduce((n,l)=>n+l.count*l.triangles,0));assert(s.lod[1].triangles<s.lod[0].triangles);
  assert(g.isInstancedBufferGeometry);assert(!Array.isArray(mesh.material));assert.equal(g.groups.length,0);
  const staticBytes=Object.values(g.attributes).filter(a=>!a.isInstancedBufferAttribute).reduce((n,a)=>n+a.array.byteLength,0);
  const dynamicBytes=Object.values(g.attributes).filter(a=>a.isInstancedBufferAttribute).reduce((n,a)=>n+a.array.byteLength,0);
  assert(dynamicBytes<=CROWD.max*16*4);assert(staticBytes<25000);
  t.diagnostic(`600 bodies: ${s.triangles} triangles, ${s.draws} draw, static ${staticBytes}B, dynamic ${dynamicBytes}B`);f.layer.dispose();
});

test('traveller instances retain their identity pack colour through motion and near handover; straw, pack and staff have distinct shader colours',()=>{
  const w={...world(),scene:new THREE.Scene(),sunDir:new THREE.Vector3(-.8,.37,.47)};
  w.data.meta={flight:{road:'main',groups:6,size:[2,4],speed:.8}};
  const layer=createKamakuraCrowd(w,true),spots=prepareFlight(w),frame={time:30,dt:1/60,pos:{x:0,y:55,z:0},flying:true};
  const mesh=w.scene.children.find(o=>o.name==='kamakura-travellers'),g=mesh.geometry;
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader};mesh.material.onBeforeCompile(shader);
  const u=shader.uniforms;
  assert.deepEqual(u.uCrowdTravellerStraw.value.toArray(),TRAVELLER.straw);assert.deepEqual(u.uCrowdWood.value.toArray(),TRAVELLER.wood);
  assert(shader.vertexShader.includes('crowdPart > 2.5 && crowdPart < 3.5'));assert(shader.vertexShader.includes('crowdPart < 4.5) vColor = uCrowdWood'));
  for(const time of [30,45,60])for(const flying of [true,false]) {
    frame.time=time;frame.flying=flying;layer.update(frame);
    for(const p of spots)sampleFlight(p,time,w.terrain,p);
    for(let i=0;i<g.instanceCount;i++) {
      const x=g.attributes.crowdAnchor.getX(i),z=g.attributes.crowdAnchor.getZ(i);
      const p=spots.find(p=>Math.hypot(p.x-x,p.z-z)<.001);assert(p);
      const packIndex=g.attributes.crowdPerson.getZ(i);assert.equal(packIndex,travellerTraits(p).packCloth);
      const color=u['uCrowdPack'+packIndex].value;
      assert.equal(color.getHex(),CROWD.clothes[travellerTraits(p).packCloth]);assert.notEqual(color.getHex(),CROWD.clothes[p.variant]);
      assert(Math.abs(g.attributes.crowdPackGain.getX(i)-travellerTraits(p).packGain)<1e-6);
      assert(!color.equals(u.uCrowdTravellerStraw.value)&&!color.equals(u.uCrowdWood.value));
      assert(!u.uCrowdTravellerStraw.value.equals(u.uCrowdWood.value));
    }
  }
  // Unrelated town hats keep the pre-existing ochre colour when the road layer is disabled.
  assert.equal(u.uCrowdStraw.value.getHex(),CROWD.clothes[4]);layer.dispose();assert.equal(w.scene.children.length,0);
});

function safety(code) {
  code=code.replace(/\/\/[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'');const stack=[];
  for(const c of code){if('([{'.includes(c))stack.push(c);else if(')]}'.includes(c))assert.equal(stack.pop(),'([{'[')]}'.indexOf(c)]);}assert.equal(stack.length,0);
  assert.doesNotMatch(code,/--\s*\d|\b(?:float|int|vec[234])\s+(?:sample|input|output|filter|active|common|resource)\b/);
  assert.doesNotMatch(code,/(?<![\w.])\d+(?:\.\d*)?(?:float|vec[234]|int)\b/);
}
const expand=s=>s.replace(/#include <(\w+)>/g,(_,key)=>{assert.equal(typeof THREE.ShaderChunk[key],'string');return expand(THREE.ShaderChunk[key]);});
test('real Lambert/basic shader hooks exist; brackets, reserved names and injected float arithmetic',()=>{
  const parts=CROWD_VERTEX_PARS+CROWD_VERTEX_STATE+CROWD_VERTEX_NORMAL+CROWD_VERTEX_POSITION;safety(parts);
  assert.doesNotMatch(parts,/(?<![\w.])\d+(?![\w.])/,'arithmetic constants are floats');
  for(const paint of [false,true]) {
    const f=fixture(paint?'?crowddebug=1':'');const mat=f.c.scene.children[0].material,lib=THREE.ShaderLib[paint?'basic':'lambert'];
    for(const hook of ['common','batching_vertex','beginnormal_vertex','begin_vertex'])assert(lib.vertexShader.includes('#include <'+hook+'>'));
    const s={uniforms:{},vertexShader:lib.vertexShader};mat.onBeforeCompile(s);safety(expand(s.vertexShader));
    for(const m of CROWD_VERTEX_PARS.matchAll(/uniform \w+ (\w+);/g))assert(Object.hasOwn(s.uniforms,m[1]));
    assert(s.vertexShader.indexOf(CROWD_VERTEX_STATE)<s.vertexShader.indexOf(CROWD_VERTEX_NORMAL));assert(s.vertexShader.includes(CROWD_VERTEX_POSITION));f.layer.dispose();
  }
  assert.throws(()=>safety('float sample=0.0;'));assert.throws(()=>safety('float x=1.--0.2;'));
});

test('GLSL compiler checks actual injected movement, fade, normal rotation and all declared names',t=>{
  const version=spawnSync('glslc',['--version'],{encoding:'utf8'});if(version.error?.code==='ENOENT')return t.skip('glslc unavailable; static checks above still run');assert.equal(version.status,0);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crowd-glsl-'));
  try {
    const code='#version 310 es\nprecision highp float;\n#define attribute in\nin vec3 position;\nin vec3 normal;\n'+CROWD_VERTEX_PARS+
      '\nout vec3 vColor;\nvoid main(){\nvColor=vec3(1.0);\n'+CROWD_VERTEX_STATE+'\nvec3 objectNormal=normal;\n'+CROWD_VERTEX_NORMAL+'\nvec3 transformed=position;\n'+CROWD_VERTEX_POSITION+'\ngl_Position=vec4(transformed+objectNormal*0.001,1.0);\n}';
    const file=path.join(dir,'crowd.vert');fs.writeFileSync(file,code);const args=['--target-env=opengl','-fauto-bind-uniforms','-fauto-map-locations',file,'-o',path.join(dir,'crowd.spv')];
    let result=spawnSync('glslc',args,{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
    fs.writeFileSync(file,code.replace(CROWD_VERTEX_PARS,CROWD_VERTEX_PARS+CROWD_SHADOW_PARS).replace(CROWD_VERTEX_POSITION,CROWD_VERTEX_POSITION+CROWD_SHADOW_POSITION));
    result=spawnSync('glslc',args,{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
    fs.writeFileSync(file,code.replace('crowdTravel, crowdWalk.z','undeclaredCrowdTravel, crowdWalk.z'));
    result=spawnSync('glslc',args,{encoding:'utf8'});assert.notEqual(result.status,0,'compiler must catch undeclared names');
    t.diagnostic('body and ground-shadow vertex shaders compiled; undeclared-variable mutation rejected');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('private world only checks forbidden placements, finite geometry and caps; no private values logged',async t=>{
  if(!process.env.KZ_WORLD_DIR)return t.skip('KZ_WORLD_DIR未設定');
  const dir=process.env.KZ_WORLD_DIR,{data}=await readPrivateData(dir);
  if(data.meta.roads)data.roads=decodeRoads(JSON.parse(fs.readFileSync(path.join(dir,'roads.json'))),data.meta.roads.count);
  if(data.meta.surface)data.surface=new Uint8Array(fs.readFileSync(path.join(dir,'surface_class_u8.bin')));
  if(data.meta.rivers)data.rivers=decodeRivers(JSON.parse(fs.readFileSync(path.join(dir,'rivers.json'))),data.meta.rivers.count);
  const terrain=createKamakuraTerrain(data),{houses,bodies}=await readPrivateHouses(dir,data),input=await readPrivateFacilities(dir,data);data.facilities=input.facilities;
  const facilities={records:input.facilities.nodes.map(node=>({node,bounds:facilityFootprint(node,input.positions.get(node.node),false)}))};
  const boxes=houses.instances.map(h=>houseBox(houses.kinds.get(h.kind),houseMatrix(h,terrain,bodies.get(h.kind)),bodies.get(h.kind)));
  const habitat=createHabitat({terrain,meta:data.meta,surface:data.surface,housePoints:boxes}),w={data,terrain,facilities,houses:{boxes},habitat};
  const list=prepare(w),site=preparePeople(w).site,s=createCrowdSelection();
  for(const b of list){assert(site.ground(b.spot.x,b.spot.z),'private ground violation (values withheld)');assert(Number.isFinite(b.y)&&Number.isFinite(b.slope),'private nonfinite geometry');if(b.spot.role!=='walker')assert(!site.onRoad(b.spot.x,b.spot.z),'private road violation');}
  for(const b of list.slice(0,20))for(const q of ['standard','light'])for(const step of [0,2,3]) {
    selectCrowd(list,b.spot,{x:b.spot.x,y:b.y+2,z:b.spot.z},q,step,s);assert(s.count<=crowdLimit(q,step));assert(s.count*crowdShape().triangles<=CROWD.max*180);
  }
});

test('rounded limbs stay below the shoulders; shader gait separates feet without sinking, in both distance shapes',()=>{
  const out={},left=[],right=[];
  for(const simple of [false,true]) {
    const s=crowdShape('traveller',1,true,simple);assert(s.triangles<=180);assert(s.joints.includes(1)&&s.joints.includes(2)&&s.joints.includes(3)&&s.joints.includes(4));
    for(let phase=0;phase<Math.PI*2;phase+=Math.PI/16)for(let i=0;i<s.parts.length;i++) {
      const x=s.positions[i*3],y=s.positions[i*3+1],z=s.positions[i*3+2],joint=s.joints[i];
      crowdGait(x,y,z,joint,0,phase,true,out);
      assert(out.y>=-1e-7,'no vertex below the ground over a whole step');
      if(joint>=3){assert(y<=CROWD.shoulder+1e-6);assert(out.y<=CROWD.shoulder+1e-6);assert(Math.abs(x)>CROWD.torso[0],'sleeves are beside the torso');}
      if(y===0 && joint===1 && phase===0)left.push(i);
      if(y===0 && joint===2 && phase===0)right.push(i);
    }
    const mean=(indices,phase)=>indices.reduce((sum,i)=>sum+crowdGait(s.positions[i*3],0,s.positions[i*3+2],s.joints[i],0,phase,true,out).z,0)/indices.length;
    assert(mean(left,Math.PI/2)-mean(right,Math.PI/2)>.2);assert(mean(left,Math.PI*1.5)-mean(right,Math.PI*1.5)<-.2);
    const upper=crowdGait(0,1,0,0,0,0,true,out);assert(upper.z<0,'lean follows the local forward direction');
    left.length=right.length=0;
  }
  assert(CROWD.sides>=6&&CROWD.sides<=8);
  const detailed=crowdShape('traveller',1,true);assert(Array.from(detailed.parts).some((part,i)=>part===1&&Math.abs(detailed.positions[i*3+1]-CROWD.neck[5])<1e-6),'head sits on a visible neck above the shoulders');
});

test('evening cloth uses the existing palette with a linear shade multiplier; loads remain darker in every clothing variant',()=>{
  for(const time of ['morning','evening','dusk']) {
    const w={...world(),search:'?time='+time,scene:new THREE.Scene()},layer=createKamakuraCrowd(w);
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader};w.scene.children[0].material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.uCrowdClothGain.value,time==='morning'?1:CROWD.duskGain);layer.dispose();
  }
  for(let variant=0;variant<5;variant++) {
    const p={variant},t=travellerTraits(p),cloth=new THREE.Color(CROWD.clothes[variant]),pack=new THREE.Color(CROWD.clothes[t.packCloth]).multiplyScalar(t.packGain);
    const light=c=>.2126*c.r+.7152*c.g+.0722*c.b;
    assert(light(pack)<light(cloth));assert(Math.abs(light(pack)/light(cloth)-TRAVELLER.packShade)<1e-6 || t.packGain===1);
  }
});
