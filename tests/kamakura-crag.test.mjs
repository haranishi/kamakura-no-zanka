import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as THREE from '../dist/vendor/three.module.min.js';
import { CRAG as C, CRAG_LOOK, CRAG_VERTEX_PARS, CRAG_VERTEX, CRAG_FRAGMENT_PARS, CRAG_FRAGMENT, CRAG_NORMAL, cragRockTone, CRAG_LARGE_JOINT, cragHash3, cragLargeJoint, cragFine, cragGrass, decodeCrags, cragArea, partitionCrag, buildCrags, cragLayerTone, cragOffset, cragStrong, cragNaturalOffset, naturalPoint } from '../dist/valley/kamakura-crag.js';
import { decodeWorks } from '../dist/valley/kamakura-works.js';
import { createKamakuraCrag, cragShader } from '../dist/valley/kamakura-crag-view.js';
import { createKamakuraLayers } from '../dist/valley/kamakura-layers.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { loadKamakura } from '../dist/valley/kamakura-data.js';
import { fixture } from './helpers/kamakura-fixture.mjs';
const rect=(id='outcrop',w=24,h=12)=>({id,xy_m:[[0,0],[w,0],[w,h],[0,h]]});
const terrain={heightAt:(x,z)=>2+x*.7-z*.15,groundColorAt:()=>[.2,.28,.12]};
const flat={heightAt:()=>2,groundColorAt:()=>[.2,.28,.12]};
const source=crags=>({schema:'kz-works/0.1',crags});
const near=(a,b,e=1e-6)=>assert(Math.abs(a-b)<e,`${a} != ${b}`);
function intersect(poly,other) {
  let result=poly;
  for(let i=0;i<other.length;i++) {
    const a=other[i],b=other[(i+1)%other.length],dx=b[0]-a[0],dy=b[1]-a[1],next=[];
    const dist=p=>dx*(p[1]-a[1])-dy*(p[0]-a[0]);
    if(!result.length)return [];
    let p=result.at(-1),d=dist(p);
    for(const q of result){const f=dist(q);if((d>=0)!==(f>=0)){const t=d/(d-f);next.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}if(f>=0)next.push(q);p=q;d=f;}
    result=next;
  }
  return result;
}

test('crag input: absent/empty preserves the complete legacy works result',()=>{
  const old=decodeWorks({schema:'kz-works/0.1'});
  assert.deepEqual(old,{schema:'kz-works/0.1',rocks:[],piers:[],moorings:[],fences:[]});
  assert.deepEqual(decodeWorks(source([])),old);
  const r=decodeWorks(source([rect()])).crags[0];near(r.cell_m,1.9);near(r.step_m,1.1);near(r.grain_deg,90);near(r.lift_m,.45);near(r.rise_m,0);
  const reverse=rect();reverse.xy_m.reverse();near(decodeCrags([reverse])[0].area,288);
  assert.equal(buildCrags([],{}).triangles,0);
});

test('crag input: finite strict ranges, convexity, counts, areas and cross-kind ids',()=>{
  const bad=[r=>r.id='',r=>r.id=3,r=>r.xy_m=null,r=>r.xy_m=[[0,0],[2,0]],r=>r.xy_m[0]=[NaN,0],r=>r.xy_m[0]=[0,0,0],
    r=>r.xy_m=[[0,0],[2,0],[0,2]],r=>r.xy_m=[[0,0],[50,0],[50,40],[0,40]],r=>r.xy_m=[[0,0],[8,0],[4,2],[8,8],[0,8]],
    r=>r.xy_m=[[0,0],[5,5],[0,5],[5,0]],r=>r.xy_m=[[0,0],[10,0],[10,0],[0,10]],r=>r.xy_m[0]=[C.coordinate+1,0],
    r=>r.cell_m=.9,r=>r.cell_m=4.1,r=>r.cell_m='2',r=>r.step_m=.39,r=>r.step_m=2.01,r=>r.grain_deg=-1,r=>r.grain_deg=181,
    r=>r.lift_m=-.1,r=>r.lift_m=1.6,r=>r.rise_m=-1,r=>r.rise_m=11,r=>r.rise_m=null,
    r=>r.xy_m=Array.from({length:17},(_,i)=>[8*Math.cos(i/17*Math.PI*2),8*Math.sin(i/17*Math.PI*2)])];
  for(const mutate of bad){const r=rect();mutate(r);assert.throws(()=>decodeWorks(source([r])),/港の作り物/);}
  for(const crags of [null,{},[null],Array.from({length:17},(_,i)=>rect('c'+i)),[rect('same'),rect('same')],Array.from({length:4},(_,i)=>rect('c'+i,30,45))])assert.throws(()=>decodeWorks(source(crags)));
  for(const other of [
    {rocks:[{id:'same',shape:'disc',x:0,y:0,radius:3,count:2,size_m:[1,2]}]},
    {piers:[{id:'same',xy_m:[[0,0],[0,4]],width_m:1,deck_m:1}]},
    {fences:[{id:'same',kind:'rail',xy_m:[[0,0],[1,0]],height_m:1}]}
  ])assert.throws(()=>decodeWorks({...source([rect('same')]),...other}));
  assert.doesNotThrow(()=>decodeCrags([{...rect('limits',3,2),cell_m:1,step_m:.4,lift_m:0,rise_m:10,grain_deg:180}]));
});

