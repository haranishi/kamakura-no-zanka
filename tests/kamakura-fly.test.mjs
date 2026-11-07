import test from 'node:test';
import assert from 'node:assert/strict';
import { FLY, flyOption, flySpeed, createFly, flyAction, stepFly, topPose, topFov, flyLanding } from '../dist/valley/kamakura-fly.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { pointDeparture } from '../dist/valley/kamakura-spawn.js';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { THREE, load, source } from './helpers/tree-modules.mjs';
import { startWorld } from '../dist/valley/world-entry.js';
import { readPrivateData } from '../tools/lib/kamakura-validation.mjs';
const terrain = () => createKamakuraTerrain(fixture({width:65,height:65,cell:4}));
const near = (a,b) => assert(Math.abs(a-b)<1e-8, `${a} != ${b}`);
const state = (pitch=0,yaw=0) => ({mode:'fly',speed:80,pose:{pos:{x:0,y:2000,z:0},pitch,yaw},returnPose:null});

test('flight integral: forward, strafe, vertical, diagonal normalization, pitched heading and boost',()=>{
  for(const [input,delta] of [[{forward:1},[0,0,-80]],[{right:1},[80,0,0]],[{up:1},[0,80,0]],[{up:-1},[0,-80,0]],[{forward:-1},[0,0,80]],[{right:-1},[-80,0,0]],[{forward:1,boost:true},[0,0,-400]]]) {
    const p=stepFly(state(),input,1,()=>0).pose.pos; near(p.x,delta[0]);near(p.y-2000,delta[1]);near(p.z,delta[2]);
  }
  const p=stepFly(state(),{forward:1,right:1,up:1},1,()=>0).pose.pos; near(Math.hypot(p.x,p.y-2000,p.z),80);
  const tilted=stepFly(state(Math.PI/4,-Math.PI/2),{forward:1},1,()=>0).pose.pos;
  near(tilted.x,80/Math.sqrt(2)); near(tilted.y-2000,-80/Math.sqrt(2)); near(tilted.z,0);
  const a=stepFly(state(),{forward:1},1,()=>0);let b=state();for(let i=0;i<100;i++)b=stepFly(b,{forward:1},.01,()=>0);
  near(a.pose.pos.z,b.pose.pos.z); assert.equal(state().pose.pos.z,0);
});
test('speed bounds, wheel directions, reset, pitch ±89 degrees, ground and ceiling clamps',()=>{
  near(flySpeed(80,1),100);near(flySpeed(80,-1),64);near(flySpeed(5,1),6.25);
  assert.equal(flySpeed(80,100),2000); assert.equal(flySpeed(80,-100),5);
  for(const sign of [-1,1]) near(stepFly(state(),{dy:sign*100000},0,()=>0).pose.pitch,sign*89*Math.PI/180);
  assert.equal(stepFly(state(),{up:-1},100,()=>123).pose.pos.y,125);
  assert.equal(stepFly(state(),{up:1},1000,()=>0).pose.pos.y,12000);
  const fast={...state(),speed:2000}; assert.equal(stepFly(fast,{reset:true},0,()=>0).speed,80);
  assert.equal(stepFly(fast,{speedSteps:-1},0,()=>0).speed,1600);
  assert.deepEqual(stepFly(state(),{up:1},-1,()=>0).pose.pos,state().pose.pos);
});
test('query parsing and initial northeast/down pose, top pose and fit at portrait/landscape aspects',()=>{
  const t=terrain(),spawn={x:20,z:30,yaw:0};
  for(const v of ['', '?fly=', '?fly=true','?fly=0','?fly=TOP','?fly=constructor'])assert.equal(flyOption(v),'walk');
  assert.equal(flyOption('?fly=1'),'fly');assert.equal(flyOption('?fly=top'),'top');
  const s=createFly('?fly=1',t,spawn);assert.equal(s.mode,'fly');near(s.pose.pos.y,t.heightAt(20,30)+900);near(s.pose.pitch,35*Math.PI/180);near(s.pose.yaw,-Math.PI/4);
  const bounds={minX:-5450,maxX:5450,minZ:-4150,maxZ:4150}; const top=topPose(bounds);assert.deepEqual(top.pos,{x:0,y:7500,z:0});near(top.pitch,Math.PI/2);near(top.yaw,0);
  for(const aspect of [16/9,1,9/16]){
    const camera=new THREE.PerspectiveCamera(topFov(bounds,aspect,1000),aspect,.15,30000);camera.position.copy(top.pos);camera.rotation.set(-top.pitch,top.yaw,0,'YXZ');camera.updateMatrixWorld(true);
    for(const x of [-5450,5450])for(const z of [-4150,4150])for(const y of [0,1000]){const q=new THREE.Vector3(x,y,z).project(camera);assert(Math.abs(q.x)<1&&Math.abs(q.y)<1&&Math.abs(q.z)<1);}
    const north=new THREE.Vector3(0,0,-100).project(camera);assert(north.y>0);const east=new THREE.Vector3(100,0,0).project(camera);assert(east.x>0);
  }
});
test('landing reuses pointDeparture with an 80m radius; direct, relocated, sea and out-of-frame',()=>{
  const t=terrain();const s=state();s.pose.pos.x=12;s.pose.pos.z=20;s.pose.yaw=-.8;
  assert.deepEqual(flyLanding(t,s.pose),{x:12,y:1000,z:20,yaw:-.8});
  const restricted={...t,walkable:(x,z)=>Math.hypot(x-60,z)<.5};s.pose.pos.x=s.pose.pos.z=0;
  assert.equal(pointDeparture(restricted,new URLSearchParams({pos:'0,0'})),null);
  assert.equal(flyLanding(restricted,s.pose).x,60);
  assert.equal(flyLanding({...t,walkable:()=>false},s.pose),null);
  s.pose.pos.x=10000;assert.equal(flyLanding(t,s.pose),null);
});
test('F/M/G state transitions preserve flight position on overview round trip and reject failed landing',()=>{
  const t=terrain(), eye=state().pose;let s=createFly('',t,{x:0,z:0});
  assert.equal(flyAction(s,'G',t,eye),s);s=flyAction(s,'F',t,eye);assert.equal(s.mode,'fly');
  const flying=s;s=flyAction(s,'M',t,eye);assert.equal(s.mode,'top');s=flyAction(s,'M',t,eye);assert.deepEqual(s.pose,flying.pose);
  assert.equal(flyAction(s,'F',t,eye).mode,'walk');
  assert.equal(flyAction(s,'G',{...t,walkable:()=>false},eye).mode,'fly');
  assert.equal(flyAction(s,'G',t,eye).mode,'walk');
  const top=createFly('?fly=top',t,{x:10,z:20});assert.equal(flyAction(top,'M',t,eye).pose.pos.x,10);
  assert.equal(flyAction(createFly('',t,{x:0,z:0}),'M',t,eye).mode,'top');
});

