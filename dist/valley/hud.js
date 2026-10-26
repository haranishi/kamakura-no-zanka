// hud.js — 画面の表示（目的・体力と構え・会話・字幕・結果・メニュー）（view層・DOM）。ゲームの規則は持たない。
const $ = id => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = Object.fromEntries(['hud', 'obj-text', 'compass', 'compass-needle', 'compass-dist', 'bar-hp', 'bar-posture', 'party', 'party-mode', 'boss', 'boss-name', 'boss-hp', 'markers', 'prompt', 'prompt-text', 'hint', 'subtitle',
      'dialogue', 'dlg-name', 'dlg-text', 'choice', 'result', 'result-lines', 'result-nums', 'death', 'title', 'loading', 'load-fill', 'load-note', 'load-title', 'toast', 'hurt', 'pause', 'fade', 'granary', 'granary-fill'].map(k => [k, $(k)]));
    this.dialogue = null; this.markers = new Map(); this.timers = new Map(); this.subsOn = true;   // timers: 案内・通知・字幕が消えるまで（ゲーム内の時間。休止中は進まない）
    this.hintsShown = new Set();
  }

  setState(state) { document.body.dataset.state = state; }
  // 消えるまでの時間はゲーム内の時間で数える（実時間の setTimeout だと、休止や検査の時間送りと食い違って案内が残る）
  after(key, sec, fn) { this.timers.set(key, { t: sec, fn }); }
  tick(dt) { for (const [k, v] of [...this.timers]) { v.t -= dt; if (v.t <= 0) { this.timers.delete(k); v.fn(); } } }
  loading(p, note) { this.el['load-fill'].style.width = Math.round(p * 100) + '%'; if (note) this.el['load-note'].textContent = note; }
  showTitle(hasSave) { this.el.title.classList.remove('hidden'); $('btn-continue').classList.toggle('hidden', !hasSave); this.el.hud.classList.add('hidden'); }
  hideTitle() { this.el.title.classList.add('hidden'); }
  showHUD(on = true) { this.el.hud.classList.toggle('hidden', !on); }

  setObjective(text) { this.el['obj-text'].textContent = text; }
  setCompass(angle, dist, visible = true) {
    this.el.compass.classList.toggle('hidden-compass', !visible);
    this.el['compass-needle'].style.transform = `rotate(${angle}rad)`;
    this.el['compass-dist'].textContent = dist >= 1 ? Math.round(dist) + ' m' : '';
  }
  setBars(hp, hpMax, posture, postureMax) {
    this.el['bar-hp'].style.transform = `scaleX(${Math.max(0, Math.min(1, hp / hpMax))})`;
    const p = Math.max(0, Math.min(1, posture / postureMax));
    this.el['bar-posture'].style.transform = `scaleX(${p})`;
    this.el['bar-posture'].parentElement.parentElement.classList.toggle('low', p < 0.25);
  }
  setParty(visible, modeLabel) { this.el.party.classList.toggle('hidden', !visible); if (modeLabel) this.el['party-mode'].textContent = modeLabel; }
  setBoss(visible, name, ratio) { this.el.boss.classList.toggle('hidden', !visible); if (visible) { this.el['boss-name'].textContent = name; this.el['boss-hp'].style.transform = `scaleX(${Math.max(0, ratio)})`; } }
  prompt(text, key = 'E') { this.el.prompt.classList.toggle('hidden', !text); if (text) { this.el['prompt-text'].textContent = text; this.el.prompt.querySelector('kbd').textContent = key; } }

  hint(key, text, ms = 5200) {
    if (this.hintsShown.has(key)) return;
    this.hintsShown.add(key);
    const h = this.el.hint; h.textContent = text; h.classList.remove('hidden');
    this.after('hint', ms / 1000, () => h.classList.add('hidden'));
  }
  toast(text, ms = 2200) {
    const t = this.el.toast; t.textContent = text; t.classList.add('on');
    this.after('toast', ms / 1000, () => t.classList.remove('on'));
  }
  subtitle(speaker, text, ms = 2600) {
    if (!this.subsOn) return;
    const s = this.el.subtitle; s.innerHTML = '';
    if (speaker) { const b = document.createElement('b'); b.textContent = speaker; s.append(b); }
    s.append(document.createTextNode(text)); s.classList.remove('hidden');
    this.after('sub', ms / 1000, () => s.classList.add('hidden'));
  }
  setFood(ratio) {
    const g = this.el.granary; g.classList.toggle('hidden', ratio == null);
    if (ratio != null) this.el['granary-fill'].style.transform = `scaleX(${Math.max(0, Math.min(1, ratio))})`;
  }
  fade(on) { this.el.fade.classList.toggle('on', on); }
  // 暗転を待たずに黒にする（冒頭の目覚めを、黒から明けるために）
  fadeInstant(on) { const f = this.el.fade; f.style.transition = 'none'; f.classList.toggle('on', on); void f.offsetWidth; f.style.transition = ''; }
  // 結果・死亡の画面の下に、通知や案内が透けて重ならないようにする
  clearTransient() { for (const k of ['hint', 'toast', 'sub']) this.timers.delete(k); this.el.hint.classList.add('hidden'); this.el.toast.classList.remove('on'); this.el.subtitle.classList.add('hidden'); this.el.prompt.classList.add('hidden'); this.setBoss(false); }
  hurt() {
    const h = this.el.hurt; h.classList.add('on'); clearTimeout(this.hurtTimer);
    this.hurtTimer = setTimeout(() => h.classList.remove('on'), 90);          // 画面の赤みは短い演出なので実時間で消す
  }

  // 会話：行を順に出す。進めるのは E / クリック。終わったら onEnd。
  startDialogue(id, lines, onEnd) {
    this.dialogue = { id, lines, i: 0, onEnd };
    this.el.dialogue.classList.remove('hidden'); document.body.classList.add('talking');
    this.showLine();
  }
  showLine() {
    const d = this.dialogue, line = d.lines[d.i];
    this.el['dlg-name'].textContent = line.speaker; this.el['dlg-text'].textContent = line.text;
  }
  advanceDialogue() {
    const d = this.dialogue; if (!d) return false;
    d.i++;
    if (d.i >= d.lines.length) { this.el.dialogue.classList.add('hidden'); document.body.classList.remove('talking'); this.dialogue = null; d.onEnd?.(d.id); }
    else this.showLine();
    return true;
  }
  get talking() { return !!this.dialogue; }

  showChoice(on, handlers) {
    this.el.choice.classList.toggle('hidden', !on);
    if (on && handlers) { $('choice-front').onclick = () => handlers('front'); $('choice-flank').onclick = () => handlers('flank'); }
  }

  // 敵の頭上の構え・気づきの印。list: [{id, x, y, ratio, state}] は画面座標（px）
  updateMarkers(list) {
    const seen = new Set();
    for (const m of list) {
      seen.add(m.id);
      let el = this.markers.get(m.id);
      if (!el) { el = document.createElement('div'); el.className = 'marker'; el.innerHTML = '<span></span>'; this.el.markers.append(el); this.markers.set(m.id, el); }
      el.style.left = m.x + 'px'; el.style.top = m.y + 'px';
      el.firstChild.style.transform = `scaleX(${Math.max(0, Math.min(1, m.ratio))})`;
      el.classList.toggle('alert', m.state === 'alert'); el.classList.toggle('sus', m.state === 'sus'); el.classList.toggle('tele', m.state === 'tele'); el.classList.toggle('lock', !!m.locked);
      el.style.display = m.hideBar ? 'none' : '';
      if (m.hideBar && m.state) { el.style.display = ''; el.firstChild.style.display = 'none'; } else el.firstChild.style.display = '';
    }
    for (const [id, el] of this.markers) if (!seen.has(id)) { el.remove(); this.markers.delete(id); }
  }

  showResult(summary) {
    const lines = this.el['result-lines']; lines.replaceChildren(...summary.lines.map(t => { const li = document.createElement('li'); li.textContent = t; return li; }));
    const nums = this.el['result-nums'];
    nums.replaceChildren(...[['救えた人', summary.saved], ['食糧', Math.round(summary.food)], ['士気', Math.round(summary.morale)], ['村の信頼', Math.round(summary.trust)]].map(([k, v]) => {
      const d = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; d.append(dt, dd); return d; }));
    this.clearTransient(); this.el.hud.classList.add('hidden');
    this.el.result.classList.remove('hidden');
  }
  hideResult() { this.el.result.classList.add('hidden'); }
  showDeath(on) { if (on) this.clearTransient(); this.el.death.classList.toggle('hidden', !on); }
}
