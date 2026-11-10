import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.min.js';
import { createKamakuraFields, FIELD_CAPACITIES } from '../dist/valley/kamakura-fields-view.js';
import { FIELDS } from '../dist/valley/kamakura-fields.js';

function setup(search='?debug=1&fields=3',quality='standard',options={}) {
  const scene=new THREE.Scene(),hero={pos:{x:0,y:0,z:0}},context={search,scene,quality,hero,terrain:{heightAt:()=>0},sunDir:new THREE.Vector3(.6,.7,.4)};
  const map={mayIntersect:()=>true,fieldAt(x,z,out={}) {out.kind='kikyo';out.strength=1;return out;}};
  const layer=createKamakuraFields(context,{map,now:()=>0,...options});
  const frame={dt:1/60,time:0,wind:1.5,windDir:[1,0],pos:hero.pos,yaw:0,hero};
  const update=(x=0,z=0,yaw=0)=>{hero.pos.x=x;hero.pos.z=z;frame.yaw=yaw;frame.time+=1/60;layer.update(frame);};
  return {scene,layer,update,frame,context};
}

test('off creates nothing; reduced motion, light radius, shader hooks and pause work with real vendored meshes',()=>{
  const off=setup('?fields=0');assert.equal(off.layer,null);assert.equal(off.scene.children.length,0);
  const {scene,layer,update}=setup('?debug=1','light',{reducedMotion:true});
  assert.equal(scene.children.length,6);
  for(const mesh of scene.children) {
    assert(mesh.isInstancedMesh);assert(mesh.material.isMeshLambertMaterial);
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};
    mesh.material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.uFieldMotion.value,.4);
    assert.equal(shader.uniforms.uFieldRadius.value,45);
    assert(!shader.vertexShader.includes('#include <begin_vertex>'));
    assert(shader.fragmentShader.includes('#include <fog_fragment>'));
    assert.equal(mesh.receiveShadow,true);assert.equal(mesh.castShadow,false);
  }
  layer.setAdapt(2);update();
  const frozen=globalThis.__kzFields();layer.setPaused(true);update();
  assert.equal(globalThis.__kzFields().instances,frozen.instances);layer.setPaused(false);
  layer.setAdapt(3);update();assert(scene.children.every(m=>!m.visible));assert.equal(globalThis.__kzFields().instances,0);
  layer.dispose();assert.equal(scene.children.length,0);assert.equal(globalThis.__kzFields,undefined);
});

test('generation respects work bounds and does not publish partially built cells',()=>{
  const {scene,layer,update}=setup();update();
  assert.equal(globalThis.__kzFields().cells.built,0);assert.equal(globalThis.__kzFields().instances,0);
  for(let i=0;i<10;i++)update();
  for(const m of scene.children) {
    const ready=m.geometry.getAttribute('aFieldShape').array;
    if(globalThis.__kzFields().cells.built===0)for(let i=2;i<ready.length;i+=4)assert.equal(ready[i],0);
  }
  assert(globalThis.__kzFields().work.operations<=FIELDS.work);
  assert(globalThis.__kzFields().work.completed<=FIELDS.cellsPerFrame);
  layer.dispose();
});

test('clock budget yields before another batch; stale partially uploaded cells release all slots',()=>{
  let ticks=0;
  const a=setup('?debug=1','standard',{now:()=>ticks++});a.update();
  assert(globalThis.__kzFields().work.operations<=16);a.layer.dispose();
  const b=setup();for(let i=0;i<9;i++)b.update(); // build and partially upload a dense cell
  b.update(1000,1000);b.layer.setAdapt(3);assert.equal(globalThis.__kzFields().instances,0);b.layer.dispose();
});

test('2000 frames of walking/running/turning stay bounded and reuse every geometry, material and typed buffer',t=>{
  const {scene,layer,update}=setup();
  const meshes=[...scene.children],resources=meshes.map(m=>({geometry:m.geometry,material:m.material,matrix:m.instanceMatrix.array,shape:m.geometry.getAttribute('aFieldShape').array}));
  let peak=0,peakTriangles=0,built=0;const start=performance.now();
  for(let i=0;i<2000;i++) {
    const x=i<700?i*.04:i<1400?28+(i-700)*.13:119-(i-1400)*.08,z=30*Math.sin(i*.003);
    update(x,z,i*.009);const s=globalThis.__kzFields();
    assert(s.instances<=FIELDS.maxInstances);assert(s.triangles<=FIELDS.maxTriangles);assert(s.draws<=6);assert(s.cells.built<=300);
    assert(s.work.operations<=FIELDS.work,`${i}: operations ${s.work.operations}`);assert(s.work.completed<=4);
    peak=Math.max(peak,s.instances);peakTriangles=Math.max(peakTriangles,s.triangles);built=Math.max(built,s.cells.built);
    for(let j=0;j<6;j++) {assert.equal(meshes[j].geometry===resources[j].geometry,true);assert.equal(meshes[j].material===resources[j].material,true);assert.equal(meshes[j].instanceMatrix.array===resources[j].matrix,true);assert.equal(meshes[j].geometry.getAttribute('aFieldShape').array===resources[j].shape,true);assert(meshes[j].instanceMatrix.updateRanges.length<=1);assert(meshes[j].geometry.getAttribute('aFieldTint').updateRanges.length<=1);}
  }
  assert(peak>0);assert.equal(FIELD_CAPACITIES.reduce((a,b)=>a+b,0),14100);
  t.diagnostic(JSON.stringify({frames:2000,peakInstances:peak,peakTriangles,maxBuilt:built,nodeElapsedMs:performance.now()-start}));
  const counts=meshes.map(()=>({geometry:0,material:0,mesh:0}));
  meshes.forEach((m,i)=>{m.geometry.addEventListener('dispose',()=>counts[i].geometry++);m.material.addEventListener('dispose',()=>counts[i].material++);m.addEventListener('dispose',()=>counts[i].mesh++);});
  layer.dispose();layer.dispose();layer.setAdapt(0);update();
  assert.equal(scene.children.length,0);for(const c of counts)assert.deepEqual(c,{geometry:1,material:1,mesh:1});
});

test('the fixed capacity ceiling covers all five species together and no-field travel stops every draw',t=>{
  const {scene,layer,update}=setup('?debug=1','standard',{map:{mayIntersect:()=>false,fieldAt(x,z,out){out.kind=null;out.strength=0;return out;}}});
  let ceiling=0;
  for(let i=0;i<scene.children.length;i++)ceiling+=FIELD_CAPACITIES[i]*scene.children[i].geometry.getAttribute('position').count/3;
  assert.equal(ceiling,134880);assert(ceiling<=FIELDS.maxTriangles);
  for(let i=0;i<2000;i++)update(i*.1,0,i*.01);
  assert.equal(globalThis.__kzFields().instances,0);assert.equal(globalThis.__kzFields().draws,0);
  assert(scene.children.every(m=>!m.visible));assert.equal(globalThis.__kzFields().nearest.kind,null);
  t.diagnostic(JSON.stringify({capacity:FIELD_CAPACITIES.reduce((a,b)=>a+b,0),triangleCeiling:ceiling,drawCeiling:6}));layer.dispose();
});
