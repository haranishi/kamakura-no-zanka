import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {THREE,loadHouseMaterials} from './helpers/kamakura-house-view.mjs';
import {photoBlendUniform,photoSampler,PHOTO_TEX_DATA} from '../dist/valley/kamakura-photo-tex.js';
import {houseRainCentre,houseHash,HOUSE_PALETTE} from '../dist/valley/kamakura-house-texture.js';
const shaderFor=m=>{const s={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};m.onBeforeCompile(s);return s;};
function balanced(source){
 const code=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,''), stack=[],pairs={')':'(',']':'[','}':'{'};let pp=0;
 for(const c of code){if('([{'.includes(c))stack.push(c);else if(')]}'.includes(c))assert.equal(stack.pop(),pairs[c]);}
 assert.equal(stack.length,0);
 for(const line of code.split('\n')){if(/^\s*#if(?:def|ndef)?\b/.test(line))pp++;if(/^\s*#endif\b/.test(line))assert(--pp>=0);}
 assert.equal(pp,0);
 assert(!/\b(?:float|vec[234]|mat[234]|int|bool)\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(code));
}
const mix=(a,b,t)=>a*(1-t)+b*t;
const stats=values=>{const mean=values.reduce((a,b)=>a+b,0)/values.length;const sd=Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length);return {mean,sd,cv:sd/mean};};
test('R4 photo shader: real PBR in both qualities, all roles; shared samplers, explicit-gradient branch reads, one unconditional normal',async()=>{
 const {createHouseMaterial}=await loadHouseMaterials(),base=new THREE.MeshStandardMaterial();
 try{for(const quality of ['standard','light'])for(const facilityRole of [null,0,1,2,3,4,5,6,7,8]){
  const m=createHouseMaterial(base,{quality,facilityRole,parts:true}),s=shaderFor(m),code=s.fragmentShader;
  balanced(code);balanced(s.vertexShader);
  assert.equal(s.uniforms.uPhotoBlend,photoBlendUniform);
  for(const key of ['wallWoodA','wallWoodB','wallPlaster','roofThatch','roofThatchOld','roofTile','stoneRubble']){
   assert.equal(s.uniforms['hPhoto_'+key],photoSampler(key));
   assert(code.includes(`hPhotoUV/${PHOTO_TEX_DATA[key].meters.toFixed(3)}`));
  }
  assert.equal((code.match(/vec3 hPhotoNormal=kzPerturbNormal\(/g)||[]).length,1);
  const normal=code.slice(code.indexOf('vec3 hPhotoNormal='),code.indexOf('#include <clearcoat_normal_fragment_begin>'));
  assert(!normal.includes('if('));
  assert(code.indexOf('vec2 hPhotoDx=dFdx(hPhotoUV)')<code.indexOf('if(hBlend>0.0)'));
  const readStart=code.indexOf('if(hBlend>0.0)');
  let readEnd=code.indexOf('{',readStart)+1,depth=1;
  while(depth){const c=code[readEnd++];if(c==='{')depth++;else if(c==='}')depth--;}
  const reads=code.slice(readStart,readEnd);
  assert(!/\b(?:dFdx|dFdy|fwidth|kzPhoto|kzPhotoHex)\(/.test(reads));
  const helper=code.slice(code.indexOf('vec3 housePhotoRead'),code.indexOf('uniform sampler2D houseAtlas'));
  assert(helper.includes('#ifndef HOUSE_LIGHT\n if(roofWeight>0.0)return kzPhotoHexGrad(photoMap,uv,1.2,0.0,gx,gy);\n #endif'));
  assert(helper.includes('return kzPhotoGrad(photoMap,uv,gx,gy)'));
  assert(code.indexOf('hc*=mix(1.0,hPhoto.z,hBlend*hPhotoAmount)')<code.indexOf('vec3 aged=min(vec3(.45)'));
  assert(code.includes('painted=houseKeepPigment>0.0'));assert(code.includes('if(houseKeepPigment>0.0 && roof<.5)hBlend=0.0'));
  assert(code.includes('#include <roughnessmap_fragment>\n      roughnessFactor=mix(roughnessFactor,hRough,hBlend)'));
  assert(code.includes('#include <metalnessmap_fragment>\n      metalnessFactor=mix(metalnessFactor,0.0,hBlend)'));
  m.dispose();
 }}finally{base.dispose();}
});
test('R4 photo=0/hphoto=0/loading/step3 preserve old algebra, no extra texture allocation, switches remain uniforms',async()=>{
 const {createHouseMaterial}=await loadHouseMaterials(),base=new THREE.MeshStandardMaterial();
 try{for(const search of ['', '?photo=0','?hphoto=0','?hdebug=1']){
  const m=createHouseMaterial(base,{search,parts:true}),s=shaderFor(m),u=s.uniforms,key=m.customProgramCacheKey(),version=m.version;
  assert.equal(u.housePhoto.value,/photo=0/.test(search)?0:1);assert.equal(u.houseDebug.value,search.includes('hdebug=1')?1:0);
  assert.equal(u.uPhotoBlend.value,0); // Node never loads images; null samplers are permitted.
  const expression=s.fragmentShader.match(/float hBlend=([^;]+);/)[1].replace(/\b(housePhoto|housePhotoAdapt|uPhotoBlend|houseFade)\b/g,'values.$1');
  const blend=new Function('values',`return ${expression};`);
  for(const values of [{housePhoto:0,housePhotoAdapt:1,uPhotoBlend:1,houseFade:1},{housePhoto:1,housePhotoAdapt:1,uPhotoBlend:0,houseFade:1},{housePhoto:1,housePhotoAdapt:0,uPhotoBlend:1,houseFade:1}]){
   const b=blend(values);assert.equal(b,0);
   for(const ratio of [.05,1,3]){assert.equal(mix(1,ratio,b),1);assert.equal(.9*b,0);assert.equal((1-b)*.123,.123);assert.equal(mix(.87,.6,b),.87);}
  }
  m.userData.setHouseAdapt(3);assert.equal(u.housePhotoAdapt.value,0);m.userData.setHouseAdapt(2);assert.equal(u.housePhotoAdapt.value,1);
  m.userData.setHouseAdapt(0);assert.equal(m.customProgramCacheKey(),key);assert.equal(m.version,version);m.dispose();
 }}finally{base.dispose();}
});
test('R4 ratios blend around 1, never add photograph colour; material roughnesses differ without changing palette',async t=>{
 const {createHouseMaterial}=await loadHouseMaterials(),base=new THREE.MeshStandardMaterial(),m=createHouseMaterial(base,{parts:true}),code=shaderFor(m).fragmentShader;
 try{
  for(const b of [0,.35,.6,1]){
   const ratios=Array.from({length:1001},(_,i)=>.1+1.8*i/1000);
   for(const c of HOUSE_PALETTE.wood)assert(Math.abs(stats(ratios.map(r=>c*mix(1,r,b))).mean-c)<1e-12);
  }
  for(const literal of ['hRough=.80','hRough=.92','hRough=1.0','hRough=.55+.10*vHouseRandom.x','hRough=mix(.85,.60,hWet)','hPhotoAmount=1.0'])assert(code.includes(literal));
  assert(code.includes('hpn*hpn.y-vec3(0.0,1.0,0.0)'));assert(code.includes('vHouseRandom.x>.80 && vHouseNorth>.5'));
  assert(code.includes('float detail = (1.0-hBlend)'));assert(code.includes('float overlap = (1.0-hBlend)'));
  t.diagnostic('Synthetic unbiased ratios preserve hc mean to <1e-12; final clamp, light, dirt and openings require screen comparison.');
 }finally{m.dispose();base.dispose();}
});
test('R4 rain: shader/JS centre agreement, nonuniform spacing and soil/eave/north masks',async t=>{
 const {createHouseMaterial}=await loadHouseMaterials(),base=new THREE.MeshStandardMaterial(),m=createHouseMaterial(base,{parts:true}),code=shaderFor(m).fragmentShader;
 try{
  const expression=code.match(/float hCentre=([^;]+);/)[1].replace('vHouseRandom.z','seed').replace('houseHash(vec2(hi,seed*31.0))','hash(hi,seed*31.0)');
  const centre=new Function('hi','seed','hash',`return ${expression};`),gaps=[];
  for(let i=-500;i<500;i++){assert.equal(centre(i,.37,houseHash),houseRainCentre(i,.37));gaps.push(houseRainCentre(i+1,.37)-houseRainCentre(i,.37));}
  const s=stats(gaps);assert(s.cv>=.25,`CV=${s.cv}`);assert(gaps.every(v=>v>0));
  assert(code.includes('float hSplashTop=.30+.20*houseHash'));assert(code.includes('smoothstep(.12,1.4,hEaveDist)'));
  assert(code.includes('vHouseNorth*hMossZone'));assert(code.includes('stain=mix(stain,hStain,hBlend)'));
  t.diagnostic(JSON.stringify({rainSpacingMetres:s}));
 }finally{m.dispose();base.dispose();}
});

test('R4 F4: emitted GLSL and pure rule agree on metre dimensions, wall margins, type omissions and jitter',async t=>{
 const {HOUSE_OPENING_GLSL,houseOpeningCell}=await import('../dist/valley/kamakura-house-texture.js');
 const body=HOUSE_OPENING_GLSL.slice(HOUSE_OPENING_GLSL.indexOf(' float pitch='),HOUSE_OPENING_GLSL.lastIndexOf('}'))
  .replace(/\b(?:float|bool) /g,'let ').replace(/\bhouseHash\(/g,'hash(').replace(/\bmod\(/g,'modulo(')
  .replace(/vec2\(([^()]*)\)/g,'[$1]').replace(/vec4\(0\.0\)/g,'[0,0,0,0]').replace(/vec4\(([^()]*)\)/g,'[$1]')
  .replace(/bounds\.x/g,'min').replace(/bounds\.y/g,'max');
 const gpu=new Function('cell','kind','seed','face','min','max','hash','modulo',body);
 const byKind=new Map();let doors=0,windows=0,empty=0,matched=0;const centres=[];
 for(let kind=0;kind<14;kind++)for(const seed of [.12,.37,.91])for(let face=0;face<4;face++)for(let cell=-20;cell<=20;cell++){
  const min=-36,max=36,js=houseOpeningCell(cell,kind,seed,face,min,max),gl=gpu(cell,kind,seed,face,min,max,v=>houseHash(...v),(x,y)=>x-y*Math.floor(x/y));
  byKind.set(kind,byKind.get(kind)||new Set());
  if(!js){assert.equal(gl[1],0);empty++;continue;}
  const {centre,width,height,bottom,pitch,type}=js;matched++;
  assert(centre-width/2>=min+.6 && centre+width/2<=max-.6);
  assert(pitch>=3&&pitch<=5);assert.equal(width,type==='door'?.9:.7);assert.equal(height,type==='door'?1.75:.5);
  assert(type==='door'?bottom===0:bottom>=1.3&&bottom+.5<=1.9);
  for(const [i,want] of [centre,width,height,bottom].entries())assert(Math.abs(gl[i]-want)<1e-12);
  byKind.get(kind).add(type);if(type==='door')doors++;else windows++;
  if(kind===3&&seed===.37&&face===0)centres.push(centre);
 }
 assert(doors>0&&windows>0&&empty>0);assert(!byKind.get(0).size);
 for(let kind=0;kind<14;kind++){if(kind%5===0)assert(!byKind.get(kind).has('door'));if(kind%4===0)assert(!byKind.get(kind).has('window'));}
 const gaps=centres.slice(1).map((x,i)=>x-centres[i]),s=stats(gaps);assert(s.cv>.25);
 t.diagnostic(JSON.stringify({syntheticRulesMatched:matched,doors,windows,empty,openingCentreGapCV:s.cv}));
});
test('R4 F4: bounded periodic bar integral converges to mean; all effects can be switched off',async()=>{
 const {createHouseMaterial}=await loadHouseMaterials(),base=new THREE.MeshStandardMaterial();
 const integral=(x,w)=>Math.floor(x)*w+Math.min(x-Math.floor(x),w),duty=.018/.07;
 for(const width of [.001,.1,1,2,30]){
  let total=0;
  for(let i=0;i<10000;i++){
   const x=i/10000,coverage=(integral(x+width/2,duty)-integral(x-width/2,duty))/width;
   assert(coverage>=-1e-10&&coverage<=1+1e-10);total+=coverage/10000;
   if(Number.isInteger(width))assert(Math.abs(coverage-duty)<1e-12);
  }
  assert(Math.abs(total-duty)<1e-5);
 }
 try{for(const search of ['', '?hopen=0','?photo=0','?hphoto=0']){
  const m=createHouseMaterial(base,{parts:true,search,kind:3}),s=shaderFor(m),code=s.fragmentShader;
  assert.equal(s.uniforms.houseOpenings.value,search.includes('hopen=0')?0:1);assert.equal(s.uniforms.houseKind.value,3);
  assert(s.vertexShader.includes('attribute vec2 houseWallSpan'));
  assert(code.includes('vHouseWallSpan*vHouseScale.x:vHouseWallSpan*vHouseScale.z'));
  assert(code.includes('#if defined(HOUSE_PARTS) && !defined(HOUSE_FACILITY)'));
  assert(code.includes('hOpMask*hBlend*houseOpenings*hOpeningFade'));
  assert(code.includes('vec3 hDoorPhoto=kzPhotoGrad(hPhoto_wallWoodA'));
  assert(code.indexOf('vec2 hWallDx=dFdx(hWallUV)')<code.indexOf('if(hBlend*houseOpenings*hOpMask>0.0'));
  assert(code.includes('smoothstep(18.0,28.0,length(vViewPosition))'));
  m.dispose();
 }}finally{base.dispose();}
});
test('R4 F5: every palette target is compared with the local photograph statistics (no palette changes)',async t=>{
 const doc=JSON.parse(await fs.readFile(new URL('../provenance/kamakura-photo-textures.json',import.meta.url)));
 const photos=new Map(doc.materials.map(v=>[v.key,v.stats.meanLinearRgb]));
 const luma=rgb=>rgb.reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0),sat=rgb=>(Math.max(...rgb)-Math.min(...rgb))/Math.max(...rgb);
 const mapping={thatch:'roofThatch',oldThatch:'roofThatchOld',lime:'wallPlasterWorn',oldLime:'wallPlasterWorn',roof:'roofThatch',oldRoof:'roofThatchOld',wood:'wallWoodA',oldWood:'wallWoodB',earth:'wallPlaster',oldEarth:'wallPlaster',plaster:'wallPlasterWorn',stone:'stoneRubble',oldStone:'stoneRubble',tile:'roofTile',post:'wallWoodA'};
 const rows=Object.entries(HOUSE_PALETTE).map(([key,rgb])=>{
  const photo=photos.get(mapping[key]);assert(photo?.length===3);
  return {key,photo:mapping[key],Y:+luma(rgb).toFixed(4),photoY:+luma(photo).toFixed(4),Yratio:+(luma(rgb)/luma(photo)).toFixed(2),satDelta:+(sat(rgb)-sat(photo)).toFixed(3)};
 });
 assert.equal(rows.length,Object.keys(HOUSE_PALETTE).length);t.diagnostic(JSON.stringify({paletteComparison:rows}));
});

test('R4 F4 wall spans follow each connected inset/disconnected wall and do not mutate model data',async()=>{
 const {houseWallSpans,houseOpeningCell}=await import('../dist/valley/kamakura-house-texture.js');
 const positions=[];
 for(const [min,max,z] of [[-4,4,3],[-1,1,1],[7,10,3]])positions.push(min,.5,z,max,.5,z,max,3,z,min,.5,z,max,3,z,min,3,z);
 const p=new Float32Array(positions),before=Buffer.from(p.buffer).toString('hex'),spans=houseWallSpans(p);
 assert.equal(Buffer.from(p.buffer).toString('hex'),before);
 for(let wall=0;wall<3;wall++){
  const [min,max]=[[-4,4],[-1,1],[7,10]][wall];
  for(let v=wall*6;v<wall*6+6;v++){assert.equal(spans[v*2],min);assert.equal(spans[v*2+1],max);}
  for(let kind=0;kind<14;kind++)for(let cell=-10;cell<10;cell++){
   const opening=houseOpeningCell(cell,kind,.37,0,min,max);
   if(opening){assert(opening.centre-opening.width/2>=min+.6);assert(opening.centre+opening.width/2<=max-.6);}
  }
 }
 const sloping=houseWallSpans(new Float32Array([0,3,0,3,4,0,0,3,3]));assert(sloping.every(v=>v===0));
 // Same shape after 3x instance scaling: only wall spans scale; door stays .9 x 1.75m.
 const door=Array.from({length:20},(_,cell)=>houseOpeningCell(cell-10,3,.37,0,-12,12)).find(v=>v?.type==='door');
 assert(door);assert.equal(door.width,.9);assert.equal(door.height,1.75);
});
