import test from 'node:test';
import assert from 'node:assert/strict';
import { createFieldMap, createFieldCell, stepFieldCell, fieldOptions, FIELD_KINDS, FIELD_DENSITIES, FIELDS, fieldLodScale } from '../dist/valley/kamakura-fields.js';
import { buildColliders } from '../dist/valley/collision.js';

const habitat=(weights={})=>({at(x,z,out){Object.assign(out,{meadow:1,forest:0,sand:0,town:0,bare:0,temple:0},weights);return out;}});
const world=(weights={},extra={})=>({terrain:{heightAt:()=>0,riverDistanceAt:()=>100,seaDistanceAt:()=>40,...extra.terrain},habitat:habitat(weights),...extra});
const finish=(map,cx,cz,options)=>{const j=createFieldCell(map,cx,cz,options);while(!j.done)stepFieldCell(map,j);return j.records;};
function findField(map,kind) {for(let x=-400;x<400;x+=10)for(let z=-400;z<400;z+=10){const f=map.fieldAt(x,z);if(f.strength>.99&&(!kind||f.kind===kind))return {x,z};}assert.fail('synthetic field not found');}

test('flags clamp density and preserve an integer seed, including zero',()=>{
  assert.equal(fieldOptions('?fields=0').enabled,false);assert.equal(fieldOptions('?fields=0.0').enabled,false);
  assert.equal(fieldOptions('?fields=9').density,3);assert.equal(fieldOptions('?fields=-4').density,.25);
  assert.equal(fieldOptions('?fields=bad').density,1);assert.equal(fieldOptions('?fieldseed=0').seed,0);
  assert.equal(fieldOptions('?fieldseed=1.5').seed,FIELDS.seed);
});

test('seeded colonies cover 12–30% of uniform meadow and have coherent interiors and >40m spans',t=>{
  const a=createFieldMap(world()),b=createFieldMap({...world(),seed:17});let n=0,total=0,different=0,full=0;
  for(let x=-1500;x<1500;x+=5)for(let z=-1500;z<1500;z+=5) {
    const f=a.fieldAt(x,z),again=a.fieldAt(x,z),other=b.fieldAt(x,z);assert.equal(f.kind,again.kind);assert.equal(f.strength,again.strength);
    assert(f.strength>=0&&f.strength<=1);total++;if(f.strength>0)n++;if(f.strength===1)full++;if(f.strength!==other.strength)different++;
  }
  const share=n/total;assert(share>=.12&&share<=.30);assert(different>total*.1);assert(full>n*.5);
  let span=0,run=0;for(let x=-600;x<600;x++){if(a.fieldAt(x,0).strength>0)run++;else {span=Math.max(span,run);run=0;}}
  assert(span>=40);t.diagnostic(JSON.stringify({coverage:share,interiorFraction:full/n,longestCrossSection:span}));
});

test('one meadow species per 300m region; habitat selects coast and forest-edge species',()=>{
  const map=createFieldMap(world()),regions=new Map();
  for(let x=-900;x<900;x+=10)for(let z=-900;z<900;z+=10) {
    const f=map.fieldAt(x,z);if(!f.kind)continue;const key=`${Math.floor(x/300)},${Math.floor(z/300)}`;
    if(regions.has(key))assert.equal(f.kind,regions.get(key));else regions.set(key,f.kind);
    assert.notEqual(f.kind,'hamahirugao');
  }
  const beach=createFieldMap(world({meadow:0,sand:1})),edge=createFieldMap(world({meadow:.5,forest:.5}));
  assert.equal(beach.fieldAt(...Object.values(findField(beach))).kind,'hamahirugao');
  assert.equal(edge.fieldAt(...Object.values(findField(edge))).kind,'yamayuri');
  for(const distance of [0,11,81]) {
    const m=createFieldMap(world({meadow:0,sand:1},{terrain:{seaDistanceAt:()=>distance}}));
    assert.equal(m.fieldAt(0,0).strength,0);
  }
  const riverside=createFieldMap(world({}, {terrain:{riverDistanceAt:()=>20}}));
  for(let x=-200;x<200;x+=10)for(let z=-200;z<200;z+=10)assert.notEqual(riverside.fieldAt(x,z).kind,'susuki');
});

