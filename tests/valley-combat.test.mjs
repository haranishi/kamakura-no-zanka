import test from 'node:test';
import assert from 'node:assert/strict';
import {MOVES, STATS, createFighter, startMove, setBlock, startDodge, tick, strike,
  canFinish, finish, stealthStrike, applyDamage, projectileHit} from '../dist/valley/combat.js';

const fighter = (id = 'hero', options = {}) => createFighter({id, team: 'hero', kind: 'hero', ...options});
const pair = (options = {}) => [fighter(), fighter('enemy', {team: 'enemy', kind: 'soldier', z: -1, yaw: Math.PI, ...options})];
const active = (f, id = 'light1') => {
  assert.equal(startMove(f, id), true);
  tick(f, MOVES[id].windup);
};
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const broken = f => { applyDamage(f, 0, f.posture); assert.equal(f.state, 'stagger'); };

test('MOVES retains all contract fields and freezes each row', () => {
  assert.equal(Object.keys(MOVES).length, 13);
  assert.equal(Object.isFrozen(MOVES), true);
  for (const [id, m] of Object.entries(MOVES)) {
    assert.equal(m.id, id);
    for (const key of ['kind', 'windup', 'active', 'recover', 'damage', 'posture',
      'reach', 'arcDeg', 'lunge', 'blockable', 'telegraph', 'clip']) assert.ok(key in m, `${id}.${key}`);
    assert.equal(Object.isFrozen(m), true);
    assert.throws(() => { m.damage = 999; }, TypeError);
  }
  assert.deepEqual(['light1', 'light2', 'light3'].map(id => {
    const m = MOVES[id]; return [m.windup, m.active, m.recover, m.damage, m.posture, m.reach, m.arcDeg];
  }), [[.17, .10, .26, 12, 10, 1.9, 100], [.15, .10, .28, 12, 10, 1.9, 110], [.20, .12, .46, 18, 20, 1.9, 140]]);
  for (const [id, values] of Object.entries({
    heavy: [.42, .12, .55, 30, 36, 2, 90], finisher: [.25, .10, .65, 60, 0, 1.6, 90],
    soldier_slash: [.55, .12, .70, 10, 12, 1.7, 100], soldier_thrust: [.70, .10, .80, 12, 14, 2.6, 40],
    officer_a: [.35, .12, .30, 14, 14, 2, 110], officer_b: [.20, .12, .30, 14, 14, 2, 110],
    officer_c: [.45, .14, .80, 22, 24, 2.2, 120], counter: [.12, .10, .42, 26, 32, 2, 110],
  })) {
    const m = MOVES[id];
    assert.deepEqual([m.windup, m.active, m.recover, m.damage, m.posture, m.reach, m.arcDeg], values);
  }
});

test('STATS has all kinds, armor classes and 0.3m radii', () => {
  assert.deepEqual(Object.keys(STATS), ['hero', 'archer_ally', 'soldier', 'archer', 'officer']);
  assert.ok(Object.isFrozen(STATS));
  for (const [kind, s] of Object.entries(STATS)) {
    assert.ok(Object.isFrozen(s));
    assert.ok(s.hp > 0 && s.posture > 0);
    assert.equal(s.radius, .3);
    assert.ok(['none', 'light', 'heavy'].includes(s.armor));
    const f = fighter(kind, {kind});
    assert.equal(f.hp, s.hp); assert.equal(f.posture, s.posture);
    assert.equal(f.hpMax, s.hp); assert.equal(f.postureMax, s.posture);
  }
});

test('tick emits each phase once even across a large step', () => {
  const f = fighter();
  startMove(f, 'light1');
  assert.deepEqual(tick(f, .53), ['windup', 'active', 'recover', 'end'].map(phase =>
    ({type: 'phase', id: 'hero', moveId: 'light1', phase})));
  assert.equal(f.state, 'idle'); assert.equal(f.move, null);
  assert.deepEqual(tick(f, 1), []);
});

