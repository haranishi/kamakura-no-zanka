// Baseline sums and counts were captured before changing either density or tree placement. They are compared within a
// tolerance (heights pass through Math.pow, whose last bit differs between CPU architectures: a SHA-256 of the values,
// taken on arm64, does not hold on the x64 CI runner). Exact comparisons are made at run time, against the path with the flag off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WORLD } from '../dist/valley/world-data.js';
import { TREES } from '../dist/valley/config.js';
import { createTerrain, forestPatchAt } from '../dist/valley/terrain-height.js';
import { scatterTrees, inSightline, fortTreeRemoved } from '../dist/valley/scatter.js';
import { assignTreeSpecies, forestProtected, protectedAutumnOrder, scatterUnderstory } from '../dist/valley/tree-species.js';
import { field, camera, stubRenderer, THREE } from './helpers/tree-field.mjs';
import { installQA } from '../dist/valley/qa.js';
const near = (actual, expected, tolerance, name) => assert(Math.abs(actual - expected) <= tolerance, `${name}: ${actual} against ${expected}`);
const total = a => a.reduce((v, x) => v + x, 0);
const keys = ['x', 'y', 'z', 's', 'rot', 'kind', 'tint'];
const oldTerrain = createTerrain(), terrain = createTerrain(WORLD, { forest3: true });
const before = scatterTrees(WORLD, oldTerrain), beforeSpecies = assignTreeSpecies(WORLD, oldTerrain, before);
const start = performance.now(), trees = scatterTrees(WORLD, terrain), scatterMs = performance.now() - start;
const assigned = assignTreeSpecies(WORLD, terrain, trees);
const rows = (d, a) => d.x.map((_, i) => [...keys.map(k => d[k][i]), a.species[i], a.stage[i]]);
const mean = a => a.reduce((v, x) => v + x, 0) / a.length;
const protectedRows = (d, a) => rows(d, a).filter(r => forestProtected(WORLD, r[0], r[2]));

test('forest3: protected height/density grid and all trunk/collider inputs match frozen pre-change values', () => {
  const samples = [];
  for (let z = -147; z <= 124; z++) for (let x = -147; x <= 114; x++) {
    assert.equal(terrain.heightAt(x, z), oldTerrain.heightAt(x, z));
    assert.equal(terrain.forestDensity(x, z), oldTerrain.forestDensity(x, z));
    samples.push([terrain.heightAt(x, z), terrain.forestDensity(x, z)]);
  }
  assert.equal(samples.length, 71264);
  near(total(samples.map(s => s[0])), 596858.3055045274, 1e-6, 'protected heights'); near(total(samples.map(s => s[1])), 29790.738257721317, 1e-6, 'protected density');
  const protectedTrees = protectedRows(trees, assigned);
  assert.equal(protectedTrees.length, 879);
  assert.deepEqual(protectedTrees, protectedRows(before, beforeSpecies));
  assert.equal(before.x.length, 15717);
  near(total(before.x), -69367.06821594901, 1e-6, 'x'); near(total(before.z), -38477.20722097193, 1e-6, 'z'); near(total(before.y), 2255910.8083007834, 1e-4, 'y'); near(total(before.s), 17372.248565551203, 1e-6, 'size');
  const census = [0, 0, 0, 0]; for (const k of beforeSpecies.species) census[k]++;
  assert.deepEqual(census, [11030, 1869, 977, 1841]); assert.equal(total(Array.from(beforeSpecies.stage)), 2000081);
  const disabled = scatterTrees(WORLD, terrain, { forest3: false });
  assert.deepEqual(disabled, before);
  for (let z = -640; z <= 640; z += 16) for (let x = -640; x <= 640; x += 16) assert.equal(terrain.heightAt(x, z), oldTerrain.heightAt(x, z));
});

test('forest3: dense/sparse/open area, total count, empty openings and preserved sightlines', t => {
  const s = trees.forest3, a = s.area;
  // Seen on the real screen, the first shares (dense 49%, sparse 33%, open 19%, one opening in every 120 m cell) read as hills
  // dotted with tree clumps, not as a deep wooded valley. Most of the forest stays dense; openings are few, small and irregular.
  assert(a.dense >= .72 && a.dense <= .88);
  assert(a.sparse >= .08 && a.sparse <= .2);
  assert(a.open >= .03 && a.open <= .09);
  assert(trees.x.length >= before.x.length * .88 && trees.x.length <= before.x.length * .98);
  const counts = [0, 0];
  for (let i = 0; i < trees.x.length; i++) {
    const x = trees.x[i], z = trees.z[i], p = forestPatchAt(WORLD, x, z);
    assert.notEqual(p.zone, 2, `trunk in opening: ${x},${z}`);
    if (p.zone < 0) continue;
    counts[p.zone]++;
    assert(!inSightline(WORLD, x, z)); assert(!fortTreeRemoved(WORLD, x, z));
  }
  assert(counts[0] / a.dense > counts[1] / a.sparse * 1.7);
  const originalCounts = [0, 0, 0];
  before.x.forEach((x, i) => { const zone = forestPatchAt(WORLD, x, before.z[i]).zone; if (zone >= 0) originalCounts[zone]++; });
  const denseSpacing = Math.sqrt(originalCounts[0] / counts[0]);
  assert(denseSpacing >= .7 && denseSpacing <= 1.02, String(denseSpacing));
  assert(counts[1] / originalCounts[1] >= .4 && counts[1] / originalCounts[1] <= .6);
  assert(s.openings > 30, String(s.openings));
  assert.deepEqual(scatterTrees(WORLD, terrain), trees);
  t.diagnostic(JSON.stringify({ ...s, scatterMs, counts, originalCounts, denseSpacing }));
});

