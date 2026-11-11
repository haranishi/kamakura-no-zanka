import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as THREE from '../dist/vendor/three.module.min.js';
import { WORKS as W, decodeWorks, prepareWorks, worksPlacementBatches, worksCircles, worksMotion, worksPolicy } from '../dist/valley/kamakura-works.js';
import { worksRockGeometry, worksPierGeometry, worksBoatGeometry } from '../dist/valley/kamakura-works-kit.js';
import { createKamakuraWorks, installWorksShader, WORKS_ATTRIBUTE_SLOTS, WORKS_SHADER_PARS, WORKS_BEGIN_VERTEX, WORKS_WET_FRAGMENT } from '../dist/valley/kamakura-works-view.js';
import { loadKamakura } from '../dist/valley/kamakura-data.js';
import { buildColliders, segmentBlocked } from '../dist/valley/collision.js';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { syntheticWorks } from '../tools/preview-mesh.mjs';
const synthetic=syntheticWorks(), clone=()=>structuredClone(synthetic.source);
const tris=g=>(g.index?g.index.count:g.attributes.position.count)/3;
const near=(a,b,tolerance=1e-6)=>assert(Math.abs(a-b)<tolerance);
function context(source=synthetic.source,search='?debug=1') {return {data:{works:source},search,quality:'standard',terrain:synthetic.terrain,scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),colliders:buildColliders({bounds:{minX:-500,maxX:500,minZ:-500,maxZ:500}})};}
function finish(layer,c) {const frame={dt:1/60,pos:{x:0,y:20,z:0},camera:c.camera};c.camera.position.set(0,20,0);for(let i=0;i<100;i++){layer.update(frame);if(globalThis.__kzWorks?.().ready)return frame;}assert.fail('preparation did not finish');}

test('works data: valid shapes, strict types, finite ranges, unique ids and all caps',()=>{
  const valid=decodeWorks(clone());assert.equal(valid.rocks.length,3);
  const bad=[s=>s.schema='unknown',s=>s.rocks={},s=>s.rocks=null,s=>s.piers={},s=>s.moorings={},s=>s.rocks[0].shape='sphere',s=>s.rocks[0].count=1.5,s=>s.rocks[0].count=-1,
    s=>s.rocks[0].count=W.rocks+1,s=>s.rocks[0].size_m=[4,1],s=>s.rocks[0].size_m=[0,2],s=>s.rocks[0].size_m=[1,Infinity],s=>s.rocks[0].x=NaN,
    s=>s.rocks[0].gap_deg=-1,s=>s.rocks[0].gap_bearing_deg=361,s=>s.rocks[0].width=0,s=>s.rocks[0].radius=-2,s=>s.rocks[1].id=s.rocks[0].id,
    s=>s.rocks[2].xy_m=[[0,0],[0,0]],s=>s.piers[0].width_m=-1,s=>s.piers[0].deck_m=-1,s=>s.piers[0].xy_m=[[0,0],[100,0]],
    s=>s.moorings[0].kind='ship',s=>s.moorings[0].yaw_deg=-1,s=>s.rocks=Array.from({length:W.groups+1},()=>s.rocks[0]),
    s=>s.piers=Array.from({length:W.piers+1},()=>s.piers[0]),s=>s.moorings=Array.from({length:W.moorings+1},()=>s.moorings[0])];
  for(const mutate of bad){const s=clone();mutate(s);assert.throws(()=>decodeWorks(s));}
  assert.throws(()=>decodeWorks(null));assert.throws(()=>decodeWorks({schema:'kz-works/0.1',rocks:[null]}));
});

