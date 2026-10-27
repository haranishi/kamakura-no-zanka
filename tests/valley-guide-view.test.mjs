// なぜ失敗したか: 古い設定の既定、表示段階、迂回切替の連続時間、粒の折れ点追従を壊すと案内が誤る。
// 各assertの先頭は原因の型（settings/table/plan/path/nav）。ブラウザの見え方はここでは判定しない。
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWaymarks, guideVisibility, switchGuidePlan, nearestGuideEntrance, sampleGuidePath, guideRouteHead } from '../dist/valley/guide-view.js';
import { createGuideNav } from '../dist/valley/guide-nav.js';
import { buildColliders } from '../dist/valley/collision.js';

test('settings: missing and malformed values fall back to bold',()=>{
  for(const v of [undefined,null,'',false,0,{},[], 'BOLD','quiet']) assert.equal(normalizeWaymarks(v),'bold','settings/default: legacy or invalid value must be bold');
});
test('settings: every valid level survives normalization',()=>{
  for(const v of ['bold','subtle','off']) assert.equal(normalizeWaymarks(v),v,'settings/preservation: selected level lost');
});
test('table: bold shows foot always, edge outside and distant pillar',()=>{
  assert.deepEqual(guideVisibility('bold'),{enabled:true,strong:true,foot:true,edge:false,pillar:false,pulse:true,subtle:false},'table/bold: default visibility changed');
  const v=guideVisibility('bold',{outside:true,distance:30});
  assert(v.edge && v.pillar,'table/bold-distance: outside edge and 30m pillar missing');
  assert.equal(guideVisibility('bold',{distance:29.99}).pillar,false,'table/pillar-boundary: near pillar shown');
});
test('table: subtle has thin foot without pulse or auxiliary marks',()=>{
  const v=guideVisibility('subtle',{outside:true,distance:150});
  assert(v.foot && v.subtle && !v.edge && !v.pillar && !v.pulse,'table/subtle: calm level became bold');
});
test('table: emphasis boosts subtle and forces edge inside view',()=>{
  const v=guideVisibility('subtle',{emphasized:true,distance:80});
  assert(v.strong && v.foot && v.edge && v.pillar,'table/emphasis: stalled help missing');
});
test('table: off suppresses automatic help but G temporarily restores bold',()=>{
  const off=guideVisibility('off',{emphasized:true,outside:true,distance:150});
  assert(!off.enabled && !off.foot && !off.edge && !off.pillar,'table/off: automatic marks leaked');
  const on=guideVisibility('off',{guiding:true,outside:true,distance:150});
  assert(on.enabled && on.foot && on.edge && on.pillar,'table/G-override: off prevented manual guide');
});
test('table: only free has foot; dialogue, pause and result suppress marks',()=>{
  assert.equal(guideVisibility('bold',{mode:'combat'}).foot,false,'table/combat: foot leaked');
  for(const mode of ['dialogue','paused','result']) {
    const v=guideVisibility('bold',{mode,guiding:true,outside:true,distance:150});
    assert(!v.enabled && !v.foot && !v.edge && !v.pillar,'table/mode: nonplay mark leaked');
  }
});
test('table: center arrival hides movement and reduced motion stops pulse',()=>{
  const v=guideVisibility('bold',{reached:true,guiding:true,emphasized:true,outside:true,distance:150});
  assert(!v.foot && !v.edge && !v.pillar,'table/arrival: center did not clear marks');
  assert.equal(guideVisibility('bold',{reduced:true}).pulse,false,'table/reduced: pulse continued');
});
for(const plan of ['north','south']) test(`plan: ${plan} switches only after three continuous seconds at 25m/10m boundaries`,()=>{
  const observe=(state,t,currentDistance=25,otherDistance=10,active=true)=>switchGuidePlan(plan,state,{currentDistance,otherDistance,t,active});
  const a=observe(null,10);
  assert.equal(observe(a.state,12.999).plan,plan,'plan/early: switched before three seconds');
  assert.equal(observe(a.state,13).plan,plan==='north'?'south':'north','plan/dwell: three-second switch missing');
  assert.equal(observe(a.state,12,24.99).state,null,'plan/current-boundary: inside current road did not reset');
  assert.equal(observe(a.state,12,25,10.01).state,null,'plan/other-boundary: outside other road did not reset');
  assert.equal(observe(a.state,12,25,10,false).state,null,'plan/mode: combat or pause kept dwell');
  assert.equal(observe(null,13).plan,plan,'plan/continuous: discontinuous samples switched');
  assert.equal(observe(a.state,9).state.since,9,'plan/time-reset: backwards clock inherited dwell');
});
test('plan: front is fixed and nearest entrance is chosen from world centers',()=>{
  assert.equal(switchGuidePlan('front',null,{currentDistance:100,otherDistance:0,t:100}).plan,'front','plan/front: front switched sideways');
  const zones={village_front:{x:0,z:10},village_north:{x:0,z:-10},village_south:{x:20,z:0}};
  for(const [pos,expected] of [[{x:0,z:9},'front'],[{x:0,z:-9},'north'],[{x:19,z:0},'south']]) assert.equal(nearestGuideEntrance(zones,pos),expected,'plan/entrance: wrong closest center');
});
test('path: particles cover forty meters along an elbow without cutting it',()=>{
  const p=sampleGuidePath([{x:0,z:0},{x:20,z:0},{x:20,z:40}],5);
  assert.deepEqual(p,[{x:0,z:0},{x:10,z:0},{x:20,z:0},{x:20,z:10},{x:20,z:20}],'path/elbow: particle path cut corner or exceeded 40m');
});
test('path: short, zero-length, duplicate, singleton and zero-count paths stay finite',()=>{
  const a={x:2,z:3},b={x:5,z:3};
  assert.deepEqual(sampleGuidePath([a,b],2),[a,b],'path/short: endpoint overrun');
  assert.deepEqual(sampleGuidePath([a,a,b],2),[a,b],'path/duplicate: zero segment broke interpolation');
  assert.deepEqual(sampleGuidePath([a],3),[a,a,a],'path/singleton: nonfinite particle');
  assert.deepEqual(sampleGuidePath([a,b],0),[],'path/empty: unexpected particle');
  assert.deepEqual(sampleGuidePath([a,b],1),[a],'path/one: first particle moved');
  assert.deepEqual(sampleGuidePath([a,b],2,0),[a,a],'path/zero-range: particle moved');
});
test('path: malformed particle inputs reject with TypeError',()=>{
  for(const args of [[[],2],[[{x:NaN,z:0}],2],[[{x:0,z:0}],-1],[[{x:0,z:0}],1.5],[[{x:0,z:0}],2,Infinity]]) assert.throws(()=>sampleGuidePath(...args),TypeError,'path/input: invalid path accepted');
});
test('nav: shared adapter includes terrain, static obstacles and 0.3m hero radius',()=>{
  const bounds={minX:-10,minZ:-10,maxX:10,maxZ:10};
  const col=buildColliders({bounds,buildings:[],props:[],extraCircles:[{x:0,z:0,r:1}],extraBoxes:[]});
  const terrain={bounds,waterAt:()=>0,slopeAt:()=>0,heightAt:()=>0,walkable:(x,z)=>z<5};
  const nav=createGuideNav({world:{bounds},terrain,col});
  assert.equal(nav.bounds,bounds,'nav/bounds: world bounds lost');
  assert.equal(nav.walkable(0,0),false,'nav/obstacle: circle ignored');
  assert.equal(nav.walkable(1.2,0),false,'nav/radius: hero radius ignored');
  assert.equal(nav.walkable(2,0),true,'nav/free: open terrain blocked');
  assert.equal(nav.walkable(2,6),false,'nav/terrain: terrain ignored');
  assert.equal(nav.walkable(2,0),true,'nav/cache: repeated query changed');
});

test('path: recovery heading advances instead of returning to a stale origin',()=>{
  const points=[{x:0,z:0},{x:10,z:0},{x:10,z:10}];
  assert.deepEqual(guideRouteHead(points,{x:3,z:0}).direction,{x:1,z:0},'path/stale-origin: recovery points backwards');
  const turn=guideRouteHead(points,{x:10,z:2});
  assert.equal(turn.segment,1,'path/progress: recovery did not advance segment');
  assert.deepEqual(turn.direction,{x:0,z:1},'path/turn: recovery cut next corner');
  assert.deepEqual(guideRouteHead(points,{x:10,z:10},1).direction,{x:0,z:0},'path/endpoint: nonfinite direction');
  assert.deepEqual(guideRouteHead([],{x:0,z:0}).direction,{x:0,z:0},'path/empty-route: nonzero heading');
});
