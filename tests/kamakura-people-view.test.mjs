import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from '../dist/vendor/three.module.min.js';
import { createKamakuraPeople } from '../dist/valley/kamakura-people-view.js';
import { PEOPLE, PEOPLE_CLIPS } from '../dist/valley/kamakura-people.js';
const meta=JSON.parse(fs.readFileSync(new URL('../dist/assets/characters/clips.json',import.meta.url)));
const DT=1/60;
function fixture({search='?debug=1', quality='standard', town=true, camera=null, pending=false, fail=false, api=null}={}) {
  const scene=new THREE.Scene(), hero={pos:{x:0,y:0,z:0},drawn:false};
  const terrain={bounds:{minX:-400,maxX:400,minZ:-400,maxZ:400},heightAt:()=>0,waterAt:()=>0,slopeAt:()=>0,walkable:()=>true};
  const context={search,scene,quality,hero,terrain,camera,data:{},habitat:{at(x,z,o){return Object.assign(o,{town:town?1:0,paddy:0,forest:town?0:1,pass:0,sand:0,meadow:0});}}};
  let moduleCalls=0,loads=0,created=0,disposed=0,updates=0,released=0,resolve;
  const templates=[],characters=[];
  class Person {
    constructor(roster,who) {
      created++;characters.push(this);this.tpl=roster.templates.get(who);this.model=this.tpl.scene.clone(true);this.root=new THREE.Group();this.root.add(this.model);
      this.ikCalls=0;this.legs={undo(){},apply:()=>{this.ikCalls++;},reset:false};
      this.height=meta.characters[who].height;this.mixer=new THREE.AnimationMixer(this.model);this.current=null;this.currentName=null;this.actions=new Map();
      const update=this.mixer.update.bind(this.mixer);this.mixer.update=dt=>{updates++;return update(dt);};
    }
    bone(name){return this.model.getObjectByName(name);}
    meta(name){return meta.clips[name];}
    action(name){if(!this.actions.has(name)){const action=this.mixer.clipAction(this.tpl.clips.get(name));action.setLoop(this.meta(name)?.loop?THREE.LoopRepeat:THREE.LoopOnce,Infinity);action.clampWhenFinished=true;this.actions.set(name,action);}return this.actions.get(name);}
    play(name,opt){this.current?.stop();this.current=this.action(name);this.currentName=name;this.current.reset().play();this.current.time=opt.from||0;this.current.timeScale=opt.timeScale||1;}
    dispose(){disposed++;this.mixer.stopAllAction();this.mixer.uncacheRoot(this.model);this.root.removeFromParent();}
  }
  async function loadRoster({names}) {
    loads++;if(fail&&loads===2)throw Error('synthetic load failure');
    const who=names[0], scene=new THREE.Group(), head=new THREE.Bone();head.name='Head';scene.add(head);
    const geometry=new THREE.BoxGeometry(.5,1.5,.3), material=new THREE.MeshBasicMaterial();scene.add(new THREE.Mesh(geometry,material));
    geometry.addEventListener('dispose',()=>released++);material.addEventListener('dispose',()=>released++);
    const clips=new Map(PEOPLE_CLIPS.map(name=>[name,new THREE.AnimationClip(name,meta.clips[name].seconds||3,[new THREE.NumberKeyframeTrack('Head.rotation[x]',[0,1,3],[0,.15,0])])]));
    const tpl={scene,clips,roots:new Map(),info:meta.characters[who]};templates.push(tpl);
    return {meta,templates:new Map([[who,tpl]])};
  }
  const deps={loadModule(){moduleCalls++;return pending?new Promise(r=>{resolve=r;}):Promise.resolve(api||{Character:Person,loadRoster});}};
  const layer=createKamakuraPeople(context,deps), frame={dt:DT,pos:hero.pos,hero,flying:false};
  function step(n=1){for(let i=0;i<n;i++)layer?.update(frame);}
  async function settle(){step(2);if(pending)resolve({Character:Person,loadRoster});await new Promise(r=>setImmediate(r));step(200);}
  return {scene,context,hero,layer,frame,step,settle,resolve:()=>resolve({Character:Person,loadRoster}),templates,characters,
    stats:()=>({moduleCalls,loads,created,disposed,updates,released}),snapshot:()=>globalThis.__kzPeople(),close:()=>layer?.dispose()};
}

