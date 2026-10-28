// なぜ失敗したか: legacy=既存配置、determinism=位置キー、ratio/cluster/habitat=林の構成、
// understory-exclusion=禁止域、budget=上限、purity=乱数系列・純粋層の退行を区別する。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { WORLD } from '../dist/valley/world-data.js';
import { TREES, GRASS } from '../dist/valley/config.js';
import { createTerrain } from '../dist/valley/terrain-height.js';
import { scatterTrees, scatterRocks, ROCK_MODEL, insideFootprint, insidePlot, inSightline } from '../dist/valley/scatter.js';
import { SPECIES, treeFieldsAt, assignTreeSpecies, scatterUnderstory } from '../dist/valley/tree-species.js';
import { measurementWorld } from '../tools/lib/measurement-world.mjs';
import { measureTrees } from '../tools/measure-trees.mjs';
const terrain = createTerrain(WORLD), trees = scatterTrees(WORLD, terrain);
let t = performance.now();
const assigned = assignTreeSpecies(WORLD, terrain, trees), assignMs = performance.now() - t;
t = performance.now();
const under = scatterUnderstory(WORLD, terrain, trees), understoryMs = performance.now() - t;
const roadDistance = (x,z) => Math.min(...terrain.roads.map(r=>r.index.nearest(x,z,32).d));
const empty = { x: [], y: [], z: [], s: [], kind: [] };
const bareWorld = { start: {x:10000,z:10000}, seed: WORLD.seed, buildings: [], plots: [], props: [], peaks: [], flats: [], sightlines: [] };
const flat = { heightAt: () => 0, forestDensity: () => 0.4, roadInfo: () => ({dist: 7}), riverInfo: () => ({d: 18}), waterAt: () => 0, slopeAt: () => 0 };
test('legacy coordinates, count, and immutable input [legacy]', () => {
  const json = JSON.stringify(trees, (_, v) => typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);
  assert.equal(createHash('sha256').update(json).digest('hex').slice(0,16), '7327b88af62332e7', '[legacy] tree placement changed');
  assert.equal(trees.x.length, 15830, '[legacy] count changed');
  const before = structuredClone(trees); assignTreeSpecies(WORLD, terrain, trees);
  assert.deepEqual(trees, before, '[legacy] derived species mutated trees');
});
test('deterministic position keys survive reorder and insertion [determinism]', () => {
  assert.deepEqual(assignTreeSpecies(WORLD, terrain, trees), assigned, '[determinism] species/stage changed');
  assert.deepEqual(scatterUnderstory(WORLD, terrain, trees), under, '[determinism] understory changed');
  const order = [120, 8, 930, 0, 7000];
  const subset = Object.fromEntries(Object.entries(trees).map(([k,a]) => [k,order.map(i=>a[i])]));
  const result = assignTreeSpecies(WORLD, terrain, subset);
  order.forEach((i,j) => { assert.equal(result.species[j], assigned.species[i], '[determinism] species uses ordinal key'); assert.equal(result.stage[j], assigned.stage[i], '[determinism] stage uses ordinal key'); });
});
test('species ranges and pine preservation [ratio]', () => {
  assert.deepEqual(SPECIES, {cedar:0,zelkova:1,pine:2,maple:3,sapling:4,shrub:5}, '[ratio] species numbering');
  assert(assigned.species instanceof Uint8Array && assigned.stage instanceof Uint8Array, '[ratio] typed output');
  trees.kind.forEach((k,i) => { const s = assigned.species[i]; assert(s >= 0 && s <= 3 && (k !== 2 || s === 2) && (s === k || k === 0 || k === 1), '[ratio] illegal conversion'); });
});
test('reachable denominator, ratios, clustering and stages [ratio cluster]', () => {
  const r = measureTrees(measurementWorld(), {species:true}), s = r.species, c = s.clustering;
  assert.equal(r.total.reachable,645,'[legacy] reachable denominator');
  assert(s.nonCedarPct >= 30 && s.broadleafPct >= 15 && s.speciesCount >= 4, '[ratio] reachable diversity');
  assert(s.reachable[1]/645 >= .04 && s.reachable[3]/645 >= .04, '[ratio] missing zelkova/maple');
  const broad = (s.all[1]+s.all[3])/15830;
  assert(broad >= .05 && broad <= .12, '[ratio] global broadleaf outside 5–12%');
  assert(c.actual.sameSpeciesRate >= c.shuffled.sameSpeciesRate + .10, '[cluster] trees form confetti');
  assert(c.actual.stageDifference < c.shuffled.stageDifference, '[cluster] stages are not shared');
});
test('habitat favours thinner forest [habitat]', () => {
  const groups = [[0,0],[0,0]];
  trees.x.forEach((x,i)=> {const f=terrain.forestDensity(x,trees.z[i]), g=f>.9?groups[0]:f<.5?groups[1]:null;if(g){g[1]++;if([1,3].includes(assigned.species[i]))g[0]++;}});
  assert(groups[0][0]/groups[0][1] < groups[1][0]/groups[1][1], '[habitat] dense mountains have more broadleaf');
  // Same positions and fields: changing only habitat must change cedar conversion.
  const cedars = {...trees,kind:trees.kind.map(()=>0)};
  const rich = assignTreeSpecies(WORLD, {...flat,forestDensity:()=>0,riverInfo:()=>({d:20})}, cedars);
  const poor = assignTreeSpecies(WORLD, {...flat,forestDensity:()=>1,riverInfo:()=>({d:1000}),slopeAt:()=>60}, cedars);
  assert(rich.species.filter(s=>s!==0).length > poor.species.filter(s=>s!==0).length * 1.5, '[habitat] habitat weight missing');
});
test('understory real-world exclusions and finite aligned arrays [understory-exclusion]', () => {
  for (const a of Object.values(under)) assert.equal(a.length,under.x.length,'[understory-exclusion] array lengths');
  const rocks = scatterRocks(WORLD, terrain);
  under.x.forEach((x,i)=> {
    const z=under.z[i], s=under.species[i];
    assert(s===4||s===5,'[understory-exclusion] invalid species');
    assert(Object.values(under).every(a=>Number.isFinite(a[i])),'[understory-exclusion] NaN');
    assert.equal(under.y[i],terrain.heightAt(x,z),'[understory-exclusion] height');
    assert(under.s[i] >= (s===4?2:.8) && under.s[i] <= (s===4?4:1.6),'[budget] height range');
    assert(terrain.waterAt(x,z)<=.02 && terrain.slopeAt(x,z,1.5)<=40 && terrain.riverInfo(x,z).d>=6,'[understory-exclusion] water/slope/river');
    assert(roadDistance(x,z)>=2.2,'[understory-exclusion] road');
    assert(!WORLD.buildings.some(b=>insideFootprint(b,x,z,2)) && !WORLD.plots.some(p=>insidePlot(p,x,z,1.5)), '[understory-exclusion] building/plot');
    assert(!rocks.x.some((rx,j)=>Math.hypot(x-rx,z-rocks.z[j]) < Math.hypot(ROCK_MODEL.width*rocks.s[j]*rocks.sx[j],ROCK_MODEL.depth*rocks.s[j]*rocks.sz[j])/2+.5),'[understory-exclusion] rock');
    assert(!WORLD.props.some(p=>Math.hypot(x-p.x,z-p.z)<(p.r||1)+.5),'[understory-exclusion] prop');
    assert(!WORLD.peaks.some(p=>Math.hypot(x-p.x,z-p.z)<p.flatR*1.9),'[understory-exclusion] peak');
    assert(s!==4 || !inSightline(WORLD,x,z),'[understory-exclusion] sightline');
    assert(!trees.x.some((tx,j)=>Math.hypot(x-tx,z-trees.z[j])<((trees.kind[j]===1?.42:.32)*trees.s[j])*.6+.5),'[understory-exclusion] trunk');
  });
});
test('isolated forbidden habitats reject all candidates [understory-exclusion]', () => {
  assert(scatterUnderstory(bareWorld,flat,empty).x.length>0,'[understory-exclusion] vacuous fixture');
  for(const override of [{waterAt:()=>.1},{roadInfo:()=>({dist:0})},{riverInfo:()=>({d:0})},{slopeAt:()=>50}])
    assert.equal(scatterUnderstory(bareWorld,{...flat,...override},empty).x.length,0,'[understory-exclusion] terrain exclusion omitted');
  const building={x:0,z:0,rotY:0,footprint:{w:2000,d:2000}};
  assert.equal(scatterUnderstory({...bareWorld,buildings:[building]},flat,empty).x.length,0,'[understory-exclusion] building exclusion omitted');
  const trunks={x:[],z:[],s:[],kind:[]};
  for(let x=-212;x<=242;x++)for(let z=-212;z<=202;z++){trunks.x.push(x);trunks.z.push(z);trunks.s.push(3);trunks.kind.push(0);}
  assert.equal(scatterUnderstory(bareWorld,flat,trunks).x.length,0,'[understory-exclusion] trunk exclusion omitted');
});
test('band density exceeds forest interior per unit area [habitat]', () => {
  const area=[0,0], count=[0,0], step=3;
  const group=(x,z)=>{const d=roadDistance(x,z);return d>=3&&d<=16?0:terrain.forestDensity(x,z)>.9&&d>30?1:-1;};
  for(let x=-210;x<240;x+=step)for(let z=-210;z<200;z+=step){const g=group(x,z);if(g>=0)area[g]+=step*step;}
  under.x.forEach((x,i)=>{const g=group(x,under.z[i]);if(g>=0)count[g]++;});
  assert(area.every(v=>v>0)&&count[0]/area[0]>count[1]/area[1],'[habitat] no road-edge density bias');
});
test('caps, stream separation, budget and purity [budget purity]', () => {
  const dense=scatterUnderstory(bareWorld,flat,empty,{box:[-600,600,-600,600]});
  for(const [s,name,max] of [[4,'sapling',1200],[5,'shrub',4000]]){
    assert(under.species.filter(v=>v===s).length>0,'[budget] missing understory');
    assert(dense.species.filter(v=>v===s).length<=max && TREES[name].maxCount<=max,'[budget] cap omitted');
  }
  assert(TREES.conversion.probability > .9 && TREES.conversion.probability < 1, '[ratio] conversion must preserve a small individual remainder');
  const seeds=Object.values(TREES.seeds), old=[101,211,307,401,503,7*101,13*211,17*307,19*401,23*503,GRASS.seed,GRASS.midSeed,GRASS.clumpSeed];
  assert(seeds.every(Number.isInteger)&&new Set(seeds).size===seeds.length&&seeds.every(s=>!old.includes(s)),'[purity] overlapping random streams');
  assert.deepEqual(TREES.budget,{cedar:[1500,260,40],zelkova:[1100,260,160],pine:[600,140,96],maple:[1100,260,160],sapling:[600,160],shrub:[500,140]},'[budget] triangle ceilings');
  const src=fs.readFileSync(new URL('../dist/valley/tree-species.js',import.meta.url),'utf8');
  assert(!/Math\.random|Date\.|performance\.|document\.|window\.|from ['"]three/.test(src),'[purity] impure layer');
});
test('fields remain bounded and spatially shared [cluster]', () => {
  let diff=0, spread=0; const values=[];
  for(let x=-200;x<200;x+=3){const a=treeFieldsAt(WORLD,x,13),b=treeFieldsAt(WORLD,x+1,13);for(const v of Object.values(a))assert(v>=0&&v<=1,'[cluster] field range');diff+=Math.abs(a.grove-b.grove);values.push(a.stage);spread+=Math.abs(a.stage-b.stage);}
  assert(diff/values.length<.02,'[cluster] grove uses uniform random');
  assert(spread/values.length<.04&&Math.max(...values)-Math.min(...values)>.3,'[cluster] stage field constant or independent');
});
test('report Node CPU timings [timing]',()=>console.log('trees timing (Node CPU only)',{assignMs,understoryMs,saplings:under.species.filter(s=>s===4).length,shrubs:under.species.filter(s=>s===5).length}));

// なぜ失敗したか: 小さい独立揺らぎでは紅葉が一色になり、配置変更とは別に退行を検出する必要があった。
test('only stage changes, with twenty-byte seasonal jitter [stage-jitter/placement]',()=>{
  const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
  assert.equal(hash(Array.from(assigned.species)),'3317a697e1001c87048c40147123273116bc73077810a79920ea58d8c2554b8f','[species-placement] adult species changed');
  assert.equal(hash(Object.fromEntries(Object.entries(under).filter(([k])=>k!=='stage'))),'42291a08795c4f08e616cb651813dd8b8d292766520f894a098f13ef24e98c5b','[understory-placement] coordinates/count/species or random stream changed');
  assert.equal(hash([Array.from(assigned.stage),under.stage]),'9e4eae85ea904fb581745a17408e6af5d217c5a577b4db98680d3e606e6ce7e4','[stage-jitter] seasonal jitter must remain +/-20/255');
  const residual=trees.x.map((x,i)=>{
    const f=treeFieldsAt(WORLD,x,trees.z[i]),season=Math.max(0,Math.min(1,.5+1.6*(f.stage-.5)));
    return assigned.stage[i]-(assigned.species[i]===3?.45+.55*season:season)*255;
  });
  assert(Math.min(...residual)<-19 && Math.max(...residual)>19 && residual.every(v=>Math.abs(v)<=20.5),'[stage-jitter] independent spread outside +/-20');
});
