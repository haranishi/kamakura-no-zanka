import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { decodeFacilities, facilitiesEnabled, facilityPlacement, facilityVertexY, FACILITY_WALK_TOP, causewayShown, FACILITY_HELD_BACK, minimumRectangle, facilityFootprint, facilityGroundSamples, facilityRange, facilityVisible, facilitySolid } from '../dist/valley/kamakura-facilities.js';
import { loadKamakura } from '../dist/valley/kamakura-data.js';
import { vegExclusions, prepareVeg } from '../dist/valley/kamakura-veg.js';
import { prepareStands, generateStandChunk, standPolicy } from '../dist/valley/kamakura-stands.js';
import { buildColliders, moveActor } from '../dist/valley/collision.js';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { THREE, loadFacilityView } from './helpers/kamakura-facility-view.mjs';
import { buildGlb } from '../tools/lib/glb.mjs';
import { readPrivateData } from '../tools/lib/kamakura-validation.mjs';
import { readPrivateFacilities, verifyFacilities } from '../tools/lib/kamakura-facility-validation.mjs';
const near = (a,b,eps=1e-5) => assert(Math.abs(a-b)<eps, `${a} != ${b}`);
const node = (part='hall') => ({node:part,facility:'synthetic',part,soft:['stairs','fence','kairo','causeway','jetty','sando','platform'].includes(part),status:'test',source:'synthetic',triangles:4,anchor_xz:[10,20],rel_anchor:.5,bbox_min:[-1,-1,0],bbox_max:[1,1,3]});
const catalog = nodes => ({schema:'kz-facilities/0.1',kit:'facilities.glb',count:nodes.length,total_triangles:nodes.reduce((s,n)=>s+n.triangles,0),parts:nodes.reduce((s,n)=>({...s,[n.part]:(s[n.part]||0)+1}),{}),nodes});
// A base ring and overhanging eaves. All coordinates are synthetic.
const positions = [-1,0,-2, 1,0,-2, 1,0,2, -1,0,2, -4,3,-5, 4,3,5];
function kit(nodes, external=false) {
  const p=new Float32Array(positions),bin=Buffer.from(p.buffer);
  const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:nodes.map((_,i)=>i)}],nodes:nodes.map(n=>({name:n.node,mesh:0})),
    buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteLength:bin.length}],accessors:[{bufferView:0,componentType:5126,count:p.length/3,type:'VEC3',min:[-4,0,-5],max:[4,3,5]}],
    meshes:[{primitives:[{attributes:{POSITION:0},indices:1,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.3,.4,.2,1]}}]};
  // Four triangles, including sloping faces; normals must be recomputed after terrain deformation.
  const indices=new Uint16Array([0,1,2,0,2,3,0,4,3,1,5,2]);
  const combined=Buffer.concat([bin,Buffer.from(indices.buffer)]);json.buffers[0].byteLength=combined.length;
  json.bufferViews.push({buffer:0,byteOffset:bin.length,byteLength:indices.byteLength});
  json.accessors.push({bufferView:1,componentType:5123,count:indices.length,type:'SCALAR'});
  if(external)json.buffers[0].uri='https://invalid.example/private.bin';
  const glb=buildGlb({json,bin:combined});
  // buildGlb strips buffer URIs, so use an image URI to verify pre-loader rejection.
  if(external){json.images=[{uri:'https://invalid.example/image.png'}];return kitBuffer(buildGlb({json,bin:combined}));}
  return kitBuffer(glb);
}
const kitBuffer = b => b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
test('facility catalog rejects malformed schema, soft flags, numbers, duplicate names, counts and unsafe kit',()=>{
  const c=catalog([node(),{...node('stairs'),status:null}]);assert.equal(decodeFacilities(c).nodes.length,2);
  for(const mutate of [c=>c.schema='unknown',c=>c.count++,c=>c.total_triangles++,c=>c.parts.hall++,c=>c.kit='https://invalid.example/a',
    c=>c.nodes[0].soft=true,c=>c.nodes[0].anchor_xz[0]=NaN,c=>c.nodes[0].rel_anchor=Infinity,c=>c.nodes[0].part='unknown',c=>c.nodes[1].node='hall',c=>c.nodes[0].triangles=-1,c=>c.nodes[0].bbox_max=[]]) {
    const copy=structuredClone(c);mutate(copy);assert.throws(()=>decodeFacilities(copy));
  }
});
test('walking-surface parts (causeway, stairs, approach, platform) are pressed down to a thin paving; walls keep their height',()=>{
  const terrain={heightAt:()=>10};
  for(const part of ['causeway','stairs','sando','platform']) {
    const n=node(part),p=[0,3,0, 1,-2,0, 2,.05,0], placed=facilityPlacement(n,p,terrain);
    near(placed.positions[1],10+FACILITY_WALK_TOP);            // a 3m top is capped
    near(placed.positions[4],10-2);                            // the skirt below the ground is kept
    near(placed.positions[7],10+.05);                          // a top already thinner than the cap stays
    assert.equal(facilityVertexY(n,10,3),10+FACILITY_WALK_TOP);
  }
  for(const part of ['fence','kairo','jetty']) near(facilityPlacement(node(part),[0,3,0],terrain).positions[1],13);
});
test('rigid translation uses one anchor sample; soft placement samples each vertex at both vertical scales',()=>{
  for(const scale of [1,1.8]) {
    let calls=0;const terrain={heightAt:(x,z)=>{calls++;return scale*(2*x+z);}};
    const rigid=facilityPlacement(node(),positions,terrain);assert.equal(calls,1);near(rigid.position.y,40*scale+.5);
    assert.deepEqual([...rigid.positions],positions);assert(!rigid.rebuildNormals);
    calls=0;const soft=facilityPlacement(node('fence'),positions,terrain);assert.equal(calls,positions.length/3);assert(soft.rebuildNormals);
    for(let i=0;i<positions.length;i+=3){near(soft.positions[i+1],scale*(2*(10+positions[i])+20+positions[i+2])+positions[i+1]);near(soft.positions[i],positions[i]);near(soft.positions[i+2],positions[i+2]);}
    assert.equal(soft.position.y,0);assert.deepEqual(positions,[-1,0,-2,1,0,-2,1,0,2,-1,0,2,-4,3,-5,4,3,5]);
  }
});
test('minimum-area box follows rotated footprint and excludes projecting eaves; ground samples use rotated box',()=>{
  for(const angle of [0,.37,Math.PI/2,-1.1]) {
    const c=Math.cos(angle),s=Math.sin(angle),rotated=[];
    for(let i=0;i<positions.length;i+=3)rotated.push(c*positions[i]-s*positions[i+2],positions[i+1],s*positions[i]+c*positions[i+2]);
    const b=facilityFootprint(node(),rotated);near(b.w*b.d,8);near(b.x,10);near(b.z,20);
    const t={heightAt:(x,z)=>2*x+z},h=facilityGroundSamples(b,t);
    let min=Infinity,max=-Infinity;for(let i=0;i<12;i+=3){const y=t.heightAt(10+rotated[i],20+rotated[i+2]);min=Math.min(min,y);max=Math.max(max,y);}
    near(h.low,min);near(h.high,max);near(b.bottom,0);
  }
  assert.throws(()=>minimumRectangle([[0,0],[1,0]]));
});
test('type ranges, light quality, adaptive step 3 and long-wall distance bounds',()=>{
  for(const [part,range] of [['hall',3000],['romon',3000],['buddha',3000],['fence',900],['gate',1200],['nagayamon',1200],['stairs',1200],['torii',1200]]) {
    near(facilityRange(node(part)),range);near(facilityRange(node(part),'light'),range*.6);near(facilityRange(node(part),'light',3),range*.36);
    for(const quality of ['standard','light'])for(const step of [0,1,2,3]) {
      const r=facilityRange(node(part),quality,step),box={x:0,z:0,w:200,d:2,rotY:0};
      assert(facilityVisible(node(part),box,{x:r+99,z:0},quality,step));assert(!facilityVisible(node(part),box,{x:r+101,z:0},quality,step));
    }
  }
});
test('only hall/buddha footprints block swept moves; shared tree index excludes facilities plus 1m',()=>{
  const bounds={minX:-100,maxX:100,minZ:-100,maxZ:100},terrain={bounds,heightAt:()=>5,slopeAt:()=>0,waterAt:()=>0,insideA:()=>true};
  for(const part of ['hall','buddha','gate','romon','torii','fence','kairo','nagayamon','stairs']) {
    const n=node(part),box=facilityFootprint(n,positions),col=buildColliders({bounds,extraBoxes:facilitySolid(n)?[box]:[]});
    const p=moveActor(col,terrain,{x:10,y:5,z:30},0,-20,.3);
    assert.equal(p.blocked==='wall',facilitySolid(n));if(!facilitySolid(n))near(p.z,10);
  }
  const box=facilityFootprint(node(),positions),exclude=vegExclusions(terrain,{boxes:[box]});
  assert.equal(exclude({x:10,z:20}),'house');assert.equal(exclude({x:11.9,z:20}),'house');assert.equal(exclude({x:12.1,z:20}),null);
  const raw={id:1,x:10,z:20,tier:0,sourceSpecies:2,height:8,crown:2,variant:0,tint:0};
  assert.equal(prepareVeg([raw],terrain,{boxes:[box]}).active.length,0);
  const parent={...raw,tier:1,crown:12,tint:0,rank:0};
  const covering={...box,w:100,d:100},prepared=prepareStands([parent],terrain,{boxes:[covering]},standPolicy());
  const children=generateStandChunk(prepared,[...prepared.grid.keys()][0]);
  assert(children.records.length>0);assert.equal(children.active.length,0);assert.equal(children.excluded.house,children.records.length);
});
test('optional facility loading fixes URLs, preserves old versions and handles unavailable/invalid data',async()=>{
  const f=fixture(),c=catalog([node()]),calls=[];f.meta.schema='kz-world-web/0.8';f.meta.facilities={file:'facilities.json',kit:'facilities.glb',count:c.count,total_triangles:c.total_triangles};
  const fetcher=async(url,options)=>{calls.push(url);assert.equal(options.redirect,'error');return {ok:true,json:async()=>url.endsWith('meta.json')?f.meta:c,arrayBuffer:async()=>url.endsWith('height_u16.bin')?f.heights.buffer:url.endsWith('walk_u8.bin')?f.walk.buffer:kit(c.nodes)};};
  const data=await loadKamakura(fetcher);assert.equal(data.facilities.nodes.length,1);assert.equal(calls.length,5);
  const failed=await loadKamakura(async(url,o)=>url.endsWith('facilities.glb')?{ok:false}:fetcher(url,o));assert.equal(failed.facilities,null);assert(failed.facilityNotice);assert.equal(failed.heights.length,f.heights.length);
  f.meta.facilities.file='https://invalid.example/data';calls.length=0;assert.equal((await loadKamakura(fetcher)).facilities,null);assert.equal(calls.length,3);
  delete f.meta.facilities;
  for(const version of [1,2,3,4,5,6,7]){f.meta.schema=`kz-world-web/0.${version}`;assert(!(await loadKamakura(fetcher)).facilities);}
  assert(facilitiesEnabled(''));assert(!facilitiesEnabled('?facilities=0'));assert(facilitiesEnabled('?facilities=1'));
  const world=await fs.readFile(new URL('../dist/valley/world-kamakura.js',import.meta.url),'utf8');
  assert(world.includes('facilitiesEnabled(search) ? scene : new THREE.Scene()'));assert(world.includes('facilities?.update(flight.pos, flight.active)'));
});
test('the causeway is decoded and checked but held back from the scene unless ?causeway=1',async()=>{
  assert.equal(causewayShown(''),false);assert.equal(causewayShown('?causeway=1'),true);assert.equal(causewayShown('?causeway=0'),false);
  const {buildKamakuraFacilities}=await loadFacilityView();
  const nodes=[node(),node('causeway')],data={...decodeFacilities(catalog(nodes)),kit:kit(nodes)},terrain={heightAt:(x,z)=>x+z};
  const hidden=await buildKamakuraFacilities(data,terrain,new THREE.Scene());assert.equal(hidden.records.length,1);assert.equal(hidden.records[0].node.part,'hall');hidden.dispose();
  const shown=await buildKamakuraFacilities(data,terrain,new THREE.Scene(),'standard',{showHeldBack:true});assert.equal(shown.records.length,2);shown.dispose();
});
test('bundled Three facility view: node names, static matrices, normals, shadows, distance, disposal, failure cleanup (no GPU)',async()=>{
  const {buildKamakuraFacilities}=await loadFacilityView();
  const nodes=[node(),node('stairs'),node('gate')],data={...decodeFacilities(catalog(nodes)),kit:kit(nodes)},terrain={heightAt:(x,z)=>x+z},scene=new THREE.Scene();
  const field=await buildKamakuraFacilities(data,terrain,scene);
  assert.equal(field.boxes.length,1);assert.equal(field.exclusionBoxes.length,2);assert.equal(field.records.length,3);
  scene.updateMatrixWorld(true);
  const resources=new Set();for(const r of field.records)for(const m of r.meshes){assert.equal(m.matrixAutoUpdate,false);assert(m.receiveShadow);assert.equal(m.castShadow,r.node.part!=='stairs');resources.add(m.geometry);resources.add(m.material);assert(m.geometry.boundingSphere);near(m.matrixWorld.elements[12],10);near(m.matrixWorld.elements[14],20);}
  const stair=field.records[1].meshes[0],normal=stair.geometry.getAttribute('normal');assert(normal);
  const expected=stair.geometry.clone();expected.deleteAttribute('normal');expected.computeVertexNormals();
  assert.deepEqual([...normal.array],[...expected.getAttribute('normal').array]);expected.dispose();
  const original=stair.geometry.clone();original.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));original.computeVertexNormals();
  assert.notDeepEqual([...normal.array],[...original.getAttribute('normal').array]);original.dispose();
  near(field.records[0].meshes[0].position.y,30.5);near(stair.position.y,0);
  for(let i=0;i<positions.length;i+=3)near(stair.geometry.getAttribute('position').getY(i/3),30+positions[i]+positions[i+2]+Math.min(positions[i+1],FACILITY_WALK_TOP));
  field.update({x:1e6,z:1e6});assert(field.records.every(r=>r.meshes.every(m=>!m.visible)));
  field.update({x:10,z:20});assert(field.records.every(r=>r.meshes.every(m=>m.visible)));
  field.setAdapt({scale:.58,shadows:false});assert(field.records.every(r=>r.meshes.every(m=>!m.castShadow)));
  field.update({x:2500,z:20});assert(!field.records[0].meshes[0].visible);
  field.setAdapt({scale:1,shadows:true});field.update({x:2500,z:20});assert(field.records[0].meshes[0].visible);
  const released=new Map();for(const r of resources)r.addEventListener('dispose',()=>released.set(r,(released.get(r)||0)+1));
  field.dispose();field.dispose();assert.equal(scene.children.length,0);assert([...resources].every(r=>released.get(r)===1));
  const regenerated=await buildKamakuraFacilities(data,terrain,scene);regenerated.dispose();assert.equal(scene.children.length,0);
  await assert.rejects(buildKamakuraFacilities({...data,kit:kit(nodes,true)},terrain,scene));
  await assert.rejects(buildKamakuraFacilities({...data,nodes:[{...nodes[0],node:'missing'}]},terrain,scene));assert.equal(scene.children.length,0);
});
test('source/cloned geometry and PBR materials release once, including partial failure',async()=>{
  const {buildKamakuraFacilities}=await loadFacilityView(),scene=new THREE.Scene(),nodes=[node(),node('gate')];
  const geometrySet=THREE.BufferGeometry.prototype.setAttribute,materialSet=THREE.Material.prototype.setValues;
  const tracked=new Map();
  function track(resource) {if(!tracked.has(resource)){tracked.set(resource,0);resource.addEventListener('dispose',()=>tracked.set(resource,tracked.get(resource)+1));}}
  THREE.BufferGeometry.prototype.setAttribute=function(...args){track(this);return geometrySet.apply(this,args);};
  // GLTFLoader also creates temporary default MeshBasicMaterials without GPU allocation.
  THREE.Material.prototype.setValues=function(...args){if(this.isMeshStandardMaterial)track(this);return materialSet.apply(this,args);};
  try {
    for(const fail of [false,true]) {
      tracked.clear();
      const data={...decodeFacilities(catalog(nodes)),kit:kit(nodes)};
      if(fail)data.nodes=[nodes[0],{...nodes[1],triangles:999}];
      if(fail)await assert.rejects(buildKamakuraFacilities(data,{heightAt:()=>0},scene));
      else {const field=await buildKamakuraFacilities(data,{heightAt:()=>0},scene);field.dispose();field.dispose();}
      assert(tracked.size>=4);assert([...tracked.values()].every(n=>n===1),JSON.stringify([...tracked].map(([r,n])=>({type:r.type,n,flat:r.flatShading}))));
      assert.equal(scene.children.length,0);
    }
  } finally {THREE.BufferGeometry.prototype.setAttribute=geometrySet;THREE.Material.prototype.setValues=materialSet;}
});
test('private v0.8 facility nodes, triangles, placement, grounding and overlaps', {skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定：私有の施設データが必要'},async t=>{
  const {data}=await readPrivateData(process.env.KZ_WORLD_DIR),input=await readPrivateFacilities(process.env.KZ_WORLD_DIR,data);
  if(!input){t.skip('meta.facilities がない旧版：施設なし互換');return;}
  const report=verifyFacilities(data,input);assert.equal(report.count,input.facilities.nodes.length);assert.equal(report.triangles,input.facilities.catalog.total_triangles);
  const {buildKamakuraFacilities}=await loadFacilityView(),scene=new THREE.Scene();
  const {createKamakuraTerrain}=await import('../dist/valley/kamakura-terrain.js');
  for(const scale of [1,1.8]){const field=await buildKamakuraFacilities(input.facilities,createKamakuraTerrain(data,scale),scene,'standard',{search:'?buddha=hall'});const held=input.facilities.nodes.filter(n=>FACILITY_HELD_BACK.has(n.part)).length;assert(held>=1);
    const plain=await buildKamakuraFacilities(input.facilities,createKamakuraTerrain(data,scale),new THREE.Scene(),'standard',{search:'?ftex=0&buddha=hall'});
    assert.deepEqual(field.boxes,plain.boxes);assert.deepEqual(field.exclusionBoxes,plain.exclusionBoxes);
    assert.equal(field.records.length,plain.records.length);
    for(let i=0;i<field.records.length;i++){
      assert.equal(field.records[i].meshes.length,plain.records[i].meshes.length);
      for(let j=0;j<field.records[i].meshes.length;j++){
        const a=field.records[i].meshes[j],b=plain.records[i].meshes[j];
        assert.deepEqual(a.geometry.attributes.position.array,b.geometry.attributes.position.array);
        assert.deepEqual(a.geometry.attributes.normal?.array,b.geometry.attributes.normal?.array);
        assert.deepEqual(a.matrix.elements,b.matrix.elements);
      }
    }
    plain.dispose();
    assert.equal(field.records.length,report.count-held);assert.equal(field.boxes.length,report.colliders);field.update({x:data.meta.spawn.x,z:-data.meta.spawn.y});field.dispose();
    const all=await buildKamakuraFacilities(input.facilities,createKamakuraTerrain(data,scale),new THREE.Scene(),'standard',{showHeldBack:true,search:'?buddha=hall'});assert.equal(all.records.length,report.count);all.dispose();assert.equal(scene.children.length,0);}
  t.diagnostic(JSON.stringify({count:report.count,parts:report.parts,triangles:report.triangles,colliders:report.colliders,overlaps:Object.fromEntries(Object.entries(report.overlaps).map(([k,v])=>[k,v.length]))}));
});
test('9g2 facility ftex A/B preserves all geometry, placement, boxes and counts; adaptation and resources',async()=>{
  const {buildKamakuraFacilities}=await loadFacilityView(),nodes=[node('hall'),node('fence')],data={nodes,kit:kit(nodes)},terrain={heightAt:(x,z)=>2+x*.01+z*.02};
  const scenes=[new THREE.Scene(),new THREE.Scene()];
  const fields=await Promise.all(scenes.map((s,i)=>buildKamakuraFacilities(data,terrain,s,'standard',{search:i?'?ftex=0':'?hparts=0'})));
  const snapshot=f=>f.records.map(r=>r.meshes.map(m=>({p:[...m.geometry.attributes.position.array],n:m.geometry.attributes.normal && [...m.geometry.attributes.normal.array],matrix:[...m.matrix.elements],indices:m.geometry.index && [...m.geometry.index.array]})));
  assert.deepEqual(snapshot(fields[0]),snapshot(fields[1]));assert.deepEqual(fields[0].boxes,fields[1].boxes);assert.deepEqual(fields[0].exclusionBoxes,fields[1].exclusionBoxes);
  const resources=new Set();for(const r of fields[0].records)for(const m of r.meshes){
    const u=m.material.userData.houseUniforms;assert(u);assert.equal(u.houseRole.value,0);assert(m.geometry.hasAttribute('houseLocalY'));
    resources.add(m.geometry);resources.add(m.material);resources.add(u.houseAtlas.value);
    fields[0].setAdapt({scale:.7,shadows:true});assert.equal(u.houseBump.value,0);assert.equal(u.houseStrength.value,1);
    fields[0].setAdapt({scale:.58,shadows:false});assert.equal(u.houseStrength.value,0);
    fields[0].setAdapt({scale:1,shadows:true});assert.equal(u.houseBump.value,1);assert.equal(u.houseStrength.value,1);
  }
  for(const r of fields[1].records)for(const m of r.meshes)assert(!m.material.userData.houseUniforms);
  const calls=new Map();for(const r of resources)r.addEventListener('dispose',()=>calls.set(r,(calls.get(r)||0)+1));
  for(const f of fields){f.dispose();f.dispose();f.update({x:0,z:0});}
  assert([...resources].every(r=>calls.get(r)===1));assert(scenes.every(s=>s.children.length===0));
});