test('chain accepts only the next light during recovery and rejects idle light2/light3', () => {
  const f = fighter();
  assert.equal(startMove(f, 'light2'), false);
  assert.equal(startMove(f, 'light3'), false);
  startMove(f, 'light1');
  assert.equal(startMove(f, 'light2'), false);
  tick(f, .17);
  assert.equal(startMove(f, 'light2'), false);
  tick(f, .10);
  assert.equal(startMove(f, 'heavy'), false);
  assert.equal(startMove(f, 'light3'), false);
  assert.equal(startMove(f, 'light2'), true);
  tick(f, .25);
  assert.equal(startMove(f, 'light3'), true);
  tick(f, .78);
  assert.equal(startMove(f, 'light1'), true);
});

test('chain window accepts officer transitions and rejects wrong/completed predecessors', () => {
  const f = fighter('officer', {kind: 'officer'});
  startMove(f, 'officer_a'); tick(f, .47);
  assert.equal(startMove(f, 'officer_b'), true);
  tick(f, .32);
  assert.equal(startMove(f, 'officer_c'), true);
  tick(f, .59);
  // 長い戻りの技で、chainFromに合わない再入力も拒否する。
  assert.equal(startMove(f, 'officer_b'), false);
  const g = fighter(); startMove(g, 'light1'); tick(g, .53);
  assert.equal(startMove(g, 'light2'), false);
  assert.equal(startMove(g, 'heavy'), true);
});

test('a move can hit each target once, and a new move can hit it again', () => {
  const [a, d] = pair(); active(a);
  const hit = strike(a, d);
  assert.deepEqual(hit, {outcome: 'hit', damage: 12, postureDamage: 10, staggered: false,
    dead: false, moveId: 'light1', attackerId: 'hero', defenderId: 'enemy'});
  assert.equal(d.hp, STATS.soldier.hp - 12);
  assert.equal(strike(a, d), null);
  const second = fighter('second', {z: -1});
  assert.equal(strike(a, second).outcome, 'hit');
  tick(a, .1); assert.equal(startMove(a, 'light2'), true); tick(a, .15);
  assert.equal(strike(a, d).outcome, 'hit');
});

test('reach includes one target radius and rejects distance/angle misses without consuming hit', () => {
  const [a, d] = pair({z: -2.20001}); active(a);
  assert.equal(strike(a, d), null);
  d.z = -2.2;
  assert.equal(strike(a, d).outcome, 'hit');
  const [b, e] = pair({x: 1, z: 0}); active(b);
  assert.equal(strike(b, e), null);
  e.x = Math.sin(50 * Math.PI / 180); e.z = -Math.cos(50 * Math.PI / 180);
  assert.equal(strike(b, e).outcome, 'hit');
  const [c, h] = pair({x: Math.sin(50.01 * Math.PI / 180), z: -Math.cos(50.01 * Math.PI / 180)}); active(c);
  assert.equal(strike(c, h), null);
  assert.deepEqual(c.move.struck, []);
});

test('yaw uses (-sin, -cos), including wrapped headings and coincident centers', () => {
  const [a, d] = pair({x: -1, z: 0}); a.yaw = Math.PI / 2 + 4 * Math.PI; active(a);
  assert.equal(strike(a, d).outcome, 'hit');
  const [b, e] = pair({z: 0}); active(b);
  assert.equal(strike(b, e).outcome, 'hit');
});

test('windup and recover cannot strike; enemy telegraph ends at active', () => {
  const [a, d] = pair(); startMove(a, 'soldier_slash');
  assert.equal(a.telegraphing, true); assert.equal(strike(a, d), null);
  tick(a, .55); assert.equal(a.telegraphing, false);
  tick(a, .12); assert.equal(strike(a, d), null);
});

test('parry before .2s interrupts attacker for .5s and leaves defender untouched', () => {
  const [a, d] = pair(); active(a); setBlock(d, true); tick(d, .199);
  const before = [d.hp, d.posture];
  assert.equal(strike(a, d).outcome, 'parried');
  assert.deepEqual([d.hp, d.posture], before);
  assert.equal(a.posture, 60); assert.equal(a.state, 'recoil'); assert.equal(a.move, null);
  assert.equal(startMove(a, 'light1'), false);
  tick(a, .499); assert.equal(a.state, 'recoil');
  tick(a, .001); assert.equal(a.state, 'idle');
});

