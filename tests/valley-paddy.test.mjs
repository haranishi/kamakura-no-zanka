// 棚田の区画・通行の余白・近遠混合を、描画から独立して確認する。
import test from 'node:test';
import assert from 'node:assert/strict';
import { WORLD } from '../dist/valley/world-data.js';
import { createTerrain } from '../dist/valley/terrain-height.js';
import { scatterRice } from '../dist/valley/scatter.js';
import { PADDY, createPaddyPlots, createPaddyLayout, paddyAt, paddyNearRice, paddyOptions, paddyWeights, paddyQuality, paddyPropClear, paddyGroundHeight } from '../dist/valley/paddy.js';
const terrain = createTerrain(WORLD), before = JSON.stringify(WORLD), start = performance.now(), layout = createPaddyLayout(WORLD, terrain), buildMs = performance.now() - start;

test('six deterministic rows contain 2–4 disjoint plots, bounded variation and requested harvest shares', () => {
  for (let seed = WORLD.seed; seed < WORLD.seed + 20; seed++) {
    const plots = createPaddyPlots({ ...WORLD, seed });
    assert.deepEqual(plots, createPaddyPlots({ ...WORLD, seed }));
    for (let row = 0; row < 6; row++) {
      const list = plots.filter(p => p.row === row);
      assert(list.length >= 2 && list.length <= 4);
      assert.equal(list[0].x0, WORLD.terraces.x0); assert.equal(list.at(-1).x1, WORLD.terraces.x1);
      list.forEach((p, i) => {
        assert(p.z0 >= WORLD.terraces.z0 && p.z1 <= WORLD.terraces.z1 && p.z0 < p.z1);
        assert(Math.abs(p.tint - 1) <= .08 && Math.abs(p.height - 1) <= .08);
        if (i) assert.equal(p.x0, list[i - 1].x1);
      });
    }
    const n = plots.length;
    for (const [kind, wanted] of [['standing', .60], ['harvested', .25], ['partial', .15]]) assert(Math.abs(plots.filter(p => p.kind === kind).length / n - wanted) <= .07, `${seed} ${kind}`);
    const mean = kind => { const a = plots.filter(p => p.kind === kind); return a.reduce((n, p) => n + p.z0, 0) / a.length; };
    assert(mean('harvested') < mean('standing'), 'harvest must be closer to the village');
  }
  assert.deepEqual(layout, createPaddyLayout(WORLD, terrain));
  assert.equal(JSON.stringify(WORLD), before, 'world coordinates and dimensions must remain unchanged');
});

test('partial fields have one straight cutting line and full harvested fields contain no standing near rice', () => {
  for (const p of layout.plots) {
    const z = (p.z0 + p.z1) / 2;
    const a = paddyAt(layout.plots, p.x0 + 1, z), b = paddyAt(layout.plots, p.x1 - 1, z);
    if (p.kind === 'partial') { assert(a.cut); assert(!b.cut); }
    if (p.kind === 'harvested') assert(a.cut && b.cut);
  }
  const rice = scatterRice(WORLD, terrain), copy = JSON.stringify(rice), filtered = paddyNearRice(rice, layout.plots);
  assert(filtered.x.length > 0 && filtered.x.length < rice.x.length);
  filtered.x.forEach((x, i) => { const s = paddyAt(layout.plots, x, filtered.z[i]); assert(s && !s.cut && !s.bund); });
  assert.equal(JSON.stringify(rice), copy, 'original near placement must survive paddy=0');
  for (const s of layout.far) { const at = paddyAt(layout.plots, s.x, s.z); assert(at && !at.cut && !at.bund); }
  for (const s of layout.stubble) assert(paddyAt(layout.plots, s.x, s.z).cut);
});