test('people=0 returns null without even importing characters; loading waits for drawn frames', async () => {
  const off=fixture({search:'?people=0'});off.step(10);assert.equal(off.layer,null);assert.equal(off.stats().moduleCalls,0);
  const f=fixture({pending:true});assert.equal(f.stats().moduleCalls,0);f.step();assert.equal(f.stats().moduleCalls,0);
  f.step();assert.equal(f.stats().moduleCalls,1);assert.equal(f.snapshot().active,0);assert.equal(f.snapshot().loaded,false);
  f.resolve();await new Promise(r=>setImmediate(r));f.step(200);assert(f.snapshot().loaded);assert(f.snapshot().active>0);f.close();
});
test('pool caps, nearest ordering, standard/light/automatic quality, pause, dispose exactly once', async t => {
  for(const quality of ['standard','light']) {
    const f=fixture({quality});await f.settle();let d=f.snapshot();assert.equal(d.active,Math.min(quality==='light'?5:10,d.locations.filter(p=>Math.hypot(p.x,p.z)<=(quality==='light'?45:70)).length));assert(d.pool<=10);
    const sorted=d.locations.map(p=>Math.hypot(p.x,p.z)).sort((a,b)=>a-b).slice(0,d.active);
    const active=d.actors.map(p=>Math.hypot(p.spotX,p.spotZ)).sort((a,b)=>a-b);
    // Avoidance shifts world spots by up to a step; selected identity stays nearest.
    active.forEach((distance,i)=>assert(Math.abs(distance-sorted[i])<2));
    const before=f.stats().updates;f.layer.setPaused(true);f.step(100);assert.equal(f.stats().updates,before);f.layer.setPaused(false);
    f.layer.setAdapt(2);f.step();assert(f.snapshot().active<=Math.min(6,quality==='light'?5:10));
    f.layer.setAdapt(3);assert.equal(f.snapshot().active,0);f.step(20);assert.equal(f.snapshot().active,0);
    f.layer.setAdapt(0);f.step(30);assert(f.snapshot().active>0);
    f.close();f.close();assert.equal(f.stats().disposed,f.stats().created);assert.equal(f.stats().released,6);assert.equal(f.scene.children.length,0);assert.equal(globalThis.__kzPeople,undefined);
    t.diagnostic(`${quality}: live cap ${quality==='light'?5:10}, clones ${f.stats().created}, shared resources disposed ${f.stats().released}`);
  }
});
test('people are already there on arrival; afterwards entry occurs offscreen or beyond 55m; camera turn permits entry', async () => {
  const camera=new THREE.PerspectiveCamera(60,16/9,.1,500);camera.position.set(0,2,5);camera.lookAt(0,1,-30);camera.updateMatrixWorld();
  const f=fixture({camera});await f.settle();let d=f.snapshot();
  // On arrival (the first seconds after loading) the town in front of the viewer is filled, in view and close.
  assert(d.active>0);assert(d.actors.some(p=>p.enteredDistance<=55&&!p.enteredOffscreen));const first=new Set(d.actors.map(p=>p.id));
  for(const root of f.scene.children){const actor=d.actors.find(a=>Math.hypot(a.x-root.position.x,a.z-root.position.z)<.01);assert(actor);assert(Math.abs(root.rotation.y-actor.yaw-Math.PI)<1e-9);}
  const start=d.active;camera.lookAt(0,1,30);camera.updateMatrixWorld();f.step(60);d=f.snapshot();assert(d.active>=start);
  // After the arrival window, walking on (no jump) brings newcomers in only out of sight or far away.
  f.step(200);for(let i=0;i<260;i++){f.hero.pos.x+=.4;f.step();}
  const later=f.snapshot().actors.filter(p=>!first.has(p.id));assert(later.length>0);assert(later.every(p=>p.enteredDistance>55||p.enteredOffscreen));
  // A jump to another place (more than 30 m in one frame) is an arrival again.
  f.hero.pos.x+=400;f.hero.pos.z+=300;f.step(90);const jumped=f.snapshot();if(jumped.active>0)assert(jumped.actors.some(p=>p.enteredDistance<=55));f.close();
});
test('skeleton cadence is full/half/quarter, shadows only within 25m; 2000 frames have bounded resources', async t => {
  const f=fixture();await f.settle();const close=f.snapshot().actors.find(p=>p.role==='chat');f.hero.pos.x=close.x+10;f.hero.pos.z=close.z;f.step(200);const d=f.snapshot();let near=0,half=0,quarter=0;
  for(const p of d.actors) {const dist=Math.hypot(p.x-f.hero.pos.x,p.z-f.hero.pos.z);if(dist<=35)near++;else if(dist<=55)half++;else quarter++;assert.equal(p.shadow,dist<=25);}
  const start=f.stats().updates;let expected=0;
  for(let i=0;i<120;i++){const before=f.snapshot();f.step();const after=f.snapshot();
    for(const p of after.actors){const old=before.actors.find(a=>a.id===p.id);assert(old);
      const distance=Math.hypot(p.x-f.hero.pos.x,p.z-f.hero.pos.z),stride=distance>55?4:distance>35?2:1;
      const tick=(403+i)%stride===0||old.clip!==p.clip?1:0;assert.equal(p.bones-old.bones,tick);expected+=tick;}
  }
  const work=f.stats().updates-start;assert.equal(work,expected);assert(near>0);
  let peakPool=0,peakLive=0,overlaps=0;const heroBefore={...f.hero.pos};
  for(let i=0;i<2000;i++) {f.hero.pos.x=Math.sin(i/200)*180;f.hero.pos.z=Math.cos(i/200)*180;const x=f.hero.pos.x,z=f.hero.pos.z;f.step();assert.equal(f.hero.pos.x,x);assert.equal(f.hero.pos.z,z);if(i%40===0){const s=f.snapshot();peakPool=Math.max(peakPool,s.pool);peakLive=Math.max(peakLive,s.active);overlaps=s.overlaps;}}
  assert(peakPool<=10&&peakLive<=10);assert.equal(overlaps,0);assert(f.stats().created-f.stats().disposed<=10);
  t.diagnostic(`120 frames: near/half/quarter ${near}/${half}/${quarter}, mixer updates ${work}; 2000 frames pool/live peaks ${peakPool}/${peakLive}, overlaps ${overlaps}`);
  f.close();assert.equal(f.stats().created,f.stats().disposed);assert.equal(f.stats().released,6);assert.equal(heroBefore.y,f.hero.pos.y);
});
test('near people face and bow, drawn people do not bow, cooldown persists across eviction', async () => {
  const f=fixture();await f.settle();const target=f.snapshot().actors.find(p=>p.role==='chat');
  f.hero.pos.x=target.x+2;f.hero.pos.z=target.z;f.step(2);
  let d=f.snapshot(), bow=d.actors.find(p=>p.clip==='Formal_Bow');assert(bow);assert(-Math.sin(bow.yaw)>.9);
  const root=f.scene.children.find(root=>Math.hypot(root.position.x-bow.x,root.position.z-bow.z)<.01);assert(root);
  f.step(155);assert(f.snapshot().actors.some(p=>p.clip==='Formal_Bow'));
  assert(f.characters.some(ch=>ch.currentName==='Formal_Bow'&&ch.current.time>=meta.clips.Formal_Bow.seconds-.1));
  // The complete source bow must fit the greeting, rather than only playing its lead-in.
  assert(meta.clips.Formal_Bow.seconds/3<2.7);
  f.step(240);assert(f.snapshot().actors.every(p=>p.clip!=='Formal_Bow'));
  f.hero.drawn=true;f.step(10);assert(f.snapshot().actors.every(p=>p.clip!=='Formal_Bow'));
  f.hero.pos.x=250;f.step(20);f.hero.drawn=false;f.hero.pos.x=target.x+2;f.step(20);
  assert(f.snapshot().actors.filter(p=>Math.hypot(p.x-target.x,p.z-target.z)<1).every(p=>p.clip!=='Formal_Bow'));
  f.close();
});
test('failed optional load closes its successful templates once; dispose during pending load releases late results', async () => {
  const original=console.warn,warnings=[];console.warn=(...args)=>warnings.push(args);
  try{const f=fixture({fail:true});await f.settle();assert(f.snapshot().failed);assert.equal(f.snapshot().active,0);assert.equal(f.stats().released,2);f.close();assert.equal(f.stats().released,2);assert.equal(warnings.length,1);}finally{console.warn=original;}
  const f=fixture({pending:true});f.step(2);f.close();f.resolve();await new Promise(r=>setImmediate(r));assert.equal(f.stats().loads,0);assert.equal(f.stats().created,0);
});
test('empty forest work is small and steady update code has no collection construction', async t => {
  const f=fixture({town:false});await f.settle();const start=performance.now();f.step(10000);const ms=(performance.now()-start)/10000;
  assert.equal(f.snapshot().active,0);assert.equal(f.stats().created,0);t.diagnostic(`Node empty forest mean ${ms.toFixed(5)}ms/frame; models still preloaded`);f.close();
  const source=fs.readFileSync(new URL('../dist/valley/kamakura-people-view.js',import.meta.url),'utf8');
  const hot=source.slice(source.indexOf('  function update(frame)'),source.indexOf('  return {\n    update,'));
  assert.doesNotMatch(hot,/new (?:Array|Map|Set|THREE\.)|\.map\(|\.filter\(|\.sort\(|=>/);
});

test('role pillars share geometry, use role colours and dispose each resource once', async () => {
  const f=fixture({search:'?debug=1&peopledebug=1'});await f.settle();
  const pillars=f.scene.children.map(root=>root.children.find(o=>o.isMesh));assert(pillars.every(Boolean));
  assert.equal(new Set(pillars.map(p=>p.geometry)).size,1);assert(new Set(pillars.map(p=>p.material.color.getHex())).size>=2);
  let geometry=0,materials=0;const seen=new Set();
  for(const p of pillars){if(!seen.has(p.geometry)){seen.add(p.geometry);p.geometry.addEventListener('dispose',()=>geometry++);}if(!seen.has(p.material)){seen.add(p.material);p.material.addEventListener('dispose',()=>materials++);}}
  const expected=new Set(pillars.map(p=>p.material)).size;f.close();f.close();assert.equal(geometry,1);assert.equal(materials,expected);
});
test('disposing while a GLB request is pending releases its late geometry and material', async () => {
  let resolve,closed=0;const geometry=new THREE.BoxGeometry(),material=new THREE.MeshBasicMaterial(),scene=new THREE.Group();scene.add(new THREE.Mesh(geometry,material));
  geometry.addEventListener('dispose',()=>closed++);material.addEventListener('dispose',()=>closed++);
  const api={Character:class {},loadRoster:()=>new Promise(r=>resolve=r)};
  const f=fixture({api});f.step(2);await new Promise(r=>setImmediate(r));f.close();
  resolve({meta,templates:new Map([['villager_m',{scene}]])});await new Promise(r=>setImmediate(r));assert.equal(closed,2);assert.equal(globalThis.__kzPeople,undefined);
});

test('moving groups occupy six priority slots, share the absolute scene clock with the crowd and use silhouettes while flying',async t=>{
  const {createKamakuraCrowd}=await import('../dist/valley/kamakura-crowd-view.js');
  const {prepareFlight,sampleFlight}=await import('../dist/valley/kamakura-people.js');
  const f=fixture();
  f.context.data={meta:{flight:{road:'pass',groups:12,size:[5,5],speed:.8}},roads:{pass:{kind:'trail',width_m:4,xyz_m:[[0,-150,0],[0,150,0]]}}};
  // Context is supplied before the lazy placement runs on the first frame.
  f.frame.time=30;const crowd=createKamakuraCrowd(f.context);await f.settle();
  for(let i=0;i<200;i++){f.step();crowd.update(f.frame);}
  let snap=f.snapshot();const travellers=snap.actors.filter(a=>a.role==='traveller');
  assert.equal(travellers.length,6);assert(snap.active<=PEOPLE.max);assert.equal(snap.time,30);assert.equal(globalThis.__kzFlight().time,30);
  const spots=prepareFlight(f.context),expected={};
  for(const a of travellers){const p=spots.find(p=>p.id===a.id);sampleFlight(p,30,f.context.terrain,expected);
    if(Math.hypot(expected.x-f.hero.pos.x,expected.z-f.hero.pos.z)>2)assert(Math.hypot(a.x-expected.x,a.z-expected.z)<.05);
    assert.equal(a.clip,'Casual_Walk');}
  assert(f.characters.some(c=>c.ikCalls>0),'road travellers use the existing foot IK on terrain');
  assert(f.characters.some(c=>c.root.children.length>1),'near travellers carry the shared hat, backpack and staff geometry');
  const activeGear=f.characters.flatMap(c=>c.root.children.filter(o=>o.name==='traveller-equipment'));assert.equal(activeGear.length,6);
  const saved=globalThis.Float32Array;globalThis.Float32Array=class extends saved{constructor(){super();assert.fail('steady equipped near frame allocated a buffer');}};
  try{f.step(100);}finally{globalThis.Float32Array=saved;}
  f.frame.flying=true;f.frame.pos={x:0,y:55,z:0};f.step();crowd.update(f.frame);
  assert.equal(f.snapshot().byRole.traveller,0);assert(globalThis.__kzFlight().drawn>=10);
  for(const gear of activeGear){assert(!gear.parent);assert(gear.skeleton.bones.every(b=>!b.parent));}
  for(const ch of f.characters)assert(!ch.model.getObjectByName('traveller-hat'),'evicted slots detach bone children');
  const ArrayBefore=globalThis.Float32Array;globalThis.Float32Array=class extends ArrayBefore{constructor(){super();assert.fail('steady near frame allocated a buffer');}};
  try{f.step(100);}finally{globalThis.Float32Array=ArrayBefore;}
  t.diagnostic(`near priority ${travellers.length}/${snap.active}; flying uses no near traveller slots`);
  crowd.dispose();f.close();assert.equal(f.scene.children.length,0);
});

test('ordinary people retain their local animation clock when the flight feature is disabled',async()=>{
  const a=fixture({search:'?debug=1&flight=0&shorepeople=0'});a.frame.time=10000;await a.settle();
  const before=a.snapshot().actors.map(({id,clip,yaw,head})=>({id,clip,yaw,head}));a.close();
  const b=fixture({search:'?debug=1&flight=0&shorepeople=0'});await b.settle();
  assert.deepEqual(b.snapshot().actors.map(({id,clip,yaw,head})=>({id,clip,yaw,head})),before);b.close();
});

test('flying skeletons are the nearest eight within 45m in 3D, share road anchors and leave silhouettes while loading or beyond range',async t=>{
  const {createKamakuraCrowd}=await import('../dist/valley/kamakura-crowd-view.js');
  const {prepareFlight,sampleFlight,selectFlightPeople}=await import('../dist/valley/kamakura-people.js');
  const f=fixture();f.context.data={meta:{flight:{road:'pass',groups:24,size:[6,6],speed:.8}},roads:{pass:{kind:'trail',width_m:4,xyz_m:[[0,-150,0],[0,150,0]]}}};
  const crowd=createKamakuraCrowd(f.context,true);f.frame.time=30;f.frame.flying=true;f.frame.pos={x:0,y:20,z:0};
  crowd.update(f.frame);assert(globalThis.__kzFlight().drawn>0,'pending skeleton loading leaves the road visible');
  await f.settle();crowd.update(f.frame);let snap=f.snapshot();assert.equal(snap.byRole.traveller,8);assert.equal(snap.active,8);
  const spots=prepareFlight(f.context);for(const p of spots)sampleFlight(p,30,f.context.terrain,p);
  const indices=new Int32Array(8),n=selectFlightPeople(spots,f.frame.pos,'standard',0,indices,true);
  assert.equal(n,8);assert.deepEqual(snap.actors.map(a=>a.id).sort(),Array.from(indices,i=>spots[i].id).sort());
  for(const a of snap.actors){const p=spots.find(p=>p.id===a.id);assert(Math.hypot(a.x-p.x,a.z-p.z)<.05);assert(Math.hypot(a.x,a.z,20)<=45);
    const ch=f.characters.find(c=>c.root.visible&&Math.hypot(c.root.position.x-a.x,c.root.position.z-a.z)<.001);assert(ch);
    const d=Math.hypot(p.x,p.z,20),fade=Math.max(0,Math.min(1,(45-d)/PEOPLE.fade));
    assert(Math.abs(ch.root.scale.x*ch.height-(p.child?.96:1.6)*p.alpha*fade)<1e-6);}
  for(const mesh of f.scene.children.filter(m=>m.name.startsWith('kamakura-travellers')&&!m.name.includes('shadow'))) {
    const g=mesh.geometry;
    for(let i=0;i<g.instanceCount;i++) {
      const p=spots.find(p=>Math.hypot(p.x-g.attributes.crowdAnchor.getX(i),p.z-g.attributes.crowdAnchor.getZ(i))<.001);assert(p);
      const actor=snap.actors.find(a=>a.id===p.id);
      assert(Math.abs(g.attributes.crowdAnchor.getW(i)-(p.child?.96:1.6)*p.alpha)<1e-6);
      if(actor)assert(g.attributes.crowdPerson.getW(i)>0);else assert.equal(g.attributes.crowdPerson.getW(i),0);
    }
  }
  f.frame.pos.y=100;f.step();crowd.update(f.frame);assert.equal(f.snapshot().active,0);assert.equal(globalThis.__kzFlight().drawn,spots.filter(p=>p.alpha>0).length);
  f.frame.pos.y=20;f.step(30);crowd.update(f.frame);assert.equal(f.snapshot().active,8);
  f.layer.setAdapt(2);crowd.setAdapt(2);f.step(30);crowd.update(f.frame);assert(f.snapshot().active<=6);
  f.layer.setAdapt(3);crowd.setAdapt(3);assert.equal(f.snapshot().active,0);assert.equal(globalThis.__kzFlight().drawn,0);
  t.diagnostic(`synthetic flight: ${spots.length} road people, eight skeleton slots at 20m altitude; no skeletons at 100m`);
  crowd.dispose();f.close();assert.equal(f.context.flightPeople,undefined);
});

test('walking families stay beside each other while preserving the hero clearance',async()=>{
  const f=fixture({town:false});f.context.data={meta:{flight:{road:'pass',groups:1,size:[2,2],speed:.8}},roads:{pass:{kind:'trail',width_m:4,xyz_m:[[0,-100,0],[0,100,0]]}}};
  f.hero.pos.x=10;f.frame.time=0;await f.settle();
  const actors=f.snapshot().actors.filter(a=>a.role==='traveller');assert.equal(actors.length,2);
  const distance=Math.hypot(actors[0].x-actors[1].x,actors[0].z-actors[1].z);assert(distance>=.5&&distance<.9);
  for(const a of actors)assert(Math.hypot(a.x-f.hero.pos.x,a.z-f.hero.pos.z)>=PEOPLE.heroGap);
  f.close();
});
