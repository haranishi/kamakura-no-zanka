import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { houseFrame,houseFamily,buildHouse,houseBuildSteps,houseTriangleLimit,houseVolumes,houseSilhouette,house2Fade,house2Selection,HOUSE2 } from '../dist/valley/kamakura-house-build.js';
import { houseParts,box,beam,stone,solid,roofCourse,finishHouse } from '../dist/valley/kamakura-house-parts.js';
import { syntheticHouse,previewMesh,PREVIEW } from '../tools/preview-mesh.mjs';
import { parseGlb,readAccessor,buildGlb } from '../tools/lib/glb.mjs';
import { THREE,loadHouseView } from './helpers/kamakura-house-view.mjs';
const families=['townhouse','cottage','storehouse','mansion','boathouse'];
const near=(a,b,e=1e-5)=>assert(Math.abs(a-b)<e,`${a} != ${b}`);
// Synthetic body, foundation top, projecting eaves, and x-aligned gable ridge.
const source=[-4,-.8,-3,4,-.8,-3,4,-.8,3,-4,-.8,3,-4,.3,-3,4,.3,-3,4,.3,3,-4,.3,3,
  -4,3,-3,4,3,-3,4,3,3,-4,3,3,-5,3,-4,5,3,-4,5,3,4,-5,3,4,-5,5,0,5,5,0];
