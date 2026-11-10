import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SANDO, sandoLines, sandoLength, sandoStones, sandoBoxDistance, sandoRecords } from '../dist/valley/kamakura-sando.js';
import { loadKamakura } from '../dist/valley/kamakura-data.js';
import { kamakuraPaths } from '../dist/valley/kamakura-roads.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { createGrassEnvironment } from '../dist/valley/kamakura-grass-look.js';
import { grassExclusions } from '../dist/valley/kamakura-grass-field.js';
import { vegExclusions } from '../dist/valley/kamakura-veg.js';
import { createPathField, segmentWeight } from '../dist/valley/kamakura-ground-path.js';
import { prepareProps, createPropSite, propInBox, propBoxDistance, SANDO_LANTERN } from '../dist/valley/kamakura-props.js';
import { syntheticWorld } from '../tools/make-synthetic-world.mjs';
export const flat = { heightAt: () => 10, slopeAt: () => 0, waterAt: () => 0, walkable: () => true, riverDistanceAt: () => Infinity, seaDistanceAt: () => Infinity };
export const node = (part, z, x = 0, size = [20, 10]) => ({ node: `${part}:${x}:${z}`, part, facility: 'invented', anchor_xz: [x, z], bbox_min: [-size[0]/2,0,-size[1]/2], bbox_max: [size[0]/2,10,size[1]/2] });
export const world = () => ({ facilities: { nodes: [node('hall',0), node('gate',60,0,[10,4]),node('torii',150,0,[10,2]),node('torii',110,0,[10,2])] } });
const ab = b => b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const fetcher = files => async url => { const bytes = files.get(url.slice('/world-private/'.length)); return {ok:!!bytes,json:async()=>JSON.parse(bytes),arrayBuffer:async()=>ab(bytes)}; };
const first = lines => Object.values(lines)[0];

test('S1 outer torii, next torii, gate, largest hall front; deterministic densification and width', () => {
  const data=world(); data.facilities.nodes.push(node('hall',-40,70,[6,6]));
  const a=sandoLines(data,flat), line=first(a); assert.deepEqual(a,sandoLines(data,flat));
  assert.equal(line.width_m,5);assert.equal(line.kind,'sando');assert.equal(line.xyz_m[0][1],-150);
  const north=line.xyz_m.map(p=>p[1]);assert(north.indexOf(-110)>0);assert(north.indexOf(-60)>north.indexOf(-110));assert.equal(north.at(-1),-7.5);
  for(let i=1;i<north.length;i++)assert(Math.abs(north[i]-north[i-1])>=4&&Math.abs(north[i]-north[i-1])<=5);
  data.facilities.nodes=data.facilities.nodes.filter(n=>n.part!=='torii');assert.equal(first(sandoLines(data,flat)).width_m,3.6);
});

test('S1 no entrance: 30m from the long front, preferring open ground; no facilities returns no lines', () => {
  const data={facilities:{nodes:[node('hall',0)]}}, lines=sandoLines(data,{...flat,walkable:(x,z)=>z<0});
  const line=first(lines);assert.equal(line.width_m,3);assert(Math.abs(sandoLength(line)-30)<1e-8);assert(line.xyz_m.every(p=>p[1]>=7.5));assert.deepEqual(Object.keys(sandoLines({})),[]);
});

