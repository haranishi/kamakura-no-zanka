import assert from 'node:assert/strict';
import { kamakuraAtmosphere, validateAtmosphere, atmospherePolicy } from '../../dist/valley/kamakura-atmosphere.js';
import { load } from '../../tests/helpers/tree-modules.mjs';
// Settings are public hand-authored constants. No private geographical numbers are persisted.
export async function verifyAtmosphere() {
  const { ATMOS } = await load('atmosphere.js'), original = JSON.stringify(ATMOS);
  const presets = {};
  for (const time of ['noon', 'morning', 'evening']) {
    const a = kamakuraAtmosphere(time, { ...ATMOS, sunDir: ATMOS.sunDir.toArray() });
    validateAtmosphere(a); assert(Math.abs(Math.hypot(...a.sunDir) - 1) < 1e-12);
    const elevation = Math.asin(a.sunDir[1]) * 180 / Math.PI;
    if (time === 'noon') assert(elevation >= 55 && elevation <= 60 && a.sunDir[2] > 0 && Math.abs(a.sunDir[0]) < .1);
    if (time === 'morning') assert(elevation >= 24 && elevation <= 26 && a.sunDir[0] > a.sunDir[2] && a.sunDir[2] > 0);
    presets[time] = { elevation, fogDensity: a.fogDensity, mistDensity: a.mist.density, sunColor: a.sunColor, zenith: a.zenith };
  }
  assert.equal(JSON.stringify(ATMOS), original);
  return { presets, standard: atmospherePolicy(), light: atmospherePolicy('light'),
    scope: '設定と同梱Threeオブジェクトの検査。GPU描画・GLSLコンパイル・性能測定ではない' };
}