test('partition: deterministic clipped coverage, no overlaps, symmetric shared edges for rotated convex contours',()=>{
  const shapes=[rect(),{...rect('diagonal'),xy_m:[[0,0],[19,8],[12,20],[-5,9]],grain_deg:130},
    {...rect('slivers'),xy_m:[[0,0],[50,0],[0,1]],cell_m:1}, {...rect('collinear'),xy_m:[[0,0],[12,0],[24,0],[24,12],[0,12]]}];
  for(const input of shapes) {
    const r=decodeCrags([input])[0],cells=partitionCrag(r);assert.deepEqual(cells,partitionCrag(r));
    near(cells.reduce((sum,c)=>sum+c.area,0),r.area,1e-5);
    for(let i=0;i<cells.length;i++) {
      const c=cells[i];assert(c.area>=C.minArea);near(Math.abs(cragArea(intersect(c.polygon,r.xy_m))),c.area,1e-5);
      for(let j=i+1;j<cells.length;j++){const overlap=intersect(c.polygon,cells[j].polygon);assert(overlap.length<3||Math.abs(cragArea(overlap))<1e-6);}
      for(let e=0;e<c.neighbors.length;e++)if(c.neighbors[e]>=0) {
        const n=cells[c.neighbors[e]],opposite=n.neighbors.indexOf(i);assert(opposite>=0);
        const a=c.polygon[e],b=c.polygon[(e+1)%c.polygon.length],d=n.polygon[opposite],f=n.polygon[(opposite+1)%n.polygon.length];
        near(Math.hypot(a[0]-f[0],a[1]-f[1]),0);near(Math.hypot(b[0]-d[0],b[1]-d[1]),0);
      }
    }
  }
});

test('height: corrected terrain sampler, clearance, buried foot and shared bed phase',()=>{
  const f=fixture({width:65,height:65,slope:.7});f.meta.ground={};f.ground=new Uint8Array(65*65*3).fill(128);const t=createKamakuraTerrain(f);
  const input={...rect(),step_m:.6,rise_m:3},plan=buildCrags([input],t,{dip:false}).plans[0];
  for(const b of plan.blocks) {
    const heights=[b.point,...b.polygon].map(p=>t.heightAt(p[0],-p[1]));
    near(b.gMin,Math.min(...heights));near(b.gMax,Math.max(...heights));
    assert(b.top>=b.gMax+C.clearance-1e-9);assert(b.base<=b.gMin-C.embed+1e-9);
    const layer=(b.top-plan.phase)/plan.step;assert(Math.abs(layer-Math.round(layer))<=C.heightJitter+1e-9);
    assert(b.neighbors.every(n=>n<0||plan.blocks[n].phase===b.phase));
  }
  assert.throws(()=>buildCrags([rect()],{...flat,heightAt:()=>NaN}),/高さ/);
  assert.throws(()=>buildCrags([rect()],{...flat,groundColorAt:()=>null}),/色/);
});

test('height: smooth rise increases with distance from the contour on a flat terrain',()=>{
  const r={...rect('rise',32,32),rise_m:10},raised=buildCrags([r],flat),base=buildCrags([{...r,rise_m:0}],flat);
  const cells=raised.plans[0].blocks,dist=b=>Math.min(b.point[0],32-b.point[0],b.point[1],32-b.point[1]);
  const sorted=cells.slice().sort((a,b)=>dist(a)-dist(b));
  for(let i=1;i<sorted.length;i++)assert(sorted[i].rise>=sorted[i-1].rise-1e-9);
  assert(sorted.at(-1).top>sorted[0].top+5);assert(raised.plans[0].blocks.some((b,i)=>b.top>base.plans[0].blocks[i].top));
});

function verifyGeometry(result) {
  assert(result.triangles>0);assert(result.positions.every(Number.isFinite));assert(result.normals.every(Number.isFinite));assert(result.colors.every(Number.isFinite));
  for(let i=0;i<result.positions.length;i+=9) {
    const p=result.positions,a=[p[i+3]-p[i],p[i+4]-p[i+1],p[i+5]-p[i+2]],b=[p[i+6]-p[i],p[i+7]-p[i+1],p[i+8]-p[i+2]];
    const cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],area=Math.hypot(...cross);assert(area>1e-9);
    const n=result.normals.slice(i,i+3);near(Math.hypot(...n),1);assert(cross.reduce((s,v,k)=>s+v*n[k],0)>0);
    const face=result.faces[i/9],block=result.plans.find(p=>p.id===face.id).blocks[face.block];
    if(['rock','soil','bevel'].includes(face.kind))assert(n[1]>0);
    if(face.kind==='wall') {
      if(!block.bed)near(n[1],0);
      const a=block.polygon[face.edge],b=block.polygon[(face.edge+1)%block.polygon.length],out=[b[1]-a[1],b[0]-a[0]];
      assert(n[0]*out[0]+n[2]*out[1]>0);
      const neighbor=block.neighbors[face.edge];
      if(neighbor>=0){const other=result.plans.find(p=>p.id===face.id).blocks[neighbor];
        if(block.bed){assert(block.bedTop-block.bevel>other.bedTop-other.bevel);for(let k=0;k<3;k++)assert(p[i+3*k+1]-result.beds[i/3+k]>=Math.max(block.bedBase,other.bedTop-other.bevel)-1e-4);}
        else {assert(block.top>other.top);assert(Math.min(p[i+1],p[i+4],p[i+7])>=other.top-1e-5);}}
    }
  }
}

test('geometry: high side only, exact shared-wall foot, upward caps and outward flat wall normals',()=>{
  const r=buildCrags([{...rect(),rise_m:5}],terrain,{dip:false});verifyGeometry(r);
  for(const plan of r.plans)for(const b of plan.blocks)for(let e=0;e<b.neighbors.length;e++) {
    const n=b.neighbors[e];if(n<0||b.top<=plan.blocks[n].top+C.bevelMax)continue;
    const faces=r.faces.map((f,i)=>({f,i})).filter(({f})=>f.kind==='wall'&&f.id===b.id&&f.block===b.index&&f.edge===e);
    assert(faces.length);let bottom=Infinity;
    for(const {i} of faces)for(let k=1;k<9;k+=3)bottom=Math.min(bottom,r.positions[i*9+k]);
    near(bottom,Math.max(b.base,plan.blocks[n].top),1e-5);
  }
  const light=buildCrags([{...rect(),rise_m:5}],terrain,{quality:'light',dip:false});verifyGeometry(light);assert(!light.faces.some(f=>f.kind==='bevel'));assert(light.triangles<r.triangles);
});

