import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { THREE, source } from './helpers/tree-modules.mjs';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { installGroundDetail } from '../dist/valley/kamakura-ground-detail.js';
import { installGroundSoil } from '../dist/valley/kamakura-ground-soil.js';
import { registerShoreView, unregisterShoreView } from '../dist/valley/kamakura-shore.js';
import { CLIFF as C, CLIFF_GLSL, CLIFF_SCALAR_GLSL, cliffWeight, cliffProjectionWeight, cliffLayerPhase, cliffCrackPhase, cliffFilter, cliffSignals, cliffColor, installGroundCliff } from '../dist/valley/kamakura-ground-cliff.js';

function data() {
  const d = fixture({ width: 9, height: 9, cell: 2, slope: 2 });
  d.meta.ground = {}; d.meta.surface = {};
  d.ground = new Uint8Array(243).fill(140); d.surface = new Uint8Array(81).fill(5);
  return d;
}
const shader = () => ({ uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader });
function setup(search = '', quality = 'standard', d = data(), shore = false, installer = installGroundDetail) {
  if (shore) registerShoreView(d, {});
  const material = new THREE.MeshLambertMaterial({ vertexColors: true }), owner = installer(THREE, material, d, { search, quality });
  installGroundSoil(THREE, material, owner, { search, quality });
  const s = shader(); material.onBeforeCompile(s);
  return { d, material, owner, s, dispose() { owner.dispose(); material.dispose(); if (shore) unregisterShoreView(d); } };
}
const expand = s => s.replace(/#include <(\w+)>/g, (_, key) => { assert.equal(typeof THREE.ShaderChunk[key], 'string', key); return expand(THREE.ShaderChunk[key]); });
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Execute the scalar GLSL bodies independently; tests fail if either language drifts.
const scalarSource = CLIFF_SCALAR_GLSL + CLIFF_GLSL.slice(CLIFF_GLSL.indexOf('vec4 cliffSignals'), CLIFF_GLSL.indexOf('vec3 cliffRock'));
const mirror = new Function('sin', 'floor', 'fract', 'min', 'max', 'abs', 'clamp', 'smoothstep', 'mix', 'vec4', scalarSource
  .replace(/\b(?:float|vec4)\s+(\w+)\(([^)]*)\)\s*\{/g, (_, n, args) => `function ${n}(${args.replace(/\bfloat\s+/g, '')}){`)
  .replace(/\bfloat\s+/g, 'let ') + ';return {cliffWeight,cliffProjectionWeight,cliffLayerPhase,cliffCrackPhase,cliffFilter,cliffSignals};')(
    Math.sin, Math.floor, v => v - Math.floor(v), Math.min, Math.max, Math.abs, (x, a, b) => Math.min(b, Math.max(a, x)), smoothstep, (a, b, t) => a + (b - a) * t, (...v) => v);

test('cliff slope is zero through 40 degrees, full from 55, continuous and noisy only inside the blend', () => {
  for (const [x, z] of [[0, 0], [15, -8], [-24, 19]]) {
    let last = 0;
    for (let angle = 0; angle <= 90; angle += .025) {
      const w = cliffWeight(Math.cos(angle * Math.PI / 180), x, z);
      assert(w >= last - 1e-12 && w - last < .004); last = w;
      if (angle <= 40) assert.equal(w, 0);
      if (angle >= 55) assert.equal(w, 1);
    }
    assert.deepEqual(cliffColor([.2, .14, .06], { x, y: 12, z }, { x: 0, y: 1, z: 0 }), [.2, .14, .06]);
    assert.deepEqual(cliffColor([.2, .14, .06], { x, y: 12, z }, { x: 1, y: 0, z: 0 }, { enabled: false }), [.2, .14, .06]);
  }
  assert.notEqual(cliffWeight(.67, 15, -8), cliffWeight(.67, -24, 19));
  assert.equal(cliffProjectionWeight(1, 0), 1); assert.equal(cliffProjectionWeight(0, 1), 0); assert.equal(cliffProjectionWeight(1, 1), .5);
});

test('bed and joint periods stay within the requested physical ranges, including negative coordinates', () => {
  const gaps = (f, a, b, step) => {
    let previous = Math.floor(f(a)), crossing = null; const result = [];
    for (let v = a + step; v <= b; v += step) { const next = Math.floor(f(v)); if (next !== previous) { if (crossing !== null) result.push(v - crossing); crossing = v; previous = next; } }
    return result;
  };
  for (const u of [-140, -12, 0, 43, 170]) for (const gap of gaps(h => cliffLayerPhase(u, h), -30, 60, .005)) assert(gap >= .4 && gap <= 1.4);
  for (const h of [-20, 0, 14, 110]) for (const gap of gaps(u => cliffCrackPhase(u, h), -100, 100, .005)) assert(gap >= 1.5 && gap <= 5);
  const joints = [];
  for (let h = 0; h < 30; h += .025) joints.push(cliffSignals(0, h).crack);
  assert(joints.some(v => v === 0)); assert(joints.some(v => v > .8));
  assert(C.macroMeters >= 3 && C.macroMeters <= 6);
});

test('CPU and GLSL equations agree; far footprints suppress detail while keeping large bands', () => {
  for (let i = 0; i < 500; i++) {
    const u = i * .731 - 140, h = i * .137 - 20, pixel = i % 5 * .11, ny = i / 500;
    for (const [name, args, fn] of [['cliffWeight', [ny, u, h], cliffWeight], ['cliffLayerPhase', [u, h], cliffLayerPhase], ['cliffCrackPhase', [u, h], cliffCrackPhase], ['cliffProjectionWeight', [ny, 1 - ny], cliffProjectionWeight], ['cliffFilter', [C.layerMeters, pixel], cliffFilter]]) assert(Math.abs(fn(...args) - mirror[name](...args)) < 1e-12, name);
    const s = cliffSignals(u, h, pixel, .8, 1), g = mirror.cliffSignals(u, h, pixel, .8, 1);
    assert.deepEqual(g, [s.band, s.seam, s.rim, s.macro * C.macroShade - s.crack * C.crackShade]);
    assert.deepEqual(s, cliffSignals(u, h, pixel, .8, 1));
    const far = cliffSignals(u, h, 1, 0, 0);
    assert(Math.abs(far.band) === 0); assert.equal(far.seam, 0); assert.equal(far.rim, 0); assert.equal(far.crack, 0);
    assert.equal(far.macro, cliffSignals(u, h, 0, 0, 0).macro);
    assert(Math.abs(cliffSignals(u, h, C.macroMeters, 0, 0).macro) === 0);
    const light = cliffSignals(u, h, 0, 1, 0); assert.equal(light.crack, 0);
  }
  const base = [.28, .16, .07], normal = { x: 1, y: 0, z: 0 };
  const colors = [1, 2, 3, 4].map(y => cliffColor(base, { x: 0, y, z: 0 }, normal, { distance: 200, pixel: .4 }));
  assert(Math.max(...colors.map(v => v[0])) - Math.min(...colors.map(v => v[0])) > .03);
  for (const c of colors) { assert(c.every(v => Number.isFinite(v) && v >= 0)); assert(Math.max(...c) - Math.min(...c) < Math.max(...base) - Math.min(...base)); }
});

test('side projections keep physical height detail on both vertical walls; ledge grass obeys the quality switch', () => {
  const base = [.28, .16, .07], wallX = { x: 1, y: 0, z: 0 }, wallZ = { x: 0, y: 0, z: 1 };
  const a = { x: 3, y: 8, z: 12 };
  const close = (left, right) => left.forEach((v, k) => assert(Math.abs(v - right[k]) < 1e-12));
  close(cliffColor(base, a, wallX), cliffColor(base, { ...a, x: 100 }, wallX));
  close(cliffColor(base, a, wallZ), cliffColor(base, { ...a, z: 100 }, wallZ));
  assert.notDeepEqual(cliffColor(base, a, wallX), cliffColor(base, { ...a, y: 8.3 }, wallX));
  assert.notDeepEqual(cliffColor(base, a, wallZ), cliffColor(base, { ...a, y: 8.3 }, wallZ));
  const shelf = { x: Math.sqrt(.75), y: .5, z: 0 };
  assert.notDeepEqual(cliffColor(base, a, shelf, { grass: [1, 0, 0] }), cliffColor(base, a, shelf, { grass: [0, 1, 0] }));
  assert.deepEqual(cliffColor(base, a, shelf, { fine: 0, grass: [1, 0, 0] }), cliffColor(base, a, shelf, { fine: 0, grass: [0, 1, 0] }));
});

test('overlapping bedding and vertical joints keep nonnegative source-derived rock reflectance', () => {
  let minimum = Infinity, point = null;
  for (let i = 0; i < 1000; i++) for (let j = 0; j < 1000; j++) {
    const u = -20 + i * .04, h = -10 + j * .04, s = cliffSignals(u, h);
    const shade = 1 + s.macro * C.macroShade + s.band * C.layerShade - s.seam * C.seamShade + s.rim * C.rimLight - s.crack * C.crackShade;
    if (shade < minimum) { minimum = shade; point = { x: 0, y: h, z: u }; }
  }
  assert(minimum < 0, 'fixture actually overlaps all dark features');
  const base = [.28, .16, .07], rock = cliffColor(base, point, { x: 1, y: 0, z: 0 });
  assert(rock.every(v => Number.isFinite(v) && v > 0));
  assert(CLIFF_GLSL.includes('float shade=max(' + C.shadeFloor + ','));
});

test('cliff=0 preserves pre-extension shaders, keys, uniforms and resources byte for byte', async () => {
  const baseline = source('kamakura-ground-detail.js').replace(/^import .*kamakura-ground-cliff.*\n/m, '').replace(/^  installGroundCliff\([^\n]+\n/m, '')
    .replace(/from '(\.\/[^']+)'/g, (_, path) => `from '${new URL('../dist/valley/' + path.slice(2), import.meta.url).href}'`);
  const original = (await import('data:text/javascript;base64,' + Buffer.from(baseline).toString('base64'))).installGroundDetail;
  for (const flags of ['', '&gtone=0', '&gfar=0&ground6=0&ground7=0', '&photo=0', '&gdetail=0']) for (const quality of ['standard', 'light']) {
    const a = setup('?cliff=0' + flags, quality), b = setup('?' + flags.slice(1), quality, data(), false, original);
    try {
      assert.equal(a.s.vertexShader, b.s.vertexShader); assert.equal(a.s.fragmentShader, b.s.fragmentShader);
      assert.equal(a.material.customProgramCacheKey(), b.material.customProgramCacheKey());
      assert.deepEqual(Object.keys(a.s.uniforms), Object.keys(b.s.uniforms));
      assert.equal(a.owner.textures.length, b.owner.textures.length); assert.equal(a.owner.cliff, undefined);
    } finally { a.dispose(); b.dispose(); }
  }
  const m = new THREE.MeshLambertMaterial(), before = m.onBeforeCompile;
  installGroundCliff(THREE, m, {}, {}); assert.equal(m.onBeforeCompile, before); m.dispose();
});

function safety(s) {
  const code = expand(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''), stack = [];
  for (const c of code) { if ('([{'.includes(c)) stack.push(c); else if (')]}'.includes(c)) assert.equal(stack.pop(), '([{'[')]}'.indexOf(c)]); } assert.equal(stack.length, 0);
  assert(!/--\s*\d/.test(code));
  assert(!/\b(?:float|vec[234]|int)\s+(?:input|output|filter|sample|common|active|partition|resource)\b/.test(code));
  for (const args of CLIFF_GLSL.matchAll(/(?:smoothstep|step|max|min|mix)\(([^()]+)\)/g)) for (const value of args[1].split(',')) assert(!/^\s*-?\d+\s*$/.test(value));
  const declared = new Set([...code.matchAll(/\buniform\s+\w+\s+([^;]+);/g)].flatMap(m => m[1].split(',').map(x => x.trim())));
  for (const m of code.matchAll(/\buCliff\w+\b/g)) assert(declared.has(m[0]), m[0] + ' declared');
}

test('assembled shader hooks, unchanged attributes/samplers, quality/adaptation, cleanup and debug draw accounting', t => {
  for (const quality of ['standard', 'light']) for (const flags of ['', '&gtone=0', '&photo=0', '&gfar=0&ground6=0&ground7=0']) for (const shore of [false, true]) {
    const h = setup('?debug=1&cliffdebug=1' + flags, quality, data(), shore), off = setup('?cliff=0' + flags, quality, data(), shore);
    try {
      safety(h.s.vertexShader); safety(h.s.fragmentShader);
      assert.equal(h.s.vertexShader, off.s.vertexShader);
      assert.deepEqual(h.s.fragmentShader.match(/uniform sampler\w+[^;]+;/g), off.s.fragmentShader.match(/uniform sampler\w+[^;]+;/g));
      assert(h.s.fragmentShader.indexOf('diffuseColor.rgb=mix(diffuseColor.rgb,cliffRock') < h.s.fragmentShader.indexOf('#include <lights_lambert_fragment>'));
      assert(h.s.fragmentShader.includes('if(cliffDrawWeight>0.0)'));
      for (const step of [0, 1, 2, 3, 0]) {
        h.owner.setAdapt({ step }); const u = h.owner.cliff.uniforms;
        assert.equal(u.uCliffEnabled.value, step === 3 ? 0 : 1);
        assert.equal(u.uCliffFine.value, quality === 'light' || step >= 2 ? 0 : 1);
        assert.equal(u.uCliffDistance.value.y, (quality === 'light' ? C.lightTo : C.fineTo) * C.adaptDistance ** step);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 8, 0, 0, 0, 8], 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3)); g.setIndex([0, 1, 2]);
      const mesh = new THREE.Mesh(g, h.material), renderer = { info: { render: { frame: 1 } } }, camera = new THREE.PerspectiveCamera(); camera.position.set(12, 4, 4);
      camera.lookAt(0, 4, 4); camera.updateMatrixWorld(); mesh.updateMatrixWorld();
      h.material.onBeforeRender(renderer, null, camera, g, mesh, null);
      const d = globalThis.__kzCliff(); assert.equal(d.count, 1); assert.equal(d.triangles, 1); assert.equal(d.drawCalls, 0); assert.equal(d.textureBytes, 0); assert.equal(d.work, 3);
      assert(d.nearest.distance > 12 && d.nearest.distance < 13); assert(d.nearest.bearing >= 0 && d.nearest.bearing < 360);
      assert.equal(globalThis.__kzCliff().work, 0);
      renderer.info.render.frame++; assert.equal(globalThis.__kzCliff().count, 1, 'post passes do not clear terrain counts');
      camera.lookAt(100, 4, 4); camera.updateMatrixWorld(); assert.equal(globalThis.__kzCliff().count, 0);
      g.dispose(); h.owner.dispose(); h.owner.dispose(); assert.equal(globalThis.__kzCliff, undefined);
    } finally { h.dispose(); off.dispose(); }
  }
  t.diagnostic(JSON.stringify({ materialVariants: 16, syntheticSteepChunks: 1, steepTriangles: 1, firstDebugWork: 3, cachedDebugWork: 0, equationSamples: 500 }));
});

