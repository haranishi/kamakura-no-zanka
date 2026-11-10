import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as THREE from '../dist/vendor/three.module.min.js';
import { TOWN_DRESS as C, DRESS_KINDS, townDressBatches, prepareTownDress, dressLOD, dressRange, dressKeep, dressPixelSize, dressClothMotion } from '../dist/valley/kamakura-town-dress.js';
import { DRESS_ART as A, dressPalette, townDressGeometry } from '../dist/valley/kamakura-town-dress-kit.js';
import { createKamakuraTownDress, addDressBoxes, installDressShader, DRESS_VERTEX_PARS, DRESS_BEGIN_VERTEX, DRESS_PIXEL_VERTEX } from '../dist/valley/kamakura-town-dress-view.js';
import { buildColliders, moveActor } from '../dist/valley/collision.js';
import { loadKamakura } from '../dist/valley/kamakura-data.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { townBoxesOverlap } from '../dist/valley/kamakura-town-fill.js';
import { houseBox, houseIntersects } from '../dist/valley/kamakura-houses.js';

// Invented parallel streets, transverse alleys, rotated plots and a straight synthetic beach.
function world(n=400, yaw=0) {
  const c=Math.cos(yaw),s=Math.sin(yaw),rotate=(x,z)=>({x:c*x+s*z,z:-s*x+c*z});
  const townPlots=[],lanes={},roads={};
  for(let row=0;row<Math.ceil(n/80);row++){
    const z=row*60, a=rotate(-520,z),b=rotate(520,z),id=row===0?'avenue':'lane'+row;
    const line={width_m:row===0?27:3.2,xyz_m:[[a.x,-a.z,0],[b.x,-b.z,0]]};(row===0?roads:lanes)[id]=line;
    for(let j=0;j<80&&townPlots.length<n;j++){
      const side=j%2?-1:1, at=rotate(-500+Math.floor(j/2)*25,z+side*(line.width_m/2+10.75));
      townPlots.push({...at,width:12,depth:20,yaw,state:['house','garden','burnt','repair'][Math.floor(j/2)%4],lane:id});
    }
  }
  const bounds={minX:-3000,maxX:3000,minZ:-3000,maxZ:3000};
  return { data:{townPlots,lanes,roads},terrain:{heightAt:()=>4,walkable:()=>true,waterAt:()=>0,seaDistanceAt:()=>120,bounds},
    scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(40,16/9,.1,10000),quality:'standard',search:'?debug=1',colliders:buildColliders({bounds}) };
}
function complete(v,c){const f={camera:c.camera,pos:{x:0,y:4,z:0},time:0,wind:1,windDir:[1,0]};for(let i=0;i<2000;i++){v.update(f);if(globalThis.__kzTownDress().ready)return f;}assert.fail('startup did not finish');}
function compile(mesh,depth=false){const m=depth?mesh.customDepthMaterial:mesh.material,base=THREE.ShaderLib[depth?'depth':m.isMeshBasicMaterial?'basic':'lambert'];const shader={uniforms:{},vertexShader:base.vertexShader,fragmentShader:base.fragmentShader};m.onBeforeCompile(shader);return shader;}

test('D1–D3 deterministic states, plot containment, ruin dimensions and 40% garden supports',()=>{
  const c=world(),r=prepareTownDress(c);assert.deepEqual(r.items,prepareTownDress(c).items);
  assert.deepEqual(r.plots,{burnt:100,repair:100,garden:100});
  const gardens=r.items.filter(p=>p.kind==='garden');assert(Math.abs(gardens.filter(p=>p.stakes).length/gardens.length-.4)<.15);
  for(const p of r.items){
    if(p.kind==='smoke')continue;
    const plot=c.data.townPlots[p.plot],co=Math.cos(plot.yaw),si=Math.sin(plot.yaw);
    for(const u of [-.5,.5])for(const v of [-.5,.5]){
      const x=p.x+Math.cos(p.yaw)*p.w*u+Math.sin(p.yaw)*p.d*v,z=p.z-Math.sin(p.yaw)*p.w*u+Math.cos(p.yaw)*p.d*v;
      assert(Math.abs((x-plot.x)*co-(z-plot.z)*si)<=plot.width/2-C.inset+1e-7);
      assert(Math.abs((x-plot.x)*si+(z-plot.z)*co)<=plot.depth/2-C.inset+1e-7);
    }
    if(p.kind==='burnt'){assert(p.w>=5&&p.w<=7);assert(p.d>=7&&p.d<=11);}
  }
  assert.equal(prepareTownDress({data:{},terrain:c.terrain}),null);
});

