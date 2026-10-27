// なぜ失敗したか: 原因の型（surface/priority/threshold/rotation/role/gait/input）を各assertに残す。
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySurface, stepSurfaceAt, roleOf, gaitOfClip } from '../dist/valley/step-surface.js';
import { LOCOMOTION } from '../dist/valley/anim-data.js';
const w = extra => ({ grass: 0, dirt: 0, rock: 0, gravel: 0, mud: 0, litter: 0, ...extra });
for (const [surface, weights, overlay] of [
  ['grass', {}, {}], ['dirt', { dirt: 0.46 }, {}], ['gravel', { gravel: 0.41 }, {}], ['leaves', { litter: 0.41 }, {}], ['stone', { rock: 0.51 }, {}], ['wood', {}, { wood: true }], ['water', {}, { water: 0.02 }], ['water', { mud: 0.51 }, {}],
]) test(`surface: ${surface} reachable ${JSON.stringify(weights)}`, () => assert.equal(classifySurface(w(weights), overlay), surface, 'surface: selection'));
for (const [weights, overlay, want] of [
  [{ mud: 0.6 }, { wood: true, stone: true }, 'water'], [{}, { water: 0.02, wood: true }, 'water'], [{ rock: 0.9, gravel: 0.9, litter: 0.9, dirt: 0.9 }, { wood: true, stone: true }, 'wood'], [{ gravel: 0.9, litter: 0.9, dirt: 0.9 }, { stone: true }, 'stone'], [{ rock: 0.9, gravel: 0.9 }, {}, 'stone'], [{ gravel: 0.9, litter: 0.9, dirt: 0.9 }, {}, 'gravel'], [{ litter: 0.9, dirt: 0.9 }, {}, 'leaves'],
]) test(`priority: ${want} ${JSON.stringify(overlay)}`, () => assert.equal(classifySurface(w(weights), overlay), want, 'priority: overlay/material order'));
for (const [key, boundary, surface] of [['gravel', 0.4, 'gravel'], ['dirt', 0.45, 'dirt'], ['mud', 0.5, 'water'], ['rock', 0.5, 'stone'], ['litter', 0.4, 'leaves']]) test(`threshold: ${key}`, () => {
  assert.equal(classifySurface(w({ [key]: boundary })), 'grass', 'threshold: strict boundary');
  assert.equal(classifySurface(w({ [key]: boundary + 1e-6 })), surface, 'threshold: above boundary');
  assert.equal(classifySurface(w({ [key]: boundary - 1e-6 })), 'grass', 'threshold: below boundary');
});
test('threshold: water depth is inclusive', () => { assert.equal(classifySurface(w(), { water: 0.019999 }), 'grass', 'threshold: below water'); assert.equal(classifySurface(w(), { water: 0.02 }), 'water', 'threshold: water equality'); });
const terrain = { surfaceAt: () => w(), waterAt: () => 0 };
const building = { x: 7, z: -3, rotY: 0.63, footprint: { w: 8, d: 2 } };
const point = (a, b) => [building.x + Math.cos(building.rotY) * a + Math.sin(building.rotY) * b, building.z - Math.sin(building.rotY) * a + Math.cos(building.rotY) * b];
test('rotation: rotated non-square footprint and margin', () => {
  const world = { buildings: [building] };
  for (const [x, z, want] of [[4.9, 1.9, 'wood'], [5.1, 0, 'grass'], [0, 2.1, 'grass'], [-4.9, -1.9, 'wood']]) assert.equal(stepSurfaceAt(...point(x, z), { terrain, world }), want, 'rotation: inverse Y transform/margin');
});
test('surface: stone zone and water priority through adapter', () => {
  const world = { buildings: [], zones: { temple_steps: { x: 0, z: 0, r: 6 } } };
  assert.equal(stepSurfaceAt(6, 0, { terrain, world }), 'stone', 'surface: zone boundary');
  assert.equal(stepSurfaceAt(6.01, 0, { terrain, world }), 'grass', 'surface: outside zone');
  assert.equal(stepSurfaceAt(0, 0, { terrain: { ...terrain, waterAt: () => 0.1 }, world }), 'water', 'priority: water before zone');
});
test('role: entire roster', () => { for (const [who, role] of Object.entries({ hero: 'hero', archer: 'ally', soldier: 'enemy_light', officer: 'enemy_heavy', villager_m: 'villager', villager_f: 'villager', child: 'villager' })) assert.equal(roleOf(who), role, 'role: roster mapping'); });
test('gait: every locomotion input and fallback', () => {
  for (const clip of [...new Set(Object.values(LOCOMOTION).flatMap(t => Object.values(t).filter(v => typeof v === 'string'))), 'future_walk']) assert.equal(gaitOfClip(clip), /CMU_(Run|Jog)/.test(clip) ? 'run' : clip === 'Cautious_Crouch_Walk_Forward' ? 'crouch' : 'walk', 'gait: locomotion mapping');
});
test('input: invalid weights, overlays, positions, footprints, roles, clips', () => {
  for (const call of [() => classifySurface(null), () => classifySurface({}), () => classifySurface(w({ dirt: NaN })), () => classifySurface(w({ grass: -1 })), () => classifySurface(w({ grass: 2 })), () => classifySurface(w(), { water: -1 }), () => classifySurface(w(), { wood: 1 }), () => classifySurface(w(), { stone: null }), () => stepSurfaceAt(NaN, 0, { terrain, world: { buildings: [] } }), () => stepSurfaceAt(0, 0, { terrain, world: { buildings: [{ ...building, footprint: { w: -1, d: 2 } }] } }), () => roleOf('unknown'), () => roleOf('toString'), () => gaitOfClip(null), () => gaitOfClip('')]) assert.throws(call, TypeError, 'input: invalid data rejected');
});