test('forest3: openings are separate irregular 12–90m patches, excluding clipped boundary fragments', t => {
  const n = 321, step = 4, cells = new Uint8Array(n * n), seen = new Uint8Array(n * n), patches = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) cells[j * n + i] = forestPatchAt(WORLD, -640 + i * step, -640 + j * step).zone === 2 ? 1 : 0;
  for (let k = 0; k < cells.length; k++) if (cells[k] && !seen[k]) {
    const queue = [k]; seen[k] = 1; let minX = n, maxX = 0, minZ = n, maxZ = 0, clipped = false;
    for (let q = 0; q < queue.length; q++) {
      const p = queue[q], i = p % n, j = Math.floor(p / n);
      minX = Math.min(minX, i); maxX = Math.max(maxX, i); minZ = Math.min(minZ, j); maxZ = Math.max(maxZ, j);
      for (const next of [i ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p - n, p + n]) {
        if (next < 0 || next >= cells.length) { clipped = true; continue; }
        const x = -640 + next % n * step, z = -640 + Math.floor(next / n) * step;
        if (forestProtected(WORLD, x, z)) clipped = true;
        if (!seen[next] && cells[next]) { seen[next] = 1; queue.push(next); }
      }
    }
    if (!clipped) patches.push({ span: (Math.max(maxX - minX, maxZ - minZ) + 1) * step, ratio: (maxX - minX + 1) / (maxZ - minZ + 1) });
  }
  assert(patches.length > 25, String(patches.length));
  assert(patches.every(p => p.span >= 12 && p.span <= 90), JSON.stringify(patches.filter(p => p.span < 12 || p.span > 90)));
  assert(patches.filter(p => Math.abs(p.ratio - 1) > .1).length > patches.length * .3, 'openings must not all be circular stamps');
  t.diagnostic(JSON.stringify({ fullOpenings: patches.length, span: [Math.min(...patches.map(p => p.span)), Math.max(...patches.map(p => p.span))] }));
});

test('forest3: dense centres are taller, sparse trees are young and have more pine/autumn', t => {
  const core = [], edge = [], count = [0, 0], mixed = [0, 0];
  for (let i = 0; i < trees.x.length; i++) {
    const p = forestPatchAt(WORLD, trees.x[i], trees.z[i]), sp = assigned.species[i];
    if (p.zone < 0) continue;
    count[p.zone]++; if (sp !== 0) mixed[p.zone]++;
    if (p.zone === 1) { assert(assigned.height[i] >= .55 - 1e-6 && assigned.height[i] <= .9 + 1e-6); assert.equal(assigned.old[i], 0); }
    if (p.zone === 0 && sp === 0 && !assigned.old[i]) {
      if (p.core > .75) core.push(assigned.height[i]);
      if (p.core < .2) edge.push(assigned.height[i]);
    }
  }
  assert(core.length > 100 && edge.length > 100); assert(mean(core) / mean(edge) >= 1.15);
  assert(mixed[1] / count[1] > mixed[0] / count[0]);
  t.diagnostic(JSON.stringify({ centreHeight: mean(core), edgeHeight: mean(edge), heightRatio: mean(core) / mean(edge), mixedRatios: mixed.map((v, i) => v / count[i]), species: assigned.summary.after }));
});

test('forest3: five village tones break triples along a nearest walk without changing protected geometry', () => {
  const order = protectedAutumnOrder(WORLD, trees, assigned.species), tones = new Set();
  assert(order.length > 80);
  for (let j = 0; j < order.length; j++) {
    const i = order[j], tone = assigned.tone[i]; tones.add(tone);
    if (j >= 2) assert(!(assigned.tone[order[j - 1]] === tone && assigned.tone[order[j - 2]] === tone));
    assert.equal(assigned.protectedColor[i], 1);
    assert.equal(assigned.height[i], 1); assert.equal(assigned.width[i], 1);
  }
  assert.equal(tones.size, 5);
  const reversed = Object.fromEntries(Object.entries(trees).map(([k, a]) => [k, a.slice().reverse()]));
  const a = assignTreeSpecies(WORLD, terrain, reversed);
  for (const k of ['species', 'stage', 'height', 'width', 'tone', 'brightness', 'hue', 'protectedColor']) assert.deepEqual(Array.from(a[k]).reverse(), Array.from(assigned[k]), k);
});

