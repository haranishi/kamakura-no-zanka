import test from 'node:test';
import assert from 'node:assert/strict';
import { SHOTS, shotOverride } from '../dist/valley/shots.js';

const terrain = { heightAt: (x, z) => 3 + x * .01 - z * .02 };
test('shots: every fixed view has finite numbers; the concept overlook looks north-east from the south-west', () => {
  for (const [name, s] of Object.entries(SHOTS)) {
    assert(Number.isFinite(s.eye) && s.eye > 0, name); assert.equal(s.pos.length, 2); assert(s.look.length >= 2 && s.look.length <= 3, name);
    assert([...s.pos, ...s.look, s.fov].every(Number.isFinite), name); assert(s.fov >= 30 && s.fov <= 70, name);
  }
  const c = SHOTS.concept; assert(c.look[0] > c.pos[0] && c.look[1] < c.pos[1]); assert(c.eye >= 30 && c.eye <= 60);
});
test('shots: a named view becomes a fixed camera in world coordinates; unknown names give null', () => {
  const o = shotOverride('concept', terrain), c = SHOTS.concept;
  assert.deepEqual(o.pos, [c.pos[0], terrain.heightAt(...c.pos) + c.eye, c.pos[1]]);
  assert.deepEqual(o.look, [c.look[0], terrain.heightAt(c.look[0], c.look[1]) + c.look[2], c.look[1]]); assert.equal(o.fov, c.fov);
  const v = shotOverride('village', terrain); assert.equal(v.look[1], terrain.heightAt(SHOTS.village.look[0], SHOTS.village.look[1]) + SHOTS.village.look[2]);
  for (const bad of ['', 'nope', 'constructor', '__proto__', null, undefined]) assert.equal(shotOverride(bad, terrain), null);
});
