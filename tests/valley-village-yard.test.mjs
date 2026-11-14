// 里のかまどの煙と働く人（W2c-23e）の純粋な層。描画に触れない。
import test from 'node:test';
import assert from 'node:assert/strict';
import { WORLD } from '../dist/valley/world-data.js';
import {
  YARD, yardEnabled, yardSmokeSpots, yardWorkerSpots, yardWorkerCount, yardSmokePuffCount,
  yardWorkerPixels, farScaleAt, yardStats,
} from '../dist/valley/village-yard.js';

const before = JSON.stringify(WORLD);

test('yard flag defaults on; &yard=0 turns the layer off', () => {
  assert.equal(yardEnabled(''), true);
  assert.equal(yardEnabled('?qa=1'), true);
  assert.equal(yardEnabled('?yard=0'), false);
  assert.equal(yardEnabled('?yard=1&cam=concept'), true);
});

test('smoke spots include the hearth and every farmhouse roof; WORLD is unchanged', () => {
  const spots = yardSmokeSpots(WORLD);
  assert.deepEqual(spots, yardSmokeSpots(WORLD));
  const hearth = spots.find(s => s.id === 'hearth');
  assert(hearth);
  assert.equal(hearth.x, WORLD.life.items.find(d => d.id === 'hearth').x);
  const houses = WORLD.buildings.filter(b => b.kind === 'farmhouse');
  assert.equal(spots.length, 1 + houses.length);
  for (const h of houses) assert(spots.some(s => s.id === h.id));
  for (const s of spots) {
    assert(Number.isFinite(s.x) && Number.isFinite(s.z) && Number.isFinite(s.lift));
    assert(s.strength > 0 && s.strength <= 1);
  }
  assert.equal(JSON.stringify(WORLD), before);
});

test('workers stay ≥1m from named villagers; roles and counts are bounded', () => {
  const workers = yardWorkerSpots(WORLD);
  assert.deepEqual(workers, yardWorkerSpots(WORLD));
  assert(workers.length >= 8 && workers.length <= YARD.maxWorkers);
  const villagers = WORLD.spawns.villagers;
  for (const w of workers) {
    assert(Number.isFinite(w.x) && Number.isFinite(w.z) && Number.isFinite(w.yaw));
    assert(['rice', 'thresh', 'dry', 'wood', 'carry', 'talk'].includes(w.role));
    for (const v of villagers) {
      const d = Math.hypot(w.x - v.x, w.z - v.z);
      assert(d >= 1, `${w.id} is ${d.toFixed(2)}m from ${v.id}`);
    }
  }
  assert.equal(yardWorkerCount('standard'), YARD.maxWorkers);
  assert.equal(yardWorkerCount('light'), YARD.lightMaxWorkers);
  assert(yardSmokePuffCount('standard') > yardSmokePuffCount('light'));
  assert.equal(JSON.stringify(WORLD), before);
});

test('concept overlook (~182m) scales workers so projected height clears 3px at 720p', () => {
  // shots.concept: eye at (0,186), look near village centre. Distance to a yard worker near (0,4) ≈ 182m.
  const distance = Math.hypot(0 - 0, 186 - 4);
  assert(distance > 170 && distance < 200);
  const px = yardWorkerPixels(distance, { fov: 62, height: 720 });
  assert(px >= 3, `worker height projects to ${px.toFixed(2)}px; need ≥3`);
  assert.equal(farScaleAt(0), 1);
  assert.equal(farScaleAt(YARD.farTo), YARD.farScale);
  assert(farScaleAt((YARD.farFrom + YARD.farTo) / 2) > 1 && farScaleAt((YARD.farFrom + YARD.farTo) / 2) < YARD.farScale);
});

test('yardStats reports smoke columns and capped workers', () => {
  const s = yardStats(WORLD, 'standard');
  assert.equal(s.smoke, yardSmokeSpots(WORLD).length);
  assert.equal(s.workers, Math.min(yardWorkerSpots(WORLD).length, YARD.maxWorkers));
  assert.equal(s.puffs, YARD.smokePuffs);
  const light = yardStats(WORLD, 'light');
  assert.equal(light.workers, Math.min(yardWorkerSpots(WORLD).length, YARD.lightMaxWorkers));
  assert.equal(light.puffs, YARD.lightSmokePuffs);
});
