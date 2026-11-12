// 実際のThree形状と材質をNodeで組み、予算・切り戻し・GLSLを確認する。見た目の合格とは分ける。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as THREE from '../dist/vendor/three.module.min.js';
import { moduleURL } from './helpers/tree-modules.mjs';
import { WORLD } from '../dist/valley/world-data.js';
import { createTerrain } from '../dist/valley/terrain-height.js';
import { createPaddyLayout, PADDY, PADDY_LOOK, PADDY_DEBUG, paddyAt } from '../dist/valley/paddy.js';
const base = new URL('../dist/valley/', import.meta.url), vendor = new URL('../dist/vendor/three.module.min.js', import.meta.url).href;
const read = f => fs.readFileSync(new URL(f, base), 'utf8');
const asModule = s => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
const rewrite = f => read(f).replace(/from 'three'/g, `from '${vendor}'`).replace(/from '(\.\/[^']+)'/g, (_, p) => `from '${new URL(p, base).href}'`);
const paddyURL = asModule(rewrite('paddy-view.js'));
const { buildPaddy, patchPaddyRice } = await import(paddyURL);
const { buildTerrain, paddyGroundMap } = await import(asModule(rewrite('terrain.js')));
const vegetationSource = rewrite('vegetation.js').replace(new URL('paddy-view.js', base).href, paddyURL).replace(new URL('tree-view.js', base).href, moduleURL('tree-view.js')).replace(new URL('grass-view.js', base).href, moduleURL('grass-view.js'));
const { makeTufts } = await import(asModule(vegetationSource));
const terrain = createTerrain(WORLD), layout = createPaddyLayout(WORLD, terrain);
const wind = { uTime: { value: 12 }, uWind: { value: 1 }, uWindDir: { value: new THREE.Vector2(1, 0) }, uGuideMix: { value: 0 } };
const camera = (x = -50, y = terrain.heightAt(-50, 110) + 40, z = 110) => ({ position: new THREE.Vector3(x, y, z) });
const compile = (material, kind = 'lambert') => { const lib = THREE.ShaderLib[kind], shader = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader }; material.onBeforeCompile(shader); return shader; };
const dispose = v => v.group.traverse(m => { if (m.isMesh) { m.dispose?.(); m.geometry.dispose(); m.material.dispose(); } });
const flat = { seed: 1, heightAt: () => 0, surfaceAt: () => ({ grass: .2, dirt: .8, rock: 0, gravel: 0, mud: 0, litter: 0 }), roadInfo: () => null, waterAt: () => 0, forestDensity: () => 0 };
const disposeTerrain = b => { b.material.dispose(); b.near.geometry.dispose(); b.far.geometry.dispose(); };

test('submitted real geometry stays below both budgets; adaptive distance/density decrease; stationary update allocates no uploads', t => {
  for (const quality of ['standard', 'light']) {
    const start = performance.now(), v = buildPaddy({ layout, quality, wind }); v.update(camera());
    const stats = v.stats();
    let triangles = 0, calls = 0;
    v.group.traverse(m => { if (m.isMesh && m.visible) { calls++; triangles += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : 1); assert(!m.castShadow); } });
    assert.equal(triangles, stats.triangles); assert.equal(calls, stats.drawCalls);
    assert(stats.triangles <= (quality === 'light' ? 50000 : 120000)); assert(stats.drawCalls <= 4);
    const allFar = v.group.children.find(m => m.isInstancedMesh);
    assert(stats.triangles - stats.farRice * 6 + layout.far.filter(s => s.rank < (quality === 'light' ? PADDY.lightDensity : 1)).length * 6 <= (quality === 'light' ? 50000 : 120000), 'entire field upper bound');
    const version = allFar.instanceMatrix.version; v.update(camera()); assert.equal(allFar.instanceMatrix.version, version); assert.equal(v.stats().updateItems, 0);
    let prior = stats;
    for (let level = 1; level <= 3; level++) { v.setLevel(level); v.update(camera()); const next = v.stats(); assert(next.farRice <= prior.farRice && next.distance < prior.distance); prior = next; }
    v.setLevel(0); v.update(camera(1000, 45, 110)); assert.equal(v.stats().farRice, 0);
    t.diagnostic(JSON.stringify({ quality, ...stats, viewBuildMs: performance.now() - start })); dispose(v);
  }
});

