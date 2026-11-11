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

test('three merged draws (torii, bank, tufts), shadow/fog materials, real post contacts/collisions and idempotent resource release', t => {
  const c = context(), v = createKamakuraAvenue(c); v.update(frame);
  const g = c.scene.children[0], [torii, berm, tufts] = g.children;
  assert.equal(g.children.length, 3); assert(torii.castShadow && torii.receiveShadow); assert(!berm.castShadow && berm.receiveShadow); assert(!tufts.castShadow && tufts.receiveShadow);
  assert.deepEqual(g.children.map(m => m.name), ['avenue-torii', 'avenue-berm', 'avenue-tufts']);
  for (const m of g.children) { assert(m.material.isMeshLambertMaterial && m.material.fog); assert(m.material.forceSinglePass); for (const k of ['position', 'normal', 'color']) for (const n of m.geometry.attributes[k].array) assert(Number.isFinite(n)); }
  const d = globalThis.__kzAvenue(); assert.equal(d.draws, 3); assert(d.triangles <= AVENUE.totalTriangles); assert(d.berm.tufts > 0 && d.berm.tuftsVisible); assert.equal(d.colliders, 4); assert.match(v.debugText(), /松 \d+・鳥居 2/);
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
  v.dispose(); v.dispose(); assert.equal(c.scene.children.length, 0); assert.equal(c.colliders.circles.length, 0); assert.equal(c.colliders.grid.size, 0); assert.equal(globalThis.__kzAvenue, undefined); assert.equal(freed.size, 6); assert([...freed.values()].every(n => n === 1)); assert.equal(v.debugText(), '');
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
  close(byName['avenue-pines'].geometry.parameters.height, 20); assert.equal(globalThis.__kzAvenue().draws, 4); assert(byName['avenue-tufts'].material.isMeshBasicMaterial && !byName['avenue-berm'].material.onBeforeCompile.toString().includes('bermGrass'));
  const marker = byName['avenue-pines']; let calls = 0; marker.addEventListener('dispose', () => calls++); v.dispose(); v.dispose(); assert.equal(calls, 1);
});

function balanced(code) { for (const [open, shut] of ['()', '{}', '[]']) assert.equal(code.split(open).length, code.split(shut).length, `unbalanced ${open}${shut}`); }
test('the bank mixes earth and grass in the pixel shader: the patch lands on real Lambert chunks, compiles to balanced GLSL, and tufts hide far away', () => {
  const c = context(), v = createKamakuraAvenue(c), [, berm, tufts] = c.scene.children[0].children;
  const grass = berm.geometry.attributes.bermGrass; assert.equal(grass.itemSize, 4); assert.equal(grass.count, berm.geometry.attributes.position.count);
  assert.equal(tufts.geometry.attributes.bermGrass, undefined); assert.equal(typeof berm.material.onBeforeCompile, 'function'); assert.equal(berm.material.customProgramCacheKey(), 'kamakura-avenue-berm');
  const lambert = THREE.ShaderLib.lambert, shader = { vertexShader: lambert.vertexShader, fragmentShader: lambert.fragmentShader, uniforms: {} };
  for (const mark of ['#include <common>', '#include <begin_vertex>']) assert(lambert.vertexShader.includes(mark));
  for (const mark of ['#include <common>', '#include <color_fragment>']) assert(lambert.fragmentShader.includes(mark));
  berm.material.onBeforeCompile(shader);
  for (const code of [shader.vertexShader, shader.fragmentShader]) { balanced(code); assert(!/--\d/.test(code)); assert(!/\d[a-zA-Z_]/.test(code.replace(/\d+\.\d+|\d+e-?\d+|vec[234]|mat[34]|sampler2D|texture2D|[A-Za-z_]\w*/g, '')), 'no number runs into a name'); }
  assert.match(shader.vertexShader, /attribute vec4 bermGrass;[\s\S]*vBermGrass = bermGrass;[\s\S]*vBermWorld = \(modelMatrix \* vec4\(transformed, 1\.0\)\)\.xyz;/);
  assert.match(shader.fragmentShader, /float kzBermNoise\(vec2 p\)[\s\S]*#include <color_fragment>[\s\S]*diffuseColor\.rgb = mix\(diffuseColor\.rgb, vBermGrass\.rgb, kzCover\)/);
  for (const name of ['kzCoarse', 'kzFine', 'kzGrain', 'kzCover']) assert(new RegExp(`float ${name} = `).test(shader.fragmentShader), `${name} is declared before use`);
  assert(!/\bint\b/.test(shader.fragmentShader.slice(shader.fragmentShader.indexOf('float kzCoarse'), shader.fragmentShader.indexOf('diffuseColor.rgb = mix(diffuseColor.rgb, vBermGrass'))), 'floats only');
  // Tufts are for the walker: from across the town a blade is under a pixel, so they are not drawn there; the bank still is.
  const far = { pos: { x: 0, y: 12, z: 300 }, camera: { position: new THREE.Vector3(0, 12 + AVENUE.tuftRange + 60, 300) } };
  v.update(far); assert(berm.visible && !tufts.visible); assert.equal(globalThis.__kzAvenue().draws, 2);
  v.update(frame); assert(tufts.visible); v.setAdapt(2); v.update(frame); assert(!tufts.visible && berm.visible, 'the cheaper steps drop the tufts first'); v.dispose();
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
