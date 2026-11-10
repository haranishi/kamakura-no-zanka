import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {houseFoundationTop,houseOpeningFit,houseWoodRatio,HOUSE_WOOD_MEAN,houseIndexSeed} from '../dist/valley/kamakura-house-texture.js';
import {THREE,loadHouseMaterials,loadHouseView} from './helpers/kamakura-house-view.mjs';
import {decodeHouses,houseBounds} from '../dist/valley/kamakura-houses.js';
import {parseGlb,readAccessor} from '../tools/lib/glb.mjs';
const shaderFor=m=>{const s={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};m.onBeforeCompile(s);return s;};
const ring=(y,r)=>[-r,y,-r,r,y,-r,r,y,r,-r,y,r];
test('F6 synthetic foundation rings and every opening respect floor, eave, facade and side margins',t=>{
 let count=0;
 for(const floor of [.25,.6,1.05])for(const eave of [3.2,4.5]){
  const p=[...ring(-1.5,4),...ring(floor,3.8),...ring(eave,4),...ring(eave,4.3),0,eave+2,0];
  assert.equal(houseFoundationTop(p,eave),floor>.9?.5:floor); // FX1 rejects oversized rings.
  for(let kind=0;kind<14;kind++)for(let id=0;id<40;id++)for(let face=0;face<4;face++)for(let cell=-4;cell<=4;cell++){
   const seed=houseIndexSeed(id)[2],o=houseOpeningFit(cell,kind,seed,face,-12,12,floor,eave);
   if(!o)continue;count++;
   assert(o.bottom>=floor);assert(o.bottom+o.height<=eave-.10);
   assert(o.centre-o.width/2>=-12+.6);assert(o.centre+o.width/2<=12-.6);
   if(o.type==='door')assert.equal(o.bottom,floor);
   else assert(o.bottom-floor>=.65&&o.bottom-floor<=1.4);
  }
 }
 assert(count>0);t.diagnostic(`synthetic accepted openings=${count}`);
 // Low walls cannot fit a door or window; candidates are discarded rather than clipped.
 for(let c=-10;c<10;c++)assert.equal(houseOpeningFit(c,3,.37,1,-30,30,.6,1.5),null);
});
test('F7 highlight-only compression preserves mean after distribution correction and reduces peaks',()=>{
 const r=[.1,.4,.7,1,1.2,1.6,2],mean=r.reduce((a,b)=>a+Math.min(b,1)+.45*Math.max(b-1,0),0)/r.length;
 const result=r.map(v=>houseWoodRatio(v,mean));
 assert(Math.abs(result.reduce((a,b)=>a+b,0)/r.length-1)<1e-12);
 assert(houseWoodRatio(2,mean)-houseWoodRatio(1,mean)<(2-1)/mean);
 assert.equal(houseWoodRatio(.4,mean),.4/mean);
 for(const v of Object.values(HOUSE_WOOD_MEAN))assert(v>.9&&v<1);
});
test('F6-F10 generated shader has bounded opening fill, actual floor rejection, roof age cap and scoped plaster palette',async()=>{
 const {createHouseMaterial}=await loadHouseMaterials(),base=new THREE.MeshStandardMaterial();
 try{for(const quality of ['standard','light'])for(const facilityRole of [null,2,3,5,8]){
  const m=createHouseMaterial(base,{parts:true,quality,facilityRole,foundation:.7}),s=shaderFor(m),code=s.fragmentShader;
  assert.equal(s.uniforms.houseFoundation.value,.7);
  for(const text of ['hOpFloor=houseFoundation*vHouseScale.y','hOpValid*step(hOp.w,hpp.y)','hOp.w+hOp.z,min(houseRoofBand.x,vHouseWallHeight.y)*vHouseScale.y-.10','houseInteriorFill+=hRecess*.85*hOpeningWeight','houseWoodRatio(hPhoto.z','hPhotoUV/2.000','hPhoto.z=mix(1.0,hPhoto.z,.4)','hThatchEdge','detail+=hBlend*roof*strawDetail'])assert(code.includes(text),text);
  assert(code.includes('if(vHouseRandom.x>.80 && vHouseNorth>.5)'));
  assert(code.includes('house_lime,house_oldLime,vHouseRandom.x*.3)*mix(1.0,.65,hBlend)'));
  assert(code.includes('hPhoto.z=mix(hPhoto.z,1.0,smoothstep(40.0,120.0,length(vViewPosition)))'));
  // All opening work remains gated by the preexisting switches and distance fade.
  assert(code.includes('hOpMask*hBlend*houseOpenings*hOpeningFade'));
  assert(code.includes('eave=mix(eave,hThatchEdge,hBlend)'));
  m.dispose();
 }}finally{base.dispose();}
});
test('F8 old thatch needs both an old house and north face, below 20% of a deterministic population',t=>{
 let old=0,total=0;
 for(let id=0;id<10000;id++)for(const north of [0,.25,.5,.75,1]){total++;if(houseIndexSeed(id)[0]>.8&&north>.5)old++;}
 assert(old/total<.2);assert(old>0);t.diagnostic(`synthetic old-thatch fraction=${old/total}`);
});
test('F6/FX1 private kits produce bounded structural floors above skirts; material wiring preserves geometry and collision in A/B', {skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定：私有の家GLBが必要'},async()=>{
 const dir=process.env.KZ_WORLD_DIR;
 const [catalog,bin,kit]=await Promise.all(['houses.json','houses_f32.bin','houses_kit.glb'].map(f=>fs.readFile(path.join(dir,f))));
 const houses=decodeHouses(JSON.parse(catalog),bin.buffer.slice(bin.byteOffset,bin.byteOffset+bin.byteLength)),doc=parseGlb(kit);
 for(const kind of houses.kinds.values()){
  if(!houses.catalog.count_by_kind[kind.node])continue;
  const node=doc.json.nodes.find(n=>n.name.replace(/\.\d+$/,'')===kind.node),p=doc.json.meshes[node.mesh].primitives.flatMap(p=>Array.from(readAccessor(doc,p.attributes.POSITION).array));
  const normals=doc.json.meshes[node.mesh].primitives.flatMap(p=>Array.from(readAccessor(doc,p.attributes.NORMAL).array));
  const b=houseBounds(kind),eave=b.max[1]-(b.max[1]-b.min[1])*.28,floor=houseFoundationTop(p,eave,normals);
  const ledges=p.filter((y,i)=>i%3===1&&normals[i]>.99&&y>b.min[1]+1e-4&&y<eave);
  if(ledges.length){
   const detected=Math.min(...ledges),ceiling=Math.min(.9,.30*eave);
   const expected=detected>ceiling?.5:detected;
   assert(Math.abs(floor-Math.max(.2,Math.min(ceiling,expected)))<1e-4);
  }
  assert(floor>=.2&&floor<=.9);assert(floor/eave<.35);
  assert(floor>b.min[1]);assert(floor<=eave);
 }
 const {buildKamakuraHouses}=await loadHouseView(),fields=[],scenes=[];
 try{for(const search of ['', '?photo=0']){
  const scene=new THREE.Scene();scenes.push(scene);
  fields.push(await buildKamakuraHouses({...houses,kit:kit.buffer.slice(kit.byteOffset,kit.byteOffset+kit.byteLength)},{heightAt:()=>0},scene,{search:search+'&house2=0'}));
 }
 assert.equal(JSON.stringify(fields[0].boxes),JSON.stringify(fields[1].boxes));
 }finally{fields.forEach(f=>f.dispose());}
});
test('F6/F8 local wall heights and each sloped roof edge use actual faces, including lower annex',async()=>{
 const {houseWallSpans,houseRoofSpans}=await import('../dist/valley/kamakura-house-texture.js');
 const wall=new Float32Array([-4,.6,2,4,.6,2,4,3,2,-4,.6,2,4,3,2,-4,3,2]);
 const heights=houseWallSpans(wall,null,true);
 for(let i=0;i<6;i++){assert(Math.abs(heights[i*2]-.6)<1e-6);assert.equal(heights[i*2+1],3);}
 const roof=new Float32Array([-3,2,-4,-3,2,4,0,4,-4, -3,2,4,0,4,4,0,4,-4,
   5,1,-2,5,1,2,6,2,-2]);
 const bands=houseRoofSpans(roof);
 for(let i=0;i<6;i++){assert.equal(bands[i*2],2);assert.equal(bands[i*2+1],4);}
 for(let i=6;i<9;i++){assert.equal(bands[i*2],1);assert.equal(bands[i*2+1],2);}
 for(let c=-4;c<4;c++){
  // FX3 allows windows that fit a low annex; a raised wall still rejects doors below it.
  const o=houseOpeningFit(c,3,.37,1,-12,12,.6,3.2,1.2,2);
  if(o){assert(o.bottom>=1.2);assert(o.bottom+o.height<=1.9);assert.equal(o.type,'window');}
 }
});
test('F6 actual emitted GLSL validity agrees with pure placement under nonuniform instance scaling',async()=>{
 const {houseOpeningCell}=await import('../dist/valley/kamakura-house-texture.js');
 const {createHouseMaterial}=await loadHouseMaterials(),base=new THREE.MeshStandardMaterial(),m=createHouseMaterial(base,{parts:true});
 try{
  const code=shaderFor(m).fragmentShader;
  const fitBlock=code.slice(code.indexOf('float hOpFloor='),code.indexOf('vec2 hOpUV='));
  const raw=fitBlock.replace(/float hOpValid=/,'return ');
  const expression=raw.replace(/\bfloat (\w+)=/g,'let $1=').replace(/\bfloat\(/g,'Number(').replace(/\bfloor\(/g,'Math.floor(').replace(/\bmax\(/g,'Math.max(').replace(/\bmin\(/g,'Math.min(');
  const valid=new Function('hFace','vHouseRandom','houseFoundation','vHouseWallHeight','vHouseScale','hOp','houseRoofBand','step','mix','clamp',expression);
  for(const scale of [.6,1,2.8])for(const floor of [.25,.9])for(const eave of [2,3,4])for(let kind=0;kind<14;kind++)for(let face=0;face<4;face++)for(let c=-5;c<6;c++){
   const seed=.37,wallBottom=.3,wallTop=3.5,cell=houseOpeningCell(c,kind,seed,face,-12,12);
   if(!cell)continue;
   const op={w:cell.bottom,z:cell.height};
   const accepted=valid(face,{z:seed},floor/scale,{x:wallBottom/scale,y:wallTop/scale},{y:scale},op,{x:eave/scale},(a,b)=>b>=a?1:0,(a,b,t)=>a*(1-t)+b*t,(x,a,b)=>Math.min(b,Math.max(a,x)));
   const fit=houseOpeningFit(c,kind,seed,face,-12,12,floor,eave,wallBottom,wallTop);
   assert.equal(!!accepted,!!fit);
   if(fit){assert(Math.abs(fit.height-op.z)<1e-10);assert(Math.abs(fit.bottom-op.w)<1e-10);}
  }
 }finally{m.dispose();base.dispose();}
});
