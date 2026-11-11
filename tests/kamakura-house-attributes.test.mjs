import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { THREE,loadHouseView,loadHouseMaterials } from './helpers/kamakura-house-view.mjs';
import { HOUSE2,HOUSE_DETAIL,house2SourceMeans,house2ToneMeans,house2SurfaceColor,buildHouse } from '../dist/valley/kamakura-house-build.js';
import { syntheticHouse } from '../tools/preview-mesh.mjs';
import { buildGlb } from '../tools/lib/glb.mjs';
import { decodeHouses } from '../dist/valley/kamakura-houses.js';

// Use the shipped WebGLProgram itself, including its conditional uv1/uv2/uv3/tangent declarations.
// GL only captures shaderSource: this is not a browser/GPU validation test.
async function programCapture(){
  let source=await fs.readFile(new URL('../dist/vendor/three.module.min.js',import.meta.url),'utf8');
  const at=source.indexOf('attribute vec3 position;'),name=source.slice(0,at).match(/function (\w+)\(e,t,n,r\)\{const i=e.getContext\(\),o=n.defines[^]*$/)?.[1];
  assert(name,'shipped WebGLProgram entry found');
  source=source.replace(/from"\.\/three.core.min.js"/g,`from"${new URL('../dist/vendor/three.core.min.js',import.meta.url).href}"`);
  return (await import('data:text/javascript;base64,'+Buffer.from(source+`\nexport {${name} as captureProgram};`).toString('base64'))).captureProgram;
}
function vertexFor(capture,mesh,material,{fog=true,shadow=true}={}){
  const kind=material.isMeshDepthMaterial?'depth':material.isMeshDistanceMaterial?'distanceRGBA':material.isMeshBasicMaterial?'basic':'standard';
  const lib=THREE.ShaderLib[kind],shader={uniforms:{},vertexShader:lib.vertexShader,fragmentShader:lib.fragmentShader};material.onBeforeCompile(shader);
  const attributes=mesh.geometry.attributes;
  const parameters={...shader,defines:{...material.defines,...(kind==='depth'?{DEPTH_PACKING:material.depthPacking}:{})},
    outputColorSpace:THREE.SRGBColorSpace,toneMapping:THREE.NoToneMapping,shaderType:material.type,shaderName:material.name,precision:'highp',isRawShaderMaterial:false,glslVersion:null,
    instancing:mesh.isInstancedMesh,instancingColor:!!mesh.instanceColor,vertexColors:material.vertexColors&&!!attributes.color,
    vertexAlphas:material.vertexColors&&attributes.color?.itemSize===4,
    vertexUv1s:!!attributes.uv1,vertexUv2s:!!attributes.uv2,vertexUv3s:!!attributes.uv3,
    vertexTangents:!!attributes.tangent&&(!!material.normalMap||material.anisotropy>0),flatShading:material.flatShading,
    normalMap:!!material.normalMap,normalMapTangentSpace:!!material.normalMap,normalMapUv:material.normalMap?'uv1':null,
    useFog:fog,fog:material.fog,fogExp2:true,shadowMapEnabled:shadow,shadowMapType:THREE.PCFSoftShadowMap,envMapCubeUVHeight:null,
    numDirLights:shadow?1:0,numDirLightShadows:shadow?1:0,numPointLights:0,numSpotLights:0,numSpotLightShadows:0,numSpotLightMaps:0,numSpotLightShadowsWithMaps:0,numRectAreaLights:0,numHemiLights:0,numPointLightShadows:0,numLightProbes:0,numClippingPlanes:0,numClipIntersection:0};
  const stop={},gl={createProgram:()=>({}),createShader:()=>({}),shaderSource:(_,code)=>{stop.code=code;throw stop;}};
  try{new capture({getContext:()=>gl},'',parameters,{});assert.fail('shader capture did not run');}catch(error){if(error!==stop)throw error;}
  return stop.code.replace('#version 300 es','#version 310 es').replace(/\baverage\b/g,'threeAverage');
}
// SPIR-V input variables after optimisation: mat4 consumes four attribute locations.
function locations(bytes){
  const words=new Uint32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const types=new Map(),pointers=new Map(),inputs=new Map(),located=new Set();
  for(let i=5;i<words.length;){const size=words[i]>>>16,op=words[i]&65535,a=words.slice(i+1,i+size);assert(size>0);
    if(op===24)types.set(a[0],a[2]); // OpTypeMatrix: column count
    if(op===32)pointers.set(a[0],a[2]);
    if(op===59&&a[2]===1)inputs.set(a[1],a[0]);
    if(op===71&&a[1]===30)located.add(a[0]);
    i+=size;
  }
  let total=0;for(const [id,type] of inputs)if(located.has(id))total+=types.get(pointers.get(type))??1;
  return total;
}
const compilerAvailable=spawnSync('glslc',['--version']).status===0;
// Keep the attribute gate available in dependency-free CI; validate this preprocessor against
// glslc when the optional compiler is installed. Only conditional directives affect inputs.
function activeSource(source){
  const macros=new Map([['GL_ES','1'],['__VERSION__','310']]),stack=[];let active=true;const out=[];
  const condition=expression=>{
    let code=expression.replace(/defined\s*(?:\(\s*(\w+)\s*\)|(\w+))/g,(_,a,b)=>macros.has(a??b)?'1':'0');
    for(let i=0;i<12&&/\b[A-Za-z_]\w*\b/.test(code);i++)code=code.replace(/\b[A-Za-z_]\w*\b/g,name=>macros.get(name)||'0');
    assert(/^[\d\s().!<>=&|+*/%~^-]+$/.test(code),code);return !!new Function(`return (${code});`)();
  };
  for(const line of source.replace(/\\\r?\n/g,'').replace(/\/\*[^]*?\*\//g,'').replace(/\/\/[^\n]*/g,'').split('\n')){
    const directive=line.match(/^\s*#\s*(\w+)\s*(.*)$/);if(!directive){if(active)out.push(line);continue;}
    const [,op,arg]=directive;
    if(['if','ifdef','ifndef'].includes(op)){
      const enabled=active&&(op==='if'?condition(arg):op==='ifdef'?macros.has(arg.trim()):!macros.has(arg.trim()));
      stack.push({parent:active,seen:enabled});active=enabled;
    }else if(op==='elif'){const top=stack.at(-1);assert(top);active=top.parent&&!top.seen&&condition(arg);top.seen||=active;
    }else if(op==='else'){const top=stack.at(-1);assert(top);active=top.parent&&!top.seen;top.seen=true;
    }else if(op==='endif'){const top=stack.pop();assert(top);active=top.parent;
    }else if(active&&op==='define'){const m=arg.match(/^(\w+)(?:\s+(.*))?$/);if(m)macros.set(m[1],m[2]||'1');
    }else if(active&&op==='undef')macros.delete(arg.trim());
  }
  assert.equal(stack.length,0);return out.join('\n');
}
function attributeCounts(source){
  let count=0;const names=new Set();
  for(const m of source.matchAll(/\b(?:attribute|in)\s+(float|vec[234]|mat[234])\s+(\w+(?:\s*,\s*\w+)*)\s*;/g))for(const name of m[2].split(/\s*,\s*/)){
    assert(!names.has(name),'duplicate attribute '+name);names.add(name);count+=m[1].startsWith('mat')?+m[1].at(-1):1;
  }
  return {count,names};
}
async function audit(capture,mesh,material,dir,cache=new Map()){
  const code=vertexFor(capture,mesh,material);if(cache.has(code))return cache.get(code);
  const file=path.join(dir,'shader.vert'),out=path.join(dir,'shader.spv');await fs.writeFile(file,code);
  const args=['--target-env=opengl','-fauto-bind-uniforms','-fauto-map-locations','-fshader-stage=vert'];
  const {count:declared,names}=attributeCounts(activeSource(code));
  assert(names.has('instanceMatrix'));assert(names.has('position'));
  assert(declared<=16,`${mesh.name}/${material.type}/${material.name}: ${declared} declared: ${[...names]}`);
  let active=null;
  if(compilerAvailable){
    const pre=spawnSync('glslc',[...args,'-E',file],{encoding:'utf8'});assert.equal(pre.status,0,pre.stderr);
    const official=attributeCounts(pre.stdout);assert.equal(declared,official.count);assert.deepEqual(names,official.names);
    const result=spawnSync('glslc',[...args,'-O',file,'-o',out],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
    active=locations(await fs.readFile(out));assert(active>0);assert(active<=declared);
  }
  const resultCounts={active,declared,names:[...names]};cache.set(code,resultCounts);return resultCounts;
}
function syntheticInput(){
  const positions=new Float32Array([-4,-.8,-3,4,-.8,-3,4,-.8,3,-4,-.8,3,-4,.3,-3,4,.3,-3,4,.3,3,-4,.3,3,-4,3,-3,4,3,-3,4,3,3,-4,3,3,-5,3,-4,5,3,-4,5,3,4,-5,3,4,-5,5,0,5,5,0]);
  const indices=new Uint16Array([12,13,17,12,17,16,16,17,14,16,14,15]);
  const bin=Buffer.concat([Buffer.from(positions.buffer),Buffer.from(indices.buffer)]);
  const families=['townhouse','cottage','storehouse','mansion','boathouse'];
  const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:families.map((_,i)=>i)}],nodes:families.map((name,i)=>({name,mesh:i})),
    buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteLength:positions.byteLength},{buffer:0,byteOffset:positions.byteLength,byteLength:indices.byteLength}],
    accessors:[{bufferView:0,componentType:5126,count:positions.length/3,type:'VEC3',min:[-5,-.8,-4],max:[5,5,4]},{bufferView:1,componentType:5123,count:indices.length,type:'SCALAR'}],
    meshes:families.map((_,i)=>({primitives:[{attributes:{POSITION:0},indices:1,material:i}]})),materials:families.map((_,i)=>({name:'synthetic-'+i,pbrMetallicRoughness:{baseColorFactor:[.21+i*.01,.17,.13,1]}}))};
  const bytes=buildGlb({json,bin});return {kit:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),catalog:{count_by_kind:Object.fromEntries(families.map(f=>[f,2]))},kinds:new Map(families.map((node,index)=>[index,{index,node,bbox_min:[-5,-4,-.8],bbox_max:[5,4,5]}])),instances:families.flatMap((_,kind)=>[0,1].map(j=>({id:kind*2+j,kind,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,kind*2+j,0,0,1]})))};
}
async function auditWorld(t,dir,privateInput=false){
  const capture=await programCapture(),{buildKamakuraHouses}=await loadHouseView(),temp=await fs.mkdtemp(path.join(os.tmpdir(),'house-attributes-'));
  const input=async()=>{
    if(!dir)return syntheticInput();
    const [catalog,bin,kit]=await Promise.all(['houses.json','houses_f32.bin','houses_kit.glb'].map(n=>fs.readFile(path.join(dir,n))));
    return {...decodeHouses(JSON.parse(catalog),bin.buffer.slice(bin.byteOffset,bin.byteOffset+bin.byteLength)),kit:kit.buffer.slice(kit.byteOffset,kit.byteOffset+kit.byteLength)};
  };
  const rows=new Map(),cache=new Map();let checked=0;
  try{for(const mode of ['normal','debug','plain','legacy-range']){
    const scene=new THREE.Scene(),houses=await input(),search='?housefar=0'+(mode==='legacy-range'?'':'&housefull=700&houseswap=760&housecap=200')+(mode==='debug'?'&house2debug=1':mode==='plain'?'&htex=0':'');
    const view=await buildKamakuraHouses(houses,{heightAt:()=>0},scene,{search});scene.onAfterRender();
    try{
      const seen=new Set();
      for(const kind of houses.kinds.values()){
        const item=houses.instances.find(i=>i.kind===kind.index&&i.house2Eligible);if(!item)continue;
        const m=item.grounded,pos={x:m[12],y:m[13]+1,z:m[14]};for(let i=0;i<350;i++)view.update(pos);
        const meshes=[];scene.traverse(o=>{if(o.isInstancedMesh)meshes.push(o);});
        for(const mesh of meshes)for(const material of [mesh.material,mesh.customDepthMaterial,mesh.customDistanceMaterial]){
          const key=mesh.uuid+material.uuid;if(seen.has(key))continue;seen.add(key);checked++;
          const result=await audit(capture,mesh,material,temp,cache);
          const label=[mode,mesh.name,!!mesh.geometry.attributes.house2Part?'fine':'core',material.type].join('/');
          const prior=rows.get(label);if(!prior||prior.declared<result.declared)rows.set(label,result);
        }
      }
      assert(seen.size>0);
    }finally{view.dispose();}
  }
  // Prefix regression: extra vertex channels really added by Three.js must count too.
  const data=syntheticInput(),scene=new THREE.Scene(),view=await buildKamakuraHouses(data,{heightAt:()=>0},scene,{search:'?housefar=0&housefull=700&houseswap=760&house2debug=1'});scene.onAfterRender();for(let i=0;i<350;i++)view.update({x:0,y:1,z:0});
  try{const mesh=scene.children.find(o=>o.geometry?.attributes.house2Part);assert(mesh);
    const material=new THREE.MeshStandardMaterial({vertexColors:true,normalMap:new THREE.Texture()});material.onBeforeCompile=mesh.material.onBeforeCompile;
    for(const name of ['uv1','uv2','uv3'])mesh.geometry.setAttribute(name,mesh.geometry.attributes.uv.clone());
    mesh.geometry.setAttribute('tangent',new THREE.BufferAttribute(new Float32Array(mesh.geometry.attributes.position.count*4),4));
    const result=await audit(capture,mesh,material,temp,cache);assert.equal(result.declared,16);assert(result.names.includes('uv1'));assert(result.names.includes('tangent'));material.normalMap.dispose();material.dispose();
  }finally{view.dispose();}
  if(privateInput)t.diagnostic('Private input: all material/geometry pairs within 16 locations; exceptions 0.');
  else t.diagnostic(JSON.stringify({auditedPairs:checked,attributePrograms:cache.size,compiledPrograms:compilerAvailable?cache.size:0,attributes:Object.fromEntries(rows)}));
  }finally{await fs.rm(temp,{recursive:true,force:true});}
}