test('works loader: absent/off never reads optional data; malformed present data is rejected',async()=>{
  const f=fixture({width:3,height:3}),calls=[];
  const fetcher=async url=>{calls.push(path.basename(url));return {ok:true,json:async()=>url.endsWith('meta.json')?f.meta:clone(),arrayBuffer:async()=>url.endsWith('height_u16.bin')?f.heights.buffer:f.walk.buffer};};
  const old=await loadKamakura(fetcher,'?townfill=0');assert.equal(old.works,undefined);assert(!calls.includes('works.json'));assert.equal(createKamakuraWorks({data:old}),null);
  f.meta.works={file:'works.json'};calls.length=0;const off=await loadKamakura(fetcher,'?works=0&townfill=0');assert.equal(off.works,undefined);assert(!calls.includes('works.json'));
  assert.equal(createKamakuraWorks({data:{works:clone()},search:'?works=0'}),null);assert.equal(createKamakuraWorks({data:{works:clone()},search:'?layers=0'}),null);
  const on=await loadKamakura(fetcher,'?townfill=0');assert.deepEqual(on.works,decodeWorks(clone()));assert(calls.includes('works.json'));
  f.meta.works.file='../works.json';await assert.rejects(loadKamakura(fetcher));
  f.meta.works.file='works.json';await assert.rejects(loadKamakura(async u=>u.endsWith('works.json')?{ok:true,json:async()=>({schema:'bad'})}:fetcher(u)));
});

test('W1: deterministic placement, explicit supplementation, open mouth, two touching crest rows',()=>{
  const {source,terrain,result}=synthetic;assert.deepEqual(result,prepareWorks(clone(),terrain));assert(result.supplemental>0);assert(result.rocks.length<=W.rocks);
  const ring=source.rocks[0];
  for(const r of result.rocks.filter(r=>r.group===0)) {
    const bearing=(Math.atan2(r.x,-r.z)*180/Math.PI+360)%360,delta=Math.abs((bearing-ring.gap_bearing_deg+540)%360-180);
    assert(delta>=ring.gap_deg/2);
    assert(delta-Math.asin(r.r/Math.hypot(r.x,r.z))*180/Math.PI>=ring.gap_deg/2-1e-6,'entire rock footprint clears mouth');
    assert(Math.abs(Math.hypot(r.x,r.z)-ring.radius)+r.r<=ring.width/2+1e-6,'whole rock lies inside band');
  }
  for(const row of [0,1]) {
    const items=result.rocks.filter(r=>r.group===0&&r.row===row);
    assert(items.length>2);for(let i=1;i<items.length;i++)assert(Math.hypot(items[i].x-items[i-1].x,items[i].z-items[i-1].z)<=.9*(items[i].r+items[i-1].r));
  }
  for(const r of result.rocks) {
    const [lo,hi]=source.rocks[r.group].size_m;assert(r.size>=lo&&r.size<=hi);assert(r.embed>=.25&&r.embed<=.4);near(r.y,r.ground-r.embed*r.size*r.sy);
    assert(r.sx>=.85&&r.sx<=1.17&&r.sz>=.85&&r.sz<=1.17&&r.sy>=.69&&r.sy<=1.01);
    if(r.ground<0)assert(r.y+r.size*r.sy>0);
  }
  const sunk=clone();sunk.rocks=[{id:'deep',shape:'disc',x:0,y:0,radius:5,count:10,size_m:[1,2]}];sunk.piers=[];sunk.moorings=[];
  const deep=prepareWorks(sunk,{heightAt:()=>-20});assert.equal(deep.rocks.length,0);assert.equal(deep.skipped,10);
  const fixed=clone();fixed.rocks=[fixed.rocks[0]];fixed.rocks[0].size_m=[4.2,4.2];fixed.piers=[];fixed.moorings=[];assert(prepareWorks(fixed,{heightAt:()=>1.8}).rocks.every(r=>r.size===4.2));
  const job=worksPlacementBatches(source,terrain);assert.equal(job.next().done,false);job.return();
});


