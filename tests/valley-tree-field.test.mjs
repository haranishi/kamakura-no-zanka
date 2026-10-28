// なぜ失敗したか: species/overlap/margin/scale/fade/light/cadence/capacity/dispose/budget/qa の原因別に落とす。
// GPU・GLSL・実機コマ時間はこのNode試験では確認しない。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { field, data, camera, setAt, THREE } from './helpers/tree-field.mjs';
import { TREES } from '../dist/valley/config.js';
import { installQA } from '../dist/valley/qa.js';
import { WORLD } from '../dist/valley/world-data.js';
import { createTerrain } from '../dist/valley/terrain-height.js';
import { scatterTrees } from '../dist/valley/scatter.js';
import { assignTreeSpecies, scatterUnderstory } from '../dist/valley/tree-species.js';
const count = f => f.sets.reduce((n,s)=>n+s.leaf.count,0);
const qa = f => { globalThis.window = {}; return installQA({ veg: { trees: f }, input: {} }, {}); };
const matrix = (s,k=0) => { const m=new THREE.Matrix4();s.leaf.getMatrixAt(k,m);return m.elements; };
test('derived species capacity, variants, color and shadow [species]',()=>{
  const d=data([{x:0,kind:0},{x:0,kind:0},{x:0,kind:2},{x:0,kind:1}]);
  const f=field([], {data:d,species:{species:new Uint8Array([0,1,2,3]),stage:new Uint8Array([0,85,170,255])},understory:data([{species:4,s:3},{species:4,variant:1,s:3},{species:5,s:1.2}])});
  assert.doesNotThrow(()=>f.update(camera()), '[species] valid derived species exceeded allocated capacity');
  for(let sp=0;sp<6;sp++) {
    const sets=f.sets.filter(s=>s.species===sp);
    assert.equal(sets.length,sp===4?4:sp===5?2:3,'[species] missing level or variant');
    for(const s of sets) {
      assert.equal(s.capacity,1,'[capacity] allocation must match species/variant count');
      assert(s.leaf.count<=s.capacity,'[capacity] instances exceed buffer');
      assert.equal(s.leaf.castShadow,s.level===0,'[shadow] distant shadow');
      assert.equal(s.leaf.receiveShadow,s.level===0,'[shadow] adapter setting changed');
      const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>'};
      s.leaf.material.onBeforeCompile(shader);
      assert(shader.vertexShader.includes('distance(treeOrigin.xz,cameraPosition.xz)'), '[distance] CPU and shader disagree on slopes');
    }
  }
  const a=setAt(f,4,0,0).leaf.material,b=setAt(f,4,0,1).leaf.material;
  assert.notEqual(a.map,b.map,'[species] sapling variants use same texture');
  const c=new THREE.Color();setAt(f,3,0).wood.getColorAt(0,c);
  assert.equal(c.r,c.g,'[color] trunk tinted');assert.equal(c.g,c.b,'[color] trunk tinted');
  assert.equal(qa(f).treeStats().bySpecies.maple[0],1,'[qa] derived species not counted');
  f.dispose();
});
test('overlap and margin enter both adjacent levels [overlap]',()=>{
  for(const x of [48,63,135,150]) {
    const f=field([{x}]);f.update(camera());
    const levels=f.sets.filter(s=>s.leaf.count).map(s=>s.level);
    assert.deepEqual(levels,x<100?[0,1]:[1,2],'[overlap/margin] adjacent level omitted');
    f.dispose();
  }
  const f=field([{x:400}]);f.update(camera());
  assert.deepEqual(f.sets.map(s=>s.leaf.count),[0,0,1],'[overlap] far tree duplicated');f.dispose();
});
test('every transition preserves matrix and broadleaf color [scale]',()=>{
  for(const sp of [0,1,2,3]) for(const x of [48,150]) {
    const f=field([{x,kind:sp,s:1.7,rot:.6,tint:.43}]);f.update(camera());
    const sets=f.sets.filter(s=>s.leaf.count);
    assert.deepEqual(matrix(sets[0]),matrix(sets[1]),'[scale] transition changes dimensions or placement');
    const scale=new THREE.Vector3(), p=new THREE.Vector3(),q=new THREE.Quaternion();new THREE.Matrix4().fromArray(matrix(sets[0])).decompose(p,q,scale);
    assert(scale.x>=1.7*.9 && scale.x<=1.7*1.25 && scale.y>=1.7*.92 && scale.y<=1.7*1.2,'[scale] variation out of range');
    if(sp===1||sp===3)assert.deepEqual([...sets[0].leaf.instanceColor.array.slice(0,3)],[...sets[1].leaf.instanceColor.array.slice(0,3)],'[color] seasonal color changes at LOD');
    f.dispose();
  }
});
test('understory heights, split and outer reserve in both qualities [fade]',()=>{
  for(const quality of ['standard','light']) for(const sp of [4,5]) {
    const cfg=TREES[sp===4?'sapling':'shrub'],range=quality==='light'?cfg.lightDistance:cfg.distance,w=TREES.lod.blend[quality];
    const f=field([],{quality,understory:data([{x:cfg.split,species:sp,s:sp===4?3:1.2}])});f.update(camera());
    assert.equal(count(f),2,'[split] understory transition must overlap');
    const sets=f.sets.filter(s=>s.leaf.count);
    assert.deepEqual(matrix(sets[0]),matrix(sets[1]),'[scale] understory level changes scale');
    const sy=Math.hypot(...matrix(sets[0]).slice(4,7));assert(sy>=.92&&sy<=1.2,'[scale] height in metres not normalized');
    for(const s of sets)for(const mesh of [s.leaf,s.wood])if(mesh) {
      const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <alphatest_fragment>\n#include <emissivemap_fragment>'};
      mesh.material.onBeforeCompile(shader);
      assert(shader.vertexShader.includes(`1.0-smoothstep(${(range-w).toFixed(1)},${(range+w).toFixed(1)},vTreeDistance)`),'[fade] outer fade missing from leaf/trunk shader');
    }
    f.understory.x[0]=range+w+5;f.update(camera(),true);assert(count(f)>0,'[margin] outer fade lacks movement reserve');
    f.understory.x[0]=range+w+6;f.update(camera(),true);assert.equal(count(f),0,'[fade] outside understory retained');
    assert.equal(f.stats.understory,0,'[stats] removed understory counted');f.dispose();
  }
});
test('light keeps half of far instances while keeping near overlap [light]',()=>{
  const f=field(Array.from({length:10},()=>({x:400})),{quality:'light'});f.update(camera());
  assert.equal(f.stats.far,5,'[light] far thinning removed');
  assert.deepEqual(f.lod,[32,100],'[light] wrong distances');
  assert.deepEqual(setAt(f,0,0).leaf.material.userData.uLod.value.toArray(),[-1,-1,24,40],'[uniform] light material policy');f.dispose();
});
test('force, last and five metre cadence [cadence]',()=>{
  const f=field([{x:0}]);f.update(camera());assert.equal(f.stats.near,1,'[cadence] first update skipped');
  f.update(camera(4.99));assert.equal(f.last.x,0,'[cadence] updated before five metres');
  f.update(camera(3,4));assert.equal(f.last.x,3,'[cadence] exact five metre update skipped');
  f.update(camera(3.1,4),true);assert.equal(f.last.x,3.1,'[force] forced assignment skipped');
  assert.equal(f.last.y,4,'[last] public Vector2 changed');f.dispose();
});
test('fallback uses legacy kind and empty understory [fallback]',()=>{
  const f=field([{kind:1,x:400},{kind:2,x:0}]);f.update(camera());
  assert.equal(setAt(f,1,2).leaf.count,1,'[fallback] kind ignored');assert.equal(f.stats.understory,0,'[fallback] unexpected understory');f.dispose();
});
test('owned buffers/materials/textures disposed once, templates survive [dispose]',()=>{
  const f=field([{x:48}]),events={geometry:0,instance:0,material:0,texture:0};
  const materials=new Set(),textures=new Set();
  for(const s of f.sets)for(const m of [s.leaf,s.wood])if(m) {
    m.geometry.addEventListener('dispose',()=>events.geometry++);m.addEventListener('dispose',()=>events.instance++);materials.add(m.material);
    if(m.material.map)textures.add(m.material.map);
  }
  for(const m of materials)m.addEventListener('dispose',()=>events.material++);
  for(const t of textures)t.addEventListener('dispose',()=>events.texture++);
  const parent=new THREE.Group();parent.add(f.group);const meshes=f.group.children.length;
  f.dispose();f.dispose();f.update(camera());
  assert.equal(events.geometry,meshes,'[dispose] geometry leak/repeat');assert.equal(events.instance,meshes,'[dispose] instance buffer leak/repeat');
  assert.equal(events.material,materials.size,'[dispose] material leak/repeat');assert.equal(events.texture,textures.size,'[dispose] texture leak/repeat');
  assert.equal(parent.children.length,0,'[dispose] group retained');assert.equal(f.group.children.length,0,'[dispose] meshes retained');
  const other=field([{x:0}]);other.update(camera());assert.equal(other.stats.near,1,'[dispose] shared template damaged');other.dispose();
});
test('vegetation and quality switch wiring [wiring]',()=>{
  const read=p=>fs.readFileSync(new URL('../dist/valley/'+p,import.meta.url),'utf8');
  assert.match(read('vegetation.js'),/new TreeField\(\{ data: scatter.trees, species: scatter.species, understory: scatter.understory, wind, sunDir, quality \}\)/,'[wiring] missing species/wind/understory');
  assert.match(read('main.js'),/old\.trees\.dispose\(\)/,'[dispose] quality switch bypasses owner');
  assert(!read('vegetation.js').includes('function cedarGeometry'),'[wiring] legacy tree code retained');
});
test('real scatter, four site budgets, QA accounting and capacities [budget]',()=>{
  const terrain=createTerrain(WORLD),trees=scatterTrees(WORLD,terrain),species=assignTreeSpecies(WORLD,terrain,trees),understory=scatterUnderstory(WORLD,terrain,trees);
  const f=field([],{data:trees,species,understory});const api=qa(f);
  const sites=[[WORLD.start.x,WORLD.start.z,1438000,985604],[-5,2.2,1387000,843894],[-6,20,1344000,811614],[-36,-48,1394000,940290]];
  assert.deepEqual(sites.map(p=>p.slice(0,2)),[[-100.5,-89],[-5,2.2],[-6,20],[-36,-48]],'[budget-sites] four evaluation sites changed');
  assert.equal(f.sets.length,18,'[sets] wrong species/variant level count');assert(f.group.children.length<=40,'[sets] draw set budget exceeded');
  for(const [x,z,old,expected] of sites) {
    const start=performance.now();f.update(camera(x,z),true);const ms=performance.now()-start,result=api.treeStats();
    console.log(`[tree-budget] (${x},${z}) total=${result.total} old=${old} update=${ms.toFixed(3)}ms sets=${f.sets.length} meshes=${f.group.children.length}`);
    assert(result.total<old,'[budget] tree triangles exceed old one-pass budget');
    assert.equal(result.total,expected,'[budget-site] real scatter triangle count changed');
    const sum=Object.values(result.tris).flat().reduce((a,b)=>a+b,0);assert.equal(sum,result.total,'[qa] species triangles differ from total');
    const expectedSpecies=[0,0,0,0];for(const s of species.species)expectedSpecies[s]++;
    for(let sp=0;sp<4;sp++)for(const s of f.sets.filter(s=>s.species===sp))assert.equal(s.capacity,expectedSpecies[sp],'[capacity] real species count mismatch');
    for(const s of f.sets)for(const m of [s.leaf,s.wood])if(m) {
      assert(m.count<=m.instanceMatrix.count,'[capacity] real instances exceed GPU buffer');
      assert.equal(m.instanceMatrix.count,s.capacity,'[capacity] actual allocation differs');
    }
    assert.equal(result.stats.near+result.stats.mid+result.stats.far+result.stats.understory,count(f),'[stats] counts lost or duplicated');
    assert.equal(Object.values(result.bySpecies).flat().reduce((a,b)=>a+b,0),count(f),'[qa] instance counts incorrect');
  }
  f.dispose();
});
