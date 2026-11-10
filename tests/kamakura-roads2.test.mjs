import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrassEnvironment, grassEcology, grassMargin, grassColony } from '../dist/valley/kamakura-grass-look.js';
import { vegExclusions } from '../dist/valley/kamakura-veg.js';
import { grassExclusions, createGrassCell } from '../dist/valley/kamakura-grass-field.js';
import { createPathField, segmentWeight, pathRadius } from '../dist/valley/kamakura-ground-path.js';
import { kamakuraPaths } from '../dist/valley/kamakura-roads.js';
import { soilHash, smooth as groundSmooth } from '../dist/valley/kamakura-ground-pattern.js';

const flat = { heightAt:()=>10, waterAt:()=>0, slopeAt:()=>0, walkable:()=>true, riverDistanceAt:()=>Infinity, seaDistanceAt:()=>Infinity };
const line = (width, z=0) => ({ xyz_m:[[-200,-z,0],[200,-z,0]], ...(width===undefined?{}:{width_m:width}) });
const passes = Object.fromEntries(Array.from({length:7},(_,i)=>[`pass${i}`,{xyz_m:[[-1800+i*50,1900,0],[-1600+i*50,1500,0],[-1400+i*50,1100,0]]}]));
const options = paths => ({paths,spawn:{x:-180,z:80},boxes:[{x:32,z:48,w:8,d:14,rotY:.7}]});

test('ROADS2 widthless grass ecology and tree exclusions match the saved implementation bit for bit', () => {
  const paths={...passes,a:line(),b:{xyz_m:[[61,180,0],[61,-180,0]]},diagonal:{xyz_m:[[-180,150,0],[180,-130,0]]}};
  const colliders={grid:new Map([['0,0',[{type:'circle',x:3,z:4,r:1,height:12}]]])};
  const terrain={...flat,heightAt:(x,z)=>10+.01*x+.02*z,slopeAt:()=>4,riverDistanceAt:(x,z)=>Math.abs(z+22)};
  for(const r4 of [false,true]) {
    const opts={...options(paths),colliders,r4,surfaceCodeAt:(x,z)=>x+z>0?2:0};
    const before=legacyGrassEnvironment(terrain,opts),after=createGrassEnvironment(terrain,opts);
    for(let i=0;i<10000;i++) {
      const x=(i%100)*4.01-200.5,z=Math.floor(i/100)*4.03-200.5;
      assert.deepEqual(after(x,z,i%2===0),before(x,z,i%2===0));
    }
  }
  // Preserve caller padding too: grassExclusions delegates to this same route filter.
  for(const pathMargin of [2.5,2.5+Math.SQRT1_2,0,.1,4]) {
    const opts={...options(paths),pathMargin},before=legacyVegExclusions(terrain,opts),after=vegExclusions(terrain,opts);
    for(let i=0;i<10000;i++) {
      const p={x:(i%100)*4.01-200.5,z:Math.floor(i/100)*4.03-200.5};
      assert.equal(after(p),before(p));
    }
  }
  // Probe exact bucket, road-edge and far-saturation boundaries (including negative cells).
  const before=legacyGrassEnvironment(flat,{paths}),after=createGrassEnvironment(flat,{paths});
  for(const x of [-192,-128,-64,-16,0,16,64,128,192])for(const z of [-10,-5,-3.7,-2.5,0,2.5,3.7,5,10,32,64])assert.deepEqual(after(x,z),before(x,z));
});

test('ROADS2 widths share pathRadius, preserve edge ecology and exclude grass roots and trees', () => {
  assert.equal(pathRadius({}),2.5);
  for(const [width,d,legacyDistance] of [[14,6,1.5],[14,8.5,4],[2.8,2,3.1]]) {
    const paths={lane:line(width)},oldPaths={lane:line(undefined,d-legacyDistance)};
    const env=createGrassEnvironment(flat,{paths}),reference=createGrassEnvironment(flat,{paths:oldPaths});
    assert.deepEqual(env(0,d),reference(0,d));
    const trees=vegExclusions(flat,{paths}),oldTrees=vegExclusions(flat,{paths:oldPaths});
    assert.equal(trees({x:0,z:d}),oldTrees({x:0,z:d}));
    const grass=grassExclusions(flat,{paths,pathMargin:2.5}),oldGrass=grassExclusions(flat,{paths:oldPaths,pathMargin:2.5});
    assert.equal(grass(0,d),oldGrass(0,d));
    if(width===14&&d===6) {
      assert.equal(grass(0,d),'path');assert.equal(trees({x:0,z:d}),'path');assert.equal(env(0,d).edge,0);
      const cell=createGrassCell(flat,{surfaceCodeAt:()=>2,environmentAt:env,exclude:grass});
      assert.equal(cell(0,5).placeable,0);
    } else {
      assert.equal(grass(0,d),null);assert.equal(trees({x:0,z:d}),null);assert.ok(env(0,d).density>0);
    }
  }
  // Every ecology term involving path distance is saturated at ten metres.
  assert.deepEqual(grassEcology(0,0,{path:10}),grassEcology(0,0,{path:Infinity}));
});

