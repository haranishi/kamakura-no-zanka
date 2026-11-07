import test from 'node:test';
import assert from 'node:assert/strict';
import {createDistanceJob,sampleDistance,shoreWetness,shoreFoam,riverWetness,tideLine,shoreHash,shorePropAt} from '../dist/valley/kamakura-shore.js';
import {waveEnvelope} from '../dist/valley/kamakura-sea-audio.js';
import {buildShoreProps} from '../dist/valley/kamakura-shore-props.js';
import {installGroundDetail} from '../dist/valley/kamakura-ground-detail.js';
import {THREE,load} from './helpers/tree-modules.mjs';
const terrain={bounds:{minX:-32,maxX:32,minZ:-32,maxZ:32},isSea:(x,z)=>z>0,riverDistanceAt:(x,z)=>Math.max(0,Math.abs(x)-2),seaDistanceAt:(x,z)=>Math.max(0,-z),heightAt:()=>.1};
const data={meta:{grid:{width:17,height:17,cell_m:4},surface:{}},surface:new Uint8Array(289)};
function finish(job){while(!job.step(13));return job.field;}
test('9e inverse field matches exhaustive lattice distance, clamps outside, limits empty sea',()=>{
  assert.throws(()=>createDistanceJob(terrain,{cell:0}),RangeError);
  const partial=finish(createDistanceJob({...terrain,bounds:{...terrain.bounds,maxZ:29}}));assert.equal(sampleDistance(partial,0,999),sampleDistance(partial,0,29));
  const f=finish(createDistanceJob(terrain,{cell:8}));
  for(let j=0;j<f.h;j++)for(let i=0;i<f.w;i++)assert.equal(f.data[j*f.w+i],Math.max(0,f.z0+j*8));
  assert.equal(sampleDistance(f,0,-999),0);assert.equal(sampleDistance(f,0,999),32);
  const empty=finish(createDistanceJob({...terrain,isSea:()=>true},{limit:17}));assert(empty.data.every(v=>v===17));
  const land=finish(createDistanceJob({...terrain,isSea:()=>false}));assert(land.data.every(v=>v===0));
  // Oblique coastline: chamfer approximation stays within 7% + one cell.
  const oblique={...terrain,isSea:(x,z)=>x+z>0},g=finish(createDistanceJob(oblique,{cell:8}));
  const sites=[];for(let j=0;j<g.h;j++)for(let i=0;i<g.w;i++){const x=g.x0+i*8,z=g.z0+j*8;if(!oblique.isSea(x,z))sites.push([x,z]);}
  for(let j=0;j<g.h;j++)for(let i=0;i<g.w;i++){const x=g.x0+i*8,z=g.z0+j*8,d=Math.min(...sites.map(([a,b])=>Math.hypot(x-a,z-b)));assert(Math.abs(g.data[j*g.w+i]-d)<=d*.07+8);}
});
test('9e river grid equals capped direct queries on lattice and interpolates with bounded error',()=>{
  const f=finish(createDistanceJob(terrain,{river:true}));
  assert.equal(f.cell,8);for(let j=0;j<f.h;j++)for(let i=0;i<f.w;i++)assert.equal(f.data[j*f.w+i],Math.min(12,terrain.riverDistanceAt(f.x0+i*8,f.z0+j*8)));
  for(let x=-40;x<=40;x+=.3)assert(Math.abs(sampleDistance(f,x,0)-Math.min(12,terrain.riverDistanceAt(x,0)))<=4);
});
test('9e foam, wetness, tide and coordinates are bounded and phase follows the shared envelope',()=>{
  for(let t=0;t<120;t+=.1)for(const d of [0,.5,2,5,8,10,12,20])for(const f of [shoreWetness,shoreFoam])assert(f(d,waveEnvelope(t))>=0&&f(d,waveEnvelope(t))<=1);
  assert.equal(shoreWetness(8,1),0);assert.equal(riverWetness(.6),1);assert.equal(riverWetness(2),0);assert(riverWetness(1)>0&&riverWetness(1)<1);
  assert(shoreWetness(6,1)>shoreWetness(6,0));assert.equal(shoreFoam(1,1),1);assert.equal(shoreFoam(6,0),1);assert.equal(tideLine(11.5),1);assert.equal(tideLine(0),0);
  assert.equal(shoreHash(-12,4),shoreHash(-12,4));assert.notEqual(shoreHash(-12,4),shoreHash(-14,4));
  assert.equal(shorePropAt(terrain,()=>0,10,-8),true);assert.equal(shorePropAt(terrain,()=>0,0,-8),false);assert.equal(shorePropAt(terrain,()=>0,10,2),false);assert.equal(shorePropAt(terrain,()=>2,10,-8),false);
});
test('9e shipped sea and ground shaders, clock, quality, disabled mode and exact resource disposal',async()=>{
  const {buildKamakuraSea}=await load('kamakura-sea-view.js');
  const {createShoreField}=await import('../dist/valley/kamakura-shore.js');terrain.shoreField=createShoreField(terrain);
  for(const search of ['', '?seav=0']) {
    const v=buildKamakuraSea(terrain,data,{search});
    const m=new THREE.MeshLambertMaterial(),d=installGroundDetail(THREE,m,data);
    if(!search){
      for(let i=0;i<100;i++)v.update(.016,{x:10,z:-8},3);
      assert(v.jobs.every(j=>j.done));assert.equal(v.uniforms.uShoreWave.value,waveEnvelope(3));
      const s={uniforms:{},...THREE.ShaderLib.standard};s.vertexShader=THREE.ShaderLib.standard.vertexShader;s.fragmentShader=THREE.ShaderLib.standard.fragmentShader;v.mesh.material.onBeforeCompile(s);
      assert(s.fragmentShader.includes('#include <fog_fragment>'));assert(s.fragmentShader.includes('shoreFoam'));assert(s.fragmentShader.includes('SUN_DIR_W'));assert(s.fragmentShader.includes('normal =')||s.fragmentShader.includes('normal='));
      assert.equal(v.uniforms.uShoreLand.value.type,THREE.HalfFloatType);assert.equal(v.uniforms.uShoreLand.value.minFilter,THREE.LinearFilter);
      const g={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};m.onBeforeCompile(g);assert(g.fragmentShader.includes('groundShoreWet'));assert.equal(g.uniforms.uShoreWave,v.uniforms.uShoreWave);
      v.setAdapt(2);assert.equal(v.uniforms.uShoreDetail.value,0);assert.equal(v.props.group.visible,false);v.setAdapt(3);assert.equal(v.uniforms.uShoreAnimate.value,0);v.setAdapt(0);assert.equal(v.uniforms.uShoreAnimate.value,1);
    }else{assert.equal(v.mesh.material.isMeshLambertMaterial,true);assert.equal(v.textures.length,0);assert.equal(v.props,null);}
    const resources=[v.mesh.geometry,v.mesh.material,...v.textures,...(v.props?[v.props.mesh.geometry,v.props.mesh.material]:[])],counts=resources.map(()=>0);resources.forEach((r,i)=>r.addEventListener('dispose',()=>counts[i]++));d.dispose();m.dispose();v.dispose();v.dispose();assert(counts.every(n=>n===1));
  }
});
test('9e props use stable cells, stay on beach, cap instances and switch quality without resources',()=>{
  for(const quality of ['standard','light']){
    const v=buildShoreProps(THREE,terrain,data,quality),w=buildShoreProps(THREE,terrain,data,quality),pos={x:10,z:-8};for(let i=0;i<20;i++){v.update(pos);w.update(pos);}
    assert.deepEqual(v.mesh.instanceMatrix.array,w.mesh.instanceMatrix.array);assert(v.mesh.count<=(quality==='light'?120:300));
    const m=new THREE.Matrix4(),p=new THREE.Vector3();for(let i=0;i<v.mesh.count;i++){v.mesh.getMatrixAt(i,m);p.setFromMatrixPosition(m);assert(shorePropAt(terrain,()=>0,p.x,p.z));assert(Math.hypot(p.x-pos.x,p.z-pos.z)<=30);}
    v.update({x:100,z:100});for(let i=0;i<20;i++)v.update({x:100,z:100});assert.equal(v.mesh.count,0);v.setAdapt(2);assert.equal(v.group.visible,false);v.setAdapt(0);assert.equal(v.group.visible,true);v.dispose();w.dispose();
  }
});
test('9e private distance preparation, texture bytes, bounded update and props (aggregate only)',{skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定：私有データはリポジトリ外'},async t=>{
  const {readPrivateData}=await import('../tools/lib/kamakura-validation.mjs');
  const fs=await import('node:fs/promises'),path=await import('node:path');
  const {createKamakuraTerrain}=await import('../dist/valley/kamakura-terrain.js'),{decodeRivers}=await import('../dist/valley/kamakura-rivers.js');
  const {data}=await readPrivateData(process.env.KZ_WORLD_DIR);
  data.surface=new Uint8Array(await fs.readFile(path.join(process.env.KZ_WORLD_DIR,'surface_class_u8.bin')));
  data.rivers=decodeRivers(JSON.parse(await fs.readFile(path.join(process.env.KZ_WORLD_DIR,'rivers.json'),'utf8')));
  const terrain=createKamakuraTerrain(data),measure=[];
  for(const river of [false,true]){
    const start=performance.now(),job=createDistanceJob(terrain,{river});finish(job);const ms=performance.now()-start;
    assert(job.field.data.every(Number.isFinite));measure.push({cell:job.field.cell,w:job.field.w,h:job.field.h,ms:+ms.toFixed(2),bytes:job.field.data.length*2});
  }
  const {buildKamakuraSea}=await load('kamakura-sea-view.js'),v=buildKamakuraSea(terrain,data),pos={x:data.meta.spawn.x,z:-data.meta.spawn.y};
  let frames=0,max=0,start=performance.now();while(v.uniforms.uShoreRiverReady.value===0&&frames<10000){const a=performance.now();v.update(1/60,pos);max=Math.max(max,performance.now()-a);frames++;}
  assert.equal(v.uniforms.uShoreRiverReady.value,1);const prep=performance.now()-start;
  start=performance.now();for(let i=0;i<10000;i++)v.update(1/60,pos,20);const steady=(performance.now()-start)/10000;
  const counts=[];for(const [x,z]of [[-1057.2,-1801.4],[-1849.2,-1465.4]]){const p={x,z};for(let i=0;i<20;i++)v.update(1/60,p,20);counts.push(v.props.mesh.count);}
  // Find one actual eligible band without emitting private cells or coordinates.
  const {createSurfaceCodeAt}=await import('../dist/valley/kamakura-surface.js'),codeAt=createSurfaceCodeAt(data.meta,data.surface);
  let candidate=null;
  const g=data.meta.grid;
  for(let j=0;j<g.height&&!candidate;j+=2)for(let i=0;i<g.width;i+=2){if(data.surface[j*g.width+i]>1)continue;const x=terrain.x0+i*terrain.cell,z=terrain.z0+j*terrain.cell;if(shorePropAt(terrain,codeAt,x,z)){candidate={x,z};break;}}
  let eligibleCount=0;if(candidate){for(let i=0;i<20;i++)v.update(1/60,candidate,20);eligibleCount=v.props.mesh.count;}
  t.diagnostic(JSON.stringify({eligible_band_props:eligibleCount,distance_grids:measure,preparation_frames:frames,preparation_ms:+prep.toFixed(2),max_update_ms:+max.toFixed(3),steady_update_ms:+steady.toFixed(5),texture_bytes:v.textures.reduce((n,t)=>n+t.image.data.byteLength,0),props_counts:counts,props_triangles:counts.map(n=>n*8)}));v.dispose();
});
test('9e props retain old window until ready, dispose both instance buffers and shared assets once',()=>{
  const v=buildShoreProps(THREE,terrain,data),pos={x:10,z:-8};for(let i=0;i<20;i++)v.update(pos);
  const old=v.mesh;v.update({x:14,z:-8});assert.equal(v.mesh,old);for(let i=0;i<20;i++)v.update({x:14,z:-8});assert.notEqual(v.mesh,old);
  const resources=[...v.group.children,v.mesh.geometry,v.mesh.material],counts=resources.map(()=>0);resources.forEach((r,i)=>r.addEventListener('dispose',()=>counts[i]++));v.dispose();v.dispose();assert(counts.every(n=>n===1));
});
