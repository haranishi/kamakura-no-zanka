import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TOWN_FILL as C, TOWN_FILL_FIELDS, townFillConfig, prepareTownFill, townBoxesOverlap } from '../dist/valley/kamakura-town-fill.js';
import { houseBox, houseIntersects } from '../dist/valley/kamakura-houses.js';
import { prepareTownDress } from '../dist/valley/kamakura-town-dress.js';
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