test('ROADS2 narrow segment weights and water remain bit-identical on 10,000-point lattices', () => {
  for(const r of [1.4,2.5,3.6])for(const water of [false,true]) {
    const s={x:-8,z:-9,dx:18,dz:21,r,water};
    for(let i=0;i<10000;i++) {
      const x=(i%100)*.25-12,z=Math.floor(i/100)*.25-12;
      assert.equal(segmentWeight(s,x,z),legacySegmentWeight(s,x,z));
    }
  }
});

test('ROADS2 wide packed earth has a broad core, bounded irregular edge and vanishes outside', () => {
  const s={x:-200,z:0,dx:400,dz:0,r:7};
  assert.ok(segmentWeight(s,0,6.2)>0&&segmentWeight(s,0,6.2)<1);
  for(let x=-100;x<=100;x+=2) {
    assert.equal(segmentWeight(s,x,3),1);
    const w=segmentWeight(s,x,6.2);assert.ok(w>=0&&w<1);
    assert.equal(segmentWeight(s,x,7.1),0);
  }
  const values=Array.from({length:81},(_,i)=>segmentWeight(s,i*2-80,5.5));
  const mean=values.reduce((a,b)=>a+b,0)/values.length;
  const std=Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length);
  assert.ok(std>.02);
  console.log(JSON.stringify({wideCore:segmentWeight(s,0,3),wideEdgeMin:Math.min(...values),wideEdgeMax:Math.max(...values),wideEdgeStd:std}));
});

test('ROADS2 frozen merged containers skip all point reads on stable and moving updates; mutable paths stay live', () => {
  let reads=0;
  const route={width_m:14,get xyz_m(){reads++;return [[-90,0,0],[90,0,0]];}};
  const data={patches:{paths:{pass:line()}},roads:{lane:route}},paths=kamakuraPaths(data),field=createPathField();
  assert.ok(Object.isFrozen(paths));assert.equal(kamakuraPaths(data),paths);
  assert.ok(field.update({x:0,z:0},paths));assert.ok(reads>0);reads=0;
  assert.equal(field.update({x:0,z:0},paths),false);assert.equal(reads,0);
  assert.equal(field.update({x:12,z:0},paths),true);assert.equal(reads,0);
  const mutable={lane:line(4)},legacy={patches:{paths:mutable}};
  assert.equal(kamakuraPaths(legacy),mutable);assert.equal(Object.isFrozen(mutable),false);
  const live=createPathField();live.update({x:0,z:0},mutable);
  mutable.lane.xyz_m[0][1]=100;assert.ok(live.update({x:0,z:0},mutable));
  mutable.lane.width_m=14;assert.ok(live.update({x:0,z:0},mutable));
  delete mutable.lane;assert.ok(live.update({x:0,z:0},mutable));assert.ok(live.bytes.every(n=>n===0));
  console.log(JSON.stringify({frozenSubsequentPointReads:reads}));
});

