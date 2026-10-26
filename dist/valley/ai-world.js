// ai-world.js — 敵・仲間のAIに渡す「世界」（app層）。歩ける格子・経路（キャッシュつき）・見通し・近接の同時攻撃の札。
// 論理モジュール（enemy-ai / companion-ai）は毎回 pathTo を呼ぶので、ここで主体ごとに経路を使い回して負荷を抑える。
import { buildNavGrid, findPath, nearestWalkable } from './nav.js';
import { nearestFree, segmentBlocked } from './collision.js';

const EYE = 1.5, CHEST = 1.2;

export function createAIWorld({ terrain, col, bounds, now, cell = 2, clearance = 0.45 }) {
  const grid = buildNavGrid({ minX: bounds.minX, minZ: bounds.minZ, maxX: bounds.maxX, maxZ: bounds.maxZ, cell, walkable: (x, z) => nearestFree(col, terrain, x, z, clearance, 0) !== null });
  const walkable = (x, z) => {
    const ix = Math.floor((x - grid.minX) / cell), iz = Math.floor((z - grid.minZ) / cell);
    return ix >= 0 && iz >= 0 && ix < grid.width && iz < grid.height && grid.cells[iz * grid.width + ix];
  };
  const paths = new Map(), sights = new Map();

  function pathTo(from, goal) {
    const key = from.id ?? 'anon', t = now();
    let e = paths.get(key);
    if (!e || t - e.t > 0.45 || Math.hypot(goal.x - e.goal.x, goal.z - e.goal.z) > 1.5 || !e.path) {
      let path = findPath(grid, { x: from.x, z: from.z }, { x: goal.x, z: goal.z });
      if (!path) {
        // 目的地が木や壁の中なら、近くの歩ける所へ寄せる
        const near = nearestWalkable(grid, goal, 12);
        if (near) path = findPath(grid, { x: from.x, z: from.z }, near);
      }
      e = { t, goal: { x: goal.x, z: goal.z }, path };
      paths.set(key, e);
    }
    const p = e.path;
    if (!p) return null;
    // 通り過ぎた折れ点は捨てる（経路は毎フレーム作り直さないので、先頭が背後に残らないように）
    while (p.length > 1 && Math.hypot(p[0].x - from.x, p[0].z - from.z) < 0.9) p.shift();
    return p;
  }

  function los(a, b) {
    const key = (a.id ?? 'a') + '|' + (b.id ?? 'b'), t = now();
    const hit = sights.get(key);
    if (hit && t - hit.t < 0.1) return hit.v;
    const v = !segmentBlocked(col, terrain,
      { x: a.x, y: terrain.heightAt(a.x, a.z) + EYE, z: a.z }, { x: b.x, y: terrain.heightAt(b.x, b.z) + CHEST, z: b.z });
    sights.set(key, { t, v });
    return v;
  }

  return {
    grid, walkable, pathTo, los,
    forget(id) { paths.delete(id); },
    clear() { paths.clear(); sights.clear(); },
    // 近接の同時攻撃を制限する共有の札
    createTokens(max = 2) {
      const held = new Set();
      return {
        held, max,
        tryAcquire(id) { if (held.has(id)) return true; if (held.size >= max) return false; held.add(id); return true; },
        release(id) { held.delete(id); },
        reset() { held.clear(); },
      };
    },
  };
}
