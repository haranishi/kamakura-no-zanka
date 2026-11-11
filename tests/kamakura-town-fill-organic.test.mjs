import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TOWN_FILL as C, TOWN_FILL_FIELDS, townFillConfig, prepareTownFill, townBoxesOverlap } from '../dist/valley/kamakura-town-fill.js';
import { houseBox, houseIntersects } from '../dist/valley/kamakura-houses.js';
import { prepareTownDress } from '../dist/valley/kamakura-town-dress.js';
import { HOUSE_FAR } from '../dist/valley/kamakura-house-far.js';
import { loadKamakura } from '../dist/valley/kamakura-data.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { buildColliders, moveActor } from '../dist/valley/collision.js';

function town({ span = 420, reach = 170, config } = {}) {
  const kinds = new Map();
  for (const [index, type] of ['machiya', 'koya', 'kura'].entries()) kinds.set(index, { index, node: 'invented-' + type, house_type: type, bbox_min: [-2, -3, -1], bbox_max: [2, 3, 5], triangles: 20 });
  const data = { meta: { ...(config ? { town_fill: config } : {}) }, houses: { kinds, instances: [], catalog: { count: 0, kinds: [...kinds.values()], count_by_kind: {} } },
    roads: { main: { kind: 'local_road', width_m: 16, xyz_m: [[0, span / 2, 0], [0, -span / 2, 0]] } }, facilities: { nodes: [] } };
  const inside = (x, z) => Math.abs(x) < reach && Math.abs(z) < span / 2;
  const terrain = { groundAt: (x, z) => inside(x, z) ? null : 'water', insideA: inside, walkable: inside, heightAt: () => 12, slopeAt: () => 0,
    waterAt: (x, z) => z > span / 2 ? 1 : 0, codeAt: (x, z) => z > span / 2 ? 0 : 4 };
  return { data, terrain };
}
const fill = f => prepareTownFill(f.data, { terrain: f.terrain });
const boxes = r => r.houses.instances.map(p => houseBox(r.houses.kinds.get(p.kind), p.matrix));
const sd = values => { const mean = values.reduce((s, v) => s + v, 0) / values.length; return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length); };
// Fold road-facing reversals and cross streets into a common facade angle, in degrees.
const angles = r => r.houses.instances.map(p => { const a = Math.atan2(p.matrix[8], p.matrix[0]); return Math.atan2(Math.sin(4 * a), Math.cos(4 * a)) / 4 * 180 / Math.PI; });
const outline = r => {
  const bands = new Map();
  for (const p of r.townPlots.filter(p => p.state === 'house')) { const k = Math.floor(p.z / 12) * 2 + +(p.x > 0); bands.set(k, Math.max(bands.get(k) || 0, Math.abs(p.x))); }
  return sd([...bands.values()]);
};
function noOverlap(r, original = 0) { const b = boxes(r); for (let i = original; i < b.length; i++) for (let j = 0; j < i; j++) assert(!townBoxesOverlap(b[i], b[j]), `overlap ${i}/${j}`); }
function distance(p, a, b) { const dx = b[0] - a[0], dz = a[1] - b[1], t = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.z + a[1]) * dz) / (dx * dx + dz * dz))); return Math.hypot(p.x - a[0] - t * dx, p.z + a[1] - t * dz); }

