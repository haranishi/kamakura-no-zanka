import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrain, think, hear, adjustMorale, alertFromAlly} from '../dist/valley/enemy-ai.js';

const fighter = (id, extra = {}) => ({id, team: 'enemy', kind: 'soldier', x: 0, z: 0, yaw: 0,
  hp: 100, hpMax: 100, posture: 100, postureMax: 100, state: 'idle', alive: true, ready: true, aware: false, ...extra});
function setup(kind = 'soldier', extra = {}) {
  const brain = createBrain(kind, {id: 'e', home: {x: 0, z: 0}, exit: {x: 20, z: 0}, seed: 123});
  const acquired = [], released = [];
  const view = {t: 0, self: fighter('e', {kind}), hero: fighter('hero', {team: 'hero', z: -10}),
    allies: [fighter('friend', {x: 5})], noises: [], targets: [],
    world: {los: () => true, pathTo: (a, b) => [{x: a.x, z: a.z}, {x: b.x, z: b.z}], walkable: () => true},
    tokens: {tryAcquire: id => { acquired.push(id); return true; }, release: id => released.push(id)}, ...extra};
  return {brain, view, acquired, released};
}
const near = (a, b) => assert(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function battle(kind = 'soldier', d = 1.3) {
  const s = setup(kind); s.brain.state = 'combat'; s.brain.awareness = 1; s.view.hero.z = -d; return s;
}

test('vision respects the 110 degree cone, yaw, range and occlusion', () => {
  for (const [angle, d, los, seen] of [[54, 10, true, true], [56, 10, true, false],
    [180, 2, true, false], [0, 20, true, true], [0, 20.01, true, false], [0, 2, false, false]]) {
    const {brain, view} = setup();
    view.hero.x = Math.sin(angle * Math.PI / 180) * d; view.hero.z = -Math.cos(angle * Math.PI / 180) * d;
    view.world.los = () => los;
    think(brain, view, 0.2); assert.equal(brain.awareness > 0, seen, `${angle}, ${d}, ${los}`);
  }
  const {brain, view} = setup(); view.self.yaw = Math.PI / 2; view.hero = fighter('hero', {x: -10});
  think(brain, view, 0.2); assert(brain.awareness > 0);
});

test('crouching halves sight range and tall grass halves it again', () => {
  for (const [crouching, inTallGrass, d, seen] of [[true, false, 10, true], [true, false, 10.1, false],
    [false, true, 10, true], [false, true, 10.1, false], [true, true, 5, true], [true, true, 5.1, false]]) {
    const {brain, view} = setup(); Object.assign(view.hero, {crouching, inTallGrass, z: -d});
    think(brain, view, 0.1); assert.equal(brain.awareness > 0, seen);
  }
});

test('awareness rate interpolates by distance and decays unseen at 0.4/s', () => {
  for (const [d, duration] of [[2, 0.9], [5, 0.9], [12.5, 1.2], [20, 1.5]]) {
    const {brain, view} = setup(); view.hero.z = -d;
    think(brain, view, 0.3); near(brain.awareness, 0.3 / duration);
    view.hero.z = 20; think(brain, view, 0.1); near(brain.awareness, 0.3 / duration - 0.04);
  }
});

test('nearby footsteps only outside sight cone, within 3m and not behind', () => {
  for (const [angle, d, expected] of [[70, 3, 0.08], [70, 3.01, 0], [110, 2, 0]]) {
    const {brain, view} = setup();
    Object.assign(view.hero, {x: Math.sin(angle * Math.PI / 180) * d, z: -Math.cos(angle * Math.PI / 180) * d});
    think(brain, view, 0.2); near(brain.awareness, expected);
  }
});

test('hearing uses inclusive radius and latest position, clamps and remembers location', () => {
  const {brain, view} = setup();
  hear(brain, {x: 5, z: 0, radius: 4.99, kind: 'run', t: 0}); near(brain.awareness, 0);
  hear(brain, {x: 5, z: 0, radius: 5, kind: 'run', t: 0}); near(brain.awareness, 0.5);
  assert.deepEqual(brain.lastSeen, {x: 5, z: 0});
  hear(brain, {x: 0, z: 0, radius: 0}); hear(brain, {x: 0, z: 0, radius: 0}); near(brain.awareness, 1);
  view.self.x = 100; think(brain, view, 0);
  const before = brain.awareness; hear(brain, {x: 0, z: 0, radius: 5}); near(brain.awareness, before);
});

test('view noises are consumed once across frames', () => {
  const {brain, view} = setup(); view.hero.z = 30;
  view.noises = [{x: 0, z: 4, radius: 5, kind: 'walk', t: 1}];
  think(brain, view, 0); near(brain.awareness, 0.5);
  think(brain, view, 0); near(brain.awareness, 0.5);
});

test('a hearing stimulus reaches thresholds before unseen decay can erase them', () => {
  const {brain, view} = setup(); view.hero.z = 30; view.world.los = () => false;
  hear(brain, {x: 0, z: 4, radius: 5});
  assert.equal(think(brain, view, 0.1).events[0].type, 'suspicious');
  near(brain.awareness, 0.5);
  hear(brain, {x: 0, z: 4, radius: 5});
  assert(think(brain, view, 0.1).events.some(e => e.type === 'alerted'));
  assert.equal(think(brain, view, 0.1).events.length, 0);
  near(brain.awareness, 0.96);
});

test('suspicious turns and walks to last sight; losing sight searches five seconds then patrols', () => {
  const {brain, view} = setup();
  const one = think(brain, view, 0.5);
  assert.equal(brain.state, 'suspicious'); assert.equal(one.events[0].type, 'suspicious');
  assert.deepEqual(one.intent.move, {x: 0, z: -10}); assert.equal(one.intent.face, 0); assert.equal(one.intent.speed, 'walk');
  view.hero.z = 30;
  think(brain, view, 1); assert.equal(brain.state, 'search');
  think(brain, view, 3.9); assert.equal(brain.state, 'search');
  think(brain, view, 0.11); assert.equal(brain.state, 'patrol');
  assert.equal(brain.lastSeen, null);
});

test('full awareness alerts once; lost combat releases token and searches', () => {
  const {brain, view, released} = battle();
  brain.state = 'patrol'; brain.awareness = 0;
  const r = think(brain, view, 0.9); assert.equal(brain.state, 'combat');
  assert.equal(r.events.filter(e => e.type === 'alerted').length, 1);
  assert.equal(think(brain, view, 0.1).events.filter(e => e.type === 'alerted').length, 0);
  view.world.los = () => false; think(brain, view, 0.1);
  assert.equal(brain.state, 'search'); assert(released.length > 0);
  think(brain, view, 5); assert.equal(brain.state, 'patrol');
});

test('ally propagation waits a deterministic 0.6–1.2 seconds and is not rescheduled', () => {
  const delays = [];
  for (let seed = 0; seed < 20; seed++) {
    const {brain, view} = setup(); brain.seed = seed; view.hero.z = 30;
    alertFromAlly(brain, {x: 8, z: 0}); const delay = brain.allyAlert.remaining; delays.push(delay);
    assert(delay >= 0.6 && delay <= 1.2);
    alertFromAlly(brain, {x: 99, z: 99}); near(brain.allyAlert.remaining, delay);
    think(brain, view, delay - 0.001); assert.equal(brain.state, 'patrol');
    const r = think(brain, view, 0.001); assert.equal(brain.state, 'search');
    assert.deepEqual(brain.lastSeen, {x: 8, z: 0}); assert.equal(r.events[0].type, 'suspicious');
  }
  assert(new Set(delays).size > 1);
});

test('denied tokens orbit in a 2.5–4m ring and reverse every ten seconds', () => {
  const {brain, view} = battle('soldier', 3); view.tokens.tryAcquire = () => false;
  const first = think(brain, view, 0);
  assert.equal(first.intent.startMove, null); assert.equal(first.intent.speed, 'walk');
  const radius = Math.hypot(first.intent.move.x - view.hero.x, first.intent.move.z - view.hero.z);
  assert(radius >= 2.5 && radius <= 4);
  const direction = brain.orbitDirection;
  think(brain, view, 9.99); assert.equal(brain.orbitDirection, direction);
  think(brain, view, 0.01); assert.equal(brain.orbitDirection, -direction);
});

test('soldier attacks require tokens; thrust at >=2m, otherwise deterministic 30% choice', () => {
  const {brain, view, acquired, released} = battle('soldier', 2.05);
  assert.equal(think(brain, view, 0.01).intent.startMove, 'soldier_thrust'); assert.deepEqual(acquired, ['e']);
  view.self.state = 'attack'; view.self.ready = false;
  assert.equal(think(brain, view, 0.1).intent.startMove, null); assert.equal(released.length, 0);
  view.self.state = 'idle'; view.self.ready = false; think(brain, view, 0.1); assert.deepEqual(released, ['e']);
  const counts = {soldier_slash: 0, soldier_thrust: 0};
  for (let seed = 0; seed < 1000; seed++) {
    const s = battle(); s.brain.seed = seed;
    counts[think(s.brain, s.view, 0.01).intent.startMove]++;
  }
  assert(counts.soldier_thrust > 250 && counts.soldier_thrust < 350);
  assert(counts.soldier_slash > counts.soldier_thrust);
});

test('approach is needed outside reach and stagger outputs no action while releasing token', () => {
  const {brain, view, released} = battle('soldier', 8);
  assert.equal(think(brain, view, 0.1).intent.speed, 'run');
  view.hero.z = -1; think(brain, view, 0.1);
  view.self.state = 'stagger'; const r = think(brain, view, 0.1);
  assert.equal(r.intent.move, null); assert.equal(r.intent.startMove, null); assert.equal(r.intent.face, null);
  assert(released.length > 0);
});

test('soldier keeps 0.3m inside slash and thrust reach', () => {
  for (const [d, attacks] of [[1.4, true], [1.401, false], [2.3, true], [2.301, false]]) {
    const {brain, view} = battle('soldier', d);
    const {intent} = think(brain, view, 0.01);
    assert.equal(intent.startMove !== null, attacks, `distance ${d}`);
    if (!attacks) assert.equal(intent.speed, 'run');
  }
});

test('archer keeps 6–24m, retreats sideways up close and approaches beyond range', () => {
  for (const d of [5, 25]) {
    const {brain, view} = battle('archer', d);
    const {intent} = think(brain, view, 0.1);
    assert.equal(intent.startMove, null); assert.equal(intent.speed, 'run');
    const targetDistance = Math.hypot(intent.move.x - view.hero.x, intent.move.z - view.hero.z);
    if (d < 6) { assert(targetDistance > d); assert(intent.move.x !== 0); }
    else assert(targetDistance < d);
  }
  for (const d of [6, 20, 24]) {
    const {brain, view} = battle('archer', d);
    const r = think(brain, view, 0.1); assert.equal(r.intent.move, null); assert.equal(r.intent.startMove, null);
  }
});

test('archer must stand and aim for a full second; movement and lost LOS reset aiming', () => {
  const {brain, view} = battle('archer', 10);
  assert.equal(think(brain, view, 0.99).intent.startMove, null);
  assert.equal(think(brain, view, 0.01).intent.startMove, 'archer_shot');
  think(brain, view, 0.8); view.hero.z = -5; think(brain, view, 0.1); view.hero.z = -10;
  assert.equal(think(brain, view, 0.2).intent.startMove, null);
  view.world.los = () => false;
  assert.equal(think(brain, view, 1).intent.startMove, null); near(brain.aimTimer, 0);
});

test('officer chains a/b/c on ready, interruptions and long gaps reset to a', () => {
  const {brain, view} = battle('officer');
  assert.equal(think(brain, view, 0.01).intent.startMove, 'officer_a');
  view.self.state = 'attack'; view.self.ready = false;
  assert.equal(think(brain, view, 0.5).intent.startMove, null);
  view.self.ready = true;
  assert.equal(think(brain, view, 0.01).intent.startMove, 'officer_b');
  assert.equal(think(brain, view, 0.01).intent.startMove, 'officer_c');
  assert.equal(think(brain, view, 0.01).intent.startMove, 'officer_a');
  view.self.state = 'hit'; view.self.ready = false; think(brain, view, 0.1);
  view.self.state = 'idle'; view.self.ready = true;
  assert.equal(think(brain, view, 0.01).intent.startMove, 'officer_a');
  view.self.ready = false; think(brain, view, 1.21); view.self.ready = true;
  assert.equal(think(brain, view, 0.01).intent.startMove, 'officer_a');
});

test('officer rallies once at 50%, flees once at 25% and never attacks again', () => {
  const {brain, view} = battle('officer'); view.self.hp = 50;
  const r = think(brain, view, 0.01);
  assert.equal(r.intent.say, 'rally'); assert.equal(r.events.find(e => e.type === 'shout').radius, 14);
  assert.equal(think(brain, view, 0.01).events.length, 0);
  view.self.hp = 25; const flee = think(brain, view, 0.01);
  assert.equal(brain.state, 'retreat'); assert.equal(flee.intent.speed, 'run');
  assert.equal(flee.events.filter(e => e.type === 'leader_fled').length, 1);
  assert.equal(flee.intent.startMove, null);
  assert.equal(think(brain, view, 1).events.length, 0);
});

test('morale clamps, isolation penalizes once, only nearby living allies recover +1/s', () => {
  const {brain, view} = setup(); view.hero.z = 30; view.allies = [];
  think(brain, view, 1); near(brain.morale, 90); think(brain, view, 2); near(brain.morale, 90);
  view.allies = [fighter('dead', {hp: 0}), fighter('far', {x: 10.01})]; think(brain, view, 1); near(brain.morale, 90);
  view.allies = [fighter('friend', {x: 10})]; think(brain, view, 2); near(brain.morale, 92);
  adjustMorale(brain, 100, 'rally'); near(brain.morale, 100);
  adjustMorale(brain, -200, 'loss'); near(brain.morale, 0);
});

test('morale below 30 routes through pathTo; reaching exit stops permanently', () => {
  const {brain, view} = battle(); adjustMorale(brain, -71, 'loss');
  const r = think(brain, view, 0.01);
  assert.equal(brain.state, 'retreat'); assert.equal(r.intent.speed, 'run');
  assert.equal(r.events.find(e => e.type === 'routed').id, 'e');
  view.self.x = 20; view.self.z = 0;
  assert.equal(think(brain, view, 1).intent.move, null);
  view.self.x = 0; assert.equal(think(brain, view, 1).intent.move, null);
  const s = battle(); s.brain.morale = 30; think(s.brain, s.view, 0); assert.equal(s.brain.state, 'combat');
});

test('no path, no exit or only an escape toward a nearby hero causes terminal surrender', () => {
  for (const mode of ['noPath', 'noExit', 'blocked', 'trapped']) {
    const {brain, view} = battle(); adjustMorale(brain, -80, 'loss');
    if (mode === 'noPath') view.world.pathTo = () => null;
    if (mode === 'noExit') brain.exit = null;
    if (mode === 'blocked') view.world.walkable = () => false;
    if (mode === 'trapped') { brain.exit = {x: 0, z: -20}; view.world.walkable = x => Math.abs(x) < 0.2; }
    const r = think(brain, view, 0.01);
    assert.equal(brain.state, 'surrendered', mode); assert.equal(r.intent.move, null);
    assert.equal(r.events.filter(e => e.type === 'surrendered').length, 1);
    assert.equal(think(brain, view, 1).events.length, 0);
  }
});

test('a nearby hero does not force surrender when a lateral escape is open', () => {
  const {brain, view} = battle(); adjustMorale(brain, -80, 'loss'); brain.exit = {x: 0, z: -20};
  const {intent, events} = think(brain, view, 0.01);
  assert.equal(brain.state, 'retreat'); assert.equal(intent.speed, 'run');
  assert(intent.move.x !== 0); assert.equal(events.some(e => e.type === 'surrendered'), false);
});

test('dead fighters do nothing and release outstanding attack tokens', () => {
  const {brain, view, released} = battle(); think(brain, view, 0.01);
  view.self.alive = false; const r = think(brain, view, 1);
  assert.equal(r.intent.startMove, null); assert.equal(r.intent.move, null); assert.deepEqual(released, ['e']);
});

test('JSON round trip preserves deterministic decisions, seeds and every finite numeric value', () => {
  const a = battle(), b = battle(); a.view.tokens.tryAcquire = b.view.tokens.tryAcquire = () => false;
  for (let i = 0; i < 100; i++) {
    a.brain = JSON.parse(JSON.stringify(a.brain));
    if (i === 10) { alertFromAlly(a.brain, {x: 4, z: 2}); alertFromAlly(b.brain, {x: 4, z: 2}); }
    assert.deepEqual(think(a.brain, a.view, 0.1), think(b.brain, b.view, 0.1));
    assert.deepEqual(a.brain, b.brain);
  }
  function check(value) {
    if (typeof value === 'number') assert(Number.isFinite(value));
    if (value && typeof value === 'object') Object.values(value).forEach(check);
  }
  check(a.brain); check(think(a.brain, a.view, NaN));
});