test('W1: zero-gap rings close cyclically; transformed stones stay seated (20–50% buried) and emerge above water',()=>{
  const s=clone();s.rocks=[s.rocks[0]];s.rocks[0].gap_deg=0;s.piers=[];s.moorings=[];
  const result=prepareWorks(s,{heightAt:()=>1.8});
  for(const row of [0,1]) {
    const items=result.rocks.filter(r=>r.row===row);
    for(let i=0;i<items.length;i++) {const a=items[i],b=items[(i+1)%items.length];assert(Math.hypot(a.x-b.x,a.z-b.z)<=.9*(a.r+b.r));}
  }
  for(const r of synthetic.result.rocks) {
    const g=worksRockGeometry(),a=r.variant?g.attributes['aWorksShape'+r.variant]:g.attributes.position,obj=new THREE.Object3D(),v=new THREE.Vector3();
    obj.position.set(r.x,r.y+r.size*r.sy/2,r.z);obj.rotation.set(r.tiltX,r.yaw,r.tiltZ,'YXZ');obj.scale.set(r.size*r.sx,r.size*r.sy,r.size*r.sz);obj.updateMatrix();let bottom=Infinity,top=-Infinity;
    for(let i=0;i<a.count;i++){v.fromBufferAttribute(a,i).applyMatrix4(obj.matrix);bottom=Math.min(bottom,v.y);top=Math.max(top,v.y);}
    // A leaning, angular block sits a little deeper or shallower than its upright box: a fifth to a half of what is drawn is buried.
    const embedded=(r.ground-bottom)/(top-bottom);assert(embedded>=.2&&embedded<=.5,'visible rotated geometry embed fraction '+embedded);if(r.ground<0)assert(top>0);g.dispose();
  }
});

test('W1: actual circle colliders and shape heights, attached and removed exactly once',()=>{
  const c=context(),layer=createKamakuraWorks(c);assert.equal(c.colliders.circles.length,0);layer.update({});assert.equal(c.colliders.circles.length,0);finish(layer,c);
  assert.equal(c.colliders.circles.length,synthetic.result.rocks.length);
  const r=c.colliders.circles[0];assert(segmentBlocked(c.colliders,synthetic.terrain,{x:r.x-r.r-1,y:synthetic.terrain.heightAt(r.x,r.z)+r.height/2,z:r.z},{x:r.x+r.r+1,y:synthetic.terrain.heightAt(r.x,r.z)+r.height/2,z:r.z}));
  assert.deepEqual(worksCircles(synthetic.result.rocks)[0],{x:synthetic.result.rocks[0].x,z:synthetic.result.rocks[0].z,r:synthetic.result.rocks[0].size/2,height:synthetic.result.rocks[0].height});
  layer.dispose();layer.dispose();assert.equal(c.colliders.circles.length,0);
});

test('W2: a pier may start on a quay; the landward part gets no piles, a pier wholly on land is refused',()=>{
  const s=clone();s.rocks=[];s.moorings=[];s.piers[0].xy_m=[[0,0],[0,-30]];
  // East/north data, so the pier runs south; the first 9 m lie on a quay at 1.6 m, the rest over 3 m of water.
  const quay={heightAt:(x,z)=>z<9?1.6:-3},p=prepareWorks(s,quay).piers[0],deck=s.piers[0].deck_m;
  assert(p.piles.length>=2&&p.piles.every(q=>q.z>=9&&q.bottom<q.top));
  assert(p.piles.some(q=>q.z<13),'the first piles stand right behind the quay edge');
  assert.equal(p.boards.length>0&&p.bollards.length,2);assert(tris(worksPierGeometry([p]))<=600);
  assert.throws(()=>prepareWorks(s,{heightAt:()=>deck}),/水の上/);
  assert.throws(()=>prepareWorks(s,{heightAt:()=>NaN}),/高さ/);
});
test('W2: bent piers retain level deck, posts reach bed, <=3m support spacing and <=600 triangles',()=>{
  for(const points of [[[-45,45],[-45,15]],[[-45,45],[-45,30],[-30,30]],[[-45,45],[-45,-15]]]) {
    const s=clone();s.rocks=[];s.moorings=[];s.piers[0].xy_m=points;
    const p=prepareWorks(s,{heightAt:()=>-3}).piers[0],g=worksPierGeometry([p]);assert(tris(g)<=600);
    for(const pile of p.piles){near(pile.bottom,-3-W.pileEmbed);near(pile.top,p.deck-W.thickness);}
    for(let i=2;i<p.piles.length;i+=2)assert(p.piles[i].along-p.piles[i-2].along<=3+1e-6);
    assert.equal(p.bollards.length,2);for(const post of p.bollards)near(post.top-p.deck,.8);
    const ys=g.attributes.position;assert([...Array(ys.count)].some((_,i)=>Math.abs(ys.getY(i)-p.deck)<1e-6));g.dispose();
  }
});

