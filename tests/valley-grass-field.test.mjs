// なぜ失敗したか: [density]は母数/品質、[exclusion]は禁止域への侵入、[seed]はセル系列、
// [height]は補間/倍率、[species]は種の帯/群れ、[budget]は円外区画、[legacy]は既存配置の変更。
import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WORLD } from '../dist/valley/world-data.js';
import { GRASS } from '../dist/valley/config.js';
import { fbm, createTerrain } from '../dist/valley/terrain-height.js';
import { cellRand, mulberry32, insideFootprint, insidePlot, scatterTrees, scatterRocks, scatterGrass, scatterRice, scatterCrops, ROCK_MODEL } from '../dist/valley/scatter.js';
import { createGrassField, sampleGrass, nearTile, midTile, tilesAround, grassBudget, SHORT, TALL, SUSUKI, FERN, FLOWER } from '../dist/valley/grass-field.js';
const terrain = createTerrain(WORLD), start = performance.now(), field = createGrassField(WORLD, terrain);
const createMs = performance.now() - start;
const eligible = [];
for (let k = 0; k < field.placeable.length; k++) if (field.placeable[k]) eligible.push(k);
const at = k => ({ x: field.x0 + k % field.nx, z: field.z0 + Math.floor(k / field.nx) });
const points = [WORLD.start, WORLD.zones.village_front, WORLD.zones.village_center, WORLD.zones.temple_yard, WORLD.zones.viewpoint, { x: 66, z: -9 }];
const nearCache = new Map(), midCache = new Map();
function tileAt(x, z, mid = false, quality = 'standard') {
  const size = mid ? GRASS.midSize : GRASS.nearSize, tx = Math.floor(x / size), tz = Math.floor(z / size), key = `${tx},${tz}:${quality}`;
  const cache = mid ? midCache : nearCache;
  if (!cache.has(key)) cache.set(key, (mid ? midTile : nearTile)(field, tx, tz, { quality }));
  return cache.get(key);
}

test('landmark samples retain near density and allow mid stochastic variation [density]', () => {
  assert.equal(points.length, 6, '[density] six independent world landmarks');
  for (const p of points) {
    let nn = 0, mn = 0, leaves = 0, cards = 0, lightN = 0, lightM = 0;
    for (const k of eligible) {
      const { x, z } = at(k), d = Math.hypot(x + .5 - p.x, z + .5 - p.z);
      if (d <= 8) { nn++; const a = tileAt(x, z), b = tileAt(x, z, false, 'light'); leaves += a.count; lightN += b.count; }
      else if (d <= 25) {
        mn++; const a = tileAt(x, z, true), b = tileAt(x, z, true, 'light');
        for (let i = 0; i < a.count; i++) if (Math.floor(a.x[i]) === x && Math.floor(a.z[i]) === z) cards++;
        for (let i = 0; i < b.count; i++) if (Math.floor(b.x[i]) === x && Math.floor(b.z[i]) === z) lightM++;
      }
    }
    assert(nn > 8 && mn > 8, '[density] landmark must have eligible grassland');
    assert(leaves / nn >= 100, `[density] near ${p.x},${p.z}: ${leaves / nn}`);
    assert(cards * GRASS.cardLeaves / mn >= 16, `[density] mid ${p.x},${p.z}: ${cards * GRASS.cardLeaves / mn}`);
    assert(lightN >= leaves * .4 && lightM >= cards * .30, '[density] near light floor or mid local sampling tolerance violated');
  }
  const mean = eligible.reduce((s, k) => s + field.density[k] * 2 / 255, 0) / eligible.length;
  assert(mean >= 1, '[density] placeable-cell mean below one');
});

