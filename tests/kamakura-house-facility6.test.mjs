import test from 'node:test';
import assert from 'node:assert/strict';
import {THREE,loadHouseMaterials} from './helpers/kamakura-house-view.mjs';
import {houseOpeningFillScale,houseOpeningAlbedo,houseRoofRim,houseHorizontalBoards,houseHash,houseIndexSeed,HOUSE_FACILITY6_GLSL} from '../dist/valley/kamakura-house-texture.js';
const luma=v=>v.reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0);
const smoothstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const shaderFor=m=>{const s={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};m.onBeforeCompile(s);return s;};
const mirror=name=>{
 const body=HOUSE_FACILITY6_GLSL.match(new RegExp(`float ${name}\\([^)]*\\)\\{([\\s\\S]*?)\\n?\\}`))[1];
 const args=name==='houseOpeningFillScale'?['fillY','diffuseY']:['edge','viewSun','facing','visibility','metres','elevation'];
 return new Function(...args,'min','max','smoothstep',body);
};
test('FH1 diffuse-bound fill mirrors emitted scalar GLSL, goes to zero in darkness; timber follows wall ratios',t=>{
 const gpu=mirror('houseOpeningFillScale');let minRatio=Infinity,maxRatio=0;
 for(const wall of [[.02,.018,.015],[.08,.065,.04],[.25,.19,.11]])for(const ratio of [.56,.60,.62]){
  const door=houseOpeningAlbedo(wall,ratio),albedoRatio=luma(door)/luma(wall);
  assert(albedoRatio>=.55&&albedoRatio<=.8);
  for(const light of [0,.0001,.01,.03,.2,1,5]){
   const reflected=luma(door)*light,fill=luma(door)*.85;
   const scale=houseOpeningFillScale(fill,reflected);
   assert.equal(scale,gpu(fill,reflected,Math.min,Math.max,smoothstep));
   assert(fill*scale<=.35*reflected+1e-12);
   const opening=reflected+fill*scale,wallY=luma(wall)*light;
   assert(opening<=wallY*.9+1e-12);
   if(light){const r=opening/wallY;minRatio=Math.min(minRatio,r);maxRatio=Math.max(maxRatio,r);assert(r>=.5&&r<=.85);}
   else assert.equal(opening,0);
  }
 }
 // The material floor is honoured where the wall-relative cap can accommodate it.
 assert(houseOpeningAlbedo([.03,.03,.03],.38).every(v=>v>=.012));
 assert(houseOpeningAlbedo([.001,.001,.001],.38).every(v=>v<=.001*.62));
 t.diagnostic(JSON.stringify({syntheticDoorWallRadianceRatio:[minRatio,maxRatio]}));
});
test('FH1 light quality reduces fill even as the original wall mixes back in',()=>{
 for(const strength of [1,.7])for(const doorRatio of [.55,.62])for(const light of [0,.001,.03,1,5]){
  const wall=.08,openingAlbedo=wall*(1-strength)+wall*doorRatio*strength;
  const diffuse=openingAlbedo*light,fill=wall*doorRatio*.85*strength;
  const output=diffuse+fill*houseOpeningFillScale(fill,diffuse*strength**3);
  assert(output<=wall*light*.9+1e-12);
  if(light)assert(output/(wall*light)>=.5&&output/(wall*light)<=.85);
 }
});
test('FH2 synthetic coordinate and actual placement-index hashes choose 12% horizontal boards; legacy 35%',t=>{
 for(const mode of ['coordinate','index']){
  let old=0,next=0;
  for(let i=0;i<20000;i++){
   const seed=mode==='index'?houseIndexSeed(i)[1]:houseHash((i%200)*13.7+19,Math.floor(i/200)*9.1+7);
   old+=Number(houseHorizontalBoards(seed,false));next+=Number(houseHorizontalBoards(seed));
   if(houseHorizontalBoards(seed))assert(houseHorizontalBoards(seed,false));
  }
  assert(next/20000>=.09&&next/20000<=.15);assert(old/20000>=.32&&old/20000<=.38);
  t.diagnostic(JSON.stringify({mode,oldFraction:old/20000,newFraction:next/20000,reductionPoints:(old-next)/200}));
 }
});
test('FH3 rim mirrors GLSL; shade/opposite view/60m give zero, low sun strongest, ceiling .05',()=>{
 const gpu=mirror('houseRoofRim');
 for(const edge of [0,.3,1])for(const aim of [-1,.8,.9,1])for(const facing of [-1,0,.1,1])for(const shadow of [0,.5,.95,1])for(const distance of [0,35,45,60,100])for(const up of [.05,.3,1]){
  const args=[edge,aim,facing,shadow,distance,up],v=houseRoofRim(...args);
  assert.equal(v,gpu(...args,Math.min,Math.max,smoothstep));assert(v>=0&&v<=.05);
  if(shadow<=.95||aim<=.8||facing<=0||distance>=60)assert.equal(v,0);
 }
 assert.equal(houseRoofRim(1,1,1,1,0,.05),.05);
 assert(houseRoofRim(1,1,1,1,0,.05)>houseRoofRim(1,1,1,1,0,1));
});
test('FH1-3 shader integration preserves old branch, shadow reads, photo switches and adaptive quality',async()=>{
 const {createHouseMaterial}=await loadHouseMaterials(),base=new THREE.MeshStandardMaterial();
 try{for(const quality of ['standard','light'])for(const role of [null,2,5]){
  const on=createHouseMaterial(base,{parts:true,quality,facilityRole:role}),off=createHouseMaterial(base,{parts:true,quality,facilityRole:role,search:'?facility6=0'});
  try{
   const a=shaderFor(on),b=shaderFor(off),s=a.fragmentShader;
   assert.equal(on.defines.HOUSE_FACILITY6,1);assert.equal(off.defines.HOUSE_FACILITY6,undefined);
   assert.notEqual(on.customProgramCacheKey(),off.customProgramCacheKey());
   assert(b.fragmentShader.includes('vec3 hDoor=vec3(.032,.028,.023)*hWoodRatio'));
   assert(s.includes('#if defined(HOUSE_FACILITY6) && !defined(HOUSE_FACILITY)\n  bool hHorizontal=vHouseRandom.y>.88 && post<.5'));
   assert(s.includes('hHorizontal?'));assert(s.includes('bool hHorizontal=vHouseRandom.y>.65 && post<.5'));
   assert(s.includes('hDoor=houseOpeningAlbedo(aged,clamp(.60*hWoodRatio,.56,.62))'));
   assert(s.indexOf('float hDiffuseY=')>s.indexOf('#include <lights_fragment_end>'));
   assert(s.includes('reflectedLight.directDiffuse+reflectedLight.indirectDiffuse'));
   assert(s.includes('housePhoto*housePhotoAdapt*uPhotoBlend*houseFade'));
   assert(s.includes('houseRoofEdge=hThatchEdge*(1.0-smoothstep(.015,.06,hAboveEave))'));
   // Expanding the original lighting chunk reuses its shadow lookup, never adds another one.
   const begin=s.slice(s.indexOf('// W2c-11 facility6: reuse')-1000,s.indexOf('#if ( NUM_RECT_AREA_LIGHTS'));
   assert(begin.includes('getShadow('));assert(begin.indexOf('getShadow(')<begin.indexOf('houseSunVisibility='));
   assert(!s.includes('getShadowMask('));
   assert.equal((s.match(/houseSunVisibility=dot\(/g)||[]).length,1);
   assert(s.includes('#if UNROLLED_LOOP_INDEX == 0'));
   assert.equal(on.userData.houseUniforms.houseRimQuality.value,quality==='light'?.45:1);
   on.userData.setHouseAdapt(2);assert.equal(on.userData.houseUniforms.houseRimQuality.value,(quality==='light'?.45:1)*.4);
   on.userData.setHouseAdapt(3);assert.equal(on.userData.houseUniforms.houseRimQuality.value,0);
   on.userData.setHouseAdapt(0);assert.equal(on.userData.houseUniforms.houseRimQuality.value,quality==='light'?.45:1);
   const code=s.replace(/\/\/[^\n]*/g,'');let depth=0;
   for(const c of code){if(c==='{')depth++;if(c==='}')depth--;assert(depth>=0);}assert.equal(depth,0);
   assert(!/\b(?:float|vec[234]|bool)\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(code));
  }finally{on.dispose();off.dispose();}
 }}finally{base.dispose();}
});
