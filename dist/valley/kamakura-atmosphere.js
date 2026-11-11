import { shoreNoise } from './kamakura-shore.js';
// Low-cloud controls: degrees, seconds and linear colour shares; no new colour palette.
export const CLOUDS2 = Object.freeze({
  heightsDeg: Object.freeze([.95, 2.65, 4.9, 7.7]), // degrees: irregular centres; two remain inside the lowest four degrees.
  widthsDeg: Object.freeze([.63, .8, 1.05, 1.3]), // degrees: each layer's half thickness.
  minDeg: .55, maxDeg: 9, featherDeg: .18, // degrees: altitude envelope and its feather.
  bendDeg: .7, bendScale: .43, coreShare: .45, // degrees of wandering / low-frequency scale / solid-core share.
  noiseOffset: Object.freeze([19.3,7.1]), // noise-cell offsets: independent shapes per cloud layer.
  alongDeg: 20, driftDegS: .018, // degrees/cell; degrees/s: thickness noise scale and drift (1.08° per minute).
  thicknessMin: .25, thicknessMax: 1.9, thicknessLow: .25, thicknessHigh: .75, // thickness ratios and noise remapping endpoints.
  gapLow: .4, gapHigh: .54, // noise thresholds: complete gaps, then solid masses.
  topNoiseDeg: 3.2, topBumpDeg: .28, bottomShare: .45, topShare: 1.55, bottomFeatherDeg: .09, // degrees/cell; upper relief; half-width shares; sharp lower edge.
  opacity: .92, // optical coverage.
  shadeMix: .64, shadeGain: .6, warmGain: .9, rimGain: .85, // existing mid/fog/sun colour shares and gains.
  reducedLayers: 2, minimumLayers: 1, // layer count in light/adapt 2, then adapt 3.
  sunWidthDeg: 40, eveningGain: .42, reducedGain: .7, // degrees of warm rim / evening and reduced-quality strength.
});
export const clouds2Enabled = (search='', time=atmosphereOptions(search).time) => isEveningLike(time) && new URLSearchParams(search).get('clouds2') !== '0';
const cloudClamp = x => Math.max(0, Math.min(1, x));
const cloudSmooth = (a,b,x) => { const t=cloudClamp((x-a)/(b-a)); return t*t*(3-2*t); };
const cf = n => Number(n).toFixed(8);
// Shared scalar shape and coverage bodies: CPU and GLSL differ only in their numeric type spelling.
const cloudShape = `
  float cloudAngle=radians(bearing-time*${cf(CLOUDS2.driftDegS)});
  float cloudX=cos(cloudAngle)*${cf(180/Math.PI/CLOUDS2.alongDeg)}+layer*${cf(CLOUDS2.noiseOffset[0])};
  float cloudZ=sin(cloudAngle)*${cf(180/Math.PI/CLOUDS2.alongDeg)}+layer*${cf(CLOUDS2.noiseOffset[1])};
  float cloudNoise=cloudNoise2(cloudX,cloudZ);
  float cloudThickness=${cf(CLOUDS2.thicknessMin)}+${cf(CLOUDS2.thicknessMax-CLOUDS2.thicknessMin)}*smoothstep(${cf(CLOUDS2.thicknessLow)},${cf(CLOUDS2.thicknessHigh)},cloudNoise);
  float cloudCentre=centre+(cloudNoise2(cloudX*${cf(CLOUDS2.bendScale)},cloudZ*${cf(CLOUDS2.bendScale)})*2.0-1.0)*${cf(CLOUDS2.bendDeg)};
  float cloudFine=cloudNoise2(cos(cloudAngle)*${cf(180/Math.PI/CLOUDS2.topNoiseDeg)}+layer*${cf(CLOUDS2.noiseOffset[1])},sin(cloudAngle)*${cf(180/Math.PI/CLOUDS2.topNoiseDeg)}+layer*${cf(CLOUDS2.noiseOffset[0])});
  float cloudBottom=max(${cf(CLOUDS2.minDeg)},cloudCentre-width*cloudThickness*${cf(CLOUDS2.bottomShare)});
  float cloudTop=max(cloudBottom+${cf(CLOUDS2.bottomFeatherDeg)},cloudCentre+width*cloudThickness*${cf(CLOUDS2.topShare)}+cloudFine*${cf(CLOUDS2.topBumpDeg)});
  float cloudGate=smoothstep(${cf(CLOUDS2.gapLow)},${cf(CLOUDS2.gapHigh)},cloudNoise);
`;
const cloudLayerBody = `${cloudShape}
  float cloudBand=smoothstep(cloudBottom,cloudBottom+${cf(CLOUDS2.bottomFeatherDeg)},height)*(1.0-smoothstep(cloudTop-width*cloudThickness*${cf(1-CLOUDS2.coreShare)},cloudTop,height))*cloudGate;
  float cloudEdge=cloudBand*(1.0-smoothstep(cloudBottom+${cf(CLOUDS2.bottomFeatherDeg)},cloudBottom+${cf(CLOUDS2.featherDeg*2)},height));
  return rimOnly>0.5?cloudEdge:cloudBand;`;