test('W3: draft, independent phases, bounded heave/roll, 3–5 second periodicity and reusable output',()=>{
  const boats=synthetic.result.moorings,out={};assert.notEqual(boats[0].phase,boats[1].phase);
  for(const b of boats) {
    near(b.y,-.25);assert(b.period>=3&&b.period<=5);
    for(let i=0;i<1000;i++){assert.equal(worksMotion(b,i/60,out),out);assert(Math.abs(out.y-b.y)<=.06+1e-9);assert(Math.abs(out.tiltZ)<=2*Math.PI/180+1e-9);near(out.x,b.x);near(out.z,b.z);}
    const a={};worksMotion(b,.73,a);worksMotion(b,.73+b.period,out);near(a.y,out.y);near(a.tiltZ,out.tiltZ);
  }
});

function checkGeometry(g) {
  const p=g.attributes.position,n=g.attributes.normal,c=g.attributes.color,indices=g.index?.array;
  const a=new THREE.Vector3(),b=new THREE.Vector3(),d=new THREE.Vector3();
  for(let i=0;i<p.count;i++){const norm=Math.hypot(n.getX(i),n.getY(i),n.getZ(i));near(norm,1,1e-5);for(let j=0;j<3;j++)assert(c.array[i*3+j]>=0&&c.array[i*3+j]<=1);}
  for(let i=0;i<(indices?.length??p.count);i+=3){a.fromBufferAttribute(p,indices?.[i]??i);b.fromBufferAttribute(p,indices?.[i+1]??i+1);d.fromBufferAttribute(p,indices?.[i+2]??i+2);b.sub(a);d.sub(a);assert(b.cross(d).lengthSq()>1e-18,'nondegenerate triangle');}
}
test('shapes: existing four variants, valid normals, no degenerate triangles, bounded linear colors',()=>{
  for(const far of [false,true])for(const g of [worksRockGeometry(far),worksPierGeometry(synthetic.result.piers,far),worksBoatGeometry(far)]){checkGeometry(g);g.dispose();}
  const near=worksRockGeometry();for(const i of [1,2,3]){assert(near.attributes['aWorksShape'+i]);assert.equal(near.attributes['aWorksNormal'+i],undefined);}assert(tris(worksRockGeometry(true))<=12);near.dispose();
});

test('W4: all LODs, flight altitude, quality/adapt counts, debug masks, pause and exact disposal',()=>{
  const c=context(undefined,'?debug=1&worksdebug=1'),posts=[];c.post={setAdapt:n=>posts.push(n)};
  const layer=createKamakuraWorks(c),frame=finish(layer,c),group=c.scene.children[0],events=new Map();assert.deepEqual(posts,[2]);assert.equal(group.children.length,6);
  for(const m of group.children) {
    assert(m.material.isMeshBasicMaterial);assert.equal(m.material.fog,false);assert.equal(m.material.toneMapped,false);
    for(const resource of [typeof m.dispose==='function'?m:null,m.geometry,m.material,m.customDepthMaterial].filter(Boolean)) {events.set(resource,0);resource.addEventListener('dispose',()=>events.set(resource,events.get(resource)+1));}
  }
  assert.match(layer.debugText(),/石 \d+・桟 \d+・繋 \d+/);let info=globalThis.__kzWorks();assert(info.drawn.near>0);assert(info.nearest.distance>=0);assert(info.nearest.bearing>=0&&info.nearest.bearing<360);
  c.camera.position.y=700;layer.update(frame);info=globalThis.__kzWorks();assert.equal(info.drawn.near,0);assert(info.drawn.far>0);assert(info.drawn.triangles<=25000);
  const standard=info.drawn.far,standardTriangles=info.drawn.triangles;layer.setAdapt(3);layer.update(frame);assert(globalThis.__kzWorks().drawn.far<standard);assert(globalThis.__kzWorks().drawn.triangles<standardTriangles);
  layer.setAdapt(0);c.camera.position.y=5000;layer.update(frame);assert.equal(globalThis.__kzWorks().drawn.draws,0);
  c.camera.position.y=10;layer.update(frame);const matrix=group.getObjectByName('works-boat-near').instanceMatrix,version=matrix.version;
  layer.setPaused(true);layer.update(frame);assert.equal(matrix.version,version);layer.setPaused(false);
  for(let i=0;i<1000;i++)layer.update(frame);assert.equal(group.getObjectByName('works-boat-near').instanceMatrix,matrix);assert.equal(globalThis.__kzWorks().work.matrixWrites,4);
  layer.dispose();layer.dispose();assert.equal(c.scene.children.length,0);assert.equal(globalThis.__kzWorks,undefined);for(const count of events.values())assert.equal(count,1);
  assert(worksPolicy('light').far<worksPolicy().far);assert(worksPolicy('light').keep<worksPolicy().keep);
});

