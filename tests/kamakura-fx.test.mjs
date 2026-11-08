import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { prepareFishRivers, createFishState, fishPigment, fishHaze, fishMix, FISH_WATER } from '../dist/valley/kamakura-fish.js';
import { createFxState, bindFxContact, riverDepthAlpha, fxOptions, rippleWidth, rippleAlpha, rippleAspect, rippleSecondary } from '../dist/valley/kamakura-fx.js';
const terrain = { vscale: 1, waterAt: (x,z) => z < 2 ? .4 : 0, surfaceAt: () => ({ dirt: 1 }), groundColorAt: () => [.2,.3,.1], heightAt: () => 2 };
const river = (xy = [[-20,0],[0,0],[20,0]], widths = xy.map(()=>4)) => ({ xy_m: xy, width_m: widths, water_elev_m: xy.map(()=>2.5), bed_m: xy.map(()=>2) });
const data = (...rivers) => ({ rivers });
const prep = () => prepareFishRivers(data(river()));
const hero = () => ({ pos: { x: 0, y: 2, z: 0 }, yaw: 0, stepGait: 'walk' });
test('fx deterministic contacts, bounds, gait strength, ballistic floor, expiry and contact-spaced V wakes', () => {
  const a=createFxState({terrain,rivers:prep()}), b=createFxState({terrain,rivers:prep()}), h=hero();
  for(const s of [a,b]) { s.contact({foot:'left'},h); s.update(.25); h.pos.x=1; s.contact({foot:'right'},h); h.pos.x=0; }
  assert.deepEqual(a.drops,b.drops); assert.deepEqual(a.ripples,b.ripples);
  assert.equal(a.ripples.filter(r=>r.wake && r.life>0).length,1);
  const walking=a.ripples[0].strength; h.stepGait='run'; a.contact({foot:'left'},h); assert(a.ripples[3].strength>walking);
  for(let i=0;i<500;i++) a.contact({foot:'left'},h);
  assert.equal(a.drops.length,192); assert.equal(a.ripples.length,24);
  for(let i=0;i<180;i++) { a.update(1/60); for(const p of a.drops) if(!p.dust) assert(p.y>=p.water); }
  assert(a.drops.every(p=>p.life===0)); assert(a.ripples.every(r=>r.life===0));
  a.update(1); h.pos.x+=1; a.contact({foot:'right'},h); assert.equal(a.ripples.filter(r=>r.wake&&r.life>0).length,0);
});
test('dust only on dry ground, color derived from ground, grass walks have no effects',()=>{
  const s=createFxState({terrain,rivers:prep()}); s.api.dust({x:0,y:2,z:0}); assert(s.drops.every(p=>!p.life));
  s.api.dust({x:0,y:2,z:5}); assert.equal(s.drops.filter(p=>p.life>0).length,8); assert.equal(s.drops[0].r,.35);
  const grass={...terrain,surfaceAt:()=>({grass:1})}; const g=createFxState({terrain:grass,rivers:prep()});
  g.api.dust({x:0,y:2,z:5}); g.contact({}, {...hero(),pos:{x:0,y:2,z:5}}); assert(g.drops.every(p=>!p.life));
});
test('wrapper preserves original once and before FX; world wires after audio, updates and disposes',()=>{
  const calls=[], h={onFootContact(c){assert.equal(c.foot,'left');calls.push('base');}};
  bindFxContact(h,{contact(c,actor){assert.equal(actor,h);calls.push('fx');}}); h.onFootContact({foot:'left'}); assert.deepEqual(calls,['base','fx']);
  const world=fs.readFileSync(new URL('../dist/valley/world-kamakura.js',import.meta.url),'utf8');
  assert(world.indexOf('audioView.attach(g)')<world.indexOf('g.fx = fx.api')); assert.match(world,/bindFxContact\(hero, fx\)/); assert.match(world,/fx.update\(paused \? 0 : dt, camera, hero\)/); assert.match(world,/fx\?\.dispose\(\)/);
  assert.equal(fxOptions('?fx=0').enabled,false);assert.equal(fxOptions('?fish=0').fish,false);
});
test('fish deterministic on straight/bent/variable/short synthetic rivers, lane and camera bounds, scare return, narrow exclusion, jump ripple',()=>{
  for(const r of [river(),river([[0,0],[8,5],[16,0]],[2,4,1.3]),river([[0,0],[.5,0]],[2,2])]) {
    const a=createFishState(prepareFishRivers(data(r))),b=createFishState(prepareFishRivers(data(r))),camera={x:0,z:0},far={x:500,z:500};
    for(let i=0;i<300;i++){a.update(.1,camera,far);b.update(.1,camera,far);assert.deepEqual(a.fish,b.fish); for(let j=0;j<a.count;j++){ const f=a.fish[j]; assert(Math.abs(f.lane)<=f.half*.78+1e-9);assert(Math.hypot(f.x,f.z)<=24);assert(f.y>=2.06); } }
    assert(a.count>0);a.update(.1,far,far);assert.equal(a.count,0);
  }
  let jumps=0; const rivers=prep(),f=createFishState(rivers,{ripple(){jumps++;}}),camera={x:0,z:0};
  const s=rivers.segments[1],near={x:s.ax+s.dx/2,z:s.az+s.dz/2};
  f.update(.1,camera,near);assert(rivers.segments.some(p=>p.fleeing)); f.update(2,camera,{x:500,z:500});f.update(2.6,camera,{x:500,z:500});f.update(0,camera,{x:500,z:500});assert(f.fish.slice(0,f.count).every(p=>p.scare===0));
  for(let i=0;i<1000;i++)f.update(.1,camera,near);assert(jumps>0);assert(f.count<=56);
  const narrow=createFishState(prepareFishRivers(data(river(undefined,[1,1,1]))));narrow.update(.1,camera,near);assert.equal(narrow.count,0);
  const dry=createFishState(prepareFishRivers(data({...river(),bed_m:[2.4,2.4,2.4]})));dry.update(.1,camera,near);assert.equal(dry.count,0);
});
test('river opacity CPU formula stays bounded and monotonically increases with depth and toward center',()=>{
  for(let e=0;e<=1;e+=.1)for(let d=0;d<=2;d+=.1){const a=riverDepthAlpha(e,d);assert(a>=.5&&a<=.9);assert(a>=riverDepthAlpha(e+.01,d));assert(a<=riverDepthAlpha(e,d+.01));}
});
const threeURL=new URL('../dist/vendor/three.module.min.js',import.meta.url).href;
const cache=new Map();
async function load(name){
  if(cache.has(name))return cache.get(name);
  let s=fs.readFileSync(new URL('../dist/valley/'+name,import.meta.url),'utf8').replace(/from 'three'/g,`from '${threeURL}'`);
  for(const match of [...s.matchAll(/from '(\.\/[^']+)'/g)]) {
    const rel=match[1].slice(2), url=(rel.endsWith('-view.js')||rel==='atmosphere.js')?await load(rel):new URL('../dist/valley/'+rel,import.meta.url).href;
    s=s.replaceAll(`from '${match[1]}'`,`from '${url}'`);
  }
  const url='data:text/javascript;base64,'+Buffer.from(s).toString('base64');cache.set(name,url);return url;
}
test('bundled Three: three draws, fog, resources dispose once, quality changes reuse pools, flags allocate none, shader contracts',async()=>{
  const THREE=await import(threeURL),{buildKamakuraFx}=await import(await load('kamakura-fx-view.js'));
  const fx=buildKamakuraFx({terrain,data:{rivers:data(river())}}),h=hero(),camera=new THREE.PerspectiveCamera();
  const resources=new Map();for(const m of fx.group.children)for(const r of [m,m.geometry,m.material]){resources.set(r,0);r.addEventListener('dispose',()=>resources.set(r,resources.get(r)+1));}
  const matrices=fx.group.children.map(m=>m.instanceMatrix);
  fx.contact({foot:'left'},h);fx.update(.1,camera,h);assert.equal(fx.group.children.length,3);
  for(const m of fx.group.children){assert.equal(m.material.fog,true);assert(!m.castShadow);const shader={vertexShader:THREE.ShaderLib[m.material.isMeshStandardMaterial?'standard':'basic'].vertexShader,fragmentShader:THREE.ShaderLib[m.material.isMeshStandardMaterial?'standard':'basic'].fragmentShader,uniforms:{}};m.material.onBeforeCompile(shader);assert(!shader.vertexShader.includes('undefined'));if(m.material.transparent) {assert(!m.material.depthWrite);assert(m.material.forceSinglePass);assert(shader.fragmentShader.includes('vFxAlpha'));}}
  fx.setAdapt(2);fx.update(.1,camera,h);assert(fx.fish.count<=14);assert.equal(fx.state.drops.filter(p=>p.life>0).length,21);
  fx.setAdapt(3);fx.contact({},h);fx.update(.1,camera,h);assert(fx.group.children.every(m=>m.count===0));fx.setAdapt(0);fx.contact({},h);fx.update(.1,camera,h);
  assert.deepEqual(fx.group.children.map(m=>m.instanceMatrix),matrices);
  const begin=performance.now();for(let i=0;i<10000;i++){if(i%15===0)fx.contact({},h);fx.update(1/60,camera,h);}console.log('W2c-9d synthetic Node update ms/frame:',(performance.now()-begin)/10000);
  console.log('W2c-9d max draws/triangles:',3,24*2+192*2+56*60);
  fx.dispose();fx.dispose();assert([...resources.values()].every(n=>n===1));
  const off=buildKamakuraFx({terrain,data:{},search:'?fx=0&fish=0'});assert.equal(off.group.children.length,0);assert.equal(off.state,null);assert.equal(off.fish,null);off.dispose();
  const light=buildKamakuraFx({terrain,data:{rivers:data(river())},quality:'light'});assert.equal(light.state.drops.length,96);assert.equal(light.state.ripples.length,12);assert.equal(light.fish.fish.length,28);light.dispose();
});
test('water shader uses depth/edge opacity and preserves distance gate; release once',async()=>{
 const THREE=await import(threeURL),{buildKamakuraWater}=await import(await load('kamakura-water-view.js'));
 const {prepareRivers}=await import('../dist/valley/kamakura-rivers.js'); const prepared=prepareRivers(data(river()));const w=buildKamakuraWater(prepared,{terrain});
 const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};w.material.onBeforeCompile(shader);
 assert(shader.vertexShader.includes('attribute float waterDepth'));assert(shader.vertexShader.includes('vWDepth = waterDepth'));assert(shader.fragmentShader.includes('varying float vWDepth'));assert(shader.fragmentShader.includes('uWaterDistance'));assert.equal(shader.uniforms.uWaterAlpha.value.x,.5);
 assert(w.group.children.every(m=>[...m.geometry.attributes.waterDepth.array].every(d=>Math.abs(d-.5)<1e-5)));
 w.dispose();w.dispose();
});
test('school path does not depend on when its camera becomes visible; preparation yields in batches',async()=>{
 const a=createFishState(prep()),b=createFishState(prep()),near={x:0,z:0},far={x:500,z:500};
 for(let i=0;i<100;i++){a.update(.1,near,far);b.update(.1,far,far);}b.update(0,near,far);assert.equal(a.count,b.count);
 for(let i=0;i<a.count;i++){assert.equal(a.fish[i].x,b.fish[i].x);assert.equal(a.fish[i].z,b.fish[i].z);}
 const {prepareKamakuraFx}=await import(await load('kamakura-fx-view.js'));let yields=0;
 const r=river(Array.from({length:300},(_,i)=>[i*5,0]));const fx=await prepareKamakuraFx({terrain,data:{rivers:data(r)}},async()=>{yields++;},{sliceMs:0});assert(yields>=2);fx.dispose();
 let fast=0;const fx2=await prepareKamakuraFx({terrain,data:{rivers:data(r)}},async()=>{fast++;},{sliceMs:1e9});assert.equal(fast,0,'a long slice never yields (no per-step frame wait)');fx2.dispose();
});
test('private river FX pools and CPU update timing (no geographic output)',{skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定：私有の川データが必要'},async t=>{
 const path=await import('node:path'),{decodeRivers}=await import('../dist/valley/kamakura-rivers.js');
 const filename=path.join(process.env.KZ_WORLD_DIR,'rivers.json');if(!fs.existsSync(filename)){t.skip('rivers.json がない旧版');return;}
 const {loadKamakura}=await import('../dist/valley/kamakura-data.js'),{createKamakuraTerrain}=await import('../dist/valley/kamakura-terrain.js');
 const loaded=await loadKamakura(async url=>{
   const bytes=fs.readFileSync(path.join(process.env.KZ_WORLD_DIR,path.basename(url)));
   return {ok:true,json:async()=>{const value=JSON.parse(bytes);if(path.basename(url)==='meta.json'){delete value.houses;delete value.veg;delete value.facilities;}return value;},arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
 });
 const actualTerrain=createKamakuraTerrain(loaded),{buildKamakuraFx}=await import(await load('kamakura-fx-view.js')),THREE=await import(threeURL);
 const d=decodeRivers(JSON.parse(fs.readFileSync(filename,'utf8'))),fx=buildKamakuraFx({terrain:actualTerrain,data:{rivers:d}}),h=hero(),cam=new THREE.PerspectiveCamera();
 const candidate=prepareFishRivers(d,1,actualTerrain).segments.find(s=>s.habitat&&s.wa>=1.2&&s.wb>=1.2);assert(candidate);
 h.pos.x=candidate.ax+candidate.dx/2;h.pos.z=candidate.az+candidate.dz/2;h.pos.y=actualTerrain.heightAt(h.pos.x,h.pos.z);cam.position.set(h.pos.x,h.pos.y+2,h.pos.z+3);
 for(let i=0;i<1000;i++)fx.update(1/60,cam,h);
 const start=performance.now();for(let i=0;i<10000;i++){if(i%15===0)fx.contact({},h);fx.update(1/60,cam,h);assert(fx.fish.count>0&&fx.fish.count<=56);}
 console.log('W2c-9d private Node update ms/frame:',(performance.now()-start)/10000);fx.dispose();
});

test('saturated geometry budgets and outward fish body normals',async()=>{
 const {buildKamakuraFx}=await import(await load('kamakura-fx-view.js')),THREE=await import(threeURL);
 const dense=Array.from({length:12},(_,i)=>river([[-20,i*.2],[0,i*.2],[20,i*.2]]));
 const fx=buildKamakuraFx({terrain,data:{rivers:data(...dense)}}),h=hero(),camera=new THREE.PerspectiveCamera();
 for(let i=0;i<24;i++){fx.state.ripple(0,2.5,0);fx.api.dust({x:0,y:2,z:5},2);}
 fx.update(0,camera,h);assert(fx.fish.count<=14);
 // Explicitly saturate the preallocated output to verify the unchanged render budget.
 for(let i=fx.fish.count;i<56;i++)Object.assign(fx.fish.fish[i],fx.fish.fish[0]);
 const {buildFishView}=await import(await load('kamakura-fish-view.js'));
 const saturated=buildFishView({fish:fx.fish.fish,count:56});saturated.update();assert.equal(saturated.mesh.count,56);assert.equal(fx.group.children[0].count,24);assert.equal(fx.group.children[1].count,192);
 const mesh=fx.group.children[2],pos=mesh.geometry.attributes.position,normal=mesh.geometry.attributes.normal;
 for(let i=4;i<12;i++)assert(pos.getX(i)*normal.getX(i)+pos.getY(i)*normal.getY(i)>0,'fish body normals must face out');
 let triangles=56*mesh.geometry.index.count/3;for(const m of fx.group.children.slice(0,2))triangles+=m.geometry.index.count/3*m.count;assert.equal(triangles,3792);
 const begin=performance.now();for(let i=0;i<10000;i++)fx.update(0,camera,h);console.log('W2c-9d4 full particle/ripple pools, bounded fish Node dt=0 update ms/frame:',(performance.now()-begin)/10000);saturated.dispose();fx.dispose();
});

test('habitat excludes land/sea/shallow terrain and sea contacts produce no splash',()=>{
 for(const wet of [0,.46]){
 const t={...terrain,waterAt:()=>wet};const f=createFishState(prepareFishRivers(data(river()),1,t));f.update(.1,{x:0,z:0},{x:500,z:500});assert.equal(f.count,0);
 const fx=createFxState({terrain:t,rivers:prep()});fx.contact({},hero());assert(fx.drops.every(p=>p.life===0));
 }
 const t={...terrain,heightAt:()=>2.4};const f=createFishState(prepareFishRivers(data(river()),1,t));f.update(.1,{x:0,z:0},{x:500,z:500});assert.equal(f.count,0);
});

// W2c-9d2: regression for scan-order starvation; >40 far schools arrive first.
test('9d4 nearest selection, sparse near cap, 24m gate, foot exclusion and sizes',()=>{
 const farRivers=Array.from({length:60},(_,i)=>river([[16,-8-i*.1],[23,-8-i*.1]]));
 const nearRiver=river([[0,0],[6,0]]), prepared=prepareFishRivers(data(...farRivers,nearRiver));
 const nearest=prepared.segments.at(-1), camera={x:3,z:0}, state=createFishState(prepared);
 state.update(0,camera,camera);assert.equal(state.fish[0].school,nearest.id);
 for(let i=0;i<600;i++) {
   state.update(1/60,camera,camera);assert(state.count<=56);
   let near=0,big=0;
   for(let j=0;j<state.count;j++) {
     const f=state.fish[j],d=Math.hypot(f.x-camera.x,f.z-camera.z);assert(d>=2&&d<=24);if(d<=12)near++;
     assert(f.big ? f.size>=.35&&f.size<=.45 : f.size>=.15&&f.size<=.24);big+=+f.big;
   }
   assert(near<=6);assert(big<=1);
 }
 // Hero priority (outside the exclusion disc) and fallback to camera.
 const a=river([[0,0],[4,0]]), b=river([[18,0],[22,0]]);
 const r=prepareFishRivers(data(a,b)), f=createFishState(r,{limit:2});
 f.update(0,{x:0,z:0},{x:20,z:3});assert.equal(f.fish[0].school,r.segments[1].id);
 f.update(0,{x:0,z:3});assert.equal(f.fish[0].school,r.segments[0].id);
 const outside=createFishState(prepareFishRivers(data(river([[25,0],[26,0]]))));
 outside.update(0,{x:0,z:0});assert.equal(outside.count,0);
});

test('9d3 olive back and silver belly preserve specified linear pigment and depth contrast',async()=>{
 const {buildFishView}=await import(await load('kamakura-fish-view.js')),THREE=await import(threeURL);
 const view=buildFishView(createFishState(prep())),g=view.mesh.geometry,c=g.attributes.color,p=g.attributes.position;
 const luminance=i=>c.getX(i)*.2126+c.getY(i)*.7152+c.getZ(i)*.0722;
 assert(Math.abs(luminance(2)-(.2126*fishPigment(0,0)+.7152*fishPigment(1,0)+.0722*fishPigment(2,0)))<1e-6);
 assert(luminance(2)>.30&&luminance(2)<.40);assert(luminance(1)>.15);assert(luminance(0)<.05);
 assert(luminance(2)>luminance(0)*4);
 let min=Infinity,max=-Infinity;for(let i=0;i<p.count;i++){min=Math.min(min,p.getZ(i));max=Math.max(max,p.getZ(i));}assert.equal(max-min,1);
 const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};view.mesh.material.onBeforeCompile(shader);
 assert(shader.fragmentShader.includes('0.25+0.6*vFishDepth')); assert(shader.fragmentShader.includes('backLimit'));
 view.dispose();
});

