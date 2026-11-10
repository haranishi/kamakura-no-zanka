import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { THREE,load,source } from './helpers/tree-modules.mjs';
import { MIST } from '../dist/valley/kamakura-mist.js';
import { postOptions } from '../dist/valley/kamakura-post.js';
import { cloudHigh, CLOUD_HIGH, lightFinalShader } from '../dist/valley/kamakura-sky-fx.js';
import { KAMAKURA_TIMES } from '../dist/valley/kamakura-atmosphere.js';
const {createKamakuraPost,POST_SHADERS}=await load('kamakura-post-view.js');
const terrain={bounds:{minX:-512,maxX:512,minZ:-512,maxZ:512},heightAt:x=>50+Math.min(80,Math.abs(x)*.4)};
function stub(){let target=null,w=1280,h=720;const draws=[],resources=new Map();
  const track=r=>{if(!r||resources.has(r))return;resources.set(r,0);r.addEventListener('dispose',()=>resources.set(r,resources.get(r)+1));};
  return {toneMapping:THREE.NoToneMapping,toneMappingExposure:1,autoClear:false,draws,resources,getRenderTarget:()=>target,
    getDrawingBufferSize:v=>v.set(w,h),size(x,y){w=x;h=y;},setRenderTarget(t){target=t;track(t);track(t?.depthTexture);},
    render(scene){scene.traverse(o=>{track(o.geometry);track(o.material);for(const uniform of Object.values(o.material?.uniforms??{}))if(uniform.value?.isDataTexture)track(uniform.value);});draws.push({material:scene.children[0]?.material});}};}
