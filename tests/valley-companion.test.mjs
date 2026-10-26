import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompanion, setMode, thinkCompanion } from '../dist/valley/companion-ai.js';
const fighter = (id, x = 0, z = 0) => ({ id, x, z, yaw: 0, hp: 100, hpMax: 100, ready: true, alive: true, state: 'idle' });
function setup(mode = 'follow') {
  const c = createCompanion({ id: 'archer', mode });
  const goals = [];
  const v = { t: 0, self: fighter('archer', 0, 7), hero: fighter('hero'), enemies: [], world: {
    los: () => true, walkable: () => true, pathTo: (a, b) => { goals.push(b); return [a, b]; },
  } };
  return { c, v, goals };
}
test('follow aims behind left at every yaw, stays still at its slot', () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const { c, v, goals } = setup(); v.hero.yaw = yaw;
    thinkCompanion(c, v, 0);
    const p = goals[0], f = { x: -Math.sin(yaw), z: -Math.cos(yaw) }, l = { x: -Math.cos(yaw), z: Math.sin(yaw) };
    assert.ok(Math.abs(p.x * f.x + p.z * f.z + 3.25) < 1e-9);
    assert.ok(Math.abs(p.x * l.x + p.z * l.z - 1) < 1e-9);
    Object.assign(v.self, p);
    assert.equal(thinkCompanion(c, v, 0.1).intent.speed, 'stop');
  }
});
test('narrow path falls back behind; a detour never directs movement ahead of hero', () => {
  const { c, v, goals } = setup(); v.world.walkable = x => x === 0;
  thinkCompanion(c, v, 0.1); assert.equal(goals[0].x, 0);
  v.self.z = 0.5; v.world.pathTo = () => [{ x: 0, z: -4 }];
  const r = thinkCompanion(c, v, 0.1); assert.equal(r.intent.move, null);
});
test('path failure retries every two seconds and never overwrites position', () => {
  const { c, v } = setup(); let calls = 0;
  v.world.pathTo = () => { calls++; return null; };
  const before = structuredClone(v.self);
  assert.equal(thinkCompanion(c, v, 0).intent.move, null);
  assert.equal(c.state, 'repath');
  thinkCompanion(c, v, 1.9); assert.equal(calls, 1);
  thinkCompanion(c, v, 0.1); assert.equal(calls, 2);
  assert.deepEqual(v.self, before);
  assert.equal('position' in thinkCompanion(c, v, 0).intent, false);
});
test('cover stays more than six metres behind; hold and retreat use explicit safe point', () => {
  const { c, v, goals } = setup('cover'); thinkCompanion(c, v, 0);
  assert.ok(goals[0].z >= 6);
  for (const mode of ['hold', 'retreat']) {
    setMode(c, mode, { x: 9, z: 12 }); thinkCompanion(c, v, 0);
    assert.deepEqual(goals.at(-1), { x: 9, z: 12 });
  }
  assert.equal(setMode(c, 'run'), false);
});
test('shots require LOS and range, select nearest, and respect 2.4 seconds in both modes', () => {
  for (const mode of ['follow', 'cover']) {
    const { c, v } = setup(mode); v.self.z = 0;
    v.enemies = [fighter('far', 24.001), fighter('near', 12), fighter('hidden', 4)];
    v.world.los = (a, b) => b.id !== 'hidden';
    let r = thinkCompanion(c, v, 0);
    assert.deepEqual(r.intent.shoot, { targetId: 'near' }); assert.equal(r.intent.startMove, 'ally_shot');
    assert.deepEqual(r.events, [{ type: 'shot', id: 'archer' }]);
    assert.equal(thinkCompanion(c, v, 2.399).intent.shoot, null);
    assert.equal(thinkCompanion(c, v, 0.002).intent.shoot.targetId, 'near');
    c.shotIn = 0; v.enemies = [fighter('edge', 24)];
    assert.equal(thinkCompanion(c, v, 0).intent.shoot.targetId, 'edge');
    c.shotIn = 0; v.enemies[0].x = 24.001;
    assert.equal(thinkCompanion(c, v, 0).intent.shoot, null);
    v.enemies[0].x = 2; v.world.los = () => false;
    assert.equal(thinkCompanion(c, v, 0).intent.shoot, null);
    v.world.los = () => true; v.self.ready = false;
    assert.equal(thinkCompanion(c, v, 0).intent.shoot, null);
  }
});
test('down never dies; safe timer pauses within 8m and recovers at 30 percent', () => {
  const { c, v } = setup(); v.self.hp = 0; v.self.hpMax = 80; v.self.alive = false;
  let r = thinkCompanion(c, v, 3);
  assert.deepEqual(r.events, [{ type: 'down', id: 'archer' }]);
  assert.equal(v.self.alive, true); assert.equal(v.self.state, 'down');
  v.enemies = [fighter('enemy', 0, 15)];
  assert.equal(thinkCompanion(c, v, 20).events.length, 0); assert.equal(c.safeTime, 3);
  v.enemies = []; thinkCompanion(c, v, 4.999); assert.equal(v.self.hp, 0);
  r = thinkCompanion(c, v, 0.002); assert.equal(v.self.hp, 24);
  assert.deepEqual(r.events, [{ type: 'recovered', id: 'archer' }]);
  assert.equal(v.self.alive, true);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(c)));
});
test('invalid dt does not poison timers', () => {
  const { c, v } = setup();
  for (const dt of [NaN, Infinity, -1]) thinkCompanion(c, v, dt);
  assert.ok(Number.isFinite(c.shotIn)); assert.ok(Number.isFinite(c.retryIn));
});