test('budgets: maximal input keeps submitted geometry <=60k near /25k far and <=8 calls',t=>{
  const s={schema:'kz-works/0.1',rocks:[{id:'disc',shape:'disc',x:0,y:0,radius:60,count:W.rocks,size_m:[2,4]}],
    piers:Array.from({length:W.piers},(_,i)=>({id:'pier'+i,xy_m:[[i*10,0],[i*10,-60]],width_m:2.6,deck_m:1.4})),
    moorings:Array.from({length:W.moorings},(_,i)=>({x:i,y:-20,yaw_deg:0,kind:i%2?'sail':'boat'}))};
  const c=context(s);c.terrain={heightAt:()=>-.3};const layer=createKamakuraWorks(c),frame=finish(layer,c),group=c.scene.children[0];
  let total=0,far=0;for(const m of group.children){const n=tris(m.geometry)*(m.isInstancedMesh?m.count:1);total+=n;if(m.name.endsWith('far'))far+=n;}
  assert(total<=W.nearTriangles);assert(far<=W.farTriangles);assert(group.children.length<=8);
  c.camera.position.y=700;layer.update(frame);assert(globalThis.__kzWorks().drawn.triangles<=25000);
  t.diagnostic(JSON.stringify({submittedTotal:total,submittedFar:far,draws:group.children.length,work:globalThis.__kzWorks().work}));layer.dispose();
});

