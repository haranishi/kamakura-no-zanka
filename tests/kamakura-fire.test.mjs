import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as THREE from '../dist/vendor/three.module.min.js';
import { FIRE, FIRE_SMOKE_GLSL, fireEnabled, fireDayGain, validateFires, selectFireHouses, prepareFires, fireCounts, smokeProfile } from '../dist/valley/kamakura-fire.js';
import { createKamakuraFire, FIRE_VERTEX, FIRE_FRAGMENT, FIRE_POOL_VERTEX, FIRE_POOL_FRAGMENT } from '../dist/valley/kamakura-fire-view.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { validateMeta } from '../dist/valley/kamakura-data.js';
import { readPrivateData } from '../tools/lib/kamakura-validation.mjs';
const source=name=>fs.readFileSync(new URL('../dist/valley/'+name,import.meta.url),'utf8');
const meta={grid:{width:301,height:301,cell_m:2}};
const fire=(x=0,y=0,strength=1)=>({x,y,radius_m:30,strength});
const boxes=Array.from({length:12},(_,i)=>({id:'house-'+i,x:(i%4)*5-7,z:Math.floor(i/4)*6-6,w:4,d:5,height:5,rotY:.2}));
function fixture(options={}){
  const {search='?debug=1&time=evening',quality='standard',houses=boxes}=options, fires=Object.hasOwn(options,'fires')?options.fires:[fire()];
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();camera.position.set(-250,65,-220);scene.fog=new THREE.FogExp2('#8a9ab0',.001);
  const context={scene,camera,search,quality,data:{meta:{...meta,fires}},terrain:{heightAt:(x,z)=>2+x*.02+z*.01},houses:{boxes:houses},
    wind:{uWind:{value:1},uWindDir:{value:new THREE.Vector2(.8,.2)}}};
  const layer=createKamakuraFire(context),frame={dt:1/60,camera,pos:{x:0,y:2,z:0},flying:false};
  return {context,layer,frame};
}

test('metadata accepts absent/empty and edge values; rejects malformed, out-of-map and out-of-range entries',()=>{
  for(const fires of [undefined,[],[fire()],[{x:-300,y:300,radius_m:4,strength:.2}]])validateFires(fires,meta);
  const bad=[null,{},'fires',Array.from({length:9},()=>fire()),[null],[{}],[{...fire(),x:301}],[{...fire(),y:-301}],
    ...['x','y','radius_m','strength'].flatMap(key=>[NaN,Infinity,'1',null,undefined].map(value=>[{...fire(),[key]:value}])),
    [{...fire(),radius_m:3.99}],[{...fire(),radius_m:30.01}],[{...fire(),strength:.199}],[{...fire(),strength:1.001}]];
  for(const input of bad)assert.throws(()=>validateFires(input,meta),/火元/);
  assert.throws(()=>validateFires([fire()],{}));
  // Follow the real loader's call chain, not only the standalone validator.
  assert(source('kamakura-data.js').includes('validateFires(m.fires, m);'));
  const valid={schema:'kz-world-web/0.1',grid:{...meta.grid,row0:'north',col0:'west',sample_position:'cell_center',x_axis:'east',y_axis:'north',z_axis:'up'},
    height:{encoding:'uint16-le',min_m:0,max_m:10,file:'height_u16.bin'},walk:{file:'walk_u8.bin',polygon_m:[[-10,-10],[10,-10],[10,10],[-10,10]]},
    spawn:{x:0,y:0,z:0,yaw_deg_clockwise_from_north:0},places:[],fires:[fire()]};
  assert.equal(validateMeta(valid),valid);assert.throws(()=>validateMeta({...valid,fires:[{...fire(),strength:2}]}),/火元/);
});

test('zero sources and fire=0 create no scene objects or debug hook',()=>{
  for(const opts of [{fires:undefined},{fires:[]},{search:'?fire=0'},{search:'?fire=0',fires:[{bad:true}]}]){
    const f=fixture(opts);assert.equal(f.layer,null);assert.equal(f.context.scene.children.length,0);
  }
  assert(fireEnabled(''));assert(!fireEnabled('?fire=0'));
});

test('house selection is deterministic, radius bounded and strength monotone; no house gives ground fire',()=>{
  const outside={...boxes[0],id:'outside',x:31,z:0};
  const high=selectFireHouses(fire(),[...boxes,outside]),low=selectFireHouses(fire(0,0,.2),boxes);
  assert.equal(high.length,6);assert.equal(low.length,2);assert(low.every(b=>high.includes(b)));
  assert.deepEqual(high,selectFireHouses(fire(),[...boxes,outside].reverse()));
  assert(high.every(b=>Math.hypot(b.x,b.z)<=30));
  const f=fixture({houses:[]}),p=prepareFires(f.context);assert(p.sources[0].houses[0].ground);assert.equal(p.sources[0].houses[0].x,0);f.layer.dispose();
  const g=fixture();g.context.data.houses={instances:[{id:high[0].id.slice(6),grounded:Array.from({length:16},(_,i)=>i===13?7:0)}]};
  const p2=prepareFires(g.context);assert.equal(p2.sources[0].houses[0].y,7);g.layer.dispose();
});