test('five species cluster more than shuffled controls; clearings are 8–12% [species]', () => {
  const counts = [0, 0, 0, 0, 0], values = eligible.map(k => field.species[k]);
  for (const s of values) counts[s]++;
  assert(counts.every(n => n > 0), '[species] missing undergrowth species');
  assert.equal(SHORT, 0); assert.equal(TALL, 1); assert.equal(SUSUKI, 2); assert.equal(FERN, 3); assert.equal(FLOWER, 4);
  const ratio = counts.map(n => n / values.length);
  assert(ratio[SHORT] >= .48 && ratio[SHORT] <= .65, '[species] short grass target about 55%');
  assert(ratio[TALL] >= .12 && ratio[TALL] <= .27, '[species] tall grass target about 20%');
  assert(ratio[SUSUKI] >= .04 && ratio[SUSUKI] <= .13, '[species] susuki target about 8%');
  const clearing = field.stats.clearCount / field.stats.eligible;
  assert(clearing >= .08 && clearing <= .12, '[species] open-ground quantile outside 8–12%');
  const shuffled = [...values], rng = mulberry32(991);
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  const map = new Map(eligible.map((k, i) => [k, i])); let same = 0, control = 0, pairs = 0;
  for (let i = 0; i < eligible.length; i++) {
    const k = eligible[i], { x, z } = at(k), s = field.species[k];
    if (s === SUSUKI) assert(terrain.forestDensity(x + .5, z + .5) < .3, '[species] susuki outside open land');
    if (s === FERN) assert(terrain.forestDensity(x + .5, z + .5) > .52 || terrain.riverInfo(x + .5, z + .5).d < 25, '[species] fern outside forest or bank');
    if (s === FLOWER) { const T = WORLD.terraces, d = Math.max(T.x0 - x - .5, x + .5 - T.x1, T.z0 - z - .5, z + .5 - T.z1); assert(d >= 3 && d <= 6, '[species] flowers outside terrace band'); }
    for (const next of [k + 1, k + field.nx]) {
      if (next === k + 1 && k % field.nx === field.nx - 1) continue;
      const j = map.get(next); if (j === undefined) continue;
      pairs++; same += +(values[i] === values[j]); control += +(shuffled[i] === shuffled[j]);
    }
  }
  assert(same / pairs > control / pairs + .2, '[species] no spatial clustering beyond shuffled control');
  console.log('grass field:', JSON.stringify({ createMs, eligible: eligible.length, species: counts, shares: ratio, clearing, sameRate: same / pairs, shuffledRate: control / pairs }));
});

const rocks = scatterRocks(WORLD, terrain);
function checkRoot(x, z) {
  assert(terrain.waterAt(x, z) <= .05, '[exclusion:water] submerged root');
  assert(terrain.forestDensity(x, z) <= .82, '[exclusion:forest] dense forest');
  assert((terrain.roadInfo(x, z)?.w || 0) <= .35, '[exclusion:road] root on road');
  assert(terrain.riverInfo(x, z).d >= 12, '[exclusion:river] river corridor');
  assert(terrain.slopeAt(x, z, 1) <= 35, '[exclusion:slope] steep ground');
  assert(!WORLD.buildings.some(b => insideFootprint(b, x, z, .4)), '[exclusion:footprint] root in building');
  assert(!WORLD.plots.some(b => insidePlot(b, x, z, .4)), '[exclusion:plot] root in plot');
  assert(!WORLD.props.some(p => Math.hypot(x - p.x, z - p.z) < (p.r || 1) + .4), '[exclusion:prop] root in prop');
  assert(Math.hypot(x - 4, z - 6) >= 7, '[exclusion:yard] garden disk');
  const T = WORLD.terraces;
  assert(!(x > T.x0 - 2 && x < T.x1 + 2 && z > T.z0 - 2 && z < T.z1 + 2), '[exclusion:terrace] root in rice field');
  for (let i = 0; i < rocks.x.length; i++) {
    const b = { x: rocks.x[i], z: rocks.z[i], rotY: rocks.rot[i], footprint: { w: ROCK_MODEL.width * rocks.s[i] * rocks.sx[i], d: ROCK_MODEL.depth * rocks.s[i] * rocks.sz[i] } };
    assert(!insideFootprint(b, x, z), '[exclusion:rock] root on rock');
  }
}
test('all roots at six landmarks plus 200 fixed random tiles avoid prohibited ground [exclusion]', () => {
  const rng = mulberry32(9321), selections = points.map(p => ({ x: Math.floor(p.x), z: Math.floor(p.z) }));
  for (let i = 0; i < 200; i++) selections.push(at(eligible[Math.floor(rng() * eligible.length)]));
  for (const { x, z } of selections) for (const a of [tileAt(x, z), tileAt(x, z, true)]) {
    for (let i = 0; i < a.count; i++) checkRoot(a.x[i], a.z[i]);
    if (a.clumps) for (let i = 0; i < a.clumps.count; i++) checkRoot(a.clumps.x[i], a.clumps.z[i]);
  }
});

