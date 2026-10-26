import test from 'node:test';
import assert from 'node:assert/strict';
import { STORY } from '../dist/valley/story-data.js';
import { createQuest, reduce, exportProgress, restoreProgress, summarize } from '../dist/valley/quest.js';
const ev = (type, fields = {}) => ({ type, ...fields });
function run(s, type, fields) { return reduce(s, ev(type, fields)).state; }
function viewpoint() {
  let s = run(createQuest(STORY), 'enter_zone', { zone: 'temple_yard' });
  s = run(s, 'dialogue_end', { id: 'boy_arrives' });
  return run(s, 'arrived', { place: 'viewpoint' });
}
function village(entrance = 'village_front') { return run(viewpoint(), 'enter_zone', { zone: entrance }); }
function escort() {
  let s = run(village(), 'enemy_down', { id: 'officer', how: 'routed' });
  s = run(s, 'interact', { id: 'archer_captive' });
  return run(s, 'party_joined', { id: 'archer' });
}
for (const entrance of ['village_front', 'village_north', 'village_south']) {
  test(`full route through all beats: ${entrance}`, () => {
    let s = createQuest(STORY);
    const steps = [
      ['enter_zone', { zone: 'temple_yard' }, 'b1_boy', 'dialogue'],
      ['dialogue_end', { id: 'boy_arrives' }, 'b2_road', 'checkpoint'],
      ['arrived', { place: 'viewpoint' }, 'b3_viewpoint', 'dialogue'],
      ['enter_zone', { zone: entrance }, 'b4_village', 'spawn'],
      ['enemy_down', { id: 'officer', how: 'surrendered' }, 'b5_archer', 'despawn'],
      ['interact', { id: 'archer_captive' }, 'b5_archer', 'dialogue'],
      ['party_joined', { id: 'archer' }, 'b6_escort', 'checkpoint'],
      ['arrived', { place: 'temple_steps' }, 'b7_result', 'ending'],
      ['dialogue_end', { id: 'result' }, 'done', 'objective'],
    ];
    for (const [type, fields, beat, effect] of steps) {
      const before = structuredClone(s); const r = reduce(s, ev(type, fields));
      assert.deepEqual(s, before); assert.notEqual(r.state, s);
      assert.equal(r.state.beat, beat); assert.ok(r.effects.some(e => e.type === effect)); s = r.state;
    }
    assert.equal(s.flags.archerJoined, true); assert.equal(s.resources.morale, 65);
    assert.equal(s.flags.approach, entrance === 'village_front' ? 'front' : 'flank');
  });
}
test('plan is advisory and first actual entrance is fixed', () => {
  let s = run(viewpoint(), 'choose_plan', { plan: 'front' });
  const r = reduce(s, ev('enter_zone', { zone: 'village_south' })); s = r.state;
  assert.equal(r.effects.find(e => e.type === 'spawn').alert, 'unaware');
  s = run(s, 'enter_zone', { zone: 'village_front' });
  s = run(s, 'choose_plan', { plan: 'flank' });
  assert.equal(s.flags.approach, 'flank'); assert.equal(s.flags.plan, 'front');
});
test('pillage follows approach, clamps at zero and rejects invalid input', () => {
  const f = run(village(), 'pillage_tick', { dt: 10, pillagers: 2 });
  const l = run(village('village_north'), 'pillage_tick', { dt: 10, pillagers: 2 });
  assert.equal(f.resources.food, 44); assert.equal(l.resources.food, 58);
  // 脇道でも見つかって騒ぎになれば、正面と同じ速さで荒らされる
  assert.equal(run(village('village_north'), 'pillage_tick', { dt: 10, pillagers: 2, loud: true }).resources.food, 44);
  assert.equal(run(f, 'pillage_tick', { dt: 1e300, pillagers: 1e300 }).resources.food, 0);
  for (const dt of [NaN, Infinity, -1, '3']) assert.deepEqual(run(f, 'pillage_tick', { dt, pillagers: 2 }), f);
});
test('trust rises with mercy, stealth and what is left in the stores; a careful flank keeps 50+ food', () => {
  let s = village('village_north');
  const t0 = s.trust;
  s = run(s, 'enemy_down', { id: 'village_soldier_1', how: 'surrendered' }); assert.equal(s.trust, t0 + 4);
  s = run(s, 'enemy_down', { id: 'village_soldier_2', how: 'routed' }); assert.equal(s.trust, t0 + 6);
  s = run(s, 'enemy_down', { id: 'village_soldier_3', how: 'killed', stealth: true }); assert.equal(s.trust, t0 + 9);
  s = run(s, 'enemy_down', { id: 'village_archer', how: 'killed' }); assert.equal(s.trust, t0 + 9);            // 正面から倒しても信頼は増えない
  const quiet = run(s, 'pillage_tick', { dt: 20, pillagers: 5 });                                              // 静かな脇道：20秒で 20×5×0.1 = 10
  assert.ok(quiet.resources.food >= 50);
  const done = run(quiet, 'enemy_down', { id: 'officer', how: 'killed' });
  assert.equal(done.beat, 'b5_archer'); assert.ok(done.trust >= t0 + 9 + 1);                                    // 蓄えが多く残るほど、里の信頼が上がる
  const raided = run(run(village(), 'pillage_tick', { dt: 60, pillagers: 5 }), 'enemy_down', { id: 'officer', how: 'killed' });
  assert.ok(raided.trust < done.trust);
  assert.ok(summarize({ ...done, flags: { ...done.flags, archerJoined: true } }).trust >= 50 || done.trust < 50);   // 要約は信頼をそのまま映す
});
test('retry keeps the chosen plan so the compass and the choice stay consistent', () => {
  let s = run(viewpoint(), 'choose_plan', { plan: 'flank' });
  s = run(s, 'enter_zone', { zone: 'village_north' });
  s = run(run(s, 'player_down'), 'retry');
  assert.equal(s.beat, 'b3_viewpoint'); assert.equal(s.flags.plan, 'flank'); assert.equal(s.flags.approach, null);
});
test('each defeat kind clears officer and repeated defeats have no effects', () => {
  for (const how of ['killed', 'routed', 'surrendered']) {
    const s = run(village(), 'enemy_down', { id: 'officer', how }); assert.equal(s.beat, 'b5_archer');
    assert.deepEqual(reduce(s, ev('enemy_down', { id: 'officer', how })), { state: s, effects: [] });
  }
});
test('all village members can clear a group without an officer in custom story', () => {
  const story = structuredClone(STORY); story.groups.village_enemies = ['one', 'two'];
  let s = createQuest(story);
  for (const [type, fields] of [['enter_zone', { zone: 'temple_yard' }], ['dialogue_end', { id: 'boy_arrives' }], ['arrived', { place: 'viewpoint' }], ['enter_zone', { zone: 'village_front' }]]) s = run(s, type, fields);
  s = run(s, 'enemy_down', { id: 'one', how: 'killed' }); assert.equal(s.beat, 'b4_village');
  assert.equal(run(s, 'enemy_down', { id: 'two', how: 'routed' }).beat, 'b5_archer');
});
test('active ambush blocks return until each member is down; cannot spawn twice', () => {
  let s = run(escort(), 'enter_zone', { zone: 'ambush_trigger' });
  assert.equal(s.flags.ambush, 'active');
  assert.deepEqual(reduce(s, ev('enter_zone', { zone: 'ambush_trigger' })).effects, []);
  assert.deepEqual(run(s, 'arrived', { place: 'temple_steps' }), s);
  for (const id of STORY.groups.escort_ambush) s = run(s, 'enemy_down', { id, how: 'routed' });
  assert.equal(s.flags.ambush, 'cleared');
  assert.deepEqual(reduce(s, ev('enter_zone', { zone: 'ambush_trigger' })).effects, []);
  assert.equal(run(s, 'arrived', { place: 'temple_steps' }).beat, 'b7_result');
});
test('out of order, invalid, and duplicate events leave state unchanged', () => {
  const initial = createQuest(STORY);
  for (const event of [null, {}, ev('party_joined', { id: 'archer' }), ev('arrived', { place: 'temple_steps' }), ev('enemy_down', { id: 'officer', how: 'killed' }), ev('retry')]) {
    const r = reduce(initial, event); assert.deepEqual(r.state, initial); assert.deepEqual(r.effects, []);
  }
  let s = run(initial, 'enter_zone', { zone: 'temple_yard' });
  assert.deepEqual(reduce(s, ev('enter_zone', { zone: 'temple_yard' })).effects, []);
  s = run(village(), 'enemy_down', { id: 'officer', how: 'killed' });
  assert.deepEqual(run(s, 'party_joined', { id: 'archer' }), s);
  s = run(s, 'interact', { id: 'archer_captive' });
  assert.deepEqual(reduce(s, ev('interact', { id: 'archer_captive' })).effects, []);
});
test('retry restores checkpoint resources, flags and clears groups; cannot play while down', () => {
  let s = run(village(), 'pillage_tick', { dt: 20, pillagers: 2 });
  s = run(s, 'player_down');
  assert.deepEqual(run(s, 'enemy_down', { id: 'officer', how: 'killed' }), s);
  const r = reduce(s, ev('retry')); assert.equal(r.state.beat, 'b3_viewpoint');
  assert.equal(r.state.resources.food, 60); assert.equal(r.state.flags.approach, null);
  assert.equal(r.state.pendingRetry, false);
  for (const group of Object.keys(STORY.groups)) assert.ok(r.effects.some(e => e.type === 'despawn' && e.group === group));
  assert.equal(run(run(createQuest(STORY), 'player_down'), 'retry').beat, 'b0_temple');
});
test('checkpoint export/restore round trips; combat export rewinds and preserves dead IDs at checkpoint', () => {
  const s = escort(), exported = exportProgress(s);
  assert.deepEqual(exportProgress(restoreProgress(STORY, exported)), exported);
  assert.equal(exported.world.enemies.officer.alive, false);
  assert.deepEqual(exportProgress(run(s, 'enter_zone', { zone: 'ambush_trigger' })), exported);
  assert.equal(exportProgress(village()).beat, 'b3_viewpoint');
  assert.equal(restoreProgress(STORY, {}).beat, 'b0_temple');
});
test('summary derives text from approach, food, morale and trust', () => {
  const s = escort(), a = summarize(s);
  assert.equal(a.saved, 4); assert.ok(a.lines.some(l => l.includes('冬を越せる')));
  s.flags.approach = 'flank'; s.resources.food = 49; s.resources.morale = 20; s.trust = 60;
  const b = summarize(s); assert.notDeepEqual(a.lines, b.lines);
  assert.equal(b.approach, 'flank'); assert.ok(b.lines.some(l => l.includes('次は匿えない')));
});
