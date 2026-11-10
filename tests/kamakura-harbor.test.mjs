import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from '../dist/vendor/three.module.min.js';
import { HARBOR, prepareHarbor, harborPlacementBatches, createHarborSite, harborInteriorBatches, harborOverlap, harborMotion, harborLOD, harborNear, harborRange, harborKeep, harborPixelWidth } from '../dist/valley/kamakura-harbor.js';
import { HARBOR_ART, harborGeometry } from '../dist/valley/kamakura-harbor-kit.js';
import { createKamakuraHarbor, installHarborShader, HARBOR_VERTEX_PARS, HARBOR_BEGIN_VERTEX, HARBOR_PIXEL_VERTEX } from '../dist/valley/kamakura-harbor-view.js';
import { decodeRoads } from '../dist/valley/kamakura-roads.js';
import { decodeRivers } from '../dist/valley/kamakura-rivers.js';
import { prepareProps } from '../dist/valley/kamakura-props.js';
import { sampleDistance } from '../dist/valley/kamakura-shore.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { createHabitat } from '../dist/valley/kamakura-habitat.js';
import { facilityFootprint } from '../dist/valley/kamakura-facilities.js';
import { houseBox, houseMatrix } from '../dist/valley/kamakura-houses.js';
import { readPrivateData } from '../tools/lib/kamakura-validation.mjs';
import { readPrivateFacilities } from '../tools/lib/kamakura-facility-validation.mjs';
import { readPrivateHouses } from '../tools/lib/kamakura-house-validation.mjs';

// All coordinates below belong to this invented straight beach and three-sided timber-free inlet.
function world({ port = true, river = false } = {}) {
  const dry = (x,z) => z<0 || port && x>500 && x<600 && z>12 && z<110 && !(x>512 && x<588 && z>12 && z<98);
  const terrain = { bounds: { minX:-1600,maxX:1600,minZ:-600,maxZ:1100 },
    heightAt:(x,z)=>dry(x,z)?(z>0?.2:-z*.02):-2, slopeAt:()=>1, walkable:(x,z)=>dry(x,z), isSea:(x,z)=>!dry(x,z),
    waterAt:(x,z)=>dry(x,z)?0:1, seaDistanceAt:(x,z)=>Math.max(0,-z),
    riverDistanceAt:(x,z)=>river?Math.max(0,Math.abs(x)-9):Infinity };
  const node={node:'test jetty',part:'jetty',facility:'test port',anchor_xz:[550,61],bbox_min:[-50,0,-49],bbox_max:[50,1,49]};
  return { terrain, data:{meta:{places:[{name:'test beach',kind:'coast',x:0,y:0}]},facilities:{nodes:port?[node]:[]}},
    houses:{boxes:Array.from({length:15},(_,i)=>({x:-700+i*100,z:-140,w:6,d:5,rotY:0}))},
    habitat:{at(x,z,out){out.sand=z<0&&z>-100?1:0;return out;}} };
}
const fixture=world(), placed=prepareHarbor(fixture);
const beach=placed.items.filter(p=>p.kind==='beach'), racks=placed.items.filter(p=>p.kind==='rack'), sails=placed.items.filter(p=>p.kind==='sail'), harbour=placed.items.filter(p=>p.kind==='harbour');
const sample = p => ({ ...p, kind:'beach', x:-1100,y:.44,z:-22,yaw:0,w:1.6,d:7 });

