import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeVeg, VEG_FIELDS, mapVeg, prepareVeg, nearbyVeg, selectVeg, vegPolicy, vegCircles, treesEnabled, configureVegPolicy, VEG_POLICY_LIMITS } from '../dist/valley/kamakura-veg.js';
import { loadKamakura, decodeData } from '../dist/valley/kamakura-data.js';
import { buildColliders, moveActor } from '../dist/valley/collision.js';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { load, THREE } from './helpers/tree-modules.mjs';
import { wind, stubRenderer } from './helpers/tree-field.mjs';
import { verifyVeg } from '../tools/lib/kamakura-veg-validation.mjs';
import { readPrivateData } from '../tools/lib/kamakura-validation.mjs';
import { readPrivateHouses } from '../tools/lib/kamakura-house-validation.mjs';
const { buildKamakuraVeg, vegHeight } = await load('kamakura-veg-view.js');
const { treeGeometry } = await load('tree-geometry.js');
const info = n => ({ schema: 'kz-veg-web/0.1', file: 'veg_f32.bin', encoding: 'float32-le (N,16)', count: n, fields: VEG_FIELDS });
const row = (over = {}) => Object.assign([10, 10, 9999, .7, 12, 3, 0, 0, 3, -.2, .25, .07, .4, 0, 0, 0], over);
const bin = rows => { const b = new ArrayBuffer(rows.length * 64), v = new DataView(b); rows.flat().forEach((x,k) => v.setFloat32(k*4,x,true)); return b; };
const decode = rows => decodeVeg(info(rows.length), bin(rows));
const terrain = { heightAt: () => 10, waterAt: () => 0, insideA: () => true };
test('vegetation LE fields/count, finite/range contract and ignored tiers are still validated', () => {
  const a = decode([row()])[0]; assert.equal(a.x,10); assert.equal(a.height,12); assert.equal(a.phase,.25); assert(!Object.hasOwn(a,'y'));
  assert.throws(() => decodeVeg(info(2), bin([row()])));
  assert.throws(() => decodeVeg({ ...info(1), fields: [...VEG_FIELDS].reverse() }, bin([row()])));
  for (const [k,v] of [[0,NaN],[2,Infinity],[4,0],[5,-1],[6,7],[6,.5],[7,3],[8,4],[9,1.1],[10,-.1],[12,1.1],[15,NaN]]) assert.throws(() => decode([row({[k]:v})]));
  assert.equal(mapVeg(decode([row({7:1})])[0]),null); assert.equal(mapVeg(decode([row({6:5})])[0]),null);
});
test('species, shape clamp, linear green and scale are deterministic across levels', () => {
  const a = decode(Array.from({length:7},(_,k)=>row({6:k}))), mapped = a.map(mapVeg);
  assert.deepEqual(mapped.map(i=>i?.species ?? null), [1,2,0,1,5,null,3]);
  assert.deepEqual(mapped, a.map(mapVeg));
  assert.equal(mapped[0].shape,2); assert.equal(mapped[1].shape,1); assert.equal(mapped[2].shape,3); assert.equal(mapped[4].shape,0);
  assert(mapped[0].color.every((v,k)=>v<mapped[3].color[k]));
  for(const i of mapped.filter(Boolean)) for(let l=0;l<(i.species===5?2:3);l++) assert.equal(treeGeometry(i.species,l,i.shape).height * i.height / vegHeight(i.species,i.shape), i.height);
});
test('one-time exclusions cover rotated house, route with north conversion, spawn, water, sea and preserve marks', () => {
  const rows = [row({0:0,1:0}),row({0:20,1:-10}),row({0:40,1:0}),row({0:60,1:0}),row({0:80,1:0}),row({0:100,1:0})];
  let queries=0;
  const p=prepareVeg(decode(rows),{...terrain,waterAt:(x)=>{queries++;return x===60?1:0;},heightAt:x=>x===80?-1:20},
    {boxes:[{x:0,z:0,w:4,d:4,rotY:Math.PI/4}],paths:{r:{xyz_m:[[18,10,1],[22,10,2]]}},spawn:{x:40,z:0}});
  assert.deepEqual(p.excluded,{house:1,path:1,spawn:1,water:2}); assert.equal(p.active.length,1); assert.equal(p.active[0].y,20);
  assert.deepEqual(p.records.map(i=>i.excluded),['house','path','spawn','water','water',null]);
  const corners=prepareVeg(decode([row({0:2.8,1:2.8})]),terrain,{boxes:[{x:0,z:0,w:4,d:4,rotY:0}]});assert.equal(corners.active.length,1);
  const before=queries;selectVeg(p.grid,{x:100,z:0}); assert.equal(queries,before);
});
test('256m index limits scanned cells; distance then thin rank, global capacity and range limits', () => {
  const p=prepareVeg(decode([row({0:20,1:0,12:.8}),row({0:-20,1:0,12:.1}),row({0:100,1:0}),row({0:10000,1:0})]),terrain);
  assert.equal(nearbyVeg(p.grid,{x:0,z:0},50).items.length,3);
  const policy={...vegPolicy(),capacities:[1,1,1]}, s=selectVeg(p.grid,{x:0,z:0},policy);
  assert.equal(s.levels[0][0].id,1);assert.equal(s.levels[1][0].id,2);assert.equal(s.dropped[0],1);assert.equal(s.scanned,3);
  assert(s.levels.every(v=>v.length<=1));
  const circles=vegCircles(prepareVeg(decode([row(),row({6:4}),row({0:50})]),{...terrain,insideA:x=>x<50}),vegHeight);
  assert.equal(circles.length,1);assert.equal(circles[0].r,.42);
});
test('trunk collision stops swept walking, while shrub and disabled trees leave the path free', () => {
  const p=prepareVeg(decode([row({0:0,1:0}),row({0:3,1:0,6:4})]),terrain);
  const circles=vegCircles(p,vegHeight), bounds={minX:-100,maxX:100,minZ:-100,maxZ:100};
  const t={...terrain,bounds,walkable:()=>true,slopeAt:()=>0};
  const pos={x:-2,y:10,z:0};const result=moveActor(buildColliders({bounds,extraCircles:circles}),t,pos,4,0);
  assert(result.x<-.7);assert(Math.abs(moveActor(buildColliders({bounds}),t,pos,4,0).x-2)<1e-10);
});
test('view applies global caps across types and shader distances/phase/fade match CPU policy (no GPU)', () => {
  const prepared=prepareVeg(decode(Array.from({length:150},(_,i)=>row({0:10,1:0,6:i%4,8:0}))),terrain);
  const view=buildKamakuraVeg(prepared,{wind,sunDir:new THREE.Vector3(1,1,1)});
  const s=view.update({position:{x:0,z:0}});assert.equal(s.counts[0],128);assert.equal(s.dropped[0],22);
  for(const set of view.sets.values())for(const m of [set.leaf,set.wood])if(m){
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};m.material.onBeforeCompile(shader);
    assert(shader.vertexShader.includes('aKzPhase*6.283185'));assert(shader.vertexShader.includes('distance(treeOrigin.xz,cameraPosition.xz)'));assert(shader.vertexShader.includes('smoothstep(450.0,455.0,vTreeDistance)'));
    if(m.customDepthMaterial){const d={uniforms:{},vertexShader:THREE.ShaderLib.depth.vertexShader,fragmentShader:THREE.ShaderLib.depth.fragmentShader};m.customDepthMaterial.onBeforeCompile(d);assert(d.vertexShader.includes('aKzPhase*6.283185'));}
  }
  view.dispose();
});
test('optional loader is local, fails open, v0.1–0.5 are treeless and trees=0 disables rendering', async () => {
  const f=fixture({width:2,height:2});
  for(let v=1;v<=5;v++) { const meta={...f.meta,schema:`kz-world-web/0.${v}`}; const d=decodeData(meta,f.heights.buffer,f.walk.buffer);assert.equal(d.veg,null); }
  const meta={...f.meta,schema:'kz-world-web/0.6',veg:{file:'veg_f32.bin',info:'veg.json',count:1}};
  const calls=[];
  const fetcher=async url=>{calls.push(url); return {ok:true,json:async()=>url.endsWith('meta.json')?meta:info(1),arrayBuffer:async()=>url.endsWith('height_u16.bin')?f.heights.buffer:url.endsWith('walk_u8.bin')?f.walk.buffer:bin([row()])};};
  assert.equal((await loadKamakura(fetcher)).veg.length,1);assert(calls.every(u=>u.startsWith('/world-private/')));
  meta.veg.file='https://invalid.example/veg.bin';calls.length=0;
  const d=await loadKamakura(fetcher);assert.equal(d.veg,null);assert(d.vegNotice);assert(!calls.some(u=>u.includes('https:')));
  meta.veg.file='veg_f32.bin';meta.veg.count=2;assert.equal((await loadKamakura(fetcher)).veg,null);
  assert(!treesEnabled('?trees=0'));assert(treesEnabled(''));
  const world=fs.readFileSync(new URL('../dist/valley/world-kamakura.js',import.meta.url),'utf8');
  assert(world.includes('data.veg && treesEnabled(search)'));assert(world.includes('stepWind(windState, dt, { paused })'));assert(world.includes('extraCircles: trees?.circles || []'));
});
test('foliage gain multiplies the leaf colour of every level and leaves the trunks alone', () => {
  const prepared=prepareVeg(decode([row({0:48,1:0,6:2}),row({0:150,1:0,6:6}),row({0:10,1:0,6:4})]),terrain),gain=[2,1.5,.5];
  const read=view=>{const out=[],c=new THREE.Color();view.update({position:{x:0,z:0}});
    for(const [key,set] of view.sets)for(const [part,mesh] of [['leaf',set.leaf],['wood',set.wood]])if(mesh)for(let i=0;i<mesh.count;i++){mesh.getColorAt(i,c);out.push([key,part,c.r,c.g,c.b]);}
    view.dispose();return out;};
  const plain=read(buildKamakuraVeg(prepared,{wind,sunDir:new THREE.Vector3(1,1,1)})),lit=read(buildKamakuraVeg(prepared,{wind,sunDir:new THREE.Vector3(1,1,1),foliage:gain}));
  assert.equal(plain.length,lit.length);assert(plain.some(p=>p[1]==='leaf')&&plain.some(p=>p[1]==='wood'));
  for(let i=0;i<plain.length;i++){
    assert.deepEqual(plain[i].slice(0,2),lit[i].slice(0,2));
    for(let k=0;k<3;k++)assert(Math.abs(lit[i][2+k]-plain[i][2+k]*(plain[i][1]==='leaf'?gain[k]:1))<1e-6,`${plain[i][0]} ${plain[i][1]} channel ${k}`);
  }
  assert.deepEqual(read(buildKamakuraVeg(prepared,{wind,sunDir:new THREE.Vector3(1,1,1),foliage:null})),plain);
});
test('real bundled Three view: generation, overlapping LOD, height/lean/phase, eviction, exact disposal and recreation (no GPU)', () => {
  const prepared=prepareVeg(decode([row({0:48,1:0,6:2}),row({0:150,1:0,6:6}),row({0:10,1:0,6:4})]),terrain);
  for(const renderer of [null,stubRenderer(),stubRenderer({fail:true})]) {
    const scene=new THREE.Scene(), view=buildKamakuraVeg(prepared,{wind,sunDir:new THREE.Vector3(1,1,1),renderer});scene.add(view.group);
    const stats=view.update({position:{x:0,z:0}}); assert.deepEqual(stats.counts,[2,3,1]);assert(stats.triangles>0);
    for(const level of [0,1]) {const set=view.sets.get(`0/3/${level}`),m=new THREE.Matrix4();set.leaf.getMatrixAt(0,m); assert.equal(m.elements[13],10);assert(Math.abs(new THREE.Vector3().setFromMatrixScale(m).y-.6)<1e-6);assert.equal(set.leaf.geometry.attributes.aKzPhase.array[0],.25);}
    assert.equal(view.update({position:{x:1,z:0}}),stats);
    view.update({position:{x:10000,z:0}});assert([...view.sets.values()].every(s=>s.leaf.count===0));
    const owned=new Set(), releases=new Map();
    const watch=o=>{if(!o||owned.has(o))return;owned.add(o);o.addEventListener('dispose',()=>releases.set(o,(releases.get(o)||0)+1));};
    for(const set of view.sets.values())for(const m of [set.leaf,set.wood])if(m){watch(m);watch(m.geometry);watch(m.material);watch(m.customDepthMaterial);watch(m.material.map);}
    view.dispose();view.dispose();assert.equal(scene.children.length,0);for(const o of owned)assert.equal(releases.get(o),1);
    const second=buildKamakuraVeg(prepared,{wind,sunDir:new THREE.Vector3(1,1,1),quality:'light'});assert(second.update({position:{x:0,z:0}}).triangles>0);second.dispose();
  }
});
test('private v0.6 vegetation count contract, filtering, inside A, colliders and bounded spawn selection', {skip:!process.env.KZ_WORLD_DIR && 'KZ_WORLD_DIR未設定：私有の植生データが必要'}, async t=>{
  const {data}=await readPrivateData(process.env.KZ_WORLD_DIR);
  if(!data.meta.veg){t.skip('meta.veg が無い旧形式のため省略');return;}
  const report=await verifyVeg(data,process.env.KZ_WORLD_DIR,await readPrivateHouses(process.env.KZ_WORLD_DIR,data));
  console.log(JSON.stringify({vegetation:report})); assert(report.used>0);assert(report.circles>0);
});

