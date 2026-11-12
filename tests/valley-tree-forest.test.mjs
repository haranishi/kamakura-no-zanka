// 斜面の群れ、任務に使う木の保護、切り戻し、色と影の段差を検査する。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { WORLD } from '../dist/valley/world-data.js';
import { shotOverride } from '../dist/valley/shots.js';
import { TREES } from '../dist/valley/config.js';
import { createTerrain } from '../dist/valley/terrain-height.js';
import { scatterTrees, mulberry32 } from '../dist/valley/scatter.js';
import { assignTreeSpecies, forestProtected, scatterUnderstory } from '../dist/valley/tree-species.js';
import { field, wind, camera, THREE, stubRenderer } from './helpers/tree-field.mjs';
import { load } from './helpers/tree-modules.mjs';
import { installQA } from '../dist/valley/qa.js';
const { forestColor } = await load('tree-view.js');
const terrain = Object.assign(createTerrain(WORLD, { fortShape: 0 }), { fort2: false }), trees = scatterTrees(WORLD, terrain, { fort2: false });
const start = performance.now(), assigned = assignTreeSpecies(WORLD, terrain, trees), assignmentMs = performance.now() - start;
const legacy = assignTreeSpecies(WORLD, terrain, trees, { forest2: false });
const outside = [...trees.x.keys()].filter(i => trees.x[i] < -147 || trees.x[i] > 114 || trees.z[i] < -147 || trees.z[i] > 124);
const broad = i => [1, 3].includes(assigned.species[i]);
const digest = a => createHash('sha256').update(Buffer.from(a)).digest('hex');
const matrixAt = (s, k) => Array.from(s.leaf.instanceMatrix.array.slice(k * 16, k * 16 + 16));
function rows(f, level) {
  const result = new Map();
  for (const set of f.sets) if (set.level === level) for (let k = 0; k < set.leaf.count; k++) {
    const m = matrixAt(set, k), key = `${m[12]},${m[14]}`;
    result.set(key, { sp: set.species, shape: set.shape, matrix: m, color: Array.from(set.leaf.instanceColor.array.slice(k * 3, k * 3 + 3)), age: set.leaf.geometry.attributes.aForestAge?.array[k] ?? 0 });
  }
  return result;
}
function qa(f) { globalThis.window = {}; return installQA({ veg: { trees: f }, input: {} }, {}).treeStats(); }
function make(quality = 'standard', options = {}) { return field([], { data: trees, species: assigned, wind, quality, renderer: stubRenderer(), ...options }); }

test('forest: protected 879 trunks and the complete disabled drawing retain the previous data', () => {
  assert.equal(trees.x.length, 15830); assert.equal(outside.length, 14951);
  const oldHash = digest(legacy.species) + digest(legacy.stage);
  // Frozen from the unmodified species calculation, covering all 15,830 instances.
  assert.equal(oldHash, '8087537d16fb571073f3290da81189c0c254b2666352d5d36dee189bf4b4460d26b8a90dcb084eaab9fa8ffc48ac9dfa49d57ae859da937f28915346d3b0bab2');
  for (let i = 0; i < trees.x.length; i++) {
    const protectedTree = !outside.includes(i);
    assert.equal(forestProtected(WORLD, trees.x[i], trees.z[i]), protectedTree);
    if (!protectedTree) continue;
    assert.equal(assigned.outside[i], 0); assert.equal(assigned.species[i], legacy.species[i]); assert.equal(assigned.stage[i], legacy.stage[i]);
    assert.equal(assigned.height[i], 1); assert.equal(assigned.width[i], 1); assert.equal(assigned.old[i], 0);
  }
  const off = make('standard', { forest2: false }), old = field([], { data: trees, species: legacy, renderer: stubRenderer() });
  const on = make();
  for (const at of [[-50, 110], [-100.5, -89], [-36, -48]]) {
    off.update(camera(...at), true); old.update(camera(...at), true); on.update(camera(...at), true);
    for (const level of [0, 1, 2]) {
      assert.deepEqual(rows(off, level), rows(old, level));
      const modern = rows(on, level);
      for (const [key, r] of rows(old, level)) {
        const x = r.matrix[12], z = r.matrix[14];
        if (x >= -147 && x <= 114 && z >= -147 && z <= 124) assert.deepEqual(modern.get(key), r);
      }
    }
  }
  // The flag is read at construction, including when both flags are present.
  globalThis.location = { search: '?forest2=0&forest2debug=1' };
  const urlOff = make(); assert.equal(urlOff.forest, null); assert.equal(urlOff.forestDebug, false);
  delete globalThis.location;
  for (const f of [off, old, on, urlOff]) f.dispose();
});

