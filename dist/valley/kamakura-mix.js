// R10 tuning surface. Gains are linear; targets are post-limiter dBFS for parent calibration.
const freeze = o => { for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v); return Object.freeze(o); };
export const MIX = freeze({
  buses: { ambience: 1, steps: 1, life: 1 },
  targets: { stepMarginDb: 10, walkPeak: [-14, -8], runPeak: [-11, -5], riverRms: [-36, -31], windRms: [-44, -38], peakDb: -1 },
  steps: { ceiling: .9, walkCeiling: .52, walk: .90, run: 1.45, crouch: .28, legacyGain: 3.0, body: .14, sand: .18, rustle: .40, splash: .44, drop: .050, leaf: .055, detail: .35 },
  // rates: grains per second in each loop (two loops of different length play together, so the stream holds about 48 grains a second).
  river: { gain: 2.0, floor: .03, scale: 14, power: 2.2, reach: 300, nearHz: 6200, farHz: 800, rates: [26, 22], seconds: [8.13, 12.37], seeds: [0x72697631, 0x72697632] },
  // boost: how much the foliage hiss rises at the crest of a gust (x3.2, about +10 dB). At 5.2 a meadow gust reached -26 dBFS, louder
  // than the river bank (measured). seconds: noise loops shorter than a few seconds are heard as a repeating flutter.
  wind: { floor: .06, floorBoost: 1.8, meadow: .020, forest: .026, boost: 2.2, meadowHz: [2600, 1500], forestHz: [1400, 1300], q: 1.2, seconds: { air: 5.3, leaves: 6.7, swell: 7.3, foam: 9.1 } },
  sea: { gain: .5, scale: 60, power: 1.6, reach: 600 },
  smoothing: .3, panMax: .7, probe: 4,
  duck: { maxDb: 6, attack: .012, hold: .100, release: .160, quiet: .15, loud: .65 }
});
const clamp = x => Math.max(0, Math.min(1, x));
export const dbGain = db => 10 ** (db / 20);
export function waterNear(distance, kind = 'river') {
  const p = MIX[kind];
  if (!Number.isFinite(distance) || distance > p.reach) return 0;
  // Smoothly close the final quarter of the hearing radius.
  const fade = clamp((p.reach - Math.max(0, distance)) / (p.reach * .25));
  return fade * fade * (3 - 2 * fade) / (1 + (Math.max(0, distance) / p.scale) ** p.power);
}
export function riverBrightness(distance) { return MIX.river.farHz + (MIX.river.nearHz - MIX.river.farHz) * Math.sqrt(waterNear(distance)); }
export function windGain(level, kind = 'meadow') {
  return MIX.wind[kind] * (1 + MIX.wind.boost * clamp((level - .32) / .68));
}
// Negative distance gradient points to the water. North-facing listener's right is east.
export function waterPan(east, west, south, north, yaw, distance = 10) {
  if (![east, west, south, north, yaw, distance].every(Number.isFinite)) return 0;
  const dx = west - east, dz = north - south, length = Math.hypot(dx, dz);
  return length < 1e-6 ? 0 : MIX.panMax * Math.max(-1, Math.min(1, (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / length)) * clamp(distance / MIX.probe);
}
export function duckDepth(river, sea) {
  const loudness = Math.max(waterNear(river), waterNear(sea, 'sea'));
  return MIX.duck.maxDb * clamp((loudness - MIX.duck.quiet) / (MIX.duck.loud - MIX.duck.quiet));
}
export function duckPlan(time, depthDb) {
  const d = MIX.duck;
  return { gain: dbGain(-Math.max(0, Math.min(d.maxDb, depthDb))), attack: time + d.attack, hold: time + d.attack + d.hold, end: time + d.attack + d.hold + d.release };
}
// Evaluate our last automation, including an interrupted attack/release, without reading AudioParam.value.
export function duckAt(time, start, from, target, attack, hold, end) {
  if (time <= start) return from;
  if (time < attack) return from + (target - from) * (time - start) / (attack - start);
  if (time <= hold) return target;
  if (time < end) return target + (1 - target) * (time - hold) / (end - hold);
  return 1;
}
