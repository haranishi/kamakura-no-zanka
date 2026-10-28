// なぜ失敗したか: legacy=既存配置、determinism=位置キー、ratio/cluster/habitat=林の構成、
// understory-exclusion=禁止域、budget=上限、purity=乱数系列・純粋層の退行を区別する。
// 独立レビュー後: rice/terrace/tread/dress/crown=描画する殻と実物の照合、jitter-independence=乱数の共有。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { WORLD } from '../dist/valley/world-data.js';
import { TREES, GRASS } from '../dist/valley/config.js';
import { createTerrain } from '../dist/valley/terrain-height.js';
import { scatterTrees, scatterRocks, scatterRice, ROCK_MODEL, insideFootprint, insidePlot, inSightline } from '../dist/valley/scatter.js';
import { SPECIES, treeFieldsAt, assignTreeSpecies, scatterUnderstory } from '../dist/valley/tree-species.js';
import { measurementWorld } from '../tools/lib/measurement-world.mjs';
import { measureTrees } from '../tools/measure-trees.mjs';
import { TreeField, wind, THREE } from './helpers/tree-field.mjs';
import { load } from './helpers/tree-modules.mjs';
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
  // Each of these fixtures blocks the whole small box only through its own rule.
  const box={box:[-40,40,-40,40]};
  assert(scatterUnderstory(bareWorld,flat,empty,box).x.length>0,'[understory-exclusion] vacuous small fixture');
  assert.equal(scatterUnderstory({...bareWorld,terraces:{x0:-500,x1:500,z0:-500,z1:500}},flat,empty,box).x.length,0,'[terrace] terrace exclusion omitted');
  const firewood=[];for(let x=-40;x<=40;x++)for(let z=-40;z<=40;z++)firewood.push({kind:'firewood',x,z});
  assert.equal(scatterUnderstory({...bareWorld,dress:firewood},flat,empty,box).x.length,0,'[dress] firewood exclusion omitted');
  assert.equal(scatterUnderstory({...bareWorld,distant:[{x:0,z:0,collider:{w:100,d:100,height:2}}]},flat,empty,box).x.length,0,'[dress] distant collider exclusion omitted');
  // A road 3m away with a 2m half width passes the old 2.2m centreline rule but meets every crown.
  const road={...flat,roads:[{half:2,index:{nearest:()=>({d:3})}}]};
  assert(scatterUnderstory(bareWorld,{...flat,roads:[{half:2,index:{nearest:()=>({d:9})}}]},empty,box).x.length>0,'[road-crown] vacuous road fixture');
  assert.equal(scatterUnderstory(bareWorld,road,empty,box).x.length,0,'[road-crown] crown may overhang the tread');
  // Beside a zero-width path the crown rule alone admits small crowns at 2m; the legacy 2.2m centreline floor must not.
  assert.equal(scatterUnderstory(bareWorld,{...flat,roads:[{half:0,index:{nearest:()=>({d:2})}}]},empty,box).x.length,0,'[understory-exclusion] 2.2m centreline floor omitted');
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
    // The dense fixture must reach the cap, or the cap check is vacuous.
    assert(dense.species.filter(v=>v===s).length===TREES[name].maxCount && TREES[name].maxCount<=max,'[budget] cap omitted');
  }
  assert(TREES.conversion.probability > .9 && TREES.conversion.probability < 1, '[ratio] conversion must preserve a small individual remainder');
  const seeds=Object.values(TREES.seeds), old=[101,211,307,401,503,7*101,13*211,17*307,19*401,23*503,GRASS.seed,GRASS.midSeed,GRASS.clumpSeed];
  assert(seeds.every(Number.isInteger)&&new Set(seeds).size===seeds.length&&seeds.every(s=>!old.includes(s)),'[purity] overlapping random streams');
  assert.deepEqual(TREES.budget,{cedar:[1500,260,40],zelkova:[2600,560,160],pine:[600,140,96],maple:[2600,560,160],sapling:[1400,200],shrub:[1200,180]},'[budget] triangle ceilings');
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
  // Terrace, crown-to-tread and dress exclusions removed 30 saplings and 95 shrubs; survivors keep every value.
  // 座標は 1e-6 に丸めて照合する。Node 22 と 24 は Math の関数の最後の桁が違い、生の値のハッシュは版で割れた
  // （CIのNode 22だけが落ちた）。個数・種・乱数の系列は丸めても同じで、割れるのは桁だけ。
  const rounded=v=>createHash('sha256').update(JSON.stringify(v,(_,x)=>typeof x==='number'?Math.round(x*1e6)/1e6:x)).digest('hex');
  assert.equal(rounded(Object.fromEntries(Object.entries(under).filter(([k])=>k!=='stage'))),'f1f5dbf87af01ac14b103061faa29da45bd802c2c6171bd7f263163d8f474a42','[understory-placement] coordinates/count/species or random stream changed');
  // Adult jitter now takes the second position draw (conversion keeps the first).
  assert.equal(hash([Array.from(assigned.stage),under.stage]),'4403081aba853a5f604b131b0af42bcbea3f44848f5b756d8fc94217257ee05a','[stage-jitter] seasonal jitter must remain +/-20/255');
  const residual=trees.x.map((x,i)=>{
    const f=treeFieldsAt(WORLD,x,trees.z[i]),season=Math.max(0,Math.min(1,.5+1.6*(f.stage-.5)));
    return assigned.stage[i]-(assigned.species[i]===3?.45+.55*season:season)*255;
  });
  assert(Math.min(...residual)<-19 && Math.max(...residual)>19 && residual.every(v=>Math.abs(v)<=20.5),'[stage-jitter] independent spread outside +/-20');
});

