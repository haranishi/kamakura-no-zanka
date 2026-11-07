import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { THREE,load } from './helpers/tree-modules.mjs';
import { installGroundDetail } from '../dist/valley/kamakura-ground-detail.js';
import { installGroundSoil,SOIL_GLSL } from '../dist/valley/kamakura-ground-soil.js';
import { soilTexture,soilSlope,soilFine,soilMacroFade,soilMacro,soilEdge,SOIL } from '../dist/valley/kamakura-ground-pattern.js';
import { registerShoreView,unregisterShoreView } from '../dist/valley/kamakura-shore.js';

const data={meta:{surface:{},grid:{width:3,height:3,cell_m:4}},surface:new Uint8Array([2,2,2,2,4,2,2,2,2])};
function shader(){return {uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};}
// This catches the earlier GPU failure (balanced totals alone miss crossed delimiters).
function balanced(source){
  const clean=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
  const stack=[],pairs={')':'(',']':'[','}':'{'};
  for(const c of clean){if('([{'.includes(c))stack.push(c);else if(')]}'.includes(c))assert.equal(stack.pop(),pairs[c],`mismatched ${c}`);}
  assert.equal(stack.length,0,'unclosed bracket');
  const directives=[];
  for(const line of clean.split('\n')){
    if(/^\s*#\s*(if|ifdef|ifndef)\b/.test(line))directives.push(false);
    else if(/^\s*#\s*(else|elif)\b/.test(line)){assert(directives.length,'orphan else/elif');assert(!directives.at(-1),'branch after else');if(/^\s*#\s*else\b/.test(line))directives[directives.length-1]=true;}
    else if(/^\s*#\s*endif\b/.test(line))assert.notEqual(directives.pop(),undefined,'orphan endif');
  }
  assert.equal(directives.length,0,'unclosed conditional');
}
test('9b2 CPU references: classes, monotone slope/distance, pixel footprint, bounded deterministic macro',()=>{
  assert.deepEqual([0,1,2,3,4,5,6,7,255].map(soilTexture),['none','none','none','litter','soil','rock','gravel','furrows','soil']);
  let previous=0;
  for(let deg=0;deg<=90;deg++){
    const v=soilSlope(Math.cos(deg*Math.PI/180));assert(v>=previous);previous=v;
    if(deg<35)assert.equal(v,0);if(deg>=50)assert.equal(v,1);
  }
  assert.equal(soilFine(0),1);assert.equal(soilFine(12),1);assert.equal(soilFine(60),0);assert.equal(soilFine(100),0);
  previous=1;for(let d=12;d<=60;d++){const v=soilFine(d);assert(v<=previous);previous=v;}
  previous=1;for(let px=0;px<=.1;px+=.001){const v=soilFine(0,px);assert(v<=previous);previous=v;}
  assert.equal(soilMacroFade(0),1);assert.equal(soilMacroFade(2500),0);
  for(let x=-800;x<800;x+=17)for(let z=-600;z<600;z+=29){
    const m=soilMacro(x,z);assert.deepEqual(m,soilMacro(x,z));assert(m.lightness>=.92&&m.lightness<=1.08);assert(m.saturation>=.9&&m.saturation<=1.1);assert(Math.abs(m.hue)<=3);
    assert.deepEqual(soilMacro(x,z,2500),{lightness:1,saturation:1,hue:0});
  }
  assert(SOIL_GLSL.includes(`smoothstep(${SOIL.slopeFull},${SOIL.slopeStart},y)`));
});
test('9b2 real 9e shore and 9b grass fragments coexist with soil and retain balanced GLSL',()=>{
  const m=new THREE.MeshLambertMaterial();registerShoreView(data,{});
  try{
    const detail=installGroundDetail(THREE,m,data),soil=installGroundSoil(THREE,m,detail),s=shader();m.onBeforeCompile(s);
    assert(s.fragmentShader.includes('groundShoreWet'));assert(s.fragmentShader.includes('groundGrassDetail'));assert(s.fragmentShader.includes('soilColor(diffuseColor.rgb'));
    balanced(s.fragmentShader);balanced(s.vertexShader);detail.dispose();soil.dispose();m.dispose();
  }finally{unregisterShoreView(data);}
});
test('9b2 full 3x3 grass average includes diagonal and clamps boundary',()=>{
  assert(Math.abs(soilEdge(data.surface,3,3,4)-(8+.15)/9)<1e-12);
  assert.equal(soilEdge(new Uint8Array([2]),1,1,0),1);
  assert.equal(soilEdge(new Uint8Array([0]),1,1,0),.08);
  const diagonal=new Uint8Array(9);diagonal[0]=2;
  assert(Math.abs(soilEdge(diagonal,3,3,4)-(1+8*.08)/9)<1e-12);
});
test('9b2 missing shared data and A/B switches preserve hooks and allocate nothing',()=>{
  for(const [input,search] of [[{},''],[data,'?gsoil=0'],[data,'?gdetail=0']]){
    const m=new THREE.MeshLambertMaterial(),detail=installGroundDetail(THREE,m,input,{search}),old=m.onBeforeCompile,key=m.customProgramCacheKey;
    const soil=installGroundSoil(THREE,m,detail,{search});assert.equal(m.onBeforeCompile,old);assert.equal(m.customProgramCacheKey,key);assert.equal(soil.textures.length,0);soil.dispose();detail.dispose();m.dispose();
  }
});
test('9b2 shipped Lambert chains previous hooks, owns one texture, adapts and disposes once',async()=>{
  for(const quality of ['standard','light']){
    const m=new THREE.MeshLambertMaterial();let calls=0;
    m.onBeforeCompile=function(s){assert.equal(this,m);calls++;s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\n// prior-9e-marker');};
    const detail=installGroundDetail(THREE,m,data,{quality}),oldKey=m.customProgramCacheKey(),soil=installGroundSoil(THREE,m,detail,{quality});await soil.ready;
    const s=shader();m.onBeforeCompile(s);assert.equal(calls,1);assert(s.fragmentShader.includes('prior-9e-marker'));assert(s.fragmentShader.includes('groundGrassDetail'));assert(s.fragmentShader.includes('soilColor(diffuseColor.rgb'));
    assert(s.fragmentShader.indexOf('uniform sampler2D uGroundSurface')<s.fragmentShader.indexOf('float soilHash'));
    for(const chunk of ['fog_fragment','shadowmap_pars_fragment','color_fragment','lights_lambert_pars_fragment'])assert(s.fragmentShader.includes(`#include <${chunk}>`));
    assert(m.customProgramCacheKey().startsWith(oldKey));assert.equal(s.uniforms.uGroundSurface,detail.uniforms.uGroundSurface);assert.equal(s.uniforms.uSoilReady.value,1);
    assert.equal(soil.textures[0].image.data[4],Math.round((8+.15)/9*255));
    const original=s.fragmentShader;detail.setAdapt(2);assert.equal(s.uniforms.uSoilDetail.value,0);assert.equal(s.uniforms.uSoilLayers.value,1);
    detail.setAdapt({step:3});assert.equal(s.uniforms.uSoilLayers.value,0);detail.setAdapt(0);assert.equal(s.uniforms.uSoilDetail.value,quality==='light'?0:1);assert.equal(s.fragmentShader,original);
    const resources=[m,...detail.textures,...soil.textures],counts=resources.map(()=>0);resources.forEach((r,i)=>r.addEventListener('dispose',()=>counts[i]++));
    detail.dispose();detail.dispose();soil.dispose();m.dispose();assert.deepEqual(counts,[1,1,1,1]);
    balanced(s.vertexShader);balanced(s.fragmentShader);
  }
});
test('9b2 GLSL bracket and preprocessor guard rejects real structural errors',()=>{
  balanced(SOIL_GLSL);
  for(const broken of ['{(})','{','(',']','#ifdef A\n','#endif\n','#else\n','#if A\n#else\n#elif B\n#endif'])assert.throws(()=>balanced(broken));
  assert.equal((SOIL_GLSL.match(/texture2D\(/g)||[]).length,2,'at most two additional fetch sites');
  assert(!SOIL_GLSL.includes('discard'));
});
test('9b2 cancellation stops sliced preparation and still releases its texture once',async()=>{
  const input={meta:{surface:{},grid:{width:100,height:100,cell_m:4}},surface:new Uint8Array(10000).fill(4)};
  const m=new THREE.MeshLambertMaterial(),detail=installGroundDetail(THREE,m,input),soil=installGroundSoil(THREE,m,detail);let count=0;
  soil.textures[0].addEventListener('dispose',()=>count++);assert.equal(soil.uniforms.uSoilReady.value,0);detail.dispose();await soil.ready;await new Promise(resolve=>setTimeout(resolve,10));assert.equal(count,1);assert.equal(soil.uniforms.uSoilReady.value,0);m.dispose();
});
test('9b2 chunk owner connects adaptive quality and disposal without world wiring',async()=>{
  const {fixture}=await import('./helpers/kamakura-fixture.mjs'),{createKamakuraTerrain}=await import('../dist/valley/kamakura-terrain.js'),{buildKamakuraChunks}=await load('kamakura-chunk-view.js');
  const f=fixture({width:3,height:3});f.meta.surface={};f.surface=data.surface;
  const v=buildKamakuraChunks(createKamakuraTerrain(f),new THREE.Scene(),{x:0,z:0},true,'standard',{data:f});v.update({x:0,z:0});
  const m=v.chunks.find(c=>c.mesh).mesh.material,s=shader();m.onBeforeCompile(s);v.setAdapt(3);assert.equal(s.uniforms.uSoilLayers.value,0);
  const resources=[m,s.uniforms.uGroundSurface.value,s.uniforms.uGroundPattern.value,s.uniforms.uSoilEdge.value],counts=resources.map(()=>0);resources.forEach((r,i)=>r.addEventListener('dispose',()=>counts[i]++));v.dispose();v.dispose();assert.deepEqual(counts,[1,1,1,1]);
});
test('9b2 private grid: bounded neighbour texture and asynchronous preparation (CPU only)',async t=>{
  if(!process.env.KZ_WORLD_DIR){t.skip('private surface data requires KZ_WORLD_DIR');return;}
  const {join}=await import('node:path'),dir=process.env.KZ_WORLD_DIR;
  const meta=JSON.parse(await readFile(join(dir,'meta.json'),'utf8'));
  const file=typeof meta.surface==='string'?meta.surface:meta.surface?.file;
  assert(file,'private surface metadata must name its file');
  const surface=new Uint8Array(await readFile(join(dir,file))),input={meta,surface};
  const m=new THREE.MeshLambertMaterial(),detail=installGroundDetail(THREE,m,input);assert(detail.uniforms,'private ground detail enabled');
  const start=performance.now(),soil=installGroundSoil(THREE,m,detail);await soil.ready;
  assert.equal(soil.textures[0].image.data.length,surface.length);assert.equal(soil.uniforms.uSoilReady.value,1);
  for(let i=0;i<surface.length;i+=Math.max(1,Math.floor(surface.length/101)))assert.equal(soil.textures[0].image.data[i],Math.round(soilEdge(surface,meta.grid.width,meta.grid.height,i)*255));
  t.diagnostic(`edge texture bytes=${surface.length}; sliced preparation elapsed=${(performance.now()-start).toFixed(2)}ms; slices=${soil.stats.slices}; max CPU slice=${soil.stats.maxSliceMs.toFixed(2)}ms (Node, includes timer yields; GPU not measured)`);
  const s=shader();m.onBeforeCompile(s);balanced(s.fragmentShader);detail.dispose();m.dispose();
});
