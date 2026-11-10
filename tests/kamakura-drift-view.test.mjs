import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.min.js';
import { createKamakuraDrift } from '../dist/valley/kamakura-drift-view.js';
import { DRIFT, driftAmounts } from '../dist/valley/kamakura-drift.js';
import { load } from './helpers/tree-modules.mjs';
const { installFog } = await load('atmosphere.js');

const frame = () => ({ dt: 1 / 60, time: 10, wind: 1, windDir: [.6, .8], pos: { x: 0, y: 2, z: 0 }, flying: false });
function context(search = '?debug=1', quality = 'standard') {
  let calls = 0, firstOut;
  const c = { search, quality, scene: new THREE.Scene(), sunDir: new THREE.Vector3(.3, .8, .4).normalize(),
    renderer: { getDrawingBufferSize: out => out.set(1280, 720) },
    habitat: { at(x, z, out) {
      if (firstOut) assert.equal(out, firstOut); else firstOut = out;
      calls++; out.forest = x < 10 ? 1 : 0; out.meadow = x >= 10 ? 1 : 0; out.river = 1; return out;
    } },
    get calls() { return calls; },
  };
  return c;
}
function shader(mesh) {
  const base = THREE.ShaderLib[mesh.material.isMeshBasicMaterial ? 'basic' : 'lambert'];
  const s = { uniforms: {}, vertexShader: base.vertexShader, fragmentShader: base.fragmentShader };
  mesh.material.onBeforeCompile(s); return s;
}
function balanced(source) {
  const s = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''), stack = [], pairs = { ')': '(', ']': '[', '}': '{' };
  for (const c of s) if ('([{'.includes(c)) stack.push(c); else if (')]}'.includes(c)) assert.equal(stack.pop(), pairs[c]);
  assert.equal(stack.length, 0);
  const pp = [];
  for (const line of s.split('\n')) { if (/^\s*#if/.test(line)) pp.push(line); if (/^\s*#endif/.test(line)) assert(pp.pop()); }
  assert.equal(pp.length, 0);
  assert.doesNotMatch(s, /\b(?:float|int|vec[234]|mat[234])\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/);
  assert.doesNotMatch(s, /--\s*\d|\+\+\s*\d/);
  assert.doesNotMatch(s.replace(/\b(?:vec[234]|mat[234])\b/g, 'V'), /(?:\d\.\d*|\b\d+)[a-df-zA-DF-Z_]\w*\s*\(/);
}
const expand = s => s.replace(/#include <(\w+)>/g, (_, key) => { assert.equal(typeof THREE.ShaderChunk[key], 'string', key); return expand(THREE.ShaderChunk[key]); });

test('drift=0 does not construct resources or install debug state', () => {
  assert.equal(createKamakuraDrift({ search: '?drift=0&debug=1' }), null);
  assert.equal(globalThis.__kzDrift, undefined);
});

test('two one-pass meshes fit the counts/triangle budgets and use receiving Lambert + additive Basic', t => {
  for (const quality of ['standard', 'light']) {
    const c = context('?debug=1', quality), view = createKamakuraDrift(c), meshes = c.scene.children;
    assert.equal(meshes.length, 2);
    assert(meshes[0].material.isMeshLambertMaterial && meshes[0].receiveShadow);
    assert(meshes[1].material.isMeshBasicMaterial && meshes[1].material.blending === THREE.AdditiveBlending);
    let triangles = 0;
    for (const m of meshes) {
      assert(m.isMesh && m.geometry.isInstancedBufferGeometry);
      assert(!m.frustumCulled && !m.castShadow && !m.material.depthWrite && m.material.fog && m.material.forceSinglePass);
      assert.equal(m.material.side, THREE.DoubleSide);
      triangles += m.geometry.instanceCount * m.geometry.index.count / 3;
    }
    assert.equal(triangles, (quality === 'light' ? DRIFT.light : DRIFT.standard) * 2);
    assert(triangles <= 20000);   // two triangles per particle; the count comes from the measured on-screen share (3 to 6 %)
    const inspect = globalThis.__kzDrift();
    assert.equal(Object.values(inspect.counts).reduce((a, b) => a + b), quality === 'light' ? DRIFT.light : DRIFT.standard);
    t.diagnostic(JSON.stringify({ quality, meshes: meshes.length, triangles, counts: inspect.counts }));
    view.dispose();
  }
});

test('shader hooks keep built-in shadows/fog/color output; all generated and expanded GLSL is balanced', () => {
  const old = Object.fromEntries(['fog_pars_vertex', 'fog_vertex', 'fog_pars_fragment', 'fog_fragment'].map(k => [k, THREE.ShaderChunk[k]]));
  const c = context(), view = createKamakuraDrift(c);
  try {
    // Exercise the global custom fog too, rather than assuming the stock fog chunks.
    installFog();
    for (const m of c.scene.children) {
      const s = shader(m);
      for (const code of [s.vertexShader, s.fragmentShader]) { balanced(code); balanced(expand(code)); }
      assert.equal((s.vertexShader.match(/float kzGustBand\(/g) || []).length, 1);
      assert(s.vertexShader.includes('kzGustBand(driftCenter.xz, uDriftTime, uDriftDir)'));
      assert(s.vertexShader.includes(`smoothstep(${DRIFT.minPixels.toFixed(2)}, ${DRIFT.fullPixels.toFixed(2)}`));
      assert(s.vertexShader.includes('driftScale') && !s.vertexShader.includes('#include <begin_vertex>'));
      for (const chunk of ['fog_fragment', 'tonemapping_fragment', 'colorspace_fragment']) assert(s.fragmentShader.includes(`#include <${chunk}>`));
      if (m.receiveShadow) {
        assert(s.vertexShader.includes('objectNormal = kzDriftRotate(objectNormal)'));
        assert(s.vertexShader.includes('#include <shadowmap_vertex>'));
        assert(s.fragmentShader.includes('#include <lights_fragment_begin>'));
        assert(s.fragmentShader.includes('vec3(0.9)'));   // the brightness cap of a lit leaf
      } else assert(s.fragmentShader.includes('vec3(0.85)'));
    }
  } finally { view.dispose(); Object.assign(THREE.ShaderChunk, old); }
});

test('habitat sampling/smoothing, multiplier, quality, reduced motion and adaptation preserve the contract', () => {
  for (const [search, quality, options, scale] of [
    ['?debug=1', 'standard', {}, 1], ['?debug=1&drift=2', 'standard', {}, 2],
    ['?debug=1&drift=0.1', 'standard', {}, .25], ['?debug=1&drift=99', 'standard', {}, 4],
    ['?debug=1&drift=bad', 'standard', {}, 1], ['?debug=1', 'light', {}, .75],
    ['?debug=1', 'standard', { reducedMotion: true }, .4],
  ]) {
    const c = context(search, quality), view = createKamakuraDrift(c, options), f = frame(), s = shader(c.scene.children[0]);
    const target = driftAmounts({ forest: 1 }, 'noon');
    for (let i = 0; i < 900; i++) { f.time += f.dt; view.update(f); }
    assert(Math.abs(globalThis.__kzDrift().amounts.leaf - Math.min(1, target.leaf * scale)) < 1e-4);
    assert(c.calls >= 59 && c.calls <= 61, `sample calls ${c.calls}`);
    assert.equal(s.uniforms.uDriftMotion.value, options.reducedMotion ? .5 : 1);
    view.setAdapt(2);
    assert(Math.abs(globalThis.__kzDrift().amounts.leaf - Math.min(1, target.leaf * scale * .6)) < 1e-4);
    view.setAdapt(3);
    assert(c.scene.children.every(m => !m.visible)); assert.equal(globalThis.__kzDrift().visible, false);
    view.setAdapt(0); assert(c.scene.children.every(m => m.visible));
    f.pos.x = 20;
    const before = globalThis.__kzDrift().amounts.leaf;
    for (let i = 0; i < 16; i++) view.update(f);
    assert(globalThis.__kzDrift().amounts.leaf > before * .8, 'a biome crossing must blend rather than jump');
    view.dispose();
  }
});

test('OS reduced-motion default, evening fireflies, flying, pause, debug colors and disposal ownership', () => {
  const oldMatch = globalThis.matchMedia;
  globalThis.matchMedia = query => { assert.equal(query, '(prefers-reduced-motion: reduce)'); return { matches: true }; };
  const c = context('?debug=1&driftdebug=1&time=evening'), view = createKamakuraDrift(c), meshes = [...c.scene.children], shaders = meshes.map(shader), f = frame();
  try {
    f.flying = true; f.pos = { x: 30, y: 90, z: -40 };
    for (let i = 0; i < 900; i++) view.update(f);
    const s = shaders[0];
    assert.equal(s.uniforms.uDriftMotion.value, .5);
    assert(globalThis.__kzDrift().amounts.firefly > .3);
    assert.equal(s.uniforms.uDriftViewer.value.y, 90);
    assert.equal(s.uniforms.uDriftDebug.value, 1);
    assert.equal(s.uniforms.uDriftTime.value, f.time);
    assert.equal(s.uniforms.uDriftHeight.value, 720);
    assert(s.uniforms.uDriftSun.value.equals(c.sunDir));
    // Every kind has exactly one debug color, independent of tint seed.
    const colors = new Map();
    for (const m of meshes) for (let i = 0; i < m.geometry.instanceCount; i++) {
      const k = m.geometry.attributes.aDriftShape.getY(i), a = m.geometry.attributes.aDriftColor;
      const color = `${a.getX(i)},${a.getY(i)},${a.getZ(i)}`;
      if (colors.has(k)) assert.equal(color, colors.get(k)); else colors.set(k, color);
    }
    assert.equal(new Set(colors.values()).size, 4);
    view.setPaused(true); f.time = 999; f.pos.y = 999; view.update(f);
    assert.notEqual(s.uniforms.uDriftTime.value, 999); assert.equal(s.uniforms.uDriftViewer.value.y, 90);
    view.setPaused(false); view.update(f); assert.equal(s.uniforms.uDriftTime.value, 999);
    assert.match(view.debugText(), /^粒 葉\d+ 花\d+ 塵\d+ 蛍\d+/);
    const other = () => 'owned elsewhere'; globalThis.__kzDrift = other;
    let geometries = 0, materials = 0;
    for (const m of meshes) { m.geometry.addEventListener('dispose', () => geometries++); m.material.addEventListener('dispose', () => materials++); }
    view.dispose(); view.dispose(); view.update(f); view.setAdapt(0);
    assert.equal(geometries, 2); assert.equal(materials, 2); assert.equal(c.scene.children.length, 0);
    assert.equal(globalThis.__kzDrift, other); assert.equal(view.debugText(), '');
    delete globalThis.__kzDrift;
  } finally { view.dispose(); if (oldMatch) globalThis.matchMedia = oldMatch; else delete globalThis.matchMedia; }
});

test('1000 updates reuse every uniform/vector, attribute array, geometry and material', t => {
  const c = context(), view = createKamakuraDrift(c), meshes = [...c.scene.children], shaders = meshes.map(shader), f = frame();
  const objects = shaders.map(s => Object.entries(s.uniforms).map(([key, uniform]) => ({ key, uniform, value: uniform.value })));
  const resources = meshes.map(m => ({ geometry: m.geometry, material: m.material, attributes: Object.values(m.geometry.attributes).map(a => ({ a, array: a.array, version: a.version })) }));
  for (let i = 0; i < 1000; i++) { f.time += f.dt; f.pos.x += .005; view.update(f); }
  for (let i = 0; i < 2; i++) {
    assert.equal(meshes[i].geometry, resources[i].geometry); assert.equal(meshes[i].material, resources[i].material);
    for (const { a, array, version } of resources[i].attributes) { assert.equal(a.array, array); assert.equal(a.version, version); }
    for (const { key, uniform, value } of objects[i]) {
      assert.equal(shaders[i].uniforms[key], uniform);
      if (typeof value === 'object') assert.equal(uniform.value, value);
    }
  }
  // Guard the update source as well: identity checks alone miss temporary allocations.
  const source = fs.readFileSync(new URL('../dist/valley/kamakura-drift-view.js', import.meta.url), 'utf8');
  const update = source.slice(source.indexOf('    update(frame)'), source.indexOf('    setAdapt(next)'));
  assert.doesNotMatch(update, /\bnew\b|\.map\(|\.filter\(|\.clone\(|\.slice\(|\.\.\.|JSON\./);
  t.diagnostic('1000 updates: 2 meshes, 2 geometries, 2 materials, 0 attribute uploads; uniform/vector identities unchanged');
  view.dispose(); assert.equal(globalThis.__kzDrift, undefined);
});
