import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.min.js';
import { createKamakuraProps } from '../dist/valley/kamakura-props-view.js';
import { propGeometry } from '../dist/valley/kamakura-props-kit.js';
import { PROPS, propRange } from '../dist/valley/kamakura-props.js';
import { load } from './helpers/tree-modules.mjs';
const { installFog } = await load('atmosphere.js');
function context(search = '?debug=1&time=evening&propsdebug=1', quality = 'standard') {
  const node = (name, part, x, z, facility = 'tsurugaoka') => ({ node: name, part, facility, anchor_xz: [x, z], bbox_min: [-5, 0, -3], bbox_max: [5, 6, 3] });
  return { search, quality, scene: new THREE.Scene(), renderer: { getDrawingBufferSize: v => v.set(1280, 720) },
    data: { facilities: { nodes: [node('hall', 'hall', 0, 0), node('gate', 'gate', 0, 65)] }, patches: { paths: { pass: { xyz_m: [[160, -50, 0], [160, -100, 0]] } } }, meta: { places: [{ name: 'shore', kind: 'port', x: 0, y: -800 }] } },
    houses: { boxes: Array.from({ length: 800 }, (_, i) => ({ x: -280 + i % 40 * 14, z: -280 + Math.floor(i / 40) * 14, w: 6, d: 4, rotY: .1, height: 5 })) },
    terrain: { heightAt: () => 10, walkable: (x, z) => z < 850, slopeAt: () => 0, waterAt: (x, z) => z >= 850 ? 1 : 0, seaDistanceAt: (x, z) => Math.max(0, 850 - z), riverDistanceAt: () => 100 },
    habitat: { at(x, z, out) { out.pass = x > 120 && x < 200 ? 1 : 0; out.sand = z > 750 ? 1 : 0; out.town = 0; return out; } },
  };
}
const frame = () => ({ pos: { x: 0, y: 12, z: 0 }, time: 1, dt: 1 / 60, wind: 1, windDir: [.6, .8] });
function finish(view, f) { for (let i = 0; i < 100; i++) view.update(f); const d = globalThis.__kzProps(); assert(d.ready); for (const n of Object.values(d.nearest)) assert(Number.isFinite(n.distance) && n.bearing >= 0 && n.bearing < 360); }
function shader(m, depth = false) {
  const material = depth ? m.customDepthMaterial : m.material, base = THREE.ShaderLib[depth ? 'depth' : material.isMeshBasicMaterial ? 'basic' : 'lambert'];
  const s = { uniforms: {}, vertexShader: base.vertexShader, fragmentShader: base.fragmentShader }; material.onBeforeCompile(s); return s;
}
function balanced(s) {
  s = s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const stack = [], pairs = { ')': '(', ']': '[', '}': '{' };
  for (const c of s) if ('([{'.includes(c)) stack.push(c); else if (')]}'.includes(c)) assert.equal(stack.pop(), pairs[c]); assert.equal(stack.length, 0);
  const pp = []; for (const line of s.split('\n')) { if (/^\s*#if/.test(line)) pp.push(line); if (/^\s*#endif/.test(line)) assert(pp.pop()); } assert.equal(pp.length, 0);
  assert.doesNotMatch(s, /\b(?:float|int|vec[234]|mat[234])\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/);
  assert.doesNotMatch(s, /--\s*\d|\+\+\s*\d/);
  assert.doesNotMatch(s.replace(/\b(?:vec[234]|mat[234])\b/g, 'V'), /(?:\d\.\d*|\b\d+)[a-df-zA-DF-Z_]\w*\s*\(/);
}
const expand = s => s.replace(/#include <(\w+)>/g, (_, k) => { assert.equal(typeof THREE.ShaderChunk[k], 'string'); return expand(THREE.ShaderChunk[k]); });

test('procedural shapes have finite vertices/normals, buried feet, metre-scale dimensions and bounded triangles', t => {
  const counts = {};
  for (const kind of ['lantern', 'gorinto', 'jizo', 'pole', 'cloth', 'yard', 'boat', 'glow', 'smoke', 'debug']) for (let variant = 0; variant < (['gorinto', 'yard'].includes(kind) ? 2 : 1); variant++) {
    const g = propGeometry(kind, variant); g.computeBoundingBox();
    for (const k of ['position', 'normal']) for (const n of g.attributes[k].array) assert(Number.isFinite(n), kind);
    const triangles = (g.index?.count ?? g.attributes.position.count) / 3; counts[`${kind}${variant}`] = triangles; assert(triangles <= 500, kind);
    const b = g.boundingBox;
    if (!['cloth', 'glow'].includes(kind)) assert(b.min.y < 0, `${kind}: buried skirt`);
    if (kind === 'lantern') { assert(b.max.y * .9 >= 1.6); assert(b.max.y * 1.1 <= 2.0); }
    if (kind === 'gorinto') { assert(b.max.y * .9 >= .5); assert(b.max.y * 1.1 <= 1.2); }
    if (kind === 'jizo') { assert(b.max.y * .9 >= .6); assert(b.max.y * 1.1 <= .9); }
    if (kind === 'pole') { assert(b.max.y * .9 >= 3.5); assert(b.max.y * 1.1 <= 4.5); }
    if (kind === 'cloth') { assert(Math.abs(b.max.x - b.min.x - .45) < 1e-6); assert(Math.abs(b.max.y - b.min.y - 2.6) < 1e-6); }
    if (kind === 'boat') { assert((b.max.z - b.min.z) * .9 >= 6); assert((b.max.z - b.min.z) * 1.1 <= 8); }
    if (kind === 'smoke') assert.equal(g.attributes.aPropLayer.count, 24 * 6);
    g.dispose();
  }
  t.diagnostic(JSON.stringify(counts));
});

test('props=0 allocates nothing; each kind flag filters placement, geometry and debug counts', () => {
  assert.equal(createKamakuraProps({ search: '?props=0&debug=1' }), null); assert.equal(globalThis.__kzProps, undefined);
  for (const kind of ['lantern', 'gorinto', 'jizo', 'nobori', 'smoke', 'yard', 'boat']) {
    const c = context(`?props=${kind}&debug=1&time=evening`), v = createKamakuraProps(c), f = frame(); finish(v, f);
    const placed = globalThis.__kzProps().placed;
    assert(placed[kind] > 0, kind); for (const k of Object.keys(placed)) if (k !== kind) assert.equal(placed[k], 0);
    v.dispose(); assert.equal(c.scene.children.length, 0);
  }
});

test('at most 12 one-pass instanced draws including debug/glow, 60000 triangles and correct lighting/shadows', t => {
  const c = context(), v = createKamakuraProps(c), f = frame(); finish(v, f); const meshes = c.scene.children[0].children;
  assert(meshes.length <= 12); assert(meshes.every(m => m.isInstancedMesh && m.material.forceSinglePass));
  const total = () => meshes.reduce((n, m) => n + m.count * (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0);
  assert(total() <= PROPS.triangles);
  for (const m of meshes) {
    assert(m.material.fog);
    if (/cloth|smoke|glow|debug/.test(m.name)) assert(!m.castShadow); else { assert(m.castShadow && m.receiveShadow); assert(m.material.isMeshLambertMaterial); assert(m.customDepthMaterial); }
    if (/smoke/.test(m.name)) { assert.equal(m.renderOrder, 1); assert(!m.material.depthWrite); assert(m.material.transparent && m.material.isMeshBasicMaterial); }
  }
  f.pos.z = 820; v.update(f); assert(total() <= PROPS.triangles);
  t.diagnostic(`${meshes.length} possible draws including debug/glow; ${total()} buffered triangles at synthetic shore; cap ${PROPS.triangles}`); v.dispose();
});

test('selection reuses matrices until moving 60m, buffers the next boundary, fades over 30m, and quality reduces ranges', () => {
  const c = context(), v = createKamakuraProps(c), f = frame(); finish(v, f);
  const meshes = c.scene.children[0].children, versions = meshes.map(m => m.instanceMatrix.version), revision = globalThis.__kzProps().revisions;
  f.pos.x = 59.99; v.update(f); assert.equal(globalThis.__kzProps().revisions, revision); for (let i = 0; i < meshes.length; i++) assert.equal(meshes[i].instanceMatrix.version, versions[i]);
  f.pos.x = 60; v.update(f); assert.equal(globalThis.__kzProps().revisions, revision + 1);
  for (const m of meshes) { const s = shader(m); assert.match(s.vertexShader, /smoothstep\(uPropRange - 30.0, uPropRange, propDistance\)/); }
  v.setAdapt(2); v.update(f); for (const m of meshes) assert(shader(m).uniforms.uPropRange.value <= 240);
  v.setAdapt(3); v.update(f); assert.equal(globalThis.__kzProps().visible.smoke, 0); assert.equal(globalThis.__kzProps().visible.yard, 0);
  for (const m of meshes.filter(m => /smoke|yard/.test(m.name))) assert.equal(m.count, 0);
  v.dispose();
  const light = context('?debug=1', 'light'), lv = createKamakuraProps(light, { reducedMotion: true }); finish(lv, frame());
  const ls = shader(light.scene.children[0].children[0]); assert.equal(ls.uniforms.uPropRange.value, propRange('lantern', 'light')); assert(ls.uniforms.uPropMotion.value < .3); lv.dispose();
});

test('modified shaders expand with world fog, balanced syntax, safe identifiers, shared gust, fixed cloth edge and billboard smoke', () => {
  const old = { ...THREE.ShaderChunk }; installFog();
  try {
    const c = context(), v = createKamakuraProps(c); finish(v, frame());
    for (const m of c.scene.children[0].children) {
      const s = shader(m); balanced(s.vertexShader); balanced(s.fragmentShader); balanced(expand(s.vertexShader)); balanced(expand(s.fragmentShader));
      assert.match(s.vertexShader, /kzGustBand/);
      if (/cloth/.test(m.name)) { assert.match(s.vertexShader, /position.x - 0.04/); assert.match(s.vertexShader, /propFree \* propFree/); }
      if (/smoke/.test(m.name)) { assert.match(s.vertexShader, /viewMatrix\[0\]\[0\]/); assert.match(s.vertexShader, /fract\(aPropLayer \+ propSeed \+ uPropTime/); assert.match(s.fragmentShader, /dot\(vPropDisc, vPropDisc\)/); }
      if (m.customDepthMaterial) { const d = shader(m, true); balanced(expand(d.vertexShader)); balanced(expand(d.fragmentShader)); assert.match(d.vertexShader, /transformed \*= vPropFade/); }
    }
    v.dispose();
    const source = fs.readFileSync(new URL('../dist/valley/kamakura-props-view.js', import.meta.url), 'utf8'); assert.match(source, /PROPS.fade.toFixed\(1\)/);
  } finally { Object.assign(THREE.ShaderChunk, old); }
});

test('1000 steady updates retain resources/uniforms without matrix uploads; pause freezes; dispose releases each resource once', t => {
  const c = context(), v = createKamakuraProps(c), f = frame(); finish(v, f);
  const meshes = c.scene.children[0].children.slice(), snapshots = meshes.map(m => ({ m, g: m.geometry, mat: m.material, matrix: m.instanceMatrix.array, version: m.instanceMatrix.version, shader: shader(m) }));
  const resources = new Map();
  for (const m of meshes) for (const resource of [m, m.geometry, m.material, m.customDepthMaterial].filter(Boolean)) { resources.set(resource, 0); resource.addEventListener('dispose', () => resources.set(resource, resources.get(resource) + 1)); }
  for (let i = 0; i < 1000; i++) { f.time += f.dt; f.pos.x += .001; v.update(f); }
  for (const s of snapshots) { assert.equal(s.m.geometry, s.g); assert.equal(s.m.material, s.mat); assert.equal(s.m.instanceMatrix.array, s.matrix); assert.equal(s.m.instanceMatrix.version, s.version); const uniforms = shader(s.m).uniforms; for (const k of Object.keys(s.shader.uniforms)) assert.equal(uniforms[k], s.shader.uniforms[k]); }
  const s = snapshots[0].shader, time = s.uniforms.uPropTime.value; v.setPaused(true); f.time += 1; v.update(f); assert.equal(s.uniforms.uPropTime.value, time); v.setPaused(false); v.update(f); assert.equal(s.uniforms.uPropTime.value, f.time);
  const source = fs.readFileSync(new URL('../dist/valley/kamakura-props-view.js', import.meta.url), 'utf8'), steady = source.slice(source.indexOf('      viewer.set'), source.indexOf('    setAdapt(next)'));
  assert.doesNotMatch(steady, /\bnew\b|\.map\(|\.filter\(|\.clone\(|\.slice\(|\.\.\.|JSON\./);
  v.dispose(); v.dispose(); for (const count of resources.values()) assert.equal(count, 1); assert.equal(c.scene.children.length, 0); assert.equal(globalThis.__kzProps, undefined); assert.equal(v.debugText(), '');
  t.diagnostic(`1000 updates: ${meshes.length} resource sets retained, 0 matrix uploads; ${resources.size} resources disposed once`);
});
