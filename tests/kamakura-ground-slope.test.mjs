import test from 'node:test';
import assert from 'node:assert/strict';
import {THREE} from './helpers/tree-modules.mjs';
import {fixture} from './helpers/kamakura-fixture.mjs';
import {installGroundDetail} from '../dist/valley/kamakura-ground-detail.js';
import {slopeColor,slopeSignal,slopeWeights,slopeEnvelope,farAmount,forestColor,slopeHaze,SLOPE7_GLSL} from '../dist/valley/kamakura-ground-slope.js';
import {createGroundDensity} from '../dist/valley/kamakura-ground-density.js';
const luma=c=>c[0]*.2126+c[1]*.7152+c[2]*.0722;
const sat=c=>(Math.max(...c)-Math.min(...c))/Math.max(.00001,Math.max(...c));
const base=[.3,.18,.08];
function setup(search='',quality='standard',data=null){
  const d=data||fixture({width:13,height:9,cell:2});
  d.meta.ground={};d.meta.surface={};d.ground=new Uint8Array(d.meta.grid.width*d.meta.grid.height*3).fill(140);d.surface=new Uint8Array(d.meta.grid.width*d.meta.grid.height).fill(4);
  const m=new THREE.MeshLambertMaterial({vertexColors:true}),owner=installGroundDetail(THREE,m,d,{search,quality});
  const s={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};m.onBeforeCompile(s);
  return {d,m,owner,s,dispose(){owner.dispose();m.dispose();}};
}
function balanced(source){
  const clean=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,''),stack=[],pairs={')':'(',']':'[','}':'{'};
  for(const c of clean){if('([{'.includes(c))stack.push(c);else if(')]}'.includes(c))assert.equal(stack.pop(),pairs[c]);}assert.equal(stack.length,0);
  let depth=0;for(const line of clean.split('\n')){if(/^\s*#\s*(if|ifdef|ifndef)\b/.test(line))depth++;if(/^\s*#\s*endif\b/.test(line))assert(--depth>=0);}assert.equal(depth,0);
  assert(!/--\s*\d|\b\d+(?:\.\d*)?(?:mix|vec\d|clamp)\s*\(/.test(clean));
  assert(!/\b(?:float|vec[234]|int)\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(clean));
}
// R7 parent tuning: strengths x3. The synthetic view assumes neutral land everywhere (land=1); on screen the
// neutral-land weight lowers the spread to about a third, which is the 4-6% target.
test('SL1 local 30x12m luma mean and 12-20% sigma at land=1; additive gain never exceeds 30%',t=>{
  const metrics=[];
  for(const [x,z] of [[0,0],[41,17],[-70,29],[103,-67],[-150,-83],[211,173]]){
    const values=[];
    for(let j=0;j<48;j++)for(let i=0;i<120;i++){
      const ratio=luma(slopeColor(base,x+i*.25,z+j*.25))/luma(base);
      assert(ratio>=.7-1e-10&&ratio<=1.3+1e-10);values.push(ratio);
    }
    const mean=values.reduce((s,v)=>s+v,0)/values.length,sd=Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/values.length);
    assert(Math.abs(mean-1)<.05);assert(sd>=.12&&sd<=.2);metrics.push({mean,sd});
  }
  t.diagnostic(JSON.stringify({syntheticViewMetrics:metrics}));
});
test('SL1 normalized ecological weights, terrain direction monotonicity, stable hashes and exact fade limits',()=>{
  for(let i=0;i<1000;i++){
    const x=i*.17,z=i*-.39,n=slopeSignal(x,z);
    assert.equal(n,slopeSignal(x,z));assert(Math.abs(n)<=1);
    for(const sun of [-1,0,1])for(const convex of [-1,1])for(const north of [-1,1]){
      const w=slopeWeights(n,{sun,convex,north});
      for(const v of [w.clay,w.moss,w.humus])assert(v>=-1e-12&&v<=1);
      assert(Math.abs(w.clay+w.moss+w.humus-1)<1e-12);
    }
    assert(slopeWeights(n,{sun:1,convex:1,north:-1}).clay>=slopeWeights(n,{sun:-1,convex:-1,north:1}).clay);
    const light=slopeColor(base,x,z,{sun:1,convex:1,north:-1}),damp=slopeColor(base,x,z,{sun:-1,convex:-1,north:1});
    assert(luma(light)>=luma(damp)-1e-12);assert(light[0]/light[2]>=damp[0]/damp[2]);
    for(const options of [{normalY:1},{normalY:Math.cos(Math.PI/3)},{dist:600},{strength:0}])assert.deepEqual(slopeColor(base,x,z,options),base);
    assert.equal(slopeSignal(x,z,{pixel:40}),0);
  }
  for(const deg of [0,10,15,45,60,90])assert(Math.abs(slopeEnvelope(Math.cos(deg*Math.PI/180)))<1e-12);
  assert.equal(slopeEnvelope(Math.cos(Math.PI/6)),1);
  assert(!/dFdx|dFdy|fwidth/.test(SLOPE7_GLSL));
});
test('SL2 distance monotonicity, forest cap and haze saturation bound including blue airlight',()=>{
  let previous=0;
  const fog=[.55,.67,.8];
  for(let dist=0;dist<=4000;dist+=10){
    const a=farAmount(dist);assert(a>=previous);previous=a;
    const forest=forestColor(base,1,dist),air=slopeHaze(base,fog,dist);
    if(dist<=250){assert.equal(a,0);assert.deepEqual(forest,base);assert.deepEqual(air,base);}
    assert(sat(air)<=sat(base)+1e-9);assert(sat(air)>=sat(base)*.75-1e-9);
    assert(air[2]/air[0]>=base[2]/base[0]-1e-9);
    for(const v of [...forest,...air])assert(Number.isFinite(v)&&v>=0);
  }
  assert.equal(farAmount(2200),1);assert.equal(farAmount(3000),1);assert.deepEqual(forestColor(base,1,3000),forestColor(base,1,4000));
  assert.deepEqual(forestColor(base,0,4000),base);
  for(const c of [[0,0,0],[.2,.2,.2],[.03,.04,.02]])for(const f of [fog,[.9,.4,.2],[0,0,0]]){
    const out=slopeHaze(c,f,3000);assert(out.every(Number.isFinite));
    assert(sat(out)<=sat(c)+1e-9);assert(sat(out)>=sat(c)*.75-1e-9);
  }
  const target=forestColor([0,0,0],1,3000);assert(Math.abs(target[1]-.4*.051269458)<1e-8);
});
test('SL2 deterministic canopy density uses only veg; smooth support, empty input and north/south convention',()=>{
  const veg=[{x:10,z:-20,crown:8,height:20,sourceSpecies:0}],f=createGroundDensity(veg,128,128),g=createGroundDensity(veg,128,128);
  assert.equal(f.bytes.length,128*128);assert.equal(Buffer.compare(f.bytes,g.bytes),0);
  assert(f.at(10,-20)>f.at(10,20));assert(f.at(10,-20)>f.at(12,-20));assert.equal(f.at(1000,0),0);
  assert(createGroundDensity([],128,128).bytes.every(v=>v===0));
  assert(createGroundDensity([{x:0,z:0,crown:8,sourceSpecies:5}],128,128).bytes.every(v=>v===0));
  const dense=createGroundDensity([...veg,...veg],128,128);for(let i=0;i<f.bytes.length;i++)assert(dense.bytes[i]>=f.bytes[i]);
});
test('SL1/2 generated Three shader flags, resources, sampler budget, adaptation and one-time density bake',async()=>{
  for(const quality of ['standard','light'])for(const search of ['', '?ground7=0','?ground6=0','?ground6=0&ground7=0','?photo=0']){
    const h=setup(search,quality);try{
      await h.owner.tone.ready;
      const density=h.owner.tone.density,u=h.owner.uniforms,shader=h.s.fragmentShader;
      assert(density);assert.equal(density.bytes.length,16384);
      balanced(shader);balanced(h.s.vertexShader);
      assert.equal(new Set([...shader.matchAll(/uniform sampler2D\s+([^;]+);/g)].flatMap(m=>m[1].split(','))).size,14);
      assert(shader.includes('result*=mix(1.0,groundPhotoRatio,groundPhotoAmount);'));
      assert(shader.includes('return ground6Color(result,p,dist,px,turf6,dry);')||search.includes('ground6=0'));
      assert(shader.indexOf('result*=mix(1.0,groundPhotoRatio,groundPhotoAmount);')<shader.indexOf('result=slope7Color('));
      assert(shader.indexOf('outgoingLight=slope7Haze(')<shader.indexOf('#include <opaque_fragment>'));
      for(const [step,value,fine] of [[2,quality==='light'?.25:.5,0],[3,0,0],[0,quality==='light'?.5:1,quality==='light'?0:1]]){
        h.owner.setAdapt(step);assert.equal(u.uSlope7.value,value);assert.equal(u.uSlope7Fine.value,fine);assert.equal(h.owner.tone.density,density);
      }
      const counts=h.owner.tone.textures.map(()=>0);h.owner.tone.textures.forEach((v,i)=>v.addEventListener('dispose',()=>counts[i]++));
      h.owner.dispose();h.owner.dispose();assert(counts.every(v=>v===1));
    }finally{h.dispose();}
  }
  for(const search of ['?slope7=0','?gtone=0','?gdetail=0']){
    const h=setup(search);try{assert(!h.s.fragmentShader.includes('slope7Color'));assert(!h.owner.tone?.density);assert.equal(h.owner.uniforms?.uSlope7,undefined);}finally{h.dispose();}
  }
});

test('SL2 private canopy field prepares without changing source placements or exporting private values',async t=>{
  if(!process.env.KZ_WORLD_DIR){t.skip('KZ_WORLD_DIR未設定：私有植生が必要');return;}
  const {readFile}=await import('node:fs/promises'),{join}=await import('node:path');
  const {decodeVeg}=await import('../dist/valley/kamakura-veg.js');
  const root=process.env.KZ_WORLD_DIR,meta=JSON.parse(await readFile(join(root,'meta.json'),'utf8'));
  const info=JSON.parse(await readFile(join(root,meta.veg.info),'utf8')),bin=await readFile(join(root,meta.veg.file));
  const veg=decodeVeg(info,bin.buffer.slice(bin.byteOffset,bin.byteOffset+bin.byteLength)),grid=meta.grid;
  const start=performance.now(),f=createGroundDensity(veg,grid.width*grid.cell_m,grid.height*grid.cell_m);
  assert(f.bytes.some(v=>v>0));assert.equal(f.bytes.length,16384);
  t.diagnostic(JSON.stringify({densityPreparationMs:performance.now()-start,retainedDensityBytes:f.bytes.byteLength}));
});
