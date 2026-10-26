// 隠れ谷の世界の整合：配置・通行・経路・台詞・動作表。見た目に出る前に、データの矛盾をここで落とす。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WORLD } from '../dist/valley/world-data.js';
import { createTerrain } from '../dist/valley/terrain-height.js';
import { scatterTrees, scatterRocks, insideFootprint, insidePlot, scatterCrops } from '../dist/valley/scatter.js';
import { buildColliders, nearestFree, moveActor } from '../dist/valley/collision.js';
import { propColliders, rockColliders, ROCK_MODEL } from '../dist/valley/world-colliders.js';
import { createAIWorld } from '../dist/valley/ai-world.js';
import { STORY } from '../dist/valley/story-data.js';
import { LOCOMOTION, MOVE_CLIPS, ACTION_CLIPS, GAITS, pickGait, segmentFor, locomotionTimeScale, CLIP_SEGMENTS } from '../dist/valley/anim-data.js';
import { MOVES } from '../dist/valley/combat.js';

const terrain = createTerrain(WORLD);
const trees = scatterTrees(WORLD, terrain);
const extra = propColliders(WORLD);
const allRocks = scatterRocks(WORLD, terrain);
// ゲームと同じく、岩の当たりも入れる（通行・経路・置き場の検査がすべて岩を避ける）
const col = buildColliders({ buildings: WORLD.buildings, props: WORLD.props, trees, bounds: WORLD.bounds, extraCircles: [...extra.circles, ...rockColliders(allRocks)], extraBoxes: extra.boxes });
let clock = 0;
const ai = createAIWorld({ terrain, col, bounds: WORLD.bounds, now: () => clock });
const free = p => nearestFree(col, terrain, p.x, p.z, 0.35, 0) !== null;
const inBounds = p => p.x >= WORLD.bounds.minX && p.x <= WORLD.bounds.maxX && p.z >= WORLD.bounds.minZ && p.z <= WORLD.bounds.maxZ;

test('every spawn, zone center, checkpoint, start and exit is inside the walkable bounds and not inside an obstacle', () => {
  const points = [['start', WORLD.start], ['exit', WORLD.exit]];
  for (const [id, z] of Object.entries(WORLD.checkpoints)) points.push([id, z]);
  for (const [group, list] of Object.entries(WORLD.spawns)) for (const s of [].concat(list)) {
    if (s.door) { for (const [k, v] of [['door', s.door], ['spot', s.spot], ...(s.route || []).map((r, i) => ['route' + i, r])]) points.push([`${group}:${s.id} ${k}`, { x: v[0], z: v[1] }]); }   // 家から出てくる人は戸口・持ち場・巡る道の点で見る
    else points.push([group + ':' + s.id, s]);
  }
  for (const [name, z] of Object.entries(WORLD.zones)) points.push(['zone ' + name, z]);
  for (const [name, p] of points) {
    assert(inBounds(p), `${name} is outside the bounds`);
    assert(terrain.walkable(p.x, p.z), `${name} is not walkable terrain`);
    // 区画の中心が岩や建物の中にある場合だけは、近くに歩ける所があればよい（見晴らし岩の中心など）
    if (name.startsWith('zone ')) assert(nearestFree(col, terrain, p.x, p.z, 0.35, 8) !== null, `${name}: nothing walkable within 8 m`);
    else assert(free(p), `${name} is inside an obstacle`);
  }
});

test('the whole route can be walked: temple → yard → viewpoint → village (3 entrances) → captive → ambush → temple steps', () => {
  const legs = [['start', 'temple_yard'], ['temple_yard', 'viewpoint'], ['viewpoint', 'village_front'], ['viewpoint', 'village_north'], ['viewpoint', 'village_south'],
    ['village_front', 'captive'], ['village_north', 'captive'], ['village_south', 'captive'], ['captive', 'ambush_trigger'], ['ambush_trigger', 'temple_steps']];
  const at = n => n === 'start' ? WORLD.start : n === 'captive' ? WORLD.spawns.captive : WORLD.zones[n];
  for (const [a, b] of legs) {
    const from = nearestFree(col, terrain, at(a).x, at(a).z, 0.45, 10), to = nearestFree(col, terrain, at(b).x, at(b).z, 0.45, 10);
    assert(from && to, `${a} → ${b}: no walkable end`);
    ai.clear();
    const path = ai.pathTo({ id: 't', ...from }, to);
    assert(path && path.length > 0, `${a} → ${b}: no path`);
    // 経路の各線分が壁・水に触れない（始点が障害物のそばの塞がったマスにあるときのため、始点から1.5m以内は数えない）
    let p = from;
    for (const q of path) {
      for (let k = 1; k <= 20; k++) {
        const x = p.x + (q.x - p.x) * k / 20, z = p.z + (q.z - p.z) * k / 20;
        if (Math.hypot(x - from.x, z - from.z) < 1.5) continue;
        assert(ai.walkable(x, z), `${a} → ${b}: path crosses a blocked cell at ${x.toFixed(1)},${z.toFixed(1)}`);
      }
      p = q;
    }
    assert(Math.hypot(p.x - to.x, p.z - to.z) < 3, `${a} → ${b}: path ends ${Math.hypot(p.x - to.x, p.z - to.z).toFixed(1)} m from the goal`);   // 目的地が塞がったマスなら、近くの歩けるマスへ寄せる
  }
});