test('B1/B2: complete deterministic groups, bounds, tilt, alignment and rack totals', t=>{
  assert.deepEqual(placed.items,prepareHarbor(world()).items);
  assert(beach.length>=45 && beach.length<=80 && beach.length<=HARBOR.beachCap);
  assert(racks.length>=20 && racks.length<=40);
  for(const g of placed.groups){
    const group=beach.filter(p=>p.group===g.id), nets=racks.filter(p=>p.group===g.id);
    assert(group.length>=3&&group.length<=6); assert(nets.length<=2);
    assert.equal(g.boats,group.length); assert.equal(g.racks,nets.length);
    for(const p of group){
      assert.equal(placed.site.reason(p),null); assert(p.d>=6.5&&p.d<=9&&p.w>=1.5&&p.w<=2);
      assert(Math.abs(p.tiltZ)*180/Math.PI>=4 && Math.abs(p.tiltZ)*180/Math.PI<=10);
      const delta=Math.atan2(Math.sin(p.yaw-g.yaw),Math.cos(p.yaw-g.yaw));
      assert(Math.min(Math.abs(delta),Math.abs(Math.PI-Math.abs(delta)))<=12*Math.PI/180);
      assert(p.brightness>=.9&&p.brightness<=1.1);
    }
    for(const p of nets){ assert.equal(p.yaw,g.yaw); assert(Math.hypot(p.x-g.x,p.z-g.z)<16); assert(p.w>=5&&p.w<=8); assert.equal(placed.site.reason(p),null); }
    for(const other of placed.groups) if(other!==g) assert(Math.hypot(g.x-other.x,g.z-other.z)>=Math.max(g.gap,other.gap));
    const nearest=Math.min(...placed.groups.filter(q=>q!==g).map(q=>Math.hypot(g.x-q.x,g.z-q.z)));
    assert(nearest>=70&&nearest<=150);
  }
  for(let i=0;i<beach.length;i++)for(let j=0;j<i;j++)assert(!harborOverlap(beach[i],beach[j],HARBOR.boatMargin));
  const props=prepareProps({...fixture,search:'?time=golden'},{time:'golden'}).items.filter(p=>p.kind==='boat');
  assert.deepEqual(placed.oldBoats,props);
  for(const p of beach)for(const q of props)assert(Math.hypot(p.x-q.x,p.z-q.z)>=9);
  t.diagnostic(JSON.stringify({boats:beach.length,racks:racks.length,sails:sails.length,harbour:harbour.length,groups:placed.groups.length,work:placed.work}));
});

test('B1: town beaches have shorter group intervals than remote beaches',()=>{
  const near=placed.groups.filter(g=>g.town<=HARBOR.townReach),far=placed.groups.filter(g=>g.town>HARBOR.townReach);
  assert(near.length>0&&far.length>0); assert(near.every(g=>g.gap<far[0].gap));
  const spacing = list=>list.reduce((sum,g)=>sum+Math.min(...placed.groups.filter(q=>q!==g).map(q=>Math.hypot(g.x-q.x,g.z-q.z))),0)/list.length;
  assert(spacing(near)<spacing(far));
});

test('B1: every prohibited class rejects the entire footprint, not just the centre',()=>{
  const p=sample(beach[0]);
  const check=(mutate,expected)=>{const w=world({port:false});mutate(w);assert.equal(createHarborSite(w).reason(p),expected);};
  check(w=>w.terrain.walkable=()=>false,'walk');
  check(w=>w.terrain.waterAt=()=>1,'water');
  check(w=>w.terrain.slopeAt=()=>16,'slope');
  check(w=>w.terrain.seaDistanceAt=()=>7,'shore');
  check(w=>w.terrain.seaDistanceAt=()=>41,'shore');
  check(w=>w.habitat.at=(x,z,out)=>(out.sand=0,out),'sand');
  check(w=>w.terrain.riverDistanceAt=()=>5,'river');
  check(w=>w.houses.boxes=[{x:p.x+2,z:p.z,w:1,d:1,rotY:.7}],'box');
  check(w=>w.data.patches={paths:{road:{kind:'road',width_m:8,xyz_m:[[p.x-20,-p.z,0],[p.x+20,-p.z,0]]}}},'path');
  check(w=>w.terrain.waterAt=(x,z)=>z<-25?1:0,'water');
  assert.equal(createHarborSite(world(),[{x:p.x+8,z:p.z}]).reason(p),'props');
  assert.equal(createHarborSite(world()).reason(p,[{...p,x:p.x+1}]),'near');
});

