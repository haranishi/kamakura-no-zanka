import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.min.js';
import { decodeWorks,fencePlan,fenceCircles,prepareWorks,WORKS as W } from '../dist/valley/kamakura-works.js';
import { worksFenceGeometry,WORKS_ART } from '../dist/valley/kamakura-works-kit.js';
import { createKamakuraWorks,installWorksShader } from '../dist/valley/kamakura-works-view.js';
import { HOUSE_PALETTE } from '../dist/valley/kamakura-house-texture.js';
import { buildColliders,segmentBlocked,moveActor } from '../dist/valley/collision.js';
const fence=()=>({id:'pass-side',kind:'rail',xy_m:[[0,0],[9,0],[9,7]],height_m:1.1});
const source=()=>({schema:'kz-works/0.1',fences:[fence()]});
const terrain={bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100},heightAt:(x,z)=>3+x*.1-z*.05,waterAt:()=>0,slopeAt:()=>0,walkAt:()=>true};
const near=(a,b)=>assert(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const triangles=g=>(g.index?.count??g.attributes.position.count)/3;
function context(s=source(),quality='standard',search='?debug=1&worksdebug=1') {return {data:{works:s},quality,search,terrain,scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),colliders:buildColliders({bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100}})};}
function finish(c,l) {const f={dt:1/60,camera:c.camera,pos:c.camera.position};for(let i=0;i<100;i++){l.update(f);if(globalThis.__kzWorks().ready)return f;}assert.fail('preparation not ready');}

