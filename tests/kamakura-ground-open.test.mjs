import test from 'node:test';
import assert from 'node:assert/strict';
import { THREE } from './helpers/tree-modules.mjs';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { createPathField,segmentWeight,groundPathFor } from '../dist/valley/kamakura-ground-path.js';
import { groundContactFor } from '../dist/valley/kamakura-ground-contact.js';
import { openBrightness,openSignal,terrainDry,GROUND7_GLSL } from '../dist/valley/kamakura-ground-open.js';
import { installGroundDetail } from '../dist/valley/kamakura-ground-detail.js';
const pos={x:0,z:0},road={xyz_m:[[-10,-.25,0],[10,-.25,0],[10,-20,0]],width_m:5};
test('GD4 capsule centre, irregular edge, endpoints, degenerate segments and max union',()=>{
  const f=createPathField();f.update(pos,{road});
  assert.equal(f.bytes.length,65536);assert.equal(f.at(.25,.25),1);assert.equal(f.at(.25,3.25),0);
  assert.equal(f.at(-10,.25),1);assert.equal(f.at(10,20),1);assert.equal(f.at(1000,0),0);
  const a=createPathField(),b=createPathField(),union=createPathField();
  const other={xyz_m:[[.25,10,0],[.25,-10,0]],width_m:3};
  a.update(pos,{road});b.update(pos,{other});union.update(pos,{road,other});
  for(let i=0;i<65536;i++)assert.equal(union.bytes[i],Math.max(a.bytes[i],b.bytes[i]));
  assert.equal(segmentWeight({x:0,z:0,dx:0,dz:0,r:2.5},0,0),1);
  // Independent distance projection verifies the row-clipped raster, including long diagonals.
  for(const [dx,dz] of [[1000,1000],[-1000,1000],[1000,0],[0,1000]]){
    const s={x:-dx/2,z:-dz/2,dx,dz,r:2.5},g=createPathField();g.update(pos,{a:{xyz_m:[[s.x,-s.z],[s.x+dx,-s.z-dz]]}});
    for(let j=0;j<256;j+=3)for(let i=0;i<256;i+=3)assert.equal(g.bytes[j*256+i],Math.round(255*segmentWeight(s,-64+(i+.5)*.5,-64+(j+.5)*.5)));
  }
});
test('GD4 exact regeneration conditions, in-place edits, north/south conversion and empty windows',()=>{
  const f=createPathField(),p={road:structuredClone(road)};
  assert(f.update(pos,p));assert(!f.update({x:11.9,z:0},p));assert(f.update({x:12,z:0},p));
  p.road.xyz_m[1][0]++;assert(f.update({x:12,z:0},p));assert(!f.update({x:12,z:0},p));
  p.road.width_m=3;assert(f.update({x:12,z:0},p));
  delete p.road;assert(f.update({x:12,z:0},p));assert(f.bytes.every(v=>v===0));
  assert(f.update({x:12,z:0},{}));
  const river=createPathField(true);river.update(pos,{a:{xyz_m:[[-10,0],[10,0]],width_m:10}});
  assert.equal(river.at(0,2),1);assert.equal(river.at(0,6),0);
});
function setup(search='',quality='standard',paths=true){
  const d=fixture({width:13,height:9,cell:2});d.meta.ground={};d.meta.surface={};d.ground=new Uint8Array(13*9*3).fill(140);d.surface=new Uint8Array(13*9).fill(2);
  if(paths)d.patches={paths:{road}};
  const m=new THREE.MeshLambertMaterial({vertexColors:true}),owner=installGroundDetail(THREE,m,d,{search,quality});
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};m.onBeforeCompile(shader);
  return {d,m,owner,shader,dispose(){owner.dispose();m.dispose();}};
}
function balanced(s){
  const stack=[],pairs={')':'(',']':'[','}':'{'};
  for(const c of s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'')){if('([{'.includes(c))stack.push(c);else if(')]}'.includes(c))assert.equal(stack.pop(),pairs[c]);}
  assert.equal(stack.length,0);
  let depth=0;for(const l of s.split('\n')){if(/^\s*#\s*(if|ifdef|ifndef)\b/.test(l))depth++;if(/^\s*#\s*endif\b/.test(l))assert(--depth>=0);}assert.equal(depth,0);
}
test('GD4/5 real Three resource lifetime, atlas bounds, adaptations and exact ground7=0 baseline',()=>{
  const off=setup('?ground7=0'),legacy=setup('', 'standard',false);
  try{assert.equal(off.shader.fragmentShader,legacy.shader.fragmentShader);assert.equal(off.m.customProgramCacheKey(),legacy.m.customProgramCacheKey());assert.equal(groundPathFor(off.d),undefined);}finally{off.dispose();legacy.dispose();}
  for(const search of ['', '?photo=0','?ground6=0'])for(const quality of ['standard','light']){
    const h=setup(search,quality);try{
      const path=groundPathFor(h.d),contact=groundContactFor(h.d),u=h.owner.uniforms,t=contact.texture;
      assert.equal(t.internalFormat,'R8');assert.equal(t.image.width,256);assert.equal(t.image.height,768);assert.equal(t.generateMipmaps,false);
      assert(t.image.data.subarray(0,65536).every(v=>v===255));assert(t.image.data.subarray(65536).every(v=>v===0));
      contact.update(pos,[],[]);assert(path.update(pos,h.d.patches.paths));assert(!path.update(pos,h.d.patches.paths));
      assert(t.image.data.subarray(65536,131072).some(v=>v===255));
      h.owner.setAdapt(2);assert.equal(u.uGround7.value,.5);assert.equal(u.uGround7Fine.value,0);
      h.owner.setAdapt(3);assert(!path.update({x:50,z:0},h.d.patches.paths));h.owner.setAdapt(0);
      assert.equal(u.uGround7.value,1);assert.equal(u.uGround7Fine.value,quality==='light'?0:1);
      if(search==='?ground6=0')assert.equal(u.uGround6.value,0);
      const s=h.shader.fragmentShader;balanced(s);balanced(h.shader.vertexShader);
      assert(!/--\s*\d|\b0mix\(/.test(s));
      assert(!/\b(?:float|vec[234]|int)\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(s));
      assert.equal(new Set([...s.matchAll(/uniform sampler2D\s+([^;]+);/g)].flatMap(m=>m[1].split(','))).size,14);
      assert(s.indexOf('ground7PathWeight=ground7Path(p,dist)')<s.indexOf('if(groundPhotoAmount<=0.0)return'));
      assert(s.includes('w[5]+=pathSoil;'));assert(!/dFdx|dFdy|fwidth/.test(GROUND7_GLSL));
      let releases=0;t.addEventListener('dispose',()=>releases++);h.owner.dispose();h.owner.dispose();assert.equal(releases,1);assert.equal(groundPathFor(h.d),undefined);assert(!path.update(pos,{}));
    }finally{h.dispose();}
  }
});
test('GD5 zero-mean broad noise, variance, independent spatial lags, dryness monotonicity and far convergence',t=>{
  let seed=773;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const points=Array.from({length:20000},()=>[rand()*12000-6000,rand()*12000-6000]);
  for(const fine of [true,false]){
    const values=points.map(([x,z])=>openBrightness(x,z,{fine})),mean=values.reduce((s,v)=>s+v,0)/values.length;
    const variance=values.reduce((s,v)=>s+(v-mean)**2,0)/values.length,sd=Math.sqrt(variance);
    assert(Math.abs(mean-1)<.01);assert(sd>.015&&sd<.08);
    let maxCorrelation=-Infinity;
    // A continuous field necessarily correlates near the origin; test independent lags >= broadest 55m cell.
    for(const lag of [55,110,220,440])for(let a=0;a<8;a++){
      let cov=0;for(let i=0;i<points.length;i++){const [x,z]=points[i];cov+=(values[i]-mean)*(openBrightness(x+Math.cos(a*Math.PI/4)*lag,z+Math.sin(a*Math.PI/4)*lag,{fine})-mean);}
      maxCorrelation=Math.max(maxCorrelation,cov/values.length/variance);
    }
    assert(maxCorrelation<.5);t.diagnostic(JSON.stringify({fine,mean,sd,maxCorrelation}));
    for(const [x,z] of points.slice(0,100)){
      assert.equal(openBrightness(x,z,{fine,dist:600,dry:1}),1);assert.equal(openSignal(x,z,{fine,pixel:55}),0);
      assert(openBrightness(x,z,{dry:1})>=openBrightness(x,z,{dry:-1}));
      assert(openBrightness(x,z,{dry:1})<=1.14);assert(openBrightness(x,z,{dry:-1})>=.86);
    }
  }
  for(const axis of [0,1,2]){const a=[0,0,0,0],b=[0,0,0,0];a[axis]=-1;b[axis]=1;assert(terrainDry(...b)>terrainDry(...a));}
});

test('GD4 packed earth retains luminance; GD5 dry/moss chroma is bounded and separates from brightness',async()=>{
  const {packedEarthColor,openColor}=await import('../dist/valley/kamakura-ground-open.js');
  const luma=c=>c[0]*.2126+c[1]*.7152+c[2]*.0722;
  for(const color of [[.2,.3,.07],[.3,.18,.08],[.1,.1,.1],[0,0,0]]){
    const earth=packedEarthColor(color);assert(Math.abs(luma(earth)-luma(color))<1e-12);assert.deepEqual(packedEarthColor(color,0),color);
    for(let i=0;i<200;i++){
      const x=i*.37,z=i*1.31,dry=openColor(color,x,z,{dry:1}),moss=openColor(color,x,z,{dry:-1});
      assert(luma(dry)>=luma(moss)-1e-12);
      assert(Math.abs(luma(dry)-luma(color)*openBrightness(x,z,{dry:1}))<1e-10);
      assert(dry[0]>=moss[0]);
      for(const bias of [-1,1]){
        const out=openColor(color,x,z,{dry:bias}),brightness=openBrightness(x,z,{dry:bias});
        for(let c=0;c<3;c++)assert(Math.abs(out[c]-color[c]*brightness)<=luma(color)*.04+1e-12);
      }
      assert.deepEqual(openColor(color,x,z,{dist:600,dry:1}),color);
    }
  }
});

test('GD4 report synthetic raster CPU timings without a wall-clock pass threshold',t=>{
  const f=createPathField(),paths={};
  for(let i=0;i<16;i++)paths[i]={xyz_m:[[-200,i*8-64],[200,64-i*8]]};
  const samples=[];
  for(let i=0;i<80;i++){const start=performance.now();f.update({x:(i%8)*12-42,z:0},paths);samples.push(performance.now()-start);}
  samples.sort((a,b)=>a-b);
  t.diagnostic(JSON.stringify({syntheticRoads:16,updates:80,p50Ms:samples[40],p95Ms:samples[76],maxMs:samples[79]}));
});

test('GD4 private route raster reports CPU timings without exporting coordinates',async t=>{
  if(!process.env.KZ_WORLD_DIR){t.skip('KZ_WORLD_DIR未設定：私有の道データが必要');return;}
  const {readFile}=await import('node:fs/promises'),{join}=await import('node:path');
  const paths=JSON.parse(await readFile(join(process.env.KZ_WORLD_DIR,'patch_paths.json'),'utf8'));
  const first=Object.values(paths)[0]?.xyz_m?.[0];assert(first);
  const f=createPathField(),samples=[];
  for(let i=0;i<80;i++){const start=performance.now();f.update({x:first[0]+(i%8)*12,z:-first[1]},paths);samples.push(performance.now()-start);}
  assert(f.bytes.some(v=>v>0));samples.sort((a,b)=>a-b);
  t.diagnostic(JSON.stringify({privateRouteRaster:{updates:80,p50Ms:samples[40],p95Ms:samples[76],maxMs:samples[79]}}));
});
