// W2c-9c3: synthetic distribution, actual packed coverage, and shader safety.
import test from 'node:test';
import assert from 'node:assert/strict';
import {grassColony,grassMargin,midGrassShape,createGrassEnvironment,packGrassLook,MID_BANDS} from '../dist/valley/kamakura-grass-look.js';
import {createGrassCell,createGrassWindows} from '../dist/valley/kamakura-grass-field.js';
import {nearTile,midTile} from '../dist/valley/grass-field.js';
import {buildColliders} from '../dist/valley/collision.js';
import {GRASS} from '../dist/valley/config.js';
const flat={heightAt:()=>10,slopeAt:()=>0,waterAt:()=>0,walkable:()=>true,riverDistanceAt:()=>Infinity};
function makeField(terrain=flat,surfaceCodeAt=()=>2,opts={}) {
  const env=createGrassEnvironment(terrain,{surfaceCodeAt,...opts});
  const cell=createGrassCell(terrain,{surfaceCodeAt,environmentAt:env,riverMargin:.25});
  const windows=createGrassWindows(cell,{size:128});windows.plan({x:0,z:0});windows.work(()=>0);return {field:windows.commit(),env};
}
const cv=a=>{const mean=a.reduce((s,v)=>s+v,0)/a.length;return Math.sqrt(a.reduce((s,v)=>s+(v-mean)**2,0)/a.length)/mean;};
test('distance bands keep 30/50/20, 20/80/0 and 0/100/0 species, with independent 0.6–1.8 widths',t=>{
  const rows=[];
  for(const distance of [20,50,90]) {
    const counts={tall:0,medium:0,low:0},heights=[],widths=[];
    for(let z=0;z<100;z++)for(let x=0;x<100;x++){
      const s=midGrassShape(x+.123,z+.456,distance);counts[s.kind]++;heights.push(s.height);widths.push(s.width);
      assert(s.height>=.08&&s.height<=.75);
      if(s.kind==='tall')assert(s.height>=.45&&s.height<=.75&&s.width<=.432);
      if(s.kind==='medium')assert(s.height>=.25&&s.height<=.40);
    }
    const band=MID_BANDS[rows.length];for(const k of Object.keys(counts))assert(Math.abs(counts[k]/10000-band[k])<.015);
    assert(cv(widths)>.25);if(distance<70)assert(cv(heights)>.25);
    rows.push({distance,counts,heightCV:cv(heights),widthCV:cv(widths)});
  }
  t.diagnostic(JSON.stringify(rows));
});
test('world-keyed colonies have >3x density contrast, irregular nearest distances, and size CV >=.25',t=>{
  const {field,env}=makeField(),dense=[],sparse=[],points=[];let denseCells=0,sparseCells=0;
  for(let z=-48;z<48;z++)for(let x=-48;x<48;x++){
    const c=grassColony(x+.5,z+.5);denseCells+=c>.53;sparseCells+=c<=.4;
    const d=midTile(field,x,z,{size:1,cardRate:.28,maxCards:1,sink:.12,maxSlope:36});
    for(let i=0;i<d.count;i++){
      const p={x:d.x[i],z:d.z[i]};points.push(p);if(c>.53)dense.push(p);if(c<=.4)sparse.push(p);
    }
  }
  const ratio=(dense.length/denseCells)/(sparse.length/sparseCells);assert(ratio>3,ratio);
  const nearest=[],size=[];
  // Spatial buckets keep the statistic cheap, with a 4m neighbourhood.
  const buckets=new Map();for(const p of points){const k=`${Math.floor(p.x/4)},${Math.floor(p.z/4)}`;if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(p);}
  for(const p of dense.slice(0,500)){
    let d=Infinity;const bx=Math.floor(p.x/4),bz=Math.floor(p.z/4);
    for(let j=bz-1;j<=bz+1;j++)for(let i=bx-1;i<=bx+1;i++)for(const q of buckets.get(`${i},${j}`)||[])if(q!==p)d=Math.min(d,Math.hypot(p.x-q.x,p.z-q.z));
    nearest.push(d);size.push(midGrassShape(p.x,p.z,20).width);
  }
  const jitter=points.map(p=>p.x-Math.floor(p.x));assert(Math.max(...jitter)-Math.min(...jitter)>.6);
  assert(cv(nearest)>.25);assert(cv(size)>.25);
  t.diagnostic(JSON.stringify({densePerM2:dense.length/denseCells,sparsePerM2:sparse.length/sparseCells,ratio,nearestCV:cv(nearest),sizeCV:cv(size)}));
  assert.deepEqual(env(5.5,8.5),createGrassEnvironment(flat,{surfaceCodeAt:()=>2})(5.5,8.5));
});
test('3–8m foreground leaf count and integrated ribbon area meet pre-9b density at the same world roots',t=>{
  const {field,env}=makeField();const baseline={...field,density:field.density.slice(),height:field.height.slice(),species:field.species.slice()};
  // Pre-9b: same terrain patch, no ecology density multiplier, valley nearDensity.
  const oldCell=createGrassCell(flat,{surfaceCodeAt:()=>2});
  for(let z=-64;z<64;z++)for(let x=-64;x<64;x++){const k=(z+64)*128+x+64,cell=oldCell(x,z);for(const name of ['density','height','species'])baseline[name][k]=cell[name];}
  const rows=[];
  for(const quality of ['standard','light']){
    let oldCount=0,newCount=0,oldArea=0,newArea=0;
    for(let z=-8;z<8;z++)for(let x=-8;x<8;x++){
      const old=nearTile(baseline,x,z,{size:1,quality}),now=nearTile(field,x,z,{size:1,quality});
      const raw=new Float32Array(now.count*15);
      for(let i=0;i<now.count;i++)raw.set([now.x[i],now.y[i],now.z[i],now.yaw[i],now.h[i],now.w[i],now.lean[i],.5,0,0,0,0,0,0,0],i*15);
      const packed=packGrassLook(raw,'near',env,quality);
      for(let i=0;i<old.count;i++){const d=Math.hypot(old.x[i],old.z[i]);if(d>=3&&d<8){oldCount++;oldArea+=old.h[i]*old.w[i];}}
      for(let i=0;i<packed.length;i+=15){const d=Math.hypot(packed[i],packed[i+2]);if(d>=3&&d<8&&packed[i+11]!==-1&&packed[i+11]!==-2){newCount++;newArea+=packed[i+4]*packed[i+5];}}
    }
    // Old taper integral .4167; new pow(1-t,.65) integral 1/1.65.
    oldArea*=5/12;newArea/=1.65;assert(newCount>=oldCount);assert(newArea>=oldArea);
    rows.push({quality,nearDensity:GRASS.nearDensity,oldCount,newCount,oldArea,newArea});
  }
  t.diagnostic(JSON.stringify(rows));
});
test('uncut margins cover shoulders, house/wall bases, trunks and river; lane centre stays sparse',()=>{
  for(const opts of [{path:2.9},{path:3.7},{house:.4},{tree:.4},{river:1.4},{townEdge:.75}]){
    assert.equal(grassMargin(opts),1);const s=midGrassShape(2,3,20,grassMargin(opts));assert(s.height>=.5&&s.height<=.8);
  }
  for(const opts of [{path:2.5},{path:3.8},{river:1.6},{house:1.3}])assert.equal(grassMargin(opts),0);
  const river={...flat,riverDistanceAt:()=>1.2},r=makeField(river);assert(r.field.placeable[64*128+64]);assert.equal(r.env(.5,.5).margin,1);
  const col=buildColliders({bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100},extraBoxes:[{x:0,z:0,w:4,d:4}]});
  const env=createGrassEnvironment(flat,{colliders:col,surfaceCodeAt:()=>0});
  assert(env(3,0).midDensity>env(14,0).midDensity*3);
  const paths={lane:{xyz_m:[[0,30,0],[0,-30,0]]}},lane=createGrassEnvironment(flat,{paths});
  assert(lane(3.1,0).midDensity>lane(0,0).midDensity);assert.equal(lane(3.1,0).margin,1);
  const town=createGrassEnvironment(flat,{surfaceCodeAt:(x)=>x<0?0:2});assert.equal(town(-.5,0).margin,1);
});
test('30+ degree slopes and crest proximity reduce colonies; valley bowls are denser',()=>{
  const open=createGrassEnvironment(flat),steep=createGrassEnvironment({...flat,slopeAt:()=>31.5});
  assert(steep(12,22).midDensity<open(12,22).midDensity);
  const ridge=createGrassEnvironment({...flat,heightAt:(x,z)=>10-.1*(x*x+z*z)}),bowl=createGrassEnvironment({...flat,heightAt:(x,z)=>10+.1*(x*x+z*z)});
  assert(ridge(0,0).midDensity<bowl(0,0).midDensity);
});
