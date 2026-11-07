// Opt-in adapter: keyboard/mouse Input is unchanged outside the walk prototype.
export class TouchInput {
  constructor(base, element, runButton, { signal } = {}) {
    const listen = (target, type, listener, options) => target.addEventListener(type, listener, signal ? { ...options, signal } : options);
    this.base = base; this.element = element; this.pointers = new Map(); this.runPointers = new Set();
    this.forward = this.right = this.dx = this.dy = 0; this.runPressed = false;
    element.style.touchAction = 'none'; runButton.style.touchAction = 'none';
    const down = e => {
      if (e.pointerType !== 'touch' || !base.enabled) return;
      e.preventDefault(); element.setPointerCapture?.(e.pointerId);
      const rect = element.getBoundingClientRect(), side = e.clientX - rect.left < rect.width / 2 ? 'move' : 'look';
      if ([...this.pointers.values()].some(p => p.side === side)) return;
      this.pointers.set(e.pointerId, { side, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY });
    };
    listen(element, 'pointerdown', down);
    listen(element, 'pointermove', e => {
      const p = this.pointers.get(e.pointerId); if (!p || !base.enabled) return;
      e.preventDefault();
      if (p.side === 'move') {
        const x = (e.clientX - p.x) / 60, y = (p.y - e.clientY) / 60, len = Math.max(1, Math.hypot(x, y));
        this.right = x / len; this.forward = y / len;
      } else { this.dx += e.clientX - p.lastX; this.dy += e.clientY - p.lastY; }
      p.lastX = e.clientX; p.lastY = e.clientY;
    });
    const up = e => {
      const p = this.pointers.get(e.pointerId); this.pointers.delete(e.pointerId);
      if (p?.side === 'move') this.forward = this.right = 0;
      if (p?.side === 'look') this.dx = this.dy = 0;
      this.runPointers.delete(e.pointerId);
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) { listen(element, type, up); listen(runButton, type, up); }
    listen(runButton, 'pointerdown', e => {
      if (e.pointerType !== 'touch' || !base.enabled) return;
      e.preventDefault(); runButton.setPointerCapture?.(e.pointerId); this.runPointers.add(e.pointerId); this.runPressed = true;
    });
    listen(globalThis, 'blur', () => this.clear());
    listen(document, 'visibilitychange', () => this.clear());
    // Any base clear (including pointer-lock loss) releases touch state too.
    const clear = base.clear.bind(base); base.clear = () => { clear(); this.reset(); };
  }
  reset() { this.pointers.clear(); this.runPointers.clear(); this.forward = this.right = this.dx = this.dy = 0; this.runPressed = false; }
  clear() { this.base.clear(); }
  setEnabled(on) { this.base.setEnabled(on); }
  get enabled() { return this.base.enabled; }
  down(code) { return this.base.down(code) || (code === 'ShiftLeft' && this.runPointers.size > 0); }
  wasPressed(code) { return this.base.wasPressed(code) || (code === 'ShiftLeft' && this.runPressed); }
  mouseDown(b) { return this.base.mouseDown(b); }
  mouseWasPressed(b) { return this.base.mouseWasPressed(b); }
  axis() {
    const a = this.base.axis(), f = a.forward + this.forward, r = a.right + this.right, len = Math.max(1, Math.hypot(f, r));
    return { forward: f / len, right: r / len, active: Math.hypot(f, r) > 0.03 };
  }
  look(dt) { const l = this.base.look(dt); l.dx += this.dx; l.dy += this.dy; this.dx = this.dy = 0; return l; }
  endFrame() { this.base.endFrame(); this.runPressed = false; }
  get wheel() { return this.base.wheel; }
}
