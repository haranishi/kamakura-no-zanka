import test from 'node:test';
import assert from 'node:assert/strict';
import { THREE } from './helpers/tree-modules.mjs';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { installGroundDetail } from '../dist/valley/kamakura-ground-detail.js';
import { MOSAIC_PAIRS, mosaicMask, mosaicWeights, mosaicFade, exposureIsland, exposedSoil, sandTrace, GROUND8_GLSL } from '../dist/valley/kamakura-ground-mosaic.js';
import { grassColony } from '../dist/valley/kamakura-grass-look.js';
import { photoBlendUniform } from '../dist/valley/kamakura-photo-tex.js';
import { registerShoreView, unregisterShoreView } from '../dist/valley/kamakura-shore.js';
const views=[[0,0],[41,17],[-70,29],[103,-67],[-150,-83],[211,173]]; // synthetic, not geographic data
function compile(search='',quality='standard',routes=true){
  const d=fixture({width:200,height:200,cell:2});d.meta.ground={};d.meta.surface={};
  d.ground=new Uint8Array(200*200*3).fill(140);d.surface=new Uint8Array(200*200).fill(2);
  if(routes)d.patches={paths:{}};
  registerShoreView(d,{uShoreSea:{value:null},uShoreReady:{value:1},uSeaSky:{value:new THREE.Color(.2,.3,.4)}});
  const m=new THREE.MeshLambertMaterial({vertexColors:true}),owner=installGroundDetail(THREE,m,d,{search,quality});
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};
  m.onBeforeCompile(shader);
  return {owner,m,shader,dispose(){owner.dispose();m.dispose();unregisterShoreView(d);}};
}
function checkGLSL(source){
  const clean=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,''),stack=[],pairs={')':'(',']':'[','}':'{'};
  for(const c of clean){if('([{'.includes(c))stack.push(c);else if(')]}'.includes(c))assert.equal(stack.pop(),pairs[c]);}assert.equal(stack.length,0);
  let depth=0;for(const line of clean.split('\n')){if(/^\s*#\s*(if|ifdef|ifndef)\b/.test(line))depth++;if(/^\s*#\s*endif\b/.test(line))assert(--depth>=0);}assert.equal(depth,0);
  assert(!/--\s*\d|\b\d+(?:\.\d*)?(?:mix|vec\d|clamp)\s*\(/.test(clean));
  assert(!/\b(?:float|vec[234]|int|uint)\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(clean));
}
function componentAreas(labels,w,h){
  const seen=new Set(),areas=[];
  for(let k=0;k<w*h;k++)if(labels[k]&&!seen.has(k)){
    const queue=[k];seen.add(k);
    for(let n=0;n<queue.length;n++){
      const id=queue[n];
      for(const q of [id%w?id-1:-1,id%w<w-1?id+1:-1,id>=w?id-w:-1,id<w*(h-1)?id+w:-1])
        if(q>=0&&!seen.has(q)&&labels[q]===labels[k]){seen.add(q);queue.push(q);}
    }
    areas.push(queue.length);
  }
  return areas;
}
test('GD6 conservative simultaneous transfers: unit mass, bounds, original-donor cap, no wet-sand/forest debit',()=>{
  for(let i=0;i<1000;i++){
    const raw=Array.from({length:7},(_,k)=>1+((i*19+k*31)%103)),sum=raw.reduce((a,b)=>a+b),w=raw.map(v=>v/sum);
    for(const light of [false,true]){
      const out=mosaicWeights(w,i*.173,-i*.391,{light,exposure:.3});
      assert(Math.abs(out.reduce((a,b)=>a+b)-1)<1e-6);
      out.forEach((v,k)=>{assert(v>=0&&v<=1);assert(w[k]-v<=.6*w[k]+1e-12);});
      assert.equal(out[1],w[1]);assert(out[3]>=w[3]);assert.equal(out[4],w[4]);
      assert.deepEqual(w,raw.map(v=>v/sum));
    }
  }
  for(const [from,a,b] of MOSAIC_PAIRS){
    const w=Array(7).fill(0);w[from]=1;let aSeen=false,bSeen=false;
    for(let k=0;k<1000;k++){const out=mosaicWeights(w,k*.31,-k*.071);aSeen ||=out[a]>.5;bSeen ||=out[b]>.5;}
    assert(aSeen&&bSeen,`class ${from} has two genuinely dominant partners`);
  }
});
test('GD6 world-coordinate determinism, exact fade/disable/exclusion, and light only soil/gravel pair',()=>{
  const w=[.1,.05,.3,.1,.05,.3,.1],points=views.flatMap(([x,z])=>Array.from({length:40},(_,i)=>[x+i*.7,z-i*.2]));
  const forward=points.map(([x,z])=>mosaicWeights(w,x,z));
  [...points].reverse().forEach(([x,z],i)=>assert.deepEqual(mosaicWeights(w,x,z),forward[points.length-1-i]));
  for(const [x,z] of points){
    for(const options of [{dist:200},{dist:1000},{strength:0},{avoid:1}])assert.deepEqual(mosaicWeights(w,x,z,options),w);
    const light=mosaicWeights(w,x,z,{light:true,exposure:.3});
    for(const id of [0,1,2,3,4])assert.equal(light[id],w[id]);
    assert(Math.abs((w[5]-light[5])-(light[6]-w[6]))<1e-12);
  }
  assert.equal(mosaicFade(60),1);assert.equal(mosaicFade(200),0);
});
test('GD6 six synthetic 30x12m views: 3-8 dominant material islands of at least 1m2; local weight sigma is visible',t=>{
  const metrics=[];
  for(const [ox,oz] of views){
    const labels=[],values=[];
    for(let j=0;j<48;j++)for(let i=0;i<120;i++){
      const w=mosaicWeights([0,0,0,0,0,1,0],ox+i*.25,oz+j*.25),id=w.indexOf(Math.max(...w));
      labels.push(id===5?0:id);values.push(w[5]);
    }
    const count=componentAreas(labels,120,48).filter(area=>area*.0625>=1).length;
    const mean=values.reduce((a,b)=>a+b)/values.length,sd=Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length);
    assert(count>=3&&count<=8,`island count ${count}`);assert(sd>=.20&&sd<=.30,`weight sigma ${sd}`);
    metrics.push({count,sd});
  }
  t.diagnostic(JSON.stringify({syntheticViews:metrics}));
});
test('GD7 bounded 0.67-1.83m irregular exposure islands only in sparse existing grass colonies',t=>{
  const metrics=[];
  for(const [ox,oz] of views){
    let covered=0,sum=0,max=0;const labels=[];
    for(let j=0;j<120;j++)for(let i=0;i<300;i++){
      const x=ox+i*.1,z=oz+j*.1,e=exposedSoil(x,z),c=grassColony(x,z);
      assert(e>=0&&e<=.3);if(c>=.55)assert.equal(e,0);
      if(e>0)covered++;sum+=e;max=Math.max(max,e);labels.push(+(exposureIsland(x,z)>0));
      assert.equal(exposedSoil(x,z,{grass:0}),0);assert.equal(exposedSoil(x,z,{pixel:1}),0);
      // Exposure and GD6 share one debit, using max, rather than summing two erosion layers.
      const w=mosaicWeights([0,0,1,0,0,0,0],x,z,{exposure:e});
      assert(w[2]>=.4-1e-12);assert(w[5]>=e-1e-12);
    }
    const coverage=covered/36000,largest=Math.max(...componentAreas(labels,300,120))*.01;
    assert(coverage<=.30);assert(largest<=Math.PI*(2.4*.38)**2+.1);
    metrics.push({coverage,meanHueMix:sum/36000,max,largestIslandArea:largest});
  }
  for(let j=-8;j<8;j++)for(let i=-8;i<8;i++)assert.equal(exposureIsland(i*2.4,j*.19),0,'cell borders cannot merge islands');
  t.diagnostic(JSON.stringify({exposure:metrics}));
});
test('GD7 sand traces are low-amplitude, zero-centred at broad sampling, filtered out at subpixel scale',()=>{
  let sum=0,energy=0;
  for(let i=0;i<30000;i++){
    const x=i*.113,z=i*-.071,v=sandTrace(x,z);assert(Math.abs(v)<=.018);
    assert(sandTrace(x,z,.18)===0);assert.equal(v,sandTrace(x,z));sum+=v;energy+=v*v;
  }
  assert(Math.abs(sum/30000)<.001);assert(Math.sqrt(energy/30000)>.004);
});
test('GD6/7 compiled Three wiring: no extra sampler, at most two selected reads, baseline details and exclusions survive',()=>{
  const on=compile(),off=compile('?ground8=0');
  try{
    const s=on.shader.fragmentShader,old=off.shader.fragmentShader;
    checkGLSL(s);checkGLSL(on.shader.vertexShader);
    assert(s.includes(GROUND8_GLSL));assert(!old.includes('ground8'));
    const samplers=src=>[...src.matchAll(/uniform sampler2D\s+([^;]+);/g)].flatMap(m=>m[1].split(','));
    assert.deepEqual(samplers(s),samplers(old));assert(samplers(s).length<=15);
    const prepare=s.slice(s.indexOf('void groundPhotoPrepare'),s.indexOf('void main()'));
    assert.equal((prepare.match(/groundPhotoRead\(/g)||[]).length,2);
    assert(prepare.indexOf('ground8Weights(w,p')<prepare.indexOf('float pathSoil='));
    assert(prepare.indexOf('ground8Weights(w,p')<prepare.indexOf('float moist='));
    for(const text of ['water8','road8','uGroundContactOrigin','uGroundPathOrigin','coast8','smoothstep(2.0,5.0,coast8)','1.0-smoothstep(0.0,.046875,border8)'])assert(prepare.includes(text));
    for(const text of ['groundGrassDetail(p,dist','ground6Turf','ground7Signal','slope7Signal','toneFineMultiplier','yardTrack'])assert(s.includes(text)&&old.includes(text));
    assert(!/dFdx|dFdy|fwidth|sampler2D/.test(GROUND8_GLSL));
    assert(s.includes('uPhotoBlend*uGroundPhotoEnabled*uToneBlend*step(.001,uToneStrength)'));
    assert.equal(on.shader.uniforms.uPhotoBlend,photoBlendUniform);
    assert(on.m.customProgramCacheKey().includes('|ground8'));assert(!off.m.customProgramCacheKey().includes('|ground8'));
  }finally{on.dispose();off.dispose();}
});
test('GD6/7 quality, startup, feature flags, no-routes fallback and disposal',async()=>{
  for(const quality of ['standard','light']){
    const h=compile('',quality);
    try{
      const u=h.shader.uniforms,counts=h.owner.tone.textures.map(()=>0);
      h.owner.tone.textures.forEach((t,i)=>t.addEventListener('dispose',()=>counts[i]++));
      assert.equal(u.uGround8.value,1);assert.equal(u.uGround8Fine.value,quality==='light'?0:1);
      assert.equal(u.uToneBlend.value,0);
      h.owner.setAdapt(2);assert.equal(u.uGround8.value,.5);assert.equal(u.uGround8Fine.value,0);
      h.owner.setAdapt(3);assert.equal(u.uGround8.value,0);
      h.owner.setAdapt(0);assert.equal(u.uGround8.value,1);assert.equal(u.uGround8Fine.value,quality==='light'?0:1);
      h.owner.dispose();h.owner.dispose();await h.owner.tone.ready;assert(counts.every(n=>n===1));
    }finally{h.dispose();}
  }
  for(const search of ['?ground8=0','?ground7=0','?gtone=0']){
    const h=compile(search);try{assert(!h.shader.fragmentShader.includes('ground8Weights'));}finally{h.dispose();}
  }
  for(const search of ['?ground6=0','?slope7=0','?photo=0']){
    const h=compile(search);try{checkGLSL(h.shader.fragmentShader);assert(h.shader.fragmentShader.includes('ground8Weights'));if(search==='?photo=0')assert.equal(h.shader.uniforms.uGroundPhotoEnabled.value,0);}finally{h.dispose();}
  }
  const h=compile('','standard',false);try{assert(!h.shader.fragmentShader.includes('ground8Weights'));}finally{h.dispose();}
});
