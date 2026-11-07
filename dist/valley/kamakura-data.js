// Private data only: no bundled fallback, derived elevations, or remote service.
export function validateMeta(m) {
  const g = m?.grid, h = m?.height;
  if (!['kz-world-web/0.1', 'kz-world-web/0.2'].includes(m?.schema) || !g || !h ||
      !Number.isInteger(g.width) || !Number.isInteger(g.height) || g.width < 2 || g.height < 2 ||
      !(g.cell_m > 0) || !Number.isFinite(g.cell_m) || g.width * g.height > 32e6 ||
      g.row0 !== 'north' || g.col0 !== 'west' || g.sample_position !== 'cell_center' ||
      g.x_axis !== 'east' || g.y_axis !== 'north' || g.z_axis !== 'up' ||
      h.encoding !== 'uint16-le' || !Number.isFinite(h.max_m) || !Number.isFinite(h.min_m) || !(h.max_m > h.min_m) ||
      h.file !== 'height_u16.bin' || m.walk?.file !== 'walk_u8.bin' ||
      !Array.isArray(m.walk.polygon_m) || m.walk.polygon_m.length < 3 ||
      !m.walk.polygon_m.every(p => p.length === 2 && p.every(Number.isFinite)) ||
      !['x', 'y', 'z', 'yaw_deg_clockwise_from_north'].every(k => Number.isFinite(m.spawn?.[k])) ||
      !Array.isArray(m.places) || !m.places.every(p => typeof p.name === 'string' && Number.isFinite(p.x) && Number.isFinite(p.y))) {
    throw new Error('鎌倉データの形式が対応していません');
  }
  if (m.patches && (m.patches.cells_file !== 'patch_cells_i32.bin' || m.patches.h_file !== 'patch_h_f32.bin' ||
      m.patches.axes_file !== 'patch_axes.json' || m.patches.subdivisions !== 4 ||
      !Number.isInteger(m.patches.total_cells) || m.patches.total_cells < 1 || m.patches.total_cells > g.width * g.height)) {
    throw new Error('鎌倉パッチの形式が対応していません');
  }
  return m;
}
export function decodeData(meta, heightBuffer, walkBuffer, patchBuffers) {
  validateMeta(meta);
  const count = meta.grid.width * meta.grid.height;
  if (heightBuffer.byteLength !== count * 2 || walkBuffer.byteLength !== count) throw new Error('鎌倉データの長さが一致しません');
  const view = new DataView(heightBuffer), heights = new Uint16Array(count), walk = new Uint8Array(walkBuffer);
  for (let i = 0; i < count; i++) heights[i] = view.getUint16(i * 2, true);
  if (walk.some(v => v > 2)) throw new Error('鎌倉の歩行データが不正です');
  let patches = null;
  if (meta.patches) {
    const n = meta.patches.total_cells;
    if (!patchBuffers || patchBuffers.cells.byteLength !== n * 8 || patchBuffers.heights.byteLength !== n * 100) throw new Error('鎌倉パッチの長さが一致しません');
    const cells = new Int32Array(n * 2), values = new Float32Array(n * 25), index = new Map();
    const cv = new DataView(patchBuffers.cells), hv = new DataView(patchBuffers.heights);
    for (let k = 0; k < n; k++) {
      const r = cv.getInt32(k * 8, true), c = cv.getInt32(k * 8 + 4, true), key = r * meta.grid.width + c;
      if (r < 0 || c < 0 || r >= meta.grid.height - 1 || c >= meta.grid.width - 1 || index.has(key)) throw new Error('鎌倉パッチの升目が不正です');
      cells.set([r, c], k * 2); index.set(key, k);
    }
    for (let k = 0; k < values.length; k++) {
      values[k] = hv.getFloat32(k * 4, true);
      if (!Number.isFinite(values[k])) throw new Error('鎌倉パッチの高さが不正です');
    }
    const axes = patchBuffers.axes;
    if (!axes || !Array.isArray(meta.patches.items) || !meta.patches.items.length || !meta.patches.items.every(({ id }) => {
      const a = typeof id === 'string' && Object.hasOwn(axes, id) ? axes[id] : null, n = a?.xy_m?.length;
      return n >= 2 && a.floor_m?.length === n && a.s_m?.length === n && a.floor_width_m > 0 &&
        a.xy_m.every((p, i) => p.length === 2 && p.every(Number.isFinite) && (!i || Math.hypot(p[0] - a.xy_m[i - 1][0], p[1] - a.xy_m[i - 1][1]) > 0)) && a.floor_m.every(Number.isFinite) &&
        a.s_m.every((v, i) => Number.isFinite(v) && (i === 0 || v > a.s_m[i - 1]));
    })) throw new Error('鎌倉パッチの軸が不正です');
    patches = { cells, heights: values, index, axes };
  }
  return { meta, heights, walk, patches };
}
export async function loadKamakura(fetcher = fetch) {
  const read = async name => {
    const response = await fetcher('/world-private/' + name, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('鎌倉データを読み込めません');
    return response;
  };
  const meta = validateMeta(await (await read('meta.json')).json());
  const [height, walk] = await Promise.all([read(meta.height.file), read(meta.walk.file)]);
  let patchBuffers;
  if (meta.patches) {
    const [cells, heights, axes] = await Promise.all([read(meta.patches.cells_file), read(meta.patches.h_file), read(meta.patches.axes_file)]);
    patchBuffers = { cells: await cells.arrayBuffer(), heights: await heights.arrayBuffer(), axes: await axes.json() };
  }
  return decodeData(meta, await height.arrayBuffer(), await walk.arrayBuffer(), patchBuffers);
}
