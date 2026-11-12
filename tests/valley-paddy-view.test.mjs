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
const { buildPaddy, patchPaddyRice, paddyStoneGeometry, paddyBundGeometry, paddyTuftGeometry, paddySurfaceColor, paddyStoneBandGeometry, paddyDebugColor } = await import(paddyURL);
const { buildTerrain, paddyGroundMap } = await import(asModule(rewrite('terrain.js').replace(new URL('paddy-view.js', base).href, paddyURL)));
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
    v.group.traverse(m => { if (m.isMesh && m.visible) { calls++; triangles += (Math.min(m.geometry.drawRange.count, m.geometry.index?.count ?? m.geometry.attributes.position.count)) / 3 * (m.isInstancedMesh ? m.count : 1); assert(!m.castShadow); } });
    assert.equal(triangles, stats.triangles); assert.equal(calls, stats.drawCalls);
    assert.equal(stats.stoneBandVertices,stats.stoneBands*18);
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

test('ground follows the noisy terrace mask, keeps true road width clear and colors each terrace distinctly', t => {
  const map = paddyGroundMap(WORLD, terrain), debug = paddyGroundMap(WORLD, terrain, true);
  let covered = 0;
  for (let j = 0; j < map.nz; j++) for (let i = 0; i < map.nx; i++) {
    const x = map.x0 + (i + .5) * PADDY_LOOK.mapStep, z = map.z0 + (j + .5) * PADDY_LOOK.mapStep, k = (j * map.nx + i) * 4;
    const r = terrain.roadInfo(x, z), s = paddyAt(layout.plots, x, z);
    if (!s || (r && r.dist <= PADDY_LOOK.mapStep / Math.SQRT2)) { assert.equal(map.data[k + 3], 0); continue; }
    assert.equal(map.data[k + 3], s.bund ? 253 : s.cut ? 254 : 255, 'ground type mask must distinguish roots from harvested straw');
    const color = paddyDebugColor(s.plot.level,s.riser);
    for (const [channel, value] of [color.r, color.g, color.b].entries()) assert.equal(debug.data[k + channel], Math.round(value * 255));
    if (!s.bund && map.data[k + 3]) covered++;
  }
  const fraction = covered / (map.nx * map.nz); assert(map.coverage >= .8); assert(fraction >= .5);
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
  assert(THREE.ShaderLib.lambert.fragmentShader.includes('#include <color_fragment>'));
  assert(THREE.ShaderLib.standard.fragmentShader.includes('#include <map_fragment>'));
  for (const debug of [false, true]) {
    const v = variants(debug);
    for (const [s, instanced] of v.shaders) {
      // Threeの#ifの両枝には関数の開き括弧が重複する。挿入後の本体の対応と、全includeの実在を別々に検査する。
      safety(s.vertexShader); safety(s.fragmentShader); expand(s.vertexShader); expand(s.fragmentShader);
      if (instanced && !debug) assert(s.fragmentShader.includes('sin(vPaddyRoot.x*') && s.fragmentShader.includes('-uTime*'));
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

test('stones retain smooth twelve-face detail and six-face fallback geometry without boxes', () => {
  for (const s of layout.stones.filter(s => s.followsContour).slice(0, 30)) {
    for (const near of [true, false]) {
      const g = paddyStoneGeometry(s, near), normals = g.attributes.normal, positions = g.attributes.position;
      assert.equal(g.index.count / 3, near ? 12 : 6);
      const directions = new Set();
      for (let i = 0; i < normals.count; i++) directions.add([normals.getX(i), normals.getY(i), normals.getZ(i)].map(n => n.toFixed(3)).join(','));
      assert(directions.size >= (near ? 8 : 5), 'smooth shared normals must include oblique directions');
      assert(positions.count < 12, 'shared smooth vertices, not six separate rectangular sides');
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < positions.count; i++) { lo = Math.min(lo, positions.getY(i)); hi = Math.max(hi, positions.getY(i)); }
      assert(Math.abs((lo + hi) / 2 - s.y) < 1e-5);
      assert(s.y >= s.bottom && s.y <= s.top);
      g.dispose();
    }
  }
});

test('the real bund mesh has seven rounded section points and the real stubble has five separate short fanned stems', () => {
  const b = layout.bunds.find(b => b.alongX), g = paddyBundGeometry(b), p = g.attributes.position;
  assert.equal(p.count, 14);
  for (const offset of [0, 7]) {
    assert(p.getY(offset + 3) > p.getY(offset) + .15);
    assert(p.getY(offset + 3) > p.getY(offset + 6) + .15);
  }
  g.dispose();
  for (const s of layout.stubble.slice(0, 30)) {
    const g = paddyTuftGeometry(s), p = g.attributes.position;
    assert.equal(p.count / 3, 5);
    const tips = new Set();
    for (let stem = 0; stem < 5; stem++) {
      const k = stem * 3 + 2;
      assert(Math.abs(p.getY(k) - s.y - s.height) < 1e-5);
      assert(Math.abs(Math.hypot(p.getX(k)-s.x,p.getZ(k)-s.z) - .05) < 1e-5);
      tips.add([p.getX(k).toFixed(3),p.getZ(k).toFixed(3)].join(','));
    }
    assert.equal(tips.size, 5); g.dispose();
  }
});

test('harvest ground is less saturated than standing gold, with 10–20% light straw patches and preserved dark-soil source', t => {
  const saturation = c => c.getHSL({}).s;
  const standing = layout.plots.find(p => p.kind === 'standing'), cut = layout.plots.find(p => p.kind === 'harvested');
  const gold = paddySurfaceColor({ plot: standing, cut: false }, 0, 0), patches = [];
  let bright = 0;
  for (let z = cut.z0 + 1; z < cut.z1 - 1; z += .5) for (let x = cut.x0 + 1; x < cut.x1 - 1; x += .5) {
    const c = paddySurfaceColor({ plot: cut, cut: true }, x, z);
    assert(saturation(c) < saturation(gold)); patches.push(c.r);
  }
  const min = Math.min(...patches); for (const r of patches) if (r > min * 1.1) bright++;
  assert(bright / patches.length >= .1 && bright / patches.length <= .2);
  t.diagnostic(JSON.stringify({ standingSaturation: saturation(gold), cutSaturation: saturation(paddySurfaceColor({ plot: cut, cut: true }, 0, 0)), patchFraction: bright / patches.length }));
});

test('walk-height updates retain dense stubble and grass, switch stone LOD, stay in budget and stop all uploads while stationary', t => {
  for (const quality of ['standard', 'light']) {
    const v = buildPaddy({ layout, wind, quality });
    for (const [x, z, h] of [[30, 180, 70], [-10, 49, 1.7], [-55, 62, 1.7], [-50, 110, 14], [-50, 110, 40], [-50, 250, 1.7]]) {
      const c = camera(x, terrain.heightAt(x, z) + h, z); v.update(c); const stats = v.stats();
      assert(stats.triangles <= (quality === 'light' ? 50000 : 120000)); assert(stats.drawCalls <= 4);
      if (h === 1.7 && z < 100) { assert(stats.stubble > 0 && stats.grass > 0 && stats.stoneNear > 0); assert(stats.detailRadius <= 40); }
      if (z === 250) { assert.equal(stats.stoneNear + stats.stoneMid, 0); assert(stats.stoneBands > 0 || quality === 'light'); }
      let submitted = 0;
      v.group.traverse(m => { if (m.isMesh && m.visible) submitted += Math.min(m.geometry.drawRange.count, m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : 1); });
      assert.equal(stats.triangles, submitted);
      const versions = v.group.children.map(m => m.isInstancedMesh ? m.instanceMatrix.version : m.geometry.attributes.position.version);
      v.update(c); assert.equal(v.stats().updateItems, 0);
      assert.deepEqual(v.group.children.map(m => m.isInstancedMesh ? m.instanceMatrix.version : m.geometry.attributes.position.version), versions);
      t.diagnostic(JSON.stringify({ quality, x, z, h, ...stats }));
    }
    dispose(v);
  }
});

test('sloping ribbon has a bright grey middle, grassy crown and dark lower edge, retained past 150m', () => {
  for(const w of layout.walls){
    const g=paddyStoneBandGeometry(w),p=g.attributes.position,c=g.attributes.color;assert.equal(p.count,8);assert.equal(g.index.count/3,6);
    for(let i=0;i<p.count;i++)assert(p.getY(i)>=w.bottom-1e-6&&p.getY(i)<=w.top+1e-6);
    for(let i=0;i<p.count;i++)assert(p.getY(i)>=Math.max(0,w.level*WORLD.terraces.drop)-1e-6&&p.getY(i)<=(w.level+1)*WORLD.terraces.drop+1e-6);
    assert(c.getX(2)>c.getX(3));g.dispose();
  }
  const v=buildPaddy({layout,wind});v.update(camera(-50,45,250));assert(v.stats().stoneBands>0);dispose(v);
});

test('far rice shaded face stays at least 70% as bright; ground rows and slow waves use the shared wind', () => {
  assert(PADDY_LOOK.farShadeFloor>=.7);
  const v=buildPaddy({layout,wind}),far=v.group.children.find(m=>m.isInstancedMesh),s=compile(far.material);
  assert(s.fragmentShader.includes(`outgoingLight = clamp(outgoingLight, diffuseColor.rgb * ${PADDY_LOOK.farShadeFloor}, diffuseColor.rgb)`));
  const b=buildTerrain({terrain:flat,textures:{}}),ground=compile(b.material,'standard');
  assert.equal(ground.uniforms.uPaddyTime,wind.uTime);assert.equal(ground.uniforms.uPaddyWind,wind.uWind);
  assert(ground.fragmentShader.includes('texture2D(uPaddyPhase,paddyUV)'));assert(ground.fragmentShader.includes('fwidth(paddyStripePhase)'));
  assert.equal(PADDY_LOOK.rowStrength,.06);assert.equal(PADDY_LOOK.groundWaveStrength,.08);
  const cut=paddySurfaceColor({plot:{tint:1},cut:true},0,0),gold=paddySurfaceColor({plot:{tint:1},cut:false},0,0);
  const luminance=c=>.2126*c.r+.7152*c.g+.0722*c.b;assert(luminance(cut)>=luminance(gold)*.95);assert(cut.getHSL({}).s<gold.getHSL({}).s);
  let disposed=0;ground.uniforms.uPaddyPhase.value.addEventListener('dispose',()=>disposed++);disposeTerrain(b);assert.equal(disposed,1);dispose(v);
});
