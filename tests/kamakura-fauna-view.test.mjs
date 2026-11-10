import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.min.js';
import { createKamakuraFauna } from '../dist/valley/kamakura-fauna-view.js';
import { FAUNA, flockCell } from '../dist/valley/kamakura-fauna.js';
import { load } from './helpers/tree-modules.mjs';
const { installFog } = await load('atmosphere.js');

function context(search = '?debug=1', quality = 'standard') {
  const outRefs = new Set();
  return { search, quality, scene: new THREE.Scene(), hero: { pos: { x: 1000, y: 0, z: 1000 }, speed: 0 },
    sunDir: new THREE.Vector3(.6, .8, 0), renderer: { getDrawingBufferSize: out => out.set(1280, 720) },
    terrain: { heightAt: () => 0, waterAt: () => 0, slopeAt: () => 0, walkable: () => true },
    habitat: { at(x, z, out) { outRefs.add(out); out.meadow = 1; out.town = 1; out.shore = 1; out.river = 1; out.forest = 0; out.sand = 0; return out; } }, outRefs };
}
const frame = () => ({ dt: 1 / 60, time: 0, wind: 1, windDir: [1, 0], pos: { x: 0, y: 0, z: 0 }, flying: false });
function run(view, f, n = 600) { for (let i = 0; i < n; i++) { f.time += f.dt; view.update(f); } }
function shader(mesh) {
  const s = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader };
  mesh.material.onBeforeCompile(s); return s;
}
function balanced(code) {
  const s = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''), stack = [], pairs = { ')': '(', ']': '[', '}': '{' };
  for (const c of s) if ('([{'.includes(c)) stack.push(c); else if (')]}'.includes(c)) assert.equal(stack.pop(), pairs[c]);
  assert.equal(stack.length, 0);
  const pp = [];
  for (const line of s.split('\n')) { if (/^\s*#if/.test(line)) pp.push(line); if (/^\s*#endif/.test(line)) assert(pp.pop()); }
  assert.equal(pp.length, 0);
  assert.doesNotMatch(s, /\b(?:float|int|vec[234]|mat[234])\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/);
  assert.doesNotMatch(s, /--\s*\d|\+\+\s*\d/);
  assert.doesNotMatch(s.replace(/\b(?:vec[234]|mat[234])\b/g, 'V'), /(?:\d\.\d*|\b\d+)[a-df-zA-DF-Z_]\w*\s*\(/);
}
const expand = s => s.replace(/#include <(\w+)>/g, (_, k) => { assert.equal(typeof THREE.ShaderChunk[k], 'string', k); return expand(THREE.ShaderChunk[k]); });
function findCell() {
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
    const c = flockCell(x, z); if (c.roll < .2) return c;
  }
  assert.fail('synthetic cell missing');
}

test('fauna=0 returns null before touching the context or creating debug hooks', () => {
  assert.equal(createKamakuraFauna({ search: '?fauna=0&debug=1' }), null); assert.equal(globalThis.__kzFauna, undefined);
});

test('three one-pass meshes, bounded capacities and fewer than 8000 triangles even at fauna=4/debug', t => {
  const c = context('?debug=1&faunadebug=1&fauna=4'), view = createKamakuraFauna(c), f = frame();
  try {
    run(view, f);
    assert.equal(c.scene.children.length, 3);
    let triangles = 0;
    for (const m of c.scene.children) {
      assert(m.isMesh && m.geometry.isInstancedBufferGeometry && m.material.isMeshBasicMaterial);
      assert(m.material.fog && m.material.forceSinglePass && m.material.transparent && !m.material.depthWrite);
      assert(!m.frustumCulled && !m.castShadow && !m.receiveShadow);
      assert.equal(m.material.side, THREE.DoubleSide);
      const capacity = m.geometry.attributes.aFaunaCenter.count;
      assert(m.geometry.instanceCount <= capacity);
      triangles += capacity * m.geometry.attributes.position.count / 3;
    }
    // 8,000 small instanced triangles in three draws (the first budget of 6,000 left no room for flocks of twelve and the crows).
    assert(triangles <= 8000); t.diagnostic(JSON.stringify({ meshes: 3, maximumTriangles: triangles, stateSlots: FAUNA.flockSlots, counts: globalThis.__kzFauna() }));
  } finally { view.dispose(); }
});

test('generated/expanded shaders retain the custom fog, tone mapping and color space; GLSL guards hold', () => {
  const fog = Object.fromEntries(['fog_pars_vertex', 'fog_vertex', 'fog_pars_fragment', 'fog_fragment'].map(k => [k, THREE.ShaderChunk[k]]));
  const c = context('?debug=1&faunadebug=1&time=evening'), view = createKamakuraFauna(c);
  try {
    installFog();
    for (const m of c.scene.children) {
      const s = shader(m);
      for (const code of [s.vertexShader, s.fragmentShader]) { balanced(code); balanced(expand(code)); }
      for (const key of ['fog_fragment', 'tonemapping_fragment', 'colorspace_fragment']) assert(s.fragmentShader.includes(`#include <${key}>`));
      assert(s.vertexShader.includes(`smoothstep(${FAUNA.minPixels.toFixed(6)}, ${FAUNA.fullPixels.toFixed(6)}`));
      assert(s.vertexShader.includes(`smoothstep(${FAUNA.cameraNear.toFixed(6)}, ${FAUNA.cameraFull.toFixed(6)}`));
      assert(s.vertexShader.includes('faunaPart') && s.vertexShader.includes('uFaunaSun'));
      assert.equal(s.uniforms.uFaunaDebug.value, 1); assert.equal(s.uniforms.uFaunaEvening.value, 1);
    }
  } finally { view.dispose(); Object.assign(THREE.ShaderChunk, fog); }
});

test('multipliers clamp, light/reduced counts diminish, time controls species and adapt 3 keeps only kites', () => {
  const insectCounts = [];
  // Counts follow the design table: the base number times the flag, the light quality (.6) and reduced motion (.4), within the slots.
  const many = k => Math.min(FAUNA.butterflySlots, Math.ceil(Math.round(FAUNA.butterflies * k * 1e6) / 1e6));
  for (const [search, quality, options, expected] of [
    ['?debug=1', 'standard', {}, many(1)], ['?debug=1&fauna=2', 'standard', {}, many(2)],
    ['?debug=1&fauna=.1', 'standard', {}, many(.25)], ['?debug=1&fauna=99', 'standard', {}, many(4)],
    ['?debug=1&fauna=no', 'standard', {}, many(1)], ['?debug=1', 'light', {}, many(.6)],
    ['?debug=1', 'standard', { reducedMotion: true }, many(.4)], ['?debug=1&time=evening', 'standard', {}, 0],
  ]) {
    const c = context(search, quality), view = createKamakuraFauna(c, options), f = frame();
    try {
      run(view, f, 1200); const [birds, butterfly, dragon] = c.scene.children;
      assert.equal(butterfly.geometry.instanceCount, expected); insectCounts.push(expected);
      const before = butterfly.geometry.instanceCount;
      view.setAdapt(2); run(view, f, 20);
      assert(butterfly.geometry.instanceCount <= Math.ceil(before * .6));
      view.setAdapt(3); assert(!butterfly.visible && !dragon.visible); assert(birds.visible);
      view.update(f);
      assert.equal(butterfly.geometry.instanceCount, 0); assert.equal(dragon.geometry.instanceCount, 0);
      const meta = birds.geometry.attributes.aFaunaMeta;
      for (let i = 0; i < birds.geometry.instanceCount; i++) assert.equal(meta.getX(i), 0);
      const state = globalThis.__kzFauna(); assert.equal(state.flocks.near, 0); assert.equal(state.butterflies, 0); assert.equal(state.dragonflies, 0);
      assert.match(view.debugText(), /^生 鳶\d+ 烏0 群0\/0 蝶0 蜻蛉0/); assert.equal(state.crows, 0);
      view.setAdapt(0); run(view, f, 10); assert(butterfly.visible && dragon.visible);
    } finally { view.dispose(); }
  }
  assert(insectCounts.length === 8);
});

test('layer emits once per flock, uses hero rather than flying camera, and retains cooldown off screen', () => {
  const cell = findCell(), c = context('?debug=1&faunadebug=1'), view = createKamakuraFauna(c), f = frame();
  f.pos.x = cell.x; f.pos.z = cell.z; c.hero.pos.x = cell.x; c.hero.pos.z = cell.z;
  try {
    f.flying = true; run(view, f, 40); assert.equal(c.lifeEvents.length, 0);
    f.flying = false; run(view, f, 10); assert(c.lifeEvents.length >= 1);
    const ownEvents = () => c.lifeEvents.filter(e => e.x === cell.x && e.z === cell.z).length;
    assert.equal(ownEvents(), 1); run(view, f, 300); assert.equal(ownEvents(), 1);
    const birds = c.scene.children[0], a = birds.geometry.attributes;
    let pillars = 0; for (let i = 0; i < birds.geometry.instanceCount; i++) if (a.aFaunaMeta.getW(i) === 1) pillars++;
    // A flock is absent after flight; no stray debug pillar should remain for it.
    assert(pillars <= FAUNA.flockSlots);
    c.hero.pos.x = f.pos.x = cell.x + 100; run(view, f, 100);
    c.hero.pos.x = f.pos.x = cell.x; run(view, f, 20); assert.equal(ownEvents(), 1);
    c.hero.pos.x = f.pos.x = cell.x + 100; run(view, f, 2500);
    c.hero.pos.x = f.pos.x = cell.x; run(view, f, 30); assert.equal(ownEvents(), 2);
  } finally { view.dispose(); }
});

test('OS reduced motion quietly removes birds without a burst event; evening dragonflies have more red tints', () => {
  const old = globalThis.matchMedia; globalThis.matchMedia = () => ({ matches: true });
  const cell = findCell(), c = context('?debug=1&time=evening'), view = createKamakuraFauna(c), f = frame();
  try {
    c.hero.pos.x = f.pos.x = cell.x; c.hero.pos.z = f.pos.z = cell.z;
    run(view, f, 120); assert.equal(c.lifeEvents.length, 0); assert.equal(globalThis.__kzFauna().butterflies, 0);
    const s = shader(c.scene.children[2]); assert.equal(s.uniforms.uFaunaEvening.value, 1);
    // Two seconds into the 1.5 s ease toward the evening number, at the reduced-motion share.
    assert.equal(c.scene.children[2].geometry.instanceCount, Math.ceil(FAUNA.dragonflies * (1 - Math.exp(-2 / 1.5)) * .4));
    const meta = c.scene.children[0].geometry.attributes.aFaunaMeta;
    for (let i = 0; i < c.scene.children[0].geometry.instanceCount; i++) assert.notEqual(meta.getX(i), 4);   // no flapping crows either
  } finally { view.dispose(); if (old) globalThis.matchMedia = old; else delete globalThis.matchMedia; }
});

test('pause freezes uploads, disposal releases every resource once and respects debug-hook ownership', () => {
  const c = context(), view = createKamakuraFauna(c), f = frame(), meshes = [...c.scene.children], s = shader(meshes[0]);
  run(view, f, 20); view.setPaused(true); f.time = 999; view.update(f); assert.notEqual(s.uniforms.uFaunaTime.value, 999);
  view.setPaused(false); view.update(f); assert.equal(s.uniforms.uFaunaTime.value, 999); assert(s.uniforms.uFaunaSun.value.equals(c.sunDir));
  let geometries = 0, materials = 0;
  for (const m of meshes) { m.geometry.addEventListener('dispose', () => geometries++); m.material.addEventListener('dispose', () => materials++); }
  const other = () => 'other'; globalThis.__kzFauna = other;
  view.dispose(); view.dispose(); view.update(f); view.setAdapt(0);
  assert.equal(geometries, 3); assert.equal(materials, 3); assert.equal(c.scene.children.length, 0);
  assert.equal(globalThis.__kzFauna, other); delete globalThis.__kzFauna; assert.equal(view.debugText(), '');
  const next = createKamakuraFauna(c); next.dispose(); assert.equal(globalThis.__kzFauna, undefined);
});

test('1000 updates reuse all buffers and scratch objects, including cell crossings and flock state updates', t => {
  const c = context('?debug=1&fauna=4'), view = createKamakuraFauna(c), f = frame();
  const meshes = [...c.scene.children], buffers = meshes.flatMap(m => Object.values(m.geometry.attributes).map(a => a.array));
  const cell = findCell(); f.pos.x = c.hero.pos.x = cell.x; f.pos.z = c.hero.pos.z = cell.z;
  let pointRefs = c.outRefs;
  const start = performance.now();
  for (let i = 0; i < 1000; i++) {
    f.time += f.dt; f.pos.x += .35; c.hero.pos.x = f.pos.x; view.update(f);
    assert.equal(c.outRefs, pointRefs);
  }
  const elapsed = performance.now() - start;
  const after = meshes.flatMap(m => Object.values(m.geometry.attributes).map(a => a.array));
  for (let i = 0; i < buffers.length; i++) assert.equal(buffers[i], after[i]);
  assert.equal(c.outRefs.size, 1); assert(c.lifeEvents.length > 0 && c.lifeEvents.length <= 16);
  // Audit allocation expressions in every hot-path function, not just identity of GPU buffers.
  const source = fs.readFileSync(new URL('../dist/valley/kamakura-fauna-view.js', import.meta.url), 'utf8');
  const from = source.indexOf('  const groundAlong'); assert(from > 0);
  const hot = source.slice(from, source.indexOf('    setAdapt(next)'));
  assert.doesNotMatch(hot, /\bnew\s|\.map\(|\.filter\(|\.slice\(|\.flatMap\(|\.set\(\s*\[|=\s*\{\s*\}|=\s*\[\s*\]/);
  const rules = fs.readFileSync(new URL('../dist/valley/kamakura-fauna.js', import.meta.url), 'utf8');
  assert.doesNotMatch(rules.slice(rules.indexOf('export function updateFlock'), rules.indexOf('export function insectSeed')), /\bnew\s|\.push\(\s*\{/);
  view.dispose(); t.diagnostic(JSON.stringify({ updates: 1000, reusedBuffers: buffers.length, habitatScratchObjects: c.outRefs.size, cpuMeanMsSyntheticAt4x: elapsed / 1000 }));
});
