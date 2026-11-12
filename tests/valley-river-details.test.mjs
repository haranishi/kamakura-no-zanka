import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.min.js';
import { WORLD } from '../dist/valley/world-data.js';
import { createTerrain } from '../dist/valley/terrain-height.js';
import { scatterTrees } from '../dist/valley/scatter.js';
import { RIVER_ART as A, riverLayout, riverFlags, riverBudget, inBridge, riverSamples, riverPoint, fortClearing, foamPhase, foamDistanceOpacity } from '../dist/valley/river-rocks.js';
const source = fs.readFileSync(new URL('../dist/valley/water.js', import.meta.url), 'utf8');
const code = source.replace("from 'three'", `from '${new URL('../dist/vendor/three.module.min.js', import.meta.url)}'`).replace("from './river-rocks.js'", `from '${new URL('../dist/valley/river-rocks.js', import.meta.url)}'`);
const { buildRiverDetails, buildWater, RIVER_LOOK: C, riverAdaptLevel, riverGroundHeight } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const terrain = createTerrain(WORLD), layout = riverLayout(WORLD, terrain), camera = { position: { x: -50, z: 110 } };
const triangles = m => (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : 1);
const actualTriangles = group => group.children.reduce((n, m) => n + Math.min(m.geometry.drawRange.count / 3, triangles(m)), 0);
const fixture = search => buildRiverDetails({ world: WORLD, terrain, search });

test('川の配置は決定的で、大岩40・小石220・内側の河原5・瀬7を既存の川と岸に置く', () => {
  assert.deepEqual(riverLayout(WORLD, terrain), layout);
  assert.equal(layout.rocks.filter(r => r.kind === 'large').length, 40);
  assert.equal(layout.rocks.filter(r => r.kind === 'small').length, 220);
  assert.equal(layout.shoals.length, 5); assert.equal(layout.foam.filter(f => f.kind === 'rapid').length, 7);
  assert.notDeepEqual(riverLayout({ ...WORLD, seed: WORLD.seed + 1 }, terrain).rocks, layout.rocks);
  for (const r of layout.rocks) {
    const [lo, hi] = r.kind === 'large' ? [1.5, 4] : [0.4, 1.2];
    assert(r.size >= lo && r.size <= hi);
    assert(terrain.riverInfo(r.x, r.z).d + r.size / 2 <= WORLD.river.halfWidth + WORLD.river.bankWidth);
    assert(!inBridge(WORLD, r.x, r.z, r.size / 2));
    const road = terrain.roadInfo(r.x, r.z); assert(!road || road.dist > r.size / 2 + A.roadClear);
    if (r.wet) assert(r.y + r.height > terrain.waterLevelAt(r.x, r.z));
    else assert(r.y < terrain.heightAt(r.x, r.z));
  }
  const samples = riverSamples(terrain);
  for (const s of layout.shoals) {
    assert(terrain.riverInfo(s.x, s.z).d > WORLD.river.halfWidth);
    const a = riverPoint(samples, s.along - 6), b = riverPoint(samples, s.along), c = riverPoint(samples, s.along + 6);
    const turn = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    assert(Math.sign(turn) === Math.sign(s.offset));
    assert(!inBridge(WORLD, s.x, s.z, s.length / 2));
  }
});

test('泡は岩の下流に始まり、全瀬が川幅を覆い、模様が下流へ動き、遠景の濃さが残る', () => {
  for (const f of layout.foam) {
    if (f.kind === 'wake') { const r = layout.rocks[f.rock]; assert(r.wet); assert(f.along >= r.along + r.size / 2); assert.equal(f.offset, r.offset); assert(f.length >= 2 && f.length <= 8); }
    else { assert.equal(f.width, WORLD.river.halfWidth * 2); assert(f.length >= 8 && f.length <= 20); }
  }
  for (const time of [0, 1, 17, 1000]) assert(Math.abs(foamPhase(42 + A.foamSpeed, time + 1) - foamPhase(42, time)) < 1e-10);
  for (const distance of [0, 200, 450, 1000]) assert(foamDistanceOpacity(distance) >= 0.6);
  const layer = fixture(''); layer.select({ position: { x: 10000, z: 10000 } }, 'light', 3);
  assert.equal(layer.stats().largeRocks, 40); assert.equal(layer.stats().rapids, 7);
  layer.update(2); assert.equal(layer.group.getObjectByName('river-foam').material.alphaMap.offset.y, foamPhase(0, 2)); layer.dispose();
});

