import test from 'node:test';
import assert from 'node:assert/strict';
import { SHOTS, shotOverride } from '../dist/valley/shots.js';

const terrain = { heightAt: (x, z) => 3 + x * .01 - z * .02 };
test('shots: every fixed view has finite numbers; the concept overlook looks north by east from the south', () => {
  for (const [name, s] of Object.entries(SHOTS)) {
    assert(Number.isFinite(s.eye) && s.eye > 0, name); assert.equal(s.pos.length, 2); assert(s.look.length >= 2 && s.look.length <= 3, name);
    assert([...s.pos, ...s.look, s.fov].every(Number.isFinite), name); assert(s.fov >= 30 && s.fov <= 70, name);
  }
  const c = SHOTS.concept; assert(c.look[0] > c.pos[0] && c.look[1] < c.pos[1]); assert(c.eye >= 30 && c.eye <= 90);
  // North by east: the river then runs down the right of the frame and the evening sun (bearing 55) stays inside its right edge.
  const bearing = Math.atan2(c.look[0] - c.pos[0], c.pos[1] - c.look[1]) * 180 / Math.PI; assert(bearing >= 8 && bearing <= 24, String(bearing));
  // It looks down by 10 to 20 degrees, so that the terraces fill the foot of the frame and the far hills its top edge.
  const run = Math.hypot(c.look[0] - c.pos[0], c.look[1] - c.pos[1]), pitch = Math.atan2(c.eye - c.look[2], run) * 180 / Math.PI; assert(pitch >= 8 && pitch <= 20, String(pitch));
});
test('shots: a named view becomes a fixed camera in world coordinates; unknown names give null', () => {
  const o = shotOverride('concept', terrain), c = SHOTS.concept;
  assert.deepEqual(o.pos, [c.pos[0], terrain.heightAt(...c.pos) + c.eye, c.pos[1]]);
  assert.deepEqual(o.look, [c.look[0], terrain.heightAt(c.look[0], c.look[1]) + c.look[2], c.look[1]]); assert.equal(o.fov, c.fov);
  const v = shotOverride('village', terrain); assert.equal(v.look[1], terrain.heightAt(SHOTS.village.look[0], SHOTS.village.look[1]) + SHOTS.village.look[2]);
  for (const bad of ['', 'nope', 'constructor', '__proto__', null, undefined]) assert.equal(shotOverride(bad, terrain), null);
});
