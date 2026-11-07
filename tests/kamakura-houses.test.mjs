import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeHouses, houseBounds, houseBodyBounds, houseMatrix, houseFit, houseFootprintHeights, HOUSE_BURY_TOLERANCE, houseBox, houseChunks, houseChunkDistance, houseLOD, houseIntersects } from '../dist/valley/kamakura-houses.js';
import { loadKamakura } from '../dist/valley/kamakura-data.js';
import { buildColliders, moveActor } from '../dist/valley/collision.js';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { readPrivateData } from '../tools/lib/kamakura-validation.mjs';
import { readPrivateHouses, verifyHouses } from '../tools/lib/kamakura-house-validation.mjs';
const kind = { index: 0, node: 'test-house', bbox_min: [-2, -3, -1.5], bbox_max: [4, 5, 6], triangles: 40 };
const matrix = [0,0,-2,0, 0,3,0,0, 4,0,0,0, 10,999,20,1];
const catalog = { count: 1, kinds: [kind], count_by_kind: { 'test-house': 1 } };
function binary() { const b = new ArrayBuffer(68), d = new DataView(b); d.setFloat32(0, 0, true); matrix.forEach((v,i) => d.setFloat32(4 + i*4, v, true)); return b; }
test('house LE matrices validate kinds, counts, finite affine yaw/scales and forbidden gate kinds', () => {
  const h = decodeHouses(catalog, binary()); assert.deepEqual(h.instances[0].matrix, matrix);
  assert.throws(() => decodeHouses({ ...catalog, count: 2 }, binary()));
  assert.throws(() => decodeHouses({ ...catalog, count_by_kind: {} }, binary()));
  for (const [offset, value] of [[0,9],[0,.5],[8,NaN],[56,Infinity],[16,1],[4,-1]]) {
    const b = binary(); new DataView(b).setFloat32(offset, value, true); assert.throws(() => decodeHouses(catalog,b));
  }
  const gate = { ...kind, node: 'k14_gate' };
  assert.throws(() => decodeHouses({ ...catalog, kinds: [gate], count_by_kind: { k14_gate: 1 } }, binary()));
});
test('Blender bbox and known nonuniform 90 degree matrix produce offset rotated body and ground datum', () => {
  assert.deepEqual(houseBounds(kind), { min: [-2,-1.5,-5], max: [4,6,3] });
  const b = houseBox(kind, matrix);
  assert.deepEqual(b, { x: 6, z: 18, w: 12, d: 32, height: 18, rotY: Math.PI/2 });
  const item = { matrix }, terrain = { heightAt: (x,z) => x + z };
  const m = houseMatrix(item, terrain); assert.equal(m[13],30); assert.equal(matrix[13],999);
  assert.deepEqual(m.filter((_,i) => i !== 13), matrix.filter((_,i) => i !== 13));
  assert(houseIntersects(b, { x: 6, z: 18 }));
  assert(houseIntersects(b, { x: -30,z:18 }, { x:40,z:18 }));
  assert(!houseIntersects(b, { x:0,z:30 }, { x:20,z:30 }));
});
test('foundation bottom ring excludes eaves; its box blocks swept movement through existing grid', () => {
  const body = houseBodyBounds([-1,-1.5,-2, 1,-1.5,-2, 1,-1.5,2, -1,-1.5,2, -4,4,-5, 4,4,5]);
  assert.deepEqual(body, { min: [-1,-1.5,-2], max: [1,-1.5,2] });
  const box = houseBox(kind, matrix, body), bounds = { minX:-100,maxX:100,minZ:-100,maxZ:100 };
  const col = buildColliders({ bounds, extraBoxes: [box] });
  const terrain = { bounds, heightAt:()=>10, slopeAt:()=>0, waterAt:()=>0 };
  const p = moveActor(col, terrain, { x:10,y:10,z:30 }, 0,-20,.3);
  assert.equal(p.blocked,'wall'); assert(p.z >= 22.3 - 1e-5);
});
test('slope fit: flat ground sits on the datum; the skirt never leaves a gap; burial is limited when it can be', () => {
  const body = { min: [-3, -1.5, -7], max: [3, 0, 7] }, m = [1,0,0,0, 0,1,0,0, 0,0,1,0, 100,999,200,1];
  const flat = houseFit(m, body, { heightAt: () => 12 });
  assert.equal(flat.y, 12); assert(flat.feasible);
  // A plane rising to the east: 0.1 m of rise per metre across the 6 m width is a 0.6 m span (inside tolerance).
  const gentle = { heightAt: x => 0.1 * (x - 100) + 50 }, g = houseFit(m, body, gentle);
  const gd = houseFootprintHeights(m, body, gentle, .1);
  assert(g.feasible); assert(g.y + body.min[1] - gd.low < 0, 'skirt bottom is below the lowest ground');
  assert(gd.high - g.y <= HOUSE_BURY_TOLERANCE + 1e-9, 'hill covers the wall base by no more than the tolerance');
  // Steep ground: 0.5 m of rise per metre is a 3 m span. No gap is the priority, burial is what is left.
  const steep = { heightAt: x => 0.5 * (x - 100) + 50 }, st = houseFit(m, body, steep);
  const sd = houseFootprintHeights(m, body, steep, .1);
  assert(!st.feasible); assert(st.y + body.min[1] - sd.low < 0, 'steep: still no gap');
  assert(sd.high - st.y > HOUSE_BURY_TOLERANCE, 'steep: burial exceeds the tolerance and is reported by the caller');
  // Vertical scale of the instance matrix scales the skirt depth: a 2x tall house reaches 3 m under its datum.
  const tall = m.slice(); tall[5] = 2;
  const t = houseFit(tall, body, steep);
  assert(t.bottom === -3); assert(t.y > st.y, 'a longer skirt allows the datum to stand higher');
});
test('slope fit follows the rotated footprint through the instance matrix, not the axis box', () => {
  // 90 degree yaw: the long local z axis lies along world x. Ground rises with world x only.
  const body = { min: [-1, -1.5, -5], max: [1, 0, 5] }, m = [0,0,-1,0, 0,1,0,0, 1,0,0,0, 0,0,0,1];
  const g = houseFootprintHeights(m, body, { heightAt: x => x }, .5);
  assert(Math.abs(g.low - -5) < 1e-9 && Math.abs(g.high - 5) < 1e-9, 'span is along world x (the long side), not the 2 m side');
});
test('house chunks handle negative coordinates and three LOD hysteresis thresholds', () => {
  const houses = { instances: [{ matrix }, { matrix: matrix.map((v,i) => i === 12 ? -1 : v) }] };
  const chunks = houseChunks(houses); assert.equal(chunks.length,2);
  assert.equal(houseChunkDistance(chunks[0], { x:10,z:20 }),0);
  assert.equal(houseLOD(350),1); assert.equal(houseLOD(350,0),0); assert.equal(houseLOD(350,1),1);
  assert.equal(houseLOD(300,1),0); assert.equal(houseLOD(1000,1),1); assert.equal(houseLOD(1000,2),2);
  assert.equal(houseLOD(900,2),1); assert.equal(houseLOD(1200,0),2);
});
test('optional house loader failure keeps terrain usable and never follows metadata URLs', async () => {
  const f = fixture(); f.meta.schema = 'kz-world-web/0.4';
  f.meta.houses = { file:'houses.json',instances:'houses_f32.bin',kit:'houses_kit.glb' };
  const calls = [];
  const fetcher = async url => {
    calls.push(url);
    return { ok: true, json: async () => url.endsWith('meta.json') ? f.meta : catalog,
      arrayBuffer: async () => url.endsWith('height_u16.bin') ? f.heights.buffer : url.endsWith('walk_u8.bin') ? f.walk.buffer : url.endsWith('houses_f32.bin') ? binary() : new ArrayBuffer(0) };
  };
  const data = await loadKamakura(fetcher); assert.equal(data.houses.instances.length,1); assert.equal(calls.length,6);
  const failed = await loadKamakura(async url => url.endsWith('houses.json') ? { ok:false } : fetcher(url));
  assert.equal(failed.houses,null); assert(failed.houseNotice); assert.equal(failed.heights.length,f.heights.length);
  f.meta.houses.kit = 'https://invalid.example/kit.glb'; calls.length = 0;
  const unsafe = await loadKamakura(fetcher); assert.equal(unsafe.houses,null); assert.equal(calls.length,3);
});
test('private v0.4 counts, all ground datums, kit bodies, polygon count and spawn/path overlaps',
  { skip: !process.env.KZ_WORLD_DIR && 'KZ_WORLD_DIR未設定：私有の家データが必要' }, async t => {
    const { data } = await readPrivateData(process.env.KZ_WORLD_DIR), input = await readPrivateHouses(process.env.KZ_WORLD_DIR, data);
    if (!input) { t.skip('meta.houses がない旧版：家なし互換'); return; }
    const report = verifyHouses(data, input);
    // Full positions are emitted only by the CLI, never in persisted test snapshots.
    t.diagnostic(JSON.stringify({ count:report.count, insideA:report.insideA, spawnOverlaps:report.overlaps.spawn.length,
      pathOverlaps:report.overlaps.paths.length, draw:report.spawnDrawUpperBound }));
    assert(report.foundationAccepted, '家の裾の底が地面より上に出る家がある。CLIでslopeFitを確認');
    assert(report.accepted, '家の箱が出発点または道と重なる。CLIで件数と位置を確認');
  });

