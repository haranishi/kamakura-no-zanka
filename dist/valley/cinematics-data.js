// 節目の演出の表。C1で章末（chapter1_end）を入れた。大将・救出・待ち伏せはC2〜C4。秒数は準備・移行・復帰も含む。
import { endingTier } from './narrative.js';
export const CINEMATIC_LIMITS = Object.freeze({
  minDurationSec: 5, maxDurationSec: 10, skipHintSec: 0.6,
  skipHoldSec: 0.6, maxSkipReturnSec: 0.6, safeWaitSec: 3, maxTextChars: 40,
});
// ショット1つ。カメラは anchor（ここでは焚き火 bonfire）からの相対位置（m・高さは焚き火の足もとから）。静止版は動きを減らす設定の代表の画と姿勢。
// 人物の位置は結末の場面の配置（game.setupResultScene：景継は火の(+1.0,-2.5)、穂太は(+2.1,-1.5)、弥十郎は(-2.1,-0.9)）を前提にする。
// gestures：hold/release（景継の右手が袖印を差し出す・離す）、look:a>b（a が b を見る）、gaze:hero>fire、nod:人物。
// scenery：fire（焚き火）、sode_hand／sode_fall（袖印が手にある／手から火へ落ちる）、fire_flare（袖印をくべて炎が上がる）。
const cam = (from, to, lookAt, fov) => ({ anchor: 'bonfire', from, to, lookAt, fov });
const hold = c => ({ anchor: c.anchor, from: c.to, to: c.to, lookAt: c.lookAt, fov: c.fov });
const shot = (durationSec, camera, { subtitleIds = [], gestures = [], scenery = ['fire'], still = gestures } = {}) =>
  ({ durationSec, camera, subtitleIds, gestures, scenery, still: { camera: hold(camera), gestures: still } });
const BOTH = cam([0.45, 1.4, -0.7], [0.6, 1.36, -0.95], [1.6, 1.2, -2.05], 42);          // 火の側から景継と穂太の顔へ（火の明かりが顔に当たる）
const LAMP = cam([-0.4, 2.3, 3.4], [-0.6, 3.0, 4.6], [-0.2, 0.5, -1.0], 46);             // 火の北から少し引き上げ、焚き火を囲む人の輪へ（灯）
const FIRE = cam([-2.0, 1.3, 2.8], [-1.5, 1.25, 2.4], [0.4, 0.7, -1.2], 44);             // 火越しに景継
// 断片の数で3通り（narrative.js の endingTier）。全部、自動で流れる部分は10秒以内。真相の行は直前の手送り会話 ending_truth にあり、ここでは繰り返さない
const CHAPTER1_END_SHOTS = {
  plain: [   // 0〜2個：火→景継と穂太→灯
    shot(2.4, FIRE, { gestures: ['gaze:hero>fire'] }),
    shot(2.4, BOTH, { gestures: ['look:boy>hero'] }),
    shot(2.6, LAMP, { subtitleIds: ['coda_lamp'] }),
  ],
  deep: [    // 3〜4個：受け止めた弥十郎がうなずく
    shot(1.8, FIRE, { gestures: ['gaze:hero>fire'] }),
    shot(2.0, cam([-0.75, 0.95, -1.75], [-0.85, 0.92, -1.6], [-2.1, 0.85, -0.9], 38), { gestures: ['nod:ally', 'gaze:hero>fire'] }),
    shot(1.8, BOTH, { gestures: ['look:hero>boy', 'look:boy>hero'] }),
    shot(2.4, LAMP, { subtitleIds: ['coda_lamp'], gestures: ['look:hero>boy'] }),
  ],
  full: [    // 5個：手→袖印→火→穂太（袖印を火にくべる。決定 2026-11-03）
    shot(1.4, cam([-0.45, 1.0, -0.95], [-0.3, 1.02, -1.15], [0.75, 1.1, -2.1], 40), { gestures: ['hold:hero'], scenery: ['fire', 'sode_hand'] }),
    shot(1.4, cam([-2.3, 1.15, -2.4], [-2.1, 1.1, -2.2], [0.4, 0.65, -1.0], 46), { gestures: ['release:hero'], scenery: ['fire', 'sode_fall'] }),
    shot(1.6, cam([-0.5, 1.6, 2.4], [-0.4, 1.5, 2.0], [0.5, 0.6, -1.6], 44), { subtitleIds: ['coda_let_go'], gestures: ['gaze:hero>fire'], scenery: ['fire', 'fire_flare'] }),
    shot(1.6, BOTH, { gestures: ['look:hero>boy', 'look:boy>hero'] }),
    shot(2.4, LAMP, { subtitleIds: ['coda_lamp'], gestures: ['look:hero>boy'] }),
  ],
};
export const CINEMATICS = Object.freeze([
  Object.freeze({ id: 'chapter1_end', chapter: 1, kind: 'end', trigger: 'ending_truth_end', stage: 'valley', cast: ['hero', 'boy', 'ally'],
    prepareSec: 0.2, transitionSec: 0.4, returnSec: 0.4, returnTarget: 'result', shots: CHAPTER1_END_SHOTS.plain,
    variants: { deep: CHAPTER1_END_SHOTS.deep, full: CHAPTER1_END_SHOTS.full } }),
]);
// 表の1件を、いまの状況の版にして返す（無ければ null）。章末は断片の数で版を選ぶ。variant は 'plain'|'deep'|'full'
export function cinematicFor(id, { fragments = 0 } = {}) {
  const e = CINEMATICS.find(x => x.id === id); if (!e) return null;
  const variant = e.variants ? endingTier(fragments) : 'plain';
  return { ...e, variant, shots: (variant !== 'plain' && e.variants?.[variant]) || e.shots };
}
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
    if ('cast' in e && !(Array.isArray(e.cast) && e.cast.every(v => typeof v === 'string' && v))) bad('invalid cast');
    if ('variants' in e && e.variants !== undefined) {   // 版：各版を同じ規則で検査する（版ごとに尺・字幕・カメラ）
      if (!e.variants || typeof e.variants !== 'object' || Array.isArray(e.variants)) bad('invalid variants');
      else for (const [k, shots] of Object.entries(e.variants)) {
        for (const m of validateCinematicTable([{ ...e, variants: undefined, shots }], { textById, returnTargets })) bad(`variant ${k}: ${m.replace(/^entry 0: /, '')}`);
      }
    }
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
