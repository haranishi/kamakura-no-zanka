// W2c-16: the shared gust band (kamakura-gust.js) and the shared habitat answer (kamakura-habitat.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GUST, GUST_GLSL, GUST_PERIOD_S, GUST_FRONT_SPEED, gustNoise, gustPhase, gustBand, gustLevel } from '../dist/valley/kamakura-gust.js';
import { createHabitat, habitatGround, HABITAT, HABITAT_KEYS } from '../dist/valley/kamakura-habitat.js';

const source = name => fs.readFileSync(new URL(`../dist/valley/${name}`, import.meta.url), 'utf8');

test('the gust numbers are the ones the grass and tree shaders use', () => {
  // The shaders keep their own copy of the formula; this pins the shared module to it.
  for (const file of ['grass-view.js', 'tree-materials.js']) {
    const s = source(file);
    assert.match(s, /uWindDir\)\*\.045-uTime\*\.9;/, `${file}: phase`);
    assert.match(s, /smoothstep\(\.55,\.95,sin\(bandPhase\+\w+Noise\(\w+\.xz\*\.025\)\*\.65\)\)/, `${file}: band`);
  }
  assert.deepEqual({ ...GUST }, { wave: .045, speed: .9, noiseScale: .025, noiseAmount: .65, lo: .55, hi: .95 });
  assert(Math.abs(GUST_PERIOD_S - 6.981) < 1e-3); assert(Math.abs(GUST_FRONT_SPEED - 20) < 1e-9);
});

test('gust noise is the smooth sine-lattice noise: lattice values at integers, bounded, continuous', () => {
  assert.equal(gustNoise(3, -2), Math.sin(3 * 12.9898 - 2 * 78.233));
  let worst = 0;
  for (let i = 0; i < 400; i++) {
    const x = (i * .37) % 23 - 11, z = (i * .91) % 17 - 8, a = gustNoise(x, z);
    assert(a >= -1 - 1e-12 && a <= 1 + 1e-12);
    worst = Math.max(worst, Math.abs(gustNoise(x + 1e-4, z) - a), Math.abs(gustNoise(x, z + 1e-4) - a));
  }
  assert(worst < 1e-3, `continuity ${worst}`);
});

test('the band travels downwind at the front speed and repeats every period', () => {
  const dir = [1, 0];
  // Without the positional noise the phase is exact: same phase after moving with the front.
  const base = gustPhase(0, 0, 10, ...dir) - gustNoise(0, 0) * GUST.noiseAmount;
  const moved = gustPhase(GUST_FRONT_SPEED * 2, 0, 12, ...dir) - gustNoise(GUST_FRONT_SPEED * 2 * GUST.noiseScale, 0) * GUST.noiseAmount;
  assert(Math.abs(base - moved) < 1e-9);
  for (const [x, z, t] of [[5, 7, 3], [-120, 44, 91.5], [600, -250, 12.25]]) {
    assert(Math.abs(gustBand(x, z, t, ...dir) - gustBand(x, z, t + GUST_PERIOD_S, ...dir)) < 1e-9);
  }
  // Crosswind positions at the same downwind coordinate differ only by the noise term.
  assert.notEqual(gustPhase(0, 0, 3, ...dir), gustPhase(0, 400, 3, ...dir));
});

test('band and level stay in range; a band covers roughly a fifth of the time; the level is never still', () => {
  let inside = 0, n = 0, low = 1, high = 0;
  for (let t = 0; t < 70; t += .05) {
    const band = gustBand(40, -30, t, .6, .8), level = gustLevel(40, -30, t, .6, .8);
    assert(band >= 0 && band <= 1 && level >= 0 && level <= 1);
    if (band > .01) inside++; n++; low = Math.min(low, level); high = Math.max(high, level);
  }
  const share = inside / n;
  assert(share > .12 && share < .32, `share ${share}`);
  assert(low >= .1 && low < .35 && high > .85, `level range ${low}..${high}`);
});

test('the GLSL twin is balanced, avoids reserved words and carries the same constants', () => {
  assert.equal((GUST_GLSL.match(/\(/g) || []).length, (GUST_GLSL.match(/\)/g) || []).length);
  assert.equal((GUST_GLSL.match(/\{/g) || []).length, (GUST_GLSL.match(/\}/g) || []).length);
  assert(!/\b(?:float|int|vec[234])\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(GUST_GLSL));
  assert(!/--\d|\d[a-zA-Z_]\w*\(/.test(GUST_GLSL.replace(/vec2|vec3|vec4/g, 'V')));
  for (const text of ['0.045', '0.9', '0.025', '0.65', 'smoothstep(0.55, 0.95']) assert(GUST_GLSL.includes(text), text);
  assert.match(GUST_GLSL, /float kzGustBand\(vec2 xz, float time, vec2 dir\)/);
});

// A 40x40 grid of 10 m cells centred on the origin: west half grass (2), east half forest floor (3), a paddy block and a sand strip.
function world() {
  const width = 40, height = 40, cell = 10, surface = new Uint8Array(width * height);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const x = (i - (width - 1) / 2) * cell, z = (j - (height - 1) / 2) * cell;
    surface[j * width + i] = z > 150 ? 0 : x < 0 ? (x < -120 && z < -120 ? 7 : 2) : 3;
  }
  const terrain = {
    riverDistanceAt: (x, z, reach = Infinity) => { const d = Math.abs(x + 60); return d > reach ? reach + 1 : d; },   // a river along x = -60
    seaDistanceAt: (x, z) => Math.max(0, 200 - z),                                                                  // the sea beyond z = 200
  };
  const housePoints = []; for (let k = 0; k < 16; k++) housePoints.push({ x: 90 + (k % 4) * 12, z: -90 + Math.floor(k / 4) * 12 });
  const places = [{ name: '寺', kind: 'temple', x: -150, y: 0 }, { name: '宮', kind: 'shrine', x: 150, y: 150 }, { name: '坂', kind: 'pass', x: 150, y: -150 }, { name: '浜', kind: 'coast', x: 0, y: -190 }];
  return { terrain, meta: { grid: { width, height, cell_m: cell }, surface: {}, places }, surface, housePoints };
}