test('height, width and lean remain in species ranges; corner interpolation stays grounded [height]', () => {
  // Freeze the original 500 world cells so adding start cells cannot replace the regression corpus.
  const cells = JSON.parse(fs.readFileSync(new URL('./fixtures/grass-grounding-cells.json', import.meta.url)));
  let sum = 0, max = 0, n = 0;
  for (const [x,z] of cells) {
    const a = tileAt(x,z);
    for (let i = 0; i < a.count; i++) {
      assert(a.h[i] >= .15 - 1e-7 && a.h[i] <= .6 + 1e-7, '[height] multiplied leaf height out of range');
      const spec = GRASS.species[a.species[i]];
      assert(a.w[i] >= .015 - 1e-7 && a.w[i] <= .04 + 1e-7, '[width] ribbon outside 2.2–4cm');
      assert(a.w[i] >= spec.w[0] - 1e-7 && a.w[i] <= spec.w[1] + 1e-7, '[width] wrong ribbon width');
      assert(a.lean[i] >= spec.lean[0] - 1e-7 && a.lean[i] <= spec.lean[1] + 1e-7, '[lean] wrong bend');
      assert([SHORT, TALL, FERN].includes(a.species[i]), '[species] clump rendered as ribbon');
      const err = Math.abs(a.y[i] + .02 - terrain.heightAt(a.x[i], a.z[i])); sum += err; max = Math.max(max, err); n++;
    }
  }
  assert(sum / n <= .02, `[height] mean interpolation error ${sum / n}`);
  assert(max <= .10, `[height] max interpolation error ${max}`);
  console.log('grass height error:', JSON.stringify({ samples: n, mean: sum / n, max }));
});

// Analytic fixture isolates each exclusion; real-world overlap cannot mask a missing rule.
const flat = { heightAt: () => 0, slopeAt: () => 0, waterAt: () => 0, forestDensity: () => .2, roadInfo: () => null, riverInfo: () => ({ d: 80 }) };
const smallWorld = { ...WORLD, buildings: [], props: [], plots: [], start: { x: -1000, z: -1000 }, terraces: { x0: 500, x1: 510, z0: 500, z1: 510 } };
const options = { box: [80, 88, 80, 88], padding: 0 };
test('independent forbidden fixtures reject every cell [exclusion]', () => {
  assert(createGrassField(smallWorld, flat, options).placeable.some(Boolean), '[exclusion] fixture has no positive control');
  for (const [name, t, w] of [
    ['water', { waterAt: () => .06 }], ['road', { roadInfo: () => ({ w: .5, dist: 1 }) }], ['slope', { slopeAt: () => 36 }],
    ['footprint', {}, { buildings: [{ x: 84, z: 84, rotY: .2, footprint: { w: 40, d: 40 } }] }],
    ['plot', {}, { plots: [{ x: 84, z: 84, rot: .2, hx: 20, hz: 20 }] }],
    ['prop', {}, { props: [{ x: 84, z: 84, r: 30 }] }], ['forest', { forestDensity: () => .9 }], ['river', { riverInfo: () => ({ d: 11 }) }],
  ]) assert(!createGrassField({ ...smallWorld, ...w }, { ...flat, ...t }, options).placeable.some(Boolean), `[exclusion:${name}] missing isolated exclusion`);
});