const cloudBody = CLOUDS2.heightsDeg.map((h,i) => `if(cloudLayers>${cf(i+.5)}){
  float cloudBand=cloudLayer2(bearing,height,time,${cf(i)},${cf(h)},${cf(CLOUDS2.widthsDeg[i])},0.0);
  if(cloudBand>cloudCover){cloudCover=cloudBand;cloudEdge=cloudLayer2(bearing,height,time,${cf(i)},${cf(h)},${cf(CLOUDS2.widthsDeg[i])},1.0);}
}`).join('\n');
const cloudEnvelope = `float cloudEnvelope=smoothstep(${cf(CLOUDS2.minDeg)},${cf(CLOUDS2.minDeg+CLOUDS2.bottomFeatherDeg)},height)*(1.0-smoothstep(${cf(CLOUDS2.maxDeg-CLOUDS2.featherDeg)},${cf(CLOUDS2.maxDeg)},height));return (rimOnly>0.5?cloudEdge:cloudCover)*cloudEnvelope;`;
const cloudMath = ['cloudNoise2','smoothstep','max','cos','sin','radians'];
const cloudArgs = [shoreNoise,cloudSmooth,Math.max,Math.cos,Math.sin,x=>x*Math.PI/180];
const layerSample=Function(...cloudMath,`return function(bearing,height,time,layer,centre,width,rimOnly){${cloudLayerBody.replace(/float /g,'let ')}}`)(...cloudArgs);
export const cloudLayerProfile=Function(...cloudMath,`return function(bearing,time,layer){let centre=${JSON.stringify(CLOUDS2.heightsDeg)}[layer],width=${JSON.stringify(CLOUDS2.widthsDeg)}[layer];${cloudShape.replace(/float /g,'let ')}return {thickness:cloudThickness,bottom:cloudBottom,top:cloudTop,gate:cloudGate,centre:cloudCentre};}`)(...cloudArgs);
export const cloudCoverage=Function('cloudLayer2','smoothstep',`return function(bearing,height,time=0,cloudLayers=${CLOUDS2.heightsDeg.length},rimOnly=0){let cloudCover=0,cloudEdge=0;if(height<=${cf(CLOUDS2.minDeg)}||height>=${cf(CLOUDS2.maxDeg)})return 0;${(cloudBody+cloudEnvelope).replace(/float /g,'let ')}}`)(layerSample,cloudSmooth);
export const CLOUDS2_GLSL = `
float cloudNoise2(float x,float z){return noise(vec2(x,z));}
float cloudLayer2(float bearing,float height,float time,float layer,float centre,float width,float rimOnly){${cloudLayerBody}}
float cloudCoverage2(float bearing,float height,float time,float cloudLayers,float rimOnly){float cloudCover=0.0,cloudEdge=0.0;if(height<=${cf(CLOUDS2.minDeg)}||height>=${cf(CLOUDS2.maxDeg)})return 0.0;${cloudBody}${cloudEnvelope}}
`;
export const cloudWarmth = separationDeg => 1-cloudSmooth(0,CLOUDS2.sunWidthDeg,Math.abs(separationDeg));
export const DUSK_LEGACY = Object.freeze({postMist:.75,postShade:.22,mist:Object.freeze({density:.00007,base:-4,falloff:.045})});
// Only the new dusk air is reversible; all other presets retain their original values.
export const DUSK_AIR = Object.freeze({
  shadeFloor: .013, // linear RGB: blue-violet floor for almost black surfaces.
  mistNearM: 35, mistFullM: 220, mistScaleM: 125, mistWarmBase: .04, // metres of distance ramp / wisp size / warm share away from sun.
});
export function duskAirEnabled(search='') { const q=new URLSearchParams(search);return q.get('time')==='dusk'&&q.get('duskair')!=='0'; }