test('colour: shared bed tones and majority bed offset direction, soil caps retain source ground colour',()=>{
  const r=buildCrags([rect('soil',40,35)],flat),blocks=r.plans[0].blocks,eligible=blocks.filter(b=>b.top-b.gMax<=C.soilHeight);
  const rate=eligible.filter(b=>b.soil).length/eligible.length;assert(rate>=.55&&rate<=.75);
  for(let i=0;i<r.faces.length;i++)if(r.faces[i].kind==='soil')for(let k=0;k<9;k++)near(r.colors[i*9+k],flat.groundColorAt()[k%3]);
  const values=[];for(let layer=0;layer<20;layer++){const tone=cragLayerTone('soil',layer);values.push(tone);assert(tone>=1-C.darkShade&&tone<=1+C.bandVariation);assert.equal(tone,cragLayerTone('soil',layer));}
  const dark=values.filter(t=>t===1-C.darkShade).length;assert(dark>=4&&dark<=7);
  let agree=0,total=0;for(let layer=0;layer<20;layer++)for(let b=0;b<100;b++){if(Math.sign(cragOffset('soil',b,layer))===Math.sign(cragOffset('soil',b+100,layer)))agree++;total++;}
  assert(agree/total>.6);
  const debug=buildCrags([rect()],flat,{debug:true});for(let i=0;i<debug.faces.length;i++){const kind=debug.faces[i].kind==='ledge'?'wall':debug.faces[i].kind;assert.deepEqual(Array.from(debug.colors.slice(i*9,i*9+3)),C.debug[kind]);}
});

test('budget: large steep synthetic inputs uniformly coarsen within both quality caps',()=>{
  const items=Array.from({length:4},(_,i)=>({...rect('large'+i,35,35),cell_m:1,step_m:.4}));
  const steep={...flat,heightAt:(x,z)=>Math.min(12,Math.max(0,x*Math.tan(75*Math.PI/180)))+z*.05};
  for(const quality of ['standard','light']) {
    const r=buildCrags(items,steep,{quality});assert(r.triangles<=(quality==='light'?C.lightTriangles:C.triangles));assert(r.scale>1);assert.equal(r.draws,1);
    for(const p of r.plans)near(p.cell,r.scale);
    assert(r.work.attempts>1);assert(r.work.clips>0);verifyGeometry(r);
    console.log('crag synthetic budget',quality,JSON.stringify({crags:r.plans.length,blocks:r.blocks,triangles:r.triangles,draws:r.draws,scale:r.scale,tallest:r.tallest,work:r.work}));
  }
});

function context(search='?debug=1',crags=[rect()]) {
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();camera.position.set(12,55,95);
  return {search,data:{works:source(crags)},terrain,scene,camera,quality:'standard'};
}

test('view: flags and absent data add nothing; four attributes, one material, shadows, one named surface shader',()=>{
  for(const search of ['?crag=0','?layers=0','?works=0']){const c=context(search);assert.equal(createKamakuraCrag(c),null);assert.equal(c.scene.children.length,0);}
  for(const crags of [undefined,[]]){const c=context();c.data.works.crags=crags;assert.equal(createKamakuraCrag(c),null);assert.equal(c.scene.children.length,0);}
  const c=context(),layer=createKamakuraCrag(c),m=layer.mesh;
  assert.equal(c.scene.children.length,1);assert.deepEqual(Object.keys(m.geometry.attributes).sort(),['color','cragBed','normal','position']);
  assert(m.material.isMeshStandardMaterial);assert.equal(m.material.roughness,.96);assert.equal(m.material.metalness,0);assert(m.material.vertexColors&&m.material.fog);assert(m.castShadow&&m.receiveShadow);assert.equal(m.material.onBeforeCompile,cragShader);assert.equal(m.material.customProgramCacheKey(),'kamakura-crag-look');
  for(const search of ['?craglook=0','?cragdebug=1']){const plain=createKamakuraCrag(context(search));assert.equal(plain.mesh.material.onBeforeCompile,THREE.Material.prototype.onBeforeCompile,search);plain.dispose();}
  const inspect=globalThis.__kzCrag,stats=inspect();assert.equal(stats.draws,1);assert.equal(stats.crags,1);assert(stats.blocks>0);assert(stats.tallest>0);assert.equal(stats.nearest.id,'outcrop');assert(stats.nearest.distance>0);assert(stats.nearest.bearing>=0&&stats.nearest.bearing<360);
  let released=0;for(const lod of layer.lods)lod.geometry.addEventListener('dispose',()=>released++);m.material.addEventListener('dispose',()=>released++);
  layer.dispose();layer.dispose();assert.equal(released,5);assert.equal(c.scene.children.length,0);assert.equal(globalThis.__kzCrag,undefined);assert.equal(inspect().draws,0);
});

test('view: adaptive counts and reach reduce, cached geometry only, culling restores on camera return',()=>{
  const c=context(),layer=createKamakuraCrag(c),arrays=layer.lods.map(l=>l.geometry.attributes.position.array),counts=[];
  for(let step=0;step<4;step++){layer.setAdapt(step);const s=globalThis.__kzCrag();counts.push(s.blocks);assert(s.triangles<=C.triangles);assert.equal(s.draws,1);}
  assert(counts.at(-1)<counts[0]);assert.deepEqual(layer.lods.map(l=>l.geometry.attributes.position.array),arrays);
  c.camera.position.set(0,0,2000);layer.update({camera:c.camera});assert.equal(globalThis.__kzCrag().draws,0);assert.equal(globalThis.__kzCrag().nearest,null);
  c.camera.position.set(12,55,95);layer.update({camera:c.camera});assert.equal(globalThis.__kzCrag().draws,1);layer.dispose();
  const quiet=context('');const l=createKamakuraCrag(quiet);assert.equal(globalThis.__kzCrag,undefined);l.dispose();
});

test('loader: works crags reach the layer without modifying the authored input',async()=>{
  const f=fixture({width:3,height:3});f.meta.works={file:'works.json'};
  const data=source([rect()]),copy=structuredClone(data),fetcher=async url=>({ok:true,json:async()=>url.endsWith('meta.json')?f.meta:data,arrayBuffer:async()=>url.endsWith('height_u16.bin')?f.heights.buffer:f.walk.buffer});
  const loaded=await loadKamakura(fetcher,'?townfill=0');assert.equal(loaded.works.crags.length,1);assert.deepEqual(data,copy);
  const c=context();c.data=loaded;const layer=createKamakuraCrag(c);assert(layer);layer.dispose();
});

