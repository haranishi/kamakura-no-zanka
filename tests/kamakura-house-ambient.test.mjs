import test from 'node:test';
import assert from 'node:assert/strict';
import { THREE, loadHouseMaterials } from './helpers/kamakura-house-view.mjs';
import { source } from './helpers/tree-modules.mjs';
import { HOUSE_AMBIENT, houseAmbientEnabled } from '../dist/valley/kamakura-house-texture.js';

// W2c-10 harmony. Measured in the real game atmosphere (tools/w2c_ambient_probe.mjs): a grey wall facing away from the sun was 2.5x
// brighter as MeshStandardMaterial than as the terrain's MeshLambertMaterial, because only Standard took the PMREM environment light.
// Three r180 ignores material.envMapIntensity unless the material has its own envMap (it uses scene.environmentIntensity otherwise).
test('house ambient: an own envMap with a small intensity replaces the default 0.7 environment light; opt-out leaves the material alone', async () => {
  const { createHouseMaterial } = await loadHouseMaterials();
  const environment = new THREE.Texture(), base = new THREE.MeshStandardMaterial();
  const on = createHouseMaterial(base, { parts: true, environment });
  assert.equal(on.envMap, environment); assert.equal(on.envMapIntensity, HOUSE_AMBIENT.envIntensity);
  assert(HOUSE_AMBIENT.envIntensity > 0 && HOUSE_AMBIENT.envIntensity <= .2, 'a little sky fill, never the 0.7 default');
  const off = createHouseMaterial(base, { parts: true, environment, search: '?henv=0' });
  assert.equal(off.envMap, null); assert.equal(off.envMapIntensity, 1);
  const none = createHouseMaterial(base, { parts: true });
  assert.equal(none.envMap, null);
  assert.notEqual(on.customProgramCacheKey(), none.customProgramCacheKey(), 'the envMap changes the shader variant');
  assert.equal(on.userData.houseUniforms.houseGain.value, HOUSE_AMBIENT.gain);
  assert.equal(createHouseMaterial(base, { parts: true, environment, facilityRole: 2 }).userData.houseUniforms.houseGain.value, HOUSE_AMBIENT.facilityGain);
  assert.equal(createHouseMaterial(base, { parts: true, environment, search: '?hgain=1.2' }).userData.houseUniforms.houseGain.value, 1.2);
  assert.equal(off.userData.houseUniforms.houseGain.value, 1, 'no gain without the ambient match');
  for (const m of [on, off, none]) m.dispose();
});
test('house ambient: gains keep the sunlit brightness (1/0.67) for houses and barely lift the white halls; flag parsing', () => {
  assert(HOUSE_AMBIENT.gain >= 1.3 && HOUSE_AMBIENT.gain <= 1.7);
  assert(HOUSE_AMBIENT.facilityGain >= 1 && HOUSE_AMBIENT.facilityGain < HOUSE_AMBIENT.gain);
  assert(HOUSE_AMBIENT.heroEnvIntensity > HOUSE_AMBIENT.envIntensity && HOUSE_AMBIENT.heroEnvIntensity <= .35, 'the hero keeps a little more fill so it stays readable in shade');
  assert.equal(houseAmbientEnabled(''), true); assert.equal(houseAmbientEnabled('?henv=0'), false);
});
test('house ambient: the views hand scene.environment to the materials and the boot calibrates the hero once', () => {
  assert(/environment: scene\.environment/.test(source('kamakura-house-view.js')));
  assert(/environment:scene\.environment/.test(source('kamakura-facility-view.js')));
  const boot = source('world-kamakura.js');
  assert.equal((boot.match(/houseAmbientEnabled\(search\)/g) || []).length, 1);
  assert(/m\.envMap = scene\.environment; m\.envMapIntensity = HOUSE_AMBIENT\.heroEnvIntensity/.test(boot));
  assert(boot.indexOf('houseAmbientEnabled(search)') > boot.indexOf('loadRoster'), 'after the roster exists');
});