test('D1 old ruins have sparse smoke and regrowth, not a fire on every plot',()=>{
  const c=world(1600),r=prepareTownDress(c),burnt=r.plots.burnt,smoke=r.items.filter(p=>p.kind==='smoke');
  assert(Math.abs(smoke.length/burnt-C.smokeRate)<.05);assert(smoke.every(p=>c.data.townPlots[p.plot].state==='burnt'));
  const g=townDressGeometry('burnt');assert(g.attributes.color.array.some(v=>v>dressPalette().char[0]));g.dispose();
});

test('D4 deterministic proportions, all three fences and side returns, with open entrances',()=>{
  const c=world(3200,.4),r=prepareTownDress(c),counts={house:0,garden:0,burnt:0,repair:0},seen=new Set();
  for(const f of r.items)if(C.fenceHeights[f.kind]){if(!seen.has(f.plot)){seen.add(f.plot);counts[c.data.townPlots[f.plot].state]++;}}
  for(const [state,rate]of Object.entries({house:C.houseFence,garden:C.gardenFence,burnt:C.otherFence,repair:C.otherFence}))assert(Math.abs(counts[state]/800-rate)<.055);
  for(const [kind,rate]of Object.entries({bamboo:.6,board:.25,log:.15}))assert(Math.abs(r.fences.byKind[kind]/r.fences.plots-rate)<.06);
  const returns=r.items.filter(p=>C.fenceHeights[p.kind]&&Math.abs(p.yaw-.4)>1);
  assert(Math.abs(returns.length/r.fences.plots-C.sideRate)<.06);
  for(const id of seen){
    const front=r.items.filter(p=>p.plot===id&&C.fenceHeights[p.kind]&&Math.abs(p.yaw-.4)<1e-8);
    assert.equal(front.length,2);const plot=c.data.townPlots[id];
    const ends=front.map(p=>({lo:(p.x-plot.x)*Math.cos(.4)-(p.z-plot.z)*Math.sin(.4)-p.w/2,hi:(p.x-plot.x)*Math.cos(.4)-(p.z-plot.z)*Math.sin(.4)+p.w/2})).sort((a,b)=>a.lo-b.lo);
    assert(Math.abs(ends[1].lo-ends[0].hi-C.gate)<1e-8);
  }
  assert.equal(r.boxes.length,r.fences.segments);
});

test('D4 synthetic entire lane corridors and transverse intersections remain walkable after registration',()=>{
  const c=world(400,.31),cross={width_m:3.2,xyz_m:[[-60,500,0],[60,-500,0]]};c.data.lanes.cross=cross;
  const r=prepareTownDress(c),release=addDressBoxes(c.colliders,r.boxes);
  const terrain={bounds:c.terrain.bounds,heightAt:()=>4,waterAt:()=>0,walkable:()=>true,slopeAt:()=>0};
  for(const lane of [...Object.values(c.data.lanes),...Object.values(c.data.roads)])for(let k=1;k<lane.xyz_m.length;k++){
    const a=lane.xyz_m[k-1],b=lane.xyz_m[k],len=Math.hypot(b[0]-a[0],b[1]-a[1]),dx=(b[0]-a[0])/len,dz=(a[1]-b[1])/len;
    for(let t=0;t<len;t+=.5){
      const at={x:a[0]+dx*t,y:4,z:-a[1]+dz*t};
      for(const box of r.boxes)assert(!houseIntersects(box,at,{x:at.x+dx*.5,z:at.z+dz*.5},C.laneWidth/2));
      const next=moveActor(c.colliders,terrain,at,dx*.5,dz*.5,.3);assert(Math.hypot(next.x-at.x-dx*.5,next.z-at.z-dz*.5)<1e-6);
    }
  }
  release();release();assert.equal(c.colliders.boxes.length,0);assert.equal(c.colliders.grid.size,0);
});

test('D4 release preserves unrelated existing colliders and grid identity',()=>{
  const c=world(),grid=c.colliders.grid,old={x:0,z:0,w:3,d:3,rotY:0},first=addDressBoxes(c.colliders,[old]),second=addDressBoxes(c.colliders,prepareTownDress(c).boxes);
  second();assert.equal(c.colliders.boxes.length,1);assert.equal(c.colliders.boxes[0].x,old.x);assert.equal(c.colliders.grid,grid);first();
});

