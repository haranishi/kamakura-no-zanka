import { writeAccessor, repackGlb } from '../../tools/lib/glb.mjs';

export function characterFixture() {
  const json = { asset: { version: '2.0' }, buffers: [{ byteLength: 0 }], bufferViews: [], accessors: [],
    nodes: [{ name: 'root', children: [1, 3], translation: [0.1, 0, 0] }, { name: 'bone0', children: [2] }, { name: 'bone1', translation: [0, 0.01, 0] }, { name: 'body', mesh: 0, skin: 0 }],
    skins: [{ joints: [1, 2] }], meshes: [{ primitives: [{ attributes: {} }] }], scenes: [{ nodes: [0] }], scene: 0,
    images: [], textures: [{ extensions: { EXT_texture_webp: { source: 0 } } }], extensionsUsed: ['EXT_texture_webp'], extensionsRequired: ['EXT_texture_webp'], materials: [{ name: 'unchanged' }], animations: [] };
  const doc = { json, bin: Buffer.alloc(0) };
  const add = (type, componentType, values, options = {}) => {
    const i = json.accessors.push({ type, count: values.length / ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type]) }) - 1;
    writeAccessor(doc, i, { array: Float64Array.from(values), componentType, ...options }); return i;
  };
  // An unused leading accessor tests renumbering of every downstream reference.
  add('SCALAR', 5126, [123]);
  const p = json.meshes[0].primitives[0];
  p.attributes.POSITION = add('VEC3', 5126, [0, 0, 0, 0.01, 0, 0, 0, 0.01, 0]);
  p.attributes.NORMAL = add('VEC3', 5126, [0, 0, 1, 0, 0, 1, 0, 0, 1]);
  p.attributes.TANGENT = add('VEC4', 5126, [1, 0, 0, 1, 1, 0, 0, -1, 1, 0, 0, 1]);
  p.attributes.TEXCOORD_0 = add('VEC2', 5126, [0, 0, 1, 0, 0, 1]);
  p.attributes.JOINTS_0 = add('VEC4', 5121, [0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]);
  p.attributes.WEIGHTS_0 = add('VEC4', 5126, [1, 0, 0, 0, 0.25, 0.75, 0, 0, 0, 1, 0, 0]);
  p.indices = add('SCALAR', 5123, [0, 1, 2]);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const ib0 = [...identity], ib1 = [...identity]; ib0[12] = -0.1; ib1[12] = -0.1; ib1[13] = -0.01;
  json.skins[0].inverseBindMatrices = add('MAT4', 5126, [...ib0, ...ib1]);
  const input = add('SCALAR', 5126, [0, 1]);
  const output = add('VEC4', 5126, [0, 0, 0, 1, 0, 0, -Math.SQRT1_2, -Math.SQRT1_2]);
  const translation = add('VEC3', 5126, [0, 0.01, 0, 0, 0.02, 0]);
  json.animations = [{ name: 'Keep', samplers: [{ input, output, interpolation: 'LINEAR' }, { input, output: translation, interpolation: 'STEP' }], channels: [{ sampler: 0, target: { node: 2, path: 'rotation' } }, { sampler: 1, target: { node: 2, path: 'translation' } }] }];
  const image = Buffer.from('unchanged synthetic image');
  const offset = (doc.bin.length + 3) & ~3, bin = Buffer.alloc(offset + image.length); doc.bin.copy(bin); image.copy(bin, offset); doc.bin = bin;
  const view = json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: image.length }) - 1;
  json.images.push({ bufferView: view, mimeType: 'image/webp' }); json.buffers[0].byteLength = bin.length;
  return doc;
}