// Synthetic clipped town network: 22 roads per axis, 150m spacing, ~950m per road.
// Also stress an unbroken 3150m grid; no private-world coordinates or counts are used.
function townNetwork(length=950) {
  const paths={...passes},step=4.6;
  for(let axis=0;axis<2;axis++)for(let i=0;i<22;i++) {
    const fixed=(i-10.5)*150,xyz_m=[];
    for(let d=-length/2;d<length/2;d+=step)xyz_m.push(axis?[fixed,d,0]:[d,fixed,0]);
    xyz_m.push(axis?[fixed,length/2,0]:[length/2,fixed,0]);
    paths[`town${axis}:${i}`]={xyz_m,width_m:[14,4,2.8][i%3]};
  }
  return paths;
}
function measure(paths) {
  const grassProbe={segments:0},treeProbe={segments:0};
  const grass=createGrassEnvironment(flat,{paths,probe:grassProbe}),trees=vegExclusions(flat,{paths,probe:treeProbe});
  let grassTotal=0,grassMax=0,treeTotal=0,treeMax=0;
  for(let i=0;i<10000;i++) {
    // A deterministic permutation visits distinct uncached points across the town.
    const x=(i%100)*33.17-1640.3,z=(Math.floor(i/100)*37%100)*33.13-1640.7;
    grassProbe.segments=0;treeProbe.segments=0;grass(x,z);trees({x,z});
    grassTotal+=grassProbe.segments;treeTotal+=treeProbe.segments;
    grassMax=Math.max(grassMax,grassProbe.segments);treeMax=Math.max(treeMax,treeProbe.segments);
  }
  grass.dispose();
  return {grassMean:grassTotal/10000,grassMax,treeMean:treeTotal/10000,treeMax};
}
test('ROADS2 10,000 cold queries stay below mean 12 / maximum 64 segments, for both route indexes', () => {
  for(const length of [950,3150]) {
    const paths=townNetwork(length),counts=measure(paths);
    const points=Object.values(paths).reduce((n,p)=>n+p.xyz_m.length,0);
    assert.ok(counts.grassMean<=12);assert.ok(counts.grassMax<=64);
    assert.ok(counts.treeMean<=12);assert.ok(counts.treeMax<=64);
    console.log(JSON.stringify({syntheticLength:length,syntheticPoints:points,...counts}));
  }
});
test('ROADS2 pass-only workloads never increase from the old indexes, including road-free worlds', () => {
  for(const paths of [{},passes]) {
    const probeG={segments:0},probeV={segments:0};
    const grass=createGrassEnvironment(flat,{paths,probe:probeG}),trees=vegExclusions(flat,{paths,probe:probeV});
    let oldG=0,oldV=0,newG=0,newV=0;
    for(let i=0;i<10000;i++) {
      const beforeG=oldG,beforeV=oldV;
      const x=-1950+(i%100)*8.17,z=-2000+Math.floor(i/100)*10.13;
      const oldSegments=[];
      for(const p of Object.values(paths))for(let k=1;k<p.xyz_m.length;k++) {
        const a=p.xyz_m[k-1],b=p.xyz_m[k];
        const includes=(cell,margin)=>Math.floor(x/cell)>=Math.floor((Math.min(a[0],b[0])-margin)/cell)&&Math.floor(x/cell)<=Math.floor((Math.max(a[0],b[0])+margin)/cell)&&Math.floor(z/cell)>=Math.floor((Math.min(-a[1],-b[1])-margin)/cell)&&Math.floor(z/cell)<=Math.floor((Math.max(-a[1],-b[1])+margin)/cell);
        if(includes(64,10))oldG++;
        if(includes(256,2.5))oldSegments.push({x:a[0],z:-a[1],dx:b[0]-a[0],dz:a[1]-b[1]});
      }
      for(const a of oldSegments){oldV++;const t=Math.max(0,Math.min(1,((x-a.x)*a.dx+(z-a.z)*a.dz)/(a.dx*a.dx+a.dz*a.dz||1)));if(Math.hypot(x-a.x-t*a.dx,z-a.z-t*a.dz)<=2.5)break;}
      probeG.segments=0;probeV.segments=0;grass(x,z);trees({x,z});newG+=probeG.segments;newV+=probeV.segments;
      assert.ok(probeG.segments<=oldG-beforeG);assert.ok(probeV.segments<=oldV-beforeV);
    }
    assert.ok(newG<=oldG);assert.ok(newV<=oldV);
    console.log(JSON.stringify({passesOnly:Object.keys(paths).length,oldGrassSegments:oldG,grassSegments:newG,oldTreeSegments:oldV,treeSegments:newV}));
  }
});