test('real GLTF nodes, instancing budget, atomic LOD replacement, distance eviction and disposal without browser', async () => {
  const { THREE, loadHouseView } = await import('./helpers/kamakura-house-view.mjs');
  const { buildGlb } = await import('../tools/lib/glb.mjs');
  const { buildKamakuraHouses } = await loadHouseView();
  const positions = new Float32Array([-1,-1.5,-1, 1,-1.5,-1, 1,-1.5,1, -1,-1.5,1, 0,3,0]);
  const bin = Buffer.from(positions.buffer);
  const json = { asset:{version:'2.0'}, scenes:[{nodes:[0]}],scene:0,nodes:[{name:'test-house.001',mesh:0}],
    buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:bin.length}],
    accessors:[{bufferView:0,componentType:5126,count:5,type:'VEC3',min:[-1,-1.5,-1],max:[1,3,1]}],
    meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.2,.3,.1,1]}}] };
  const kit = buildGlb({json,bin}), instances = [];
  for (const [x,z] of [[20,20],[270,20],[20,270],[270,270]]) {
    instances.push({id:instances.length,kind:0,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,x,999,z,1]});
  }
  const houses = {catalog:{count_by_kind:{'test-house':4}},kinds:new Map([[0,kind]]),instances,
    kit:kit.buffer.slice(kit.byteOffset,kit.byteOffset+kit.byteLength)};
  const scene = new THREE.Scene(), terrain = {heightAt:()=>7}, pos={x:200,z:200};
  const field = await buildKamakuraHouses(houses,terrain,scene);
  const meshes = () => {const a=[];scene.traverse(o=>{if(o.isInstancedMesh)a.push(o);});return a;};
  field.update(pos); assert.equal(meshes().length,2); assert(!field.ready(pos));
  field.update(pos); assert(field.ready(pos)); assert.equal(meshes().length,4);
  assert.equal(field.boxes.length,4);
  assert(meshes().every(mesh=>mesh.castShadow && mesh.receiveShadow));
  scene.updateMatrixWorld(true);
  for (const mesh of meshes()) { assert.equal(mesh.matrixAutoUpdate,false); assert.deepEqual(mesh.matrixWorld.elements,new THREE.Matrix4().elements); }
  const m = new THREE.Matrix4(); meshes()[0].getMatrixAt(0,m);assert.equal(m.elements[13],7);
  // Mid detail is built hidden, then replaces near detail as one complete group.
  field.update({x:-600,z:200});
  for (let i=0;i<20;i++)field.update({x:-600,z:200});
  assert(meshes().every(mesh=>mesh.parent.visible));
  assert(meshes().every(mesh=>mesh.castShadow && mesh.receiveShadow));
  const disposed=[];for(const mesh of meshes())mesh.addEventListener('dispose',()=>disposed.push(mesh));
  field.update({x:1e6,z:1e6});assert.equal(scene.children.length,0);assert(disposed.length>0);
  for(let i=0;i<10;i++)field.update(pos);assert(field.ready(pos));field.dispose();assert.equal(scene.children.length,0);
  houses.kinds.set(0,{...kind,node:'missing'});await assert.rejects(buildKamakuraHouses(houses,terrain,scene));assert.equal(scene.children.length,0);
});