test('cell streams reproduce exactly and survive tile rebatching and reversed requests [seed]', () => {
  const originalHeightAt = terrain.heightAt;
  const copy = createGrassField(WORLD, terrain);
  for (const k of ['placeable', 'density', 'height', 'species', 'heights', 'midPatch']) assert.deepEqual(field[k], copy[k], `[seed] field changed ${k}`);
  // A tile must work after all source terrain queries become unavailable.
  terrain.heightAt = () => { throw Error('[seed] tile called heightAt'); };
  try { nearTile(field, -92, -88); midTile(field, -46, -44); } finally { terrain.heightAt = originalHeightAt; }
  for (const make of [nearTile, midTile]) {
    const a = make(field, -23, -22, { size: 4 });
    make(field, 11, 17); assert.deepEqual(a, make(field, -23, -22, { size: 4 }), '[seed] request order changes arrays');
    const children = [];
    for (let z = -88; z < -84; z++) for (let x = -92; x < -88; x++) children.push(make(field, x, z, { size: 1 }));
    const props = make === nearTile ? ['x', 'y', 'z', 'h', 'w', 'lean', 'yaw', 'hue', 'species'] : ['x', 'y', 'z', 's', 'sx', 'sy', 'flip', 'yaw', 'hue', 'brightness', 'tilt', 'tiltYaw', 'species'];
    for (const key of props) assert.deepEqual([...a[key]], children.flatMap(t => [...t[key]]), `[seed] rebatching changed ${key}`);
    if (a.clumps) for (const key of ['x', 'y', 'z', 'h', 'yaw', 'hue', 'kind']) assert.deepEqual([...a.clumps[key]], children.flatMap(t => [...t.clumps[key]]), `[seed] rebatching clumps ${key}`);
  }
  for (const k of eligible.filter((_, i) => i % 1000 === 0)) {
    const { x, z } = at(k), a = nearTile(field, x, z, { size: 1 }), r = cellRand(WORLD.seed + GRASS.seed, x, z);
    assert.equal(a.x[0], Math.fround(x + .001 + r() * .998), '[seed] leaf stream is not keyed to metre cell');
    assert.equal(a.z[0], Math.fround(z + .001 + r() * .998), '[seed] cell stream changed');
  }
  assert.notDeepEqual(nearTile({ ...field, seed: field.seed + 1 }, -92, -88), nearTile(field, -92, -88), '[seed] world seed ignored');
});

test('sample uses bilinear attributes and corner heights; out-of-range is empty [sampling]', () => {
  const f = { x0: 0, z0: 0, nx: 2, nz: 2, placeable: new Uint8Array([1, 1, 1, 1]), density: new Uint8Array([0, 100, 200, 255]), height: new Uint8Array([0, 100, 200, 255]), species: new Uint8Array([0, 1, 3, 4]) };
  const s = sampleGrass(f, 1, 1);
  assert.equal(s.density, (0 + 100 + 200 + 255) / 4 * 2 / 255, '[sampling] not bilinear');
  assert.equal(s.height, .8 + (0 + 100 + 200 + 255) / 4 * .55 / 255, '[sampling] height multiplier');
  assert.equal(s.species, 4, '[sampling] species not nearest cell');
  for (const [x, z] of [[-1, 0], [2, 0], [0, 2], [NaN, 0]]) assert.equal(sampleGrass(f, x, z).placeable, false, '[sampling] out-of-range grass');
  const k = eligible[50], p = at(k), c = sampleGrass(field, p.x + .5, p.z + .5);
  assert.equal(c.density, field.density[k] * 2 / 255, '[sampling] wrong cell centre');
});

