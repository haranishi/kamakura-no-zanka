// 棚田の区画・通行の余白・近遠混合を、描画から独立して確認する。
import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { WORLD } from '../dist/valley/world-data.js';
import { createTerrain } from '../dist/valley/terrain-height.js';
import { scatterRice } from '../dist/valley/scatter.js';
import { PADDY, createPaddyPlots, createPaddyLayout, paddyAt, paddyNearRice, paddyOptions, paddyWeights, paddyQuality, paddyPropClear, paddyGroundHeight, paddyBundSection } from '../dist/valley/paddy.js';
const terrain = createTerrain(WORLD), before = JSON.stringify(WORLD), start = performance.now(), layout = createPaddyLayout(WORLD, terrain), buildMs = performance.now() - start;

test('height bit pattern is unchanged on the entire walkable area plus 12m at 0.5m intervals', () => {
  const digest=createHash('sha256'),bytes=Buffer.alloc(8);let samples=0;
  for(let z=-147;z<=124;z+=.5)for(let x=-147;x<=114;x+=.5){bytes.writeDoubleLE(terrain.heightAt(x,z));digest.update(bytes);samples++;}
  assert.equal(samples,283989);
  assert.equal(digest.digest('hex'),'10709b66ddf166e44ff64ee11d53ab389ddf1179a5bde9590c2c4192422454dc');
});

test('read-only terrace values share quantization; positive core treads match their level and southern zero floor is retained', () => {
  let treads=0,zeroFloor=0;
  for(let z=40;z<=104;z+=.5)for(let x=-68;x<=50;x+=.5){
    const t=terrain.terraceAt(x,z);assert(Number.isInteger(t.level));assert(t.frac>=0&&t.frac<1);assert(t.mask>=0&&t.mask<=1);
    if(t.mask===1&&t.frac<t.edge&&!terrain.roadInfo(x,z)){
      assert(Math.abs(terrain.heightAt(x,z)-Math.max(0,t.level*WORLD.terraces.drop))<1e-12);
      if(t.level>=0)treads++;else zeroFloor++;
    }
  }
  assert(treads>1000&&zeroFloor>5000);
});

test('real treads contain 1–3 deterministic wavy plots, keep height spread below 5cm, area above 80% and harvest shares', t => {
  for(let seed=WORLD.seed;seed<WORLD.seed+20;seed++){
    const world={...WORLD,seed},plots=createPaddyPlots(world);
    assert.deepEqual(plots,createPaddyPlots(world));
    assert(plots.length>=plots.bands.length&&plots.length<=plots.bands.length*3);
    for(const band of plots.bands){const list=plots.filter(p=>p.level===band.level);assert(list.length>=1&&list.length<=3);list.forEach(p=>{assert(Math.abs(p.tint-1)<=.08);assert(Math.abs(p.height-1)<=.08);});}
    for(const [kind,wanted] of [['standing',.60],['harvested',.25],['partial',.15]])assert(Math.abs(plots.filter(p=>p.kind===kind).length/plots.length-wanted)<=.1,`${seed} ${kind}`);
    const mean=kind=>{const a=plots.filter(p=>p.kind===kind);return a.reduce((n,p)=>n+p.row,0)/a.length;};assert(mean('harvested')<mean('standing'));
  }
  let eligible=0,covered=0;const ranges=new Map();
  for(let z=40.25;z<104;z+=.5)for(let x=-67.75;x<50;x+=.5){
    if(terrain.terraceAt(x,z).mask<=.9)continue;eligible++;
    const s=paddyAt(layout.plots,x,z);if(!s?.cultivated)continue;covered++;
    const y=terrain.heightAt(x,z),range=ranges.get(s.plot.id)||[y,y];range[0]=Math.min(range[0],y);range[1]=Math.max(range[1],y);ranges.set(s.plot.id,range);
    assert.equal(Math.max(0,terrain.terraceAt(x,z).level),s.plot.level);
  }
  assert(covered/eligible>=.8);for(const r of ranges.values())assert(r[1]-r[0]<=.05);
  assert.equal(ranges.size,layout.plots.length);assert.deepEqual(layout,createPaddyLayout(WORLD,terrain));assert.equal(JSON.stringify(WORLD),before);
  t.diagnostic(JSON.stringify({terraces:layout.terraces,plots:layout.plots.length,area:covered/eligible,maxSpread:Math.max(...[...ranges.values()].map(r=>r[1]-r[0]))}));
});

