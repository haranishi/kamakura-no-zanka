// なぜ失敗したか: [density]は母数/品質、[exclusion]は禁止域への侵入、[seed]はセル系列、
// [height]は補間/倍率、[species]は種の帯/群れ、[budget]は円外区画、[legacy]は既存配置の変更。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WORLD } from '../dist/valley/world-data.js';
import { GRASS } from '../dist/valley/config.js';
import { createTerrain } from '../dist/valley/terrain-height.js';
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

test('eligible square metres meet local density and light retains at least 40% [density]', () => {
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
    assert(cards * 14 / mn >= 20, `[density] mid ${p.x},${p.z}: ${cards * 14 / mn}`);
    assert(lightN >= leaves * .4 && lightM >= cards * .4, '[density] light lost more than 60% on identical area');
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
  assert(Math.hypot(x - WORLD.start.x, z - WORLD.start.z) >= 3, '[exclusion:start] start disk');
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
  let sum = 0, max = 0, n = 0; const rng = mulberry32(340);
  for (let k = 0; k < 500; k++) {
    const p = at(eligible[Math.floor(rng() * eligible.length)]), a = tileAt(p.x, p.z);
    for (let i = 0; i < a.count; i++) {
      assert(a.h[i] >= .15 - 1e-7 && a.h[i] <= .6 + 1e-7, '[height] multiplied leaf height out of range');
      const spec = GRASS.species[a.species[i]];
      assert(a.w[i] >= .015 - 1e-7 && a.w[i] <= .03 + 1e-7, '[width] ribbon outside 1.5–3cm');
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
  for (const k of ['placeable', 'density', 'height', 'species', 'heights']) assert.deepEqual(field[k], copy[k], `[seed] field changed ${k}`);
  // A tile must work after all source terrain queries become unavailable.
  terrain.heightAt = () => { throw Error('[seed] tile called heightAt'); };
  try { nearTile(field, -92, -88); midTile(field, -46, -44); } finally { terrain.heightAt = originalHeightAt; }
  for (const make of [nearTile, midTile]) {
    const a = make(field, -23, -22, { size: 4 });
    make(field, 11, 17); assert.deepEqual(a, make(field, -23, -22, { size: 4 }), '[seed] request order changes arrays');
    const children = [];
    for (let z = -88; z < -84; z++) for (let x = -92; x < -88; x++) children.push(make(field, x, z, { size: 1 }));
    const props = make === nearTile ? ['x', 'y', 'z', 'h', 'w', 'lean', 'yaw', 'hue', 'species'] : ['x', 'y', 'z', 's', 'yaw', 'hue', 'species'];
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
    assert(budget.mid.triangles <= 20000, '[budget] mid triangle cap');
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
    const h = Math.max(.15, Math.min(.6, (spec.h[0] + (spec.h[1] - spec.h[0]) * rng()) * (.8 + multiplier * .55 / 255) * (.9 + .2 * rng())));
    assert.equal(a.h[0], Math.fround(h), '[height] cell height multiplier omitted or applied incorrectly');
    assert.equal(a.y[0], Math.fround(1 + px + pz * 2 - .02), '[height] roots must use corner heights, sunk 2cm');
    assert(a.h.every(h => h >= .15 - 1e-7 && h <= .6 + 1e-7), '[height] extreme multiplier');
  }
});
