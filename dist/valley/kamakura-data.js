// Private data only: no bundled fallback, derived elevations, or remote service.
export function validateMeta(m) {
  const g = m?.grid, h = m?.height;
  if (m?.schema !== 'kz-world-web/0.1' || !g || !h ||
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
  return m;
}
export function decodeData(meta, heightBuffer, walkBuffer) {
  validateMeta(meta);
  const count = meta.grid.width * meta.grid.height;
  if (heightBuffer.byteLength !== count * 2 || walkBuffer.byteLength !== count) throw new Error('鎌倉データの長さが一致しません');
  const view = new DataView(heightBuffer), heights = new Uint16Array(count), walk = new Uint8Array(walkBuffer);
  for (let i = 0; i < count; i++) heights[i] = view.getUint16(i * 2, true);
  if (walk.some(v => v > 2)) throw new Error('鎌倉の歩行データが不正です');
  return { meta, heights, walk };
}
export async function loadKamakura(fetcher = fetch) {
  const read = async name => {
    const response = await fetcher('/world-private/' + name, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('鎌倉データを読み込めません');
    return response;
  };
  const meta = validateMeta(await (await read('meta.json')).json());
  const [height, walk] = await Promise.all([read(meta.height.file), read(meta.walk.file)]);
  return decodeData(meta, await height.arrayBuffer(), await walk.arrayBuffer());
}
