// GLB 2.0 container and accessor operations. No filesystem, clock or random state.
export const COMPONENTS = { 5120: [Int8Array, 1, 'getInt8', 'setInt8'], 5121: [Uint8Array, 1, 'getUint8', 'setUint8'], 5122: [Int16Array, 2, 'getInt16', 'setInt16'], 5123: [Uint16Array, 2, 'getUint16', 'setUint16'], 5125: [Uint32Array, 4, 'getUint32', 'setUint32'], 5126: [Float32Array, 4, 'getFloat32', 'setFloat32'] };
export const SHAPES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
export const align4 = n => Math.ceil(n / 4) * 4;
const fail = message => { throw new TypeError(message); };
const integer = n => Number.isSafeInteger(n) && n >= 0;

export function parseGlb(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20) fail('GLB header: expected Buffer');
  if (buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) fail('GLB header: magic/version/length');
  const chunks = [];
  for (let offset = 12; offset < buffer.length;) {
    if (offset + 8 > buffer.length) fail('GLB chunk: truncated header');
    const length = buffer.readUInt32LE(offset), type = buffer.readUInt32LE(offset + 4);
    if (length % 4 || offset + 8 + length > buffer.length) fail('GLB chunk: alignment/range');
    chunks.push({ type, data: buffer.subarray(offset + 8, offset + 8 + length) }); offset += 8 + length;
  }
  if (chunks[0]?.type !== 0x4e4f534a || chunks.length > 2 || (chunks[1] && chunks[1].type !== 0x004e4942)) fail('GLB chunk: expected JSON then BIN');
  let json;
  try { json = JSON.parse(chunks[0].data.toString('utf8')); } catch { fail('GLB JSON: invalid syntax'); }
  const bin = chunks[1]?.data || Buffer.alloc(0);
  if (!json || typeof json !== 'object' || Array.isArray(json) || json.asset?.version !== '2.0') fail('GLB JSON: asset version');
  if ((json.buffers?.length || 0) > 1 || json.buffers?.[0]?.uri) fail('GLB buffer: expected single embedded buffer');
  const length = json.buffers?.[0]?.byteLength ?? 0;
  if (!integer(length) || length > bin.length || bin.length - length > 3) fail('GLB buffer: byteLength');
  return { json, bin: bin.subarray(0, length) };
}

export function buildGlb({ json, bin }) {
  if (!json || json.asset?.version !== '2.0' || !Buffer.isBuffer(bin)) fail('GLB build: invalid document');
  const j = structuredClone(json); j.buffers = [{ ...(j.buffers?.[0] || {}), byteLength: bin.length }];
  delete j.buffers[0].uri;
  const data = Buffer.from(JSON.stringify(j)), jl = align4(data.length), bl = align4(bin.length);
  const out = Buffer.alloc(12 + 8 + jl + 8 + bl);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jl, 12); out.writeUInt32LE(0x4e4f534a, 16); out.fill(0x20, 20, 20 + jl); data.copy(out, 20);
  out.writeUInt32LE(bl, 20 + jl); out.writeUInt32LE(0x004e4942, 24 + jl); bin.copy(out, 28 + jl);
  return out;
}

export function accessorLayout(a) {
  const spec = COMPONENTS[a?.componentType], size = SHAPES[a?.type];
  if (!spec || !size || !integer(a.count)) fail('Accessor type/count: unsupported');
  const bytes = spec[1], dim = a.type.startsWith('MAT') ? Math.sqrt(size) : 0;
  const column = dim ? align4(dim * bytes) : 0;
  const offsets = Array.from({ length: size }, (_, i) => dim ? Math.floor(i / dim) * column + i % dim * bytes : i * bytes);
  return { size, bytes, offsets, elementBytes: dim ? dim * column : size * bytes, spec };
}

export function viewBytes(doc, index) {
  const v = doc.json.bufferViews?.[index];
  if (!v || (v.buffer ?? 0) !== 0 || !integer(v.byteOffset ?? 0) || !integer(v.byteLength) || (v.byteOffset ?? 0) + v.byteLength > doc.bin.length) fail('BufferView range: outside BIN');
  return doc.bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
}

