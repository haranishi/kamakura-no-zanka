// Pure chunk geometry, adapted from the author's web_q terrain stitch algorithm.
export const CHUNK_CELLS = 64;
export const LODS = [1, 2, 4, 8];
export function chooseLOD(distance, previous = 8) {
  const limits = [420, 950, 2100];
  let index = LODS.indexOf(previous);
  while (index > 0 && distance < limits[index - 1] * 0.9) index--;
  while (index < 3 && distance > limits[index] * 1.1) index++;
  return LODS[index];
}
export function choosePatchLOD(distance, previous = 8) {
  return distance < (previous === 1 ? 1320 : 1200) ? 1 : chooseLOD(distance, previous);
}
export function chunkGeometry(t, i0, j0, i1, j1, step = 1, edges = {}, ground = true) {
  const xs = [], zs = [], positions = [], normals = [], indices = [];
  for (let i = i0; i < i1; i += step) xs.push(i); xs.push(i1);
  for (let j = j0; j < j1; j += step) zs.push(j); zs.push(j1);
  const colors = ground && t.groundColorAt?.(t.x0, t.z0) ? [] : null;
  const sample = (i, j) => {
    const x = t.x0 + i * t.cell, z = t.z0 + j * t.cell;
    return { h: t.heightAt(x, z), n: t.normalAt(x, z) };
  };
  function add(i, j) {
    const horizontal = j === j0 ? edges.north : j === j1 ? edges.south : null;
    const vertical = i === i0 ? edges.west : i === i1 ? edges.east : null;
    let s = sample(i, j);
    // Equal near-detail neighbors share the actual fine surface, not a straight base edge.
    // Coarse neighbors still need the common projected edge during a distant LOD transition.
    if ((horizontal || vertical) && !(t.patches && step === 1 && Math.max(horizontal || 1, vertical || 1) === 1)) {
      const along = horizontal ? i : j, start = horizontal ? i0 : j0, end = horizontal ? i1 : j1;
      const spacing = Math.max(step, horizontal || vertical), a = start + Math.floor((along - start) / spacing) * spacing, b = Math.min(end, a + spacing);
      const sa = horizontal ? sample(a, j) : sample(i, a), sb = horizontal ? sample(b, j) : sample(i, b), u = a === b ? 0 : (along - a) / (b - a);
      const mix = (a, b) => a + (b - a) * u;
      // Interpolate normals as well as heights: fine-edge normals must not resample terrain.
      s = { h: mix(sa.h, sb.h), n: { x: mix(sa.n.x, sb.n.x), y: mix(sa.n.y, sb.n.y), z: mix(sa.n.z, sb.n.z) } };
    }
    positions.push(t.x0 + i * t.cell, s.h, t.z0 + j * t.cell);
    normals.push(s.n.x, s.n.y, s.n.z);
    if (colors) colors.push(...t.groundColorAt(t.x0 + i * t.cell, t.z0 + j * t.cell));
    return positions.length / 3 - 1;
  }
  for (const j of zs) for (const i of xs) add(i, j);
  const w = xs.length, h = zs.length;
  for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
    const a = j * w + i;
    if (step === 1 && t.patchIndex?.(xs[i], zs[j]) !== undefined) {
      const fine = [];
      for (let r = 0; r <= 4; r++) for (let c = 0; c <= 4; c++) fine.push(add(xs[i] + c / 4, zs[j] + r / 4));
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        const k = r * 5 + c;
        indices.push(fine[k], fine[k + 5], fine[k + 1], fine[k + 1], fine[k + 5], fine[k + 6]);
      }
      continue; // Replace the base cell, never overlay it.
    }
    // Match every quarter-cell vertex along a patch perimeter (also across chunks).
    if (step === 1 && ((t.patches && (i === 0 || j === 0 || i === w - 2 || j === h - 2)) || [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dz]) => t.patchIndex?.(xs[i] + dx, zs[j] + dz) !== undefined))) {
      const ring = [];
      for (let k = 0; k < 4; k++) ring.push(add(xs[i], zs[j] + k / 4));
      for (let k = 0; k < 4; k++) ring.push(add(xs[i] + k / 4, zs[j] + 1));
      for (let k = 0; k < 4; k++) ring.push(add(xs[i] + 1, zs[j] + 1 - k / 4));
      for (let k = 0; k < 4; k++) ring.push(add(xs[i] + 1 - k / 4, zs[j]));
      const center = add(xs[i] + 0.5, zs[j] + 0.5);
      for (let k = 0; k < ring.length; k++) indices.push(center, ring[k], ring[(k + 1) % ring.length]);
      continue;
    }
    if (!(i === 0 || j === 0 || i === w - 2 || j === h - 2)) { indices.push(a, a + w, a + 1, a + 1, a + w, a + w + 1); continue; }
    // Fan cells at the perimeter include every original sample, eliminating T junctions.
    const ring = [a];
    if (i === 0) for (let z = zs[j] + (t.patches ? 0.25 : 1); z < zs[j + 1]; z += step > 1 && t.patches ? 0.25 : 1) ring.push(add(xs[i], z));
    ring.push(a + w);
    if (j === h - 2) for (let x = xs[i] + (t.patches ? 0.25 : 1); x < xs[i + 1]; x += step > 1 && t.patches ? 0.25 : 1) ring.push(add(x, zs[j + 1]));
    ring.push(a + w + 1);
    if (i === w - 2) for (let z = zs[j + 1] - (t.patches ? 0.25 : 1); z > zs[j]; z -= step > 1 && t.patches ? 0.25 : 1) ring.push(add(xs[i + 1], z));
    ring.push(a + 1);
    if (j === 0) for (let x = xs[i + 1] - (t.patches ? 0.25 : 1); x > xs[i]; x -= step > 1 && t.patches ? 0.25 : 1) ring.push(add(x, zs[j]));
    const center = add((xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2);
    for (let k = 0; k < ring.length; k++) indices.push(center, ring[k], ring[(k + 1) % ring.length]);
  }
  return { positions, normals, indices, colors: colors ? new Float32Array(colors) : null };
}
