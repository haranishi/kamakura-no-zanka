import test from 'node:test';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import { RUIN_HALL as C, prepareRuinHall, ruinHallGeometry, ruinLocal, ruinWorld } from '../dist/valley/kamakura-ruin-hall.js';
import { enclosingBuddhaHalls, buddhaHallMode, facilityRange } from '../dist/valley/kamakura-facilities.js';
import { buildColliders, moveActor } from '../dist/valley/collision.js';
import { createPropSite } from '../dist/valley/kamakura-props.js';
import { vegExclusions } from '../dist/valley/kamakura-veg.js';
import { THREE, loadFacilityView } from './helpers/kamakura-facility-view.mjs';
import { createKamakuraRuinHall } from '../dist/valley/kamakura-ruin-hall-view.js';
import { box, makeGlb } from '../tools/lib/synthetic-glb.mjs';
import { syntheticWorld } from '../tools/make-synthetic-world.mjs';
import { readPrivateData } from '../tools/lib/kamakura-validation.mjs';
import { readPrivateFacilities } from '../tools/lib/kamakura-facility-validation.mjs';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
const bounds={minX:-1000,maxX:1000,minZ:-1000,maxZ:1000};
const terrain={bounds,heightAt:()=>4,waterAt:()=>0,slopeAt:()=>0,walkable:()=>true,insideA:()=>true};
const hall={x:0,z:0,w:40,d:32,height:18,rotY:0,minY:4,maxY:22};
function fixture({noBuddha=false,noEnclosure=false}={}) {
  const definitions=[['outer','hall',box(0,0,0,60,22,50),0,0],['inner','hall',box(0,0,0,40,18,32),0,0],['other','hall',box(0,0,0,12,10,12),110,0],['gate','gate',box(0,0,0,8,5,2),0,40]];
  if(!noBuddha)definitions.push(['bronze','buddha',box(0,0,0,6,10,4),noEnclosure?200:0,0]);
  const kit=makeGlb(definitions.map(([name,,geometry])=>({name,parts:[{geometry}]})));
  return {nodes:definitions.map(([node,part,g,x,z])=>({node,part,anchor_xz:[x,z],soft:false,rel_anchor:0,triangles:g.positions.length/9})),kit:kit.buffer.slice(kit.byteOffset,kit.byteOffset+kit.byteLength)};
}
test('minimum enclosing rotated hall uses geometry; unmatched and hall mode leave it alone',()=>{
  const record=(part,bounds)=>({node:{part},bounds});
  const large=record('hall',{...hall,w:60,d:60}),small=record('hall',{...hall,rotY:.6}),buddha=record('buddha',{x:0,z:0});
  assert.deepEqual(enclosingBuddhaHalls([large,small,buddha]),[small]);
  assert.deepEqual(enclosingBuddhaHalls([large,record('buddha',{x:200,z:0})]),[]);
  assert.equal(buddhaHallMode('?buddha=hall'),true);assert.equal(buddhaHallMode(''),false);
});
test('only enclosing hall becomes a low platform; collision, trees, grass and prop interior follow the change',async()=>{
  const {buildKamakuraFacilities}=await loadFacilityView(),data=fixture();
  const field=await buildKamakuraFacilities(data,terrain,new THREE.Scene(),'standard',{search:'?ftex=0'});
  assert.equal(field.ruinHalls.length,1);
  const base=field.records.find(r=>r.node.node==='inner');assert.equal(base.node.part,'platform');assert.equal(base.meshes.length,0);assert.equal(base.bounds.height,C.baseHeight);
  assert(field.records.find(r=>r.node.node==='outer').meshes.length);assert(field.records.find(r=>r.node.node==='other').meshes.length);
  assert(!field.boxes.some(b=>b.id==='inner'));assert(field.boxes.some(b=>b.id==='bronze'));
  assert(field.exclusionBoxes.some(b=>b.id==='inner'&&b.height===C.baseHeight));
  // The isolated platform suppresses tree/grass footprints but permits ordinary interior props.
  assert.equal(vegExclusions(terrain,{boxes:[base.bounds]})({x:8,z:5}),'house');
  const site=createPropSite({data:{facilities:{nodes:[base.node]}},terrain,facilities:{records:[base]}});
  assert.equal(site.reason({x:8,z:5,kind:'yard'}),null);
  field.dispose();
  for(const option of [{noBuddha:true},{noEnclosure:true}]){
    const f=await buildKamakuraFacilities(fixture(option),terrain,new THREE.Scene(),'standard',{search:'?ftex=0'});
    assert.equal(f.ruinHalls.length,0);assert(f.records.filter(r=>r.node.part==='hall').every(r=>r.meshes.length));f.dispose();
  }
});
test('hall flag retains all original meshes, solid boxes and exclusions and creates no ruin layer',async()=>{
  const {buildKamakuraFacilities}=await loadFacilityView(),data=fixture(),scene=new THREE.Scene();
  const f=await buildKamakuraFacilities(data,terrain,scene,'standard',{search:'?buddha=hall&ftex=0&debug=1'});
  assert.equal(f.ruinHalls.length,0);assert.equal(f.records.length,data.nodes.length);assert.equal(f.boxes.length,4);assert.equal(f.exclusionBoxes.length,4);
  assert(f.records.every(r=>r.meshes.length));assert.equal(globalThis.__kzRuinHall().mode,'hall');
  assert.equal(createKamakuraRuinHall({search:'?buddha=hall',facilities:f}),null);f.dispose();assert.equal(globalThis.__kzRuinHall,undefined);
});
test('deterministic surviving grid, leaning angles, connected and dropped beams and clear approach in rotated halls',()=>{
  for(const angle of [0,.53,-1.4,Math.PI]){
    const b={...hall,rotY:angle},front=ruinWorld(b,0,80),plan=prepareRuinHall(b,terrain,[front]);
    assert.deepEqual(plan,prepareRuinHall(b,terrain,[front]));
    assert(plan.posts.length>=C.minPosts&&plan.posts.length<=C.maxPosts);assert(Math.abs(plan.posts.length/plan.sites.length-C.fraction)<.15);
    assert.equal(plan.posts.filter(p=>p.lean>0).length,C.leaning);
    for(const p of plan.posts){assert(Math.abs(p.u)<=plan.box.w/2);assert(Math.abs(p.v)<=plan.box.d/2);assert(p.h>=hall.height*C.eaveRatio*C.minHeight&&p.h<=hall.height*C.eaveRatio);if(p.lean)assert(p.lean>=C.leanMin*Math.PI/180&&p.lean<=C.leanMax*Math.PI/180);}
    assert(plan.beams.length>=4&&plan.beams.length<=7);assert.equal(plan.beams.filter(p=>p.dropped).length,C.dropped);
    const col=buildColliders({bounds,extraCircles:plan.circles,extraBoxes:plan.boxes});
    for(const lateral of [-1,0,1]){
      const start=ruinWorld(plan.box,lateral,plan.box.d/2+5),end=ruinWorld(plan.box,lateral,3);
      const moved=moveActor(col,terrain,{...start,y:4},end.x-start.x,end.z-start.z,.3);
      assert.notEqual(moved.blocked,'wall');assert(Math.hypot(moved.x-end.x,moved.z-end.z)<1e-5);
    }
    for(const point of plan.circles){const [u,v]=ruinLocal(plan.box,point.x,point.z);assert(v<0||Math.abs(u)-point.r>=C.frontClear/2);}
  }
});
test('merged detail <=9000 and frame <=600 triangles, every category finite and caps face outwards',t=>{
  const plan=prepareRuinHall(hall,terrain),full=ruinHallGeometry(plan),far=ruinHallGeometry(plan,true);
  assert(full.triangles<=9000);assert(far.triangles<=600);assert(full.positions.every(Number.isFinite));
  assert.deepEqual(new Set(far.kinds),new Set(['post','beam']));
  for(const k of ['post','beam','pile','bark','repair','rope','base','soil'])assert(full.kinds.includes(k));
  // An isolated base box has upward-facing top caps and downward-facing bottom caps.
  const g=ruinHallGeometry({items:[{shape:'block',kind:'base',u:0,v:0,y:0,w:2,d:2,h:1}]});
  let up=0,down=0;
  for(let i=0;i<g.positions.length;i+=9){const p=g.positions;if(p[i+1]!==p[i+4]||p[i+4]!==p[i+7])continue;const ny=(p[i+5]-p[i+2])*(p[i+6]-p[i])-(p[i+3]-p[i])*(p[i+8]-p[i+2]);if(p[i+1]===1){assert(ny>0);up++;}else{assert(ny<0);down++;}}
  assert.equal(up,2);assert.equal(down,2);t.diagnostic(JSON.stringify({detailTriangles:full.triangles,farTriangles:far.triangles,draws:1,posts:plan.posts.length,beams:plan.beams.length,piles:plan.piles.length}));
});
test('view ranges, debug pigment, quality, no frame allocations and exact once disposal',()=>{
  const plan=prepareRuinHall(hall,terrain),scene=new THREE.Scene(),colliders=buildColliders({bounds});
  const layer=createKamakuraRuinHall({scene,terrain,colliders,facilities:{ruinHalls:[plan]},search:'?debug=1&ruinhalldebug=1'});
  const group=scene.children[0],frame={pos:{x:0,y:5,z:30},flying:false};layer.update(frame);
  assert.equal(globalThis.__kzRuinHall().mode,'open');assert.equal(globalThis.__kzRuinHall().draws,1);assert.equal(group.children[0].visible,true);
  assert.equal(group.children[0].material.fog,false);assert(group.children[0].material.isMeshBasicMaterial);
  const versions=group.children.map(m=>[m.geometry.attributes.position.version,m.geometry.attributes.color.version]);
  const originalPush=Array.prototype.push,originalMap=Array.prototype.map,originalSet=THREE.BufferGeometry.prototype.setAttribute;
  try {
    Array.prototype.push=()=>{throw Error('update pushed an array');};Array.prototype.map=()=>{throw Error('update allocated an array');};THREE.BufferGeometry.prototype.setAttribute=()=>{throw Error('update allocated an attribute');};
    for(let i=0;i<1000;i++)layer.update(frame);
  }finally{Array.prototype.push=originalPush;Array.prototype.map=originalMap;THREE.BufferGeometry.prototype.setAttribute=originalSet;}
  assert.deepEqual(group.children.map(m=>[m.geometry.attributes.position.version,m.geometry.attributes.color.version]),versions);
  frame.flying=true;frame.pos.y=700;layer.update(frame);assert.equal(group.children[0].visible,false);assert.equal(group.children[1].visible,true);
  frame.pos.y=10000;layer.update(frame);assert.equal(globalThis.__kzRuinHall().draws,0);
  frame.flying=false;frame.pos.y=4;frame.pos.z=facilityRange({part:'buddha'})+hall.d;layer.update(frame);assert.equal(globalThis.__kzRuinHall().draws,0);
  frame.pos.z=180;layer.setAdapt(3);layer.update(frame);assert(group.children[1].visible);assert(group.children.every(m=>!m.castShadow));
  const resources=new Set([...group.children.map(m=>m.geometry),group.children[0].material]),released=new Map();for(const r of resources)r.addEventListener('dispose',()=>released.set(r,(released.get(r)||0)+1));
  layer.dispose();layer.dispose();assert.equal(scene.children.length,0);assert.equal(colliders.circles.length,0);assert.equal(colliders.boxes.length,0);assert.equal(colliders.grid.size,0);assert.equal(globalThis.__kzRuinHall,undefined);assert([...resources].every(r=>released.get(r)===1));
  const lightScene=new THREE.Scene(),light=createKamakuraRuinHall({scene:lightScene,terrain,quality:'light',facilities:{ruinHalls:[plan]},search:''});frame.pos.z=C.lightDistance+1;light.update(frame);assert(lightScene.children[0].children[1].visible);light.dispose();
});
test('steady update source contains no allocating expressions and collision objects survive while culled',()=>{
  const source=fs.readFileSync(new URL('../dist/valley/kamakura-ruin-hall-view.js',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('    update(frame){'),source.indexOf('    setAdapt(next)'));
  for(const bad of [/\bnew\s/,/=>/,/\.(?:map|filter|slice|concat)\(/,/facilityVisible\(\{/])assert(!bad.test(body),String(bad));
  const scene=new THREE.Scene(),col=buildColliders({bounds}),plan=prepareRuinHall(hall,terrain);
  const layer=createKamakuraRuinHall({scene,terrain,colliders:col,facilities:{ruinHalls:[plan]},search:''});
  assert.equal(col.circles.length,plan.posts.length);assert.equal(col.boxes.length,plan.boxes.length);
  layer.update({pos:{x:0,y:10000,z:0},flying:true});assert.equal(col.circles.length,plan.posts.length);layer.dispose();
});
test('synthetic CI world includes enclosing hall and Buddha, is deterministic and under 8MB',async t=>{
  const a=syntheticWorld(),b=syntheticWorld();for(const [name,bytes] of a)assert.deepEqual(bytes,b.get(name));
  const bytes=[...a.values()].reduce((sum,v)=>sum+v.length,0);assert(bytes<8*1024*1024);
  const catalog=JSON.parse(a.get('facilities.json')),kit=a.get('facilities.glb');assert(catalog.nodes.some(n=>n.part==='buddha'));
  const {buildKamakuraFacilities}=await loadFacilityView();const f=await buildKamakuraFacilities({nodes:catalog.nodes,kit:kit.buffer.slice(kit.byteOffset,kit.byteOffset+kit.byteLength)},terrain,new THREE.Scene(),'standard',{search:'?ftex=0'});
  assert.equal(f.ruinHalls.length,1);assert(f.records.some(r=>r.node.part==='buddha'));f.dispose();t.diagnostic(JSON.stringify({syntheticBytes:bytes}));
});
test('private world: one geometric enclosure, no exceptions, budgets and central route', {skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定'},async t=>{
  const {data}=await readPrivateData(process.env.KZ_WORLD_DIR),input=await readPrivateFacilities(process.env.KZ_WORLD_DIR,data);if(!input){t.skip('施設のない旧版');return;}
  const {buildKamakuraFacilities}=await loadFacilityView(),terrain=createKamakuraTerrain(data),scene=new THREE.Scene();
  const f=await buildKamakuraFacilities(input.facilities,terrain,scene,'standard',{search:'?ftex=0'});
  assert.equal(f.ruinHalls.length,1);
  for(const p of f.ruinHalls){assert(ruinHallGeometry(p).triangles<=9000);assert(ruinHallGeometry(p,true).triangles<=600);assert(p.posts.every(s=>Math.abs(s.u)<=p.box.w/2&&Math.abs(s.v)<=p.box.d/2));}
  const p=f.ruinHalls[0],col=buildColliders({bounds:terrain.bounds,extraBoxes:f.boxes});
  const layer=createKamakuraRuinHall({scene,terrain,colliders:col,facilities:f,search:''});
  const bronze=f.records.find(r=>r.node.part==='buddha'),at=ruinLocal(p.box,bronze.bounds.x,bronze.bounds.z);
  const endV=at[1]+Math.hypot(bronze.bounds.w,bronze.bounds.d)/2+1;
  const flat={...terrain,heightAt:()=>0,waterAt:()=>0,slopeAt:()=>0,walkable:()=>true,insideA:()=>true};
  for(const offset of [-1,0,1]){
    const start=ruinWorld(p.box,offset,p.box.d/2+2),end=ruinWorld(p.box,offset,endV);
    const result=moveActor(col,flat,{...start,y:0},end.x-start.x,end.z-start.z,.3);
    assert.notEqual(result.blocked,'wall','clear approach is blocked');
  }
  layer.dispose();assert.equal(col.boxes.length,f.boxes.length);assert.equal(col.circles.length,0);
  t.diagnostic(JSON.stringify({detailTriangles:ruinHallGeometry(p).triangles,farTriangles:ruinHallGeometry(p,true).triangles,draws:1,survivalRatio:p.posts.length/p.sites.length}));f.dispose();
});

test('hall flag: every other facility is built exactly as in a world without a Buddha (the untouched path), at every distance',async()=>{
  // The first version of this test compared against `git show HEAD:` and so only held before the change was committed.
  // The invariant that survives: with &buddha=hall nothing but the Buddha itself differs from a world that has no Buddha at all,
  // where the open-air code has nothing to act on.
  const current=await loadFacilityView();
  const snapshot=field=>field.records.filter(r=>r.node.part!=='buddha').map(r=>({bounds:r.bounds,part:r.node.part,meshes:r.meshes.map(m=>({p:m.geometry.attributes.position.array,n:m.geometry.attributes.normal?.array,matrix:m.matrix.elements,visible:m.visible,shadow:m.castShadow,color:m.material.color.toArray()}))}));
  for(const quality of ['standard','light'])for(const textured of [false,true]){
    const plain=await current.buildKamakuraFacilities(fixture({noBuddha:true}),terrain,new THREE.Scene(),quality,{search:textured?'':'?ftex=0'});
    const hall=await current.buildKamakuraFacilities(fixture(),terrain,new THREE.Scene(),quality,{search:textured?'?buddha=hall':'?buddha=hall&ftex=0'});
    assert.equal(hall.ruinHalls.length,0);assert.equal(plain.ruinHalls.length,0);
    const withoutBronze=boxes=>boxes.filter(b=>b.id!=='bronze');
    assert.deepEqual(withoutBronze(hall.boxes),plain.boxes);assert.deepEqual(withoutBronze(hall.exclusionBoxes),plain.exclusionBoxes);
    for(const flying of [false,true])for(const z of [30,1000,4000,9000]){
      const pos={x:0,y:flying?700:4,z};plain.update(pos,flying);hall.update(pos,flying);assert.deepEqual(snapshot(hall),snapshot(plain));
    }
    plain.dispose();hall.dispose();
  }
});
