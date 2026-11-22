import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOUCH_CFG,
  detectTouchMode,
  selectInitialQuality,
  stickRadius,
  clampOrigin,
  stickFromDrag,
  LookDrag,
  touchPromptSpec,
} from '../dist/valley/touch-math.js';

test('detectTouchMode honors ?touch=1|0 before coarse pointer detection', () => {
  assert.equal(detectTouchMode('?touch=1', false), 'on');
  assert.equal(detectTouchMode('?touch=0', true), 'off');
  assert.equal(detectTouchMode('', true), 'on');
  assert.equal(detectTouchMode('', false), 'auto');
});

test('selectInitialQuality defaults touch devices to light while respecting explicit overrides', () => {
  assert.equal(selectInitialQuality({ touchMode: 'on' }), 'light');
  assert.equal(selectInitialQuality({ touchMode: 'auto' }), 'standard');
  assert.equal(selectInitialQuality({ touchMode: 'off' }), 'standard');
  assert.equal(selectInitialQuality({ queryQuality: 'standard', touchMode: 'on' }), 'standard');
  assert.equal(selectInitialQuality({ savedQuality: 'standard', touchMode: 'on' }), 'standard');
  assert.equal(selectInitialQuality({ queryQuality: 'light', savedQuality: 'standard', touchMode: 'off' }), 'light');
});

test('stickRadius scales proportionally on short viewports and enforces minRadius', () => {
  assert.equal(stickRadius(720), TOUCH_CFG.stick.radius);
  assert.equal(stickRadius(420), TOUCH_CFG.stick.radius);
  assert.ok(stickRadius(340) < TOUCH_CFG.stick.radius);
  assert.ok(stickRadius(340) >= TOUCH_CFG.stick.minRadius);
  assert.equal(stickRadius(100), TOUCH_CFG.stick.minRadius);
});

test('clampOrigin keeps stick origin inside viewport margins', () => {
  const r = 50;
  const p0 = clampOrigin(5, 5, r, 800, 400);
  assert.equal(p0.x, r + TOUCH_CFG.stick.edgeMargin);
  assert.equal(p0.y, r + TOUCH_CFG.stick.edgeMargin);
  const p1 = clampOrigin(799, 399, r, 800, 400);
  assert.equal(p1.x, 800 - (r + TOUCH_CFG.stick.edgeMargin));
  assert.equal(p1.y, 400 - (r + TOUCH_CFG.stick.edgeMargin));
  const tiny = clampOrigin(10, 10, r, 100, 80);
  assert.deepEqual(tiny, { x: 50, y: 40 });
});

test('stickFromDrag enforces deadzone, analog direction, run hysteresis, and knob clamp', () => {
  const R = 50;
  const dead = stickFromDrag(4, 3, R, false);
  assert.equal(dead.mag, 0);
  assert.equal(dead.forward, 0);
  assert.equal(dead.right, 0);
  assert.equal(dead.run, false);

  const walk = stickFromDrag(0, -R, R, false);
  assert.equal(walk.forward, 1);
  assert.equal(walk.right, 0);
  assert.equal(walk.mag, 1);
  assert.equal(walk.run, false);

  const enterRun = stickFromDrag(R * 1.4, 0, R, false);
  assert.equal(enterRun.right, 1);
  assert.equal(enterRun.run, true);

  // Hysteresis: stays running between runExit (1.12R) and runEnter (1.38R)
  const stayRun = stickFromDrag(R * 1.2, 0, R, true);
  assert.equal(stayRun.run, true);
  const notYetRun = stickFromDrag(R * 1.2, 0, R, false);
  assert.equal(notYetRun.run, false);
  const exitRun = stickFromDrag(R * 1.0, 0, R, true);
  assert.equal(exitRun.run, false);

  // Knob is clamped to knobMax * R
  const far = stickFromDrag(300, 0, R, true);
  assert.ok(Math.abs(far.knobX - R * TOUCH_CFG.stick.knobMax) < 1e-6);
});

test('LookDrag ignores jitter under tapSlop then returns incremental deltas', () => {
  const drag = new LookDrag(6);
  drag.start(100, 100);
  assert.deepEqual(drag.move(103, 102), { dx: 0, dy: 0 });
  assert.deepEqual(drag.move(108, 100), { dx: 8, dy: 0 });
  assert.deepEqual(drag.move(112, 95), { dx: 4, dy: -5 });
});

test('touchPromptSpec maps combat/story prompts cleanly without mutating rules', () => {
  assert.deepEqual(touchPromptSpec('とどめを刺す'), { label: 'とどめ', ready: true, counter: false, urgent: true });
  assert.deepEqual(touchPromptSpec('背後から闇討ち'), { label: '闇討ち', ready: true, counter: false, urgent: true });
  assert.deepEqual(touchPromptSpec('縛めを解く'), { label: '解く', ready: true, counter: false, urgent: true });
  assert.deepEqual(touchPromptSpec('弾いた。いま反撃'), { label: '調べる', ready: false, counter: true, urgent: false });
  assert.deepEqual(touchPromptSpec('袖印を調べる'), { label: '調べる', ready: true, counter: false, urgent: false });
  assert.deepEqual(touchPromptSpec(''), { label: '調べる', ready: false, counter: false, urgent: false });
});
