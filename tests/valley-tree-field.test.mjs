// なぜ失敗したか: species/overlap/margin/scale/fade/light/cadence/capacity/dispose/budget/qa の原因別に落とす。
// 第3次: 丸い殻の増分と狭い溶かし帯に合わせ、4地点の実バッファ総数を固定する。
// 独立レビュー後: 初期値のままでも通る検査（幹の行列・明るさ、容量の上限）を、失敗し得る形に直した。
// GPU・GLSL・実機コマ時間はこのNode試験では確認しない。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { field, data, camera, setAt, THREE, treeShape, wind } from './helpers/tree-field.mjs';
import { load } from './helpers/tree-modules.mjs';
import { TREES } from '../dist/valley/config.js';
import { installQA } from '../dist/valley/qa.js';
import { WORLD } from '../dist/valley/world-data.js';
import { createTerrain } from '../dist/valley/terrain-height.js';
import { scatterTrees } from '../dist/valley/scatter.js';
import { assignTreeSpecies, scatterUnderstory } from '../dist/valley/tree-species.js';
import { lodMembership } from '../dist/valley/tree-lod.js';
const { buildSpecimens } = await load('tree-view.js');
const count = f => f.sets.reduce((n,s)=>n+s.leaf.count,0);
const qa = f => { globalThis.window = {}; return installQA({ veg: { trees: f }, input: {} }, {}); };
const matrix = (s,k=0) => { const m=new THREE.Matrix4();s.leaf.getMatrixAt(k,m);return m.elements; };
let realScatter;
const real = () => { if (!realScatter) { const terrain=createTerrain(WORLD),trees=scatterTrees(WORLD,terrain); realScatter={terrain,trees,species:assignTreeSpecies(WORLD,terrain,trees),understory:scatterUnderstory(WORLD,terrain,trees)}; } return realScatter; };
// The first tint on a fine grid that selects each family, so one tree stands for each family.
const tintFor = (sp, shape) => { for (let k=0;k<1000;k++) { const t=(k+.5)/1000; if (treeShape(sp,t)===shape) return t; } throw new Error('[shape-selection] unreachable family'); };
test('derived species capacity, variants, color and shadow [species]',()=>{
  const d=data([{x:0,kind:0},{x:0,kind:0},{x:0,kind:2},{x:0,kind:1}]);
  const f=field([], {data:d,species:{species:new Uint8Array([0,1,2,3]),stage:new Uint8Array([0,85,170,255])},understory:data([{species:4,s:3},{species:4,variant:1,s:3},{species:5,s:1.2}])});
  assert.doesNotThrow(()=>f.update(camera()), '[species] valid derived species exceeded allocated capacity');
  for(let sp=0;sp<6;sp++) {
    const sets=f.sets.filter(s=>s.species===sp);
    assert.equal(sets.length,sp===4?4:sp===5?2:3,'[species] missing level or variant');
    for(const s of sets) {
      assert.equal(s.capacity,1,'[capacity] allocation must match species/variant count');
      // Every tree stands at the camera: exactly one near instance per set, none in the other levels.
      assert.equal(s.leaf.count,s.level===0?1:0,'[capacity] derived tree missing from or duplicated across its levels');
      for(const mesh of [s.leaf,s.wood]) {
        assert.equal(mesh.castShadow,s.level===0,'[shadow] distant shadow');
        assert.equal(mesh.receiveShadow,s.level<2,'[shadow] near/mid levels must receive shadows, far must not');
      }
      const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>'};
      s.leaf.material.onBeforeCompile(shader);
      assert(shader.vertexShader.includes('distance(treeOrigin.xz,cameraPosition.xz)'), '[distance] CPU and shader disagree on slopes');
    }
  }
  const a=setAt(f,4,0,0).leaf.material,b=setAt(f,4,0,1).leaf.material;
  assert.notEqual(a.map,b.map,'[species] sapling variants use same texture');
  // The initial instance colour is white: an unwritten trunk would still pass a grey-only check.
  const c=new THREE.Color();setAt(f,3,0).wood.getColorAt(0,c);
  assert(c.r===c.g && c.g===c.b && Math.abs(c.r-(.85+.3*.43))<1e-6,'[color] trunk tinted or individual brightness not written');
  assert.equal(qa(f).treeStats().bySpecies.maple[0],1,'[qa] derived species not counted');
  f.dispose();
});
test('overlap and margin enter both adjacent levels [overlap]',()=>{
  for(const x of [48,57,141,150]) {
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
    assert(scale.x>=1.7*.85 && scale.x<=1.7*1.35 && scale.y>=1.7*.85 && scale.y<=1.7*1.3,'[scale] variation out of range');
    if(sp===1||sp===3)assert.deepEqual([...sets[0].leaf.instanceColor.array.slice(0,3)],[...sets[1].leaf.instanceColor.array.slice(0,3)],'[color] seasonal color changes at LOD');
    f.dispose();
  }
});
test('understory heights, split and outer reserve in both qualities [fade]',()=>{
  for(const quality of ['standard','light']) for(const sp of [4,5]) {
    const cfg=TREES[sp===4?'sapling':'shrub'],range=quality==='light'?cfg.lightDistance:cfg.distance,w=TREES.lod.blend[quality];
    const f=field([],{quality,understory:data([{x:cfg.split,species:sp,s:sp===4?3:1.2}])});f.update(camera());
    assert.equal(count(f),2,'[split] hard split must reserve adjacent levels for movement');
    const sets=f.sets.filter(s=>s.leaf.count);
    assert.deepEqual(matrix(sets[0]),matrix(sets[1]),'[scale] understory level changes scale');
    const sy=Math.hypot(...matrix(sets[0]).slice(4,7));assert(sy>=.85&&sy<=1.3,'[scale] height in metres not normalized');
    for(const s of sets)for(const mesh of [s.leaf,s.wood])if(mesh) {
      const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <alphatest_fragment>\n#include <emissivemap_fragment>'};
      mesh.material.onBeforeCompile(shader);
      assert(shader.vertexShader.includes(`float treeShrink = 1.0-smoothstep(${(range-w).toFixed(1)},${(range+w).toFixed(1)},distance(treeOrigin.xz,cameraPosition.xz));`),'[shrink] outer shrink missing from leaf/trunk shader');
    }
    f.understory.x[0]=range+w+5;f.update(camera(),true);assert(count(f)>0,'[margin] outer fade lacks movement reserve');
    f.understory.x[0]=range+w+6;f.update(camera(),true);assert.equal(count(f),0,'[fade] outside understory retained');
    assert.equal(f.stats.understory,0,'[stats] removed understory counted');f.dispose();
  }
});
// なぜ失敗したか: 名前は「近景を保つ」なのに遠景の本数しか見ず、間引きを全段にかけて近景の半数が消えても通った。
test('light keeps half of far instances while keeping near overlap [light]',()=>{
  // Ten trees in each light band, overlap bands included; every level membership comes from the shared rule.
  const xs=[0,20,30,33,60,90,99,104,400], points=xs.flatMap(x=>Array.from({length:10},()=>({x})));
  const f=field(points,{quality:'light'});f.update(camera());
  const policy={lod:[32,100],blend:3}, members=[0,1,2].map(l=>points.map((p,i)=>lodMembership(p.x,policy)[l]?i:-1).filter(i=>i>=0));
  const levels=[0,1,2].map(l=>f.sets.filter(s=>s.level===l).reduce((n,s)=>n+s.leaf.count,0));
  assert(members[0].length>=20 && members[1].length>=20,'[light] vacuous near/mid fixture');
  assert.deepEqual(levels.slice(0,2),[members[0].length,members[1].length],'[light] thinning reached the near or mid level');
  assert.equal(levels[2],members[2].filter(i=>!(i&1)).length,'[light] far thinning removed or changed');
  assert(levels[2]<members[2].length,'[light] far level not thinned');
  assert.deepEqual(f.lod,[32,100],'[light] wrong distances');
  assert.deepEqual(setAt(f,0,0).leaf.material.userData.uLod.value.toArray(),[-1,-1,32,38],'[uniform] light material policy');f.dispose();
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
  const {trees,species,understory}=real();
  const f=field([],{data:trees,species,understory});const api=qa(f);
  // Hashed shape families and the terrace/tread/dress understory exclusions moved the four totals.
  // 8.1a (R17.11): near cedar limbs and tufts, middle broadleaf limbs: +9,706 to +42,862 per site, still under the old one-pass values.
  const sites=[[WORLD.start.x,WORLD.start.z,1438000,1328534],[-5,2.2,1387000,1087372],[-6,20,1344000,1056502],[-36,-48,1394000,1278092]];
  const at=new Map();for(const d of [trees,understory])d.x.forEach((x,i)=>at.set(`${Math.fround(x)},${Math.fround(d.z[i])}`,d.tint[i]));
  assert.deepEqual(sites.map(p=>p.slice(0,2)),[[-100.5,-89],[-5,2.2],[-6,20],[-36,-48]],'[budget-sites] four evaluation sites changed');
  assert.equal(f.sets.length,3*Object.values(TREES.variants).reduce((a,b)=>a+b,0)+6,'[sets] wrong species/variant level count');assert(f.group.children.length<=90,'[sets] draw set budget exceeded');
  for(const [x,z,old,expected] of sites) {
    const start=performance.now();f.update(camera(x,z),true);const ms=performance.now()-start,result=api.treeStats();
    console.log(`[tree-budget] (${x},${z}) total=${result.total} old=${old} update=${ms.toFixed(3)}ms sets=${f.sets.length} meshes=${f.group.children.length}`);
    assert(result.total<old,'[budget] tree triangles exceed old one-pass budget');
    // 7.9 set 1.30M; 8.1a spends up to 43k more on near detail (R17.11). The browser total is gated by perf (R17.10).
    assert(result.total<=1350000,'[budget-target] tree triangles exceed 1.35M target');
    assert.equal(result.total,expected,'[budget-site] real scatter triangle count changed');
    const sum=Object.values(result.tris).flat().reduce((a,b)=>a+b,0);assert.equal(sum,result.total,'[qa] species triangles differ from total');
    for(let sp=0;sp<4;sp++)for(const s of f.sets.filter(s=>s.species===sp))assert.equal(s.capacity,Array.from(species.species).filter((v,i)=>v===sp && treeShape(sp,trees.tint[i])===s.shape).length,'[capacity] real species/shape count mismatch');
    for(const s of f.sets) {
      for(const m of [s.leaf,s.wood])assert.equal(m.instanceMatrix.count,s.capacity,'[capacity] actual allocation differs');
      assert.equal(s.wood.count,s.leaf.count,'[instance-wood] trunk count differs from crown');
      const leaf=s.leaf.instanceMatrix.array,wood=s.wood.instanceMatrix.array,colors=s.wood.instanceColor.array;
      for(let k=0;k<s.leaf.count;k++) {
        for(let e=0;e<16;e++)if(wood[k*16+e]!==leaf[k*16+e])assert.fail(`[instance-wood] trunk matrix differs from crown at ${s.leaf.name}#${k}`);
        const tint=at.get(`${leaf[k*16+12]},${leaf[k*16+14]}`);
        assert(tint!==undefined,'[instance-wood] instance not at an individual position (identity matrix)');
        assert(colors[k*3]===colors[k*3+1]&&colors[k*3+1]===colors[k*3+2]&&Math.abs(colors[k*3]-(.85+.3*tint))<1e-6,'[wood-color] trunk brightness not written per individual');
      }
    }
    assert.equal(result.stats.near+result.stats.mid+result.stats.far+result.stats.understory,count(f),'[stats] counts lost or duplicated');
    assert.equal(Object.values(result.bySpecies).flat().reduce((a,b)=>a+b,0),count(f),'[qa] instance counts incorrect');
  }
  f.dispose();
});