test('shipped Three Node adapter: scene focus, hero visibility, far, chunk range/budget, overview/landing and disposal (no GPU)',async()=>{
  const {createKamakuraFlight}=await load('kamakura-fly-view.js');const {buildKamakuraChunks}=await load('kamakura-chunk-view.js');
  const t=createKamakuraTerrain(fixture({width:257,height:257,cell:30})),scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(58,16/9,.15,10000);camera.position.set(0,1005,3);
  const hero={pos:{x:0,y:1000,z:0},character:{root:new THREE.Group()},place(x,z,yaw){this.pos={x,y:t.heightAt(x,z),z};this.yaw=yaw;}};
  let snaps=0;const rig={yaw:.3,snap(){snaps++;}};const chunks=buildKamakuraChunks(t,scene,hero.pos);
  const calls={},record=name=>(...args)=>calls[name]=args;const notices=[];
  const c=createKamakuraFlight({search:'',terrain:t,spawn:hero.pos,camera,hero,rig,chunks,houses:{update:record('houses')},trees:{update:record('trees')},stands:{update:record('stands')},water:{update:record('water')},atmosphere:{update:record('atmos')},hud:{setFlight:record('hud')},hint:x=>notices.push(x)});
  assert(hero.character.root.visible);assert.equal(camera.far,10000);assert.equal(chunks.distance,3300);
  c.updateViews(1,.1);assert.equal(calls.houses[0],hero.pos);assert.equal(calls.atmos[2],hero.pos);
  c.action('F');assert(!hero.character.root.visible);assert.equal(camera.far,30000);assert.equal(chunks.distance,14000);
  c.step({forward:1,up:1,boost:true},1);const flightPos=camera.position.clone();const oldHero={...hero.pos};
  c.updateViews(2,.1);assert.equal(calls.houses[0],camera.position);assert.equal(calls.trees[0],camera);assert.equal(calls.stands[0],camera);assert.equal(calls.atmos[2],camera.position);assert.equal(calls.water[0],2);assert.deepEqual(hero.pos,oldHero);
  // Count actual geometry builds via normalAt samples on a fresh, all-coarse generation.
  chunks.dispose();const fresh=buildKamakuraChunks(t,scene,hero.pos);fresh.setFlying(true);
  let builds=0;const compute=THREE.BufferGeometry.prototype.computeBoundingSphere;
  THREE.BufferGeometry.prototype.computeBoundingSphere=function(){builds++;return compute.call(this);};
  const overhead={x:0,y:7500,z:0};
  try { fresh.update(overhead); } finally { THREE.BufferGeometry.prototype.computeBoundingSphere=compute; }
  assert.equal(builds,FLY.builds);assert(fresh.chunks.filter(ch=>ch.loaded).length<=FLY.builds);assert(fresh.chunks.filter(ch=>ch.loaded).every(ch=>ch.step===8));
  for(let i=0;i<20;i++)fresh.update(overhead);assert(fresh.chunks.every(ch=>ch.loaded&&ch.visible));fresh.dispose();
  c.action('M');near(camera.position.y,7500);c.action('M');assert(camera.position.equals(flightPos));
  c.action('F');assert(hero.character.root.visible);assert.equal(camera.far,10000);assert.equal(chunks.distance,3300);assert.deepEqual(hero.pos,oldHero);assert.equal(snaps,1);
  c.action('F');c.step({right:1},.1);const landX=camera.position.x;c.action('G');assert.equal(c.state.mode,'walk');near(hero.pos.x,landX);
  c.action('F');c.step({right:1,boost:true},100);c.action('G');assert(c.active);assert.deepEqual(notices,['ここは歩けません']);
  c.action('R');assert.equal(c.state.speed,80);c.dispose();c.dispose();assert(hero.character.root.visible);assert.equal(camera.far,10000);
  const pos=camera.position.clone();c.action('F');c.step({forward:1},1);assert(camera.position.equals(pos));assert.equal(scene.children.length,0);
  assert.match(source('world-kamakura.js'),/flight\.updateViews\(uniforms.uTime, paused \? 0 : dt\)/);
  assert.match(source('world-kamakura.js'),/else if \(!paused\)/);
});
test('fly query without world follows the existing valley entry; garden is not changed',async()=>{
  let n=0;for(const search of ['?fly=1','?fly=top&debug=1'])await startWorld(search,{valley:()=>n++,kamakura:()=>assert.fail(),fallback:()=>assert.fail()});assert.equal(n,2);
});
test('private flight landing and top extent', {skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定：私有の地形データが必要'},async()=>{
  const {data}=await readPrivateData(process.env.KZ_WORLD_DIR);const t=createKamakuraTerrain(data),spawn={x:t.meta.spawn.x,z:-t.meta.spawn.y};const s=createFly('?fly=1',t,spawn);
  const landing=flyLanding(t,s.pose);assert(landing&&t.walkable(landing.x,landing.z));assert.equal(createFly('?fly=top',t,spawn).pose.pos.y,7500);
});

