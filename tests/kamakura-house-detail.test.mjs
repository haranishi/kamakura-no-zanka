import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { housePolicy,decodeHouses } from '../dist/valley/kamakura-houses.js';
import { validateMeta,loadKamakura } from '../dist/valley/kamakura-data.js';
import { HOUSE2,HOUSE_DETAIL,house2Selection,house2Fade,buildHouse,houseDetailBand,houseDetailPart,houseDetailLimit,houseDetailFade } from '../dist/valley/kamakura-house-build.js';
import { syntheticHouse } from '../tools/preview-mesh.mjs';
import { buildGlb } from '../tools/lib/glb.mjs';
import { THREE,loadHouseView } from './helpers/kamakura-house-view.mjs';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { camOption } from '../dist/valley/kamakura-fly.js';
const policy={full_m:700,swap_m:760,cap:200};
function input(count=110){
  const p=new Float32Array([-4,-.8,-3,4,-.8,-3,4,-.8,3,-4,-.8,3,-4,.3,-3,4,.3,-3,4,.3,3,-4,.3,3,-4,3,-3,4,3,-3,4,3,3,-4,3,3,-5,3,-4,5,3,-4,5,3,4,-5,3,4,-5,5,0,5,5,0]);
  const idx=new Uint16Array([12,13,17,12,17,16,16,17,14,16,14,15]),bin=Buffer.concat([Buffer.from(p.buffer),Buffer.from(idx.buffer)]);
  const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'townhouse',mesh:0}],buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteLength:p.byteLength},{buffer:0,byteOffset:p.byteLength,byteLength:idx.byteLength}],accessors:[{bufferView:0,componentType:5126,count:p.length/3,type:'VEC3',min:[-5,-.8,-4],max:[5,5,4]},{bufferView:1,componentType:5123,count:idx.length,type:'SCALAR'}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.21,.17,.13,1],roughnessFactor:.8}}]};
  const glb=buildGlb({json,bin});
  return {kit:buffer(glb),catalog:{count_by_kind:{townhouse:count}},kinds:new Map([[0,{index:0,node:'townhouse',bbox_min:[-5,-4,-.8],bbox_max:[5,4,5]}]]),instances:Array.from({length:count},(_,i)=>({id:i,kind:0,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,(count-i)*2,0,0,1]}))};
}
const buffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const meshes=scene=>scene.children.filter(m=>m.name==='house2-instances');
const stats=()=>globalThis.__kzHouse2();
function warm(view,pos,frames=150){for(let i=0;i<frames;i++)view.update(pos);}

test('house policy validates map ranges, missing legacy defaults and explicit query precedence',()=>{
  const meta=fixture({width:2,height:2}).meta;assert.equal(validateMeta(meta),meta);assert.equal(validateMeta({...meta,house_policy:policy}).house_policy,policy);assert.throws(()=>validateMeta({...meta,house_policy:{...policy,cap:601}}));
  assert.deepEqual(housePolicy(),{full:60,swap:75,cap:90,extended:false});
  for(const p of [{full_m:30,swap_m:30,cap:30},{full_m:2000,swap_m:2500,cap:600},policy])assert.equal(housePolicy(p).full,p.full_m);
  for(const p of [null,[],{},1,{...policy,full_m:'700'},{...policy,full_m:NaN},{...policy,full_m:29},{...policy,full_m:2001},{...policy,swap_m:699},{...policy,swap_m:2501},{...policy,cap:29},{...policy,cap:601},{...policy,cap:30.5}])assert.throws(()=>housePolicy(p));
  assert.deepEqual(housePolicy(policy,'?housefull=600&houseswap=650&housecap=50'),{full:600,swap:650,cap:50,extended:true});
  assert.equal(housePolicy(undefined,'?housefull=30&houseswap=30&housecap=600').cap,600);
  for(const q of ['?housefull=','?housecap=foo','?housecap=90.5','?housecap=601','?housefull=800','?houseswap=2501'])assert.throws(()=>housePolicy(policy,q));
  assert.equal(house2Fade(700,housePolicy(policy)),1);assert.equal(house2Fade(730,housePolicy(policy)),.5);assert.equal(house2Fade(760,housePolicy(policy)),0);
  assert.equal(house2Fade(30,housePolicy({full_m:30,swap_m:30,cap:30})),1);
});

test('extended selection uses flight altitude, caps by nearest 3D distance and handles empty buffers',()=>{
  const houses=input(600),pos={x:0,y:450,z:0},ids=new Int32Array(200),distances=new Float64Array(200);
  for(const item of houses.instances){item.grounded=item.matrix;item.house2Eligible=true;}
  assert.equal(house2Selection(houses.instances,pos,ids,distances,200,760),200);
  assert.equal(ids[0],599);for(let i=1;i<200;i++)assert(distances[i]>=distances[i-1]);assert(distances[0]>=450);
  assert.equal(house2Selection(houses.instances,{...pos,y:761},ids,distances,200,760),0);
  assert.equal(house2Selection(houses.instances,pos,new Int32Array(),new Float64Array(),0,760),0);
});