test('runtime far-tree cutoff is immediate, reversible and reuses the same sets/materials (Node, no GPU)', () => {
  for(const quality of ['standard','light']) {
    const far=vegPolicy(quality).range*.85;
    const p=prepareVeg(decode([row({0:far,1:0}),row({0:10,1:0})]),terrain);
    const view=buildKamakuraVeg(p,{wind,sunDir:new THREE.Vector3(1,1,1),quality,renderer:stubRenderer()});
    const camera={position:{x:0,y:20,z:0}}, identities=[...view.sets.values()].map(s=>[s.leaf,s.wood,s.leaf.geometry,s.leaf.material]);
    view.update(camera); const full=[...view.sets.entries()].filter(([k])=>k.endsWith('/2')).reduce((n,[,s])=>n+s.leaf.count,0); assert(full>0);
    for(let i=0;i<4;i++) {
      view.setAdapt({impostorRange:.7});view.update(camera);assert.equal([...view.sets.entries()].filter(([k])=>k.endsWith('/2')).reduce((n,[,s])=>n+s.leaf.count,0),0);
      view.setAdapt({impostorRange:1});view.update(camera);assert.equal([...view.sets.entries()].filter(([k])=>k.endsWith('/2')).reduce((n,[,s])=>n+s.leaf.count,0),full);
      assert.deepEqual([...view.sets.values()].map(s=>[s.leaf,s.wood,s.leaf.geometry,s.leaf.material]),identities);
    }
    view.dispose();
  }
});

