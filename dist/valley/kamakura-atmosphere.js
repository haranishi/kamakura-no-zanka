// Pure settings. Directions are [east, up, south]; colors stay sRGB hex strings.
export const KAMAKURA_TIMES = {
  noon: {
    sunDir: [.08, .8480480962, .523803], sunColor: '#fff1d6', sunIntensity: 2.8,
    zenith: '#5a86c0', mid: '#a4c3df', horizon: '#cfe0ea', below: '#829389',
    fogColor: '#cfe0ea', hazeCool: '#cfe0ea', hazeWarm: '#e0e6e7', hazeExp: 4,
    fogDensity: .0001, mist: { density: .00004, base: -4, falloff: .045 },
    hemiSky: '#c3dcf2', hemiGround: '#75825b', hemiIntensity: 1.2,
    envIntensity: .7, fillColor: '#d0e1f2', fillIntensity: .3, exposure: 1,
  },
  morning: {
    sunDir: [.837319, .4226182617, .346829], sunColor: '#ffe6bf', sunIntensity: 2.6,
    zenith: '#648bb9', mid: '#adc5dc', horizon: '#d1e0ea', below: '#7e9085',
    fogColor: '#c4d8e8', hazeCool: '#c4d8e8', hazeWarm: '#e9ddd0', hazeExp: 5,
    fogDensity: .00012, mist: { density: .00006, base: -4, falloff: .045 },
    hemiSky: '#b6cfe6', hemiGround: '#707b58', hemiIntensity: 1,
    envIntensity: .7, fillColor: '#b9cfe7', fillIntensity: .35, exposure: 1,
  },
  // All evening colors/light values come from the unchanged valley ATMOS.
  evening: { fogDensity: .0001, mist: { density: .00005, base: -4, falloff: .045 } },
};
export function atmosphereOptions(search) {
  const q = new URLSearchParams(search), requested = q.get('time');
  return { enabled: q.get('atmos') !== '0', time: Object.hasOwn(KAMAKURA_TIMES, requested) ? requested : 'noon' };
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
export function kamakuraAtmosphere(time, evening) {
  const preset = Object.hasOwn(KAMAKURA_TIMES, time) ? KAMAKURA_TIMES[time] : KAMAKURA_TIMES.noon;
  const a = { ...evening, ...preset, sunDir: [...(preset.sunDir || evening.sunDir)], mist: { ...preset.mist } };
  validateAtmosphere(a);
  const length = Math.hypot(...a.sunDir); a.sunDir = a.sunDir.map(v => v / length);
  return a;
}