test('B1: actual dry sand code overrides averaged habitat; SAT handles rotated boxes',()=>{
  const w=world(), p=sample(beach[0]);
  w.data.meta.grid={width:3,height:3,cell_m:2000};w.data.meta.surface={};w.data.surface=new Uint8Array(9).fill(2);
  assert.equal(createHarborSite(w).reason(p),'sand');w.data.surface.fill(0);assert.equal(createHarborSite(w).reason(p),null);
  const a={x:0,z:0,yaw:Math.PI/3,w:2,d:8};
  assert(harborOverlap(a,{...a,x:1}));assert(!harborOverlap(a,{...a,x:30}));
});

test('B3: two validated offshore corridors, including the middle beach; no island crossings',()=>{
  assert.equal(sails.length,2);
  for(const p of sails){
    assert.equal(p.afloat,true);assert(p.d>=12&&p.d<=15);
    assert(p.z>=250&&p.z<=500);
    for(let s=-150;s<=150;s+=1){const x=p.x+p.tx*s,z=p.z+p.tz*s;assert(fixture.terrain.isSea(x,z));assert(sampleDistance(placed.landField,x,z)>=200+p.d/2);}
  }
  const average=placed.groups.reduce((sum,p)=>sum+p.x,0)/placed.groups.length;
  assert(Math.abs(sails[0].x-average)<150);
});