test('all house families, variants, structural/fine and original materials fit real Three.js attribute declarations',async t=>{await auditWorld(t);});
test('designed source: every material/geometry pair fits the attribute budget',{skip:!process.env.KZ_HOUSE_DESIGNED_DIR},async t=>{await auditWorld(t,process.env.KZ_HOUSE_DESIGNED_DIR);});
test('private source: every material/geometry pair fits the attribute budget',{skip:!process.env.KZ_WORLD_DIR},async t=>{await auditWorld(t,process.env.KZ_WORLD_DIR,true);});

test('packed surface, part and instance channels preserve tones, yard mask and complementary fade',async()=>{
  const {buildKamakuraHouses}=await loadHouseView(),scene=new THREE.Scene(),data=syntheticInput(),view=await buildKamakuraHouses(data,{heightAt:()=>0},scene,{search:'?housefar=0&housefull=700&houseswap=760'});
  scene.onAfterRender();try{
    for(let i=0;i<350;i++)view.update({x:0,y:1,z:0});
    for(const mesh of scene.children.filter(m=>m.name==='house2-instances')){
      const a=mesh.geometry.attributes;assert(!a.house2Fade&&!a.house2Yard&&!a.house2Tone&&!a.house2Distance);
      assert.equal(a.house2SurfaceData.itemSize,3);assert.equal(a.house2State.itemSize,4);
      if(a.house2Part){assert.equal(a.house2Part.itemSize,2);for(let i=0;i<a.house2Part.count;i++){assert(a.house2Part.getX(i)>0);assert.equal(a.house2Part.getY(i),HOUSE_DETAIL.end);}}
      for(let i=0;i<mesh.count;i++){assert.equal(a.house2State.getX(i),1);assert.equal(a.house2State.getY(i),+(mesh.instanceColor.getZ(i)<HOUSE2.yardChance));if(a.house2Part){assert(a.house2State.getZ(i)>=1);assert.equal(a.house2State.getW(i),1);}}
    }
    view.update({x:0,y:730,z:0});for(const mesh of scene.children.filter(m=>m.name==='house2-instances'&&m.visible))for(let i=0;i<mesh.count;i++)assert(Math.abs(mesh.geometry.attributes.house2State.getX(i)-.5)<.002);
  }finally{view.dispose();}
});

