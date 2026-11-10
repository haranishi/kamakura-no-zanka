// Kamakura carry posture: result targets, in degrees/metres/radians. No view dependencies.
export const HERO_MOVE = Object.freeze({
  speed: Object.freeze([0, 1.35, 2.5, 5]), lean: Object.freeze([1, 3, 8, 13.5]),
  leanRange: Object.freeze([Object.freeze([-2, 4]), Object.freeze([1, 5]), Object.freeze([6, 10]), Object.freeze([11, 16])]),
  head: -3, headMax: 6, fadeSeconds: .22, wristStep: .032,
  rest: Object.freeze([.45, .6, .35]), fist: Object.freeze([1, 1.3, .7]),
  thumbRest: Object.freeze([.25, .2]), thumbFist: Object.freeze([.7, .55]),
});
export const moveClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function moveMix(a, b, t) { return a + (b - a) * moveClamp(t, 0, 1); }
export function moveSmooth(t) { t = moveClamp(t, 0, 1); return t * t * (3 - 2 * t); }
export function heroLean(speed) {
  const s = HERO_MOVE.speed, l = HERO_MOVE.lean;
  for (let i = 1; i < s.length; i++) if (speed <= s[i]) return moveMix(l[i - 1], l[i], moveSmooth((speed - s[i - 1]) / (s[i] - s[i - 1])));
  return l[3];
}
// Caller supplies the reusable result. Thigh phase is read from the existing motion, never a new clock.
export function heroMoveTarget(out, speed, thigh, acceleration, active, reduce) {
  const run = moveSmooth((speed - 1.35) / 1.15), amount = reduce ? .35 : 1;
  out.lean = 1 + (heroLean(speed) - 1) * amount + 1.2 * Math.tanh(acceleration / 10) * amount;
  out.head = HERO_MOVE.head; out.fist = run; out.active = !!active;
  out.arm = moveMix(-6, -35 + 24 * Math.tanh(thigh / 24) * amount, run);
  out.flex = moveMix(24, 84, run);
  return out;
}

// Stance targets are relative to the actual hip joint; no actor motion is changed.
export const HERO_STANCE = Object.freeze({
  pommelFwd: .195, pommelRight: -.035, pommelUp: .119, tipHeight: 1.307, breath: .008, period: 3.5,
  wristRight: .25, wristFwd: .025, wristUp: .035, pitch: -24, yaw: 12,
  enter: .25, exit: .12, stop: .30, wristStep: .043,
});