test('forest: ratios, nearest-neighbour clustering, adjacent grove tones and visible-cone count', t => {
  const s = assigned.summary, n = s.outside;
  assert((s.after[1] + s.after[3]) / n >= .18 && (s.after[1] + s.after[3]) / n <= .28);
  assert(s.after[2] / n >= .04 && s.after[2] / n <= .08);
  assert(s.old / s.after[0] >= .03 && s.old / s.after[0] <= .06);
  const bins = new Map(), tones = new Map(), visible = new Set(), projected = new Set(), allTones = new Set();
  const shot = shotOverride('concept', terrain), cam = new THREE.PerspectiveCamera(shot.fov, 1672 / 941, .15, 2200);
  cam.position.set(...shot.pos); cam.lookAt(...shot.look); cam.updateMatrixWorld();
  for (const i of outside) {
    const key = `${Math.floor(trees.x[i] / 25)},${Math.floor(trees.z[i] / 25)}`;
    if (!bins.has(key)) bins.set(key, []); bins.get(key).push(i);
    if (broad(i)) {
      const id = assigned.cluster[i]; if (!tones.has(id)) tones.set(id, new Set()); tones.get(id).add(assigned.tone[i]); allTones.add(assigned.tone[i]);
      const dx = trees.x[i] + 50, dz = trees.z[i] - 110, r = Math.hypot(dx, dz);
      if (r < 500 && (dx * 62 - dz * 190) / (Math.hypot(62, 190) * r) > Math.cos(.65)) visible.add(id);
      const top = new THREE.Vector3(trees.x[i], trees.y[i] + (assigned.species[i] === 3 ? 8 : 12) * trees.s[i], trees.z[i]).project(cam);
      if (r < 500 && Math.abs(top.x) <= 1 && Math.abs(top.y) <= 1 && top.z > 0 && top.z < 1) projected.add(id);
      assert(terrain.slopeAt(trees.x[i], trees.z[i], 1.5) < 56); assert(trees.y[i] < 280);
    }
  }
  for (const stages of tones.values()) assert(Math.max(...stages) - Math.min(...stages) <= 1);
  assert(allTones.size >= 3); assert(visible.size >= 12 && visible.size <= 25); assert(projected.size >= 12 && projected.size <= 25);
  const pairs = [];
  for (const i of outside) {
    const ix = Math.floor(trees.x[i] / 25), iz = Math.floor(trees.z[i] / 25); let best = 625, j = -1;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const k of bins.get(`${ix + dx},${iz + dz}`) ?? []) {
      const d = (trees.x[k] - trees.x[i]) ** 2 + (trees.z[k] - trees.z[i]) ** 2;
      if (k !== i && d < best) { j = k; best = d; }
    }
    if (j >= 0) pairs.push([i, j]);
  }
  const rate = labels => { const p = pairs.filter(([i]) => labels[i]); return p.filter(([, j]) => labels[j]).length / p.length; };
  const labels = Array.from(trees.x, (_, i) => broad(i)), shuffled = labels.slice(), rng = mulberry32(46137);
  for (let k = outside.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [shuffled[outside[k]], shuffled[outside[j]]] = [shuffled[outside[j]], shuffled[outside[k]]]; }
  const clustered = rate(labels), random = rate(shuffled); assert(clustered >= 2 * random);
  t.diagnostic(JSON.stringify({ ...s, assignmentMs, clustered, shuffled: random, conceptHorizontalGroves: visible.size, conceptProjectedGrovesUnder500m: projected.size, tones: [...allTones].sort() }));
});