// W2c-12 light7: no shade grade -> restrained .15 cooling (URL can sweep 0–1).
// Pure settings. Directions are [east, up, south]; colors stay sRGB hex strings.
// Dusk tuning: colors are sRGB; intensities/exposure are multipliers, mist heights are metres.
export const DUSK = Object.freeze({
  postMist: 1.15, postExposure: 1.24, postBloom: .18, postGlare: 1, postWarmth: .006, postToe: .35, postShade: .38,
  sunDir: Object.freeze([-0.9345448863, 0.1045284633, 0.3401465212]), // bearing 250°, elevation 6°.
  // Against the concept, side by side: the whole right half of the frame was orange. The picture is blue-green and violet, and
  // only the sun and the fires are warm. The sun's light is weaker, and its warm haze keeps to a narrow cone around it.
  sunColor: '#ff9a66', sunIntensity: .85,
  // The camera of the opening scene sees only the lowest four degrees of sky: with an orange horizon the whole strip was orange.
  // The horizon is a dusty rose, and the orange stays near the sun (its halo and the warm haze towards it).
  zenith: '#262b52', mid: '#75628a', horizon: '#b9828a', below: '#484c65',
  fogColor: '#7f8fb8', hazeCool: '#7f8fb8', hazeWarm: '#d99a8c', hazeExp: 18,
  fogDensity: .000115, mist: Object.freeze({ density: .0001, base: 5, falloff: .075 }),
  // The low sun gives level ground almost nothing: with a dim sky light the road under the walker was black (real Chrome, the
  // real-size town). The sky light stays near the evening's; the trees are darkened on their own (foliage).
  hemiSky: '#929bc9', hemiGround: '#6a6f93', hemiIntensity: 1.2,
  envIntensity: .42, fillColor: '#929fcf', fillIntensity: .3, exposure: 1,
  // Leaves at dusk: darker and bluer than their daylight green (seen against the sun they stayed a bright olive).
  foliage: Object.freeze([.52, .68, .94]),
});
// Visible sun only: degrees, radiance multipliers, and radius ratio. No shadow-light changes.
export const SUN_DISC = Object.freeze({ diameterDeg: 1.15, haloRadius: 11, radiance: 3.2, haloGain: .85,
  edgeRad: .00015, seaStrength: 1, seaPower: 70, seaFloor: .3, seaDrift: .23, seaCellsM: .8,
  seaLow: .3, seaHigh: .85, seaReduced: .6 });
