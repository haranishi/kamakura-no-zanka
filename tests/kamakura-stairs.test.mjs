import test from 'node:test';
import assert from 'node:assert/strict';
import {STAIRS,validateSteps,withStairRamps} from '../dist/valley/kamakura-stairs.js';
import {decodeFacilities,facilityPlacement} from '../dist/valley/kamakura-facilities.js';
import {buildColliders,moveActor} from '../dist/valley/collision.js';
import {verifyFacilities} from '../tools/lib/kamakura-facility-validation.mjs';
import {fixture} from './helpers/kamakura-fixture.mjs';
import {decodeData} from '../dist/valley/kamakura-data.js';
const near=(a,b)=>assert(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const node=()=>({node:'synthetic-stair',part:'stairs',soft:true,facility:'test',source:'test',status:null,triangles:4,anchor_xz:[0,0],rel_anchor:0,bbox_min:[-5,0,0],bbox_max:[5,7.5,20],steps:{from_xz:[0,0],to_xz:[0,20],rise_m:7.5,width_m:10}});
const catalog=n=>({schema:'kz-facilities/0.1',kit:'facilities.glb',count:1,total_triangles:4,parts:{[n.part]:1},nodes:[n]});
const terrain=()=>({bounds:{minX:-500,maxX:500,minZ:-500,maxZ:500},heightAt:()=>13.5,slopeAt:()=>0,waterAt:()=>0,walkable:()=>true,movementBlockedAt:()=>null,maxSlope:46});
test('D1 validated optional stairs preserve the catalog soft whitelist and reject invalid shapes/ranges/grade',()=>{
  assert.equal(decodeFacilities(catalog(node())).nodes.length,1);
  for(const change of [n=>n.part='hall',n=>n.soft=false,n=>n.steps=null,n=>n.steps.extra=1,n=>n.steps.from_xz=[0],n=>n.steps.to_xz=[NaN,20],n=>n.steps.to_xz=[0,Infinity],n=>n.steps.rise_m=.19,n=>n.steps.rise_m=61,n=>n.steps.width_m=.9,n=>n.steps.width_m=41,n=>n.steps.to_xz=[0,.5],n=>n.steps.to_xz=[0,201],n=>n.steps.rise_m=30,n=>n.steps.base_m='0',n=>n.steps.base_m=NaN,n=>n.steps.base_m=50.01,n=>n.steps.base_m=-50.01,n=>n.steps.landing_m=-.01,n=>n.steps.landing_m=20.01,n=>n.steps.landing_m='1']){
    const n=node();change(n);assert.throws(()=>decodeFacilities(catalog(n)));
  }
  for(const [rise,length,width] of [[.2,1,1],[60,50,40]]){const n=node();Object.assign(n.steps,{rise_m:rise,to_xz:[0,length],width_m:width});validateSteps(n);}
});
test('D1 new stair mesh retains its vertices, anchor height and normals; missing metadata/steps=0 keeps paving bytes',()=>{
  const n=node(),p=new Float32Array([0,0,0,5,7.5,20,-5,.18,1]),t=terrain(),placed=facilityPlacement(n,p,t);
  assert.deepEqual(placed.positions,p);near(placed.position.y,13.5);assert(!placed.rebuildNormals);
  const old={...n};delete old.steps;
  assert.deepEqual(facilityPlacement(n,p,t,{search:'?steps=0'}),facilityPlacement(old,p,t));
  near(facilityPlacement(old,p,t).positions[4],13.62);
});
test('D1 the facility checker accepts built stairs set down whole, and still holds draped stairs to the paving rule',()=>{
  // The checker walks a decoded world. Without this rule a world with built stairs failed it (found with the designed map).
  const f=fixture({width:40,height:40}),data=decodeData(f.meta,f.heights.buffer,f.walk.buffer);
  const built={...node(),anchor_xz:[4,4],steps:{from_xz:[4,4],to_xz:[4,14],rise_m:3,width_m:4}},draped={...node(),node:'paved'};delete draped.steps;draped.anchor_xz=[-20,-20];
  const p=new Float32Array([0,0,0, 2,3,10, -2,.18,.5]),input={facilities:{nodes:[built,draped],catalog:{total_triangles:8}},positions:new Map([[built.node,p],[draped.node,p]])};
  const report=verifyFacilities(data,input);
  for(const scale of [1,1.8]){const g=report.grounding.byVerticalScale[scale];assert.equal(g.built,1);assert.equal(g.soft,1);assert.equal(g.hard,0);assert.equal(g.softVertices,3);}
});
test('D1 the ramp starts at the height the model is set down at, not at the ground under its lower end',()=>{
  // A hollow under the steps (ground 3.5 m below the model's zero) must not pull the ramp down with it.
  const t={...terrain(),heightAt:()=>10},n=node();n.rel_anchor=3.5;
  const placed=facilityPlacement(n,new Float32Array([0,0,0]),t),r=withStairRamps(t,[n]);
  near(placed.position.y,13.5);near(r.heightAt(0,0),13.5-STAIRS.noseInsetM);near(r.heightAt(0,20),21-STAIRS.noseInsetM);
  n.steps.base_m=.5;const lifted=withStairRamps(t,[n]);near(lifted.heightAt(0,10),13.5+.5+3.75-STAIRS.noseInsetM);
  for(const base_m of [-50,0,50]){const m=node();m.steps.base_m=base_m;validateSteps(m);}
  // The anchor may lie away from the lower end: the datum is still the anchor's.
  const off=node();off.anchor_xz=[30,-7];const slope={...terrain(),heightAt:(x,_z)=>13.5+x/10},shifted=withStairRamps(slope,[off]);
  near(shifted.heightAt(0,10),Math.max(13.5,16.5+3.75-STAIRS.noseInsetM));
});
test('D1 a landing keeps the height of the last nose, level, for its length beyond the upper end',()=>{
  // The ground under a landing slab lies lower (it must stay under the treads): without the landing the hero dropped into it.
  const t={...terrain(),heightAt:(_x,z)=>z>20.9?21:13.5},n=node();n.steps.landing_m=1;const r=withStairRamps(t,[n]),top=21-STAIRS.noseInsetM;
  near(r.heightAt(0,20),top);near(r.heightAt(0,20.5),top);near(r.heightAt(0,20.9),top);near(r.slopeAt(0,20.5),0);near(r.slopeAt(0,19.5),Math.atan(7.5/20)*180/Math.PI);
  near(r.heightAt(0,21.01),21);assert.equal(r.inspectStairs({x:0,z:20.5}).under,'synthetic-stair');assert.equal(r.inspectStairs({x:0,z:21.01}).under,null);
  const plain=withStairRamps(t,[node()]);near(plain.heightAt(0,20.5),13.5);
  for(const landing_m of [0,20]){const m=node();m.steps.landing_m=landing_m;validateSteps(m);}
  // A landing near a cell boundary of the index is still found.
  const far=node();far.steps={from_xz:[0,10],to_xz:[0,31],rise_m:7.5,width_m:10,landing_m:3};far.anchor_xz=[0,10];const q=withStairRamps(terrain(),[far]);near(q.heightAt(0,33.5),13.5+7.5-STAIRS.noseInsetM);
});
test('D1 ramp endpoints, rectangle, slope and max with terrain; empty/disabled inputs keep object identity',()=>{
  const t=terrain(),n=node(),r=withStairRamps(t,[n]);
  near(r.heightAt(0,0),13.5);near(r.heightAt(0,20),21-STAIRS.noseInsetM);
  near(r.heightAt(0,10),17.25-STAIRS.noseInsetM);near(r.slopeAt(0,10),Math.atan(7.5/20)*180/Math.PI);
  for(const [x,z] of [[5.01,10],[0,-.01],[0,20.01]]){near(r.heightAt(x,z),13.5);near(r.slopeAt(x,z),0);}
  near(r.heightAt(5,10),r.heightAt(0,10));near(r.slopeAt(0,0),0);
  const high=withStairRamps({...t,heightAt:(_x,z)=>13.5+z,slopeAt:()=>45},[n]);near(high.heightAt(0,10),23.5);near(high.slopeAt(0,10),45);
  assert.equal(withStairRamps(t,[]),t);assert.equal(withStairRamps(t,[n],{search:'?steps=0'}),t);
});
test('D1 rotated and overlapping ramps select the highest floor without touching the source terrain',()=>{
  const t=terrain(),a=node(),b=node();b.node='cross';b.steps={from_xz:[-10,10],to_xz:[10,10],rise_m:10,width_m:2};
  const r=withStairRamps(t,[a,b]);near(r.heightAt(0,10),18.5-STAIRS.noseInsetM);assert.equal(r.inspectStairs({x:0,z:10}).under,'cross');near(t.heightAt(0,10),13.5);
});
test('D1 walk up/down with real collision, replace old steep slope, retain water/bounds, debug and release',()=>{
  const t=terrain(),n=node(),r=withStairRamps(t,[n]),col=buildColliders({bounds:t.bounds});
  let pos={x:0,z:-1,y:13.5};
  for(let k=0;k<44;k++){pos=moveActor(col,r,pos,0,.5,.3);assert(!pos.blocked);pos.y=r.heightAt(pos.x,pos.z);}
  // The test terrain continues flat beyond the top; return from the top itself.
  pos={x:0,z:20,y:r.heightAt(0,20)};
  for(let k=0;k<42;k++){pos=moveActor(col,r,pos,0,-.5,.3);assert(!pos.blocked);pos.y=r.heightAt(pos.x,pos.z);}
  const info=r.inspectStairs({x:0,z:10,y:r.heightAt(0,10)});assert.equal(info.count,1);assert.equal(info.under,n.node);near(info.nearest.distance,0);near(info.base,13.5);
  const steep=withStairRamps({...t,slopeAt:()=>60,movementBlockedAt:()=> 'slope'},[n]);assert.equal(steep.movementBlockedAt(0,10),null);assert.equal(steep.movementBlockedAt(30,10),'slope');
  for(const why of ['water','bounds'])assert.equal(withStairRamps({...t,movementBlockedAt:()=>why},[n]).movementBlockedAt(0,10),why);
  r.disposeStairs();r.disposeStairs();assert.equal(r.inspectStairs({x:0,z:10}).count,0);near(r.heightAt(0,10),13.5);
});

test('D1 rotated upper endpoints tolerate projection roundoff, and huge finite index keys terminate',()=>{
  const t=terrain();
  for(let i=1;i<=1000;i++){
    const n=node(),x=20*Math.sin(i),z=20*Math.cos(i);n.steps.to_xz=[x,z];
    const r=withStairRamps(t,[n]);near(r.heightAt(x,z),21-STAIRS.noseInsetM);r.disposeStairs();
  }
  const n=node();n.steps.from_xz=[1e100,0];n.steps.to_xz=[1e100,20];const r=withStairRamps(t,[n]);near(r.heightAt(1e100,20),21-STAIRS.noseInsetM);r.disposeStairs();
});