const indices=[12,13,17,12,17,16,16,17,14,16,14,15];
function checkShape(m,{bounds=true}={}){
  assert.equal(m.positions.length,m.normals.length);assert.equal(m.positions.length/3,m.roles.length);assert(m.positions.every(Number.isFinite));
  assert.equal(m.triangles,m.positions.length/9);
  const eps=1e-4;
  for(const part of m.solids)for(let i=part.start*3;i<(part.start+part.count)*3;i+=9){
    const p=m.positions.slice(i,i+3),q=m.positions.slice(i+3,i+6),r=m.positions.slice(i+6,i+9),n=m.normals.slice(i,i+3),u=q.map((v,k)=>v-p[k]),v=r.map((x,k)=>x-p[k]);
    const c=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];assert(Math.hypot(...c)>1e-7,part.label);
    near(Math.hypot(...n),1);assert(c.reduce((s,x,k)=>s+x*n[k],0)>0);
    assert(n.reduce((s,x,k)=>s+x*((p[k]+q[k]+r[k])/3-part.centre[k]),0)>-eps,part.label+' inward');
    const a=[m.frame,...(m.frame.wings??[])].find(f=>f.volume===(part.volume??0))?.body??m.frame.body;
    if(bounds&&![1,4,5].includes(part.role)&&!part.label.startsWith('tower ')&&!part.label.startsWith('porch '))for(const t of [p,q,r])for(const k of [0,2])assert(t[k]>=a.min[k]-eps&&t[k]<=a.max[k]+eps,part.label+' outside body');
  }
  for(const o of m.openings){assert(o.top>o.bottom);assert(o.depth>HOUSE2.wall);}
}
test('H1 reads body, base, walls, eaves, ridge, overhang, gable/hip and rotated source, with source +z facade',()=>{
  const f=houseFrame('townhouse',source,1,[{positions:source,indices}]);
  near(f.width,8);near(f.depth,6);near(f.base,1.1);near(f.floor,.3);near(f.wallHeight,2.7);near(f.eave,3);near(f.top,5);near(f.overhang,1);assert(f.alongX);assert(!f.hipped);
  const noFoundation=source.filter((_,i)=>i<12||i>=24);assert.equal(houseFrame('cottage',noFoundation).floor,0);
  const rotated=source.map((v,i)=>i%3===0?source[i+2]:i%3===2?source[i-2]:v),g=houseFrame('cottage',rotated);
  assert(!g.alongX);near(g.width,6);near(g.depth,8);near(g.eave,3);
  const hip=source.slice();hip[48]=-2;hip[51]=2;assert(houseFrame('mansion',hip).hipped);
  assert.equal(houseFamily('gatehouse'),null);assert.equal(houseFamily('fence'),null);assert.equal(houseFamily('unknown'),null);
});
test('H2 every family has two deterministic shapes, outward flat normals, no degeneracy and bounded envelope/cost',t=>{
  const totals=[];
  for(const family of families){const f=syntheticHouse(family),limit=f.family==='mansion'?4000:f.family==='store'?1400:1800;
    const a=buildHouse(f,0),b=buildHouse(f,1);assert.notDeepEqual(a.positions,b.positions);assert.deepEqual(a.positions,buildHouse(f,0).positions);
    for(const m of [a,b]){checkShape(m);assert(m.triangles<=limit,`${family}: ${m.triangles} > ${limit}`);assert(m.solids.some(p=>p.label==='roof course'));
      const roof=m.solids.find(p=>p.label==='roof course'),ys=[];for(let i=roof.start*3+1;i<(roof.start+roof.count)*3;i+=3)ys.push(m.positions[i]);assert(Math.max(...ys)-Math.min(...ys)>=HOUSE2.boardRoof);
      assert(m.solids.some(p=>p.label==='opening back'));assert(m.solids.some(p=>p.label==='rafter'));}
    totals.push([family,a.triangles,b.triangles]);
  }
  t.diagnostic(JSON.stringify({syntheticTriangles:totals}));
});
test('closed primitive faces are outward; generator yields finite construction stages',()=>{
  const m=houseParts();box(m,[-1,0,-1],[1,2,1],0);beam(m,[-2,0,0],[2,3,1],.12,.12);stone(m,0,0,0,1,.2,.7);
  const shape=finishHouse(m,{body:{min:[-3,-2,-3],max:[3,4,3]}},0);checkShape(shape);
  for(const solid of shape.solids){const edges=new Map();for(let i=solid.start*3;i<(solid.start+solid.count)*3;i+=9){const ids=[0,3,6].map(j=>Array.from(shape.positions.slice(i+j,i+j+3)).join(','));for(let j=0;j<3;j++){const key=[ids[j],ids[(j+1)%3]].sort().join('|');edges.set(key,(edges.get(key)??0)+1);}}assert([...edges.values()].every(v=>v===2));}
  const gen=houseBuildSteps(syntheticHouse('mansion'),0);let steps=0,r;do{r=gen.next();steps++;}while(!r.done);assert(steps>8&&steps<32);
});
test('H3 allocation-free selection: true 3D distance, closest 90, complementary dither band and deterministic variant',()=>{
  const items=Array.from({length:150},(_,i)=>({house2Eligible:true,grounded:[1,0,0,0,0,1,0,0,0,0,1,0,i/2,0,0,1]})),ids=new Int32Array(90),distances=new Float64Array(90);
  assert.equal(house2Selection(items,{x:0,y:0,z:0},ids,distances),90);assert.deepEqual([...ids],Array.from({length:90},(_,i)=>i));
  assert.equal(house2Selection(items,{x:0,y:76,z:0},ids,distances),0);assert.equal(house2Fade(60),1);near(house2Fade(67.5),.5);assert.equal(house2Fade(75),0);
  for(let d=60;d<=75;d+=.5){const weight=house2Fade(d);for(let i=0;i<100;i++){const sample=i/100;assert.notEqual(sample<weight,sample>=weight);}}
});
// Production exercises the unchanged data-URL helper too; HEAD is read only for the legacy comparison.
export async function loadHouse2View(legacy=false){
  if(!legacy)return loadHouseView();
  const helper=new URL('./helpers/kamakura-house-view.mjs',import.meta.url),base=await fs.readFile(helper,'utf8');
  const {execFileSync}=await import('node:child_process');
  const helperSource=legacy?base.replace("read('../../dist/valley/kamakura-house-view.js')",JSON.stringify(execFileSync('git',['show','HEAD:dist/valley/kamakura-house-view.js'],{encoding:'utf8'}).replace(/from 'three'/g,"from '"+new URL('../dist/vendor/three.module.min.js',import.meta.url).href+"'"))):base;
  const resolved=helperSource.replace("from '../../dist/vendor/three.module.min.js'", "from '"+new URL('../dist/vendor/three.module.min.js',import.meta.url).href+"'").replace(/new URL\(([^,]+), import\.meta\.url\)/g,(_,a)=>`new URL(${a}, '${helper.href}')`);
  return (await import('data:text/javascript;base64,'+Buffer.from(resolved).toString('base64'))).loadHouseView();
}
function fieldInput(count=5,kinds=2){
  const p=new Float32Array(source),idx=new Uint16Array(indices),bin=Buffer.concat([Buffer.from(p.buffer),Buffer.from(idx.buffer)]);
  const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:Array.from({length:kinds},(_,i)=>i)}],nodes:Array.from({length:kinds},(_,i)=>({name:i?'cottage':'townhouse',mesh:0})),buffers:[{byteLength:bin.length}],
    bufferViews:[{buffer:0,byteLength:p.byteLength},{buffer:0,byteOffset:p.byteLength,byteLength:idx.byteLength}],accessors:[{bufferView:0,componentType:5126,count:p.length/3,type:'VEC3',min:[-5,-.8,-4],max:[5,5,4]},{bufferView:1,componentType:5123,count:idx.length,type:'SCALAR'}],
    meshes:[{primitives:[{attributes:{POSITION:0},indices:1,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.21,.17,.13,1],roughnessFactor:.8}}]};
  const glb=buildGlb({json,bin});return {kit:glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength),catalog:{count_by_kind:{townhouse:Math.ceil(count/2),cottage:Math.floor(count/2)}},
    kinds:new Map(Array.from({length:kinds},(_,i)=>[i,{index:i,node:i?'cottage':'townhouse',bbox_min:[-5,-4,-.8],bbox_max:[5,4,5]}])),
    instances:Array.from({length:count},(_,i)=>({id:i,kind:i%kinds,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,i*.35,0,0,1]}))};
}
const detailMeshes=scene=>scene.children.filter(o=>o.name==='house2-instances');
async function warm(view,pos,frames=100){for(let i=0;i<frames;i++)view.update(pos);}
test('H3 lazy one-kind-per-frame cache, shared instancing, cap, altitude, adaptation, dither and single disposal',async t=>{
  const {buildKamakuraHouses}=await loadHouse2View(),scene=new THREE.Scene(),data=fieldInput(120),terrain={heightAt:()=>0};
  const view=await buildKamakuraHouses(data,terrain,scene,{search:'?debug=1&housefar=0'}),pos={x:0,y:0,z:0};
  assert.equal(detailMeshes(scene).length,0);view.update(pos);assert.equal(globalThis.__kzHouse2().built.length,0);scene.onAfterRender();let last=new Set();
  for(let i=0;i<100;i++){view.update(pos);const s=globalThis.__kzHouse2(),now=new Set(s.built.map(b=>b.type));assert(now.size-last.size<=1);last=now;}
  const stats=globalThis.__kzHouse2();assert.equal(stats.built.length,4);assert.equal(stats.shown,90);assert(stats.triangles<=HOUSE2.triangles);assert(stats.draws<=HOUSE2.draws);assert(stats.nearest.distance<1);assert.equal(stats.nearest.tiltDegrees,0);
  assert.equal(detailMeshes(scene).length,4);assert(detailMeshes(scene).every(m=>m.castShadow&&m.receiveShadow));
  const resources=new Set();scene.traverse(o=>{if(o.geometry)resources.add(o.geometry);if(o.material)resources.add(o.material);if(o.customDepthMaterial)resources.add(o.customDepthMaterial);if(o.customDistanceMaterial)resources.add(o.customDistanceMaterial);});
  const releases=new Map();for(const r of resources)r.addEventListener('dispose',()=>releases.set(r,(releases.get(r)??0)+1));
  const version=detailMeshes(scene).map(m=>[m.instanceMatrix.version,m.instanceColor.version,m.geometry.attributes.house2Fade.version]);
  const before=performance.now();await warm(view,pos,10000);const ms=performance.now()-before;
  assert.deepEqual(detailMeshes(scene).map(m=>[m.instanceMatrix.version,m.instanceColor.version,m.geometry.attributes.house2Fade.version]),version);
  view.update({x:0,y:76,z:0});assert.equal(globalThis.__kzHouse2().shown,0);
  view.update(pos);assert.equal(globalThis.__kzHouse2().built.length,4);
  view.setAdapt(2);view.update(pos);assert.equal(globalThis.__kzHouse2().shown,0);view.setAdapt(0);view.update(pos);assert(globalThis.__kzHouse2().shown>0);
  view.dispose();view.dispose();assert.equal(scene.children.length,0);assert.equal(globalThis.__kzHouse2,undefined);for(const r of resources)assert.equal(releases.get(r),1);
  t.diagnostic(JSON.stringify({shown:stats.shown,triangles:stats.triangles,draws:stats.draws,buildSlices:stats.built.map(b=>b.maxSliceMs),updates:10000,stableCpuMs:ms}));
});
test('H3 off/light preserve legacy render resources and do not create any modelled cache; partial construction disposes',async()=>{
  const {buildKamakuraHouses}=await loadHouse2View();
  for(const options of [{search:'?house2=0&debug=1&housefar=0'},{search:'?debug=1&housefar=0',quality:'light'}]){
    const scene=new THREE.Scene(),view=await buildKamakuraHouses(fieldInput(),{heightAt:()=>0},scene,options);await warm(view,{x:0,y:0,z:0});assert.equal(detailMeshes(scene).length,0);assert.equal(globalThis.__kzHouse2().built.length,0);assert.equal(globalThis.__kzHouse2().enabled,false);
    scene.traverse(o=>{if(o.isInstancedMesh)assert(!o.geometry.attributes.house2Fade);});view.dispose();
  }
  const scene=new THREE.Scene(),view=await buildKamakuraHouses(fieldInput(),{heightAt:()=>0},scene,{search:'?housefar=0'});view.update({x:0,y:0,z:0});view.dispose();assert.equal(scene.children.length,0);
});
function safety(source){
  const code=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');const stack=[];
  for(const ch of code){if('({['.includes(ch))stack.push(ch);else if(')}]'.includes(ch))assert.equal(stack.pop(),'({['[')}]'.indexOf(ch)]);}assert.equal(stack.length,0);
  assert(!/--\s*\d|\b\d+(?:\.\d+)?(?:float|vec[234]|int)\b/.test(code));assert(!/\b(?:attribute|varying|uniform|float|int|vec[234])\s+(?:input|output|sample|filter|common|partition|active|namespace)\b/.test(code));
}
test('H3/H5 shipped shader anchors, complementary colour/depth/distance discard, debug colors, seed and yard mask',async()=>{
  const {buildKamakuraHouses}=await loadHouse2View();
  for(const search of ['?housefar=0','?housefar=0&house2debug=1','?housefar=0&htex=0','?housefar=0&housefull=700&houseswap=760&housecap=200','?housefar=0&housefull=700&houseswap=760&housecap=200&house2debug=1','?housefar=0&housefull=700&houseswap=760&housecap=200&htex=0']){
    const scene=new THREE.Scene(),view=await buildKamakuraHouses(fieldInput(),{heightAt:()=>0},scene,{search});scene.onAfterRender();await warm(view,{x:0,y:0,z:0});
    scene.traverse(o=>{if(!o.isInstancedMesh)return;
      const isDetail=o.name==='house2-instances';
      for(const [m,key] of [[o.material,o.material.isMeshBasicMaterial?'basic':'standard'],[o.customDepthMaterial,'depth'],[o.customDistanceMaterial,'distanceRGBA']]){
        assert(m);const lib=THREE.ShaderLib[key];for(const mark of ['common','begin_vertex'])assert(lib.vertexShader.includes('#include <'+mark+'>'));assert(lib.fragmentShader.includes('#include <clipping_planes_fragment>'));
        const shader={uniforms:{},vertexShader:lib.vertexShader,fragmentShader:lib.fragmentShader};m.onBeforeCompile(shader);safety(shader.vertexShader);safety(shader.fragmentShader);assert(!/attribute\s/.test(shader.fragmentShader),'attributes belong only to the vertex shader');
        assert(shader.fragmentShader.includes(isDetail?'h2screen>=vHouse2Fade':'h2screen<vHouse2Fade'));assert(!m.transparent);
        if(isDetail)assert(shader.vertexShader.includes('if(house2Role>5.5)transformed*=house2Yard'));
      }
      if(isDetail&&search.includes('debug')){assert(o.material.isMeshBasicMaterial);assert(o.geometry.attributes.color);assert.equal(o.material.fog,false);}
    });view.dispose();
  }
});
test('H4 CPU viewer draws sorted shaded faces in four views with the human reference',()=>{
  const m=buildHouse(syntheticHouse('townhouse'));for(const view of ['oblique','front','side','under']){const svg=previewMesh(m,{view});assert(svg.includes('<polygon'));assert(svg.includes('human 1.66 m'));assert(svg.includes(view));}
});
test('private kits: source-derived frames and all variants stay within cost and envelope limits', {skip:!process.env.KZ_WORLD_DIR&&'private input not set'},async t=>{
  const dir=process.env.KZ_WORLD_DIR,doc=parseGlb(await fs.readFile(path.join(dir,'houses_kit.glb')));let covered=0,total=0,maxMs=0;
  for(const n of doc.json.nodes)if(n.mesh!==undefined&&houseFamily(n.name)){
    const surfaces=doc.json.meshes[n.mesh].primitives.map(p=>({positions:readAccessor(doc,p.attributes.POSITION).array,indices:p.indices===undefined?null:readAccessor(doc,p.indices).array}));
    const f=houseFrame(n.name,surfaces.flatMap(s=>Array.from(s.positions)),1,surfaces);assert(f.eave>f.floor);assert(f.top>f.eave);
    const triangles=[];for(const v of [0,1]){const start=performance.now(),m=buildHouse(f,v);maxMs=Math.max(maxMs,performance.now()-start);checkShape(m);assert(m.triangles<=houseTriangleLimit(f));triangles.push(m.triangles);total+=m.triangles;}
    covered++;t.diagnostic(JSON.stringify({family:f.family,triangles}));
  }
  assert(covered>0);t.diagnostic(JSON.stringify({coveredFraction:1,templateTriangles:total,maxWholeBuildMs:maxMs}));
});