test('parry expires at .2s and holding block cannot rearm the window', () => {
  const [a, d] = pair(); active(a); setBlock(d, true); tick(d, .2); setBlock(d, true);
  assert.equal(d.parryT, 0);
  const before = [d.hp, d.posture];
  const r = strike(a, d);
  assert.equal(r.outcome, 'blocked'); close(r.damage, 1.8); assert.equal(r.postureDamage, 5);
  close(d.hp, before[0] - 1.8); assert.equal(d.posture, before[1] - 5);
  assert.equal(d.blocking, true); assert.equal(d.state, 'idle');
  setBlock(d, false); setBlock(d, true); assert.equal(d.parryT, .2);
});

test('block only covers front 120 degrees', () => {
  for (const [angle, expected] of [[60, 'blocked'], [60.01, 'hit'], [180, 'hit']]) {
    const [a, d] = pair(); active(a); d.yaw = Math.PI + angle * Math.PI / 180;
    setBlock(d, true); tick(d, .21);
    assert.equal(strike(a, d).outcome, expected);
  }
});

test('guard break staggers and heavy blocked attacks recoil', () => {
  const [a, d] = pair(); d.posture = 5; active(a); setBlock(d, true); tick(d, .2);
  assert.equal(strike(a, d).staggered, true); assert.equal(d.blocking, false);
  const [b, e] = pair(); active(b, 'heavy'); setBlock(e, true); tick(e, .2);
  assert.equal(strike(b, e).outcome, 'blocked'); assert.equal(b.state, 'recoil');
});

test('parry posture break takes priority over attacker recoil', () => {
  const [a, d] = pair(); a.posture = 40; active(a); setBlock(d, true);
  strike(a, d); assert.equal(a.state, 'stagger');
  assert.ok(tick(a, 0).some(e => e.type === 'stagger_start'));
});

test('dodge invulnerability is limited to .06 through .30 seconds and consumes the hit', () => {
  for (const [time, expected] of [[.059, 'hit'], [.06, 'evaded'], [.2, 'evaded'], [.30, 'evaded'], [.301, 'hit']]) {
    const [a, d] = pair(); active(a); startDodge(d); tick(d, time);
    const hp = d.hp; const r = strike(a, d);
    assert.equal(r.outcome, expected, String(time));
    assert.equal(strike(a, d), null);
    if (expected === 'evaded') assert.equal(d.hp, hp);
  }
});

test('dodge action locks, .52s duration, cost and zero-posture priority', () => {
  const f = fighter();
  assert.equal(startDodge(f, Math.PI / 2), true);
  assert.equal(f.posture, 88); assert.equal(f.yaw, Math.PI / 2);
  assert.equal(startMove(f, 'light1'), false); assert.equal(setBlock(f, true), false);
  assert.equal(startDodge(f), false);
  tick(f, .519); assert.equal(f.state, 'dodge'); tick(f, .001); assert.equal(f.state, 'idle');
  f.posture = 11.99; assert.equal(startDodge(f), false);
  f.posture = 12; assert.equal(startDodge(f), true); assert.equal(f.state, 'stagger');
});

test('block rejects busy states and attacks require releasing block', () => {
  const f = fighter(); setBlock(f, true);
  assert.equal(startMove(f, 'light1'), false); assert.equal(startDodge(f), false);
  setBlock(f, false); active(f); assert.equal(setBlock(f, true), false);
  for (const state of ['dodge', 'hit', 'stagger', 'recoil']) {
    const g = fighter(); g.state = state;
    assert.equal(setBlock(g, true), false); assert.equal(startMove(g, 'light1'), false);
  }
});

test('an enemy\'s posture break lasts 2.2s (the time to finish it), emits events once and restores 50 percent', () => {
  const f = fighter('s', {team: 'enemy', kind: 'soldier'}); broken(f);
  assert.deepEqual(tick(f, 2.199), [{type: 'stagger_start', id: f.id}]);
  assert.equal(f.posture, 0); assert.equal(f.state, 'stagger');
  assert.deepEqual(tick(f, .001), [{type: 'stagger_end', id: f.id}]);
  assert.equal(f.posture, f.postureMax / 2); assert.equal(f.state, 'idle');
  assert.deepEqual(tick(f, 0), []);
});

