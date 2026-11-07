import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchInput } from '../dist/valley/touch-input.js';
class Target {
  constructor() { this.handlers = new Map(); this.style = {}; }
  addEventListener(type, fn) { const list = this.handlers.get(type) || []; list.push(fn); this.handlers.set(type, list); }
  emit(type, event = {}) { for (const fn of this.handlers.get(type) || []) fn({ preventDefault() {}, ...event }); }
  getBoundingClientRect() { return { left: 0, width: 800 }; }
  setPointerCapture() {}
}
test('touch adapter keeps keyboard axis/look, independent fingers, sprint edges and pause clearing', () => {
  const oldDocument = globalThis.document, oldAdd = globalThis.addEventListener;
  const page = new Target(), window = new Target(); globalThis.document = page; globalThis.addEventListener = window.addEventListener.bind(window);
  try {
    const element = new Target(), run = new Target();
    const base = { enabled: true, wheel: 0, keys: new Set(), clear() { this.keys.clear(); }, setEnabled(on) { this.enabled = on; if (!on) this.clear(); },
      down(key) { return this.keys.has(key); }, wasPressed() { return false; }, mouseDown() { return false; }, mouseWasPressed() { return false; },
      axis() { return { forward: this.down('KeyW') ? 1 : 0, right: 0 }; }, look() { return { dx: 2, dy: 3 }; }, endFrame() {} };
    const input = new TouchInput(base, element, run);
    const finger = (id, x, y = 100) => ({ pointerId: id, pointerType: 'touch', clientX: x, clientY: y });
    element.emit('pointerdown', finger(1, 100)); element.emit('pointermove', finger(1, 160, 40));
    assert(Math.abs(Math.hypot(input.axis().forward, input.axis().right) - 1) < 1e-9);
    element.emit('pointerdown', finger(2, 600)); element.emit('pointermove', finger(2, 620, 110));
    assert.deepEqual(input.look(0.016), { dx: 22, dy: 13 }); assert.deepEqual(input.look(0.016), { dx: 2, dy: 3 });
    run.emit('pointerdown', finger(3, 700)); assert(input.down('ShiftLeft')); assert(input.wasPressed('ShiftLeft'));
    input.endFrame(); assert(!input.wasPressed('ShiftLeft')); assert(input.down('ShiftLeft'));
    element.emit('pointerup', finger(1, 160, 40)); assert(!input.axis().active); assert(input.down('ShiftLeft'));
    run.emit('lostpointercapture', finger(3, 700)); assert(!input.down('ShiftLeft'));
    base.keys.add('KeyW'); assert(input.axis().active); input.setEnabled(false); assert(!input.axis().active); assert.equal(input.pointers.size, 0);
    input.setEnabled(true); element.emit('pointerdown', finger(1, 100)); element.emit('pointermove', finger(1, 100, 40));
    window.emit('blur'); assert(!input.axis().active);
    element.emit('pointerdown', finger(1, 100)); element.emit('pointermove', finger(1, 100, 40)); page.emit('visibilitychange'); assert(!input.axis().active);
    element.emit('pointerdown', { ...finger(1, 100), pointerType: 'mouse' }); assert.equal(input.pointers.size, 0);
    element.emit('pointerdown', finger(1, 100)); element.emit('pointermove', finger(1, 100, 40)); element.emit('pointercancel', finger(1, 100)); assert(!input.axis().active);
  } finally { globalThis.document = oldDocument; globalThis.addEventListener = oldAdd; }
});