// Frozen pre-ROADS2 reference implementations (0269fb4), using only synthetic inputs.
const clamp=v=>Math.max(0,Math.min(1,v));
const smooth=v=>{const t=clamp(v);return t*t*(3-2*t);};
function legacyGrassEnvironment(terrain,{ colliders, extraColliders, paths={}, surfaceCodeAt, r4=false }={}) {
  const routes=new Map(), key=(x,z)=>`${x},${z}`;
  for(const path of Object.values(paths))for(let i=1;i<path.xyz_m.length;i++) {
    const a=path.xyz_m[i-1],b=path.xyz_m[i],segment={x:a[0],z:-a[1],dx:b[0]-a[0],dz:a[1]-b[1]};
    for(let z=Math.floor((Math.min(-a[1],-b[1])-10)/64);z<=Math.floor((Math.max(-a[1],-b[1])+10)/64);z++)
      for(let x=Math.floor((Math.min(a[0],b[0])-10)/64);x<=Math.floor((Math.max(a[0],b[0])+10)/64);x++){
        const k=key(x,z);if(!routes.has(k))routes.set(k,[]);routes.get(k).push(segment);
      }
  }
  // W2c-9p: metre ecology is shared by window preparation and near/mid packing.
  // The view prunes to its bounded window; normal work stays lazy and near-only.
  const cache=new Map(), buckets=new Map(), layers=[colliders,extraColliders];
  const environment=(x,z,withNormal=false,river)=>{
    const id=key(x,z);let e=cache.get(id);
    if(!e) {
    let path=Infinity,house=Infinity,tree=Infinity,shade=0;
    for(const a of routes.get(key(Math.floor(x/64),Math.floor(z/64)))||[]) {
      const t=clamp(((x-a.x)*a.dx+(z-a.z)*a.dz)/(a.dx*a.dx+a.dz*a.dz||1));
      path=Math.min(path,Math.hypot(x-a.x-t*a.dx,z-a.z-t*a.dz));
    }
    // A collider occupies several buckets; shade/house minima need each only once.
    const bx=Math.floor((x-12)/8),bz=Math.floor((z-12)/8),bucketKey=key(bx,bz);
    let candidates=buckets.get(bucketKey);
    if(!candidates){
      const unique=new Set();
      for(let j=bz;j<=Math.floor((z+12)/8);j++)for(let i=bx;i<=Math.floor((x+12)/8);i++)
        for(const col of layers)for(const o of col?.grid.get(key(i,j))||[])unique.add(o);
      candidates=[...unique];buckets.set(bucketKey,candidates);
    }
    for(const o of candidates) {
      if(o.type==='circle'){const d=Math.hypot(x-o.x,z-o.z)-o.r;tree=Math.min(tree,d);shade=Math.max(shade,1-smooth(d/Math.min(10,Math.max(3,o.height*.4))));}
      else {const dx=x-o.x,dz=z-o.z,d=Math.hypot(Math.max(0,Math.abs(dx*o.c-dz*o.s)-o.hx),Math.max(0,Math.abs(dx*o.s+dz*o.c)-o.hz));house=Math.min(house,d);shade=Math.max(shade,.65*(1-smooth(d/8)));}
    }
    const riverDistance=river??terrain.riverDistanceAt(x,z,15),slope=terrain.slopeAt?.(x,z)??0;
    let townEdge=Infinity;
    const code=surfaceCodeAt?.(x,z);
    // Dirt/grass transitions describe town lanes without a private path map.
    if(code===0||code===2)for(const [dx,dz] of [[.75,0],[-.75,0],[0,.75],[0,-.75],[1.2,0],[-1.2,0],[0,1.2],[0,-1.2]]) {
      const other=surfaceCodeAt(x+dx,z+dz);
      if((code===0&&other===2)||(code===2&&other===0))townEdge=Math.min(townEdge,Math.hypot(dx,dz));
    }
    const margin=grassMargin({path,house,tree,river:riverDistance,townEdge});
    e=grassEcology(x,z,{river:riverDistance,path,house,shade,sand:1-smooth((terrain.seaDistanceAt?.(x,z)??Infinity)/40),elevation:terrain.heightAt(x,z),slopeBreak:smooth(slope/24)});
    // A positive local crest suppresses ridge rows; bowls retain their colonies.
    const crest=Math.max(0,terrain.heightAt(x,z)-(terrain.heightAt(x-4,z)+terrain.heightAt(x+4,z)+terrain.heightAt(x,z-4)+terrain.heightAt(x,z+4))/4);
    e.margin=margin;e.colony=grassColony(x,z);
    if(r4){e.sand=code===0;e.sea=terrain.seaDistanceAt?.(x,z)??Infinity;e.elevation=terrain.heightAt(x,z);}
    // W2c-9r2 grass: expose physical refuge/crest distances to the band placement rule.
    e.tree=tree;e.house=house;e.river=riverDistance;e.crest=crest;
    const colonyWeight=e.colony>.53 ? 1.55 : e.colony>.40 ? .35 : .025;
    e.midDensity*=Math.max(margin?1.8:0,colonyWeight)*(1-.8*smooth((slope-30)/2))*(1-.65*smooth(crest/1.5));
    if(code===0)e.midDensity*=margin?1:.15;
    // Grassland preserves the pre-9b leaf-density floor; soil stays trampled.
    e.nearDensity=code===2?Math.max(1,e.density):e.density;
    if(margin){e.nearDensity=Math.max(e.nearDensity,1.15);e.midDensity=Math.max(e.midDensity,2);}
    cache.set(id,e);
    }
    if(withNormal && e.normalY===undefined){const nx=terrain.heightAt(x-.5,z)-terrain.heightAt(x+.5,z),nz=terrain.heightAt(x,z-.5)-terrain.heightAt(x,z+.5),length=Math.hypot(nx,1,nz);e.normalX=nx/length;e.normalY=1/length;e.normalZ=nz/length;}
    return e;
  };
  let retained=null;
  environment.retain=(f)=>{
    // No cache-wide scan on a streaming frame. Expansion keeps warm entries;
    // movement starts a bounded generation, while resident geometry keeps its bytes.
    if(!retained || f.x0>retained.x0 || f.z0>retained.z0 || f.x0+f.nx<retained.x0+retained.nx || f.z0+f.nz<retained.z0+retained.nz)cache.clear();
    buckets.clear();retained={x0:f.x0,z0:f.z0,nx:f.nx,nz:f.nz};
  };
  environment.dispose=()=>{cache.clear();buckets.clear();};
  return environment;
}