function snapshot(f, level, protectedOnly = false, wood = false) {
  const rows = new Map();
  for (const s of f.sets) if (s.level === level) {
    const mesh = wood ? s.wood : s.leaf; if (!mesh) continue;
    for (let k = 0; k < mesh.count; k++) {
      const m = Array.from(mesh.instanceMatrix.array.slice(k * 16, k * 16 + 16));
      if (protectedOnly && !forestProtected(WORLD, m[12], m[14])) continue;
      rows.set(`${m[12]},${m[14]}`, { sp: s.species, matrix: m, color: Array.from(mesh.instanceColor.array.slice(k * 3, k * 3 + 3)) });
    }
  }
  return rows;
}

test('forest3: standard/light/automatic budgets, far boards, QA, debug and unchanged protected trunks', t => {
  const underBefore = scatterUnderstory(WORLD, oldTerrain, before), under = scatterUnderstory(WORLD, terrain, trees), measured = [];
  const sites = [[-100.5, -89], [-5, 2.2], [-6, 20], [-36, -48], [30, 180]];
  for (const quality of ['standard', 'light']) {
    const renderer = stubRenderer(); let ratio = 1.5; renderer.getPixelRatio = () => ratio;
    const f = field([], { data: trees, species: assigned, understory: under, quality, renderer });
    const old = field([], { data: before, species: beforeSpecies, understory: underBefore, quality, renderer: stubRenderer() });
    assert.equal(f.impostors.families.length, 13); assert.equal(renderer.calls.filter(c => c[0] === 'render').length, 2);
    for (const [x, z] of sites) {
      f.update(camera(x, z), true); old.update(camera(x, z), true);
      const tris = field => field.sets.reduce((n, s) => n + [s.leaf, s.wood].reduce((v, m) => v + (m?.count ?? 0) * (m?.geometry.index.count ?? 0) / 3, 0), 0);
      const calls = field => field.sets.reduce((n, s) => n + [s.leaf, s.wood].filter(m => m?.count).length, 0);
      assert(tris(f) <= (quality === 'standard' ? 1328534 * .7 : 414556)); assert(calls(f) <= calls(old));
      for (const level of [0, 1]) for (const [key, r] of snapshot(old, level, true, true)) {
        if (r.sp >= 4) continue;
        assert.deepEqual(snapshot(f, level, true, true).get(key), r);
      }
      const protectedFar = snapshot(f, 2, true), oldFar = snapshot(old, 2, true);
      assert.deepEqual([...protectedFar.keys()].sort(), [...oldFar.keys()].sort());
      for (const [key, r] of oldFar) assert.deepEqual(protectedFar.get(key).matrix, r.matrix);
      // Both LODs get exactly the same instance tint and scale in their overlap.
      const mid = snapshot(f, 1), far = snapshot(f, 2);
      for (const [key, r] of mid) if (far.has(key)) {
        const [tx, tz] = key.split(',').map(Number);
        if (forestProtected(WORLD, tx, tz) && [0, 2].includes(r.sp)) continue; // Retain the previous far-conifer brightness jitter.
        assert.deepEqual(far.get(key), r);
      }
      globalThis.window = {};
      const qa = installQA({ veg: { trees: f }, input: {} }, {}).treeStats();
      assert.deepEqual(qa.stats.forest3.area, trees.forest3.area); assert.equal(qa.stats.forest3.after, trees.x.length);
      measured.push({ quality, x, z, before: tris(old), after: tris(f), callsBefore: calls(old), callsAfter: calls(f) });
    }
    let prev = Infinity;
    for (const scale of [1, .85, .7, .58]) {
      ratio = 1.5 * scale; f.update(camera(30, 180), true);
      assert(f.stats.forest2.triangles < prev); prev = f.stats.forest2.triangles;
      measured.push({ quality, adaptive: scale, triangles: prev });
    }
    old.dispose(); f.dispose();
  }
  // Turning off the previous forest layer also turns off village recolouring.
  const legacy = assignTreeSpecies(WORLD, oldTerrain, before, { forest2: false });
  const raw = field([], { data: before, species: legacy, forest2: false, renderer: stubRenderer() });
  const off = field([], { data: trees, species: assigned, forest2: false, renderer: stubRenderer() });
  for (const at of [[-100.5, -89], [-6, 20], [-36, -48]]) {
    raw.update(camera(...at), true); off.update(camera(...at), true);
    for (const level of [0, 1]) assert.deepEqual(snapshot(off, level, true), snapshot(raw, level, true));
  }
  off.dispose(); raw.dispose();
  const debug = field([], { data: trees, species: assigned, renderer: stubRenderer(), forest3debug: true });
  debug.update(camera(30, 180), true);
  for (const [key, r] of snapshot(debug, 2)) {
    const [x, z] = key.split(',').map(Number), zone = forestPatchAt(WORLD, x, z).zone;
    if (zone < 0) continue;
    assert.deepEqual(r.color, new THREE.Color(TREES.forest3.debug[zone]).toArray().map(Math.fround));
  }
  debug.dispose(); t.diagnostic(JSON.stringify(measured));
});
