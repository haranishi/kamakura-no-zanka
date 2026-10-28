import { decodedAccessor, readAccessor, writeAccessor, repackGlb, deduplicateAccessors, coalesceAccessorViews, accessorSlots, accessorLayout } from './glb.mjs';

const dot = (a, b) => a.reduce((s, x, k) => s + x * b[k], 0);
const unit = v => { const n = Math.hypot(...v); if (!n) throw new TypeError('Quantization: zero vector'); return v.map(x => x / n); };
export function angleDegrees(a, b, quaternion = false) {
  const d = dot(unit(a), unit(b));
  return Math.acos(Math.min(1, Math.max(-1, quaternion ? Math.abs(d) : d))) * (quaternion ? 360 : 180) / Math.PI;
}

export function byteBreakdown(doc) {
  const groups = { images: [], animation: [], mesh: [] };
  const region = index => {
    const a = doc.json.accessors[index], v = doc.json.bufferViews[a.bufferView], l = accessorLayout(a);
    const start = (v.byteOffset || 0) + (a.byteOffset || 0), stride = v.byteStride ?? l.elementBytes;
    return [start, start + (a.count ? (a.count - 1) * stride + l.elementBytes : 0)];
  };
  for (const i of doc.json.images || []) if (i.bufferView !== undefined) {
    const v = doc.json.bufferViews[i.bufferView]; groups.images.push([v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength]);
  }
  for (const a of doc.json.animations || []) for (const s of a.samplers) { groups.animation.push(region(s.input), region(s.output)); }
  for (const [o, k] of accessorSlots({ ...doc.json, animations: [] })) groups.mesh.push(region(o[k]));
  const length = ranges => {
    let total = 0, end = -1;
    for (const [a, b] of ranges.sort((a, b) => a[0] - b[0])) { total += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b); }
    return total;
  };
  // Reused accessor subranges count once per category. Cross-category sharing is
  // reported separately so totals cannot imply that shared BIN bytes are duplicated.
  const unique = length(Object.values(groups).flat());
  const result = Object.fromEntries(Object.entries(groups).map(([k, ranges]) => [k, length(ranges)]));
  result.sharedBytes = Object.values(result).reduce((n, x) => n + x, 0) - unique;
  result.binPadding = doc.bin.length - unique;
  return result;
}

export function compressCharacter(original, keep) {
  const doc = { json: structuredClone(original.json), bin: Buffer.from(original.bin) };
  const removedClips = doc.json.animations.filter(a => !keep(a.name)).map(a => a.name);
  doc.json.animations = doc.json.animations.filter(a => keep(a.name));
  const errors = { rotationDegrees: 0, normalDegrees: 0, tangentDegrees: 0, uv: 0, weight: 0 };
  const rotations = new Set(), skippedUV = [];
  for (const a of doc.json.animations) for (const c of a.channels) if (c.target.path === 'rotation') {
    const s = a.samplers[c.sampler];
    if (!['LINEAR', 'STEP'].includes(s.interpolation || 'LINEAR')) throw new TypeError('Rotation interpolation: expected LINEAR/STEP');
    if (rotations.has(s.output)) continue; rotations.add(s.output);
    const input = decodedAccessor(doc, s.output); if (input.type !== 'VEC4') throw new TypeError('Rotation shape: expected VEC4');
    const out = new Int16Array(input.array.length); let previous = null;
    for (let i = 0; i < input.count; i++) {
      let q = unit(Array.from(input.array.subarray(i * 4, i * 4 + 4)));
      if (previous && dot(previous, q) < 0) q = q.map(v => -v);
      previous = q; const quant = q.map(v => Math.round(v * 32767)); out.set(quant, i * 4);
      errors.rotationDegrees = Math.max(errors.rotationDegrees, angleDegrees(q, quant, true));
    }
    writeAccessor(doc, s.output, { array: out, componentType: 5122, normalized: true });
  }
  const outOfRangeMeshes = new Set();
  for (const [mi, mesh] of doc.json.meshes.entries()) for (const p of mesh.primitives) {
    const i = p.attributes.TEXCOORD_0;
    if (i !== undefined && decodedAccessor(doc, i).array.some(v => v < 0 || v > 1)) outOfRangeMeshes.add(mi);
  }
  const done = new Set(); let quantizedMesh = false;
  for (const [mi, mesh] of doc.json.meshes.entries()) for (const [pi, primitive] of mesh.primitives.entries()) {
    for (const semantic of ['WEIGHTS_0', 'TEXCOORD_0', 'NORMAL', 'TANGENT']) {
      const index = primitive.attributes[semantic]; if (index === undefined || done.has(index)) continue; done.add(index);
      const a = decodedAccessor(doc, index), values = a.array;
      if (![...values].every(Number.isFinite)) throw new TypeError('Vertex attribute: non-finite value');
      if (semantic === 'TEXCOORD_0' && outOfRangeMeshes.has(mi)) { skippedUV.push({ mesh: mi, primitive: pi, reason: 'outside [0,1]' }); continue; }
      const type = semantic === 'TEXCOORD_0' ? 5123 : semantic === 'WEIGHTS_0' ? 5121 : 5120;
      const max = type === 5123 ? 65535 : type === 5121 ? 255 : 127;
      const out = type === 5123 ? new Uint16Array(values.length) : type === 5121 ? new Uint8Array(values.length) : new Int8Array(values.length);
      for (let i = 0; i < a.count; i++) {
        const v = Array.from(values.subarray(i * a.size, (i + 1) * a.size)); let quant;
        if (semantic === 'WEIGHTS_0') {
          if (a.size !== 4 || v.some(x => x < 0 || x > 1)) throw new TypeError('Weights: expected nonnegative VEC4');
          const sum = v.reduce((s, x) => s + x, 0); if (!sum) throw new TypeError('Weights: zero sum');
          quant = v.map(x => Math.round(x / sum * 255));
          const largest = v.indexOf(Math.max(...v)); quant[largest] += 255 - quant.reduce((s, x) => s + x, 0);
        } else if (semantic === 'NORMAL' || semantic === 'TANGENT') {
          quant = unit(v.slice(0, 3)).map(x => Math.max(-127, Math.min(127, Math.round(x * 127))));
          if (semantic === 'TANGENT') quant.push(v[3] < 0 ? -127 : 127);
          const key = semantic === 'NORMAL' ? 'normalDegrees' : 'tangentDegrees';
          errors[key] = Math.max(errors[key], angleDegrees(v.slice(0, 3), quant.slice(0, 3)));
          quantizedMesh = true;
        } else quant = v.map(x => Math.round(x * max));
        out.set(quant, i * a.size);
        if (semantic === 'WEIGHTS_0' || semantic === 'TEXCOORD_0') {
          const key = semantic === 'WEIGHTS_0' ? 'weight' : 'uv';
          for (let k = 0; k < a.size; k++) errors[key] = Math.max(errors[key], Math.abs(v[k] - quant[k] / max));
        }
      }
      writeAccessor(doc, index, { array: out, componentType: type, normalized: true, byteStride: semantic === 'NORMAL' ? 4 : undefined });
    }
  }
  if (quantizedMesh) for (const key of ['extensionsUsed', 'extensionsRequired']) doc.json[key] = [...new Set([...(doc.json[key] || []), 'KHR_mesh_quantization'])];
  return { doc: coalesceAccessorViews(deduplicateAccessors(repackGlb(doc))), removedClips, skippedUV, errors };
}
