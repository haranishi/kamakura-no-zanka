// Node専用。ゲームと同じ配置と当たりを測定道具で共有する。
import { WORLD } from '../../dist/valley/world-data.js';
import { createTerrain } from '../../dist/valley/terrain-height.js';
import { scatterTrees, scatterRocks } from '../../dist/valley/scatter.js';
import { buildColliders } from '../../dist/valley/collision.js';
import { propColliders, rockColliders } from '../../dist/valley/world-colliders.js';
export function measurementWorld(world = WORLD) {
  const terrain = createTerrain(world), trees = scatterTrees(world, terrain);
  const rocks = scatterRocks(world, terrain), extra = propColliders(world);
  const col = buildColliders({ buildings: world.buildings, props: world.props, trees, bounds: world.bounds,
    extraBoxes: extra.boxes, extraCircles: [...extra.circles, ...rockColliders(rocks)] });
  return { world, terrain, trees, rocks, col };
}
