// life-rules.js（S7-0）：場面・選んだ道・結果から「見せる物と状態」を決める純粋な層の試験。
// 本人の決定（design-valley-life.md 冒頭）を、場面と道と米のすべての組で確かめる。変異は tools/verify-life-rules-mutations.mjs。
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIFE_ITEMS, LIFE_PLACES, DAMAGE_NAMES, FOOD_PLENTIFUL, FOOD_MEAGER, TRUST_HIGH, TRUST_MID, stageOf, phaseOf, normalizeLifeInput,
  damageOf, lifeScene, lifeItem, lifeInputFromQuest } from '../dist/valley/life-rules.js';
import { createQuest, reduce, summarize } from '../dist/valley/quest.js';
import { STORY } from '../dist/valley/story-data.js';

const BEATS = ['b0_temple', 'b1_boy', 'b2_road', 'b3_viewpoint', 'b4_village', 'b5_archer', 'b6_escort', 'b7_result', 'done'];
const ROUTES = ['front', 'flank', null];
const FOODS = [60, 55, 50, 49.999, 42, 35, 34.999, 20, 0];
const item = (input, id) => lifeItem(lifeScene(input), id);
// 場面×道×米×信頼×弥十郎×待ち伏せ×物見のすべての組（試験の母集団）
const everyInput = function* () {
  for (const beat of BEATS) for (const approach of ROUTES) for (const food of FOODS) for (const trust of [70, 58, 50, 48, 30])
    for (const archerJoined of [false, true]) for (const ambush of [null, 'active', 'cleared']) for (const scoutDown of [false, true])
      yield { beat, approach, food, trust, archerJoined, captiveFreed: archerJoined, ambush, scoutDown };
};

test('beats map to stages 0-8, short names b0-b7 are accepted and unknown values start at b0 [stage]', () => {
  BEATS.forEach((beat, i) => assert.equal(stageOf(beat), i, `[stage] ${beat}`));
  for (let i = 0; i <= 7; i++) assert.equal(stageOf('b' + i), i, `[stage-short] b${i}`);
  for (const bad of [undefined, null, 4, 'b8', 'b4_', 'B4', 'village', {}]) assert.equal(stageOf(bad), 0, `[stage-unknown] ${String(bad)}`);
  assert.deepEqual(lifeScene({ beat: 'b4' }), lifeScene({ beat: 'b4_village' }), '[stage-short] the same scene');
});

test('the village is raided in b0-b4, saved in b5-b6 and at the ending in b7 and done [phase]', () => {
  assert.deepEqual(BEATS.map((_, i) => phaseOf(i)), ['raid', 'raid', 'raid', 'raid', 'raid', 'saved', 'saved', 'ending', 'ending'], '[phase]');
});

test('every place lists every item once, with a declared state and a count that is 0 when hidden [shape]', () => {
  const ids = LIFE_ITEMS.map(i => i.id);
  assert.equal(new Set(ids).size, ids.length, '[shape] duplicate item id');
  for (const i of LIFE_ITEMS) { assert(LIFE_PLACES.includes(i.place), `[shape] unknown place ${i.place}`); assert.match(i.ref, /^(寺|道|見|入|中|縛|帰)\d$/, `[shape] ref ${i.ref}`); }
  for (const input of everyInput()) {
    const scene = lifeScene(input);
    assert.deepEqual(Object.keys(scene.places), LIFE_PLACES, '[shape] places');
    const listed = Object.values(scene.places).flat();
    assert.deepEqual(listed.map(i => i.id), ids, '[shape] item order');
    for (const it of listed) {
      const spec = LIFE_ITEMS.find(i => i.id === it.id);
      assert(spec.states.includes(it.state), `[shape] ${it.id} state ${it.state}`);
      assert(Number.isInteger(it.count) && it.count >= 0, `[shape] ${it.id} count ${it.count}`);
      if (!it.show) assert.equal(it.count, 0, `[hidden-count] ${it.id}`);
      else assert(it.count >= 1, `[shown-count] ${it.id}`);
      assert.equal(typeof it.flame, 'boolean', `[shape] ${it.id} flame`);
    }
  }
});

