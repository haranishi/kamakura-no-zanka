import test from 'node:test';
import assert from 'node:assert/strict';
import {createSignedShoreJob,shoreFoam,shoreWetness,tideLine,sandWindDirection,SHORE_GLSL,sampleDistance} from '../dist/valley/kamakura-shore.js';
import {waveEnvelope} from '../dist/valley/kamakura-sea-audio.js';
import {bankRibbon,buildBankWet,BANK_WIDTH} from '../dist/valley/kamakura-bank-wet.js';
import {riverRibbon,prepareRivers} from '../dist/valley/kamakura-rivers.js';
import {buildShoreProps} from '../dist/valley/kamakura-shore-props.js';
import {installGroundDetail} from '../dist/valley/kamakura-ground-detail.js';
import {THREE,load} from './helpers/tree-modules.mjs';
const finish=j=>{while(!j.step(127));return j.field;};
const plane=(a=.6,b=.8)=>({bounds:{minX:-320,maxX:320,minZ:-320,maxZ:320},heightAt:(x,z)=>-(a*x+b*z-1.7),isSea:(x,z)=>a*x+b*z>=1.7,seaDistanceAt:()=>10,riverDistanceAt:()=>Infinity});
function balanced(source){
  const s=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
  const stack=[],pp=[];
  for(const token of s.match(/[{}()]|^\s*#\s*(?:ifdef|ifndef|if|endif)\b/gm)||[]){
    if(token.includes('#')){if(/endif/.test(token))assert(pp.pop(),'extra #endif');else pp.push(token);continue;}
    if(token==='{'||token==='(')stack.push(token);else assert.equal(stack.pop(),token==='}'?'{':'(','mismatched shader delimiter');
  }
  assert.equal(stack.length,0,'unclosed shader delimiter');assert.equal(pp.length,0,'unclosed preprocessor condition');
}
const shaderFor=m=>{const base=THREE.ShaderLib[m.isMeshStandardMaterial?'standard':m.isMeshLambertMaterial?'lambert':'basic'];const s={uniforms:{},vertexShader:base.vertexShader,fragmentShader:base.fragmentShader};m.onBeforeCompile(s);return s;};
test('9e2 signed sub-cell shore has correct sign, monotonicity, cap and <1m coastline position error',()=>{
  for(const [a,b] of [[1,0],[.6,.8],[Math.SQRT1_2,Math.SQRT1_2],[.28, .96]]){
    const t=plane(a,b),job=createSignedShoreJob(t);assert.equal(job.done,false);const f=finish(job);assert.equal(f.cell,8);
    let prev=-Infinity;
    for(let d=-12;d<=12;d+=.2){const actual=f.signedDistanceAt(a*(d+1.7),b*(d+1.7));assert(Math.abs(actual-d)<=Math.abs(d)*.35+1,`${actual} vs ${d}`);assert(actual>=prev);prev=actual;}
    for(let q=-50;q<=50;q+=.4)assert(Math.abs(f.signedDistanceAt(-b*q+a*1.7,a*q+b*1.7))<=1);
    assert(f.data.every(v=>Math.abs(v)<=240));assert.equal(f.signedDistanceAt(999,999),f.signedDistanceAt(320,320));
  }
  const inland=finish(createSignedShoreJob({...plane(),heightAt:()=>1,isSea:()=>false}));assert(inland.data.every(v=>v===-240));
  const sea=finish(createSignedShoreJob({...plane(),heightAt:()=>-1,isSea:()=>true}));assert(sea.data.every(v=>v===240));
  // A river below sea level but excluded by isSea cannot seed a coast.
  const river=finish(createSignedShoreJob({...plane(),heightAt:()=>-1,isSea:()=>false}));assert(river.data.every(v=>v===-240));
  assert.throws(()=>createSignedShoreJob(plane(),{cell:0}),RangeError);
});
test('9e2 five audio-clock phases retain >=8% foam and >=25% wet coverage across 12m',t=>{
  const coverage=[];
  for(const time of [0,2,5,9,17]){let foam=0,wet=0,n=0;const wave=waveEnvelope(time);
    for(let d=0;d<12;d+=.01){n++;if(shoreFoam(d,wave)>.1)foam++;if(shoreWetness(d,wave)>.1)wet++;}
    assert(foam/n>=.08);assert(wet/n>=.25);coverage.push({time,foam:+(foam/n).toFixed(3),wet:+(wet/n).toFixed(3)});
  }
  assert(shoreFoam(1,1)>shoreFoam(1,0));assert(shoreFoam(6,0)>shoreFoam(6,1));assert(shoreWetness(6,1)>shoreWetness(6,0));assert.equal(tideLine(11.5),1);
  assert.deepEqual(sandWindDirection(0,0),[5,1.7]);
  const a=sandWindDirection(10,20),b=sandWindDirection(10.001,20.001),c=sandWindDirection(100,200);
  assert(Math.hypot(a[0]-b[0],a[1]-b[1])<.001);assert(Math.hypot(a[0]-c[0],a[1]-c[1])>.1);
  t.diagnostic(JSON.stringify(coverage));balanced(SHORE_GLSL);
});
const r={id:'synthetic',xy_m:[[0,0],[0,-12]],water_elev_m:[1,1],width_m:[4,4],enters_sea:false};
test('9e2 river banks use 1.5m outside ribbon, drape at 1.5cm, dispose once and honor seav=0',()=>{
  const terrain={heightAt:(x,z)=>x*.1+z*.01},prepared=prepareRivers({rivers:[r]}),f=bankRibbon(riverRibbon(r),terrain);
  assert.equal(BANK_WIDTH,1.5);assert(f.indices.length>0);
  for(let k=0;k<f.positions.length;k+=3){const [x,y,z]=f.positions.slice(k,k+3);assert(Math.abs(y-terrain.heightAt(x,z)-.015)<1e-6);assert(Math.abs(x)>=3.2-1e-5&&Math.abs(x)<=4.7+1e-5);}
  const v=buildBankWet(THREE,prepared,terrain),resources=[v.material,...v.group.children.map(m=>m.geometry)],counts=resources.map(()=>0);
  resources.forEach((r,i)=>r.addEventListener('dispose',()=>counts[i]++));const s=shaderFor(v.material);balanced(s.vertexShader);balanced(s.fragmentShader);
  v.dispose();v.dispose();assert(counts.every(n=>n===1));const off=buildBankWet(THREE,prepared,terrain,{search:'?seav=0'});assert.equal(off.group.children.length,0);off.dispose();
});
test('9e2 every modified shader balances braces, parentheses and #if; single R16F grid and evening colors',async()=>{
  const {buildKamakuraSea}=await load('kamakura-sea-view.js');const terrain=plane(),data={meta:{grid:{width:81,height:81,cell_m:8},surface:{}},surface:new Uint8Array(6561)};
  let noon;
  for(const search of ['', '?time=evening','?seav=0']){
    const v=buildKamakuraSea(terrain,data,{search});let frames=0;while(v.jobs.length&&!v.preparedShore&&frames++<10000)v.update(1/60,{x:0,z:0});v.update(1/60,{x:0,z:0});
    for(const m of [v.mesh.material,v.props?.meshes[0].material,v.bank?.material].filter(Boolean)){const s=shaderFor(m);balanced(s.vertexShader);balanced(s.fragmentShader);}
    const m=new THREE.MeshLambertMaterial(),g=installGroundDetail(THREE,m,data);const s=shaderFor(m);balanced(s.vertexShader);balanced(s.fragmentShader);
    if(search!=='?seav=0'){
      assert(terrain.shoreSigned);assert.equal(v.jobs.length,1);assert.equal(v.uniforms.uShoreSea.value,v.uniforms.uShoreLand.value);// W2c-9 parent fix: the finished grid is a NEW texture (a 1x1 placeholder cannot be resized on the GPU: texStorage2D is immutable), shared by sea and sand.
      const shared=v.uniforms.uShoreSea.value;assert.equal(shared.type,THREE.HalfFloatType);assert.equal(shared.image.width,terrain.shoreSigned.w);assert.equal(shared.image.height,terrain.shoreSigned.h);assert.equal(v.textures.filter(t=>t.image?.width===terrain.shoreSigned.w&&t.image?.height===terrain.shoreSigned.h).length,1,'exactly one full-size shore grid');assert.equal(v.mesh.material.roughness,.22);
      if(!search)noon=v.uniforms.uSeaDay.value;else assert(v.uniforms.uSeaDay.value<noon);
      for(const step of [2,3,0]){v.setAdapt(step);assert.equal(v.uniforms.uShoreDetail.value,step>=2?0:1);assert.equal(v.uniforms.uShoreAnimate.value,step>=3?0:1);}
    }else {assert.equal(v.textures.length,0);assert.equal(v.bank,null);}
    g.dispose();m.dispose();v.dispose();
  }
  assert.throws(()=>balanced('void main(){x=(1.0;}'));assert.throws(()=>balanced('#ifdef X\nvoid main(){}'));
});
test('9e2 private signed grid timing, aggregate coast counts and both beaches have dozens of props',{skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定：私有標高は同梱しない'},async t=>{
  const {readPrivateData}=await import('../tools/lib/kamakura-validation.mjs'),{createKamakuraTerrain}=await import('../dist/valley/kamakura-terrain.js');
  const {data}=await readPrivateData(process.env.KZ_WORLD_DIR),terrain=createKamakuraTerrain(data);const start=performance.now(),f=finish(createSignedShoreJob(terrain));const ms=performance.now()-start;terrain.shoreSigned=f;
  let sea=0,coast=0;for(const d of f.data){if(d>0)sea++;if(Math.abs(d)<8)coast++;}
  const props=buildShoreProps(THREE,terrain,data),counts=[];
  for(const [x,z] of [[-1057.2,-1801.4],[-1849.2,-1465.4]]){for(let i=0;i<20;i++)props.update({x,z:-z});counts.push(props.count);}
  assert(counts.every(n=>n>=20&&n<=50),`props aggregate: ${counts}`);props.dispose();
  t.diagnostic(JSON.stringify({grid:[f.w,f.h],cell:f.cell,ms:+ms.toFixed(2),texture_bytes:f.data.length*2,sea_fraction:+(sea/f.data.length).toFixed(3),coast_cells:coast,props:counts,triangle_upper_bound:counts.map(n=>n*20)}));
});