test('D5 tents use only eligible house plots, preserve cap, and report a genuine shortage',()=>{
  const c=world(1600),r=prepareTownDress(c);assert(r.tents>=40&&r.tents<=90);
  for(const p of r.items.filter(p=>p.kind==='tent')){const plot=c.data.townPlots[p.plot];assert(plot.state==='house'||c.terrain.seaDistanceAt(p.x,p.z)<=C.coastReach);assert(p.w>=3&&p.w<=4);assert(p.d>=2.5&&p.d<=3);}
  c.terrain.seaDistanceAt=()=>600;for(const p of c.data.townPlots)p.lane='lane1';assert.equal(prepareTownDress(c).tents,0);
  assert(prepareTownDress(world(1)).skipped.tentShortfall>0);
});

test('D5 cloth mirror stays within 3cm, uses a common clock, and is still at zero wind',()=>{
  for(let i=0;i<1000;i++)assert(Math.abs(dressClothMotion(i/13,2,7,100))<=.03);
  assert(dressClothMotion(3,2,4,0)===0);assert.equal(dressClothMotion(4,2,4),dressClothMotion(4,2,4));
});

test('D6 3D LOD boundaries, all quality steps and 1.5px expansion',()=>{
  for(const [kind,near,far]of [['burnt',350,4000],['repair',350,4000],['tent',350,4000],['garden',250,1500],['bamboo',90,700]]){
    assert.equal(dressLOD(kind,near-.01),'near');assert.equal(dressLOD(kind,near),'far');assert.equal(dressLOD(kind,far),'far');assert.equal(dressLOD(kind,far+.01),'hidden');
    assert.equal(dressLOD(kind,Math.hypot(1,near+5)),'far');
    let previous=Infinity;for(let step=0;step<=3;step++){const d=dressRange(kind,'standard',step);assert(d<previous);previous=d;}
  }
  assert.equal(dressRange('burnt','light'),2500);assert.equal(dressRange('burnt','standard',3),1200);assert.equal(dressRange('bamboo','light'),400);
  assert(dressKeep('light',3)<dressKeep('standard',2));
  for(const d of [1000,3000,4000]){const projection=1/Math.tan(40*Math.PI/360),size=dressPixelSize(.5,d,941,projection);assert(size>=.5);assert(size*941*projection/(2*d)>=1.5-1e-9);}
});

test('shapes: finite unit normals, no degenerate triangles, category budgets and derived colour ranges',t=>{
  const counts={};
  for(const kind of DRESS_KINDS)for(const far of [false,true]){
    if(kind==='smoke'&&far)continue;const g=townDressGeometry(kind,far),p=g.attributes.position,n=g.attributes.normal,col=g.attributes.color;
    counts[kind+(far?'Far':'Near')]=p.count/3;assert(p.array.every(Number.isFinite));assert(col.array.every(v=>v>=0&&v<=1));
    for(let i=0;i<n.count;i++)assert(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-5);
    for(let i=0;i<p.count;i+=3){const a=new THREE.Vector3().fromBufferAttribute(p,i),b=new THREE.Vector3().fromBufferAttribute(p,i+1),c=new THREE.Vector3().fromBufferAttribute(p,i+2);assert(b.sub(a).cross(c.sub(a)).length()>1e-9,kind+' degenerate');}
    if(!far)assert(p.count/3<=({burnt:220,repair:420,garden:160,tent:90}[kind]||1000));g.dispose();
  }
  const p=dressPalette();assert(p.char.every(v=>v>0&&v<.1));assert(p.cloth.every(v=>v>.45&&v<.9));assert(Object.isFrozen(C)&&Object.isFrozen(A));
  assert.equal(counts.tentFar,2);assert.equal(counts.gardenFar,2);t.diagnostic(JSON.stringify({trianglesPerShape:counts,maxDraws:15}));
});

test('D7 flag off and absent plots touch neither scene nor terrain; first display defers all work',()=>{
  const c={search:'?towndress=0',get data(){assert.fail('off read data');},get scene(){assert.fail('off created scene');}};assert.equal(createKamakuraTownDress(c),null);
  assert.equal(createKamakuraTownDress({data:{}}),null);
  const w=world(),v=createKamakuraTownDress(w);v.update({});assert.equal(globalThis.__kzTownDress().ready,false);assert.equal(globalThis.__kzTownDress().work.plots,undefined);v.dispose();
});