// なぜ失敗したか: 転換の判定と色づきの揺らぎが位置の乱数の同じ1つ目を使い、転換に漏れた杉の揺らぎが常に+19/255付近に張り付いた。
test('conversion and seasonal jitter are independent draws [jitter-independence]',()=>{
  // Habitat is >= .8 everywhere here, so grove alone decides candidacy; candidates convert by draw only.
  const rich={...flat,forestDensity:()=>0,riverInfo:()=>({d:20})},cedars={...trees,kind:trees.kind.map(()=>0)};
  const r=assignTreeSpecies(WORLD,rich,cedars),groups={converted:[],cedar:[]};
  cedars.x.forEach((x,i)=>{
    const f=treeFieldsAt(WORLD,x,cedars.z[i]),sp=r.species[i];
    if(f.grove+TREES.conversion.habitatWeight*.8<=TREES.fields.threshold)return;
    const season=Math.max(0,Math.min(1,.5+1.6*(f.stage-.5))),base=(sp===3?.45+.55*season:season)*255;
    if(base>21&&base<234)groups[sp===0?'cedar':'converted'].push(r.stage[i]-base);
  });
  const mean=a=>a.reduce((s,v)=>s+v,0)/a.length,sd=a=>Math.sqrt(mean(a.map(v=>(v-mean(a))**2)));
  assert(groups.cedar.length>=100&&groups.converted.length>=1000,'[jitter-independence] vacuous candidate fixture');
  assert(Math.abs(mean(groups.cedar)-mean(groups.converted))<4,'[jitter-independence] remaining cedars reuse the conversion draw (mean shift)');
  assert(Math.min(...groups.cedar)<-15&&Math.max(...groups.cedar)>15&&Math.abs(sd(groups.cedar)-sd(groups.converted))<3,'[jitter-independence] remaining cedars confined to one jitter band');
});

// なぜ失敗したか: 若木・灌木の除外が畑だけで棚田を見ず、稲の中に立った。実装と同じ除外表で照合する試験では、表の抜けを検出できなかった。
test('understory keeps clear of the planted terraces [rice/terrace]',()=>{
  const rice=scatterRice(WORLD,terrain),T=WORLD.terraces,bins=new Map(),near=new Set();
  rice.x.forEach((x,i)=>{const k=`${Math.floor(x)},${Math.floor(rice.z[i])}`;if(!bins.has(k))bins.set(k,[]);bins.get(k).push(i);});
  under.x.forEach((x,i)=>{
    const z=under.z[i];
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const j of bins.get(`${Math.floor(x)+dx},${Math.floor(z)+dz}`)??[])if(Math.hypot(x-rice.x[j],z-rice.z[j])<=1)near.add(i);
  });
  assert(rice.x.length>10000,'[rice] vacuous rice fixture');
  assert.deepEqual([...near],[],'[rice] understory stands within 1m of planted rice');
  const inside=under.x.flatMap((x,i)=>x>=T.x0-2.5&&x<=T.x1+2.5&&under.z[i]>=T.z0-2.5&&under.z[i]<=T.z1+2.5?[i]:[]);
  assert.deepEqual(inside,[],'[terrace] understory inside the terrace rectangle or its 2.5m rim');
});

