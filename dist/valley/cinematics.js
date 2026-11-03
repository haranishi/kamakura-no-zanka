// 純粋な再生・予約・記録。呼出側が渡す状態だけを更新し、通知はそのコマの戻り値で返す。
import { CINEMATIC_LIMITS as LIMITS } from './cinematics-data.js';
const KEYS = Object.freeze(['KeyE', 'Space', 'Mouse0']);
const EPS = 1e-9;
const downNow = down => Object.fromEntries(KEYS.map(k => [k, down?.[k] === true]));

// 最初の入力は既に押されていた可能性がある。解放を観測するまで新規押下にしない。
export function createCinematicPlayer(entry, { fromBattle = false } = {}) {
  return { entry, fromBattle, phase: 'preparing', elapsedSec: 0, returnElapsedSec: 0,
    skipped: false, hintSent: false, endSent: false, suspended: false, released: false,
    previousDown: downNow({ KeyE: true, Space: true, Mouse0: true }),
    holdSec: {}, shotIndex: -1, shotTimeSec: 0 };
}

// dtは前の入力観測からの秒。押し始めたコマのdtを長押しへ加算しない。
// 復帰最初のdtも捨て、休止時間を繰り越さない。戻り値のevents/consumedは毎コマ使い切る。
export function stepCinematic(state, dt, input = {}) {
  const s = state, events = [], consumed = [], down = downNow(input.down);
  const result = () => ({ state: s, events, consumed });
  if (s.phase === 'ended') return result();
  if (input.paused || input.hidden || s.suspended) {
    const blocked = input.paused || input.hidden;
    s.suspended = !!blocked;
    s.previousDown = down;
    s.holdSec = {};
    return result();
  }
  const sec = Number.isFinite(dt) && dt > 0 ? dt : 0;
  s.elapsedSec += sec;
  if (!s.hintSent && s.elapsedSec + EPS >= LIMITS.skipHintSec) {
    s.hintSent = true; events.push({ type: 'skip-hint' });
  }
  if (KEYS.every(k => !down[k])) s.released = true;
  const pressed = KEYS.filter(k => down[k] && !s.previousDown[k]);
  for (const k of KEYS) s.holdSec[k] = down[k] && s.previousDown[k] ? (s.holdSec[k] || 0) + sec : 0;
  const skipKeys = s.fromBattle
    ? (s.released ? KEYS.filter(k => down[k] && s.holdSec[k] + EPS >= LIMITS.skipHoldSec) : [])
    : pressed;
  s.previousDown = down;
  if (s.phase === 'returning') {
    s.returnElapsedSec += sec;
    // 消費した操作は、復帰が終わるまで押し続けても後続処理に渡さない。
    if (s.skipped) consumed.push(...KEYS.filter(k => down[k]));
  } else if (s.hintSent && skipKeys.length) {
    s.skipped = true; s.phase = 'returning'; s.returnElapsedSec = 0;
    consumed.push(...KEYS.filter(k => down[k]));
    events.push({ type: 'skip', keys: skipKeys });
  } else {
    const start = s.entry.prepareSec + s.entry.transitionSec;
    const playSec = s.entry.shots.reduce((n, shot) => n + shot.durationSec, 0);
    if (s.elapsedSec + EPS >= start + playSec) {
      s.phase = 'returning'; s.returnElapsedSec = Math.max(0, s.elapsedSec - start - playSec);
    } else if (s.elapsedSec + EPS >= start) {
      s.phase = 'playing';
      let t = Math.max(0, s.elapsedSec - start);
      s.shotIndex = 0;
      while (s.shotIndex < s.entry.shots.length - 1 && t + EPS >= s.entry.shots[s.shotIndex].durationSec) {
        t = Math.max(0, t - s.entry.shots[s.shotIndex++].durationSec);
      }
      s.shotTimeSec = t;
    }
  }
  if (s.phase === 'returning' && s.returnElapsedSec + EPS >= s.entry.returnSec) {
    s.phase = 'ended';
    if (!s.endSent) { s.endSent = true; events.push({ type: 'ended', skipped: s.skipped }); }
  }
  return result();
}

export function planSafeStart({ waitedSec, safe, cancelled }) {
  if (cancelled) return 'cancel';
  if (!Number.isFinite(waitedSec) || waitedSec > LIMITS.safeWaitSec) return 'give-up';
  return safe ? 'start' : 'wait';
}

// JSONの組で区切り文字を含むidも衝突しない。試行番号・集合は実行中だけ保持する。
const playedKey = (id, attempt) => JSON.stringify([id, attempt]);
export const createPlayedSet = () => new Map();
export const canReserve = (set, id, attempt) => !set.has(playedKey(id, attempt));
export function markReserved(set, id, attempt) {
  if (!canReserve(set, id, attempt)) return false;
  set.set(playedKey(id, attempt), 'reserved'); return true;
}
export function markEnded(set, id, attempt) {
  const key = playedKey(id, attempt);
  if (set.get(key) !== 'reserved') return false;
  set.set(key, 'ended'); return true;
}

export const CINEMATICS_STORAGE_KEY = 'kamakura-valley-cinematics';
const initialRecord = () => ({ schema: CINEMATICS_STORAGE_KEY, version: 1, chapter1EndSeen: false });
// rawは解析済みの値、または保存された文字列。null/undefinedは記録なし。
// 読込失敗を渡す場合はErrorを使う（通知つきで未完了）。保存先へは触れない。
export function normalizeCinematicsRecord(raw) {
  const empty = initialRecord();
  if (raw === null || raw === undefined) return { record: empty, notice: '' };
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        value.schema !== CINEMATICS_STORAGE_KEY || value.version !== 1 ||
        ('chapter1EndSeen' in value && typeof value.chapter1EndSeen !== 'boolean')) throw new Error('invalid record');
    return { record: { ...empty, chapter1EndSeen: value.chapter1EndSeen ?? false }, notice: '' };
  } catch {
    return { record: empty, notice: '演出の記録を読めないため未完了として扱う' };
  }
}
export function planResume({ checkpoint, record }) {
  if (checkpoint !== 'cp_result') return 'none';
  return normalizeCinematicsRecord(record).record.chapter1EndSeen ? 'to-result' : 'play-end';
}