test('installed GLSL compiler checks cliff equations and assembled Lambert programs', async t => {
  const available = spawnSync('glslc', ['--version'], { encoding: 'utf8' });
  if (available.error?.code === 'ENOENT') { t.skip('glslc unavailable; static validation still runs'); return; } assert.equal(available.status, 0);
  const dir = await mkdtemp(join(tmpdir(), 'cliff-glsl-')); let compiled = 0;
  try {
    const prefix = `#version 310 es
precision highp float;precision highp int;
#define varying in
#define texture2D texture
// shaderc reserves average as an interpolation name; Three's common chunk uses it as a helper.
#define average kzCompilerAverage
out vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
`;
    const isolated = prefix + `uniform vec3 cameraPosition;in vec3 world;\n` + CLIFF_GLSL + '\nvoid main(){gl_FragColor=vec4(cliffRock(vec3(.2),world,vec3(1.0,0.0,0.0),vec2(.1),100.0),1.0);}';
    const programs = [isolated];
    const definitions = ['NUM_DIR_LIGHTS 1', 'NUM_DIR_LIGHT_SHADOWS 1', 'NUM_POINT_LIGHTS 0', 'NUM_POINT_LIGHT_SHADOWS 0', 'NUM_SPOT_LIGHTS 0', 'NUM_SPOT_LIGHT_SHADOWS 0', 'NUM_SPOT_LIGHT_MAPS 0', 'NUM_SPOT_LIGHT_COORDS 0', 'NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS 0', 'NUM_HEMI_LIGHTS 0', 'NUM_RECT_AREA_LIGHTS 0', 'NUM_CLIPPING_PLANES 0', 'UNION_CLIPPING_PLANES 0', 'USE_COLOR', 'USE_FOG', 'USE_SHADOWMAP', 'SHADOWMAP_TYPE_PCF', 'HIGH_PRECISION'];
    for (const flags of ['', '&gtone=0', '&photo=0', '&gfar=0&ground6=0&ground7=0']) for (const shore of [false, true]) {
      const h = setup('?cliffdebug=1' + flags, 'standard', data(), shore);
      try {
        let body = expand(h.s.fragmentShader);
        // Three substitutes light counts, then expands the annotated loops before compiling.
        for (const value of definitions.filter(v => / \d+$/.test(v))) { const [name, n] = value.split(' '); body = body.replace(new RegExp('\\b' + name + '\\b', 'g'), n); }
        body = body.replace(/#pragma unroll_loop_start\s+for\s*\(\s*int i = (\d+); i < (\d+); i \+\+\s*\)\s*\{([\s\S]+?)\}\s+#pragma unroll_loop_end/g, (_, start, end, snippet) => {
          let result = ''; for (let i = Number(start); i < Number(end); i++) result += snippet.replace(/\[\s*i\s*\]/g, '[' + i + ']').replace(/UNROLLED_LOOP_INDEX/g, String(i)); return result;
        });
        programs.push(prefix + definitions.map(v => '#define ' + v).join('\n') + '\nuniform mat4 viewMatrix;uniform vec3 cameraPosition;uniform bool isOrthographic;\nvec4 linearToOutputTexel(vec4 v){return v;}\n' + body);
      } finally { h.dispose(); }
    }
    for (const code of programs) {
      const file = join(dir, 'cliff.frag'); await writeFile(file, code);
      const r = spawnSync('glslc', ['--target-env=opengl', '-fauto-bind-uniforms', '-fauto-map-locations', file, '-o', join(dir, 'cliff.spv')], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr); compiled++;
    }
    t.diagnostic(JSON.stringify({ compiledFragments: compiled, addedTriangles: 0, addedDrawCalls: 0, addedTextureBytes: 0 }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('private world cliff material assembles without exporting data values or exceeding sampler limits', async t => {
  if (!process.env.KZ_WORLD_DIR) { t.skip('KZ_WORLD_DIR未設定'); return; }
  const root = process.env.KZ_WORLD_DIR, meta = JSON.parse(await readFile(join(root, 'meta.json'), 'utf8'));
  const d = { meta, ground: new Uint8Array(await readFile(join(root, meta.ground.file))), surface: new Uint8Array(await readFile(join(root, meta.surface.file))) };
  const h = setup('?photo=0', 'light', d);
  try {
    safety(h.s.fragmentShader); assert(h.s.fragmentShader.includes('cliffRock'));
    assert(new Set([...h.s.fragmentShader.matchAll(/uniform sampler2D\s+([^;]+);/g)].flatMap(m => m[1].split(','))).size <= 15);
  } finally { h.dispose(); }
});