test('decision 1: while raided there are no flames, the raid is plain to see and only lanterns ever burn [raid-no-fire]', () => {
  for (const input of everyInput()) {
    const scene = lifeScene(input), all = Object.values(scene.places).flat();
    for (const it of all) if (it.flame) assert(['temple_lantern', 'steps_lantern'].includes(it.id), `[lantern-only] ${it.id} burns at ${input.beat}`);
    if (scene.phase !== 'raid') continue;
    assert(!all.some(i => i.flame), `[raid-no-fire] flame at ${input.beat}`);
    const at = id => lifeItem(scene, id);
    assert.equal(at('camp_kitchen').state, 'embers', '[raid-kitchen] embers, no flame');
    assert(!at('house_smoke').show && at('house_smoke').state === 'stopped', '[raid-house-smoke] houses are silent');
    assert(at('camp_smoke').show && at('camp_smoke').count === 1, '[raid-camp-smoke] one grey column marks the camp');
    assert.equal(at('boundary_rope').state, 'cut', '[raid-rope]');
    assert.equal(at('threshing_floor').state, 'scattered', '[raid-threshing]');
    assert.equal(at('laundry').state, 'fallen', '[raid-laundry]');
    assert.equal(at('paddy_workers').state, 'hiding', '[raid-paddy]');
    assert(!at('extra_workers').show && at('extra_workers').count === 0, '[raid-workers]');
    assert.equal(at('bale_row').state, 'carried_out', '[raid-bales]');
    assert(at('raid_marks').show && at('fallen_fence').count >= 1, '[raid-marks] plainly raided');
    assert.equal(at('temple_lantern').state, 'unlit', '[raid-lantern]');
  }
});

test('the raid is worse from the front and when rice is lost; before entering it does not depend on the route [damage]', () => {
  for (const beat of BEATS.slice(0, 4)) for (const approach of ROUTES) for (const food of FOODS)
    assert.equal(damageOf(normalizeLifeInput({ beat, approach, food })), 1, `[damage-before-entering] ${beat} ${approach} ${food}`);
  const cases = [['front', 60, 2], ['front', 35, 2], ['front', 34.999, 3], ['front', 0, 3], ['flank', 60, 1], ['flank', 50, 1], ['flank', 49.999, 2], ['flank', 0, 2],
    [null, 50, 1], [null, 49.999, 2], [null, 35, 2], [null, 34.999, 3]];
  for (const [approach, food, level] of cases) {
    const scene = lifeScene({ beat: 'b4_village', approach, food });
    assert.deepEqual(scene.damage, { level, name: DAMAGE_NAMES[level] }, `[damage] ${approach} food ${food}`);
    assert.equal(lifeItem(scene, 'raid_marks').count, level, `[damage-marks] ${approach} ${food}`);
    assert.equal(lifeItem(scene, 'fallen_fence').count, level >= 3 ? 2 : 1, `[damage-fence] ${approach} ${food}`);
    assert.equal(lifeItem(scene, 'bale_row').count, 3 + level, `[damage-bales] ${approach} ${food}`);
  }
  for (const food of FOODS) {
    const front = damageOf(normalizeLifeInput({ beat: 'b4_village', approach: 'front', food })), flank = damageOf(normalizeLifeInput({ beat: 'b4_village', approach: 'flank', food }));
    assert(front >= flank, `[damage-front-worse] food ${food}`);
  }
  for (const approach of ROUTES) for (let i = 1; i < FOODS.length; i++) {
    const more = damageOf(normalizeLifeInput({ beat: 'b4_village', approach, food: FOODS[i - 1] })), less = damageOf(normalizeLifeInput({ beat: 'b4_village', approach, food: FOODS[i] }));
    assert(less >= more, `[damage-monotone] ${approach} ${FOODS[i]}`);
  }
});

test('the raid marks stay as the result after the village is saved [damage-persists]', () => {
  for (const approach of ['front', 'flank']) for (const food of FOODS) {
    const at4 = lifeScene({ beat: 'b4_village', approach, food });
    for (const beat of BEATS.slice(5)) {
      const later = lifeScene({ beat, approach, food });
      assert.deepEqual(later.damage, at4.damage, `[damage-persists] ${beat} ${approach} ${food}`);
      for (const id of ['raid_marks', 'fallen_fence']) assert.deepEqual(lifeItem(later, id), lifeItem(at4, id), `[damage-persists] ${id} ${beat}`);
      assert.equal(lifeItem(later, 'bale_row').count, lifeItem(at4, 'bale_row').count, `[damage-persists] bales ${beat}`);
    }
  }
});

