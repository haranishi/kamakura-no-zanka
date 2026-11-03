// M0（走り・歩きの滑らかさ）：生成物の足運びの表が生成元と一致し、滑らかさの切替が URL を正しく読む。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildTable, render } from '../tools/gait-sample.mjs';
import { GAIT_TABLE } from '../dist/valley/gait-table.js';
import { STANCE_SPEED } from '../dist/valley/anim-data.js';
import { parseSmoothFlags, SMOOTH_NAMES } from '../dist/valley/smooth-flags.js';

test('gait-table.js is exactly what tools/gait-sample.mjs produces (not hand-edited)', () => {
  assert.equal(fs.readFileSync(new URL('../dist/valley/gait-table.js', import.meta.url), 'utf8'), render(buildTable()));
});

test('gait-table agrees with the measured STANCE_SPEED within 10% and covers the six cycles', () => {
  for (const name of Object.keys(STANCE_SPEED)) {
    const g = GAIT_TABLE[name]?.hero;
    assert(g, name);
    assert(Math.abs(g.stanceSpeed / STANCE_SPEED[name] - 1) < 0.1, `${name} ${g.stanceSpeed} vs ${STANCE_SPEED[name]}`);
    assert(g.leftLand >= 0 && g.leftLand < 1 && g.pass.length >= 2 && g.hipsY[0] < g.hipsY[1], name);
  }
  assert.equal(Object.keys(GAIT_TABLE.CMU_Run).length, 7);
});

test('smooth flags: default all new, off/all turns every change back, names turn back one by one', () => {
  const all = parseSmoothFlags('');
  for (const n of SMOOTH_NAMES) assert.equal(all[n], true);
  for (const q of ['?smooth=off', '?qa=1&smooth=all', 'off']) for (const n of SMOOTH_NAMES) assert.equal(parseSmoothFlags(q)[n], false, q + n);
  const some = parseSmoothFlags('?qa=1&smooth=speed,IK&seed=3');
  assert.deepEqual(SMOOTH_NAMES.filter(n => !some[n]), ['speed', 'ik']);
  assert.deepEqual([...parseSmoothFlags('?smooth=cam%65ra,bogus').unknown], ['bogus']);
  assert.equal(parseSmoothFlags('?smooth=camera%2').camera, true);   // 壊れた %xx でも投げない
  assert.equal(parseSmoothFlags('?smoothing=off').speed, true);       // 別の名前の引数は読まない
  assert(Object.isFrozen(some));
});
