import test from 'node:test';
import assert from 'node:assert/strict';
import { HORIZON, validateHorizon, horizonRidge, horizonDirection, horizonBudget, buildHorizon } from '../dist/valley/kamakura-horizon.js';
import { createKamakuraHorizon } from '../dist/valley/kamakura-horizon-view.js';
import { validateMeta } from '../dist/valley/kamakura-data.js';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { THREE, load } from './helpers/tree-modules.mjs';
const examples=()=>['range','headland','island'].map((kind,i)=>({bearing_deg:130+i*32,width_deg:35-i*10,height_deg:2.5-i*.7,kind}));
const near=(a,b,e=1e-6)=>assert(Math.abs(a-b)<e,`${a} vs ${b}`);
function shaderCheck(shader) {
  const s=shader.replace(/\/\/[^\n]*/g,''),stack=[];
  for(const c of s){if('([{'.includes(c))stack.push(c);if(')]}'.includes(c))assert.equal(stack.pop(),'([{'[')]}'.indexOf(c)]);}assert.equal(stack.length,0);
  assert(!/--\s*\d|\b(?:float|vec[234])\s+(?:input|output|sample|patch|filter|common|active)\b/.test(s));
  const declared=new Set([...s.matchAll(/\b(?:float|vec[234]|attribute|varying)\s+([^;{}]+)/g)].flatMap(m=>[...m[1].matchAll(/\b(?:vHorizon|horizon)\w*/g)].map(m=>m[0])));
  for(const m of s.matchAll(/\b(?:vHorizon|horizon)\w*/g))assert(declared.has(m[0]),m[0]);
}
test('horizon metadata accepts only bounded finite silhouettes; absence is null and loader validates',()=>{
  assert.equal(validateHorizon(),null);assert.deepEqual(validateHorizon([]),[]);
  for(const item of examples())for(const [key,values] of Object.entries({bearing_deg:[0,360],width_deg:[.5,80],height_deg:[.1,6]}))for(const value of values)validateHorizon([{...item,[key]:value}]);
  const f=fixture();f.meta.horizon=examples();assert.equal(validateMeta(f.meta),f.meta);
  for(const value of [null,{},'range',Array(13).fill(examples()[0]),[null],...['bearing_deg','width_deg','height_deg'].flatMap(key=>[NaN,Infinity,'1',null,-1,1000].map(v=>[{...examples()[0],[key]:v}])),[{...examples()[0],kind:'hill'}],[{...examples()[0],kind:new String('range')}],[{...examples()[0],extra:1}]]){
    assert.throws(()=>validateHorizon(value));f.meta.horizon=value;assert.throws(()=>validateMeta(f.meta));
  }
});
test('ridges are deterministic, irregular, bounded and join the sea; bearings follow east/up/south',()=>{
  for(const item of examples()){
    const ridge=Array.from({length:101},(_,i)=>horizonRidge(item,i/100));
    assert.deepEqual(ridge,Array.from({length:101},(_,i)=>horizonRidge({...item},i/100)));
    assert.equal(ridge[0],0);assert.equal(ridge[100],0);assert(ridge.every(h=>h>=0&&h<=item.height_deg));
    assert(ridge.some((h,i)=>Math.abs(h-ridge[100-i])>.1));
  }
  const out=[0,0,0];for(const [bearing,x,z] of [[0,0,-1],[90,1,0],[180,0,1],[270,-1,0],[360,0,-1]]){
    horizonDirection(bearing,0,out);near(out[0],x);near(out[1],0);near(out[2],z);
  }
  horizonDirection(90,3,out);near(Math.asin(out[1])*180/Math.PI,3);near(Math.hypot(...out),1);
});
test('all LODs fit one draw; light/adaptation reduces count and geometry and construction is deterministic',()=>{
  const items=Array.from({length:12},(_,i)=>({...examples()[i%3],bearing_deg:i*30}));
  for(const quality of ['standard','light']){
    const p=buildHorizon(items,quality),again=buildHorizon(items,quality);assert.deepEqual(p.positions,again.positions);
    assert(p.positions.every(Number.isFinite));assert.equal(p.positions.length/3,p.kinds.length);assert.equal(p.heights.length,p.kinds.length);
    for(let step=0;step<=3;step++){
      const b=horizonBudget(items.length,quality,step),lod=p.lods[step];assert.equal(b.draws,1);assert.equal(lod.vertices,b.triangles*3);
      if(step)assert(b.triangles<p.lods[step-1].triangles);assert(lod.start+lod.vertices<=p.kinds.length);
    }
  }
  assert.equal(horizonBudget(0).draws,0);assert(horizonBudget(12,'light').triangles<horizonBudget(12).triangles);
});
test('horizon layer is absent without metadata or with flag, ignores camera translation, adapts and releases once',()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(50,1.5,.1,10000);
  for(const c of [{data:{}},{data:{meta:{horizon:[]}}},{data:{meta:{horizon:examples()}},search:'?horizon=0'}])assert.equal(createKamakuraHorizon({scene,camera,...c}),null);
  for(const quality of ['standard','light']){
    const v=createKamakuraHorizon({scene,camera,data:{meta:{horizon:examples()}},search:'?time=dusk&debug=1&horizondebug=1',quality});
    assert.equal(scene.children.length,1);assert.equal(v.mesh.renderOrder,HORIZON.renderOrder);assert(!v.mesh.material.depthWrite);assert(v.mesh.material.depthTest);assert(!v.mesh.frustumCulled);
    const positions=v.mesh.geometry.attributes.position.array.slice();camera.position.set(200,55,-90);camera.updateMatrixWorld();
    const stats=globalThis.__kzHorizon();assert.equal(stats.count,3);assert.equal(stats.draws,1);assert.equal(stats.frameWork,0);assert(stats.nearest.infinite);assert.equal(stats.nearest.distance,null);
    assert.deepEqual(v.mesh.geometry.attributes.position.array,positions);assert.match(v.mesh.material.vertexShader,/mat3\(viewMatrix\)\*position/);
    shaderCheck(v.mesh.material.vertexShader);shaderCheck(v.mesh.material.fragmentShader);
    for(let step=0;step<=3;step++){v.setAdapt(step);assert.equal(v.mesh.geometry.drawRange.count,globalThis.__kzHorizon().triangles*3);}
    assert.equal(v.mesh.material.uniforms.horizonPalette.value[0].getHex(),HORIZON.debug.range);
    let released=0;for(const resource of [v.mesh.geometry,v.mesh.material])resource.addEventListener('dispose',()=>released++);
    v.dispose();v.dispose();v.setAdapt(0);assert.equal(released,2);assert.equal(scene.children.length,0);assert.equal(globalThis.__kzHorizon,undefined);
  }
});
test('land colours follow the active sky at every time; range is fainter than headland',()=>{
  const {LEGACY_ATMOS: ATMOS}=awaitableAtmos;
  for(const time of ['morning','noon','golden','evening','dusk']){
    const a=kamakuraAtmosphere(time,{...ATMOS,sunDir:ATMOS.sunDir.toArray()});
    const v=createKamakuraHorizon({scene:new THREE.Scene(),data:{meta:{horizon:examples()}},atmosphere:{atmosphere:{params:a}},search:'?time='+time});
    const palette=v.mesh.material.uniforms.horizonPalette.value,haze=new THREE.Color(a.hazeCool??a.fogColor);
    const distance=c=>Math.hypot(c.r-haze.r,c.g-haze.g,c.b-haze.b);
    assert(distance(palette[0])<distance(palette[1]));v.dispose();
  }
});
import { kamakuraAtmosphere } from '../dist/valley/kamakura-atmosphere.js';
const awaitableAtmos=await load('atmosphere.js');
