import { createHash } from 'node:crypto';
import { readAccessor, decodedAccessor, viewBytes, accessorLayout, accessorSlots } from './glb.mjs';

const requireValid = (condition, reason) => { if (!condition) throw new TypeError(reason); };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function validateStructure(doc) {
  const { json, bin } = doc;
  requireValid(json.buffers?.length === 1 && json.buffers[0].byteLength === bin.length, 'Buffer length: inconsistent');
  const ranges = (json.bufferViews || []).map((v, i) => {
    viewBytes(doc, i);
    requireValid((v.byteOffset ?? 0) % 4 === 0, 'BufferView alignment: expected four bytes');
    if (v.byteStride !== undefined) requireValid(v.byteStride >= 4 && v.byteStride <= 252 && v.byteStride % 4 === 0, 'BufferView stride: invalid');
    return [v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength];
  }).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) requireValid(ranges[i][0] >= ranges[i - 1][1], 'BufferView overlap: shared bytes');
  for (let i = 0; i < (json.accessors?.length || 0); i++) {
    const a = json.accessors[i], l = accessorLayout(a); readAccessor(doc, i);
    requireValid(((json.bufferViews[a.bufferView]?.byteOffset ?? 0) + (a.byteOffset ?? 0)) % l.bytes === 0, 'Accessor alignment: component boundary');
    requireValid(!a.normalized || ![5125, 5126].includes(a.componentType), 'Accessor normalization: invalid component type');
  }
  for (const [o, k] of accessorSlots(json)) requireValid(Number.isInteger(o[k]) && !!json.accessors[o[k]], 'Accessor reference: missing');
  const used = new Set(json.extensionsUsed || []);
  const walk = o => {
    if (!o || typeof o !== 'object') return;
    if (o.extensions) for (const k of Object.keys(o.extensions)) requireValid(used.has(k), 'Extension declaration: missing ' + k);
    for (const value of Object.values(o)) walk(value);
  }; walk(json);
  for (const name of json.extensionsRequired || []) requireValid(used.has(name), 'Required extension: missing from extensionsUsed');
  for (const m of json.meshes || []) for (const p of m.primitives) {
    for (const [semantic, index] of Object.entries(p.attributes)) {
      const a = json.accessors[index], l = accessorLayout(a), v = json.bufferViews[a.bufferView];
      requireValid(((a.byteOffset ?? 0) + (v.byteOffset ?? 0)) % 4 === 0 && (v.byteStride ?? l.elementBytes) % 4 === 0, 'Vertex alignment: ' + semantic);
      if (['NORMAL', 'TANGENT'].includes(semantic) && a.componentType !== 5126) {
        requireValid(a.normalized && used.has('KHR_mesh_quantization') && json.extensionsRequired?.includes('KHR_mesh_quantization'), 'Mesh quantization extension: missing');
      }
    }
  }
  for (const animation of json.animations || []) for (const c of animation.channels) {
    const s = animation.samplers[c.sampler]; requireValid(!!s && !!json.nodes[c.target.node], 'Animation reference: sampler/node');
    const t = readAccessor(doc, s.input), out = readAccessor(doc, s.output);
    requireValid(t.type === 'SCALAR' && t.componentType === 5126 && !t.normalized, 'Animation input: expected float SCALAR');
    requireValid(out.count === t.count * (s.interpolation === 'CUBICSPLINE' ? 3 : 1), 'Animation output: key count');
    for (let i = 0; i < t.count; i++) requireValid(Number.isFinite(t.array[i]) && (i === 0 || t.array[i] > t.array[i - 1]), 'Animation time: invalid order');
  }
  return { accessors: json.accessors.length, bufferViews: ranges.length, images: (json.images || []).map(i => sha256(viewBytes(doc, i.bufferView))) };
}

