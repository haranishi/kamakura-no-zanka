import test from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../dist/valley/kamakura-house-texture.js';
import {THREE,loadHouseMaterials} from './helpers/kamakura-house-view.mjs';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smoothstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const fract=x=>x-Math.floor(x),step=(a,x)=>x<a?0:1;
const shaderFor=m=>{const s={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};m.onBeforeCompile(s);return s;};
// Execute the emitted scalar GLSL itself, including its helper-to-helper calls.
const gpu={};
for(const match of W.HOUSE_FACILITY7_GLSL.matchAll(/float (house\w+)\(([^)]*)\)\{([\s\S]*?)\n\}/g)){
 const [,name,params,body]=match;
 gpu[name]=new Function('env',...params.split(',').map(p=>p.trim().split(' ').at(-1)),`with(env){${body.replace(/\bfloat\b/g,'let')}}`).bind(null,gpu);
}
Object.assign(gpu,{min:Math.min,max:Math.max,floor:Math.floor,fract,step,smoothstep,vec2:(...v)=>v,houseHash:v=>W.houseHash(...v)});
test('FH4/FH5 emitted GLSL scalar formulas match independent JS mirrors over metre samples',()=>{
 const names=['houseWeatherSeed','houseWeatherTrack','houseWeatherWidth','houseWeatherLength','houseWeatherLine','houseWeatherMud','houseWeatherEave','houseWeatherRun','houseWeatherBudget','houseWeatherDirt','houseInteriorMember','houseInteriorDepth','houseInteriorLift'];
 const args={houseWeatherSeed:[-12.7,43.1,-1,0],houseWeatherTrack:[-1.7,.43],houseWeatherWidth:[-1.7,.43],houseWeatherLength:[-1.7,.43],houseWeatherLine:[.03,0,.04,.01],houseWeatherMud:[-.31,.2,.43],houseWeatherEave:[2.7,3,.43],houseWeatherRun:[.3,1.2],houseWeatherBudget:[3,8],houseWeatherDirt:[.4,.2,.1,.5,.7,3,8],houseInteriorMember:[-.1,.02],houseInteriorDepth:[3,8],houseInteriorLift:[.6,.8,1]};
 for(const name of names)for(let i=0;i<100;i++){
  const a=args[name].map(v=>v*(.1+i*.03));
  assert(Math.abs(W[name](...a)-gpu[name](...a))<1e-10,name);
 }
});
test('FH4 tracks are world-origin/face hashes, stable under order and window changes, 2–6cm wide and .6–1.5m long',()=>{
 const seeds=[[1,0],[-1,0],[0,1],[0,-1]].map(([nx,nz])=>W.houseWeatherSeed(-321.4,51.3,nx,nz));
 assert.equal(new Set(seeds).size,4);
 const points=Array.from({length:40},(_,i)=>i*.8-16);
 for(const seed of seeds){
  const centres=points.map(x=>W.houseWeatherTrack(x,seed));
  assert.deepEqual(points.toReversed().map(x=>W.houseWeatherTrack(x,seed)).reverse(),centres);
  const gaps=centres.slice(1).map((v,i)=>v-centres[i]);assert(Math.max(...gaps)-Math.min(...gaps)>.4);
  for(const x of points){assert(W.houseWeatherWidth(x,seed)>=.02&&W.houseWeatherWidth(x,seed)<=.06);assert(W.houseWeatherLength(x,seed)>=.6&&W.houseWeatherLength(x,seed)<=1.5);}
 }
 assert.notEqual(W.houseWeatherTrack(.3,seeds[0]),W.houseWeatherTrack(.3,seeds[1]));
 assert(!/houseOpening|window|instanceColor/.test(W.HOUSE_FACILITY7_GLSL));
});
test('FH4 mud/eave/runoff ranges, direction and contact contrast; integrated wall loss including tint stays below 16%',t=>{
 let largestMean=0;
 for(const seed of [.07,.43,.82]){
  let previousMud=1,previousRun=1;
  for(let i=0;i<=150;i++){
   const y=i/100,mud=W.houseWeatherMud(.32,y,seed),run=W.houseWeatherRun(y,1.5);
   assert(mud>=0&&mud<=previousMud);assert(run>=0&&run<=previousRun);previousMud=mud;previousRun=run;
  }
  assert.equal(W.houseWeatherMud(.32,.9,seed),0);assert.equal(W.houseWeatherEave(1.6,3,seed),0);
  assert.equal(W.houseWeatherRun(-.001,1),0);assert.equal(W.houseWeatherRun(1.5,1.5),0);
  for(const height of [.5,1,2,3,5,9]){
   let total=0;
   const countX=320,countY=240;
   for(let ix=0;ix<countX;ix++)for(let iy=0;iy<countY;iy++){
    const x=(ix+.5)*8/countX-4,y=(iy+.5)*height/countY;
    const mud=W.houseWeatherMud(x,y,seed),eave=W.houseWeatherEave(y,height,seed);
    const line=W.houseWeatherLine(x,W.houseWeatherTrack(x,seed),W.houseWeatherWidth(x,seed),.025);
    // Worst-case sill: allowed at every horizontal position, not just actual windows.
    const runoff=line*Math.max(W.houseWeatherRun(height-y,W.houseWeatherLength(x,seed)),W.houseWeatherRun(height*.55-y,W.houseWeatherLength(x,seed)));
    const seam=W.houseWeatherLine(fract(x/.24)*.24,.12,.012,.025)*(1-smoothstep(.35,.55,y/height));
    const dirt=W.houseWeatherDirt(mud,eave,1-smoothstep(0,.04,y),runoff,seam,height,8);
    assert(dirt>=0&&dirt<=.5);
    const tint=.10*mud*W.houseWeatherBudget(height,8);
    total+=1-(1-dirt)*(1-tint);
   }
   const mean=total/(countX*countY);largestMean=Math.max(largestMean,mean);assert(mean<=.16,`height=${height}, loss=${mean}`);
  }
 }
 assert(Math.abs(W.houseWeatherDirt(1,0,0,0,0,4,8)-.45)<1e-12);
 assert.equal(W.houseWeatherDirt(0,1,0,0,0,4,8),.26);
 assert.equal(W.houseWeatherDirt(0,0,0,1,0,4,8),.22);
 t.diagnostic(JSON.stringify({largestSyntheticWallMeanLoss:largestMean,footLoss:.45,eaveLoss:.26,runoffLoss:.22}));
});
test('FH5 members have 1.2m period, .25m width, area-preserving minification and a brighter opening; lift never subtracts original fill',()=>{
 for(const x of [-3,-.8,.05,.3,1.6,10])for(const pixel of [.001,.02,.2,1.2,12]){
  const a=W.houseInteriorMember(x,pixel);assert(a>=-1e-10&&a<=1+1e-10);
  assert(Math.abs(a-W.houseInteriorMember(x+1.2,pixel))<1e-10);
  if(pixel>=1.2)assert(Math.abs(a-.25/1.2)<1e-10);
 }
 assert(W.houseInteriorMember(.1,.001)>.999);assert.equal(W.houseInteriorMember(.3,.001),0);
 let previous=1;
 for(let i=0;i<=100;i++){
  const near=W.houseInteriorDepth(i/10,10);assert(near<=previous);previous=near;
  for(const member of [0,.5,1])for(const upper of [0,.5,1]){
   const lift=W.houseInteriorLift(near,member,upper);assert(lift>=.0042-1e-12&&lift<=.032);
   assert(lift<=W.houseInteriorLift(1,member,upper));
  }
 }
 assert(W.houseInteriorLift(1,1,1)<W.houseInteriorLift(1,0,1));
});
test('FH5 opening frame follows inward U-room normals, rigid translation and rotation',()=>{
 // Back wall, two sides and ceiling, open towards +z. No new game geometry.
 const p=[-2,0,-3, 2,0,-3, 2,3,-3, -2,0,-3, 2,3,-3, -2,3,-3,
 -2,0,-3,-2,3,-3,-2,3,3, -2,0,-3,-2,3,3,-2,0,3,
 2,0,-3,2,3,3,2,3,-3, 2,0,-3,2,0,3,2,3,3];
 const frame=W.houseInteriorOpeningFrame([{positions:p}]);assert.deepEqual(frame,[0,1,3,6]);
 const q=p.map((v,i)=>i%3===0?v+15:i%3===2?v-7:v);
 const shifted=W.houseInteriorOpeningFrame([{positions:q}]);assert.deepEqual(shifted,[0,1,-4,6]);
 const rotated=p.map((v,i)=>i%3===0?-p[i+2]:i%3===2?p[i-2]:v);
 const r=W.houseInteriorOpeningFrame([{positions:rotated}]);assert.equal(r[0],-1);assert.equal(r[1],0);assert.equal(r[2],3);assert.equal(r[3],6);
});
function balanced(source){
 const code=source.replace(/\/\/[^\n]*/g,''),stack=[],pair={')':'(',']':'[','}':'{'};let pp=0;
 for(const c of code){if('([{'.includes(c))stack.push(c);if(')]}'.includes(c))assert.equal(stack.pop(),pair[c]);}assert.equal(stack.length,0);
 for(const line of code.split('\n')){if(/^\s*#if(?:def|ndef)?\b/.test(line))pp++;if(/^\s*#endif\b/.test(line))assert(--pp>=0);}assert.equal(pp,0);
 assert(!/\b(?:float|vec[234]|bool|int)\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(code));
 assert(!/--\s*\d|0mix\(/.test(code));
}
test('facility7 branches preserve existing gates, uncapped hall radiance and material-only quality adaptation',async()=>{
 const {createHouseMaterial}=await loadHouseMaterials(),base=new THREE.MeshStandardMaterial();
 try{for(const role of [null,2,4,5])for(const quality of ['standard','light'])for(const search of ['', '?facility7=0','?facility6=0','?hphoto=0','?hopen=0']){
  const m=createHouseMaterial(base,{parts:true,facilityRole:role,quality,search,interiorFrame:[0,1,3,6]});
  try{
   const s=shaderFor(m),u=s.uniforms;balanced(s.vertexShader);balanced(s.fragmentShader);
   assert.equal(m.defines.HOUSE_FACILITY7,search.includes('facility7=0')?undefined:1);
   assert.equal(u.houseWeatherQuality.value,quality==='light'?.45:1);
   assert(s.vertexShader.indexOf('vHouseWeatherSeed=')<s.vertexShader.indexOf('vHouseRandom = instanceColor'));
   assert(s.fragmentShader.includes('#if defined(HOUSE_FACILITY7) && !defined(HOUSE_FACILITY)'));
   assert(s.fragmentShader.includes('stain=mix(stain,0.0,hWeatherWeight)'));
   assert(s.fragmentShader.includes('houseInteriorFill=(recess*.65+vec3(.031))*houseRelief*houseFade'));
   assert(s.fragmentShader.includes('houseInteriorFill+=hLift*'));
   assert(s.fragmentShader.includes('#ifdef HOUSE_FACILITY\n      totalEmissiveRadiance+=houseInteriorFill;'));
   const derivative=s.fragmentShader.indexOf('vec3 hWeatherPixel=max(fwidth(hpp)');
   assert(derivative<s.fragmentShader.indexOf('if (houseFade > 0.0)'));
   const version=m.version,key=m.customProgramCacheKey();
   m.userData.setHouseAdapt(2);assert.equal(u.houseWeatherQuality.value,(quality==='light'?.45:1)*.4);
   m.userData.setHouseAdapt(3);assert.equal(u.houseWeatherQuality.value,0);
   m.userData.setHouseAdapt(0);assert.equal(u.houseWeatherQuality.value,quality==='light'?.45:1);
   assert.equal(m.version,version);assert.equal(m.customProgramCacheKey(),key);
  }finally{m.dispose();}
 }}finally{base.dispose();}
});
test('FH5 private facility path infers nondegenerate hall frames with identical geometry/colliders and disposal', {skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定：私有施設が必要'},async()=>{
 const fs=await import('node:fs/promises'),path=await import('node:path');
 const {loadFacilityView}=await import('./helpers/kamakura-facility-view.mjs');
 const {buildKamakuraFacilities}=await loadFacilityView(),dir=process.env.KZ_WORLD_DIR;
 const bin=await fs.readFile(path.join(dir,'facilities.glb')),catalog=JSON.parse(await fs.readFile(path.join(dir,'facilities.json')));
 const data={nodes:catalog.nodes,kit:bin.buffer.slice(bin.byteOffset,bin.byteOffset+bin.byteLength)},fields=[];
 try{
  for(const search of ['','?facility7=0'])fields.push(await buildKamakuraFacilities(data,{heightAt:()=>0},new THREE.Scene(),'standard',{search}));
  assert.equal(fields[0].records.length,fields[1].records.length);
  assert.equal(fields[0].boxes.length,fields[1].boxes.length);
  for(let i=0;i<fields[0].boxes.length;i++)for(const key of Object.keys(fields[0].boxes[i]))assert.equal(fields[0].boxes[i][key],fields[1].boxes[i][key]);
  let interiors=0;
  for(let i=0;i<fields[0].records.length;i++){
   const a=fields[0].records[i],b=fields[1].records[i];assert.equal(a.meshes.length,b.meshes.length);
   for(let j=0;j<a.meshes.length;j++){
    const x=a.meshes[j],y=b.meshes[j];
    assert.equal(x.geometry.attributes.position.count,y.geometry.attributes.position.count);
    // Compare scalar values, never pass a cyclic Three object to assert.deepEqual.
    assert.equal(x.geometry.attributes.position.array.length,y.geometry.attributes.position.array.length);
    for(let k=0;k<x.geometry.attributes.position.array.length;k++)assert.equal(x.geometry.attributes.position.array[k],y.geometry.attributes.position.array[k]);
    for(const m of [].concat(x.material))if(a.node.part!=='hall')assert.equal(m.userData.houseUniforms.houseInteriorFrame.value.w,0);
    for(const m of [].concat(x.material))if(a.node.part==='hall'&&m.userData.houseUniforms.houseInterior.value){
     const f=m.userData.houseUniforms.houseInteriorFrame.value;
     assert(Math.abs(Math.hypot(f.x,f.y)-1)<1e-6);assert(f.w>1);assert([f.x,f.y,f.z,f.w].every(Number.isFinite));interiors++;
    }
   }
  }
  assert(interiors>0);
  const geometries=new Set(),materials=new Set();
  for(const field of fields)for(const mesh of field.group.children){geometries.add(mesh.geometry);for(const material of [].concat(mesh.material))materials.add(material);}
  let disposedGeometry=0,disposedMaterial=0;
  for(const g of geometries)g.addEventListener('dispose',()=>disposedGeometry++);
  for(const m of materials)m.addEventListener('dispose',()=>disposedMaterial++);
  for(const field of fields){field.dispose();field.dispose();}
  assert.equal(disposedGeometry,geometries.size);assert.equal(disposedMaterial,materials.size);
 }finally{fields.forEach(field=>field.dispose());}
});