test('GLSL compiler checks detail and legacy standard/basic/depth/distance with real instancing and sun/shadows',async t=>{
  const {spawnSync}=await import('node:child_process');if(spawnSync('glslc',['--version']).error?.code==='ENOENT'){t.skip('glslc unavailable');return;}
  const {tmpdir}=await import('node:os'),dir=await fs.mkdtemp(path.join(tmpdir(),'house2-glsl-'));
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
    #define USE_INSTANCING
    #define USE_INSTANCING_COLOR
    #define OPAQUE
    uniform mat4 modelMatrix,modelViewMatrix,projectionMatrix,viewMatrix;
    uniform mat3 normalMatrix;uniform vec3 cameraPosition;uniform bool isOrthographic;
    ${stage==='vert'?'in vec3 position,normal,color,instanceColor;in mat4 instanceMatrix;in vec2 uv;':'out vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\nvec4 linearToOutputTexel(vec4 v){return v;}'}
  `;
  const {buildKamakuraHouses}=await loadHouse2View();let stages=0;
  try{
    for(const search of ['?housefar=0','?housefar=0&house2debug=1','?housefar=0&htex=0','?housefar=0&housefull=700&houseswap=760&housecap=200','?housefar=0&housefull=700&houseswap=760&housecap=200&house2debug=1','?housefar=0&housefull=700&houseswap=760&housecap=200&htex=0']){
      const scene=new THREE.Scene(),view=await buildKamakuraHouses(fieldInput(),{heightAt:()=>0},scene,{search});scene.onAfterRender();await warm(view,{x:0,y:0,z:0});
      try{
        const legacy=[];scene.traverse(o=>{if(o.name==='house-instances')legacy.push(o);});
        const meshes=[legacy[0],detailMeshes(scene)[0],...detailMeshes(scene).filter(m=>m.geometry.attributes.house2PartEnd)];assert(meshes.every(Boolean));
        for(const mesh of meshes)for(const [material,kind] of [[mesh.material,mesh.material.isMeshBasicMaterial?'basic':'standard'],[mesh.customDepthMaterial,'depth'],[mesh.customDistanceMaterial,'distanceRGBA']]){
          const lib=THREE.ShaderLib[kind],shader={uniforms:{},vertexShader:lib.vertexShader,fragmentShader:lib.fragmentShader};material.onBeforeCompile(shader);
          for(const lit of [false,true])for(const [property,stage] of [['vertexShader','vert'],['fragmentShader','frag']]){
            const defs=Object.entries(material.defines??{}).map(([k,v])=>`#define ${k} ${v}`).join('\n');
            let code=prefix(stage)+defs+'\n'+(kind==='depth'?'#define DEPTH_PACKING '+material.depthPacking+'\n':'')+(lit?'#define USE_SHADOWMAP\n#define SHADOWMAP_TYPE_PCF_SOFT\n':'')+expand(shader[property]);
            code=code.replace(/\baverage\b/g,'threeAverage').replace(/\bNUM_\w+\b/g,n=>lit&&['NUM_DIR_LIGHTS','NUM_DIR_LIGHT_SHADOWS'].includes(n)?'1':'0');
            code=code.replace(/#pragma unroll_loop_start\s+for \( int i = (\d+); i < (\d+); i \+\+ \) \{([\s\S]+?)\}\s+#pragma unroll_loop_end/g,(_,a,b,body)=>{let s='';for(let i=+a;i<+b;i++)s+=body.replace(/\[\s*i\s*\]/g,'[ '+i+' ]').replace(/UNROLLED_LOOP_INDEX/g,String(i));return s;});
            const file=path.join(dir,'shader.'+stage);await fs.writeFile(file,code);
            const result=spawnSync('glslc',['--target-env=opengl','-fauto-bind-uniforms','-fauto-map-locations','-fshader-stage='+stage,file,'-o',path.join(dir,'shader.spv')],{encoding:'utf8'});
            assert.equal(result.status,0,result.stderr);stages++;
          }
        }
      }finally{view.dispose();}
    }
    t.diagnostic(JSON.stringify({compiledInstancedShaderStages:stages}));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('house2=0 matches HEAD render state, collision boxes, geometry and all surface shader strings',async()=>{
  const current=await loadHouse2View(),old=await loadHouse2View(true),sceneA=new THREE.Scene(),sceneB=new THREE.Scene(),terrain={heightAt:()=>0};
  const a=await current.buildKamakuraHouses(fieldInput(),terrain,sceneA,{search:'?house2=0'}),b=await old.buildKamakuraHouses(fieldInput(),terrain,sceneB,{search:'?house2=0'});
  const capture=scene=>{const out=[];scene.traverse(o=>{if(o.geometry){const g=o.geometry,lib=THREE.ShaderLib[o.material.isMeshBasicMaterial?'basic':'standard'],shader={uniforms:{},vertexShader:lib.vertexShader,fragmentShader:lib.fragmentShader};o.material.onBeforeCompile(shader);out.push({name:o.name,visible:o.visible,parent:o.parent.visible,count:o.count,
    positions:Array.from(g.attributes.position.array),normals:g.attributes.normal?Array.from(g.attributes.normal.array):null,matrices:o.instanceMatrix?Array.from(o.instanceMatrix.array):null,vertex:shader.vertexShader,fragment:shader.fragmentShader});}});return out;};
  try{assert.deepEqual(a.boxes,b.boxes);for(const pos of [{x:0,y:0,z:0},{x:800,y:0,z:0},{x:3000,y:400,z:0},{x:0,y:0,z:0}]){
    for(let i=0;i<12;i++){a.update(pos);b.update(pos);}sceneA.onAfterRender();sceneB.onAfterRender();assert.deepEqual(capture(sceneA),capture(sceneB));
  }}finally{a.dispose();b.dispose();}
});
test('private runtime: nearest source types build lazily, keep colliders and obey global draw/triangle caps', {skip:!process.env.KZ_WORLD_DIR&&'private input not set'},async t=>{
  const dir=process.env.KZ_WORLD_DIR,{decodeHouses}=await import('../dist/valley/kamakura-houses.js');
  const [catalog,bin,kit]=await Promise.all(['houses.json','houses_f32.bin','houses_kit.glb'].map(n=>fs.readFile(path.join(dir,n))));
  const houses={...decodeHouses(JSON.parse(catalog),bin.buffer.slice(bin.byteOffset,bin.byteOffset+bin.byteLength)),kit:kit.buffer.slice(kit.byteOffset,kit.byteOffset+kit.byteLength)};
  const {buildKamakuraHouses}=await loadHouse2View(),scene=new THREE.Scene(),view=await buildKamakuraHouses(houses,{heightAt:()=>0},scene,{search:'?housefar=0&debug=1'}),boxes=JSON.stringify(view.boxes);
  scene.onAfterRender();let maxShown=0,maxTriangles=0,maxDraws=0;
  try{for(const kind of houses.kinds.values()){
    if(!houseFamily(kind))continue;const item=houses.instances.find(i=>i.kind===kind.index);if(!item)continue;const m=item.grounded,pos={x:m[12],y:m[13],z:m[14]};
    await warm(view,pos,80);const s=globalThis.__kzHouse2();assert(s.shown<=HOUSE2.cap);assert(s.triangles<=HOUSE2.triangles);assert(s.draws<=HOUSE2.draws);maxShown=Math.max(maxShown,s.shown);maxTriangles=Math.max(maxTriangles,s.triangles);maxDraws=Math.max(maxDraws,s.draws);
  }assert.equal(JSON.stringify(view.boxes),boxes);assert(globalThis.__kzHouse2().built.length>0);
  t.diagnostic(JSON.stringify({capUsed:maxShown/HOUSE2.cap,maxTriangles,maxDraws}));
  }finally{view.dispose();}
});

