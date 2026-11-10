import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { HOUSE_FAR, houseFarShape, houseFarBrightness, houseFarRange, houseFarMask, houseFarVisible, houseFarDistance } from '../dist/valley/kamakura-house-far.js';
import { houseBodyBounds, houseMatrix, houseChunks, houseLOD } from '../dist/valley/kamakura-houses.js';
import { THREE, loadHouseView } from './helpers/kamakura-house-view.mjs';
import { buildGlb } from '../tools/lib/glb.mjs';
import { readPrivateData } from '../tools/lib/kamakura-validation.mjs';
import { readPrivateHouses } from '../tools/lib/kamakura-house-validation.mjs';
const body={min:[-2,-1,-4],max:[2,-1,4]};
// Synthetic box foundation, wall rim, eaves and z-aligned ridge.
const source=[-2,-1,-4,2,-1,-4,2,-1,4,-2,-1,4, -2,3,-4,2,3,-4,2,3,4,-2,3,4,
  -3,3,-5,3,3,-5,3,3,5,-3,3,5, 0,6,-5,0,6,5];
const roofIndices=[8,11,13,8,13,12,12,13,10,12,10,9];
const shape=(name='synthetic-house',positions=source,indices=roofIndices)=>houseFarShape(positions,houseBodyBounds(positions),name,[{positions,indices}]);
const near=(a,b,epsilon=1e-5)=>assert(Math.abs(a-b)<epsilon,`${a} != ${b}`);
function makeHouses(count=3) {
  const p=new Float32Array(source),idx=new Uint16Array(roofIndices),bin=Buffer.concat([Buffer.from(p.buffer),Buffer.from(idx.buffer)]);
  const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0,1]}],nodes:[{name:'synthetic-house',mesh:0},{name:'synthetic-wall',mesh:0}],
    buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:p.byteLength},{buffer:0,byteOffset:p.byteLength,byteLength:idx.byteLength}],
    accessors:[{bufferView:0,componentType:5126,count:p.length/3,type:'VEC3',min:[-3,-1,-5],max:[3,6,5]},
      {bufferView:1,componentType:5123,count:idx.length,type:'SCALAR'}],
    meshes:[{primitives:[{attributes:{POSITION:0},indices:1,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.21,.17,.13,1],roughnessFactor:.8}}]};
  const glb=buildGlb({json,bin}),instances=[];
  for(let i=0;i<count;i++)instances.push({id:i,kind:i%2,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,i*300,0,0,1]});
  return {catalog:{count_by_kind:{'synthetic-house':Math.ceil(count/2),'synthetic-wall':Math.floor(count/2)}},
    kinds:new Map([0,1].map(i=>[i,{index:i,node:i?'synthetic-wall':'synthetic-house',bbox_min:[-3,-5,-1],bbox_max:[3,5,6],triangles:4}])),
    instances,kit:glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength)};
}
async function field(options={},count=3) {
  const {buildKamakuraHouses}=await loadHouseView(),scene=new THREE.Scene(),houses=makeHouses(count),terrain={heightAt:(x,z)=>12+x*.02+z*.01};
  const view=await buildKamakuraHouses(houses,terrain,scene,options);
  return {view,scene,houses,terrain};
}
const farMesh=scene=>scene.getObjectByName('house-far');
async function complete(view,scene,pos) {
  view.update(pos);scene.onAfterRender();
  let n=0;
  for(;n<1000;n++){view.update(pos);if(farMesh(scene)?.geometry.boundingSphere)break;}
  assert(n<1000);return n+1;
}
function compile(material,kind='standard') {
  const lib=THREE.ShaderLib[kind],shader={uniforms:{},vertexShader:lib.vertexShader,fragmentShader:lib.fragmentShader};
  material.onBeforeCompile(shader);return shader;
}
function shaderSafety(shader) {
  for(const source of [shader.vertexShader,shader.fragmentShader]){
    const code=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
    const stack=[];
    for(const ch of code){if('({['.includes(ch))stack.push(ch);else if(')}]'.includes(ch))assert.equal(stack.pop(),'({['[')}]'.indexOf(ch)]);}
    assert.equal(stack.length,0);
    assert(!/--\s*\d|\b\d+(?:\.\d+)?(?:float|vec[234]|int)\b/.test(code));
    assert(!/\b(?:attribute|varying|uniform|float|int|vec[234])\s+(?:input|output|sample|filter|common|partition|active|namespace)\b/.test(code));
  }
}
test('GLB-derived extents, ridge direction, eaves, planar outward normals and 16/12 triangle budgets',()=>{
  for(const rotate of [false,true]){
    const p=rotate?source.map((v,i)=>i%3===0?source[i+2]:i%3===2?source[i-2]:v):source;
    // Reversing x/z reverses winding, so reverse each source triangle as well.
    const idx=rotate?roofIndices.map((v,i)=>roofIndices[i-i%3+(2-i%3)]):roofIndices;
    const s=shape('synthetic-house',p,idx);
    assert.equal(s.triangles,16);assert.equal(s.alongX,rotate);near(s.eave,3);near(s.top,6);
    const b=houseBodyBounds(p);assert(s.min[0]<b.min[0]&&s.max[0]>b.max[0]&&s.min[2]<b.min[2]&&s.max[2]>b.max[2]);
    for(let i=0;i<s.positions.length;i+=9){
      const n=[...s.normals.slice(i,i+3)];near(Math.hypot(...n),1);
      assert.deepEqual([...s.normals.slice(i+3,i+6)],n);assert.deepEqual([...s.normals.slice(i+6,i+9)],n);
      const a=s.positions.slice(i,i+3),b=s.positions.slice(i+3,i+6),c=s.positions.slice(i+6,i+9);
      const u=b.map((v,k)=>v-a[k]),v=c.map((v,k)=>v-a[k]);
      const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
      assert(cross.reduce((sum,v,k)=>sum+v*n[k],0)>0);
      // Every face points away from a point within the solid (roof gables included).
      assert(n.reduce((sum,v,k)=>sum+v*((a[k]+b[k]+c[k])/3-[0,1,0][k]),0)>0);
    }
    for(const axis of [0,2]){const values=[];for(let i=axis;i<s.positions.length;i+=3)values.push(s.positions[i]);near(Math.max(...values)-Math.min(...values),s.max[axis]-s.min[axis]);}
  }
  for(const name of ['synthetic-fence','synthetic-gate','synthetic-nagayamon']){const s=shape(name);assert(s.wall);assert.equal(s.triangles,12);}
  for(let id=0;id<100;id++){assert.equal(houseFarBrightness(id),houseFarBrightness(id));assert(Math.abs(houseFarBrightness(id)-1)<=.08);}
});
test('mask rewrites only on visibility revisions, hysteresis, altitude and quality limits',()=>{
  const chunks=[{level:0,distance:0},{level:1,distance:700},{level:2,distance:1200}],data=new Uint8Array(4),state={data,revision:-1};
  assert(houseFarMask(state,chunks,0,'standard',0));assert.deepEqual([...data],[0,0,255,0]);
  chunks[0].level=2;
  assert(!houseFarMask(state,chunks,0,'standard',0));assert.equal(data[0],0);
  assert(houseFarMask(state,chunks,1,'standard',0));assert.equal(data[0],255);
  assert(!houseFarMask(state,chunks,2,'standard',0));
  assert.equal(houseLOD(1000,1),1);assert.equal(houseLOD(1080,1),2);assert.equal(houseLOD(1000,2),2);assert.equal(houseLOD(919,2),1);
  for(const [quality,step,range] of [['standard',0,Infinity],['light',0,4000],['standard',3,2500],['light',3,2500]]){
    assert.equal(houseFarRange(quality,step),range);
    assert(houseFarVisible(2,range,quality,step));assert(!houseFarVisible(1,100,quality,step));
    if(Number.isFinite(range))assert(!houseFarVisible(2,range+.01,quality,step));
  }
  near(houseFarDistance({minY:0,maxY:10},{y:710},0),700);
});
test('one mesh, chunk ids, slope grounding, atomic handoff, unchanged mask and no stable-frame allocation',async t=>{
  const {view,scene,houses,terrain}=await field({search:'?debug=1'}),pos={x:-1500,y:100,z:0};
  assert(!farMesh(scene));view.update(pos);assert(!farMesh(scene),'prewarm does not construct far geometry');
  for(let i=0;i<100;i++)view.update(pos);assert(!farMesh(scene),'even repeated loading prewarm cannot open the presentation gate');
  const slices=await complete(view,scene,pos),mesh=farMesh(scene),g=mesh.geometry;
  assert(mesh.castShadow&&mesh.receiveShadow);assert.equal(g.groups.length,0);assert.equal(g.index,null);
  assert.equal(scene.children.filter(o=>o.name==='house-far').length,1);
  const chunks=houseChunks(houses),a=g.attributes;let at=0,triangles=0;
  for(let ci=0;ci<chunks.length;ci++)for(const item of chunks[ci].items){
    const template=shape(item.kind?'synthetic-wall':'synthetic-house'),matrix=houseMatrix(item,terrain,body);triangles+=template.triangles;
    for(let j=0;j<template.positions.length;j+=3){
      assert.equal(a.houseFarChunk.getX(at),ci);
      near(a.position.getY(at),matrix[13]+template.positions[j+1],.02);
      near(a.position.getX(at),matrix[12]+template.positions[j],.001);at++;
    }
  }
  assert.equal(g.attributes.position.count/3,triangles);
  const shader=compile(mesh.material),mask=shader.uniforms.houseFarMask.value;
  assert.equal(mask.image.data.length<=HOUSE_FAR.maskBytes,true);
  const version=mask.version;let writes=0;const original=THREE.BufferAttribute.prototype.setXYZ;
  THREE.BufferAttribute.prototype.setXYZ=function(...args){writes++;return original.apply(this,args);};
  const start=performance.now();try{for(let i=0;i<10000;i++)view.update(pos);}finally{THREE.BufferAttribute.prototype.setXYZ=original;}
  const stableCpuMs=performance.now()-start,stableUploads=mask.version-version;
  assert.equal(mask.version,version);assert.equal(writes,0);
  assert.deepEqual(globalThis.__kzHouseFar().chunks,{total:3,far:3,hidden:0});
  const nearPos={x:0,y:terrain.heightAt(0,0),z:0};
  for(let frame=0;frame<20;frame++){
    view.update(nearPos);
    for(let ci=0;ci<chunks.length;ci++){
      const groups=scene.children.filter(o=>o.name.startsWith('houses-'+chunks[ci].key+'-')&&o.visible);
      assert(!(mask.image.data[ci]&&groups.length),'no near/mid and far overlap in the same frame');
      // Shader collapse maps every vertex to one point, so hidden triangles have zero area.
      if(groups.length)assert.equal(mask.image.data[ci],0);
    }
  }
  const stats=globalThis.__kzHouseFar();assert(stats.ready);assert.equal(stats.draws,0);assert.equal(stats.facilities.shown,0);
  const resources=new Set([mesh.geometry,mesh.material,mesh.customDepthMaterial,mesh.customDistanceMaterial,mask]);
  const releases=new Map();for(const r of resources)r.addEventListener('dispose',()=>releases.set(r,(releases.get(r)??0)+1));
  view.dispose();view.dispose();assert.equal(scene.children.length,0);assert.equal(globalThis.__kzHouseFar,undefined);
  for(const r of resources)assert.equal(releases.get(r),1);
  t.diagnostic(JSON.stringify({syntheticHouses:houses.instances.length,triangles,draws:1,shadowDraws:1,maskBytes:mask.image.data.length,slices,stableUpdates:10000,attributeWrites:writes,maskUploads:stableUploads,stableCpuMs}));
});
test('deferred work is bounded, debug color is unlit, range reductions and flag-off retain old mesh counts',async()=>{
  for(const [search,quality,step] of [['?housefardebug=1','standard',0],['','light',0],['','standard',3],['?housefar=0','standard',0]]){
    const {view,scene}=await field({search,quality},80),pos={x:-6000,y:100,z:0};view.setAdapt(step);
    if(search.includes('housefar=0')){view.update(pos);scene.onAfterRender();view.update(pos);assert.equal(scene.children.length,0);view.dispose();continue;}
    view.update(pos);scene.onAfterRender();view.update(pos);
    assert(!farMesh(scene).geometry.boundingSphere,'more than one construction update');
    await complete(view,scene,pos);
    const mesh=farMesh(scene);
    if(search){assert(mesh.material.isMeshBasicMaterial);assert.equal(mesh.material.fog,false);assert.equal(mesh.material.toneMapped,false);
      const rgb=mesh.geometry.attributes.color;const purple=new THREE.Color(HOUSE_FAR.debugHouse),yellow=new THREE.Color(HOUSE_FAR.debugWall);
      assert([purple,yellow].every(c=>Array.from({length:rgb.count},(_,i)=>Math.abs(rgb.getX(i)-c.r)<1e-6&&Math.abs(rgb.getY(i)-c.g)<1e-6&&Math.abs(rgb.getZ(i)-c.b)<1e-6).some(Boolean)));
    }else{const mask=compile(mesh.material).uniforms.houseFarMask.value;assert.equal(mask.image.data[0],0);}
    view.dispose();
  }
});
test('generated standard/basic/depth/distance shaders preserve anchors, source colors and declarations',async()=>{
  for(const search of ['', '?housefardebug=1','?htex=0','?hparts=0']){
    const {view,scene}=await field({search}),pos={x:-1500,y:200,z:0};await complete(view,scene,pos);
    const mesh=farMesh(scene);
    for(const [material,kind] of [[mesh.material,mesh.material.isMeshBasicMaterial?'basic':'standard'],[mesh.customDepthMaterial,'depth'],[mesh.customDistanceMaterial,'distanceRGBA']]){
      for(const anchor of ['common','begin_vertex','project_vertex'])assert(THREE.ShaderLib[kind].vertexShader.includes('#include <'+anchor+'>'));
      const shader=compile(material,kind);shaderSafety(shader);
      assert(shader.vertexShader.includes('transformed*=step(0.5,houseFarOn)'));
      assert(shader.vertexShader.includes('uniform sampler2D houseFarMask;'));
      if(material===mesh.material&&!search.includes('debug')&&!search.includes('htex=0')){
        assert(shader.vertexShader.includes('vHouseObj=houseFarLocal'));
        assert(shader.vertexShader.includes('vHouseN=houseFarNormal'));
        assert(shader.fragmentShader.includes('#define houseKind vHouseFarFrame.x'));
        assert(shader.fragmentShader.includes('float brightness = vHouseFarBrightness;'));
        assert(shader.fragmentShader.includes('target=mix(target,mix(house_thatch,house_oldThatch'));
        assert(shader.uniforms.houseAtlas.value,'same atlas as mid, including texture mip means');
        assert(!shader.fragmentShader.includes('uniform vec2 houseRoofBand;'));
      }
    }
    view.dispose();
  }
});
test('private inputs: every instance receives a GLB-derived far shape within resource limits',
  {skip:!process.env.KZ_WORLD_DIR&&'private input not set'},async t=>{
    const {data}=await readPrivateData(process.env.KZ_WORLD_DIR),input=await readPrivateHouses(process.env.KZ_WORLD_DIR,data);
    if(!input){t.skip('legacy world without houses');return;}
    // Do not copy any private coordinates, catalog values or counts to fixtures or diagnostics.
    const {parseGlb,readAccessor}=await import('../tools/lib/glb.mjs');
    const {join}=await import('node:path');
    const doc=parseGlb(await fs.readFile(join(process.env.KZ_WORLD_DIR,'houses_kit.glb'))),shapes=new Map();
    for(const kind of input.houses.kinds.values())if(input.houses.catalog.count_by_kind[kind.node]){
      const node=doc.json.nodes.find(n=>n.name.replace(/\.\d+$/,'')===kind.node),surfaces=doc.json.meshes[node.mesh].primitives.map(p=>({positions:readAccessor(doc,p.attributes.POSITION).array,indices:p.indices===undefined?undefined:readAccessor(doc,p.indices).array}));
      const p=surfaces.flatMap(s=>Array.from(s.positions));shapes.set(kind.index,houseFarShape(p,input.bodies.get(kind.index),kind.node,surfaces));
    }
    let triangles=0,represented=0;
    for(const item of input.houses.instances){const s=shapes.get(item.kind);assert(s);triangles+=s.triangles;represented++;assert(s.positions.every(Number.isFinite));assert(s.triangles<=(s.wall?12:16));}
    assert.equal(represented,input.houses.instances.length);assert(triangles<=HOUSE_FAR.triangles);assert(houseChunks(input.houses).length<=HOUSE_FAR.maskBytes);
    const {createKamakuraTerrain}=await import('../dist/valley/kamakura-terrain.js'),terrain=createKamakuraTerrain(data);
    const {buildKamakuraHouses}=await loadHouseView(),scene=new THREE.Scene();
    const bytes=await fs.readFile(join(process.env.KZ_WORLD_DIR,'houses_kit.glb'));
    const houses={...input.houses,kit:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
    const view=await buildKamakuraHouses(houses,terrain,scene);
    try{
      const slices=await complete(view,scene,{x:terrain.bounds.maxX+10000,y:1000,z:terrain.bounds.maxZ+10000});
      const mesh=farMesh(scene);assert.equal(mesh.geometry.attributes.position.count/3,triangles);
      assert.equal(scene.children.filter(o=>o.name==='house-far').length,1);
      const mask=compile(mesh.material).uniforms.houseFarMask.value;assert(mask.image.data.byteLength<=HOUSE_FAR.maskBytes);
      t.diagnostic(JSON.stringify({coverage:represented/input.houses.instances.length,triangles,draws:1,shadowDraws:1,maskBytes:mask.image.data.byteLength,constructionUpdates:slices}));
    }finally{view.dispose();assert.equal(scene.children.length,0);}
  });

test('optional installed GLSL compiler rejects undeclared names and scalar type errors in all far shader paths',async t=>{
  const {spawnSync}=await import('node:child_process');
  const available=spawnSync('glslc',['--version'],{encoding:'utf8'});
  if(available.error?.code==='ENOENT'){t.skip('glslc not installed; static checks still run');return;}
  assert.equal(available.status,0);
  const {tmpdir}=await import('node:os'),{join}=await import('node:path'),dir=await fs.mkdtemp(join(tmpdir(),'housefar-glsl-'));
  const expand=s=>s.replace(/#include <(\w+)>/g,(_,k)=>{assert.equal(typeof THREE.ShaderChunk[k],'string');return expand(THREE.ShaderChunk[k]);});
  const prefix=stage=>`#version 310 es
    precision highp float;precision highp int;
    #define varying ${stage==='vert'?'out':'in'}
    #define attribute in
    #define texture2D texture
    #define textureCube texture
    #define texture2DGradEXT textureGrad
    #define texture2DLodEXT textureLod
    #define TEXTURE_LOD_EXT
    #define HIGH_PRECISION
    #define USE_COLOR
    #define OPAQUE
    uniform mat4 modelMatrix,modelViewMatrix,projectionMatrix,viewMatrix;
    uniform mat3 normalMatrix;uniform vec3 cameraPosition;uniform bool isOrthographic;
    ${stage==='vert'?'in vec3 position,normal,color;in vec2 uv;':'out vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\nvec4 linearToOutputTexel(vec4 v){return v;}'}
  `;
  let stages=0;
  try{
    for(const search of ['', '?housefardebug=1','?htex=0','?hparts=0']){
      const {view,scene}=await field({search});
      try{
        await complete(view,scene,{x:-1500,y:200,z:0});const mesh=farMesh(scene);
        for(const [material,kind] of [[mesh.material,mesh.material.isMeshBasicMaterial?'basic':'standard'],[mesh.customDepthMaterial,'depth'],[mesh.customDistanceMaterial,'distanceRGBA']]){
          const shader=compile(material,kind);
          for(const lit of [false,true])for(const [property,stage] of [['vertexShader','vert'],['fragmentShader','frag']]){
            const defines=Object.entries(material.defines??{}).map(([k,v])=>`#define ${k} ${v}`).join('\n');
            let code=prefix(stage)+defines+'\n'+(kind==='depth'?'#define DEPTH_PACKING '+material.depthPacking+'\n':'')+(lit?'#define USE_SHADOWMAP\n#define SHADOWMAP_TYPE_PCF_SOFT\n':'')+expand(shader[property]);
            // SPIR-V requires ES310; Three's ES300 helper conflicts with its new subgroup name.
            // This rename affects only the compiler input, never the shipped shader.
            code=code.replace(/\baverage\b/g,'threeAverage').replace(/\bNUM_\w+\b/g,n=>lit&&['NUM_DIR_LIGHTS','NUM_DIR_LIGHT_SHADOWS'].includes(n)?'1':'0');
            // Mirror Three's compile-time loop expansion, including sampler-array indices.
            code=code.replace(/#pragma unroll_loop_start\s+for \( int i = (\d+); i < (\d+); i \+\+ \) \{([\s\S]+?)\}\s+#pragma unroll_loop_end/g,(_,a,b,body)=>{
              let expanded='';for(let i=+a;i<+b;i++)expanded+=body.replace(/\[\s*i\s*\]/g,'[ '+i+' ]').replace(/UNROLLED_LOOP_INDEX/g,String(i));return expanded;
            });
            const file=join(dir,'shader.'+stage);await fs.writeFile(file,code);
            const result=spawnSync('glslc',['--target-env=opengl','-fauto-bind-uniforms','-fauto-map-locations','-fshader-stage='+stage,file,'-o',join(dir,'shader.spv')],{encoding:'utf8'});
            assert.equal(result.status,0,result.stderr);stages++;
          }
        }
      }finally{view.dispose();}
    }
    t.diagnostic(JSON.stringify({compiledShaderStages:stages}));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('all far GPU resources release once during construction, after presentation, and on invalid input',async()=>{
  const {buildKamakuraHouses}=await loadHouseView(),geometries=new Map(),materials=new Map();
  const set=THREE.BufferGeometry.prototype.setAttribute,values=THREE.Material.prototype.setValues;
  function track(map,r){if(!map.has(r)){map.set(r,0);r.addEventListener('dispose',()=>map.set(r,map.get(r)+1));}}
  THREE.BufferGeometry.prototype.setAttribute=function(...args){track(geometries,this);return set.apply(this,args);};
  THREE.Material.prototype.setValues=function(...args){if(this.isMeshStandardMaterial||this.isMeshBasicMaterial||this.isMeshDepthMaterial||this.isMeshDistanceMaterial)track(materials,this);return values.apply(this,args);};
  try{
    for(const mode of ['prewarm','partial','complete','failure']){
      geometries.clear();materials.clear();const houses=makeHouses(80),scene=new THREE.Scene(),callback=()=>{};scene.onAfterRender=callback;
      if(mode==='failure')houses.kinds.set(1,{...houses.kinds.get(1),node:'missing'});
      if(mode==='failure')await assert.rejects(buildKamakuraHouses(houses,{heightAt:()=>0},scene));
      else{
        const view=await buildKamakuraHouses(houses,{heightAt:()=>0},scene),pos={x:-6000,z:0,y:100};
        view.update(pos);
        if(mode==='complete')await complete(view,scene,pos);
        else if(mode==='partial'){scene.onAfterRender();view.update(pos);assert(!farMesh(scene).geometry.boundingSphere);}
        view.dispose();view.dispose();view.update(pos);
      }
      assert.equal(scene.onAfterRender,callback);assert.equal(scene.children.length,0);
      assert([...geometries.values()].every(n=>n===1),'geometry release '+mode);
      // GLTFLoader's temporary default BasicMaterial is CPU-only; its source PBR dependency is owned.
      assert([...materials].filter(([m])=>!m.isMeshBasicMaterial).every(([,n])=>n===1),'material release '+mode);
    }
  }finally{THREE.BufferGeometry.prototype.setAttribute=set;THREE.Material.prototype.setValues=values;}
});