test('橋の門柱と柵と旗は橋の外。道は幅3.5mの柱間を通り、歩ける範囲へ装飾を足さない', () => {
  const gates = layout.gates.filter(g => g.group === 'gate'); assert.equal(gates.length, 2);
  const banners = layout.banners.filter(b => b.group === 'gate'); assert.equal(banners.length, 4);
  for (const g of gates) {
    assert.equal(g.opening, 3.5); assert(g.height >= 3.2 && g.height <= 3.8);
    for (const side of [-1, 1]) {
      const half = (g.opening + A.gatePost) / 2;
      const x = g.x + g.acrossX * half * side, z = g.z + g.acrossZ * half * side;
      assert(!inBridge(WORLD, x, z, A.gatePost / 2));
      assert(x - A.gatePost / 2 > WORLD.bounds.maxX);
      assert(Math.abs((x - g.x) * g.acrossX + (z - g.z) * g.acrossZ) - A.gatePost / 2 >= g.opening / 2 - 1e-9);
    }
  }
  for (const f of layout.fences.filter(f => f.group === 'gate')) {
    assert(f.height >= 1.8 && f.height <= 2.2); assert(Math.abs(Math.hypot(f.to.x - f.from.x, f.to.z - f.from.z) - 9) < 1e-8);
    for (let i = 0; i <= 20; i++) { const x = f.from.x + (f.to.x - f.from.x) * i / 20, z = f.from.z + (f.to.z - f.from.z) * i / 20; assert(x - A.fenceRadius > WORLD.bounds.maxX); assert(!inBridge(WORLD, x, z, A.fenceRadius)); const road = terrain.roadInfo(x, z); assert(!road || road.dist > A.fenceRadius); }
  }
  for (const b of banners) { assert(b.height >= 3.5 && b.height <= 4.5); assert(!inBridge(WORLD, b.x, b.z, A.bannerPole)); }
});

test('砦の輪は門だけ開き、櫓と小屋が輪の中に入り、既存の木の除外半径だけを使う', () => {
  const f = WORLD.distant.find(d => d.kind === 'fort'), ring = layout.fences.filter(d => d.group === 'fort');
  for (let i = 1; i < ring.length; i++) assert.deepEqual(ring[i - 1].to, ring[i].from);
  assert(Math.hypot(ring[0].from.x - ring.at(-1).to.x, ring[0].from.z - ring.at(-1).to.z) >= A.fortGateOpening);
  for (const s of ring) for (const p of [s.from, s.to]) assert(Math.abs(Math.hypot(p.x - f.x, p.z - f.z) - A.fortDiameter / 2) < 1e-8);
  for (const p of [...layout.towers, ...layout.huts]) assert(Math.hypot(p.x - f.x, p.z - f.z) + p.width * 0.85 < A.fortDiameter / 2);
  for (const p of [...layout.towers, ...layout.huts]) assert(Math.hypot(p.x - f.x, p.z - f.z) - p.width / 2 > 31.06 * A.fortModelScale);
  // 砦は見渡しから約 470m 先にあるので、やぐらと幟は、遠くから読める大きめの寸法にしてある（実寸の 9m・8 本では、数画素だった）。
  assert.equal(layout.towers[0].height, A.towerHeight); assert(A.towerHeight >= 9 && A.towerHeight <= 16); assert.equal(layout.huts.length, 3);
  assert.equal(layout.banners.filter(b => b.group === 'fort').length, A.fortBanners); assert(A.fortBanners >= 8 && A.fortBanners <= 12);
  const clearing = fortClearing(WORLD); assert(clearing.radius >= 45 && clearing.radius <= 70);
  const trees = scatterTrees(WORLD, terrain);
  for (let i = 0; i < trees.x.length; i++) assert(Math.hypot(trees.x[i] - clearing.x, trees.z[i] - clearing.z) >= clearing.radius);
  for (const p of [WORLD.start, ...WORLD.buildings, ...Object.values(WORLD.roads).flatMap(r => r.points.map(([x, z]) => ({ x, z })))]) assert(Math.hypot(p.x - clearing.x, p.z - clearing.z) > clearing.radius);
  assert(layout.path.every(p => Math.hypot(p.x - clearing.x, p.z - clearing.z) < WORLD.peaks[0].r));
});