test('camera lists use rectangle-circle overlap and budgets bound every offset [budget]', () => {
  const full = { x0: -1000, z0: -1000, nx: 2000, nz: 2000 }, result = [];
  for (const quality of ['standard', 'light']) {
    const budget = grassBudget(quality); result.push(budget);
    assert(budget.near.triangles <= (quality === 'standard' ? 200000 : 80000), '[budget] near triangle cap');
    assert(budget.mid.triangles <= (quality === 'standard' ? 40000 : 15000), '[budget] mid triangle cap');
    assert.equal(budget.mid.triangles, budget.mid.count * 6, '[budget] three card plates omitted');
    const q = GRASS.quality[quality], rng = mulberry32(789);
    for (let i = 0; i < 51; i++) {
      const x = i === 0 ? 0 : rng() * 16 - 8, z = i === 0 ? 0 : rng() * 16 - 8, lists = tilesAround(full, x, z, { quality });
      for (const name of ['near', 'mid']) {
        const size = name === 'near' ? GRASS.nearSize : GRASS.midSize;
        const radius = (name === 'near' ? 8 : 25) * q.distance;
        const keys = new Set(lists[name].map(t => t.key));
        assert(lists[name].length <= budget[name].tiles, '[budget] tile count exceeds bound');
        for (let tz = Math.floor((z - radius) / size) - 1; tz <= Math.ceil((z + radius) / size); tz++) for (let tx = Math.floor((x - radius) / size) - 1; tx <= Math.ceil((x + radius) / size); tx++) {
          const dx = Math.max(tx * size - x, 0, x - (tx + 1) * size), dz = Math.max(tz * size - z, 0, z - (tz + 1) * size);
          const far = Math.hypot(Math.max(Math.abs(tx * size - x), Math.abs((tx + 1) * size - x)), Math.max(Math.abs(tz * size - z), Math.abs((tz + 1) * size - z)));
          const expected = Math.hypot(dx, dz) <= radius && (name === 'near' || far >= 8 * q.distance * .8);
          assert.equal(keys.has(`${name}:${tx},${tz}`), expected, '[budget] missing/extra intersecting rectangle');
        }
        assert(lists[name].every((t, j, a) => !j || t.dist >= a[j - 1].dist), '[budget] tiles not sorted');
      }
    }
  }
  console.log('grass budgets:', JSON.stringify(result));
});

test('legacy placement hashes and counts remain unchanged [legacy]', () => {
  for (const [name, fn, hash, count] of [
    ['trees', scatterTrees, '7327b88af62332e7', 15830], ['rocks', scatterRocks, '1da272cdfa7d6d2a', 267],
    ['grass', scatterGrass, '5abb950b2a60bd91', 21180], ['rice', scatterRice, '0e98efe119c6b88c', 21882], ['crops', scatterCrops, 'e3a37af7c7f007fb', 618],
  ]) {
    const a = fn(WORLD, terrain), json = JSON.stringify(a, (_, v) => typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);
    assert.equal(a.x.length, count, `[legacy] ${name} count changed`);
    assert.equal(createHash('sha256').update(json).digest('hex').slice(0, 16), hash, `[legacy] ${name} output changed`);
  }
});

test('report pure generation timing after warmup, including dense tiles [timing]', () => {
  const best = eligible.reduce((a, b) => field.density[a] >= field.density[b] ? a : b), p = at(best), results = {};
  for (const [name, make, size] of [['near', nearTile, GRASS.nearSize], ['mid', midTile, GRASS.midSize]]) {
    const tx = Math.floor(p.x / size), tz = Math.floor(p.z / size);
    for (let i = 0; i < 100; i++) make(field, tx, tz);
    const times = [];
    for (let i = 0; i < 500; i++) { const t = performance.now(); make(field, tx, tz); times.push(performance.now() - t); }
    times.sort((a, b) => a - b); results[name] = { count: make(field, tx, tz).count, medianMs: times[250], p95Ms: times[474], maxMs: times[499] };
  }
  console.log('grass timing (Node CPU only):', JSON.stringify({ createMs, ...results }));
});


