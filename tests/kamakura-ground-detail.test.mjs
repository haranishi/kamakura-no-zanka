import test from 'node:test';
import assert from 'node:assert/strict';
import { grassAmount,slopeAmount,detailAmplitude,boundaryWarp,groundPattern } from '../dist/valley/kamakura-ground-pattern.js';
import { installGroundDetail } from '../dist/valley/kamakura-ground-detail.js';
import { THREE,load } from './helpers/tree-modules.mjs';
import { tilesAround } from '../dist/valley/grass-field.js';
import { GRASS } from '../dist/valley/config.js';
import { GRASS_WINDOW,GRASS_MOVE,GRASS_EDGE,KAMAKURA_GRASS_REACH } from '../dist/valley/kamakura-grass-field.js';
const data={meta:{surface:{},grid:{width:3,height:2,cell_m:3.9}},surface:new Uint8Array([0,1,2,3,4,7])};
test('9b class table, slope, deterministic boundary warp and monotone distance bands',()=>{
  assert.deepEqual([0,1,2,3,4,5,6,7,255].map(grassAmount),[.08,0,1,.45,.15,0,0,.7,0]);
  assert.equal(slopeAmount(.45),0);assert.equal(slopeAmount(.85),1);assert(slopeAmount(.6)>0&&slopeAmount(.6)<1);
  assert.deepEqual(boundaryWarp(-12,31),boundaryWarp(-12,31));assert.notDeepEqual(boundaryWarp(-12,31),boundaryWarp(-11,31));
  for(const d of [0,18,2500,5000])assert.equal(detailAmplitude(d),0);
  let last=0;for(let d=18;d<=55;d++){assert(detailAmplitude(d)>=last);last=detailAmplitude(d);}
  last=1;for(let d=700;d<=2500;d++){assert(detailAmplitude(d)<=last);last=detailAmplitude(d);}
});
test('9b periodic seeded texture has neutral mean, repeatable bytes and continuous edges',()=>{
  const a=groundPattern(),b=groundPattern();assert.deepEqual(a.data,b.data);assert.notDeepEqual(a.data,groundPattern(2).data);
  assert.equal(a.data.length,256*256*4);assert(Math.abs(a.mean-.5)<.01);
  for(let i=0;i<256;i++)for(let c=0;c<4;c++){
    assert.equal(a.data[i*4+c],a.data[((255*256)+i)*4+c]);
    assert.equal(a.data[(i*256)*4+c],a.data[(i*256+255)*4+c]);
  }
});
test('9b shipped Lambert hooks retain fog/shadow chunks, uniforms switch live and resources dispose once',()=>{
  for(const quality of ['standard','light']){
    const m=new THREE.MeshLambertMaterial({vertexColors:true}),d=installGroundDetail(THREE,m,data,{quality,search:'?grass=0'});
    const s={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};m.onBeforeCompile(s);
    for(const chunk of ['fog_fragment','shadowmap_pars_fragment','color_fragment','lights_lambert_pars_fragment'])assert(s.fragmentShader.includes(`#include <${chunk}>`));
    assert(s.vertexShader.includes('#include <fog_vertex>'));assert(s.fragmentShader.includes('diffuseColor.rgb*=groundGrassDetail'));
    assert.equal(s.uniforms.uGroundSurface.value.image.data,data.surface);assert.equal(d.textures[0].unpackAlignment,1);
    d.setAdapt(2);assert.equal(s.uniforms.uGroundSecond.value,0);d.setAdapt(3);assert.equal(s.uniforms.uGroundStrength.value,0);
    d.setAdapt(0);assert.equal(s.uniforms.uGroundStrength.value,quality==='light'?.7:1);
    assert.equal(s.uniforms.uGroundSecond.value,quality==='light'?0:1);
    const counts=[0,0];d.textures.forEach((t,i)=>t.addEventListener('dispose',()=>counts[i]++));d.dispose();d.dispose();assert.deepEqual(counts,[1,1]);m.dispose();
  }
  for(const [input,search]of [[{},''],[data,'?gdetail=0']]){
    const m=new THREE.MeshLambertMaterial(),old=m.onBeforeCompile,d=installGroundDetail(THREE,m,input,{search});assert.equal(m.onBeforeCompile,old);assert.equal(d.textures.length,0);d.dispose();m.dispose();
  }
});
test('9b omitted reach returns exactly the original valley tiles; enlarged window covers mid plus streaming margin',()=>{
  const field={x0:-256,z0:-256,nx:512,nz:512};
  for(const quality of ['standard','light'])for(const [x,z]of [[0,0],[-12,3],[15,-31]]){
    assert.deepEqual(tilesAround(field,x,z,{quality}),tilesAround(field,x,z,{quality,reach:{near:GRASS.nearRadius,mid:GRASS.midRadius}}));
    const extended=tilesAround(field,x,z,{quality,reach:KAMAKURA_GRASS_REACH});assert(extended.mid.length>tilesAround(field,x,z,{quality}).mid.length*4);
  }
  assert.equal(GRASS_WINDOW/2-GRASS_MOVE-KAMAKURA_GRASS_REACH.mid-GRASS_EDGE,20);
});
test('9b chunk owner disposes material and both shared textures once',async()=>{
  const {buildKamakuraChunks}=await load('kamakura-chunk-view.js');
  const {createKamakuraTerrain}=await import('../dist/valley/kamakura-terrain.js');
  const {fixture}=await import('./helpers/kamakura-fixture.mjs');
  const f=fixture({width:3,height:2});f.meta.surface={};f.surface=data.surface;
  const v=buildKamakuraChunks(createKamakuraTerrain(f),new THREE.Scene(),{x:0,z:0},true,'standard',{data:f});v.update({x:0,z:0});
  const material=v.chunks.find(c=>c.mesh).mesh.material,s={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};material.onBeforeCompile(s);
  const resources=[material,s.uniforms.uGroundSurface.value,s.uniforms.uGroundPattern.value],counts=[0,0,0];resources.forEach((r,i)=>r.addEventListener('dispose',()=>counts[i]++));v.dispose();v.dispose();assert.deepEqual(counts,[1,1,1]);
});
