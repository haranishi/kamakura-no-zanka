// 共有風の純粋状態。時間は design-contracts.md「風」の仕様の値（混合1秒・全体5秒・終了後2秒）。
const GUIDE_SECONDS = 5, COOLDOWN_SECONDS = 2;
const reducedScale = 0.4; // 未測定の初期設計値。振幅と粒数だけを減らす。
const finitePositive = v => Number.isFinite(v) && v >= 0;
function direction(dir) {
  if (!Array.isArray(dir) || dir.length !== 2 || !Array.from(dir).every(Number.isFinite)) return null;
  const scale = Math.max(Math.abs(dir[0]), Math.abs(dir[1]));
  if (!scale) return null;
  const x = dir[0] / scale, z = dir[1] / scale, length = Math.hypot(x, z);
  return [x / length, z / length];
}
export function createWind({ t = 0, strength = 1, baseDir = [1, 0] } = {}) {
  return { t: finitePositive(t) ? t : 0, strength: finitePositive(strength) ? strength : 1,
    baseDir: direction(baseDir) || [1, 0], guideDir: null, guideElapsed: null, cooldown: 0, guideMix: 0 };
}
export function requestGuide(state, dir) {
  const normalized = direction(dir);
  if (!normalized) return { state, accepted: false, reason: '導きの向きが不正です' };
  if (state.guideElapsed !== null) return { state, accepted: false, reason: '導きの風の最中です' };
  if (state.cooldown > 0) return { state, accepted: false, reason: '終了後2秒の待ち時間です' };
  return { state: { ...state, guideDir: normalized, guideElapsed: 0, guideMix: 0 }, accepted: true, reason: null };
}
export function stepWind(state, dt, { paused = false, reduced = false } = {}) {
  // reduced は活動時間・導きの時間を変えない。
  if (paused || !finitePositive(dt)) return { ...state };
  const next = { ...state, t: state.t + dt };
  if (!Number.isFinite(next.t)) next.t = state.t;
  if (state.guideElapsed === null) next.cooldown = Math.max(0, state.cooldown - dt);
  else {
    const elapsed = state.guideElapsed + dt;
    if (elapsed >= GUIDE_SECONDS) {
      next.guideElapsed = null; next.guideDir = null; next.guideMix = 0;
      next.cooldown = Math.max(0, COOLDOWN_SECONDS - (elapsed - GUIDE_SECONDS));
    } else {
      next.guideElapsed = elapsed;
      next.guideMix = Math.max(0, Math.min(1, elapsed, GUIDE_SECONDS - elapsed));
    }
  }
  return next;
}
function mixedDirection(state) {
  const mix = state.guideMix, guide = state.guideDir || state.baseDir;
  return direction([state.baseDir[0] * (1 - mix) + guide[0] * mix, state.baseDir[1] * (1 - mix) + guide[1] * mix]) || state.baseDir;
}
export function windVector(state, { reduced = false } = {}) {
  const dir = mixedDirection(state);
  const strength = state.strength * (reduced ? reducedScale : 1);
  return { x: dir[0] * strength, z: dir[1] * strength, strength };
}
export function particleCount(base, { reduced = false } = {}) {
  return finitePositive(base) ? Math.floor(base * (reduced ? reducedScale : 1)) : 0;
}
export function toUniforms(state, { reduced = false } = {}) {
  const dir = mixedDirection(state); // 向きは強さ0・振幅設定からも独立する。
  return { uTime: state.t, uWind: state.strength * (reduced ? reducedScale : 1), uWindDir: dir, uGuideMix: state.guideMix };
}