test('partial fields divide along the terrace and contain both cut and uncut treads; near/far rice and stubble respect them', () => {
  for(const p of layout.plots.filter(p=>p.kind==='partial')){
    let cut=0,standing=0;
    for(let z=p.z0;z<p.z1;z+=.25)for(let x=p.x0;x<p.x1;x+=1){const s=paddyAt(layout.plots,x,z);if(s?.plot.id===p.id&&!s.bund){if(s.cut)cut++;else standing++;}}
    assert(cut>0&&standing>0);
  }
  const rice=scatterRice(WORLD,terrain),copy=JSON.stringify(rice),filtered=paddyNearRice(rice,layout.plots);
  assert(filtered.x.length>0&&filtered.x.length<rice.x.length);
  filtered.x.forEach((x,i)=>{const s=paddyAt(layout.plots,x,filtered.z[i]);assert(s&&!s.cut&&!s.bund);});
  assert.equal(JSON.stringify(rice),copy);
  for(const s of layout.far){const at=paddyAt(layout.plots,s.x,s.z);assert(at&&!at.cut&&!at.bund);}
  for(const s of layout.stubble)assert(paddyAt(layout.plots,s.x,s.z).cut);
});

test('contours bend at least 3 degrees, never cross adjacent levels, keep 1–1.5m points and cover actual slopes clear of roads', t => {
  let maximumSpread=0;
  for(const line of layout.lines){
    const headings=[];
    for(let i=1;i<line.points.length;i++){const a=line.points[i-1],b=line.points[i],d=Math.hypot(b.x-a.x,b.z-a.z);assert(d<=1.5);if(i<line.points.length-1)assert(d>=1);headings.push(Math.atan2(b.z-a.z,b.x-a.x));}
    // 向きの折り返しで ±π が出るため、平均方向を基準に差を取る。
    const mean=Math.atan2(headings.reduce((n,a)=>n+Math.sin(a),0),headings.reduce((n,a)=>n+Math.cos(a),0));
    const spread=Math.sqrt(headings.reduce((n,a)=>n+Math.atan2(Math.sin(a-mean),Math.cos(a-mean))**2,0)/headings.length)*180/Math.PI;maximumSpread=Math.max(maximumSpread,spread);
    for(const p of line.points)assert(Math.abs(layout.plots.field.value(p.x,p.z)-(line.level+(1+layout.plots.field.edge)/2))<.005);
  }
  assert(maximumSpread>=3);
  const cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
  for(let i=0;i<layout.lines.length;i++)for(let j=i+1;j<layout.lines.length;j++){
    const a=layout.lines[i],b=layout.lines[j];if(a.level===b.level)continue;
    for(let u=1;u<a.points.length;u++)for(let v=1;v<b.points.length;v++)assert(!(cross(a.points[u-1],a.points[u],b.points[v-1])*cross(a.points[u-1],a.points[u],b.points[v])<0&&cross(b.points[v-1],b.points[v],a.points[u-1])*cross(b.points[v-1],b.points[v],a.points[u])<0));
  }
  for(const w of layout.walls){
    const road=terrain.roadInfo(w.x,w.z);assert(!road||road.dist>w.width/2+PADDY.stoneBandWidth);
    for(const p of [w.aTop,w.aBottom,w.bTop,w.bBottom])assert(p.y>=w.bottom-1e-9&&p.y<=w.top+1e-9);
    assert(Math.abs(Math.hypot(w.aTop.x-w.aBottom.x,w.aTop.z-w.aBottom.z)-PADDY.stoneBandWidth)<1e-8);
  }
  for(const s of layout.stones){assert(s.y>=s.bottom&&s.y<=s.top);assert(s.width>=PADDY.stoneMin&&s.width<=PADDY.stoneMax);assert(s.depth>=.25&&s.depth<=.45&&Math.abs(s.tilt)<=12);}
  for(const b of layout.bunds){const r=terrain.roadInfo(b.x,b.z);assert(!r||r.dist>b.sx/2+PADDY.bundWidth/2);}
  assert(layout.stoneLength>500);t.diagnostic(JSON.stringify({maximumSpread,length:layout.stoneLength}));
});