test('S1 water, unwalkable ground, steep land, stairs and house footprints cut lines; short fragments are discarded', () => {
  for(const override of [{waterAt:(x,z)=>z>70&&z<80?1:0},{walkable:(x,z)=>!(z>70&&z<80)},{slopeAt:(x,z)=>z>70&&z<80?15:0}]) {
    const lines=sandoLines(world(),{...flat,...override});assert(Object.keys(lines).length>=1);
    for(const line of Object.values(lines)) { assert(sandoLength(line)>=12);for(const p of line.xyz_m)assert(!( -p[1]>70&&-p[1]<80)); }
  }
  const data=world();data.facilities.nodes.push(node('stairs',80,0,[20,12]));
  for(const line of Object.values(sandoLines(data,flat))) for(const p of line.xyz_m)assert(sandoBoxDistance(p[0],-p[1],sandoRecords(data).at(-1).bounds)>0);
  assert.equal(Object.keys(sandoLines(world(),{...flat,walkable:(x,z)=>z>140})).length,0);
  const m=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,85,1];
  data.houses={instances:[{kind:0,matrix:m}],kinds:new Map([[0,{bbox_min:[-5,-5,0],bbox_max:[5,5,8]}]])};
  for(const line of Object.values(sandoLines(data,flat))) for(const p of line.xyz_m)assert(Math.abs(-p[1]-85)>5);
});

test('S1 hollow walls stop a route unless its gate supplies an opening', () => {
  const data=world();data.facilities.nodes.push(node('fence',20,0,[70,80]));
  // Southern band at z=60 is crossed through the gate there.
  assert(first(sandoLines(data,flat)).xyz_m.some(p=>-p[1]<50));
  data.facilities.nodes=data.facilities.nodes.filter(n=>n.part!=='gate');
  for(const line of Object.values(sandoLines(data,flat)))assert(line.xyz_m.every(p=>-p[1]>60));
});

test('load gates: sando=0, absent facilities, optional failure; stable paths retain legacy references and avoid collisions', async () => {
  const files=syntheticWorld(), data=await loadKamakura(fetcher(files),'?sando=0');assert.equal(data.sando,null);assert.equal(kamakuraPaths(data),kamakuraPaths(data));
  const noRoad=await loadKamakura(fetcher(files),'?sando=0&roads=0');assert.equal(kamakuraPaths(noRoad),noRoad.patches.paths);
  const good=await loadKamakura(fetcher(files),'');assert(Object.keys(good.sando).length>0);assert(good.facilities.nodes.some(n=>n.part==='gate'));
  const merged=kamakuraPaths(good);assert(Object.isFrozen(merged));assert.equal(merged,kamakuraPaths(good));assert(Object.keys(merged).some(k=>k.startsWith('sando:')));
  const copy=new Map(files), meta=JSON.parse(copy.get('meta.json'));delete meta.facilities;copy.set('meta.json',Buffer.from(JSON.stringify(meta)));assert.equal((await loadKamakura(fetcher(copy),'')).sando,null);
  const broken=new Map(files);broken.delete('facilities.json');assert.equal((await loadKamakura(fetcher(broken),'')).sando,null);
  // Optional derivation itself may fail even after valid data decoding (terrain provider failure).
  const nativeSin=Math.sin;
  try { Math.sin=()=>{throw Error('synthetic terrain failure');};const failed=await loadKamakura(fetcher(files),'');assert.equal(failed.sando,null);assert(failed.sandoNotice);assert(failed.facilities); }
  finally { Math.sin=nativeSin; }
  const line=first(good.sando), collision={patches:{paths:{'sando:a':line}},sando:{a:line}};assert.equal(kamakuraPaths(collision)['sando:sando:a'],line);
});

test('S1 readers exclude grass and trees, packed-earth centre has weight one; frozen paths do no subsequent point reads', () => {
  const data=world();data.sando=sandoLines(data,flat);const paths=kamakuraPaths(data), grass=grassExclusions(flat,{paths}), trees=vegExclusions(flat,{paths});
  assert.equal(grass(0,90),'path');assert.equal(trees({x:0,z:90}),'path');assert.equal(segmentWeight({x:0,z:0,dx:0,dz:150,r:2.5},0,90),1);
  let reads=0;const d={sando:{a:{width_m:5,get xyz_m(){reads++;return [[0,0,0],[0,-90,0]];}}}}, p=kamakuraPaths(d), f=createPathField();f.update({x:0,z:20},p);reads=0;
  f.update({x:1,z:20},p);f.update({x:20,z:20},p);assert.equal(reads,0);
});