test('explicit quality coefficients, cell heights and clump rates [contract]', () => {
  assert.deepEqual(GRASS.quality, { standard: { density: 1, distance: 1 }, light: { density: .4, distance: .6 } }, '[quality] R14 coefficients changed');
  let sumS = 0, sumF = 0, nS = 0, nF = 0;
  for (const k of eligible) {
    const kind = field.species[k]; if (kind !== SUSUKI && kind !== FLOWER) continue;
    const { x, z } = at(k), a = nearTile(field, x, z, { size: 1 });
    if (kind === SUSUKI) { nS++; sumS += a.clumps.count; } else { nF++; sumF += a.clumps.count; }
    assert(a.clumps.kind.every(s => s === kind), '[species] clump kind lost');
  }
  assert(Math.abs(sumS / nS - .25) < .04, '[clump] susuki rate is not .25 per eligible species cell');
  assert(Math.abs(sumF / nF - .8) < .05, '[clump] flower rate is not .8 per eligible species cell');
  for (let species = 0; species < 5; species++) for (const multiplier of [0, 255]) {
    const f = { seed: 1333, x0: 0, z0: 0, nx: 1, nz: 1, placeable: new Uint8Array([1]), density: new Uint8Array([128]), height: new Uint8Array([multiplier]), species: new Uint8Array([species]), heights: new Float32Array([1, 2, 3, 4]) };
    const a = nearTile(f, 0, 0, { size: 1 }), rng = cellRand(1333 + GRASS.seed, 0, 0), spec = GRASS.species[species === SUSUKI || species === FLOWER ? SHORT : species];
    const px = .001 + rng() * .998, pz = .001 + rng() * .998;
    const h = Math.max(.15, Math.min(.6, (spec.h[0] + (spec.h[1] - spec.h[0]) * rng()) * (.8 + multiplier * .55 / 255) * (.75 + .55 * rng()) * (cellRand(1333 + GRASS.seed + 1, 0, 0)() < .08 ? 1.5 : 1)));
    assert.equal(a.h[0], Math.fround(h), '[height] cell height multiplier omitted or applied incorrectly');
    assert.equal(a.y[0], Math.fround(1 + px + pz * 2 - .02), '[height] roots must use corner heights, sunk 2cm');
    assert(a.h.every(h => h >= .15 - 1e-7 && h <= .6 + 1e-7), '[height] extreme multiplier');
  }
});

// なぜ失敗したか: [mid-density]は全母数の平均低下、[mid-patch]は場の偏り、[mid-shape]は苗の反復。
test('mid stochastic cell counts preserve the population mean, bounds and independent shapes [mid-density]', () => {
  let weighted = 0, density = 0, cards = 0, light = 0, empty = 0, expected = 0;
  const scales = [], widths = [], heights = [], flips = new Set();
  for (const k of eligible) {
    const { x, z } = at(k), patch = field.midPatch[k], d = field.density[k] * 2 / 255;
    assert(patch >= .2 - 1e-6 && patch <= 1.8 + 1e-6, '[mid-patch] outside .2–1.8');
    weighted += patch; density++;
    const a = midTile(field, x, z, { size: 1 }), b = midTile(field, x, z, { size: 1, quality: 'light' });
    const average = GRASS.midCardRate;
    const rng = cellRand(field.seed + GRASS.midSeed, x, z);
    assert.equal(a.count, Math.min(GRASS.midMaxCards, Math.floor(average * patch + rng())), '[mid-count] count is not stochastic rounding');
    assert(a.count <= 4 && a.count <= Math.ceil(average * 1.8), '[budget] mid cell exceeded maximum');
    cards += a.count; light += b.count; empty += a.count === 0; expected += Math.min(GRASS.midMaxCards, average * patch);
    for (let i = 0; i < a.count; i++) {
      assert(a.s[i] >= .5 - 1e-6 && a.s[i] <= 1.9, '[mid-shape] scale outside .5–1.9');
      assert(a.sx[i] >= .75 - 1e-6 && a.sx[i] <= 1.25 + 1e-6, '[mid-shape] width outside .75–1.25');
      assert(a.sy[i] >= .75 - 1e-6 && a.sy[i] <= 1.875 + 1e-6, '[mid-shape] height outside .75–1.875');
      scales.push(a.s[i]); widths.push(a.sx[i]); heights.push(a.sy[i]); flips.add(a.flip[i]);
    }
  }
  assert(Math.abs(weighted / density - 1) < 1e-6, '[mid-patch] cell mean changed');
  assert(Math.abs(cards / expected - 1) < .025, '[mid-density] population expectation drift');
  assert(cards * GRASS.cardLeaves / eligible.length >= 20, '[mid-density] below 20 represented leaves/m²');
  assert(Math.abs(light / cards - .4) < .025, '[mid-density] light population ratio drift');
  assert(empty > 0 && cards / eligible.length > 1.94 && cards / eligible.length < 2.03, '[mid-count] mean must remain near 2.0 cards/m² under the cap');
  assert.equal(GRASS.midCardRate, 2, '[mid-density] expected 2 cards/m²');
  assert.equal(GRASS.midMaxCards, 3, '[budget] three-card cell cap required');
  assert.deepEqual(GRASS.card, { size:.55, aspect:.25 }, '[mid-shape] square card contract changed');
  assert.equal(GRASS.cardLeaves, 14, '[mid-density] accounting must remain 14 leaves/card');
  assert.equal(GRASS.midDensity, 20, '[mid-density] represented-leaf target changed');
  for (const [values, range] of [[scales,1.35],[widths,.49],[heights,1.1]])
    assert(Math.max(...values) - Math.min(...values) > range, '[mid-shape] missing individual variation');
  assert.deepEqual([...flips].sort(), [-1,1], '[mid-shape] missing reflection');
  console.log('mid population', { cells: eligible.length, cards, light, representedDensity: cards * GRASS.cardLeaves / eligible.length });
});

