import test from 'node:test';
import assert from 'node:assert/strict';
import {coastalGrassAt,nearGrassR3DensityAt,nearGrassR3Offset,grassShadowFactors,grassR3Enabled,GRASS_R3_NEAR_GLSL} from '../dist/valley/kamakura-grass-r3.js';
import {sandGrassAt,createGrassBandCell,nearGrassDensityAt} from '../dist/valley/kamakura-grass-band.js';
import {createGrassLook} from '../dist/valley/kamakura-grass-look-view.js';
import {createGrassEnvironment} from '../dist/valley/kamakura-grass-look.js';
import {createGrassCell,createGrassWindows} from '../dist/valley/kamakura-grass-field.js';
import {nearTile,midTile} from '../dist/valley/grass-field.js';
import {THREE,load} from './helpers/tree-modules.mjs';
const {buildGrass,buildKamakuraGrass}=Object.assign({},await load('grass-view.js'),await load('kamakura-grass-view.js'));
const smoothstep=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
const flat={heightAt:()=>10,slopeAt:()=>0,waterAt:()=>0,walkable:()=>true,riverDistanceAt:()=>Infinity,seaDistanceAt:()=>50};
function field(r3=false){
  const surfaceCodeAt=()=>0,environmentAt=createGrassEnvironment(flat,{surfaceCodeAt});
  const cell=createGrassBandCell(createGrassCell(flat,{surfaceCodeAt,environmentAt}),flat,{surfaceCodeAt,environmentAt,...(r3?{sandHabitatAt:coastalGrassAt,sandMidScale:1}:{})});
  const w=createGrassWindows(cell,{size:128});w.plan({x:0,z:0});w.work(()=>0);return w.commit();
}
const expanded=s=>s.replace(/#include <(\w+)>/g,(_,k)=>expanded(THREE.ShaderChunk[k]));
function balanced(s){
  const stack=[],pairs={')':'(',']':'[','}':'{'};
  for(const c of s.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g,'')){if('([{'.includes(c))stack.push(c);if(')]}'.includes(c))assert.equal(stack.pop(),pairs[c]);}assert.equal(stack.length,0);
  let depth=0;for(const m of s.matchAll(/^\s*#(if\w*|endif|else|elif)\b/gm)){if(m[1].startsWith('if'))depth++;if(m[1]==='endif')assert(--depth>=0);}assert.equal(depth,0);
  assert(!/\b(?:float|vec[234])\s+(?:patch|sample|input|output|filter|common|active|partition|resource)\b/.test(s));
}
globalThis.document={createElement(){const c={width:0,height:0,getContext:()=>({createLinearGradient:()=>({addColorStop(){}}),beginPath(){},moveTo(){},quadraticCurveTo(){},fill(){},getImageData:()=>({data:new Uint8ClampedArray(c.width*c.height*4)})})};return c;}};
const wind={uTime:{value:0},uWind:{value:1},uWindDir:{value:new THREE.Vector2(1,0)},uGuideMix:{value:0}};
test('R3 shore succession is monotone at fixed world positions, with spatially broken edges and open sand',t=>{
  let old=0,next=0,open=0;const contour=[];
  for(let z=-80;z<80;z++)for(let x=-80;x<80;x++){
    let previous=0;for(const d of [0,9,12,18,26,40,50,65,90]){const v=coastalGrassAt(x+.5,z+.5,d);assert(v>=previous-1e-12);previous=v;}
    assert.equal(coastalGrassAt(x,z,9,1),0);
    const v=coastalGrassAt(x+.5,z+.5,50);old+=sandGrassAt(x+.5,z+.5,50);next+=v;open+=v<.1;
    if(x===0)contour.push(coastalGrassAt(x+.5,z+.5,26));
  }
  const ratio=next/old;assert(ratio>.35&&ratio<.60);assert(open/25600>.3);
  assert(Math.max(...contour)-Math.min(...contour)>.25);
  for(const d of [26,50,90])assert(coastalGrassAt(3,7,d,.85)>=.85);
  t.diagnostic(JSON.stringify({habitatRatioToR2:ratio,lowHabitatFraction:open/25600,edgeRange:[Math.min(...contour),Math.max(...contour)]}));
});
test('actual synthetic near and mid roots reduce R2 carpet by roughly half',t=>{
  const counts=[];for(const f of [field(),field(true)]){
    let near=0,mid=0;for(let z=-48;z<48;z++)for(let x=-48;x<48;x++){
      near+=nearTile(f,x,z,{size:1}).count;mid+=midTile(f,x,z,{size:1,cardRate:.38,maxCards:1}).count;
    }counts.push({near,mid});
  }
  const ratio=(counts[1].near+counts[1].mid)/(counts[0].near+counts[0].mid);
  assert(ratio>.30&&ratio<.60);assert(counts[1].mid>150);t.diagnostic(JSON.stringify({counts,ratio}));
});
test('near/mid overlap spans 20m with two-scale contour displacement and gentler density slope',t=>{
  let oldMax=0,newMax=0;const offsets=[];
  for(let x=-80;x<80;x+=2){offsets.push(nearGrassR3Offset(x,13));for(let d=0;d<34;d+=.1){
    oldMax=Math.max(oldMax,Math.abs(nearGrassDensityAt(x,13,d+.1)-nearGrassDensityAt(x,13,d)));
    newMax=Math.max(newMax,Math.abs(nearGrassR3DensityAt(x,13,d+.1)-nearGrassR3DensityAt(x,13,d)));
  }assert.equal(nearGrassR3DensityAt(x,13,32),0);}
  assert(newMax<oldMax*.85);assert(Math.max(...offsets)-Math.min(...offsets)>6);
  const expression=GRASS_R3_NEAR_GLSL.match(/float nearGrassDensity\(float d\)\{return ([^;]+);/)[1],run=new Function('d','smoothstep',`return ${expression}`);
  for(let d=0;d<40;d+=.1)assert(Math.abs(run(d+nearGrassR3Offset(17,31),smoothstep)-nearGrassR3DensityAt(17,31,d))<1e-12);
  t.diagnostic(JSON.stringify({oldMaxPer10cm:oldMax,newMaxPer10cm:newMax,offsetRange:[Math.min(...offsets),Math.max(...offsets)]}));
});
test('R3 shadows reuse one sun lookup, retain ground sky light and soften emissive in shade; all quality/stage shaders balance',()=>{
  const f=field(true);
  for(const quality of ['standard','light'])for(const r3 of [false,true]){
    const look=createGrassLook(()=>({height:1,dry:.2,shade:0,flowers:0}),quality,{value:new THREE.Vector4()},true,r3);
    const v=buildGrass({field:f,wind,quality,sunDir:new THREE.Vector3(1,1,0),look,reach:{near:32,mid:158,midInner:8}});
    try{v.warm({position:new THREE.Vector3(0,12,0)});for(const stage of [0,1,2,3]){
      v.setLookQuality(stage);
      for(const m of new Set(v.group.children.map(o=>o.material))){
        const s={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};m.onBeforeCompile(s);
        for(const code of [s.vertexShader,s.fragmentShader]){balanced(code);balanced(expanded(code));}
        assert.equal(s.uniforms.uGrassLookStep.value,stage);
        if(!r3){assert(!s.fragmentShader.includes('grassSunVisibility'));continue;}
        const fs=s.fragmentShader,decl=fs.indexOf('float grassSunVisibility = 1.0;'),use=fs.indexOf('grassSunVisibility = ( directLight.visible');
        assert(decl>=0&&use>decl);assert(fs.indexOf('totalEmissiveRadiance *=')>use);
        assert.equal((fs.match(/getShadow\( directionalShadowMap/g)||[]).length,1);
        assert(!fs.includes('getShadowMask'));
        assert(!fs.includes('reflectedLight.indirectDiffuse *='),'retain the same indirect light as ground Lambert');
        const line=fs.split('\n').find(l=>l.includes('totalEmissiveRadiance *= mix('));assert(line);
        const [,a,b]=line.match(/mix\(([.\d]+),([.\d]+),grassSunVisibility\)/);
        for(const visibility of [0,.25,.5,.75,1])assert.equal(Number(a)+(Number(b)-Number(a))*visibility,grassShadowFactors(visibility).emissive);
        assert(s.vertexShader.includes('smoothstep(6.0,26.0,'));
      }
    }}finally{v.dispose();}
  }
  assert.deepEqual(grassShadowFactors(1),{emissive:1,indirect:1});
});
test('shadow floor preserves dusk fill and never attenuates normalized ground lighting',()=>{
  // Equal albedo/normal: ground = sky + sun*visibility. Grass must retain that
  // entire diffuse base, plus a nonnegative residual emissive (not a pixel ratio).
  for(const visibility of [0,.01,.25,.5,.75,1]){
    const factors=grassShadowFactors(visibility);
    assert(factors.emissive>=.25&&factors.emissive<=1,'nonzero dusk fill floor');
    if(visibility<1)assert(factors.emissive<1,'shade still suppresses R2 glow');
    assert.equal(factors.indirect,1,'sky must match ground, including in full shadow');
    for(const sky of [.005,.02,.1,.4])for(const sun of [0,.1,1])for(const glow of [0,.01,.08]){
      const ground=sky+sun*visibility;
      const grass=sky*factors.indirect+sun*visibility+glow*factors.emissive;
      assert(grass>=ground,'grass correction must not darken the ground diffuse base');
    }
  }
  assert(grassShadowFactors(0).emissive<=.4,'full shade still clearly dims R2 emissive');
});
test('URL retains R2 and legacy gband=0 paths',async()=>{
  assert(grassR3Enabled(''));assert(!grassR3Enabled('?grass3=0'));
  const {fixture}=await import('./helpers/kamakura-fixture.mjs');const data=fixture();data.meta.surface={};data.surface=new Uint8Array(data.meta.grid.width*data.meta.grid.height).fill(2);
  for(const [search,r3,bands] of [['',true,true],['?grass3=0',false,true],['?gband=0',false,false]]){
    const v=buildKamakuraGrass({data,terrain:flat,search,wind,sunDir:new THREE.Vector3(1,1,0)});
    try{v.warm({position:new THREE.Vector3(0,12,0)});assert.equal(v.stats().r3,r3);assert.equal(v.stats().bands,bands);}finally{v.dispose();}
  }
});
