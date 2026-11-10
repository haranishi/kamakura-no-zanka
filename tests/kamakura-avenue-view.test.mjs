import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.min.js';
import { createKamakuraAvenue } from '../dist/valley/kamakura-avenue-view.js';
import { buildColliders, freeAt } from '../dist/valley/collision.js';
import { AVENUE } from '../dist/valley/kamakura-avenue.js';
const context = (search = '?debug=1', quality = 'standard') => ({
  search, quality, scene: new THREE.Scene(),
  data: { roads: { avenue: { kind: 'local_road', route_id: 'synthetic', width_m: 14, xyz_m: [[0, 0, 0], [0, -600, 0]] } }, veg: [] },
  terrain: { bounds: { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 }, heightAt: (x, z) => 10 + x * .1, waterAt: () => 0, walkable: () => true, insideA: () => true },
  colliders: buildColliders({ bounds: { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 } }),
});
const frame = { pos: { x: 0, y: 12, z: 300 } };

test('layer is null before reading context or allocating scene resources when avenue=0 or no road', () => {
  assert.equal(createKamakuraAvenue({ search: '?avenue=0' }), null);
  assert.equal(createKamakuraAvenue({ data: {}, search: '' }), null);
  assert.equal(createKamakuraAvenue({ data: { sandoNotice: 'upstream terrain failure' }, search: '' }), null);
});

test('two merged draws, shadow/fog materials, real post contacts/collisions and idempotent resource release', t => {
  const c = context(), v = createKamakuraAvenue(c); v.update(frame);
  const g = c.scene.children[0], [torii, berm] = g.children;
  assert.equal(g.children.length, 2); assert(torii.castShadow && torii.receiveShadow); assert(!berm.castShadow && berm.receiveShadow);
  for (const m of g.children) { assert(m.material.isMeshLambertMaterial && m.material.fog); assert(m.material.forceSinglePass); for (const k of ['position', 'normal', 'color']) for (const n of m.geometry.attributes[k].array) assert(Number.isFinite(n)); }
  const d = globalThis.__kzAvenue(); assert.equal(d.draws, 2); assert(d.triangles <= 7000); assert.equal(d.colliders, 4); assert.match(v.debugText(), /松 \d+・鳥居 2/);
  assert.equal(c.colliders.circles.length, 4);
  for (const p of c.colliders.circles) { assert.equal(p.r, .5); assert(!freeAt(c.colliders, c.terrain, p.x, p.z, .3)); }
  assert(freeAt(c.colliders, c.terrain, 0, 168, .3));
  const positions = torii.geometry.attributes.position;
  for (const post of c.colliders.circles) {
    let near = 0; for (let i = 0; i < positions.count; i++) if (Math.hypot(positions.getX(i) - post.x, positions.getZ(i) - post.z) <= .51 && Math.abs(positions.getY(i) - c.terrain.heightAt(post.x, post.z)) < .001) near++;
    assert(near > 0, 'mesh feet match each circular collider on sloping ground');
  }
  const freed = new Map(); for (const m of g.children) for (const r of [m.geometry, m.material]) r.addEventListener('dispose', () => freed.set(r, (freed.get(r) || 0) + 1));
  t.diagnostic(JSON.stringify({ triangles: d.triangles, draws: d.draws, distanceChecksPerFrame: d.work.distanceChecks }));
  v.dispose(); v.dispose(); assert.equal(c.scene.children.length, 0); assert.equal(c.colliders.circles.length, 0); assert.equal(c.colliders.grid.size, 0); assert.equal(globalThis.__kzAvenue, undefined); assert.equal(freed.size, 4); assert([...freed.values()].every(n => n === 1)); assert.equal(v.debugText(), '');
});

test('visibility measures camera height in 3D and responds to each quality step, even with a walking pos', () => {
  for (const quality of ['standard', 'light']) {
    const c = context('?debug=1', quality), v = createKamakuraAvenue(c), f = { pos: { x: 0, y: 12, z: 168 }, camera: { position: new THREE.Vector3(0, 4010, 168) } };
    v.update(f); assert.equal(globalThis.__kzAvenue().torii[0].visible, quality === 'standard');
    f.camera.position.y = 6010; v.update(f); assert.equal(globalThis.__kzAvenue().draws, 0);
    f.camera.position.y = 3010; v.setAdapt(3); v.update(f); assert.equal(globalThis.__kzAvenue().torii[0].visible, false);
    f.camera.position.y = 1010; v.update(f); assert.equal(globalThis.__kzAvenue().torii[0].visible, true); assert(!c.scene.children[0].children[0].castShadow);
    v.setAdapt(0); v.update(f); assert(c.scene.children[0].children[0].castShadow); v.dispose();
  }
});

test('debug colours are unlit/unfogged, pine columns are 20m, and three draws include debug markers', () => {
  const c = context('?debug=1&avenuedebug=1'), v = createKamakuraAvenue(c); v.update(frame); const g = c.scene.children[0];
  const byName = Object.fromEntries(g.children.map(m => [m.name, m]));
  for (const [name, color] of [['avenue-pines', AVENUE.debugPine], ['avenue-torii', AVENUE.debugTorii], ['avenue-berm', AVENUE.debugBerm]]) { const m = byName[name]; assert(m.material.isMeshBasicMaterial && !m.material.fog && !m.material.toneMapped); assert.equal(m.material.color.getHexString(), color.slice(1)); }
  close(byName['avenue-pines'].geometry.parameters.height, 20); assert.equal(globalThis.__kzAvenue().draws, 3);
  const marker = byName['avenue-pines']; let calls = 0; marker.addEventListener('dispose', () => calls++); v.dispose(); v.dispose(); assert.equal(calls, 1);
});
function close(a, b) { assert(Math.abs(a - b) < 1e-6); }

test('1000 updates reuse all buffers, do not query terrain or construct objects, pause and disposal stop updates', () => {
  const c = context(), v = createKamakuraAvenue(c); v.update(frame); const children = c.scene.children[0].children, saved = children.map(m => [m.geometry.attributes.position.array, m.geometry.attributes.color.array, m.geometry.drawRange]);
  for (const k of ['heightAt', 'waterAt', 'walkable']) c.terrain[k] = () => assert.fail('terrain queried in frame');
  const src = fs.readFileSync(new URL('../dist/valley/kamakura-avenue-view.js', import.meta.url), 'utf8'), update = src.slice(src.indexOf('    update(frame)'), src.indexOf('    setAdapt(next)'));
  assert.doesNotMatch(update, /\bnew\b|\.map\(|\.filter\(|\.slice\(|=>|\.\.\.|=\s*[\[{]/);
  for (let i = 0; i < 1000; i++) v.update(frame);
  children.forEach((m, i) => { assert.equal(m.geometry.attributes.position.array, saved[i][0]); assert.equal(m.geometry.attributes.color.array, saved[i][1]); assert.equal(m.geometry.drawRange, saved[i][2]); });
  const before = globalThis.__kzAvenue(); v.setPaused(true); v.update({ pos: { x: 0, y: 9000, z: 0 } }); assert.deepEqual(globalThis.__kzAvenue(), before);
  v.setPaused(false); v.update({ pos: { x: 0, y: 9000, z: 0 } }); assert.equal(globalThis.__kzAvenue().draws, 0); v.dispose(); v.update(frame);
});
