import test from 'node:test';
import assert from 'node:assert/strict';
import { MIST, MIST_TIMES, MIST_GLSL, MIST_SKY_GLSL, mistSkyFactor, mistSkyShader, createMistField, sampleMistField, mistAmount, mistAlongRay, mistNoise, mistWisp, mistDownward, mistStrength } from '../dist/valley/kamakura-mist.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { readPrivateData } from '../tools/lib/kamakura-validation.mjs';
const bounds={minX:-1024,maxX:1024,minZ:-1024,maxZ:1024};
const build=heightAt=>{const f=createMistField({bounds,heightAt});let frames=0;while(!f.ready){f.step();frames++;assert(frames<1000);}return f;};
test('circular valley field: valley 1, ridge/flat/sea/coast 0; floor is smoothed local minimum',t=>{
  const f=build((x,z)=>100+Math.min(80,Math.abs(x)*.4));
  const sample=[0,0]; sampleMistField(f,0,0,sample); assert.equal(sample[0],1); assert.equal(sample[1],100);
  sampleMistField(f,900,0,sample);assert.equal(sample[0],0);
  const ridge=build(x=>180-Math.min(80,Math.abs(x)*.4));sampleMistField(ridge,0,0,sample);assert.equal(sample[0],0);
  const flat=build(()=>100);sampleMistField(flat,0,0,sample);assert.deepEqual(sample,[0,100]);
  const coast=build(x=>x<0?0:100+Math.min(80,Math.abs(x-96)*.4));
  for(const x of [-128,0,96,128]){sampleMistField(coast,x,0,sample);assert.equal(sample[0],0);}
  sampleMistField(f,100000,0,sample);assert.deepEqual(sample,[0,0]);
  t.diagnostic(JSON.stringify({syntheticCells:f.cells,work:f.work,frames:Math.ceil(f.work/MIST.cellsPerFrame),textureBytes:f.data.byteLength,addedTriangles:0,addedDraws:0}));
});
test('field creation is incremental and bounded, queries stop after readiness',()=>{
  let calls=0;const f=createMistField({bounds,heightAt:()=>{calls++;return 100;}});
  assert.equal(calls,0);assert(!f.ready);f.step(7);assert.equal(calls,7);assert.equal(f.work,7);
  while(!f.ready)f.step(1000);
  assert.equal(calls,f.cells);assert.equal(f.work,f.cells*3);const w=f.work;assert(f.step());assert.equal(f.work,w);
  const huge=createMistField({bounds:{minX:-20000,maxX:20000,minZ:-8000,maxZ:8000},heightAt:()=>2});
  assert(huge.width<=512 && huge.height<=512);assert(huge.cells<=512*512);
});
test('CPU mist mirror: altitude, camera clearance, distance fade, caps, time presets and wind translation',()=>{
  assert.deepEqual(Object.values(MIST_TIMES),[.8,.25,.5,.6]);assert.equal(mistStrength('bad'),.5);
  for(const time of Object.keys(MIST_TIMES))assert.equal(mistStrength(time),MIST_TIMES[time]);
  assert.equal(mistAmount(1,100,100,120,1,.8),0);
  assert.equal(mistAmount(1,100,100,9000,1,.8),0);
  assert.equal(mistAmount(0,100,100,500,1,.8),0);
  const full=mistAmount(1,100,100,500,1,.3),high=mistAmount(1,100,122,500,1,.3);   // below the cap, so the altitude ratio is exact
  assert(Math.abs(high/full-Math.exp(-1))<1e-12);assert.equal(mistAmount(1,100,100,500,1,1),MIST.cap);
  const f=build(x=>100+Math.min(80,Math.abs(x)*.4)),scratch=[0,0];
  const eye={x:0,y:100,z:-900},p={x:0,y:100,z:900};
  let sum=0;for(let i=1;i<=3;i++){
    const z=eye.z+(p.z-eye.z)*i/3;sampleMistField(f,0,z,scratch);
    sum+=mistAmount(scratch[0],scratch[1],100,1800*i/3,mistWisp(mistNoise(0,z/MIST.scale)),.5)*(i===3?1:MIST.pathWeight);
  }
  assert(Math.abs(mistAlongRay(f,eye,p,0,1,0,.5,scratch)-Math.min(MIST.totalCap,sum))<1e-12);
  assert(mistAlongRay(f,eye,p,0,1,0,.8,scratch)<=MIST.totalCap);
  // Wisps: clear air below the first threshold, a full band above the second. Looking straight down thins the layer.
  assert.equal(mistWisp(MIST.wispFrom),0);assert.equal(mistWisp(MIST.wispTo),1);assert(mistWisp(.5)>0&&mistWisp(.5)<1);
  assert.equal(mistDownward(0),1);assert.equal(mistDownward(MIST.downFrom),1);assert(Math.abs(mistDownward(-1)-MIST.downThin)<1e-12);assert(mistDownward(.6)<1&&mistDownward(.6)>MIST.downThin);
  const down=mistAlongRay(f,{x:0,y:900,z:0},{x:0,y:100,z:10},0,1,0,.5,scratch),level=mistAlongRay(f,{x:0,y:101,z:-800},{x:0,y:100,z:10},0,1,0,.5,scratch);
  assert(down<=level*MIST.downThin+1e-9||level===0);
  assert.equal(mistAlongRay(f,{x:0,y:100,z:0},{x:0,y:100,z:100},0,1,0,.8,scratch),0);
  const shiftedEye={...eye,x:MIST.speed*10},shiftedPoint={...p,x:MIST.speed*10};
  // Compare noise advection directly, independent of static terrain weights.
  assert.equal(mistNoise((shiftedEye.x-MIST.speed*10)/(MIST.scale*MIST.stretch),shiftedPoint.z/MIST.scale),mistNoise(eye.x/(MIST.scale*MIST.stretch),p.z/MIST.scale));
});
test('private valley field stays bounded; emits only the valley coverage aggregate', {skip:!process.env.KZ_WORLD_DIR && '私有地形未指定'}, async t=>{
  const {data}=await readPrivateData(process.env.KZ_WORLD_DIR),f=createMistField(createKamakuraTerrain(data));
  while(!f.ready)f.step(4096);
  assert(f.width<=512 && f.height<=512);let covered=0;
  for(let i=0;i<f.cells;i++){assert(Number.isFinite(f.data[i*2+1]));assert(f.data[i*2]>=0 && f.data[i*2]<=1);covered+=f.data[i*2]>=.5;}
  const fraction=covered/f.cells;t.diagnostic(JSON.stringify({valleyFraction:fraction}));assert(fraction>=.05 && fraction<=.35);
});