// Complete pre-change house list for a small invented town; rounded numbers use a tolerance, never a hash.
const legacy = [[0,0,.99485211,-1.56258416,13.06924755,-5.88232515],[1,0,1.07648821,-1.55906305,13.03155207,14.62155481],[2,0,.99370705,-1.50324729,13.98006841,26.51201108],[3,1,1.04295323,-1.62571289,24.38065251,25.79942552],[4,0,.99348544,-1.63721925,13.29015874,46.76824521],[5,1,.97476249,-1.61559922,23.26253429,46.71650838],[6,0,1.07533115,-1.57625592,12.78951204,56.90831964],[7,0,1.03514426,1.61532013,24.24327948,-4.60570531],[8,0,.94816028,1.54894796,24.81793081,13.42663798],[9,0,.95645251,1.52033594,24.10111378,58.80630539]];
test('absent layout values preserve the complete legacy house list and zero opt-ins are identical', () => {
  const f = town({ span: 160, reach: 35 }), r = fill(f);
  assert.equal(r.houses.instances.length, legacy.length);
  legacy.forEach(([id, kind, scale, yaw, x, z], i) => {
    const item = r.houses.instances[i], c = Math.cos(yaw) * scale, s = Math.sin(yaw) * scale;
    assert.equal(item.id, id); assert.equal(item.kind, kind);
    const expected = [c,0,-s,0,0,scale,0,0,s,0,c,0,x,0,z,1];
    expected.forEach((v, j) => assert(Math.abs(item.matrix[j] - v) < 1e-7, `matrix ${i}/${j}`));
  });
  f.data.meta.town_fill = { groupYaw: 0, edgeFray: 0, yardRate: 0 };
  assert.deepEqual(fill(f).houses, r.houses); assert.deepEqual(r.yards, []);
  assert.equal(prepareTownFill(f.data, { terrain: f.terrain, search: '?townfill=0' }), null);
});
test('every new data field accepts both boundaries, rejects nonfinite/outside values and inverted setbacks', () => {
  for (const name of ['yaw','shift','setbackMin','setbackMax','bend','bendWave','annexRate','groupYaw','edgeFray','yardRate']) {
    const [min, max] = TOWN_FILL_FIELDS[name];
    for (const v of [min, max]) { const value = { [name]: v }; if (name.startsWith('setback')) Object.assign(value, { setbackMin: v, setbackMax: v }); assert.equal(townFillConfig(value)[name], v); }
    for (const v of [min - .001, max + .001, NaN, Infinity, '1', null]) assert.throws(() => townFillConfig({ [name]: v }));
  }
  assert.throws(() => townFillConfig({ setbackMin: 4, setbackMax: 2 }));
});
test('three to six neighbouring facade slots share a turn and setback; safe rotation preserves density and increases spread', () => {
  const config = { yaw: 0, groupYaw: 12, bend: 0, shift: 0, setbackMin: 2, setbackMax: 2, annexRate: 0, houseRate: 1, gardenRate: 0, burntRate: 0, repairRate: 0 };
  const r = fill(town({ config })), flat = fill(town({ config: { ...config, groupYaw: 0 } }));
  const row = r.townPlots.filter(p => p.lane === 'avenue' && p.x > 0).sort((a,b) => a.z - b.z);
  const runs = []; for (const p of row) { const last = runs.at(-1); if (last && Math.abs(last.turn - p.houseTurn) < 1e-9) last.n++; else runs.push({ turn: p.houseTurn, n: 1 }); }
  assert(runs.length > 4); for (const run of runs.slice(1,-1)) assert(run.n >= 3 && run.n <= 6);
  assert(sd(angles(r)) > sd(angles(flat)) + 1); assert(r.stats.houses.added >= flat.stats.houses.added);
  noOverlap(r); assert.deepEqual(fill(town({ config })), r);
});
test('broad edge bites preserve central and avenue plots, neighbours, density and bounded removal', () => {
  const f = town({ config: { houseRate: 1, gardenRate: 0, burntRate: 0, repairRate: 0 } }), before = fill(f); f.data.meta.town_fill.edgeFray = 1; const after = fill(f);
  assert(after.stats.edge.dropped > 0); assert(after.stats.edge.fraction <= .12);
  const key = p => [p.x,p.z,p.lane].join(','), kept = new Set(after.townPlots.map(key));
  for (const p of before.townPlots) if (p.lane === 'avenue' || Math.abs(p.x) < C.laneFirst) assert(kept.has(key(p)));
  const homes = after.townPlots.filter(p => p.state === 'house'), reach = Math.max(C.frontageMax * C.frayNeighbour, C.depth + C.laneWidth);
  for (const p of homes) assert(homes.some(q => q !== p && Math.hypot(p.x-q.x,p.z-q.z) <= reach));
  assert(outline(after) > outline(before)); noOverlap(after); assert.deepEqual(fill(f), after);
});
test('rear markers are deterministic, absent behind annexes, and clear of all houses, paths and other markers', () => {
  const f = town({ config: { yardRate: 1, annexRate: 0 } }), r = fill(f), b = boxes(r);
  assert(r.yards.length > 0); assert(Object.isFrozen(r.yards));
  const paths = [...Object.values(f.data.roads), ...Object.values(r.lanes)];
  for (let i = 0; i < r.yards.length; i++) {
    const p = r.yards[i]; for (const house of b) assert(!houseIntersects(house, p, undefined, C.yardGap + p.size / 2 - 1e-8));
    for (const line of paths) for (let j = 1; j < line.xyz_m.length; j++) assert(distance(p,line.xyz_m[j-1],line.xyz_m[j]) >= line.width_m/2+C.yardGap+p.size/2-1e-8);
    for (let j = i+1; j < r.yards.length; j++) assert(Math.hypot(p.x-r.yards[j].x,p.z-r.yards[j].z) >= C.yardGap+(p.size+r.yards[j].size)/2);
  }
  assert.deepEqual(fill(f).yards, r.yards);
  f.data.meta.town_fill.annexRate = 1; const annexed = fill(f); assert(annexed.stats.annexes > 0); assert(annexed.yards.length < r.yards.length);
});
test('plot enclosures follow facade turns and retain house clearance', () => {
  const f = town({ config: { yaw: 2, groupYaw: 12, annexRate: 0 } }), r = fill(f);
  const dress = prepareTownDress({ data: { ...f.data, houses: r.houses, townPlots: r.townPlots, lanes: r.lanes }, terrain: f.terrain });
  const fences = dress.items.filter(p => ['bamboo','board','log'].includes(p.kind)), b = boxes(r);
  assert(fences.length > 0); assert(r.townPlots.some(p => Math.abs(p.houseTurn || 0) > .05));
  for (const fence of fences) {
    const plot = r.townPlots[fence.plot], delta = fence.yaw - plot.yaw - (plot.houseTurn || 0);
    assert(Math.abs(Math.sin(2 * delta)) < 1e-8);
    for (const house of b) assert(!townBoxesOverlap({ ...fence, rotY: fence.yaw }, house, .6 - 1e-8));
  }
});