// なぜ失敗したか: 変種を段ごとに選び直すと樹形が跳ね、同じ材質の多重パッチでLODが壊れる。
test('tint selects one stable family across all levels and QA sums families [shape-selection]',()=>{
  const points=[];
  for(let sp=0;sp<4;sp++)for(let k=0;k<TREES.variants[['cedar','zelkova','pine','maple'][sp]];k++)points.push({x:48,kind:sp,tint:tintFor(sp,k),rot:.6});
  const f=field(points);f.update(camera());
  assert.equal(f.sets.length,39,'[shape-sets] missing adult family');
  for(const s of f.sets) {
    assert.equal(s.capacity,1,'[shape-capacity] per-family buffer');
    assert.equal(s.leaf.count,s.level<2?1:0,'[shape-selection] tint family absent');
    if(s.level===0) {
      const mid=f.sets.find(m=>m.species===s.species && m.shape===s.shape && m.level===1);
      assert.deepEqual(matrix(s),matrix(mid),'[shape-lod] family transform changes');
      assert.notEqual(s.leaf.material,mid.leaf.material,'[shape-material] level material shared');
    }
    const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>'};s.leaf.material.onBeforeCompile(shader);
    assert.equal((shader.vertexShader.match(/distance\(treeOrigin.xz,cameraPosition.xz\)/g)||[]).length,1,'[shape-material] shader patched more than once');
    assert.deepEqual(s.leaf.material.userData.uLod.value.toArray(),s.level===0?[-1,-1,48,56]:s.level===1?[40,48,150,158]:[142,150,-1,-1],'[shape-material] family corrupted LOD uniforms');
  }
  const q=qa(f).treeStats();for(const sp of ['cedar','zelkova','pine','maple'])assert.deepEqual(q.bySpecies[sp],[TREES.variants[sp],TREES.variants[sp],0],'[qa-shape] shape counts overwritten');
  const total=f.sets.reduce((n,s)=>n+s.leaf.count*(s.leaf.geometry.index.count+s.wood.geometry.index.count)/3,0);assert.equal(q.total,total,'[qa-shape] shape triangles lost');
  f.data.x.fill(150);f.update(camera(),true);assert(f.sets.every(s=>s.leaf.count===(s.level>0?1:0)),'[shape-lod] far family differs');
  f.dispose();
  const shuffled=field([...points].reverse());shuffled.update(camera());
  assert(shuffled.sets.every(s=>s.capacity===1 && s.leaf.count===(s.level<2?1:0)),'[shape-order] family depends on array index');shuffled.dispose();
});
test('individual tilt and scale are deterministic and leave roots fixed [tilt/scale]',()=>{
  for(const tint of [0,.03,.19,.43,.71,.99,1]) {
    const f=field([{x:48,y:7,z:0,tint,rot:.6}]);f.update(camera());const m=new THREE.Matrix4().fromArray(matrix(f.sets.find(s=>s.leaf.count))),p=new THREE.Vector3(),s=new THREE.Vector3(),q=new THREE.Quaternion();m.decompose(p,q,s);
    assert.deepEqual(p.toArray(),[48,Math.fround(6.85),0],'[tilt-root] tilt moves root');
    const e=new THREE.Euler().setFromQuaternion(q,'YXZ');
    assert(Math.abs(e.x)<=Math.PI/60+1e-6 && Math.abs(e.z)<=Math.PI/60+1e-6 && Math.abs(e.x)+Math.abs(e.z)>1e-5,'[tilt] missing or excessive tilt');
    assert(s.x>=.85-1e-6 && s.x<=1.35+1e-6 && s.y>=.85-1e-6 && s.y<=1.3+1e-6,'[scale-range] individual dimensions');
    assert(Math.abs(s.x-(.85+.5*((tint*7.31)%1)))<1e-6 && Math.abs(s.y-(.85+.45*((tint*3.17)%1)))<1e-6,'[scale-range] full variation not used');
    const before=matrix(f.sets.find(s=>s.leaf.count));f.update(camera(),true);assert.deepEqual(matrix(f.sets.find(s=>s.leaf.count)),before,'[tilt-determinism] forced update changes transform');f.dispose();
  }
});
test('understory hard switches with movement reserve and shrinks vertices instead of dither [hard-split/shrink]',()=>{
  for(const quality of ['standard','light'])for(const sp of [4,5]) {
    const cfg=TREES[sp===4?'sapling':'shrub'],range=quality==='light'?cfg.lightDistance:cfg.distance,w=TREES.lod.blend[quality];
    const f=field([],{quality,understory:data([{x:cfg.split,species:sp,s:sp===4?3:1.2}])});f.update(camera());
    for(const set of f.sets)for(const mesh of [set.leaf,set.wood]) {
      const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <alphatest_fragment>'};mesh.material.onBeforeCompile(shader);const v=shader.vertexShader;
      const expression=v.match(/float treeShrink = ([^;]+);/)?.[1];assert(expression,'[shrink] missing root shrink');
      assert(v.includes('transformed *= treeShrink;') && v.indexOf('transformed *= treeShrink;')<v.indexOf('vec4 treeWorld'),'[shrink] local vertices not scaled before instance transform');
      assert.equal(v.match(/vTreeWeight = ([^;]+);/)?.[1],`${set.level===0?'1.0-':''}step(${cfg.split.toFixed(1)},vTreeDistance)`,'[hard-split] blended or outer dither weight');
      assert.deepEqual(mesh.material.userData.uLod.value.toArray(),[-1,-1,-1,-1],'[hard-split] blend uniforms enabled');
      const scalar=new Function('distance','treeOrigin','cameraPosition','smoothstep',`return ${expression}`);
      const smoothstep=(a,b,d)=>{const t=Math.max(0,Math.min(1,(d-a)/(b-a)));return t*t*(3-2*t);};
      for(const [d,expected] of [[range-w,1],[range,.5],[range+w,0]])assert.equal(scalar(()=>d,{xz:0},{xz:0},smoothstep),expected,'[shrink] incorrect smooth scale');
    }
    // Reserve is around the hard split, not split +/- blend +/- margin.
    f.understory.x[0]=cfg.split+6;f.update(camera(),true);assert.equal(setAt(f,sp,0).leaf.count,0,'[hard-split-margin] retained L0 beyond movement reserve');
    f.understory.x[0]=cfg.split-6;f.update(camera(),true);assert.equal(setAt(f,sp,1).leaf.count,0,'[hard-split-margin] retained L1 beyond movement reserve');f.dispose();
  }
});