test('flight key/button/wheel binding respects pause, repeat and abort without modifying base Input',async()=>{
  const {bindKamakuraFlight}=await load('kamakura-fly-view.js');const oldAdd=globalThis.addEventListener;
  const window=new EventTarget(),element=new EventTarget(),hud={toggle:new EventTarget(),top:new EventTarget(),land:new EventTarget()};globalThis.addEventListener=window.addEventListener.bind(window);
  const events=new AbortController();let paused=false,clears=0;const actions=[],steps=[];
  const flight={active:true,action:k=>actions.push(k),step:(i,dt)=>steps.push([i,dt])};const input={base:{wheel:100},clear(){clears++;}};
  const emit=(target,type,values={})=>{const e=Object.assign(new Event(type,{cancelable:true}),values);target.dispatchEvent(e);return e;};
  try {
    bindKamakuraFlight({flight,input,hud,element,paused:()=>paused,signal:events.signal});
    for(const code of ['KeyF','KeyM','KeyG','KeyR'])emit(window,'keydown',{code,repeat:false});
    emit(window,'keydown',{code:'KeyF',repeat:true});assert.deepEqual(actions,['F','M','G','R']);
    emit(hud.toggle,'click');emit(hud.top,'click');emit(hud.land,'click');assert.deepEqual(actions.slice(4),['F','M','G']);assert.equal(clears,7);assert.equal(input.base.wheel,0);
    assert(emit(element,'wheel',{deltaY:-120}).defaultPrevented);emit(element,'wheel',{deltaY:120});assert.deepEqual(steps,[[{speedSteps:1},0],[{speedSteps:-1},0]]);
    paused=true;emit(window,'keydown',{code:'KeyF'});emit(hud.top,'click');emit(element,'wheel',{deltaY:120});assert.equal(actions.length,7);assert.equal(steps.length,2);
    paused=false;flight.active=false;assert(!emit(element,'wheel',{deltaY:120}).defaultPrevented);
    events.abort();emit(window,'keydown',{code:'KeyF'});emit(hud.toggle,'click');assert.equal(actions.length,7);
    assert.match(source('world-kamakura.js'),/bindKamakuraFlight\(\{ flight, input, hud/);
  }finally{globalThis.addEventListener=oldAdd;}
});

test('HUD gates controls, changes help/run label and finds the nearest place beneath the flight camera',async()=>{
  const {createKamakuraHUD}=await import('../dist/valley/hud-kamakura.js');const oldDocument=globalThis.document;
  const roots=[];
  globalThis.document={body:{append:root=>roots.push(root)},createElement(){const nodes=new Map();return {setAttribute(){},querySelector(name){if(!nodes.has(name))nodes.set(name,{style:{},innerHTML:'walking help'});return nodes.get(name);}};}};
  try {
    const t=terrain(),meta={places:[{x:1000,y:0,name:'東の場所'},{x:-1000,y:0,name:'西の場所'}]};
    for(const [debug,show]of [[false,false],[true,true],[false,true]]){
      const hud=createKamakuraHUD(meta,debug,show);hud.setFlight(false,false);
      assert.equal(hud.root.querySelector('.kz-flight').hidden,!show);assert(hud.up.hidden);assert.equal(hud.run.textContent,'走る');
      hud.setFlight(true,false);assert.equal(hud.toggle.textContent,'歩く');assert(!hud.up.hidden);assert.equal(hud.run.textContent,'加速');assert.match(hud.root.querySelector('.kz-info').innerHTML,/飛行：WASD/);
      const s=state();s.pose.pos.x=500;hud.update(s.pose.pos,s.pose.yaw,t,null,s);assert.equal(hud.root.querySelector('.kz-place').textContent,'東の場所');
      if(debug)assert.match(hud.root.querySelector('.kz-debug').textContent,/高度 .*速さ .*向き .*ピッチ/);
      hud.setFlight(true,true);assert.equal(hud.top.textContent,'元の飛行へ');hud.setFlight(false,false);assert.equal(hud.root.querySelector('.kz-info').innerHTML,'walking help');
      hud.update({x:500,y:1000,z:0},0,t,null,s);assert.equal(hud.root.querySelector('.kz-place').textContent,'鎌倉');
    }
    assert.equal(roots.length,3);
  }finally{globalThis.document=oldDocument;}
});