test('posture regenerates 18 per second only after 1.2s, pauses for block/attack/stagger', () => {
  const f = fighter('armor', {kind: 'soldier'}); applyDamage(f, 0, 20);
  tick(f, 1.2); assert.equal(f.posture, 30); tick(f, .5); assert.equal(f.posture, 39);
  setBlock(f, true); tick(f, 3); assert.equal(f.posture, 39);
  setBlock(f, false); startMove(f, 'soldier_thrust'); tick(f, 1.5);
  assert.equal(f.posture, 39); tick(f, .2); assert.equal(f.state, 'idle');
  close(f.posture, 40.8);
  tick(f, .5); close(f.posture, 49.8); tick(f, 10); assert.equal(f.posture, f.postureMax);
  const g = fighter(); applyDamage(g, 0, 20); tick(g, 1);
  applyDamage(g, 1, 0); tick(g, 1); assert.equal(g.posture, 80);
});

test('the hero\'s posture break is shorter than an enemy\'s, and a strong hit makes a lightly armored soldier flinch', () => {
  const h = fighter('hero', {kind: 'hero'}); broken(h);
  assert.deepEqual(tick(h, 1.399), [{type: 'stagger_start', id: h.id}]); assert.equal(h.state, 'stagger');
  assert.deepEqual(tick(h, .001), [{type: 'stagger_end', id: h.id}]); assert.equal(h.state, 'idle');
  for (const [moveId, flinches] of [['light1', false], ['light2', false], ['light3', true], ['heavy', true], ['counter', true]]) {
    const a = fighter('a', {kind: 'hero'}), d = fighter('d', {kind: 'soldier', x: 1.2});
    a.yaw = Math.atan2(-(d.x - a.x), -(d.z - a.z)); d.yaw = a.yaw + Math.PI;
    d.state = 'idle'; startMove(d, 'soldier_slash');
    applyDamage(d, 1, 1, ['light3', 'heavy', 'counter'].includes(moveId));
    assert.equal(d.state, flinches ? 'hit' : 'attack', moveId);
  }
  const o = fighter('o', {kind: 'officer'}); startMove(o, 'officer_a'); applyDamage(o, 1, 1, true); assert.equal(o.state, 'attack');   // 重い鎧はひるまない
});
test('none armor interrupts windup/active while light/heavy continue until posture break', () => {
  for (const kind of ['hero', 'soldier', 'officer']) {
    for (const elapsed of [0, .17]) {
      const f = fighter(kind, {kind}); startMove(f, 'light1'); tick(f, elapsed);
      applyDamage(f, 1, 1);
      assert.equal(f.state, kind === 'hero' ? 'hit' : 'attack');
      assert.equal(f.move === null, kind === 'hero');
      if (kind === 'hero') { tick(f, .3); assert.equal(f.state, 'idle'); }
      else { broken(f); assert.equal(f.move, null); }
    }
  }
});

test('finish requires living staggered target, ready attacker, 1.9m and forward 90 degrees', () => {
  const [a, d] = pair(); assert.equal(canFinish(a, d), false); assert.equal(finish(a, d), false);
  broken(d); d.z = -1.90001; assert.equal(canFinish(a, d), false);
  d.z = -1.9; assert.equal(canFinish(a, d), true);
  a.yaw = Math.PI; assert.equal(canFinish(a, d), false); a.yaw = 0;
  setBlock(a, true); assert.equal(canFinish(a, d), false); setBlock(a, false);
  assert.equal(startMove(a, 'finisher'), false);
  assert.equal(finish(a, d), true); assert.equal(d.hp, 60);
  assert.equal(strike(a, d), null); tick(a, .25);
  assert.equal(strike(a, d).dead, true); assert.equal(d.hp, 0);
});

test('officer finisher deals hpMax 30 percent, only to its selected staggered target', () => {
  const [a, d] = pair({kind: 'officer'}); broken(d);
  d.hp = 100; finish(a, d); tick(a, .25);
  const other = fighter('other', {kind: 'officer', z: -1}); broken(other);
  assert.equal(strike(a, other), null);
  const r = strike(a, d); assert.equal(r.damage, 60); assert.equal(d.hp, 40); assert.equal(r.dead, false);
  const [b, e] = pair(); broken(e); finish(b, e); tick(b, .25); tick(e, 2.2);
  assert.equal(strike(b, e), null);
});

