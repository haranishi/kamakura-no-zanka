// なぜ失敗したか: 地形が草の場より先にできるため、未コンパイル時の結線と品質切替を守る。
// 原因の型: meadow-texture / meadow-shader / meadow-dispose / meadow-wire。GPU/見た目は未検証。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.min.js';
const read = name => fs.readFileSync(new URL('../dist/valley/' + name, import.meta.url), 'utf8');
const source = read('terrain.js').replace(/from 'three'/g, `from '${new URL('../dist/vendor/three.module.min.js', import.meta.url).href}'`)
  .replace(/from '(\.\/[^']+)'/g, (_, p) => `from '${new URL('../dist/valley/' + p, import.meta.url).href}'`);
const { buildTerrain } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const terrain = { seed: 1, heightAt: () => 0, surfaceAt: () => ({ grass: .2, dirt: .8, rock: 0, gravel: 0, mud: 0, litter: 0 }), roadInfo: () => null, waterAt: () => 0, forestDensity: () => 0 };
const compile = material => {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader); return shader;
};

test('real Three cover texture survives compile and quality changes, replacing and disposing owned maps', () => {
  const built = buildTerrain({ terrain, textures: {} });
  built.setQuality('light');
  const initial = compile(built.material), zero = initial.uniforms.uCover.value;
  assert.equal(initial.uniforms.uDetail.value, 0, '[meadow-wire] precompile quality ignored');
  assert.deepEqual([...zero.image.data], [0], '[meadow-texture] default cover must be zero');
  assert.deepEqual(built.meadowCover(), { nx: 0, nz: 0, mean: 0, max: 0 }, '[meadow-wire] default stats');
  let zeroDisposed = 0; zero.addEventListener('dispose', () => zeroDisposed++);
  const data = new Uint8Array([0, 128, 255, 128, 0, 255]);
  built.setMeadowCover({ data, x0: -7, z0: 12, nx: 3, nz: 2 });
  assert.equal(zeroDisposed, 1, '[meadow-dispose] default texture leaked');
  const shader = compile(built.material), u = shader.uniforms, texture = u.uCover.value;
  assert.equal(initial.uniforms.uCover, u.uCover, '[meadow-wire] recompilation lost shared uniform');
  assert(texture.isDataTexture && texture.image.data === data, '[meadow-texture] incorrect upload');
  assert.equal(texture.format, THREE.RedFormat, '[meadow-texture] not red format');
  assert.equal(texture.type, THREE.UnsignedByteType, '[meadow-texture] not bytes');
  assert.equal(texture.unpackAlignment, 1, '[meadow-texture] odd width row alignment');
  for (const key of ['minFilter', 'magFilter']) assert.equal(texture[key], THREE.LinearFilter, '[meadow-texture] filtering');
  for (const key of ['wrapS', 'wrapT']) assert.equal(texture[key], THREE.ClampToEdgeWrapping, '[meadow-texture] wrapping');
  assert(!texture.flipY && !texture.generateMipmaps && texture.colorSpace === THREE.NoColorSpace, '[meadow-texture] data interpretation');
  assert.deepEqual(u.uCoverSize.value.toArray(), [3, 2], '[meadow-texture] dimensions');
  for (let i = 0; i < 3; i++) assert.equal(((-7 + i + .5) - u.uCoverOrigin.value.x) / u.uCoverSize.value.x, (i + .5) / 3, '[meadow-texture] half-texel alignment');
  assert.equal((12.5 - u.uCoverOrigin.value.y) / u.uCoverSize.value.y, .25, '[meadow-texture] z centre alignment');
  assert.equal(u.uMeadow.value, .85, '[meadow-shader] blend strength');
  assert.equal(u.uMeadowTint.value.getHexString(), '6b6a35', '[meadow-shader] tint mismatch');
  assert.deepEqual(built.meadowCover(), { nx: 3, nz: 2, mean: 766 / 6 / 255, max: 1 }, '[meadow-wire] stats not normalized');
  const stats = built.meadowCover(); stats.nx = 99;
  for (const q of ['light', 'standard', 'light']) {
    built.setQuality(q);
    assert.equal(compile(built.material).uniforms.uDetail.value, q === 'light' ? 0 : 1, '[meadow-wire] quality lost before compile');
    assert.equal(u.uCover.value, texture, '[meadow-dispose] quality replaced cover');
  }
  assert.equal(built.meadowCover().nx, 3, '[meadow-wire] stats exposed mutable state');
  let disposed = 0; texture.addEventListener('dispose', () => disposed++);
  built.setMeadowCover({ data: new Uint8Array([255]), x0: 0, z0: 0, nx: 1, nz: 1 });
  assert.equal(disposed, 1, '[meadow-dispose] replacement leaked texture');
  let finalDisposed = 0; u.uCover.value.addEventListener('dispose', () => finalDisposed++);
  built.material.dispose(); built.near.geometry.dispose(); built.far.geometry.dispose();
  assert.equal(finalDisposed, 1, '[meadow-dispose] material teardown leaked texture');
});

