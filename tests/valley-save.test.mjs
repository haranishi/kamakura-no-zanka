import test from 'node:test';
import assert from 'node:assert/strict';
import { VALLEY_KEY, VALLEY_SCHEMA_VERSION, initialSave, sanitize, migrate, loadValley, saveValley } from '../dist/valley/save.js';
const storage = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) }; };
test('save roundtrip is isolated, serializable and uses versioned valley key', () => {
  const st = storage(), s = initialSave();
  assert.equal(VALLEY_SCHEMA_VERSION, 1); assert.equal(VALLEY_KEY, 'kamakura-valley-progress');
  assert.equal(loadValley(st).hasSave, false);
  s.flags.archerJoined = true; s.party.archer.joined = true;
  s.world.enemies.officer = { alive: false }; s.player.hp = 77;
  assert.deepEqual(saveValley(st, s), { ok: true, notice: '' });
  const r = loadValley(st); assert.equal(r.hasSave, true); assert.deepEqual(r.state, s);
  r.state.player.hp = 1; assert.equal(s.player.hp, 77);
  assert.deepEqual(migrate(s), s);
});
test('unknown properties are stripped at every nesting level', () => {
  const s = initialSave(); s.extra = 'ignored'; s.flags.extra = 1; s.resources.extra = 2;
  s.party.archer.extra = 4; s.player.extra = 5; s.world.enemies.officer = { alive: false, hp: 2 };
  const r = sanitize(s);
  assert.equal('extra' in r, false); assert.equal('extra' in r.flags, false);
  assert.equal('extra' in r.resources, false); assert.equal('extra' in r.party.archer, false);
  assert.deepEqual(r.world.enemies.officer, { alive: false });
});
test('invalid numbers, types, missing structures and strings reject the whole save', () => {
  const changes = [
    s => s.resources.food = NaN, s => s.resources.food = Infinity,
    s => s.resources.food = 1e300, s => s.resources.food = -1,
    s => s.resources.morale = '50', s => s.player.hp = 1001,
    s => s.trust = null, s => s.savedAt = Infinity, s => s.savedAt = -1,
    s => s.party.archer.hp = NaN, s => s.party.archer.mode = 'x'.repeat(10000),
    s => s.flags.archerJoined = 'true', s => s.flags.plan = 'other',
    s => s.flags.ambush = 'bad', s => s.checkpoint = 'unknown', s => s.beat = 'b999',
    s => s.resources = [], s => s.player = null, s => delete s.world,
    s => s.world.enemies.officer = { alive: 0 },
    s => s.world.enemies['x'.repeat(65)] = { alive: true },
    s => s.party.archer.joined = true,
  ];
  for (const change of changes) {
    const s = initialSave(); change(s);
    assert.throws(() => sanitize(s), TypeError);
    const st = storage(); st.setItem(VALLEY_KEY, JSON.stringify(s));
    const r = loadValley(st); assert.equal(r.hasSave, false); assert.deepEqual(r.state, initialSave());
    assert.ok(r.notice.length > 0); assert.equal(saveValley(st, s).ok, false);
  }
  for (const raw of [null, 4, 'string', []]) assert.throws(() => sanitize(raw));
});
test('future versions, incorrect schema and corrupt JSON recover with a reason', () => {
  for (const text of ['{broken', 'null', JSON.stringify({ ...initialSave(), version: 2 }), JSON.stringify({ ...initialSave(), schema: 'other' })]) {
    const st = storage(); st.setItem(VALLEY_KEY, text);
    const r = loadValley(st); assert.equal(r.hasSave, false); assert.deepEqual(r.state, initialSave()); assert.ok(r.notice);
  }
});
test('unavailable storage, read and write exceptions never escape', () => {
  for (const st of [undefined, {}, { getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); } }]) {
    assert.equal(loadValley(st).hasSave, false);
    const r = saveValley(st, initialSave()); assert.equal(r.ok, false); assert.ok(r.notice);
  }
});
test('dead IDs remain dead across stale saves and never duplicate or mutate the caller', () => {
  const st = storage(), s = initialSave(); s.world.enemies.officer = { alive: false };
  saveValley(st, s);
  const stale = initialSave(); stale.world.enemies.officer = { alive: true }; stale.world.enemies.scout = { alive: false };
  assert.equal(saveValley(st, stale).ok, true);
  let r = loadValley(st).state;
  assert.deepEqual(r.world.enemies, { officer: { alive: false }, scout: { alive: false } });
  assert.equal(stale.world.enemies.officer.alive, true);
  saveValley(st, initialSave()); r = loadValley(st).state;
  assert.equal(Object.keys(r.world.enemies).length, 2); assert.equal(r.world.enemies.officer.alive, false);
});
test('enemy map rejects prototype keys and excessive IDs', () => {
  const s = initialSave(); s.world.enemies = JSON.parse('{"__proto__":{"alive":false}}');
  assert.throws(() => sanitize(s));
  s.world.enemies = Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`enemy_${i}`, { alive: true }]));
  assert.throws(() => sanitize(s));
});
