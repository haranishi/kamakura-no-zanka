import { isEveningLike } from './kamakura-atmosphere.js';
// W2c-9f: pure post policy; defaults are provisional until parent GPU comparisons.
// toe: share of Neutral tone mapping's dark offset (x-6.25x^2, up to .04) that is kept. 1 = three.js as shipped. The offset strips the
// smallest channel from every dark colour, so shade turns dark, green and over-saturated (screen HSV saturation .83 in the grass views).
export const POST_DEFAULTS = Object.freeze({ tone: 'neutral', threshold: 1.05, saturation: .98, contrast: 1.025, vignette: .10, toe: .6 });
// null = not given on the URL: the time-of-day preset (params.postToe) decides, then POST_DEFAULTS.toe.
const toeOption = value => { const n = value === null || value === '' ? NaN : +value; return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null; };
export function postOptions(search = '') {
  const q = new URLSearchParams(search), tone = q.get('tone');
  return { tone: ['none', 'aces', 'neutral', 'agx'].includes(tone) ? tone : POST_DEFAULTS.tone,
    post: q.get('post') !== '0', bloom: q.get('bloom') !== '0', glare: q.get('glare') !== '0',
    shafts: q.get('shafts') !== '0', cloud: q.get('cloud') !== '0', mist: q.get('mist') !== '0', cloudhigh: q.get('cloudhigh') !== '0',
    postdebug: ['depth', 'shafts', 'cloud', 'mist', 'valley'].includes(q.get('postdebug')) ? q.get('postdebug') : '', toe: toeOption(q.get('ptoe')) };
}
// A downgrade latches for this owner lifetime: no allocation/probe oscillation.
export function postRoute(quality, step, enabled, latched = false) {
  return enabled && quality !== 'light' && step < 2 && !latched;
}
export function bloomSizes(width, height) {
  return [2, 4, 8].map(d => [Math.max(1, Math.floor(width / d)), Math.max(1, Math.floor(height / d))]);
}
// View-space directional projection: translation cancels, no arbitrary sun distance.
export function projectSun(x, y, z, elevation, projectionX, projectionY, out) {
  out.x = .5; out.y = .5; out.strength = 0;
  if (!(z < -1e-6) || !(elevation > 0)) return out;
  const nx = x * projectionX / -z, ny = y * projectionY / -z;
  out.x = nx * .5 + .5; out.y = ny * .5 + .5;
  const edge = Math.max(Math.abs(nx), Math.abs(ny));
  out.strength = Math.max(0, Math.min(1, (1.25 - edge) / .25)) * Math.min(1, elevation / .035);
  return out;
}
// Neutral's achromatic transfer, matching the bundled Three chunk (not an RGB substitute).
export function neutralGray(value, exposure = 1, toe = 1) {
  const x = Math.max(0, value * exposure), offset = (x < .08 ? x - 6.25 * x * x : .04) * toe;
  const peak = x - offset;
  return peak < .76 ? peak : 1 - .24 * .24 / (peak + .24 - .76);
}
// W2c-10 grade: the bundled three.js Neutral operator with a scaled dark offset. Idempotent (re-patching a patched chunk just changes the factor).
export function neutralToneChunk(chunk, toe = POST_DEFAULTS.toe) {
  if (!/vec3 NeutralToneMapping\( vec3 color \)/.test(chunk)) throw new Error('NeutralToneMapping missing from the tone mapping chunk');
  const factor = Math.max(0, Math.min(1, toe)).toFixed(4), pattern = /color -= offset( \* [0-9.]+)?;/;
  if (!pattern.test(chunk)) throw new Error('Neutral tone mapping offset line missing');
  return chunk.replace(pattern, `color -= offset * ${factor};`);
}
export function postMemory(width, height) {
  const levels = bloomSizes(width, height), lowPixels = levels.reduce((n, [w, h]) => n + w * h, 0) + levels[0][0] * levels[0][1];
  // RGBA16F resolve + 4x color + 4x depth + resolved depth (depth estimated 4B).
  return { width, height, levels, bytes: width * height * 60 + lowPixels * 8 };
}

// W2c-9r1 light: unbounded threshold excess -> monotonic shoulder (linear HDR).
export function bloomLift(brightness, threshold = POST_DEFAULTS.threshold, cap = .9) {
  const excess = Math.max(0, brightness - threshold);
  return cap > 0 ? cap * (excess / (cap + excess)) : 0;
}
export function bloomCap(search = '') {
  const q = new URLSearchParams(search);
  return q.get('evening2') === '0' ? 0 : isEveningLike(q.get('time')) ? .65 : .9;
}

// W2c-12 light7: unchanged black/green shade -> luminance-preserving cooling and dusk floor.
export function shadeSettings(search = '', params = {}) {
  const q = new URLSearchParams(search), enabled = q.get('light7') !== '0';
  return { strength: enabled ? (toeOption(q.get('pshade')) ?? params.postShade ?? .15) : 0,
    floor: enabled && isEveningLike(q.get('time')) ? .0068 : 0,
    evening: isEveningLike(q.get('time')) };
}
const shadeWeight = l => { const t = Math.max(0, Math.min(1, l / .12)); return 1 - t*t*(3-2*t); };
// Linear display RGB after grading. Cooling moves red/blue toward neutral, never away;
// the green compensation preserves luminance. No saturation boost, including gray/blue inputs.
export function shadeColor(r, g, b, settings, out) {
  const l = .2126*r + .7152*g + .0722*b, w = shadeWeight(l)*settings.strength;
  const dr = -Math.min(r*(settings.evening ? .01 : .02), Math.max(0,r-l))*w;
  const db = Math.min(b*.03, Math.max(0,l-b))*w;
  // Gate the floor by the brightest channel so dark saturated foliage is not
  // lifted as a whole. 1.5*floor keeps the gray transfer monotonic (max slope 1).
  const peak = Math.max(r,g,b), knee = Math.max(.000001,settings.floor*1.5);
  const t = Math.max(0,Math.min(1,peak/knee));
  const lift = settings.floor*(1-t*t*(3-2*t));
  // Dusk floor follows the blue-violet hemisphere (#acb4da), normalized peak 1.
  out[0] = r+dr+lift*.9; out[1] = g-(.2126*dr+.0722*db)/.7152+lift*.94; out[2] = b+db+lift;
  return out;
}
export const SHADE_GLSL = `
vec3 kzShade(vec3 c, float strength, float duskFloor, float dusk) {
  float lum = dot(c,vec3(.2126,.7152,.0722));
  float weight = 1.-smoothstep(0.,.12,lum);
  float redDelta = -min(c.r*mix(.02,.01,dusk),max(0.,c.r-lum))*weight*strength;
  float blueDelta = min(c.b*.03,max(0.,lum-c.b))*weight*strength;
  float peak=max(c.r,max(c.g,c.b));
  c += vec3(redDelta,-(.2126*redDelta+.0722*blueDelta)/.7152,blueDelta);
  float floorWeight=1.-smoothstep(0.,max(.000001,duskFloor*1.5),peak);
  return c+vec3(.9,.94,1.)*duskFloor*floorWeight;
}`;
