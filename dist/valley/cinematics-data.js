// 節目の演出の表。内容はC1〜C4で追加する。秒数は準備・移行・復帰も含む。
export const CINEMATIC_LIMITS = Object.freeze({
  minDurationSec: 5, maxDurationSec: 10, skipHintSec: 0.6,
  skipHoldSec: 0.6, maxSkipReturnSec: 0.6, safeWaitSec: 3, maxTextChars: 40,
});
export const CINEMATICS = Object.freeze([]);
const seconds = n => Number.isFinite(n) && n >= 0;
const vector = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const camera = c => c && typeof c.anchor === 'string' && c.anchor.length > 0 &&
  vector(c.from) && vector(c.to) && vector(c.lookAt) && Number.isFinite(c.fov) && c.fov > 0 && c.fov < 180;

// entry: id, chapter, kind, opening?, trigger, stage, prepareSec, transitionSec,
// returnSec, returnTarget, shots。cameraの位置はanchorからの相対位置（m）。
export function validateCinematicTable(table, { textById = {}, returnTargets = [] } = {}) {
  const errors = [], ids = new Set();
  if (!Array.isArray(table)) return ['table must be an array'];
  for (const [i, entry] of table.entries()) {
    const bad = message => errors.push(`entry ${i}: ${message}`);
    if (!entry || typeof entry !== 'object') { bad('invalid entry'); continue; }
    const e = entry;
    if (typeof e.id !== 'string' || !e.id) bad('invalid id');
    if (ids.has(e.id)) bad('duplicate id');
    ids.add(e.id);
    if (!Number.isInteger(e.chapter) || e.chapter < 1) bad('invalid chapter');
    if (!['open', 'end', 'event'].includes(e.kind)) bad('invalid kind');
    if (typeof e.trigger !== 'string' || !e.trigger || typeof e.stage !== 'string' || !e.stage) bad('missing trigger/stage');
    if (!returnTargets.includes(e.returnTarget)) bad('unknown return target');
    const timing = [e.prepareSec, e.transitionSec, e.returnSec];
    if (!timing.every(seconds) || e.returnSec > CINEMATIC_LIMITS.maxSkipReturnSec) bad('invalid preparation/transition/return duration');
    if (!Array.isArray(e.shots) || e.shots.length === 0) {
      bad(e.chapter > 1 ? 'empty later chapter scene' : 'empty shots'); continue;
    }
    let total = timing.reduce((a, b) => a + b, 0);
    for (const [j, s] of e.shots.entries()) {
      if (!s || typeof s !== 'object') { bad(`shot ${j}: invalid shot`); total = NaN; continue; }
      if (!seconds(s.durationSec) || s.durationSec === 0) bad(`shot ${j}: invalid duration`);
      total += s.durationSec;
      if (!camera(s.camera)) bad(`shot ${j}: invalid camera`);
      if (!Array.isArray(s.gestures) || !s.gestures.every(v => typeof v === 'string') ||
          !Array.isArray(s.scenery) || !s.scenery.every(v => typeof v === 'string')) bad(`shot ${j}: invalid cues`);
      if (!s.still || !camera(s.still.camera) || !Array.isArray(s.still.gestures) ||
          !s.still.gestures.every(v => typeof v === 'string')) bad(`shot ${j}: invalid still`);
      if (!Array.isArray(s.subtitleIds)) { bad(`shot ${j}: invalid subtitles`); continue; }
      let chars = 0;
      for (const id of s.subtitleIds) {
        if (typeof id !== 'string' || !Object.hasOwn(textById, id) || typeof textById[id] !== 'string') bad(`shot ${j}: unknown subtitle`);
        else chars += [...textById[id]].length;
      }
      if (chars > CINEMATIC_LIMITS.maxTextChars) bad(`shot ${j}: subtitles exceed 40 characters`);
    }
    // #32の章頭（第1章のopen）だけが長尺の例外。openingフラグだけでは免除せず、後続章にも広げない（R26.1）。
    const opening = e.kind === 'open' && e.opening === true && e.chapter === 1;
    if (!Number.isFinite(total) || (!opening && (total < CINEMATIC_LIMITS.minDurationSec || total > CINEMATIC_LIMITS.maxDurationSec))) bad('duration outside limits');
  }
  return errors;
}