test('registry: optional outcrops follow works and close through the common layer lifecycle',async()=>{
  const c=context('?debug=1&herolife=0'),reports=[];
  const layers=await createKamakuraLayers(c,{report:(name,error)=>reports.push({name,error})});
  assert.deepEqual(reports,[]);assert(layers.names.includes('crag'));
  assert.equal(layers.names.indexOf('crag'),layers.names.indexOf('works')+1);
  assert(globalThis.__kzCrag().blocks>0);layers.setAdapt(3);assert.equal(globalThis.__kzCrag().draws,1);
  layers.dispose();assert.equal(globalThis.__kzCrag,undefined);
  c.data.works.crags=[];
  const old=await createKamakuraLayers(c,{report:(name,error)=>reports.push({name,error})});
  assert(!old.names.includes('crag'));old.dispose();assert.deepEqual(reports,[]);
});

test('optional private world: sampling and renderer stay bounded without fixed private values',async t=>{
  const root=process.env.KZ_WORLD_DIR;if(!root){t.skip('KZ_WORLD_DIR absent');return;}
  const fetcher=async url=>{const name=String(url).split('/').at(-1),bytes=await fs.readFile(path.join(root,name));return {ok:true,json:async()=>JSON.parse(bytes),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};};
  const data=await loadKamakura(fetcher,'?townfill=0'),tform=createKamakuraTerrain(data);
  for(const quality of ['standard','light']){const result=buildCrags([rect('synthetic-probe')],tform,{quality});assert(result.triangles<=(quality==='light'?C.lightTriangles:C.triangles));}
});

test('look: rock is darker and greyer than its cliff colour; the surface shader enters at real anchors, once',()=>{
  const cliff=[.52,.5,.62],rock=cragRockTone(cliff),lum=c=>.2126*c[0]+.7152*c[1]+.0722*c[2],spread=c=>Math.max(...c)-Math.min(...c);
  assert(lum(rock)<lum(cliff)*.75&&lum(rock)>lum(cliff)*.45);assert(spread(rock)/lum(rock)<spread(cliff)/lum(cliff));
  assert(CRAG_LOOK.grainLow<1&&CRAG_LOOK.grainHigh>1&&CRAG_LOOK.groove<.5&&CRAG_LOOK.jointWidth<.5&&CRAG_LOOK.fineFrom<CRAG_LOOK.fineTo&&CRAG_LOOK.wallFrom<CRAG_LOOK.wallTo);
  const standard=THREE.ShaderLib.standard,shader=cragShader({vertexShader:standard.vertexShader,fragmentShader:standard.fragmentShader});
  for(const [text,chunk]of [[shader.vertexShader,CRAG_VERTEX_PARS],[shader.vertexShader,CRAG_VERTEX],[shader.fragmentShader,CRAG_FRAGMENT_PARS],[shader.fragmentShader,CRAG_FRAGMENT],[shader.fragmentShader,CRAG_NORMAL]])assert.equal(text.split(chunk).length,2);
  assert(shader.vertexShader.indexOf('#include <beginnormal_vertex>')<shader.vertexShader.indexOf(CRAG_VERTEX),'objectNormal is declared before it is read');
  assert(shader.fragmentShader.indexOf('#include <color_fragment>')<shader.fragmentShader.indexOf(CRAG_FRAGMENT));
  assert(shader.fragmentShader.indexOf(CRAG_FRAGMENT)<shader.fragmentShader.indexOf(CRAG_NORMAL),'the relief is computed before the normal reads it');
  assert(THREE.ShaderChunk.normal_fragment_begin.includes('vec3 normal')&&standard.fragmentShader.includes('varying vec3 vViewPosition'));
  // Beds stay in order: the uneven thickness never folds a bed back on itself.
  assert(CRAG_LOOK.unevenGain*CRAG_LOOK.uneven*1.5<1/CRAG_LOOK.bed);
  assert.throws(()=>cragShader({vertexShader:'void main(){}',fragmentShader:standard.fragmentShader}),/anchor/);
});
test('look: emitted GLSL is balanced, float-only and free of reserved or undeclared names',t=>{
  for(const text of [CRAG_VERTEX_PARS,CRAG_VERTEX,CRAG_FRAGMENT_PARS,CRAG_FRAGMENT,CRAG_NORMAL]){
    for(const [open,close]of ['()','{}','[]'])assert.equal(text.split(open).length,text.split(close).length,open);
    assert(!/--\d|\+\+\d/.test(text));assert(!/\b(?:sample|input|output|filter|common|partition|active|texture)\b\s*=/.test(text));
    // Every numeric literal carries a decimal point: no int/float mixing.
    for(const n of text.replace(/vec[234]|mat[34]|cragHash3/g,'').match(/(?<![\w.])\d+(?![\w.])/g)||[])assert.fail('integer literal '+n);
  }
  const version=spawnSync('glslc',['--version'],{encoding:'utf8'});if(version.error?.code==='ENOENT')return t.skip('glslc unavailable');assert.equal(version.status,0);
  const dir=fsSync.mkdtempSync(path.join(os.tmpdir(),'crag-glsl-'));
  try{
    const stages={
      'crag.vert':'#version 310 es\nprecision highp float;\n#define varying out\n#define attribute in\nin vec3 position;in vec3 normal;uniform mat4 modelMatrix;\n'+CRAG_VERTEX_PARS+'\nvoid main(){vec3 transformed=position;vec3 objectNormal=normal;\n'+CRAG_VERTEX+'\ngl_Position=vec4(transformed,1.0);}',
      'crag.frag':'#version 310 es\nprecision highp float;\n#define varying in\nout vec4 cragOut;\nin vec3 vViewPosition;\n'+CRAG_FRAGMENT_PARS+'\nvoid main(){vec4 diffuseColor=vec4(1.0);vec3 normal=vec3(0.0,0.0,1.0);\n'+CRAG_FRAGMENT+'\n'+CRAG_NORMAL+'\ncragOut=vec4(diffuseColor.rgb*normal.z,1.0);}'};
    const compile=(name,text)=>{const file=path.join(dir,name);fsSync.writeFileSync(file,text);return spawnSync('glslc',['--target-env=opengl','-fauto-bind-uniforms','-fauto-map-locations',file,'-o',path.join(dir,'out.spv')],{encoding:'utf8'});};
    for(const [name,text]of Object.entries(stages)){const result=compile(name,text);assert.equal(result.status,0,result.stderr);}
    assert.notEqual(compile('bad.frag',stages['crag.frag'].replace('vCragWorld,normalize','vMissingWorld,normalize')).status,0);
    assert.notEqual(compile('bad2.frag',stages['crag.frag'].replace('float tone=cragHash3','int tone=cragHash3')).status,0);
    t.diagnostic('2 shader stages compiled; undeclared-name and numeric-type mutations rejected');
  }finally{fsSync.rmSync(dir,{recursive:true,force:true});}
});