// なぜ失敗したか: 等分選択では旧変種が減りすぎ、QAが新しい変種を識別できなかった。
test('cedar tint allocation is 45/25/30 and QA includes five families [cedar-frequency/qa]',()=>{
  const counts=[0,0,0,0,0];for(let i=0;i<1000;i++)counts[treeShape(0,(i+.5)/1000)]++;
  assert.deepEqual(counts,[150,150,150,250,300],'[cedar-frequency] weighted allocation');
  const {trees,species}=real(),cedar=Array.from(trees.tint).filter((_,i)=>species.species[i]===0),actual=[0,0,0,0,0];
  for(const t of cedar)actual[treeShape(0,t)]++;
  actual.forEach((n,k)=>assert(Math.abs(n/cedar.length-[.15,.15,.15,.25,.30][k])<.01,'[cedar-frequency] real scatter family share drifted'));
  const f=field([0,1,2,3,4].map(k=>({x:48,tint:tintFor(0,k)})));f.update(camera());
  assert.deepEqual(qa(f).treeStats().byShape.cedar,{'0':[1,1,0],'1':[1,1,0],'2':[1,1,0],'3':[1,1,0],'4':[1,1,0]},'[qa-cedar] missing family or level');f.dispose();
});

// なぜ失敗したか: 幹の行列・明るさを書き忘れても、InstancedMeshの初期値（単位行列・白）のまま全試験が通り、全ての幹が原点に重なった。
test('trunk instances follow their crowns and carry individual brightness [instance-wood/wood-color]',()=>{
  const adults=[{x:5,z:3,y:2,kind:0,tint:.1,rot:.4},{x:100,z:-7,kind:1,tint:.6,rot:1.1},{x:400,z:9,kind:2,tint:.9},{x:30,z:20,kind:0,tint:.33}];
  const plants=[{x:4,z:-2,species:4,s:3,tint:.2},{x:20,z:1,species:5,s:1.2,tint:.8}];
  const f=field(adults,{understory:data(plants)});f.update(camera());
  const items=[...adults,...plants],seen=new Set();
  for(const s of f.sets) {
    assert.equal(s.wood.count,s.leaf.count,'[instance-wood] trunk count differs from crown');
    for(let k=0;k<s.leaf.count;k++) {
      const trunk=new THREE.Matrix4();s.wood.getMatrixAt(k,trunk);
      assert.deepEqual(trunk.elements,matrix(s,k),'[instance-wood] trunk matrix differs from crown');
      const item=items.find(p=>Math.abs(p.x-trunk.elements[12])<1e-4&&Math.abs(p.z-trunk.elements[14])<1e-4);
      assert(item&&!trunk.equals(new THREE.Matrix4()),'[instance-wood] trunk left at the identity matrix');
      const c=new THREE.Color();s.wood.getColorAt(k,c);
      assert(c.r===c.g&&c.g===c.b&&Math.abs(c.r-(.85+.3*item.tint))<1e-6,'[wood-color] trunk brightness not written per individual');
      seen.add(item);
    }
  }
  assert.equal(seen.size,items.length,'[instance-wood] fixture tree missing from every level');f.dispose();
});

