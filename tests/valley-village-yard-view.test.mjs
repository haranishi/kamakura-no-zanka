// 里の煙と働く人の描画層（W2c-23e）。Three.js の組立と更新だけを確かめる。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { THREE, loadView } from './helpers/valley-view-modules.mjs';
import { WORLD } from '../dist/valley/world-data.js';
import { createTerrain } from '../dist/valley/terrain-height.js';
import { YARD, yardSmokeSpots, yardWorkerSpots, yardWorkerCount, yardSmokePuffCount } from '../dist/valley/village-yard.js';

const { buildVillageYard } = await loadView('village-yard-view.js');

function fixture(search = '', quality = 'standard') {
  const terrain = createTerrain(WORLD);
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 2000);
  camera.position.set(0, terrain.heightAt(0, 186) + 86, 186);
  const yard = buildVillageYard({ world: WORLD, terrain, quality: () => quality, search });
  const wind = { uTime: { value: 0 }, uWind: { value: 1 }, uWindDir: { value: new THREE.Vector3(0.9, 0, 0.2) } };
  return { yard, camera, wind, terrain };
}

test('&yard=0 builds an empty group and never places meshes', () => {
  const { yard } = fixture('?yard=0');
  assert.equal(yard.group.children.length, 0);
  assert.deepEqual(yard.stats(), { smoke: 0, workers: 0, puffs: 0 });
  yard.update(1, null, null);
});

test('default build places smoke puffs and workers; update advances smoke time', () => {
  const { yard, camera, wind } = fixture('');
  assert(yard.group.children.length >= 2);
  const smoke = yard.group.getObjectByName('village-yard-smoke');
  assert(smoke);
  assert.equal(smoke.geometry.instanceCount, yardSmokeSpots(WORLD).length * yardSmokePuffCount('standard'));
  yard.update(0, camera, wind);
  const before = yard.stats().workers;
  assert.equal(before, Math.min(yardWorkerSpots(WORLD).length, yardWorkerCount('standard')));
  yard.update(2.5, camera, wind);
  assert.equal(smoke.material.uniforms.uTime.value, 2.5);
  assert.deepEqual(yard.stats().smoke, yardSmokeSpots(WORLD).length);
});

test('light quality reduces puffs and worker cap; dispose clears GPU objects', () => {
  let q = 'standard';
  const terrain = createTerrain(WORLD);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 90, 186);
  const yard = buildVillageYard({ world: WORLD, terrain, quality: () => q, search: '' });
  const smoke = yard.group.getObjectByName('village-yard-smoke');
  assert.equal(smoke.geometry.instanceCount, yardSmokeSpots(WORLD).length * YARD.smokePuffs);
  q = 'light';
  yard.update(0.1, camera, null);
  assert.equal(smoke.geometry.instanceCount, yardSmokeSpots(WORLD).length * YARD.lightSmokePuffs);
  assert(yard.stats().workers <= YARD.lightMaxWorkers);
  yard.dispose();
  assert.equal(yard.group.children.length, 0);
});

test('main.js wires buildVillageYard next to life; game.js updates yard each frame', () => {
  const main = fs.readFileSync(new URL('../dist/valley/main.js', import.meta.url), 'utf8');
  const game = fs.readFileSync(new URL('../dist/valley/game.js', import.meta.url), 'utf8');
  assert.match(main, /buildVillageYard/);
  assert.match(main, /props\.yard\s*=/);
  assert.match(game, /props\?\.yard\?\.update/);
});
