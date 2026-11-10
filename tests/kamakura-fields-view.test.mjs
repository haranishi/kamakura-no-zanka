import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.min.js';
import { createKamakuraFields, FIELD_CAPACITY } from '../dist/valley/kamakura-fields-view.js';
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
  assert.equal(scene.children.length,1);
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
    if(globalThis.__kzFields().cells.built===0)for(let i=2;i<ready.length;i+=3)assert.equal(ready[i],0);
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
  const meshes=[...scene.children],resources=meshes.map(m=>({geometry:m.geometry,material:m.material,matrix:m.instanceMatrix.array,attributes:Object.fromEntries(Object.entries(m.geometry.attributes).map(([key,a])=>[key,{attribute:a,array:a.array}]))}));
  const ranges=new WeakMap();
  let peak=0,peakTriangles=0,built=0;const start=performance.now();
  for(let i=0;i<2000;i++) {
    const x=i<700?i*.04:i<1400?28+(i-700)*.13:119-(i-1400)*.08,z=30*Math.sin(i*.003);
    update(x,z,i*.009);const s=globalThis.__kzFields();
    assert(s.instances<=FIELD_CAPACITY);assert(s.triangles<=FIELD_CAPACITY*4);assert(s.draws<=1);assert(s.cells.built<=300);
    assert(s.work.operations<=FIELDS.work,`${i}: operations ${s.work.operations}`);assert(s.work.completed<=FIELDS.cellsPerFrame);
    for(const mesh of meshes)for(const attr of [mesh.instanceMatrix,mesh.geometry.getAttribute('aFieldTint'),mesh.geometry.getAttribute('aFieldHeight')]) {
      const range=attr.updateRanges[0];
      if(range) {
        if(ranges.has(attr))assert.equal(range===ranges.get(attr),true,'upload range objects must be reused');else ranges.set(attr,range);
        assert(range.start>=0&&range.start+range.count<=attr.array.length);
        if(i%2===0)attr.clearUpdateRanges(); // Simulate the renderer consuming pending uploads.
      }
    }
    peak=Math.max(peak,s.instances);peakTriangles=Math.max(peakTriangles,s.triangles);built=Math.max(built,s.cells.built);
    for(let j=0;j<meshes.length;j++) {assert.equal(meshes[j].geometry===resources[j].geometry,true);assert.equal(meshes[j].material===resources[j].material,true);assert.equal(meshes[j].instanceMatrix.array===resources[j].matrix,true);for(const [key,a] of Object.entries(resources[j].attributes)){assert.equal(meshes[j].geometry.getAttribute(key)===a.attribute,true);assert.equal(meshes[j].geometry.getAttribute(key).array===a.array,true);}assert(meshes[j].instanceMatrix.updateRanges.length<=1);assert(meshes[j].geometry.getAttribute('aFieldTint').updateRanges.length<=1);}
  }
  assert(peak>0);assert.equal(FIELD_CAPACITY,16000);
  t.diagnostic(JSON.stringify({frames:2000,peakInstances:peak,peakTriangles,maxBuilt:built,nodeElapsedMs:performance.now()-start}));
  const counts=meshes.map(()=>({geometry:0,material:0,mesh:0}));
  meshes.forEach((m,i)=>{m.geometry.addEventListener('dispose',()=>counts[i].geometry++);m.material.addEventListener('dispose',()=>counts[i].material++);m.addEventListener('dispose',()=>counts[i].mesh++);});
  layer.dispose();layer.dispose();layer.setAdapt(0);update();
  assert.equal(scene.children.length,0);for(const c of counts)assert.deepEqual(c,{geometry:1,material:1,mesh:1});
});

test('the fixed capacity ceiling covers all five species together and no-field travel stops every draw',t=>{
  const {scene,layer,update}=setup('?debug=1','standard',{map:{mayIntersect:()=>false,fieldAt(x,z,out){out.kind=null;out.strength=0;return out;}}});
  let ceiling=0;
  for(let i=0;i<scene.children.length;i++)ceiling+=FIELD_CAPACITY*scene.children[i].geometry.getAttribute('position').count/3;
  assert.equal(ceiling,FIELD_CAPACITY*4);assert(ceiling<=FIELDS.maxTriangles);
  for(let i=0;i<2000;i++)update(i*.1,0,i*.01);
  assert.equal(globalThis.__kzFields().instances,0);assert.equal(globalThis.__kzFields().draws,0);
  assert(scene.children.every(m=>!m.visible));assert.equal(globalThis.__kzFields().nearest.kind,null);
  t.diagnostic(JSON.stringify({capacity:FIELD_CAPACITY,triangleCeiling:ceiling,drawCeiling:1}));layer.dispose();
});

