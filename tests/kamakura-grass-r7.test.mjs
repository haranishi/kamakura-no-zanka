import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {grassR7Enabled,grassR7Variation,grassR7Gradient,grassR7Angle,grassR7RoundGain,grassR7Shade,packGrassR7} from '../dist/valley/kamakura-grass-r7.js';
import {grassR4Variation,grassLuminance,grassR4Pigment} from '../dist/valley/kamakura-grass-look.js';
import {grassR5Floor} from '../dist/valley/kamakura-grass-r5.js';
import {createGrassLook} from '../dist/valley/kamakura-grass-look-view.js';
import {localGrassR7Metrics} from '../tools/lib/grass-r7-metrics.mjs';
import {fixture} from './helpers/kamakura-fixture.mjs';
import {THREE,load} from './helpers/tree-modules.mjs';
const {buildGrass}=await load('grass-view.js'),{buildKamakuraGrass}=await load('kamakura-grass-view.js');
const env=()=>({height:1,dry:.4,shade:.8,flowers:0,margin:0});
const wind={uTime:{value:0},uWind:{value:1},uWindDir:{value:new THREE.Vector2(1,0)},uGuideMix:{value:0}};
globalThis.document={createElement(){const c={width:0,height:0,getContext:()=>({createLinearGradient:()=>({addColorStop(){}}),beginPath(){},moveTo(){},quadraticCurveTo(){},fill(){},getImageData:()=>({data:new Uint8ClampedArray(c.width*c.height*4)})})};return c;}};
const shaderFor=m=>{const s={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};m.onBeforeCompile(s);return s;};
const digest=s=>createHash('sha256').update(s.vertexShader).update(s.fragmentShader).digest('hex');
const stats=a=>{const mean=a.reduce((s,v)=>s+v,0)/a.length;return {mean,sd:Math.sqrt(a.reduce((s,v)=>s+(v-mean)**2,0)/a.length)};};
const raw=()=>{const a=new Float32Array(1200*15);for(let i=0;i<1200;i++)a.set([i%40*.71,0,Math.floor(i/40)*.39,0,.3,.03,.3,.5,.08,.15,.03,0,0,1,0],i*15);return a;};
const expanded=s=>s.replace(/#include <(\w+)>/g,(_,k)=>expanded(THREE.ShaderChunk[k]));
function balanced(src){
 const code=src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g,''),stack=[],pairs={')':'(',']':'[','}':'{'};
 for(const c of code){if('([{'.includes(c))stack.push(c);if(')]}'.includes(c))assert.equal(stack.pop(),pairs[c]);}assert.equal(stack.length,0);
 let depth=0;for(const m of code.matchAll(/^\s*#(if\w*|endif|else|elif)\b/gm)){if(m[1].startsWith('if'))depth++;if(m[1]==='endif')assert(--depth>=0);}assert.equal(depth,0);
 assert(!/\b(?:float|vec[234])\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(code));
 assert(!/--\s*(?:\d|\.\d)/.test(code));
 assert(!/(?<![A-Za-z_0-9])(?:\d+\.?\d*|\.\d+)(?:mix|vec[234]|smoothstep|clamp|max|min|abs|pow|sin|cos|dot|length|normalize|float)\(/.test(code));
}
test('GR1: local 30×12m blade distribution, hue bounds, stable reordered/windowed packing',t=>{
 const values=[];
 for(let z=0;z<12;z+=.11)for(let x=0;x<30;x+=.17){const v=grassR7Variation(x,z);assert(v.blade>=.75&&v.blade<=1.25);assert(Math.abs(v.hue)<=.025);values.push(v.blade);}
 const d=stats(values);assert(Math.abs(d.mean-1)<.003);assert(d.sd>.14&&d.sd<.148);
 const data=raw(),all=packGrassR7(data.slice(),'near','standard');
 for(let i=data.length-15;i>=0;i-=15){const one=packGrassR7(data.slice(i,i+15),'near','standard');for(let j=0;j<15;j++)assert.equal(one[j],all[i+j]);}
 for(const marker of [-2,-3]){const a=data.slice(0,15);a[11]=marker;assert.equal(Buffer.compare(Buffer.from(a.buffer),Buffer.from(packGrassR7(a.slice(),'near','standard').buffer)),0);}
 const a=data.slice(0,15),v=grassR4Variation(a[0],a[2]),stock=grassR4Pigment([...a.slice(8,11)],a[0],a[2],v,1);a.set(stock,8);
 const result=packGrassR7(a.slice(),'near','light');assert(Math.abs(grassLuminance([...result.slice(8,11)])/grassLuminance(stock)-grassR7Variation(a[0],a[2]).blade/v.blade)<1e-6);
 t.diagnostic(JSON.stringify({localBladeBrightness:d}));
});
// R7 parent tuning: gradient 0.40-1.40 and tip lift 0.28 (the first 0.65-1.20 / 0.12 gave no screen change).
test('GR2: one sky deficit, monotone root/tip gradient, zero sun change, weaker dusk',()=>{
 const sky=[.65,.8,1],c=[.08,.15,.03];let previous=0;
 assert.equal(grassR7Gradient(0),.55);assert(Math.abs(grassR7Gradient(1)-1.40)<1e-12);
 for(let k=0;k<=100;k++){const y=k/100,g=grassR7Gradient(y);assert(g>=previous);previous=g;}
 const root=grassR7Shade(c,sky,[0,0,0],0,1,0),tip=grassR7Shade(c,sky,[0,0,0],0,1,1),dusk=grassR7Shade(c,sky,[0,0,0],0,.1,1);
 assert(grassLuminance(tip)>grassLuminance(root)*2);assert(grassLuminance(dusk)<grassLuminance(tip));
 for(const y of [0,.1,.5,1]){
  const lit=[.1,.2,.04];assert.deepEqual(grassR7Shade(c,sky,lit,.03,1,y),lit);
  const old=grassR5Floor(c,sky,[0,0,0],0,1);assert.deepEqual(grassR7Shade(c,sky,[0,0,0],0,1,y,0),[0,0,0]);
  const newY=grassLuminance(grassR7Shade(c,sky,[.03,.03,.03],0,1,y));assert(newY<.08,'existing illumination is deducted, not stacked');assert(grassLuminance(old)<=.0200001);
 }
});
test('GR2 local strength: 30×12m retains old fine variation, SD grows ≥25% without mean drift',()=>{
 for(const scale of [.15,.35,.55])for(const sunY of [1,.1]){const m=localGrassR7Metrics(scale,sunY);assert(m.sdGain>=1.25);assert(Math.abs(m.meanChange)<.2);}
});
test('GR3: 25 degree vertex limit and ≤10% lighting change for all light directions',()=>{
 for(let u=0;u<=1;u+=.01){const a=grassR7Angle(u);assert(Math.abs(a)<=25*Math.PI/180+1e-12);
  for(let theta=-Math.PI;theta<Math.PI;theta+=.013){const gain=grassR7RoundGain(Math.max(0,Math.cos(theta)),Math.max(0,Math.cos(theta-a)));assert(gain>=.9&&gain<=1.1);}
 }
});
test('R7 actual Three hooks: no geometry cost, full/light/adapt, old path identical and balanced GLSL',t=>{
 const nx=64,n=nx*nx,field={seed:1333,x0:-32,z0:-32,nx,nz:nx,placeable:new Uint8Array(n).fill(1),density:new Uint8Array(n).fill(159),height:new Uint8Array(n).fill(255),species:new Uint8Array(n),midPatch:new Float32Array(n).fill(1.6),heights:new Float32Array((nx+1)**2)};
 for(const quality of ['standard','light']){
  const records=[];
  const r6Hashes=quality==='standard'?{near:'0535469bf1d77ccd6637fa20a6b83f186b75f1f6e58e54557e1ccd465349772f',mid:'913c93dd48933e2d05e3c5a58a41caf0bcd2e1664ec937fbc2fe124a90f6ea9f'}:{near:'728f0ec02c47045e2890585ce9423e7684f5171d19da50e003a44cad4b190b78',mid:'08fed80165d4b3bb9f43ff044cc54120bf6187e904b2b48c97b2634b87a233f0'};
  for(const r7 of [false,true]){
   const look=createGrassLook(env,quality,{value:new THREE.Vector4()},true,true,true,true,r7),view=buildGrass({field,wind,sunDir:new THREE.Vector3(1,1,0),quality,look,reach:{near:32,mid:158,midInner:4}});
   try{view.warm({position:new THREE.Vector3(0,2,0)});const shaders={};
    for(const m of new Set(view.group.children.map(o=>o.material))){const s=shaderFor(m),key=m.map?'mid':'near';shaders[key]=digest(s);if(!r7)assert.equal(shaders[key],r6Hashes[key]);for(const c of [s.vertexShader,s.fragmentShader]){balanced(c);balanced(expanded(c));}
     const full=r7&&quality!=='light'&&!m.map;
     assert.equal(s.vertexShader.includes('grass7Angle='),full);assert.equal(s.fragmentShader.includes('float grass7Gradient='),full);
     if(full){
      const expr=s.fragmentShader.match(/float grass7Gradient=([^;]+);/)[1];
      const gradient=new Function('vGrassUV','grass7Gate','mix','sqrt','clamp',`return ${expr}`);
      for(const y of [0,.1,.5,1])for(const gate of [0,.35,1])assert(Math.abs(gradient({y},gate,(a,b,t)=>a+(b-a)*t,Math.sqrt,(v,a,b)=>Math.max(a,Math.min(b,v)))-(1+(grassR7Gradient(y)-1)*gate))<1e-12);
      assert(s.vertexShader.includes('vGrass7FlatNormal=normalize(normalMatrix*objectNormal)'));assert(s.fragmentShader.includes('normal*=faceDirection'));
      assert.equal((s.fragmentShader.match(/grass6Target-grass6Current/g)||[]).length,1);assert(!s.fragmentShader.includes('float grass4Floor='));
      assert.equal((s.fragmentShader.match(/getShadow\( directionalShadowMap/g)||[]).length,1);
      assert(s.fragmentShader.includes('reflectedLight.directDiffuse*=grass7RoundGain;'));assert(s.fragmentShader.includes('grass7TipSky=grass4KeepLuma'));
     }
    }
    for(const step of [0,1,2,3]){look.setAdapt(step);assert.equal(look.uniforms.uGrass7Strength.value,quality==='light'?0:step>=3?0:step>=2?.35:1);}
    records.push({triangles:view.stats().triangles,shaders});
   }finally{view.dispose();view.dispose();}
  }
  assert.equal(records[0].triangles,records[1].triangles);assert.equal(records[0].shaders.mid,records[1].shaders.mid);
  if(quality==='light')assert.equal(records[0].shaders.near,records[1].shaders.near);
  t.diagnostic(JSON.stringify({quality,triangles:records[0].triangles,r6Hashes:records[0].shaders}));
 }
});
test('R7 URL: grass7=0 restores complete R6 packing and programs; old flags and valley preserved',()=>{
 assert(grassR7Enabled(''));assert(!grassR7Enabled('?grass7=0'));
 const data=fixture();data.meta.surface={};data.surface=new Uint8Array(data.meta.grid.width*data.meta.grid.height).fill(2);
 const terrain={heightAt:()=>10,slopeAt:()=>0,waterAt:()=>0,walkable:()=>true,riverDistanceAt:()=>Infinity,seaDistanceAt:()=>50};
 for(const search of ['', '?grass7=0','?grass6=0','?grass4=0']){
  const view=buildKamakuraGrass({data,terrain,search,wind,sunDir:new THREE.Vector3(1,1,0)});
  try{view.warm({position:new THREE.Vector3(0,12,0)});assert.equal(view.stats().r7,search==='');
   for(const m of new Set(view.group.children[0].children.map(o=>o.material))){const s=shaderFor(m);assert.equal(s.fragmentShader.includes('grass7Gradient='),search===''&&!m.map);if(search==='?grass7=0')assert(!m.customProgramCacheKey().includes('-r7'));}
  }finally{view.dispose();}
 }
 const look=createGrassLook(env,'standard',{value:new THREE.Vector4()},true,true,true,true),off=createGrassLook(env,'standard',{value:new THREE.Vector4()},true,true,true,true,false);
 assert.equal(Buffer.compare(Buffer.from(look.pack(raw(),'near').buffer),Buffer.from(off.pack(raw(),'near').buffer)),0);
 const valley=buildGrass({field:{seed:1,x0:0,z0:0,nx:1,nz:1,placeable:new Uint8Array(1),density:new Uint8Array(1),height:new Uint8Array(1),species:new Uint8Array(1),heights:new Float32Array(4)},wind,sunDir:new THREE.Vector3(1,1,0)});
 try{valley.warm({position:new THREE.Vector3()});for(const m of new Set(valley.group.children.map(o=>o.material)))assert(!shaderFor(m).fragmentShader.includes('grass7'));}finally{valley.dispose();}
});