test('all counts fit 700 boards; light and adaptation reduce costs without losing any source',t=>{
  const f=fixture({fires:Array.from({length:8},()=>fire())}),p=prepareFires(f.context),measure=[];
  for(const quality of ['standard','light']){
    let previous=Infinity;
    for(let step=0;step<=3;step++){
      const count=fireCounts(p,quality,step);assert(count.boards<=700);assert(count.boards<=previous);previous=count.boards;
      assert(count.sources.every(s=>s.flames>=3&&s.glows>=2&&s.smoke>=4&&s.embers>0));
      if(quality==='standard'&&step===0)assert(count.sources.every(s=>s.embers>=20&&s.embers<=60));
      measure.push({quality,step,boards:count.boards});
    }
  }
  t.diagnostic(JSON.stringify(measure));f.layer.dispose();
});

test('smoke broadens and drifts with wind; CPU agrees with executable GLSL arithmetic and vanishes at the top',()=>{
  const body=FIRE_SMOKE_GLSL.match(/\{([\s\S]*)\}/)[1].replace(/vec2 drift=wind/g,'let drift=wind').replace(/float (\w+)=/g,'let $1=')
    .replace('let drift=wind*height*','let drift=windX*height*').replace('return vec4(radius,drift,','return [radius,drift,windZ*height*'+FIRE.smokeWind+'*t*t,').replace(/\);\s*$/,'];');
  const shader=new Function('t','height','windX','windZ','clamp',body),clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  let last=-1;
  for(const height of [90,160])for(const wx of [-1,0,1])for(const wz of [-.3,0,.5]){
    last=-1;
    for(const t of [0,.1,.5,.8,1]){
      const cpu=smokeProfile(t,height,wx,wz),gpu=shader(t,height,wx,wz,clamp);
      for(const [i,key] of ['radius','x','z','opacity'].entries())assert(Math.abs(cpu[key]-gpu[i])<1e-6);
      assert(cpu.radius>=last);last=cpu.radius;
      assert(cpu.x*wx>=0&&cpu.z*wz>=0);if(t===1)assert.equal(cpu.opacity,0);
    }
  }
  assert(FIRE_VERTEX.includes(FIRE_SMOKE_GLSL));assert(FIRE_FRAGMENT.includes(FIRE_SMOKE_GLSL));
  assert(FIRE_VERTEX.indexOf('vec3 toward=uCam-origin')>FIRE_VERTEX.indexOf('origin.y+=life'),'puffs face the eye from their raised/drifting position, including close views');
});

test('real scene batches, ground conformity, flame placement and quality counts agree with reported geometry',t=>{
  const f=fixture({fires:[fire(),fire(80,-50,.2),fire(-80,50,.6)]}),snap=globalThis.__kzFire;
  assert.equal(f.context.scene.children.filter(o=>o.isMesh).length,4);
  assert.equal(f.context.scene.children.filter(o=>o.isPointLight).length,1);
  const meshes=f.context.scene.children.filter(o=>o.isMesh),pool=meshes.find(m=>m.name.endsWith('pool'));
  for(let i=0;i<pool.geometry.attributes.position.count;i++){
    const p=pool.geometry.attributes.position;assert(Math.abs(p.getY(i)-f.context.terrain.heightAt(p.getX(i),p.getZ(i))-FIRE.poolLiftM)<1e-5);
  }
  for(const m of meshes){assert(!m.castShadow);assert(!m.frustumCulled);assert(!m.material.depthWrite);assert(m.material.forceSinglePass);}
  for(let step=0;step<=3;step++){
    f.layer.setAdapt(step);f.layer.update(f.frame);const s=snap();
    const sprites=meshes.filter(m=>m!==pool).reduce((n,m)=>n+m.geometry.instanceCount,0);
    assert.equal(s.triangles,sprites*2+pool.geometry.index.count/3);assert.equal(s.boards,sprites+3*FIRE.poolSegments**2);assert.equal(s.draws,4);
    const tongues=meshes[0].geometry.attributes.fireSize;
    for(let i=0;i<meshes[0].geometry.instanceCount;i++)if(tongues.getZ(i)===0)assert(tongues.getY(i)>=4&&tongues.getY(i)<=9);
    assert(s.nearest.distance>200);t.diagnostic(JSON.stringify(s));
  }
  f.layer.dispose();
});