test('a map may widen the single-tree range and the far capacity; without it the policy is the default, and bad values are refused', () => {
  const L = VEG_POLICY_LIMITS, plain = { standard: vegPolicy('standard'), light: vegPolicy('light') };
  try {
    assert.equal(configureVegPolicy(null), null); assert.deepEqual(vegPolicy('standard'), plain.standard);
    configureVegPolicy({ range: 1500, far: 40000 });
    const wide = vegPolicy('standard'), light = vegPolicy('light');
    assert.equal(wide.range, 1500); assert.deepEqual(wide.capacities, [plain.standard.capacities[0], plain.standard.capacities[1], 40000]);
    assert.deepEqual(wide.lod, plain.standard.lod); assert.equal(wide.blend, plain.standard.blend);   // the near levels do not move
    assert.equal(light.range, 1500 * L.light.range); assert.equal(light.capacities[2], Math.round(40000 * L.light.far));
    assert(light.range >= plain.light.range && light.capacities[2] >= plain.light.capacities[2]);
    // The lower bounds equal the defaults: an override can only widen.
    configureVegPolicy({ range: L.range[0], far: L.far[0] }); assert.deepEqual(vegPolicy('standard'), plain.standard);
    for (const bad of [{ range: 100, far: 40000 }, { range: 5000, far: 40000 }, { range: 1500, far: 10 }, { range: 1500, far: 1e6 }, { range: '1500', far: 40000 }, { range: 1500, far: 40000.5 }, { range: NaN, far: 40000 }, [1500, 40000], 'wide'])
      assert.throws(() => configureVegPolicy(bad), /木の範囲/);
  } finally { configureVegPolicy(null); }
  assert.deepEqual(vegPolicy('standard'), plain.standard); assert.deepEqual(vegPolicy('light'), plain.light);
});
