// WW15.6 / B1–B3: deterministic crossings; only the walking terrain receives decks.
import { kamakuraPaths } from './kamakura-roads.js';
import { buildColliders } from './collision.js';
export const BRIDGES = Object.freeze({
  gap: 24, // m: extra endpoint separation beyond river width.
  minSpan: 6, maxSpan: 30, // m: navigable bridge span, excluding approaches.
  minWidth: 2.4, maxWidth: 4.5, // m: clear deck width limits.
  bankClearance: .6, thickness: .14, // m: dry bank threshold and deck thickness.
  topSlack: .25, topReach: 10, // m: a bank ends where the ground is within this of the road level; the road level is read this far beyond the water when the road was not cut.
  crownRatio: .03, crownMax: .5, // span fraction / m: central camber.
  rampDeg: 8, rampMax: 32, sample: .25, // degrees / m / m: approach search.
  separation: 40, perRiver: 8, total: 24, // m / counts: crossing deduplication and budgets.
  railHeight: .75, railWidth: .14, pierSpacing: 4, pierInset: .35, // m: structural dimensions.
  indexCell: 64, // m: deck query grid; empty cells return immediately.
  adaptFactor: .15, // fraction per quality step: shrink distance limits.
  standardRange: 4000, lightRange: 2500, adaptRange: 1200, nearRange: 180, // m: 3D distance limits.
});
export const bridgesEnabled = search => { const q = new URLSearchParams(search); return q.get('bridges') !== '0' && q.get('layers') !== '0'; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cross = (x, z, u, v) => x * v - z * u;
export function bridgeRange(quality = 'standard', step = 0) {
  const base = quality === 'light' ? BRIDGES.lightRange : BRIDGES.standardRange;
  return step >= 3 ? BRIDGES.adaptRange : base * (1 - step * BRIDGES.adaptFactor);
}
function intersection(a, b, c, d) {
  const dx = b[0] - a[0], dz = b[1] - a[1], ex = d[0] - c[0], ez = d[1] - c[1], den = cross(dx, dz, ex, ez);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(c[0] - a[0], c[1] - a[1], ex, ez) / den;
  const u = cross(c[0] - a[0], c[1] - a[1], dx, dz) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}
const cache = new WeakMap();
export function bridgeSites(data, terrain) {
  let byTerrain = cache.get(data); if (!byTerrain) cache.set(data, byTerrain = new WeakMap());
  if (byTerrain.has(terrain)) return byTerrain.get(terrain);
  const paths = Object.entries(kamakuraPaths(data) || {}).filter(([, p]) => p.xyz_m?.length > 1);
  const rivers = data.rivers?.rivers || [], candidates = [], segments = [], ends = [];
  for (const [id, p] of paths) {
    // decodeRoads drops route_id; both v10/v11 exporters use `${route_id}:${run}`.
    const route = p.route_id ?? id.replace(/^road:/, '').replace(/:\d+$/, '');
    for (let i = 1; i < p.xyz_m.length; i++) segments.push({ a: p.xyz_m[i - 1], b: p.xyz_m[i], road: route, width: p.width_m ?? BRIDGES.minWidth, gap: false });
    for (const i of [0, p.xyz_m.length - 1]) ends.push({ point: p.xyz_m[i], next: p.xyz_m[i ? i - 1 : 1], road: route, width: p.width_m ?? BRIDGES.minWidth, id });
  }
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
    const a = ends[i], b = ends[j];
    if (a.id === b.id || a.road !== b.road) continue;
    // End tangents must face the missing stretch, rather than two parallel cul-de-sacs.
    const dx = b.point[0] - a.point[0], dz = b.point[1] - a.point[1];
    if ((a.point[0] - a.next[0]) * dx + (a.point[1] - a.next[1]) * dz <= 0 ||
        (b.point[0] - b.next[0]) * dx + (b.point[1] - b.next[1]) * dz >= 0) continue;
    segments.push({ a: a.point, b: b.point, road: a.road, width: Math.min(a.width, b.width), gap: true });
  }
  // Recorded crossings (newer data): a short stretch of the road's line through the recorded point. The same bank and deck rules apply.
  for (const c of data.crossings || []) {
    const b = c.bearing * Math.PI / 180, half = (c.span ?? BRIDGES.maxSpan) / 2 + BRIDGES.topReach, dx = Math.sin(b) * half, dn = Math.cos(b) * half;
    segments.push({ a: [c.x - dx, c.north - dn], b: [c.x + dx, c.north + dn], road: c.road, width: c.width, gap: false });
  }
  for (const s of segments) for (const r of rivers) for (let i = 1; i < r.xy_m.length; i++) {
    const c = r.xy_m[i - 1], d = r.xy_m[i];
    // Broad phase avoids intersection work for the dense river polylines.
    if (Math.max(s.a[0], s.b[0]) < Math.min(c[0], d[0]) || Math.min(s.a[0], s.b[0]) > Math.max(c[0], d[0]) ||
        Math.max(s.a[1], s.b[1]) < Math.min(c[1], d[1]) || Math.min(s.a[1], s.b[1]) > Math.max(c[1], d[1])) continue;
    const hit = intersection(s.a, s.b, c, d); if (!hit) continue;
    const riverWidth = r.width_m[i - 1] + (r.width_m[i] - r.width_m[i - 1]) * hit.u;
    const length = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    if (s.gap && length > riverWidth + BRIDGES.gap) continue;
    const water = (r.water_elev_m[i - 1] + (r.water_elev_m[i] - r.water_elev_m[i - 1]) * hit.u) * (terrain.vscale ?? 1);
    const x = s.a[0] + (s.b[0] - s.a[0]) * hit.t, z = -(s.a[1] + (s.b[1] - s.a[1]) * hit.t);
    const ux = (s.b[0] - s.a[0]) / length, uz = -(s.b[1] - s.a[1]) / length;
    const at = u => terrain.heightAt(x + ux * u, z + uz * u);
    // A river cut into a trench: the bridge runs from bank top to bank top, at the level of the road.
    // (The first version stopped at the first dry point, low on the trench wall; its ramps then had to climb the wall and no site passed.)
    const reach = s.gap ? length / 2 : riverWidth / 2 + BRIDGES.topReach, level = Math.min(at(-reach), at(reach));
    const dry = Math.max(water + BRIDGES.bankClearance, level - BRIDGES.topSlack);
    const bank = sign => { for (let u = BRIDGES.minSpan / 2; u <= BRIDGES.maxSpan; u += BRIDGES.sample) if (at(sign * u) >= dry) return sign * u; return null; };
    const left = bank(-1), right = bank(1);
    if (left === null || right === null || right - left > BRIDGES.maxSpan) continue;
    const span = right - left, deck = Math.max(water + BRIDGES.bankClearance + BRIDGES.thickness, at(left), at(right));
    const rise = Math.min(BRIDGES.crownMax, span * BRIDGES.crownRatio);
    const rampSlope = Math.tan(BRIDGES.rampDeg * Math.PI / 180);
    const approach = (bankU, sign) => {
      if (deck - at(bankU) < .001) return bankU;
      for (let run = BRIDGES.sample; run <= BRIDGES.rampMax; run += BRIDGES.sample) {
        const u = bankU + sign * run;
        if (Math.abs(deck - at(u)) / run <= rampSlope) return u;
      }
      return null;
    };
    const start = approach(left, -1), end = approach(right, 1); if (start === null || end === null) continue;
    const site = { road: s.road, river: r.id, x, z, ux, uz, span, width: clamp(s.width, BRIDGES.minWidth, BRIDGES.maxWidth), roadWidth: s.width,
      left, right, start, end, deck, rise, water, startY: at(start), endY: at(end), bed: terrain.heightAt(x, z), piers: [] };
    const rows = Math.max(1, Math.floor(span / BRIDGES.pierSpacing));
    for (let n = 0; n < rows; n++) for (const sign of [-1, 1]) {
      const u = (left + right) / 2 + (n - (rows - 1) / 2) * BRIDGES.pierSpacing, v = sign * (site.width / 2 - BRIDGES.pierInset);
      const px = x + ux * u - uz * v, pz = z + uz * u + ux * v;
      site.piers.push({ x: px, z: pz, u, v, bottom: terrain.heightAt(px, pz), top: deckHeight(site, u) - BRIDGES.thickness });
    }
    const half = site.width / 2 + BRIDGES.railWidth;
    site.minX = Math.min(x + ux * start, x + ux * end) - Math.abs(uz) * half;
    site.maxX = Math.max(x + ux * start, x + ux * end) + Math.abs(uz) * half;
    site.minZ = Math.min(z + uz * start, z + uz * end) - Math.abs(ux) * half;
    site.maxZ = Math.max(z + uz * start, z + uz * end) + Math.abs(ux) * half;
    candidates.push(site);
  }
  candidates.sort((a, b) => b.roadWidth - a.roadWidth || a.road.localeCompare(b.road) || a.x - b.x || a.z - b.z);
  const sites = [], counts = new Map();
  for (const s of candidates) {
    if (sites.length >= BRIDGES.total) break;
    if ((counts.get(s.river) || 0) >= BRIDGES.perRiver || sites.some(p => Math.hypot(p.x - s.x, p.z - s.z) <= BRIDGES.separation)) continue;
    sites.push(s); counts.set(s.river, (counts.get(s.river) || 0) + 1);
  }
  byTerrain.set(terrain, sites); return sites;
}
export function deckHeight(s, u) {
  if (u < s.left) return s.start === s.left ? s.deck : s.startY + (s.deck - s.startY) * (u - s.start) / (s.left - s.start);
  if (u > s.right) return s.end === s.right ? s.deck : s.deck + (s.endY - s.deck) * (u - s.right) / (s.end - s.right);
  // Zero derivative at banks keeps the crown from adding to the approach slope.
  const t = (u - s.left) / s.span;
  return s.deck + s.rise * 16 * t * t * (1 - t) * (1 - t);
}
export function bridgeAt(sites, x, z) {
  for (const s of sites) {
    const dx = x - s.x, dz = z - s.z, u = dx * s.ux + dz * s.uz, v = -dx * s.uz + dz * s.ux;
    if (u >= s.start && u <= s.end && Math.abs(v) <= s.width / 2) return s;
  }
  return null;
}
export function withBridgeDecks(terrain, sites, enabled = true) {
  if (!enabled || !sites.length) return terrain;
  const grid = new Map(), cell = BRIDGES.indexCell;
  for (const s of sites) for (let ix = Math.floor(s.minX / cell); ix <= Math.floor(s.maxX / cell); ix++) {
    if (!grid.has(ix)) grid.set(ix, new Map());
    const column = grid.get(ix);
    for (let iz = Math.floor(s.minZ / cell); iz <= Math.floor(s.maxZ / cell); iz++) { if (!column.has(iz)) column.set(iz, []); column.get(iz).push(s); }
  }
  const find = (x, z) => { const list = grid.get(Math.floor(x / cell))?.get(Math.floor(z / cell)); return list ? bridgeAt(list, x, z) : null; };
  const heightAt = (x, z) => { const s = find(x, z), base = terrain.heightAt(x, z); return s ? Math.max(base, deckHeight(s, (x - s.x) * s.ux + (z - s.z) * s.uz)) : base; };
  const slopeAt = (x, z) => {
    if (!find(x, z)) return terrain.slopeAt(x, z);
    const e = BRIDGES.sample, s = find(x, z), u = (x - s.x) * s.ux + (z - s.z) * s.uz;
    return Math.atan(Math.abs(deckHeight(s, Math.min(s.end, u + e)) - deckHeight(s, Math.max(s.start, u - e))) / (2 * e)) * 180 / Math.PI;
  };
  const blocked = (x, z, r = 0) => {
    if (!find(x, z)) return terrain.movementBlockedAt?.(x, z, r) ?? null;
    if (terrain.insideA && !terrain.insideA(x, z) && !terrain.insidePatch?.(x, z)) return 'bounds';
    return null;
  };
  return { ...terrain, heightAt, slopeAt, waterAt: (x, z) => find(x, z) ? 0 : terrain.waterAt(x, z),
    movementBlockedAt: blocked, walkable: (x, z) => find(x, z) ? !blocked(x, z) : terrain.walkable(x, z) };
}
export function bridgeRailBoxes(sites, terrain) {
  return sites.flatMap(s => [-1, 1].map(sign => {
    const u = (s.start + s.end) / 2, v = sign * (s.width / 2 + BRIDGES.railWidth / 2);
    const x = s.x + s.ux * u - s.uz * v, z = s.z + s.uz * u + s.ux * v;
    return { x, z, w: s.end - s.start, d: BRIDGES.railWidth, rotY: -Math.atan2(s.uz, s.ux), height: Math.max(BRIDGES.railHeight, s.deck + s.rise + BRIDGES.railHeight - terrain.heightAt(x, z)) };
  }));
}
// Reuse the house box insertion format, without changing the shared collision module.
export function addBridgeRails(col, sites, terrain) {
  const own = buildColliders({ bounds: col.bounds, extraBoxes: bridgeRailBoxes(sites, terrain) });
  for (const b of own.boxes) col.boxes.push(b);
  for (const [key, list] of own.grid) { if (!col.grid.has(key)) col.grid.set(key, []); col.grid.get(key).push(...list); }
  let disposed = false;
  return () => {
    if (disposed) return; disposed = true;
    const owned = new Set(own.boxes); let n = 0;
    for (const b of col.boxes) if (!owned.has(b)) col.boxes[n++] = b; col.boxes.length = n;
    for (const key of own.grid.keys()) { const list = col.grid.get(key).filter(b => !owned.has(b)); if (list.length) col.grid.set(key, list); else col.grid.delete(key); }
  };
}
