// opening.js — オープニングの進行の状態機械（純粋層）。時計・乱数・DOM・Three.js に触れない。
// 入力は経過時間 dt と「飛ばす」操作（と「動きを減らす」）。出力は区間・語りの画面・字の色・カメラの鍵・暗転・終了・飛ばし済み。
// 見せ方（舞台・字幕の枠・目覚め）は game.js と opening-stage.js が、この出力と出来事（events）だけを見て決める。
import { OPENING } from './opening-data.js';

const SCENES = ['A', 'B', 'C', 'D'];
const isScene = id => SCENES.includes(id);
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const ramp = (t, a, b) => clamp01((t - a) / (b - a));      // a→b で 0→1

export function planOf(version, data = OPENING) {
  const key = Object.hasOwn(data.versions, version) ? version : 'full';
  const v = data.versions[key];
  const segments = v.segments.map(([id, from, to]) => ({ id, from, to }));
  const lines = v.lines.map(([id, at, until]) => ({ id, at, until, text: data.lines[id].text, kind: data.lines[id].kind, color: data.colors[data.lines[id].kind] }));
  return { version: key, segments, lines, total: segments[segments.length - 1].to, wake: segments.find(s => s.id === 'wake') };
}

export function createOpening({ version = 'full' } = {}) {
  return { version: planOf(version).version, t: 0, skipAt: null, skipBlack: null, stood: false, done: false };
}

function segmentAt(plan, t) {
  for (const s of plan.segments) if (t < s.to) return s;
  return plan.segments[plan.segments.length - 1];
}

// 予定どおりの暗転の濃さ（飛ばしを含まない）。暗転と題名は1、暗転からは明け、題名へは暮れる。目覚めは既存の暗転に任せて0
function scheduledBlack(plan, t, F) {
  const seg = segmentAt(plan, t), i = plan.segments.indexOf(seg), prev = plan.segments[i - 1], next = plan.segments[i + 1];
  let black = seg.id === 'dark' || seg.id === 'title' ? 1 : 0;
  if (isScene(seg.id) && prev && !isScene(prev.id)) black = Math.max(black, 1 - ramp(t, seg.from, seg.from + F.fromDark));
  if (isScene(seg.id) && next && !isScene(next.id)) black = Math.max(black, ramp(t, seg.to - F.toTitle, seg.to));
  return black;
}

// 時刻 t の見え方。状態を書き換えない
export function viewOf(state, { reduced = false } = {}, data = OPENING) {
  const plan = planOf(state.version, data), F = data.fade, t = state.t;
  const seg = segmentAt(plan, t), i = plan.segments.indexOf(seg);
  const prev = plan.segments[i - 1], scene = isScene(seg.id), wake = seg.id === 'wake';
  const skipK = state.skipAt === null || wake ? 0 : ramp(t, state.skipAt, state.skipAt + data.skip.fade);
  // 飛ばしたあとは、飛ばした瞬間の濃さから1へ単調に暮れる（明けの途中で飛ばしても、場面が透けて見えない）。予定の暗転より明るくはしない
  const black = wake ? 0 : state.skipAt === null ? scheduledBlack(plan, t, F) : Math.max(scheduledBlack(plan, t, F), state.skipBlack + (1 - state.skipBlack) * skipK);
  // 場面から場面へは溶け合わせる（前の場面の最後の1枚を残して薄くする）。暗転からと、題名へは溶けない
  const dissolve = scene && prev && isScene(prev.id) ? 1 - ramp(t, seg.from, seg.from + F.dissolve) : 0;
  const l = wake ? null : plan.lines.find(x => t >= x.at && t < x.until) || null;
  const line = l && { id: l.id, text: l.text, kind: l.kind, color: l.color,
    alpha: Math.min(ramp(t, l.at, l.at + F.line), 1 - ramp(t, l.until - F.line, l.until)) * (1 - skipK) };
  const title = seg.id === 'title' ? Math.min(ramp(t, seg.from + F.titleDelay, seg.from + F.titleDelay + F.titleIn), 1 - ramp(t, seg.to - F.titleOut, seg.to)) * (1 - skipK) : 0;
  const hint = wake || state.skipAt !== null ? 0 : ramp(t, data.skip.lockout, data.skip.lockout + F.hint);
  const camera = scene ? { shot: seg.id, k: reduced ? data.shots[seg.id].still : ramp(t, seg.from, seg.to) } : null;
  return { version: plan.version, t, segment: seg.id, segmentT: t - seg.from, black, dissolve, line, title, hint, camera,
    stage: !wake && !state.done, wake, wakeT: wake ? t - seg.from : 0, skipped: state.skipAt !== null, done: state.done };
}

// 1コマ進める。戻り値の state は新しいオブジェクト（入力は書き換えない）。events は起きた順：
// skip（飛ばしを受け付けた）・cut（場面が替わった。前の1枚を残す合図）・seen・wake（目覚めの区間に入った）・getup・done
export function stepOpening(state, { dt = 0, skip = false, reduced = false } = {}, data = OPENING) {
  const events = [];
  if (state.done) return { state, out: viewOf(state, { reduced }, data), events };
  const plan = planOf(state.version, data), W = plan.wake;
  dt = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const before = state.t;
  let t = before + dt, skipAt = state.skipAt, skipBlack = state.skipBlack, stood = state.stood, done = false;
  if (skip && skipAt === null && t < W.from && t > data.skip.lockout) { skipAt = t; skipBlack = scheduledBlack(plan, t, data.fade); events.push('skip'); }
  if (skipAt !== null && t < W.from && t >= skipAt + data.skip.fade) t = W.from + (t - skipAt - data.skip.fade);
  const from = segmentAt(plan, before).id, to = segmentAt(plan, t).id;
  if (t < W.from && isScene(from) && isScene(to) && from !== to) events.push('cut');
  if (before < W.from && t >= W.from) events.push('seen', 'wake');
  const wakeT = t - W.from;
  if (wakeT >= 0) {
    if (!stood && wakeT > data.wake.getupAt) { stood = true; events.push('getup'); }
    if (wakeT > W.to - W.from || (skip && before >= W.from && wakeT > data.wake.skipAfter)) { done = true; events.push('done'); }
  }
  const next = { version: state.version, t, skipAt, skipBlack, stood, done };
  return { state: next, out: viewOf(next, { reduced }, data), events };
}

// 炎の明るさの揺らぎ（倍率）。1.1Hz以下の正弦だけで作り、1秒に3回を超えて明滅させない（R22.5）
export function flicker(t, seed = 0) {
  const w = 2 * Math.PI;
  return 1 + 0.07 * Math.sin(t * w * 1.1 + seed) + 0.05 * Math.sin(t * w * 0.63 + seed * 1.7) + 0.03 * Math.sin(t * w * 0.37 + seed * 2.3);
}

// 2色のコントラスト比（WCAG 2.x の相対輝度）。字と帯の読みやすさを測る
export function contrast(a, b) {
  const lum = hex => {
    const n = parseInt(hex.replace('#', ''), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255).map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
