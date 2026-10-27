// R16 / design-contracts.md「guide.js」。純粋層。nav入力は静的通行判定（主人公を含めない）。
import { buildNavGrid, findPath, nearestWalkable, losClear } from './nav.js';
import { STORY } from './story-data.js';

// 仕様の値: R16.2/16.5、design-contracts.md guide.js。
const HERO_RADIUS = 0.3, OFF_ROAD = 25, WINDOW = 30, PROGRESS = 10, TURN_DEG = 30;
const RELEASE_DISTANCE = 20; // 未測定の設計値。25mから5mの余裕（design-contracts.md）。
const CELL = 0.5, STEP = 0.1; // 未測定の探索設計値。細い畦道の帯と障害物を検査する解像度。
const EPS = 1e-9; // 未測定の数値計算設計値。ゲームの距離閾値には使わない。
const copyPoint = p => ({ x: p.x, z: p.z });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function point(p) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) throw new TypeError('Invalid guide point');
  return copyPoint(p);
}
function finiteTree(v) {
  if (typeof v === 'number' && !Number.isFinite(v)) throw new TypeError('Non-finite guide data');
  if (v && typeof v === 'object') for (const x of Object.values(v)) finiteTree(x);
}
function project(p, a, b) {
  const length = dist(a, b);
  if (!Number.isFinite(length)) throw new TypeError('Guide distance overflow');
  const ux = length ? (b.x - a.x) / length : 0, uz = length ? (b.z - a.z) / length : 0;
  const along = Math.max(0, Math.min(length, (p.x - a.x) * ux + (p.z - a.z) * uz));
  const q = { x: a.x + ux * along, z: a.z + uz * along };
  return { point: q, distance: dist(p, q), along };
}
export function roadDistance(road, pos) {
  point(pos);
  if (!road || !Array.isArray(road.points) || road.points.length < 2) throw new TypeError('Invalid guide road');
  const ps = road.points.map(([x, z]) => point({ x, z }));
  return Math.min(...ps.slice(1).map((b, i) => project(pos, ps[i], b).distance));
}
function validNav(nav) {
  if (!nav || typeof nav.walkable !== 'function') throw new TypeError('Guide needs walkable(x,z)');
  const { minX, minZ, maxX, maxZ } = nav.bounds || {};
  if (![minX, minZ, maxX, maxZ].every(Number.isFinite) || maxX <= minX || maxZ <= minZ ||
      !Number.isFinite(nav.cell ?? CELL) || (nav.cell ?? CELL) <= 0) throw new TypeError('Invalid guide navigation');
}
function inside(nav, p) {
  const b = nav.bounds;
  return p.x >= b.minX && p.z >= b.minZ && p.x < b.maxX && p.z < b.maxZ;
}
function gridFor(nav, band = () => true, road = null) {
  let bounds = nav.bounds;
  if (road) {
    const r = road.halfWidth + HERO_RADIUS, xs = road.points.map(p => p[0]), zs = road.points.map(p => p[1]);
    bounds = { minX: Math.max(bounds.minX, Math.min(...xs) - r), maxX: Math.min(bounds.maxX, Math.max(...xs) + r),
      minZ: Math.max(bounds.minZ, Math.min(...zs) - r), maxZ: Math.min(bounds.maxZ, Math.max(...zs) + r) };
  }
  const cell = nav.cell ?? CELL;
  // セルの四隅も通れるものだけ使い、navのセル判定で実物の壁を切らない。
  const clear = (x, z) => band(x, z) && nav.walkable(x, z);
  return buildNavGrid({ ...bounds, cell, walkable: (x, z) => clear(x, z) &&
    [-1, 1].every(dx => [-1, 1].every(dz => clear(x + dx * cell / 2, z + dz * cell / 2))) });
}
// 道の帯の外（接続区間・目的地の補正）は、世界全体でなく、点のまわりだけの格子で探す。足りなければ広げ、最後は世界全体。
// 世界全体の格子（0.5m・約17万セル）は、最初の1回に約10秒かかった（実測。通れる判定が約110万回）。
const LOCAL_MARGINS = [6, 24];
function gridAround(nav, a, b, margin) {
  const w = nav.bounds;
  const bounds = { minX: Math.max(w.minX, Math.min(a.x, b.x) - margin), maxX: Math.min(w.maxX, Math.max(a.x, b.x) + margin),
    minZ: Math.max(w.minZ, Math.min(a.z, b.z) - margin), maxZ: Math.min(w.maxZ, Math.max(a.z, b.z) + margin) };
  if (!(bounds.maxX > bounds.minX && bounds.maxZ > bounds.minZ)) return gridFor(nav);
  return gridFor({ bounds, cell: nav.cell, walkable: (x, z) => nav.walkable(x, z) });
}
// 狭い格子から順に。最後（world）は世界全体で、呼出側が使い回せるように渡す。
const looseGrids = (nav, a, b, world = () => gridFor(nav)) => [...LOCAL_MARGINS.map(m => () => gridAround(nav, a, b, m)), world];
function connect(nav, a, b, band, grids) {
  const clear = (x, z) => inside(nav, { x, z }) && band(x, z) && nav.walkable(x, z);
  if (losClear(clear, a, b, STEP)) return dist(a, b) ? [a, b] : [a];
  for (const grid of grids) {
    const g = grid();
    let path = findPath(g, a, b);
    if (!path) {
      const end = nearestWalkable(g, b);
      path = end && findPath(g, a, end);
    }
    if (!path) continue;
    path = [a, ...path, b].filter((p, i, ps) => !i || dist(p, ps[i - 1]) > EPS);
    if (path.slice(1).every((p, i) => losClear(clear, path[i], p, STEP))) return path;
  }
  return null;
}
function target(world, objectiveId, plan) {
  const spec = STORY.beats[objectiveId]?.guideTarget;
  const id = spec && typeof spec === 'object' ? spec[plan] : spec;
  if (!id) return null;
  return world.zones[id] || (id === 'boy' ? world.spawns.villagers.find(p => p.id === 'boy') : world.spawns[id]);
}
// 公開データは生の折れ点を保持。fromに一番近い道路区間から入り、未通過点だけを採る。
export function baselineStops(world, { objectiveId, plan = 'front', from }) {
  point(from);
  if (!['front', 'north', 'south'].includes(plan)) throw new TypeError('Invalid guide plan');
  const goal = target(world, objectiveId, plan);
  if (!goal) return null;
  const stops = [];
  const road = (id, indices) => {
    const def = world.roads[id];
    if (!def || !Number.isFinite(def.halfWidth) || def.halfWidth <= 0 || def.points.length < 2) throw new TypeError('Invalid guide road');
    for (const index of indices) {
      const [x, z] = def.points[index];
      stops.push({ road: id, index, point: point({ x, z }) });
    }
  };
  const range = (a, b) => Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => a + Math.sign(b - a) * i);
  const nearestSegment = (id, p) => {
    const ps = world.roads[id].points.map(([x, z]) => point({ x, z }));
    let best = 0, d = Infinity;
    for (let i = 0; i < ps.length - 1; i++) { const n = project(p, ps[i], ps[i + 1]); if (n.distance < d) { best = i; d = n.distance; } }
    return best;
  };
  if (objectiveId === 'b2_road') {
    const entry = nearestSegment('temple', from);
    const ps = world.roads.temple.points.map(([x, z]) => ({ x, z }));
    const first = project(from, ps[entry], ps[entry + 1]).along > EPS ? entry + 1 : entry;
    road('temple', range(first, world.roads.temple.points.length - 1));
    road('forest', range(0, nearestSegment('forest', goal) + 1));
  } else if (objectiveId === 'b3_viewpoint') {
    const first = nearestSegment('forest', from) + 1;
    if (plan === 'front') {
      road('forest', range(first, 10)); road('lane', [0]);
    } else {
      // データ上の空白は connection として明示する。迂回路の全折れ点は省略しない。
      // 既存world-dataの分岐折れ点: 北はforest[8]、南は[7]。
      // forest[9]は正面入口区域内なので、迂回選択の前に正面を成立させない位置で離れる。
      road('forest', range(first, plan === 'north' ? 8 : 7));
      road(plan, range(0, world.roads[plan].points.length - 1));
    }
  } else if (objectiveId === 'b6_escort') {
    road('forest', range(world.roads.forest.points.length - 1, 0));
    road('temple', range(world.roads.temple.points.length - 1, 0));
  }
  const lastRoad = stops.at(-1)?.road;
  const goalRoad = lastRoad && roadDistance(world.roads[lastRoad], goal) <= world.roads[lastRoad].halfWidth + HERO_RADIUS ? lastRoad : null;
  stops.push({ road: goalRoad, index: null, target: true, point: point(goal) });
  return stops;
}