// Exercise the exact column-major upload route used by both original and town-fill houses.
function checkUprightPlacements(shape){
  const position=new THREE.Vector3(),matrix=new THREE.Matrix4(),readback=new THREE.Matrix4();
  const instance=new THREE.InstancedMesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial(),1);
  for(const yaw of [0,90,180,270,37])for(const scale of [.92,1.08]){
    const a=yaw*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
    const values=[c*scale,0,-s*scale,0,0,scale,0,0,s*scale,0,c*scale,0,13,2,-7,1];
    instance.setMatrixAt(0,matrix.fromArray(values));instance.getMatrixAt(0,readback);
    const v=readback.elements;near(v[4],0);near(v[6],0);near(v[5],scale);
    for(const part of shape.solids){
      if(['post','tower post','porch post'].includes(part.label)){
        const p=shape.positions.slice(part.start*3,(part.start+part.count)*3),levels=new Map();
        for(let i=0;i<p.length;i+=3){const y=p[i+1];if(!levels.has(y))levels.set(y,new Set());position.fromArray(p,i).applyMatrix4(readback);levels.get(y).add(position.x.toFixed(5)+','+position.z.toFixed(5));}
        assert.equal(levels.size,2);const [low,high]=[...levels.values()];assert.deepEqual(low,high,'post cap footprints must coincide');
      }
      if(part.label==='veranda'||part.label==='original foundation'){
        const heights=new Set();for(let i=part.start*3;i<(part.start+part.count)*3;i+=3){position.fromArray(shape.positions,i).applyMatrix4(readback);heights.add(position.y.toFixed(5));}assert(heights.size<=2,'floor must stay horizontal');
      }
      if(![1,4,5].includes(part.role)&&!part.label.startsWith('tower ')&&!part.label.startsWith('porch '))for(let i=part.start*3;i<(part.start+part.count)*3;i+=3){
        position.fromArray(shape.positions,i).applyMatrix4(readback).applyMatrix4(readback.clone().invert());
        for(const k of [0,2])assert(position.getComponent(k)>=([shape.frame,...(shape.frame.wings??[])].find(f=>f.volume===(part.volume??0))??shape.frame).body.min[k]-1e-4&&position.getComponent(k)<=([shape.frame,...(shape.frame.wings??[])].find(f=>f.volume===(part.volume??0))??shape.frame).body.max[k]+1e-4,'body leaves original footprint');
      }
    }
  }
  instance.dispose();instance.geometry.dispose();instance.material.dispose();
}
test('X1 all synthetic families, ridge directions, fronts, variants and rotated/scaled uploads keep posts upright and floors level',()=>{
  for(const family of families)for(const swap of [false,true])for(const sign of [-1,1])for(const variant of [0,1]){
    const p=swap?source.map((v,i)=>i%3===0?source[i+2]:i%3===2?source[i-2]:v):source;
    const frame=houseFrame(family,p,sign);checkUprightPlacements(buildHouse(frame,variant));
  }
});
test('X1 private all source kinds/variants and town-fill yaw/scales preserve upright posts and level floors', {skip:!process.env.KZ_WORLD_DIR&&'private input not set'},async t=>{
  const dir=process.env.KZ_WORLD_DIR,doc=parseGlb(await fs.readFile(path.join(dir,'houses_kit.glb'))),catalog=JSON.parse(await fs.readFile(path.join(dir,'houses.json'),'utf8'));
  let examined=0;
  for(const n of doc.json.nodes)if(n.mesh!==undefined&&houseFamily(n.name)){
    const surfaces=doc.json.meshes[n.mesh].primitives.map(p=>({positions:readAccessor(doc,p.attributes.POSITION).array,indices:p.indices===undefined?null:readAccessor(doc,p.indices).array}));
    const kind=catalog.kinds.find(k=>k.node===n.name)??n.name,frame=houseFrame(kind,surfaces.flatMap(s=>Array.from(s.positions)),1,surfaces);
    for(const variant of [0,1]){const shape=buildHouse(frame,variant);checkShape(shape);assert(shape.triangles<=houseTriangleLimit(frame));checkUprightPlacements(shape);examined++;}
  }
  assert(examined>0);t.diagnostic(JSON.stringify({sourceCoverage:1,yawCases:5,scaleCases:2,maxPostLean:0}));
});
test('X2 local metre UVs keep wall grain vertical and roof grain downhill with quarter-metre board spacing',()=>{
  const nearUV=(a,b)=>near(a,b,2e-5);
  for(const family of families)for(const swap of [false,true])for(const variant of [0,1]){
    const p=swap?source.map((v,i)=>i%3===0?source[i+2]:i%3===2?source[i-2]:v):source,shape=buildHouse(houseFrame(family,p),variant);
    assert.equal(shape.uvs.length,shape.positions.length/3*2);
    for(let i=0;i<shape.positions.length;i+=9){const j=i/3,surface=shape.surfaces[j],n=Array.from(shape.normals.slice(i,i+3));
      const points=[0,3,6].map(k=>Array.from(shape.positions.slice(i+k,i+k+3))),uv=[0,1,2].map(k=>Array.from(shape.uvs.slice((j+k)*2,(j+k)*2+2)));
      for(let k=1;k<3;k++){
        const d=points[k].map((v,c)=>v-points[0][c]),du=uv[k][0]-uv[0][0],dv=uv[k][1]-uv[0][1];
        if(surface===1&&Math.abs(n[1])>1e-6&&Math.abs(n[1])<.999999){
          nearUV(Math.hypot(du,dv),Math.hypot(...d));
          const down=new THREE.Vector3(...n).multiplyScalar(n[1]).sub(new THREE.Vector3(0,1,0)).normalize();nearUV(dv,new THREE.Vector3(...d).dot(down));
        }else if(Math.abs(n[1])<1e-6){nearUV(dv,d[1]);nearUV(du,Math.abs(n[2])>Math.abs(n[0])?d[0]:d[2]);}
      }
    }
    assert(HOUSE2.board>=.2&&HOUSE2.board<=.3);
    assert(previewMesh(shape,{uv:true}).includes('stroke-width="'+PREVIEW.stripePixels+'"'));
  }
});
test('X2 original photo samplers/packed normals/roughness, one material per variant, local UV and unmodified projection',async()=>{
  const {buildKamakuraHouses}=await loadHouse2View(),scene=new THREE.Scene(),view=await buildKamakuraHouses(fieldInput(),{heightAt:()=>0},scene,{search:'?housefar=0'});
  scene.onAfterRender();await warm(view,{x:0,y:0,z:0});
  const {photoSampler,PHOTO_TEX_DATA,photoBlendUniform}=await import('../dist/valley/kamakura-photo-tex.js');
  try{for(const mesh of detailMeshes(scene)){
    assert(!Array.isArray(mesh.material));assert(mesh.geometry.attributes.uv);
    const lib=THREE.ShaderLib.standard,shader={uniforms:{},vertexShader:lib.vertexShader,fragmentShader:lib.fragmentShader};mesh.material.onBeforeCompile(shader);
    for(const key of ['wallWoodA','wallPlaster','roofThatch','stoneRubble','groundSoil']){assert.equal(shader.uniforms['hPhoto_'+key],photoSampler(key));assert(shader.fragmentShader.includes(String(PHOTO_TEX_DATA[key].roughness)));}
    assert.equal(shader.uniforms.uPhotoBlend,photoBlendUniform);assert(shader.fragmentShader.includes('kzPerturbNormal(normal,-vViewPosition,h2uv,h2photo.xy'));
    assert(shader.vertexShader.includes('#include <project_vertex>'));assert(shader.vertexShader.includes('vec3 h2p=position*h2scale,h2n=normalize(normal/h2scale)'));
    assert(shader.fragmentShader.includes('h2uv/vec2(3.0000,2.000)'));assert.equal(mesh.material.emissiveIntensity,0);
  }}finally{view.dispose();}
});
test('X3 warm lime stays within linear clean reflectance range, retains hue and darkens at the foot; timber uses original wood',async t=>{
  const {house2SurfaceColor}=await import('../dist/valley/kamakura-house-build.js');
  const y=c=>c.reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const ranges=[];for(const seed of [0,.5,1]){
    const a=house2SurfaceColor(5,seed),b=house2SurfaceColor(5,seed,{height:0});
    assert(a[0]>a[1]&&a[1]>a[2]);assert(y(a)>=HOUSE2.plasterMin-1e-9&&y(a)<=HOUSE2.plasterMax+1e-9);assert(y(b)<y(a));
    near(a[0]/a[2],b[0]/b[2]);assert(y(a.map(v=>v*.55))>=.38&&y(a.map(v=>v*.55))<=.48);ranges.push(y(a));
    const wood=house2SurfaceColor(0,seed),timber=house2SurfaceColor(2,seed,{tone:HOUSE2.timberTone});near(y(timber)/y(wood),HOUSE2.timberTone);
  }
  const m=buildHouse(syntheticHouse('storehouse'));assert(m.solids.some(p=>p.label==='waist boards'));assert(m.roles.some(r=>r===4));
  t.diagnostic(JSON.stringify({cleanLimeLuminance:ranges,shadeIrradiance:.55,footMultiplier:1-HOUSE2.plasterDirt}));
});