test('forest: cedar dimensions have independent width, habitat response and sufficient height variance', t => {
  const cedar = outside.filter(i => assigned.species[i] === 0 && !assigned.old[i]);
  const heights = cedar.map(i => assigned.height[i]), mean = heights.reduce((a, b) => a + b) / heights.length;
  const variance = heights.reduce((v, h) => v + (h - mean) ** 2, 0) / heights.length;
  assert(Math.sqrt(variance) / mean >= .15);
  for (const i of outside.filter(i => assigned.species[i] === 0)) {
    const old = assigned.old[i], h = assigned.height[i], w = assigned.width[i] / (old ? 1.45 : 1);
    assert(h >= (old ? 1.5 : .7) - 1e-6 && h <= (old ? 1.9 : 1.45) + 1e-6);
    assert(w >= .8 - 1e-6 && w <= 1.25 + 1e-6);
  }
  const wm = cedar.reduce((v, i) => v + assigned.width[i], 0) / cedar.length;
  const covariance = cedar.reduce((v, i) => v + (assigned.height[i] - mean) * (assigned.width[i] - wm), 0) / cedar.length;
  assert(Math.abs(covariance) < .004, 'width must not be derived from height');
  t.diagnostic(JSON.stringify({ cedarHeightRange: [Math.min(...heights), Math.max(...heights)], cedarHeightCV: Math.sqrt(variance) / mean, heightWidthCovariance: covariance }));
});

test('forest: reorder/insertion, quality and LOD do not change autumn colour or dimensions', () => {
  const order = [0, 111, 1214, 7000, 14000], subset = Object.fromEntries(Object.entries(trees).map(([k, a]) => [k, order.map(i => a[i])]));
  const derived = assignTreeSpecies(WORLD, terrain, subset);
  for (const k of ['species', 'stage', 'outside', 'old', 'tone', 'cluster', 'height', 'width', 'brightness', 'hue', 'blue']) order.forEach((i, j) => assert.equal(derived[k][j], assigned[k][i], k));
  assert.deepEqual(assignTreeSpecies(WORLD, terrain, trees), assigned);
  const picks = outside.filter((i, n) => n % 32 === 0), d = Object.fromEntries(Object.entries(trees).map(([k, a]) => [k, picks.map(i => a[i])]));
  const a = assignTreeSpecies(WORLD, terrain, d), snapshots = [];
  for (const quality of ['standard', 'light']) {
    const f = field([], { data: d, species: a, quality, renderer: stubRenderer() });
    // Force every individual through an overlap band without changing their position-based attributes.
    const i = picks.findIndex(i => assigned.old[i]); assert(i >= 0, 'old cedar fixture is required');
    const at = [d.x[i], d.z[i]];
    f.update(camera(at[0] + (quality === 'light' ? 100 : 150), at[1]), true);
    const mid = rows(f, 1), far = rows(f, 2);
    let overlap = 0; for (const [key, r] of mid) if (far.has(key)) { assert.deepEqual(far.get(key), r); overlap++; }
    assert(overlap > 0, 'LOD overlap fixture is required');
    snapshots.push(f.forestColors); f.dispose();
  }
  assert.deepEqual(snapshots[0], snapshots[1]);
  for (let sp of [1, 3]) for (let tone = 0; tone < 5; tone++) {
    const source = forestColor(sp, tone), shifted = forestColor(sp, tone, 1, .06);
    const max = Math.max(...[...TREES.palette.maple, ...TREES.palette.zelkova].map(v => new THREE.Color(v).getHSL({}).s));
    assert(shifted.getHSL({}).s <= max + 1e-6); assert(Math.abs(source.getHSL({}).s - shifted.getHSL({}).s) < 1e-6);
  }
});