test('8 racks and 28 clustered straw bundles stay in harvested plots and outside road, zone and patrol margins', () => {
  assert(layout.racks.length >= 6 && layout.racks.length <= 10); assert(layout.straw.length >= 20 && layout.straw.length <= 40);
  for (const p of [...layout.racks, ...layout.straw]) {
    const at = paddyAt(layout.plots, p.x, p.z); assert(at && at.plot.kind === 'harvested');
    assert(paddyPropClear(WORLD, terrain, p.x, p.z, p.radius ?? .5));
    if (p.radius) { assert(p.length >= 4 && p.length <= 7 && p.height >= 1.6 && p.height <= 2); assert(p.x - p.length / 2 > at.plot.x0 && p.x + p.length / 2 < at.plot.x1); }
    else assert(p.height >= 1 && p.height <= 1.4);
  }
  for (const p of layout.straw) assert(layout.straw.some(s => s !== p && Math.hypot(s.x - p.x, s.z - p.z) < 2));
  assert(!paddyPropClear(WORLD, terrain, -30, 52, 1), 'road negative control');
  assert(!paddyPropClear(WORLD, terrain, -12, 36, 1), 'zone negative control');
  const fake = { ...WORLD, zones: {}, spawns: { guard: [{ kind: 'soldier', patrol: [[10, 50], [20, 50]] }] } };
  assert(!paddyPropClear(fake, { roadInfo: () => null }, 15, 51, .5), 'patrol segment negative control');
});

test('near and far coverage sum to one through the complete handover, with monotone quality reductions', () => {
  for (const q of ['standard', 'light']) for (let level = 0; level <= 3; level++) {
    for (let d = 0; d <= 95; d += .125) { const w = paddyWeights(d, q, level); assert(Math.abs(w.near + w.far - 1) < 1e-12); }
    const end = paddyQuality(q, level).distance; assert.equal(paddyWeights(end, q, level).far, 0);
    if (level) { assert(paddyQuality(q, level).density < paddyQuality(q, level - 1).density); assert(end < paddyQuality(q, level - 1).distance); }
  }
  assert.equal(paddyOptions('?paddy=0&paddydebug=1').enabled, false);
  assert.equal(paddyOptions('?paddydebug=1').debug, true);
});

test('surface attachment uses the same diagonal as the one-metre terrain mesh', () => {
  const fixture = { heightAt: (x, z) => x * z };
  assert.equal(paddyGroundHeight(fixture, .2, .3), 0);
  assert(Math.abs(paddyGroundHeight(fixture, .8, .9) - .7) < 1e-12);
  assert.equal(paddyGroundHeight(fixture, 2, 3), 6);
});

test('layout metrics are reported without changing any collision or world input', t => {
  t.diagnostic(JSON.stringify({ buildMs, plots: layout.plots.length, farCapacity: layout.far.length, stoneLength: layout.stoneLength, stones: layout.stones.length, stubble: layout.stubble.length, racks: layout.racks.length, straw: layout.straw.length }));
  assert.equal(JSON.stringify(WORLD), before);
});


test('rounded bund section has low edges, a raised centre and continuous bounded crown variation', () => {
  for (let x = -60; x < 45; x += .2) {
    assert.equal(paddyBundSection(0, x, 50), 0);
    assert(Math.abs(paddyBundSection(1, x, 50)) < 1e-10);
    assert(paddyBundSection(.5, x, 50) >= .15 && paddyBundSection(.5, x, 50) <= .22);
    assert(paddyBundSection(.5, x, 50) > paddyBundSection(1/6, x, 50));
  }
});

test('short stubble follows contour rows at 30cm average spacing; far plants jitter by 35% without a dot grid', t => {
  assert(layout.stubble.length>4000);
  for(const s of layout.stubble){
    assert(s.alongX);assert(s.height>=.08&&s.height<=.14);
    const phase=layout.plots.field.value(s.x,s.z)*WORLD.terraces.drop/(PADDY.stubbleStep*.1);
    assert(Math.abs(phase-Math.round(phase))<1e-9);
    const at=paddyAt(layout.plots,s.x,s.z);assert(at.cut&&!at.bund);
    const road=terrain.roadInfo(s.x,s.z);assert(!road||road.dist>PADDY.bundWidth/2);
  }
  const rows=new Map();for(const s of layout.far){const key=`${s.row}/${s.plot}`;if(!rows.has(key))rows.set(key,[]);rows.get(key).push(s);}
  const gaps=[];for(const row of rows.values()){row.sort((a,b)=>a.x-b.x);for(let i=1;i<row.length;i++){const d=row[i].x-row[i-1].x;if(d<PADDY.farStep*2)gaps.push(d);}}
  const mean=gaps.reduce((a,b)=>a+b,0)/gaps.length,cv=Math.sqrt(gaps.reduce((n,d)=>n+(d-mean)**2,0)/gaps.length)/mean;
  assert(cv>=.2);t.diagnostic(JSON.stringify({farSpacingCV:cv}));
});
