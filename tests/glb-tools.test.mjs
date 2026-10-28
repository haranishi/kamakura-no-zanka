// なぜ失敗したか: [container/range/reference/alignment/image/stride] で破損した層を示す。
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGlb, buildGlb, readAccessor, decodedAccessor, writeAccessor, repackGlb, deduplicateAccessors, viewBytes } from '../tools/lib/glb.mjs';
import { characterFixture } from './fixtures/character-glb.mjs';

test('GLB round trip preserves JSON and BIN [container]', () => {
  const d = characterFixture(), bytes = buildGlb(d), back = parseGlb(bytes);
  assert.deepEqual(back.json, d.json, '[container] JSON metadata changed');
  assert.deepEqual(back.bin, d.bin, '[container] BIN changed');
  assert.deepEqual(buildGlb(back), bytes, '[container] nondeterministic output');
  const jl = bytes.readUInt32LE(12), raw = Buffer.from(JSON.stringify(d.json));
  assert.equal(jl % 4, 0, '[alignment] JSON chunk'); assert.equal(bytes.readUInt32LE(20 + jl) % 4, 0, '[alignment] BIN chunk');
  assert(bytes.subarray(20 + raw.length, 20 + jl).every(x => x === 32), '[alignment] JSON padding is not spaces');
});

test('repack renumbers mesh, skin, shared animation input and image [reference]', () => {
  const d = characterFixture(), image = viewBytes(d, d.json.images[0].bufferView), original = decodedAccessor(d, d.json.meshes[0].primitives[0].attributes.POSITION).array;
  const r = repackGlb(d), a = r.json.animations[0];
  assert.equal(r.json.accessors.length, d.json.accessors.length - 1, '[reference] unused accessor retained');
  assert.equal(r.json.meshes[0].primitives[0].attributes.POSITION, 0, '[reference] mesh not renumbered');
  assert.deepEqual(decodedAccessor(r, 0).array, original, '[reference] position data changed');
  assert.equal(a.samplers[0].input, a.samplers[1].input, '[reference] shared input broken');
  assert.equal(readAccessor(r, r.json.skins[0].inverseBindMatrices).type, 'MAT4', '[reference] inverse bind lost');
  assert.deepEqual(viewBytes(r, r.json.images[0].bufferView), image, '[image] bytes changed');
  assert(r.json.bufferViews.every(v => v.byteOffset % 4 === 0), '[alignment] bufferView offset');
  assert.deepEqual(repackGlb(r), r, '[reference] repack not idempotent');
});

test('strided normalized BYTE VEC3 returns packed raw and decoded values [stride]', () => {
  const d = characterFixture(), index = d.json.meshes[0].primitives[0].attributes.NORMAL;
  writeAccessor(d, index, { array: Int8Array.from([127, 0, -127, 0, 127, 0, -127, 0, 127]), componentType: 5120, normalized: true, byteStride: 4 });
  const a = readAccessor(parseGlb(buildGlb(d)), index);
  assert.equal(a.normalized, true, '[stride] normalization flag lost');
  assert.equal(a.size, 3, '[stride] shape lost');
  assert.deepEqual([...a.array], [127, 0, -127, 0, 127, 0, -127, 0, 127], '[stride] padding read as values');
  assert.deepEqual([...decodedAccessor(d, index).array], [1, 0, -1, 0, 1, 0, -1, 0, 1], '[stride] normalized decoding');
});

test('deduplication merges equal values while preserving references [reference]', () => {
  const d = characterFixture(), a = d.json.animations[0], i = a.samplers[0].input;
  const clone = structuredClone(d.json.accessors[i]);
  a.samplers[1].input = d.json.accessors.push(clone) - 1;
  const r = deduplicateAccessors(d);
  assert.equal(r.json.animations[0].samplers[0].input, r.json.animations[0].samplers[1].input, '[reference] equivalent input not shared');
});

test('invalid GLB and accessor inputs raise TypeError with a cause [range]', () => {
  for (const b of [null, Buffer.alloc(1), Buffer.alloc(24)]) assert.throws(() => parseGlb(b), TypeError, '[container] invalid header accepted');
  const d = characterFixture();
  assert.throws(() => readAccessor(d, 999), /Accessor type\/count/, '[range] missing accessor accepted');
  const i = d.json.meshes[0].primitives[0].attributes.POSITION;
  d.json.accessors[i].byteOffset = 99999;
  assert.throws(() => readAccessor(d, i), TypeError, '[range] out-of-view accepted');
  assert.throws(() => writeAccessor(d, i, { array: [1], componentType: 5126 }), TypeError, '[range] wrong shape accepted');
  const bytes = buildGlb(characterFixture()); bytes.writeUInt32LE(bytes.length + 4, 8);
  assert.throws(() => parseGlb(bytes), /GLB header/, '[container] bad length accepted');
});