test('finisher bypasses guard/parry on staggered target', () => {
  const [a, d] = pair(); broken(d); finish(a, d); tick(a, .25);
  d.blocking = true; d.parryT = .2;
  assert.equal(strike(a, d).outcome, 'hit'); assert.equal(a.state, 'attack');
});

test('stealth only from rear 90 degrees, unaware, and within 1.9m', () => {
  for (const [x, z, aware, expected] of [[0, -1, false, 'stealth'], [0, 0, false, 'stealth'],
    [1, -1, false, 'stealth'], [1.01, -1, false, null], [0, -1.90001, false, null], [0, -1, true, null]]) {
    const [a, d] = pair({z: 0}); d.aware = aware; a.x = x; a.z = z;
    // 同位置の相手は方向が定まらないが、距離0を扇形の内とする。
    const outcome = stealthStrike(a, d)?.outcome ?? null;
    assert.equal(outcome, expected);
    if (outcome === 'stealth') assert.equal(d.alive, false);
  }
  const [a, d] = pair({z: 0}); d.aware = false; a.z = 1;
  assert.equal(stealthStrike(a, d), null);
});

test('officer stealth removes 45 percent current hp and staggers without killing', () => {
  const [a, d] = pair({kind: 'officer', z: 0}); d.aware = false; a.z = -1; d.hp = 80;
  const r = stealthStrike(a, d);
  assert.equal(r.outcome, 'stealth'); assert.equal(r.damage, 36); assert.equal(d.hp, 44);
  assert.equal(r.staggered, true); assert.equal(r.dead, false); assert.equal(d.aware, true);
  assert.equal(stealthStrike(a, d), null);
});

test('projectiles evade, block front at 40 percent hp/50 percent posture, never parry', () => {
  const f = fighter(); setBlock(f, true);
  const r = projectileHit(f, {damage: 10, posture: 8, fromYaw: 0});
  assert.equal(r.outcome, 'blocked'); assert.equal(r.damage, 4); assert.equal(r.postureDamage, 4);
  assert.equal(f.hp, 96); assert.equal(f.posture, 96); assert.equal(f.blocking, true);
  const g = fighter(); startDodge(g); tick(g, .1);
  assert.equal(projectileHit(g, {damage: 10, posture: 8}).outcome, 'evaded');
  const h = fighter(); setBlock(h, true);
  assert.equal(projectileHit(h, {damage: 10, posture: 8, fromYaw: Math.PI}).outcome, 'hit');
  const i = fighter(); setBlock(i, true);
  assert.equal(projectileHit(i, {damage: 10, posture: 8, fromYaw: 0, blockable: false}).outcome, 'hit');
});

test('projectile guard break and death use the same damage rules', () => {
  const f = fighter(); f.posture = 4; setBlock(f, true);
  assert.equal(projectileHit(f, {damage: 10, posture: 8, fromYaw: 0}).staggered, true);
  assert.equal(projectileHit(f, {damage: 999, posture: 0}).dead, true);
});

test('shot moves signal active but strike cannot create a melee hit', () => {
  for (const id of ['archer_shot', 'ally_shot']) {
    const [a, d] = pair(); const m = MOVES[id];
    assert.equal(m.kind, 'shot'); assert.equal(m.damage, id === 'ally_shot' ? 10 : 12);
    assert.deepEqual([m.windup, m.active, m.recover, m.posture], [.9, .05, 1.2, 8]);
    active(a, id); assert.equal(strike(a, d), null);
  }
});

test('dead fighters accept no damage or actions and dead attackers cannot hit', () => {
  const [a, d] = pair(); active(a); applyDamage(d, 999, 999);
  tick(d, 0); const before = structuredClone(d);
  assert.equal(strike(a, d), null); assert.equal(applyDamage(d, 1, 1), null);
  assert.equal(projectileHit(d, {damage: 1}), null); assert.equal(stealthStrike(a, d), null);
  assert.equal(startMove(d, 'light1'), false); assert.equal(setBlock(d, true), false);
  assert.equal(startDodge(d), false); assert.equal(finish(d, a), false);
  assert.deepEqual(tick(d, 10), []); assert.deepEqual(d, before);
  applyDamage(a, 999, 0); assert.equal(strike(a, fighter('live', {z: -1})), null);
});

