import test from 'node:test';
import assert from 'node:assert/strict';
import {nearGrassDensityAt,midGrassDensityAt,grassTintAt,grassBandOffset,facilityGrassAt,sandGrassAt,createGrassBandCell,grassBandEnabled,GRASS_BAND_GLSL} from '../dist/valley/kamakura-grass-band.js';
import {createGrassCell,createGrassWindows} from '../dist/valley/kamakura-grass-field.js';
import {createGrassEnvironment} from '../dist/valley/kamakura-grass-look.js';
import {createGrassLook} from '../dist/valley/kamakura-grass-look-view.js';
import {midTile,tilesAround} from '../dist/valley/grass-field.js';
import {load,THREE,source} from './helpers/tree-modules.mjs';
import {fixture} from './helpers/kamakura-fixture.mjs';
const {buildGrass}=await load('grass-view.js'),{buildKamakuraGrass}=await load('kamakura-grass-view.js');
const flat={heightAt:()=>10,slopeAt:()=>0,waterAt:()=>0,walkable:()=>true,riverDistanceAt:()=>Infinity,seaDistanceAt:()=>Infinity};
const surfaceCodeAt=()=>2;
const boxes=[{x:0,z:0,w:8,d:8,rotY:Math.PI/4}];
const makeCell=(terrain=flat,code=surfaceCodeAt,facilityBoxes=[])=>createGrassBandCell(createGrassCell(terrain,{surfaceCodeAt:code,environmentAt:createGrassEnvironment(terrain,{surfaceCodeAt:code})}),terrain,{surfaceCodeAt:code,facilityBoxes});
const windowAt=(cell,x=0,size=64)=>{const w=createGrassWindows(cell,{size});w.plan({x,z:0});w.work(()=>0);w.commit();return w;};
const wind={uTime:{value:0},uWind:{value:1},uWindDir:{value:new THREE.Vector2(1,0)},uGuideMix:{value:0}};
const camera={position:new THREE.Vector3(0,12,0)};
globalThis.document={createElement(){const c={width:0,height:0,getContext:()=>({createLinearGradient:()=>({addColorStop(){}}),beginPath(){},moveTo(){},quadraticCurveTo(){},fill(){},getImageData:()=>({data:new Uint8ClampedArray(c.width*c.height*4)})})};return c;}};
const shader=m=>{const s={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};m.onBeforeCompile(s);return s;};
function balanced(s){const stack=[],pairs={')':'(',']':'[','}':'{'};for(const c of s.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g,'')){if('([{'.includes(c))stack.push(c);if(')]}'.includes(c))assert.equal(stack.pop(),pairs[c]);}assert.equal(stack.length,0);let depth=0;for(const m of s.matchAll(/^\s*#(if\w*|endif|else|elif)\b/gm)){if(m[1].startsWith('if'))depth++;if(m[1]==='endif')assert(--depth>=0);}assert.equal(depth,0);assert(!/\b(?:float|vec[234])\s+(?:patch|sample|input|output|filter|common|active|partition|resource)\b/.test(s));}
const expanded=s=>s.replace(/#include <(\w+)>/g,(_,k)=>expanded(THREE.ShaderChunk[k]));
test('continuous overlap and ground handoff: 10cm adjacent change < .014; monotone tails',t=>{
  let delta=0;const offsets=[];
  for(const [x,z] of [[0,0],[13,7],[-88,35],[151,-231]]){
    offsets.push(grassBandOffset(x,z));
    for(const f of [nearGrassDensityAt,midGrassDensityAt,grassTintAt]){
      let previous=f(x,z,0);for(let d=.1;d<160;d+=.1){const n=f(x,z,d);assert(n>=0&&n<=1);delta=Math.max(delta,Math.abs(n-previous));if(d>=30)assert(f===grassTintAt?n>=previous-1e-12:n<=previous+1e-12);previous=n;}
    }
    for(const d of [15,20,25,30,70,100,120])assert(nearGrassDensityAt(x,z,d)+midGrassDensityAt(x,z,d)+grassTintAt(x,z,d)>.65);
    assert.equal(nearGrassDensityAt(x,z,25),0);assert.equal(midGrassDensityAt(x,z,122),0);assert.equal(grassTintAt(x,z,127),1);
  }
  assert(delta<.014);assert(new Set(offsets).size>1);t.diagnostic(JSON.stringify({maxAdjacentDeltaPer10cm:delta,offsetRange:[Math.min(...offsets),Math.max(...offsets)]}));
});
test('synthetic grids have zero roots on steep slopes, facility rectangles and swash; exterior recovers',t=>{
  const cases=[makeCell({...flat,slopeAt:()=>35}),makeCell({...flat,heightAt:(x,z)=>10+x}),makeCell(flat,surfaceCodeAt,[{x:0,z:0,w:40,d:40}]),makeCell({...flat,seaDistanceAt:()=>9},()=>0)];
  const counts=[];for(const cell of cases){let count=0;for(let z=-8;z<8;z++)for(let x=-8;x<8;x++){const v=cell(x,z);count+=v.placeable;assert.equal(v.density,0);assert.equal(v.midPatch,0);}counts.push(count);}
  for(const d of [0,1,2,3,4])assert.equal(facilityGrassAt(d,0,[{x:0,z:0,w:8,d:8}]),0);
  assert.equal(facilityGrassAt(8,0,[{x:0,z:0,w:8,d:8}]),1);assert.equal(facilityGrassAt(0,0,boxes),0);
  let last=0;for(let d=0;d<50;d+=.5){const v=sandGrassAt(17,31,d);assert(v>=last);last=v;}assert(last>0);
  const grass=makeCell()(18,18),forest=makeCell(flat,()=>3)(18,18);assert(grass.midPatch>forest.midPatch);assert.equal(forest.species,3);
  t.diagnostic(JSON.stringify({excludedCellsPerCase:256,generated:counts}));
});
test('world values and mid roots match after streaming versus a fresh window',()=>{
  const cell=makeCell(flat,surfaceCodeAt,boxes),w=windowAt(cell,0,128);w.plan({x:32,z:0});w.work(()=>0);const moved=w.commit(),fresh=windowAt(cell,32,128).field;
  for(const key of ['placeable','density','height','species','midPatch','heights'])assert.deepEqual(moved[key],fresh[key]);
  assert.deepEqual(midTile(moved,0,0),midTile(fresh,0,0));
  const a=tilesAround(fresh,0,0,{reach:{near:25,mid:122,midInner:8}});assert(a.mid.some(t=>t.dist<15));
});
test('band shader composes, balances all includes, evaluates the same distance algebra and removes old gates',()=>{
  const f=windowAt(makeCell()).field,look=createGrassLook((x,z)=>({height:1,dry:.2,shade:0,flowers:0}),'standard',{value:new THREE.Vector4()},true);
  const v=buildGrass({field:f,wind,sunDir:new THREE.Vector3(1,1,0),look,reach:{near:25,mid:122,midInner:8}});
  try{v.warm(camera);for(const m of new Set(v.group.children.map(o=>o.material))){const s=shader(m);for(const code of [s.vertexShader,s.fragmentShader]){balanced(code);balanced(expanded(code));}assert(s.vertexShader.includes('float bandDistance=dd/1.0+grassBandOffset(rootWorld.xz)'));if(m.map){assert(!s.vertexShader.includes('float tail=mix'));assert(!s.vertexShader.includes('alive *= step(fract'));assert(s.vertexShader.includes('bandDensity)*smoothstep(0.0,.08,bandDensity)'));}else assert(!s.vertexShader.includes('float alive = step(fadeOut'));}
    const smoothstep=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
    for(const [name,fn] of [['nearGrassDensity',nearGrassDensityAt],['midGrassDensity',midGrassDensityAt]]){const expression=GRASS_BAND_GLSL.match(new RegExp(`float ${name}\\(float d\\)\\{return ([^;]+);`))[1];const run=new Function('d','smoothstep',`return ${expression}`);for(let d=0;d<=150;d+=.25)assert(Math.abs(run(d+grassBandOffset(17,31),smoothstep)-fn(17,31,d))<1e-12);}
  }finally{v.dispose();}
});
test('A/B, light and adaptive stages; stable frame buffers and exactly-once disposal',t=>{
  const d=fixture();d.meta.surface={};d.surface=new Uint8Array(d.meta.grid.width*d.meta.grid.height).fill(2);
  const rows=[];
  for(const [search,quality] of [['&gband=0','standard'],['','standard'],['','light']]){
    const v=buildKamakuraGrass({data:d,terrain:flat,search,quality,wind,sunDir:new THREE.Vector3(1,1,0)});
    try{v.warm(camera);v.update(camera);for(let i=0;i<4000&&(v.stats().pending||v.stats().queue);i++)v.update(camera);assert(!v.stats().pending&&!v.stats().queue);assert.equal(v.stats().bands,search==='');const before=v.stats();rows.push({search,quality,near:before.nearBlades,mid:before.midCards,triangles:before.triangles});
      const resources=new Map(),buffers=[];v.group.traverse(o=>{if(o.isMesh){for(const r of [o.geometry,o.material,o.material.map].filter(Boolean))resources.set(r,0);buffers.push([o,o.geometry.attributes.iRoot.data.array]);}});
      for(const r of resources.keys())r.addEventListener('dispose',()=>resources.set(r,resources.get(r)+1));
      const start=performance.now();for(let i=0;i<1000;i++){v.updateHero({x:0,y:10,z:0},0,false,1/60);v.update(camera);}
      rows.at(-1).steadyCpuMs=(performance.now()-start)/1000;
      assert.equal(v.stats().builds,before.builds);for(const [o,a] of buffers)assert.equal(o.geometry.attributes.iRoot.data.array,a);
      v.setAdapt(2);assert(v.stats().midCards<before.midCards);v.setAdapt(3);assert(!v.group.visible);v.setAdapt(0);assert(v.group.visible);assert.equal(v.stats().midCards,before.midCards);
      v.dispose();v.dispose();assert([...resources.values()].every(n=>n===1));
    }finally{v.dispose();}
  }
  assert(rows[2].mid<rows[1].mid);t.diagnostic(JSON.stringify(rows));
  assert(!grassBandEnabled('?gband=0'));assert(grassBandEnabled(''));
  for(const p of [/from 'three'/,/document\./,/performance\./,/Math\.random/,/Date\.now/])assert(!p.test(source('kamakura-grass-band.js')));
  const lightLook=createGrassLook(()=>({height:1,dry:0,shade:0,flowers:0}),'light',{value:new THREE.Vector4()},true);
  const light=buildGrass({field:windowAt(makeCell()).field,wind,quality:'light',sunDir:new THREE.Vector3(1,1,0),look:lightLook,reach:{near:25,mid:122,midInner:8}});
  try{light.warm(camera);for(const m of new Set(light.group.children.map(o=>o.material))){const s=shader(m);assert(s.vertexShader.includes('dd/0.6+grassBandOffset'));balanced(expanded(s.vertexShader));balanced(expanded(s.fragmentShader));}}finally{light.dispose();}
});