test('forest: four-site and concept budgets, fixed bake cost, QA and adaptive reductions', t => {
  const sites = [[-100.5, -89, 1328534 * .7], [-5, 2.2, 1087372 * .7], [-6, 20, 1056502 * .7], [-36, -48, 1278092 * .7], [-50, 110, 1000000]];
  const understory = scatterUnderstory(WORLD, terrain, trees);
  const measured = [];
  for (const quality of ['standard', 'light']) {
    const renderer = stubRenderer(); let ratio = 1.5; renderer.getPixelRatio = () => ratio;
    const f = make(quality, { renderer, understory });
    assert.equal(renderer.calls.filter(c => c[0] === 'render').length, 2); assert.equal(f.impostors.families.length, 13);
    for (const [x, z, limit] of sites) {
      const now = performance.now(); f.update(camera(x, z), true); const ms = performance.now() - now, q = qa(f);
      const calls = f.sets.reduce((n, s) => n + [s.leaf, s.wood].filter(m => m?.count).length, 0);
      assert(q.total <= limit); assert(calls <= 77); assert(f.group.children.length <= 90);
      assert.deepEqual(q.stats.forest2.after, assigned.summary.after); assert.equal(q.stats.forest2.triangles, q.total); assert.equal(q.stats.forest2.calls, calls);
      measured.push({ quality, x, z, triangles: q.total, calls, updateMs: ms });
    }
    let prev = Infinity;
    for (const scale of [1, .85, .7, .58]) {
      ratio = 1.5 * scale; f.update(camera(-50, 110));
      const q = qa(f); assert(q.total < prev); prev = q.total;
      assert.deepEqual(q.stats.forest2.after, assigned.summary.after);
      measured.push({ quality, adaptive: scale, triangles: q.total, drawn: q.stats.near + q.stats.mid + q.stats.far });
    }
    f.dispose();
  }
  t.diagnostic(JSON.stringify(measured));
});

const expand = s => s.replace(/#include <(\w+)>/g, (_, k) => { assert.equal(typeof THREE.ShaderChunk[k], 'string', k); return expand(THREE.ShaderChunk[k]); });
function balance(s) {
  const code = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''), stack = [];
  for (const c of code) if ('([{'.includes(c)) stack.push(c); else if (')]}'.includes(c)) assert.equal(stack.pop(), '([{'[')]}'.indexOf(c)]);
  assert.equal(stack.length, 0);
  assert.doesNotMatch(code, /\b(?:float|int|vec[234])\s+(?:input|output|sample|filter|active|common|resource)\b/);
}
function shaderFor(material, depth = false) {
  const lib = THREE.ShaderLib[depth ? 'depth' : 'lambert'];
  const s = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
  material.onBeforeCompile(s); return s;
}

test('forest: debug colours, old crown/branch/depth cut and all bundled shader anchors', () => {
  globalThis.location = { search: '?forest2debug=1' };
  const f = make(); delete globalThis.location;
  f.update(camera(-50, 110), true);
  assert(f.forestDebug);
  for (const set of f.sets) for (const mesh of [set.leaf, set.wood]) if (mesh) {
    const a = mesh.geometry.getAttribute('aForestAge'); assert(a && a.count === set.capacity);
    for (let k = 0; k < mesh.count; k++) {
      const expected = new THREE.Color(TREES.forest2.debug[a.array[k] ? 4 : set.species]);
      assert.deepEqual(Array.from(mesh.instanceColor.array.slice(k * 3, k * 3 + 3)), expected.toArray().map(Math.fround));
    }
    for (const depth of [false, true]) {
      const material = depth ? mesh.customDepthMaterial : mesh.material; if (!material) continue;
      const s = shaderFor(material, depth);
      assert(s.vertexShader.includes('vForestAge = aForestAge;'));
      assert(s.fragmentShader.includes('vForestHeight < 10.00'));
      assert.equal(s.fragmentShader.includes('gl_FragColor.rgb = vForestDebug'), !depth);
      if (set.impostor) assert(s.fragmentShader.includes('&& impNormal.a > .5'));
      for (const code of [s.vertexShader, s.fragmentShader]) { balance(code); balance(expand(code)); }
    }
  }
  const off = make('standard', { forest2: false });
  for (const set of off.sets) {
    assert(!set.leaf.geometry.getAttribute('aForestAge'));
    const s = shaderFor(set.leaf.material); assert(!s.vertexShader.includes('aForestAge')); assert(!s.fragmentShader.includes('vForestDebug'));
  }
  off.dispose(); f.dispose();
});

