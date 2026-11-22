// valley-touch.js — 隠れ谷（第一章）のスマホ向けタッチ操作層（view/app層）。
// 規則層には触れず、Input の注入口（injectStick / injectLook / touchKeyDown / touchMouseDown）へ渡す。
// <html class="kz-touch"> が無いデスクトップ環境では一切 DOM を表示せず、操作も見た目も変えない。
import { TOUCH_CFG, stickRadius, clampOrigin, stickFromDrag, LookDrag, touchPromptSpec } from './touch-math.js';

export const TOUCH_CLASS = 'kz-touch';

let swallowUntil = 0;
let clickGuarded = false;
const SWALLOW_MS = 500;

function ensureClickGuard() {
  if (clickGuarded) return;
  clickGuarded = true;
  window.addEventListener(
    'click',
    e => {
      if (performance.now() < swallowUntil) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    true,
  );
}

/** 2本目の指のタップ（他指が画面に触れている間は click が発火しない）でも確実に反応するボタンハンドラ。 */
export function onTap(target, fn) {
  if (!target) return;
  ensureClickGuard();
  target.addEventListener('click', fn);
  target.addEventListener('pointerup', e => {
    if (e.pointerType !== 'touch' || e.isPrimary) return;
    swallowUntil = performance.now() + SWALLOW_MS;
    fn(e);
  });
}

function mk(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function rectOf(el) {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
}

export class ValleyTouchControls {
  constructor({ input, mode = 'auto', onMenu }) {
    this.input = input;
    this.mode = mode;
    this.onMenu = onMenu;
    this.enabled = false;
    this.active = false;
    this.portraitDismissed = false;
    this.tracks = new Map();
    this.look = new LookDrag();
    this.R = TOUCH_CFG.stick.radius;
    this.running = false;
    this.lastSyncKey = '';
    this.narrationPointers = new Set();
    this.buttons = new Map();
    this.labels = new Map();
    this.layer = null;
    this.orientBanner = null;

    if (mode === 'on') {
      this.enable();
    } else if (mode === 'auto') {
      this._autoListener = e => {
        if (e.pointerType === 'touch') {
          window.removeEventListener('pointerdown', this._autoListener, true);
          this._autoListener = null;
          this.enable();
        }
      };
      window.addEventListener('pointerdown', this._autoListener, { capture: true, passive: true });
    }
  }

  enable() {
    if (this.enabled || this.mode === 'off') return;
    this.enabled = true;
    document.documentElement.classList.add(TOUCH_CLASS);
    this.input.setTouchMode(true);
    this.buildDom();
    this.wireOverlays();
  }

  buildDom() {
    if (this.layer) return;
    const layer = mk('div', 'kz-touch-layer');
    layer.dataset.testid = 'valley-touch-layer';
    layer.setAttribute('aria-label', 'タッチ操作');

    const lookZone = mk('div', 'kz-touch-look');
    lookZone.dataset.testid = 'touch-look-zone';
    const stickZone = mk('div', 'kz-touch-stick-zone');
    stickZone.dataset.testid = 'touch-stick-zone';

    const stickHint = mk('div', 'kz-stick-hint');
    stickHint.setAttribute('aria-hidden', 'true');
    stickHint.append(mk('span', 'kz-stick-hint-text', '歩く'));

    const stickBase = mk('div', 'kz-stick');
    stickBase.dataset.testid = 'touch-stick';
    stickBase.setAttribute('aria-hidden', 'true');
    const runRing = mk('div', 'kz-stick-run');
    runRing.append(mk('span', 'kz-stick-run-label', '走'));
    const stickKnob = mk('div', 'kz-stick-knob');
    stickBase.append(runRing, mk('div', 'kz-stick-ring'), stickKnob);
    stickZone.append(stickHint, stickBase);

    const makeBtn = (name, text, aria, extraCls = '') => {
      const b = mk('button', `kz-tbtn kz-tbtn-${name}${extraCls ? ' ' + extraCls : ''}`);
      b.type = 'button';
      b.tabIndex = -1;
      b.dataset.testid = `touch-btn-${name}`;
      b.setAttribute('aria-label', aria);
      const label = mk('span', 'kz-tbtn-label', text);
      b.append(label);
      this.buttons.set(name, b);
      this.labels.set(name, label);
      b.addEventListener('pointerdown', e => this.onButtonDown(e, name, b));
      b.addEventListener('click', e => e.preventDefault());
      return b;
    };

    const pad = mk('div', 'kz-touch-btns');
    pad.append(
      makeBtn('attack', '斬る', '斬る（続けて三連）'),
      makeBtn('guard', '受ける', '受ける・弾く（長押し）'),
      makeBtn('dodge', '避ける', '転がって避ける'),
      makeBtn('heavy', '強斬り', '強く斬る'),
      makeBtn('interact', '調べる', '調べる・とどめ・闇討ち'),
    );

    const aux = mk('div', 'kz-touch-aux');
    aux.append(
      makeBtn('crouch', '屈む', '屈む・立つ', 'kz-tbtn-pill'),
      makeBtn('lock', '狙う', '敵を狙う・解除', 'kz-tbtn-pill'),
      makeBtn('guide', '風', '導きの風を呼ぶ', 'kz-tbtn-pill'),
    );

    const banner = mk('div', 'kz-orient-banner hidden');
    banner.setAttribute('role', 'status');
    banner.append(mk('span', 'kz-orient-text', '画面を横向きにすると操作しやすくなります'));
    const dismiss = mk('button', 'kz-orient-close', 'このまま遊ぶ');
    dismiss.type = 'button';
    onTap(dismiss, () => {
      this.portraitDismissed = true;
      banner.classList.add('hidden');
    });
    banner.append(dismiss);

    layer.append(lookZone, stickZone, pad, aux);
    document.body.append(layer, banner);

    this.layer = layer;
    this.lookZone = lookZone;
    this.stickZone = stickZone;
    this.stickHint = stickHint;
    this.stickBase = stickBase;
    this.stickKnob = stickKnob;
    this.orientBanner = banner;

    stickZone.addEventListener('pointerdown', e => this.onStickDown(e));
    lookZone.addEventListener('pointerdown', e => this.onLookDown(e));
    layer.addEventListener('contextmenu', e => e.preventDefault());

    this._onMove = e => this.onMove(e);
    this._onUp = e => this.onUp(e);
    this._onCancel = e => this.onCancel(e);
    window.addEventListener('pointermove', this._onMove, { passive: true });
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('pointercancel', this._onCancel);
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
  }

  wireOverlays() {
    const dlg = document.getElementById('dialogue');
    if (dlg && !dlg.dataset.kzTouchWired) {
      dlg.dataset.kzTouchWired = '1';
      onTap(dlg, () => {
        if (!this.enabled || dlg.classList.contains('hidden')) return;
        this.input.touchKeyDown('KeyE');
        setTimeout(() => this.input.touchKeyUp('KeyE'), 30);
      });
    }
    const party = document.getElementById('party');
    if (party && !party.dataset.kzTouchWired) {
      party.dataset.kzTouchWired = '1';
      party.setAttribute('role', 'button');
      party.setAttribute('aria-label', '弥十郎への指示を切り替える');
      onTap(party, () => {
        if (!this.enabled || party.classList.contains('hidden')) return;
        this.input.touchKeyDown('KeyQ');
        setTimeout(() => this.input.touchKeyUp('KeyQ'), 30);
      });
    }
    const narration = document.getElementById('narration');
    if (narration && !narration.dataset.kzTouchWired) {
      narration.dataset.kzTouchWired = '1';
      narration.addEventListener('pointerdown', e => {
        if (!this.enabled || narration.classList.contains('hidden')) return;
        e.preventDefault();
        this.narrationPointers.add(e.pointerId);
        this.input.touchKeyDown('KeyE');
      });
      const endNarration = e => {
        if (!this.narrationPointers.delete(e.pointerId)) return;
        if (this.narrationPointers.size === 0) this.input.touchKeyUp('KeyE');
      };
      window.addEventListener('pointerup', endNarration);
      window.addEventListener('pointercancel', endNarration);
    }
    const menuBtn = document.getElementById('menu-btn');
    if (menuBtn && !menuBtn.dataset.kzTouchWired && this.onMenu) {
      menuBtn.dataset.kzTouchWired = '1';
      menuBtn.addEventListener('pointerup', e => {
        if (e.pointerType !== 'touch' || e.isPrimary) return;
        swallowUntil = performance.now() + SWALLOW_MS;
        this.onMenu();
      });
    }
  }

  setActive(on) {
    if (!this.layer) return;
    if (!on && this.active) this.releaseAll();
    this.active = !!on;
    this.layer.classList.toggle('kz-on', this.active);
  }

  releaseAll() {
    for (const [, t] of this.tracks) {
      if (t.kind === 'btn') t.el.classList.remove('kz-down');
    }
    this.tracks.clear();
    this.narrationPointers.clear();
    this.running = false;
    this.input.releaseTouch();
    this.showStick(false);
    this.lastSyncKey = '';
  }

  sync(game, pauseOpen) {
    if (!this.enabled || !this.layer) return;
    const playing = !!game && game.flow === 'play' && !game.paused && !pauseOpen && !game.hud.talking && game.hero?.alive;
    this.setActive(playing);

    const portrait = playing && window.innerHeight > window.innerWidth && !this.portraitDismissed;
    this.orientBanner.classList.toggle('hidden', !portrait);

    const dlgNext = document.querySelector('.dlg-next');
    if (dlgNext && dlgNext.textContent !== 'タップ ▸') dlgNext.textContent = 'タップ ▸';

    if (!playing) return;
    const spec = touchPromptSpec(game.promptKey);
    const crouch = !!game.hero?.crouch;
    const locked = !!game.lock;
    const key = [spec.label, spec.ready, spec.counter, spec.urgent, crouch, locked].join('|');
    if (key === this.lastSyncKey) return;
    this.lastSyncKey = key;

    const interact = this.buttons.get('interact');
    this.labels.get('interact').textContent = spec.label;
    interact.classList.toggle('kz-ready', spec.ready);
    interact.classList.toggle('kz-urgent', spec.urgent);
    interact.classList.toggle('kz-dim', !spec.ready);

    const attack = this.buttons.get('attack');
    this.labels.get('attack').textContent = spec.counter ? '反撃' : '斬る';
    attack.classList.toggle('kz-counter', spec.counter);

    const crouchBtn = this.buttons.get('crouch');
    this.labels.get('crouch').textContent = crouch ? '立つ' : '屈む';
    crouchBtn.classList.toggle('kz-toggled', crouch);
    crouchBtn.setAttribute('aria-pressed', String(crouch));

    const lockBtn = this.buttons.get('lock');
    this.labels.get('lock').textContent = locked ? '解除' : '狙う';
    lockBtn.classList.toggle('kz-toggled', locked);
    lockBtn.setAttribute('aria-pressed', String(locked));
  }

  capture(e, target) {
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic PointerEvent in tests may not support capture; window listeners still track it.
    }
  }

  dropStale(e) {
    if (e.pointerType === 'touch' && e.isPrimary && this.tracks.size > 0) this.releaseAll();
  }

  onStickDown(e) {
    if (!this.active) return;
    e.preventDefault();
    this.dropStale(e);
    for (const t of this.tracks.values()) if (t.kind === 'stick') return;
    this.R = stickRadius(window.innerHeight);
    const origin = clampOrigin(e.clientX, e.clientY, this.R, window.innerWidth, window.innerHeight);
    this.tracks.set(e.pointerId, { kind: 'stick', ox: origin.x, oy: origin.y });
    this.capture(e, this.stickZone);
    this.running = false;
    const zr = this.stickZone.getBoundingClientRect();
    this.stickBase.style.setProperty('--sx', `${origin.x - zr.left}px`);
    this.stickBase.style.setProperty('--sy', `${origin.y - zr.top}px`);
    this.stickBase.style.setProperty('--r', `${this.R}px`);
    this.showStick(true);
    this.updateStick(e.clientX - origin.x, e.clientY - origin.y);
  }

  onLookDown(e) {
    if (!this.active) return;
    e.preventDefault();
    this.dropStale(e);
    for (const t of this.tracks.values()) if (t.kind === 'look') return;
    this.tracks.set(e.pointerId, { kind: 'look' });
    this.capture(e, this.lookZone);
    this.look.start(e.clientX, e.clientY);
  }

  onButtonDown(e, name, el) {
    e.preventDefault();
    e.stopPropagation();
    if (!this.active) return;
    this.dropStale(e);
    if (this.tracks.has(e.pointerId)) return;
    for (const t of this.tracks.values()) if (t.kind === 'btn' && t.name === name) return;
    this.tracks.set(e.pointerId, { kind: 'btn', name, el });
    this.capture(e, el);
    el.classList.add('kz-down');
    this.pressAction(name);
  }

  onMove(e) {
    const t = this.tracks.get(e.pointerId);
    if (!t) return;
    if (t.kind === 'stick') {
      this.updateStick(e.clientX - t.ox, e.clientY - t.oy);
    } else if (t.kind === 'look') {
      const d = this.look.move(e.clientX, e.clientY);
      if (d.dx || d.dy) {
        this.input.injectLook(d.dx * TOUCH_CFG.look.gain, d.dy * TOUCH_CFG.look.gain);
      }
    }
  }

  onUp(e) {
    const t = this.tracks.get(e.pointerId);
    if (!t) return;
    this.tracks.delete(e.pointerId);
    this.endTrack(t);
  }

  onCancel(e) {
    const t = this.tracks.get(e.pointerId);
    if (!t) return;
    this.tracks.delete(e.pointerId);
    this.endTrack(t);
  }

  endTrack(t) {
    if (t.kind === 'stick') {
      this.running = false;
      this.input.injectStick(0, 0, false);
      this.showStick(false);
    } else if (t.kind === 'btn') {
      t.el.classList.remove('kz-down');
      this.releaseAction(t.name);
    }
  }

  pressAction(name) {
    if (name === 'attack') this.input.touchMouseDown(0);
    else if (name === 'guard') this.input.touchMouseDown(2);
    else if (name === 'dodge') this.input.touchKeyDown('Space');
    else if (name === 'heavy') this.input.touchKeyDown('KeyF');
    else if (name === 'interact') this.input.touchKeyDown('KeyE');
    else if (name === 'crouch') this.input.touchKeyDown('KeyC');
    else if (name === 'lock') this.input.touchKeyDown('Tab');
    else if (name === 'guide') this.input.touchKeyDown('KeyG');
  }

  releaseAction(name) {
    if (name === 'attack') this.input.touchMouseUp(0);
    else if (name === 'guard') this.input.touchMouseUp(2);
    else if (name === 'dodge') this.input.touchKeyUp('Space');
    else if (name === 'heavy') this.input.touchKeyUp('KeyF');
    else if (name === 'interact') this.input.touchKeyUp('KeyE');
    else if (name === 'crouch') this.input.touchKeyUp('KeyC');
    else if (name === 'lock') this.input.touchKeyUp('Tab');
    else if (name === 'guide') this.input.touchKeyUp('KeyG');
  }

  updateStick(dx, dy) {
    const out = stickFromDrag(dx, dy, this.R, this.running);
    this.running = out.run;
    this.input.injectStick(out.right, out.forward, out.run);
    this.stickKnob.style.setProperty('--kx', `${out.knobX}px`);
    this.stickKnob.style.setProperty('--ky', `${out.knobY}px`);
    this.stickBase.classList.toggle('kz-run', out.run);
    this.stickKnob.textContent = out.run ? '走る' : '';
  }

  showStick(on) {
    if (!this.stickBase) return;
    this.stickBase.classList.toggle('kz-on', on);
    this.stickHint.classList.toggle('kz-off', on);
    if (!on) {
      this.stickBase.classList.remove('kz-run');
      this.stickKnob.textContent = '';
      this.stickKnob.style.setProperty('--kx', '0px');
      this.stickKnob.style.setProperty('--ky', '0px');
    }
  }

  info() {
    if (!this.layer) return { enabled: this.enabled, active: false, buttons: {} };
    const buttons = {};
    for (const [k, b] of this.buttons) buttons[k] = rectOf(b);
    return {
      enabled: this.enabled,
      active: this.active,
      stick: { ...this.input.stick },
      zones: { stick: rectOf(this.stickZone), look: rectOf(this.lookZone) },
      buttons,
    };
  }
}
