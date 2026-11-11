import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.min.js';
import { performance } from 'node:perf_hooks';
import { validateFlight, prepareFlight, sampleFlight, selectFlightPeople, FLIGHT, PEOPLE, preparePeople,
  resetPerson, createPersonState, stepPerson, createPeopleSite } from '../dist/valley/kamakura-people.js';
import { validateMeta } from '../dist/valley/kamakura-data.js';
import { crowdMotion, crowdShape, crowdPlacementBatches, CROWD } from '../dist/valley/kamakura-crowd.js';
import { createKamakuraCrowd } from '../dist/valley/kamakura-crowd-view.js';
import { harborPlacementBatches, prepareHarbor, harborOverlap } from '../dist/valley/kamakura-harbor.js';

const config = () => ({road:'pass',groups:6,size:[2,4],speed:.8});
function world() {
  const terrain={bounds:{minX:-200,maxX:200,minZ:-300,maxZ:150},heightAt:(x,z)=>8-z*.12,
    walkable:()=>true,waterAt:()=>0,slopeAt:()=>7};
  return {data:{meta:{flight:config()},roads:{pass:{kind:'trail',width_m:4,xyz_m:[[0,-100,0],[0,0,0],[0,200,0]]}}},
    terrain,habitat:{at(x,z,o){return Object.assign(o,{town:1,forest:0,pass:0,sand:0,paddy:0,meadow:0});}},search:'?debug=1',quality:'standard'};
}
function beachWorld() {
  const w=world();w.data={};w.terrain.bounds={minX:-550,maxX:550,minZ:-90,maxZ:90};
  Object.assign(w.terrain,{heightAt:(x,z)=>-z*.02,waterAt:(x,z)=>z>=0?1:0,walkable:(x,z)=>z<0,isSea:(x,z)=>z>=0,
    seaDistanceAt:(x,z)=>Math.max(0,-z),slopeAt:()=>1});
  w.habitat.at=(x,z,o)=>Object.assign(o,{town:0,forest:0,pass:0,sand:z<0&&z>-60?1:0,paddy:0,meadow:0});
  w.houses={boxes:[{x:0,z:-80,w:4,d:5}]};return w;
}
test('flight metadata accepts only bounded fields and optional absence; loader invokes its validator',()=>{
  assert.equal(validateFlight(),null);assert.equal(validateFlight(null),null);assert.deepEqual(validateFlight(config()),config());
  for(const value of [false,[],{}, {...config(),road:''},{...config(),road:3}, ...[0,13,1.5,NaN].map(groups=>({...config(),groups})),
    ...[[0,4],[2,6],[4,2],[1.5,3],[2],[2,3,4],new Array(2)].map(size=>({...config(),size})),
    ...[.3,1.7,NaN,Infinity,'1'].map(speed=>({...config(),speed}))]) assert.throws(()=>validateFlight(value));
  const m={schema:'kz-world-web/0.1',grid:{width:2,height:2,cell_m:1,row0:'north',col0:'west',sample_position:'cell_center',x_axis:'east',y_axis:'north',z_axis:'up'},
    height:{encoding:'uint16-le',min_m:0,max_m:10,file:'height_u16.bin'},walk:{file:'walk_u8.bin',polygon_m:[[0,0],[1,0],[0,1]]},spawn:{x:0,y:0,z:0,yaw_deg_clockwise_from_north:0},places:[]};
  assert.equal(validateMeta(m),m);assert.throws(()=>validateMeta({...m,flight:{...config(),groups:50}}),/人の指定/);
  assert.deepEqual(prepareFlight({...world(),search:'?flight=0'}),[]);const absent=world();delete absent.data.meta.flight;assert.deepEqual(prepareFlight(absent),[]);
  assert.deepEqual(prepareFlight({...world(),data:{meta:{flight:config()}}}),[]);
});
test('absolute-time groups are deterministic, spaced within the road width, speed-correct, ground-following and fade at both ends',()=>{
  const w=world(),a=prepareFlight(w),b=prepareFlight(w);assert.deepEqual(a,b);assert(a.length>=12&&a.length<=24);
  const groups=new Map();for(const p of a){if(!groups.has(p.group))groups.set(p.group,[]);groups.get(p.group).push(p);}
  assert.equal(groups.size,6);
  for(const members of groups.values()) {
    assert(members.length>=2&&members.length<=4);
    for(let i=1;i<members.length;i++)assert(members[i].s0-members[i-1].s0>=1&&members[i].s0-members[i-1].s0<=2.5);
  }
  const out={},other={};
  for(const p of a) {
    assert(Math.abs(p.side)<=.8);sampleFlight(p,30,w.terrain,out);sampleFlight(p,30,w.terrain,other);assert.deepEqual(out,other);
    assert(Math.abs(out.x)<=w.data.roads.pass.width_m/2);assert.equal(out.y,w.terrain.heightAt(out.x,out.z));
    sampleFlight(p,31,w.terrain,other);assert(Math.abs((other.travel-out.travel+p.length)%p.length-p.speed)<1e-8);
    if(other.travel>out.travel)assert(Math.abs(Math.hypot(other.x-out.x,other.z-out.z)-p.speed)<1e-8);
    const start={...p,s0:0},end={...p,s0:p.length-6};sampleFlight(start,0,w.terrain,out);assert.equal(out.alpha,0);
    sampleFlight(start,6/p.speed,w.terrain,out);assert.equal(out.alpha,.5);sampleFlight(end,0,w.terrain,out);assert.equal(out.alpha,.5);
    sampleFlight(end,6/p.speed,w.terrain,out);assert.equal(out.alpha,0);
  }
  for(const width of [1,1.5,2,4]) {w.data.roads.pass.width_m=width;for(const p of prepareFlight(w))assert(Math.abs(p.side)<=width/2-FLIGHT.edge);}
  // Cross a bend and compare the two rendering levels at exactly the same time.
  w.data.roads.pass.xyz_m=[[0,-100,0],[0,0,0],[80,100,0]];
  const site=createPeopleSite(w);
  for(const p of prepareFlight(w))for(const time of [0,17,122,400]) {
    const near=resetPerson(createPersonState(),p),body={spot:p,terrain:w.terrain};
    stepPerson(near,{x:1000,z:1000},false,time,1/60,site);crowdMotion(body,time,out);
    assert(Math.hypot(near.x-out.x,near.z-out.z)<.05);assert(Math.abs(near.yaw-out.yaw)<1e-9);assert.equal(near.clip,'Casual_Walk');
  }
});
test('near priority is bounded at six, light quality reduces it, flight mode uses no near slots, hero avoidance survives',()=>{
  const w=world();w.data.meta.flight={road:'pass',groups:12,size:[5,5],speed:1};const spots=prepareFlight(w),out=new Int32Array(6),viewer={x:0,z:0};
  assert.equal(selectFlightPeople(spots,viewer,'standard',0,out),6);assert.equal(selectFlightPeople(spots,viewer,'light',0,out),5);
  assert.equal(selectFlightPeople(spots,viewer,'standard',3,out),0);assert.equal(selectFlightPeople(spots,viewer,'standard',0,out,true),0);
  const p=spots[20],s=resetPerson(createPersonState(),p),site=createPeopleSite(w);
  stepPerson(s,{x:p.x,z:p.z},false,0,1/60,site);assert(Math.hypot(s.x-p.x,s.z-p.z)>=PEOPLE.heroGap-1e-6);
});
test('traveller silhouette contains a hat, backpack and optional staff with finite normals and a bounded full height',t=>{
  for(const staff of [false,true]) {
    const shape=crowdShape('traveller',0,staff);assert.equal(shape.triangles,staff?108:96);assert(shape.parts.includes(2)&&shape.parts.includes(3));assert.equal(shape.parts.includes(4),staff);
    let min=Infinity,max=-Infinity,hat=0,pack=0;
    for(let i=0;i<shape.parts.length;i++) {const y=shape.positions[i*3+1];min=Math.min(min,y);max=Math.max(max,y);
      if(shape.parts[i]===2)hat=Math.max(hat,Math.abs(shape.positions[i*3]));if(shape.parts[i]===3)pack=Math.max(pack,shape.positions[i*3+2]);
      assert(Math.abs(Math.hypot(...shape.normals.subarray(i*3,i*3+3))-1)<1e-6);}
    assert.equal(min,0);assert.equal(max,1);assert(hat>.1&&hat<=CROWD.torso[1]*1.1);
    assert(hat<=CROWD.travellerHatRadius+1e-6&&pack>.2);
    for(let i=0;i<shape.parts.length;i++)if(shape.parts[i]===3)assert(Math.abs(shape.positions[i*3])<=CROWD.torso[0]+1e-6,'pack fits the back width');
  }
  t.diagnostic('traveller: 96 triangles; with staff: 108; instanced pass uses 108 per figure');
});
test('flying overlook retains at least five groups including figures directly below; shadows, moving uploads, caps, pause and disposal',t=>{
  const w=world();w.scene=new THREE.Scene();w.camera=new THREE.PerspectiveCamera();w.camera.position.set(0,55,0);w.sunDir=new THREE.Vector3(-1,.4,1);
  const layer=createKamakuraCrowd(w),frame={dt:1/60,time:30,pos:w.camera.position,camera:w.camera,flying:true};
  for(let i=0;i<2000&&!globalThis.__kzCrowd().ready;i++)layer.update(frame);
  let snap=globalThis.__kzFlight();const mesh=w.scene.children.find(m=>m.name==='kamakura-travellers'),shadow=w.scene.children.find(m=>m.name==='kamakura-travellers-shadow');
  assert(snap.drawn>=10);assert(snap.groups>=5);assert(snap.byRole.traveller===snap.drawn);assert.equal(snap.draws,2);assert.equal(shadow.geometry,mesh.geometry);
  assert(snap.nearest.distance<80);assert.equal(snap.triangles,snap.selected*108);
  const selected=prepareFlight(w).filter(p=>{sampleFlight(p,frame.time,w.terrain,p);return p.alpha>0;});assert(new Set(selected.map(p=>p.group)).size>=5);
  const anchor=mesh.geometry.attributes.crowdAnchor,person=mesh.geometry.attributes.crowdPerson;
  assert(Array.from(person.array).filter((v,i)=>i%3===0).some(v=>v===-2),'flying never hides under the near-distance cut');
  const start=anchor.array.slice(0,3),version=anchor.version;frame.time+=1;layer.update(frame);assert(anchor.version>version);
  const end=anchor.array.slice(0,3);assert(Math.hypot(end[0]-start[0],end[2]-start[2])>.7);
  // No buffers or arrays are created while moving, after the static placement has completed.
  const ArrayBefore=globalThis.Float32Array;globalThis.Float32Array=class extends ArrayBefore{constructor(){super();assert.fail('moving frame allocated a typed array');}};
  const begin=performance.now();try{for(let i=0;i<1000;i++){frame.time+=1/60;layer.update(frame);}}finally{globalThis.Float32Array=ArrayBefore;}
  const ms=(performance.now()-begin)/1000;snap=globalThis.__kzFlight();assert(globalThis.__kzCrowd().selected+snap.selected<=CROWD.max);
  layer.setPaused(true);layer.update(frame);assert.deepEqual(globalThis.__kzFlight(),snap);layer.setPaused(false);
  layer.setAdapt(2);layer.update(frame);assert(globalThis.__kzFlight().selected<selected.length);assert(globalThis.__kzFlight().selected+globalThis.__kzCrowd().selected<=Math.floor(CROWD.max*CROWD.adaptCount));
  layer.setAdapt(3);assert.equal(globalThis.__kzFlight().drawn,0);assert(!mesh.visible&&!shadow.visible);
  layer.setAdapt(0);layer.update(frame);assert(globalThis.__kzFlight().drawn>0);
  t.diagnostic(`flight ${snap.drawn} figures, ${snap.triangles} triangles, ${snap.draws} draws; moving update ${ms.toFixed(4)} ms; ${JSON.stringify(snap.work)}`);
  layer.dispose();assert.equal(w.scene.children.length,0);assert.equal(globalThis.__kzFlight,undefined);assert.equal(globalThis.__kzCrowd,undefined);
});
test('harbor shore preparation exactly matches beach groups, adds 0–2 dry workers per group and shares identities at both densities',t=>{
  const w=beachWorld(),full=prepareHarbor(w),job=harborPlacementBatches(w,{shoreOnly:true});let n;do{n=job.next();}while(!n.done);
  assert.deepEqual(n.value.groups,full.groups);assert.deepEqual(n.value.items,full.items.filter(p=>p.kind==='beach'||p.kind==='rack'));assert.equal(n.value.work.routeSamples,0);
  const near=preparePeople(w),shore=near.spots.filter(p=>p.harborShore),far=preparePeople(w,2.5).spots.filter(p=>p.harborShore);
  const farJob=crowdPlacementBatches(w,2.5);let result;do{result=farJob.next();}while(!result.done);
  assert.deepEqual(result.value.filter(b=>b.spot.harborShore).map(b=>b.spot),shore);
  assert.deepEqual(shore,far);assert(shore.length>=6&&shore.length<=14);
  for(const group of full.groups)assert(shore.filter(p=>p.group===`shore-${group.id}`).length<=2);
  for(const p of shore) {
    assert(w.terrain.walkable(p.x,p.z));assert.equal(w.terrain.waterAt(p.x,p.z),0);assert(near.site.ground(p.x,p.z));
    assert(full.items.some(b=>b.group===Number(p.group.split('-')[1])&&Math.hypot(p.x-b.x,p.z-b.z)<10));
    for(const b of full.items)assert(!harborOverlap({x:p.x,z:p.z,w:.6,d:.6,yaw:0},b));
  }
  for(const flag of ['harbor=0','shorepeople=0'])assert.equal(preparePeople({...w,search:'?'+flag}).spots.filter(p=>p.harborShore).length,0);
  t.diagnostic(`synthetic beach: ${full.groups.length} groups, ${shore.length} dry workers`);
});

test('moving silhouette count decreases with light/adaptation and flight=0 restores the ordinary crowd path',()=>{
  for(const quality of ['standard','light']) {
    const w=world();w.quality=quality;w.data.meta.flight={...config(),groups:12,size:[5,5]};
    w.scene=new THREE.Scene();w.camera=new THREE.PerspectiveCamera();w.camera.position.set(0,55,0);
    const layer=createKamakuraCrowd(w),frame={dt:1/60,time:5,pos:w.camera.position,camera:w.camera,flying:true};layer.update(frame);
    const full=globalThis.__kzFlight().selected;assert.equal(full,quality==='light'?45:60);
    layer.setAdapt(2);layer.update(frame);assert.equal(globalThis.__kzFlight().selected,Math.floor(full*CROWD.adaptCount));
    layer.setAdapt(3);assert.equal(globalThis.__kzFlight().draws,0);layer.dispose();
  }
  const w=world();w.search='?debug=1&flight=0';w.scene=new THREE.Scene();const layer=createKamakuraCrowd(w);
  assert(!w.scene.children.some(m=>m.name==='kamakura-travellers'));assert.equal(globalThis.__kzFlight,undefined);layer.dispose();
});
