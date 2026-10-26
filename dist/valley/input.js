// input.js — キーボード・マウス入力（app層）。押した瞬間（エッジ）と押しっぱなしを分け、ポインターロックで視点を回す。
// UI入力中・画面外・押しっぱなしの残りはゲームへ渡さない（requirements 11.3）。
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const GAME_KEYS = new Set([...MOVE_KEYS, 'ShiftLeft', 'ShiftRight', 'Space', 'KeyC', 'KeyE', 'KeyQ', 'KeyF', 'Tab', 'KeyH', 'KeyI', 'KeyJ', 'KeyK', 'KeyL', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'ControlLeft']);
const uiTarget = t => !!t?.closest?.('button,input,select,textarea,dialog,[contenteditable="true"]');

export class Input {
  constructor(element) {
    this.el = element; this.enabled = false; this.locked = false;
    this.held = new Set(); this.pressed = new Set(); this.mouse = new Set(); this.mousePressed = new Set();
    this.lookX = 0; this.lookY = 0; this.wheel = 0; this.mouseDownAt = new Map();
    this.onLockChange = null;
    addEventListener('keydown', e => {
      if (!this.enabled || uiTarget(e.target) || !GAME_KEYS.has(e.code)) return;
      e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
    });
    addEventListener('keyup', e => { this.held.delete(e.code); });
    addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => this.clear());
    element.addEventListener('mousedown', e => {
      if (!this.enabled) return;
      if (!this.locked) { this.requestLock(); return; }
      e.preventDefault(); this.mouse.add(e.button); this.mousePressed.add(e.button); this.mouseDownAt.set(e.button, performance.now());
    });
    addEventListener('mouseup', e => { this.mouse.delete(e.button); });
    element.addEventListener('contextmenu', e => e.preventDefault());
    element.addEventListener('wheel', e => { if (this.enabled) this.wheel += e.deltaY; }, { passive: true });
    document.addEventListener('mousemove', e => { if (this.enabled && this.locked) { this.lookX += e.movementX; this.lookY += e.movementY; } });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === element;
      if (!this.locked) this.clear();
      this.onLockChange?.(this.locked);
    });
  }

  requestLock() {
    try { const p = this.el.requestPointerLock?.(); p?.catch?.(() => {}); } catch { /* ヘッドレスなど。IJKLで見回せる */ }
  }
  releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); }
  clear() { this.held.clear(); this.pressed.clear(); this.mouse.clear(); this.mousePressed.clear(); this.lookX = this.lookY = 0; }
  setEnabled(on) { this.enabled = on; if (!on) this.clear(); }

  down(code) { return this.held.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  mouseDown(b) { return this.mouse.has(b); }
  mouseWasPressed(b) { return this.mousePressed.has(b); }
  mouseHeldMs(b, now) { return this.mouse.has(b) ? now - (this.mouseDownAt.get(b) || now) : 0; }
  axis() {
    const f = (this.down('KeyW') || this.down('ArrowUp') ? 1 : 0) - (this.down('KeyS') || this.down('ArrowDown') ? 1 : 0);
    const r = (this.down('KeyD') || this.down('ArrowRight') ? 1 : 0) - (this.down('KeyA') || this.down('ArrowLeft') ? 1 : 0);
    const l = Math.hypot(f, r) || 1;
    return { forward: f / l, right: r / l, active: !!(f || r) };
  }
  look(dt) {
    let dx = this.lookX, dy = this.lookY; this.lookX = this.lookY = 0;
    // ロックできない環境のための IJKL 視点
    const kx = (this.down('KeyL') ? 1 : 0) - (this.down('KeyJ') ? 1 : 0), ky = (this.down('KeyK') ? 1 : 0) - (this.down('KeyI') ? 1 : 0);
    dx += kx * dt * 520; dy += ky * dt * 380;
    return { dx, dy };
  }
  endFrame() { this.pressed.clear(); this.mousePressed.clear(); this.wheel = 0; }
}
