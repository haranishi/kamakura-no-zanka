// cinematics-view.js — 節目の演出を谷の上で見せる（app層・C0a後半）。再生は cinematics.js、見え方は cinematics-frame.js。
// 演出の間、game は flow='cinematic' で世界の更新（人物・戦闘・判断・押し出し・米と区域・矢・タイマー・時計）を呼ばない（game.update）。
// ここが進めるのは、演出の時計（実時間・休止と非表示で止まる）・演出カメラ（game.cine）・語りの枠（#32 の hud.narration）・飛ばしの案内だけ。
import { createCinematicPlayer, stepCinematic, createPlayedSet, markReserved, markEnded, canReserve } from './cinematics.js';
import { validateCinematicTable } from './cinematics-data.js';
import { createReturnRegistry, skipDown, cinematicView } from './cinematics-frame.js';
import { saveCinematicsRecord } from './save.js';
import { CinemaCast } from './cinematics-cast.js';
import { OPENING } from './opening-data.js';
import { WORLD } from './world-data.js';

const CHAPTER_END_ID = 'chapter1_end';
const HOLD_SKIP = '<kbd>E</kbd>・<kbd>Space</kbd>・クリックを長押しで飛ばす';   // 戦闘から始まった演出は、離してから新しく0.6秒長押し（R26.3）

export class CinematicDirector {
  constructor(game) {
    this.g = game; this.active = null; this.swallow = null; this.cast = new CinemaCast(game);   // 人物の見た目・景色（cast と scenery の指示）
    this.returns = createReturnRegistry();
    // 試験用の復帰先：遊びへ戻るだけ。後続の会話・回復・加入・保存は、各演出の復帰先（C1〜C4）が既存の出口へ1回ずつ渡す
    this.returns.register('play', () => { this.g.flow = 'play'; this.g.input.requestLock(); });
    this.resetRun();
  }
  // 今回の上映の記録（予約の集合・試行番号）。はじめから・つづきから・もう一度で初期化、区切りへのやり直しは試行番号を進める
  resetRun() { this.played = createPlayedSet(); this.attempt = 0; this.endCount = 0; this.events = []; }
  nextAttempt() { this.played = createPlayedSet(); this.attempt++; }

  // entry は表の1件（cinematics-data.js の形）。opts.textById は字幕の識別子→文。戻り値 { ok, reason?, errors? }
  play(entry, { fromBattle = false, textById = {} } = {}) {
    const g = this.g;
    if (this.active || g.flow !== 'play') return { ok: false, reason: 'busy' };
    const errors = validateCinematicTable([entry], { textById, returnTargets: this.returns.names() });
    if (errors.length) {
      // 表示できない：映像で何も成立させず、同じ復帰口へ進む（R29.7）。章末の完了は書かない
      this.events.push({ type: 'failed', id: entry?.id ?? null, errors });
      g.hud.toast('演出を表示できないため、そのまま続ける', 2400);
      (this.returns.resolve(entry?.returnTarget) || this.returns.resolve('play'))({ entry, skipped: false, failed: true });
      return { ok: false, reason: 'invalid', errors };
    }
    if (!canReserve(this.played, entry.id, this.attempt)) return { ok: false, reason: 'reserved' };
    markReserved(this.played, entry.id, this.attempt);
    const c = g.camera;
    this.active = { entry, textById, attempt: this.attempt, player: createCinematicPlayer(entry, { fromBattle }), prevFlow: g.flow, prevCine: g.cine,
      pose: { pos: c.position.clone(), quat: c.quaternion.clone(), fov: c.fov }, lastKey: null };
    g.flow = 'cinematic'; g.cine = null;
    this.cast.begin(entry);
    document.body.classList.add('cinematic');
    g.hud.narration(true, { colors: OPENING.colors, title: '', note: '', skip: fromBattle ? HOLD_SKIP : null });
    this.events.push({ type: 'start', id: entry.id, fromBattle });
    this.step(0);                                   // 開始のコマ：押している操作を観測する（押し続けを新しい押下にしない）
    return { ok: true };
  }

  // 毎コマ（game.update の演出の分岐）。rawDt は実時間。休止中は pauseStep が呼ばれ、復帰の最初の dt は再生側が捨てる
  step(rawDt) {
    const a = this.active; if (!a) return;
    const g = this.g, before = a.player.elapsedSec, r = stepCinematic(a.player, rawDt, { down: skipDown(g.input), hidden: document.hidden });
    for (const e of r.events) {
      this.events.push({ ...e, id: a.entry.id, t: +a.player.elapsedSec.toFixed(3) });
      if (e.type === 'ended') { this.finish(e.skipped); return; }
    }
    this.show(a.player.elapsedSec - before);                       // 進んだ演出の秒（休止明けの最初のコマは0）
  }
  pauseStep() { const a = this.active; if (a) stepCinematic(a.player, 0, { down: skipDown(this.g.input), paused: true }); }

