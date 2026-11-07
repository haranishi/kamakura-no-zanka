import test from 'node:test';
import assert from 'node:assert/strict';
import { createChunkJobs, withinChunkBudget, chunkBudget, shouldPlanChunks } from '../dist/valley/kamakura-chunk-jobs.js';
import { chunkGeometry, LODS } from '../dist/valley/kamakura-chunks.js';
import { verifyScheduledSeams } from '../tools/lib/kamakura-chunk-validation.mjs';
import { load, THREE } from './helpers/tree-modules.mjs';
const { buildKamakuraChunks } = await load('kamakura-chunk-view.js');
function cross() {
  const chunks = [[0,0],[0,-64],[0,64],[-64,0],[64,0]].map(([x,z]) => ({ x, z, step: 8, loaded: true }));
  const neighbors = ch => Object.fromEntries([['north',0,-64],['south',0,64],['west',-64,0],['east',64,0]].map(([s,x,z]) => [s,chunks.find(n => n.x === ch.x+x && n.z === ch.z+z)]));
  return { chunks, neighbors };
}
test('jobs: near-first, budget boundary/overrun yields, planning at 3m or every fourth frame', () => {
  assert.equal(chunkBudget('standard'), 3); assert.equal(chunkBudget('light'), 2);
  assert(withinChunkBudget(0, 20, 0, 3)); assert(!withinChunkBudget(0, 3, 1, 3)); assert(!withinChunkBudget(0, 9, 1, 3)); assert(withinChunkBudget(5, 6, 1, 2));
  assert(shouldPlanChunks(null,{x:0,z:0},1)); assert(!shouldPlanChunks({x:0,z:0},{x:2,z:0},1));
  assert(shouldPlanChunks({x:0,z:0},{x:3,z:0},1)); assert(shouldPlanChunks({x:0,z:0},{x:0,z:0},4));
  const { chunks, neighbors } = cross(); const jobs = createChunkJobs(chunks, neighbors, () => 1);
  jobs.plan({x:0,z:-60}); assert.equal(jobs.next().center, chunks[1]);
});
test('jobs: atomic five-way commit, target change cancels generation including neighbour target, late result rejected', () => {
  const { chunks, neighbors } = cross(); let want = 1;
  const jobs = createChunkJobs(chunks, neighbors, () => want); jobs.plan({x:0,z:0});
  const batch = jobs.next(); assert.equal(batch.jobs.length, 5); assert.equal(batch.jobs[0].ch, chunks[0]);
  for (const job of batch.jobs.slice(0,4)) jobs.prepared(batch.generation,job);
  assert.equal(jobs.commit(batch.generation), null); assert(chunks.every(ch => ch.step === 8));
  want = 4; jobs.plan({x:0,z:0}); assert.equal(jobs.active, null);
  assert.equal(jobs.prepared(batch.generation,batch.jobs[4]), false); assert.equal(jobs.commit(batch.generation), null);
  const next = jobs.next(); assert(next.generation > batch.generation);
  for (const job of next.jobs) jobs.prepared(next.generation,job);
  assert.equal(jobs.commit(next.generation).length, 5); assert.equal(chunks[0].step,4); assert(chunks.slice(1).every(ch=>ch.step===8));
  const neighborJobs = createChunkJobs(chunks, neighbors, (ch,d) => ch === chunks[0] ? 1 : d < 65 ? 2 : 4);
  neighborJobs.plan({x:0,z:0}); const nb=neighborJobs.next(); neighborJobs.plan({x:0,z:10}); assert.equal(neighborJobs.active,null); assert.equal(neighborJobs.commit(nb.generation),null);
});
const terrain = { w:193, h:193, cell:1, x0:0, z0:0, maskAt:()=>true,
  heightAt:(x,z)=> 20+Math.sin(x*.17)+Math.cos(z*.13), normalAt:(x,z)=>({x:Math.sin(x*.1)*.1,y:1,z:Math.cos(z*.1)*.1}), groundColorAt:(x,z)=>[x/1000,.3,z/1000] };