test('mean correction uses area weighted source RGB and tones without changing near texture or debug output',async()=>{
  const {createHouse2Material}=await loadHouseMaterials();
  const p=[0,1,0,2,1,0,0,1,2],q=[0,1,0,0,1,2,2,1,0];
  const means=house2SourceMeans([{positions:p,rgb:[.1,.2,.3]},{positions:q,rgb:[.3,.4,.5]}]);
  assert.deepEqual(means[0],[.3,.4,.5]); // upward face, downward one excluded
  const wall=[0,1,0,2,1,0,0,3,0],large=wall.map((v,i)=>i%3===0?v*2:v);
  const weighted=house2SourceMeans([{positions:wall,rgb:[.1,.2,.3]},{positions:large,rgb:[.4,.5,.6]}])[1];
  weighted.forEach((v,i)=>assert(Math.abs(v-([.1,.2,.3][i]+2*[.4,.5,.6][i])/3)<1e-12));
  const range=house2SourceMeans([{positions:[...wall,...large],rgb:[.1,.2,.3],start:0,count:3},{positions:[...wall,...large],rgb:[.4,.5,.6],start:3,count:3}])[1];
  assert.deepEqual(range,weighted,'draw ranges respect material groups');
  for(const family of ['townhouse','cottage','storehouse','mansion','boathouse'])for(const variant of [0,1]){
    const shape=buildHouse(syntheticHouse(family),variant),tones=house2ToneMeans(shape);assert(tones.every(v=>v>0));
    if(family==='cottage')assert(shape.surfaces.includes(6),'earth walls are included in far matching');
    const base=new THREE.MeshStandardMaterial(),m=createHouse2Material(base,{constants:HOUSE2,frame:shape.frame,sourceMeans:means,toneMeans:tones});
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};m.onBeforeCompile(shader);
    assert(shader.fragmentShader.includes('1.0000*smoothstep(60.0,75.0,length(vViewPosition))'));
    assert(shader.fragmentShader.includes('h2wall=vHouse2Role==0.0'));
    assert(shader.fragmentShader.includes('h2color*=mix(vec3(1.0),h2legacy/max(h2mean,vec3(0.000001)),h2match)'));
    assert.deepEqual(shader.uniforms.house2RoofSource.value.toArray(),means[0]);assert.deepEqual(shader.uniforms.house2Tones.value.toArray(),tones);
    m.dispose();base.dispose();
  }
});