test('dip input: optional angles survive works decoding and reject non-finite or out-of-range values',()=>{
  for(const [key,max] of [['dip_deg',25],['dip_to_deg',360],['face_deg',360]]) {
    for(const value of [-1,max+.01,NaN,Infinity,null,'9'])assert.throws(()=>decodeWorks(source([{...rect(),[key]:value}])));
    for(const value of [0,max])assert.equal(decodeCrags(decodeWorks(source([{...rect(),[key]:value}])).crags)[0][key],value);
  }
  assert.equal(decodeCrags([rect()])[0].dip_deg,9);
});

test('dip fallback: zero angle and URL flag retain identical legacy positions, normals and colours in every LOD',()=>{
  const input={...rect('legacy'),rise_m:4,dip_deg:18,dip_to_deg:300};
  for(const quality of ['standard','light'])for(let step=0;step<4;step++) {
    const off=buildCrags([input],terrain,{quality,step,dip:false}),zero=buildCrags([{...input,dip_deg:0}],terrain,{quality,step});
    for(const name of ['positions','normals','colors'])assert.deepEqual(off[name],zero[name]);
    assert(off.beds.every(v=>v===0));assert.equal(off.strong,0);assert.equal(off.lowered,0);
  }
  const c=context('?debug=1&cragdip=0'),layer=createKamakuraCrag(c),baseline=buildCrags(c.data.works.crags,terrain,{dip:false});
  assert.deepEqual(layer.mesh.geometry.attributes.position.array,baseline.positions);
  assert(globalThis.__kzCrag().dip.every(d=>d.degrees===0));layer.dispose();
});

test('dip planes: caps and wall beds share the authored gradient and phase; every uploaded cap clears terrain',()=>{
  for(const dip_to_deg of [0,95,220])for(const quality of ['standard','light']) {
    const input={...rect('inclined'),dip_deg:25,dip_to_deg,rise_m:5},r=buildCrags([input],terrain,{quality});verifyGeometry(r);
    const plan=r.plans[0];let tilted=false,bedBoundaries=0;
    for(const b of plan.blocks){const h=(b.bedTop-plan.phase)/plan.step;assert(Math.abs(h-Math.round(h))<=C.heightJitter+1e-8);}
    for(let i=0;i<r.faces.length;i++) {
      const face=r.faces[i],b=plan.blocks[face.block];
      for(let k=0;k<3;k++) {
        const at=i*9+k*3,x=r.positions[at],y=r.positions[at+1],north=-r.positions[at+2],bed=r.beds[i*3+k];
        near(bed,(x-b.bed.origin[0])*b.bed.east+(north-b.bed.origin[1])*b.bed.north,1e-5);
        if(face.kind==='rock'||face.kind==='soil') {
          const samples=[...b.cap.map((p,i)=>[p,b.bedTop+b.capHeights[i]]),[b.hub,b.hubBed]];
          assert(samples.some(([p,h])=>Math.hypot(p[0]-x,p[1]-north)<1e-4&&Math.abs(y-bed-h)<1e-4));
          assert(y>=terrain.heightAt(x,-north)+C.clearance-1e-4);
          if(Math.abs(r.normals[i*9+1]-1)>.001)tilted=true;
        }
        if(face.kind==='wall'){const h=(y-bed-b.phase)/b.step;assert(h>=face.layer-(quality==='light'?1:0)-1e-4&&h<=face.layer+(quality==='light'?2:1)+1e-4);if(Math.abs(h-Math.round(h))<1e-4)bedBoundaries++;}
      }
    }
    assert(tilted&&bedBoundaries>0);assert(CRAG_FRAGMENT_PARS.includes('p.y-vCragBed'));
  }
});

test('lean and seams: shared corners coincide through every bed, and uploaded high walls meet the lower bevel rim',()=>{
  const r=buildCrags([{...rect('seams'),rise_m:5}],terrain),plan=r.plans[0];verifyGeometry(r);let joins=0,slopes=0;
  const coords=i=>Array.from(r.positions.slice(i,i+3));
  for(const b of plan.blocks) {
    assert(b.lean>=3&&b.lean<=9);
    for(const p of b.polygon) {
      const v=p.corner,lo=v.anchor+v.limit/v.slope*.1,hi=v.anchor+v.limit/v.slope*.2,a=naturalPoint(p,lo),d=naturalPoint(p,hi);
      near(Math.hypot(d[0]-a[0],d[1]-a[1])/(hi-lo),v.slope);assert((d[0]-a[0])*v.dx+(d[1]-a[1])*v.dy>0);slopes++;
      for(let layer=Math.floor((b.bedBase-b.phase)/b.step);layer<(b.bedTop-b.phase)/b.step;layer++) {
        const start=b.phase+layer*b.step,end=start+b.step,knots=[start,...v.knots.filter(h=>h>start&&h<end),end].sort((a,b)=>a-b),offset=cragNaturalOffset(b.id,layer);
        for(let k=1;k<knots.length;k++)if(knots[k]-knots[k-1]>C.epsilon) {
          const a=naturalPoint(p,knots[k-1],offset),d=naturalPoint(p,knots[k],offset),mid=naturalPoint(p,(knots[k-1]+knots[k])/2,offset);
          near(mid[0],(a[0]+d[0])/2);near(mid[1],(a[1]+d[1])/2);
        }
      }
    }
    for(let e=0;e<b.neighbors.length;e++) {
      const index=b.neighbors[e];if(index<0)continue;
      const other=plan.blocks[index],oe=other.neighbors.indexOf(b.index);
      for(const [p,q] of [[b.polygon[e],other.polygon[(oe+1)%other.polygon.length]],[b.polygon[(e+1)%b.polygon.length],other.polygon[oe]]]) {
        for(const h of [b.bedTop,other.bedTop,b.bedTop-b.step,other.bedTop+other.step]) {
          const layer=Math.floor((h-b.phase)/b.step),a=naturalPoint(p,h,cragNaturalOffset(plan.id,layer)),d=naturalPoint(q,h,cragNaturalOffset(plan.id,layer));
          near(a[0],d[0],1e-7);near(a[1],d[1],1e-7);
        }
      }
      if(b.bedTop-b.bevel<=other.bedTop-other.bevel+1e-6)continue;
      const high=[],low=[],height=other.bedTop-other.bevel;
      for(let i=0;i<r.faces.length;i++) {
        const f=r.faces[i];if(f.id!==b.id)continue;
        if((f.block===b.index&&f.edge===e)||(f.block===other.index&&f.edge===oe&&f.kind==='bevel'))for(let k=0;k<3;k++) {
          const at=i*9+k*3;if(Math.abs(r.positions[at+1]-r.beds[i*3+k]-height)<1e-4)(f.block===b.index?high:low).push(coords(at));
        }
      }
      assert(low.length>=2);for(const p of low)assert(high.some(q=>Math.hypot(...p.map((v,k)=>v-q[k]))<1e-5),'shared rim vertex must exist in uploaded high wall');joins++;
    }
  }
  assert(joins>0&&slopes>0);
});