test('X4 ridge caps meet the stepped/thatch roof and gable apex meets its underside without a new slit',()=>{
  for(const family of families)for(const variant of [0,1]){
    const shape=buildHouse(syntheticHouse(family),variant),f=shape.frame;
    const heights=label=>{const ys=[];for(const part of shape.solids)if(part.label===label)for(let i=part.start*3+1;i<(part.start+part.count)*3;i+=3)ys.push(shape.positions[i]);return ys;};
    const roof=heights('roof course'),cap=heights('ridge cap'),gable=heights('gable');
    near(Math.min(...cap),Math.max(...roof));
    if(gable.length)near(Math.max(...gable),Math.max(...roof)-(f.roofThatch?HOUSE2.thatchRoof:HOUSE2.boardRoof)-(f.family==='store'?HOUSE2.storeRoofGap:0));
  }
});

function roof(m,{x0,x1,z0,z1,eave,top,alongX=true,hip=false}){
  const p=(u,y,v)=>alongX?[u,y,v]:[v,y,u],u0=alongX?x0:z0,u1=alongX?x1:z1,v0=alongX?z0:x0,v1=alongX?z1:x1,mid=(v0+v1)/2;
  const r0=hip?u0+(u1-u0)/4:u0,r1=hip?u1-(u1-u0)/4:u1;
  const planes=[[[u0,eave,v0],[u1,eave,v0],[r1,top,mid],[r0,top,mid]],[[u1,eave,v1],[u0,eave,v1],[r0,top,mid],[r1,top,mid]]];
  for(const q of planes)roofCourse(m,q.map(v=>p(...v)),.1);
  if(hip)for(const q of [[[u0,eave,v1],[u0,eave,v0],[r0,top,mid]],[[u1,eave,v0],[u1,eave,v1],[r1,top,mid]]]){
    const top=q.map(v=>p(...v)),low=top.map(p=>[p[0],p[1]-.1,p[2]]);
    solid(m,[...low,...top],[[0,1,2],[3,5,4],[0,3,4,1],[1,4,5,2],[2,5,3,0]],1);
  }
}
function volumeKit(type='single'){
  const m=houseParts();
  const add=(a,b,e,t,alongX,hip=false)=>{box(m,[a[0],-.6,a[1]],[b[0],e,b[1]],0);roof(m,{x0:a[0]-.6,x1:b[0]+.6,z0:a[1]-.6,z1:b[1]+.6,eave:e,top:t,alongX,hip});};
  if(type==='double'||type==='offset'){
    add([-4,2],[4,6],4.8,7.2,true);
    add(type==='offset'?[-3,-6]:[-2,-6],type==='offset'?[0,2]:[2,2],2.8,4.6,false);
  }else if(type==='l'){
    add([-5,-3],[3,3],3.5,5.7,true);add([3,-2],[7,1],2.7,4.3,false);
  }else if(type==='store'){
    box(m,[-3,-.6,-2],[3,.4,2],0);box(m,[-2.8,.4,-1.8],[2.8,3.5,1.8],0);
    roof(m,{x0:-3.6,x1:3.6,z0:-2.6,z1:2.6,eave:3.5,top:5.3});
  }else add([-3,-2],[3,2],3,5,type!=='gableFront',type==='hip');
  if(type==='tower'){
    box(m,[-.5,4.8,-.5],[.5,6.6,.5],0);
    solid(m,[[-.8,6.6,-.8],[.8,6.6,-.8],[.8,6.6,.8],[-.8,6.6,.8],[0,7.5,0]],[[0,3,2,1],[0,1,4],[1,2,4],[2,3,4],[3,0,4]],1);
  }
  if(type==='porch'||type==='entrance'){
    const sign=type==='porch'?1:-1;
    roofCourse(m,[[-1.5,2.2,sign*3.2],[1.5,2.2,sign*3.2],[1.5,2.8,sign*1.9],[-1.5,2.8,sign*1.9]],.1);
  }
  return [{positions:m.positions}];
}
function silhouetteCheck(surfaces,shape){
  const a=houseSilhouette(surfaces),b=houseSilhouette(shape);assert.equal(a.roofs.length,b.roofs.length);
  let maxDifference=0;
  for(const source of a.roofs){const made=b.roofs.find(r=>r.volume===source.volume),f=[shape.frame,...shape.frame.wings].find(f=>f.volume===source.volume);
    assert.equal(made.alongX,source.alongX);near(made.top,source.top,.3);near(made.eave,source.eave,.3);
    maxDifference=Math.max(maxDifference,Math.abs(made.top-source.top),Math.abs(made.eave-source.eave));
    for(const k of [0,2])for(const sign of [-1,1]){
      const side=(sign<0?'-':'+')+(k===0?'x':'z'),touch=f.contacts.some(c=>c.face===side);
      const edge=sign<0?'min':'max',body=source.body[edge][k],actual=made[edge][k],original=source[edge][k];
      if(touch)near(actual,body);
      else {const oldProjection=Math.abs(original-body),growth=Math.max(0,HOUSE2.eave-oldProjection);assert(sign*(actual-original)>=-1e-4,'source roof must be covered');assert(sign*(actual-original)<=growth+1e-4,'roof must stay in expanded source bounds');}
    }
  }
  assert.equal(a.towers.length,b.towers.length);for(let i=0;i<a.towers.length;i++)near(a.towers[i].top,b.towers[i].top,.3);
  return maxDifference;
}
test('V1 position weld splits bodies, roof plates, tower and porches; ignores raised store body',()=>{
  for(const type of ['single','double','offset','l','tower','porch','entrance','hip','store']){
    const surfaces=volumeKit(type),v=houseVolumes(surfaces);assert.equal(v.volumes.length,['double','offset','l'].includes(type)?2:1,type);
    assert.equal(v.towers.length,type==='tower'?1:0);assert.equal(v.porches.length,['porch','entrance'].includes(type)?1:0);
    assert(v.volumes.every(v=>v.roof.slopeArea>0));assert(v.components.length>=v.volumes.length*2);
    // Reverse triangle order and rotate each triangle's vertex order; connected measurements must not depend on either.
    const p=surfaces[0].positions,tri=[];for(let i=0;i<p.length;i+=9)tri.unshift(...p.slice(i+3,i+9),...p.slice(i,i+3));
    assert.deepEqual(houseSilhouette([{positions:tri}]),houseSilhouette(surfaces));
    assert.deepEqual(houseFrame('townhouse',tri,1,[{positions:tri}]),houseFrame('townhouse',p,1,surfaces));
    const perturb=p.map((v,i)=>v+(i%9===0?HOUSE2.weld/4:0));assert.equal(houseVolumes([{positions:perturb}]).volumes.length,v.volumes.length);
  }
});
test('V2 largest body owns wings; source z porch decides facade, no porch defaults +z including gables',()=>{
  for(const type of ['single','double','offset','l','tower','porch','entrance','hip','store','gableFront']){
    const s=volumeKit(type),f=houseFrame(type==='store'?'storehouse':'townhouse',s[0].positions,1,s);
    assert.equal(f.front,type==='entrance'?'-z':'+z');assert.equal(f.wings.length,['double','offset','l'].includes(type)?1:0);
    assert(f.wings.every(w=>w.width*w.depth<=f.width*f.depth));assert(f.top<6||type==='double'||type==='offset');
    if(type==='single'){near(f.width,6);near(f.depth,4);near(f.eave,3);near(f.top,5);near(f.overhang,.6);assert(f.alongX);assert(!f.hipped);}
    if(type==='double'||type==='offset')assert.notEqual(f.alongX,f.wings[0].alongX);
    if(type==='tower'){assert.equal(f.towers.length,1);near(f.top,5);}
    if(type==='hip')assert(f.hipped);
  }
});
test('V3/V4 all synthetic kits: facades, contacts, closed solids, upright placement, yield stages and measured roof silhouette',()=>{
  for(const type of ['single','double','offset','l','tower','porch','entrance','hip','store','gableFront'])for(const variant of [0,1]){
    const s=volumeKit(type),f=houseFrame(type==='tower'?'boathouse':type==='l'?'mansion':type==='store'?'storehouse':'townhouse',s[0].positions,1,s),m=buildHouse(f,variant);
    checkShape(m);checkUprightPlacements(m);assert(m.triangles<=houseTriangleLimit(f),type+': '+m.triangles);silhouetteCheck(s,m);
    const front=m.openings.filter(o=>o.kind==='door'||o.kind==='shed');assert(front.length);assert(front.every(o=>o.face===f.front&&o.volume===f.frontVolume));
    for(const o of m.openings){const owner=[f,...f.wings].find(f=>f.volume===o.volume);assert(!owner.contacts.some(c=>c.face===o.face));}
    if(f.porches.length){assert(m.solids.some(p=>p.label==='porch roof'));assert.equal(m.solids.filter(p=>p.label==='porch post').length,2);}
    if(f.towers.length){const parts=m.solids.filter(p=>p.label.startsWith('tower '));assert(parts.reduce((s,p)=>s+p.count/3,0)<=120);assert.equal(parts.filter(p=>p.label==='tower post').length,4);}
    // Closed shells for added roofs, towers and posts. Hidden contact faces keep their existing omission rule.
    for(const p of m.solids.filter(p=>p.label.startsWith('tower ')||p.label.startsWith('porch '))){const edges=new Map();for(let i=p.start*3;i<(p.start+p.count)*3;i+=9){const ids=[0,3,6].map(j=>Array.from(m.positions.slice(i+j,i+j+3)).join(','));for(let j=0;j<3;j++){const key=[ids[j],ids[(j+1)%3]].sort().join('|');edges.set(key,(edges.get(key)??0)+1);}}assert([...edges.values()].every(v=>v===2));}
    let stages=0;for(const _ of houseBuildSteps(f,variant))stages++;assert(stages>=10&&stages<64);
  }
  // The previous whole-kit frame fails (b): one roof instead of two, with a low eave stretching to the other body's high ridge.
  const s=volumeKit('double'),old=houseFrame('townhouse',s[0].positions),merged=buildHouse(old);
  assert.throws(()=>silhouetteCheck(s,merged),assert.AssertionError);
});
test('private V1–V4 every kind/variant has matching roof silhouette and bounded cost', {skip:!process.env.KZ_WORLD_DIR&&'private input not set'},async t=>{
  const dir=process.env.KZ_WORLD_DIR,doc=parseGlb(await fs.readFile(path.join(dir,'houses_kit.glb'))),catalog=JSON.parse(await fs.readFile(path.join(dir,'houses.json'),'utf8'));let kinds=0,double=0,maxTriangles=0,maxDifference=0;const families={};
  for(const n of doc.json.nodes)if(n.mesh!==undefined&&houseFamily(n.name)){
    const s=doc.json.meshes[n.mesh].primitives.map(p=>({positions:readAccessor(doc,p.attributes.POSITION).array,indices:p.indices===undefined?null:readAccessor(doc,p.indices).array}));
    const f=houseFrame(catalog.kinds.find(k=>k.node===n.name)??n.name,s.flatMap(s=>Array.from(s.positions)),1,s);kinds++;if(f.wings.length)double++;
    for(const v of [0,1]){const m=buildHouse(f,v);assert(m.triangles<=houseTriangleLimit(f));checkShape(m);checkUprightPlacements(m);maxDifference=Math.max(maxDifference,silhouetteCheck(s,m));maxTriangles=Math.max(maxTriangles,m.triangles);
      const r=families[f.family]??=[Infinity,0];r[0]=Math.min(r[0],m.triangles);r[1]=Math.max(r[1],m.triangles);
    }
  }
  assert(kinds>0);t.diagnostic(JSON.stringify({kinds,double,maxTriangles,maxSilhouetteDifference:maxDifference,familyTriangles:families}));
});

// Perspective visibility uses the camera-to-face vector. A horizontal underside high in frame is visible from a level front camera.
test('V4 preview retains perspective-visible undersides and overlays source wire in all required views',()=>{
  const positions=[-1,4,1,1,4,1,0,4,-1,-1,0,0,0,0,-1,1,0,0],normals=Array.from({length:6},()=>[0,-1,0]).flat();
  const mesh={positions,normals};assert(previewMesh(mesh,{view:'front'}).includes('<polygon'));
  const s=volumeKit('double'),m=buildHouse(houseFrame('townhouse',s[0].positions,1,s));
  for(const view of ['top','front','side','oblique']){const svg=previewMesh(m,{view,source:s});assert(svg.includes('fill="none" stroke="'+PREVIEW.overlayColor+'"'));assert(!/NaN|Infinity/.test(svg));}
});