test('an enemy can reach the exit from every village spawn (else it would surrender instead of fleeing)', () => {
  for (const s of WORLD.spawns.village_enemies) {
    ai.clear();
    const path = ai.pathTo({ id: s.id, x: s.x, z: s.z }, WORLD.exit);
    assert(path && path.length, `${s.id} cannot reach the exit`);
  }
});

test('the ambushers can reach the temple steps (the ambush starts there when the hero skips the road)', () => {
  const steps = WORLD.zones.temple_steps;
  for (const s of WORLD.spawns.escort_ambush) {
    ai.clear();
    const path = ai.pathTo({ id: s.id, x: s.x, z: s.z }, { x: steps.x, z: steps.z });
    assert(path && path.length, `${s.id} cannot reach the temple steps`);
    const end = path[path.length - 1];
    assert(Math.hypot(end.x - steps.x, end.z - steps.z) < steps.r, `${s.id}: path ends ${Math.hypot(end.x - steps.x, end.z - steps.z).toFixed(1)} m from the steps`);
  }
});

test('no big rock stands in the village flat, on a road shoulder or in a story zone, and every big rock blocks movement', () => {
  const rocks = scatterRocks(WORLD, terrain), village = WORLD.flats.find(f => f.id === 'village');
  const wide = i => Math.max(ROCK_MODEL.width * rocks.s[i] * rocks.sx[i], ROCK_MODEL.depth * rocks.s[i] * rocks.sz[i]);
  for (let i = 0; i < rocks.x.length; i++) {
    if (wide(i) < 2.5) continue;
    const x = rocks.x[i], z = rocks.z[i], at = `rock ${i} (${x.toFixed(1)},${z.toFixed(1)}) width ${wide(i).toFixed(1)}m`;
    assert(!(Math.abs(x - village.x) < village.hx && Math.abs(z - village.z) < village.hz), `${at} stands in the village flat`);
    for (const [name, zone] of Object.entries(WORLD.zones)) assert(Math.hypot(x - zone.x, z - zone.z) > zone.r + wide(i) / 2, `${at} stands in zone ${name}`);
    const road = terrain.roadInfo(x, z); assert(!road || road.dist > 4, `${at} sits on a road shoulder`);
  }
  // 林道の斥候と戦う所（巡回路の10m以内）には、幅1.3mを超える岩を置かない（カメラの脇で画面を塞ぐ）
  for (const sc of WORLD.spawns.road_scout) for (const [px, pz] of sc.patrol) for (let i = 0; i < rocks.x.length; i++) {
    if (Math.hypot(rocks.x[i] - px, rocks.z[i] - pz) < 10) assert(wide(i) <= 1.3, `rock ${i} (${rocks.x[i].toFixed(1)},${rocks.z[i].toFixed(1)}) is ${wide(i).toFixed(1)}m wide beside the scout fight`);
  }
  // 幅1.4m以上の岩には当たりが付く（岩の中へ入れない）
  const circles = rockColliders(rocks), bigCount = rocks.x.filter((_, i) => wide(i) >= 1.4).length;
  assert.equal(new Set(circles.map(o => o.rock)).size, bigCount, 'every big rock has a collider'); assert(circles.length > 20, 'the valley should have rocks that block');
  // 実際に止まる：大きく細長い岩の長い軸の端から、中心へ向かって歩くと、見た目の端で止まる（半径を0にしても、game から登録を外しても、円を1つに戻しても、ここで落ちる）。
  // 端の外が歩けない場所（谷の外・急な斜面）では検査にならないので、反対へ歩けることを確かめた岩だけを数える。
  const order = [...rocks.x.keys()].filter(i => wide(i) >= 3 && wide(i) / Math.min(ROCK_MODEL.width * rocks.s[i] * rocks.sx[i], ROCK_MODEL.depth * rocks.s[i] * rocks.sz[i]) >= 1.4).sort((a, b) => wide(b) - wide(a));
  let checked = 0;
  for (const big of order) {
    const w = ROCK_MODEL.width * rocks.s[big] * rocks.sx[big], d = ROCK_MODEL.depth * rocks.s[big] * rocks.sz[big], L = Math.max(w, d), rot = rocks.rot[big];
    const along = w >= d ? [Math.cos(rot), -Math.sin(rot)] : [Math.sin(rot), Math.cos(rot)], cx = rocks.x[big], cz = rocks.z[big];
    const start = { x: cx + along[0] * (L / 2 + 4), z: cz + along[1] * (L / 2 + 4) }; start.y = terrain.heightAt(start.x, start.z);
    const walk = (dir, n) => { let p = { ...start }; for (let g = 0; g < n; g++) { const r = moveActor(col, terrain, p, dir[0] * 0.1, dir[1] * 0.1, 0.3); p = { x: r.x, y: r.y, z: r.z }; } return p; };
    const away = walk(along, 30);
    if (Math.hypot(away.x - start.x, away.z - start.z) < 2.5) continue;                         // そこは歩けない
    const p = walk([-along[0], -along[1]], 80), t = Math.abs((p.x - cx) * along[0] + (p.z - cz) * along[1]);
    assert(t >= L / 2 - 0.4, `walked ${(L / 2 - t).toFixed(2)} m into the rock at (${cx.toFixed(0)},${cz.toFixed(0)}) (${L.toFixed(1)} m long) along its long axis`);
    if (++checked >= 3) break;
  }
  assert(checked >= 1, 'no big elongated rock had walkable ground at its end to test against');
});