test('structural/fine partition retains exact near geometry, UVs, tones and all readable structural parts',()=>{
  for(const family of ['townhouse','cottage','storehouse','mansion','boathouse'])for(const variant of [0,1]){
    const shape=buildHouse(syntheticHouse(family),variant),core=houseDetailBand(shape,false),fine=houseDetailBand(shape,true);
    assert.equal(core.triangles+fine.triangles,shape.triangles);assert(core.triangles<shape.triangles);
    for(const label of ['ridge cap','thick eave','post','opening back'])assert(core.solids.some(s=>s.label===label),family+' '+label);
    assert(core.solids.every(s=>!houseDetailPart(s)));assert(fine.solids.every(s=>houseDetailPart(s)));
    for(const band of [core,fine])for(const s of band.solids){const original=shape.solids.find(o=>o.label===s.label&&o.start>=0&&o.centre.every((v,k)=>v===s.centre[k]));assert(original);
      for(const [key,size] of [['positions',3],['normals',3],['uvs',2],['tones',1],['surfaces',1]])assert.deepEqual(band[key].subarray(s.start*size,(s.start+s.count)*size),shape[key].subarray(original.start*size,(original.start+original.count)*size));}
  }
  const focal=720/(2*Math.tan(50*Math.PI/360));
  for(const part of Object.values(HOUSE_DETAIL.parts)){
    const end=houseDetailLimit(part,focal);assert(end<=75);assert(part.width*focal/end>=1.5);
    assert.equal(houseDetailFade(end,end),0);assert.equal(houseDetailFade(0,end),1);assert(houseDetailFade(end-1,end)>0);
    assert(houseDetailLimit(part,focal,.5)<=end);
  }
});

test('extended view builds over multiple frames, keeps placeholders until ready and submits less distant geometry',async t=>{
  const {buildKamakuraHouses}=await loadHouseView(),scene=new THREE.Scene(),data=input(240),terrain={heightAt:()=>0,meta:{house_policy:policy}};
  const view=await buildKamakuraHouses(data,terrain,scene,{search:'?debug=1&housefar=0'}),pos={x:0,y:200,z:400};
  try{
    view.update(pos);assert.equal(stats().shown,0);assert(scene.children.some(g=>g.children.some(m=>m.name==='house-instances')));scene.onAfterRender();
    let allocated=0,completed=0;
    for(let frame=1;frame<=150;frame++){
      const before=stats().buildStages;view.update(pos);const s=stats();
      assert(s.buildStages-before<=HOUSE_DETAIL.stages);assert(meshes(scene).length-allocated<=1);allocated=meshes(scene).length;
      assert(s.shown<=policy.cap);assert(s.triangles<=HOUSE_DETAIL.triangles);assert(s.draws<=HOUSE_DETAIL.draws);
      if(s.shown===200){completed=frame;break;}
    }
    assert(completed>1);assert.equal(stats().shown,200);assert.equal(stats().policy.full,700);
    assert(meshes(scene).filter(m=>m.visible).every(m=>!m.geometry.attributes.house2PartEnd));
    const selected=data.instances.filter(i=>i.house2Weight>0).map(i=>i.id).sort((a,b)=>a-b);assert.deepEqual(selected,Array.from({length:200},(_,i)=>i+40));
    const far=stats().triangles;
    const near={x:data.instances[239].grounded[12],y:1,z:0};warm(view,near);
    assert(meshes(scene).some(m=>m.visible&&m.geometry.attributes.house2PartEnd));
    const snapshot=meshes(scene).map(m=>[m.instanceMatrix.version,m.instanceColor.version,m.geometry.attributes.house2Fade.version,m.geometry.attributes.house2Distance?.version]);
    warm(view,near,20);assert.deepEqual(meshes(scene).map(m=>[m.instanceMatrix.version,m.instanceColor.version,m.geometry.attributes.house2Fade.version,m.geometry.attributes.house2Distance?.version]),snapshot);
    view.update({...pos,y:800});assert.equal(stats().shown,0);view.setAdapt(2);view.update(near);assert.equal(stats().shown,0);view.setAdapt(0);view.update(near);assert(stats().shown>0);
    t.diagnostic(JSON.stringify({syntheticShown:200,farTriangles:far,completionFrames:completed,maxGeneratorStages:stats().maxBuildStages}));
  }finally{view.dispose();}assert.equal(globalThis.__kzHouse2,undefined);assert.equal(scene.children.length,0);
});

test('expanded policy does not depend on near chunks at the old 350m threshold, including altitude',async()=>{
  const {buildKamakuraHouses}=await loadHouseView(),scene=new THREE.Scene(),data=input(2),terrain={heightAt:()=>0,meta:{house_policy:{full_m:1700,swap_m:1800,cap:30}}};
  const view=await buildKamakuraHouses(data,terrain,scene,{search:'?debug=1'});
  try{const pos={x:0,y:900,z:1000};scene.onAfterRender();warm(view,pos);assert.equal(stats().shown,2);view.update({...pos,y:1801});assert.equal(stats().shown,0);}finally{view.dispose();}
});

