import test from 'node:test';
import assert from 'node:assert/strict';
import {buildNavGrid, findPath, smoothPath, losClear, nearestWalkable} from '../dist/valley/nav.js';

const grid = (walkable = () => true, extra = {}) => buildNavGrid({minX: 0, minZ: 0, maxX: 10, maxZ: 10, cell: 1, walkable, ...extra});

test('grid samples every cell center once and survives JSON', () => {
  const calls = [];
  const g = grid((x, z) => { calls.push({x, z}); return true; });
  assert.equal(calls.length, 100);
  assert.deepEqual(calls[0], {x: 0.5, z: 0.5});
  assert.deepEqual(calls.at(-1), {x: 9.5, z: 9.5});
  assert.deepEqual(JSON.parse(JSON.stringify(g)), g);
  const partial = grid(() => true, {maxX: 2.5, maxZ: 1.2});
  assert.deepEqual(nearestWalkable(partial, {x: 2.4, z: 1.1}), {x: 2.25, z: 1.1});
});

test('straight paths are smooth and include exact endpoints', () => {
  const a = {x: 0.2, z: 0.3}, b = {x: 8.8, z: 7.9};
  assert.deepEqual(findPath(grid(), a, b), [a, b]);
  assert.deepEqual(findPath(grid(), a, a), [a]);
  assert.deepEqual(smoothPath([a, {x: 3, z: 3}, b], () => true), [a, b]);
});

test('A* detours around a wall and smoothing keeps every segment walkable', () => {
  const walkable = (x, z) => !(x >= 4 && x < 6 && z < 8);
  const a = {x: 1.3, z: 1.2}, b = {x: 8.7, z: 1.2};
  const path = findPath(grid(walkable), a, b);
  assert.deepEqual(path[0], a); assert.deepEqual(path.at(-1), b);
  assert(path.some(p => p.z >= 8));
  for (let i = 1; i < path.length; i++) assert(losClear(walkable, path[i - 1], path[i], 0.02));
});

test('unreachable, blocked and out-of-bounds destinations return null', () => {
  const g = grid((x, z) => x < 4 || x >= 6);
  assert.equal(findPath(g, {x: 1, z: 1}, {x: 8, z: 1}), null);
  assert.equal(findPath(g, {x: 1, z: 1}, {x: 5, z: 1}), null);
  assert.equal(findPath(g, {x: 1, z: 1}, {x: 10, z: 1}), null);
  assert.equal(findPath(grid(() => false), {x: 1, z: 1}, {x: 8, z: 1}), null);
});

test('diagonals cannot cut two blocked adjacent corners', () => {
  const g = grid((x, z) => (x < 1 && z < 1) || (x >= 1 && z >= 1), {maxX: 2, maxZ: 2});
  assert.equal(findPath(g, {x: 0.5, z: 0.5}, {x: 1.5, z: 1.5}), null);
});

test('one blocked corner also prevents a diagonal and cannot reappear during smoothing', () => {
  const g = grid((x, z) => !(x >= 1 && z < 1), {maxX: 2, maxZ: 2});
  const path = findPath(g, {x: 0.5, z: 0.5}, {x: 1.5, z: 1.5});
  assert.deepEqual(path, [{x: 0.5, z: 0.5}, {x: 0.5, z: 1.5}, {x: 1.5, z: 1.5}]);
});

test('blocked starts use the nearest walkable center; radius is measured in meters', () => {
  const g = grid(x => x >= 3);
  const a = {x: 1.2, z: 2.3}, b = {x: 8.1, z: 2.1};
  assert.deepEqual(nearestWalkable(g, a), {x: 3.5, z: 2.5});
  assert.equal(nearestWalkable(g, a, 2), null);
  assert.deepEqual(findPath(g, a, b)[0], {x: 3.5, z: 2.5});
  assert.deepEqual(findPath(g, a, b).at(-1), b);
  assert.equal(nearestWalkable(grid(() => false), a), null);
});

test('LOS samples both endpoints, intermediate obstacles and zero length', () => {
  const a = {x: 0, z: 0}, b = {x: 3, z: 0};
  assert.equal(losClear(x => x !== 0, a, b), false);
  assert.equal(losClear(x => x !== 3, a, b), false);
  assert.equal(losClear(x => !(x >= 1 && x <= 2), a, b), false);
  assert.equal(losClear(() => true, a, a), true);
  assert.equal(losClear(() => true, a, b, 0), false);
  assert.equal(losClear(() => true, {x: NaN, z: 0}, b), false);
});

test('invalid grid dimensions reject before allocation', () => {
  assert.throws(() => grid(() => true, {cell: 0}), TypeError);
  assert.throws(() => grid(() => true, {maxX: Infinity}), TypeError);
  assert.throws(() => grid(() => true, {maxZ: -1}), TypeError);
});

test('map-sized A* with repeated barriers has bounded LOS work', () => {
  const g = grid((x, z) => Math.floor(x / 10) % 2 === 0 || z > 240, {maxX: 300, maxZ: 260, cell: 2});
  const path = findPath(g, {x: 1, z: 1}, {x: 299, z: 259});
  assert(path?.length > 1);
  const long = Array.from({length: 1000}, (_, i) => ({x: i, z: 0}));
  let calls = 0;
  smoothPath(long, () => { calls++; return false; });
  assert(calls <= 16000);
});