test('people who come out of their houses can walk from the door to their spot and along their route', () => {
  assert(WORLD.spawns.revived.length >= 3, 'the revived village needs people');
  for (const r of WORLD.spawns.revived) {
    const legs = [[r.door, r.spot], ...(r.route ? r.route.slice(1).map((p, i) => [r.route[i], p]) : [])];
    for (const [a, b] of legs) {
      if (a[0] === b[0] && a[1] === b[1]) continue;
      ai.clear();
      const path = ai.pathTo({ id: r.id, x: a[0], z: a[1] }, { x: b[0], z: b[1] });
      assert(path && path.length, `${r.id}: no path ${a} → ${b}`);
      const end = path[path.length - 1];
      assert(Math.hypot(end.x - b[0], end.z - b[1]) < 1.5, `${r.id}: path ends ${Math.hypot(end.x - b[0], end.z - b[1]).toFixed(1)} m short of ${b}`);
    }
    if (r.face) assert(WORLD.spawns.revived.some(o => o.id === r.face), `${r.id} faces nobody (${r.face})`);
  }
  const ids = WORLD.spawns.revived.map(r => r.id).concat(WORLD.spawns.villagers.map(v => v.id));
  assert.equal(new Set(ids).size, ids.length, 'villager ids must be unique');
});

// 道の中心線を、操作と同じ移動の規則（斜度・段差・壁・水）で端から端まで歩く。道の継ぎ目の段・道の上の置き物を落とす。
test('every road can be walked end to end with the real movement rule (no cliff at a seam, nothing standing on the road)', () => {
  const barricades = WORLD.distant.filter(d => d.collider);                         // 東の口の馬防柵だけは道を塞ぐ設計
  for (const road of terrain.roads) {
    let pos = { x: road.line[0].x, y: terrain.heightAt(road.line[0].x, road.line[0].z), z: road.line[0].z };
    walk: for (let i = 1; i < road.line.length; i++) {
      const tx = road.line[i].x, tz = road.line[i].z;
      for (let g = 0; g < 400; g++) {
        const dx = tx - pos.x, dz = tz - pos.z, d = Math.hypot(dx, dz);
        if (d < 0.25) break;
        const st = Math.min(0.12, d), r = moveActor(col, terrain, pos, dx / d * st, dz / d * st, 0.3, {});
        if (r.blocked) {
          const byDesign = r.blocked === 'wall' && barricades.some(b => Math.hypot(pos.x - b.x, pos.z - b.z) < 6);
          assert(byDesign, `${road.id}: blocked (${r.blocked}) at ${pos.x.toFixed(1)},${pos.z.toFixed(1)}`);
          break walk;
        }
        pos = { x: r.x, y: r.y, z: r.z };
      }
    }
  }
});