test('S2 stones: three/four staggered columns, 2–4cm joints, missing edge stones, dimensions, yaw, central 60%, cap', t => {
  for(const width_m of [3,3.6,5]) {
    const lines={a:{xyz_m:[[0,0,0],[0,-150,0]],width_m}}, stones=[...sandoStones(lines,flat)];assert.deepEqual(stones,[...sandoStones(lines,flat)]);
    const cols=new Map();for(const p of stones){if(!cols.has(p.col))cols.set(p.col,[]);cols.get(p.col).push(p);assert(Math.abs(p.x)+p.w/2+.02<=width_m*.3+.025);assert(Math.abs(p.yaw)<=Math.PI/60);assert(p.d>=.9*.92&&p.d<=.9*1.08);}
    assert.equal(cols.size,width_m>=5?4:3);
    for(const group of cols.values())for(let i=1;i<group.length;i++)if(group[i].row===group[i-1].row+1){const envelope=p=>Math.abs(Math.cos(p.yaw))*p.d+Math.abs(Math.sin(p.yaw))*p.w;const gap=group[i].z-group[i-1].z-(envelope(group[i])+envelope(group[i-1]))/2;assert(gap>=.02-1e-8&&gap<=.04+1e-8);}
    assert.notEqual(cols.get(1)[0].z,cols.get(2)[0].z);assert(!stones.some(p=>p.col===0&&p.row%10===0));
    t.diagnostic(JSON.stringify({syntheticWidth:width_m,stones:stones.length,columns:cols.size}));
  }
  assert.equal([...sandoStones({long:{xyz_m:[[0,0,0],[0,-9000,0]],width_m:5}},flat)].length,SANDO.stones);
});

test('S2 props refuse stones on every prohibited box and terrain, including a narrow wet corner', () => {
  const data=world();data.sando=sandoLines(data,flat);data.facilities.nodes.push(node('stairs',80,0,[15,12]));
  const terrain={...flat,heightAt:(x,z)=>10+.1*x+.04*z, slopeAt:()=>7, waterAt:(x,z)=>z>95&&z<100?1:0};
  const context={data,terrain,houses:{boxes:[{x:0,z:40,w:4,d:5,rotY:.4}]}};
  const result=prepareProps(context), stones=result.items.filter(p=>p.kind==='paver');assert(stones.length>0);
  for(const p of stones){assert.equal(result.site.reason(p),null);assert.equal(p.y,terrain.heightAt(p.x,p.z));for(const b of result.site.boxes)assert(!propInBox(p.x,p.z,b,.04));assert(!(p.z>94.7&&p.z<100.3));}
  const site=createPropSite({...context,terrain:{...terrain,waterAt:(x,z)=>x>.2?1:0}});assert.equal(site.reason({kind:'paver',x:0,z:120,w:.9,d:.6,yaw:0,y:14.8}),'water');
});

test('S3 pairs cover the whole approach, 14m spacing, edges +0.6m, no gates within 2m; 24-pair cap', t => {
  const data=world();data.sando=sandoLines(data,flat);const result=prepareProps({data,terrain:flat}), lamps=result.items.filter(p=>p.kind==='lantern');
  const pairs=new Map();for(const p of lamps){if(!pairs.has(p.z))pairs.set(p.z,[]);pairs.get(p.z).push(p);assert.equal(Math.abs(p.x),3.1);for(const r of sandoRecords(data).filter(r=>['gate','torii'].includes(r.node.part)))assert(propBoxDistance(p.x,p.z,r.bounds)>=2);}
  assert([...pairs.keys()].some(z=>z>120));assert([...pairs.keys()].some(z=>z<40));
  const zs=[...pairs.keys()].sort((a,b)=>a-b);for(const pair of pairs.values())assert.equal(pair.length,2);for(let i=1;i<zs.length;i++)assert(Math.abs((zs[i]-zs[i-1])/SANDO_LANTERN.every-Math.round((zs[i]-zs[i-1])/SANDO_LANTERN.every))<1e-8);   // the spacing is the design constant; gaps (a gate) are whole multiples of it
  const long={sando:{a:{xyz_m:[[0,0,0],[0,-1000,0]],width_m:5,facility:'invented'}}};assert.equal(prepareProps({data:long,terrain:flat},{only:'lantern'}).placed.lantern,48);
  t.diagnostic(JSON.stringify({syntheticPairs:pairs.size,firstZ:zs[0],lastZ:zs.at(-1)}));
});