// Column-major affine algebra, written independently of the compression and renderer.
export const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}
export function compose(t, q, s) {
  const [x, y, z, w] = q;
  return [
    (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    ...t, 1,
  ];
}
const norm = q => { const n = Math.hypot(...q); requireValid(n > 0 && Number.isFinite(n), 'Quaternion: invalid length'); return q.map(x => x / n); };
export function rotationError(a, b) {
  a = norm(a); b = norm(b);
  // Chord distance avoids cancellation for very small angles and handles q/-q.
  const minus = Math.hypot(...a.map((x, i) => x - b[i])), plus = Math.hypot(...a.map((x, i) => x + b[i]));
  return 4 * Math.asin(Math.min(1, Math.min(minus, plus) / 2)) * 180 / Math.PI;
}
export function slerp(a, b, u) {
  let d = a.reduce((n, x, i) => n + x * b[i], 0);
  if (d < 0) { b = b.map(x => -x); d = -d; }
  if (d > 0.999999) return norm(a.map((x, i) => x * (1 - u) + b[i] * u));
  const theta = Math.acos(Math.min(1, d)), den = Math.sin(theta);
  return a.map((x, i) => (x * Math.sin((1 - u) * theta) + b[i] * Math.sin(u * theta)) / den);
}
export function sampleTrack(track, time) {
  const { times, values, size, interpolation, rotation } = track;
  requireValid(['LINEAR', 'STEP'].includes(interpolation), 'Animation interpolation: expected LINEAR/STEP');
  let lo = 0, hi = times.length - 1;
  if (time <= times[0]) hi = 0;
  else if (time >= times[hi]) lo = hi;
  else { while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= time) lo = mid; else hi = mid; } }
  const a = Array.from(values.subarray(lo * size, lo * size + size));
  if (lo === hi || interpolation === 'STEP' || time === times[lo]) return a;
  const b = Array.from(values.subarray(hi * size, hi * size + size)), u = (time - times[lo]) / (times[hi] - times[lo]);
  return rotation ? slerp(a, b, u) : a.map((x, i) => x + (b[i] - x) * u);
}