test('state survives JSON roundtrip at each combat state and resumes identically', () => {
  const states = [];
  const f = fighter(); states.push(structuredClone(f)); startMove(f, 'light1'); states.push(structuredClone(f));
  tick(f, .17); states.push(structuredClone(f));
  const d = fighter('d'); startDodge(d); tick(d, .1); states.push(d);
  const h = fighter('h'); applyDamage(h, 1, 1); states.push(h);
  const s = fighter('s'); broken(s); states.push(s);
  const dead = fighter('dead'); applyDamage(dead, 999, 0); states.push(dead);
  for (const state of states) {
    const copy = JSON.parse(JSON.stringify(state)); assert.deepEqual(copy, state);
    assert.deepEqual(tick(copy, .5), tick(state, .5)); assert.deepEqual(copy, state);
  }
});

test('1/60 and 1/30 ticks produce equal phase events, timers and posture regeneration', () => {
  for (const setup of [f => startMove(f, 'soldier_thrust'), f => startDodge(f),
    f => broken(f), f => applyDamage(f, 1, 20), f => { setBlock(f, true); }]) {
    const a = fighter(), b = fighter(); setup(a); setup(b);
    const ea = [], eb = [];
    for (let n = 0; n < 90; n++) {
      ea.push(...tick(a, 1 / 60), ...tick(a, 1 / 60));
      eb.push(...tick(b, 1 / 30));
      assert.deepEqual(a, b);
    }
    assert.deepEqual(ea, eb);
    assert.deepEqual(a, b);
  }
});

test('invalid inputs cannot introduce NaN or Infinity', () => {
  const f = fighter('f', {x: NaN, z: Infinity, yaw: NaN, hp: Infinity, posture: NaN});
  applyDamage(f, NaN, Infinity); startDodge(f, NaN);
  for (const dt of [NaN, Infinity, -1, 0]) tick(f, dt);
  for (const v of Object.values(f)) if (typeof v === 'number') assert.ok(Number.isFinite(v));
  assert.equal(startMove(f, 'unknown'), false);
  assert.equal(startMove(f, 'toString'), false);
  assert.throws(() => fighter('bad', {kind: 'unknown'}), RangeError);
  const huge = fighter('huge', {hp: Number.MAX_VALUE, posture: Number.MAX_VALUE});
  applyDamage(huge, 1, 1); tick(huge, 1);
  assert.ok(Number.isFinite(huge.hp)); assert.ok(Number.isFinite(huge.posture));
});

test('a parry opens a counter window for the defender only, the counter consumes it, and it expires', () => {
  const att = createFighter({id: 's', team: 'enemy', kind: 'soldier', x: 0, z: -1, yaw: Math.PI});
  const def = fighter('hero', {x: 0, z: 0, yaw: 0});
  assert.equal(startMove(def, 'counter'), false, 'no counter without a parry');
  startMove(att, 'soldier_slash'); tick(att, .40);
  setBlock(def, true);                                   // 当たりの直前（0.15秒前）に押す＝弾きの窓の中
  tick(att, .15); tick(def, .15);
  const res = strike(att, def);
  assert.equal(res.outcome, 'parried');
  assert.equal(att.counterT, 0, 'the attacker gets no window');
  assert.ok(def.counterT > 0.8);
  setBlock(def, false);
  assert.equal(startMove(def, 'counter'), true);
  assert.equal(def.state, 'attack'); assert.equal(def.counterT, 0);
  tick(def, MOVES.counter.windup + MOVES.counter.active + MOVES.counter.recover + 0.01);
  assert.equal(startMove(def, 'counter'), false, 'one counter per parry');
  // 時間切れ
  const d2 = fighter('hero2'); d2.counterT = 0.9; tick(d2, 0.91);
  assert.equal(d2.counterT, 0); assert.equal(startMove(d2, 'counter'), false);
  // 窓があっても、構えを崩されて動けない間は出せない
  const d3 = fighter('hero3'); d3.counterT = 0.9; applyDamage(d3, 0, d3.posture);
  assert.equal(startMove(d3, 'counter'), false);
});