test('旗3種で担当の追加物だけを止め、すべて切ると追加描画0。確認色は分類どおり', () => {
  for (const [search, omitted] of [['?river2=0', ['rocks', 'foam', 'shoals']], ['?gate=0', ['gate']], ['?fort2=0', ['fort']]]) {
    const l = fixture(search), d = l.layout;
    for (const name of omitted) {
      if (Array.isArray(d[name])) assert.equal(d[name].length, 0);
      else for (const key of ['gates', 'fences', 'banners', 'huts', 'towers']) assert(d[key].every(v => v.group !== name));
    }
    if (omitted[0] === 'fort') { assert.equal(d.clearing, null); assert.equal(d.path.length, 0); }
    l.dispose();
  }
  const off = fixture('?river2=0&gate=0&fort2=0'); assert.equal(off.group.children.length, 0); assert.equal(off.stats().draws, 0); off.dispose();
  const debug = fixture('?riverdebug=1');
  assert.equal(debug.group.getObjectByName('river-rocks').material.color.getHexString(), '808080');
  assert.equal(debug.group.getObjectByName('river-foam').material.color.getHexString(), 'ffffff');
  for (const [mesh, expected] of [['river-ground', [C.yellow, C.pink]], ['river-timber', [C.brown, C.pink]], ['river-cloth', [C.red, C.pink]]]) {
    const colors = debug.group.getObjectByName(mesh).geometry.attributes.color;
    for (let i = 0; i < colors.count; i++) assert(expected.some(c => { const color = new THREE.Color(c); return Math.abs(color.r - colors.getX(i)) + Math.abs(color.g - colors.getY(i)) + Math.abs(color.b - colors.getZ(i)) < 1e-6; }));
  }
  debug.dispose();
  assert(fs.readFileSync(new URL('../dist/valley/props.js', import.meta.url), 'utf8').includes('river.update(time)'));
});

test('標準・軽量・自動4段階が5回・各予算以内。描画直前の設定変更と解像度低下に追従する', t => {
  const l = fixture(''), values = [];
  for (const q of ['standard', 'light']) {
    let previous = Infinity;
    for (let adapt = 0; adapt < 4; adapt++) {
      l.select(camera, q, adapt); const s = l.stats();
      assert.equal(s.draws, 5); assert.equal(s.triangles, actualTriangles(l.group)); assert(s.triangles <= (q === 'light' ? 40000 : 100000)); assert(s.triangles <= previous); previous = s.triangles;
      assert.equal(s.largeRocks, 40); assert.equal(s.rapids, 7); values.push({ q, adapt, rocks: s.rocks, foam: s.foam, triangles: s.triangles, draws: s.draws });
    }
  }
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  try {
    globalThis.document = { getElementById: () => ({ value: 'light' }) };
    const m = l.group.children[0]; m.onBeforeRender({ getPixelRatio: () => 1 }, null, camera); assert.equal(l.stats().quality, 'light');
    globalThis.window = { __valley: { game: { post: { quality: 'standard' } } } };
    m.onBeforeRender({ getPixelRatio: () => 0.58 }, null, camera); assert.equal(l.stats().quality, 'standard'); assert.equal(l.stats().adapt, 3);
  } finally { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; }
  for (const [i, scale] of A.adaptScales.entries()) assert.equal(riverAdaptLevel({ getPixelRatio: () => scale }, 'standard', new URLSearchParams('w=1280')), i);
  for (const m of l.group.children) { assert(!m.castShadow); assert.equal(m.frustumCulled, false); for (const a of Object.values(m.geometry.attributes)) for (const n of a.array) assert(Number.isFinite(n)); }
  t.diagnostic(JSON.stringify(values)); l.dispose();
});