test('shader contracts preserve rock, far mips and bounded meadow tint before lighting', () => {
  const built = buildTerrain({ terrain, textures: {}, quality: 'light' });
  const shader = compile(built.material).fragmentShader;
  const start = shader.indexOf('vec2 coverUV'), end = shader.indexOf('float edgeNoise');
  const cover = shader.slice(start, end);
  assert.match(cover, /\(wxz - uCoverOrigin\) \/ uCoverSize/, '[meadow-shader] world mapping absent');
  assert.equal([...shader.matchAll(/texture\(uCover,/g)].length, 1, '[meadow-shader] cover lookup budget');
  assert.match(cover, /lessThan\(coverUV, vec2\(0.0\)\)/, '[meadow-shader] negative bounds missing');
  assert.match(cover, /greaterThanEqual\(coverUV, vec2\(1.0\)\)\)\) cover = 0.0/, '[meadow-shader] upper bounds missing');
  assert.match(cover, /float k = cover \* uMeadow;/, '[meadow-shader] cover strength unused');
  assert.match(cover, /w\[0\] = mix\(w\[0\], 1.0, k\)/, '[meadow-shader] grass weight unchanged');
  for (const i of [1, 3, 4, 5]) assert(cover.includes(`w[${i}] *= (1.0 - k)`), '[meadow-shader] soil layer not reduced');
  assert(!cover.includes('w[2]'), '[meadow-shader] rock weight changed');
  assert(start > shader.indexOf('float w[6]') && end < shader.indexOf('vec4 c[6]'), '[meadow-shader] weights changed after reads');
  assert.match(shader, /farMix = smoothstep\(70.0, 260.0, length\(vViewPosition\)\)/, '[meadow-shader] farMix changed');
  assert.match(shader, /textureLod\(uTexC, vec3\(uv, lf\), 7.0\).rgb, farMix/, '[meadow-shader] distant layer average lost');
  assert.match(shader, /mix\(albedo, uMeadowTint, cover \* 0.25 \* smoothstep\(20.0, 70.0, length\(vViewPosition\)\)\)/, '[meadow-shader] tint must be cover-only and capped');
  built.material.dispose(); built.near.geometry.dispose(); built.far.geometry.dispose();
});

test('main wires cover immediately after field creation and QA exposes live stats', () => {
  assert.match(read('main.js'), /const field = createGrassField\(WORLD, terrain\); live.grassField = field;\s*built.setMeadowCover\(coverMap\(field\)\);/, '[meadow-wire] missing post-field cover');
  assert.match(read('main.js'), /meadowCover: \(\) => built.meadowCover\(\)/, '[meadow-wire] QA callback missing');
  assert.match(read('qa.js'), /meadowCover\(\) \{ return ctl.meadowCover\(\); \}/, '[meadow-wire] QA API missing');
});