test('extended policy preserves light quality and explicit house2 off',async()=>{
  const {buildKamakuraHouses}=await loadHouseView();
  for(const options of [{quality:'light'},{search:'?house2=0'}]){const scene=new THREE.Scene(),view=await buildKamakuraHouses(input(),{heightAt:()=>0,meta:{house_policy:policy}},scene,{...options,search:(options.search??'?')+'&debug=1'});
    try{scene.onAfterRender();warm(view,{x:0,y:0,z:0});assert.equal(stats().enabled,false);assert.equal(meshes(scene).length,0);}finally{view.dispose();}}
});

async function world(dir){
  const data=await loadKamakura(async url=>{
    const name=url.slice('/world-private/'.length),bytes=await fs.readFile(path.join(dir,name));
    return {ok:true,arrayBuffer:async()=>buffer(bytes),json:async()=>{const value=JSON.parse(bytes);if(name==='meta.json')value.house_policy={...policy};return value;}};
  },'');
  assert(data.houses,'runtime house loading succeeds');return {...data,decoded:data};
}

test('designed world: metadata validation, real terrain and overlook finish inside the requested rendering budgets',{skip:!process.env.KZ_HOUSE_DESIGNED_DIR&&'designed input not set'},async t=>{
  const data=await world(process.env.KZ_HOUSE_DESIGNED_DIR);data.meta.house_policy={...policy};assert.equal(validateMeta(data.meta),data.meta);
  assert.throws(()=>validateMeta({...data.meta,house_policy:{...policy,cap:601}}));
  const terrain=createKamakuraTerrain(data.decoded),camera=camOption('?cam=overlook',data.meta.places,data.meta.overlook);assert(camera);
  const {buildKamakuraHouses}=await loadHouseView(),scene=new THREE.Scene(),view=await buildKamakuraHouses(data.houses,terrain,scene,{search:'?debug=1'});
  const projection=new THREE.PerspectiveCamera(camera.fov,1672/940,.15,30000);scene.onAfterRender({getDrawingBufferSize:v=>v.set(1672,940)},scene,projection);
  try{
    let complete=0;
    const eligible=data.houses.instances.filter(i=>i.house2Eligible&&Math.hypot(i.grounded[12]-camera.pos.x,i.grounded[13]-camera.pos.y,i.grounded[14]-camera.pos.z)<policy.swap_m).length;
    for(let frame=1;frame<=1000;frame++){view.update(camera.pos);const s=stats();assert(s.shown<=policy.cap);assert(s.triangles<=600000);assert(s.draws<=120);assert(s.maxBuildStages<=HOUSE_DETAIL.stages);
      if(s.shown===eligible&&!s.building){complete=frame;break;}}
    assert(complete>0,'all eligible houses finish');
    const s=stats();let fallbackTriangles=0,fallbackDraws=0;
    scene.traverse(m=>{if(m.name!=='house-instances'||!m.visible||!m.parent.visible)return;fallbackTriangles+=(m.geometry.index?.count??m.geometry.attributes.position.count)/3*m.count;fallbackDraws++;});
    t.diagnostic(JSON.stringify({designed:{shown:s.shown,triangles:s.triangles,draws:s.draws,completionFrames:complete,buildFrames:s.buildFrames,generatorStages:s.buildStages,maxGeneratorStages:s.maxBuildStages,maxSliceMs:Math.max(...s.built.map(b=>b.maxSliceMs)),fallbackSubmittedTriangles:fallbackTriangles,fallbackDraws}}));
    const shown=s.shown,triangles=s.triangles;view.setAdapt(3);view.update(camera.pos);assert.equal(stats().shown,0);view.setAdapt(0);view.update(camera.pos);assert.equal(stats().shown,shown);assert.equal(stats().triangles,triangles);
  }finally{view.dispose();}
});

test('private world: expanded policy raises no exception and stays under all configured budgets',{skip:!process.env.KZ_WORLD_DIR&&'private input not set'},async t=>{
  const data=await world(process.env.KZ_WORLD_DIR);data.meta.house_policy={...policy};
  const {buildKamakuraHouses}=await loadHouseView(),scene=new THREE.Scene(),view=await buildKamakuraHouses(data.houses,{heightAt:()=>0,meta:data.meta},scene,{search:'?debug=1&housefar=0'});
  let checked=0;
  try{scene.onAfterRender();for(const kind of data.houses.kinds.values()){
    const item=data.houses.instances.find(i=>i.kind===kind.index&&i.house2Eligible);if(!item)continue;
    const pos={x:item.grounded[12],y:item.grounded[13]+200,z:item.grounded[14]};warm(view,pos,250);
    assert(stats().shown<=policy.cap);assert(stats().triangles<=HOUSE_DETAIL.triangles);assert(stats().draws<=HOUSE_DETAIL.draws);assert(stats().maxBuildStages<=HOUSE_DETAIL.stages);checked++;
  }assert(checked>0);t.diagnostic('Private input: exceptions 0, budget violations 0.');}finally{view.dispose();}
});