test('every smoke quality overlaps vertically from ground to top, including the cheapest column',()=>{
  const f=fixture();for(let step=0;step<=3;step++){
    f.layer.setAdapt(step);const m=f.context.scene.children.find(o=>o.name==='kamakura-fire-smoke'),g=m.geometry;
    let lastTop=0;
    for(let i=0;i<g.instanceCount;i++){
      const t=g.attributes.fireSize.getW(i),height=g.attributes.fireAnchor.getW(i),p=smokeProfile(t,height),half=Math.max(p.radius*2*FIRE.smokeAspect,g.attributes.fireSize.getY(i))/2;
      const bottom=t*height-half,top=t*height+half;assert(bottom<=lastTop);lastTop=top;
    }
    assert(lastTop>=160);
  }f.layer.dispose();
});

test('point light selects only the nearest walking fire inside 80m; flight and distant views never add lights',()=>{
  const f=fixture({fires:[fire(),fire(70,0)]}),snap=globalThis.__kzFire;
  f.layer.update(f.frame);assert.equal(snap().lightSource,0);
  f.frame.pos.x=60;f.layer.update(f.frame);assert.equal(snap().lightSource,1);
  f.frame.pos.x=300;f.layer.update(f.frame);assert.equal(snap().light,0);
  f.frame.pos.x=0;f.frame.flying=true;f.layer.update(f.frame);assert.equal(snap().light,0);
  f.frame.flying=false;f.frame.pos.y=100;f.layer.update(f.frame);assert.equal(snap().light,0);
  const light=f.context.scene.children.find(o=>o.isPointLight);assert(!light.castShadow);f.layer.dispose();
});

test('frame updates reuse buffers, do not repack or resample terrain; pause and unchanged adaptation do no work',()=>{
  const f=fixture(),snap=globalThis.__kzFire,initial=snap().work;
  f.context.terrain.heightAt=()=>assert.fail('terrain queries belong only to construction');
  const buffers=f.context.scene.children.filter(o=>o.isMesh).map(m=>m.geometry.attributes.position.array);
  for(let i=0;i<200;i++)f.layer.update(f.frame);
  let s=snap();assert.equal(s.work.uploadedInstances,initial.uploadedInstances);assert.equal(s.work.terrainSamples,initial.terrainSamples);assert.equal(s.work.perFrameBoardUpdates,0);
  f.layer.setAdapt(0);assert.equal(snap().work.uploadedInstances,initial.uploadedInstances);
  f.layer.setPaused(true);const time=s.time;f.layer.update(f.frame);assert.equal(snap().time,time);
  assert.deepEqual(f.context.scene.children.filter(o=>o.isMesh).map(m=>m.geometry.attributes.position.array),buffers);
  f.layer.dispose();
});

test('daytime weakens additive light; distant glow retains a floor; debug colours cover all categories',()=>{
  assert.equal(fireDayGain('evening'),1);assert.equal(fireDayGain('dusk'),1);assert.equal(fireDayGain('noon'),.4);
  assert(FIRE.fogKeep>0);assert(FIRE_FRAGMENT.includes('max('+FIRE.fogKeep.toFixed(8)+',fog)'));
  for(const search of ['?time=evening','?time=noon','?firedebug=1&debug=1']){
    const f=fixture({search}),u=f.context.scene.children[0].material.uniforms;
    assert.equal(u.uDay.value,search.includes('evening')?1:.4);assert.equal(u.uPaint.value,search.includes('firedebug')?1:0);f.layer.dispose();
  }
});

test('source halos respect the authored radius multiplier even for small fires and distant cameras',()=>{
  for(const radius_m of [4,18,30])for(const strength of [.2,.8,1]){
    const f=fixture({fires:[{...fire(),radius_m,strength}],houses:[]}),g=f.context.scene.children[0].geometry;
    const diameter=g.attributes.fireSize.getX(g.instanceCount-1);
    assert(diameter>=radius_m*FIRE.glowRadiusMin*2-1e-5&&diameter<=radius_m*FIRE.glowRadiusMax*2+1e-5);
    f.context.camera.position.set(-450,60,0);f.layer.update(f.frame);assert.equal(g.attributes.fireSize.getX(g.instanceCount-1),diameter);f.layer.dispose();
  }
});

