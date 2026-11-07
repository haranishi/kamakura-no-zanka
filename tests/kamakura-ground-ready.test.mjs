import test from 'node:test';
import assert from 'node:assert/strict';
import { THREE } from './helpers/tree-modules.mjs';
import { installGroundDetail } from '../dist/valley/kamakura-ground-detail.js';
import { TONE_FADE_MS } from '../dist/valley/kamakura-ground-tone.js';
import { groundUseAt } from '../dist/valley/kamakura-ground-tone-rules.js';
import { smooth } from '../dist/valley/kamakura-ground-pattern.js';
import { registerShoreView, unregisterShoreView } from '../dist/valley/kamakura-shore.js';
import { fixture } from './helpers/kamakura-fixture.mjs';

// W2c-9r1 ground, real-Chrome findings that the Node maths could not show:
//  1. SRGB8 cannot be mipmapped in WebGL2 (glGenerateMipmap fails): far ground and the aerial view lost every colour.
//  2. The 4 m weights take seconds to bake. While they were missing the tone was skipped and the legacy detail was switched
//     off, so the near ground was flat for the first half minute and then popped.
const synthetic = (size = 9) => {
  const d = fixture({ width: 9, height: 9, cell: 2 }); d.meta.ground = {}; d.meta.surface = {};
  if (size > 9) { d.meta.grid.width = size; d.meta.grid.height = size; d.meta.grid.cell_m = 4; } // a bake that needs many slices
  d.ground = new Uint8Array(size * size * 3).fill(140); d.surface = new Uint8Array(size * size).fill(2); return d;
};
function setup(size = 9) {
  const d = synthetic(size); registerShoreView(d, {});
  const material = new THREE.MeshLambertMaterial({ vertexColors: true }), owner = installGroundDetail(THREE, material, d);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  material.onBeforeCompile(shader);
  return { d, material, owner, shader, done() { owner.dispose(); material.dispose(); unregisterShoreView(d); } };
}

test('the base is an unconverted RGB8 texture that can build mipmaps; the shader decodes sRGB after filtering [mipmap]', () => {
  const { d, owner, shader, done } = setup(), base = owner.tone.textures[0];
  assert.equal(base.image.data, d.ground, 'the source bytes are uploaded as they are');
  assert.equal(base.format, THREE.RGBFormat);
  assert(base.generateMipmaps && base.minFilter === THREE.LinearMipmapLinearFilter);
  assert.notEqual(base.internalFormat, 'SRGB8', 'glGenerateMipmap fails for SRGB8 in WebGL2');
  assert.equal(base.internalFormat, 'RGB8', 'left unnamed, RGBFormat asks glTexStorage2D for the unsized RGB and the texture stays black');
  assert(shader.fragmentShader.includes('vec3 toneLinear(vec3 c)'));
  assert(shader.fragmentShader.includes('toneLinear(texture2D(uToneBase,uv).rgb)'));
  done();
});

test('the tone runs from the first frame on neutral weights; the baked weights are never sampled before they exist [ready]', () => {
  const { owner, shader, done } = setup(400), glsl = shader.fragmentShader; // 160k weight texels: several slices
  assert.equal(owner.tone.uniforms.uToneReady.value, 0); assert.equal(owner.tone.uniforms.uToneBlend.value, 0);
  assert(glsl.includes('if(uToneStrength>0.0)diffuseColor.rgb=groundTone('), 'the tone must not wait for the bake');
  assert(!glsl.includes('uToneReady*uToneStrength'), 'no gate on the bake any more');
  assert(glsl.includes('vec4 weights=vec4(0.0,0.0,0.0,1.0);'), 'neutral land before the weights exist');
  assert(glsl.includes('if(uToneBlend>0.0)weights=mix(weights,texture2D(uToneWeights,'), 'the weights texture is only read once it is blended in');
  assert(glsl.includes('uniform float uToneReady,uToneBlend,'));
  assert(owner.tone.textures[0].version > 0, 'the base texture is uploaded immediately');
  assert.equal(owner.tone.textures[1].version, 0, 'the weights are uploaded when the bake ends');
  done();
});

test('the weights fade in after the bake, once, and disposing stops the fade [ready]', async () => {
  const { owner, done } = setup(), u = owner.tone.uniforms;
  await owner.tone.ready;
  assert.equal(u.uToneReady.value, 1); assert(owner.tone.textures[1].version > 0);
  assert(u.uToneBlend.value >= 0 && u.uToneBlend.value < 1, 'fading, not popped');
  const seen = []; const t0 = performance.now();
  while (u.uToneBlend.value < 1 && performance.now() - t0 < TONE_FADE_MS + 800) { seen.push(u.uToneBlend.value); await new Promise(r => setTimeout(r, 40)); }
  await owner.tone.faded;
  assert.equal(u.uToneBlend.value, 1);
  assert(seen.length >= 5 && seen.every((v, i) => i === 0 || v >= seen[i - 1]), `monotone fade over several steps: ${seen.length}`);
  done();
  const second = setup(); await second.owner.tone.ready; second.done(); await second.owner.tone.faded; // dispose resolves a running fade
});

test('the use falloff early-out equals the plain distance loop everywhere [bake-speed]', () => {
  const reference = (boxes, x, z) => { let a = 0; for (const b of boxes) { const d = Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.z0 - z, 0, z - b.z1)); a = Math.max(a, 1 - smooth(0, 5, d)); } return a; };
  let state = 12345; const rand = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  const boxes = Array.from({ length: 12 }, () => { const x0 = rand() * 400 - 200, z0 = rand() * 400 - 200; return { x0, x1: x0 + 1 + rand() * 60, z0, z1: z0 + 1 + rand() * 60 }; });
  for (const b of boxes.slice(0, 3)) for (const [x, z] of [[b.x0 - 5, b.z0], [b.x1 + 5, b.z1], [b.x0 - 5.0001, b.z0 - 5.0001], [b.x1 + 4.999, b.z1 + 4.999], [b.x0, b.z1 + 5]]) assert.equal(groundUseAt(boxes, x, z), reference(boxes, x, z));
  for (let i = 0; i < 4000; i++) { const x = rand() * 500 - 250, z = rand() * 500 - 250; assert.equal(groundUseAt(boxes, x, z), reference(boxes, x, z)); }
});