test('B3: mirror motion returns after a lap, bounded waves and speed, smooth headings; caller storage retained 1000 frames',()=>{
  const p=sails[0], out={}, same=out, lap=Math.PI*HARBOR.routeSpan/HARBOR.speed;
  const a={};harborMotion(p,0,a);harborMotion(p,lap,out);
  assert(Math.abs(out.x-a.x)<1e-8&&Math.abs(out.z-a.z)<1e-8);
  let last=null, lo=Infinity, hi=-Infinity;
  for(let i=0;i<1000;i++){
    const time=i*.01;assert.equal(harborMotion(p,time,out),same);
    lo=Math.min(lo,out.y-p.y);hi=Math.max(hi,out.y-p.y);
    assert(Math.abs(out.y-p.y)<=.25+1e-9);assert(Math.abs(out.tiltX)<=2*Math.PI/180);assert(Math.abs(out.tiltZ)<=3*Math.PI/180);
    if(last!==null)assert(Math.hypot(out.x-last.x,out.z-last.z)<=.6*.01+1e-8);
    last={x:out.x,z:out.z};
  }
  assert(lo<-.24&&hi>.24);
  // Test both reversals directly, wrapping angle differences across +/-pi.
  for(const theta of [Math.PI/2,Math.PI*1.5]){
    const t=(theta-p.phase)*(HARBOR.routeSpan/2)/HARBOR.speed;
    const before={},after={};harborMotion(p,t-.01,before);harborMotion(p,t+.01,after);
    assert(Math.abs(Math.atan2(Math.sin(after.yaw-before.yaw),Math.cos(after.yaw-before.yaw)))<.01);
  }
  const body=harborMotion.toString();assert.doesNotMatch(body,/\bnew\b|\.map\(|\.filter\(|\.push\(|=>|return\s*\{/);
});

test('B4: enclosed wet pocket, six floating boats, dry-root pier, dry hut; no jetty means no structures',()=>{
  assert.equal(harbour.length,6);assert(harbour.every(p=>p.afloat));
  for(const p of harbour)assert(fixture.terrain.isSea(p.x,p.z));
  const pier=placed.infra.find(p=>p.kind==='pier'), hut=placed.infra.find(p=>p.kind==='hut');assert(pier&&hut);
  assert(!fixture.terrain.isSea(pier.x,pier.z));assert(fixture.terrain.isSea(pier.x+pier.dx*pier.d,pier.z+pier.dz*pier.d));
  assert(!fixture.terrain.isSea(hut.x,hut.z));assert(pier.d>=10&&pier.d<=16);assert.equal(pier.w,1.6);
  const none=prepareHarbor(world({port:false}));assert.equal(none.infra.length,0);assert(!none.items.some(p=>p.kind==='harbour'));
});

test('B4: solid offshore island cannot invent an enclosed water surface or pier',()=>{
  const w=world({port:false}), node={node:'solid',part:'jetty',facility:'port',anchor_xz:[900,40],bbox_min:[-45,0,-40],bbox_max:[45,1,40]};
  w.data.facilities={nodes:[node]};const original=w.terrain.isSea;
  w.terrain.isSea=(x,z)=>original(x,z)&&!(x>855&&x<945&&z>0&&z<80);
  const r=prepareHarbor(w);assert.equal(r.infra.length,0);assert(r.skipped.interior>0);
  assert(r.items.filter(p=>p.kind==='harbour').every(p=>!p.afloat&&w.terrain.walkable(p.x,p.z)));
});

test('B5: 3D boundaries, light/adapt range and density, 1.5px width floor',()=>{
  assert.equal(harborLOD(899,'standard',0),'near');assert.equal(harborLOD(900,'standard',0),'far');
  assert.equal(harborLOD(5000,'standard',0),'far');assert.equal(harborLOD(5001,'standard',0),'hidden');
  assert.equal(harborRange('light'),3000);assert.equal(harborRange('standard',3),1500);
  assert(harborNear('light')<harborNear('standard'));assert(harborKeep('standard',3)<harborKeep('standard',2));
  assert.equal(harborLOD(700,'standard',0),'near');assert.equal(harborLOD(Math.hypot(700,700),'standard',0),'far');
  assert.equal(harborLOD(100,'light',0,.9),'hidden');
  for(const d of [1000,3000,5000]){const width=harborPixelWidth(1.7,d,941,1/Math.tan(40*Math.PI/360));assert(width>=1.7);assert(width*941/(2*d*Math.tan(40*Math.PI/360))>=1.5-1e-9);}
});

test('geometry: per-shape and aggregate budgets, finite unit normals, open hull, square sail and existing palette',t=>{
  const counts={};
  for(const kind of ['boat','craft','rack','sail','port'])for(const far of [false,true]){
    const g=harborGeometry(kind,far,placed.infra), n=g.attributes.normal, p=g.attributes.position, c=g.attributes.color;
    counts[kind+(far?'Far':'Near')]=p.count/3;
    assert(p.array.every(Number.isFinite));assert(n.array.every(Number.isFinite));assert(c.array.every(v=>v>=0&&v<=1));
    for(let i=0;i<n.count;i++)assert(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-5);
    if(kind==='boat')assert(p.count/3<=(far?12:260));if(kind==='craft')assert(p.count/3<=(far?14:260));if(kind==='rack')assert(p.count/3<=(far?4:180));
    if(kind==='sail'||kind==='craft')assert(Math.abs(g.boundingBox.max.y-(far?HARBOR_ART.sailBottom+HARBOR_ART.sailHeight:HARBOR_ART.mastHeight))<1e-5);
    g.dispose();
  }
  const near=(beach.length+harbour.length+sails.length)*counts.craftNear+racks.length*counts.rackNear+counts.portNear;
  const far=(beach.length+harbour.length+sails.length)*counts.craftFar+racks.length*counts.rackFar+counts.portFar;
  assert(near<=30000&&far<=3000);
  const maximumCraft=HARBOR.beachCap+HARBOR.harbourCap+HARBOR.sailCount;
  assert(maximumCraft*counts.craftNear+HARBOR.rackCap*counts.rackNear+counts.portNear<=HARBOR.nearTriangles);
  assert(maximumCraft*counts.craftFar+HARBOR.rackCap*counts.rackFar+counts.portFar<=HARBOR.farTriangles);
  assert(Object.isFrozen(HARBOR)&&Object.isFrozen(HARBOR_ART));
  const existing=fs.readFileSync(new URL('../dist/valley/kamakura-props-kit.js',import.meta.url),'utf8');
  for(const k of ['wood','plank','net','mat'])assert(existing.includes(HARBOR_ART[k]));
  t.diagnostic(JSON.stringify({counts,nearTriangles:near,farTriangles:far,draws:6,shadowDraws:3,drawsWithShadows:9}));
});

function viewContext(search='?debug=1',quality='standard'){
  return {...world(),search,quality,scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(40,16/9,.1,10000),renderer:{getDrawingBufferSize:v=>v.set(1280,720)}};
}
function finish(view,c){
  const f={dt:1/60,time:0,pos:{x:0,y:2,z:0},camera:c.camera};
  for(let i=0;i<4000;i++){view.update(f);if(globalThis.__kzHarbor().ready)return f;}
  assert.fail('bounded synthetic preparation did not finish');
}
function compile(mesh,depth=false){
  const m=depth?mesh.customDepthMaterial:mesh.material, base=THREE.ShaderLib[depth?'depth':m.isMeshBasicMaterial?'basic':'lambert'];
  const shader={uniforms:{},vertexShader:base.vertexShader,fragmentShader:base.fragmentShader};m.onBeforeCompile(shader);return shader;
}
function balanced(source){
  const s=source.replace(/\/\/[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,''),stack=[],pairs={')':'(',']':'[','}':'{'};
  for(const c of s)if('([{'.includes(c))stack.push(c);else if(')]}'.includes(c))assert.equal(stack.pop(),pairs[c]);
  assert.equal(stack.length,0);assert.doesNotMatch(s,/--\s*\d|\+\+\s*\d/);
  assert.doesNotMatch(s,/\b(?:float|vec[234]|int)\s+(?:patch|sample|input|output|filter|active|common|resource|texture)\b/);
  assert.doesNotMatch(s.replace(/\b(?:vec[234]|mat[234])\b/g,'V'),/(?:\d\.\d*|\b\d+)[a-df-zA-DF-Z_]\w*\s*\(/);
}
function expand(s){return s.replace(/#include <(\w+)>/g,(_,key)=>{assert.equal(typeof THREE.ShaderChunk[key],'string');return expand(THREE.ShaderChunk[key]);});}

test('layer: harbor=0 is allocation-free and never touches terrain/scene; work starts after the first frame',()=>{
  const off={search:'?harbor=0',get scene(){assert.fail('off created a scene object');},get terrain(){assert.fail('off queried terrain');}};
  assert.equal(createKamakuraHarbor(off),null);
  const c=viewContext(),v=createKamakuraHarbor(c);assert.equal(globalThis.__kzHarbor().ready,false);
  v.update({});assert.equal(globalThis.__kzHarbor().work.scans,undefined);v.dispose();assert.equal(globalThis.__kzHarbor,undefined);
});

test('layer: camera xyz drives both LODs; <=8 matrix writes, <=10 draws, lower adapt density, no steady-frame container allocation',t=>{
  const c=viewContext(),v=createKamakuraHarbor(c),f=finish(v,c),group=c.scene.getObjectByName('kamakura-harbor');
  assert.equal(group.children.length,6);
  c.camera.position.set(0,2,0);v.update(f);const close=globalThis.__kzHarbor();assert(close.drawn.near>0&&close.drawn.far>0);
  c.camera.position.set(0,1200,0);v.update(f);const high=globalThis.__kzHarbor();assert.equal(high.drawn.near,0);assert(high.drawn.far>0);
  assert(high.nearest.distance>1100);assert(high.nearest.bearing>=0&&high.nearest.bearing<360);
  v.setAdapt(3);v.update(f);const cheap=globalThis.__kzHarbor();assert(cheap.drawn.far<high.drawn.far);
  v.setAdapt(0);let matrixWrites=0;
  for(const mesh of group.children)if(mesh.name.endsWith('near')){const set=mesh.setMatrixAt;mesh.setMatrixAt=function(i,m){matrixWrites++;return set.call(this,i,m);};}
  // Constructors used for packing are replaced AFTER startup; the 1,000 frame path may not allocate any.
  const saved=globalThis.Float32Array;globalThis.Float32Array=class extends saved{constructor(...args){super(...args);assert.fail('hot path allocated a typed buffer');}};
  try{for(let i=0;i<1000;i++){f.time=i/60;v.update(f);assert(globalThis.__kzHarbor().drawn.matrixWrites<=8);}}
  finally{globalThis.Float32Array=saved;}
  assert.equal(matrixWrites,8000);assert(globalThis.__kzHarbor().drawn.drawsWithShadows<=10);
  const update=v.update.toString();assert.doesNotMatch(update.slice(update.indexOf('const camera =')),/\bnew\b|\.map\(|\.filter\(|\.slice\(|\.push\(/);
  for(let i=0;i<group.children.length;i+=2){assert.equal(group.children[i].instanceMatrix,group.children[i+1].instanceMatrix);assert(group.children[i].castShadow);assert(!group.children[i+1].castShadow);assert(group.children[i+1].receiveShadow);}
  const at=globalThis.__kzHarbor();v.setPaused(true);f.time+=100;v.update(f);assert.deepEqual(globalThis.__kzHarbor().drawn,at.drawn);v.setPaused(false);
  t.diagnostic(JSON.stringify({high:high.drawn,adapt3:cheap.drawn,matrixWritesPer1000Frames:matrixWrites}));v.dispose();
});

test('B6: category debug colours, darker far silhouettes, no fog/light; exactly-once resource release',()=>{
  const c=viewContext('?debug=1&harbordebug=1'),v=createKamakuraHarbor(c);finish(v,c);
  const group=c.scene.getObjectByName('kamakura-harbor'),events=new Map();
  for(const mesh of group.children){
    assert(mesh.material.isMeshBasicMaterial);assert.equal(mesh.material.fog,false);assert.equal(mesh.material.toneMapped,false);assert.equal(mesh.material.vertexColors,false);
    for(const resource of [mesh,mesh.geometry,mesh.material,mesh.customDepthMaterial].filter(Boolean)){events.set(resource,0);resource.addEventListener('dispose',()=>events.set(resource,events.get(resource)+1));}
    const far=mesh.name.endsWith('far'),c0=new THREE.Color();mesh.getColorAt(0,c0);
    const base=new THREE.Color(mesh.name.includes('rack')?HARBOR_ART.rackDebug:mesh.name.includes('sail')?HARBOR_ART.sailDebug:mesh.name.includes('port')?HARBOR_ART.portDebug:HARBOR_ART.beachDebug).multiplyScalar(far?HARBOR_ART.farDebugGain:1);
    assert(c0.distanceTo?c0.distanceTo(base)<1e-5:Math.abs(c0.r-base.r)<1e-5);
  }
  assert.match(v.debugText(),/浜舟 \d+・枠 \d+・帆 \d+/);
  v.dispose();v.dispose();assert.equal(c.scene.children.length,0);assert.equal(globalThis.__kzHarbor,undefined);
  for(const n of events.values())assert.equal(n,1);
  assert.equal(v.debugText(),'');v.update({});v.setAdapt(3);
});

test('GLSL: all real Three hooks exist for Lambert/basic/depth; brackets, names and float literals verified',()=>{
  const chunks=(HARBOR_VERTEX_PARS+HARBOR_BEGIN_VERTEX+HARBOR_PIXEL_VERTEX).replace(/\/\/[^\n]*/g,'');
  balanced(chunks);
  const declarations=new Set([...chunks.matchAll(/\b(?:float|vec[234]|mat[234])\s+(\w+)(?:\s*,\s*(\w+))?(?:\s*,\s*(\w+))?(?:\s*,\s*(\w+))?(?:\s*,\s*(\w+))?/g)].flatMap(m=>m.slice(1).filter(Boolean)));
  const known=new Set(['attribute','uniform','varying','float','vec2','vec3','vec4','mat4','step','smoothstep','mix','max','length','if','distance','position','instanceMatrix','modelMatrix','viewMatrix','modelViewMatrix','projectionMatrix','gl_Position']);
  for(const m of chunks.matchAll(/\b[A-Za-z_]\w*\b/g))if(chunks[m.index-1]!=='.')assert(known.has(m[0])||declarations.has(m[0]),`undeclared shader name ${m[0]}`);
  assert.doesNotMatch(chunks.replace(/\[\d+\]/g,''),/(?<![\w.])\d+(?![\w.])/,'all arithmetic literals must be floats');
  for(const search of ['?debug=1','?debug=1&harbordebug=1']){
    const c=viewContext(search),v=createKamakuraHarbor(c);finish(v,c);
    for(const mesh of c.scene.getObjectByName('kamakura-harbor').children){
      for(const depth of [false,...(mesh.customDepthMaterial?[true]:[])]){
        const s=compile(mesh,depth);assert(s.vertexShader.includes('distance(harborOrigin, uHarborViewer)'));
        assert(s.fragmentShader.includes('if (vHarborShown < 0.5) discard;'));balanced(expand(s.vertexShader));balanced(expand(s.fragmentShader));
      }
    }
    v.dispose();
  }
  const broken=new THREE.MeshLambertMaterial();installHarborShader(broken,{});assert.throws(()=>broken.onBeforeCompile({uniforms:{},vertexShader:'',fragmentShader:''}),/hook missing/);broken.dispose();
});

test('private world: exception-free, bounded, dry exclusions and full wet routes (no geography printed)',async t=>{
  const dir=process.env.KZ_WORLD_DIR;if(!dir)return t.skip('KZ_WORLD_DIR未設定');
  const {data}=await readPrivateData(dir);
  if(data.meta.surface)data.surface=new Uint8Array(fs.readFileSync(path.join(dir,data.meta.surface.file)));
  if(data.meta.roads)data.roads=decodeRoads(JSON.parse(fs.readFileSync(path.join(dir,data.meta.roads.file))),data.meta.roads.count);
  if(data.meta.rivers)data.rivers=decodeRivers(JSON.parse(fs.readFileSync(path.join(dir,data.meta.rivers.file))),data.meta.rivers.count);
  const terrain=createKamakuraTerrain(data),ph=await readPrivateHouses(dir,data),input=await readPrivateFacilities(dir,data);
  data.facilities=input.facilities;
  const facilities={records:input.facilities.nodes.map(node=>({node,bounds:facilityFootprint(node,input.positions.get(node.node),false)}))};
  const boxes=ph.houses.instances.map(h=>houseBox(ph.houses.kinds.get(h.kind),houseMatrix(h,terrain,ph.bodies.get(h.kind)),ph.bodies.get(h.kind)));
  const habitat=createHabitat({terrain,meta:data.meta,surface:data.surface,housePoints:boxes});
  const r=prepareHarbor({data,terrain,facilities,houses:{boxes},habitat});
  const counts={beach:0,rack:0,sail:0,harbour:0};let animated=0,near=0,far=0;
  const sizes={};for(const kind of ['boat','craft','rack','sail','port'])for(const f of [false,true]){const g=harborGeometry(kind,f,r.infra);sizes[kind+(f?'Far':'Near')]=g.attributes.position.count/3;g.dispose();}
  for(const p of r.items){
    counts[p.kind]++;const kind=p.kind==='beach'||p.kind==='harbour'||p.kind==='sail'?'craft':p.kind;near+=sizes[kind+'Near'];far+=sizes[kind+'Far'];
    if(p.afloat){animated++;assert(terrain.isSea(p.x,p.z),'floating boat must be wet (values withheld)');}
    else assert.equal(r.site.reason(p),null,'dry placement violates a rule (values withheld)');
    if(p.kind==='sail')for(let d=-150;d<=150;d+=10)assert(sampleDistance(r.landField,p.x+p.tx*d,p.z+p.tz*d)>=200,'route shore clearance (values withheld)');
  }
  near+=sizes.portNear;far+=sizes.portFar;
  assert(counts.beach<=96&&counts.rack<=40&&counts.sail<=2&&counts.harbour<=6&&animated<=8);
  assert(near<=30000&&far<=3000);
  t.diagnostic(JSON.stringify({privateAggregate:counts,triangles:{near,far},drawsUpper:6,shadowDrawsUpper:3,animated,work:r.work}));
});
