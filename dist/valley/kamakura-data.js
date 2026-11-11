import { validateSea } from './kamakura-shore.js';
import { decodeWorks, worksEnabled } from './kamakura-works.js';
import { validateMist } from './kamakura-mist.js';
import { validateBackdrop } from './kamakura-backdrop.js';
import { prepareAvenue } from './kamakura-avenue.js';
import { overlookConfig } from './kamakura-fly.js';
import { townFillConfig, prepareTownFill } from './kamakura-town-fill.js';
import { sandoLines, sandoEnabled } from './kamakura-sando.js';
import { decodeFacilities } from './kamakura-facilities.js';
import { decodeRoads, decodeCrossings, kamakuraPaths, roadStats } from './kamakura-roads.js';
import { decodeRivers } from './kamakura-rivers.js';
import { decodeVeg } from './kamakura-veg.js';
import { decodeHouses } from './kamakura-houses.js';
// Runtime world files only: no bundled geography or remote service.
export function validateMeta(m) {
  const g = m?.grid, h = m?.height;
  if (!['kz-world-web/0.1', 'kz-world-web/0.2', 'kz-world-web/0.3', 'kz-world-web/0.4', 'kz-world-web/0.5', 'kz-world-web/0.6', 'kz-world-web/0.7', 'kz-world-web/0.8', 'kz-world-web/0.9'].includes(m?.schema) || !g || !h ||
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
      m.patches.axes_file !== 'patch_axes.json' || (m.patches.paths_file !== undefined && m.patches.paths_file !== 'patch_paths.json') || m.patches.subdivisions !== 4 ||
      !Number.isInteger(m.patches.total_cells) || m.patches.total_cells < 1 || m.patches.total_cells > g.width * g.height)) {
    throw new Error('鎌倉パッチの形式が対応していません');
  }
  validateSea(m.sea);
  validateMist(m.mist);
  validateBackdrop(m.backdrop);
  townFillConfig(m.town_fill);
  overlookConfig(m.overlook);
  return m;
}
export function decodeData(meta, heightBuffer, walkBuffer, patchBuffers, groundBuffer) {
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
    const paths = patchBuffers.paths;
    if (meta.patches.paths_file && (!paths || !meta.patches.items.every(({ id }) => {
      const p = Object.hasOwn(paths, id) ? paths[id] : null, n = p?.xyz_m?.length;
      return n >= 2 && typeof p.route_id === 'string' && p.s_m?.length === n &&
        p.xyz_m.every((q, i) => q.length === 3 && q.every(Number.isFinite) &&
          (!i || Math.hypot(q[0] - p.xyz_m[i - 1][0], q[1] - p.xyz_m[i - 1][1]) > 0)) &&
        p.s_m.every((v, i) => Number.isFinite(v) && (!i || v > p.s_m[i - 1]));
    }))) throw new Error('鎌倉パッチの道の線が不正です');
    patches = { cells, heights: values, index, axes, paths: paths || null };
  }
  const ground = meta.ground && groundBuffer?.byteLength === count * 3 ? new Uint8Array(groundBuffer) : null;
  const groundNotice = ground ? '' : '地面の色を読み込めませんでした。単色で散策を続けます';
  return { meta, heights, walk, patches, ground, groundNotice, veg: null, vegNotice: '', rivers: null, riverNotice: '', roads: null, sando: null };
}
export async function loadKamakura(fetcher = fetch, search = globalThis.location?.search || '') {
  const read = async name => {
    const response = await fetcher('/world-private/' + name, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('鎌倉データを読み込めません');
    return response;
  };
  const meta = validateMeta(await (await read('meta.json')).json());
  const [height, walk] = await Promise.all([read(meta.height.file), read(meta.walk.file)]);
  let patchBuffers;
  if (meta.patches) {
    const [cells, heights, axes] = await Promise.all([read(meta.patches.cells_file), read(meta.patches.h_file), read(meta.patches.axes_file)]);
    patchBuffers = { cells: await cells.arrayBuffer(), heights: await heights.arrayBuffer(), axes: await axes.json() };
    if (meta.patches.paths_file) patchBuffers.paths = await (await read(meta.patches.paths_file)).json();
  }
  const data = decodeData(meta, await height.arrayBuffer(), await walk.arrayBuffer(), patchBuffers);
  if (meta.roads && new URLSearchParams(search).get('roads') !== '0') {
    try {
      if (meta.roads.file !== 'roads.json' || meta.roads.schema !== 'kz-roads/0.1' || !Number.isInteger(meta.roads.count)) throw new Error();
      const source = await (await read('roads.json')).json();
      data.roads = decodeRoads(source, meta.roads.count);
      data.crossings = decodeCrossings(source);
      if (new URLSearchParams(search).get('avenue') !== '0' || meta.town_fill !== undefined) for (const [id, road] of Object.entries(data.roads)) road.route_id = source.roads[id].route_id;
    } catch { /* Optional roads failure keeps the existing pass paths and terrain. */ }
  }
  if (meta.works && worksEnabled(search)) {
    if (meta.works.file !== 'works.json') throw new Error('港の作り物のファイルが不正です');
    data.works = decodeWorks(await (await read('works.json')).json());
  }
  data.surface = null;
  if (meta.surface) {
    try {
      if (meta.surface.file !== 'surface_class_u8.bin' || !/^uint8(?:$| )/.test(meta.surface.encoding)) throw new Error();
      const surface = await (await read('surface_class_u8.bin')).arrayBuffer();
      if (surface.byteLength !== meta.grid.width * meta.grid.height) throw new Error();
      data.surface = new Uint8Array(surface);
    } catch { /* Optional surface failure retains dirt footsteps. */ }
  }
  if (meta.ground) {
    try {
      if (meta.ground.file !== 'ground_rgb.bin') throw new Error();
      const ground = await (await read(meta.ground.file)).arrayBuffer();
      if (ground.byteLength !== meta.grid.width * meta.grid.height * 3) throw new Error();
      data.ground = new Uint8Array(ground); data.groundNotice = '';
    } catch { /* Optional colour failure keeps the decoded, walkable terrain. */ }
  }
  if (meta.houses) {
    try {
      if (meta.houses.file !== 'houses.json' || meta.houses.instances !== 'houses_f32.bin' || meta.houses.kit !== 'houses_kit.glb') throw new Error();
      const [catalog, placements, kit] = await Promise.all([read(meta.houses.file), read(meta.houses.instances), read(meta.houses.kit)]);
      data.houses = decodeHouses(await catalog.json(), await placements.arrayBuffer());
      data.houses.kit = await kit.arrayBuffer();
    } catch {
      data.houses = null; data.houseNotice = '家を読み込めませんでした。家なしで散策を続けます';
    }
  }
  if (meta.veg) {
    try {
      if (!Number.isInteger(meta.veg.count) || meta.veg.file !== 'veg_f32.bin' || meta.veg.info !== 'veg.json') throw new Error();
      const [info, bin] = await Promise.all([read('veg.json'), read('veg_f32.bin')]);
      data.veg = decodeVeg(await info.json(), await bin.arrayBuffer(), meta.veg.count);
    } catch { data.veg = null; data.vegNotice = '木を読み込めませんでした。木なしで散策を続けます'; }
  }
  if (meta.rivers) {
    try {
      if (meta.rivers.file !== 'rivers.json' || !Number.isInteger(meta.rivers.count) || meta.rivers.count < 1 || !Number.isInteger(meta.rivers.points)) throw new Error();
      data.rivers = decodeRivers(await (await read('rivers.json')).json(), meta.rivers.count);
      if (data.rivers.points !== meta.rivers.points) throw new Error();
    } catch { data.rivers = null; data.riverNotice = '川を読み込めませんでした。川なしで散策を続けます'; }
  }
  if (meta.facilities) {
    try {
      if (meta.facilities.file !== 'facilities.json' || meta.facilities.kit !== 'facilities.glb') throw new Error();
      const [catalog, kit] = await Promise.all([read('facilities.json'), read('facilities.glb')]);
      data.facilities = decodeFacilities(await catalog.json());
      if (data.facilities.nodes.length !== meta.facilities.count || data.facilities.catalog.total_triangles !== meta.facilities.total_triangles) throw new Error();
      data.facilities.kit = await kit.arrayBuffer();
    } catch { data.facilities = null; data.facilityNotice = '施設を読み込めませんでした。施設なしで散策を続けます'; }
  }
  data.sando = null;
  if (data.facilities && sandoEnabled(search)) {
    try { data.sando = sandoLines(data); }
    catch { data.sando = null; data.sandoNotice = '参道を作れませんでした。散策を続けます'; }
  }
  if (!data.sandoNotice && new URLSearchParams(search).get('avenue') !== '0') { data.avenue = prepareAvenue(data); if (data.avenue) data.veg = data.avenue.veg; }
  const town = data.sandoNotice || new URLSearchParams(search).get('townfill') === '0' ? null : prepareTownFill(data, { search });
  if (town) { data.houses = town.houses; data.lanes = town.lanes; data.townPlots = town.townPlots; }
  globalThis.__kzTownFill?.dispose?.();
  if (new URLSearchParams(search).get('townfilldebug') === '1' || new URLSearchParams(search).get('debug') === '1') {
    const debug = () => town?.stats || null;
    debug.dispose = () => { if (globalThis.__kzTownFill === debug) delete globalThis.__kzTownFill; }; globalThis.__kzTownFill = debug;
  }
  return data;
}

const roadDebug = new WeakMap();
export function updateKamakuraRoadPaths(data, pos, view, search) {
  let debug = roadDebug.get(data);
  if (!debug) {
    debug = { pos };
    roadDebug.set(data, debug);
    if (new URLSearchParams(search).get('debug') === '1') globalThis.__kzRoads = () => roadStats(data, debug.pos);
  }
  debug.pos = pos;
  return view?.update(pos, kamakuraPaths(data));
}
