// Pure surface samples and river-bank queries. Coordinates: east/up/south.
const keys = ['grass', 'dirt', 'rock', 'gravel', 'mud', 'litter'];
const classes = ['gravel', 'mud', 'grass', 'litter', 'dirt', 'rock', 'gravel', 'mud'];
export function surfaceWeights(code) {
  const key = classes[code] || 'dirt';
  return Object.fromEntries(keys.map(k => [k, +(k === key)]));
}
export function createSurfaceAt(meta, samples) {
  const { width, height, cell_m: cell } = meta.grid;
  const valid = meta.surface && samples instanceof Uint8Array && samples.length === width * height;
  return (x, z) => {
    if (!valid) return surfaceWeights(255);
    const i = Math.max(0, Math.min(width - 1, Math.round(x / cell + (width - 1) / 2)));
    const j = Math.max(0, Math.min(height - 1, Math.round(z / cell + (height - 1) / 2)));
    return surfaceWeights(samples[j * width + i]);
  };
}
export function segmentBankDistance(s, x, z) {
  const dx = s.bx - s.ax, dz = s.bz - s.az, length2 = dx * dx + dz * dz;
  const t = length2 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / length2)) : 0;
  return Math.max(0, Math.hypot(x - s.ax - t * dx, z - s.az - t * dz) - (s.ah + t * (s.bh - s.ah)));
}
export function createRiverIndex(data, cell = 256) {
  const segments = [], cells = new Map();
  let minI = Infinity, maxI = -Infinity, minJ = Infinity, maxJ = -Infinity, references = 0;
  for (const r of data?.rivers || []) for (let k = 1; k < r.xy_m.length; k++) {
    const s = { ax: r.xy_m[k - 1][0], az: -r.xy_m[k - 1][1], bx: r.xy_m[k][0], bz: -r.xy_m[k][1], ah: r.width_m[k - 1] / 2, bh: r.width_m[k] / 2 };
    const id = segments.length, half = Math.max(s.ah, s.bh); segments.push(s);
    const i0 = Math.floor((Math.min(s.ax, s.bx) - half) / cell), i1 = Math.floor((Math.max(s.ax, s.bx) + half) / cell);
    const j0 = Math.floor((Math.min(s.az, s.bz) - half) / cell), j1 = Math.floor((Math.max(s.az, s.bz) + half) / cell);
    minI = Math.min(minI, i0); maxI = Math.max(maxI, i1); minJ = Math.min(minJ, j0); maxJ = Math.max(maxJ, j1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const key = `${i},${j}`; if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(id); references++;
    }
  }
  function riverDistanceAt(x, z) {
    if (!segments.length) return Infinity;
    const ci = Math.max(minI, Math.min(maxI, Math.floor(x / cell))), cj = Math.max(minJ, Math.min(maxJ, Math.floor(z / cell)));
    let best = Infinity; const seen = new Set();
    const visit = (i, j) => {
      for (const id of cells.get(`${i},${j}`) || []) {
        if (seen.has(id)) continue; seen.add(id);
        best = Math.min(best, segmentBankDistance(segments[id], x, z));
      }
    };
    const limit = Math.max(ci - minI, maxI - ci, cj - minJ, maxJ - cj);
    for (let ring = 0; ring <= limit; ring++) {
      const left = ci - ring, right = ci + ring, top = cj - ring, bottom = cj + ring;
      if (!ring) visit(ci, cj);
      else {
        for (let i = Math.max(minI, left); i <= Math.min(maxI, right); i++) {
          if (top >= minJ) visit(i, top); if (bottom <= maxJ) visit(i, bottom);
        }
        for (let j = Math.max(minJ, top + 1); j <= Math.min(maxJ, bottom - 1); j++) {
          if (left >= minI) visit(left, j); if (right <= maxI) visit(right, j);
        }
      }
      // Segments occupy every cell of their half-width-expanded AABB. Any
      // unvisited bank is at least this far away, even for queries outside it.
      const remaining = Math.min(left > minI ? Math.max(0, x - left * cell) : Infinity,
        right < maxI ? Math.max(0, (right + 1) * cell - x) : Infinity,
        top > minJ ? Math.max(0, z - top * cell) : Infinity,
        bottom < maxJ ? Math.max(0, (bottom + 1) * cell - z) : Infinity);
      if (best <= remaining) break;
    }
    return best;
  }
  return { riverDistanceAt, segments, cells, cell, references };
}