test('staged cards stay hidden as a whole cell, and cancelling a staged upload returns every slot',()=>{
  const {scene,layer,update}=setup();const mesh=scene.children[0],shape=mesh.geometry.getAttribute('aFieldShape');
  let sawStaging=false,sawComplete=false;
  for(let frame=0;frame<100;frame++) {
    update();const groups=new Map();
    for(let i=0;i<mesh.count;i++) {
      const x=mesh.instanceMatrix.array[i*16+12],z=mesh.instanceMatrix.array[i*16+14],key=`${Math.floor(x/10)},${Math.floor(z/10)}`;
      const ready=shape.array[i*shape.itemSize+2];
      if(groups.has(key))assert.equal(ready,groups.get(key),'a cell must publish atomically');else groups.set(key,ready);
      if(ready===0)sawStaging=true;else sawComplete=true;
    }
    assert.equal([...groups.values()].filter(v=>v===1).length,globalThis.__kzFields().cells.built);
  }
  assert(sawStaging&&sawComplete);
  update(1000,1000);layer.setAdapt(3);
  assert.equal(globalThis.__kzFields().instances,0);
  for(let i=2;i<shape.array.length;i+=shape.itemSize)assert.equal(shape.array[i],0);
  layer.dispose();
});

test('adapt 2 reduces range and the first complete cell density; prefetch starts ahead of the viewer',()=>{
  const a=setup('?debug=1'),mesh=a.scene.children[0];
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};mesh.material.onBeforeCompile(shader);
  const firstCell=()=>{
    do {a.update();}while(globalThis.__kzFields().cells.built===0);
    const shape=mesh.geometry.getAttribute('aFieldShape');let ready=0;
    for(let i=0;i<mesh.count;i++)if(shape.array[i*shape.itemSize+2]) {
      ready++;assert(mesh.instanceMatrix.array[i*16+14]<0,'north-facing prefetch should publish the northern cell first');
    }
    return ready;
  };
  const full=firstCell();assert.equal(shader.uniforms.uFieldRadius.value,FIELDS.radius);
  a.layer.setAdapt(2);assert.equal(shader.uniforms.uFieldRadius.value,FIELDS.lightRadius);
  const reduced=firstCell();assert(reduced/full>.45&&reduced/full<.75);
  a.layer.dispose();
});

test('settled updates allocate no rendering resources or upload ranges and preserve buffer versions',()=>{
  const {scene,layer,update}=setup('?fields=1','standard',{map:{mayIntersect:()=>false,fieldAt(x,z,out){out.kind=null;out.strength=0;return out;}}});
  // Four empty cells may finish per frame; cover the full initial queue using that contractual bound.
  const cells=(Math.ceil((FIELDS.radius+8)/FIELDS.cell)*2+1)**2;
  for(let i=0;i<cells;i++)update();
  const mesh=scene.children[0],attributes=[mesh.instanceMatrix,...Object.values(mesh.geometry.attributes)],versions=attributes.map(a=>a.version);
  for(let i=0;i<200;i++)update();
  attributes.forEach((a,i)=>assert.equal(a.version,versions[i]));
  layer.dispose();
});

test('debug search preserves nearest fields by kind and the public debug text',()=>{
  const {layer,update}=setup('?debug=1&fieldsdebug=1&fieldseed=17','standard',{map:{mayIntersect:()=>false,fieldAt(x,z,out){out.kind=['susuki','kikyo','ominaeshi','yamayuri','hamahirugao'][Math.min(4,Math.max(0,Math.floor((x+400)/160)))];out.strength=1;return out;}}});
  for(let i=0;i<Math.ceil(41*41/8);i++)update();
  const state=globalThis.__kzFields();assert.equal(Object.keys(state.byKind).length,5);
  for(const value of Object.values(state.byKind))for(const key of ['distance','bearing','east','north'])assert(Number.isFinite(value[key]));
  assert.equal(state.nearest.distance,0);assert.match(layer.debugText(),/^野 女郎花 区画\d+ 株/);
  layer.dispose();assert.equal(layer.debugText(),'');
});

test('full capacity admits new nearby cells by releasing farther cells still inside the streaming radius',()=>{
  const {scene,layer,update}=setup(),mesh=scene.children[0],shape=mesh.geometry.getAttribute('aFieldShape');
  const occupied=()=>{
    const groups=new Set();
    for(let i=0;i<mesh.count;i++)if(shape.array[i*shape.itemSize+2])groups.add(`${Math.floor(mesh.instanceMatrix.array[i*16+12]/FIELDS.cell)},${Math.floor(mesh.instanceMatrix.array[i*16+14]/FIELDS.cell)}`);
    return groups;
  };
  do {update();}while(globalThis.__kzFields().cells.pending>0);
  assert.equal(globalThis.__kzFields().instances,FIELD_CAPACITY);
  const before=occupied();
  do {update(50,0);}while(globalThis.__kzFields().cells.pending>0);
  const after=occupied();
  assert([...after].some(key=>!before.has(key)),'capacity must admit new cells');
  assert([...before].some(key=>{
    const [cx,cz]=key.split(',').map(Number);
    return !after.has(key)&&Math.hypot(cx*FIELDS.cell+5-50,cz*FIELDS.cell+5)<FIELDS.radius+15;
  }),'a farther resident cell must be thinned before leaving the radius');
  assert(globalThis.__kzFields().instances<=FIELD_CAPACITY);
  layer.dispose();
});