test('9g3 facility roles use mesh hints with anonymous materials; unknown torii keeps source color',async()=>{
  const {buildKamakuraFacilities}=await loadFacilityView();
  const nodes=[{...node('hall'),node:'synthetic_wall'},{...node('torii'),node:'synthetic_torii'}];
  const f={...decodeFacilities(catalog(nodes)),kit:kit(nodes)},scene=new THREE.Scene();
  const view=await buildKamakuraFacilities(f,{heightAt:()=>0},scene,'standard',{search:'?hparts=0'});
  try {
    const wall=view.records.find(r=>r.node.part==='hall').meshes[0].material;
    const torii=view.records.find(r=>r.node.part==='torii').meshes[0].material;
    assert.equal(wall.userData.houseUniforms.houseRole.value,2);
    assert.equal(torii.userData.houseUniforms.houseRole.value,0);
    assert.notEqual(wall,torii); // One source, distinct known/unknown roles.
    assert(wall.color.equals(torii.color));
  } finally {view.dispose();}
});

test('W2c-18 flight ranges include altitude, preserve walking exactly, and facfar=0 restores flight culling',async()=>{
  const nodes=[node('hall'),node('gate'),node('fence')],terrain={heightAt:()=>0},scene=new THREE.Scene();
  const {buildKamakuraFacilities}=await loadFacilityView();
  for(const off of [false,true]){
    const view=await buildKamakuraFacilities({...decodeFacilities(catalog(nodes)),kit:kit(nodes)},terrain,scene,'standard',{search:off?'?facfar=0':''});
    for(const [part,range] of [['hall',8000],['romon',8000],['buddha',8000],['fence',2500],['gate',4000],['torii',4000],['kairo',4000]]){
      near(facilityRange(node(part),'standard',0,true),range);
      near(facilityRange(node(part),'light',3,true),range*.36);
    }
    // A different flying position uses each facility's expanded bound distance, including altitude.
    view.update({x:2000,y:100,z:20},false);
    assert.deepEqual(view.records.map(r=>r.meshes[0].visible),[true,false,false]);
    view.update({x:2000,y:100,z:20},true);
    assert.deepEqual(view.records.map(r=>r.meshes[0].visible),off?[true,false,false]:[true,true,true]);
    assert.equal(scene.userData.kzHouseFarFacilities.flying,true);
    assert.equal(scene.userData.kzHouseFarFacilities.shown,off?1:3);
    view.update({x:10,y:9000,z:20},true);
    assert(view.records.every(r=>r.meshes[0].visible===off),'disabled flag restores legacy horizontal-only rule');
    view.dispose();assert.equal(scene.userData.kzHouseFarFacilities,undefined);
  }
  const box={x:0,z:0,w:20,d:20,rotY:0,minY:0,maxY:10};
  assert(facilityVisible(node('hall'),box,{x:0,z:0,y:8010},'standard',0,true));
  assert(!facilityVisible(node('hall'),box,{x:0,z:0,y:8011},'standard',0,true));
});
test('D1 facility view passes steps flag to rigid placement, preserves draw counts and releases resources',async()=>{
  const {buildKamakuraFacilities}=await loadFacilityView(),n={...node('stairs'),steps:{from_xz:[10,20],to_xz:[10,40],rise_m:7.5,width_m:10}},terrain={heightAt:(x,z)=>x+z},scene=new THREE.Scene();
  const data={...decodeFacilities(catalog([n])),kit:kit([n])};
  for(const search of ['?ftex=0','?ftex=0&steps=0']){
    const view=await buildKamakuraFacilities(data,terrain,scene,'standard',{search}),mesh=view.records[0].meshes[0];
    assert.equal(view.records.length,1);assert.equal(mesh.geometry.index.count/3,n.triangles);
    const expected=facilityPlacement(n,positions,terrain,{search});near(mesh.position.y,expected.position.y);
    assert.deepEqual([...mesh.geometry.attributes.position.array],[...expected.positions]);
    view.dispose();view.dispose();assert.equal(scene.children.length,0);
  }
});
