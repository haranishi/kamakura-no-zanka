// ゲームとNode検査で共有する静的通行判定。主人公半径はguide契約の0.3m。
// freeAt は nearestFree(col, terrain, x, z, 0.3, 0) !== null と同じ真偽で、約2倍速い（tests/valley-guide-world.test.mjs で照合）。
import { freeAt } from './collision.js';
export function createGuideNav({ world, terrain, col }) {
  const cache = new Map();
  return { bounds: world.bounds, walkable(x, z) {
    const key = `${x},${z}`;
    if (!cache.has(key)) cache.set(key, freeAt(col, terrain, x, z, 0.3));
    return cache.get(key);
  } };
}
