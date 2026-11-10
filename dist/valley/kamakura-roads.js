// Optional route data, independent of terrain height and rendering.
export const ROAD_POINT_LIMIT = 20000;
export function decodeRoads(source, count = source?.count) {
  if (source?.schema !== 'kz-roads/0.1' || !source.roads || typeof source.roads !== 'object' || Array.isArray(source.roads) ||
      !Number.isInteger(count) || count < 0 || count !== source.count || count > ROAD_POINT_LIMIT / 2) throw new Error('道の形式が不正です');
  const entries = Object.entries(source.roads), roads = Object.create(null);
  if (entries.length !== count) throw new Error('道の数が一致しません');
  let points = 0;
  for (const [id, road] of entries) {
    const xyz = road?.xyz_m;
    if (!id || typeof road?.route_id !== 'string' || typeof road.name !== 'string' ||
        !['local_road', 'kaido', 'trail'].includes(road.kind) || !Number.isFinite(road.width_m) || road.width_m < 1 || road.width_m > 40 ||
        !Array.isArray(xyz) || xyz.length < 2 || (points += xyz.length) > ROAD_POINT_LIMIT ||
        !Array.from(xyz).every((p, i) => Array.isArray(p) && p.length === 3 && Array.from(p).every(Number.isFinite) &&
          (!i || (Math.hypot(p[0] - xyz[i - 1][0], p[1] - xyz[i - 1][1]) > 0 &&
            Number.isFinite(Math.hypot(p[0] - xyz[i - 1][0], p[1] - xyz[i - 1][1])))))) throw new Error('道の線が不正です');
    roads[id] = { xyz_m: xyz, width_m: road.width_m, kind: road.kind, name: road.name };
  }
  return roads;
}

const combined = new WeakMap();
export function kamakuraPaths(data) {
  if (!data.roads) return data.patches?.paths;
  let paths = combined.get(data);
  if (!paths) {
    paths = Object.assign(Object.create(null), data.patches?.paths);
    for (const [id, road] of Object.entries(data.roads)) {
      let key = `road:${id}`;
      while (Object.hasOwn(paths, key)) key = `road:${key}`;
      paths[key] = road;
    }
    combined.set(data, paths);
  }
  return paths;
}

// Debug queries are user initiated; normal frames only update the position reference.
export function roadStats(data, pos) {
  let nearest = null;
  const roads = data.roads;
  if (roads) for (const [id, road] of Object.entries(roads)) for (let i = 1; i < road.xyz_m.length; i++) {
    const a = road.xyz_m[i - 1], b = road.xyz_m[i], dx = b[0] - a[0], dz = a[1] - b[1];
    const x = pos.x - a[0], z = pos.z + a[1];
    const t = Math.max(0, Math.min(1, (x * dx + z * dz) / (dx * dx + dz * dz)));
    const distance = Math.hypot(x - t * dx, z - t * dz);
    if (!nearest || distance < nearest.distance) nearest = { id, kind: road.kind, distance };
  }
  return { loaded: roads !== null && roads !== undefined, count: roads ? Object.keys(roads).length : 0, nearest };
}