test('ground weights follow the surface grid, sum to one and blend across a boundary', () => {
  const habitat = createHabitat(world());
  const meadow = habitat.at(-100, 0), forest = habitat.at(100, 0), edge = habitat.at(-2, 0);
  assert.equal(meadow.meadow, 1); assert.equal(forest.forest, 1);
  assert(edge.meadow >= .25 && edge.forest >= .25 && Math.abs(edge.meadow + edge.forest - 1) < 1e-9, JSON.stringify(edge));
  assert.equal(habitat.at(-160, -160).paddy, 1); assert.equal(habitat.at(0, 190).sand, 1);
  for (const [x, z] of [[-100, 0], [3, 148], [-125, -118], [77, -33]]) {
    const w = habitat.at(x, z);
    assert(Math.abs(w.meadow + w.forest + w.sand + w.paddy + w.bare + w.rock - 1) < 1e-9);
    for (const key of HABITAT_KEYS) assert(w[key] >= 0 && w[key] <= 1, `${key}=${w[key]}`);
  }
  assert.equal(habitatGround(meadow), 'meadow'); assert.equal(habitatGround(forest), 'forest');
});

test('river, shore, town and named places fall off with distance', () => {
  const habitat = createHabitat(world());
  assert.equal(habitat.at(-60, 0).river, 1); assert(Math.abs(habitat.at(-30, 0).river - .5) < 1e-9); assert.equal(habitat.at(60, 0).river, 0);
  assert.equal(habitat.at(0, 200).shore, 1); assert(Math.abs(habitat.at(0, 110).shore - .5) < 1e-9); assert.equal(habitat.at(0, 0).shore, 0);
  assert(habitat.at(108, -72).town > .5); assert.equal(habitat.at(-150, 150).town, 0);
  assert.equal(habitat.at(-150, 0).temple, 1); assert.equal(habitat.at(-150, HABITAT.placeCore).temple, 1);
  const mid = habitat.at(-150, (HABITAT.placeCore + HABITAT.placeReach) / 2).temple; assert(Math.abs(mid - .5) < 1e-9);
  assert.equal(habitat.at(-150, HABITAT.placeReach).temple, 0);
  assert.equal(habitat.at(150, -150).temple, 1, 'a shrine counts with the temples (north is -z)');
  assert.equal(habitat.at(150, 150).pass, 1); assert.equal(habitat.at(-190, -190).pass, 0);
});

test('nearestPlace returns the closest place of the asked kinds with its distance', () => {
  const habitat = createHabitat(world());
  assert.deepEqual(habitat.nearestPlace(-140, 0), { name: '寺', kind: 'temple', x: -150, z: 0, distance: 10 });
  assert.equal(habitat.nearestPlace(140, -140).name, '宮');
  assert.equal(habitat.nearestPlace(0, 0, ['pass']).name, '坂');
  assert.equal(habitat.nearestPlace(0, 0, ['coast']), null, 'only temples, shrines and passes are kept');
});

test('a world without the surface grid, houses or places answers with zeros instead of failing', () => {
  const habitat = createHabitat({ terrain: {}, meta: { grid: { width: 4, height: 4, cell_m: 10 } }, surface: null });
  const w = habitat.at(5, 5);
  for (const key of HABITAT_KEYS) assert.equal(w[key], 0, key);
  assert.equal(habitatGround(w), ''); assert.equal(habitat.nearestPlace(0, 0), null);
  assert.doesNotThrow(() => createHabitat().at(0, 0));
});

test('at() reuses the object it is given and both modules are pure', () => {
  const habitat = createHabitat(world()), out = {};
  assert.equal(habitat.at(10, 10, out), out); assert.deepEqual(Object.keys(out).sort(), [...HABITAT_KEYS].sort());
  for (const file of ['kamakura-gust.js', 'kamakura-habitat.js']) {
    const code = source(file).replace(/\/\/.*$/gm, '');
    for (const bad of [/from\s+'three/, /\bMath\.random\b/, /\bDate\.now\b/, /\bperformance\.now\b/, /\bdocument\./, /\bwindow\./]) assert(!bad.test(code), `${file} uses ${bad}`);
  }
});
