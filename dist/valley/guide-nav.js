// ゲームとNode検査で共有する静的通行判定。主人公半径はguide契約の0.3m。
import { nearestFree } from './collision.js';
export function createGuideNav({ world, terrain, col }) {
  const cache = new Map();
  return { bounds: world.bounds, walkable(x, z) {
    const key = `${x},${z}`;
    if (!cache.has(key)) cache.set(key, nearestFree(col, terrain, x, z, 0.3, 0) !== null);
    return cache.get(key);
  } };
}