test('layer: indexed camera selection, both budgets, high cameras and quality decrease; 1000 frames allocate no containers',t=>{
  const c=world(1600),v=createKamakuraTownDress(c);c.camera.position.set(0,6,0);const frame=complete(v,c),low=globalThis.__kzTownDress();assert(low.drawn.near>0&&low.drawn.far>0);
  const group=c.scene.getObjectByName('kamakura-town-dress');assert(group.children.length<=C.draws);assert(low.drawn.draws<=C.draws);
  assert(low.drawn.nearTriangles<=C.nearTriangles&&low.drawn.farTriangles<=C.farTriangles);assert(low.nearest.distance>=0&&low.nearest.bearing>=0&&low.nearest.bearing<360);
  c.camera.position.set(0,700,0);v.update(frame);const high=globalThis.__kzTownDress();assert.equal(high.drawn.near,0);assert(high.drawn.far>0);assert(high.nearest.distance>600);
  v.setAdapt(3);v.update(frame);assert(globalThis.__kzTownDress().drawn.far<high.drawn.far);
  v.setAdapt(0);const saved=globalThis.Float32Array;globalThis.Float32Array=class extends saved{constructor(...args){super(...args);assert.fail('update allocated typed array');}};
  const start=performance.now();try{for(let i=0;i<1000;i++){frame.time=i/60;v.update(frame);}}finally{globalThis.Float32Array=saved;}
  const ms=performance.now()-start;assert.doesNotMatch(v.update.toString().slice(v.update.toString().indexOf('viewer.copy')),/\bnew\b|\.map\(|\.filter\(|\.slice\(|\.push\(|=>/);
  for(const p of globalThis.__kzTownDress().nearest?[globalThis.__kzTownDress().nearest]:[])assert(Number.isFinite(p.distance));
  const before=globalThis.__kzTownDress();v.setPaused(true);v.update({});assert.deepEqual(globalThis.__kzTownDress(),before);v.setPaused(false);
  assert.match(v.debugText(),/焼 \d+・直 \d+・畑 \d+・柵 \d+・幕 \d+/);t.diagnostic(JSON.stringify({low:low.drawn,high:high.drawn,work:before.work,update1000Ms:ms}));v.dispose();
});

test('D7 debug is unlit with darker far colours, shadow policy, shader hooks, exactly-once disposal',()=>{
  const c=world(1600);c.search+='&towndressdebug=1';const v=createKamakuraTownDress(c);complete(v,c);
  const resources=new Map();for(const m of c.scene.getObjectByName('kamakura-town-dress').children){
    const far=m.name.endsWith('far'),kind=m.name.split('-')[2];assert(m.material.isMeshBasicMaterial);assert(!m.material.fog&&!m.material.toneMapped&&!m.material.vertexColors);
    const expected=new THREE.Color(A.debug[kind]).multiplyScalar(far?A.farDebugGain:1);assert(Math.abs(m.material.color.r-expected.r)<1e-7);
    assert.equal(m.castShadow,!far&&kind!=='smoke');assert.equal(m.receiveShadow,kind!=='smoke');
    compile(m);if(m.customDepthMaterial)compile(m,true);
    for(const r of [m,m.geometry,m.material,m.customDepthMaterial].filter(Boolean)){resources.set(r,0);r.addEventListener('dispose',()=>resources.set(r,resources.get(r)+1));}
  }
  v.dispose();v.dispose();for(const count of resources.values())assert.equal(count,1);assert.equal(globalThis.__kzTownDress,undefined);assert.equal(c.scene.children.length,0);assert.equal(c.colliders.boxes.length,0);v.update({});assert.equal(v.debugText(),'');
});

function expand(s){return s.replace(/#include <(\w+)>/g,(_,key)=>{assert.equal(typeof THREE.ShaderChunk[key],'string');return expand(THREE.ShaderChunk[key]);});}
function glslCheck(s){
  s=s.replace(/\/\/[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'');const stack=[],pairs={')':'(',']':'[','}':'{'};
  for(const ch of s)if('([{'.includes(ch))stack.push(ch);else if(')]}'.includes(ch))assert.equal(stack.pop(),pairs[ch]);assert.equal(stack.length,0);
  assert.doesNotMatch(s,/--\s*\d|\d\.\d*[g-zA-Z_]\w*\s*\(/);
  assert.doesNotMatch(s,/\b(?:float|int|vec[234])\s+(?:input|output|sample|patch|filter|active|common|resource)\b/);
  assert.doesNotMatch(s,/\bfloat\s+\w+\s*=\s*\d+\s*;/);
}
test('GLSL: actual basic/Lambert/depth hooks, brackets, declared dress names, float literals and smoke/cloth code',()=>{
  glslCheck(DRESS_VERTEX_PARS+DRESS_BEGIN_VERTEX+DRESS_PIXEL_VERTEX);
  const c=world(),v=createKamakuraTownDress(c);complete(v,c);
  for(const mesh of c.scene.getObjectByName('kamakura-town-dress').children)for(const depth of [false,true]){
    if(depth&&!mesh.customDepthMaterial)continue;const shader=compile(mesh,depth);glslCheck(expand(shader.vertexShader));glslCheck(expand(shader.fragmentShader));
    assert(!shader.vertexShader.includes('uDressDistance'));assert(shader.vertexShader.includes('aDressGround.z'));
    const names=new Set([...shader.vertexShader.matchAll(/\b(?:float|vec[234])\s+(\w*Dress\w*|dress\w*)/g)].map(m=>m[1]));
    for(const m of shader.vertexShader.matchAll(/\b(dress\w+)\b/g))assert(names.has(m[1]),'undeclared '+m[1]);
  }
  const m=new THREE.MeshBasicMaterial();installDressShader(m,{});assert.throws(()=>m.onBeforeCompile({uniforms:{},vertexShader:'',fragmentShader:''}),/hook missing/);v.dispose();
});

test('placement: narrow plots, water, and subdivided startup work are rejected/countable',()=>{
  const c=world();c.terrain.waterAt=()=>1;const wet=prepareTownDress(c);assert.equal(wet.items.length,0);assert(wet.skipped.terrain>0);
  const dry=world();for(const p of dry.data.townPlots)p.width=1;assert.equal(prepareTownDress(dry).items.length,0);
  const job=townDressBatches(world(400));let next,frames=0;do{next=job.next();frames++;}while(!next.done);assert(frames>=Math.floor(400/C.batch));
});

test('private data: no exceptions, submission caps and no fence crossing of any lane', {skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定'},async t=>{
  const data=await loadKamakura(async url=>{const b=await fs.readFile(path.join(process.env.KZ_WORLD_DIR,path.basename(url)));return {ok:true,json:async()=>JSON.parse(b),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};});
  if(!data.townPlots?.length)return t.skip('区画のない旧世界');
  const c={...world(1),data,terrain:createKamakuraTerrain(data)},start=performance.now(),r=prepareTownDress(c),ms=performance.now()-start;
  for(const box of r.boxes){assert(c.terrain.walkable(box.x,box.z));for(const lane of Object.values(data.lanes||{}))for(let j=1;j<lane.xyz_m.length;j++){const a={x:lane.xyz_m[j-1][0],z:-lane.xyz_m[j-1][1]},b={x:lane.xyz_m[j][0],z:-lane.xyz_m[j][1]};assert(!houseIntersects(box,a,b,C.laneWidth/2));}}
  const houseBoxes=data.houses.instances.map(p=>houseBox(data.houses.kinds.get(p.kind),p.matrix));
  for(const p of r.items)if(p.kind==='tent')for(const b of houseBoxes)assert(!townBoxesOverlap({...p,rotY:p.yaw},b,0));
  const v=createKamakuraTownDress(c);c.camera.position.set(data.townPlots[0].x,20,data.townPlots[0].z);const f=complete(v,c);const walk=globalThis.__kzTownDress();c.camera.position.y+=700;v.update(f);const fly=globalThis.__kzTownDress();
  for(const s of [walk,fly]){assert(s.drawn.nearTriangles<=C.nearTriangles);assert(s.drawn.farTriangles<=C.farTriangles);assert(s.drawn.draws<=C.draws);}
  t.diagnostic(JSON.stringify({placementMs:ms,plots:r.plots,fences:r.fences,tents:r.tents,skipped:r.skipped,work:r.work,walk:walk.drawn,fly:fly.drawn}));v.dispose();
});