test('far mean normalisation preserves area-averaged RGB across all families and variants; near and zero-strength are unchanged',async()=>{
  const {createHouse2Material}=await loadHouseMaterials(),smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
  for(const strength of [0,1]){
    const base=new THREE.MeshStandardMaterial(),m=createHouse2Material(base,{constants:{...HOUSE2,farMeanMatch:strength},frame:syntheticHouse('townhouse')});
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};m.onBeforeCompile(shader);
    const expression=shader.fragmentShader.match(/float h2match=([^;]+);/)[1].replace('length(vViewPosition)','distance');
    const fade=new Function('distance','smoothstep',`return ${expression};`);
    for(const distance of [0,40,60])assert.equal(fade(distance,smooth),0);
    for(const distance of [75,150,450])assert.equal(fade(distance,smooth),strength);
    assert.equal(fade(67.5,smooth),strength*.5);m.dispose();base.dispose();
  }
  const reference=[.18,.14,.09],source=[.2,.16,.12];
  for(const family of ['townhouse','cottage','storehouse','mansion','boathouse'])for(const variant of [0,1])for(const seed of [.1,.5,.9]){
    const shape=buildHouse(syntheticHouse(family),variant),tones=house2ToneMeans(shape),sums=[[0,0,0],[0,0,0]],areas=[0,0];
    for(let i=0;i<shape.positions.length;i+=9){
      const surface=shape.surfaces[i/3],k=surface===1&&shape.normals[i+1]>0?0:shape.roles[i/3]===0&&[0,5,6].includes(surface)?1:-1;if(k<0)continue;
      const a=new THREE.Vector3().fromArray(shape.positions,i),b=new THREE.Vector3().fromArray(shape.positions,i+3),c=new THREE.Vector3().fromArray(shape.positions,i+6);
      const area=b.sub(a).cross(c.sub(a)).length();areas[k]+=area;
      const color=house2SurfaceColor(surface,seed,{source,tone:shape.tones[i/3]}),mean=house2SurfaceColor(surface,seed,{source,tone:tones[k]});
      for(let j=0;j<3;j++)sums[k][j]+=area*color[j]*reference[j]/mean[j];
    }
    for(let k=0;k<2;k++)for(let j=0;j<3;j++)assert(Math.abs(sums[k][j]/areas[k]-reference[j])<1e-6,`${family}/${variant}/${seed}/${k}/${j}`);
  }
});
