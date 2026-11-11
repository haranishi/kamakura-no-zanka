// Synthetic regression coverage for W2c-19 edges. No Git history or private fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as B from '../dist/valley/kamakura-backdrop.js';
import * as S from '../dist/valley/kamakura-shore.js';
import * as M from '../dist/valley/kamakura-mist.js';
import * as F from '../dist/valley/kamakura-sea-far.js';
import * as P from '../tools/preview-sea.mjs';
import * as H from './helpers/tree-modules.mjs';
import {fixture} from './helpers/kamakura-fixture.mjs';
import {loadKamakura} from '../dist/valley/kamakura-data.js';
import {createKamakuraTerrain} from '../dist/valley/kamakura-terrain.js';
import {createKamakuraBackdrop} from '../dist/valley/kamakura-backdrop-view.js';
import {KAMAKURA_TIMES} from '../dist/valley/kamakura-atmosphere.js';
const {createKamakuraPost}=await H.load('kamakura-post-view.js');
const {buildKamakuraSea}=await H.load('kamakura-sea-view.js');
const finish=j=>{let steps=0;while(!j.step(257)){steps++;assert(steps<100000);}return j.field;};
const hash=s=>createHash('sha256').update(s).digest('hex');
const bytes=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
const base={cell:2,bounds:{minX:-300,maxX:300,minZ:-180,maxZ:220}};
const uniform=h=>({...base,heightAt:()=>h});
test('E1 sea-edge mountain smoothly descends, exact legacy above 30m; no sea extensions',()=>{
  let last=0;for(let h=.5;h<=30;h+=.25){const p=B.backdropPoint(uniform(h),1100,0);assert(p.height>=last);last=p.height;}
  for(const d of [1,100,800,9000])assert.equal(B.backdropPoint(uniform(.5),300+d,0).height,B.BACKDROP.minHeightM);
  for(const h of [30,60,120])for(const d of [0,2,800,5000])assert.equal(B.backdropPoint(uniform(h),300+d,0).height,B.backdropPoint(uniform(h),300+d,0,{},false).height);
  assert.equal(B.buildBackdrop(uniform(-5)).triangles,0);
});
test('E1 backdrop2=0 ignores map gain; high edges retain identical geometry and colours; same budget',t=>{
  const terrain={...base,heightAt:(_x,z)=>30-z/4};const a=B.buildBackdrop(terrain,{enhanced:false}),b=B.buildBackdrop(terrain,{enhanced:false,gain:4}),c=B.buildBackdrop(terrain);
  for(let i=0;i<a.segments.length;i++)for(const key of ['positions','colors','indices'])assert.deepEqual(a.segments[i][key],b.segments[i][key]);
  assert.equal(c.triangles,a.triangles);assert.equal(c.draws,a.draws);assert(c.triangles<=60000&&c.draws<=2);assert(c.coastLengthM>0);
  // Noise uses trigonometry: compare the two paths directly, never hash its floating point table.
  const high=B.buildBackdrop(uniform(80)),off=B.buildBackdrop(uniform(80),{enhanced:false});
  for(let i=0;i<high.segments.length;i++)for(const key of ['positions','colors','indices'])assert.deepEqual(high.segments[i][key],off.segments[i][key]);
  const e=B.BACKDROP;
  for(const segment of a.segments)for(let i=0;i<segment.positions.length;i+=3){
    const x=segment.positions[i],z=segment.positions[i+2];
    for(let k=0;k<3;k++)assert(Math.abs(segment.colors[i+k]-e.canopy[k]*(1+e.shadeContrast*(2*S.shoreNoise(x/e.shadeScaleM,z/e.shadeScaleM)-1)))<1e-6);
  }
  const light=B.buildBackdrop(terrain,{quality:'light'});assert(light.triangles<c.triangles&&light.draws<c.draws);
  t.diagnostic(JSON.stringify({standard:{triangles:c.triangles,draws:c.draws,work:c.work},light:{triangles:light.triangles,draws:light.draws,work:light.work}}));
});
test('E1 canopy noise is bounded, stationary, returns exactly to its mean when unresolved; GLSL scalar mirror',()=>{
  const g=B.BACKDROP_GLSL.match(/float backdropCrown\(vec2 p,float pixel\)\{([\s\S]*?)\n\}/)[1].replace(/float /g,'let ').replace(/backdropNoise\(p\/([\d.]+)\)/g,'shoreNoise(x/$1,z/$1)');
  const smoothstep=(a,b,x)=>{let t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
  const mirror=Function('shoreNoise','smoothstep','mix',`return (x,z,pixel)=>{${g}}`)(S.shoreNoise,smoothstep,(a,b,t)=>a+(b-a)*t);
  for(let x=-500;x<500;x+=7.1)for(const pixel of [0,5,20,40,100]){const a=B.backdropCrown(x,13,pixel);assert(a>=.75&&a<=1.25);assert(Math.abs(a-mirror(x,13,pixel))<1e-12);if(pixel>=40)assert.equal(a,1);}
});
test('E1 haze matches existing ground airlight, constant literals, shader anchors and float syntax',async()=>{
  const {slopeHaze}=await import('../dist/valley/kamakura-ground-slope.js');
  for(const d of [0,250,800,1600,2200,6000])assert.deepEqual(B.backdropHaze([.06,.15,.03],[.4,.5,.6],d),slopeHaze([.06,.15,.03],[.4,.5,.6],d));
  const shader={vertexShader:H.THREE.ShaderLib.lambert.vertexShader,fragmentShader:H.THREE.ShaderLib.lambert.fragmentShader};B.backdropShader(shader);assert(shader.fragmentShader.includes('outgoingLight=backdropHaze'));assert(shader.vertexShader.includes('vBackdropWorld=(modelMatrix'));
  let src=B.BACKDROP_GLSL.replace(/\/\/[^\n]*/g,''),stack=[];for(const c of src){if('([{'.includes(c))stack.push(c);if(')]}'.includes(c))assert.equal(stack.pop(),'([{'[')]}'.indexOf(c)]);}assert.equal(stack.length,0);
  assert(!/--\s*\d|\b(?:float|vec[234])\s+(?:sample|input|output|filter|patch)\b/.test(src));assert(!/(?<![\w.])\d+(?![\w.])/.test(src.replace(/vec[234]/g,'')));
  for(const [key,value] of Object.entries(B.BACKDROP))if(key.startsWith('haze'))assert(src.includes(Number(value).toFixed(8)));
  const known=new Set(['varying','float','vec2','vec3','return','if','fract','sin','dot','floor','mix','smoothstep','length','max','min','clamp']);
  for(const match of src.matchAll(/\b(?:float|vec[23])\s+(\w+)/g))known.add(match[1]);
  for(const match of src.matchAll(/,\s*(\w+)\s*=/g))known.add(match[1]);
  for(const match of src.matchAll(/(?<![\w.])([A-Za-z_]\w*)/g))assert(known.has(match[1]),match[1]+' undeclared');
});
test('E2 narrow harbor and river are sheltered, wide mouth stays open; 4m grid and bounded deterministic values',()=>{
  const narrow=finish(S.createSignedShoreJob(P.previewEdgesTerrain())),again=finish(S.createSignedShoreJob(P.previewEdgesTerrain())),wide=finish(S.createSignedShoreJob(P.previewEdgesTerrain(60)));
  assert.equal(narrow.cell,4);assert.equal(narrow.opennessAt(120,70),0);assert.equal(narrow.opennessAt(-140,-90),0);assert.equal(wide.opennessAt(120,70),1);assert.equal(narrow.opennessAt(-260,80),1);
  assert.deepEqual(narrow.data,again.data);assert.deepEqual(narrow.openness,again.openness);assert(narrow.openness.every(v=>v>=0&&v<=1));
  for(let z=100,old=0;z<150;z+=.5){let a=narrow.opennessAt(120,z);assert(Math.abs(a-old)<.15);old=a;}
});
test('E2 shelter=0 retains frozen straight-beach distance bytes without topology work',()=>{
  const terrain={...base,heightAt:(_x,z)=>-z*.2,isSea:(_x,z)=>z>=0};
  const a=S.createSignedShoreJob(terrain,{shelter:false});finish(a);
  assert.equal(hash(bytes(a.field.data)),'080fffa94cba713bdbc1b0676038579fe7a819576dda55b5afada79b872a8f10');
  assert(!a.field.openness);assert.equal(a.work,a.field.data.length*5);
});
const d=()=>({rivers:[],meta:{grid:{width:301,height:201,cell_m:2},surface:{}},surface:new Uint8Array(60501)});
const t=()=>({...P.previewEdgesTerrain(),riverDistanceAt:()=>Infinity,seaDistanceAt:()=>0});
const compile=v=>{const s={uniforms:{},vertexShader:H.THREE.ShaderLib.standard.vertexShader,fragmentShader:H.THREE.ShaderLib.standard.fragmentShader};v.mesh.material.onBeforeCompile(s);return s;};
test('E2 shelter=0 retains original sea source hashes, key and texture components for sea2/sea3 disable flags',()=>{
  for(const [flags,expected,format] of [['sea2=0','281fcef06279bb44f9ce15ef8d9759b194c532572b9bc85cc5e5005c669c27b3',H.THREE.RedFormat],['sea3=0','c892de2aebb1e4200c251020ecb72926a24cedb40f5e200a27393cda2985593e',H.THREE.RGFormat]]){
    const v=buildKamakuraSea(t(),d(),{search:'?shelter=0&bankwet=0&'+flags}),s=compile(v);assert.equal(hash(s.vertexShader+'\n'+s.fragmentShader),expected);assert.equal(v.textures[0].format,format);assert.equal(v.mesh.material.customProgramCacheKey(),flags==='sea2=0'?'kamakura-sea-11-shore6':'kamakura-sea-18-far');v.dispose();
  }
});
test('E2 packed topology uses one existing shore sample for all surf, preserves colour source, adapts and disposes',()=>{
  for(const flags of ['', '&sea3=0','&sea2=0']){
    const terrain=t(),v=buildKamakuraSea(terrain,d(),{search:'?bankwet=0&debug=1'+flags}),s=compile(v);assert.equal((s.fragmentShader.match(/texture2D\(uShoreLand,seaUV\)/g)||[]).length,1);assert(s.fragmentShader.includes('seaFoam=seaFoam*seaOpen'));
    for(let i=0;!v.preparedShore&&i<100;i++)v.update(.016,{x:0,y:0,z:0},1);assert(v.preparedShore);const tex=v.textures.at(-1);assert.equal(tex.image.data.length/terrain.shoreSigned.data.length,flags.includes('sea2=0')?2:4);
    for(const step of [0,1,2,3])v.setAdapt(step);v.dispose();assert(!terrain.shoreSigned);assert.equal(globalThis.__kzSea3,undefined);
  }
});
test('E2 front strengths are proportional to openness; only a thin stationary .25 edge survives',()=>{
  for(const openness of [0,.25,.5,.75,1])for(const distance of [0,4,12,30,50]){
    const a=F.sea3Sample(distance,15,7,2,0,300,'standard',0,{},1),b=F.sea3Sample(distance,15,7,2,0,300,'standard',0,{},openness);
    for(const key of ['crest','tail','wash'])assert.equal(b[key],a[key]*openness);
    if(distance>1&&openness===0)assert.equal(b.foam,0);
  }
  assert.equal(S.shelteredEdgeFoam(0),.25);assert.equal(S.shelteredEdgeFoam(1),0);
});
test('E3/E4 settings white lists reject nonnumbers, ranges and unknown keys',()=>{
  for(const value of [{},{gain:0},{gain:2,floor_m:500},{floor_m:-50}])assert.equal(M.validateMist(value),value);
  for(const value of [null,[],2,{oops:1},{gain:-.01},{gain:2.01},{gain:'1'},{gain:NaN},{floor_m:-51},{floor_m:501}])assert.throws(()=>M.validateMist(value));
  for(const value of [{},{gain:.5},{gain:4}])assert.equal(B.validateBackdrop(value),value);
  for(const value of [null,[],4,{oops:1},{gain:.49},{gain:4.01},{gain:Infinity},{gain:'1'}])assert.throws(()=>B.validateBackdrop(value));
});
test('E3 absent settings retain exact field bytes and original shader hash; gain changes both caps',()=>{
  const terrain={bounds:{minX:-512,maxX:512,minZ:-512,maxZ:512},heightAt:x=>100+Math.min(80,Math.abs(x)*.4)},a=M.createMistField(terrain),b=M.createMistField({...terrain,meta:{mist:{}}});while(!a.step(257));while(!b.step(257));assert.deepEqual(a.data,b.data);
  assert.equal(hash(bytes(a.data)),'3563b7c67d4383e0a143db7f143dc2bd5a336b7dcc3b3789dc87103b8833beae');
  assert.equal(hash(M.mistShader()),'77da81d524de57849b9a10f6dc8acdc4f8b4e27aec4374e762955e6554ab3a00');assert.equal(M.mistShader({}),M.MIST_GLSL);
  for(const gain of [0,.25,.5,1,2]){assert.equal(M.mistAmount(1,100,100,500,1,10,gain),M.MIST.cap*gain);const s=M.mistShader({gain});assert(s.includes('min('+(M.MIST.cap*gain).toFixed(6)+',amount'));assert(s.includes('min('+(M.MIST.totalCap*gain).toFixed(6)+',amount'));}
});
test('E3 low valleys mask to zero, above floor+10m preserve full field; E4 gain multiplies vertex colour only',()=>{
  for(const floor_m of [90,100,105]){
    const f=M.createMistField({meta:{mist:{floor_m}},bounds:{minX:-512,maxX:512,minZ:-512,maxZ:512},heightAt:x=>100+Math.min(80,Math.abs(x)*.4)});while(!f.step(257));const out=[];M.sampleMistField(f,0,0,out);assert.equal(out[0],floor_m===90?1:0);
  }
  const a=B.buildBackdrop(uniform(80)),b=B.buildBackdrop(uniform(80),{gain:2});for(let k=0;k<a.segments.length;k++){assert.deepEqual(a.segments[k].positions,b.segments[k].positions);assert.deepEqual(b.segments[k].colors,Float32Array.from(a.segments[k].colors,v=>v*2));}
});

// Exercise the real loader, terrain adapter and view factories, rather than only their pure helpers.
function mapFixture(settings={}){
  const f=fixture({width:33,height:33,cell:32});Object.assign(f.meta,settings);
  for(let row=0;row<33;row++)for(let col=0;col<33;col++)f.heights[row*33+col]=100+Math.min(80,Math.abs(col-16)*16);
  return f;
}
async function loadMap(settings={},requests=[]){
  const f=mapFixture(settings);
  return loadKamakura(async url=>{
    const name=url.slice('/world-private/'.length);requests.push(name);
    assert(['meta.json','height_u16.bin','walk_u8.bin'].includes(name));
    return {ok:true,json:async()=>structuredClone(f.meta),arrayBuffer:async()=>name==='height_u16.bin'?f.heights.buffer:f.walk.buffer};
  },'?townfill=0');
}
function postRenderer(){
  let target=null,final=null,draws=0;
  return {toneMapping:H.THREE.NoToneMapping,toneMappingExposure:1,autoClear:false,
    getDrawingBufferSize:v=>v.set(640,360),getRenderTarget:()=>target,setRenderTarget:t=>{target=t;},
    render(scene){draws++;const material=scene.children[0]?.material;if(material?.uniforms?.mistField)final=material;},
    get final(){return final;},get draws(){return draws;}};
}
function renderMist(data){
  const terrain=createKamakuraTerrain(data),renderer=postRenderer();
  const post=createKamakuraPost({renderer,terrain,search:'?shafts=0&cloud=0',params:KAMAKURA_TIMES.golden,now:()=>0});
  try{
    const scene=new H.THREE.Scene(),camera=new H.THREE.PerspectiveCamera();
    post.render(scene,camera);assert.equal(renderer.final.uniforms.mistReady.value,0);
    for(let i=0;renderer.final.uniforms.mistReady.value===0;i++){assert(i<20);post.render(scene,camera);}
    const material=renderer.final,u=material.uniforms,field=M.createMistField(terrain);while(!field.step(257));
    assert.deepEqual(u.mistField.value.image.data,field.data);
    assert.equal(u.mistField.value.format,H.THREE.RGFormat);
    assert.equal(u.mistStrength.value,M.mistStrength('golden'));
    const texture=u.mistField.value;let disposals=0;texture.addEventListener('dispose',()=>disposals++);
    const result={shader:material.fragmentShader,data:field.data,field,textureBytes:field.data.byteLength,draws:renderer.draws};
    post.setAdapt(2);assert.equal(disposals,1);assert.equal(u.mistField.value,null);assert.equal(post.targets,null);
    return result;
  }finally{post.dispose();}
}
test('T2 loader rejects malformed mist/backdrop metadata before reading terrain bytes',async()=>{
  const invalidMist=[null,[],2,{unknown:1},{gain:-.01},{gain:2.01},{gain:'1'},{gain:NaN},{gain:Infinity},{floor_m:-51},{floor_m:501},{floor_m:'0'}];
  const invalidBackdrop=[null,[],4,{unknown:1},{gain:.49},{gain:4.01},{gain:'1'},{gain:NaN},{gain:Infinity}];
  for(const [key,values] of [['mist',invalidMist],['backdrop',invalidBackdrop]])for(const value of values){
    const requests=[];await assert.rejects(loadMap({[key]:value},requests),new RegExp('meta\\.'+key));assert.deepEqual(requests,['meta.json']);
  }
  for(const mist of [{},{gain:0},{gain:2,floor_m:500},{floor_m:-50}])assert.deepEqual((await loadMap({mist})).meta.mist,mist);
  for(const backdrop of [{},{gain:.5},{gain:4}])assert.deepEqual((await loadMap({backdrop})).meta.backdrop,backdrop);
});
test('T2 loaded mist settings reach the field texture and both final GPU caps; absent settings retain frozen program',async t=>{
  const absent=renderMist(await loadMap()),empty=renderMist(await loadMap({mist:{}}));
  assert.equal(hash(bytes(absent.data)),'8d94b0d2e8ad4d4572dc3d205848a93678b184a5600f58e6c3586633cfed62c5');
  assert.equal(hash(absent.shader),'1ef431de45e6681b0ede5f37bd9d284e6130b584e816fa912b4465dcd95ee22b');assert.equal(empty.shader,absent.shader);assert.deepEqual(empty.data,absent.data);
  for(const gain of [0,.25,1,2]){
    const result=renderMist(await loadMap({mist:{gain}}));assert.deepEqual(result.data,absent.data);assert.equal(result.field.gain,gain);
    assert(result.shader.includes(`min(${(M.MIST.cap*gain).toFixed(6)},amount`));
    assert(result.shader.includes(`min(${(M.MIST.totalCap*gain).toFixed(6)},amount`));
    // Apart from the two cap literals, the complete final shader remains identical.
    assert.equal(result.shader.replace(M.mistShader({gain}),M.MIST_GLSL),absent.shader);
    const field=result.field,scratch=[],eye={x:0,y:100,z:-400},point={x:0,y:100,z:400};
    assert.equal(M.mistAlongRay(field,eye,point,0,1,0,1e6,scratch),M.MIST.totalCap*gain);
  }
  const masked=renderMist(await loadMap({mist:{gain:.25,floor_m:110}}));
  const sample=[];M.sampleMistField(absent.field,0,0,sample);assert.equal(sample[0],1);
  M.sampleMistField(masked.field,0,0,sample);assert.equal(sample[0],0);
  const restored=renderMist(await loadMap({mist:{floor_m:90}}));assert.deepEqual(restored.data,absent.data);
  const half=renderMist(await loadMap({mist:{floor_m:95}}));M.sampleMistField(half.field,0,0,sample);assert.equal(sample[0],.5);
  t.diagnostic(JSON.stringify({mistCells:absent.field.cells,mistWork:absent.field.work,textureBytes:absent.textureBytes,addedDraws:0,addedTriangles:0}));
});
async function renderBackdrop(data,search='?debug=1'){
  const scene=new H.THREE.Scene(),camera=new H.THREE.PerspectiveCamera(),terrain=createKamakuraTerrain(data);
  const layer=createKamakuraBackdrop({scene,camera,terrain,data,search});
  try{
    layer.update();layer.update();await new Promise(resolve=>setTimeout(resolve,0));
    const info=globalThis.__kzBackdrop();assert.equal(info.error,null);assert.equal(info.ready,true);
    const segments=layer.meshes.map(mesh=>{
      const shader={vertexShader:H.THREE.ShaderLib.lambert.vertexShader,fragmentShader:H.THREE.ShaderLib.lambert.fragmentShader};
      mesh.material.onBeforeCompile(shader);
      return {positions:mesh.geometry.attributes.position.array,colors:mesh.geometry.attributes.color.array,indices:mesh.geometry.index.array,shader:shader.vertexShader+'\n'+shader.fragmentShader};
    });
    return {segments,info};
  }finally{layer.dispose();assert.equal(scene.children.length,0);assert.equal(globalThis.__kzBackdrop,undefined);}
}
test('T2 loaded backdrop gain reaches rendered colours and debug; absent/empty and backdrop2=0 retain original programs',async()=>{
  const absent=await renderBackdrop(await loadMap()),empty=await renderBackdrop(await loadMap({backdrop:{}}));
  assert.deepEqual(empty,absent);assert.equal(absent.info.gain,1);
  for(const segment of absent.segments)assert.equal(hash(segment.shader),'8a77d2291d7a9325635773c06aa55efe9a93947448e670ce28dd8f47d68b0f6e');
  for(const gain of [.5,2,4]){
    const gained=await renderBackdrop(await loadMap({backdrop:{gain}}));assert.equal(gained.info.gain,gain);
    for(let i=0;i<absent.segments.length;i++){
      const a=absent.segments[i],b=gained.segments[i];assert.deepEqual(a.positions,b.positions);assert.deepEqual(a.indices,b.indices);assert.equal(a.shader,b.shader);
      for(let k=0;k<a.colors.length;k++)assert(Math.abs(b.colors[k]-a.colors[k]*gain)<1e-6);
    }
  }
  const off=await renderBackdrop(await loadMap(),'?debug=1&backdrop2=0'),offGain=await renderBackdrop(await loadMap({backdrop:{gain:4}}),'?debug=1&backdrop2=0');
  assert.deepEqual(offGain,off);
  for(const segment of off.segments)assert.equal(hash(segment.shader),'a4b8074c5d0987f12f6cef9e12d23a3580490d479a9231b5fecb2ae009a063d8');
  // All edges in this fixture are high: enabling the feature preserves all position/colour bytes.
  for(let i=0;i<absent.segments.length;i++)for(const key of ['positions','colors','indices'])assert.deepEqual(absent.segments[i][key],off.segments[i][key]);
});
