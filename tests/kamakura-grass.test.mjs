// CPU tests with shipped Three. Canvas is a double; no GPU rendering or browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrassCell, createGrassWindows, grassExclusions, grassEnabled, grassFrameBudget, grassEdge } from '../dist/valley/kamakura-grass-field.js';
import { SHORT, TALL, FERN, SUSUKI, nearTile, midTile, tilesAround } from '../dist/valley/grass-field.js';
import { buildColliders, addColliderCircles } from '../dist/valley/collision.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { load, THREE, source } from './helpers/tree-modules.mjs';
const flat = () => ({ heightAt: (x,z) => 10 + x*.01 + z*.02, slopeAt: () => 2, waterAt: () => 0, walkable: () => true, riverDistanceAt: () => Infinity });
const cell = (code = 2, terrain = flat(), options = {}) => createGrassCell(terrain,{surfaceCodeAt:()=>code,...options});
const finish = w => { w.work(()=>0); const f=w.commit(); assert(f); return f; };
const at = (f,x,z) => (z-f.z0)*f.nx+x-f.x0;
const bounds = {minX:-1000,maxX:1000,minZ:-1000,maxZ:1000};
test('world metre cells repeat; overlapping windows reuse exact raw values and corner heights',()=>{
  let evaluations=0; const evaluate=cell(),w=createGrassWindows((x,z)=>{evaluations++;return evaluate(x,z);});
  assert.deepEqual(evaluate(-12,7),evaluate(-12,7));
  w.plan({x:0,z:0});const a=finish(w);assert.equal(evaluations,9216);
  assert(!w.plan({x:23.99,z:0}));assert(w.plan({x:24,z:0}));const b=finish(w);
  assert.deepEqual(b.stats,{evaluated:2304,reused:6912});assert.equal(evaluations,11520);
  for(let z=-48;z<48;z++)for(let x=-24;x<48;x++) {
    const ai=at(a,x,z),bi=at(b,x,z);
    for(const key of ['rawDensity','rawMidPatch','species','height'])assert.equal(a[key][ai],b[key][bi]);
    if(grassEdge(a,x,z)===1&&grassEdge(b,x,z)===1)for(const key of ['placeable','density','midPatch'])assert.equal(a[key][ai],b[key][bi]);
  }
  const cold=createGrassWindows(evaluate);cold.plan({x:24,z:0});const c=finish(cold);
  for(const key of ['density','midPatch','species','height','heights','placeable'])assert.deepEqual(b[key],c[key]);
  w.plan({x:1000,z:-1000});assert.equal(finish(w).stats.evaluated,9216);
});
test('classes determine density/species; rice, wet sand, rock, gravel and unknown never get blades',()=>{
  const grass=cell()(7,9);assert([SHORT,TALL].includes(grass.species));assert(grass.density>0);
  for(const [code,kind,factor] of [[3,FERN,.3],[0,SUSUKI,.15],[4,SHORT,.2]]){
    const c=cell(code)(7,9);assert.equal(c.species,kind);assert(Math.abs(c.density/grass.density-factor)<.015);assert(Math.abs(c.midPatch/grass.midPatch-factor)<1e-8);
  }
  for(const code of [1,5,6,7,255])assert.equal(cell(code)(7,9).placeable,0);
  const kinds=new Set();for(let x=0;x<200;x++)kinds.add(cell(2,{...flat(),riverDistanceAt:()=>12})(x,5).species);
  assert(kinds.has(FERN)&&kinds.has(SUSUKI));
});
test('excludes water, slope including corner gradients, non-walkable land and river banks',()=>{
  for(const terrain of [{...flat(),waterAt:()=>.4},{...flat(),walkable:()=>false},{...flat(),slopeAt:()=>32.1},{...flat(),heightAt:(x)=>x*2},{...flat(),riverDistanceAt:()=>1}])assert.equal(cell(2,terrain)(5,7).placeable,0);
  assert.equal(cell(2,{...flat(),slopeAt:()=>32})(5,7).placeable,1);
  assert.equal(cell(2,{...flat(),riverDistanceAt:()=>2})(5,7).placeable,1);
});
test('boxes (house/facility), rotated margins, paths and live trunk grid exclusions; the start point is not excluded',()=>{
  const col=buildColliders({bounds,extraBoxes:[{x:0,z:0,w:4,d:4,rotY:Math.PI/4},{x:20,z:0,w:4,d:4}],extraCircles:[{x:40,z:0,r:.5}]});
  // A start point may be passed by older callers; it must not carve a bare disc (real-Chrome finding 2026-11-07).
  const ex=grassExclusions(flat(),{colliders:col,paths:{road:{xyz_m:[[60,0,0],[60,-10,0]]}},spawn:{x:80,z:0}});
  for(const [x,z,reason] of [[0,0,'box'],[20,0,'box'],[22.4,0,'box'],[40,0,'trunk'],[62.5,5,'path'],[80,3,null],[80,0,null]])assert.equal(ex(x,z),reason);
  assert.equal(ex(25,0),null);assert.equal(ex(63.3,5),null);assert.equal(ex(80,3.8),null);
  // A box turned 45 degrees reaches sqrt(2) times its margin along the world axes; the 8 m collision grid registers it without margin.
  // This corner cell lies in the next grid cell (found in review): it must still be excluded.
  const turned=buildColliders({bounds,extraBoxes:[{x:5.11,z:.5,w:4,d:4,rotY:Math.PI/4}]}),exTurned=grassExclusions(flat(),{colliders:turned});
  assert.equal(exTurned(9.5,.5),'box');assert.equal(exTurned(9.7,.5),null);assert.equal(exTurned(5.11,.5),'box');
  const release=addColliderCircles(col,[{x:90,z:0,r:1}]);assert.equal(ex(90,0),'trunk');release();assert.equal(ex(90,0),null);
  assert.equal(cell(2,flat(),{exclude:ex})(20,0).placeable,0);
});
test('time budget splits all work, old field stays committed until ready; edges fade both LODs',()=>{
  const w=createGrassWindows(cell());w.plan({x:0,z:0});assert.equal(w.commit(),null);
  let tick=0;assert.equal(w.work(()=>++tick,2),2);assert.equal(w.field,null);const f=finish(w);
  w.plan({x:24,z:0});tick=0;w.work(()=>++tick,1.5);assert.equal(w.field,f);assert.equal(w.commit(),null);
  const pending=w.pending;assert(!w.plan({x:100,z:0}));assert.equal(w.pending,pending);finish(w);
  assert.equal(grassEdge(f,-48,0),0);assert(grassEdge(f,-45,0)>0&&grassEdge(f,-45,0)<1);assert.equal(grassEdge(f,-42,0),1);
  assert.equal(f.density[at(f,-48,0)],0);assert.equal(f.midPatch[at(f,-48,0)],0);
  assert.equal(grassFrameBudget('standard'),2);assert.equal(grassFrameBudget('light'),1.5);
  w.plan({x:500,z:0});w.cancel();assert.equal(w.commit(),null);
  assert.throws(()=>w.plan({x:NaN,z:0}),RangeError);
});
test('valley field contract works for near/mid sampling and both quality levels',()=>{
  const w=createGrassWindows(cell());w.plan({x:-5,z:7});const f=finish(w);
  for(const quality of ['standard','light']){
    const tiles=tilesAround(f,0,0,{quality});assert(tiles.near.length&&tiles.mid.length);
    for(const [kind,make]of [['near',nearTile],['mid',midTile]])for(const t of tiles[kind]){
      const d=make(f,t.tx,t.tz,{quality});assert(d.count>=0);assert(d.y.every(Number.isFinite));
    }
  }
});
// Only card-atlas drawing is substituted, as in the existing valley grass tests.
globalThis.document={createElement(){const c={width:0,height:0,getContext:()=>({createLinearGradient:()=>({addColorStop(){}}),beginPath(){},moveTo(){},quadraticCurveTo(){},fill(){},getImageData:()=>({data:new Uint8ClampedArray(c.width*c.height*4)})})};return c;}};
const {buildKamakuraGrass}=await load('kamakura-grass-view.js');
const wind={uTime:{value:0},uWind:{value:1},uWindDir:{value:new THREE.Vector2(1,0)},uGuideMix:{value:0}};
const camera=x=>({position:new THREE.Vector3(x,12,0)});
function view(code=2,search='',quality='standard') {
  const data=fixture();data.meta.surface={};data.surface=new Uint8Array(data.meta.grid.width*data.meta.grid.height).fill(code);
  return buildKamakuraGrass({data,terrain:createKamakuraTerrain(data),search,quality,wind,sunDir:new THREE.Vector3(1,1,0)});
}
function settle(v,c) {for(let i=0;i<250;i++){v.update(c);if(!v.stats().pending&&v.stats().switches&&v.stats().queue===0)return;}assert.fail('grass did not settle');}
test('shipped Three CPU view streams, retains interior chunks, adapts without rebuilding and disposes each resource once',()=>{
  for(const quality of ['standard','light']){
    const v=view(2,'',quality);settle(v,camera(0));const before=v.stats();assert(before.nearBlades>0&&before.midCards>0);
    const allocated=new Map();const watch=()=>v.group.traverse(o=>{for(const r of [o.geometry,...[].concat(o.material||[]),o.material?.map].filter(Boolean))if(!allocated.has(r)){allocated.set(r,0);r.addEventListener('dispose',()=>allocated.set(r,allocated.get(r)+1));}});
    watch();const builds=before.builds;v.setAdapt(2);const reduced=v.stats();assert.equal(reduced.builds,builds);assert(reduced.nearBlades/before.nearBlades>.55&&reduced.nearBlades/before.nearBlades<.65);
    // Step 2 must thin by an independent hash: the card pattern and the far fade both read iShape.w.
    {const cards=new Set();let nearMaxW=0;v.group.traverse(o=>{if(!o.isMesh||!(o.geometry.instanceCount>0))return;const a=o.geometry.getAttribute('iShape').data.array;
      for(let i=0;i<o.geometry.instanceCount;i++){const w=a[i*15+7];if(o.material.alphaTest>0)cards.add(Math.floor(w*3.999));else nearMaxW=Math.max(nearMaxW,w);}});
      assert.deepEqual([...cards].sort(),[0,1,2,3]);assert(nearMaxW>.95,`near blades must keep the whole w range, max ${nearMaxW}`);}
    v.setAdapt(3);assert.equal(v.group.visible,false);const switches=v.stats().switches;v.update(camera(500));assert.equal(v.stats().switches,switches);
    v.setAdapt(0);assert.equal(v.stats().nearBlades,before.nearBlades);assert.equal(v.group.visible,true);
    const central=new Map();v.group.traverse(o=>{if(o.geometry?.instanceCount>0&&Math.abs(o.geometry.boundingSphere.center.x)<10&&Math.abs(o.geometry.boundingSphere.center.z)<10)central.set(o,o.geometry.getAttribute('iRoot').data.array.slice());});
    // Move the CPU window while holding the render camera, proving retained chunks remain exact.
    for(let i=0;i<200;i++){v.update(camera(0),{x:24,z:0});if(!v.stats().pending&&v.stats().switches>switches)break;}
    assert.equal(v.stats().switches,switches+1);for(const [o,a]of central)assert.deepEqual(o.geometry.getAttribute('iRoot').data.array,a);
    for(const x of [48,72,96,-72,0]){settle(v,camera(x));watch();}
    v.group.traverse(o=>{if(o.isMesh)assert(!o.castShadow&&o.receiveShadow);});
    v.dispose();v.dispose();v.update(camera(0));assert.equal(v.group.children.length,0);for(const n of allocated.values())assert.equal(n,1);
  }
});
test('grass=0, absent/invalid surface and paused views allocate no grass meshes',()=>{
  assert(!grassEnabled('?grass=0'));assert(grassEnabled(''));
  const off=view(2,'?grass=0');for(let i=0;i<20;i++)off.update(camera(0));assert(!off.enabled);assert.equal(off.group.children.length,0);off.dispose();
  const data=fixture();for(const surface of [undefined,new Uint8Array(1)]){
    data.surface=surface;const v=buildKamakuraGrass({data,terrain:flat()});v.update(camera(0));assert(!v.enabled);assert.equal(v.group.children.length,0);v.dispose();
  }
  const paused=view();paused.update(camera(0),{x:0,z:0},true);assert.equal(paused.stats().switches,0);paused.dispose();
});
test('composition uses shared wind/sun, flight position, pause, adaptive step and disposal',()=>{
  const s=source('world-kamakura.js');assert.match(s,/buildKamakuraGrass\(\{[^\n]*wind, sunDir: atmosphere.sunDir/);assert.match(s,/grass.update\(camera, flight.pos, paused\)/);assert.match(s,/grass\?\.setAdapt\(adapt.step\)/);assert.match(s,/grass\?\.dispose\(\)/);
});
test('private v0.9 window uses provided surface/height and reuses overlap (no private values emitted)',{skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定：私有v0.9地表データが必要'},async t=>{
  const {verifyPrivateGrass}=await import('../tools/lib/kamakura-grass-validation.mjs');
  const result=await verifyPrivateGrass(process.env.KZ_WORLD_DIR);if(result.skipped)return t.skip(result.skipped);
  assert.equal(result.newCells,2304);assert.equal(result.reusedCells,6912);
  assert(result.samples.grass.nearBlades>0);assert(result.samples.forest.nearBlades>0);
  t.diagnostic(JSON.stringify(result));
});