test('paddy=0 allocates no new meshes and preserves original near tuft placement and shaders', () => {
  const v = buildPaddy({ layout, quality: 'standard', wind, search: '?paddy=0&paddydebug=1' });
  assert.equal(v.group.children.length, 0); v.update(camera()); assert.equal(v.stats().triangles, 0); assert.equal(v.stats().plots, 0);
  const data = { x: [-10, 10], y: [0, 0], z: [60, 60], s: [1, 1], rot: [0, 0], tint: [0, 1] };
  const mesh = makeTufts({ data, geometry: new THREE.PlaneGeometry(.05, 1), wind, height: 1, fadeStart: 60, fadeEnd: 95, tintA: PADDY_LOOK.tintA, tintB: PADDY_LOOK.tintB });
  assert.equal(mesh.userData.instances, 2);
  const shader = compile(mesh.children[0].material);
  assert(!shader.fragmentShader.includes('paddy')); assert(!shader.vertexShader.includes('paddy'));
  assert(shader.vertexShader.includes('smoothstep(60.0, 95.0, dd)'));
  const b = buildTerrain({ terrain: flat, textures: {}, search: '?paddy=0' });
  const oldShader = compile(b.material, 'standard'); assert(!oldShader.uniforms.uPaddyGround && !oldShader.fragmentShader.includes('paddyUV')); assert.equal(b.paddyCoverage(), 0);
  disposeTerrain(b); dispose({ group: mesh });
});

test('ground cover colors exceed 80% of the complete terrace area, keep the true road width clear and debug kinds distinct', t => {
  const map = paddyGroundMap(WORLD, terrain), debug = paddyGroundMap(WORLD, terrain, true);
  let covered = 0;
  for (let j = 0; j < map.nz; j++) for (let i = 0; i < map.nx; i++) {
    const x = map.x0 + (i + .5) * PADDY_LOOK.mapStep, z = map.z0 + (j + .5) * PADDY_LOOK.mapStep, k = (j * map.nx + i) * 4;
    const r = terrain.roadInfo(x, z), s = paddyAt(layout.plots, x, z);
    if (r && r.dist <= PADDY_LOOK.mapStep / Math.SQRT2) { assert.equal(map.data[k + 3], 0); continue; }
    const color = new THREE.Color(PADDY_DEBUG[s.bund ? 'bund' : s.plot.kind]);
    for (const [channel, value] of [color.r, color.g, color.b].entries()) assert.equal(debug.data[k + channel], Math.round(value * 255));
    if (!s.bund && map.data[k + 3]) covered++;
  }
  const fraction = covered / (map.nx * map.nz); assert(fraction >= .8);
  t.diagnostic(JSON.stringify({ coveredFraction: fraction, mapBytes: map.data.byteLength }));
});

test('terrain shader owns and frees its data texture; quality switches preserve color and no geometry or extra draw is added', () => {
  const b = buildTerrain({ terrain: flat, textures: {}, search: '' }), shader = compile(b.material, 'standard'), texture = shader.uniforms.uPaddyGround.value;
  assert.equal(texture.magFilter, THREE.NearestFilter); assert(!texture.generateMipmaps && texture.isDataTexture);
  const geo = b.near.geometry.attributes.position.array.slice();
  b.setQuality('light'); assert.equal(compile(b.material, 'standard').uniforms.uDetail.value, 0);
  assert.deepEqual(b.near.geometry.attributes.position.array, geo); assert.equal(b.group.children.length, 2);
  let disposed = 0; texture.addEventListener('dispose', () => disposed++); disposeTerrain(b); assert.equal(disposed, 1);
});

const expand = s => s.replace(/#include <(\w+)>/g, (_, key) => { assert.equal(typeof THREE.ShaderChunk[key], 'string', 'shader anchor ' + key); return expand(THREE.ShaderChunk[key]); });
function safety(shader) {
  const code = shader.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''), stack = [];
  for (const c of code) { if ('([{'.includes(c)) stack.push(c); else if (')]}'.includes(c)) assert.equal(stack.pop(), '([{'[')]}'.indexOf(c)]); } assert.equal(stack.length, 0);
  assert(!/\b(?:float|int|vec[234])\s+(?:input|output|filter|sample|common|active|partition|resource)\b/.test(code));
}
function variants(debug) {
  const v = buildPaddy({ layout, wind, search: debug ? '?paddydebug=1' : '' });
  const far = v.group.children.find(m => m.isInstancedMesh).material;
  const near = makeTufts({ data: { x: [0], y: [0], z: [60], s: [1], rot: [0], tint: [.5] }, geometry: new THREE.PlaneGeometry(.05, 1), wind, height: 1, fadeStart: 60, fadeEnd: 95, tintA: PADDY_LOOK.tintA, tintB: PADDY_LOOK.tintB, flutter: .02, paddy: { debug } });
  const b = buildTerrain({ terrain: flat, textures: {}, search: debug ? '?paddydebug=1' : '' });
  return { shaders: [[compile(far), true], [compile(near.children[0].material), true], [compile(b.material, 'standard'), false]], dispose() { dispose(v); dispose({ group: near }); disposeTerrain(b); } };
}