// Sweep actual movement in both directions on a 5 m grid. Only previously traversable
// edges are considered; symmetric house collisions must not create a new one-way trap.
function movement(terrain, old, added, axis, spawn) {
  const pad = 175, step = 5, x0 = -pad, x1 = pad, z0 = Math.min(...axis.points.map(p => p.z)) - 15, z1 = Math.max(...axis.points.map(p => p.z)) + 15;
  const w = Math.floor((x1-x0)/step), h = Math.floor((z1-z0)/step), n = w*h, open = new Uint8Array(n), base = new Uint8Array(n), edges = new Uint8Array(n), previous = new Uint8Array(n);
  const col = buildColliders({ bounds: terrain.bounds, extraBoxes: old }), all = buildColliders({ bounds: terrain.bounds, extraBoxes: [...old,...added] });
  const x = k => x0+(k%w+.5)*step, z = k => z0+(Math.floor(k/w)+.5)*step;
  let source = -1, nearest = Infinity;
  for (let k=0;k<n;k++) {
    const p = {x:x(k),z:z(k)};
    if (!terrain.walkable(p.x,p.z) || old.some(b => houseIntersects(b,p,undefined,.3))) continue;
    base[k]=1; if (added.some(b => houseIntersects(b,p,undefined,.3))) continue; open[k]=1;
    const d=Math.hypot(p.x-spawn.x,p.z-spawn.z); if(d<nearest){nearest=d;source=k;}
  }
  const dx=[1,-1,0,0],dz=[0,0,1,-1],opposite=[1,0,3,2];
  for(let k=0;k<n;k++) if(base[k]) for(let d=0;d<4;d++) {
    const i=k%w+dx[d],j=Math.floor(k/w)+dz[d],q=j*w+i;if(i<0||i>=w||j<0||j>=h||!base[q])continue;
    const p={x:x(k),y:terrain.heightAt(x(k),z(k)),z:z(k)};
    const prior=moveActor(col,terrain,p,dx[d]*step,dz[d]*step,.3);
    if(Math.hypot(prior.x-x(q),prior.z-z(q))>=.5)continue;previous[k]|=1<<d;
    if(!open[k]||!open[q])continue;
    const after=moveActor(all,terrain,p,dx[d]*step,dz[d]*step,.3);
    if(Math.hypot(after.x-x(q),after.z-z(q))<.5)edges[k]|=1<<d;
  }
  for(let k=0;k<n;k++)for(let d=0;d<4;d++){
    const i=k%w+dx[d],j=Math.floor(k/w)+dz[d],q=j*w+i;if(i<0||i>=w||j<0||j>=h)continue;
    if((previous[k]&(1<<d))&&(previous[q]&(1<<opposite[d]))&&(edges[k]&(1<<d))&&!(edges[q]&(1<<opposite[d])))edges[k]&=~(1<<d);
  }
  const reach=(graph,reverse)=>{const seen=new Uint8Array(n),queue=new Int32Array(n);let head=0,tail=0;if(source>=0){seen[source]=1;queue[tail++]=source;}while(head<tail){const k=queue[head++];for(let d=0;d<4;d++){const i=k%w+dx[d],j=Math.floor(k/w)+dz[d],q=j*w+i;if(i<0||i>=w||j<0||j>=h||seen[q])continue;if(reverse?graph[q]&(1<<opposite[d]):graph[k]&(1<<d)){seen[q]=1;queue[tail++]=q;}}}return seen;};
  const before=reach(previous,false),back=reach(previous,true),after=reach(edges,false),returned=reach(edges,true);
  let reached=0,traps=0; for(let k=0;k<n;k++)if(after[k]){reached++;if(!returned[k]&&!(before[k]&&!back[k]))traps++;}
  return {cells:n,reached,newTraps:traps};
}
test('authored town with requested values retains 95 percent of houses, avenue frontages and bidirectional movement', { skip: !process.env.KZ_DESIGNED_WORLD_DIR && 'KZ_DESIGNED_WORLD_DIR未設定' }, async t => {
  const bare = await loadKamakura(async url => {
    const bytes=await fs.readFile(path.join(process.env.KZ_DESIGNED_WORLD_DIR,path.basename(url)));
    return {ok:true,json:async()=>JSON.parse(bytes),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
  }, '?townfill=0');
  const before=prepareTownFill(bare), values={yaw:9,groupYaw:8,shift:1.4,setbackMin:1,setbackMax:4.5,bend:3,bendWave:70,annexRate:.55,edgeFray:.8,yardRate:.6};
  const changed={...bare,meta:{...bare.meta,town_fill:{...bare.meta.town_fill,...values}}}, r=prepareTownFill(changed), unfrayed=prepareTownFill({...changed,meta:{...changed.meta,town_fill:{...changed.meta.town_fill,edgeFray:0}}});
  assert(r.houses.instances.length >= before.houses.instances.length*.95);
  const avenue = value => value.townPlots.filter(p=>p.state==='house'&&p.lane==='avenue').length;
  assert(avenue(r)>=avenue(before));assert.equal(avenue(r),avenue(unfrayed));assert(r.stats.edge.fraction<=.12);
  const homes=r.townPlots.filter(p=>p.state==='house'), neighbourReach=Math.max(changed.meta.town_fill.frontageMax*C.frayNeighbour,C.depth+C.laneWidth);
  for(const p of homes)assert(homes.some(q=>q!==p&&Math.hypot(p.x-q.x,p.z-q.z)<=neighbourReach),'isolated authored plot');
  noOverlap(r, bare.houses.instances.length); assert(sd(angles(r))>sd(angles(before)));
  const terrain=createKamakuraTerrain(bare), old=boxes({houses:bare.houses});
  for(const node of bare.facilities?.nodes||[])if(node.part==='hall'||node.part==='buddha'){const a=node.bbox_min,b=node.bbox_max;old.push({x:node.anchor_xz[0]+(a[0]+b[0])/2,z:node.anchor_xz[1]+(a[2]+b[2])/2,w:b[0]-a[0],d:b[2]-a[2],rotY:0});}
  const graph=movement(terrain,old,boxes(r).slice(bare.houses.instances.length),r.stats.axis,{x:bare.meta.spawn.x,z:-bare.meta.spawn.y});
  assert(graph.reached>1);assert.equal(graph.newTraps,0);
  assert(r.stats.houses.added<=C.houseMax);assert(r.stats.lanes.length<=C.laneLengthMax);
  assert(r.stats.work.turnAttempts<=r.stats.work.candidates*(C.kindAttempts+1)*(2*C.turnHalves+2));
  const report=value=>({houses:value.houses.instances.length,added:value.stats.houses.added,yawSD:sd(angles(value)),edgeSD:outline(value),annexes:value.stats.annexes,yards:value.yards.length,edge:value.stats.edge,avenue:avenue(value),work:value.stats.work});
  t.diagnostic(JSON.stringify({authoredBefore:report(before),authoredAfter:report(r),movement:graph,farDraws:1,newDraws:0}));
});

function streets(config = {}) {
  const f = town({ span: 360, reach: 140, config: { reach: 140, outerStart: 130, start: 4, shoreGap: 2, coastSmall: 0,
    frontageMin: 10, frontageMax: 11, laneFirst: 25, laneEvery: 43.2, crossEvery: 300,
    yaw: 9, groupYaw: 8, shift: 1.4, setbackMin: 1, setbackMax: 4.5, bend: 3, bendWave: 70,
    annexRate: .55, edgeFray: .8, yardRate: .6, ...config } });
  f.data.roads.east = { kind: 'local_road', route_id: 'east', width_m: 5, xyz_m: [[0,-25,12],[132,-25,12]] };
  f.data.roads.west = { kind: 'trail', route_id: 'west', width_m: 4, xyz_m: [[0,-85,12],[-132,-85,12]] };
  f.data.roads.north = { kind: 'kaido', route_id: 'north', width_m: 4, xyz_m: [[0,60,12],[132,60,12]] };
  f.terrain.bounds={minX:-140,maxX:140,minZ:-180,maxZ:180};
  return f;
}
function closest(p, paths) {
  let best = null;
  for (const path of paths) for (let i=1;i<path.xyz_m.length;i++) {
    const a=path.xyz_m[i-1], b=path.xyz_m[i], dx=b[0]-a[0], dz=a[1]-b[1], t=Math.max(0,Math.min(1,((p.x-a[0])*dx+(p.z+a[1])*dz)/(dx*dx+dz*dz)));
    const x=a[0]+dx*t,z=-a[1]+dz*t,d=Math.hypot(p.x-x,p.z-z);
    if (!best || d<best.d) best={x,z,d,path};
  }
  return best;
}
function frontageSafety(f, r, start) {
  const b=boxes(r), paths=[...Object.values(f.data.roads),...Object.values(r.lanes)];
  for(let i=start;i<b.length;i++) {
    const house=b[i],item=r.houses.instances[i],face=r.stats.front.axis[item.kind],local=face==='+x'?[1,0]:face==='-x'?[-1,0]:face==='+z'?[0,1]:[0,-1];
    const fx=item.matrix[0]*local[0]+item.matrix[8]*local[1],fz=item.matrix[2]*local[0]+item.matrix[10]*local[1],plot=r.townPlots.find(p=>p.house===item.id), source=plot.lane==='avenue'?Object.values(f.data.roads).filter(p=>p.kind==='local_road'&&p.width_m===r.stats.axis.width):plot.lane.startsWith('road:')?Object.entries(f.data.roads).filter(([id])=>id.replace(/:\d+$/,'')===plot.lane.slice(5).replace(/:\d+$/,'')).map(([,p])=>p):[r.lanes[plot.lane]],near=closest(house,source);
    assert((fx*(near.x-house.x)+fz*(near.z-house.z))/(Math.hypot(fx,fz)*near.d)>Math.cos((C.yaw+20)*Math.PI/180),'door faces its street');
    // A swept line from the frontage to the house must be free: rear-only scraps are not frontages.
    for(let j=0;j<b.length;j++) if(j!==i) {
      assert(!townBoxesOverlap(house,b[j],C.houseGap-1e-7),'house clearance');
      assert(!houseIntersects(b[j],{x:near.x,z:near.z},{x:house.x,z:house.z},.3),'blocked door path');
    }
    for(const p of paths) for(let j=1;j<p.xyz_m.length;j++) assert(!houseIntersects(house,{x:p.xyz_m[j-1][0],z:-p.xyz_m[j-1][1]},{x:p.xyz_m[j][0],z:-p.xyz_m[j][1]},p.width_m/2),'house crosses a street');
  }
}
test('road and infill fields are opt-in, validated, and preserve every prior transform', () => {
  const f=streets(), before=fill(f); f.data.meta.town_fill.roadPlots=0; f.data.meta.town_fill.infillRate=0;
  assert.deepEqual(fill(f),before);
  for(const name of ['roadPlots','infillRate']) {
    for(const value of [0,1]) assert.equal(townFillConfig({[name]:value})[name],value);
    for(const value of [-.1,1.1,NaN,Infinity,null,'1']) assert.throws(()=>townFillConfig({[name]:value}));
  }
  assert.throws(()=>townFillConfig({roadPlots:.5}));
  const after=fill(streets({roadPlots:1,infillRate:.8}));
  assert.deepEqual(after.houses.instances.slice(0,before.houses.instances.length),before.houses.instances);
});
test('existing local roads, trails and highways gain deterministic safe frontages on both banks', () => {
  const f=streets({roadPlots:1}),r=fill(f),before=fill(streets());
  assert(r.stats.supplemental.roadHouses>0); noOverlap(r);
  for(const id of ['east','west','north']) {
    const plots=r.townPlots.filter(p=>p.lane==='road:'+id); assert(plots.length>0,id+' has houses');
    assert(plots.some(p=>p.z<-f.data.roads[id].xyz_m[0][1])); assert(plots.some(p=>p.z>-f.data.roads[id].xyz_m[0][1]));
  }
  frontageSafety(f,r,before.houses.instances.length); assert.deepEqual(fill(f),r);
});
test('gap houses increase roof coverage and street density while retaining avenues and return paths', t => {
  const f=streets({roadPlots:1,infillRate:.8}),r=fill(f),before=fill(streets());
  const roof=value=>boxes(value).reduce((n,b)=>n+b.w*b.d,0),avenue=value=>value.townPlots.filter(p=>p.lane==='avenue'&&p.state==='house'&&!p.source);
  assert(r.stats.supplemental.infill>0); assert(r.houses.instances.length>=before.houses.instances.length*1.25);
  assert(roof(r)>=roof(before)*1.25);assert.deepEqual(avenue(r),avenue(before));
  const sideStreets=Object.values(f.data.roads).slice(1,3);
  assert(boxes(r).filter(b=>{const n=closest(b,sideStreets);return n.d<=15+n.path.width_m/2;}).length>=14);
  frontageSafety(f,r,before.houses.instances.length);noOverlap(r);
  assert.deepEqual(fill(f),r);const graph=movement(f.terrain,[],boxes(r),r.stats.axis,{x:0,z:0});
  assert(graph.reached>1);assert.equal(graph.newTraps,0);
  assert(r.stats.lanes.length+r.stats.supplemental.scanned<=C.laneLengthMax);assert(r.stats.houses.added<=C.houseMax);
  t.diagnostic(JSON.stringify({before:before.houses.instances.length,after:r.houses.instances.length,roofRatio:roof(r)/roof(before),supplemental:r.stats.supplemental,movement:graph,work:r.stats.work}));
});

test('supplemental frontages leave rivers, facilities and the full bridge approach clear', () => {
  const f=streets({roadPlots:1,infillRate:1}), inside=f.terrain.insideA;
  f.data.rivers={rivers:[{id:'invented-river',xy_m:[[100,180],[100,-180]],width_m:[6,6],water_elev_m:[9,9]}]};
  f.terrain.groundAt=(x,z)=>!inside(x,z)||Math.abs(x-100)<=11?'water':null;
  f.terrain.heightAt=x=>Math.abs(x-100)<13?9:12;
  f.data.facilities.nodes=[{part:'hall',anchor_xz:[-65,70],bbox_min:[-6,0,-5],bbox_max:[6,8,5]}];
  const without=prepareTownFill({...f.data,meta:{...f.data.meta,town_fill:{...f.data.meta.town_fill,roadPlots:0,infillRate:0}}},{terrain:f.terrain}),r=fill(f);
  const added=boxes(r).slice(without.houses.instances.length);
  assert(added.length>0);assert(r.stats.supplemental.rejected.bridge>0);assert(r.stats.supplemental.rejected.water>0);
  for(const b of added) {
    assert(!townBoxesOverlap(b,{x:-65,z:70,w:12,d:10,rotY:0},C.facilityGap-1e-7));
    for(const z of [25,-60]) assert(!townBoxesOverlap(b,{x:100,z,w:42,d:19,rotY:0}),'bridge and approaches');
    const c=Math.cos(b.rotY),s=Math.sin(b.rotY);
    for(let u=-b.w/2;u<=b.w/2;u+=1) for(let v=-b.d/2;v<=b.d/2;v+=1) assert.equal(f.terrain.groundAt(b.x+c*u+s*v,b.z-s*u+c*v),null);
  }
});

test('light quality and large supplemental scans retain the existing hard work and geometry budgets', () => {
  const f=streets({roadPlots:1,infillRate:1}),r=fill(f),light=prepareTownFill(f.data,{terrain:f.terrain,search:'?q=light'});
  assert(light.houses.instances.length<r.houses.instances.length);
  f.data.roads.remote={kind:'trail',width_m:3,xyz_m:[[5000,0,0],[5000,200000,0]]};
  const huge=fill(f);
  assert(huge.stats.supplemental.rejected.budget>0);
  assert(huge.stats.supplemental.scanned+huge.stats.lanes.length<=C.laneLengthMax);
  assert(huge.stats.supplemental.axisChecks<=C.laneLengthMax/C.step);
  assert(huge.stats.houses.added<=C.houseMax);assert(huge.stats.work.farTriangles<=HOUSE_FAR.triangles);
});

test('authored street additions retain old transforms, roof coverage and bidirectional movement', {skip:!process.env.KZ_DESIGNED_WORLD_DIR&&'KZ_DESIGNED_WORLD_DIR未設定'}, async t => {
  const bare=await loadKamakura(async url=>{const b=await fs.readFile(path.join(process.env.KZ_DESIGNED_WORLD_DIR,path.basename(url)));return {ok:true,json:async()=>JSON.parse(b),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};},'?townfill=0');
  const values={yaw:9,groupYaw:8,shift:1.4,setbackMin:1,setbackMax:4.5,bend:3,bendWave:70,annexRate:.55,edgeFray:.8,yardRate:.6};
  const data={...bare,meta:{...bare.meta,town_fill:{...bare.meta.town_fill,...values}}},before=prepareTownFill(data);
  const r=prepareTownFill({...data,meta:{...data.meta,town_fill:{...data.meta.town_fill,roadPlots:1,infillRate:.8}}});
  assert.deepEqual(r.houses.instances.slice(0,before.houses.instances.length),before.houses.instances);noOverlap(r,bare.houses.instances.length);
  frontageSafety({data:bare},r,before.houses.instances.length);
  const terrain=createKamakuraTerrain(bare), old=boxes({houses:bare.houses});
  for(const node of bare.facilities?.nodes||[]) if(node.part==='hall'||node.part==='buddha'){const a=node.bbox_min,b=node.bbox_max;old.push({x:node.anchor_xz[0]+(a[0]+b[0])/2,z:node.anchor_xz[1]+(a[2]+b[2])/2,w:b[0]-a[0],d:b[2]-a[2],rotY:0});}
  const graph=movement(terrain,old,boxes(r).slice(bare.houses.instances.length),r.stats.axis,{x:bare.meta.spawn.x,z:-bare.meta.spawn.y});
  assert(graph.reached>1);assert.equal(graph.newTraps,0);
  const c=data.meta.town_fill,axis=r.stats.axis,roof=value=>{const b=boxes(value);let covered=0,total=0;for(let u=-c.reach+.5;u<c.reach;u++)for(let v=.5;v<axis.length;v++){const a=axis.points[0],end=axis.points.at(-1),dx=(end.x-a.x)/axis.length,dz=(end.z-a.z)/axis.length,p={x:a.x+dx*v-dz*u,z:a.z+dz*v+dx*u};total++;if(b.some(h=>houseIntersects(h,p)))covered++;}return {covered,total,share:covered/total};};
  const a=roof(before),b=roof(r);assert(b.share/a.share>=1.25);
  const streets=Object.entries(bare.roads).filter(([id])=>/^(east-upper|west):/.test(id)).map(([,p])=>p);
  const along=boxes(r).filter(h=>{const p=closest(h,streets);return p.d<=15+p.path.width_m/2;}).length;
  t.diagnostic(JSON.stringify({authoredStreetBefore:{houses:before.houses.instances.length,roof:a},authoredStreetAfter:{houses:r.houses.instances.length,roof:b,streetHouses:along,avenue:r.townPlots.filter(p=>p.lane==='avenue'&&p.state==='house'&&!p.source).length,supplemental:r.stats.supplemental,work:r.stats.work},movement:graph,farDraws:1,addedDraws:0}));
});

test('a tiny model cannot turn a scrap smaller than the minimum empty plot into infill', () => {
  const f=streets({roadPlots:0,infillRate:1,houseRate:0,gardenRate:1,burntRate:0,repairRate:0});
  f.data.roads={main:f.data.roads.main};
  for(const k of f.data.houses.kinds.values()) { k.bbox_min=[-.5,-.5,0]; k.bbox_max=[.5,.5,1]; }
  const ground=(edge,length)=>(x,z)=>Math.abs(x)<=8 || x>=8&&x<=edge&&z>=20&&z<=20+length?null:'water';
  f.terrain.groundAt=ground(14,6);assert.equal(fill(f).stats.supplemental.infill,0);
  f.terrain.groundAt=ground(25,30);assert(fill(f).stats.supplemental.infill>0);
});
