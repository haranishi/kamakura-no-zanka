import test from 'node:test';
import assert from 'node:assert/strict';
import { vegPolicy, vegTrunkHandover, vegTrunkLod, vegTrunkWeights } from '../dist/valley/kamakura-veg.js';
import { uLodFor } from '../dist/valley/tree-lod.js';
import { load, THREE } from './helpers/tree-modules.mjs';
import { wind } from './helpers/tree-field.mjs';
const { buildKamakuraVeg } = await load('kamakura-veg-view.js');

// W2c-9r1 veg: a pale dithered ghost stood beside near pine trunks seen against the sky. The cause is the LOD pair: the near
// trunk bows (sin(t*PI) between its ends) while the middle trunk is one straight prism, and the shared window lets the
// middle trunk enter while the near trunk is still fully opaque. These tests pin the Kamakura-only handover.
for (const quality of ['standard', 'light']) {
  const policy = vegPolicy(quality), [a, b] = policy.lod, w = policy.blend;
  test(`${quality}: the middle trunk never shows beside a fully opaque near trunk (legacy window does)`, () => {
    let legacyGhost = 0, handoverGhost = 0;
    for (let d = 0; d <= a + 4 * w; d += .25) {
      const [nearOld, midOld] = vegTrunkWeights(d, policy, false), [nearNew, midNew] = vegTrunkWeights(d, policy, true);
      if (nearOld === 1 && midOld > .05) legacyGhost++;
      if (nearNew === 1 && midNew > 0) handoverGhost++;
    }
    assert(legacyGhost >= 8, `the legacy window must reproduce the ghost: ${legacyGhost} samples`);
    assert.equal(handoverGhost, 0, 'the handover must not draw the middle trunk before the near trunk starts to leave');
  });
  test(`${quality}: the handover keeps the trunk covered and finishes before the near trunk is gone`, () => {
    let floor = 1;
    for (let d = 0; d <= b - 1; d += .05) floor = Math.min(floor, Math.max(...vegTrunkWeights(d, policy)));
    // The middle trunk steps in over a quarter of a blend while the near trunk is still almost whole: at most about 4% of
    // the samples are open. (A full-blend window opened 26%, which showed as a see-through trunk against bright ground.)
    assert(floor >= .95, `trunk coverage floor ${floor}`);
    const [x0, x1] = vegTrunkLod(policy).slice(0, 2);
    assert.equal(x0, a); assert.equal(x1, a + w / 4);
    assert.equal(vegTrunkWeights(a + w / 4, policy)[1], 1, 'the middle trunk is whole once the near trunk has begun to leave');
    assert(vegTrunkWeights(a + w / 4, policy)[0] > .95 && vegTrunkWeights(a + 2 * w, policy)[0] === 0);
    let last = 0; for (let d = a; d <= a + w / 4; d += .02) { const m = vegTrunkWeights(d, policy)[1]; assert(m >= last - 1e-12, 'monotone fade-in'); last = m; }
  });
  test(`${quality}: the middle trunk still leaves where the shared window leaves`, () => {
    for (const d of [b - 2 * w, b, b + w, b + 2 * w]) assert.equal(vegTrunkWeights(d, policy)[1], vegTrunkWeights(d, policy, false)[1]);
  });
}
test('vtrunk=0 switches the handover off; any other value keeps it', () => {
  assert.equal(vegTrunkHandover(''), true); assert.equal(vegTrunkHandover('?world=kamakura'), true);
  assert.equal(vegTrunkHandover('?vtrunk=1'), true); assert.equal(vegTrunkHandover('?vtrunk=0'), false);
});
test('the view applies the handover to middle trunks only; crowns, near trunks and shrubs keep the shared uniforms', () => {
  const tree = (species, id) => ({ id, species, shape: 0, x: 0, z: 0, y: 0, yaw: 0, height: 12, lean: 0, tint: 0, phase: 0, rank: id, color: [1, 1, 1], insideA: false });
  const prepared = { active: [tree(2, 0), tree(0, 1), tree(5, 2)], grid: new Map() };
  for (const quality of ['standard', 'light']) {
    const policy = vegPolicy(quality);
    const on = buildKamakuraVeg(prepared, { wind, sunDir: new THREE.Vector3(1, 1, 1), quality }), off = buildKamakuraVeg(prepared, { wind, sunDir: new THREE.Vector3(1, 1, 1), quality, search: '?vtrunk=0' });
    const uniform = (view, key, mesh) => view.sets.get(key)[mesh].material.userData.uLod.value.toArray();
    for (const species of [2, 0]) {
      assert.deepEqual(uniform(on, `${species}/0/1`, 'wood'), vegTrunkLod(policy), `${species} middle trunk`);
      assert.deepEqual(uniform(off, `${species}/0/1`, 'wood'), uLodFor(1, policy), `${species} middle trunk with vtrunk=0`);
      assert.deepEqual(uniform(on, `${species}/0/1`, 'leaf'), uLodFor(1, policy), `${species} middle crown keeps entering early`);
      assert.deepEqual(uniform(on, `${species}/0/0`, 'wood'), uLodFor(0, policy), `${species} near trunk`);
    }
    assert.deepEqual(uniform(on, '5/0/1', 'leaf'), uniform(off, '5/0/1', 'leaf'), 'shrubs keep their own split');
    on.dispose(); off.dispose();
  }
});
