// smooth-flags.js — 走り・歩きの滑らかさの変更（design-locomotion-smooth §8）を1件ずつ旧経路へ戻す切替。純粋（渡された文字列だけを読む）。
// URL の ?smooth=off で全部を旧経路へ、?smooth=speed,ik のように名前を並べるとその変更だけを旧経路へ戻す。既定（指定なし）は全部が新しい経路。
// 基準値は同じ版で ?smooth=off を撮り直して得る（要件38.3）。2026-11-04 時点では、どの変更もまだこの切替を読まない（差し込み口だけ）。
export const SMOOTH_NAMES = Object.freeze(['speed', 'accel', 'phase', 'stride', 'ik', 'arms', 'camera']);

// search は location.search の形（'?a=1&smooth=off'）か、smooth の値そのもの。戻り値の各名前は true＝新しい経路、false＝旧経路。
// unknown は読めなかった名前（打ち間違いに気づけるように返す。切替には使わない）。
export function parseSmoothFlags(search = '') {
  const s = String(search ?? '');
  let raw = s;
  if (s.includes('=') || s.startsWith('?')) {
    raw = null;
    for (const part of s.replace(/^\?/, '').split('&')) {
      const i = part.indexOf('='), key = i < 0 ? part : part.slice(0, i);
      if (key === 'smooth') raw = i < 0 ? '' : part.slice(i + 1);
    }
  }
  const flags = Object.fromEntries(SMOOTH_NAMES.map(n => [n, true])), unknown = [];
  if (raw) {
    let text = raw.replace(/\+/g, ' ');
    try { text = decodeURIComponent(text); } catch { /* 壊れた %xx はそのまま読む */ }
    for (const word of text.split(',').map(w => w.trim().toLowerCase()).filter(Boolean)) {
      if (word === 'off' || word === 'all') for (const n of SMOOTH_NAMES) flags[n] = false;
      else if (SMOOTH_NAMES.includes(word)) flags[word] = false;
      else unknown.push(word);
    }
  }
  return Object.freeze({ ...flags, unknown: Object.freeze(unknown) });
}
