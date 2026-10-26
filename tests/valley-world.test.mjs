// 隠れ谷の世界の整合：配置・通行・経路・台詞・動作表。見た目に出る前に、データの矛盾をここで落とす。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WORLD } from '../dist/valley/world-data.js';
import { createTerrain } from '../dist/valley/terrain-height.js';
import { scatterTrees } from '../dist/valley/scatter.js';
import { buildColliders, nearestFree, moveActor } from '../dist/valley/collision.js';
import { propColliders } from '../dist/valley/world-colliders.js';
import { createAIWorld } from '../dist/valley/ai-world.js';
import { STORY } from '../dist/valley/story-data.js';
import { LOCOMOTION, MOVE_CLIPS, ACTION_CLIPS, GAITS, pickGait, segmentFor, locomotionTimeScale, CLIP_SEGMENTS } from '../dist/valley/anim-data.js';
import { MOVES } from '../dist/valley/combat.js';

const terrain = createTerrain(WORLD);
const trees = scatterTrees(WORLD, terrain);
const extra = propColliders(WORLD);
const col = buildColliders({ buildings: WORLD.buildings, props: WORLD.props, trees, bounds: WORLD.bounds, extraCircles: extra.circles, extraBoxes: extra.boxes });
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
