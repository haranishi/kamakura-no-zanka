import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { decodeRoads, kamakuraPaths, roadStats, ROAD_POINT_LIMIT } from '../dist/valley/kamakura-roads.js';
import { loadKamakura, updateKamakuraRoadPaths } from '../dist/valley/kamakura-data.js';
import { syntheticWorld } from '../tools/make-synthetic-world.mjs';
import { createPathField, segmentWeight } from '../dist/valley/kamakura-ground-path.js';
const ab = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const road = (width = 14) => ({ route_id: 'invented', name: 'Invented avenue', kind: 'local_road', width_m: width, xyz_m: [[-90,0,0],[90,0,0]] });
const source = r => ({ schema: 'kz-roads/0.1', count: 1, roads: { lane: r } });
function loader(files, calls = []) {
  return async (url, options) => {
    calls.push(url); assert.equal(options.redirect, 'error');
    const b = files.get(url.slice('/world-private/'.length));
    return { ok: !!b, json: async () => JSON.parse(b), arrayBuffer: async () => ab(b) };
  };
}
test('roads validate finite nonoverlapping points, width, kind, schema, count and total point budget', () => {
  const good = decodeRoads(source(road()));
  assert.equal(good.lane.width_m, 14); assert.equal(good.lane.kind, 'local_road');
  for (const mutate of [
    r => r.xyz_m.pop(), r => r.xyz_m[0][0] = NaN, r => r.xyz_m[0][2] = Infinity,
    r => r.width_m = 0, r => r.width_m = 40.1, r => r.width_m = '14',
    r => r.xyz_m[1] = [...r.xyz_m[0]], r => r.kind = 'unknown',
    r => r.xyz_m = Array.from({ length: ROAD_POINT_LIMIT + 1 }, (_, i) => [i,0,0]),
    r => r.xyz_m = [[0,0],[1,0]], r => r.xyz_m = [null,[1,0,0]]
  ]) { const r = road(); mutate(r); assert.throws(() => decodeRoads(source(r))); }
  assert.throws(() => decodeRoads({ ...source(road()), schema: 'other' }));
  assert.throws(() => decodeRoads(source(road()), 2));
  assert.throws(() => decodeRoads({ ...source(road()), count: 2 }));
  const big = road(); big.xyz_m = Array.from({ length: ROAD_POINT_LIMIT / 2 + 1 }, (_, i) => [i,0,0]);
  assert.throws(() => decodeRoads({ schema: 'kz-roads/0.1', count: 2, roads: { a: big, b: big } }));
  for (const width of [1,40]) assert.equal(decodeRoads(source(road(width))).lane.width_m, width);
});
test('optional roads load; missing, unsafe, malformed, failed and disabled roads preserve all other files', async () => {
  const files = syntheticWorld(), meta = JSON.parse(files.get('meta.json')), calls = [];
  const good = await loadKamakura(loader(files, calls), '');
  assert.ok(good.roads); assert.equal(Object.keys(good.roads).length, meta.roads.count);
  const disabled = await loadKamakura(loader(files), '?roads=0');
  for (const mode of ['disabled','missing-meta','missing-file','malformed','metadata','unsafe','schema','bad-count','transport']) {
    const copy = new Map(files), m = structuredClone(meta), requests = [];
    if (mode === 'missing-meta') delete m.roads;
    if (mode === 'missing-file') copy.delete('roads.json');
    if (mode === 'malformed') copy.set('roads.json', Buffer.from('{'));
    if (mode === 'metadata') m.roads.schema = 'wrong';
    if (mode === 'unsafe') m.roads.file = '../roads.json';
    if (mode === 'schema') copy.set('roads.json', Buffer.from(JSON.stringify({ schema:'wrong' })));
    if (mode === 'bad-count') m.roads.count++;
    copy.set('meta.json', Buffer.from(JSON.stringify(m)));
    const fetcher = loader(copy, requests);
    const data = await loadKamakura(mode === 'transport' ? async (...args) => {
      if (args[0].endsWith('/roads.json')) throw Error('unavailable');
      return fetcher(...args);
    } : fetcher, mode === 'disabled' ? '?roads=0' : '');
    assert.equal(data.roads, null, mode);
    for (const key of ['heights','walk','ground','surface']) assert.deepEqual(data[key], disabled[key], key);
    assert.equal(data.houses.instances.length, disabled.houses.instances.length);
    assert.equal(data.veg.length, disabled.veg.length); assert.equal(data.rivers.points, disabled.rivers.points);
    assert.deepEqual(data.patches.paths, disabled.patches.paths);
    if (['disabled','missing-meta','metadata','unsafe'].includes(mode)) assert.ok(!requests.some(u => u.endsWith('/roads.json')));
  }
});
test('merging keeps stable references, retains legacy identity and cannot overwrite colliding/prototype ids', () => {
  const old = { 'road:lane': road(4), '__proto__': road(2) };
  const legacy = { patches: { paths: old }, roads: null };
  assert.equal(kamakuraPaths(legacy), old); assert.equal(kamakuraPaths({}), undefined);
  const roads = decodeRoads(source(road())), data = { patches: { paths: old }, roads };
  const merged = kamakuraPaths(data);
  assert.equal(kamakuraPaths(data), merged); assert.equal(merged['road:lane'], old['road:lane']);
  assert.equal(merged['road:road:lane'], roads.lane); assert.equal(Object.keys(old).length, 1);
  const hostile = decodeRoads(JSON.parse('{"schema":"kz-roads/0.1","count":1,"roads":{"__proto__":'+JSON.stringify(road())+'}}'));
  assert.ok(Object.hasOwn(hostile, '__proto__'));
  assert.ok(Object.hasOwn(kamakuraPaths({ roads: hostile }), 'road:__proto__'));
});
test('packed earth shares widths and existing irregular edges without any new shader', () => {
  for (const width of [2.8,4,14]) {
    const data = { roads: { lane: road(width) } }, paths = kamakuraPaths(data), field = createPathField();
    assert.ok(field.update({ x: 0, z: 0 }, paths));
    assert.equal(field.update({ x: 0, z: 0 }, kamakuraPaths(data)), false);
    assert.equal(segmentWeight({ x:-90,z:0,dx:180,dz:0,r:width/2 }, 0, 0), 1);
    assert.equal(segmentWeight({ x:-90,z:0,dx:180,dz:0,r:width/2 }, 0, width/2+.1), 0);
    assert.equal(field.at(0,width/2+2), 0);
  }
  const s = { x:-90,z:0,dx:180,dz:0,r:7 };
  const weights = Array.from({ length: 81 }, (_, i) => segmentWeight(s, i*2-80, 7-1.5));
  const mean = weights.reduce((a,b)=>a+b)/weights.length;
  const deviation = Math.sqrt(weights.reduce((a,b)=>a+(b-mean)**2,0)/weights.length);
  assert.ok(deviation > .02, `wide road edge deviation ${deviation}`);
  console.log(JSON.stringify({ wideEdgeMin:Math.min(...weights), wideEdgeMax:Math.max(...weights), wideEdgeStd:deviation }));
});
test('debug nearest reports original ids and southward coordinates, follows live viewpoint, and stays opt in', () => {
  const previous = globalThis.__kzRoads;
  try {
    delete globalThis.__kzRoads;
    const data = { roads: { lane: { ...road(), xyz_m:[[0,20,0],[20,20,0]] } } };
    const pos = { x:10,z:-23 };
    updateKamakuraRoadPaths(data, pos, undefined, '');
    assert.equal(globalThis.__kzRoads, undefined);
    assert.equal(roadStats(data,pos).nearest.distance,3);
    const debugData = { roads: data.roads };
    updateKamakuraRoadPaths(debugData,pos,undefined,'?debug=1');
    assert.deepEqual(globalThis.__kzRoads(),{ loaded:true,count:1,nearest:{id:'lane',kind:'local_road',distance:3} });
    updateKamakuraRoadPaths(debugData,{x:10,z:-28},undefined,'?debug=1');
    assert.equal(globalThis.__kzRoads().nearest.distance,8);
    assert.deepEqual(roadStats({roads:null},pos),{loaded:false,count:0,nearest:null});
  } finally { if (previous === undefined) delete globalThis.__kzRoads; else globalThis.__kzRoads = previous; }
});
test('synthetic startup includes deterministic wide/narrow routes below the total 8 MB limit', async () => {
  const a = syntheticWorld(), b = syntheticWorld();
  for (const [name, bytes] of a) assert.ok(bytes.equals(b.get(name)), name);
  const data = await loadKamakura(loader(a), '');
  const widths = Object.values(data.roads).map(r=>r.width_m).sort((a,b)=>a-b);
  assert.deepEqual(widths,[2.8,4,14]);
  const bytes = [...a.values()].reduce((sum,b)=>sum+b.length,0);
  assert.ok(bytes < 8_000_000); console.log(JSON.stringify({ syntheticBytes:bytes }));
});
test('all runtime consumers share merged paths; spawn keeps only original pass paths', async () => {
  const world = await fs.readFile(new URL('../dist/valley/world-kamakura.js',import.meta.url),'utf8');
  assert.equal((world.match(/paths: kamakuraPaths\(data\)/g)||[]).length,2);
  assert.ok(world.includes('updateKamakuraRoadPaths(data, camera.position, groundPathFor(data), search)'));
  const grass = await fs.readFile(new URL('../dist/valley/kamakura-grass-view.js',import.meta.url),'utf8');
  assert.ok(grass.includes('const paths = kamakuraPaths(data) || {};'));
  const ground = await fs.readFile(new URL('../dist/valley/kamakura-ground-tone.js',import.meta.url),'utf8');
  assert.ok(ground.includes('kamakuraPaths(data)!=null'));
  const spawn = await fs.readFile(new URL('../dist/valley/kamakura-spawn.js',import.meta.url),'utf8');
  assert.ok(!spawn.includes('kamakuraPaths'));
});
test('explicit private world loads optional roads without copying private values into fixtures or output', async t => {
  if (!process.env.KZ_WORLD_DIR) { t.skip('No explicit private world'); return; }
  const { join, basename } = await import('node:path');
  const data = await loadKamakura(async url => {
    const b = await fs.readFile(join(process.env.KZ_WORLD_DIR, basename(url)));
    return { ok:true,json:async()=>JSON.parse(b),arrayBuffer:async()=>ab(b) };
  }, '');
  if (data.meta.roads) assert.ok(data.roads);
  else assert.equal(data.roads, null);
});
