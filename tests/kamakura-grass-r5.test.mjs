import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {grassR5Enabled,grassR5Jitter,grassR5Weights,nearGrassR5DensityAt,grassR5Floor} from '../dist/valley/kamakura-grass-r5.js';
import {grassR4Coast,grassLuminance,packGrassLook,packGrassR4} from '../dist/valley/kamakura-grass-look.js';
import {nearGrassR3DensityAt} from '../dist/valley/kamakura-grass-r3.js';
import {midGrassBandOffset} from '../dist/valley/kamakura-grass-band.js';
import {createGrassLook} from '../dist/valley/kamakura-grass-look-view.js';
import {fixture} from './helpers/kamakura-fixture.mjs';
import {THREE,load} from './helpers/tree-modules.mjs';
const {buildGrass}=await load('grass-view.js');
const {buildKamakuraGrass}=await load('kamakura-grass-view.js');
const environment=()=>({height:1,dry:.4,shade:0,flowers:0,margin:0});
const wind={uTime:{value:0},uWind:{value:1},uWindDir:{value:new THREE.Vector2(1,0)},uGuideMix:{value:0}};
globalThis.document={createElement(){const c={width:0,height:0,getContext:()=>({createLinearGradient:()=>({addColorStop(){}}),beginPath(){},moveTo(){},quadraticCurveTo(){},fill(){},getImageData:()=>({data:new Uint8ClampedArray(c.width*c.height*4)})})};return c;}};
function field(){const nx=128,n=nx*nx;return {seed:1333,x0:-64,z0:-64,nx,nz:nx,placeable:new Uint8Array(n).fill(1),density:new Uint8Array(n).fill(159),height:new Uint8Array(n).fill(255),species:new Uint8Array(n),midPatch:new Float32Array(n).fill(1.6),heights:new Float32Array((nx+1)**2)};}
const shaderFor=m=>{const s={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};m.onBeforeCompile(s);return s;};
const r4Golden={standardNear:'48b43ab1ccc78b53ecaaabe28ec60dec0220a13e8dc1e111ed8df783cd5da2a2',standardMid:'af6b05d73f2e878182eef509e17a7fda1b271f5c0aa33c9bb78bb7f3cb6b022c',lightNear:'3c165f2c004605b6a3af70c039f5e3555ce2ba5f36d9a766b67550bdf0d8f0f9',lightMid:'d7401023c262a68da41d08489bbf0d6b92050400c834a13ff1c60e2d480d3114'};
const digest=s=>createHash('sha256').update(s.vertexShader).update(s.fragmentShader).digest('hex');
const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
const expanded=s=>s.replace(/#include <(\w+)>/g,(_,k)=>expanded(THREE.ShaderChunk[k]));
function balanced(code){
 const stack=[],pairs={')':'(',']':'[','}':'{'};let depth=0;
 for(const c of code.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g,'')){if('([{'.includes(c))stack.push(c);if(')]}'.includes(c))assert.equal(stack.pop(),pairs[c]);}assert.equal(stack.length,0);
 for(const m of code.matchAll(/^\s*#(if\w*|endif|else|elif)\b/gm)){if(m[1].startsWith('if'))depth++;if(m[1]==='endif')assert(--depth>=0);}assert.equal(depth,0);
 assert(!/\b(?:float|vec[234])\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(code));
 // A replaced fragment that leaves a number glued to an identifier ('0mix(') is a GLSL compile error only a real GPU reports.
 assert(!/(?<![A-Za-z_0-9])(?:\d+\.?\d*|\.\d+)(?:mix|vec[234]|smoothstep|clamp|max|min|abs|pow|sin|cos|dot|length|normalize|float)\(/.test(code.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g,'')));
}
test('GS1 world-keyed ±25% jitter and complementary density: no holes or distance steps',t=>{
 let maxDeviation=0,maxRelativeDeviation=0,maxRateAdjustedDeviation=0;
 // Independent unsigned reference, including negative/large world coordinates.
 for(const x of [-4000,-.1,0,.1,5000])for(const z of [-2000,-.3,0,.7,3000]){
  let h=(BigInt(Math.floor(x*16))*1664525n+BigInt(Math.floor(z*16))*1013904223n+1327n)&0xffffffffn;
  h=((h^(h>>16n))*2246822519n)&0xffffffffn;h=h^(h>>13n);
  assert.equal(grassR5Jitter(x,z),.75+.5*Number(h&65535n)/65535);
 }
 for(let d=0;d<=144;d+=.25){let sum=0,baseline=0,rateAdjusted=0;
  for(let z=0;z<32;z++)for(let x=0;x<32;x++){
   const xx=x*.731+.17,zz=z*.913+.29,j=grassR5Jitter(xx,zz),w=grassR5Weights(xx,zz,d);
   assert(j>=.75&&j<=1.25);assert.equal(j,grassR5Jitter(xx,zz));
   assert(Math.abs(w.near+w.mid-w.total)<1e-12);assert.equal(w.near,nearGrassR5DensityAt(xx,zz,d));
   assert(nearGrassR5DensityAt(xx,zz,d+.01)<=w.near+1e-12);
   const next=grassR5Weights(xx,zz,d+.001);assert(Math.abs(next.mid-w.mid)<.0002);
   sum+=w.total;rateAdjusted+=w.near+w.mid*(.42/.38)*(1-(1-.38/.42)*smooth(30,40,d));const md=d+midGrassBandOffset(xx,zz)*smooth(30,70,d);
   // R3 shader broadens the legacy CPU helper's 6–18m gate to 6–26m.
   baseline+=nearGrassR3DensityAt(xx,zz,d)+smooth(6,26,md)*(1-.50*smooth(28,110,md))*(1-smooth(80,144,md));
  }
  // The tail can reach zero at different distances; compare normalized unit coverage,
  // rather than divide by a vanishing baseline at the horizon.
  maxDeviation=Math.max(maxDeviation,Math.abs(sum-baseline)/1024);
  if(baseline>1e-6){maxRelativeDeviation=Math.max(maxRelativeDeviation,Math.abs(sum/baseline-1));maxRateAdjustedDeviation=Math.max(maxRateAdjustedDeviation,Math.abs(rateAdjusted/baseline-1));}
 }
 assert(maxRateAdjustedDeviation<.20,`rate-adjusted deviation ${maxRateAdjustedDeviation}`);assert(maxRelativeDeviation<.20,`relative deviation ${maxRelativeDeviation}`);t.diagnostic(JSON.stringify({maximumAbsoluteCoverageDeviation:maxDeviation,maximumRelativeCoverageDeviation:maxRelativeDeviation,maximumRateAdjustedCoverageDeviation:maxRateAdjustedDeviation}));
});
test('GS2 sky floor reaches .020 linear in shadow/back faces, leaves sunlit unchanged, weakens at dusk',()=>{
 for(const c of [[.04,.12,.02],[.001,.002,.001],[0,0,0]])for(const y of [0,.001,.008,.019]){
  const current=[y,y,y],day=grassR5Floor(c,[.65,.8,1],current,0,1),dusk=grassR5Floor(c,[.65,.8,1],current,0,.1);
  assert(y+grassLuminance(day)>=.020-1e-12);assert(grassLuminance(dusk)<=grassLuminance(day));
  assert.equal(grassLuminance(grassR5Floor(c,[.65,.8,1],current,.03,1)),0);
  assert.equal(grassLuminance(grassR5Floor(c,[.65,.8,1],current,0,1,0)),0);
 }
});
test('GS3 coast density floor .35 → .55; height/width stay byte-identical and inland density stays 1',()=>{
 for(const d of [0,10,20,40,75,100])for(const h of [0,.5,1,7,20]){
  const before=grassR4Coast(d,h),after=grassR4Coast(d,h,true);
  assert.equal(before.height,after.height);assert.equal(before.width,after.width);assert(after.density>=.55&&after.density>=before.density);
 }
 assert.equal(grassR4Coast(0,0,true).density,.55);assert.equal(grassR4Coast(100,20,true).density,1);
});
test('R5 rendered buffers and shaders: triangle budget, old opt-out, adaptive strength and valid GLSL',t=>{
 const totals=[];const hashes={};
 for(const quality of ['standard','light'])for(const r5 of [false,true]){
  const look=createGrassLook(environment,quality,{value:new THREE.Vector4()},true,true,true,r5);
  const view=buildGrass({field:field(),wind,sunDir:new THREE.Vector3(1,1,0),quality,look,reach:{near:32,mid:158,midInner:r5?4:8}});
  try{view.warm({position:new THREE.Vector3(0,2,0)});totals.push({quality,r5,...view.stats()});
   for(const m of new Set(view.group.children.map(o=>o.material))){
    const s=shaderFor(m),vs=s.vertexShader,fs=s.fragmentShader;
    for(const code of [vs,fs]){balanced(code);balanced(expanded(code));}
    const key=quality+(m.map?'Mid':'Near');if(!r5){hashes[key]=digest(s);assert.equal(hashes[key],r4Golden[key]);}
    if(r5){
     assert(vs.includes('grass6Distance(iRoot.xz,dd/'));assert(vs.includes('grass6Weights(bandDistance)'));
     assert(!fs.includes('float grass4Floor='));assert(fs.includes('grass6Current='));
     assert(fs.indexOf('grass6Current=')>fs.indexOf('grassSunVisibility = ( directLight.visible'));
     const darkExpr=fs.match(/float grass6Dark=([^;]+);/)[1];
     const dark=new Function('reflectedLight','smoothstep','dot','vec3',`return ${darkExpr}`);
     for(const y of [0,.001,.019,.020,.025,1])assert.equal(dark({directDiffuse:[y,y,y]},smooth,(a,b)=>grassLuminance(a),()=>[.2126,.7152,.0722]),1-smooth(.020,.025,y));
     assert(fs.includes('max(mix(.020,.010,grass6Dusk),grass6Y)'));
     assert.equal((fs.match(/getShadow\( directionalShadowMap/g)||[]).length,1);
     assert(fs.indexOf('fwidth(vGrassUV.x)')<fs.indexOf('#include <alphatest_fragment>'));
     assert(!/texture\w*\(/.test(fs.slice(fs.indexOf('vec3 grass6Sky='),fs.indexOf('grass6Dark*uGrass6Strength;'))));
     if(m.map){assert(vs.includes('t*mix(iShape.x,grassHeight'));assert(!vs.includes('transformed.y*=mix(1.0,clamp(abs(iShape.z)'));}
    }else assert(!fs.includes('grass6Current='));
   }
   for(const step of [0,1,2,3]){look.setAdapt(step);assert.equal(look.uniforms.uGrass6Strength.value,(quality==='light'?.5:1)*(step>=3?0:step>=2?.35:1));}
  }finally{view.dispose();view.dispose();}
 }
 for(let i=0;i<totals.length;i+=2)assert(totals[i+1].triangles<=totals[i].triangles*1.15);
 assert(grassR5Enabled(''));assert(!grassR5Enabled('?grass6=0'));
 t.diagnostic(JSON.stringify({totals:totals.map(({quality,r5,triangles,nearBlades,midCards})=>({quality,r5,triangles,nearBlades,midCards})),r4Hashes:hashes}));
});
test('R5 packing retains stable shared roots, near bytes, and the ecological near pigment',()=>{
 const raw=new Float32Array(100*15);for(let i=0;i<100;i++)raw.set([i*.19,0,i*.23,0,.3,.03,.3,.5,.2,.3,.1,0,0,1,0],i*15);
 const look=createGrassLook(environment,'standard',{value:new THREE.Vector4()},true,true,true,true);
 for(const kind of ['near','mid']){
  const packed=look.pack(raw,kind),half=look.pack(raw.subarray(50*15),kind);
  const strideOffset=(kind==='near'?100*15:50*15)*4;
  assert.equal(Buffer.compare(Buffer.from(half.buffer),Buffer.from(packed.buffer,packed.byteOffset+strideOffset,half.byteLength)),0);
  if(kind==='near'){
   const old=createGrassLook(environment,'standard',{value:new THREE.Vector4()},true,true,true).pack(raw,kind);
   assert.equal(Buffer.compare(Buffer.from(old.buffer),Buffer.from(packed.buffer)),0);
  }else{
   const nearRaw=raw.slice();for(let i=0;i<nearRaw.length;i+=15)nearRaw[i+4]=0;
   const near=look.pack(nearRaw,'near');
   for(let i=0;i<packed.length;i+=15){const ratio=(packed[i+4]-.12)/near[i*2+4];assert(ratio>=.8-1e-6&&ratio<=1.1+1e-6);}
   const pigment=packGrassR4(packGrassLook(raw,kind,environment,'standard',true),kind,environment);
   for(let i=0;i<packed.length;i+=15)for(const j of [0,2,8,9,10])assert.equal(packed[i+j],pigment[i+j]);
  }
 }
});

test('grass6=0 restores R4 URL wiring, shader hashes and coast placement; grass4=0 retains R3',()=>{
 const data=fixture();data.meta.surface={};data.surface=new Uint8Array(data.meta.grid.width*data.meta.grid.height).fill(2);
 const terrain={heightAt:()=>10,slopeAt:()=>0,waterAt:()=>0,walkable:()=>true,riverDistanceAt:()=>Infinity,seaDistanceAt:()=>50};
 for(const quality of ['standard','light'])for(const search of ['', '?grass6=0','?grass4=0']){
  const view=buildKamakuraGrass({data,terrain,quality,search,wind,sunDir:new THREE.Vector3(1,1,0)});
  try{
   view.warm({position:new THREE.Vector3(0,12,0)});
   assert.equal(view.stats().r5,search==='');
   for(const m of new Set(view.group.children[0].children.map(o=>o.material))){
    if(search==='?grass6=0')assert.equal(digest(shaderFor(m)),r4Golden[quality+(m.map?'Mid':'Near')]);
    if(search==='')assert(m.customProgramCacheKey().endsWith('-r5'));
    if(search==='?grass4=0')assert(!shaderFor(m).vertexShader.includes('grass6Distance'));
   }
  }finally{view.dispose();}
 }
});
test('GS1 parent: near ribbons under ~0.9px are discarded only by the grass6 patch (no single-pixel sparkle); R4 and mid stay untouched',()=>{
 const r5=fs.readFileSync(new URL('../dist/valley/kamakura-grass-r5-view.js',import.meta.url),'utf8'),r4=fs.readFileSync(new URL('../dist/valley/kamakura-grass-look-view.js',import.meta.url),'utf8');
 assert.match(r5,/kind==='near'\)shader\.fragmentShader=shader\.fragmentShader\s*\.replace\('float grass4Coverage=smoothstep\(1\.0,2\.0,grass4PixelWidth\);'/);
 assert.match(r5,/if\(uGrass6Strength>\.5&&grass4PixelWidth<\.9\)discard;/);
 assert.doesNotMatch(r4,/uGrass6Strength>\.5&&grass4PixelWidth/,'the R4 patch must not know the grass6 uniform (grass6=0 would not compile)');
 assert(r4.indexOf('float grass4PixelWidth')>0,'the width estimate exists before the replaced line (uniform control flow)');
});