test('S1 remote added approaches retain bounded local grass/tree work (10,000 cold queries)', t => {
  const road={xyz_m:[[-500,0,0],[500,0,0]],width_m:4};const base={roads:{a:road}}, more={roads:base.roads,sando:{}};
  for(let i=0;i<200;i++)more.sando[i]={xyz_m:[[10000+i*50,0,0],[10000+i*50,-150,0]],width_m:5};
  function measure(data){const g={segments:0},v={segments:0},paths=kamakuraPaths(data),grass=createGrassEnvironment(flat,{paths,probe:g}),trees=vegExclusions(flat,{paths,probe:v});let total=0,max=0;for(let i=0;i<10000;i++){g.segments=v.segments=0;const x=(i%100)*9.87-490,z=Math.floor(i/100)*3.97-198;grass(x,z);trees({x,z});total+=g.segments+v.segments;max=Math.max(max,g.segments,v.segments);}grass.dispose();return {total,max};}
  assert.deepEqual(measure(base),measure(more));const work=measure(more);assert(work.max<=64);t.diagnostic(JSON.stringify({coldQueries:10000,...work}));
});

test('sando disabled produces byte-equal legacy prop transforms and no paving mesh inputs', () => {
  const data=world(), a=prepareProps({data,terrain:flat});data.sando=null;const b=prepareProps({data,terrain:flat});assert.deepEqual(a.items,b.items);assert.equal(b.placed.paver,0);
});

test('private world: derived lines and all stone footprints stay on permitted land; values remain unreported', async t => {
  const dir=process.env.KZ_WORLD_DIR;if(!dir)return t.skip('KZ_WORLD_DIR未設定');
  const data=await loadKamakura(async url=>{try{const bytes=await fs.readFile(path.join(dir,url.slice('/world-private/'.length)));return {ok:true,json:async()=>JSON.parse(bytes),arrayBuffer:async()=>ab(bytes)};}catch(error){if(error.code==='ENOENT')return {ok:false};throw error;}},'');
  const terrain=createKamakuraTerrain(data);assert.doesNotThrow(()=>sandoLines(data,terrain));
  const result=prepareProps({data,terrain});for(const p of result.items.filter(p=>p.kind==='paver'))assert.equal(result.site.reason(p),null,'Private prohibited placement (values withheld)');
});

test('densified local approaches keep grass/tree cold queries below mean 12 and max 64 segments', t => {
  const data={sando:{}};
  for(let i=0;i<30;i++){const points=[];for(let n=0;n<=32;n++)points.push([i*150-2100,-n*4.5,0]);data.sando[i]={xyz_m:points,width_m:5};}
  const paths=kamakuraPaths(data),g={segments:0},v={segments:0},grass=createGrassEnvironment(flat,{paths,probe:g}),trees=vegExclusions(flat,{paths,probe:v});
  let gt=0,vt=0,gm=0,vm=0;
  for(let i=0;i<10000;i++){g.segments=v.segments=0;const x=i%100*44.31-2190,z=Math.floor(i/100)*4.17-110;grass(x,z);trees({x,z});gt+=g.segments;vt+=v.segments;gm=Math.max(gm,g.segments);vm=Math.max(vm,v.segments);}
  grass.dispose();assert(gt/10000<=12&&vt/10000<=12&&gm<=64&&vm<=64);t.diagnostic(JSON.stringify({syntheticApproaches:30,coldQueries:10000,grassMean:gt/10000,treeMean:vt/10000,grassMax:gm,treeMax:vm}));
});
