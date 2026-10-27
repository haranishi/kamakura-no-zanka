import test from 'node:test';
import assert from 'node:assert/strict';
import { measurementWorld as guideWorldWithoutCenter } from '../tools/lib/measurement-world.mjs';
import { guideWorld, measureGuideBaselines } from '../tools/measure-guide-baselines.mjs';
import { buildBaseline, roadDistance } from '../dist/valley/guide.js';
import { nearestFree } from '../dist/valley/collision.js';
import { STORY } from '../dist/valley/story-data.js';
import { createQuest, reduce } from '../dist/valley/quest.js';
const data = guideWorld(), { world, nav } = data;
const measured = measureGuideBaselines(data);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const range = (a, b) => Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => a + Math.sign(b - a) * i);

for (const row of measured.rows) test(`real world ${row.beat}/${row.variant}: mandatory points in order, no obstacles or road-band violations`, () => {
  const b = row.baseline;
  let expected = [];
  const road = (id, indices) => expected.push(...indices.map(index => ({ road: id, index })));
  if (row.beat === 'b2_road') { road('temple', [1, 2]); road('forest', range(0, 5)); }
  if (row.beat === 'b3_viewpoint') {
    if (row.variant === 'front') { road('forest', range(5, 10)); road('lane', [0]); }
    if (row.variant === 'north') { road('forest', range(5, 8)); road('north', range(0, 5)); }
    if (row.variant === 'south') { road('forest', range(5, 7)); road('south', range(0, 5)); }
  }
  if (row.beat === 'b6_escort') { road('forest', range(11, 0)); road('temple', range(2, 0)); }
  assert.deepEqual(b.mandatory.map(({ road, index }) => ({ road, index })), expected);
  let previous = -1;
  for (const stop of b.mandatory) {
    assert(stop.pathIndex >= previous); previous = stop.pathIndex;
    const [x, z] = world.roads[stop.road].points[stop.index];
    assert.deepEqual(stop.point, { x, z });
    assert.deepEqual(b.points[stop.pathIndex], stop.corrected);
    const correction = b.corrections.find(c => c.road === stop.road && c.index === stop.index);
    assert(distance(stop.point, stop.corrected) === 0 || correction);
  }
  for (const leg of b.legs) {
    for (let i = leg.startIndex + 1; i <= leg.endIndex; i++) {
      const a = b.points[i - 1], c = b.points[i];
      // 未測定の検査解像度0.05m。実装の0.1mより細かく、端点も含めて検査。
      const count = Math.max(1, Math.ceil(distance(a, c) / 0.05));
      for (let k = 0; k <= count; k++) {
        const p = { x: a.x + (c.x - a.x) * k / count, z: a.z + (c.z - a.z) * k / count };
        assert(nearestFree(data.col, data.terrain, p.x, p.z, 0.3, 0) !== null, `${row.beat}/${row.variant}: obstacle at ${JSON.stringify(p)}`);
        if (leg.kind === 'road') assert(roadDistance(world.roads[leg.road], p) <= world.roads[leg.road].halfWidth + 0.3 + 1e-9);
      }
    }
  }
  // 必須点間の直線距離を下回る実装、余計な巡回を含む実装を落とす。
  const stops = [b.from, ...b.mandatory.map(s => s.corrected), b.points.at(-1)];
  const minimum = stops.slice(1).reduce((sum, p, i) => sum + distance(stops[i], p), 0);
  assert(b.length + 1e-9 >= minimum);
  // 未測定の検査上限: 必須点の下界から25%の障害物迂回余裕。旧最短路との比較は旧2m格子の半セル1mを余裕とする（未測定の検査設計値）。
  assert(b.length <= minimum * 1.25);
  assert(b.length >= row.roadM - 1);
  assert.deepEqual(JSON.parse(JSON.stringify(b)), b);
});

test('all b0-b6 and all three plans yield baselines; b7/done have no guide', () => {
  for (const objectiveId of Object.keys(STORY.beats)) for (const plan of ['front', 'north', 'south']) {
    if (['b7_result', 'done'].includes(objectiveId)) {
      assert.equal(STORY.beats[objectiveId].guideTarget, null);
      assert.equal(buildBaseline(world, nav, { objectiveId, plan, from: world.checkpoints.cp_result }), null);
      continue;
    }
    const row = measured.rows.find(r => r.beat === objectiveId && (r.variant === plan || r.variant === 'default'));
    const b = (row?.baseline.plan === plan ? row.baseline : null) || buildBaseline(world, nav, { objectiveId, plan, from: measured.rows.find(r => r.beat === objectiveId).start });
    assert(b, `${objectiveId}/${plan}`);
  }
});

test('village center is a stable data target, all entrances reach it, arriving does not clear the quest', () => {
  assert.equal(STORY.beats.b4_village.guideTarget, 'village_center');
  assert.deepEqual(world.zones.village_center, { x: 0, z: 4, r: 3 });
  for (const row of measured.rows.filter(r => r.beat === 'b4_village')) assert.deepEqual(row.baseline.points.at(-1), { x: 0, z: 4 });
  let state = createQuest();
  for (const event of [{ type: 'enter_zone', zone: 'temple_yard' }, { type: 'dialogue_end', id: 'boy_arrives' },
    { type: 'arrived', place: 'viewpoint' }, { type: 'enter_zone', zone: 'village_front' }]) state = reduce(state, event).state;
  assert.equal(state.beat, 'b4_village');
  assert.equal(reduce(state, { type: 'enter_zone', zone: 'village_center' }).state.beat, 'b4_village');
});

test('all travel objective texts match destinations, b3 is shortened, dialogue and result remain separate', () => {
  const expected = ['庭へ降りる——縁側の前へ', '穂太の話を聞く——駆け上がる子のそばへ',
    '見晴らし岩へ——石段を下り、林道を南東へ', '里へ——正面は南の林道、北は斜面道、南は畦道',
    '里を守る——倉と家のあいだへ', '縛られた弥十郎を解く——縄のそばへ', '廃寺へ戻る——林道を北西へ、石段の上まで',
    '帰還の報せを聞く', '谷の灯を守った'];
  assert.deepEqual(Object.values(STORY.beats).map(b => b.objective), expected);
  assert(expected.every(t => [...t].length <= 22)); // 現在の実文字数の最大22。画面内確認は親のブラウザへ。
});

test('guide-only center zone does not change existing tree or rock placement', () => {
  const before = structuredClone(world); delete before.zones.village_center;
  const old = guideWorldWithoutCenter(before);
  assert.deepEqual(data.trees, old.trees); assert.deepEqual(data.rocks, old.rocks);
});
