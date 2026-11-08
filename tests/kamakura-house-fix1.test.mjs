import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {houseFoundationTop,houseVariation,HOUSE_SURFACE} from '../dist/valley/kamakura-house-texture.js';
import {houseBounds} from '../dist/valley/kamakura-houses.js';
import {parseGlb,readAccessor} from '../tools/lib/glb.mjs';
import {THREE,loadHouseMaterials} from './helpers/kamakura-house-view.mjs';
const ring=(y,r)=>[-r,y,-r,r,y,-r,r,y,r,-r,y,r];
const shaderFor=m=>{const s={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};m.onBeforeCompile(s);return s;};

test('FX1 raised trapezoid, stepped roofs, curved shapes and invalid detections keep stone below walls',()=>{
 const cases=[
  {p:[...ring(-1.5,4),...ring(.6,3),...ring(3,4),0,5,0],e:3,want:.6},
  {p:[...ring(-1.5,4),...ring(2,3),...ring(3,4),...ring(5,2)],e:3,want:.5},
  {p:[...ring(-1.5,4),...ring(1.4,3),...ring(3,2)],e:3,want:.5},
  {p:Array.from({length:120},(_,i)=>[Math.cos(i)*3,-1.5+i*.05,Math.sin(i)*3]).flat(),e:3,want:.2},
  {p:ring(-1.5,4),e:3,want:.5},
  {p:[],e:3,want:.5}, {p:[0,NaN,0],e:3,want:.5},
  {p:[...ring(-1.5,3),...ring(2,2)],e:1.4,want:.42},
  {p:ring(.7,4),e:NaN,want:.5},
 ];
 for(const {p,e,want} of cases){
  const before=p.slice(),top=houseFoundationTop(p,e);
  assert(Math.abs(top-want)<1e-10);assert(top>=.2&&top<=.9);
  if(Number.isFinite(e))assert(top/e<.35);
  assert.deepEqual(p,before);
 }
 const p=[...ring(-1.5,4),...ring(.6,3),...ring(3,4)];
 // Upward roof ledges must not override a plausible foundation with all-wall stone.
 const n=p.map((_,i)=>i%3===1&&i>=24?1:0);
 assert.equal(houseFoundationTop(p,3,n),HOUSE_SURFACE.base);
});

test('FX1 every private catalog kind stays in 0.2--0.9m and below 35% wall height',
 {skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定：全種類の私有GLB検査を省略'},async t=>{
 const dir=process.env.KZ_WORLD_DIR;
 const catalog=JSON.parse(await fs.readFile(path.join(dir,'houses.json'))),doc=parseGlb(await fs.readFile(path.join(dir,'houses_kit.glb')));
 const rows=[];
 for(const k of catalog.kinds){
  const node=doc.json.nodes.find(n=>n.name.replace(/\.\d+$/,'')===k.node);
  assert(node&&Number.isInteger(node.mesh),`kind ${k.index}: missing mesh`);
  const primitives=doc.json.meshes[node.mesh].primitives;
  const positions=primitives.flatMap(p=>Array.from(readAccessor(doc,p.attributes.POSITION).array));
  const normals=primitives.flatMap(p=>Array.from(readAccessor(doc,p.attributes.NORMAL).array));
  const b=houseBounds(k),wallHeight=b.max[1]-(b.max[1]-b.min[1])*.28;
  const foundation=houseFoundationTop(positions,wallHeight,normals);
  assert(foundation>=.2&&foundation<=.9,`kind ${k.index}: foundation outside bounds`);
  assert(foundation/wallHeight<.35,`kind ${k.index}: foundation covers wall`);
  rows.push({kind:k.index,wallHeight:+wallHeight.toFixed(6),foundation:+foundation.toFixed(6)});
 }
 assert.equal(rows.length,catalog.kinds.length);
 t.diagnostic(JSON.stringify({foundationByKind:rows,range:[Math.min(...rows.map(r=>r.foundation)),Math.max(...rows.map(r=>r.foundation))]}));
});

test('FX1 stone expression cannot reach above its foundation or below the datum; FX2 uses one shifted soil-plaster read',async()=>{
 const {createHouseMaterial}=await loadHouseMaterials(),base=new THREE.MeshStandardMaterial();
 try{for(const quality of ['standard','light']){
  const m=createHouseMaterial(base,{parts:true,facilityRole:2,quality}),s=shaderFor(m),code=s.fragmentShader;
  try{
   const formula=code.match(/if\(hBlend>0\.0\)stone=([^;]+);/)[1];
   assert.equal(formula,'step(0.0,vHouseObj.y)*step(vHouseObj.y,houseFoundation)');
   const stone=new Function('y','foundation','step',`return ${formula.replaceAll('vHouseObj.y','y').replaceAll('houseFoundation','foundation')};`);
   for(const f of [.2,.5,.9])for(const y of [-2,-.01,0,.1,.5,.9,1,3,8])assert.equal(stone(y,f,(a,b)=>b>=a?1:0),Number(y>=0&&y<=f));
   assert(!code.includes('hPhoto_wallPlasterWorn'));assert(!('hPhoto_wallPlasterWorn' in s.uniforms));
   const hall=code.slice(code.indexOf('// W2c-10b FIX1 FX2:'),code.indexOf('// W2c-10 F4:'));
   assert.equal((hall.match(/kzPhotoGrad\(/g)||[]).length,1);assert(!hall.includes('kzPhotoHex'));
   assert(hall.includes('hPhotoUV/2.000,hPhotoDx/2.000,hPhotoDy/2.000'));
   assert(!/\b(dFdx|dFdy|fwidth)\(/.test(hall));
   assert(code.indexOf('vec2 hPhotoDx=dFdx(hPhotoUV)')<code.indexOf('if(hBlend>0.0)'));
   assert(code.includes('hPhotoUV+=vHouseRandom.yz*17.0'));
   const offsets=Array.from({length:30},(_,i)=>houseVariation(i*2.31,i*7.21).offset.join(','));
   assert.equal(new Set(offsets).size,offsets.length);
   assert(code.includes('house_lime,house_oldLime,vHouseRandom.x*.3)*mix(1.0,.65,hBlend)'));
   // Check the emitted contrast expression, with a known mean-one distribution.
   const weight=Number(hall.match(/hPhoto.z=mix\(1.0,hPhoto.z,([.\d]+)\)/)[1]);
   assert.equal(weight,.4);
   const ratios=[.6,.8,1,1.2,1.4].map(r=>1+(r-1)*weight);
   const mean=ratios.reduce((a,b)=>a+b,0)/ratios.length,sd=Math.sqrt(ratios.reduce((a,b)=>a+(b-mean)**2,0)/ratios.length);
   assert(Math.abs(mean-1)<1e-12);assert(sd>=.05&&sd<=.15);
  }finally{m.dispose();}
 }}finally{base.dispose();}
});