export function readAccessor(doc, index) {
  const a = doc.json.accessors?.[index], layout = accessorLayout(a);
  const { size, bytes, offsets, elementBytes, spec } = layout;
  const array = new spec[0](a.count * size);
  if (a.bufferView !== undefined) {
    const v = doc.json.bufferViews?.[a.bufferView], data = viewBytes(doc, a.bufferView), stride = v.byteStride ?? elementBytes, start = a.byteOffset ?? 0;
    if (!integer(start) || start % bytes || !integer(stride) || stride < elementBytes || stride % bytes || start + (a.count ? (a.count - 1) * stride + elementBytes : 0) > data.length) fail('Accessor range/stride: outside bufferView');
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) array[i * size + k] = dv[spec[2]](start + i * stride + offsets[k], true);
  } else if (!a.sparse) fail('Accessor storage: missing bufferView');
  if (a.sparse) {
    const s = a.sparse, ispec = COMPONENTS[s.indices.componentType];
    if (![5121, 5123, 5125].includes(s.indices.componentType) || !integer(s.count) || s.count > a.count) fail('Sparse accessor: invalid indices/count');
    const ib = viewBytes(doc, s.indices.bufferView), vb = viewBytes(doc, s.values.bufferView), io = s.indices.byteOffset ?? 0, vo = s.values.byteOffset ?? 0;
    if (!integer(io) || !integer(vo) || io + s.count * ispec[1] > ib.length || vo + s.count * elementBytes > vb.length) fail('Sparse accessor range: outside bufferView');
    const id = new DataView(ib.buffer, ib.byteOffset, ib.byteLength), vd = new DataView(vb.buffer, vb.byteOffset, vb.byteLength);
    let previous = -1;
    for (let i = 0; i < s.count; i++) {
      const target = id[ispec[2]](io + i * ispec[1], true);
      if (target <= previous || target >= a.count) fail('Sparse accessor index: order/range'); previous = target;
      for (let k = 0; k < size; k++) array[target * size + k] = vd[spec[2]](vo + i * elementBytes + offsets[k], true);
    }
  }
  return { array, type: a.type, size, count: a.count, componentType: a.componentType, normalized: a.normalized === true };
}

export function decodedAccessor(doc, index) {
  const a = readAccessor(doc, index);
  const max = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535, 5125: 4294967295 }[a.componentType];
  return { ...a, array: Float64Array.from(a.array, v => a.normalized ? Math.max(-1, v / max) : v) };
}

// Replace only the storage/type of an accessor. Repacking removes its old view later.
export function writeAccessor(doc, index, { array, componentType, normalized = false, byteStride }) {
  const a = doc.json.accessors?.[index], spec = COMPONENTS[componentType];
  if (!a || !spec || !ArrayBuffer.isView(array) || array.length !== a.count * SHAPES[a.type]) fail('Accessor write: type/shape mismatch');
  const layout = accessorLayout({ ...a, componentType }), stride = byteStride ?? layout.elementBytes;
  if (stride < layout.elementBytes || stride % spec[1]) fail('Accessor write: invalid stride');
  const data = Buffer.alloc(a.count * stride), dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < layout.size; k++) dv[spec[3]](i * stride + layout.offsets[k], array[i * layout.size + k], true);
  const offset = align4(doc.bin.length), bin = Buffer.alloc(offset + data.length); doc.bin.copy(bin); data.copy(bin, offset); doc.bin = bin;
  const oldView = doc.json.bufferViews?.[a.bufferView];
  const view = { buffer: 0, byteOffset: offset, byteLength: data.length };
  if (oldView?.target !== undefined) view.target = oldView.target;
  if (byteStride !== undefined) view.byteStride = stride;
  doc.json.bufferViews ||= []; a.bufferView = doc.json.bufferViews.push(view) - 1;
  a.byteOffset = 0; a.componentType = componentType;
  if (normalized) a.normalized = true; else delete a.normalized;
  delete a.sparse;
  for (const key of ['min', 'max']) if (a[key]) a[key] = Array.from({ length: layout.size }, (_, k) => {
    let n = key === 'min' ? Infinity : -Infinity;
    for (let i = k; i < array.length; i += layout.size) n = key === 'min' ? Math.min(n, array[i]) : Math.max(n, array[i]);
    return n;
  });
  doc.json.buffers[0].byteLength = bin.length;
}

// Reference slots are explicit: unrelated numeric metadata must never be renumbered.
export function accessorSlots(json) {
  const slots = [], add = (o, k) => { if (o?.[k] !== undefined) slots.push([o, k]); };
  for (const m of json.meshes || []) for (const p of m.primitives || []) {
    add(p, 'indices'); for (const k of Object.keys(p.attributes || {})) add(p.attributes, k);
    for (const t of p.targets || []) for (const k of Object.keys(t)) add(t, k);
  }
  for (const s of json.skins || []) add(s, 'inverseBindMatrices');
  for (const a of json.animations || []) for (const s of a.samplers || []) { add(s, 'input'); add(s, 'output'); }
  for (const n of json.nodes || []) { const attrs = n.extensions?.EXT_mesh_gpu_instancing?.attributes; for (const k of Object.keys(attrs || {})) add(attrs, k); }
  return slots;
}

