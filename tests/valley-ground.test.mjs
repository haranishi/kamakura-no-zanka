// 基準値は変更前に採取。保護域・外側の木・切り戻しを、独立した固定ハッシュでも照合する。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { WORLD } from '../dist/valley/world-data.js';
import { createTerrain, FORT_HILL, fortPeakHeight } from '../dist/valley/terrain-height.js';
import { scatterTrees, fortClearRadius, FORT_CLEAR } from '../dist/valley/scatter.js';
import { assignTreeSpecies } from '../dist/valley/tree-species.js';
import { riverLayout, riverFlags, fortOutcrops, fortPathEdge, FORT_GROUND } from '../dist/valley/river-rocks.js';
import { loadView, THREE } from './helpers/valley-view-modules.mjs';
const { buildTerrain, canopyBlendAt, canopyColorAt, CANOPY } = await loadView('terrain.js');
const { buildRiverDetails } = await loadView('water.js');
const terrain = createTerrain(), oldTerrain = createTerrain(WORLD, { fortShape: 0 }), peak = WORLD.peaks[0];
const trees = scatterTrees(WORLD, terrain), oldTrees = scatterTrees(WORLD, oldTerrain, { fort2: false });
const species = assignTreeSpecies(WORLD, terrain, trees);
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const keys = ['x', 'y', 'z', 's', 'rot', 'kind', 'tint'];
const rows = predicate => trees.x.flatMap((x, i) => predicate(x, trees.z[i]) ? [[...keys.map(k => trees[k][i]), species.species[i], species.stage[i]]] : []);
const inside = (x, z) => x >= -147 && x <= 114 && z >= -147 && z <= 124;
const compile = b => { const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader }; b.material.onBeforeCompile(shader); return shader; };
const dispose = b => { b.near.geometry.dispose(); b.far.geometry.dispose(); b.material.dispose(); };

test('保護域の1m格子71,264点の高さと879本の位置・種類は変更前と完全一致する', () => {
  const samples = [];
  for (let z = -147; z <= 124; z++) for (let x = -147; x <= 114; x++) {
    const h = terrain.heightAt(x, z); assert.equal(h, oldTerrain.heightAt(x, z)); samples.push(h);
    assert.equal(canopyBlendAt(WORLD, x, z), 0);
  }
  assert.equal(samples.length, 71264);
  assert.equal(hash(samples), '8030cd4052593302d74755145b9f5cf2e463411a787d69d3efc458040129d7bf');
  const protectedTrees = rows(inside); assert.equal(protectedTrees.length, 879);
  assert.equal(hash(protectedTrees), '430dc3398480f8ad47e03b5b3f7e9ee160cac7ffea1fa0f586b9d1400f6f08ca');
});

test('峰の頂は96mで固定、斜面は非円形。110m外の高さと全15,445本の位置・樹種は一致', () => {
  for (let z = peak.z - 24; z <= peak.z + 24; z++) for (let x = peak.x - 24; x <= peak.x + 24; x++) if (Math.hypot(x - peak.x, z - peak.z) <= peak.flatR) assert.equal(terrain.heightAt(x, z), peak.h);
  const ring = Array.from({ length: 32 }, (_, i) => { const a = Math.PI * 2 * i / 32; return fortPeakHeight(peak, peak.x + Math.cos(a) * 62, peak.z + Math.sin(a) * 62, WORLD.seed, WORLD.bounds); });
  assert(Math.max(...ring) - Math.min(...ring) > 8);
  for (let z = peak.z - 135; z <= peak.z + 135; z++) for (let x = peak.x - 135; x <= peak.x + 135; x++) if (Math.hypot(x - peak.x, z - peak.z) >= 110) assert.equal(terrain.heightAt(x, z), oldTerrain.heightAt(x, z));
  const outside = rows((x, z) => Math.hypot(x - peak.x, z - peak.z) > 110);
  assert.equal(outside.length, 15445); assert.equal(hash(outside), '362d1d8b6092a1f1591d1964324f7bf0fef7636997b7707f37fa8b17884c5638');
  assert.equal(FORT_HILL.shape, 1);
});

test('不規則な西の肩は北東より1.4倍以上広く、南西〜西の木は4割以下。元の衝突順を保つ', t => {
  const radii = Array.from({ length: 128 }, (_, i) => { const a = Math.PI * 2 * i / 128; return fortClearRadius(WORLD, peak, peak.x + Math.cos(a) * 70, peak.z + Math.sin(a) * 70); });
  assert(Math.max(...radii) / Math.min(...radii) >= 1.4);
  const west = data => data.x.filter((x, i) => x < peak.x && data.z[i] >= peak.z - 10 && Math.hypot(x - peak.x, data.z[i] - peak.z) < 95).length;
  assert(west(trees) / west(oldTrees) <= .4);
  const originals = new Map(oldTrees.x.map((x, i) => [`${x},${oldTrees.z[i]}`, i]));
  for (let i = 0; i < trees.x.length; i++) { const j = originals.get(`${trees.x[i]},${trees.z[i]}`); assert.notEqual(j, undefined); for (const k of keys.filter(k => k !== 'y')) assert.equal(trees[k][i], oldTrees[k][j]); }
  assert.equal(trees.fortRemoved, oldTrees.x.length - trees.x.length);
  t.diagnostic(JSON.stringify({ before: oldTrees.x.length, after: trees.x.length, removed: trees.fortRemoved, westBefore: west(oldTrees), westAfter: west(trees), radiusMin: Math.min(...radii), radiusMax: Math.max(...radii), keep: FORT_CLEAR.keep }));
});