test('forest: glslc compiles actual Lambert, board and depth programs in both qualities and debug modes', t => {
  if (spawnSync('glslc', ['--version']).error?.code === 'ENOENT') return t.skip('glslc unavailable; static validation still runs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-forest-glsl-')); let compiled = 0;
  const prefix = stage => `#version 310 es
    precision highp float; precision highp int;
    #define varying ${stage === 'vert' ? 'out' : 'in'}
    #define attribute in
    #define texture2D texture
    #define textureCube texture
    #define texture2DGradEXT textureGrad
    #define average threeCompilerAverage
    #define HIGH_PRECISION
    #define USE_COLOR
    #define USE_INSTANCING
    #define USE_INSTANCING_COLOR
    #define USE_FOG
    #define FOG_EXP2
    #define USE_SHADOWMAP
    #define SHADOWMAP_TYPE_PCF_SOFT
    #define OPAQUE
    uniform mat4 modelMatrix,modelViewMatrix,projectionMatrix,viewMatrix;
    uniform mat3 normalMatrix; uniform vec3 cameraPosition; uniform bool isOrthographic;
    ${stage === 'vert' ? 'in vec3 position,normal,color,instanceColor; in mat4 instanceMatrix; in vec2 uv;' : 'out vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\nvec4 linearToOutputTexel(vec4 v){return v;}'}
  `;
  try {
    for (const quality of ['standard', 'light']) for (const debug of [false, true]) {
      const f = make(quality, { forest2debug: debug });
      try {
        // One family per species exercises identical generated programs without recompiling all shape duplicates.
        for (const set of f.sets.filter(s => s.shape === 0)) for (const mesh of [set.leaf, set.wood]) if (mesh) for (const depth of [false, true]) {
          const m = depth ? mesh.customDepthMaterial : mesh.material; if (!m) continue;
          const s = shaderFor(m, depth);
          for (const [property, stage] of [['vertexShader', 'vert'], ['fragmentShader', 'frag']]) {
            let defs = depth ? '#define DEPTH_PACKING 3201\n' : '';
            if (mesh.material.map) defs += '#define USE_MAP\n#define MAP_UV uv\n#define USE_ALPHATEST\n';
            if (!depth && m.normalMap) defs += '#define USE_NORMALMAP\n#define USE_NORMALMAP_TANGENTSPACE\n#define NORMALMAP_UV uv\n';
            let body = expand(s[property]).replace(/\bNUM_\w+\b/g, n => ['NUM_DIR_LIGHTS', 'NUM_DIR_LIGHT_SHADOWS'].includes(n) ? '1' : '0');
            body = body.replace(/#pragma unroll_loop_start\s+for\s*\(\s*int i = (\d+); i < (\d+); i \+\+\s*\)\s*\{([\s\S]+?)\}\s+#pragma unroll_loop_end/g, (_, a, b, snippet) => {
              let out = ''; for (let i = +a; i < +b; i++) out += snippet.replace(/\[\s*i\s*\]/g, `[${i}]`).replace(/UNROLLED_LOOP_INDEX/g, String(i)); return out;
            });
            const file = path.join(dir, 'tree.' + stage); fs.writeFileSync(file, prefix(stage) + defs + body);
            const r = spawnSync('glslc', ['--target-env=opengl', '-fauto-bind-uniforms', '-fauto-map-locations', file, '-o', path.join(dir, 'tree.spv')], { encoding: 'utf8' });
            assert.equal(r.status, 0, `${quality} debug=${debug} ${set.species}/${set.level} ${mesh === set.leaf ? 'leaf' : 'wood'} depth=${depth} ${stage}: ${r.stderr}`); compiled++;
          }
        }
      } finally { f.dispose(); }
    }
    const file = path.join(dir, 'bad.frag'); fs.writeFileSync(file, prefix('frag') + 'void main(){gl_FragColor=vec4(undeclaredForest); }');
    assert.notEqual(spawnSync('glslc', ['--target-env=opengl', '-fauto-map-locations', '-fauto-bind-uniforms', file, '-o', path.join(dir, 'bad.spv')]).status, 0);
    t.diagnostic(JSON.stringify({ compiledStages: compiled, negativeChecks: 1 }));
  } finally { fs.rmSync(dir, { recursive: true }); }
});
