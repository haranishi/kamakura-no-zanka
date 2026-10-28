// なぜ失敗したか: [interpolation/hierarchy/skinning/structure/quantization] を失敗メッセージに残す。
import test from 'node:test';
import assert from 'node:assert/strict';
import { characterFixture } from './fixtures/character-glb.mjs';
import { buildGlb, parseGlb, readAccessor, viewBytes, coalesceAccessorViews } from '../tools/lib/glb.mjs';
import { compressCharacter } from '../tools/lib/character-compression.mjs';
import { validateStructure, compareCharacters, prepareAnimation, worldMatrices, prepareMeshes, skinPositions, sampleTrack, rotationError } from '../tools/lib/character-validation.mjs';

test('LINEAR slerp takes shortest arc; STEP holds and clamps [interpolation]', () => {
  const track = { times: [0, 2], values: Float64Array.from([0, 0, 0, 1, 0, 0, -Math.SQRT1_2, -Math.SQRT1_2]), size: 4, rotation: true, interpolation: 'LINEAR' };
  assert(rotationError(sampleTrack(track, 1), [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)]) < 1e-9, '[interpolation] antipodal slerp midpoint');
  track.interpolation = 'STEP';
  assert.deepEqual(sampleTrack(track, 1), [0, 0, 0, 1], '[interpolation] STEP changed before key');
  assert.deepEqual(sampleTrack(track, -1), [0, 0, 0, 1], '[interpolation] start not clamped');
  assert.deepEqual(sampleTrack(track, 2), [0, 0, -Math.SQRT1_2, -Math.SQRT1_2], '[interpolation] STEP final key not reached');
});

test('CPU skinning respects ancestors and inverse binds with analytic positions [skinning]', () => {
  const d = characterFixture(), tracks = prepareAnimation(d, d.json.animations[0]), mesh = prepareMeshes(d)[0];
  const at = t => skinPositions(mesh, worldMatrices(d, tracks, t));
  const start = at(0), end = at(1);
  assert(Math.hypot(start[3] - 0.01, start[4], start[5]) < 1e-8, '[skinning] bind pose should reproduce mesh position');
  // bone1 rotates 90 degrees and moves 1cm by STEP, bone0 stays at its bind.
  assert(Math.abs(end[3] - 0.085) < 1e-8 && Math.abs(end[4] + 0.0525) < 1e-8, '[skinning] weighted endpoint disagrees with analytic result');
  const worlds = worldMatrices(d, tracks, 0.5);
  assert(Math.abs(worlds[2][12] - 0.1) < 1e-8 && Math.abs(worlds[2][13] - 0.01) < 1e-8, '[hierarchy] parent translation or STEP pose lost');
});

test('quantization preserves indices, images, channels and normalized weight sum [quantization]', () => {
  const d = characterFixture();
  d.json.animations.push({ ...structuredClone(d.json.animations[0]), name: 'Remove' });
  const result = compressCharacter(d, name => name === 'Keep'), bytes = buildGlb(result.doc);
  assert.deepEqual(result.removedClips, ['Remove'], '[quantization] clip selection');
  assert.deepEqual(buildGlb(compressCharacter(d, n => n === 'Keep').doc), bytes, '[quantization] deterministic bytes');
  const c = parseGlb(bytes), check = compareCharacters(d, c);
  assert(check.maxRotationDegrees < 0.01 && check.maxPositionMm < 0.5, '[quantization] synthetic tolerance exceeded');
  const p = c.json.meshes[0].primitives[0], w = readAccessor(c, p.attributes.WEIGHTS_0);
  assert.equal(w.componentType, 5121, '[quantization] weight type');
  for (let i = 0; i < w.array.length; i += 4) assert.equal(w.array.subarray(i, i + 4).reduce((a, b) => a + b, 0), 255, '[quantization] weights do not sum to 255');
  assert.deepEqual(viewBytes(d, d.json.images[0].bufferView), viewBytes(c, c.json.images[0].bufferView), '[image] bytes changed');
  assert.equal(c.json.bufferViews[c.json.accessors[p.attributes.NORMAL].bufferView].byteStride, 4, '[alignment] normal stride');
});

test('UV outside unit square stays float and is reported [quantization]', () => {
  const d = characterFixture(), i = d.json.meshes[0].primitives[0].attributes.TEXCOORD_0, a = d.json.accessors[i], v = d.json.bufferViews[a.bufferView];
  d.bin.writeFloatLE(1.1, v.byteOffset);
  const r = compressCharacter(d, () => true), out = r.doc.json.meshes[0].primitives[0].attributes.TEXCOORD_0;
  assert.equal(r.doc.json.accessors[out].componentType, 5126, '[quantization] out-of-range UV changed');
  assert.equal(r.skippedUV.length, 1, '[quantization] missing skip reason');
});

test('independent verifier rejects range, overlap, alignment, extensions and changed images [structure]', () => {
  const corruptions = [
    [d => { d.json.bufferViews[0].byteLength = d.bin.length + 4; }, /BufferView range/],
    [d => { d.json.bufferViews[1].byteOffset = 0; }, /BufferView overlap/],
    [d => { d.json.bufferViews[0].byteOffset = 1; }, /BufferView alignment/],
    [d => { d.json.extensionsUsed = []; }, /Extension declaration/],
    [d => { d.json.accessors[1].byteOffset = 999999; }, /Accessor range/],
  ];
  for (const [change, reason] of corruptions) { const d = characterFixture(); change(d); assert.throws(() => validateStructure(d), reason, '[structure] corruption accepted'); }
  const d = characterFixture(), c = compressCharacter(d, () => true).doc;
  c.bin[c.json.bufferViews[c.json.images[0].bufferView].byteOffset] ^= 1;
  assert.throws(() => compareCharacters(d, c), /Image SHA256/, '[image] changed bytes accepted');
});

test('coalescing unstrided views preserves all samples and structural validity [reference]', () => {
  const d = characterFixture(), c = coalesceAccessorViews(d);
  validateStructure(c);
  for (let i = 0; i < d.json.accessors.length - 1; i++) assert.deepEqual(readAccessor(c, i).array, readAccessor(d, i + 1).array, '[reference] merged accessor differs');
});

test('a rotation output shared with STEP also has continuous quaternion signs [quantization]', () => {
  const d = characterFixture(); d.json.animations[0].samplers[0].interpolation = 'STEP';
  const linear = structuredClone(d.json.animations[0]); linear.name = 'Linear'; linear.samplers[0].interpolation = 'LINEAR'; d.json.animations.push(linear);
  const c = compressCharacter(d, () => true).doc;
  const a = readAccessor(c, c.json.animations[0].samplers[0].output).array;
  assert(a[3] > 0 && a[7] > 0, '[quantization] shared output retained antipodal keys');
});
