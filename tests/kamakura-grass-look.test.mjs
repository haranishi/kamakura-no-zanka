// Synthetic ecology and shipped Three only; no private placement is stored here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {grassEcology,grassPush,grassRecovery,packGrassLook,createGrassEnvironment,grassLookEnabled} from '../dist/valley/kamakura-grass-look.js';
import {createGrassLook} from '../dist/valley/kamakura-grass-look-view.js';
import {createGrassCell,createGrassWindows} from '../dist/valley/kamakura-grass-field.js';
import {buildColliders} from '../dist/valley/collision.js';
import {fixture} from './helpers/kamakura-fixture.mjs';
import {load,THREE,source} from './helpers/tree-modules.mjs';
const {buildGrass}=await load('grass-view.js'),{buildKamakuraGrass}=await load('kamakura-grass-view.js');
globalThis.document={createElement(){const c={width:0,height:0,getContext:()=>({createLinearGradient:()=>({addColorStop(){}}),beginPath(){},moveTo(){},quadraticCurveTo(){},fill(){},getImageData:()=>({data:new Uint8ClampedArray(c.width*c.height*4)})})};return c;}};
const wind={uTime:{value:0},uWind:{value:1},uWindDir:{value:new THREE.Vector2(1,0)},uGuideMix:{value:0}};
const flat={heightAt:()=>10,slopeAt:()=>0,waterAt:()=>0,walkable:()=>true,riverDistanceAt:()=>Infinity};
const camera={position:new THREE.Vector3(0,12,0)};
const shaderFor=m=>{const s={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};m.onBeforeCompile(s);return s;};
const data=()=>{const d=fixture();d.meta.surface={};d.surface=new Uint8Array(d.meta.grid.width*d.meta.grid.height).fill(2);return d;};
const view=(search='',quality='standard')=>buildKamakuraGrass({data:data(),terrain:flat,wind,sunDir:new THREE.Vector3(1,1,0),quality,search});