const camera=()=>new THREE.PerspectiveCamera(40,16/9,1,10000),sun=()=>new THREE.Vector3(-.8,.4,.44).normalize();
const hash=s=>createHash('sha256').update(s).digest('hex');
test('cloud high altitude: exact legacy below 250m, smooth endpoints, high 3x / .45, flag restores original',()=>{
  const out={};for(const height of [-100,0,249,250]){cloudHigh(height,true,out);assert.equal(out.scale,1);assert.equal(out.strength,1);}
  for(const height of [750,900,10000]){cloudHigh(height,true,out);assert.equal(out.scale,CLOUD_HIGH.scale);assert.equal(out.strength,CLOUD_HIGH.strength);}
  cloudHigh(500,true,out);assert.equal(out.scale,2);assert.equal(out.strength,.725);
  cloudHigh(900,false,out);assert.equal(out.scale,1);assert.equal(out.strength,1);
});
test('mist only creates depth; first render does no terrain work, field spreads across frames; no added pass',t=>{
  let heightCalls=0,stamp=0;const r=stub(),p=createKamakuraPost({renderer:r,terrain:{...terrain,heightAt:x=>{heightCalls++;return terrain.heightAt(x);}},search:'?debug=1&shafts=0&cloud=0',sunDir:sun(),params:KAMAKURA_TIMES.golden,now:()=>stamp});
  const c=camera(),w=new THREE.Scene();c.position.set(0,800,1000);
  p.render(w,c);assert.equal(heightCalls,0);assert(!globalThis.__kzAir().mist.ready);assert(p.targets[0].depthTexture);assert.equal(r.draws.length,6);
  let frames=1;
  while(!globalThis.__kzAir().mist.ready){stamp+=16;r.draws.length=0;p.render(w,c);frames++;assert(frames<200);assert.equal(r.draws.length,6);}
  assert(frames>1);const air=globalThis.__kzAir(),u=r.draws.at(-1).material.uniforms,texture=u.mistField.value;
  assert.equal(texture.format,THREE.RGFormat);assert.equal(texture.type,THREE.FloatType);assert(texture.image.width<=512&&texture.image.height<=512);assert.equal(heightCalls,air.mist.cells);
  assert.equal(air.mist.strength,.5);assert(u.mistCool.value.isColor);assert(u.mistWarm.value.isColor);
  const lum=c=>.2126*c.r+.7152*c.g+.0722*c.b,expected=lum(new THREE.Color(KAMAKURA_TIMES.golden.horizon))*MIST.brightness;
  assert(Math.abs(lum(u.mistCool.value)-expected)<1e-12);assert(Math.abs(lum(u.mistWarm.value)-expected)<1e-12);
  const refs=Object.fromEntries(Object.entries(u).filter(([,v])=>typeof v.value==='object').map(([k,v])=>[k,v.value]));
  const before=r.resources.size;
  for(let i=0;i<1000;i++){stamp+=16;r.draws.length=0;p.render(w,c);assert.equal(u.mistField.value,texture);}
  assert.equal(r.resources.size,before);for(const [k,v] of Object.entries(refs))assert.equal(u[k].value,v);
  assert.equal(u.mistWind.value.x,1);assert.equal(u.mistWind.value.y,0);
  r.size(640,360);p.resize();assert.equal(u.mistField.value,texture);assert.equal(r.resources.get(texture),0);
  p.setAdapt(2);assert(!air.mist.enabled);assert(!air.mist.ready);assert.equal(r.resources.get(texture),1);
  p.dispose();p.dispose();assert.equal(globalThis.__kzAir,undefined);for(const n of r.resources.values())assert.equal(n,1);
  t.diagnostic(JSON.stringify({syntheticCells:air.mist.cells,firstReadyFrame:frames,textureBytes:texture.image.data.byteLength,stableFrames:1000,addedDraws:0,addedTriangles:0}));
});
test('mist=0, light, post=0 and initial downgrade never call terrain; disposal during preparation is safe',()=>{
  for(const args of [{search:'?mist=0&cloudhigh=0'},{quality:'light'},{search:'?post=0'}]){
    const r=stub(),p=createKamakuraPost({renderer:r,terrain:{...terrain,heightAt:()=>assert.fail('terrain accessed')},...args});
    for(let i=0;i<10;i++)p.render(new THREE.Scene(),camera());p.dispose();
    assert([...r.resources.keys()].every(o=>!o.isDataTexture));for(const n of r.resources.values())assert.equal(n,1);
  }
  const r=stub(),p=createKamakuraPost({renderer:r,terrain,search:'?debug=1'});p.setAdapt(2);p.render(new THREE.Scene(),camera());assert(!globalThis.__kzAir().mist.ready);assert.equal(r.resources.size,0);p.dispose();
  const r2=stub(),p2=createKamakuraPost({renderer:r2,terrain,search:'?debug=1&cloud=0&shafts=0',now:(()=>{let t=0;return ()=>t+=3;})()});
  p2.render(new THREE.Scene(),camera());p2.render(new THREE.Scene(),camera());assert(!globalThis.__kzAir().mist.ready);p2.dispose();p2.dispose();assert.equal(globalThis.__kzAir,undefined);
});
test('high cloud renderer samples height above terrain; flag skips height query and restores exact old program',()=>{
  for(const high of [true,false]){
    let calls=0;const r=stub(),p=createKamakuraPost({renderer:r,terrain:{...terrain,heightAt:()=>{calls++;return 100;}},search:'?debug=1&mist=0&shafts=0'+(high?'':'&cloudhigh=0'),sunDir:sun()});
    const c=camera();c.position.y=850;p.render(new THREE.Scene(),c);
    const u=r.draws.at(-1).material.uniforms;
    assert.equal(u.cloudStrength.value,high?.25*.45:.25);assert.equal(globalThis.__kzAir().cloud.scale,high?3:1);assert.equal(calls,high?1:0);
    if(high)assert.equal(u.cloudScale.value,3);else assert(!Object.hasOwn(u,'cloudScale'));p.dispose();
  }
  // Original R10 final program (cloud on, shafts off) from the pre-change source.
  const disabled=lightFinalShader(POST_SHADERS.final,postOptions('?shafts=0&mist=0&cloudhigh=0'));
  assert.equal(hash(disabled),'3bc60a46263b92e32dfde6ef35e94cd52b090e381fdd40819fbb3a52c3f8968d');
  const enabled=lightFinalShader(POST_SHADERS.final,postOptions('?shafts=0&mist=0'));
  assert.equal(enabled.replace('cloudTime, cloudStrength, cloudScale;','cloudTime, cloudStrength;').replace('/(520.0*cloudScale);','/520.0;'),disabled);
  assert.equal(lightFinalShader(POST_SHADERS.final,postOptions('?shafts=0&cloud=0&mist=0&cloudhigh=0')),POST_SHADERS.final);
  assert.throws(()=>lightFinalShader('void main(){}',postOptions('')));
});
test('shared debug owner combines atmosphere and post and releases each owner in either disposal order',()=>{
  assert.match(source('world-kamakura.js'),/createKamakuraPost\(\{[^\n]*terrain: t,/);
  const original=()=>({flying:true,shadow:{size:100},mist:{},cloud:{}});const air=original();const getter=()=>air;globalThis.__kzAir=getter;
  const r=stub(),p=createKamakuraPost({renderer:r,terrain,search:'?debug=1',sunDir:sun()});p.render(new THREE.Scene(),camera());assert.equal(globalThis.__kzAir,getter);assert.equal(globalThis.__kzAir().shadow.size,100);p.dispose();assert.equal(globalThis.__kzAir,getter);delete globalThis.__kzAir;
  const hot=source('kamakura-post-view.js').split('render(world,view) {')[1].split('dispose(){')[0];assert(!/\bnew\s|\.clone\(|\.map\(/.test(hot));
});
