import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {grass9Radius,grass9Blend,grass9DensityAt,grass9Retain,grass9Ahead,grass9Tiles,grass9Queue,grass9Distance,grass9NearChunks,grass9MidChunks,grass9Plan,GRASS9_DENSITY,GRASS9_CHUNKS,grass9WorkBudget} from '../dist/valley/kamakura-grass-stream.js';
import {createGrassLook} from '../dist/valley/kamakura-grass-look-view.js';
import {wantedChunks} from '../dist/valley/grass-schedule.js';
import {load,THREE} from './helpers/tree-modules.mjs';
const {buildGrass}=await load('grass-view.js');
globalThis.document={createElement(){const c={width:0,height:0,getContext:()=>({createLinearGradient:()=>({addColorStop(){}}),beginPath(){},moveTo(){},quadraticCurveTo(){},fill(){},getImageData:()=>({data:new Uint8ClampedArray(c.width*c.height*4)})})};return c;}};
const env=()=>({height:1,dry:.4,shade:.5,flowers:.1,margin:0,normalX:0,normalY:1,normalZ:0});
const wind={uTime:{value:0},uWind:{value:1},uWindDir:{value:new THREE.Vector2(1,0)},uGuideMix:{value:0}};
function field(size=192){const n=size*size;return {seed:1333,x0:-size/2,z0:-size/2,nx:size,nz:size,placeable:new Uint8Array(n).fill(1),density:new Uint8Array(n).fill(128),height:new Uint8Array(n).fill(128),species:new Uint8Array(n),midPatch:new Float32Array(n).fill(1.6),heights:new Float32Array((size+1)**2)};}
function setup(on=true,quality='standard',now=()=>0){
 const f=field(),camera={position:new THREE.Vector3(0,2,0)},stream=on?{chunkSizes:GRASS9_CHUNKS,budget:grass9WorkBudget,center:{value:new THREE.Vector2()},radiusUniform:{value:grass9Radius(quality)},position:{x:0,z:0},vx:0,vz:0,now,
 radius(){return this.radiusUniform.value;},distance(c){return grass9Distance(c,this.position.x,this.position.z);},
 tiles(f){return grass9Tiles(f,this.position.x,this.position.z,{quality,radius:this.radius(),vx:this.vx,vz:this.vz});},
 plan(f){return grass9Plan(f,this.position.x,this.position.z,{quality,radius:this.radius(),vx:this.vx,vz:this.vz});},
 queue(w,r){return grass9Queue(w,r,this.position.x,this.position.z);}}:null;
 const look=createGrassLook(env,quality,{value:new THREE.Vector4()},true,true,true,true,true,stream);
 const view=buildGrass({field:f,wind,quality,sunDir:new THREE.Vector3(1,1,0),reach:{near:32,mid:158,midInner:4},look,streaming:stream});
 return {view,stream,camera,look,f};
}
const shaders=m=>{const s={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};m.onBeforeCompile(s);return s;};
const expanded=s=>s.replace(/#include <(\w+)>/g,(_,k)=>expanded(THREE.ShaderChunk[k]));
function balanced(src){const code=src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g,''),stack=[],pairs={')':'(',']':'[','}':'{'};
 for(const c of code){if('([{'.includes(c))stack.push(c);if(')]}'.includes(c))assert.equal(stack.pop(),pairs[c]);}assert.equal(stack.length,0);
 let depth=0;for(const m of code.matchAll(/^\s*#(if\w*|endif|else|elif)\b/gm)){if(m[1].startsWith('if'))depth++;if(m[1]==='endif')assert(--depth>=0);}assert.equal(depth,0);
 assert(!/\b(?:float|vec[234])\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(code));
 assert(!/--\s*(?:\d|\.\d)/.test(code));assert(!/(?:\d)(?:mix|vec[234]|smoothstep|clamp)\(/.test(code));
}
test('GS1 constant six rings, world-keyed retention and continuous outer handoff',t=>{
 const count=new Array(6).fill(0),area=count.map((_,i)=>Math.PI*((i+1)**2-i*i)*25);
 for(let z=-30;z<30;z+=.07)for(let x=-30;x<30;x+=.07){const d=Math.hypot(x,z);if(d>=30)continue;assert.equal(grass9DensityAt(x,z,d),1);if(grass9Retain(x,z))count[Math.floor(d/5)]++;}
 const ratios=count.map((n,i)=>n*.07**2/area[i]/GRASS9_DENSITY);for(const r of ratios)assert(r>.85&&r<1.15);
 for(let i=0;i<500;i++){const x=i*.37,z=-i*.13;let old=0;for(let d=0;d<=49;d+=.1){const v=grass9Blend(x,z,d);assert(v>=old-1e-12);assert(v-old<.013);old=v;}assert.equal(old,1);}
 assert.deepEqual([grass9Radius(),grass9Radius('light'),grass9Radius('standard',2),grass9Radius('standard',3)],[30,20,20,12]);
 t.diagnostic(JSON.stringify({ringDensityRatios:ratios,retained:GRASS9_DENSITY,GRASS9_CHUNKS,grass9WorkBudget}));
});
test('GS3 pure corridor, nearest-first urgent work and speed-clamped forecast',()=>{
 const f=field(),tiles=grass9Tiles(f,0,0,{vx:8,vz:0}),chunks=wantedChunks(tiles,GRASS9_CHUNKS),queue=grass9Queue(chunks,new Map(),0,0);
 for(let i=1;i<queue.length;i++)assert(queue[i].dist>=queue[i-1].dist);
 assert.equal(grass9Ahead(0,0,8,0).lead,34);assert.equal(grass9Ahead(0,0,100,0).lead,60);
 assert.equal(grass9Ahead(0,0,0,0).x,0);
 const keys=new Set(chunks.near.map(c=>c.key));
 for(let x=0;x<=34;x+=2)for(let z=-30;z<=30;z+=2)assert(keys.has(`near:${Math.floor(x/6)},${Math.floor(z/6)}`));
});
test('GS1/2 actual packed roots, triangle budget, LOD shared attributes and balanced shader',t=>{
 const counts=[];
 for(const on of [false,true]){const {view,camera,stream}=setup(on);try{view.warm(camera);const s=view.stats();counts.push(s.triangles);
  if(!on)continue;
  assert.equal(s.holes30,0);assert.equal(s.appeared30,0);
  const rings=new Array(6).fill(0);let fine=0,coarse=0;
  for(const m of view.group.children)if(m.name==='grass-near'&&m.visible){const a=m.geometry.getAttribute('iRoot').data.array;
   const tris=m.geometry.drawRange.count/3;if(tris===12)fine++;else {assert.equal(tris,4);coarse++;}
   const idx=m.geometry.index.array;assert.deepEqual([...idx.slice(0,12)],[0,1,7,0,7,6,6,7,13,6,13,12]);
   for(let i=0;i<m.geometry.instanceCount*15;i+=15){const d=Math.hypot(a[i],a[i+2]);assert.equal(tris,d<12?12:4);if(d<30)rings[Math.floor(d/5)]++;}
  }
  assert(fine&&coarse);
  const rates=rings.map((n,i)=>n/(Math.PI*((i+1)**2-i*i)*25)),mean=rings.reduce((a,b)=>a+b,0)/(Math.PI*900);
  for(const r of rates)assert(r/mean>.85&&r/mean<1.15);
  for(const m of new Set(view.group.children.map(o=>o.material))){const s=shaders(m);for(const c of [s.vertexShader,s.fragmentShader]){balanced(c);balanced(expanded(c));}
   assert(s.vertexShader.includes('distance(rootWorld.xz,uGrass9Center)'));
   if(!m.map){assert(s.vertexShader.includes('float fadeOut = grass9Blend(rootWorld.xz,dd);'));assert(s.vertexShader.includes('float alive=1.0-grass9Blend(rootWorld.xz,dd);'));assert(!s.vertexShader.includes('alive*=(1.0-smoothstep(4.5,6.0,dd))'));assert(!s.fragmentShader.includes('grass4PixelWidth<.9)discard'),'subpixel blades stay inside the radius (the lawn would thin out)');assert(s.fragmentShader.includes('grass9Cap')&&/grass9Cap=mix\(4\.0,\.32,/.test(s.fragmentShader),'but a thin blade may not light up as a single warm-white pixel');}
  }
  t.diagnostic(JSON.stringify({ringBladesPerM2:rates,ringRatios:rates.map(r=>r/mean),fineChunks:fine,coarseChunks:coarse,stats:s}));
 }finally{view.dispose();}}
 assert(counts[1]<=counts[0]*1.6,`triangle budget: ${counts}`);t.diagnostic(JSON.stringify({oldTriangles:counts[0],newTriangles:counts[1],ratio:counts[1]/counts[0]}));
});
test('GS3 rendered stream tracks running/turning with no holes or late inner roots',()=>{
 let tick=0;const {view,camera,stream}=setup(true,'standard',()=>{tick+=.001;return tick;});
 try{view.warm(camera);
  for(let frame=0;frame<240;frame++){
   const x=Math.min(20,frame*8/60),z=frame>150?(frame-150)*8/60:0;
   stream.position.x=x;stream.position.z=z;stream.center.value.set(x,z);stream.vx=frame>150?0:8;stream.vz=frame>150?8:0;
   camera.position.set(x,2,z);view.update(camera);const s=view.stats();assert.equal(s.holes30,0,`frame ${frame}`);assert.equal(s.appeared30,0,`frame ${frame}`);
  }
 }finally{view.dispose();}
});
test('GS3 six-ms urgent budget is independent of two-ms background work',()=>{
 assert.equal(grass9WorkBudget(30),6);assert.equal(grass9WorkBudget(0),6);assert.equal(grass9WorkBudget(30.1),2);assert.equal(grass9WorkBudget(45),2);assert.equal(grass9WorkBudget(25,20),2);
 let tick=0;const {view,camera,stream}=setup(true,'light',()=>++tick);
 try{view.warm(camera);const before=view.stats().builds;
  stream.position.x=1;stream.vx=8;stream.center.value.x=1;camera.position.x=1;
  view.update(camera);assert(view.stats().builds-before<=2,'injected clock stops background work at 2ms');
  assert.equal(view.stats().holes30,0);assert.equal(view.stats().appeared30,0);
 }finally{view.dispose();}
});
test('GS2 exact packed attributes survive LOD, quality radii, teleport warm and once-only disposal',()=>{
 const {view,camera,stream,look}=setup();const resources=new Map();
 const watch=()=>view.group.traverse(m=>{for(const r of [m.geometry,m.material,m.material?.map].filter(Boolean))if(!resources.has(r)){resources.set(r,0);r.addEventListener('dispose',()=>resources.set(r,resources.get(r)+1));}});
 try{view.warm(camera);watch();
  const m=view.group.children.find(m=>m.name==='grass-near'&&m.visible&&m.geometry.boundingSphere.center.x>0&&m.geometry.boundingSphere.center.x<6&&m.geometry.boundingSphere.center.z>0&&m.geometry.boundingSphere.center.z<6);
  assert(m);const a=m.geometry.attributes.iRoot.data.array;
  const root=new Float32Array(a.slice(0,15)),buffer=a;
  // Move away from the same root: only index range changes, dimensions and pigment remain exact.
  stream.position.x=-15;stream.center.value.x=-15;stream.changed=true;camera.position.x=-15;view.warm(camera);
  const coarse=view.group.children.find(o=>o.visible&&o.geometry.boundingSphere===m.geometry.boundingSphere);assert(coarse);assert.equal(coarse.geometry.drawRange.count,12);assert.equal(m.geometry.attributes.iRoot.data.array,buffer);
  assert.equal(Buffer.compare(Buffer.from(root.buffer),Buffer.from(coarse.geometry.attributes.iRoot.data.array.slice(0,15).buffer)),0);
  assert.equal(Buffer.compare(Buffer.from(root.buffer),Buffer.from(buffer.slice(0,15).buffer)),0);
  for(const step of [2,3,0]){look.setAdapt(step);stream.radiusUniform.value=grass9Radius('standard',step);stream.changed=true;view.setLookQuality(step);view.update(camera);assert.equal(view.stats().radius30,[30,30,20,12][step]);assert.equal(view.stats().holes30,0);}
  watch();const builds=view.stats().builds;for(let i=0;i<100;i++)view.update(camera);assert.equal(view.stats().builds,builds);
  const hashes=new Set();for(const material of new Set(view.group.children.map(m=>m.material))){const s=shaders(material);hashes.add(createHash('sha256').update(s.vertexShader).digest('hex'));assert(s.vertexShader.indexOf('float grass9Blend(')>s.vertexShader.indexOf('float grass6Jitter('));}
  assert.equal(hashes.size,2);
 }finally{watch();view.dispose();view.dispose();}
 for(const n of resources.values())assert.equal(n,1);
});
test('grass9=0 restores R8 shader bytes and adaptive behavior; R9 warm/landing use hero centre',async()=>{
 const {fixture}=await import('./helpers/kamakura-fixture.mjs');
 const {buildKamakuraGrass}=await load('kamakura-grass-view.js');
 const d=fixture({width:257,height:257});d.meta.surface={};d.surface=new Uint8Array(257**2).fill(2);
 const terrain={heightAt:()=>10,slopeAt:()=>0,waterAt:()=>0,walkable:()=>true,riverDistanceAt:()=>Infinity};
 const camera={position:new THREE.Vector3(-4,12,0)},pos={x:0,y:10,z:0};
 const {view:base}=setup(false);base.warm(camera);
 const digest=s=>createHash('sha256').update(s.vertexShader).update(s.fragmentShader).digest('hex');
 const expected=new Map(base.group.children.map(m=>[!!m.material.map,digest(shaders(m.material))]));base.dispose();
 for(const on of [false,true]){
  const jobs=new Map();let id=0;
  const v=buildKamakuraGrass({data:d,terrain,search:on?'':'?grass9=0',wind,sunDir:new THREE.Vector3(1,1,0),now:()=>0,schedule:fn=>{jobs.set(++id,fn);return id;},cancel:key=>jobs.delete(key)});
  try{v.warm(camera,pos);assert.equal(v.stats().r9,on);
   for(const material of new Set(v.group.children[0].children.map(m=>m.material))){const s=shaders(material);if(!on)assert.equal(digest(s),expected.get(!!material.map));else {assert.equal(s.uniforms.uGrass9Center.value.x,pos.x);assert(material.customProgramCacheKey().includes('-r9'));}}
   for(const step of [2,3,0]){v.setAdapt(step);v.update(camera,pos);if(on){assert(v.group.visible);assert.equal(v.stats().radius30,grass9Radius('standard',step));assert.equal(v.stats().holes30,0);}else assert.equal(v.group.visible,step!==3);}
   if(on){
    for(const x of [7,26]){v.warm(camera,{x,y:10,z:0});assert.equal(v.stats().holes30,0);}
    const builds=v.stats().builds;v.warm(camera,{x:60,y:10,z:40});assert.equal(v.stats().holes30,0);assert.equal(v.stats().appeared30,0);assert(v.stats().builds>builds);assert(v.stats().nearBlades>0);
    v.updateHero(pos,0,true,1/60);v.warm(camera,pos);assert.equal(v.stats().holes30,0);assert.equal(v.stats().appeared30,0);
   }
  }finally{v.dispose();assert.equal(jobs.size,0);}
 }
});

test('GS3 urgent metre window bypasses the ordinary 32m replanning guard',async()=>{
 const {createGrassWindows}=await import('../dist/valley/kamakura-grass-field.js');
 const w=createGrassWindows(()=>({placeable:1,density:128,height:128,species:0,midPatch:1,heights:[0,0,0,0]}),{size:144});
 try{w.plan({x:0,z:0});w.work(()=>0);w.commit();assert(!w.plan({x:19,z:0},144));assert(w.plan({x:19,z:0},144,true));w.work(()=>0);assert(w.commit());}finally{w.dispose();}
});

test('GS4 chunk-level plans cover exactly the tile-level plans',()=>{
 let seed=12345;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const big={x0:-900,z0:-900,nx:1800,nz:1800};
 for(const quality of ['standard','light'])for(let n=0;n<120;n++){
  const x=(rnd()-.5)*800,z=(rnd()-.5)*800,angle=rnd()*Math.PI*2,speed=rnd()*10,radius=[30,20,12][Math.floor(rnd()*3)];
  const o={quality,radius,vx:Math.cos(angle)*speed,vz:Math.sin(angle)*speed},tiles=grass9Tiles(big,x,z,o),wanted=wantedChunks(tiles,GRASS9_CHUNKS);
  const near=grass9NearChunks(big,x,z,o);
  assert.deepEqual(near.map(c=>c.key).sort(),wanted.near.map(c=>c.key).sort(),`near ${quality} ${radius} ${x} ${z}`);
  for(let i=1;i<near.length;i++)assert(near[i].dist>=near[i-1].dist);
  // Mid: a chunk holds the whole tile ring it overlaps, so the chunk plan may only add the boundary chunks (<=6%).
  const mid=new Set(grass9MidChunks(big,x,z,o).map(c=>c.key)),tiled=wanted.mid.map(c=>c.key);
  for(const k of tiled)assert(mid.has(k),`mid chunk ${k} lost: ${quality} ${radius} ${x} ${z}`);
  assert(mid.size<=tiled.length*1.06,`mid chunks ${mid.size} vs ${tiled.length}`);
 }
 // A window edge only removes whole chunks that cannot hold a tile of the field; it never adds a chunk the tile plan lacks.
 const edge={x0:-40,z0:-40,nx:80,nz:80},o={quality:'standard',radius:30,vx:8,vz:0};
 const tiled=new Set(wantedChunks(grass9Tiles(edge,0,0,o),GRASS9_CHUNKS).near.map(c=>c.key));
 for(const c of grass9NearChunks(edge,0,0,o))assert(tiled.has(c.key)||c.cx*6<edge.x0+edge.nx&&(c.cx+1)*6>edge.x0,c.key);
 const plan=grass9Plan(edge,0,0,o);assert(plan.near.length&&plan.mid.length);
});
test('GS4 skipped resubmits leave exactly the blades a full resubmit gives',()=>{
 const blades=(view,cx,cz,reach)=>{const out=new Map();
  for(const m of view.group.children)if(m.name==='grass-near'&&m.visible){const a=m.geometry.getAttribute('iRoot').data.array,tris=m.geometry.drawRange.count/3;
   for(let i=0;i<m.geometry.instanceCount*15;i+=15)if(Math.hypot(a[i]-cx,a[i+2]-cz)<=reach)out.set(`${a[i].toFixed(4)},${a[i+2].toFixed(4)}`,tris);}
  return out;};
 let tick=0;const {view,camera,stream}=setup(true,'standard',()=>{tick+=.001;return tick;});
 const fresh=setup(true,'standard',()=>0);
 try{view.warm(camera);
  let x=0,z=0;
  for(let frame=0;frame<420;frame++){
   if(frame<260){x+=8/60;z+=frame>120?3/60:0;}
   stream.position.x=x;stream.position.z=z;stream.center.value.set(x,z);stream.vx=frame<260?8:0;stream.vz=frame<260&&frame>120?3:0;
   camera.position.set(x,2,z);view.update(camera);
  }
  // The view replans once the player has moved a metre: end on a replan so both views describe the same position.
  x+=1.01;stream.position.x=x;stream.center.value.set(x,z);stream.vx=0;stream.vz=0;camera.position.set(x,2,z);for(let frame=0;frame<30;frame++)view.update(camera);
  const s=view.stats();assert.equal(s.queue,0,'queue drained');assert.equal(s.holes30,0);assert(s.submitSkipped>s.replans*20,`skipped ${s.submitSkipped} over ${s.replans} replans`);
  fresh.stream.position.x=x;fresh.stream.position.z=z;fresh.stream.center.value.set(x,z);fresh.camera.position.set(x,2,z);fresh.view.warm(fresh.camera);
  const a=blades(view,x,z,44),b=blades(fresh.view,x,z,44);
  assert(a.size>1000);assert.equal(a.size,b.size);
  let bad=0;for(const [k,v] of b)if(a.get(k)!==v)bad++;
  assert.equal(bad,0,'same roots with the same level of detail');
  assert.equal(view.stats().appeared30,0);
 }finally{view.dispose();fresh.view.dispose();}
});