function edge(g,axis,value) {
  const out=new Map(); for(let k=0;k<g.positions.length;k+=3) if(g.positions[k+axis]===value) out.set(g.positions[k+(axis===0?2:0)],[g.positions[k+1],...g.normals.slice(k,k+3),...g.colors.slice(k,k+3)]); return out;
}
function equalEdge(a,b,axis) { const l=edge(a,axis,64),r=edge(b,axis,64); assert.equal(l.size,65); assert.equal(r.size,65); for(const [k,v] of l) v.forEach((x,c)=>assert(Math.abs(x-r.get(k)[c])<1e-7)); }
test('jobs geometry path: all 16 LOD pairs x EW/NS share height/normal/color before and after atomic commit', () => {
  for(const a of LODS) for(const b of LODS) for(const axis of [0,2]) {
    const left={x:32,z:32,step:a,loaded:true,i:0,j:0},right={x:axis===0?96:32,z:axis===2?96:32,step:b,loaded:true,i:axis===0?64:0,j:axis===2?64:0};
    const side=axis===0?['east','west']:['south','north']; const neighbors=ch=>({[side[ch===left?0:1]]:ch===left?right:left});
    const geometry=(ch,step,edges)=>chunkGeometry(terrain,ch.i,ch.j,ch.i+64,ch.j+64,step,edges);
    const visible=new Map([left,right].map(ch=>[ch,geometry(ch,ch.step,Object.fromEntries(Object.entries(neighbors(ch)).map(([s,n])=>[s,n.step])))]));
    equalEdge(visible.get(left),visible.get(right),axis);
    const nextStep=LODS[(LODS.indexOf(a)+1)%4]; const jobs=createChunkJobs([left,right],neighbors,ch=>ch===left?nextStep:b); jobs.plan(left);
    const batch=jobs.next(), pending=new Map(); assert.equal(batch.jobs.length,2);
    for(const [k,job] of batch.jobs.entries()) { pending.set(job.ch,geometry(job.ch,job.step,job.edges)); jobs.prepared(batch.generation,job); if(k===0) { assert.equal(jobs.commit(batch.generation),null); equalEdge(visible.get(left),visible.get(right),axis); } }
    for(const job of jobs.commit(batch.generation)) visible.set(job.ch,pending.get(job.ch)); equalEdge(visible.get(left),visible.get(right),axis);
  }
});
test('shipped Three view (Node, no GPU): staged swap, cancellation/disposal, no leaked geometries and static matrixWorld', () => {
  const originalNow=Object.getOwnPropertyDescriptor(performance,'now'); let time=0;
  Object.defineProperty(performance,'now',{configurable:true,value:()=>{time+=4;return time;}});
  const originalDispose=THREE.BufferGeometry.prototype.dispose, originalSphere=THREE.BufferGeometry.prototype.computeBoundingSphere;
  const allocated=new Set(), disposed=new Map();
  THREE.BufferGeometry.prototype.computeBoundingSphere=function(){allocated.add(this);return originalSphere.call(this);};
  THREE.BufferGeometry.prototype.dispose=function(){disposed.set(this,(disposed.get(this)||0)+1);return originalDispose.call(this);};
  let view;
  try {
    const scene=new THREE.Scene(); view=buildKamakuraChunks(terrain,scene,{x:96,z:96});
    let n=0; while(!view.ready({x:96,z:96}) && n++<30) view.update({x:96,z:96}); assert(n<=9); assert(view.ready({x:96,z:96}));
    assert.equal(scene.children.length,9); scene.updateMatrixWorld(true);
    for(const ch of view.chunks) { assert.equal(ch.mesh.matrixAutoUpdate,false); assert.deepEqual(ch.mesh.matrixWorld.elements,new THREE.Matrix4().elements); }
    const old=view.chunks.map(ch=>ch.mesh.geometry);
    const far={x:1500,z:96}; view.update(far); const batch=view.scheduler.active; assert(batch); assert.equal(batch.jobs.filter(j=>j.done).length,1);
    assert.deepEqual(view.chunks.map(ch=>ch.mesh.geometry),old);
    const staged=[...allocated].filter(g=>!old.includes(g)); view.update({x:96,z:96}); assert.equal(view.scheduler.active,null);
    for(const g of staged) assert.equal(disposed.get(g),1); assert.deepEqual(view.chunks.map(ch=>ch.mesh.geometry),old);
    view.update(far); const replacement=view.scheduler.active; let frames=1;
    while(view.scheduler.active===replacement && frames++<6) view.update(far);
    assert(frames<=5); assert(old.some(g=>disposed.has(g))); assert(view.chunks.some((ch,i)=>ch.mesh.geometry!==old[i]));
    // Dispose with a second, partially prepared transaction in flight.
    view.update({x:96,z:96}); view.dispose(); view.dispose(); view.update(far); assert.equal(scene.children.length,0);
    for(const g of allocated) assert.equal(disposed.get(g),1);
  } finally { view?.dispose(); THREE.BufferGeometry.prototype.dispose=originalDispose; THREE.BufferGeometry.prototype.computeBoundingSphere=originalSphere; if(originalNow) Object.defineProperty(performance,'now',originalNow); else delete performance.now; }
});

test('CLI scheduled seam verifier includes all 32 combinations', () => { assert.equal(verifyScheduledSeams(terrain).combinations,32); });

test('jobs reuse the planned queue without rescanning LOD/distance on continuation frames', () => {
  const {chunks,neighbors}=cross(); let calls=0;
  const jobs=createChunkJobs(chunks,neighbors,()=>{calls++;return 1;});jobs.plan({x:0,z:0});const planned=calls;
  for(let frame=0;frame<40;frame++) { const batch=jobs.next(); if(batch) { const job=batch.jobs.find(j=>!j.done);jobs.prepared(batch.generation,job);jobs.commit(batch.generation); } }
  assert.equal(calls,planned);assert(chunks.every(ch=>ch.step===1));assert.equal(jobs.next(),null);
});