  show(dt = 0) {
    const a = this.active, g = this.g, reduced = g.reducedMotion(), v = cinematicView(a.player, { reduced, textById: a.textById });
    // 演出カメラ：毎コマ、開始時の遊びのカメラから混ぜ直す（カメラの装置 rig は動かさない＝戻ったときの視点と操作の向きは元のまま）
    const c = g.camera, p = this.anchorAt(v.anchor), T = g.terrain;
    c.position.copy(a.pose.pos); c.quaternion.copy(a.pose.quat);
    if (c.fov !== a.pose.fov) { c.fov = a.pose.fov; c.updateProjectionMatrix(); }
    const px = p.x + v.pos[0], pz = p.z + v.pos[2], lx = p.x + v.lookAt[0], lz = p.z + v.lookAt[2];
    // cine の y は地面からの高さ。相対位置は anchor の足もとの高さから測るので、その差を渡す
    g.cine = { shot: { pos: [px, p.y + v.pos[1] - T.heightAt(px, pz), pz], look: [lx, p.y + v.lookAt[1] - T.heightAt(lx, lz), lz], fov: v.fov }, k: v.weight, target: v.weight };
    g.applyCine(0);
    this.cast.update(v, a.player, dt, reduced);
    const key = v.subtitleKey + (v.hint ? '#h' : '');
    if (key !== a.lastKey) {
      a.lastKey = key;
      g.hud.setNarration({ black: 0, title: 0, hint: v.hint ? 1 : 0,
        line: v.subtitle ? { id: 'cine:' + v.subtitleKey, text: v.subtitle, color: OPENING.colors.history, kind: 'history', alpha: 1 } : null });
    }
  }
  anchorAt(name) {
    const g = this.g;
    const actor = name === 'hero' ? g.hero : name === 'ally' ? g.ally : g.enemies.find(e => e.id === name) || g.npcs.get(name);
    const at = actor ? actor.pos : WORLD.props.find(p => p.id === name) || g.hero.pos;
    return { x: at.x, z: at.z, y: g.terrain.heightAt(at.x, at.z) };
  }

  // 片づけ：語りの枠・演出カメラ・表示の印を戻す。カメラは開始時の姿へ（次のコマから rig が続きを描く）
  cleanup() {
    const a = this.active, g = this.g; if (!a) return null;
    this.active = null; this.cast.end();
    g.hud.narration(false); document.body.classList.remove('cinematic');
    const c = g.camera; c.position.copy(a.pose.pos); c.quaternion.copy(a.pose.quat);
    if (c.fov !== a.pose.fov) { c.fov = a.pose.fov; c.updateProjectionMatrix(); }
    g.cine = a.prevCine; g.flow = a.prevFlow;
    return a;
  }
  // 完走・飛ばしの終わり（再生側の ended は1回だけ来る）。記録 → 復帰先の順
  finish(skipped) {
    const g = this.g, a = this.cleanup();
    markEnded(this.played, a.entry.id, a.attempt); this.endCount++;
    // 袖印をくべる版を、火に触れる前に飛ばした：くべた結末として扱う（映像を飛ばしただけ。断片・任務は変えない）
    const st = this.cast.last;
    if (skipped && st && !st.burned && a.entry.shots.some(s => s.scenery.includes('fire_flare'))) { st.burned = true; st.burnSkipped = true; }
    // 飛ばしに使った操作は、離すまで次の攻撃・回避・調べる・行送りへ渡さない（game.update が毎コマ押した瞬間を消す）
    const down = skipDown(g.input), held = Object.keys(down).filter(k => down[k]);
    this.swallow = skipped && held.length ? new Set(held) : null;
    if (a.entry.id === CHAPTER_END_ID) {
      const r = saveCinematicsRecord(g.storage, { chapter1EndSeen: true });
      if (!r.ok) g.hud.toast(r.notice + '（次に開いたとき、もう一度流れることがある）', 3200);
    }
    this.returns.resolve(a.entry.returnTarget)({ entry: a.entry, skipped });
  }
  // 中断（区切りへのやり直し・はじめから）：通知も記録も復帰先もなし
  abort() { const a = this.cleanup(); if (a) this.events.push({ type: 'aborted', id: a.entry.id }); }

  // 飛ばしに使った操作の押した瞬間を消す。離したものから外す（押し直しは新しい操作として通す）
  filterInput(input) {
    const s = this.swallow; if (!s) return;
    for (const k of [...s]) {
      const held = k === 'Mouse0' ? input.mouse.has(0) : input.held.has(k);
      if (!held) { s.delete(k); continue; }
      if (k === 'Mouse0') input.mousePressed.delete(0); else input.pressed.delete(k);
    }
    if (!s.size) this.swallow = null;
  }

  snapshot() {
    const a = this.active, p = a?.player;
    return { flow: this.g.flow, attempt: this.attempt, endCount: this.endCount, played: [...this.played].map(([k, v]) => [JSON.parse(k), v]),
      events: this.events.map(e => ({ ...e })), swallow: this.swallow ? [...this.swallow] : [],
      active: p ? { id: a.entry.id, phase: p.phase, elapsed: +p.elapsedSec.toFixed(4), shot: p.shotIndex, hint: p.hintSent, skipped: p.skipped,
        suspended: p.suspended, released: p.released, fromBattle: p.fromBattle } : null, stage: this.cast.last ? { ...this.cast.last } : null };
  }
}