test('real shader anchors, shared wind, complementary dithering and balanced GLSL survive both debug variants', () => {
  assert(THREE.ShaderLib.lambert.vertexShader.includes('#include <begin_vertex>'));
  assert(THREE.ShaderLib.lambert.fragmentShader.includes('#include <alphatest_fragment>'));
  assert(THREE.ShaderLib.standard.fragmentShader.includes('#include <map_fragment>'));
  for (const debug of [false, true]) {
    const v = variants(debug);
    for (const [s, instanced] of v.shaders) {
      // Threeの#ifの両枝には関数の開き括弧が重複する。挿入後の本体の対応と、全includeの実在を別々に検査する。
      safety(s.vertexShader); safety(s.fragmentShader); expand(s.vertexShader); expand(s.fragmentShader);
      if (instanced) { for (const key of Object.keys(wind)) assert.equal(s.uniforms[key], wind[key]); assert.match(s.vertexShader, /vPaddyDistance = distance\(paddyRoot, cameraPosition\)/); }
      else assert(s.fragmentShader.includes('mix(albedo,paddyGround.rgb,paddyGround.a)'));
    }
    assert(v.shaders[0][0].fragmentShader.includes('paddyGrain >= paddyFar*paddyOuter'));
    assert(v.shaders[1][0].fragmentShader.includes('paddyGrain < paddyFar'));
    v.dispose();
  }
  assert.throws(() => safety('void main(){float sample=0.0;}')); assert.throws(() => safety('void main(){'));
});

test('glslc compiles actual Three near, far and terrain shaders with instancing, directional light and fog', t => {
  const available = spawnSync('glslc', ['--version'], { encoding: 'utf8' });
  if (available.error?.code === 'ENOENT') return t.skip('glslc unavailable; delimiter, reserved word and anchor checks still run');
  assert.equal(available.status, 0);
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'paddy-glsl-')); let count = 0;
  try {
    for (const debug of [false, true]) {
      const v = variants(debug);
      try { for (const [shader, instanced] of v.shaders) for (const lit of [false, true]) for (const [property, stage] of [['vertexShader', 'vert'], ['fragmentShader', 'frag']]) {
        const prefix = `#version 310 es
precision highp float; precision highp int;
#define varying ${stage === 'vert' ? 'out' : 'in'}
#define attribute in
#define texture2D texture
#define textureCube texture
#define texture2DGradEXT textureGrad
#define texture2DLodEXT textureLod
#define HIGH_PRECISION
#define USE_COLOR
#define OPAQUE
${instanced ? '#define USE_INSTANCING\n#define USE_INSTANCING_COLOR' : ''}
${lit ? '#define USE_SHADOWMAP\n#define SHADOWMAP_TYPE_PCF_SOFT\n#define USE_FOG' : ''}
uniform mat4 modelMatrix,modelViewMatrix,projectionMatrix,viewMatrix;
uniform mat3 normalMatrix; uniform vec3 cameraPosition; uniform bool isOrthographic;
${stage === 'vert' ? 'in vec3 position,normal,color,instanceColor; in mat4 instanceMatrix; in vec2 uv;' : 'out vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\nvec4 linearToOutputTexel(vec4 v){return v;}'}
`;
        let code = prefix + expand(shader[property]);
        code = code.replace(/\baverage\b/g, 'threeAverage').replace(/\bNUM_\w+\b/g, n => lit && ['NUM_DIR_LIGHTS', 'NUM_DIR_LIGHT_SHADOWS'].includes(n) ? '1' : '0');
        code = code.replace(/#pragma unroll_loop_start\s+for \( int i = (\d+); i < (\d+); i \+\+ \) \{([\s\S]+?)\}\s+#pragma unroll_loop_end/g, (_, a, b, body) => { let out = ''; for (let i = +a; i < +b; i++) out += body.replace(/\[\s*i\s*\]/g, '[ ' + i + ' ]').replace(/UNROLLED_LOOP_INDEX/g, String(i)); return out; });
        const file = path.join(dir, 'shader.' + stage); fs.writeFileSync(file, code);
        const result = spawnSync('glslc', ['--target-env=opengl', '-fauto-bind-uniforms', '-fauto-map-locations', '-fshader-stage=' + stage, file, '-o', path.join(dir, 'out.spv')], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr); count++;
      } } finally { v.dispose(); }
    }
    t.diagnostic(JSON.stringify({ compiledStages: count }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('game and world viewer update the far rice and expose QA counters; adaptive hooks reach the paddy view', () => {
  assert.match(read('qa.js'), /paddyStats\(\) \{ return game.veg.paddy.stats\(\); \}/);
  assert.match(read('world.js'), /veg.rice.update\(camera\)/); assert.match(read('game.js'), /this.veg.rice.update\(this.camera\)/);
  assert.match(read('vegetation.js'), /rice.update = camera => \{ nearUpdate\(camera\); paddyView.update\(camera\); \}/);
  assert.match(read('vegetation.js'), /paddyView.setLevel\(level\)/);
});
