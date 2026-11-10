// kamakura-time-switch.js — W2c-16: change the time of day from the screen, staying where you stand.
// Why a reload: the sky, the fog chunks, the light and the tone map are all baked for one time when the world boots (see
// kamakura-atmosphere-view.js). Rebuilding them in place would touch every material; reloading with the same place and heading is cheap
// and keeps one code path. Pure: builds the next URL query only.
import { KAMAKURA_TIMES, atmosphereOptions } from './kamakura-atmosphere.js';

export const TIME_ORDER = Object.freeze(['morning', 'noon', 'golden', 'evening'].filter(name => Object.hasOwn(KAMAKURA_TIMES, name)));
export const TIME_LABEL = Object.freeze({ morning: '朝', noon: '昼', golden: '夕方前', evening: '夕方' });
export function currentTime(search = '') { return atmosphereOptions(search).time; }
export function nextTime(time) { return TIME_ORDER[(TIME_ORDER.indexOf(time) + 1) % TIME_ORDER.length]; }
export function timeButtonText(search = '') { return `時刻：${TIME_LABEL[currentTime(search)]}`; }
// The query for the next time of day at the same place. pos is { x east, z south }; yaw is the internal heading in radians
// (the URL takes degrees clockwise from north, which is -yaw). Every other parameter is kept as it is.
export function timeSwitchSearch(search = '', pos, yaw) {
  const params = new URLSearchParams(search);
  params.set('time', nextTime(currentTime(search)));
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.z)) params.set('pos', `${pos.x.toFixed(1)},${(0 - pos.z).toFixed(1)}`);
  if (Number.isFinite(yaw)) params.set('yaw', (((-yaw * 180 / Math.PI) % 360 + 360) % 360).toFixed(0));
  // Commas stay readable (the spawn parser splits on a literal comma either way).
  return '?' + params.toString().replace(/%2C/g, ',');
}
