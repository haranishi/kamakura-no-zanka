import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as W from '../dist/valley/kamakura-house-texture.js';
import {THREE,loadHouseMaterials} from './helpers/kamakura-house-view.mjs';
const shaderFor=m=>{const s={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};m.onBeforeCompile(s);return s;};
function balanced(source){
 const code=source.replace(/\/\/[^\n]*/g,''),stack=[],pair={')':'(',']':'[','}':'{'};let pp=0;
 for(const c of code){if('([{'.includes(c))stack.push(c);if(')]}'.includes(c))assert.equal(stack.pop(),pair[c]);}assert.equal(stack.length,0);
 for(const line of code.split('\n')){if(/^\s*#if(?:def|ndef)?\b/.test(line))pp++;if(/^\s*#endif\b/.test(line))assert(--pp>=0);}assert.equal(pp,0);
 assert(!/\b(?:float|vec[234]|bool|int)\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(code));
 assert(!/--\s*\d|(?:^|[^\w.])\d+(?:\.\d*)?[A-Za-z_]\w*\(/.test(code));
}
function withoutHall(source){return source.replace(/#ifdef HOUSE_HALL7\n[\s\S]*?#endif/g,'').replace(/\/\/[^\n]*/g,'').replace(/\s+/g,'');}
const hash=s=>createHash('sha256').update(s).digest('hex');
test('HL1 metre frames follow vertex extents and facing, exclude slender timber and nonwall roles',()=>{
 const p=[-4,0,2,4,0,2,4,5,2,-4,5,2, 4,0,2,4,0,5,4,5,5,4,5,2];
 const n=[0,0,1,0,0,1,0,0,1,0,0,1, 1,0,0,1,0,0,1,0,0,1,0,0],timber=new Float32Array(8);
 const a=W.houseHallWallFrames(p,n,timber,0,5,2);
 assert(Math.abs(a[0]-.4)<1e-6);assert(Math.abs(a[1]-3.2)<1e-6);assert.equal(a[2],8);assert.equal(a[18],3);
 const q=p.map((v,i)=>i%3===1?v+9:v),b=W.houseHallWallFrames(q,n,timber,9,14,2);
 for(let i=0;i<8;i++){assert(Math.abs(b[i*4]-a[i*4]-9)<1e-6);for(let j=1;j<4;j++)assert.equal(b[i*4+j],a[i*4+j]);}
 timber.fill(1);assert(W.houseHallWallFrames(p,n,timber,0,5,2).every(v=>v===0));
 for(const role of [0,3,4,5,6,7,8])assert(W.houseHallWallFrames(p,n,new Float32Array(8),0,5,role).every(v=>v===0));
});
test('HL1 one-wall transmission has visible spatial contrast and mean loss including grey-brown tint below 16%',t=>{
 let maximumMean=0;const walls=[];
 for(const height of [.5,1,2,3,5,9])for(const span of [2,8,16])for(const seed of [.07,.43,.82]){
  let sum=0,sumSq=0;const nx=320,ny=240;
  for(let ix=0;ix<nx;ix++)for(let iy=0;iy<ny;iy++){
   const c=W.houseHallWeather((ix+.5)*span/nx-span/2,(iy+.5)*height/ny,height,span,seed,.025,1);
   assert(c.every(v=>v>=.42&&v<=1));assert(c[0]>=c[1]&&c[1]>=c[2]);
   const loss=1-(.2126*c[0]+.7152*c[1]+.0722*c[2]);sum+=loss;sumSq+=loss*loss;
  }
  const mean=sum/(nx*ny),sd=Math.sqrt(sumSq/(nx*ny)-mean*mean);maximumMean=Math.max(maximumMean,mean);
  assert(mean<=.16,`synthetic mean loss ${mean}`);
  if(height===3&&span===8){assert(sd>.075,`one wall contrast ${sd}`);walls.push({mean,sd});}
 }
 // Same seed derives only from world origin and facing, independent of enumeration.
 const origins=[[12,34,1,0],[12,34,0,1],[-12,34,1,0]];
 assert.deepEqual(origins.map(v=>W.houseWeatherSeed(...v)),origins.toReversed().map(v=>W.houseWeatherSeed(...v)).reverse());
 assert.equal(new Set(origins.map(v=>W.houseWeatherSeed(...v))).size,3);
 t.diagnostic(JSON.stringify({maximumSyntheticMeanLoss:maximumMean,oneFace8x3: walls,baselineAddedLayerSD:0}));
});
test('HL1 role gates, photo/quality controls, emitted GLSL and disabled baseline formulas',async()=>{
 const {createHouseMaterial}=await loadHouseMaterials();
 for(const role of [null,0,1,2,3,4,5,6,7,8])for(const color of [0xaaaaaa,0x111111,0xff0000])for(const search of ['', '?hall7=0','?facility7=0','?hphoto=0','?photo=0']){
  const base=new THREE.MeshStandardMaterial({color});
  for(const quality of ['standard','light']){
   const m=createHouseMaterial(base,{parts:true,facilityRole:role,quality,search});
   try{
    const s=shaderFor(m);balanced(s.vertexShader);balanced(s.fragmentShader);
    const eligible=[1,2].includes(role)&&!W.facilityPreservesPigment([base.color.r,base.color.g,base.color.b],role)&&!W.facilityInterior([base.color.r,base.color.g,base.color.b],role)&&!search.includes('hall7=0')&&!search.includes('facility7=0');
    assert.equal(m.defines.HOUSE_HALL7,eligible?1:undefined);
    if(search.includes('photo=0'))assert.equal(s.uniforms.housePhoto.value,0);
    const key=m.customProgramCacheKey(),version=m.version;
    m.userData.setHouseAdapt(2);assert.equal(s.uniforms.houseWeatherQuality.value,(quality==='light'?.45:1)*.4);
    m.userData.setHouseAdapt(3);assert.equal(s.uniforms.houseWeatherQuality.value,0);
    assert.equal(m.version,version);assert.equal(m.customProgramCacheKey(),key);
    assert(s.fragmentShader.indexOf('float hWeatherPixelX=max(fwidth')<s.fragmentShader.indexOf('if (houseFade > 0.0)'));
    assert(!/dFdx|dFdy|fwidth|texture2D/.test(s.fragmentShader.match(/#ifdef HOUSE_HALL7\n \/\/ W2c-13[\s\S]*?#endif/)[0]));
    // Hashes are from the pre-R7 HEAD, comments/space removed. Guards remove only new code.
    if(role===2&&color===0xaaaaaa&&quality==='standard'&&search==='?hall7=0'){
     assert.equal(hash(withoutHall(s.vertexShader)),BASE_VERTEX);
     assert.equal(hash(withoutHall(s.fragmentShader)),BASE_FRAGMENT);
    }
   }finally{m.dispose();}
  }
  base.dispose();
 }
});
const BASE_VERTEX='46bdee52bdc6b0b924beb2a8763ba321879d26b6deaffffff1b38e35e574da78',BASE_FRAGMENT='f11f093d33d19143d91a5c1da07a9d39e71f0e0d90308a37dd961bd8a6939a3f';
test('HL1 private facilities retain geometry/colliders, use finite actual wall frames and dispose once', {skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定：私有施設が必要'},async()=>{
 const fs=await import('node:fs/promises'),path=await import('node:path');
 const {loadFacilityView}=await import('./helpers/kamakura-facility-view.mjs'),{buildKamakuraFacilities}=await loadFacilityView();
 const bin=await fs.readFile(path.join(process.env.KZ_WORLD_DIR,'facilities.glb')),catalog=JSON.parse(await fs.readFile(path.join(process.env.KZ_WORLD_DIR,'facilities.json')));
 const data={nodes:catalog.nodes,kit:bin.buffer.slice(bin.byteOffset,bin.byteOffset+bin.byteLength)},fields=[];
 try{
  for(const search of ['','?hall7=0','?facility7=0'])fields.push(await buildKamakuraFacilities(data,{heightAt:()=>0},new THREE.Scene(),'standard',{search}));
  let walls=0,hallWall=false,otherWall=false;
  for(let k=1;k<fields.length;k++){
   assert.equal(fields[k].records.length,fields[0].records.length);assert.equal(fields[k].boxes.length,fields[0].boxes.length);
   for(let i=0;i<fields[0].boxes.length;i++)for(const key of Object.keys(fields[0].boxes[i]))assert.equal(fields[k].boxes[i][key],fields[0].boxes[i][key]);
   for(let i=0;i<fields[0].group.children.length;i++){
    const a=fields[0].group.children[i],b=fields[k].group.children[i];
    assert.equal(a.geometry.attributes.position.count,b.geometry.attributes.position.count);
    for(let j=0;j<a.geometry.attributes.position.array.length;j++)assert.equal(a.geometry.attributes.position.array[j],b.geometry.attributes.position.array[j]);
    assert.equal(b.geometry.attributes.houseHallWall,undefined);
    for(const m of [].concat(a.material))if(m.defines?.HOUSE_HALL7){
     const f=a.geometry.attributes.houseHallWall;assert(f);assert(f.array.every(Number.isFinite));
     let valid=0;for(let v=0;v<f.count;v++)if(f.getW(v)>0){assert(f.getY(v)>0&&f.getZ(v)>0);valid++;}
     if(valid>0){walls++;if(fields[0].records.find(r=>r.meshes.includes(a)).node.part==='hall')hallWall=true;else otherWall=true;}
     assert([1,2].includes(m.userData.houseUniforms.houseRole.value));assert.equal(m.userData.houseUniforms.houseInterior.value,0);
    }
   }
  }
  assert(walls>0);assert(hallWall);assert(otherWall);
  const geometries=new Set(),materials=new Set();
  for(const f of fields)for(const m of f.group.children){geometries.add(m.geometry);for(const x of [].concat(m.material))materials.add(x);}
  let gc=0,mc=0;for(const g of geometries)g.addEventListener('dispose',()=>gc++);for(const m of materials)m.addEventListener('dispose',()=>mc++);
  for(const f of fields){f.dispose();f.dispose();}assert.equal(gc,geometries.size);assert.equal(mc,materials.size);
 }finally{fields.forEach(f=>f.dispose());}
});