test('buildings, props and vegetable plots do not overlap each other or stand on a road', () => {
  const pts = b => { const out = [], c = Math.cos(b.rotY), sn = Math.sin(b.rotY); for (let u = -b.footprint.w / 2; u <= b.footprint.w / 2; u += 1) for (let v = -b.footprint.d / 2; v <= b.footprint.d / 2; v += 1) out.push({ x: b.x + u * c + v * sn, z: b.z - u * sn + v * c }); return out; };
  const bs = WORLD.buildings.filter(b => b.footprint);
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) for (const p of pts(bs[i])) assert(!insideFootprint(bs[j], p.x, p.z, 1.0), `${bs[i].id} overlaps ${bs[j].id}`);
  for (const p of WORLD.props) {
    for (const b of bs) assert(!insideFootprint(b, p.x, p.z, (p.r || 0.5) + 0.3), `prop ${p.id} is inside building ${b.id}`);
    for (const f of WORLD.plots) assert(!insidePlot(f, p.x, p.z, (p.r || 0.5)), `prop ${p.id} stands in ${f.id}`);
    for (const o of WORLD.props) if (o !== p) assert(Math.hypot(p.x - o.x, p.z - o.z) >= (p.r || 0.5) + (o.r || 0.5) - 0.01, `props ${p.id} and ${o.id} overlap`);
  }
  for (const f of WORLD.plots) for (const b of bs) for (const p of [{ x: f.x, z: f.z }, { x: f.x + f.hx, z: f.z + f.hz }, { x: f.x - f.hx, z: f.z - f.hz }]) assert(!insideFootprint(b, p.x, p.z, 1.0), `${f.id} touches ${b.id}`);
  const clear = (x, z, margin) => { for (const r of terrain.roads) { const n = r.index.nearest(x, z, r.half + margin + 3); if (n.d < r.half + margin) return false; } return true; };
  for (const b of bs) if (b.kind !== 'temple') for (const p of pts(b)) assert(clear(p.x, p.z, 0.3), `${b.id} stands on a road at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
  for (const f of WORLD.plots) assert(clear(f.x, f.z, 0.2), `${f.id} stands on a road`);
  const crops = scatterCrops(WORLD, terrain); assert(crops.x.length > 300, 'the plots should have plants');
});

test('decorations do not overlap buildings, and fences stay clear of roads the hero must use', () => {
  const insideBuilding = (x, z) => WORLD.buildings.some(b => { const dx = x - b.x, dz = z - b.z, c = Math.cos(b.rotY), s = Math.sin(b.rotY), u = dx * c - dz * s, v = dx * s + dz * c; return Math.abs(u) < b.footprint.w / 2 + 0.3 && Math.abs(v) < b.footprint.d / 2 + 0.3; });
  for (const d of WORLD.dress) {
    const pts = d.kind === 'fence_line' ? [d.from, d.to, [(d.from[0] + d.to[0]) / 2, (d.from[1] + d.to[1]) / 2]] : [[d.x, d.z]];
    for (const [x, z] of pts) { assert(!insideBuilding(x, z), `${d.kind} at ${x},${z} is inside a building`); assert(terrain.waterAt(x, z) < 0.05, `${d.kind} at ${x},${z} is in water`); }
    if (d.kind === 'fence_line') for (const [id, road] of Object.entries(WORLD.roads)) {
      if (!['forest', 'lane'].includes(id)) continue;
      for (let i = 1; i < road.points.length; i++) for (let k = 0; k <= 8; k++) {
        const a = road.points[i - 1], b = road.points[i], x = a[0] + (b[0] - a[0]) * k / 8, z = a[1] + (b[1] - a[1]) * k / 8;
        const t = ((x - d.from[0]) * (d.to[0] - d.from[0]) + (z - d.from[1]) * (d.to[1] - d.from[1])) / (Math.hypot(d.to[0] - d.from[0], d.to[1] - d.from[1]) ** 2), tt = Math.max(0, Math.min(1, t));
        const px = d.from[0] + (d.to[0] - d.from[0]) * tt, pz = d.from[1] + (d.to[1] - d.from[1]) * tt;
        assert(Math.hypot(px - x, pz - z) > road.halfWidth + 0.8, `fence ${d.from}→${d.to} blocks the ${id} road`);
      }
    }
  }
});

test('walking into a fence, a building and a tree stops the hero instead of passing through', () => {
  const fence = extra.boxes.find(b => b.id === 'fence');
  const start = { x: fence.x + Math.sin(fence.rotY) * 2, z: fence.z + Math.cos(fence.rotY) * 2, y: 0 };
  start.y = terrain.heightAt(start.x, start.z);
  let pos = start;
  for (let i = 0; i < 40; i++) { const r = moveActor(col, terrain, pos, -Math.sin(fence.rotY) * 0.2, -Math.cos(fence.rotY) * 0.2, 0.3); pos = r; }
  assert(Math.hypot(pos.x - fence.x, pos.z - fence.z) > 0.25, 'the hero walked through the fence');
});

test('every dialogue line is short (≤ 40 characters), has a speaker, and every referenced dialogue exists', () => {
  for (const [id, lines] of Object.entries(STORY.dialogues)) {
    assert(lines.length > 0, id);
    for (const l of lines) { assert(l.speaker && l.text, id); assert([...l.text].length <= 40, `${id}: "${l.text}" is ${[...l.text].length} characters`); }
  }
  for (const [k, lines] of Object.entries(STORY.barks)) for (const t of lines) assert([...t].length <= 14, `bark ${k}: ${t}`);
  for (const id of ['boy_arrives', 'viewpoint_overlook', 'village_cleared', 'archer_joins', 'ambush_cleared', 'result']) assert(STORY.dialogues[id], id);
});

test('every animation clip the game plays exists for the characters that play it', () => {
  const meta = JSON.parse(fs.readFileSync(new URL('../dist/assets/characters/clips.json', import.meta.url)));
  const has = (who, clip) => assert(meta.characters[who].clips.includes(clip), `${who} lacks clip ${clip}`);
  const loco = (who, styles) => { for (const s of styles) for (const [k, name] of Object.entries(LOCOMOTION[s])) if (k !== 'idleFreeze') has(who, name); };
  loco('hero', ['relaxed', 'guard', 'crouch']); loco('soldier', ['relaxed', 'guard']); loco('officer', ['relaxed', 'guard']); loco('archer', ['injured', 'relaxed']);
  for (const w of ['villager_m', 'villager_f', 'child']) loco(w, ['villager']);
  for (const m of ['light1', 'light2', 'light3', 'heavy', 'finisher']) has('hero', MOVE_CLIPS[m].clip);
  for (const m of ['soldier_slash', 'soldier_thrust', 'archer_shot']) has('soldier', MOVE_CLIPS[m].clip);
  for (const m of ['officer_a', 'officer_b', 'officer_c']) has('officer', MOVE_CLIPS[m].clip);
  has('archer', MOVE_CLIPS.ally_shot.clip);
  for (const a of ['dodge', 'stagger', 'die', 'die2', 'hit', 'hit2', 'wake', 'getup']) has('hero', ACTION_CLIPS[a].clip);
  for (const w of ['soldier', 'officer']) for (const a of ['hit', 'hit2', 'hit_waist', 'die', 'die2']) has(w, ACTION_CLIPS[a].clip);
  for (const c of ['Two_Handed_Parry']) has('hero', c);
  for (const c of ['Kneel_on_One_Knee_and_Stand']) for (const w of ['soldier', 'officer', 'archer']) has(w, c);
  for (const c of ['Knock_Down', 'Stand_Up2', 'Sit_Cross_Legged_on_Floor']) has('archer', c);
  for (const c of ['Pull_Radish', 'Stand_and_Chat', 'Talk_with_Hands_Open', 'Sit_Cross_Legged_on_Floor', 'Long_Breathe_and_Look_Around']) { has('villager_m', c); has('villager_f', c); }
  has('child', 'Catching_Breath'); has('child', 'Sit_Cross_Legged_on_Floor');
  for (const s of WORLD.spawns.village_enemies.concat(WORLD.spawns.escort_ambush, WORLD.spawns.road_scout)) if (s.idleClip) has(s.kind === 'officer' ? 'officer' : 'soldier', s.idleClip);
  // 技ごとの動作の時間割：当たりの秒が動作の長さの中にある
  for (const [id, mv] of Object.entries(MOVE_CLIPS)) {
    const who = id.startsWith('officer') ? 'officer' : id.startsWith('soldier') || id === 'archer_shot' ? 'soldier' : id === 'ally_shot' ? 'archer' : 'hero';
    const c = meta.clips[mv.clip]; assert(c, `${mv.clip} not in clips.json`);
    const seg = segmentFor(c, { windup: MOVES[id].windup, active: MOVES[id].active, recover: MOVES[id].recover }, CLIP_SEGMENTS[mv.clip]);
    assert(seg.from >= 0 && seg.to <= c.seconds + 1e-6 && seg.to > seg.from && seg.speed >= 0.55 && seg.speed <= 2.5, `${id}/${who}: bad segment ${JSON.stringify(seg)}`);
  }
});

test('gait selection switches with hysteresis and the playback speed stays in range', () => {
  assert.equal(pickGait('idle', 0), 'idle');
  assert.equal(pickGait('idle', GAITS.walkUp + 0.01), 'walk');
  assert.equal(pickGait('walk', GAITS.walkDown + 0.01), 'walk');          // 戻る境は上がる境より低い
  assert.equal(pickGait('walk', GAITS.walkDown - 0.01), 'idle');
  assert.equal(pickGait('walk', GAITS.jogUp + 0.01), 'jog');
  assert.equal(pickGait('jog', GAITS.jogDown + 0.01), 'jog');
  assert.equal(pickGait('jog', GAITS.runUp + 0.01), 'run');
  assert.equal(pickGait('run', GAITS.runDown + 0.01), 'run');
  assert.equal(pickGait('run', GAITS.runDown - 0.01), 'jog');
  assert.equal(locomotionTimeScale(0.01, 1.2), 0.55); assert.equal(locomotionTimeScale(100, 1.2), 2); assert.equal(locomotionTimeScale(2, 0.1), 1);
});

test('the bow shot segment lands the release on the combat active phase', () => {
  const meta = JSON.parse(fs.readFileSync(new URL('../dist/assets/characters/clips.json', import.meta.url))).clips.Archery_Shot;
  const m = MOVES.archer_shot, seg = segmentFor(meta, { windup: m.windup, active: m.active, recover: m.recover }, CLIP_SEGMENTS.Archery_Shot);
  const releaseAt = seg.from + m.windup * seg.speed;                  // 当たり（放ち）の時刻のクリップ内の秒
  assert(Math.abs(releaseAt - CLIP_SEGMENTS.Archery_Shot.release) < 1e-6, `release at ${releaseAt}`);
});

// 「入れるのに戻れない」所が無い：5m格子（4方向）で、出発点から行ける所のうち、出発点へ戻れない所を数える（操作と同じ移動の規則）。
// 下りだけ急な斜面を降りられる規則や、地形・岩・建物の置き換えで、はまり込む穴ができていないかを見る。
test('nowhere the hero can walk to is a one-way trap: every reachable cell can return to the start', () => {
  const G = 5, b = WORLD.bounds, W = Math.floor((b.maxX - b.minX) / G), H = Math.floor((b.maxZ - b.minZ) / G);
  const px = i => b.minX + (i % W + 0.5) * G, pz = i => b.minZ + (Math.floor(i / W) + 0.5) * G;
  const ok = i => terrain.walkable(px(i), pz(i));
  const fwd = Array.from({ length: W * H }, () => []), rev = Array.from({ length: W * H }, () => []);
  for (let i = 0; i < W * H; i++) {
    if (!ok(i)) continue;
    const x = px(i), z = pz(i), y = terrain.heightAt(x, z);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = (i % W) + dx, nz = Math.floor(i / W) + dz; if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      const j = nz * W + nx; if (!ok(j)) continue;
      const r = moveActor(col, terrain, { x, y, z }, dx * G, dz * G, 0.3);
      if (Math.hypot(r.x - px(j), r.z - pz(j)) < 0.5) { fwd[i].push(j); rev[j].push(i); }
    }
  }
  const s = Math.floor((WORLD.start.z - b.minZ) / G) * W + Math.floor((WORLD.start.x - b.minX) / G);
  const reach = adj => { const seen = new Uint8Array(W * H), q = [s]; seen[s] = 1; for (let k = 0; k < q.length; k++) for (const j of adj[q[k]]) if (!seen[j]) { seen[j] = 1; q.push(j); } return seen; };
  const A = reach(fwd), B = reach(rev), traps = [];
  let nA = 0; for (let i = 0; i < W * H; i++) { if (A[i]) nA++; if (A[i] && !B[i]) traps.push(`(${px(i).toFixed(0)},${pz(i).toFixed(0)})`); }
  assert(nA > 2000, `only ${nA} cells are reachable from the start`);
  assert.equal(traps.length, 0, `one-way traps: ${traps.slice(0, 8).join(' ')}`);
});