test('decision 2: once saved, life starts again: smoke, the re-tied rope, workers and the lanterns [saved-life]', () => {
  for (const beat of BEATS.slice(5)) for (const food of FOODS) {
    const scene = lifeScene({ beat, approach: 'front', food }), at = id => lifeItem(scene, id);
    assert(at('house_smoke').show && at('house_smoke').state === 'rising', `[saved-house-smoke] ${beat}`);
    assert(!at('camp_smoke').show, `[saved-camp-smoke] ${beat}`);
    assert.equal(at('camp_kitchen').state, 'cold', `[saved-kitchen] ${beat}`);
    assert.equal(at('boundary_rope').state, 'retied', `[saved-rope] ${beat}`);
    assert.equal(at('threshing_floor').state, 'tidy', `[saved-threshing] ${beat}`);
    assert.equal(at('laundry').state, 'hung', `[saved-laundry] ${beat}`);
    assert.equal(at('paddy_workers').state, 'working', `[saved-paddy] ${beat}`);
    assert.equal(at('bale_row').state, 'left_behind', `[saved-bales] ${beat}`);
    assert(at('extra_workers').show && at('extra_workers').count === (food >= FOOD_PLENTIFUL ? 3 : 2), `[saved-workers] ${beat} ${food}`);
  }
  const lit = (beat, id) => item({ beat }, id);
  for (const beat of BEATS) {
    const stage = stageOf(beat), steps = lit(beat, 'steps_lantern'), temple = lit(beat, 'temple_lantern');
    assert.equal(steps.flame, stage >= 6, `[steps-lantern] ${beat}`); assert.equal(steps.state, stage >= 6 ? 'lit' : 'unlit', `[steps-lantern] ${beat}`);
    assert.equal(temple.flame, stage >= 7, `[temple-lantern] ${beat}`); assert.equal(temple.state, stage >= 7 ? 'lit' : 'unlit', `[temple-lantern] ${beat}`);
    assert.equal(lit(beat, 'crows').state, stage >= 7 ? 'to_peak' : 'circling', `[crows] ${beat}`);
  }
});

test('decision 3: the gate ruin is always the same quiet thing and never burns [gate-ruin]', () => {
  const first = item({}, 'gate_ruin');
  assert.deepEqual(first, { id: 'gate_ruin', ref: '寺2', show: true, state: 'quiet', count: 1, flame: false }, '[gate-ruin]');
  for (const input of everyInput()) assert.deepEqual(item(input, 'gate_ruin'), first, `[gate-ruin] ${input.beat}`);
});

test('the result rice, the fire ring and the raid level agree with the result lines of quest.js [result-lines]', () => {
  const r = STORY.results, state = (food, trust, approach) => ({ story: STORY, resources: { food, morale: 50 }, flags: { approach, archerJoined: true }, trust });
  for (let food = 0; food <= 60; food += 0.25) {
    const line = summarize(state(food, 40, 'front')).lines[1], rice = item({ beat: 'b7_result', approach: 'front', food }, 'result_rice');
    const want = { [r.plentiful]: ['bales', 3], [r.meager]: ['bales', 2], [r.scarce]: ['basket', 1] }[line];
    assert.deepEqual([rice.state, rice.count], want, `[result-rice] food ${food}`);
    for (const approach of ['front', 'flank']) {
      const first = summarize(state(food, 40, approach)).lines[0], level = lifeScene({ beat: 'b7_result', approach, food }).damage.level;
      if (first === r.flankLoud) assert.equal(level, 2, `[result-flank-loud] ${food}`);
      if (first === r.flank) assert.equal(level, 1, `[result-flank-quiet] ${food}`);
      if (first === r.front) assert(level >= 2, `[result-front] ${food}`);
    }
  }
  for (let trust = 0; trust <= 100; trust += 1) {
    const line = summarize(state(50, trust, 'flank')).lines[3], ring = item({ beat: 'done', trust }, 'fire_ring').state;
    assert.equal(ring, { [r.trustHigh]: 'inner', [r.trustMid]: 'edge', [r.trustLow]: 'apart' }[line], `[fire-ring] trust ${trust}`);
  }
  assert.equal(TRUST_HIGH > TRUST_MID && FOOD_PLENTIFUL > FOOD_MEAGER, true, '[thresholds]');
  for (const beat of BEATS.slice(0, 7)) {
    assert.deepEqual(item({ beat, food: 60 }, 'result_rice'), { id: 'result_rice', ref: '寺6', show: false, state: 'none', count: 0, flame: false }, `[result-rice-hidden] ${beat}`);
    assert.equal(item({ beat, trust: 90 }, 'fire_ring').state, 'unused', `[fire-ring-before-ending] ${beat}`);
  }
});

test('the captive, his bow, the ambush birds and the scout sword follow the story flags [flags]', () => {
  for (const archerJoined of [false, true]) for (const captiveFreed of [false, true]) {
    const scene = lifeScene({ beat: 'b5_archer', archerJoined, captiveFreed });
    assert.equal(lifeItem(scene, 'captive_bow').show, !archerJoined, `[bow] joined ${archerJoined}`);
    assert.equal(lifeItem(scene, 'captive_rope').state, captiveFreed || archerJoined ? 'cut' : 'tied', `[rope] freed ${captiveFreed} joined ${archerJoined}`);
  }
  for (const beat of BEATS) for (const ambush of [null, 'active', 'cleared']) {
    const birds = item({ beat, ambush }, 'ambush_birds');
    assert.equal(birds.show, beat === 'b6_escort', `[birds-show] ${beat}`);
    assert.equal(birds.state, ambush === null ? 'perched' : 'flown', `[birds] ${ambush}`);
  }
  for (const scoutDown of [false, true, 'yes']) assert.equal(item({ beat: 'b6_escort', scoutDown }, 'scout_sword').show, scoutDown === true, `[scout-sword] ${scoutDown}`);
});