test('露頭6〜12個は急斜面の草地。川・橋・砦の物は旗を切り替えても移動しない。道幅3〜3.5m', t => {
  const rocks = fortOutcrops(WORLD, terrain); assert(rocks.length >= 6 && rocks.length <= 12);
  assert.deepEqual(rocks, fortOutcrops(WORLD, terrain));
  for (const r of rocks) { assert(r.size >= 4 && r.size <= 12); assert(terrain.slopeAt(r.x, r.z) >= FORT_GROUND.slopeMin); assert(Math.hypot(r.x - peak.x, r.z - peak.z) < 110); }
  const before = riverLayout(WORLD, oldTerrain), after = riverLayout(WORLD, terrain);
  for (const k of ['rocks', 'foam', 'shoals', 'gates', 'fences', 'banners', 'towers', 'huts', 'path']) assert.deepEqual(after[k], before[k], k);
  assert.equal(riverLayout(WORLD, terrain, riverFlags('?fort2=0')).fortRocks.length, 0);
  assert(FORT_GROUND.pathWidth >= 3 && FORT_GROUND.pathWidth <= 3.5);
  for (let x = 190; x < 310; x++) for (const side of [-1, 1]) assert(Math.abs(fortPathEdge(x, -90, side) - FORT_GROUND.pathWidth / 2 * side) <= .4);
  t.diagnostic(JSON.stringify({ rocks: rocks.length, sizes: rocks.map(r => r.size), slopes: rocks.map(r => terrain.slopeAt(r.x, r.z)) }));
});

let built;
test('同一の樹冠地図を両メッシュで参照し、全ての縁頂点の色と材質重みが一致。近景は切り戻しと同色', t => {
  built = buildTerrain({ terrain, textures: {}, search: '?paddy=0' });
  const old = buildTerrain({ terrain: oldTerrain, textures: {}, search: '?canopy=0&fort2=0&paddy=0' });
  const s = compile(built), p = built.near.geometry.attributes.position, near = built.near.geometry.attributes, far = built.far.geometry.attributes;
  assert.equal(built.near.material, built.far.material);
  const farPoints = new Map(); for (let i = 0; i < far.position.count; i++) farPoints.set(`${far.position.getX(i)},${far.position.getZ(i)}`, i);
  let edgeVertices = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    if (inside(x, z)) for (const k of ['color', 'aS0', 'aS1']) for (let c = 0; c < 3; c++) assert.equal(near[k].array[i * 3 + c], old.near.geometry.attributes[k].array[i * 3 + c]);
    if ((x === -152 || x === 192 || z === -152 || z === 136) && farPoints.has(`${x},${z}`)) {
      const j = farPoints.get(`${x},${z}`); edgeVertices++;
      for (const k of ['color', 'aS0', 'aS1']) for (let c = 0; c < 3; c++) assert(Math.abs(near[k].array[i * 3 + c] - far[k].array[j * 3 + c]) < 1e-6);
    }
  }
  assert(edgeVertices > 100);
  let red = 0, green = 0;
  for (let z = -500; z <= 500; z += 20) for (let x = -500; x <= 500; x += 20) {
    const c = canopyColorAt(WORLD, terrain, x, z);
    if (c.weight < .8) continue;
    assert(c.color.r >= 0 && c.color.g > 0 && c.color.b >= 0);
    if (c.grove > .95) { assert(c.color.r / c.color.g > s.uniforms.uCedar.value.r / s.uniforms.uCedar.value.g); red++; }
    else if (c.grove < .01) { assert(Math.hypot(...c.color.toArray().map((v, i) => v - s.uniforms.uCedar.value.toArray()[i])) < .01); green++; }
  }
  assert(red > 5 && green > 50);
  const map = s.uniforms.uCanopyField.value; let disposed = 0; map.addEventListener('dispose', () => disposed++);
  const triangles = b => b.group.children.reduce((n, m) => n + m.geometry.index.count / 3, 0);
  assert.equal(triangles(built), triangles(old));
  assert.equal(compile(old).uniforms.uCanopy.value, 0); assert.equal(oldTerrain.fort2, false);
  t.diagnostic(JSON.stringify({ ...terrain.groundStats(), edgeVertices, redSamples: red, cedarSamples: green, terrainTriangles: triangles(built), terrainDraws: 2, buildMs: built.buildMs }));
  dispose(old); dispose(built); assert.equal(disposed, 1);
});

