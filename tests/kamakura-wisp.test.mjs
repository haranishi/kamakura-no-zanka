import test from 'node:test';
import assert from 'node:assert/strict';
import { WISP as C,WISP_TIMES,validateWisps,wispTime,wispDepth,wispEdge,wispNear,wispNoise,wispBudget,buildWisps } from '../dist/valley/kamakura-wisp.js';
import { validateMeta } from '../dist/valley/kamakura-data.js';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { THREE,source } from './helpers/tree-modules.mjs';
import { createKamakuraWisp,WISP_VERTEX,WISP_FRAGMENT } from '../dist/valley/kamakura-wisp-view.js';
const item=(extra={})=>({x:0,y:0,radius_m:60,height_m:5,strength:.8,...extra});
const bowl={heightAt:(x,z)=>10+(x*x+z*z)*.008};
const context=(extra={})=>({scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),data:{meta:{wisps:[item()]}},terrain:bowl,search:'?time=dusk&debug=1',...extra});

test('placed mist accepts optional data, validates every range and rejects unknown or nonnumeric values through meta',()=>{
  assert.equal(validateWisps(undefined),null);assert.deepEqual(validateWisps([]),[]);
  const f=fixture();assert.equal(validateMeta(f.meta),f.meta);
  for(const wisps of [[],[item()],Array.from({length:16},()=>item()),[item({radius_m:15,height_m:1.5,lift_m:0,strength:.1})],[item({radius_m:160,height_m:14,lift_m:25,strength:1})]]){
    f.meta.wisps=wisps;assert.equal(validateMeta(f.meta),f.meta);
  }
  for(const wisps of [null,{},[null],[[]],Array.from({length:17},()=>item()),[item({strenth:1})]])assert.throws(()=>validateMeta({...f.meta,wisps}),RangeError);
  for(const key of ['x','y','radius_m','height_m','lift_m','strength'])for(const value of [NaN,Infinity,-Infinity,'1',null,{},[]])assert.throws(()=>validateWisps([item({[key]:value})]),RangeError,key);
  for(const [key,values] of [['radius_m',[14.99,160.01]],['height_m',[1.49,14.01]],['lift_m',[-.01,25.01]],['strength',[.099,1.01]]])for(const value of values)assert.throws(()=>validateWisps([item({[key]:value})]),RangeError);
  for(const key of ['x','y','radius_m','height_m','strength']){const value=item();delete value[key];assert.throws(()=>validateWisps([value]),RangeError);}
});
test('bowl and slope have horizontal tops, terrain-derived depth and a soft disappearing bank; outer radius is clear',()=>{
  assert.equal(wispDepth(10,10,5),0);assert.equal(wispDepth(10,12,5),0);assert.equal(wispDepth(10,5,5),1);
  assert(wispDepth(10,9.99,5)<.00002);assert(wispDepth(10,7.5,5)>.4);
  assert.equal(wispEdge(60,60),0);assert.equal(wispEdge(90,60),0);assert.equal(wispEdge(42,60),1);assert(wispEdge(59.99,60)<.00001);
  for(const terrain of [bowl,{heightAt:x=>10+x*.2}]){
    const p=buildWisps([item({lift_m:1})],terrain),side=C.segments+1,perSheet=side*side;
    for(let i=0;i<p.depths.length;i++){
      const layer=Math.floor(i/perSheet),x=p.positions[i*3],h=p.positions[i*3+1],z=p.positions[i*3+2];
      assert.equal(h,16-layer*5*C.lowerShare);
      assert(Math.abs(p.depths[i]-wispDepth(h,terrain.heightAt(x,z),5)*.8)<1e-6);
    }
    assert(p.depths.some(d=>d===0));assert(p.depths.some(d=>d>.7));assert(p.depths.some(d=>d>0&&d<.3));
  }
  const p=buildWisps([item({x:12,y:20})],{heightAt:()=>10});assert.deepEqual(p.centres[0],{x:12,z:-20,top:16,lower:13.75});
});
test('approach fade, bounded opacity, shared flowing noise and all five time multipliers',()=>{
  for(const d of [0,10,25])assert.equal(wispNear(d,3),0);
  assert.equal(wispNear(60,3),1);assert.equal(wispNear(10,3.001),1);assert.equal(wispNear(42.5,-3),.5);
  assert.deepEqual(WISP_TIMES,{dusk:1,morning:1,evening:.8,golden:.3,noon:0});
  for(const [t,gain] of Object.entries(WISP_TIMES))assert.equal(wispTime(t),gain);
  for(let x=-100;x<200;x+=2){const a=wispNoise(x,13,7,.6,.8);assert(a>=C.noiseBase&&a<=1);assert(Math.abs(a-wispNoise(x-C.noiseSpeedMps*7*.6,13-C.noiseSpeedMps*7*.8,0))<1e-12);}
  assert(C.opacityCap<=.34);assert(1-(1-C.opacityCap)**2<=.56);
});
test('all quality/adapt budgets fit one draw and height is sampled once at preparation, never in update',t=>{
  const items=Array.from({length:16},(_,i)=>item({x:i*20}));
  for(const quality of ['standard','light']){
    let calls=0;const ctx=context({quality,data:{meta:{wisps:items}},terrain:{heightAt:()=>{calls++;return 10;}}});ctx.camera.position.set(0,60,150);
    const layer=createKamakuraWisp(ctx),p=layer.prepared,before=calls;
    assert.equal(calls,items.length*((quality==='light'?C.lightSegments:C.segments)+1)**2+items.length);assert.equal(calls,p.work);
    for(let step=0;step<=3;step++){
      layer.setAdapt(step);const b=wispBudget(16,quality,step),r=globalThis.__kzWisp();
      assert.equal(r.draws,1);assert.equal(r.triangles,b.triangles);assert(b.triangles<=(quality==='light'?6000:16000));
      assert.equal(layer.mesh.geometry.drawRange.count/3,b.triangles);assert.equal(p.lods[step].range,C.rangesM[step]);
    }
    layer.setAdapt(0);const array=layer.uniforms.wispFades.value,version=layer.mesh.geometry.attributes.wispDepth.version;
    const frame={dt:.016,windDir:[.6,.8]};for(let i=0;i<1000;i++)layer.update(frame);
    assert.equal(calls,before);assert.equal(layer.uniforms.wispFades.value,array);assert.equal(layer.mesh.geometry.attributes.wispDepth.version,version);
    layer.setPaused(true);const clock=layer.uniforms.wispClock.value;layer.update(frame);assert.equal(layer.uniforms.wispClock.value,clock);
    layer.setPaused(false);layer.update(frame);assert(layer.uniforms.wispClock.value>clock);
    const r=globalThis.__kzWisp();assert(Number.isFinite(r.nearest.distance));assert(r.nearest.bearing>=0&&r.nearest.bearing<360);
    t.diagnostic(JSON.stringify({quality,maxSources:16,drawnSources:p.lods[0].count,triangles:p.lods[0].triangles,draws:r.draws,heightQueries:p.work,vertices:p.positions.length/3,frameSources:r.frameWork,stableFrames:1000}));
    layer.dispose();
  }
  const hot=source('kamakura-wisp-view.js').split('update(frame)')[1].split('setAdapt')[0];assert(!/new |\.map\(|\.slice\(|=>/.test(hot));
});
test('flag/absent data produce no resources, noon is hidden, diagnostic pink bypasses opacity and resources dispose once',()=>{
  for(const [time,gain] of Object.entries(WISP_TIMES)){
    const v=createKamakuraWisp(context({search:'?time='+time}));
    assert.equal(v.uniforms.wispGain.value,gain);assert(v.uniforms.wispCool.value.toArray().every(Number.isFinite));v.dispose();
  }
  for(const ctx of [context({search:'?wisp=0'}),context({data:{meta:{}}}),context({data:{meta:{wisps:[]}}})]){assert.equal(createKamakuraWisp(ctx),null);assert.equal(ctx.scene.children.length,0);}
  const noTerrain={heightAt:()=>assert.fail('disabled layer sampled terrain')};assert.equal(createKamakuraWisp(context({terrain:noTerrain,search:'?wisp=0'})),null);
  for(const search of ['?time=noon&debug=1','?time=noon&debug=1&wispdebug=1','?time=dusk&debug=1']){
    const ctx=context({search}),v=createKamakuraWisp(ctx),reader=globalThis.__kzWisp;
    assert.equal(v.mesh.visible,!search.includes('noon')||search.includes('wispdebug'));
    assert.equal(v.mesh.material.depthWrite,false);assert.equal(v.mesh.material.depthTest,true);assert.equal(v.mesh.material.fog,true);assert.equal(v.mesh.material.forceSinglePass,true);assert.equal(v.mesh.castShadow,false);
    ctx.camera.position.set(0,16,0);v.update({dt:0});assert.equal(v.uniforms.wispFades.value[0],0);
    assert.equal(reader().count,search.includes('wispdebug')?1:0);
    let g=0,m=0;v.mesh.geometry.addEventListener('dispose',()=>g++);v.mesh.material.addEventListener('dispose',()=>m++);v.dispose();v.dispose();v.update({dt:1});v.setAdapt(2);
    assert.equal(g,1);assert.equal(m,1);assert.equal(ctx.scene.children.length,0);assert.equal(globalThis.__kzWisp,undefined);assert.equal(reader().draws,0);
  }
  assert(WISP_FRAGMENT.indexOf('if(wispDebug>.5)')>WISP_FRAGMENT.indexOf('#include <fog_fragment>'));
});
test('mist shaders use real Three chunks, balanced delimiters, declared names and float expressions',()=>{
  const types='float|int|vec[234]|mat[234]|sampler2D';
  for(let s of [WISP_VERTEX,WISP_FRAGMENT]){
    for(const [,chunk] of s.matchAll(/#include <(\w+)>/g))assert.equal(typeof THREE.ShaderChunk[chunk],'string',chunk);
    s=s.replace(/#include <\w+>/g,'').replace(/\/\/[^\n]*/g,'');
    const stack=[];for(const c of s){if('({['.includes(c))stack.push(c);else if(')}]'.includes(c))assert.equal(stack.pop(),'({['[')}]'.indexOf(c)]);}assert.equal(stack.length,0);
    assert(!/--\s*\d|\b(?:float|vec[234])\s+(?:input|output|sample|patch|filter|common|active)\b/.test(s));
    const known=new Set(['attribute','uniform','varying','void','main','return','if','discard','float','int','vec2','vec3','vec4','mix','floor','fract','sin','dot','length','max','pow','clamp','smoothstep','normalize','modelViewMatrix','projectionMatrix','cameraPosition','position','gl_Position','gl_FragColor']);
    for(const m of s.matchAll(new RegExp('\\b(?:'+types+')\\s+(\\w+)','g')))known.add(m[1]);
    for(const m of s.matchAll(/(?:uniform|varying|attribute)\s+\w+\s+([^;]+);/g))for(const n of m[1].split(','))known.add(n.trim().replace(/\[.*\]/,''));
    for(const m of s.matchAll(/,\s*(\w+)\s*=/g))known.add(m[1]);
    for(const m of s.matchAll(/(?<![\w.])([A-Za-z_]\w*)/g))assert(known.has(m[1]),m[1]+' undeclared');
    const scalars=s.replace(/\[\d+\]/g,'').replace(/\b[A-Za-z_]\w*/g,'');for(const m of scalars.matchAll(/(?<![\d.])\d+(?:\.\d*)?(?![\d.])/g))assert(m[0].includes('.'),'integer in float expression: '+m[0]);
  }
});
