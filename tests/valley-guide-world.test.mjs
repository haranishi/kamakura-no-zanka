import test from 'node:test';
import assert from 'node:assert/strict';
import { measurementWorld as guideWorldWithoutCenter } from '../tools/lib/measurement-world.mjs';
import { guideWorld, measureGuideBaselines } from '../tools/measure-guide-baselines.mjs';
import { createGuideNav } from '../dist/valley/guide-nav.js';
import { buildBaseline, buildRecovery, roadDistance, RECOVERY_PENDING } from '../dist/valley/guide.js';
import { nearestFree, freeAt } from '../dist/valley/collision.js';
import { STORY } from '../dist/valley/story-data.js';
import { createQuest, reduce } from '../dist/valley/quest.js';
const data = guideWorld(), { world } = data;
const nav = createGuideNav(data);
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

// なぜ失敗したか（2026-10-27 の実ブラウザ測定）: 道の帯の外の接続区間（forest[8]→north[0] など）で見通しが塞がれると、
// 世界全体（約17万セル）の格子を作り、通れる判定を約110万回呼んだ。最初の1回に約10秒かかり、b3の開始でゲームが固まった。
// 復帰路（Gと迷いの助けが0.5秒ごとに呼ぶ）も、同じ作りで同じ重さだった。純粋な検査では結果が正しいので、遅さに気づけなかった。
// 速さは環境で変わるので、通れる判定の呼び出し回数で縛る（決定的）。区間のまわりだけの格子で探すと、
// north 約9千回・south 約2万回・front 約700回・復帰路（庭の道から）約1万回（実測）。上限は実測の約3倍。
test('baseline and recovery searches stay local (no world-sized grid): cold call budget', () => {
  const fresh = createGuideNav(data);
  let calls = 0;
  const counted = { bounds: fresh.bounds, walkable(x, z) { calls++; return fresh.walkable(x, z); } };
  const from = { x: -49, z: -33 };
  for (const [plan, limit] of [['north', 30000], ['south', 60000], ['front', 3000]]) {
    calls = 0;
    assert(buildBaseline(world, counted, { objectiveId: 'b3_viewpoint', plan, from }), `${plan} baseline exists`);
    assert(calls <= limit, `${plan}: ${calls} walkable calls > ${limit}. 型: 帯の外の接続区間で、世界全体の格子を作っている（実機で約10秒固まる）`);
  }
  const north = buildBaseline(world, counted, { objectiveId: 'b3_viewpoint', plan: 'north', from });
  calls = 0;
  assert(buildRecovery(north, counted, { pos: { x: 0, z: 3 }, progress: 0 }), 'recovery from the lane exists');
  assert(calls <= 30000, `recovery: ${calls} walkable calls > 30000. 型: 復帰路の探索が世界全体の格子を作っている（Gと迷いの助けのたびに固まる）`);
});

// なぜ（2026-11-03 の実ブラウザ測定）: 林道を走って基準路から25m離れると、迷いの助けの復帰探索（0.5秒ごと）が毎回、
// 現在地を原点にした新しい格子（約2万セル・通れる判定約10万回）を作り直し、0.1〜0.2秒の停止を繰り返した（最初の1回は約0.7秒）。
// いまは格子を世界の格子目に揃えてセルの判定を覚え、読んだセルだけを判定する。続く探索は前の判定を使い回す（実測 約3千回、旧 約10万回）。
test('recovery searches reuse earlier cell checks while running off the road (no rebuild every 0.5s)', () => {
  const fresh = createGuideNav(data);
  let calls = 0;
  const counted = { bounds: fresh.bounds, walkable(x, z) { calls++; return fresh.walkable(x, z); } };
  const b = buildBaseline(world, counted, { objectiveId: 'b2_road', plan: 'front', from: { x: -74, z: -66 } });
  const runs = [{ x: -38.6, z: -11.3 }, { x: -36.3, z: -10.2 }, { x: -34, z: -9.1 }].map(pos => {
    calls = 0; const r = buildRecovery(b, counted, { pos, progress: b.length }); return { r, calls };
  });
  assert(runs.every(({ r }) => r && r.points.length >= 2), 'recovery from the forest road beyond the b2 goal exists');
  for (const { calls } of runs.slice(1)) assert(calls <= 10000, `${calls} walkable calls > 10000 on the next search 2.3m further. 型: 復帰探索が毎回格子を作り直している（走ると0.5秒ごとに引っかかる）`);
});
// 予算で区切っても、同じ位置からの探索は区切らない探索と同じ経路になる（途中は RECOVERY_PENDING）。1回に判定するセルは予算の分だけ。
test('budgeted recovery returns pending, then the same path as an unbudgeted search', () => {
  const pos = { x: -30, z: -6 };
  const whole = buildRecovery(measured.rows.find(r => r.beat === 'b2_road').baseline, createGuideNav(data), { pos, progress: 0 });
  const nav2 = createGuideNav(data), b = measured.rows.find(r => r.beat === 'b2_road').baseline;
  let r, calls = 0, cells = 0, maxCells = 0;
  do {
    calls++; cells = 0;
    r = buildRecovery(b, nav2, { pos, progress: 0, spend: () => ++cells <= 40 });
    maxCells = Math.max(maxCells, cells);
  } while (r === RECOVERY_PENDING && calls < 5000);
  assert(calls > 1, 'the search was split into several calls');
  assert.deepEqual(r, whole);
  assert(maxCells <= 41, `one call checked ${maxCells} cells (budget 40)`);
  assert.throws(() => buildRecovery(b, nav2, { pos, spend: 3 }), TypeError);
});
// guide-nav は nearestFree(…, 0) の代わりに freeAt を使う（地形の計算1回）。真偽が一致すること。
test('freeAt matches nearestFree(radius 0.3, maxR 0) across the world', () => {
  const b = world.bounds;
  let n = 0;
  for (let x = b.minX - 1; x <= b.maxX + 1; x += 2.3) for (let z = b.minZ - 1; z <= b.maxZ + 1; z += 2.3) {
    n++; assert.equal(freeAt(data.col, data.terrain, x, z, 0.3), nearestFree(data.col, data.terrain, x, z, 0.3, 0) !== null, `(${x}, ${z})`);
  }
  assert(n > 5000);
});
