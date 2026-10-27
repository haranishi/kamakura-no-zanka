import test from 'node:test';
import assert from 'node:assert/strict';
import { measureTrees } from '../tools/measure-trees.mjs';
test('tree denominators nest, species sum, and the same world is deterministic', () => {
  const a = measureTrees();
  assert.deepEqual(a, measureTrees());
  for (const k of ['all', 'walkable', 'reachable']) {
    assert.equal(a[k].length, 3);
    assert.equal(a.total[k], a[k].reduce((x, y) => x + y, 0));
    assert(a[k].every(n => Number.isInteger(n) && n >= 0));
  }
  for (let i = 0; i < 3; i++) assert(a.all[i] >= a.walkable[i] && a.walkable[i] >= a.reachable[i]);
  assert.equal(a.ratios.reachableNonCedarPct, (a.reachable[1] + a.reachable[2]) / a.total.reachable * 100);
  assert.equal(a.ratios.reachableBroadleafPct, a.reachable[1] / a.total.reachable * 100);
});
test('reachable trees exclude blocked cells, unwalkable trunks and the surplus strip', () => {
  // 合成地形の設計値。現行の本数は固定しない。右セルは通行地形でも移動不能。
  const world = { bounds: { minX: 0, minZ: 0, maxX: 11, maxZ: 5 }, start: { x: 2, z: 2 } };
  const terrain = { walkable: (x, z) => z !== 1, heightAt: () => 0 };
  const trees = { x: [2, 7, 10.5, 2], z: [2, 2, 2, 1], kind: [0, 1, 2, 1] };
  const a = measureTrees({ world, terrain, trees, col: {}, move: (_c, _t, p) => p });
  assert.deepEqual(a.all, [1, 2, 1]); assert.deepEqual(a.walkable, [1, 1, 1]);
  assert.deepEqual(a.reachable, [1, 0, 0]);
});