// なぜ失敗したか: 群の材質のキャッシュ鍵がQA標本と同じだと、先にコンパイルした方のシェーダー（地面距離・縮みの置換の有無）を両方が使う。
test('field programs never share a cache key with QA specimens [cache-key]',()=>{
  const f=field([{x:0},{x:0,kind:1},{x:0,kind:2}],{understory:data([{species:4,s:3},{species:4,variant:1,s:3},{species:5,s:1.2}])});
  const spec=buildSpecimens({terrain:{heightAt:()=>0},wind,sunDir:new THREE.Vector3(1,1,1),items:f.sets.map(s=>({species:s.species,level:s.level,variant:s.variant,shape:s.shape}))});
  f.sets.forEach((s,k)=>{
    for(const [j,mesh] of [[0,s.leaf],[1,s.wood]]) {
      const key=mesh.material.customProgramCacheKey(),other=spec.group.children[k*2+j].material.customProgramCacheKey();
      assert(key.includes('-field-xz-'),'[cache-key] field program key lost its ground-distance tag');
      assert.notEqual(key,other,'[cache-key] field and QA specimen compile to one program');
    }
  });
  spec.dispose();f.dispose();
});

// なぜ失敗したか: 形を tint の帯で選んだため、明るさ(.85+.3*tint)と背丈も同じ tint から出て、形ごとに明るさの帯が分かれた。
test('shape families span the whole tint-driven brightness range [shape-brightness]',()=>{
  const {trees,species}=real();
  for(let sp=0;sp<4;sp++) {
    const tints=Array.from(trees.tint).filter((_,i)=>species.species[i]===sp),lo=Math.min(...tints),hi=Math.max(...tints),ranges=new Map();
    for(const t of tints){const s=treeShape(sp,t),r=ranges.get(s)??[1,0];ranges.set(s,[Math.min(r[0],t),Math.max(r[1],t)]);}
    assert.equal(ranges.size,TREES.variants[['cedar','zelkova','pine','maple'][sp]],'[shape-brightness] family missing from the real scatter');
    for(const [s,[a,b]] of ranges)assert((b-a)/(hi-lo)>=.8,`[shape-brightness] family ${sp}/${s} confined to one brightness band`);
  }
});

