// 道しるべの表示規則と経路サンプリング。時計・描画環境は呼出側が渡す。
export function normalizeWaymarks(level) {
  return ['bold', 'subtle', 'off'].includes(level) ? level : 'bold';
}
export function guideVisibility(level, { mode = 'free', emphasized = false, guiding = false, outside = false, distance = 0, reached = false, reduced = false } = {}) {
  level = normalizeWaymarks(level);
  const strong = guiding || (level !== 'off' && emphasized) || level === 'bold';
  const enabled = !reached && (mode === 'free' || mode === 'combat') && (level !== 'off' || guiding);
  return { enabled, strong, foot: enabled && mode === 'free', edge: enabled && strong && (outside || emphasized),
    pillar: enabled && strong && distance >= 30, pulse: enabled && strong && !reduced, subtle: enabled && !strong };
}
export function switchGuidePlan(plan, state, { currentDistance, otherDistance, t, active = true }) {
  if (!['north', 'south'].includes(plan) || !active || currentDistance < 25 || otherDistance > 10) return { plan, state: null };
  const since = state?.plan === plan && t >= state.since ? state.since : t;
  if (t - since >= 3) return { plan: plan === 'north' ? 'south' : 'north', state: null };
  return { plan, state: { plan, since } };
}
export function nearestGuideEntrance(zones, pos) {
  return ['front', 'north', 'south'].reduce((best, plan) => {
    const p = zones[`village_${plan}`], b = zones[`village_${best}`];
    return Math.hypot(p.x - pos.x, p.z - pos.z) < Math.hypot(b.x - pos.x, b.z - pos.z) ? plan : best;
  }, 'front');
}
// 経路の先頭（現在地）から最大40m。折れ点を飛ばす直線補間はしない。
export function sampleGuidePath(points, count, maxDistance = 40) {
  if (!Number.isInteger(count) || count < 0 || !Number.isFinite(maxDistance) || maxDistance < 0 ||
      !Array.isArray(points) || !points.length || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z))) throw new TypeError('Invalid guide particle path');
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  const total = Math.min(maxDistance, lengths.at(-1));
  let segment = 1;
  return Array.from({ length: count }, (_, i) => {
    const d = count > 1 ? total * i / (count - 1) : 0;
    while (segment < points.length - 1 && lengths[segment] < d) segment++;
    const a = points[segment - 1] || points[0], b = points[segment] || a;
    const span = (lengths[segment] || 0) - (lengths[segment - 1] || 0), f = span ? (d - lengths[segment - 1]) / span : 0;
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
  });
}

// 復帰路の古い始点へ逆走しないよう、隣接線分へ順に投影して次の折れ点を選ぶ。
export function guideRouteHead(points, pos, segment = 0) {
  if (!Array.isArray(points) || points.length < 2) return { segment: 0, direction: { x: 0, z: 0 } };
  const last = points.length - 2;
  let best = Math.min(segment, last), distance = Infinity;
  for (let i = best; i <= Math.min(segment + 1, last); i++) {
    const a = points[i], b = points[i + 1], dx = b.x - a.x, dz = b.z - a.z, len = dx * dx + dz * dz;
    const f = len ? Math.max(0, Math.min(1, ((pos.x - a.x) * dx + (pos.z - a.z) * dz) / len)) : 1;
    const d = Math.hypot(pos.x - a.x - dx * f, pos.z - a.z - dz * f);
    if (d <= distance) { best = i; distance = d; }
  }
  while (best < last && Math.hypot(points[best + 1].x - pos.x, points[best + 1].z - pos.z) < 0.1) best++;
  const target = points[best + 1], dx = target.x - pos.x, dz = target.z - pos.z, d = Math.hypot(dx, dz);
  return { segment: best, direction: d ? { x: dx / d, z: dz / d } : { x: 0, z: 0 } };
}
