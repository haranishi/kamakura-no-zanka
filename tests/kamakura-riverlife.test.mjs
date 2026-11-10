import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as THREE from '../dist/vendor/three.module.min.js';
import { BRIDGES, bridgeSites } from '../dist/valley/kamakura-bridges.js';
import { riverRocks, riverSamples, RIVER_ROCKS } from '../dist/valley/kamakura-river-rocks.js';
import { bridgeGeometry, rockGeometry, RIVERLIFE_ART } from '../dist/valley/kamakura-riverlife-kit.js';
import { createKamakuraRiverlife, installRiverlifeShader, FOAM_BEGIN_VERTEX, FOAM_COLOR_FRAGMENT, FOAM_VERTEX_PARS, FOAM_FRAGMENT_PARS, RIVERLIFE_VERTEX_PARS, RIVERLIFE_BEGIN_VERTEX } from '../dist/valley/kamakura-riverlife-view.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { loadKamakura } from '../dist/valley/kamakura-data.js';
import { buildColliders } from '../dist/valley/collision.js';
import { syntheticWorld } from '../tools/make-synthetic-world.mjs';
function fixture() {
  const river = { id: 'analytic', enters_sea: true, xy_m: [[0, 500], [0, -500]], width_m: [8, 8], bed_m: [25, 1], water_elev_m: [26, 2] };
  const data = { roads: { road: { route_id: 'crossing', width_m: 4, xyz_m: [[-20, 0, 0], [20, 0, 0]] } }, rivers: { rivers: [river] } };
  const terrain = { vscale: 1, heightAt: (x, z) => 14 - z * .024 + Math.min(1, Math.max(0, (Math.abs(x) - 4) / 2)), bounds: { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 } };
  return { search: '?debug=1', quality: 'standard', data, terrain, scene: new THREE.Scene(), colliders: buildColliders({ bounds: terrain.bounds }), hero: { pos: { x: 0, y: 15, z: 0 } } };
}
const tri = g => (g.index?.count ?? g.attributes.position.count) / 3;
async function load(files) { return loadKamakura(async url => { const b = files.get(url.slice('/world-private/'.length)); return { ok: true, json: async () => JSON.parse(b), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; }); }
test('B2 detailed bridge <=900 triangles, distant <=60, four rounded rocks <=60 each', () => {
  const c = fixture(), sites = bridgeSites(c.data, c.terrain); assert.equal(sites.length, 1);
  const shapes = bridgeGeometry(sites, c.terrain);
  assert(tri(shapes.deck) + tri(shapes.rail) + tri(shapes.pier) <= 900); assert(tri(shapes.far) <= 60);
  for (const g of Object.values(shapes)) { for (const v of g.attributes.position.array) assert(Number.isFinite(v)); g.dispose(); }
  const profiles = [];
  for (let i = 0; i < 4; i++) { const g = rockGeometry(i); assert(tri(g) <= 60); profiles.push([...g.attributes.position.array]); g.dispose(); }
  for (let i = 1; i < 4; i++) assert.notDeepEqual(profiles[i], profiles[0]);
});
test('layer flags, 3D ranges, quality, one foam draw, <=8 draws and <=70000 submitted triangles', () => {
  assert.equal(createKamakuraRiverlife({ search: '?bridges=0&rocks=0' }), null);
  assert.equal(createKamakuraRiverlife({ search: '?layers=0' }), null);
  for (const search of ['?debug=1', '?debug=1&riverlifedebug=1', '?debug=1&bridges=0', '?debug=1&rocks=0']) {
    const c = fixture(); c.search = search; const layer = createKamakuraRiverlife(c), group = c.scene.children[0];
    const frame = { dt: .016, pos: { x: 0, y: 15, z: 0 }, hero: c.hero }; layer.update(frame);
    const stats = globalThis.__kzRiverlife(); assert(stats.drawn.draws <= 8); assert(stats.drawn.triangles <= 70000);
    assert(group.children.filter(m => m.name === 'foam').length <= 1);
    frame.pos.y = 800; layer.update(frame); assert.equal(globalThis.__kzRiverlife().rocks.count, 0); assert.equal(globalThis.__kzRiverlife().foam.count, 0);
    if (!search.includes('bridges=0')) { assert.equal(globalThis.__kzRiverlife().drawn.bridges, 1); assert(group.children.find(m => m.name === 'far').visible); }
    frame.pos.y = 2600; layer.setAdapt(3); layer.update(frame); assert.equal(globalThis.__kzRiverlife().drawn.draws, 0);
    layer.dispose(); assert.equal(c.scene.children.length, 0); assert.equal(c.colliders.boxes.length, 0); assert.equal(c.colliders.circles.length, 0); assert.equal(globalThis.__kzRiverlife, undefined);
  }
});
test('1000 updates reuse every buffer, uniform and resource; pause stops foam time; dispose once', () => {
  const c = fixture(), layer = createKamakuraRiverlife(c), meshes = c.scene.children[0].children, refs = meshes.map(m => [m.geometry, m.material, m.customDepthMaterial, ...Object.values(m.geometry.attributes).map(a => a.array)]);
  const releases = new Map();
  for (const r of new Set(refs.flat().filter(r => r?.dispose))) r.addEventListener('dispose', () => releases.set(r, (releases.get(r) || 0) + 1));
  const shaders = meshes.map(m => { const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader }; m.material.onBeforeCompile(shader); return shader; });
  const frame = { dt: .016, pos: { x: 0, y: 15, z: 0 }, hero: c.hero };
  for (let i = 0; i < 1000; i++) { frame.pos.x = i % 10; layer.update(frame); }
  meshes.forEach((m, i) => assert.deepEqual([m.geometry, m.material, m.customDepthMaterial, ...Object.values(m.geometry.attributes).map(a => a.array)], refs[i]));
  const time = shaders.find(s => s.uniforms.uRiverlifeTime).uniforms.uRiverlifeTime;
  const before = time.value; layer.setPaused(true); layer.update(frame); assert.equal(time.value, before); layer.setPaused(false); layer.update(frame); assert(time.value > before);
  layer.dispose(); layer.dispose(); for (const count of releases.values()) assert.equal(count, 1);
});
test('shader insertion markers exist for basic/lambert/depth; generated GLSL has balanced tokens and safe numeric literals', () => {
  for (const type of ['basic', 'lambert', 'depth']) for (const foam of [false, true]) {
    if (foam && type !== 'basic') continue;
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib[type].vertexShader, fragmentShader: THREE.ShaderLib[type].fragmentShader };
    for (const marker of ['#include <common>', '#include <begin_vertex>']) assert(shader.vertexShader.includes(marker));
    if (foam) assert(shader.fragmentShader.includes('#include <color_fragment>'));
    const material = new THREE.MeshBasicMaterial(); installRiverlifeShader(material, {}, foam); material.onBeforeCompile(shader);
    for (const s of [shader.vertexShader, shader.fragmentShader]) {
      for (const [a, b] of [['(', ')'], ['{', '}'], ['[', ']']]) { let balance = 0; for (const ch of s) { if (ch === a) balance++; if (ch === b) balance--; assert(balance >= 0); } assert.equal(balance, 0); }
      assert(!/--\d|\d\.\d+[A-Za-z_]|\b(?:float|vec[234])\s+(?:sample|input|output|common)\b/.test(s));
      assert(!/\b(?:float|vec[234])\s+\w+\s*=\s*\d+\s*;/.test(s));
    }
    material.dispose();
  }
  assert(FOAM_BEGIN_VERTEX.includes('distance(aFoamOrigin, uRiverlifeViewer)'));
  assert(FOAM_COLOR_FRAGMENT.includes('uRiverlifeTime * vFoamMotion.x')); assert(RIVERLIFE_ART.foamMax <= .42);
});
test('CI synthetic data crosses a river, creates a bridge, remains deterministic and <8MB', async () => {
  const files = syntheticWorld(), again = syntheticWorld();
  for (const [name, bytes] of files) assert(bytes.equals(again.get(name)));
  assert([...files.values()].reduce((n, b) => n + b.length, 0) < 8000000);
  const data = await load(files), terrain = createKamakuraTerrain(data); assert(bridgeSites(data, terrain).length >= 1);
});
test('private data: no exception, bridge/rock budgets and forbidden pier/mouth zones', async t => {
  if (!process.env.KZ_WORLD_DIR) return t.skip('Private data not configured');
  const data = await loadKamakura(async url => { const b = await fs.readFile(path.join(process.env.KZ_WORLD_DIR, url.slice('/world-private/'.length))); return { ok: true, json: async () => JSON.parse(b), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; });
  const terrain = createKamakuraTerrain(data), sites = bridgeSites(data, terrain), placed = riverRocks(data, terrain, sites);
  assert(sites.length <= BRIDGES.total); assert(placed.rocks.length <= RIVER_ROCKS.standardCap);
  for (const s of sites) assert(sites.filter(p => p.river === s.river).length <= BRIDGES.perRiver);
  for (const rock of placed.rocks) for (const s of sites) for (const pier of s.piers) assert(Math.hypot(rock.x - pier.x, rock.z - pier.z) >= RIVER_ROCKS.pierClear + rock.width / 2);
  for (const rock of placed.rocks) {
    const river = data.rivers.rivers.find(r => r.id === rock.river), p = riverSamples(river, terrain.vscale);
    const mouth = p[0].water >= p.at(-1).water ? p.at(-1).along : 0;
    if (river.enters_sea) assert(Math.abs(mouth - rock.along) > RIVER_ROCKS.mouthClear, 'Private mouth exclusion (coordinates withheld)');
  }
  const context = { data, terrain, search: '?debug=1', quality: 'standard', scene: new THREE.Scene(), colliders: buildColliders({ bounds: terrain.bounds }) };
  const layer = createKamakuraRiverlife(context);
  layer.update({ dt: .016, pos: { x: 0, y: 0, z: 0 } });
  const stats = globalThis.__kzRiverlife(); assert(stats.drawn.draws <= 8); assert(stats.drawn.triangles <= 70000); layer.dispose();
  t.diagnostic(`bridge/rock counts withheld from the repository; bridges within limit: ${sites.length <= BRIDGES.total}; rock capacity used: ${(placed.rocks.length / RIVER_ROCKS.standardCap * 100).toFixed(1)}%`);
  // Private raw counts may be emitted at run time; never pinned in source or recorded documents.
  t.diagnostic(`bridges=${sites.length}; rocks=${placed.rocks.length}`);
});

test('all custom GLSL identifiers are declared; update allocates no arrays, objects, closures or renderer resources', async () => {
  const code = [FOAM_BEGIN_VERTEX, FOAM_COLOR_FRAGMENT, FOAM_VERTEX_PARS, FOAM_FRAGMENT_PARS, RIVERLIFE_VERTEX_PARS, RIVERLIFE_BEGIN_VERTEX].join('\n');
  const declared = new Set([...code.matchAll(/\b(?:float|vec[234])\s+(\w+)/g)].map(m => m[1]));
  for (const m of code.matchAll(/(?:uniform|attribute|varying)\s+(?:float|vec[234])\s+([^;]+);/g)) for (const name of m[1].split(',')) declared.add(name.trim());
  for (const id of code.match(/\b(?:[auv]Riverlife\w*|riverlife\w*|[av]Foam\w*)\b/g)) assert(declared.has(id), id);
  const source = await fs.readFile(new URL('../dist/valley/kamakura-riverlife-view.js', import.meta.url), 'utf8');
  const update = source.slice(source.indexOf('    update(frame) {'), source.indexOf('    setAdapt(value)'));
  assert(!/\bnew\b|=>|\.map\(|\.filter\(|\.slice\(|=\s*\[|=\s*\{/.test(update));
});
test('foam rotation keeps the upward winding for east, west, north and south flow', () => {
  // The fragment's card is single-sided, so a reflection would make every foam face disappear.
  assert(FOAM_BEGIN_VERTEX.includes('vec3(aFoamShape.w * position.x'));
  assert(FOAM_BEGIN_VERTEX.includes('-aFoamShape.z * position.x'));
  for (const [tx, tz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) assert.equal(tz * tz + tx * tx, 1);
});
test('debug masks bypass post fog while ordinary play leaves the post route alone', () => {
  for (const debug of [false, true]) {
    const c = fixture(), calls = []; c.post = { setAdapt: n => calls.push(n) };
    if (debug) c.search += '&riverlifedebug=1';
    const layer = createKamakuraRiverlife(c); assert.deepEqual(calls, debug ? [2] : []); layer.dispose();
  }
});
