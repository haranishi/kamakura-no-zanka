const $ = s => document.querySelector(s);
export const DEFAULT_SETTINGS = Object.freeze({ quality: 'standard', sensitivity: 1, fov: 65, invert: false, hud: true, hints: true, muted: false });
export function sanitizeSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  return {
    quality: value.quality === 'light' ? 'light' : 'standard',
    sensitivity: Math.min(2, Math.max(.4, Number(value.sensitivity) || 1)),
    fov: Math.min(85, Math.max(55, Number(value.fov) || 65)),
    invert: value.invert === true, hud: value.hud !== false, hints: value.hints !== false, muted: value.muted === true,
  };
}
export class WalkUI {
  constructor(callbacks, touch) {
    this.callbacks = callbacks; this.touch = touch; this.state = 'loading'; this.played = false;
    this.dialog = $('#pause-dialog'); this.dialogOrigin = 'title'; this.settings = { ...DEFAULT_SETTINGS, quality: touch ? 'light' : 'standard' };
    this.hintUntil = 0; this.toastTimer = 0;
    try { const saved = localStorage.getItem('kamakura-ui-v16'); if (saved) this.settings = sanitizeSettings(JSON.parse(saved)); } catch {}
    this.bind(); this.syncSettings();
  }
  get playing() { return this.state === 'playing'; }
  mode(state) {
    this.state = state; document.body.dataset.state = state;
    $('#title-screen').classList.toggle('hidden', state !== 'title');
    $('#hud').classList.toggle('hidden', state !== 'playing');
    $('#quest-hud').classList.toggle('hidden', state !== 'playing');
    $('#interaction').classList.toggle('hidden', state !== 'playing' || !this.prompt);
    $('#touch-controls').classList.toggle('hidden', state !== 'playing' || !this.touch);
    this.callbacks.mode(state);
  }
  ready() { this.mode('title'); $('#loading').classList.add('hidden'); $('#start').focus({ preventScroll: true }); }
  progress(event) {
    if (event?.total) {
      const p = Math.max(0, Math.min(100, Math.round(event.loaded / event.total * 100)));
      $('#load-bar').style.width = p + '%'; $('#progress-track').setAttribute('aria-valuenow', p);
      $('#load-text').textContent = `3Dモデルを読み込んでいます · ${p}%`;
    } else { $('#load-text').textContent = '3Dモデルを読み込んでいます'; $('#progress-track').removeAttribute('aria-valuenow'); $('#progress-track').classList.add('indeterminate'); }
  }
  preparing() { $('#load-title').textContent = 'もうすぐ、隠れ谷へ'; $('#load-text').textContent = '光と風景を整えています'; $('#progress-track').classList.remove('indeterminate'); $('#load-bar').style.width = '100%'; }
  error(error) {
    this.mode('error'); if (this.dialog.open) this.dialog.close();
    $('#loading').classList.remove('hidden'); $('#loading').classList.add('error-state'); $('#load-title').textContent = '風景をひらけませんでした';
    $('#load-text').textContent = /webgl/i.test(String(error)) ? 'このブラウザでは3D表示を開始できませんでした。WebGL2対応のブラウザと、グラフィック設定をご確認ください。' : 'モデルの読み込みが途中で止まりました。もう一度読み込んでください。';
    $('#load-note').textContent = '保存済みの進行や設定は保持されています'; $('#progress-track').classList.add('hidden'); $('#retry').classList.remove('hidden'); $('#retry').focus({ preventScroll: true });
  }
  play(lock = true) {
    if (this.state === 'loading' || this.state === 'error') return;
    this.callbacks.gesture?.(); if (this.dialog.open) this.dialog.close();
    this.played = true; this.hideRestart(); this.mode('playing'); this.hintUntil = performance.now() + 11000;
    $('#view').focus({ preventScroll: true });
    if (lock && !this.touch) this.callbacks.lock(); this.pointerChanged();
  }
  open(panel = 'rest') {
    if (this.state === 'loading' || this.state === 'error') return;
    if (!this.dialog.open) {
      this.dialogOrigin = this.state === 'playing' ? 'playing' : 'title';
      this.mode(this.dialogOrigin === 'playing' ? 'paused' : 'title');
      if (document.pointerLockElement) document.exitPointerLock(); this.dialog.showModal();
    }
    this.hideRestart(); this.panel(panel);
  }
  panel(panel) {
    for (const id of ['rest', 'controls', 'settings']) $('#panel-' + id).classList.toggle('hidden', id !== panel);
    for (const b of document.querySelectorAll('[data-panel]')) { const active = b.dataset.panel === panel; b.classList.toggle('active', active); b.setAttribute('aria-current', active ? 'page' : 'false'); }
    $('#dialog-title').textContent = panel === 'controls' ? '歩き方' : panel === 'settings' ? '設定' : 'ひと休み';
    $('#dialog-kicker').textContent = this.dialogOrigin === 'playing' ? '隠れ谷で、ひと休み' : '残火の鎌倉';
    for (const id of ['resume', 'reset', 'to-title', 'restart-game']) $('#' + id).classList.toggle('hidden', this.dialogOrigin !== 'playing');
    $('.nav-divider').classList.toggle('hidden', this.dialogOrigin !== 'playing');
    $('#dialog-footer-text').textContent = this.dialogOrigin === 'playing' ? '移動・水運び・音は一時停止しています' : '隠れ谷に残る、暮らしの気配';
  }
  close(lock = false) { if (!this.dialog.open) return; this.dialog.close(); this.hideRestart(); if (this.dialogOrigin === 'playing') this.play(lock); else this.mode('title'); }
  title() { if (this.dialog.open) this.dialog.close(); this.mode('title'); if (document.pointerLockElement) document.exitPointerLock(); $('#start').focus({ preventScroll: true }); }
  pause() { if (this.playing) this.open('rest'); }
  requestRestart() { this.open('rest'); $('#restart-confirm').classList.remove('hidden'); $('#cancel-restart').focus({ preventScroll: true }); }
  hideRestart() { $('#restart-confirm').classList.add('hidden'); }
  showQuest({ objective, inventory, stage, hasSave, distance, direction, label }) {
    const changed = this.questStage !== stage; this.questStage = stage;
    $('#objective-text').textContent = objective; $('#inventory-text').textContent = inventory;
    $('#quest-step').textContent = stage === 'bucket' ? '一 / 三' : stage === 'empty' ? '二 / 三' : stage === 'full' ? '三 / 三' : '完';
    $('#quest-label').textContent = stage === 'delivered' ? '暮らしに、小さな灯を' : '今日のしごと';
    $('#quest-again').classList.toggle('hidden', stage !== 'delivered');
    $('#inventory').classList.toggle('is-full', stage === 'full');
    $('#inventory').classList.toggle('is-empty', stage === 'bucket' || stage === 'delivered');
    $('#start-label').textContent = hasSave ? 'つづきから' : '庭へ入る';
    $('#destination').classList.toggle('hidden', stage === 'delivered');
    $('#destination-text').textContent = `${label || ''} · ${Number.isFinite(distance) ? distance.toFixed(1) : '—'} m`;
    $('#destination-needle').style.transform = `rotate(${direction || 0}rad)`;
    if (changed) $('#quest-status').textContent = objective;
  }
  setPrompt(target) {
    this.prompt = target;
    $('#interaction').classList.toggle('hidden', !this.playing || !target);
    if (target) $('#interaction-text').textContent = target.label;
  }
  notify(text, ms = 2400) {
    const el = $('#toast'); el.textContent = text; el.classList.add('visible'); clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('visible'), ms);
  }
  tick(now) { $('#control-hint').classList.toggle('is-faded', !this.settings.hints || now > this.hintUntil); }
  pointerChanged() { $('#look').classList.toggle('hidden', this.touch || !!document.pointerLockElement || !this.playing); }
  changeSettings() {
    this.settings = sanitizeSettings({ quality: $('#quality').value, sensitivity: $('#sensitivity').value, fov: $('#fov').value, invert: $('#invert').checked, hud: $('#show-hud').checked, hints: $('#show-hints').checked, muted: $('#mute').checked });
    this.syncSettings(); try { localStorage.setItem('kamakura-ui-v16', JSON.stringify(this.settings)); } catch {}
    this.callbacks.settings(this.settings);
  }
  syncSettings() {
    const s = this.settings; $('#quality').value = s.quality; $('#sensitivity').value = s.sensitivity; $('#sensitivity-value').textContent = s.sensitivity.toFixed(1);
    $('#fov').value = s.fov; $('#fov-value').textContent = s.fov + '°'; $('#invert').checked = s.invert; $('#show-hud').checked = s.hud; $('#show-hints').checked = s.hints; $('#mute').checked = s.muted;
    document.body.classList.toggle('hud-hidden', !s.hud);
  }
  toggleHUD() { this.settings.hud = !this.settings.hud; this.syncSettings(); this.changeSettings(); this.notify(this.settings.hud ? '画面表示を戻しました' : '画面表示を隠しました。Hで戻せます'); }
  bind() {
    $('#start').onclick = () => this.play(); $('#menu-button').onclick = () => this.open(); $('#resume').onclick = () => this.close(true); $('#dialog-close').onclick = () => this.close();
    $('#look').onclick = () => this.callbacks.lock(); $('#retry').onclick = () => location.reload();
    $('#reset').onclick = () => { this.callbacks.reset(); this.notify('出発点に戻りました。水運びの進行は保持しています'); };
    $('#to-title').onclick = () => this.title(); $('#restart-game').onclick = () => this.requestRestart(); $('#quest-again').onclick = () => this.requestRestart();
    $('#cancel-restart').onclick = () => { this.hideRestart(); $('#restart-game').focus(); };
    $('#confirm-restart').onclick = () => { this.callbacks.restart(); this.hideRestart(); this.close(false); };
    for (const b of document.querySelectorAll('[data-open]')) b.onclick = () => this.open(b.dataset.open);
    for (const b of document.querySelectorAll('[data-panel]')) b.onclick = () => { this.hideRestart(); this.panel(b.dataset.panel); };
    for (const id of ['quality', 'sensitivity', 'fov', 'invert', 'show-hud', 'show-hints', 'mute']) $('#' + id).addEventListener(id === 'sensitivity' || id === 'fov' ? 'input' : 'change', () => this.changeSettings());
    $('#defaults').onclick = () => { this.settings = { ...DEFAULT_SETTINGS, quality: this.touch ? 'light' : 'standard' }; this.syncSettings(); this.changeSettings(); this.notify('表示と音の設定を初期値に戻しました'); };
    this.dialog.addEventListener('cancel', e => { e.preventDefault(); if (!$('#restart-confirm').classList.contains('hidden')) this.hideRestart(); else this.close(); });
  }
}