// なぜ失敗したか: 針葉樹のL2だけ明るさを別の式(.55+.9*f3)で決め、溶かし帯で半数の木の明るさが±20%以上跳ねた。
test('far conifers keep their mid brightness [far-brightness]',()=>{
  const {trees,species}=real(),pick=[...trees.x.keys()].filter(i=>species.species[i]===0||species.species[i]===2);
  const d=Object.fromEntries(Object.entries(trees).map(([k,a])=>[k,pick.map(i=>k==='x'||k==='z'?0:a[i])]));
  const f=field([],{data:d,species:{species:Uint8Array.from(pick,i=>species.species[i]),stage:new Uint8Array(pick.length)}});
  // Colours depend on the individual, not on position: the same trees seen mid-only, then far-only.
  const luma=level=>{const out=new Map();for(const s of f.sets)if(s.level===level){const a=s.leaf.instanceColor.array;out.set(`${s.species}/${s.shape}`,Array.from({length:s.leaf.count},(_,k)=>.2126*a[k*3]+.7152*a[k*3+1]+.0722*a[k*3+2]));}return out;};
  f.update(camera(100),true);const mid=luma(1);f.update(camera(400),true);const far=luma(2);
  let inside=0,total=0;
  for(const [key,values] of mid){const other=far.get(key);assert.equal(other.length,values.length,'[far-brightness] individuals lost between levels');values.forEach((v,k)=>{total++;if(Math.abs(other[k]/v-1)<=.25)inside++;});}
  assert(total===pick.length&&total>10000,'[far-brightness] vacuous conifer fixture');
  assert(inside/total>=.95,`[far-brightness] only ${(100*inside/total).toFixed(1)}% of conifers keep L2/L1 brightness within 25%`);
  f.dispose();
});
