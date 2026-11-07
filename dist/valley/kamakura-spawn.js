// Pure path/axis interpolation and test departure; coordinates at the public boundary use z=south.
export function patchRoute(patches, id) {
  const path = patches?.paths && Object.hasOwn(patches.paths, id) ? patches.paths[id] : null;
  if (path) return { ...path, xy_m: path.xyz_m.map(p => p.slice(0, 2)), floor_m: path.xyz_m.map(p => p[2]),
    floor_width_m: patches.axes[id].floor_width_m };
  return patches?.axes && Object.hasOwn(patches.axes, id) ? patches.axes[id] : null;
}
export function axisPoint(axis, distance) {
  const s = axis.s_m, d = Math.max(s[0], Math.min(s.at(-1), s[0] + distance));
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid] <= d) lo = mid; else hi = mid; }
  const u = (d - s[lo]) / (s[hi] - s[lo]), a = axis.xy_m[lo], b = axis.xy_m[hi];
  const dx = b[0] - a[0], dz = a[1] - b[1], length = Math.hypot(dx, dz);
  return { x: a[0] + dx * u, z: -a[1] + dz * u, dx: dx / length, dz: dz / length,
    floor: axis.floor_m[lo] + (axis.floor_m[hi] - axis.floor_m[lo]) * u, distance: d - s[0] };
}
// Test departure at a chosen point: ?pos=<east>,<north> (metres, as the debug HUD prints them) and ?yaw=<degrees clockwise from north>.
// The nearest walkable point within 40 m is used, so a point inside a house or on a cliff still starts the walk.
export function pointDeparture(t, params, radius = 40) {
  const parts = String(params.get('pos') ?? '').split(',');
  if (parts.length !== 2 || parts.some(v => v.trim() === '')) return null;
  const east = Number(parts[0]), north = Number(parts[1]);
  if (!Number.isFinite(east) || !Number.isFinite(north)) return null;
  const turn = params.has('yaw') && params.get('yaw').trim() !== '' ? Number(params.get('yaw')) : NaN;
  const yaw = Number.isFinite(turn) ? -turn * Math.PI / 180 : -t.meta.spawn.yaw_deg_clockwise_from_north * Math.PI / 180;
  if (t.walkable(east, -north)) return { x: east, z: -north, yaw };
  const step = t.cell / 4, found = [];
  for (let z = -radius; z <= radius; z += step) for (let x = -radius; x <= radius; x += step) found.push({ x: east + x, z: -north + z, d: Math.hypot(x, z) });
  found.sort((a, b) => a.d - b.d);
  const best = found.find(q => q.d <= radius && t.walkable(q.x, q.z));
  return best ? { x: best.x, z: best.z, yaw } : null;
}
export function kamakuraSpawn(t, search) {
  const params = new URLSearchParams(search), id = params.get('spawn');
  const axis = patchRoute(t.patches, id);
  if (!axis) {
    const point = pointDeparture(t, params);
    if (point) return point;
    return { x: t.meta.spawn.x, z: -t.meta.spawn.y, yaw: -t.meta.spawn.yaw_deg_clockwise_from_north * Math.PI / 180 };
  }
  const raw = Number(params.get('at')), at = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
  const p = axisPoint(axis, (axis.s_m.at(-1) - axis.s_m[0]) * at), yaw = Math.atan2(-p.dx, -p.dz);
  if (t.walkable(p.x, p.z)) return { x: p.x, z: p.z, yaw };
  // Search the fine lattice around the requested point, ordered by actual distance.
  // Include the axis itself: a narrow floor may sit between lattice points.
  const candidates = [];
  for (let d = 0; d <= axis.s_m.at(-1) - axis.s_m[0]; d += 0.25) candidates.push(axisPoint(axis, d));
  const radius = axis.floor_width_m * 2, step = t.cell / 4;
  for (let z = -radius; z <= radius; z += step) for (let x = -radius; x <= radius; x += step) candidates.push({ x: p.x + x, z: p.z + z });
  candidates.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
  const best = candidates.find(q => t.walkable(q.x, q.z));
  if (!best) throw new Error('切通の近くに歩ける出発点がありません');
  return { x: best.x, z: best.z, yaw: best.dx === undefined ? yaw : Math.atan2(-best.dx, -best.dz) };
}
