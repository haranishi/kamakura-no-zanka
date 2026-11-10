import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.min.js';
import {createKamakuraBackdrop} from '../dist/valley/kamakura-backdrop-view.js';
import {BACKDROP} from '../dist/valley/kamakura-backdrop.js';
const context=(search='?debug=1',quality='standard')=>({search,quality,scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),terrain:{bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100},cell:20,heightAt:(_x,z)=>30-z}});
const ready=async v=>{v.update();assert.equal(v.meshes.length,0);v.update();assert.equal(v.meshes.length,0);await new Promise(resolve=>setTimeout(resolve,1));};

test('S3 disabled backdrop is null and never samples the terrain',()=>{
  const c=context('?backdrop=0');c.terrain.heightAt=()=>assert.fail('disabled build');assert.equal(createKamakuraBackdrop(c),null);
});

test('S3 first draw is not delayed, resources are static, adapted and released exactly once; debug is owned',async()=>{
  const c=context(),v=createKamakuraBackdrop(c);assert.equal(c.scene.children.length,0);assert.equal(globalThis.__kzBackdrop().ready,false);
  await ready(v);assert(globalThis.__kzBackdrop().ready);assert.equal(v.update,undefined);assert.equal(c.scene.children.length,1);
  const a=globalThis.__kzBackdrop();assert(a.triangles<=BACKDROP.maxTriangles&&a.draws<=2);assert(a.nearest.distance>0&&Number.isFinite(a.nearest.bearing));
  const resources=v.meshes.flatMap(m=>[m.geometry,m.material]),counts=resources.map(()=>0);resources.forEach((r,i)=>r.addEventListener('dispose',()=>counts[i]++));
  for(const mesh of v.meshes){assert.equal(mesh.castShadow,false);assert.equal(mesh.receiveShadow,false);assert.equal(mesh.matrixAutoUpdate,false);assert.equal(mesh.material.fog,true);assert(mesh.geometry.attributes.normal.array.every(Number.isFinite));}
  v.setAdapt(2);assert(globalThis.__kzBackdrop().triangles<a.triangles);v.setAdapt(3);assert(globalThis.__kzBackdrop().triangles>0);v.setAdapt(0);assert.equal(globalThis.__kzBackdrop().triangles,a.triangles);
  v.dispose();v.dispose();assert(counts.every(n=>n===1));assert.equal(c.scene.children.length,0);assert.equal(globalThis.__kzBackdrop,undefined);
});

test('S4 debug is unlit without fog, fine magenta and coarse yellow; light has one draw',async()=>{
  const c=context('?debug=1&backdropdebug=1'),v=createKamakuraBackdrop(c);await ready(v);
  assert.deepEqual(v.meshes.map(m=>m.material.color.getHex()),[BACKDROP.debugNear,BACKDROP.debugFar]);
  assert(v.meshes.every(m=>m.material.isMeshBasicMaterial&&!m.material.fog&&!m.material.toneMapped));
  const light=createKamakuraBackdrop(context('?debug=1','light'));await ready(light);assert.equal(globalThis.__kzBackdrop().draws,1);
  v.dispose();assert.equal(typeof globalThis.__kzBackdrop,'function','An old owner cannot delete a new debug reader');light.dispose();
});

test('S3 cancellation before deferred build creates no geometry; failure closes and reports once',async()=>{
  const c=context(),v=createKamakuraBackdrop(c);v.update();v.update();v.dispose();await new Promise(resolve=>setTimeout(resolve,1));assert.equal(c.scene.children.length,0);
  const warnings=[],old=console.warn;console.warn=(...args)=>warnings.push(args);
  try{const c=context();c.terrain.heightAt=()=>{throw new Error('synthetic edge failure');};const v=createKamakuraBackdrop(c);await ready(v);assert.equal(globalThis.__kzBackdrop().ready,false);assert.equal(globalThis.__kzBackdrop().error,'synthetic edge failure');assert.equal(warnings.length,1);assert.equal(c.scene.children.length,0);v.dispose();}
  finally{console.warn=old;}
});