test('broken or missing input falls back to the story defaults and the scene stays well formed [normalize]', () => {
  assert.deepEqual(normalizeLifeInput(null), { stage: 0, beat: 'b0_temple', route: null, entered: false, food: STORY.resources.food, trust: STORY.trust,
    archerJoined: false, captiveFreed: false, ambush: null, scoutDown: false }, '[normalize] defaults');
  const odd = normalizeLifeInput({ beat: 'b4_village', approach: 'north', plan: 'flank', food: NaN, trust: 300, ambush: 'soon', archerJoined: 'yes' });
  assert.deepEqual([odd.route, odd.food, odd.trust, odd.ambush, odd.archerJoined], ['flank', STORY.resources.food, 100, null, false], '[normalize] odd values');
  assert.deepEqual([normalizeLifeInput({ food: -5, trust: -1 }).food, normalizeLifeInput({ food: -5, trust: -1 }).trust], [0, 0], '[normalize] clamp');
  assert.equal(normalizeLifeInput({ approach: 'front', plan: 'flank' }).route, 'front', '[normalize] the entered road wins over the plan');
  assert.equal(normalizeLifeInput({ archerJoined: true }).captiveFreed, true, '[normalize] joined implies freed');
});

test('the layer is pure: same input, same answer, no mutation of the input, a fresh result each time [pure]', () => {
  const freeze = o => { for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v); return Object.freeze(o); };
  for (const input of [{ beat: 'b4_village', approach: 'front', food: 30, trust: 50, flags: { x: 1 } }, { beat: 'done', approach: 'flank', food: 55, trust: 60 }]) {
    const frozen = freeze(structuredClone(input)), a = lifeScene(frozen), b = lifeScene(frozen);
    assert.deepEqual(a, b, '[pure] same answer');
    a.places.entrance[0].count = 99; a.damage.level = 0;
    assert.deepEqual(lifeScene(frozen), b, '[pure] fresh result');
  }
});

test('a played run through quest.js feeds the layer: front road, lost rice, the village cleared [quest]', () => {
  let q = createQuest();
  const ev = e => { q = reduce(q, e).state; };
  const scene = () => lifeScene(lifeInputFromQuest(q));
  assert.equal(scene().phase, 'raid', '[quest] start');
  ev({ type: 'enter_zone', zone: 'temple_yard' }); ev({ type: 'dialogue_end', id: 'boy_arrives' }); ev({ type: 'arrived', place: 'viewpoint' });
  ev({ type: 'choose_plan', plan: 'flank' });
  assert.deepEqual([scene().route, scene().damage.level], ['flank', 1], '[quest] plan chosen, not yet entered');
  ev({ type: 'enter_zone', zone: 'village_front' });
  assert.deepEqual([q.beat, q.flags.plan, q.flags.approach], ['b4_village', 'flank', 'front'], '[quest] entered from the front after planning the flank');
  assert.deepEqual([scene().route, scene().damage.level], ['front', 2], '[quest] the entered road decides');
  ev({ type: 'pillage_tick', dt: 10, pillagers: 4 });
  assert(q.resources.food < FOOD_MEAGER, '[quest] rice lost');
  assert.equal(scene().damage.level, 3, '[quest] ravaged');
  for (const id of STORY.groups.village_enemies) ev({ type: 'enemy_down', id, how: 'killed' });
  assert.equal(q.beat, 'b5_archer', '[quest] cleared');
  const saved = scene();
  assert.deepEqual([saved.phase, saved.damage.level, lifeItem(saved, 'boundary_rope').state, lifeItem(saved, 'captive_rope').state], ['saved', 3, 'retied', 'tied'], '[quest] saved');
  ev({ type: 'interact', id: 'archer_captive' });
  assert.equal(lifeItem(scene(), 'captive_rope').state, 'cut', '[quest] freed');
  ev({ type: 'party_joined', id: 'archer' });
  assert.deepEqual([q.beat, lifeItem(scene(), 'captive_bow').show, lifeItem(scene(), 'steps_lantern').flame], ['b6_escort', false, true], '[quest] escort');
  assert.equal(lifeInputFromQuest(q, { scoutDown: true }).scoutDown, true, '[quest] scout flag passes through');
  assert.deepEqual(lifeInputFromQuest(undefined), { beat: undefined, approach: null, plan: null, food: undefined, trust: undefined,
    archerJoined: false, captiveFreed: false, ambush: null, scoutDown: false }, '[quest] missing state');
});
