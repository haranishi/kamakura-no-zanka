// banter.js — 掛け合い・独り言の選び方（純粋層）。いつ・どの台詞を字幕に出すかだけを決める。表示は hud.js、状況の組み立ては game.js。
// 規則（design-narrative.md §4）：条件（場面・場所・出来事・同行者・信頼・選んだ道）がそろった台詞を、データの順に一つずつ。
// 戦闘中・会話中・案内の表示中・掛け声の表示中・字幕OFFは出さない（game.js が blocked にまとめて渡す）。同じ台詞は一度だけ、
// 同じ group の言い換えも一つだけ。前の掛け合いが終わってから GAP 秒、止める理由が消えてから CALM 秒あける。
// 時計・乱数・DOM に触れない。状態は JSON にできる素の値だけで持つ。

export const BANTER_GAP = 8;
export const BANTER_CALM = 2;
// 信頼の段（結果文の境目と同じ。quest.js の summarize：58以上・48以上）
export const trustTier = t => (t >= 58 ? 'high' : t >= 48 ? 'mid' : 'low');
// when が読める鍵。ここに無い鍵は書き間違いとして検査で落とす（tests/valley-story.test.mjs）
export const WHEN_KEYS = ['beats', 'minBeatT', 'areas', 'after', 'plan', 'approach', 'ambush', 'companion', 'captiveFreed', 'seen', 'trust', 'food', 'fragments'];
// game.js が起こす出来事の名前（when.after に書ける値）
export const BANTER_EVENTS = ['scout_killed', 'scout_stealth', 'scout_surrendered', 'scout_routed'];

const inRange = (v, r) => typeof v === 'number' && (r[0] == null || v >= r[0]) && (r[1] == null || v < r[1]);
// 状況 sit が条件 when を満たすか。会話の行の when（narrative.js）も同じ規則で読む
export function matches(when, sit) {
  if (!when) return true;
  if (when.beats && !when.beats.includes(sit.beat)) return false;
  if (when.minBeatT != null && !((sit.beatT ?? 0) >= when.minBeatT)) return false;
  if (when.areas && !when.areas.some(a => (sit.areas || []).includes(a))) return false;
  if (when.after && !(sit.events || []).includes(when.after)) return false;
  for (const k of ['plan', 'approach', 'ambush']) if (k in when && (sit[k] ?? null) !== when[k]) return false;
  for (const k of ['companion', 'captiveFreed', 'seen']) if (k in when && !!sit[k] !== when[k]) return false;
  if (when.trust && trustTier(sit.trust) !== when.trust) return false;
  if (when.food && !inRange(sit.food, when.food)) return false;
  if (when.fragments && !inRange(sit.fragments, when.fragments)) return false;
  return true;
}
// 円の場所のうち、pos が入っているものの名前
export function areasAt(areas, pos) {
  return Object.entries(areas || {}).filter(([, a]) => Math.hypot(pos.x - a.x, pos.z - a.z) < a.r).map(([name]) => name);
}
// 一行を読む時間（秒）。短い行でも2.4秒、長くても4.6秒
export const lineSeconds = text => Math.max(2.4, Math.min(4.6, 1.4 + 0.11 * [...String(text)].length));

export function createBanterState() { return { shown: [], groups: [], playing: null, lastEnd: -1e9, calmSince: null, quietSince: null }; }

// 1コマ分進める。返す show は、いま字幕に出す一行（無ければ null）。list は STORY.banter。
// waiting は「掛け合いの最中か、出せる台詞が静まるのを待っている」。そのあいだ、急がない案内（G の案内）は譲る（掛け合い＞ヒント）
export function stepBanter(state, sit, list) {
  const s = { ...state, shown: [...state.shown], groups: [...state.groups], playing: state.playing && { ...state.playing } };
  const none = { state: s, show: null, waiting: false };
  if (sit.blocked) {
    // 割り込まれたら、掛け合いの残りの行は捨てる（掛け声や会話の上に、続きを重ねない）
    if (s.playing) { s.playing = null; s.lastEnd = sit.t; }
    s.calmSince = null; s.quietSince = null;
    return none;
  }
  if (s.playing) {
    if (sit.t < s.playing.until) return { ...none, waiting: true };
    const entry = list.find(e => e.id === s.playing.id), i = s.playing.line + 1;
    if (entry && i < entry.lines.length) {
      const line = entry.lines[i], seconds = lineSeconds(line.text);
      s.playing = { id: entry.id, line: i, until: sit.t + seconds };
      return { state: s, show: { id: entry.id, line: i, speaker: line.speaker, text: line.text, seconds }, waiting: true };
    }
    s.lastEnd = s.playing.until; s.playing = null;
    return none;
  }
  // held（案内の表示中）：新しい掛け合いは始めないが、始まった掛け合いは最後まで出す（掛け合い＞ヒント）。
  // overHint の台詞（目覚めた直後の一言）だけは、案内と並んで出す（案内は上、字幕は下で重ならない）
  if (s.calmSince === null) s.calmSince = sit.t;
  if (sit.held) s.quietSince = null; else if (s.quietSince === null) s.quietSince = sit.t;
  if (sit.t - s.lastEnd < BANTER_GAP) return none;
  const entry = list.find(e => !s.shown.includes(e.id) && !(e.group && s.groups.includes(e.group)) && (e.overHint || !sit.held) && matches(e.when, sit));
  if (!entry) return none;
  if (sit.t - s.calmSince < BANTER_CALM || (!entry.overHint && sit.t - s.quietSince < BANTER_CALM)) return { ...none, waiting: true };
  s.shown.push(entry.id); if (entry.group) s.groups.push(entry.group);
  const line = entry.lines[0], seconds = lineSeconds(line.text);
  s.playing = { id: entry.id, line: 0, until: sit.t + seconds };
  return { state: s, show: { id: entry.id, line: 0, speaker: line.speaker, text: line.text, seconds }, waiting: true };
}