test('水面の既存形と色は維持。1000更新で資源・配列が同一、布の上辺は固定して裾だけ揺れる', () => {
  const water = buildWater({ world: WORLD, terrain }); assert.equal(water.mesh.material.color.getHex(), 0x23565c); assert.equal(water.mesh.geometry.index.count / 3, (terrain.riverLine.length - 1) * 2);
  const l = fixture(''), meshes = l.group.children, resources = meshes.map(m => [m.geometry, m.material, ...Object.values(m.geometry.attributes).map(a => a.array)]), cloth = meshes.find(m => m.name === 'river-cloth'), base = cloth.geometry.attributes.position.array.slice();
  const matrix = meshes.find(m => m.isInstancedMesh).instanceMatrix;
  l.select(camera); const version = matrix.version;
  for (let i = 0; i < 1000; i++) { l.update(i / 60); l.select(camera); }
  assert.equal(matrix.version, version);
  assert.notDeepEqual(cloth.geometry.attributes.position.array, base);
  for (const b of l.layout.banners) {
    const top = terrain.heightAt(b.x, b.z) + b.height;
    for (let i = 0; i < base.length; i += 3) if (Math.abs(base[i + 1] - top) < 1e-5 && Math.abs(base[i + 2] - b.z) < 1e-5) assert(Math.abs(cloth.geometry.attributes.position.getZ(i / 3) - b.z) < 1e-4);
  }
  meshes.forEach((m, i) => assert.deepEqual([m.geometry, m.material, ...Object.values(m.geometry.attributes).map(a => a.array)], resources[i]));
  const rock = l.group.getObjectByName('river-rocks'); rock.geometry.computeBoundingBox(); const b = rock.geometry.boundingBox; assert(Math.max(b.max.x - b.min.x, b.max.z - b.min.z) <= 1.00001);
  l.dispose(); water.mesh.geometry.dispose(); water.mesh.material.dispose();
});

test('砦の色の面は既存の遠景格子三角形に沿い、地形を変えない', () => {
  const x = 263.2, z = -141.2, h = terrain.heightAt(x, z); assert(Number.isFinite(riverGroundHeight(terrain, x, z))); assert.equal(terrain.heightAt(x, z), h);
  const step = C.farGrid;
  for (let x = 216; x <= 312; x += step) for (let z = -192; z <= -88; z += step) assert(Math.abs(riverGroundHeight(terrain, x, z) - terrain.heightAt(x, z)) < 1e-8);
  assert.equal(riverFlags('?river2=0').river, false); assert(riverBudget('light', 3).fraction < riverBudget('standard', 0).fraction);
});

test('砦の模型は外周の主建物に収まり、fort2=0で元の模型の位置・向き・寸法へ戻る', async () => {
  const { loadView } = await import('./helpers/valley-view-modules.mjs');
  const { buildProps } = await loadView('props.js');
  const model = new THREE.Group(); model.name = 'original-fort'; model.add(new THREE.Mesh(new THREE.BoxGeometry(1.89, 1.036, 1.668), new THREE.MeshStandardMaterial()));
  const world = { ...WORLD, props: [], dress: [] }, def = WORLD.distant.find(d => d.kind === 'fort'), previous = globalThis.location;
  try {
    for (const search of ['', '?fort2=0&river2=0&gate=0']) {
      globalThis.location = { search };
      const built = buildProps({ world, terrain, models: { fort: model } }), fort = built.group.getObjectByName('original-fort');
      assert.equal(fort.position.x, def.x); assert.equal(fort.position.z, def.z); assert.equal(fort.rotation.y, def.rotY);
      assert.equal(fort.scale.x, def.scale * (search ? 1 : A.fortModelScale));
      if (search) assert.equal(built.river.group.children.length, 0);
      else assert(31.06 * A.fortModelScale < A.fortDiameter / 2);
      const releases = new Map();
      for (const m of built.river.group.children) for (const r of [m.geometry, m.material]) r.addEventListener('dispose', () => releases.set(r, (releases.get(r) || 0) + 1));
      built.river.dispose(); built.river.dispose(); for (const n of releases.values()) assert.equal(n, 1);
      assert.equal(model.scale.x, 1);
    }
  } finally { if (previous === undefined) delete globalThis.location; else globalThis.location = previous; }
  model.children[0].geometry.dispose(); model.children[0].material.dispose();
});
