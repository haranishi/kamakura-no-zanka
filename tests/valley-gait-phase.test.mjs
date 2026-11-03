// M2a（走り・歩きの滑らかさ）：足の位相の純粋層（dist/valley/gait-phase.js）と、?smooth=phase の切替（loco.js）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { passStartTime } from '../dist/valley/gait-phase.js';
import { GAIT_TABLE } from '../dist/valley/gait-table.js';
import { parseLoco } from '../dist/valley/loco.js';

const RUN = GAIT_TABLE.CMU_Run.hero;

test('start from the passing phase of the gait table', () => {
  assert.equal(passStartTime(RUN), RUN.pass[0] * RUN.period);
  assert.equal(passStartTime(RUN, 1), RUN.pass[1] * RUN.period);
  assert.equal(passStartTime(null), null);
  assert.equal(passStartTime({ period: 1 }), null);
});

test('?smooth=phase, ?smooth=off and ?loco=old turn the phase layer back', () => {
  assert.equal(parseLoco('').smoothPhase, true);
  for (const q of ['?smooth=phase', '?smooth=off', '?loco=old', '?smooth=speed,phase']) assert.equal(parseLoco(q).smoothPhase, false, q);
  assert.equal(parseLoco('?smooth=speed').smoothPhase, true);
});