// なぜ失敗したか: 枚数を葉相当会計や近景密度に連動させると、中景が再び疎になる。
test('mid card rate ignores near density and keeps its extreme patch bound [mid-count]', () => {
  const n = 256, f = { seed: 1333, x0: 0, z0: 0, nx: n, nz: 1, placeable: new Uint8Array(n).fill(1), density: new Uint8Array(n), species: new Uint8Array(n), heights: new Float32Array((n+1)*2), midPatch: new Float32Array(n).fill(1.6) };
  const a = midTile(f, 0, 0, { size: n });
  f.density.fill(255);
  assert.deepEqual(midTile(f, 0, 0, { size: n }), a, '[mid-count] near density changed card count');
  const counts = new Map();
  for (const x of a.x) counts.set(Math.floor(x), (counts.get(Math.floor(x)) || 0)+1);
  assert.equal(Math.max(...counts.values()), 3, '[mid-count] extreme patch did not exercise three-card maximum');
});

// なぜ失敗したか: 開始地点だけ旧配置の半径3m除外が残り、足もとが円形に抜けていた。
test('start permits grass in the old disk and changing start never changes placement [start-placement]', () => {
  const w = { ...smallWorld, start: { x: 84, z: 84 } };
  const f = createGrassField(w, flat, options), control = createGrassField(smallWorld, flat, options);
  assert.deepEqual(f.placeable, control.placeable, '[start-placement] start still affects placeable cells');
  for (const make of [nearTile, midTile]) {
    const a = make(f, 10, 10, { size: 8 });
    assert(a.x.some((x,i) => Math.hypot(x-84,a.z[i]-84)<3), '[start-placement] no roots inside old start disk');
  }
  let roots = 0;
  for (let z = Math.floor(WORLD.start.z)-3; z <= WORLD.start.z+3; z++)
    for (let x = Math.floor(WORLD.start.x)-3; x <= WORLD.start.x+3; x++) {
      const a = nearTile(field,x,z,{size:1});
      roots += a.x.filter((px,i)=>Math.hypot(px-WORLD.start.x,a.z[i]-WORLD.start.z)<3).length;
    }
  assert(roots>0, '[start-placement] actual world has no grass inside start disk');
});

