// W2c-12 light7: no shade grade -> restrained .15 cooling (URL can sweep 0–1).
// Pure settings. Directions are [east, up, south]; colors stay sRGB hex strings.
export const KAMAKURA_TIMES = {
  noon: {
    postExposure: 1, postBloom: .12, postGlare: .7, postWarmth: .008, postToe: .6, postShade: .15,
    sunDir: [.08, .8480480962, .523803], sunColor: '#fff1d6', sunIntensity: 2.8,
    zenith: '#5a86c0', mid: '#a4c3df', horizon: '#cfe0ea', below: '#829389',
    fogColor: '#cfe0ea', hazeCool: '#cfe0ea', hazeWarm: '#e0e6e7', hazeExp: 4,
    fogDensity: .0001, mist: { density: .00004, base: -4, falloff: .045 },
    hemiSky: '#c3dcf2', hemiGround: '#75825b', hemiIntensity: 1.2,
    envIntensity: .7, fillColor: '#d0e1f2', fillIntensity: .3, exposure: 1,
  },
  morning: {
    postExposure: 1.04, postBloom: .15, postGlare: .85, postWarmth: .012, postToe: .6, postShade: .15,
    sunDir: [.837319, .4226182617, .346829], sunColor: '#ffe6bf', sunIntensity: 2.6,
    zenith: '#648bb9', mid: '#adc5dc', horizon: '#d1e0ea', below: '#7e9085',
    fogColor: '#c4d8e8', hazeCool: '#c4d8e8', hazeWarm: '#e9ddd0', hazeExp: 5,
    fogDensity: .00012, mist: { density: .00006, base: -4, falloff: .045 },
    hemiSky: '#b6cfe6', hemiGround: '#707b58', hemiIntensity: 1,
    envIntensity: .7, fillColor: '#b9cfe7', fillIntensity: .35, exposure: 1,
  },
  golden: {
    // Tuned after a blind comparison with noon (10 fixed views, 2026-11-10): golden won 7, and lost where the far hills turned ochre
    // and the shade sank to olive black. So the distant haze stays a cool blue-grey and only the haze near the sun is warm (hazeExp 9),
    // and the shade takes more of the sky's blue (hemi/fill up, the dark offset of the tone map down).
    postExposure: 1.06, postBloom: .16, postGlare: .95, postWarmth: .016, postToe: .6, postShade: .22,
    sunDir: [-0.8008814546671346, 0.3704076727835497, 0.4705178546169415], sunColor: '#ffd9a6', sunIntensity: 3.3,
    zenith: '#4f7fbd', mid: '#a9c0d8', horizon: '#ecdcc8', below: '#868f88',
    fogColor: '#b7c6d8', hazeCool: '#a9bcd6', hazeWarm: '#f3d2a2', hazeExp: 9,
    fogDensity: .00011, mist: { density: .00006, base: -4, falloff: .045 },
    hemiSky: '#b2c7ee', hemiGround: '#7d7c5e', hemiIntensity: 1.28,
    envIntensity: .7, fillColor: '#b3c5ea', fillIntensity: .52, exposure: 1,
  },
  // All evening colors/light values come from the unchanged valley ATMOS.
  // postToe 1 = three.js's Neutral as shipped: a blind A/B (11/8) kept the evening's warmth only with the full dark offset.
  evening: { postExposure: 1.12, postBloom: .18, postGlare: 1, postWarmth: .018, postToe: 1, postShade: .15, fogDensity: .0001, mist: { density: .00005, base: -4, falloff: .045 } },
};
// The time of day when the address names none. Golden hour was preferred to noon in 7 of 10 views by a reviewer who was not told
// which was which, and the owner chose it (2026-11-10). `&time=noon` gives the former default.
export const DEFAULT_TIME = 'golden';
export function atmosphereOptions(search) {
  const q = new URLSearchParams(search), requested = q.get('time');
  return { enabled: q.get('atmos') !== '0', time: Object.hasOwn(KAMAKURA_TIMES, requested) ? requested : DEFAULT_TIME };
}
export function atmospherePolicy(quality = 'standard', enabled = true) {
  return { shadows: enabled, shadowSize: enabled ? (quality === 'light' ? 2048 : 4096) : 0,
    standShadows: enabled && quality !== 'light', shadowExtent: 46 };
}
export function validateAtmosphere(a) {
  for (const key of ['sunColor', 'zenith', 'mid', 'horizon', 'below', 'fogColor', 'hazeCool', 'hazeWarm', 'hemiSky', 'hemiGround', 'fillColor']) {
    if (!/^#[0-9a-f]{6}$/i.test(a[key])) throw new RangeError(`atmosphere color: ${key}`);
  }
  if (!Array.isArray(a.sunDir) || a.sunDir.length !== 3 || !a.sunDir.every(Number.isFinite) || !(a.sunDir[1] > 0) || Math.hypot(...a.sunDir) < 1e-6 || Math.hypot(a.sunDir[0], a.sunDir[2]) < 1e-6) throw new RangeError('atmosphere direction');
  for (const key of ['sunIntensity', 'hemiIntensity', 'envIntensity', 'fillIntensity', 'hazeExp', 'exposure']) {
    if (!Number.isFinite(a[key]) || a[key] < 0 || a[key] > 32) throw new RangeError(`atmosphere value: ${key}`);
  }
  if (!(a.fogDensity >= .00008 && a.fogDensity <= .00012)) throw new RangeError('atmosphere fog');
  if (!a.mist || !Number.isFinite(a.mist.base) || !(a.mist.density >= 0 && a.mist.density <= .0001) || !(a.mist.falloff > 0 && a.mist.falloff <= 1)) throw new RangeError('atmosphere mist');
  return a;
}
// W2c-9r1 light: dark green evening -> orange sun / blue-violet shade.
export const EVENING_LIGHT = Object.freeze({
  // Retain the shared golden sun hue: sea shaders also read this pure preset.
  sunIntensity: 4.1,
  hemiSky: '#acb4da', hemiGround: '#77748c', hemiIntensity: 1.15,
  fillColor: '#aeb8df', fillIntensity: .45,
  hazeCool: '#a1a9c2', hazeWarm: '#f0b77f', fogColor: '#a1a9c2',
});
export function eveningEnabled(search = '') { return new URLSearchParams(search).get('evening2') !== '0'; }
// Linear interpolation of sRGB settings at initialization only; caller owns the result.
export function eveningLight(base, strength = 1) {
  const t = Math.max(0, Math.min(1, strength)), out = { ...base };
  for (const key of Object.keys(EVENING_LIGHT)) {
    const next = EVENING_LIGHT[key];
    if (typeof next === 'number') out[key] = base[key] + (next - base[key]) * t;
    else {
      let color = '#';
      for (let i = 1; i < 7; i += 2) {
        const old = parseInt(base[key].slice(i, i + 2), 16);
        color += Math.round(old + (parseInt(next.slice(i, i + 2), 16) - old) * t).toString(16).padStart(2, '0');
      }
      out[key] = color;
    }
  }
  return out;
}
// Direction points from the surface toward the camera; sunDir points toward the sun.
// Pure, allocation-free public contract for the next grass pass (no transmission yet).
export function sunBacklight(dir, sunDir, strength = 1) {
  const length = Math.hypot(dir[0], dir[1], dir[2]) * Math.hypot(sunDir[0], sunDir[1], sunDir[2]);
  if (!(length > 0)) return 0;
  const facing = Math.max(0, -(dir[0]*sunDir[0]+dir[1]*sunDir[1]+dir[2]*sunDir[2])/length);
  return facing ** 4 * Math.max(0, Math.min(1, strength));
}
export function kamakuraAtmosphere(time, evening, enhanced = true, strength = 1) {
  const preset = Object.hasOwn(KAMAKURA_TIMES, time) ? KAMAKURA_TIMES[time] : KAMAKURA_TIMES.noon;
  const a = { ...evening, ...preset, sunDir: [...(preset.sunDir || evening.sunDir)], mist: { ...preset.mist } };
  if (time === 'evening' && enhanced) Object.assign(a, eveningLight(a, strength));
  validateAtmosphere(a);
  const length = Math.hypot(...a.sunDir); a.sunDir = a.sunDir.map(v => v / length);
  return a;
}