// Widest drawn radius of every understory shell: the field's own instance matrix applied to the
// L0/L1 leaf and wood buffers. Both levels share one matrix, so each item is placed once at L0.
async function drawnCrowns(u) {
  const {treeGeometry}=await load('tree-geometry.js'), zero=u.x.map(()=>0), none={x:[],y:[],z:[],s:[],rot:[],kind:[],tint:[]};
  const f=new TreeField({data:none,species:{species:new Uint8Array(0),stage:new Uint8Array(0)},understory:{...u,x:zero,z:zero},wind,sunDir:new THREE.Vector3(1,1,1)});
  f.update({position:{x:0,z:0}},true);
  const points=new Map(),radius=new Float64Array(u.x.length),next=new Map();
  for(const sp of [4,5]) {
    const seen=new Set(),list=[];
    for(const l of [0,1])for(const kind of ['leaf','wood']) {
      const p=treeGeometry(sp,l)[kind].getAttribute('position');
      for(let i=0;i<p.count;i++){const k=`${p.getX(i)},${p.getY(i)},${p.getZ(i)}`;if(!seen.has(k)){seen.add(k);list.push(p.getX(i),p.getY(i),p.getZ(i));}}
    }
    points.set(sp,list);
  }
  for(let i=0;i<u.x.length;i++) {
    const sp=u.species[i],variant=sp===4?u.variant[i]:0,key=`${sp}/${variant}`,k=next.get(key)??0;next.set(key,k+1);
    const set=f.sets.find(s=>s.species===sp&&s.variant===variant&&s.level===0),e=set.leaf.instanceMatrix.array,o=k*16,list=points.get(sp);
    assert(k<set.leaf.count,'[crown] understory item not drawn at L0');
    let r=0;
    for(let j=0;j<list.length;j+=3)r=Math.max(r,Math.hypot(e[o]*list[j]+e[o+4]*list[j+1]+e[o+8]*list[j+2],e[o+2]*list[j]+e[o+6]*list[j+1]+e[o+10]*list[j+2]));
    radius[i]=r;
  }
  f.dispose();return radius;
}
function modelExtent(name) {
  const b=fs.readFileSync(new URL(`../dist/assets/valley/models/${name}.glb`,import.meta.url)),json=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));
  assert(json.nodes.every(n=>!n.matrix&&!n.scale&&!n.rotation&&!n.translation),'[dress] model node transform not handled');
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const m of json.meshes)for(const p of m.primitives){const a=json.accessors[p.attributes.POSITION];for(let k=0;k<3;k++){min[k]=Math.min(min[k],a.min[k]);max[k]=Math.max(max[k],a.max[k]);}}
  return {min,max};
}
// Distance from a point to a placed model's footprint rectangle (Three rotation.y, uniform x/z scale).
function footprintDistance(o,x,z) {
  const c=Math.cos(o.rotY),s=Math.sin(o.rotY),dx=x-o.x,dz=z-o.z,u=dx*c-dz*s,v=dx*s+dz*c;
  return Math.hypot(Math.max(o.min[0]*o.scale-u,0,u-o.max[0]*o.scale),Math.max(o.min[2]*o.scale-v,0,v-o.max[2]*o.scale));
}
// なぜ失敗したか: 灌木の道の除外が全道一律の中心から2.2mで、幅2mの道では樹冠が踏み面へ張り出し、薪・柵・幟も見ていなかった。
// 実装の除外表ではなく、描画する殻（群の行列×実バッファ）を、道の踏み面と飾りの模型の寸法で照合する。
test('drawn understory crowns stay off road treads and dress [tread/dress/crown]',async()=>{
  const radius=await drawnCrowns(under),wood=modelExtent('firewood'),fence=modelExtent('fence'),dress=[];
  // props.js: firewood at d.scale||1.2; fence segments every ~2.5m scaled to their length; banners hold an 0.8m bar.
  for(const d of WORLD.dress) {
    if(d.kind==='firewood')dress.push({id:'firewood',x:d.x,z:d.z,rotY:d.rotY||0,scale:d.scale||1.2,...wood});
    else if(d.kind==='fence_line'){
      const [x0,z0]=d.from,[x1,z1]=d.to,len=Math.hypot(x1-x0,z1-z0),n=Math.max(1,Math.round(len/2.5)),rotY=Math.atan2(-(z1-z0),x1-x0);
      for(let i=0;i<n;i++){const t=(i+.5)/n;dress.push({id:'fence',x:x0+(x1-x0)*t,z:z0+(z1-z0)*t,rotY,scale:(len/n)/2.63,...fence});}
    } else if(d.kind==='banner')dress.push({id:'banner',x:d.x,z:d.z,rotY:d.rotY||0,scale:d.scale||1,min:[-.05,0,-.05],max:[.8,0,.05]});
  }
  assert(dress.filter(o=>o.id==='firewood').length===7&&dress.some(o=>o.id==='fence')&&dress.some(o=>o.id==='banner'),'[dress] vacuous dress fixture');
  const over=[],tread=[],touch=[];
  under.x.forEach((x,i)=>{
    const z=under.z[i],name=under.species[i]===4?'sapling':'shrub';
    if(radius[i]>TREES[name].crown*under.s[i])over.push([i,radius[i]/under.s[i]]);
    for(const r of terrain.roads){const d=r.index.nearest(x,z,64).d;if(d-radius[i]<r.half)tread.push([i,r.id,+(d-r.half).toFixed(2),+radius[i].toFixed(2)]);}
    for(const o of dress)if(footprintDistance(o,x,z)<radius[i])touch.push([i,o.id,o.x,o.z]);
  });
  assert(radius.every(r=>r>.3),'[crown] vacuous crown radii');
  assert.deepEqual(over,[],'[crown] TREES crown coefficient is narrower than the drawn shell');
  assert.deepEqual(tread,[],'[tread] understory crown reaches a road tread');
  assert.deepEqual(touch,[],'[dress] understory crown overlaps firewood, fence or banner');
});