// 一度だけ構築。再開・目的・planが変わったときに呼び直す。viewから毎コマ呼ばない。
export function buildBaseline(world, nav, options) {
  finiteTree(options); validNav(nav);
  const { objectiveId, plan = 'front', from } = options;
  const stops = baselineStops(world, { objectiveId, plan, from });
  if (!stops) return null;
  const paths = [point(from)], mandatory = [], corrections = [], legs = [];
  const grids = new Map();
  const getGrid = id => {
    if (!grids.has(id)) {
      const road = id && world.roads[id];
      grids.set(id, gridFor(nav, road ? (x, z) => roadDistance(road, { x, z }) <= road.halfWidth + HERO_RADIUS : undefined, road));
    }
    return grids.get(id);
  };
  // 帯の外は、狭い格子から順に（最後は世界全体）。
  const loose = (a, b) => looseGrids(nav, a, b, () => getGrid(null));
  const snap = (id, p) => {
    if (id) return nearestWalkable(getGrid(id), p);
    for (const grid of inside(nav, p) ? loose(p, p) : [() => getGrid(null)]) {
      const q = nearestWalkable(grid(), p);
      if (q) return q;
    }
    return null;
  };
  let prevRoad = null;
  for (const stop of stops) {
    let to = stop.point;
    const r = stop.road && world.roads[stop.road];
    const band = r ? (x, z) => roadDistance(r, { x, z }) <= r.halfWidth + HERO_RADIUS : () => true;
    if (!inside(nav, to) || !nav.walkable(to.x, to.z)) {
      to = snap(stop.road, to);
      if (!to) return null;
      corrections.push({ road: stop.road, index: stop.index, original: stop.point, corrected: to, meters: dist(to, stop.point) });
    }
    const a = paths.at(-1);
    // 道間の接続だけ無帯。始点が当該帯内なら最初の区間から帯を守る。
    const inRoad = r && (prevRoad === stop.road || band(a.x, a.z));
    const useBand = inRoad ? band : () => true;
    const id = inRoad ? stop.road : null;
    const path = connect(nav, a, to, useBand, id ? [() => getGrid(id)] : loose(a, to));
    if (!path) return null;
    const startIndex = paths.length - 1;
    for (const p of path.slice(1)) if (dist(paths.at(-1), p) > EPS) paths.push(copyPoint(p));
    legs.push({ kind: inRoad ? 'road' : 'connection', road: inRoad ? stop.road : null, startIndex, endIndex: paths.length - 1 });
    if (stop.road && !stop.target) mandatory.push({ ...stop, corrected: copyPoint(to), pathIndex: paths.length - 1 });
    prevRoad = stop.road;
  }
  if (paths.length === 1) paths.push(copyPoint(paths[0]));
  const cumulative = [0];
  for (let i = 1; i < paths.length; i++) cumulative.push(cumulative[i - 1] + dist(paths[i - 1], paths[i]));
  finiteTree(cumulative);
  const result = { id: JSON.stringify([objectiveId, plan, from.x, from.z, paths]), objectiveId, plan,
    from: copyPoint(from), points: paths, cumulative, length: cumulative.at(-1), mandatory, corrections, legs };
  finiteTree(result);
  return result;
}
function validateBaseline(baseline) {
  finiteTree(baseline);
  if (!baseline || baseline.points?.length < 2 || baseline.cumulative?.length !== baseline.points?.length ||
      !Number.isFinite(baseline.length)) throw new TypeError('Invalid guide baseline');
  baseline.points.forEach(point);
}
function projection(b, pos, low = 0, high = b.points.length - 2, floor = 0) {
  let best = null;
  for (let i = low; i <= high; i++) {
    let p = project(pos, b.points[i], b.points[i + 1]);
    let s = b.cumulative[i] + p.along;
    if (s < floor) {
      const len = b.cumulative[i + 1] - b.cumulative[i];
      const f = len ? (floor - b.cumulative[i]) / len : 0;
      if (f > 1) continue;
      const a = b.points[i], c = b.points[i + 1];
      const q = { x: a.x + (c.x - a.x) * f, z: a.z + (c.z - a.z) * f };
      p = { point: q, distance: dist(pos, q) }; s = floor;
    }
    if (!best || p.distance < best.distance) best = { ...p, segment: i, s };
  }
  return best;
}
function unit(a, b) {
  const d = dist(a, b);
  return d ? { x: (b.x - a.x) / d, z: (b.z - a.z) / d } : { x: 0, z: 0 };
}
export function directions(baseline, pos, segment = 0) {
  validateBaseline(baseline); point(pos);
  if (!Number.isInteger(segment) || segment < 0 || segment >= baseline.points.length - 1) throw new TypeError('Invalid guide segment');
  let next = segment + 1;
  while (next < baseline.points.length - 1 && dist(pos, baseline.points[next]) <= EPS) next++;
  const along = unit(pos, baseline.points[next]), direct = unit(pos, baseline.points.at(-1));
  const angleDeg = Math.hypot(along.x, along.z) && Math.hypot(direct.x, direct.z)
    ? Math.acos(Math.max(-1, Math.min(1, along.x * direct.x + along.z * direct.z))) * 180 / Math.PI : 0;
  return { along, direct, angleDeg, direction: angleDeg + EPS >= TURN_DEG ? along : direct, next: copyPoint(baseline.points[next]) };
}
// 復帰用経路を返すだけ。assessには渡さない。呼出側が0.5秒ごとに要求する（仕様の値）。
export function buildRecovery(baseline, nav, { pos, progress = 0 }) {
  validateBaseline(baseline); validNav(nav); point(pos);
  if (!Number.isFinite(progress) || progress < 0 || progress > baseline.length) throw new TypeError('Invalid guide progress');
  const p = projection(baseline, pos, 0, baseline.points.length - 2, progress);
  if (!p) return null;
  const path = connect(nav, pos, p.point, () => true, looseGrids(nav, pos, p.point));
  return path ? { points: [...path, ...baseline.points.slice(p.segment + 1).map(copyPoint)], join: p.point, segment: p.segment, progress: p.s } : null;
}
// state=nullで開始。入力・状態を変更しない。返り値は {state, offRoad, remaining, stalled, emphasized, direction, ...}。
export function assess(baseline, state, observation) {
  finiteTree(observation); finiteTree(state);
  const { t, pos, mode, objectiveId, plan, baselineId } = observation;
  if (!Number.isFinite(t) || t < 0 || !['free', 'combat', 'dialogue', 'paused', 'result'].includes(mode)) throw new TypeError('Invalid guide observation');
  point(pos);
  if (!objectiveId || !baseline) return null;
  validateBaseline(baseline);
  if (baselineId !== baseline.id || objectiveId !== baseline.objectiveId || plan !== baseline.plan) throw new TypeError('Guide baseline does not match observation');
  const key = JSON.stringify([objectiveId, plan, baselineId]);
  const reset = !state || state.key !== key || t < state.t || mode === 'result';
  const prev = reset ? null : state;
  if (prev && (!Number.isInteger(prev.segment) || prev.segment < 0 || prev.segment >= baseline.points.length - 1 ||
      !Array.isArray(prev.history) || !Number.isFinite(prev.clock) || !Number.isFinite(prev.t))) throw new TypeError('Invalid guide state');
  const p = projection(baseline, pos, prev ? Math.max(0, prev.segment - 1) : 0,
    prev ? Math.min(baseline.points.length - 2, prev.segment + 1) : baseline.points.length - 2);
  const remaining = baseline.length - p.s;
  const distance = projection(baseline, pos).distance; // 復帰路ではなく固定基準路全体への距離。
  let history = prev && mode === 'free' && prev.mode === 'free' ? prev.history.map(h => ({ ...h })) : [];
  const clock = (prev?.clock || 0) + (mode === 'free' && prev?.mode === 'free' ? t - prev.t : 0);
  let stalled = false, progress30 = null;
  if (mode === 'free') {
    if (history.at(-1)?.t === clock) history.pop();
    history.push({ t: clock, remaining });
    const start = clock - WINDOW;
    while (history.length > 1 && history[1].t <= start) history.shift();
    if (history[0].t <= start) {
      const a = history[0], b = history[1] || a;
      const f = b.t === a.t ? 0 : (start - a.t) / (b.t - a.t);
      progress30 = a.remaining + (b.remaining - a.remaining) * f - remaining;
      stalled = progress30 < PROGRESS;
    }
  }
  const offRoad = distance >= OFF_ROAD;
  let emphasized = prev?.emphasized || false;
  if (mode === 'free') {
    if (offRoad || stalled) emphasized = true;
    if (distance < RELEASE_DISTANCE && progress30 !== null && progress30 >= PROGRESS) emphasized = false;
  }
  const facing = directions(baseline, pos, p.segment);
  const nextState = { key, t, mode, clock, segment: p.segment, progress: Math.max(prev?.progress || 0, p.s), history, emphasized };
  const result = { state: nextState, offRoad, distance, remaining, stalled, emphasized: mode === 'free' && emphasized,
    direction: facing.direction, directions: facing, progress30 };
  finiteTree(result);
  return result;
}