test('strong beds: one in four to six, continuous offsets, downward undersides and darker cavities',()=>{
  for(const id of ['beds-a','beds-b','beds-c']) {
    let strong=0,positive=0,negative=0;
    for(let layer=-120;layer<120;layer++) {
      const kind=cragStrong(id,layer),offset=cragNaturalOffset(id,layer);if(kind)strong++;
      if(kind>0){assert(offset>=.25&&offset<=.45);positive++;}if(kind<0){assert(offset<=-.25&&offset>=-.5);negative++;}
    }
    assert(strong/240>=1/6&&strong/240<=1/4);assert(positive&&negative);
  }
  const r=buildCrags([{...rect('underside'),rise_m:8}],terrain),down=r.faces.map((f,i)=>({f,i})).filter(({f,i})=>f.kind==='ledge'&&r.normals[i*9+1]<-.1);
  assert(down.length>0&&r.strong>0);
  for(const {f,i} of down){assert(r.normals[i*9+1]<0);const b=r.plans[0].blocks[f.block];assert(r.colors[i*9]<=b.rock[0]*cragLayerTone(b.id,f.layer)*b.tone*C.cavityGain+1e-5);}
  assert(C.rimGain===1.1&&C.cavityGain===.7&&C.hueVariation===.04);
});

test('broken tops and contour: stratified rates, corner cuts, road protection and clearance overrides',()=>{
  for(const face_deg of [undefined,220,40]) {
    const r=buildCrags([{...rect('broken',40,35),rise_m:10,face_deg}],flat),blocks=r.plans[0].blocks;
    assert.equal(blocks.filter(b=>b.topShift!==0).length,Math.round(blocks.length*.35));
    const eligible=blocks.filter(b=>b.edgeEligible),selected=eligible.filter(b=>b.edgeLower>0),corners=blocks.filter(b=>b.corner);
    assert.equal(selected.length,Math.max(corners.length,Math.round(eligible.length*.45)));
    assert(r.lowered>0);assert(blocks.some(b=>b.corner&&b.bedTop<=b.nominalBedTop-2*b.step+1e-7));
    for(const b of blocks) {
      assert(b.topShift===0||Math.abs(b.topShift)===1||Math.abs(b.topShift)===2);
      if(b.corner)assert(b.edgeLower-b.topShift>=2);
      if(b.road){assert.equal(b.edgeLower,0);assert.equal(b.corner,false);}
      assert(b.top>=2+C.clearance-1e-7);
    }
    assert(corners.length>0);assert.equal(r.lowered,blocks.filter(b=>b.bedTop<b.nominalBedTop-1e-8).length);
    assert(blocks.some(b=>b.topShift>0));assert(blocks.some(b=>b.topShift<0));
  }
});

test('diagnostics: dip, strong beds and actually lowered blocks track quality and disposal',()=>{
  const c=context('?debug=1'),layer=createKamakuraCrag(c);
  for(let step=0;step<4;step++) {
    layer.setAdapt(step);const s=globalThis.__kzCrag(),p=layer.lods[step].plan;
    assert.deepEqual(s.dip,p.plans.map(p=>({id:p.id,degrees:p.dip,bearing:p.direction})));assert.equal(s.strong,p.strong);assert.equal(s.lowered,p.lowered);assert.equal(s.folded,p.folded);assert.equal(s.bent,p.bent);
    assert.equal(layer.mesh.geometry.attributes.cragBed.itemSize,4);assert.equal(Object.keys(layer.mesh.geometry.attributes).length,4);
  }
  const inspect=globalThis.__kzCrag;layer.dispose();assert.equal(inspect().strong,0);assert.equal(inspect().lowered,0);
});

test('natural caps: deterministic, non-overlapping triangles cover concave caps without filling the notches',()=>{
  const input=[{...rect('concave'),rise_m:5}],r=buildCrags(input,terrain),again=buildCrags(input,terrain);
  assert.deepEqual(r.positions,again.positions);assert.deepEqual(r.beds,again.beds);
  for(const b of r.plans[0].blocks) {
    const triangles=[];
    for(let i=0;i<r.faces.length;i++)if(r.faces[i].block===b.index&&['rock','soil'].includes(r.faces[i].kind)) {
      const poly=Array.from({length:3},(_,k)=>[r.positions[i*9+k*3],-r.positions[i*9+k*3+2]]);if(cragArea(poly)<0)poly.reverse();triangles.push(poly);
    }
    assert(triangles.length>0);
    for(let i=0;i<triangles.length;i++)for(let j=i+1;j<triangles.length;j++){const p=intersect(triangles[i],triangles[j]);assert(p.length<3||Math.abs(cragArea(p))<1e-6,JSON.stringify({block:b.index,i,j,area:cragArea(p),triangles}));}
  }
  const layer=createKamakuraCrag(context('?debug=1'));layer.update({camera:{position:{x:0,y:0,z:10000}}});
  const s=globalThis.__kzCrag();assert.deepEqual(s.dip,[]);assert.equal(s.strong,0);assert.equal(s.lowered,0);layer.dispose();
});