test('rail input: optional array, strict kind/points/heights/ids, 24 fences, 64 points, total 800m',()=>{
  assert.equal(decodeWorks(source()).fences.length,1);assert.deepEqual(decodeWorks({schema:'kz-works/0.1'}).fences,[]);
  for(const mutate of [s=>s.fences=null,s=>s.fences={},s=>s.fences[0]=null,s=>s.fences[0].kind='wall',s=>s.fences[0].height_m=.59,s=>s.fences[0].height_m=1.61,s=>s.fences[0].height_m='1',s=>s.fences[0].id='',s=>s.fences[0].xy_m=[[0,0]],s=>s.fences[0].xy_m=[[0,0],[0,0]],s=>s.fences[0].xy_m=[[0,0],[NaN,0]],s=>s.fences.push(fence()),s=>s.fences=Array.from({length:25},(_,i)=>({...fence(),id:''+i})),s=>s.fences[0].xy_m=Array.from({length:65},(_,i)=>[i,0]),s=>s.fences[0].xy_m=[[0,0],[801,0]]]) {
    const s=source();mutate(s);assert.throws(()=>decodeWorks(s));
  }
  const boundary=source();boundary.fences[0].xy_m=[[0,0],[800,0]];assert.equal(decodeWorks(boundary).fences.length,1);
  boundary.fences.push({...fence(),id:'extra'});assert.throws(()=>decodeWorks(boundary));
  for(const height_m of [.6,1.6])assert(decodeWorks({...source(),fences:[{...fence(),height_m}]}));
  const duplicate=source();duplicate.piers=[{id:'pass-side',xy_m:[[0,0],[0,3]],width_m:1,deck_m:1}];assert.throws(()=>decodeWorks(duplicate));
});
test('posts hit every corner, intervals <=2.2m, heads vary and lean <=3deg; rails connect posts over sloping ground',()=>{
  const f=fence(),p=fencePlan(f,terrain);assert.deepEqual(p,fencePlan(f,terrain));
  for(const [x,north] of f.xy_m)assert(p.posts.some(v=>v.x===x&&v.z===-north));
  assert(new Set(p.posts.map(v=>v.height)).size>1);
  for(let i=0;i<p.posts.length;i++) {
    const a=p.posts[i];near(a.y,terrain.heightAt(a.x,a.z));assert(a.diameter>=.12&&a.diameter<=.16);assert(Math.abs(a.tiltX)<=3*Math.PI/180);assert(Math.abs(a.tiltZ)<=3*Math.PI/180);
    if(!i)continue;const prev=p.posts[i-1];assert(Math.hypot(a.x-prev.x,a.z-prev.z)<=2.2+1e-8);
    for(let row=0;row<2;row++){const r=p.rails[(i-1)*2+row];near(r.a.x,prev.x);near(r.a.z,prev.z);near(r.b.x,a.x);near(r.b.z,a.z);near(r.a.y-prev.y,f.height_m*[.45,.85][row]);near(r.b.y-a.y,f.height_m*[.45,.85][row]);assert(r.diameter>=.07&&r.diameter<=.09);}
  }
  assert.throws(()=>fencePlan(f,{heightAt:()=>NaN}));
});
test('collider circles stay on authored lines, stop crossing but leave the adjacent path walkable',()=>{
  const p=fencePlan(fence(),terrain),circles=fenceCircles([p]);
  for(const c of circles)assert((c.z===0&&c.x>=0&&c.x<=9)||(c.x===9&&c.z<=0&&c.z>=-7));
  const col=buildColliders({bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100},extraCircles:circles});
  for(let x=.1;x<8.8;x+=.13){const y=terrain.heightAt(x,0)+.5;assert(segmentBlocked(col,terrain,{x,y,z:-1},{x,y,z:1}));}
  assert(!segmentBlocked(col,terrain,{x:0,y:4,z:1},{x:8,y:4,z:1}));
  const result=moveActor(col,terrain,{x:1,y:terrain.heightAt(1,1),z:1},6,0);assert(result.x>6);
});
test('rail geometry: aged wood source, nondegenerate faces, heads and overhangs, bounded mesh and shadow shader hooks',()=>{
  assert.equal(WORKS_ART.fenceColor,HOUSE_PALETTE.oldWood);
  const p=fencePlan(fence(),terrain),g=worksFenceGeometry([p]);assert.equal(triangles(g),p.posts.length*10+p.rails.length*8);
  const pos=g.attributes.position,normal=g.attributes.normal,a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  for(let i=0;i<pos.count;i+=3){a.fromBufferAttribute(pos,i);b.fromBufferAttribute(pos,i+1);c.fromBufferAttribute(pos,i+2);assert(b.sub(a).cross(c.sub(a)).lengthSq()>1e-15);}
  for(let i=0;i<normal.count;i++)near(Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i)),1);
  let minX=Infinity;for(let i=0;i<pos.count;i++)minX=Math.min(minX,pos.getX(i));assert(minX<-.1,'rails project beyond first post');
  assert.equal(g.attributes.aWorksFenceRank.count,pos.count);g.dispose();
  for(const type of ['lambert','basic','depth']) {
    const m=new THREE.MeshLambertMaterial(),base=THREE.ShaderLib[type];installWorksShader(m,{},'fence');assert.equal(m.defines.WORKS_PIER,1);assert.equal(m.defines.WORKS_FENCE,1);
    const shader={uniforms:{},vertexShader:base.vertexShader,fragmentShader:base.fragmentShader};m.onBeforeCompile(shader);assert(shader.vertexShader.includes('worksRank = aWorksFenceRank'));assert(!shader.vertexShader.includes('#include <begin_vertex>'));m.dispose();
  }
});
test('one fence draw, stats and debug color, distance/quality reduction, immutable collisions and exact disposal',t=>{
  const c=context(),l=createKamakuraWorks(c),frame=finish(c,l),m=c.scene.children[0].children[0],info=globalThis.__kzWorks();
  assert.equal(info.fences,1);assert.equal(info.posts,10);assert.equal(info.drawn.draws,1);assert.equal(info.drawn.triangles,244);assert(c.colliders.circles.length>10);assert(m.castShadow&&m.receiveShadow);assert(m.customDepthMaterial);assert(m.material.isMeshBasicMaterial);
  const events=new Map();for(const r of [m.geometry,m.material,m.customDepthMaterial]){events.set(r,0);r.addEventListener('dispose',()=>events.set(r,events.get(r)+1));}
  c.camera.position.set(0,700,0);l.update(frame);assert.equal(globalThis.__kzWorks().drawn.draws,1);l.setAdapt(3);c.camera.position.set(0,2200,0);l.update(frame);assert.equal(globalThis.__kzWorks().drawn.draws,0);
  assert.equal(c.colliders.circles.length,fenceCircles([fencePlan(fence(),terrain)]).length);
  t.diagnostic(JSON.stringify({fences:info.fences,posts:info.posts,triangles:info.drawn.triangles,draws:info.drawn.draws,work:info.work,colliders:c.colliders.circles.length}));
  l.dispose();l.dispose();assert.equal(c.colliders.circles.length,0);assert.equal(globalThis.__kzWorks,undefined);for(const n of events.values())assert.equal(n,1);
  assert.equal(createKamakuraWorks({...c,search:'?works=0'}),null);
});
test('maximal bends plus rocks stay within the shared geometry budget; quality reduces complete fences',t=>{
  const s={schema:'kz-works/0.1',fences:Array.from({length:24},(_,i)=>({id:'rail'+i,kind:'rail',height_m:1,xy_m:Array.from({length:64},(_,j)=>[i*2,j*.5])})),rocks:[{id:'rocks',shape:'disc',x:0,y:0,radius:50,count:2000,size_m:[1,2]}]};
  const result=prepareWorks(s,terrain);assert.equal(result.fences.length,24);
  const c=context(s),l=createKamakuraWorks(c),frame=finish(c,l),info=globalThis.__kzWorks();assert(info.drawn.draws<=W.draws);assert(info.drawn.triangles<=W.nearTriangles);
  const full=info.drawn.near;l.setAdapt(3);l.update(frame);assert(globalThis.__kzWorks().drawn.near<full);t.diagnostic(JSON.stringify({posts:info.posts,triangles:info.drawn.triangles,draws:info.drawn.draws,work:info.work}));l.dispose();
});

test('simultaneous maximum rail length, bends, piers and boats use coarse post sides within the total budget',t=>{
  const s={schema:'kz-works/0.1',fences:Array.from({length:24},(_,i)=>({id:'f'+i,kind:'rail',height_m:1,xy_m:Array.from({length:64},(_,j)=>[i,j===0?0:33.3333+(j-63)*.0001])})),piers:Array.from({length:8},(_,i)=>({id:'p'+i,xy_m:[[i*10,0],[i*10,-60]],width_m:2.6,deck_m:1.4})),moorings:Array.from({length:24},(_,i)=>({x:i,y:-20,yaw_deg:0,kind:'boat'}))};
  const c=context(s);c.terrain={...terrain,heightAt:()=>-3};const l=createKamakuraWorks(c),frame=finish(c,l),info=globalThis.__kzWorks();
  assert.equal(info.fences,24);assert.equal(info.posts,1896);assert(info.drawn.triangles<=W.nearTriangles);assert(info.drawn.draws<=W.draws);
  const fenceMesh=c.scene.children[0].getObjectByName('works-fence-near');assert.equal(triangles(fenceMesh.geometry),1896*7+(1896-24)*16);
  t.diagnostic(JSON.stringify({posts:info.posts,triangles:info.drawn.triangles,draws:info.drawn.draws}));l.dispose();
});
