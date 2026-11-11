import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createSignedShoreJob,swellFacing,validateSea} from '../dist/valley/kamakura-shore.js';
import {validateMeta} from '../dist/valley/kamakura-data.js';
import {fixture} from './helpers/kamakura-fixture.mjs';
import {previewEdgesTerrain} from '../tools/preview-sea.mjs';
import * as H from './helpers/tree-modules.mjs';
const {buildKamakuraSea}=await H.load('kamakura-sea-view.js');
const finish=j=>{while(!j.step(257));return j;};
const hash=a=>createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const beach=()=>({cell:2,bounds:{minX:-300,maxX:300,minZ:-180,maxZ:220},heightAt:(_x,z)=>-z*.2,isSea:(_x,z)=>z>=0,riverDistanceAt:()=>Infinity,seaDistanceAt:()=>0});
test('D2 optional meta sea uses strict whitelist, finite numeric direction 0..360',()=>{
  for(const value of [0,180,360]){const f=fixture();f.meta.sea={swell_from_deg:value};assert.equal(validateMeta(f.meta),f.meta);}
  validateSea(undefined);
  for(const sea of [null,[],{},180,{swell_from_deg:-1},{swell_from_deg:361},{swell_from_deg:'180'},{swell_from_deg:NaN},{swell_from_deg:Infinity},{swell_from_deg:180,unknown:1}]){const f=fixture();f.meta.sea=sea;assert.throws(()=>validateMeta(f.meta));}
});
test('D2 facing respects compass bearings, smooth cross-shore fade and undefined gradients',()=>{
  assert.equal(swellFacing(0,1,180),1);assert.equal(swellFacing(0,-1,180),0);
  assert(swellFacing(1,0,180)>.3&&swellFacing(1,0,180)<.5);
  assert.equal(swellFacing(0,0,180),1);assert.equal(swellFacing(1,0,90),1);assert.equal(swellFacing(-1,0,90),0);
  for(let i=-100;i<=100;i++){const f=swellFacing(i,37,180);assert(f>=0&&f<=1);}
});
test('D2 beach stays fully open; ring south=1 north=0 sides fade, harbor stays quiet; deterministic bounded field',()=>{
  const terrain=previewEdgesTerrain(),j=finish(createSignedShoreJob(terrain,{sea:{swell_from_deg:180}})),a=j.field,b=finish(createSignedShoreJob(terrain,{sea:{swell_from_deg:180}})).field;
  assert.equal(a.opennessAt(-260,80),1);assert.equal(a.opennessAt(120,150),1);assert.equal(a.opennessAt(120,0),0);assert.equal(a.opennessAt(120,70),0);
  const center=Math.round((70-a.z0)/a.cell)*a.w+Math.round((120-a.x0)/a.cell);assert.equal(a.swellGain[center],1); // already sheltered: no orange overlay
  for(const x of [40,200])assert(a.opennessAt(x,70)>0&&a.opennessAt(x,70)<1);
  assert(a.openness.every(v=>v>=0&&v<=1));assert.deepEqual(a.openness,b.openness);assert.deepEqual(a.data,b.data);assert(j.swellReducedFraction>0&&j.swellReducedFraction<1);
  for(let col=0;col<a.w;col++)assert.equal(a.swellGain[col],1);
});
test('D2 missing sea and swell=0 retain frozen distance/openness hashes and work',()=>{
  const t=beach(),old=finish(createSignedShoreJob(t)),absent=finish(createSignedShoreJob(t,{sea:undefined})),off=finish(createSignedShoreJob(t,{sea:{swell_from_deg:180},swell:false}));
  assert.equal(hash(old.field.data),'080fffa94cba713bdbc1b0676038579fe7a819576dda55b5afada79b872a8f10');
  assert.equal(hash(old.field.openness),'a04bb345ec2ad399e2e7f83dc0f25695f6770daa271187829ba6604d2a07bde8');
  for(const j of [absent,off]){assert.deepEqual(j.field.data,old.field.data);assert.deepEqual(j.field.openness,old.field.openness);assert.equal(j.work,old.work);assert(!j.field.swellGain);}
  const directional=finish(createSignedShoreJob(t,{shelter:false,sea:{swell_from_deg:0}}));assert.equal(directional.field.opennessAt(0,20),0);
});
const compile=v=>{const s={uniforms:{},vertexShader:H.THREE.ShaderLib.standard.vertexShader,fragmentShader:H.THREE.ShaderLib.standard.fragmentShader};v.mesh.material.onBeforeCompile(s);return s;};
const data=sea=>({rivers:[],meta:{grid:{width:301,height:201,cell_m:2},surface:{},...(sea?{sea}: {})},surface:new Uint8Array(60501)});
test('D2 disabled/missing data preserve shader bytes; debug uses spare alpha, single sample, no draws; release',()=>{
  const old=buildKamakuraSea(beach(),data(),{search:'?bankwet=0'}),off=buildKamakuraSea(beach(),data({swell_from_deg:180}),{search:'?bankwet=0&swell=0'});
  assert.equal(compile(old).fragmentShader,compile(off).fragmentShader);assert.equal(old.mesh.material.customProgramCacheKey(),off.mesh.material.customProgramCacheKey());old.dispose();off.dispose();
  for(const flags of ['', '&sea3=0','&sea2=0','&shelter=0']){
    const terrain={...previewEdgesTerrain(),riverDistanceAt:()=>Infinity,seaDistanceAt:()=>0},v=buildKamakuraSea(terrain,data({swell_from_deg:180}),{search:'?debug=1&sea3debug=1&bankwet=0'+flags}),shader=compile(v).fragmentShader;
    assert.equal((shader.match(/texture2D\(uShoreLand,seaUV\)/g)||[]).length,1);
    if(!flags.includes('sea3=0')&&!flags.includes('sea2=0'))assert(shader.includes('1.0-sea2Shore.a'));
    let stack=[];for(const c of shader.replace(/\/\/[^\n]*/g,'')){if('([{'.includes(c))stack.push(c);if(')]}'.includes(c))assert.equal(stack.pop(),'([{'[')]}'.indexOf(c)]);}assert.equal(stack.length,0);
    assert(!/--\s*\d|\b(?:float|vec[234])\s+(?:sample|input|output|filter|patch)\b/.test(shader));
    for(let i=0;i<1000&&!v.preparedShore;i++)v.update(.016,{x:0,y:0,z:0},1);assert(v.preparedShore);
    assert.equal(v.textures.at(-1).image.data.length,terrain.shoreSigned.data.length*4);assert.equal(v.mesh.geometry.index.count/3,2);assert.equal(v.group.children.filter(o=>o===v.mesh).length,1);
    if(!flags.includes('sea3=0')&&!flags.includes('sea2=0')){const stats=globalThis.__kzSea3();assert(stats.swellReducedFraction>0);assert.equal(stats.swellFromDeg,180);}
    v.dispose();assert.equal(globalThis.__kzSea3,undefined);assert(!terrain.shoreSigned);
  }
});
