import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareBurntHall,prepareRuinHall,ruinHallGeometry,ruinWorld,RUIN_HALL as C} from '../dist/valley/kamakura-ruin-hall.js';
import {decodeFacilities,ruinsEnabled,facilityRange} from '../dist/valley/kamakura-facilities.js';
import {dressPalette} from '../dist/valley/kamakura-town-dress-kit.js';
import {buildColliders,moveActor} from '../dist/valley/collision.js';
import {createKamakuraRuinHall} from '../dist/valley/kamakura-ruin-hall-view.js';
import {THREE,loadFacilityView} from './helpers/kamakura-facility-view.mjs';
import {box,makeGlb} from '../tools/lib/synthetic-glb.mjs';
const bounds={minX:-1000,maxX:1000,minZ:-1000,maxZ:1000},terrain={bounds,heightAt:()=>4,waterAt:()=>0,slopeAt:()=>0,walkable:()=>true};
const hall={x:0,z:0,w:40,d:32,height:18,rotY:0,minY:4,maxY:22};
function input(){
  const defs=[['burn','hall',40,32,18,0],['plain','hall',20,16,12,90],['buddha-hall','hall',30,26,16,-90],['bronze','buddha',6,4,10,-90]],nodes=[],parts={};
  const kit=makeGlb(defs.map(([node,part,w,d,h,x])=>{
    const geometry=box(0,0,0,w,h,d);parts[part]=(parts[part]||0)+1;
    nodes.push({node,part,facility:'synthetic',source:'synthetic',soft:false,status:null,triangles:geometry.positions.length/9,anchor_xz:[x,0],rel_anchor:0,bbox_min:[-w/2,-d/2,0],bbox_max:[w/2,d/2,h]});
    return {name:node,parts:[{geometry}]};
  }));nodes[0].ruin='burnt';
  const catalog={schema:'kz-facilities/0.1',kit:'facilities.glb',count:nodes.length,total_triangles:nodes.reduce((s,n)=>s+n.triangles,0),parts,nodes};
  return {...decodeFacilities(catalog),kit:kit.buffer.slice(kit.byteOffset,kit.byteOffset+kit.byteLength)};
}
test('burnt marker has a strict allowlist, only hall accepts it, absent markers decode unchanged',()=>{
  const f=input();assert.equal(f.nodes[0].ruin,'burnt');
  for(const value of [null,'fire',true,1,{},['burnt']]){const c=structuredClone(f.catalog);c.nodes[0].ruin=value;assert.throws(()=>decodeFacilities(c));}
  const bad=structuredClone(f.catalog);bad.nodes[3].ruin='burnt';assert.throws(()=>decodeFacilities(bad));
  const plain=structuredClone(f.catalog);delete plain.nodes[0].ruin;assert.deepEqual(decodeFacilities(plain).nodes,plain.nodes);
  assert(ruinsEnabled(''));assert(!ruinsEnabled('?ruins=0'));
});
test('only marked hall burns; boxes and prop hall removed, base excludes vegetation; flags independently restore halls',async()=>{
  const {buildKamakuraFacilities}=await loadFacilityView();
  for(const search of ['?ftex=0','?ftex=0&ruins=0','?ftex=0&buddha=hall','?ftex=0&ruins=0&buddha=hall']){
    const data=input(),scene=new THREE.Scene(),f=await buildKamakuraFacilities(data,terrain,scene,'standard',{search});
    const burnt=f.ruinHalls.filter(p=>p.burnt),open=f.ruinHalls.filter(p=>!p.burnt);
    assert.equal(burnt.length,search.includes('ruins=0')?0:1);assert.equal(open.length,search.includes('buddha=hall')?0:1);
    const burned=f.records.find(r=>r.node.node==='burn');assert.equal(burned.meshes.length===0,burnt.length===1);
    assert.equal(f.boxes.some(b=>b.id==='burn'),!burnt.length);assert(f.exclusionBoxes.some(b=>b.id==='burn'));
    if(burnt.length){assert.equal(burned.node.part,'platform');assert.equal(burned.bounds.height,C.baseHeight);}
    assert(f.records.find(r=>r.node.node==='plain').meshes.length);assert(f.records.find(r=>r.node.node==='bronze').meshes.length);
    const layer=createKamakuraRuinHall({scene,terrain,facilities:f,search:search+'&debug=1'});
    if(f.ruinHalls.length){assert(layer);layer.update({pos:{x:0,y:4,z:0}});assert.equal(globalThis.__kzRuinHall().burnt,burnt.length);layer.dispose();}
    else assert.equal(layer,null);f.dispose();
  }
  const marked=input();marked.nodes[2].ruin='burnt';
  const f=await buildKamakuraFacilities(marked,terrain,new THREE.Scene(),'standard',{search:'?buddha=hall&ftex=0'});
  assert(f.records.find(r=>r.node.node==='buddha-hall').meshes.length,'Buddha hall flag still controls Buddha enclosure');f.dispose();
});
test('unmarked world is identical with ruins enabled or disabled, including geometry, boxes and open Buddha plan',async()=>{
  const {buildKamakuraFacilities}=await loadFacilityView(),data=input();delete data.nodes[0].ruin;
  const a=await buildKamakuraFacilities(data,terrain,new THREE.Scene(),'standard',{search:'?ftex=0'}),b=await buildKamakuraFacilities(data,terrain,new THREE.Scene(),'standard',{search:'?ftex=0&ruins=0'});
  const snapshot=f=>f.records.map(r=>({bounds:r.bounds,node:r.node,meshes:r.meshes.map(m=>({p:m.geometry.attributes.position.array,matrix:m.matrix.elements}))}));
  assert.deepEqual(snapshot(a),snapshot(b));assert.deepEqual(a.boxes,b.boxes);assert.deepEqual(a.exclusionBoxes,b.exclusionBoxes);assert.deepEqual(a.ruinHalls,b.ruinHalls);a.dispose();b.dispose();
});
test('burnt shapes: 30% posts, broken and leaning, inside footprint, grounded stones, route traversable end to end, bounded triangles',t=>{
  for(const [w,d,height] of [[40,32,18],[14,10,8],[80,64,28]])for(const rotY of [0,.5,-1.2]){
    const plan=prepareBurntHall({...hall,w,d,height,rotY},terrain);assert.deepEqual(plan,prepareBurntHall({...hall,w,d,height,rotY},terrain));
    assert(Math.abs(plan.posts.length/plan.sites.length-.3)<.035);assert(plan.posts.some(p=>p.lean>0));
    assert(plan.items.every(p=>['post','beam','base','ash','grass'].includes(p.kind)));
    assert(plan.beams.length>=4&&plan.beams.length<=8);assert(plan.items.some(p=>p.kind==='grass'));
    for(const p of plan.posts){assert(p.broken);assert(p.w>=.4&&p.w<=.5);assert(Math.abs(p.u)+p.w/2<w/2);assert(Math.abs(p.v+(p.dv||0))+p.w/2<d/2);assert(p.h>=height*C.eaveRatio*.3&&p.h<=height*C.eaveRatio*.9);assert.equal(p.y,4+C.stoneHeight);}
    for(const p of plan.items.filter(p=>p.kind==='base'))assert.equal(p.y,4);
    const col=buildColliders({bounds,extraCircles:plan.circles});assert.equal(col.boxes.length,0);
    for(const u of [-1,0,1]){const start=ruinWorld(plan.box,u,d/2+2),end=ruinWorld(plan.box,u,-d/2-2),moved=moveActor(col,terrain,{...start,y:4},end.x-start.x,end.z-start.z,.3);assert(Math.hypot(moved.x-end.x,moved.z-end.z)<1e-6);}
    const full=ruinHallGeometry(plan),far=ruinHallGeometry(plan,true);assert(full.triangles<=6000);assert(far.triangles<=400);assert(full.positions.every(Number.isFinite));
    for(const g of [full,far])for(let i=0;i<g.positions.length;i+=9){const p=g.positions,a=new THREE.Vector3(...p.slice(i,i+3)),b=new THREE.Vector3(...p.slice(i+3,i+6)),c=new THREE.Vector3(...p.slice(i+6,i+9));assert(b.sub(a).cross(c.sub(a)).length()>1e-7);}
    if(rotY===0)t.diagnostic(JSON.stringify({syntheticShape:[w,d],nearTriangles:full.triangles,farTriangles:far.triangles,draws:1,surviving:plan.posts.length/plan.sites.length}));
  }
});
test('burnt layer: derived nonblack charcoal, debug colours, no frame allocation, facility distance, <=6 draws and exact disposal',()=>{
  for(const debug of [false,true]){
    const plans=[prepareRuinHall(hall,terrain),...Array.from({length:8},(_,i)=>prepareBurntHall({...hall,x:i*70},terrain))],scene=new THREE.Scene(),col=buildColliders({bounds});
    const layer=createKamakuraRuinHall({scene,terrain,colliders:col,facilities:{ruinHalls:plans},search:'?debug=1'+(debug?'&ruinhalldebug=1':'')});
    const frame={pos:{x:0,y:4,z:0},flying:false};layer.update(frame);assert.equal(globalThis.__kzRuinHall().burnt,8);assert(globalThis.__kzRuinHall().draws<=6);
    const group=scene.children[0],g=group.children[2].geometry,p=ruinHallGeometry(plans[1]),palette=dressPalette();
    if(!debug){const index=p.kinds.indexOf('post');for(let k=0;k<3;k++){assert(g.attributes.color.array[index*3+k]>0);assert(Math.abs(g.attributes.color.array[index*3+k]-palette.char[k]*p.shades[index])<1e-6);}}
    const originalPush=Array.prototype.push,originalMap=Array.prototype.map,originalFilter=Array.prototype.filter,originalSet=THREE.BufferGeometry.prototype.setAttribute;
    try{Array.prototype.push=()=>{throw Error('push in update');};Array.prototype.map=()=>{throw Error('map in update');};Array.prototype.filter=()=>{throw Error('filter in update');};THREE.BufferGeometry.prototype.setAttribute=()=>{throw Error('new attribute');};for(let i=0;i<1000;i++)layer.update(frame);}
    finally{Array.prototype.push=originalPush;Array.prototype.map=originalMap;Array.prototype.filter=originalFilter;THREE.BufferGeometry.prototype.setAttribute=originalSet;}
    frame.flying=true;frame.pos.y=700;layer.update(frame);assert(group.children[3].visible);frame.pos.y=facilityRange({part:'hall'},'standard',0,true)+100;layer.update(frame);assert.equal(globalThis.__kzRuinHall().draws,0);
    const resources=new Set(group.children.flatMap(m=>[m.geometry,m.material])),counts=new Map();for(const r of resources)r.addEventListener('dispose',()=>counts.set(r,(counts.get(r)||0)+1));layer.dispose();layer.dispose();assert([...resources].every(r=>counts.get(r)===1));assert.equal(scene.children.length,0);assert.equal(col.circles.length,0);assert.equal(col.boxes.length,0);assert.equal(globalThis.__kzRuinHall,undefined);
  }
});

test('fallen beams meet the synthetic sloped ground at both ends instead of floating as horizontal stock',()=>{
  const slope={...terrain,heightAt:(x,z)=>4+x*.03+z*.02};
  const plan=prepareBurntHall({...hall,rotY:.7},slope);
  for(const p of plan.beams){
    assert.equal(p.shape,'beam');const a=ruinWorld(plan.box,p.u,p.v),b=ruinWorld(plan.box,p.end[0],p.end[2]);
    assert(Math.abs(p.y-slope.heightAt(a.x,a.z)-C.burntBeamWidth/2)<1e-7);
    assert(Math.abs(p.end[1]-slope.heightAt(b.x,b.z)-C.burntBeamWidth/2)<1e-7);
  }
});