test('six stone lines use two courses at the existing drop, keep roads clear and expose their contour coverage', () => {
  for (let row = 0; row < 6; row++) assert(layout.stones.some(s => s.row === row));
  for (const s of layout.stones) {
    assert(s.x >= WORLD.terraces.x0 && s.x <= WORLD.terraces.x1);
    assert(Math.abs(s.z - s.nominal) <= PADDY.contourSearch + .001);
    assert(s.width >= PADDY.stoneMin && s.width <= PADDY.stoneMax);
    assert.equal(s.height * PADDY.stoneLayers, WORLD.terraces.drop);
    const road = terrain.roadInfo(s.x, s.z); assert(!road || road.dist > PADDY.stoneMax - .08);
    if (s.followsContour) assert(terrain.heightAt(s.sampleX, s.z - PADDY.contourProbe) - terrain.heightAt(s.sampleX, s.z + PADDY.contourProbe) >= PADDY.contourMin);
  }
  assert(layout.stones.some(s => s.followsContour));
  assert(layout.stones.some(s => !s.followsContour), 'existing southern terrain eases out; retain explicit embedded-edge fallback');
  assert(layout.stoneLength > 600 && layout.stoneLength < 6 * 118);
  for (const b of layout.bunds) { assert(b.x - b.sx / 2 >= WORLD.terraces.x0 - 1e-8 && b.x + b.sx / 2 <= WORLD.terraces.x1 + 1e-8 && b.z - b.sz / 2 >= WORLD.terraces.z0 - 1e-8 && b.z + b.sz / 2 <= WORLD.terraces.z1 + 1e-8); const r = terrain.roadInfo(b.x, b.z); assert(!r || r.dist > Math.hypot(b.sx, b.sz) / 2); }
});

test('8 racks and 28 clustered straw bundles stay in harvested plots and outside road, zone and patrol margins', () => {
  assert(layout.racks.length >= 6 && layout.racks.length <= 10); assert(layout.straw.length >= 20 && layout.straw.length <= 40);
  for (const p of [...layout.racks, ...layout.straw]) {
    const at = paddyAt(layout.plots, p.x, p.z); assert(at && at.plot.kind === 'harvested');
    assert(paddyPropClear(WORLD, terrain, p.x, p.z, p.radius ?? .5));
    if (p.radius) { assert(p.length >= 4 && p.length <= 7 && p.height >= 1.6 && p.height <= 2); assert(p.x - p.length / 2 > at.plot.x0 && p.x + p.length / 2 < at.plot.x1); }
    else assert(p.height >= 1 && p.height <= 1.4);
  }
  for (const p of layout.straw) assert(layout.straw.some(s => s !== p && Math.hypot(s.x - p.x, s.z - p.z) < 2));
  assert(!paddyPropClear(WORLD, terrain, -30, 52, 1), 'road negative control');
  assert(!paddyPropClear(WORLD, terrain, -12, 36, 1), 'zone negative control');
  const fake = { ...WORLD, zones: {}, spawns: { guard: [{ kind: 'soldier', patrol: [[10, 50], [20, 50]] }] } };
  assert(!paddyPropClear(fake, { roadInfo: () => null }, 15, 51, .5), 'patrol segment negative control');
});

test('near and far coverage sum to one through the complete handover, with monotone quality reductions', () => {
  for (const q of ['standard', 'light']) for (let level = 0; level <= 3; level++) {
    for (let d = 0; d <= 95; d += .125) { const w = paddyWeights(d, q, level); assert(Math.abs(w.near + w.far - 1) < 1e-12); }
    const end = paddyQuality(q, level).distance; assert.equal(paddyWeights(end, q, level).far, 0);
    if (level) { assert(paddyQuality(q, level).density < paddyQuality(q, level - 1).density); assert(end < paddyQuality(q, level - 1).distance); }
  }
  assert.equal(paddyOptions('?paddy=0&paddydebug=1').enabled, false);
  assert.equal(paddyOptions('?paddydebug=1').debug, true);
});

test('surface attachment uses the same diagonal as the one-metre terrain mesh', () => {
  const fixture = { heightAt: (x, z) => x * z };
  assert.equal(paddyGroundHeight(fixture, .2, .3), 0);
  assert(Math.abs(paddyGroundHeight(fixture, .8, .9) - .7) < 1e-12);
  assert.equal(paddyGroundHeight(fixture, 2, 3), 6);
});

test('layout metrics are reported without changing any collision or world input', t => {
  t.diagnostic(JSON.stringify({ buildMs, plots: layout.plots.length, farCapacity: layout.far.length, stoneLength: layout.stoneLength, stones: layout.stones.length, stubble: layout.stubble.length, racks: layout.racks.length, straw: layout.straw.length }));
  assert.equal(JSON.stringify(WORLD), before);
});
