import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { standChildren, standChildCount, standShrink, standPolicy, standsEnabled, prepareStands, planStandChunks, generateStandChunk } from '../dist/valley/kamakura-stands.js';
import { buildColliders, addColliderCircles, moveActor } from '../dist/valley/collision.js';
import { load, THREE } from './helpers/tree-modules.mjs';
import { wind, stubRenderer } from './helpers/tree-field.mjs';
import { verifyStands } from '../tools/lib/kamakura-stand-validation.mjs';
import { readPrivateData } from '../tools/lib/kamakura-validation.mjs';
import { readPrivateHouses } from '../tools/lib/kamakura-house-validation.mjs';
const { buildKamakuraStands } = await load('kamakura-stand-view.js');
const stand = (over = {}) => ({ id: 1, x: 40, z: 40, height: 20, crown: 12, tier: 1, sourceSpecies: 0, tint: .2, rank: .1, ...over });
const bounds = { minX: -10000, maxX: 10000, minZ: -10000, maxZ: 10000 };
const terrain = { bounds, heightAt: (x,z) => 10 + x*.001 + z*.001, insideA: () => true, waterAt: () => 0, slopeAt: () => 0, walkable: () => true };
const camera = (x = 0, z = 0) => ({ position: { x, y: 20, z } });
test('children are deterministic by parent, bounded, inside the disk and at least 5m apart', () => {
  const source = Object.freeze(stand());
  assert.deepEqual(standChildren(source), standChildren(source));
  assert.notDeepEqual(standChildren(source), standChildren(stand({id:2})));
  for (let id = 0; id < 300; id++) for (const r of [9, 12, 15]) for (const light of [false,true]) {
    const p=stand({id,crown:r}), items=standChildren(p,light);
    assert.equal(items.length, standChildCount(r,light)); assert(items.length>=3 && items.length<=16);
    for (const [k,i] of items.entries()) {
      assert(Math.hypot(i.x-p.x,i.z-p.z)<=r+1e-10);assert(i.height>=p.height*.75 && i.height<=p.height*1.05);
      assert.equal(i.sourceSpecies,p.sourceSpecies);assert(i.variant>=0 && i.variant<=3);
      for (const j of items.slice(k+1)) assert(Math.hypot(i.x-j.x,i.z-j.z)>=5);
    }
  }
});
test('child exclusion reuses house, north-facing path, spawn and water rules, with heightAt grounding', () => {
  const raw=standChildren(stand()), a=raw[0];
  const make= (t=terrain, options={}) => {const p=prepareStands([stand()],t,options);return generateStandChunk(p,'0,0');};
  const clean=make();assert.equal(clean.active.length,raw.length);
  for (const i of clean.active) assert.equal(i.y,terrain.heightAt(i.x,i.z));
  for (const [reason,t,options] of [
    ['house',terrain,{boxes:[{x:a.x,z:a.z,w:1,d:1,rotY:Math.PI/4}]}],
    ['path',terrain,{paths:{r:{xyz_m:[[a.x-1,-a.z,0],[a.x+1,-a.z,0]]}}}],
    ['spawn',terrain,{spawn:a}],['water',{...terrain,waterAt:(x,z)=>Math.hypot(x-a.x,z-a.z)<1?1:0},{}]
  ]) {const p=make(t,options);assert(p.excluded[reason]>0);assert(!p.active.some(i=>i.id===a.id));}
  const outside=make({...terrain,insideA:(x,z)=>Math.hypot(x-40,z-40)<.01});assert.equal(outside.active.length,0);
});
test('tile plans generate only near A tier1, retain with hysteresis, evict and reproduce, with bounded cells', () => {
  const items=[];let id=0;
  for(let x=-1200;x<=1200;x+=100)for(let z=-1200;z<=1200;z+=100)items.push(stand({id:id++,x,z}));
  items.push(stand({id:id++,tier:2}),stand({id:id++,x:2000}));
  const p=prepareStands(items,{...terrain,insideA:x=>x<1500}), resident=new Map();
  assert.equal(p.expandable,items.length-2);
  let max=0;
  for(let x=-900;x<=900;x+=60){const pos={x,z:0},plan=planStandChunks(p,resident,pos);
    for(const key of plan.remove)resident.delete(key);
    for(const key of plan.create)resident.set(key,generateStandChunk(p,key));
    max=Math.max(max,resident.size);assert(resident.size<=36);
  }
  assert(max>0);const key=[...resident.keys()][0], prior=resident.get(key);
  for(const key of planStandChunks(p,resident,{x:10000,z:10000}).remove)resident.delete(key);
  assert.equal(resident.size,0);assert.deepEqual(generateStandChunk(p,key),prior);
  assert.equal(prepareStands(items,terrain,{},standPolicy('light')).policy.ranges[1],3000);
  assert.equal(prepareStands([stand({rank:.6})],terrain,{},standPolicy('light')).distant.size,0);
});
test('smooth shrink is monotonic and exact at boundaries for both tiers and quality policies', () => {
  for(const quality of ['standard','light'])for(const [near,far] of standPolicy(quality).hide.slice(1)){
    assert.equal(standShrink(near-10,near,far),0);assert.equal(standShrink(near,near,far),0);assert.equal(standShrink(far,near,far),1);
    let last=0;for(let d=near;d<=far+10;d++){const k=standShrink(d,near,far);assert(k>=last && k<=1);last=k;}
  }
});
test('dynamic circle batches stop walking, release every grid reference and preserve existing colliders', () => {
  const col=buildColliders({bounds,extraCircles:[{x:4,z:0,r:.2}]});const old=col.circles[0], before=[...col.grid.keys()];
  const release=addColliderCircles(col,[{x:0,z:0,r:1},{x:8,z:0,r:1}]);
  assert(moveActor(col,terrain,{x:-3,y:10,z:0},6,0).x< -1);
  assert.throws(()=>addColliderCircles(col,[{x:0,z:0,r:1},{x:NaN,z:0,r:1}]));assert.equal(col.circles.length,3);
  release();release();assert.deepEqual(col.circles,[old]);assert.deepEqual([...col.grid.keys()],before);
  assert(Math.abs(moveActor(col,terrain,{x:-3,y:10,z:0},6,0).x-3)<1e-10);
});
test('bundled Three view: static crowns, uniform shader, child pool, bounded frame creation and complete disposal (Node, no GPU)', () => {
  const items=[stand(),stand({id:2,tier:2,x:1500}),stand({id:3,x:280}),stand({id:4,x:-280}),stand({id:5,x:0,z:280})];
  for (const renderer of [null,stubRenderer()]) {
    const p=prepareStands(items,terrain),col=buildColliders({bounds}),view=buildKamakuraStands(p,{wind,sunDir:new THREE.Vector3(1,1,1),colliders:col,renderer});
    const scene=new THREE.Scene();scene.add(view.group);
    let s=view.update(camera());assert(s.chunks<=2);while(s.pending)s=view.update(camera());
    assert(s.children.triangles>0);assert(col.circles.length>0);
    const matrices=view.distant.map(d=>Array.from(d.mesh.instanceMatrix.array));
    for(const {mesh} of view.distant){
      assert.equal(mesh.frustumCulled,true);assert(mesh.geometry.index.count/3>=20 && mesh.geometry.index.count/3<=80);
      const shader={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader};mesh.material.onBeforeCompile(shader);
      assert.equal(shader.uniforms.uStandEye,view.eye);assert(shader.vertexShader.includes('smoothstep('));assert(shader.vertexShader.includes('aStandExpand'));
      const tier=mesh.name.split('/')[1];assert(shader.vertexShader.includes(tier==='1'?'smoothstep(100.0, 180.0':'smoothstep(500.0, 800.0'));
    }
    const first=[...view.resident.entries()];view.update(camera(10000,10000));assert.equal(view.resident.size,0);assert.equal(col.circles.length,0);
    assert(view.distant.every(d=>!d.mesh.visible));assert.deepEqual(view.distant.map(d=>Array.from(d.mesh.instanceMatrix.array)),matrices);
    s=view.update(camera());while(s.pending)s=view.update(camera());
    for(const [key,prior] of first)assert.deepEqual(view.resident.get(key),prior);
    assert.equal(view.eye.value.x,0);
    const owned=new Set(),releases=new Map();const watch=o=>{if(o&&!owned.has(o)){owned.add(o);o.addEventListener('dispose',()=>releases.set(o,(releases.get(o)||0)+1));}};
    view.group.traverse(m=>{if(!m.isMesh)return;watch(m);watch(m.geometry);watch(m.material);watch(m.customDepthMaterial);watch(m.material.map);});
    view.dispose();view.dispose();assert.equal(scene.children.length,0);assert.equal(col.circles.length,0);
    for(const o of owned)assert.equal(releases.get(o),1);
  }
});
test('switches disable both stand paths; empty data is harmless and wiring leaves valley entry intact', () => {
  assert(standsEnabled(''));for(const q of ['?stands=0','?trees=0','?stands=1&trees=0'])assert(!standsEnabled(q));
  const outside=prepareStands([stand(),stand({id:2,tier:2})],{...terrain,insideA:()=>false});assert.equal(outside.grid.size,0);assert.equal(outside.distant.size,2);
  const v=buildKamakuraStands(outside,{wind,sunDir:new THREE.Vector3(1,1,1)});assert.equal(v.distant[0].mesh.geometry.attributes.aStandExpand.array[0],0);assert.equal(v.distant[1].mesh.geometry.attributes.aStandExpand.array[0],1);v.dispose();
  const p=prepareStands(null,terrain);assert.equal(p.distant.size,0);assert.deepEqual(planStandChunks(p,new Map(),{x:0,z:0}),{create:[],remove:[]});
  const world=fs.readFileSync(new URL('../dist/valley/world-kamakura.js',import.meta.url),'utf8');
  assert(world.includes('if (standsEnabled(search))'));assert(world.includes('stands?.update(camera)'));assert(world.includes('colliders: g.col'));
});
test('private v0.6 stands aggregates and bounded traversal', {skip:!process.env.KZ_WORLD_DIR && 'KZ_WORLD_DIR未設定：私有の林分データが必要'},async t=>{
  const {data}=await readPrivateData(process.env.KZ_WORLD_DIR);if(!data.meta.veg){t.skip('植生のない旧形式');return;}
  const report=await verifyStands(data,process.env.KZ_WORLD_DIR,await readPrivateHouses(process.env.KZ_WORLD_DIR,data));
  console.log(JSON.stringify({stands:report}));assert(report.expandable>0);
});