// なぜ失敗したか: 一様な株と葉の丈・倒れが揃い、株は水玉、近景は植毛に見えた。
test('cell streams encode skewed scale, tall tufts, tilt, brightness and long leaves [variation]', () => {
  let midCount=0,tall=0,small=0,long=0,nearCount=0; const bends=[];
  for (const k of eligible.filter((_,i)=>i%20===0)) {
    const {x,z}=at(k), a=midTile(field,x,z,{size:1}), r=cellRand(field.seed+GRASS.midSeed,x,z); r();
    for(let i=0;i<a.count;i++) {
      r(); r(); const u=r();
      assert.equal(a.s[i],Math.fround(.5+1.4*u*u),'[variation:scale] squared distribution lost');
      assert.equal(a.sx[i],Math.fround(1+GRASS.card.aspect*(2*r()-1)),'[variation:aspect] width range lost');
      const sy=1+GRASS.card.aspect*(2*r()-1), isTall=r()<.12;
      assert.equal(a.sy[i],Math.fround(sy*(isTall?1.5:1)),'[variation:tall] tall multiplier lost');
      r();r();r();
      assert.equal(a.brightness[i],Math.fround(.8+.4*r()),'[variation:brightness] brightness lost');
      assert.equal(a.tilt[i],Math.fround((2*r()-1)*Math.PI/15),'[variation:tilt] tilt lost');
      assert.equal(a.tiltYaw[i],Math.fround(r()*Math.PI*2),'[variation:tilt] direction lost');
      midCount++;tall+=isTall;small+=a.s[i]<1;
    }
    const b=nearTile(field,x,z,{size:1}), nr=cellRand(field.seed+GRASS.seed,x,z), lr=cellRand(field.seed+GRASS.seed+1,x,z);
    for(let i=0;i<b.count;i++) {
      nr();nr();const spec=GRASS.species[b.species[i]],base=spec.h[0]+(spec.h[1]-spec.h[0])*nr();
      const factor=.75+.55*nr(), isLong=lr()<.08;
      const h=Math.max(.15,Math.min(.6,base*(.8+field.height[k]*.55/255)*factor*(isLong?1.5:1)));
      assert.equal(b.h[i],Math.fround(h),'[variation:height] height factor or long blade lost');
      nr();const t=.5+.5*Math.sin((nr()-.5)*Math.PI);
      assert.equal(b.lean[i],Math.fround(spec.lean[0]+(spec.lean[1]-spec.lean[0])*t),'[variation:lean] wider bend distribution lost');
      nr();nr();bends.push(t);nearCount++;long+=isLong;
    }
  }
  assert(tall/midCount>.10 && tall/midCount<.14,'[variation:tall] expected 12% tall tufts');
  assert(small/midCount>.57 && small/midCount<.63,'[variation:scale] small tufts must predominate');
  assert(long/nearCount>.075 && long/nearCount<.085,'[variation:height] expected 8% long leaves');
  assert(bends.filter(v=>v<.1||v>.9).length/bends.length>.39,'[variation:lean] bend range not broadened');
});

// なぜ失敗したか: ひとつの大きな斑だけでは、短い距離の株数が揃って水玉になる。
test('patch ordering follows both three and fourteen metre fields [mid-patch]', () => {
  const samples=eligible.filter((_,i)=>i%17===0).map(k=>{
    const {x,z}=at(k);
    return {v:fbm((x+.5)/3,(z+.5)/3,WORLD.seed+593,2)+fbm((x+.5)/14,(z+.5)/14,WORLD.seed+599,2),p:field.midPatch[k]};
  }).sort((a,b)=>a.v-b.v);
  for(let i=1;i<samples.length;i++) assert(samples[i].p>=samples[i-1].p-1e-6,'[mid-patch:scales] two-scale spatial ordering lost');
  const values=eligible.map(k=>field.midPatch[k]);
  assert(Math.max(...values)-Math.min(...values)>1.2,'[mid-patch:range] patch contrast narrowed');
});