test('folded roofs: three or four planar sectors, upward normals, terrain clearance and seven-to-three hub signs',()=>{
  const ground={...flat,heightAt:(x,z)=>2+Math.sin(x*1.9)*.3+Math.cos(z*1.7)*.25};
  for(const quality of ['standard','light']) {
    const r=buildCrags([{...rect('folds',40,35),rise_m:4}],ground,{quality}),blocks=r.plans[0].blocks;
    near(blocks.filter(b=>b.fold<0).length/blocks.length,.3,.1);assert.equal(r.folded,blocks.length);verifyGeometry(r);
    for(const b of blocks) {
      // The roof height follows the tuning constants (lowered after pyramids read as crystals in a real browser): below a layer, above flat.
      assert(C.foldMin>.05&&C.foldMax<=.6&&C.foldMax>C.foldMin);assert(Math.abs(b.fold)/b.step>=C.foldMin-1e-9&&Math.abs(b.fold)/b.step<=C.foldMax+1e-9);
      assert(b.roofFaces>=2&&b.roofFaces<=4);
      const normalGroups=[];
      for(let i=0;i<r.faces.length;i++)if(r.faces[i].block===b.index&&['rock','soil'].includes(r.faces[i].kind)) {
        const n=Array.from(r.normals.slice(i*9,i*9+3));assert(n[1]>0);
        if(!normalGroups.some(g=>Math.hypot(...n.map((v,k)=>v-g[k]))<1e-3))normalGroups.push(n);
        for(let k=0;k<3;k++){const at=i*9+k*3;assert(r.positions[at+1]>=ground.heightAt(r.positions[at],r.positions[at+2])+C.clearance-1e-4);}
      }
      assert(normalGroups.length>=2&&normalGroups.length<=4,'sectors must be planar after upload');
      const center=b.cap.reduce((v,p)=>[v[0]+p[0]/b.cap.length,v[1]+p[1]/b.cap.length],[0,0]);
      const width=Math.max(...b.cap.map(p=>p[0]))-Math.min(...b.cap.map(p=>p[0])),depth=Math.max(...b.cap.map(p=>p[1]))-Math.min(...b.cap.map(p=>p[1]));
      assert(Math.hypot(b.hub[0]-center[0],b.hub[1]-center[1])<=Math.max(width,depth)*C.foldShift+1e-6);
    }
  }
  const off=buildCrags([rect()],ground,{dip:false});assert.equal(off.folded,0);assert.equal(off.bent,0);
});

test('bent walls: actual midpoints displace only long outer edges, match bands and vanish in light quality',()=>{
  const r=buildCrags([{...rect('bends'),rise_m:6}],terrain);let midpoints=0;
  for(const b of r.plans[0].blocks)for(const entry of b.bentEdges??[]) {
    const e=entry.edge,a=b.polygon[e],d=b.polygon[(e+1)%b.polygon.length],length=Math.hypot(d[0]-a[0],d[1]-a[1]),nx=(d[1]-a[1])/length,ny=(a[0]-d[0])/length;
    assert.equal(b.neighbors[e],-1);assert(length>=2.2);assert(Math.abs(entry.displacement)>=.12&&Math.abs(entry.displacement)<=.35);
    for(let i=0;i<r.faces.length;i++)if(r.faces[i].block===b.index&&r.faces[i].edge===e&&r.faces[i].kind==='wall')for(let k=0;k<3;k++) {
      const at=i*9+k*3,h=r.positions[at+1]-r.beds[i*3+k],layer=r.faces[i].layer,offset=cragNaturalOffset(b.id,layer),A=naturalPoint(a,h,offset),B=naturalPoint(d,h,offset);
      const fade=Math.max(0,Math.min(1,(b.bedTop-b.bevel-h)/C.offsetFade));
      const expected=[(A[0]+B[0])/2+nx*entry.displacement*fade,(A[1]+B[1])/2+ny*entry.displacement*fade];
      if(Math.hypot(r.positions[at]-expected[0],-r.positions[at+2]-expected[1])<1e-4)midpoints++;
    }
  }
  assert(midpoints>0);assert.equal(r.bent,r.plans[0].blocks.reduce((n,b)=>n+(b.bentEdges?.length??0),0));
  for(const quality of ['standard','light']) {
    const result=quality==='standard'?r:buildCrags([{...rect('bends'),rise_m:6}],terrain,{quality});
    if(quality==='light'){assert.equal(result.bent,0);assert(result.plans[0].blocks.every(b=>!b.bentEdges));}
    let shared=0;
    for(let i=0;i<result.faces.length;i++) {
      const f=result.faces[i],b=result.plans[0].blocks[f.block];if(f.kind!=='wall'||b.neighbors[f.edge]<0)continue;
      shared++;
      const a=b.polygon[f.edge],d=b.polygon[(f.edge+1)%b.polygon.length],layer=quality==='light'?Math.floor(f.layer/2)*2:f.layer;
      for(let k=0;k<3;k++) {
        const at=i*9+k*3,h=result.positions[at+1]-result.beds[i*3+k],offset=cragNaturalOffset(b.id,layer),A=naturalPoint(a,h,offset),B=naturalPoint(d,h,offset);
        assert([0,C.seamWidth,1-C.seamWidth,1].some(t=>Math.hypot(result.positions[at]-A[0]-(B[0]-A[0])*t,-result.positions[at+2]-A[1]-(B[1]-A[1])*t)<1e-4),'shared wall retains exactly its original horizontal stops');
      }
    }
    assert(shared>0);verifyGeometry(result);
  }
});