test('dispose releases each owned geometry/material/light once, removes hooks and silences retained methods',()=>{
  const f=fixture(),snap=globalThis.__kzFire,seen=[];
  const light=f.context.scene.children.find(o=>o.isPointLight),disposeLight=light.dispose.bind(light);let lightDisposed=0;
  light.dispose=()=>{lightDisposed++;disposeLight();};
  for(const o of f.context.scene.children){for(const resource of o.isMesh?[o.geometry,o.material]:[o])resource.addEventListener('dispose',()=>seen.push(resource));}
  const old=snap();f.layer.dispose();f.layer.dispose();f.layer.update(f.frame);f.layer.setAdapt(3);
  assert.equal(f.context.scene.children.length,0);assert.equal(seen.length,8);assert.equal(new Set(seen).size,8);assert.equal(lightDisposed,1);assert.equal(globalThis.__kzFire,undefined);assert.equal(f.layer.debugText(),'');assert.equal(snap().time,old.time);
  const g=fixture();globalThis.__kzFire=()=>42;g.layer.dispose();assert.equal(globalThis.__kzFire(),42);delete globalThis.__kzFire;
});

function syntax(code){
  const stripped=code.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g,'');const stack=[];
  for(const c of stripped){if('([{'.includes(c))stack.push(c);else if(')]}'.includes(c))assert.equal(stack.pop(),'([{'[')]}'.indexOf(c)]);}
  assert.equal(stack.length,0);assert.doesNotMatch(stripped,/--\s*\d|\b(?:float|vec[234]|int)\s+(?:sample|input|output|filter|active|common|resource)\b/);
}
test('all emitted shaders have balanced delimiters, safe identifiers and float arithmetic',()=>{
  for(const shader of [FIRE_VERTEX,FIRE_FRAGMENT,FIRE_POOL_VERTEX,FIRE_POOL_FRAGMENT]){syntax(shader);assert.doesNotMatch(shader,/(?<![\w.])\d+(?![\w.])/);}
  // Standalone shaders have no replacement hooks that could silently fail after a Three.js update.
  assert(![FIRE_VERTEX,FIRE_FRAGMENT,FIRE_POOL_VERTEX,FIRE_POOL_FRAGMENT].some(s=>s.includes('#include')));
  assert.throws(()=>syntax('float sample=1.0;'));assert.throws(()=>syntax('float n=1.--2.0;'));
});
test('GLSL compiler validates every vertex/fragment shader and rejects undeclared names / mixed numeric types',t=>{
  const version=spawnSync('glslc',['--version'],{encoding:'utf8'});if(version.error?.code==='ENOENT')return t.skip('glslc unavailable');assert.equal(version.status,0);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fire-glsl-'));
  try{
    const shaders=[['fire.vert',FIRE_VERTEX],['fire.frag',FIRE_FRAGMENT],['pool.vert',FIRE_POOL_VERTEX],['pool.frag',FIRE_POOL_FRAGMENT]];
    const compile=(name,shader)=>{
      const vertex=name.endsWith('vert'),prefix='#version 310 es\nprecision highp float;\n#define attribute in\n#define varying '+(vertex?'out':'in')+'\n'+
        (vertex?'in vec3 position;in vec2 uv;uniform mat4 modelViewMatrix,viewMatrix,projectionMatrix;\n':'out vec4 fireOut;\n#define gl_FragColor fireOut\n');
      const file=path.join(dir,name);fs.writeFileSync(file,prefix+shader);
      return spawnSync('glslc',['--target-env=opengl','-fauto-bind-uniforms','-fauto-map-locations',file,'-o',path.join(dir,'out.spv')],{encoding:'utf8'});
    };
    for(const [name,shader]of shaders){const result=compile(name,shader);assert.equal(result.status,0,result.stderr);}
    assert.notEqual(compile('bad.vert',FIRE_VERTEX.replace('uCam-origin','missingCamera-origin')).status,0);
    assert.notEqual(compile('bad.frag',FIRE_FRAGMENT.replace('vDepth-uFog.x','vDepth-ivec2(1,2)')).status,0);
    t.diagnostic('4 shader stages compiled; undeclared-name and numeric-type mutations rejected');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('private data only checks acceptance, exceptions and upper bounds without publishing any measurements',async t=>{
  if(!process.env.KZ_WORLD_DIR)return t.skip('KZ_WORLD_DIR未設定');
  const {data}=await readPrivateData(process.env.KZ_WORLD_DIR);assert.doesNotThrow(()=>validateFires(data.meta.fires,data.meta));
  const f=fixture({fires:[]});f.context.data=data;f.context.terrain=createKamakuraTerrain(data);
  const layer=createKamakuraFire(f.context);
  if(layer){const s=globalThis.__kzFire();assert(s.sources<=FIRE.maxSources);assert(s.boards<=FIRE.maxBoards);assert(s.draws<=5);layer.dispose();}
});