export function prepareAnimation(doc, animation) {
  return animation.channels.map(c => {
    const s = animation.samplers[c.sampler], output = decodedAccessor(doc, s.output);
    return { node: c.target.node, path: c.target.path, times: decodedAccessor(doc, s.input).array, values: output.array, size: output.size, rotation: c.target.path === 'rotation', interpolation: s.interpolation || 'LINEAR' };
  });
}
export function worldMatrices(doc, tracks, time) {
  const nodes = doc.json.nodes, transforms = nodes.map(n => ({ translation: n.translation || [0, 0, 0], rotation: n.rotation || [0, 0, 0, 1], scale: n.scale || [1, 1, 1] }));
  for (const t of tracks) {
    requireValid(['translation', 'rotation', 'scale'].includes(t.path) && !nodes[t.node].matrix, 'Animation target: unsupported path/matrix');
    transforms[t.node][t.path] = sampleTrack(t, time);
  }
  const parents = new Map(); for (let i = 0; i < nodes.length; i++) for (const c of nodes[i].children || []) { requireValid(!parents.has(c), 'Node hierarchy: multiple parents'); parents.set(c, i); }
  const matrices = [], active = new Set();
  const visit = i => {
    requireValid(!!nodes[i] && !active.has(i), 'Node hierarchy: missing node/cycle');
    if (matrices[i]) return matrices[i]; active.add(i);
    const n = transforms[i], local = nodes[i].matrix || compose(n.translation, n.rotation, n.scale);
    matrices[i] = parents.has(i) ? multiply(visit(parents.get(i)), local) : local;
    active.delete(i); return matrices[i];
  };
  nodes.forEach((_, i) => visit(i)); return matrices;
}
export function prepareMeshes(doc) {
  const result = [];
  for (const n of doc.json.nodes) if (n.mesh !== undefined && n.skin !== undefined) {
    const skin = doc.json.skins[n.skin], inverse = skin.inverseBindMatrices === undefined ? null : decodedAccessor(doc, skin.inverseBindMatrices).array;
    for (const p of doc.json.meshes[n.mesh].primitives) {
      const attr = semantic => decodedAccessor(doc, p.attributes[semantic]).array;
      const weights = attr('WEIGHTS_0');
      // GLTFLoader normalizes skin weights on load. Independently apply the same
      // mathematical invariant before comparing the two deformation results.
      for (let v = 0; v < weights.length; v += 4) {
        const sum = weights[v] + weights[v + 1] + weights[v + 2] + weights[v + 3];
        requireValid(sum > 0 && Number.isFinite(sum), 'Skinning weights: invalid sum');
        for (let k = 0; k < 4; k++) weights[v + k] /= sum;
      }
      result.push({ position: attr('POSITION'), weights, joints: attr('JOINTS_0'), skin: skin.joints, inverse: skin.joints.map((_, i) => inverse ? Array.from(inverse.subarray(i * 16, i * 16 + 16)) : identity()) });
    }
  }
  requireValid(result.length > 0, 'Skinning: no skinned mesh'); return result;
}
export function skinPositions(mesh, worlds) {
  const matrices = mesh.skin.map((n, i) => multiply(worlds[n], mesh.inverse[i]));
  const out = new Float64Array(mesh.position.length);
  for (let v = 0; v < out.length / 3; v++) {
    const p = mesh.position.subarray(v * 3, v * 3 + 3);
    for (let j = 0; j < 4; j++) {
      const w = mesh.weights[v * 4 + j]; if (!w) continue;
      const m = matrices[mesh.joints[v * 4 + j]]; requireValid(!!m, 'Skinning joint: out of range');
      for (let r = 0; r < 3; r++) out[v * 3 + r] += w * (m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
    }
  }
  return out;
}

function same(a, b, reason) { requireValid(JSON.stringify(a) === JSON.stringify(b), reason); }
export function compareCharacters(original, compressed) {
  const structure = validateStructure(compressed), originalStructure = validateStructure(original);
  same(structure.images, originalStructure.images, 'Image SHA256: changed');
  for (const k of ['nodes', 'materials', 'scenes', 'scene', 'textures', 'images']) {
    // Image bufferView indices are storage, all other image fields remain unchanged.
    const clean = json => k === 'images' ? json.images.map(({ bufferView, ...i }) => i) : json[k];
    same(clean(original.json), clean(compressed.json), 'Metadata changed: ' + k);
  }
  same(original.json.skins.map(({ inverseBindMatrices, ...s }) => s), compressed.json.skins.map(({ inverseBindMatrices, ...s }) => s), 'Skin joint order: changed');
  const om = prepareMeshes(original), cm = prepareMeshes(compressed); requireValid(om.length === cm.length, 'Mesh count: changed');
  for (let i = 0; i < om.length; i++) for (const k of ['position', 'joints', 'skin', 'inverse']) same(om[i][k], cm[i][k], 'Mesh data changed: ' + k);
  for (let i = 0; i < original.json.meshes.length; i++) for (let p = 0; p < original.json.meshes[i].primitives.length; p++) {
    const a = original.json.meshes[i].primitives[p], b = compressed.json.meshes[i].primitives[p];
    same(Array.from(readAccessor(original, a.indices).array), Array.from(readAccessor(compressed, b.indices).array), 'Mesh indices: changed');
  }
  const clips = []; let maxRotationDegrees = 0, maxPositionMm = 0, sum = 0, count = 0;
  for (const anim of compressed.json.animations) {
    const source = original.json.animations.find(a => a.name === anim.name); requireValid(!!source, 'Animation name: missing original');
    const ot = prepareAnimation(original, source), ct = prepareAnimation(compressed, anim);
    same(ot.map(t => [t.node, t.path, t.interpolation, Array.from(t.times)]), ct.map(t => [t.node, t.path, t.interpolation, Array.from(t.times)]), 'Animation channels/timing: changed');
    let rotationDegrees = 0;
    for (let i = 0; i < ot.length; i++) {
      if (!ot[i].rotation) { same(ot[i].values, ct[i].values, 'Animation translation/scale: changed'); continue; }
      for (let k = 0; k < ot[i].times.length; k++) {
        rotationDegrees = Math.max(rotationDegrees, rotationError(Array.from(ot[i].values.subarray(k * 4, k * 4 + 4)), Array.from(ct[i].values.subarray(k * 4, k * 4 + 4))));
        if (k) { const mid = (ot[i].times[k - 1] + ot[i].times[k]) / 2; rotationDegrees = Math.max(rotationDegrees, rotationError(sampleTrack(ot[i], mid), sampleTrack(ct[i], mid))); }
      }
    }
    const start = Math.min(...ot.map(t => t.times[0])), end = Math.max(...ot.map(t => t.times[t.times.length - 1])), times = [start, (start + end) / 2, end];
    let maxMm = 0, sumMm = 0, vertices = 0;
    for (const time of times) {
      const ow = worldMatrices(original, ot, time), cw = worldMatrices(compressed, ct, time);
      for (let mi = 0; mi < om.length; mi++) {
        const a = skinPositions(om[mi], ow), b = skinPositions(cm[mi], cw);
        for (let v = 0; v < a.length; v += 3) {
          const mm = Math.hypot(a[v] - b[v], a[v + 1] - b[v + 1], a[v + 2] - b[v + 2]) * 1000;
          requireValid(Number.isFinite(mm), 'Skinning error: non-finite'); maxMm = Math.max(maxMm, mm); sumMm += mm; vertices++;
        }
      }
    }
    clips.push({ name: anim.name, times, rotationDegrees, maxPositionMm: maxMm, meanPositionMm: sumMm / vertices, vertexSamples: vertices });
    maxRotationDegrees = Math.max(maxRotationDegrees, rotationDegrees); maxPositionMm = Math.max(maxPositionMm, maxMm); sum += sumMm; count += vertices;
  }
  return { structure, clips, maxRotationDegrees, maxPositionMm, meanPositionMm: sum / count, vertexSamples: count, targets: { rotation: maxRotationDegrees < 0.01, position: maxPositionMm < 3 } };
}