function expand(s){return s.replace(/#include <(\w+)>/g,(_,name)=>expand(THREE.ShaderChunk[name]??assert.fail('unknown shader hook '+name)));}
function balanced(s){const stack=[];for(const c of s){if('({['.includes(c))stack.push(c);if(')}]'.includes(c))assert.equal(stack.pop(),'({['[')}]'.indexOf(c)]);}assert.equal(stack.length,0);}
test('GLSL: no works program needs more than twelve vertex-attribute slots (sixteen were refused by a real GPU)',()=>{
  // Slots: every attribute the program can read. A vec3/float takes one, the instance matrix four.
  const pars=(kind,far)=>{
    const defines=new Set(['WORKS_'+kind.toUpperCase(),...(far?['WORKS_FAR']:[])]),stack=[true],names=[];
    for(const line of WORKS_SHADER_PARS.split('\n')){
      const m=line.match(/^#(ifdef|ifndef|else|endif)\s*(\w+)?/);
      if(m){if(m[1]==='ifdef')stack.push(defines.has(m[2]));else if(m[1]==='ifndef')stack.push(!defines.has(m[2]));else if(m[1]==='else')stack.push(!stack.pop());else stack.pop();continue;}
      if(stack.every(Boolean)){const a=line.match(/^attribute \w+ (.+);$/);if(a)names.push(...a[1].split(',').map(s=>s.trim()));}
    }
    return names;
  };
  for(const kind of ['rock','pier','boat'])for(const far of [false,true]){
    const custom=pars(kind,far),builtin=['position','color',...(kind==='rock'?[]:['normal'])],slots=custom.length+builtin.length+(kind==='pier'?0:4);
    assert(slots<=WORKS_ATTRIBUTE_SLOTS,`${kind} ${far?'far':'near'} uses ${slots} slots`);
  }
  assert.deepEqual(pars('rock',false).sort(),['aWorksDetailed','aWorksRank','aWorksShape1','aWorksShape2','aWorksShape3','aWorksVariant']);
});
test('GLSL: real Lambert/basic/depth hooks, brackets, reserved words, float literals and declared identifiers',()=>{
  const chunks=[WORKS_SHADER_PARS,WORKS_BEGIN_VERTEX,WORKS_WET_FRAGMENT].join('\n');balanced(chunks);
  const broken=new THREE.MeshLambertMaterial();installWorksShader(broken,{},'rock');assert.throws(()=>broken.onBeforeCompile({vertexShader:'',fragmentShader:'',uniforms:{}}),/hook missing/);broken.dispose();
  assert.doesNotMatch(chunks,/--\d|\d(?:\.\d+)?[A-Za-z_]\w*|\b(?:input|output|sample|filter|half|fixed)\b/);
  const code=chunks.replace(/^#.*$/gm,'').replace(/\[\d+\]/g,'');assert.doesNotMatch(code,/(?<![\w.])\d+(?![\w.])/);
  const declared=new Set([...chunks.matchAll(/\b(?:float|vec[234])\s+(\w+)/g)].map(m=>m[1]));
  for(const name of ['uWorksNear','uWorksFar','uWorksKeep','aWorksDetailed','aWorksShape1','vWorksHeight'])assert(chunks.includes(name));assert(!chunks.includes('aWorksNormal'));
  const known=new Set(['uniform','attribute','varying','vec2','vec3','vec4','float','normal','position','instanceMatrix','diffuseColor','max','mix','step','distance','fract','sin','dot']);
  // Include comma-separated uniforms in the declared set.
  for(const name of ['uWorksNear','uWorksFar','uWorksKeep','aWorksRank','aWorksDetailed','aWorksShape1','aWorksShape2','aWorksShape3','aWorksSail','aWorksSailPart'])declared.add(name);
  for(const m of code.matchAll(/\b[A-Za-z_]\w*\b/g))if(code[m.index-1]!=='.')assert(known.has(m[0])||declared.has(m[0]),'undeclared '+m[0]);
  for(const kind of ['rock','pier','boat'])for(const far of [false,true])for(const key of ['lambert','basic','depth']) {
    const base=THREE.ShaderLib[key],m=key==='depth'?new THREE.MeshDepthMaterial():new THREE.MeshLambertMaterial();
    for(const hook of ['common','begin_vertex'])assert(base.vertexShader.includes('#include <'+hook+'>'));
    if(kind==='rock'&&key!=='depth')assert(base.fragmentShader.includes('#include <color_fragment>'));
    installWorksShader(m,{},kind,far);const shader={uniforms:{},vertexShader:base.vertexShader,fragmentShader:base.fragmentShader};m.onBeforeCompile(shader);balanced(expand(shader.vertexShader));balanced(expand(shader.fragmentShader));m.dispose();
  }
});

test('steady update and motion own no arrays, objects, closures or Three constructors',async()=>{
  const src=await fs.readFile(new URL('../dist/valley/kamakura-works-view.js',import.meta.url),'utf8');
  const section=src.slice(src.indexOf('    update(frame)'),src.indexOf('    setAdapt(step)'));
  assert.doesNotMatch(section,/\bnew\b|=>|\.map\(|\.filter\(|\.slice\(|\.clone\(/);
  assert.doesNotMatch(section.replace(/if\([^\n]*\)\{/g,''),/=\s*\[|=\s*\{/);
  const rules=await fs.readFile(new URL('../dist/valley/kamakura-works.js',import.meta.url),'utf8');const motion=rules.slice(rules.indexOf('export function worksMotion'),rules.indexOf('export function worksCircles'));
  assert.doesNotMatch(motion,/\bnew\b|=>|=\s*\[|=\s*\{/);
});

test('private world without works remains inactive, including v12 (no geography printed)',async t=>{
  if(!process.env.KZ_WORLD_DIR)return t.skip('KZ_WORLD_DIR未設定');
  const dir=process.env.KZ_WORLD_DIR,meta=JSON.parse(await fs.readFile(path.join(dir,'meta.json'),'utf8'));
  if(meta.works)return t.skip('この検査はworksなしの世界専用');
  assert.equal(createKamakuraWorks({data:{meta},search:'?debug=1'}),null);
});