export const isEveningLike = time => time === 'evening' || time === 'dusk';
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
    // and the shade sank to olive black. So the distant haze stays a cool blue-grey and only the haze near the sun is warm,
    // and the shade takes more of the sky's blue (hemi/fill up, the dark offset of the tone map down).
    // 2026-11-11, against the designed Kamakura seen from the sea: the sun was too weak beside that fill, and the picture read
    // as overcast. The sun is stronger and a little more golden (3.3 -> 4.2), the warm haze reaches wider around it (hazeExp 9 -> 7),
    // and the grade is a touch warmer. The sky light in the shade stays as it was: lowering it made no visible gain in six shaded
    // views and risked the olive-black shade again.
    postExposure: 1.06, postBloom: .16, postGlare: .95, postWarmth: .028, postToe: .7, postShade: .22,
    sunDir: [-0.8008814546671346, 0.3704076727835497, 0.4705178546169415], sunColor: '#ffd08c', sunIntensity: 4.2,
    zenith: '#4f7fbd', mid: '#a9c0d8', horizon: '#ecdcc8', below: '#868f88',
    fogColor: '#b7c6d8', hazeCool: '#a9bcd6', hazeWarm: '#f4cf96', hazeExp: 7,
    fogDensity: .00011, mist: { density: .00006, base: -4, falloff: .045 },
    hemiSky: '#b2c7ee', hemiGround: '#7d7c5e', hemiIntensity: 1.28,
    envIntensity: .7, fillColor: '#b3c5ea', fillIntensity: .52, exposure: 1,
    // Seen in real Chrome (the designed Kamakura from the overlook): with the low sun the wooded hills, half of the frame, sank to
    // a dark olive mass while roofs and ground were lit. Leaf colours get this gain in the low sun (trees only; no other time).
    foliage: [1.6, 1.5, 1.05],
  },
  // All evening colors/light values come from the unchanged valley ATMOS.
  // postToe 1 = three.js's Neutral as shipped: a blind A/B (11/8) kept the evening's warmth only with the full dark offset.
  dusk: DUSK,
  evening: { postExposure: 1.12, postBloom: .18, postGlare: 1, postWarmth: .018, postToe: 1, postShade: .15, fogDensity: .0001, mist: { density: .00005, base: -4, falloff: .045 } },
};
// The time of day when the address names none. Golden hour was preferred to noon in 7 of 10 views by a reviewer who was not told
// which was which, and the owner chose it (2026-11-10). `&time=noon` gives the former default.
export const DEFAULT_TIME = 'golden';
export function atmosphereOptions(search) {
  const q = new URLSearchParams(search), requested = q.get('time');
  return { enabled: q.get('atmos') !== '0', time: Object.hasOwn(KAMAKURA_TIMES, requested) ? requested : DEFAULT_TIME };
}
// Resolve once before booting view/audio/layers; explicit URL values (even empty/unknown) retain precedence.
export function sceneSearch(meta, search = '') {
  if (meta?.time !== undefined && (typeof meta.time !== 'string' || !Object.hasOwn(KAMAKURA_TIMES, meta.time))) throw new RangeError('Invalid map time');
  const q = new URLSearchParams(search);
  if (q.has('time') || meta?.time === undefined) return search;
  q.set('time', meta.time);
  return '?' + q.toString();
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
  if (a.foliage !== undefined && !(Array.isArray(a.foliage) && a.foliage.length === 3 && a.foliage.every(v => Number.isFinite(v) && v >= .5 && v <= 2.5))) throw new RangeError('atmosphere foliage');
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
// A designed map is laid out after a picture, and the picture decides where its light comes from. Such a map may move the sun
// of every time of day: meta.sun.turn_deg turns it about the vertical (clockwise seen from above) and meta.sun.lift_deg raises
// or lowers it. `&sunturn=` and `&sunlift=` in the address override them (for tuning and captures).
export const SUN_PLACE = Object.freeze({ turnMax: 180, liftMax: 45, low: 4, high: 80 }); // degrees: limits of the two fields / of the resulting height
export function sunPlace(meta, search = '') {
  const sun = meta?.sun;
  if (sun !== undefined && (!sun || typeof sun !== 'object' || Array.isArray(sun) || Object.keys(sun).some(key => !['turn_deg', 'lift_deg', 'disc_deg'].includes(key)))) throw new RangeError('Invalid sun');
  const q = new URLSearchParams(search), place = {};
  for (const [field, name, max] of [['turn', 'turn_deg', SUN_PLACE.turnMax], ['lift', 'lift_deg', SUN_PLACE.liftMax]]) {
    const stored = sun && Object.hasOwn(sun, name) ? sun[name] : 0;
    if (!Number.isFinite(stored) || Math.abs(stored) > max) throw new RangeError('Invalid sun');
    const raw = q.get('sun' + field), asked = Number(raw);
    place[field] = raw !== null && raw !== '' && Number.isFinite(asked) && Math.abs(asked) <= max ? asked : stored;
  }
  if (sun && Object.hasOwn(sun, 'disc_deg')) {
    if (!Number.isFinite(sun.disc_deg) || sun.disc_deg < .5 || sun.disc_deg > 10) throw new RangeError('Invalid sun disc');
    place.disc = sun.disc_deg;
  }
  const rawDisc = q.get('sundisc'), disc = Number(rawDisc);
  if (rawDisc !== null && rawDisc !== '' && Number.isFinite(disc) && (disc === 0 || disc >= .5 && disc <= 10)) place.disc = disc;
  return place;
}
// Null keeps every former sky/water shader and direction intact. Zero explicitly hides disc/halo/path.
export function visualSun(time, dir, place = {}) {
  if (place.disc === undefined && time !== 'dusk') return null;
  const flat = Math.hypot(dir[0], dir[2]);
  const lift = (place.disc ?? Math.asin(dir[1]) * 180 / Math.PI) * Math.PI / 180;
  return { enabled: place.disc !== 0, dir: [dir[0] / flat * Math.cos(lift), Math.sin(lift), dir[2] / flat * Math.cos(lift)] };
}
// The presets' air is made for a map kilometres across: a hill 500 m away is as clear as one at arm's length. A small designed
// map may thicken it: meta.air.haze multiplies the haze that grows with distance, meta.air.mist the low mist near the ground
// (both 1 = as it is). `&airhaze=` and `&airmist=` in the address override them (for tuning and captures).
export const AIR = Object.freeze({ hazeMax: 20, mistMax: 40 }); // largest multipliers a map may ask for
export function airOf(meta, search = '') {
  const air = meta?.air;
  if (air !== undefined && (!air || typeof air !== 'object' || Array.isArray(air) || Object.keys(air).some(key => key !== 'haze' && key !== 'mist'))) throw new RangeError('Invalid air');
  const q = new URLSearchParams(search), out = {};
  for (const [name, max] of [['haze', AIR.hazeMax], ['mist', AIR.mistMax]]) {
    const stored = air && Object.hasOwn(air, name) ? air[name] : 1;
    if (!Number.isFinite(stored) || stored < 1 || stored > max) throw new RangeError('Invalid air');
    const raw = q.get('air' + name), asked = Number(raw);
    out[name] = raw !== null && raw !== '' && Number.isFinite(asked) && asked >= 0 && asked <= max ? asked : stored;
  }
  return out;
}
// dir is a unit [east, up, south]. A new unit array; no turn and no lift return the same numbers.
export function placeSun(dir, { turn = 0, lift = 0 } = {}) {
  if (!turn && !lift) return [dir[0], dir[1], dir[2]];
  const t = turn * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), flat = Math.hypot(dir[0], dir[2]);
  const height = Math.max(SUN_PLACE.low, Math.min(SUN_PLACE.high, Math.asin(Math.max(-1, Math.min(1, dir[1]))) * 180 / Math.PI + lift)) * Math.PI / 180;
  const k = Math.cos(height) / flat;
  return [(dir[0] * c - dir[2] * s) * k, Math.sin(height), (dir[2] * c + dir[0] * s) * k];
}
export function kamakuraAtmosphere(time, evening, enhanced = true, strength = 1, place = undefined, air = undefined) {
  const preset = Object.hasOwn(KAMAKURA_TIMES, time) ? KAMAKURA_TIMES[time] : KAMAKURA_TIMES.noon;
  const a = { ...evening, ...preset, sunDir: [...(preset.sunDir || evening.sunDir)], mist: { ...preset.mist } };
  if (time === 'evening' && enhanced) Object.assign(a, eveningLight(a, strength));
  if (time === 'dusk' && air?.legacyDusk) { Object.assign(a,DUSK_LEGACY,{mist:{...DUSK_LEGACY.mist}}); }
  validateAtmosphere(a);
  const length = Math.hypot(...a.sunDir); a.sunDir = placeSun(a.sunDir.map(v => v / length), place);
  // The map's air comes after the check: the presets keep their own narrow range.
  if (air) { a.fogDensity *= air.haze ?? 1; a.mist.density *= air.mist ?? 1; }
  return a;
}