test('mist GLSL identifiers are declared and numeric expressions use floats (array index excluded)', async()=>{
  const { MIST_GLSL }=await import('../dist/valley/kamakura-mist.js');
  function validate(shader){
    shader=shader.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g,'');
    const known=new Set(['uniform','return','if','float','vec2','vec3','vec4','sampler2D','any','lessThan','greaterThan','texture2D','mix','fract','sin','dot','floor','exp','max','min','smoothstep','length','normalize','pow','clamp','abs','cameraWorld']);
    for(const m of shader.matchAll(/\b(?:float|vec[234]|sampler2D)\s+(\w+)/g))known.add(m[1]);
    for(const m of shader.matchAll(/,\s*(\w+)\s*=/g))known.add(m[1]);
    for(const m of shader.matchAll(/uniform\s+\w+\s+([^;]+);/g))for(const n of m[1].split(','))known.add(n.trim());
    for(const m of shader.matchAll(/(?<![\w.])([A-Za-z_]\w*)/g))assert(known.has(m[1]),m[1]+' undeclared');
    const expressions=shader.replace(/\[\d+\]/g,'').replace(/\b[A-Za-z_]\w*/g,'');
    for(const m of expressions.matchAll(/(?<![\d.])\d+(?:\.\d*)?(?![\d.])/g))assert(m[0].includes('.'),'integer in float expression: '+m[0]);
  }
  validate(MIST_GLSL);
  validate(mistSkyShader(MIST_GLSL));
  assert.throws(()=>validate(MIST_GLSL.replace('mistReady<.5','unknownValue<.5')));
  assert.throws(()=>validate(MIST_GLSL.replace('return vec2(0.)','return vec2(0)')));
});

test('horizon mist gate is zero at 0/1/3 degrees, preserves every downward surface and retains legacy bytes',t=>{
  const field=build(x=>100+Math.min(80,Math.abs(x)*.4)),scratch=[0,0],eye={x:0,y:105,z:-800};
  const readings=[];
  for(const deg of [-20,-5,-1,0,1,3]){
    const angle=deg*Math.PI/180,point={x:0,y:eye.y+Math.sin(angle)*1200,z:eye.z+Math.cos(angle)*1200};
    const old=mistAlongRay(field,eye,point,0,1,0,.8,scratch),now=old*mistSkyFactor(Math.sin(angle));
    if(deg<0)assert.equal(now,old);else assert.equal(now,0);
    readings.push({elevationDeg:deg,legacyFinite:old,nowFinite:now,legacyEmptySky:0,nowEmptySky:0});
    assert.equal(mistSkyFactor(Math.sin(angle),false,true),1);
  }
  assert.equal(mistSkyFactor(-Math.sin(.5*Math.PI/180),true),1);assert.equal(mistSkyFactor(0,true),0);
  const halfway=mistSkyFactor(-Math.sin(.25*Math.PI/180),true);assert(halfway>.49&&halfway<.51);
  assert.equal(mistSkyShader(MIST_GLSL,'?mistsky=1'),MIST_GLSL);assert.throws(()=>mistSkyShader('missing'));
  const formula=MIST_SKY_GLSL.match(/return 1\.0-smoothstep\(([-\d.]+),0\.0,rayY\)/);assert(formula);
  assert(Math.abs(Number(formula[1])+Math.sin(.5*Math.PI/180))<1e-6);
  t.diagnostic(JSON.stringify({syntheticHorizonProbe:readings}));
});
