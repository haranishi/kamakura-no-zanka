import test from 'node:test';
import assert from 'node:assert/strict';
import { FLIGHT_SHADOW as F, flightShadowSize, flightShadowBox, flightShadowEnabled, createFlightShadowState } from '../dist/valley/kamakura-flight-shadow.js';
import { snapShadowCenter } from '../dist/valley/shadow-snap.js';
import { softShadowEnabled } from '../dist/valley/kamakura-shadow.js';
import { THREE,load,source } from './helpers/tree-modules.mjs';
const {createKamakuraAtmosphere}=await load('kamakura-atmosphere-view.js');
const flat={heightAt:()=>20},sun=[-.8,.4,.4472135954999579];
const close=(a,b,e=1e-5)=>assert(Math.abs(a-b)<e,`${a} != ${b}`);
test('flight box ray hits synthetic ground, distance/span equation, bounds, quantization, hysteresis and snapping',t=>{
  const p={x:50,y:720,z:10},d={x:0,y:-.5,z:-Math.sqrt(.75)},s=createFlightShadowState();
  assert.equal(flightShadowBox(p,d,flat,sun,4096,s),s);close(s.center[1],20);close(s.center[2],10-Math.sqrt(.75)*1400,.04);
  close(s.centerDistance,1400,.04);assert.equal(s.size,flightShadowSize(s.centerDistance));assert(s.size>=s.centerDistance*.95 && s.size<s.centerDistance*.95*1.25);
  assert.equal(flightShadowSize(0),F.minSize);assert.equal(flightShadowSize(1e10),F.maxSize);
  const size=s.size;for(let i=0;i<1000;i++){p.x+=.00001;flightShadowBox(p,d,flat,sun,4096,s);assert.equal(s.size,size);}
  assert.deepEqual(s.snapped,snapShadowCenter(...s.center,sun,s.texel));assert.equal(s.texel,s.size/4096);
  assert.equal(s.bias,-F.biasTexels*s.texel/(s.far-s.near));assert.equal(s.normalBias,F.normalTexels*s.texel);
  assert(s.far>s.sunDistance+F.relief);assert(!s.soft);assert(!softShadowEnabled('','standard',{},s.size));assert(softShadowEnabled('','standard',{},F.minSize));
  const level=flightShadowSize(1000);assert.equal(flightShadowSize(level/.95*1.02,level),level);
  assert(flightShadowSize(level/.95*1.12,level)>level);
  assert.equal(flightShadowSize(level/1.25/.95*.98,level),level);assert(flightShadowSize(level/1.25/.95*.8,level)<level);
  t.diagnostic(JSON.stringify({syntheticSpan:s.size,texel:s.texel,near:s.near,far:s.far,bias:s.bias,normalBias:s.normalBias,soft:s.soft,addedDraws:0}));
});
test('ray traces terrain relief; upward and too-far rays use bounded ground fallbacks and stay stable',()=>{
  const terrain={heightAt:(x,z)=>20-z*.05},s=createFlightShadowState(),p={x:0,y:720,z:0};
  flightShadowBox(p,{x:0,y:-.5,z:-Math.sqrt(.75)},terrain,sun,4096,s);
  close(p.y-.5*s.centerDistance,terrain.heightAt(...[s.center[0],s.center[2]]),.05);
  for(const dir of [{x:0,y:0,z:-1},{x:0,y:.5,z:-Math.sqrt(.75)}]){
    s.size=0;flightShadowBox(p,dir,flat,sun,4096,s);assert.equal(s.center[2],-F.maxSize/2);assert.equal(s.center[1],20);
    const center=s.center.slice(),size=s.size;for(let i=0;i<100;i++){flightShadowBox(p,dir,flat,sun,4096,s);assert.deepEqual(s.center,center);assert.equal(s.size,size);}
  }
  flightShadowBox({x:0,y:12000,z:0},{x:0,y:-.01,z:-Math.sqrt(.9999)},flat,sun,4096,s);assert(Math.abs(s.center[2])<=F.maxDistance);
  assert(flightShadowEnabled(''));assert(!flightShadowEnabled('?flyshadow=0'));
});
function renderer(){let target=null;return {shadowMap:{enabled:false,type:THREE.BasicShadowMap},xr:{enabled:false},autoClear:true,toneMapping:THREE.NoToneMapping,
  state:{buffers:{depth:{getReversed:()=>false}}},compile(){},getRenderTarget:()=>target,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,
  getClearColor:c=>c.set(0),setRenderTarget:t=>{target=t;},render(){}};}
function snapshot(a){const s=a.sun.shadow,c=s.camera;return {box:[c.left,c.right,c.top,c.bottom,c.near,c.far],position:a.sun.position.toArray(),target:a.sun.target.position.toArray(),bias:s.bias,normalBias:s.normalBias,radius:s.radius};}
test('real atmosphere: walking unchanged in all times, flight restores original box/light/filter, flags and quality',()=>{
  const camera=new THREE.PerspectiveCamera(),pos={x:50,y:20,z:10};camera.position.set(30,720,50);camera.rotation.x=-.4;camera.updateMatrixWorld();
  for(const time of ['morning','noon','golden','evening']){
    const r=renderer(),c=createKamakuraAtmosphere({scene:new THREE.Scene(),renderer:r,search:'?time='+time+'&debug=1'}),a=c.atmosphere;
    assert(a);c.update(camera,.01,pos,.4);const walk=snapshot(a);
    assert.deepEqual(walk.box,[-46,46,46,-46,1,260]);assert.equal(walk.bias,-.0003);assert.equal(walk.normalBias,.05);assert.equal(walk.radius,2);
    const expected=a.sun.target.position.clone().addScaledVector(c.sunDir,150).toArray();assert.deepEqual(walk.position,expected);
    c.update(camera,.01,camera.position,0,true,flat);assert(globalThis.__kzAir().flying);assert(globalThis.__kzAir().shadow.size>150);assert.equal(a.sun.shadow.radius,1);assert.equal(r.shadowMap.type,THREE.PCFShadowMap);
    c.update(camera,.01,pos,.4,false,flat);assert.deepEqual(snapshot(a),walk);assert.equal(r.shadowMap.type,THREE.PCFSoftShadowMap);
    c.setAdapt({shadows:false,scale:.58});c.update(camera,.01,camera.position,0,true,flat);assert.equal(a.sun.shadow.camera.right,46);assert(!a.sun.castShadow);
    c.setAdapt({shadows:true,scale:1});c.update(camera,.01,camera.position,0,true,flat);assert(a.sun.shadow.camera.right>46);
    c.dispose();c.dispose();assert.equal(globalThis.__kzAir,undefined);
    for(const args of [{search:'?flyshadow=0&time='+time},{quality:'light',search:'?time='+time}]){
      const off=createKamakuraAtmosphere({scene:new THREE.Scene(),renderer:renderer(),...args});off.update(camera,.01,camera.position,0,true,flat);
      assert.deepEqual(snapshot(off.atmosphere).box,[-46,46,46,-46,1,260]);assert.equal(off.atmosphere.sun.shadow.bias,-.0003);off.dispose();
    }
  }
  const hot=source('kamakura-atmosphere-view.js').split('update(camera, dt, hero, yaw,')[1].split('dispose()')[0];assert(!/\bnew\s|\.clone\(|\.map\(/.test(hot));
});
