// Kamakura-only controller. All durations are seconds; no browser or clock access.
export const SCALES = [1, .85, .7, .58];
export function adaptPolicy(step) {
  return { scale: SCALES[step], standRange: step === 3 ? .4 : step === 2 ? .6 : 1,
    impostorRange: step === 3 ? .7 : 1, shadows: step < 3 };
}
export function adaptOptions(search = '', touch = false) {
  const q = new URLSearchParams(search), forced = q.get('adaptstep');
  return { quality: touch || q.get('q') === 'light' ? 'light' : 'standard', enabled: q.get('autoscale') !== '0',
    step: /^[0-3]$/.test(forced ?? '') ? Number(forced) : 0 };
}
export function adaptPixelRatio(dpr, quality, step) { return Math.min(dpr, quality === 'light' ? 1 : 1.5) * SCALES[step]; }
export function createAdapt(step = 0) {
  return { step, cool: 0, sum: 0, count: 0, clock: 0, probeWait: 10, lastRaise: -99, averageMs: 0 };
}
export function stepAdapt(previous, dt, { paused = false, hidden = false, enabled = true } = {}) {
  if (paused || hidden || !Number.isFinite(dt) || dt <= 0) return previous;
  const s = { ...previous, clock: previous.clock + dt, cool: Math.max(0, previous.cool - dt), sum: previous.sum + dt, count: previous.count + 1 };
  if (s.count < 90) return s;
  // Round sub-nanosecond accumulation noise before strict boundary comparisons.
  s.averageMs = Math.round(s.sum / s.count * 1e12) / 1e9; s.sum = 0; s.count = 0;
  const failedProbe = s.averageMs > 24 && s.clock - s.lastRaise < 6;
  if (!enabled || (s.cool > 0 && !failedProbe)) return s;
  if (s.averageMs > 24 && s.step < 3) {
    if (s.clock - s.lastRaise < 6) s.probeWait = Math.min(90, s.probeWait * 2);
    s.step++; s.cool = s.probeWait; s.lastRaise = -99;
  } else if (s.averageMs < 18.5 && s.step > 0) {
    s.step--; s.cool = 6; s.lastRaise = s.clock;
  }
  return s;
}
