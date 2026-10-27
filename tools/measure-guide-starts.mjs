import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORY } from '../dist/valley/story-data.js';
import { createQuest, reduce } from '../dist/valley/quest.js';
import { buildNavGrid, findPath, nearestWalkable } from '../dist/valley/nav.js';
import { nearestFree } from '../dist/valley/collision.js';
import { measurementWorld } from './lib/measurement-world.mjs';
const point = p => ({ x: p.x, z: p.z });
const distance = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
export function measureGuideStarts() {
  const { world: w, terrain, col } = measurementWorld();
  // design-contracts.md navの仕様値2m。clearance=.45、目標補正半径12mは現行ai-world.jsの値。
  const grid = buildNavGrid({ ...w.bounds, cell: 2, walkable: (x, z) => nearestFree(col, terrain, x, z, 0.45, 0) !== null });
  const events = [{ type: 'enter_zone', zone: 'temple_yard' }, { type: 'dialogue_end', id: 'boy_arrives' },
    { type: 'arrived', place: 'viewpoint' }, { type: 'choose_plan', plan: 'front' },
    { type: 'enter_zone', zone: 'village_front' }, { type: 'enemy_down', id: 'officer', how: 'killed' },
    { type: 'interact', id: 'archer_captive' }, { type: 'party_joined', id: 'archer' },
    { type: 'enter_zone', zone: 'ambush_trigger' },
    ...STORY.groups.escort_ambush.map(id => ({ type: 'enemy_down', id, how: 'killed' })),
    { type: 'arrived', place: 'temple_steps' }];
  let quest = createQuest();
  const states = new Map([[quest.beat, quest]]);
  for (const e of events) { quest = reduce(quest, e).state; states.set(quest.beat, quest); }
  const z = w.zones, cp = w.checkpoints, rows = [];
  function row(beat, variant, start, destination, marker, note = '') {
    const state = states.get(beat);
    if (!state) throw Error(`quest did not reach ${beat}`);
    const from = point(start), target = point(destination);
    let end = target, route = findPath(grid, from, end);
    if (!route) { end = nearestWalkable(grid, target, 12); route = end && findPath(grid, from, end); }
    if (!route?.length) throw Error(`no nav path for ${beat}/${variant}`);
    // navが始点を補正した分も計上する。これは道路必須点を守る未実装guideの距離ではない。
    const fullPath = [from, ...route];
    const firstTurn = fullPath.find(p => distance(from, p) > 0) || target;
    const directYaw = Math.atan2(target.x - from.x, target.z - from.z);
    const routeYaw = Math.atan2(firstTurn.x - from.x, firstTurn.z - from.z);
    const angleDeg = distance(from, target) === 0 ? 0 : Math.abs(Math.atan2(Math.sin(routeYaw - directYaw), Math.cos(routeYaw - directYaw))) * 180 / Math.PI;
    rows.push({ beat, variant, objective: state.story.beats[beat].objective, marker: marker && point(marker),
      start: from, destination: target, navEnd: point(end), correctionM: distance(target, end),
      straightM: distance(from, target), roadM: fullPath.slice(1).reduce((n, p, i) => n + distance(fullPath[i], p), 0),
      firstTurn: point(firstTurn), angleDeg, path: fullPath, note });
  }
  row('b0_temple', 'default', w.start, z.temple_yard, z.temple_yard);
  const boy = w.spawns.villagers.find(n => n.id === 'boy');
  row('b1_boy', 'default', z.temple_yard, boy, boy, '穂太の静的spawn。実行時の接近・着席で位置は変わる');
  row('b2_road', 'default', cp.cp_leave_temple, z.viewpoint, z.viewpoint);
  for (const entry of ['front', 'north', 'south']) {
    const entrance = z['village_' + entry];
    row('b3_viewpoint', entry, cp.cp_viewpoint, entrance, entry === 'front' ? z.village_front : z.village_north,
      '現行markerはflankなら北。南専用markerはまだない');
    const nearestEnemy = [...w.spawns.village_enemies].sort((a, b) => distance(entrance, a) - distance(entrance, b))[0];
    row('b4_village', entry, entrance, { x: w.flats.find(f => f.id === 'village').x, z: w.flats.find(f => f.id === 'village').z }, nearestEnemy,
      '到達点は里中心（測定用）。現行markerは最寄りの生存敵。中心到達は任務達成ではない');
  }
  row('b5_archer', 'default', w.flats.find(f => f.id === 'village'), w.spawns.captive, w.spawns.captive);
  row('b6_escort', 'default', cp.cp_archer_joined, z.temple_steps, z.temple_steps);
  row('b7_result', 'default', z.temple_steps, cp.cp_result, null, '現行はmarkerなし。到達点は結果checkpointを測定上の代替とする');
  return { note: '現行navの最短経路（XZ距離m）。道路必須点の新guideとは異なる。開始点・b4/b7到達点は未測定の検査設計。markerはgame.objectiveTargetの静的初期値。', rows };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = measureGuideStarts();
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else { console.log(result.note); console.table(result.rows.map(({ path: _path, ...r }) => ({ ...r, marker: JSON.stringify(r.marker), start: JSON.stringify(r.start), destination: JSON.stringify(r.destination), navEnd: JSON.stringify(r.navEnd), firstTurn: JSON.stringify(r.firstTurn) }))); }
}