test('品質と自動調整は同じプログラムと地図のままセル探索を9から4へ減らす。QAへ数と旗が届く', () => {
  const b = buildTerrain({ terrain: createTerrain(), textures: {}, search: '?qa=1&canopydebug=1&fort2=0&paddy=0&w=1280' }), s = compile(b), key = b.material.customProgramCacheKey(), map = s.uniforms.uCanopyField.value;
  assert.equal(s.uniforms.uCanopyDebug.value, 1); assert.equal(s.uniforms.uFortGround.value, 0);
  assert.equal(built.material.customProgramCacheKey(), key);
  assert.equal(b.material.userData.uDetailU.value, 1); b.setQuality('light'); assert.equal(s.uniforms.uCanopyDetail.value, 0);
  b.setQuality('standard'); b.near.onBeforeRender({ getPixelRatio: () => .58 }); assert.equal(s.uniforms.uCanopyDetail.value, 0);
  b.near.onBeforeRender({ getPixelRatio: () => 1 }); assert.equal(s.uniforms.uCanopyDetail.value, 1); assert.equal(s.uniforms.uCanopyField.value, map);
  const offTrees = scatterTrees(WORLD, { ...oldTerrain, fort2: false }); assert.deepEqual(offTrees, oldTrees);
  dispose(b);
});

test('丘の露頭は追加1命令・800三角形以内で、軽量と自動調整は数を減らす。静止中は更新しない', t => {
  const v = buildRiverDetails({ world: WORLD, terrain }), records = [];
  for (const q of ['standard', 'light']) for (let adapt = 0; adapt < 4; adapt++) {
    v.select({ position: { x: 30, z: 180 } }, q, adapt);
    const r = v.group.getObjectByName('fort-outcrops'), s = v.stats();
    assert.equal(s.fortRocks, r.count); assert(r.count <= 10); assert(s.draws <= 6);
    const triangles = r.geometry.attributes.position.count / 3 * r.count; assert(triangles <= 800);
    records.push({ q, adapt, rocks: r.count, triangles, totalTriangles: s.triangles, totalDraws: s.draws });
    const version = r.instanceMatrix.version; for (let i = 0; i < 50; i++) v.select({ position: { x: 30, z: 180 } }, q, adapt); assert.equal(r.instanceMatrix.version, version);
  }
  t.diagnostic(JSON.stringify(records)); v.dispose();
});

const expand = source => source.replace(/#include <(\w+)>/g, (_, name) => { assert(Object.hasOwn(THREE.ShaderChunk, name), name); return expand(THREE.ShaderChunk[name]); });
test('実際のThree材質のGLSLは全旗・品質でコンパイルし、未宣言の名前は拒否する', t => {
  const available = spawnSync('glslc', ['--version'], { encoding: 'utf8' });
  if (available.error?.code === 'ENOENT') return t.skip('glslc unavailable');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'valley-ground-glsl-')); let stages = 0;
  const compileStage = (shader, stage, valid = true) => {
    const prefix = `#version 310 es\nprecision highp float;precision highp int;\n#define varying ${stage === 'vert' ? 'out' : 'in'}\n#define attribute in\n#define texture2D texture\n#define textureCube texture\n#define USE_COLOR\n#define OPAQUE\nuniform mat4 modelMatrix,modelViewMatrix,projectionMatrix,viewMatrix;uniform mat3 normalMatrix;uniform vec3 cameraPosition;uniform bool isOrthographic;\n${stage === 'vert' ? 'in vec3 position,normal,color;in vec2 uv;' : 'out vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\nvec4 linearToOutputTexel(vec4 v){return v;}'}\n`;
    const source = (prefix + expand(shader)).replace(/\baverage\b/g, 'threeAverage').replace(/\bNUM_\w+\b/g, '0');
    const file = path.join(dir, 'shader.' + stage); fs.writeFileSync(file, source);
    const result = spawnSync('glslc', ['--target-env=opengl', '-fauto-bind-uniforms', '-fauto-map-locations', file, '-o', path.join(dir, 'out.spv')], { encoding: 'utf8' });
    if (valid) assert.equal(result.status, 0, result.stderr); else assert.notEqual(result.status, 0); stages++;
  };
  try {
    for (const search of ['?canopy=0&fort2=0', '?canopydebug=1', '?fort2=0', '']) {
      const b = buildTerrain({ terrain: createTerrain(), textures: {}, search });
      const shader = compile(b);
      assert(!/\bfloat\s+sample\b/.test(shader.fragmentShader));
      for (const q of ['standard', 'light']) { b.setQuality(q); compileStage(shader.vertexShader, 'vert'); compileStage(shader.fragmentShader, 'frag'); }
      if (!search) compileStage(shader.fragmentShader.replace('gN = normalize(nw);', 'gN = missingCanopyName;'), 'frag', false);
      dispose(b);
    }
    t.diagnostic(JSON.stringify({ compiledStages: stages - 1, negativeChecks: 1, cell: CANOPY.cell }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
