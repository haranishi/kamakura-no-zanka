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
export function chunkGeometry(t, i0, j0, i1, j1, step = 1, edges = {}) {
  const xs = [], zs = [], positions = [], normals = [], indices = [];
  for (let i = i0; i < i1; i += step) xs.push(i); xs.push(i1);
  for (let j = j0; j < j1; j += step) zs.push(j); zs.push(j1);
  const sample = (i, j) => {
    const x = t.x0 + i * t.cell, z = t.z0 + j * t.cell;
    return { h: t.heightAt(x, z), n: t.normalAt(x, z) };
  };
  function add(i, j) {
    const horizontal = j === j0 ? edges.north : j === j1 ? edges.south : null;
    const vertical = i === i0 ? edges.west : i === i1 ? edges.east : null;
    let s = sample(i, j);
    if (horizontal || vertical) {
      const along = horizontal ? i : j, start = horizontal ? i0 : j0, end = horizontal ? i1 : j1;
      const spacing = Math.max(step, horizontal || vertical), a = start + Math.floor((along - start) / spacing) * spacing, b = Math.min(end, a + spacing);
      const sa = horizontal ? sample(a, j) : sample(i, a), sb = horizontal ? sample(b, j) : sample(i, b), u = a === b ? 0 : (along - a) / (b - a);
      const mix = (a, b) => a + (b - a) * u;
      // Interpolate normals as well as heights: fine-edge normals must not resample terrain.
      s = { h: mix(sa.h, sb.h), n: { x: mix(sa.n.x, sb.n.x), y: mix(sa.n.y, sb.n.y), z: mix(sa.n.z, sb.n.z) } };
    }
    positions.push(t.x0 + i * t.cell, s.h, t.z0 + j * t.cell);
    normals.push(s.n.x, s.n.y, s.n.z);
    return positions.length / 3 - 1;
  }
  for (const j of zs) for (const i of xs) add(i, j);
  const w = xs.length, h = zs.length;
  for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
    const a = j * w + i;
    if (!(i === 0 || j === 0 || i === w - 2 || j === h - 2)) { indices.push(a, a + w, a + 1, a + 1, a + w, a + w + 1); continue; }
    // Fan cells at the perimeter include every original sample, eliminating T junctions.
    const ring = [a];
    if (i === 0) for (let z = zs[j] + 1; z < zs[j + 1]; z++) ring.push(add(xs[i], z));
    ring.push(a + w);
    if (j === h - 2) for (let x = xs[i] + 1; x < xs[i + 1]; x++) ring.push(add(x, zs[j + 1]));
    ring.push(a + w + 1);
    if (i === w - 2) for (let z = zs[j + 1] - 1; z > zs[j]; z--) ring.push(add(xs[i + 1], z));
    ring.push(a + 1);
    if (j === 0) for (let x = xs[i + 1] - 1; x > xs[i]; x--) ring.push(add(x, zs[j]));
    const center = add((xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2);
    for (let k = 0; k < ring.length; k++) indices.push(center, ring[k], ring[(k + 1) % ring.length]);
  }
  return { positions, normals, indices };
}
