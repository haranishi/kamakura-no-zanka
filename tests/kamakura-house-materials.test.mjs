import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HOUSE_SURFACE, houseSurface, houseVariation, houseAmplitude, houseTextureData, houseRoleColor, houseBroad, facilityMaterialRole } from '../dist/valley/kamakura-house-texture.js';
import { THREE, loadHouseMaterials, loadHouseView } from './helpers/kamakura-house-view.mjs';
import { buildGlb, parseGlb, readAccessor } from '../tools/lib/glb.mjs';
import { houseBounds } from '../dist/valley/kamakura-houses.js';

test('house surfaces: datum takes priority; slope threshold covers simplified roof; distance fades monotonically', () => {
  for (const [ny,y,role] of [[1,-2,'stone'],[0,.5,'stone'],[0,.51,'wall'],[.34,3,'wall'],[.35,3,'roof'],[.7,4,'roof'],[-1,4,'wall']]) assert.equal(houseSurface(ny,y),role);
  assert.equal(houseAmplitude(0),1); assert.equal(houseAmplitude(80),1); assert.equal(houseAmplitude(250),0); assert.equal(houseAmplitude(1000),0);
  let last=1; for(let d=0;d<400;d++){const a=houseAmplitude(d); assert(a<=last && a>=0); last=a;}
});
test('house instances: deterministic world hash, bounded brightness/hue/offset and approximately 65/35 walls', () => {
  let wood=0;
  for(let i=0;i<10000;i++) {
    const v=houseVariation(i*.71-300, i*1.37+100);
    assert.deepEqual(v,houseVariation(i*.71-300,i*1.37+100));
    assert(v.brightness>=.90 && v.brightness<=1.10); assert(Math.abs(v.hue)<=HOUSE_SURFACE.hue);
    assert(v.offset.every(x=>x>=0 && x<17)); if(v.wall==='wood') wood++;
  }
  assert(wood/10000>.62 && wood/10000<.68); assert.notDeepEqual(houseVariation(1,2),houseVariation(2,1));
});
test('packed texture: deterministic seeds, centered channels, continuous borders and full mip budget', t => {
  const a=houseTextureData(), b=houseTextureData(); assert.deepEqual(a,b); assert.notDeepEqual(houseTextureData(32,1),houseTextureData(32,2));
  const means=[0,0,0,0], size=512;
  for(let i=0;i<a.length;i++)means[i%4]+=a[i]/255/(size*size);
  for(const mean of means)assert(Math.abs(mean-.5)<.006);
  for(let i=0;i<size;i++)for(let c=0;c<4;c++){
    assert.equal(a[(i*size)*4+c],a[(i*size+size-1)*4+c]);
    assert.equal(a[i*4+c],a[((size-1)*size+i)*4+c]);
  }
  let mipBytes=0;for(let n=size;n>=1;n/=2)mipBytes+=n*n*4;
  assert(mipBytes<4*1024*1024); t.diagnostic(JSON.stringify({textures:1,baseBytes:a.byteLength,mipBytes,means}));
});
test('shipped PBR hooks preserve fog/previous hook, use no UV/color, change only uniforms, and release once', async () => {
  const {createHouseTextures,createHouseMaterial}=await loadHouseMaterials();
  const texture=await createHouseTextures(), base=new THREE.MeshStandardMaterial({color:0x6b5842,roughness:.87,metalness:.1});
  base.onBeforeCompile=s=>{s.fragmentShader+='\n// prior hook';};
  const original={...THREE.ShaderChunk};
  const {load}=await import('./helpers/tree-modules.mjs'); const {installFog}=await load('atmosphere.js'); installFog();
  try {
    for(const quality of ['standard','light']) {
      const m=createHouseMaterial(base,{texture,quality}), u=m.userData.houseUniforms;
      assert(m.color.equals(base.color));assert.equal(m.roughness,base.roughness);assert.equal(m.metalness,base.metalness);
      const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
      m.onBeforeCompile(shader);
      assert(shader.fragmentShader.includes('// prior hook'));
      assert(shader.fragmentShader.includes('#include <fog_fragment>'));assert(shader.vertexShader.includes('#include <fog_vertex>'));
      assert(THREE.ShaderChunk.fog_fragment.includes('vFogWorldY'));
      assert(shader.vertexShader.includes('vHouseObj'));assert(shader.vertexShader.includes('instanceMatrix[3]'));
      assert(shader.fragmentShader.includes(`smoothstep(${HOUSE_SURFACE.near.toFixed(1)},${HOUSE_SURFACE.far.toFixed(1)}`));
      assert(!shader.fragmentShader.includes('vUv')); // Bundled standard shader uses includes for its own optional UVs.
      const version=m.version,key=m.customProgramCacheKey();
      m.userData.setHouseAdapt(2);assert.equal(u.houseBump.value,0);assert(u.houseStrength.value>0);
      m.userData.setHouseAdapt(3);assert.equal(u.houseStrength.value,0);
      m.userData.setHouseAdapt(0);assert.equal(u.houseBump.value,1);assert.equal(u.houseStrength.value,quality==='light'?.7:1);
      assert.equal(u.houseDirt.value,quality==='light'?0:1);assert.equal(m.version,version);assert.equal(m.customProgramCacheKey(),key);
      assert.equal(m.defines.HOUSE_LIGHT,quality==='light'?1:undefined);m.dispose();
    }
  } finally {Object.assign(THREE.ShaderChunk,original);texture.dispose();base.dispose();}
});
function synthetic() {
  const positions=new Float32Array([-1,-1.5,-1,1,-1.5,-1,1,-1.5,1,-1,-1.5,1,0,3,0,1,2,1]);
  const bin=Buffer.from(positions.buffer),json={asset:{version:'2.0'},scenes:[{nodes:[0]}],scene:0,nodes:[{name:'synthetic',mesh:0}],buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteLength:bin.length}],accessors:[{bufferView:0,componentType:5126,count:6,type:'VEC3',min:[-1,-1.5,-1],max:[1,3,1]}],meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.2,.3,.1,1]}}]};
  const glb=buildGlb({json,bin}),kind={index:0,node:'synthetic',bbox_min:[-1,-1,-1.5],bbox_max:[1,1,3],triangles:2};
  return {catalog:{count_by_kind:{synthetic:3}},kinds:new Map([[0,kind]]),instances:[0,1,2].map(i=>({id:i,kind:0,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,20+i*2,999,20,1]})),kit:glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength)};
}
const meshes=scene=>{const a=[];scene.traverse(o=>{if(o.isInstancedMesh)a.push(o);});return a;};
const snapshot=scene=>meshes(scene).map(o=>({count:o.count,matrix:Array.from(o.instanceMatrix.array),position:Array.from(o.geometry.attributes.position.array),normal:o.geometry.attributes.normal && Array.from(o.geometry.attributes.normal.array),visible:o.parent.visible}));
test('A/B real instancing: identical geometry/matrices/boxes/LOD; shared material, idempotent resource disposal', async t => {
  const {buildKamakuraHouses}=await loadHouseView(), scenes=[new THREE.Scene(),new THREE.Scene()], terrain={heightAt:()=>7};
  const fields=await Promise.all(scenes.map((s,i)=>buildKamakuraHouses(synthetic(),terrain,s,{search:i?'?htex=0':''})));
  assert.deepEqual(fields[0].boxes,fields[1].boxes);
  const resources=new Set();
  for(const pos of [{x:20,z:20},{x:-600,z:20},{x:20,z:20}]) {
    for(let j=0;j<12;j++)for(let i=0;i<2;i++)fields[i].update(pos);
    assert.deepEqual(snapshot(scenes[0]),snapshot(scenes[1]));assert.equal(fields[0].ready(pos),fields[1].ready(pos));
    const mats=new Set(meshes(scenes[0]).map(o=>o.material));assert.equal(mats.size,1);
    for(const m of mats){resources.add(m);resources.add(m.userData.houseUniforms.houseAtlas.value);}
    if(pos.x<0){
      const roof=meshes(scenes[0])[1].geometry, p=roof.attributes.position,n=roof.attributes.normal;
      assert(Array.from({length:p.count},(_,j)=>houseSurface(n.getY(j),p.getY(j))).includes('roof'));
    }
  }
  const calls=new Map();for(const r of resources)r.addEventListener('dispose',()=>calls.set(r,(calls.get(r)||0)+1));
  const m=meshes(scenes[0])[0].material,u=m.userData.houseUniforms,version=m.version;
  fields[0].setAdapt(2);assert.equal(u.houseBump.value,0);fields[0].setAdapt(3);assert.equal(u.houseStrength.value,0);assert.equal(m.version,version);
  for(const f of fields){f.dispose();f.dispose();}
  for(const f of fields)f.update({x:20,z:20});
  assert([...resources].every(r=>calls.get(r)===1));assert(scenes.every(s=>!s.children.length));
  t.diagnostic(JSON.stringify({syntheticSharedMaterials:1,textures:1,disposedResources:calls.size}));
});
test('private kit: all used types have roof/wall/base without UV/color; no names or per-type counts emitted', {skip:!process.env.KZ_WORLD_DIR && 'KZ_WORLD_DIR未設定：私有GLBが必要'}, async t => {
  const dir=process.env.KZ_WORLD_DIR;
  const catalog=JSON.parse(await fs.readFile(path.join(dir,'houses.json'),'utf8'));
  const doc=parseGlb(await fs.readFile(path.join(dir,'houses_kit.glb')));
  const {houseNodeName}=await import('../dist/valley/kamakura-houses.js');
  let used=0, uv=0, color=0;
  for(const kind of catalog.kinds){
    if(!catalog.count_by_kind[kind.node])continue;used++;
    const node=doc.json.nodes.find(n=>houseNodeName(n.name)===kind.node),roles=new Set();
    for(const primitive of doc.json.meshes[node.mesh].primitives){
      const p=readAccessor(doc,primitive.attributes.POSITION).array,n=readAccessor(doc,primitive.attributes.NORMAL).array;
      if(primitive.attributes.TEXCOORD_0!==undefined)uv++;if(primitive.attributes.COLOR_0!==undefined)color++;
      for(let j=0;j<p.length;j+=3)roles.add(houseSurface(n[j+1],p[j+1]));
    }
    assert.deepEqual([...roles].sort(),['roof','stone','wall']);
    const bounds=houseBounds(kind);assert(bounds.max[1]>HOUSE_SURFACE.base);
  }
  t.diagnostic(JSON.stringify({allUsedTypesCovered:used>0,uvPresent:uv>0,vertexColorsPresent:color>0}));
});
test('private A/B: complete catalog shares per-type PBR, unchanged instances/colliders and single disposal including unused source materials', {skip:!process.env.KZ_WORLD_DIR && 'KZ_WORLD_DIR未設定：私有GLBと配置が必要'}, async t => {
  const dir=process.env.KZ_WORLD_DIR, {decodeHouses}=await import('../dist/valley/kamakura-houses.js');
  const [catalog,bin,glb]=await Promise.all(['houses.json','houses_f32.bin','houses_kit.glb'].map(f=>fs.readFile(path.join(dir,f))));
  const make=()=>({...decodeHouses(JSON.parse(catalog),bin.buffer.slice(bin.byteOffset,bin.byteOffset+bin.byteLength)),kit:glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength)});
  const scenes=[new THREE.Scene(),new THREE.Scene()], fields=[],terrain={heightAt:()=>3};
  const {buildKamakuraHouses}=await loadHouseView();
  const materialCalls=new Map(),textureCalls=new Map(),md=THREE.Material.prototype.dispose,td=THREE.Texture.prototype.dispose;
  THREE.Material.prototype.dispose=function(){materialCalls.set(this,(materialCalls.get(this)||0)+1);md.call(this);};
  THREE.Texture.prototype.dispose=function(){textureCalls.set(this,(textureCalls.get(this)||0)+1);td.call(this);};
  try {
    const houses=make();
    fields.push(await buildKamakuraHouses(houses,terrain,scenes[0]));
    fields.push(await buildKamakuraHouses(make(),terrain,scenes[1],{search:'?htex=0'}));
    assert.deepEqual(fields[0].boxes,fields[1].boxes);
    const activeMaterials=new Set(),texturedByType=new Map();
    for(const kind of houses.kinds.keys()){
      const item=houses.instances.find(i=>i.kind===kind);if(!item)continue;
      const pos={x:item.matrix[12],z:item.matrix[14]};
      for(let j=0;j<200;j++){fields[0].update(pos);fields[1].update(pos);}
      // Existing LOD hysteresis can retain mid in the 315–350m band after travel. Compare the same readiness contract.
      assert.equal(fields[0].ready(pos),fields[1].ready(pos));assert.deepEqual(snapshot(scenes[0]),snapshot(scenes[1]));
      for(const mesh of meshes(scenes[0])){
        activeMaterials.add(mesh.material);assert(mesh.material.userData.houseUniforms);
        const key=mesh.geometry; if(texturedByType.has(key))assert.equal(mesh.material,texturedByType.get(key)); else texturedByType.set(key,mesh.material);
      }
    }
    const resources=[...activeMaterials].map(m=>m.userData.houseUniforms.houseAtlas.value);
    assert.equal(new Set(resources).size,1);
    const sourceCount=parseGlb(glb).json.materials.length;
    // Current kit's one source color per placed type is shared by all its instances and LODs.
    const placedTypes=new Set(houses.instances.map(i=>i.kind)).size;
    assert.equal(activeMaterials.size,placedTypes);
    for(const f of fields){f.dispose();f.dispose();}
    assert([...materialCalls.values()].every(n=>n===1));assert([...textureCalls.values()].every(n=>n===1));assert.equal(textureCalls.size,1);
    assert.equal(materialCalls.size,sourceCount*2+placedTypes);
    t.diagnostic(JSON.stringify({activeTexturedMaterials:activeMaterials.size,loadedSourceMaterialsPerBuild:sourceCount,textureDisposals:textureCalls.size,allMaterialDisposalsOnce:true}));
  } finally {for(const f of fields)f.dispose();THREE.Material.prototype.dispose=md;THREE.Texture.prototype.dispose=td;}
});
test('partial setup failure disposes all sources, clones and atlas once', async () => {
  const {buildKamakuraHouses}=await loadHouseView(), houses=synthetic(), scene=new THREE.Scene();
  houses.kinds.set(1,{...houses.kinds.get(0),index:1,node:'missing'});houses.catalog.count_by_kind.missing=1;
  const materialCalls=new Map(),textureCalls=new Map(),md=THREE.Material.prototype.dispose,td=THREE.Texture.prototype.dispose;
  THREE.Material.prototype.dispose=function(){materialCalls.set(this,(materialCalls.get(this)||0)+1);md.call(this);};
  THREE.Texture.prototype.dispose=function(){textureCalls.set(this,(textureCalls.get(this)||0)+1);td.call(this);};
  try {
    await assert.rejects(buildKamakuraHouses(houses,{heightAt:()=>0},scene));
    assert.equal(materialCalls.size,2);assert([...materialCalls.values()].every(n=>n===1));
    assert.equal(textureCalls.size,1);assert([...textureCalls.values()].every(n=>n===1));assert.equal(scene.children.length,0);
  } finally {THREE.Material.prototype.dispose=md;THREE.Texture.prototype.dispose=td;}
});
// CIE76 on linear RGB, D65. This measures the shared palette equation, not screenshots.
function lab(c) {
  const xyz=[.4124564*c[0]+.3575761*c[1]+.1804375*c[2],.2126729*c[0]+.7151522*c[1]+.072175*c[2],.0193339*c[0]+.119192*c[1]+.9503041*c[2]];
  const f=xyz.map((v,i)=>{const t=v/[.95047,1,1.08883][i];return t>216/24389?Math.cbrt(t):t*841/108+4/29;});
  return [116*f[1]-16,500*(f[0]-f[1]),200*(f[1]-f[2])];
}
test('9g2: role DeltaE >= 8, metre-scale patch amplitude >= 15%, fine fade stays full through 80m', async t=>{
  let minimum=Infinity,low=1,high=-1;
  for(let i=0;i<=20;i++)for(const base of [[.05,.03,.01],[.3,.2,.1],[.8,.8,.8]]) {
    const colors=['roof','wood','plaster','stone'].map(role=>lab(houseRoleColor(base,role,i/20,.9)));
    for(let a=0;a<colors.length;a++)for(let b=a+1;b<colors.length;b++)minimum=Math.min(minimum,Math.hypot(...colors[a].map((v,j)=>v-colors[b][j])));
  }
  assert(minimum>=8);
  for(let i=0;i<20000;i++){const v=houseBroad(i*.013,i*.007,i*.021);low=Math.min(low,v);high=Math.max(high,v);assert(Math.abs(v)<=.2);}
  assert(low<-.15 && high>.15);assert.equal(houseAmplitude(40),1);assert(houseAmplitude(100)>.95);assert.equal(houseAmplitude(250),0);
  const {createHouseMaterial}=await loadHouseMaterials(),base=new THREE.MeshStandardMaterial(),m=createHouseMaterial(base);
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};m.onBeforeCompile(shader);
  assert(shader.fragmentShader.includes('float houseFade = houseStrength;'));
  assert(shader.fragmentShader.includes('brightness*(1.0+broad-stain+.10*ridge)'));
  assert(shader.fragmentShader.includes('dFdx(hp)'));assert(shader.fragmentShader.includes('(surface-.5)*1.15'));
  assert.equal((shader.fragmentShader.match(/texture2D\(houseAtlas/g)||[]).length,3); // houseTri called twice standard, once light.
  for(const [name,role] of [['roof tile',4],['pillar',5],['board',1],['stone',3],['unknown',2]])assert.equal(facilityMaterialRole(name),role);
  m.dispose();base.dispose();t.diagnostic(JSON.stringify({minimumDeltaE:minimum,broadRange:[low,high],at40m:houseAmplitude(40),at100m:houseAmplitude(100)}));
});
