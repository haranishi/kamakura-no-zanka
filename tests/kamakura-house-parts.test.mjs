import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { houseIndexSeed, facilityPartRole, HOUSE_SURFACE } from '../dist/valley/kamakura-house-texture.js';
import { FACILITY_PARTS } from '../dist/valley/kamakura-facilities.js';
import { THREE, loadHouseMaterials, loadHouseView } from './helpers/kamakura-house-view.mjs';
import { loadFacilityView } from './helpers/kamakura-facility-view.mjs';
import { buildGlb } from '../tools/lib/glb.mjs';

// Synthetic base ring and roof; no private geography or per-type fixtures.
function kit(names) {
  const positions=new Float32Array([-1,0,-1,1,0,-1,1,0,1,-1,0,1,0,4,0,1,3,1]);
  const bin=Buffer.from(positions.buffer),json={asset:{version:'2.0'},scene:0,scenes:[{nodes:names.map((_,i)=>i)}],
    nodes:names.map(name=>({name,mesh:0})),buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteLength:bin.length}],
    accessors:[{bufferView:0,componentType:5126,count:6,type:'VEC3',min:[-1,0,-1],max:[1,4,1]}],
    meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.8,.8,.8,1]}}]};
  const glb=buildGlb({json,bin});return glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength);
}
function houses() {
  return {kit:kit(['synthetic']),catalog:{count_by_kind:{synthetic:3}},
    kinds:new Map([[0,{index:0,node:'synthetic',bbox_min:[-1,-1,0],bbox_max:[1,1,4],triangles:2}]]),
    instances:[0,1,2].map(id=>({id,kind:0,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,20+id*2,0,20,1]}))};
}
const collect=scene=>{const result=[];scene.traverse(o=>{if(o.isInstancedMesh)result.push(o);});return result;};
function balanced(source) {
  const code=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
  const stack=[],pairs={')':'(',']':'[','}':'{'};
  for(const c of code){if('([{'.includes(c))stack.push(c);else if(')]}'.includes(c))assert.equal(stack.pop(),pairs[c]);}
  assert.equal(stack.length,0);
  const directives=[];
  for(const line of code.split('\n')){
    if(/^\s*#\s*if(?:def|ndef)?\b/.test(line))directives.push(false);
    else if(/^\s*#\s*(else|elif)\b/.test(line)){assert(directives.length);assert(!directives.at(-1));if(/^\s*#\s*else\b/.test(line))directives[directives.length-1]=true;}
    else if(/^\s*#\s*endif\b/.test(line))assert.notEqual(directives.pop(),undefined);
  }
  assert.equal(directives.length,0);
  const reserved='patch|sample|input|output|filter|common|active|partition|resource';
  assert(!new RegExp(`\\b(?:float|vec[234]|int|bool|void)\\s+(?:${reserved})\\b`).test(code));
}
test('R1 index hash gives bounded, nonzero color/age variance independent of placement',t=>{
  let sum=0,squared=0,min=Infinity,max=-Infinity;
  for(let id=0;id<10000;id++){
    const seed=houseIndexSeed(id);assert.deepEqual(seed,houseIndexSeed(id));assert(seed.every(v=>v>=0&&v<1));
    const brightness=1+(seed[0]*2-1)*HOUSE_SURFACE.brightness;
    assert(brightness>=.88&&brightness<=1.12);assert(Math.abs((seed[1]*2-1)*HOUSE_SURFACE.hue)<=HOUSE_SURFACE.hue);
    sum+=brightness;squared+=brightness*brightness;min=Math.min(min,brightness);max=Math.max(max,brightness);
  }
  const variance=squared/10000-(sum/10000)**2;assert(variance>.004&&variance<.006);
  t.diagnostic(JSON.stringify({brightnessMin:min,brightnessMax:max,brightnessVariance:variance,hueDegrees:HOUSE_SURFACE.hue*180/Math.PI}));
});
test('R1 instanced seed stream survives near/mid rebuilds; hparts and htex switches restore legacy',async()=>{
  const {buildKamakuraHouses}=await loadHouseView(),terrain={heightAt:()=>3},scenes=[new THREE.Scene(),new THREE.Scene(),new THREE.Scene()];
  const fields=await Promise.all(scenes.map((s,i)=>buildKamakuraHouses(houses(),terrain,s,{search:['','?hparts=0','?htex=0'][i]})));
  try {
    for(const pos of [{x:20,z:20},{x:-600,z:20},{x:20,z:20}]){
      for(let j=0;j<12;j++)fields.forEach(f=>f.update(pos));
      const meshes=scenes.map(collect);
      assert.deepEqual(fields[0].boxes,fields[1].boxes);assert.deepEqual(fields[0].boxes,fields[2].boxes);
      for(let j=0;j<meshes[0].length;j++){
        const m=meshes[0][j];assert.equal(m.material.defines.HOUSE_PARTS,1);
        for(let id=0;id<3;id++)for(let c=0;c<3;c++)assert.equal(m.instanceColor.array[id*3+c],Math.fround(houseIndexSeed(id)[c]));
        for(let i=1;i<3;i++){
          assert.equal(meshes[i][j].instanceColor,null);
          assert.deepEqual(m.instanceMatrix.array,meshes[i][j].instanceMatrix.array);
          assert.deepEqual(m.geometry.attributes.position.array,meshes[i][j].geometry.attributes.position.array);
        }
      }
    }
    const seeds=collect(scenes[0])[0].instanceColor.array;
    for(let i=0;i<20;i++)fields[0].update({x:20,z:20});
    assert.equal(collect(scenes[0])[0].instanceColor.array,seeds);
  }finally{fields.forEach(f=>{f.dispose();f.dispose();});}
});
test('R1 all facility classifications receive explicit roles, bounds, and reversible materials',async()=>{
  const nodes=FACILITY_PARTS.map((part,i)=>({part,node:`anonymous-${i}`,soft:['fence','kairo','causeway','stairs','jetty','sando','platform'].includes(part),triangles:2,anchor_xz:[i*10,0],rel_anchor:0}));
  const {buildKamakuraFacilities}=await loadFacilityView(),data={nodes,kit:kit(nodes.map(n=>n.node))},fields=[];
  try {
    for(const search of ['','?hparts=0'])fields.push(await buildKamakuraFacilities(data,{heightAt:()=>0},new THREE.Scene(),'standard',{search,showHeldBack:true}));
    for(let i=0;i<nodes.length;i++){
      const m=fields[0].records[i].meshes[0],old=fields[1].records[i].meshes[0],u=m.material.userData.houseUniforms;
      assert(u.houseRole.value>0);assert.equal(u.houseRole.value,facilityPartRole(nodes[i].part));
      assert.equal(old.material.userData.houseUniforms.houseRole.value,0);
      assert.equal(m.material.defines.HOUSE_PARTS,1);assert.equal(old.material.defines.HOUSE_PARTS,undefined);
      assert.equal(u.houseRoofBand.value.y,4);assert.equal(u.houseRoofBand.value.x,2.88);
      assert.deepEqual(m.geometry.attributes.position.array,old.geometry.attributes.position.array);
      assert.deepEqual(m.matrix.elements,old.matrix.elements);
    }
    assert.equal(facilityPartRole('buddha'),6);assert.equal(facilityPartRole('torii'),7);
    assert.equal(facilityPartRole('hall','pillar'),5);assert.equal(facilityPartRole('hall','roof'),4);
    assert.equal(facilityPartRole('unknown'),2);
  }finally{fields.forEach(f=>f.dispose());}
});
test('R1 atlas preparation yields; smaller final-size samplers adapt and all resources dispose exactly once',async t=>{
  const {createHouseTextures,createHouseMaterial}=await loadHouseMaterials(true);
  let turns=0;const timer=setInterval(()=>turns++,0),start=performance.now();
  const standard=await createHouseTextures({parts:true}),light=await createHouseTextures({parts:true,quality:'light'});
  clearInterval(timer);assert(turns>0);
  assert.equal(standard.image.width,512);assert.equal(light.image.width,128);assert.equal(standard.userData.houseSmall.image.width,128);
  const resources=[standard,standard.userData.houseSmall,light],calls=resources.map(()=>0);
  resources.forEach((r,i)=>r.addEventListener('dispose',()=>calls[i]++));
  const base=new THREE.MeshStandardMaterial(),material=createHouseMaterial(base,{texture:standard,parts:true});
  const u=material.userData.houseUniforms,key=material.customProgramCacheKey(),version=material.version;
  material.userData.setHouseAdapt(2);assert.equal(u.houseAtlas.value,standard.userData.houseSmall);assert.equal(u.houseBump.value,0);
  material.userData.setHouseAdapt(3);assert.equal(u.houseStrength.value,0);assert.equal(u.houseDetail.value,0);
  material.userData.setHouseAdapt(0);assert.equal(u.houseAtlas.value,standard);assert.equal(material.version,version);assert.equal(material.customProgramCacheKey(),key);
  standard.dispose();light.dispose();material.dispose();base.dispose();assert.deepEqual(calls,[1,1,1]);
  t.diagnostic(JSON.stringify({preparationMs:performance.now()-start,eventLoopTurns:turns,standardPixels:512*512,smallPixels:128*128,ownedTextureDisposals:calls}));
});
test('R1 all emitted shaders balance, avoid reserved declarations, preserve PBR/fog hooks and seed color independence',async()=>{
  const {createHouseMaterial}=await loadHouseMaterials(),base=new THREE.MeshStandardMaterial();
  for(const quality of ['standard','light'])for(const parts of [true,false])for(const facilityRole of [null,1,2,3,4,5,6,7]){
    const material=createHouseMaterial(base,{quality,parts,facilityRole});
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
    material.onBeforeCompile(shader);balanced(shader.vertexShader);balanced(shader.fragmentShader);
    if(parts){assert(!shader.vertexShader.includes('vColor.xyz *= instanceColor.xyz'));assert(shader.vertexShader.includes('vHouseRandom = instanceColor'));
      assert(shader.fragmentShader.includes('patina=clamp'));assert(shader.fragmentShader.includes('verticalFrame'));}
    assert(shader.fragmentShader.includes('#include <fog_fragment>'));assert(shader.fragmentShader.includes('#include <lights_fragment_begin>'));material.dispose();
  }
  base.dispose();
  for(const bad of ['{(})','#else','#if A\n#else\n#elif B\n#endif','float sample=0.0;'])assert.throws(()=>balanced(bad));
});
test('R1 private facilities have zero missing role assignments, including all held-back parts', {skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定：私有の施設GLBが必要'},async t=>{
  const dir=process.env.KZ_WORLD_DIR,catalog=JSON.parse(await fs.readFile(path.join(dir,'facilities.json'),'utf8')),bin=await fs.readFile(path.join(dir,'facilities.glb'));
  const {buildKamakuraFacilities}=await loadFacilityView(),kit=bin.buffer.slice(bin.byteOffset,bin.byteOffset+bin.byteLength);
  const field=await buildKamakuraFacilities({nodes:catalog.nodes,kit},{heightAt:()=>0},new THREE.Scene(),'standard',{showHeldBack:true});
  try{
    let missing=0;
    for(const r of field.records)for(const mesh of r.meshes)for(const material of [].concat(mesh.material)){
      if(!material.userData.houseUniforms || material.userData.houseUniforms.houseRole.value<=0)missing++;
    }
    assert.equal(missing,0);assert.equal(field.records.length,catalog.nodes.length);
    t.diagnostic(JSON.stringify({allPrivatePartsCovered:true,missingRoles:missing}));
  }finally{field.dispose();field.dispose();}
});