export function repackGlb(doc) {
  const json = structuredClone(doc.json), slots = accessorSlots(json);
  const used = [...new Set(slots.map(([o, k]) => o[k]))].sort((a, b) => a - b);
  const map = new Map(used.map((n, i) => [n, i]));
  json.accessors = used.map(n => { if (!json.accessors?.[n]) fail('Accessor reference: missing'); return json.accessors[n]; });
  for (const [o, k] of slots) o[k] = map.get(o[k]);
  const views = [];
  const add = (o, k) => { if (o?.[k] !== undefined) views.push([o, k]); };
  for (const a of json.accessors) { add(a, 'bufferView'); add(a.sparse?.indices, 'bufferView'); add(a.sparse?.values, 'bufferView'); }
  for (const i of json.images || []) add(i, 'bufferView');
  const indices = [...new Set(views.map(([o, k]) => o[k]))].sort((a, b) => a - b);
  const vm = new Map(indices.map((n, i) => [n, i])); let length = 0;
  const parts = indices.map(n => { const data = viewBytes(doc, n); const offset = align4(length); length = offset + data.length; return { data, offset }; });
  json.bufferViews = indices.map((n, i) => ({ ...json.bufferViews[n], buffer: 0, byteOffset: parts[i].offset }));
  for (const [o, k] of views) o[k] = vm.get(o[k]);
  const bin = Buffer.alloc(align4(length)); for (const p of parts) p.data.copy(bin, p.offset);
  json.buffers = [{ ...json.buffers?.[0], byteLength: bin.length }];
  return { json, bin };
}

// Share byte-identical accessors with identical metadata, without changing sampled values.
// Images are deliberately excluded; only accessor storage is canonicalized.
export function deduplicateAccessors(doc) {
  const canonical = new Map(), remap = new Map();
  const meshAccessors = new Set(accessorSlots({ meshes: doc.json.meshes }).map(([o, k]) => o[k]));
  for (let i = 0; i < doc.json.accessors.length; i++) {
    const a = doc.json.accessors[i];
    if (a.sparse || a.extensions || meshAccessors.has(i)) { remap.set(i, i); continue; }
    const { bufferView, byteOffset, ...metadata } = a;
    const data = readAccessor(doc, i).array;
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const key = JSON.stringify(metadata) + ':' + bytes.toString('base64');
    if (canonical.has(key)) remap.set(i, canonical.get(key));
    else { canonical.set(key, i); remap.set(i, i); }
  }
  for (const [o, k] of accessorSlots(doc.json)) o[k] = remap.get(o[k]);
  return repackGlb(doc);
}

// Animation/skin accessors can share one unstrided view. This removes repeated JSON
// view records while retaining each accessor's exact bytes and component alignment.
export function coalesceAccessorViews(doc) {
  const json = structuredClone(doc.json), protectedViews = new Set((json.images || []).map(i => i.bufferView));
  for (const [o, k] of accessorSlots({ meshes: json.meshes })) protectedViews.add(json.accessors[o[k]].bufferView);
  for (const a of json.accessors) if (a.sparse) { protectedViews.add(a.sparse.indices.bufferView); protectedViews.add(a.sparse.values.bufferView); }
  const candidates = json.bufferViews.map((v, i) => i).filter(i => !protectedViews.has(i) && json.bufferViews[i].target === undefined && json.bufferViews[i].byteStride === undefined);
  if (candidates.length < 2) return doc;
  // Preserve view extension/extras metadata by leaving such views separate.
  const indices = candidates.filter(i => Object.keys(json.bufferViews[i]).every(k => ['buffer', 'byteOffset', 'byteLength'].includes(k)));
  const selected = new Set(indices);
  const accessors = json.accessors.filter(a => selected.has(a.bufferView));
  const blocks = accessors.map(a => {
    const l = accessorLayout(a), view = viewBytes(doc, a.bufferView), start = a.byteOffset || 0;
    return { a, data: view.subarray(start, start + a.count * l.elementBytes) };
  }).sort((a, b) => b.data.length - a.data.length);
  // Prefixes/subranges (notably shared time axes and constant tracks) need no second
  // copy. Overlapping accessor ranges are legal; the bufferView itself stays unique.
  const combined = Buffer.alloc(blocks.reduce((n, b) => n + align4(b.data.length), 0));
  let length = 0;
  for (const block of blocks) {
    let offset = combined.subarray(0, length).indexOf(block.data);
    while (offset >= 0 && offset % 4 !== 0) offset = combined.subarray(0, length).indexOf(block.data, offset + 1);
    if (offset < 0) { offset = align4(length); block.data.copy(combined, offset); length = offset + block.data.length; }
    block.a.byteOffset = offset;
  }
  const start = align4(doc.bin.length), bin = Buffer.alloc(start + align4(length)); doc.bin.copy(bin); combined.copy(bin, start, 0, length);
  const index = json.bufferViews.push({ buffer: 0, byteOffset: start, byteLength: align4(length) }) - 1;
  for (const a of accessors) a.bufferView = index;
  return repackGlb({ json, bin });
}