test('private v0.9 three habitable points: 2–6 fish within 12m for 90% of 600 frames',
 {skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定：私有v0.9の川・地形が必要'},async()=>{
 const path=await import('node:path');
 const {loadKamakura}=await import('../dist/valley/kamakura-data.js'),{createKamakuraTerrain}=await import('../dist/valley/kamakura-terrain.js');
 const loaded=await loadKamakura(async url=>{
   const name=path.basename(url),bytes=fs.readFileSync(path.join(process.env.KZ_WORLD_DIR,name));
   return {ok:true,json:async()=>{const value=JSON.parse(bytes);if(name==='meta.json'){delete value.houses;delete value.veg;delete value.facilities;}return value;},arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
 });
 const terrain=createKamakuraTerrain(loaded);
 const prepared=prepareFishRivers(loaded.rivers,terrain.vscale,terrain);
 const habitats=prepared.segments.filter(s=>s.habitat&&Math.min(s.wa,s.wb)>=1.2&&Math.min(s.ya-s.ba,s.yb-s.bb)>=.35&&Math.min(s.ya,s.yb)>0);
 assert(habitats.length>=3);
 // Select runtime quartiles. Never store private coordinates or derived geometry.
 for(const fraction of [.25,.5,.75]) {
   const s=habitats[Math.floor((habitats.length-1)*fraction)],hero={x:s.ax+s.dx/2,z:s.az+s.dz/2},camera={x:hero.x,z:hero.z+3};
   const fish=createFishState(prepared),counts=[];let pass=0;
   for(let i=0;i<600;i++) {
     fish.update(1/60,camera,hero);let n=0;
     assert(fish.count<=56);
     for(let j=0;j<fish.count;j++) {
       const f=fish.fish[j],distance=Math.hypot(f.x-hero.x,f.z-hero.z);assert(distance>=2);
       assert(terrain.waterAt(f.x,f.z)>.05&&terrain.waterAt(f.x,f.z)<.46);
       assert(prepared.sampleAt(f.x,f.z).y-terrain.heightAt(f.x,f.z)>=.35);
       if(distance<=12)n++;
     }
     counts.push(n);if(n>=2&&n<=6)pass++;
   }
   counts.sort((a,b)=>a-b);
   console.log('W2c-9d4 private point summary (min / median / max / 2–6 fraction):',counts[0],(counts[299]+counts[300])/2,counts.at(-1),pass/600);
   assert(counts.at(-1)<=10);assert(pass/600>=.90);
 }
});

// W2c-9d3: test the generated shader (including Three chunks), not just JS parsing.
function shaderBalance(source) {
 const clean=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
 const stack=[];
 for(const token of clean.matchAll(/[{}()]/g)) {
   const t=token[0]; if(t==='{'||t==='(')stack.push(t);
   else assert.equal(stack.pop(),t==='}'?'{':'(','GLSL bracket nesting');
 }
 assert.equal(stack.length,0,'GLSL unclosed bracket');
 const pp=[];
 for(const m of clean.matchAll(/^\s*#\s*(if|ifdef|ifndef|elif|else|endif)\b/gm)) {
   if(['if','ifdef','ifndef'].includes(m[1]))pp.push(m[1]);
   else {assert(pp.length>0,'GLSL orphan conditional');if(m[1]==='endif')pp.pop();}
 }
 assert.equal(pp.length,0,'GLSL unclosed conditional');
}
function expandChunks(source,THREE) {
 return source.replace(/#include <([^>]+)>/g,(_,key)=>{assert.equal(typeof THREE.ShaderChunk[key],'string',key);return expandChunks(THREE.ShaderChunk[key],THREE);});
}
test('9d3 GLSL braces, parentheses and preprocessor pairs on every generated fish/FX shader',async()=>{
 for(const bad of ['void main(){ foo(1.0; }','void main() {}}','#ifdef A\nvoid main() {}','#endif']) assert.throws(()=>shaderBalance(bad));
 const THREE=await import(threeURL),{buildKamakuraFx}=await import(await load('kamakura-fx-view.js'));
 for(const quality of ['standard','light']) {
   const fx=buildKamakuraFx({terrain,data:{rivers:data(river())},quality});
   for(const mesh of fx.group.children) {
     const shader={...THREE.ShaderLib.basic};mesh.material.onBeforeCompile(shader);
     for(const stage of ['vertexShader','fragmentShader']) {
       shaderBalance(shader[stage]);shaderBalance(expandChunks(shader[stage],THREE));
     }
   }
   fx.dispose();
 }
});
test('9d3 fish shape budget, tail, dorsal, speed, heading spread, phases, depth and haze bounds',async()=>{
 const fish=createFishState(prep()),camera={x:0,z:0},far={x:500,z:500};
 for(let k=0;k<120;k++) {
   fish.update(.1,camera,far);
   const headings=[];
   for(let i=0;i<fish.count;i++) {
     const f=fish.fish[i];assert(f.speed>=.3&&f.speed<=.9);assert(f.variation>=.88&&f.variation<=1.12);assert(Math.abs(f.pitch)<=8*Math.PI/180);assert(Math.abs(f.roll)<=10*Math.PI/180);assert(f.sizeVariation>=.8&&f.sizeVariation<=1.2);
     assert(Math.abs(f.headingOffset)<=60*Math.PI/180+1e-9);
     if(f.school===fish.fish[0].school)headings.push(f.headingOffset*180/Math.PI);
     if(!f.jumping) {assert(f.depth>=.2&&f.depth<=.45);assert(f.y>=2.08);}
   }
   const mean=headings.reduce((a,b)=>a+b)/headings.length;
   const sd=Math.sqrt(headings.reduce((a,b)=>a+(b-mean)**2,0)/headings.length);assert(sd>=12);
   assert.notEqual(fish.fish[0].phase,fish.fish[1].phase);
 }
 const lum=rgb=>rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
 for(const d of [.2,.3,.45]) for(const variation of [.9,1,1.1]) {
   const back=[0,1,2].map(c=>fishHaze(c,1,d,variation)),belly=[0,1,2].map(c=>fishHaze(c,0,d,variation));
   assert(lum(FISH_WATER)-lum(back)>=.04-1e-9);assert(lum(belly)-lum(back)>.12);assert(fishMix(d)>=.25&&fishMix(d)<=.55);
 }
 const {buildFishView}=await import(await load('kamakura-fish-view.js')),view=buildFishView(fish),g=view.mesh.geometry,p=g.attributes.position;
 assert.equal(g.index.count/3,60);assert(g.index.count/3*56<=3400);
 assert(p.getY(0)-p.getY(2)>=.59,'vertical tail');assert(p.getY(29)>.25,'dorsal projection');
 assert.equal(view.mesh.material.transparent,false);view.dispose();
});
test('9d3 square white droplets, soft mist lifetime, landing micro-rings and double elliptical fading fronts',async()=>{
 const fx=createFxState({terrain,rivers:prep()}),h=hero();h.stepGait='run';fx.contact({},h);
 const live=fx.drops.filter(p=>p.life>0),mist=live.filter(p=>p.mist),drops=live.filter(p=>!p.mist);
 assert.equal(drops.length,32);assert.equal(mist.length,4);
 for(const p of drops) {assert(p.size>=.02&&p.size<=.05);assert(p.r>=.624&&p.r<=.889);assert(p.g>=.768&&p.g<=.939);assert(p.b>=.823&&p.b<=.957);}
 for(const p of mist) {assert(p.duration>=.4&&p.duration<=.6);assert(p.size>=.5&&p.size<=.9);}
 fx.update(.6);assert(mist.every(p=>p.life===0));fx.update(.35);assert(fx.ripples.some(r=>r.strength<.2&&r.life>0));
 assert(rippleWidth(.7)>rippleWidth(.08));assert(rippleWidth(.7)>rippleWidth(1.43));assert.notEqual(rippleWidth(.7,0),rippleWidth(.7,.5));
 assert(rippleSecondary(.3)>rippleSecondary(0));assert(rippleAspect()>1);
 let alpha=.5;for(let age=0;age<=1.3;age+=.01){const a=rippleAlpha(age);assert(a<=alpha+1e-9);alpha=a;}assert.equal(rippleAlpha(1.3),0);
 const THREE=await import(threeURL),{buildKamakuraFx}=await import(await load('kamakura-fx-view.js'));
 const view=buildKamakuraFx({terrain,data:{rivers:data(river())}}),camera=new THREE.PerspectiveCamera();camera.rotation.set(.3,.7,.2);view.contact({},h);view.update(.1,camera,h);
 const mesh=view.group.children[1],matrix=new THREE.Matrix4(),pos=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
 for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);matrix.decompose(pos,rotation,scale);assert(Math.abs(scale.x/scale.y-1)<1e-6);assert(Math.abs(rotation.dot(camera.quaternion))>1-1e-6);}
 const shader={...THREE.ShaderLib.basic};view.group.children[0].material.onBeforeCompile(shader);assert(shader.fragmentShader.includes('max(inner,outer)'));assert(shader.fragmentShader.includes('uneven'));
 view.dispose();
});

test('9p deferred effects allow movement before indexing, publish deterministic fish, and release once',async()=>{
  const {prepareKamakuraFx,buildKamakuraFx}=await import(await load('kamakura-fx-view.js')),THREE=await import(threeURL);
  const options={terrain,data:{rivers:data(river(Array.from({length:300},(_,i)=>[i*5-700,0])))}};
  let time=0;const fx=await prepareKamakuraFx(options,undefined,{defer:true,now:()=>time+=3}),h=hero(),camera=new THREE.PerspectiveCamera();
  assert.equal(fx.ready,false);assert.equal(fx.group.children.length,0);fx.api.dust(h.pos);fx.contact({},h);
  fx.update(.1,camera,h);assert.equal(fx.ready,false); // first draw does no index work
  fx.update(.1,camera,h);assert.equal(fx.ready,false);h.pos.x=1;fx.update(.1,camera,h);assert.equal(h.pos.x,1);
  for(let i=0;i<20&&!fx.ready;i++)fx.update(0,camera,h);assert(fx.ready);
  const reference=buildKamakuraFx(options);reference.update(0,camera,h);fx.update(0,camera,h);
  assert.deepEqual(fx.fish.fish,reference.fish.fish);assert.equal(fx.fish.count,reference.fish.count);
  const resources=new Map();fx.group.traverse(o=>{for(const r of [o.isMesh&&o,o.geometry,o.material].filter(Boolean)){resources.set(r,0);r.addEventListener('dispose',()=>resources.set(r,resources.get(r)+1));}});
  fx.dispose();fx.dispose();assert([...resources.values()].every(n=>n===1));assert.equal(fx.group.children.length,0);reference.dispose();
  const cancelled=await prepareKamakuraFx(options,undefined,{defer:true,now:()=>time+=3});cancelled.dispose();cancelled.update(.1,camera,h);assert.equal(cancelled.group.children.length,0);
});

// W2c-9d4: prevent reserved identifiers in generated code; includes are tested separately.
function shaderIdentifiers(source) {
 const clean=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
 const reserved=new Set('patch sample input output common filter active partition resource superp half fixed unsigned packed public static extern external interface long short double hvec2 hvec3 hvec4 fvec2 fvec3 fvec4 sampler3DRect'.split(' '));
 for(const m of clean.replace(/^\s*#.*$/gm,'').matchAll(/\b[A-Za-z_]\w*\b/g))assert(!reserved.has(m[0]),`reserved GLSL identifier: ${m[0]}`);
}
test('9d4 shader safety rejects reserved identifiers and checks modified fish fade/FX sources',async()=>{
 for(const name of ['patch','sample','input','output','common','filter','active'])assert.throws(()=>shaderIdentifiers(`float ${name}=0.0;`));
 const THREE=await import(threeURL),{buildKamakuraFx}=await import(await load('kamakura-fx-view.js'));
 const fx=buildKamakuraFx({terrain,data:{rivers:data(river())}});
 for(const mesh of fx.group.children){const shader={...THREE.ShaderLib.basic};mesh.material.onBeforeCompile(shader);
   for(const stage of ['vertexShader','fragmentShader']){shaderBalance(shader[stage]);shaderIdentifiers(shader[stage]);shaderBalance(expandChunks(shader[stage],THREE));}}
 const shader={...THREE.ShaderLib.basic};fx.group.children[2].material.onBeforeCompile(shader);assert(shader.fragmentShader.includes('>vFishAlpha) discard'));
 fx.dispose();
});
test('9d4 school flees at triple speed, fades in two seconds and returns elsewhere after 2.5s away',()=>{
 const prepared=prepareFishRivers(data(river([[0,0],[12,0]]))),state=createFishState(prepared),camera={x:6,z:0},far={x:100,z:100};
 state.update(0,camera,far);const initial={...state.fish[0]},s=prepared.segments[0];
 const close={x:initial.x,z:initial.z+3};state.update(0,camera,close);
 assert(s.fleeing);const start=state.fish.slice(0,state.count).find(f=>f.school===s.id);assert(start);assert(Math.abs(start.speed/(.3+s.id*.6)-3)<1e-9);
 const startX=start.x;state.update(.5,camera,close);const moving=state.fish.slice(0,state.count).find(f=>f.school===s.id);assert(moving);assert.equal(moving.alpha,.75);assert(Math.abs(moving.x-startX)>.1);
 state.update(1.5,camera,close);assert.equal(state.count,0);assert.equal(s.generation,0);
 state.update(0,camera,far);state.update(2.4,camera,far);assert.equal(state.count,0);state.update(.1,camera,far);assert.equal(s.generation,1);
 state.update(0,camera,far);assert(state.count>=2);assert(state.fish.slice(0,state.count).every(f=>f.alpha===1));assert.notEqual(state.fish[0].x,initial.x);
});
test('9d4 splash ballistic height, 60% walking, mist diameter and ripple reach; standing emits nothing',()=>{
 const run=createFxState({terrain,rivers:prep()}),walk=createFxState({terrain,rivers:prep()}),standing=createFxState({terrain,rivers:prep()}),h=hero();
 walk.contact({},h);h.stepGait='run';run.contact({},h);
 const drops=run.drops.filter(p=>p.life&&!p.mist),walking=walk.drops.filter(p=>p.life&&!p.mist);
 assert.equal(drops.length,32);assert.equal(walking.length,19);
 for(const p of drops)assert(p.vy*p.vy/14>=.3&&p.vy*p.vy/14<=.7);
 assert(Math.abs(walking[0].size/drops[0].size-.6)<1e-9);assert(Math.abs(walking[0].vy/drops[0].vy-.6)<1e-9);
 const ring=run.ripples[0];assert.equal(ring.radius,.15);
 // Use ripple-only pools so landing drops cannot overwrite the original slots.
 const rings=createFxState({terrain,rivers:prep()});rings.ripple(0,2.5,0,1);rings.ripple(0,2.5,0,.55);rings.update(1.3);
 assert(Math.abs(rings.ripples[0].radius-1.8)<1e-9);assert(Math.abs(rings.ripples[1].radius-1.4)<1e-9);
 standing.update(10);assert(standing.drops.every(p=>p.life===0));assert(standing.ripples.every(r=>r.life===0));
});


test('9d4 loose schools retain 0.4–1.2m longitudinal neighbour spacing',()=>{
 const prepared=prepareFishRivers(data(river([[0,0],[12,0]]))),state=createFishState(prepared),far={x:100,z:100};
 for(let frame=0;frame<600;frame++) {
   state.update(1/60,{x:6,z:0},far);assert(state.count>=2&&state.count<=5);
   for(let i=1;i<state.count;i++)assert(state.fish[i].x-state.fish[i-1].x>=.4-1e-9&&state.fish[i].x-state.fish[i-1].x<=1.2+1e-9);
 }
});