const key = (x, z) => `${x},${z}`;
// Bounds are indexed too, so exclusions do not scan every house for every tree.
function insert(grid, value, minX, maxX, minZ, maxZ, cell = 256) {
  for (let x = Math.floor(minX / cell); x <= Math.floor(maxX / cell); x++) for (let z = Math.floor(minZ / cell); z <= Math.floor(maxZ / cell); z++) {
    const k = key(x, z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(value);
  }
}
function nearHouse(b, p) {
  const c = Math.cos(b.rotY), s = Math.sin(b.rotY), dx = p.x - b.x, dz = p.z - b.z;
  return Math.hypot(Math.max(0, Math.abs(dx * c - dz * s) - b.w / 2), Math.max(0, Math.abs(dx * s + dz * c) - b.d / 2)) <= 1;
}
function segmentDistance(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}
function legacyVegExclusions(terrain, { boxes = [], paths = {}, spawn, pathMargin = 2.5, spawnMargin = 3 } = {}) {
  const obstacles = new Map(), routes = new Map();
  for (const b of boxes) { const r = Math.hypot(b.w, b.d) / 2 + 1; insert(obstacles, b, b.x - r, b.x + r, b.z - r, b.z + r); }
  for (const p of Object.values(paths)) for (let i = 1; i < p.xyz_m.length; i++) {
    const a = { x: p.xyz_m[i - 1][0], z: -p.xyz_m[i - 1][1] }, b = { x: p.xyz_m[i][0], z: -p.xyz_m[i][1] };
    insert(routes, { a, b }, Math.min(a.x, b.x) - pathMargin, Math.max(a.x, b.x) + pathMargin, Math.min(a.z, b.z) - pathMargin, Math.max(a.z, b.z) + pathMargin);
  }
  return item => {
    const k = key(Math.floor(item.x / 256), Math.floor(item.z / 256));
    return (obstacles.get(k) || []).some(b => nearHouse(b, item)) ? 'house'
      : (routes.get(k) || []).some(({ a, b }) => segmentDistance(item, a, b) <= pathMargin) ? 'path'
      : spawn && Math.hypot(item.x - spawn.x, item.z - spawn.z) <= spawnMargin ? 'spawn'
      : terrain.waterAt(item.x, item.z) > 0 || terrain.heightAt(item.x, item.z) <= 0 ? 'water' : null;
  };
}

function legacySegmentWeight(s,x,z) {
  const dx=x-s.x,dz=z-s.z,t=Math.max(0,Math.min(1,(dx*s.dx+dz*s.dz)/(s.dx*s.dx+s.dz*s.dz||1)));
  const u=dx-t*s.dx,v=dz-t*s.dz,squared=u*u+v*v;
  if(squared>=s.r*s.r)return 0;
  if(!s.water && squared<=Math.min(1.2,s.r*.375)**2)return 1;
  const d=Math.sqrt(squared);
  if(s.water)return 1-groundSmooth(s.r-2,s.r,d);
  const edge=s.r*(.75+.25*soilHash(Math.floor(x/2),Math.floor(z/2)));
  return 1-groundSmooth(Math.min(1.2,edge*.5),edge,d);
}