test('large joints: world spacing, width, wandering and thirty percent interruption; CPU and emitted GLSL agree',()=>{
  const glsl=CRAG_LARGE_JOINT.replace('float cragLargeJoint(float x,float y,float z)','function emitted(x,y,z)').replace(/float /g,'const ').replace(/cragHash3\(vec3\(([^)]+)\)\)/g,'hash($1)').replace(/\b(floor|sin|abs)\(/g,'Math.$1(');
  const smoothstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
  const emitted=Function('hash','fract','mix','smoothstep',glsl+';return emitted;')(cragHash3,x=>x-Math.floor(x),(a,b,t)=>a+(b-a)*t,smoothstep);
  const L=CRAG_LOOK,center=(i,y)=>(i+.5)*L.crackSpacing+(cragHash3(i,4.1,9.7)*2-1)*L.crackJitter+(L.crackSwayMin+(L.crackSwayMax-L.crackSwayMin)*cragHash3(i,2.3,8.1))*Math.sin(y/L.crackWave+cragHash3(i,4.1,9.7)*6.283185);
  for(let i=-12;i<=12;i++) {
    const width=L.crackWidthMin+(L.crackWidthMax-L.crackWidthMin)*cragHash3(i,6.1,1.7);assert(width>=.25&&width<=.6);
    let missing=0,visible=0;
    for(let sample=0;sample<600;sample++) {
      const y=sample/600*L.crackPeriod,c=center(i,y),spacing=center(i+1,y)-c;
      assert(spacing>=5&&spacing<=11);near(emitted(c,y,0),cragLargeJoint(c,y,0),1e-10);
      if(cragLargeJoint(c,y,0)===0)missing++;else {visible++;near(cragLargeJoint(c,y,0),1);near(cragLargeJoint(c+width*.51,y,0),0);}
      near(emitted(c-y*.13,y,y*.13/L.crackDirection),cragLargeJoint(c-y*.13,y,y*.13/L.crackDirection),1e-10);
    }
    assert(missing/600>=.15&&missing/600<=.45);assert(visible>0);
    assert(Math.abs(center(i,0)-center(i,15))>.01);
  }
});

test('fine rock detail: grooves, fine joints, per-layer tone and bump all fade before overlook pixel sizes',()=>{
  assert.equal(CRAG_LOOK.fineFrom,.012);assert.equal(CRAG_LOOK.fineTo,.05);assert.equal(CRAG_LOOK.jointKeep,.8);assert.equal(CRAG_LOOK.jointSlant,25);
  for(const pixel of [.05,.08,.14,1])assert.equal(cragFine(pixel),0);
  assert.equal(cragFine(.001),1);assert(cragFine(.03)>0&&cragFine(.03)<1);
  assert(CRAG_FRAGMENT_PARS.includes('groove*0.300000*wall*fine'));
  assert(CRAG_FRAGMENT_PARS.includes('joint*0.420000*wall*fine'));
  assert(CRAG_FRAGMENT_PARS.includes('(tone-0.5)*0.240000*wall*fine'));
  assert(CRAG_FRAGMENT_PARS.includes('cragLargeJoint(p.x,p.y,p.z)'));
});

test('grass: ground-derived packed colour, upward mask, shelf half strength and independent URL switch',()=>{
  assert(cragGrass(.87,.9)>0);assert.equal(cragGrass(.3,.9),0);assert.equal(cragGrass(-1,.9),0);assert.equal(cragGrass(1,.9,false),0);
  near(cragGrass(1,.9,true,true),cragGrass(1,.9)*.5);
  assert(CRAG_FRAGMENT_PARS.includes('step(0.870000,n.y)'));assert(CRAG_FRAGMENT_PARS.includes('mix(c,vCragGrass,grass)'));
  for(const search of ['?debug=1','?debug=1&craggrass=0']) {
    const layer=createKamakuraCrag(context(search)),shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
    layer.mesh.material.onBeforeCompile(shader);assert.equal(shader.uniforms.cragGrassStrength.value,search.includes('craggrass=0')?0:CRAG_LOOK.grassStrength);
    const r=layer.lods[0].plan;assert.equal(Object.keys(layer.mesh.geometry.attributes).length,4);
    for(let i=0;i<r.faces.length;i++) {
      const b=r.plans[0].blocks[r.faces[i].block],code=r.surface[i*12+1],rgb=[Math.floor(code/65536),Math.floor(code/256)%256,code%256].map(v=>v/255);
      for(let k=0;k<3;k++)near(rgb[k],b.source[k],1/255);
      const kind=r.faces[i].kind;assert.equal(r.surface[i*12+3],['rock','soil'].includes(kind)?1:kind==='ledge'?.5:0);
    }
    const stats=globalThis.__kzCrag();assert.equal(stats.folded,r.folded);assert.equal(stats.bent,r.bent);
    layer.update({camera:{position:{x:0,y:0,z:10000}}});assert.equal(globalThis.__kzCrag().folded,0);assert.equal(globalThis.__kzCrag().bent,0);
    const inspect=globalThis.__kzCrag;layer.dispose();assert.equal(inspect().folded,0);assert.equal(inspect().bent,0);
  }
});


test('light roofs: non-planar rim vertices have a closing curtain to the unmodified shared wall rim',()=>{
  const r=buildCrags([{...rect('light-seals'),rise_m:5}],terrain,{quality:'light'});let sealed=0;
  for(const b of r.plans[0].blocks)for(let e=0;e<b.cap.length;e++) {
    if(Math.abs(b.capHeights[e])<1e-5)continue;
    const p=b.cap[e],height=b.bedTop+b.capHeights[e];let top=false,bottom=false;
    for(let i=0;i<r.faces.length;i++)if(r.faces[i].block===b.index&&r.faces[i].kind==='ledge')for(let k=0;k<3;k++) {
      const at=i*9+k*3;if(Math.hypot(r.positions[at]-p[0],-r.positions[at+2]-p[1])>1e-4)continue;
      const h=r.positions[at+1]-r.beds[i*3+k];if(Math.abs(h-height)<1e-4)top=true;if(Math.abs(h-b.bedTop)<1e-4)bottom=true;
    }
    assert(top&&bottom,'both ends of the curtain must be present in uploaded geometry');sealed++;
  }
  assert(sealed>0);
});
