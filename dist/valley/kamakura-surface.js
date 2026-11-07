// Pure surface samples and river-bank queries. Coordinates: east/up/south.
const keys = ['grass', 'dirt', 'rock', 'gravel', 'mud', 'litter'];
const classes = ['gravel', 'mud', 'grass', 'litter', 'dirt', 'rock', 'gravel', 'mud'];
export function surfaceWeights(code) {
  const key = classes[code] || 'dirt';
  return Object.fromEntries(keys.map(k => [k, +(k === key)]));
}
export function createSurfaceAt(meta, samples) {
  const codeAt = createSurfaceCodeAt(meta, samples);
  return (x, z) => surfaceWeights(codeAt(x, z));
}
// Keep raw sand/rice/gravel classes available without changing footstep weights.
export function createSurfaceCodeAt(meta, samples) {
  const { width, height, cell_m: cell } = meta.grid;
  const valid = meta.surface && samples instanceof Uint8Array && samples.length === width * height;
  return (x, z) => {
    if (!valid) return 255;
    const i = Math.max(0, Math.min(width - 1, Math.round(x / cell + (width - 1) / 2)));
    const j = Math.max(0, Math.min(height - 1, Math.round(z / cell + (height - 1) / 2)));
    return samples[j * width + i];
  };
}

export function segmentBankDistance(s, x, z) {
  const dx = s.bx - s.ax, dz = s.bz - s.az, length2 = dx * dx + dz * dz;
  const t = length2 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / length2)) : 0;
  return Math.max(0, Math.hypot(x - s.ax - t * dx, z - s.az - t * dz) - (s.ah + t * (s.bh - s.ah)));
}
// Grid index of river segments. Cells are numeric keys (no string building) and a per-query stamp
// replaces the visited-set, so a query is one array read per candidate segment.
// riverDistanceAt(x, z, reach): the exact bank distance when it is <= reach; otherwise some value
// above reach (the search stops as soon as no unvisited bank can be within reach). Callers that only
// compare against a threshold (water test, grass bank rules) pass reach so far queries stay cheap.
export function createRiverIndex(data, cell = 256) {
  const segments = [], boxes = [];
  let minI = Infinity, maxI = -Infinity, minJ = Infinity, maxJ = -Infinity, references = 0;
  for (const r of data?.rivers || []) for (let k = 1; k < r.xy_m.length; k++) {
    const s = { ax: r.xy_m[k - 1][0], az: -r.xy_m[k - 1][1], bx: r.xy_m[k][0], bz: -r.xy_m[k][1], ah: r.width_m[k - 1] / 2, bh: r.width_m[k] / 2 };
    const half = Math.max(s.ah, s.bh); segments.push(s);
    // Segments occupy every cell of their half-width-expanded AABB.
    const box = [Math.floor((Math.min(s.ax, s.bx) - half) / cell), Math.floor((Math.max(s.ax, s.bx) + half) / cell),
      Math.floor((Math.min(s.az, s.bz) - half) / cell), Math.floor((Math.max(s.az, s.bz) + half) / cell)];
    boxes.push(box);
    minI = Math.min(minI, box[0]); maxI = Math.max(maxI, box[1]); minJ = Math.min(minJ, box[2]); maxJ = Math.max(maxJ, box[3]);
  }
  const cols = maxI - minI + 1, cells = new Map();
  boxes.forEach(([i0, i1, j0, j1], id) => {
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const key = (j - minJ) * cols + (i - minI); let list = cells.get(key);
      if (!list) cells.set(key, list = []);
      list.push(id); references++;
    }
  });
  const stamp = new Uint32Array(segments.length);
  let epoch = 0, qx = 0, qz = 0, best = Infinity;
  function visit(i, j) {
    const list = cells.get((j - minJ) * cols + (i - minI)); if (!list) return;
    for (let n = 0; n < list.length; n++) {
      const id = list[n]; if (stamp[id] === epoch) continue; stamp[id] = epoch;
      const d = segmentBankDistance(segments[id], qx, qz); if (d < best) best = d;
    }
  }
  function riverDistanceAt(x, z, reach = Infinity) {
    if (!segments.length) return Infinity;
    if (++epoch === 0xffffffff) { stamp.fill(0); epoch = 1; }
    qx = x; qz = z; best = Infinity;
    const ci = Math.max(minI, Math.min(maxI, Math.floor(x / cell))), cj = Math.max(minJ, Math.min(maxJ, Math.floor(z / cell)));
    const maxRing = Math.max(ci - minI, maxI - ci, cj - minJ, maxJ - cj);
    for (let ring = 0; ring <= maxRing; ring++) {
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
      // Any unvisited bank is at least this far away, even for queries outside the index.
      const remaining = Math.min(left > minI ? Math.max(0, x - left * cell) : Infinity,
        right < maxI ? Math.max(0, (right + 1) * cell - x) : Infinity,
        top > minJ ? Math.max(0, z - top * cell) : Infinity,
        bottom < maxJ ? Math.max(0, (bottom + 1) * cell - z) : Infinity);
      if (best <= remaining || remaining > reach) break;
    }
    return best;
  }
  return { riverDistanceAt, segments, cells, cell, references };
}