test('houses and rotated facilities, paths, water/banks, slopes, town and temple bare ground exclude every root',()=>{
  const base=createFieldMap(world()),p=findField(base),at=(m)=>m.fieldAt(p.x,p.z).strength;
  assert.equal(at(createFieldMap(world({town:.51}))),0);
  assert.equal(at(createFieldMap(world({bare:.6,temple:.8}))),0);
  for(const terrain of [{waterAt:()=>.1},{riverDistanceAt:()=>2},{slopeAt:()=>31}])assert.equal(at(createFieldMap(world({}, {terrain}))),0);
  const col=buildColliders({bounds:{minX:-1000,maxX:1000,minZ:-1000,maxZ:1000},extraBoxes:[{x:p.x,z:p.z,w:8,d:6,rotY:.7}]});
  const boxed=createFieldMap(world({}, {colliders:col}));assert.equal(at(boxed),0);
  const paths={test:{xyz_m:[[p.x-50,-p.z,0],[p.x+50,-p.z,0]]}},road=createFieldMap(world({}, {data:{patches:{paths}}}));
  assert.equal(at(road),0);assert.equal(road.fieldAt(p.x,p.z+3).strength,0);assert(road.fieldAt(p.x,p.z+4).strength>0);
  const roots=finish(road,Math.floor(p.x/10),Math.floor(p.z/10));assert(roots.every(r=>Math.abs(r.z-p.z)>3));
});

test('cells are deterministic, half-open, have no duplicated boundary roots, and density follows strength',t=>{
  const m={mayIntersect:()=>true,fieldAt(x,z,out){out.kind='kikyo';out.strength=1;return out;}};
  const full=finish(m,0,0),half=finish({...m,fieldAt(x,z,out){out.kind='kikyo';out.strength=.5;return out;}},0,0),double=finish(m,0,0,{density:2});
  assert.deepEqual(full,finish(m,0,0));assert(half.length/full.length>.43&&half.length/full.length<.57);
  assert(double.length/full.length>1.85&&double.length/full.length<2.15);
  const all=[...full,...finish(m,-1,0),...finish(m,1,0)],unique=new Set(all.map(r=>`${r.x},${r.z}`));assert.equal(unique.size,all.length);
  assert(full.every(r=>r.x>=0&&r.x<10&&r.z>=0&&r.z<10&&r.scale>=.75&&r.scale<=1.25));
  const positions=new Set(full.map(r=>`${r.x},${r.z}`));assert(half.every(r=>positions.has(`${r.x},${r.z}`)));
  const forbidden=createFieldMap(world({town:1}));assert.equal(finish(forbidden,0,0).length,0);
  t.diagnostic(JSON.stringify({full:full.length,half:half.length,double:double.length}));
});

test('outer ring fades continuously and padded cell test misses no field',()=>{
  for(const radius of [FIELDS.radius,FIELDS.lightRadius]) {
    assert.equal(fieldLodScale(radius-10,radius),1);assert.equal(fieldLodScale(radius,radius),0);assert.equal(fieldLodScale(radius-5,radius),.5);
    let prior=1;for(let d=0;d<radius+10;d+=.125){const v=fieldLodScale(d,radius);assert(v>=0&&v<=prior);prior=v;}
  }
  const map=createFieldMap(world());
  for(let x=-300;x<300;x+=2)for(let z=-300;z<300;z+=2)if(map.fieldAt(x,z).strength>0)assert(map.mayIntersect(Math.floor(x/10),Math.floor(z/10)));
});

test('all species scale with the clump density table, strength and requested density',t=>{
  const counts=[];
  for(let kind=0;kind<FIELD_KINDS.length;kind++)for(const strength of [.5,1])for(const density of [.6,1,2]) {
    const map={mayIntersect:()=>true,fieldAt(x,z,out){out.kind=FIELD_KINDS[kind];out.strength=strength;return out;}};
    let count=0;
    for(let cx=-5;cx<5;cx++)for(let cz=-5;cz<5;cz++)count+=finish(map,cx,cz,{density}).length;
    const expected=100*FIELDS.cell**2*FIELD_DENSITIES[kind]*strength*density;
    assert(Math.abs(count/expected-1)<.07,`${FIELD_KINDS[kind]}: ${count}/${expected}`);
    counts.push({kind:FIELD_KINDS[kind],strength,density,count});
  }
  t.diagnostic(JSON.stringify(counts));
});