test('world fields are repeatable; wetness, shade, management and 2.5–5m path shoulder are monotone',()=>{
  const at=options=>grassEcology(17,31,options), dry=at({river:30}),wet=at({river:0});
  assert(wet.height>dry.height&&wet.density>dry.density&&wet.dry<dry.dry);
  let last=0;for(let d=0;d<=30;d+=.25){const e=at({river:d});assert(e.dry>=last-1e-10);last=e.dry;}
  for(const axis of ['shade','house','path']){
    const values=axis==='shade'?[0,.25,.5,.75,1]:[0,2.5,3,4,5,7,9,15];let lastHeight,lastDensity;
    for(const v of values){const e=at({[axis]:v});if(lastDensity!==undefined){assert(axis==='shade'?e.density<=lastDensity:e.density>=lastDensity);assert(axis==='shade'||e.height>=lastHeight);}lastDensity=e.density;lastHeight=e.height;}
  }
  assert.equal(at({path:2.5}).edge,0);assert.equal(at({path:5}).edge,1);assert(at({path:3.75}).edge>.49&&at({path:3.75}).edge<.51);
  assert(at({sand:1,elevation:100}).dry>dry.dry);
  assert.deepEqual(at({}),at({}));
  const environmentAt=(x,z)=>grassEcology(x,z,{path:Math.abs(x),river:Math.abs(z)});
  const w=createGrassWindows(createGrassCell(flat,{surfaceCodeAt:()=>2,environmentAt}));w.plan({x:0,z:0});w.work(()=>0);const a=w.commit();
  w.plan({x:32,z:0});w.work(()=>0);const b=w.commit();
  const cold=createGrassWindows(createGrassCell(flat,{surfaceCodeAt:()=>2,environmentAt}));cold.plan({x:32,z:0});cold.work(()=>0);const c=cold.commit();
  for(const key of ['density','height','species','midPatch','heights'])assert.deepEqual(b[key],c[key]);assert(a.stats.evaluated>0);
});
test('live collision and indexed synthetic paths provide canopy, house and path fields',()=>{
  const col=buildColliders({bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100},extraCircles:[{x:0,z:0,r:.5,height:12}],extraBoxes:[{x:30,z:0,w:4,d:4}]});
  const env=createGrassEnvironment(flat,{colliders:col,paths:{road:{xyz_m:[[-30,30,0],[-30,-30,0]]}}});
  assert(env(1,0).shade>env(7,0).shade);assert(env(33,0).managed>env(43,0).managed);assert.equal(env(-28,0).edge,0);assert.equal(env(-24,0).edge,1);
});
test('flower field is sparse with coherent populated patches, bounded and desaturated; packed layers and seeds exist',()=>{
  let zeros=0,high=0,sum=0,diff=0;for(let z=-300;z<300;z+=3)for(let x=-300;x<300;x+=3){const f=grassEcology(x,z).flowers;assert(f>=0&&f<=1);zeros+=f===0;high+=f>.2;sum+=f;diff+=Math.abs(f-grassEcology(x+1,z).flowers);}
  assert(zeros>20000&&high>50);assert(diff/sum<.2);
  const raw=new Float32Array(100*15);for(let i=0;i<100;i++)raw.set([i*.17,10,0,0,.3,.03,.3,.5,.2,.3,.1,0,0,0,0],i*15);
  const env=()=>({height:1,dry:.2,shade:0,flowers:1});
  const packed=packGrassLook(raw,'near',env), light=packGrassLook(raw,'near',env,'light');
  let low=0,flowers=0,seeds=0;const colors=new Set();for(let i=0;i<packed.length;i+=15){const marker=packed[i+11];low+=marker===-1;flowers+=marker===-2;seeds+=marker===-3;if(marker===-2)colors.add(packed.subarray(i+8,i+11).join(','));if(marker===-1)assert(packed[i+4]>=.04&&packed[i+4]<=.120001);}
  assert.equal(low,100);assert(flowers>0&&flowers<=17);assert(seeds>0);assert(colors.size>=2);assert(light.length<packed.length);
  for(let i=0;i<light.length;i+=15)assert.notEqual(light[i+11],-1);
  assert.deepEqual(packGrassLook(raw,'near',env),packed);
});
test('push has zero endpoints, a bounded single maximum, and critically damped recovery',()=>{
  assert.equal(grassPush(0),0);assert.equal(grassPush(.8),0);assert.equal(grassPush(10),0);assert.equal(grassPush(.2,0),0);
  let prior=0;for(let i=0;i<=100;i++){const v=grassPush(.8/3*i/100);assert(v>=prior-1e-10&&v<=1.000001);prior=v;}
  for(let i=1;i<=100;i++){const v=grassPush(.8/3+(.8*2/3)*i/100);assert(v<=prior+1e-10&&v>=0);prior=v;}
  assert.equal(grassRecovery(0),1);assert(grassRecovery(1)<.001);assert(grassRecovery(.1)>grassRecovery(.2));
});
test('warm completes the first window and chunks; hero uniforms reuse storage, sprint widens, flight clears; shader hooks compose',()=>{
  const v=view();v.warm(camera);const stats=v.stats();assert.equal(stats.pending,false);assert.equal(stats.queue,0);assert.equal(stats.switches,1);assert(stats.lawn>0&&stats.tallBlades>0);assert(stats.flowers<=2000);
  const near=v.group.children[0].children.find(m=>m.name==='grass-near'),s=shaderFor(near.material),u=s.uniforms;
  const hero=u.uHero.value,trail=u.uGrassTrail.value;const pos={x:1,y:10,z:2};
  for(let i=0;i<20;i++)v.updateHero(pos,0,false,1/60);const walking=hero.w;
  v.updateHero(pos,5,false,1/60);assert(hero.w>walking);assert.equal(u.uHero.value,hero);assert.equal(u.uGrassTrail.value,trail);assert.equal(hero.x,1);
  const old=trail.slice();v.updateHero({x:100,y:10,z:100},5,false,.05);assert(trail.some((n,i)=>i%4===3&&n<old[i]));
  v.updateHero(pos,5,true,1/60);assert.equal(hero.w,0);assert.equal(u.uHeroStrength.value,0);for(let i=3;i<16;i+=4)assert.equal(trail[i],0);
  for(const text of ['grassPress','uGrassTrail[4]','pow(max(.005,1.0-t),.65)','normalize(iTip.yzw),0.78','vec3(.25,.17,.075)','smoothstep(4.5,6.0,dd)'])assert(s.vertexShader.includes(text),text);
  assert.match(s.fragmentShader,/float ridge/);assert.match(s.fragmentShader,/float glint/);assert.match(s.fragmentShader,/pow\(lc, vec3\(0.800\)\)/);assert.match(s.fragmentShader,/#include <fog_fragment>/);
  const resources=new Set();v.group.traverse(o=>{if(o.isMesh){resources.add(o.geometry);resources.add(o.material);if(o.material.map)resources.add(o.material.map);}});const disposed=new Map();for(const r of resources)r.addEventListener('dispose',()=>disposed.set(r,(disposed.get(r)||0)+1));
  const builds=stats.builds;v.setAdapt(2);assert.equal(v.stats().builds,builds);assert.equal(u.uGrassLookStep.value,2);assert.equal(v.stats().lawn,0);assert.equal(v.stats().flowers,0);assert.equal(near.geometry.drawRange.count,18);assert.equal(near.geometry.drawRange.start,0);
  v.setAdapt(3);assert.equal(v.group.visible,false);v.setAdapt(0);assert.equal(near.geometry.drawRange.count,36);assert.equal(near.geometry.drawRange.start,18);assert.equal(v.stats().nearBlades,stats.nearBlades);
  v.dispose();v.dispose();for(const n of disposed.values())assert.equal(n,1);assert.equal(disposed.size,resources.size);
});
test('light omits lawn, halves flower candidates; glook=0 restores 9b materials and counts',()=>{
  assert(!grassLookEnabled('?glook=0'));assert(grassLookEnabled(''));
  const light=view('','light');light.warm(camera);assert.equal(light.stats().lawn,0);const off=view('?glook=0');off.warm(camera);assert(!off.stats().improved);assert.equal(off.stats().lawn,undefined);
  for(const m of off.group.children[0].children){if(m.name==='grass-near')assert.equal(m.geometry.index.count,18);assert(!shaderFor(m.material).vertexShader.includes('uHero'));}
  light.dispose();off.dispose();
  const s=source('world-kamakura.js');assert(s.indexOf('grass.warm(camera, flight.pos)')<s.indexOf('renderer.setAnimationLoop(now'));assert.match(s,/grass.updateHero\(hero.pos, hero.speed, flight.active, paused \? 0 : dt\)/);
  assert.match(s,/if \(!flight.active\) rig.update\(0, hero.pos/);
});
test('pure grass look sources do not reference renderer, DOM, clock or unseeded randomness',()=>{
  const s=source('kamakura-grass-look.js').replace(/\/\/.*$/gm,'');for(const pattern of [/from 'three'/,/document\./,/performance\./,/Math\.random/,/Date\.now/])assert(!pattern.test(s));
});

// Captured from the unmodified 9b renderer before adding look (synthetic fixture).
function fingerprint(buildGrass,quality,species){
 const nx=64,n=nx*nx,field={seed:1333,x0:-32,z0:-32,nx,nz:nx,placeable:new Uint8Array(n).fill(1),density:new Uint8Array(n).fill(159),height:new Uint8Array(n).fill(255),species:new Uint8Array(n).fill(species),midPatch:new Float32Array(n).fill(1.6),heights:new Float32Array((nx+1)**2)};
 const v=buildGrass({field,quality,wind:{uTime:{value:0},uWind:{value:1},uWindDir:{value:new THREE.Vector2(1,0)},uGuideMix:{value:0}},sunDir:new THREE.Vector3(1,1,0)});
 v.warm({position:new THREE.Vector3(0,2,0)});const hash=createHash('sha256'),materials=new Set();
 for(const m of v.group.children){ const g=m.geometry;hash.update(m.name+':'+g.instanceCount);for(const a of [g.attributes.position.array,g.attributes.uv.array,g.index.array,g.attributes.iRoot.data.array.subarray(0,g.instanceCount*15)])hash.update(Buffer.from(a.buffer,a.byteOffset,a.byteLength));materials.add(m.material); }
 for(const m of materials){const shader={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};m.onBeforeCompile(shader);hash.update(shader.vertexShader);hash.update(shader.fragmentShader);hash.update(m.customProgramCacheKey());}
 v.dispose();return hash.digest('hex');
}
test('omitted look keeps original packed bytes, geometry, counts and complete compiled shader strings',()=>{
  const expected={standard:['1a1d68b04ea5487f1f8176a9ca1387eb6e3fb918ac835fb5063b09ccf25b2ca8','b2ae1e972f3d288dff59b62746177b54711583a4e4a60b56b9d0a3153c8136ba','074c5444fa7cb87c81c39a06aee02dbc16b9f95e6ed3be1bb14b59da9c593e0f'],light:['70b905ab38e17ec410dc68dd2c9781326d51c2e7d51ab7ea6991276faaadfd79','88b624e2bbf6e2f4a7a84e66578ed6343cb7db4f3817f511b4e4f95ab4521f7f','1f70ce2214548f1e9db2fb140588e3482d6bb5fe459fb5f5ed9cfff8552f4129']};
  for(const quality of ['standard','light'])for(const [i,species]of [0,2,4].entries())assert.equal(fingerprint(buildGrass,quality,species),expected[quality][i]);
});
test('private synchronous warm and A/B CPU measurements emit aggregates only',{skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定：私有v0.9なし'},async t=>{
  const {validateGrassLook}=await import('./helpers/kamakura-grass-look-validation.mjs');
  const r=await validateGrassLook(process.env.KZ_WORLD_DIR);if(r.skipped)return t.skip(r.skipped);
  assert(r.samples>=1);assert(r.counts.flowers.max<=2000);assert(r.counts.lawn.max>0);assert(r.warmMs.max>0);t.diagnostic(JSON.stringify(r));
});
test('dense synthetic flowers stay below 2000; stage2 streamed and pooled geometry stays coarse without replacements',t=>{
  const nx=192,n=nx*nx,field={seed:1333,x0:-96,z0:-96,nx,nz:nx,placeable:new Uint8Array(n).fill(1),density:new Uint8Array(n).fill(159),height:new Uint8Array(n).fill(255),species:new Uint8Array(n),midPatch:new Float32Array(n).fill(1.6),heights:new Float32Array((nx+1)**2)};
  const look=createGrassLook(()=>({height:1,dry:.25,shade:0,flowers:1}),'standard',{value:new THREE.Vector4()});
  const v=buildGrass({field,wind,sunDir:new THREE.Vector3(1,1,0),reach:{near:10,mid:70},look});
  v.warm(camera);const s=v.stats();assert(s.lawn>0&&s.flowers>0&&s.flowers<=2000);assert(s.midCards<=30000);t.diagnostic(JSON.stringify({syntheticDense:s}));
  const positions=new Set(v.group.children.map(m=>m.geometry.attributes.position.array));
  v.setLookQuality(2);v.setDensityScale(.6);assert.equal(v.stats().flowers,0);assert.equal(v.stats().lawn,0);
  for(const x of [36,-36,0]){const c={position:new THREE.Vector3(x,12,0)};v.warm(c);assert.equal(v.stats().flowers,0);for(const m of v.group.children)if(m.name==='grass-near')assert.deepEqual(m.geometry.drawRange,{start:0,count:18});}
  assert(v.group.children.some(m=>positions.has(m.geometry.attributes.position.array)));
  v.setLookQuality(0);v.setDensityScale(1);assert.equal(v.stats().nearBlades,s.nearBlades);v.dispose();
});

test('look owns seed heads: legacy elevated susuki clumps cannot float above short leaves',()=>{
  const nx=64,n=nx*nx,field={seed:1333,x0:-32,z0:-32,nx,nz:nx,placeable:new Uint8Array(n).fill(1),density:new Uint8Array(n).fill(159),height:new Uint8Array(n).fill(255),species:new Uint8Array(n).fill(2),heights:new Float32Array((nx+1)**2)};
  const look=createGrassLook(()=>({height:1,dry:.3,shade:0,flowers:0}),'standard',{value:new THREE.Vector4()});
  const v=buildGrass({field,wind,sunDir:new THREE.Vector3(1,1,0),look});v.warm(camera);
  for(const m of v.group.children)if(m.name==='grass-near'){const a=m.geometry.attributes.iRoot.data.array;for(let i=0;i<m.geometry.instanceCount;i++)assert(a[i*15+1]<=0);}
  v.dispose();
});

test('near packed tips carry terrain normals and normalBlend follows the slope',()=>{
  const slope={...flat,heightAt:(x,z)=>10+.2*x-.1*z},env=createGrassEnvironment(slope);
  const e=env(0,0,true);assert(Math.abs(e.normalX+.2/Math.sqrt(1.05))<1e-10);assert(Math.abs(e.normalZ-.1/Math.sqrt(1.05))<1e-10);
  const raw=new Float32Array([0,10,0,0,.3,.03,.3,.5,.2,.3,.1,0,0,0,0]);const a=packGrassLook(raw,'near',env);assert(Math.abs(a[12]-e.normalX)<1e-7);assert(Math.abs(a[13]-e.normalY)<1e-7);assert(Math.abs(a[14]-e.normalZ)<1e-7);
});
