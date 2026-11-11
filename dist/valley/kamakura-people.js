// W2c-17a: world-anchored people, with no renderer, shared RNG or clock.
import { harborEnabled, harborPlacementBatches, harborOverlap } from './kamakura-harbor.js';
import { kamakuraPaths } from './kamakura-roads.js';
import { createPropSite, propInBox, propPlacementBatches } from './kamakura-props.js';

export const PEOPLE_ROLES = Object.freeze(['walker', 'chat', 'sitter', 'farmer', 'worshipper', 'child', 'shore']);
export const PEOPLE = Object.freeze({ range: 70, lightRange: 45, max: 10, lightMax: 5, refresh: 8, fade: 10, cell: 40,
  gap: 1.2, heroGap: .85, slope: 20, bowNear: 5, waveNear: 6, cooldown: 30, grace: 2.5, jump: 30 });
export const PEOPLE_CLIPS = Object.freeze(['Casual_Walk', 'CMU_Run', 'Stand_and_Chat', 'Talk_with_Hands_Open', 'Formal_Bow',
  'Sit_Cross_Legged_on_Floor', 'Pull_Radish', 'Male_Bend_Over_Pick_Up', 'Wave_One_Hand', 'Long_Breathe_and_Look_Around']);
// Metres / counts / ratios: controls for road groups and dry beach workers.
export const FLIGHT = Object.freeze({
  fade: 12, // m at each endpoint, shrink before wrapping.
  priority: 6, // people, reserved inside the existing near-person cap.
  gapMin: 1, gapMax: 2.5, // m along the road between group members.
  side: .8, edge: .25, // m lateral spread and clearance from the road edge.
  jitter: .12, // fraction of group spacing, deterministic group displacement.
  shoreCap: 14, shorePerGroup: 2, // people, total beach ceiling / group ceiling.
  shoreMargin: .65, shoreSearch: 4, // m, clearance from hull/rack / outward search.
});
export const flightEnabled = (search = '') => new URLSearchParams(search).get('flight') !== '0';
export function validateFlight(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.road !== 'string' || !value.road.trim() ||
      !Number.isInteger(value.groups) || value.groups < 1 || value.groups > 12 ||
      !Array.isArray(value.size) || value.size.length !== 2 || !Array.from(value.size).every(n => Number.isInteger(n) && n >= 1 && n <= 5) ||
      value.size[0] > value.size[1] || !Number.isFinite(value.speed) || value.speed < .4 || value.speed > 1.6) throw new Error('道を行く人の指定が不正です');
  return value;
}
export function prepareFlight(context) {
  const config = validateFlight(context.data?.meta?.flight);
  if (!config || !flightEnabled(context.search)) return [];
  const path = context.data?.roads?.[config.road] || context.data?.patches?.paths?.[config.road];
  if (!path?.xyz_m?.length) return [];
  const route = [], points = path.xyz_m; let length = 0;
  for (let i = 0; i < points.length; i++) {
    if (i) length += Math.hypot(points[i][0] - points[i-1][0], points[i][1] - points[i-1][1]);
    route.push({ x: points[i][0], z: -points[i][1], d: length });
  }
  if (!(length > 0)) return [];
  const spots = [], spacing = length / config.groups, width = Math.max(0, (path.width_m || 1) / 2 - FLIGHT.edge);
  for (let g = 0; g < config.groups; g++) {
    const size = config.size[0] + Math.floor(peopleHash(g, length, 201) * (config.size[1] - config.size[0] + 1));
    const gap = FLIGHT.gapMin + (FLIGHT.gapMax - FLIGHT.gapMin) * peopleHash(g, length, 202);
    const start = (g + .5 + (peopleHash(g, length, 203) * 2 - 1) * FLIGHT.jitter) * spacing;
    for (let m = 0; m < size; m++) {
      const p = spot('traveller', route[0].x, route[0].z, 0, `flight-${g}`);
      Object.assign(p, { id: `flight-${g}-${m}`, route, length, speed: config.speed,
        s0: start + (m - (size - 1) / 2) * gap, side: (peopleHash(g, m, 204) * 2 - 1) * Math.min(FLIGHT.side, width),
        staff: spots.length % 3 === 0, flight: true, alpha: 1 });
      // Seed traits with identity, not a shared start point or a time-dependent coordinate.
      p.phase = peopleHash(g, m, 205) * PEOPLE.cooldown;
      p.variant = spots.length % 5; sampleFlight(p, 0, context.terrain, p); spots.push(p);
    }
  }
  return spots;
}
// One absolute-time formula, used by both levels; no retained movement integration or allocation.
export function sampleFlight(p, time, terrain, out) {
  const s = ((p.s0 + p.speed * time) % p.length + p.length) % p.length;
  let lo = 1, hi = p.route.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (p.route[mid].d < s) lo = mid + 1; else hi = mid; }
  const a = p.route[lo - 1], b = p.route[lo], len = b.d - a.d, u = (s - a.d) / len;
  const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
  out.x = a.x + (b.x - a.x) * u - dz * p.side;
  out.z = a.z + (b.z - a.z) * u + dx * p.side;
  out.y = terrain.heightAt(out.x, out.z); out.yaw = face(dx, dz); out.travel = s;
  out.alpha = Math.max(0, Math.min(1, s / FLIGHT.fade, (p.length - s) / FLIGHT.fade));
  return out;
}
export function selectFlightPeople(spots, pos, quality, step, out, flying = false) {
  out.fill(-1); if (flying) return 0;
  const limit = Math.min(out.length, FLIGHT.priority, peopleLimit(quality, step)), range = quality === 'light' ? PEOPLE.lightRange : PEOPLE.range;
  let count = 0;
  for (let i = 0; i < spots.length; i++) {
    const p = spots[i]; if (!p.flight || !p.alpha) continue;
    const d = Math.hypot(p.x - pos.x, p.z - pos.z); if (d >= range) continue;
    let k = 0; while (k < count && Math.hypot(spots[out[k]].x - pos.x, spots[out[k]].z - pos.z) <= d) k++;
    if (k >= limit) continue;
    for (let j = Math.min(count, limit - 1); j > k; j--) out[j] = out[j - 1];
    out[k] = i; count = Math.min(limit, count + 1);
  }
  return count;
}
// Integer mixing avoids cross-engine trigonometric RNG boundary differences.
export function peopleHash(x, z, salt = 0) {
  let a = Math.imul(Math.round(x * 16) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.round(z * 16) ^ salt, 0xc2b2ae35);
  a = Math.imul(a ^ a >>> 16, 0x7feb352d); a = Math.imul(a ^ a >>> 15, 0x846ca68b);
  return ((a ^ a >>> 16) >>> 0) / 4294967296;
}
export function peopleAmount(search = '') {
  const raw = new URLSearchParams(search).get('people');
  if (raw === '0') return 0;
  const n = Number(raw); return raw === null || !Number.isFinite(n) || n <= 0 ? 1 : Math.max(.25, Math.min(3, n));
}
export const peopleLimit = (quality, step) => step >= 3 ? 0 : Math.min(quality === 'light' ? PEOPLE.lightMax : PEOPLE.max, step >= 2 ? 6 : PEOPLE.max);
export const peopleStride = d => d > 55 ? 4 : d > 35 ? 2 : 1;
const face = (dx, dz) => Math.atan2(-dx, -dz);

// Numeric nested maps: lookups on the moving/avoidance path create no keys or arrays.
function spatial(cell) {
  const grid = new Map(), empty = Object.freeze([]);
  return {
    add(p, minX, minZ, maxX = minX, maxZ = minZ) {
      for (let i = Math.floor(minX / cell); i <= Math.floor(maxX / cell); i++) {
        if (!grid.has(i)) grid.set(i, new Map()); const col = grid.get(i);
        for (let j = Math.floor(minZ / cell); j <= Math.floor(maxZ / cell); j++) {
          if (!col.has(j)) col.set(j, []); col.get(j).push(p);
        }
      }
    },
    at(x, z) { return grid.get(Math.floor(x / cell))?.get(Math.floor(z / cell)) || empty; },
  };
}
export function createPeopleSite(context) {
  const base = createPropSite(context), terrain = context.terrain, boxes = spatial(32), paths = spatial(32);
  for (const b of base.boxes) { const r = Math.hypot(b.w, b.d) / 2 + .4; boxes.add(b, b.x - r, b.z - r, b.x + r, b.z + r); }
  for (const path of Object.values(kamakuraPaths(context.data || {}) || {})) {
    const r = (path.width_m || 5) / 2, points = path.xyz_m || [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], s = { ax: a[0], az: -a[1], dx: b[0] - a[0], dz: a[1] - b[1], r };
      s.len2 = s.dx * s.dx + s.dz * s.dz;
      if (s.len2) paths.add(s, Math.min(a[0], b[0]) - r, Math.min(-a[1], -b[1]) - r, Math.max(a[0], b[0]) + r, Math.max(-a[1], -b[1]) + r);
    }
  }
  function ground(x, z) {
    const b = terrain.bounds;
    if (b && (x < b.minX + .4 || x > b.maxX - .4 || z < b.minZ + .4 || z > b.maxZ - .4)) return false;
    if (!terrain.walkable(x, z) || terrain.waterAt(x, z) > 0 || terrain.slopeAt(x, z) > PEOPLE.slope || !Number.isFinite(terrain.heightAt(x, z))) return false;
    for (const b of boxes.at(x, z)) if (propInBox(x, z, b, .4)) return false;
    return true;
  }
  function onRoad(x, z) {
    for (const s of paths.at(x, z)) {
      const t = Math.max(0, Math.min(1, ((x - s.ax) * s.dx + (z - s.az) * s.dz) / s.len2));
      if (Math.hypot(x - s.ax - t * s.dx, z - s.az - t * s.dz) < s.r + .4) return true;
    }
    return false;
  }
  return { records: base.records, boxes: base.boxes, terrain, ground, onRoad };
}
function spot(role, x, z, yaw = 0, group = '') {
  const h = peopleHash(x, z, 13);
  return { id: '', role, who: role === 'child' ? 'child' : h < .5 ? 'villager_m' : 'villager_f', x, z, yaw, group,
    scale: .96 + .08 * peopleHash(x, z, 14), phase: peopleHash(x, z, 15) * 19, variant: h < .5 ? 0 : 1, route: null, length: 0 };
}
function local(b, u, v) {
  const c = Math.cos(b.rotY || 0), s = Math.sin(b.rotY || 0);
  return { x: b.x + c * u + s * v, z: b.z - s * u + c * v };
}
function* shorePeopleBatches(context, site) {
  const shoreSpots = [];
  if (harborEnabled(context.search) && new URLSearchParams(context.search).get('shorepeople') !== '0') {
    const harbor = harborPlacementBatches(context, { shoreOnly: true }); let state;
    do { state = harbor.next(); yield shoreSpots; } while (!state.done);
    let workers = 0;
    for (const group of state.value.groups) {
      let added = 0;
      const groupItems = state.value.items.filter(p => p.group === group.id && (p.kind === 'beach' || p.kind === 'rack'));
      const items = [groupItems.find(p=>p.kind==='beach'),groupItems.find(p=>p.kind==='rack'),...groupItems.filter(p=>p.kind==='beach').slice(1)].filter(Boolean);
      // Both levels use a density-independent quota and seeds, so beach identities coincide.
      for (const item of items) {
        search: for (const sign of [-1, 1]) for (let d = 0; d <= FLIGHT.shoreSearch; d++) {
          if (added >= FLIGHT.shorePerGroup || workers >= FLIGHT.shoreCap) break;
          const offset = sign * (item.w / 2 + FLIGHT.shoreMargin + d);
          const p = spot('shore', item.x + Math.cos(item.yaw) * offset, item.z - Math.sin(item.yaw) * offset,
            face(item.x - (item.x + Math.cos(item.yaw) * offset), item.z - (item.z - Math.sin(item.yaw) * offset)), `shore-${group.id}`);
          const footprint = { x: p.x, z: p.z, w: FLIGHT.shoreMargin, d: FLIGHT.shoreMargin, yaw: 0 };
          if (!site.ground(p.x, p.z) || site.onRoad(p.x, p.z) || state.value.items.some(q => harborOverlap(footprint, q, FLIGHT.shoreMargin))) continue;
          // Do not let town-density throttling erase an otherwise valid beach group.
          if (shoreSpots.some(q => Math.hypot(q.x - p.x, q.z - p.z) < PEOPLE.gap)) continue;
          p.id = `shore-${group.id}-${added}`; p.variant = added;p.who='villager_m';p.harborShore=true; shoreSpots.push(p); workers++; added++; break search;
        }
        if (added >= FLIGHT.shorePerGroup || workers >= FLIGHT.shoreCap) break;
      }
      yield shoreSpots;
    }
  }
  return shoreSpots;
}
export function* peoplePlacementBatches(context, amount = 1) {
  const site = createPeopleSite(context), spots = [], occupied = spatial(64), weights = {}, { terrain, habitat } = context;
  const result = { spots, site };
  function allowed(p) {
    if (!site.ground(p.x, p.z) || (p.role !== 'walker' && site.onRoad(p.x, p.z))) return false;
    habitat.at(p.x, p.z, weights);
    if ((weights.forest || 0) > .35 || (weights.pass || 0) > .4) return false;
    if (p.role === 'farmer' && !((weights.paddy || 0) > .35 || ((weights.meadow || 0) > .5 && (weights.town || 0) > .03))) return false;
    if ((p.role === 'chat' || p.role === 'sitter') && !(weights.town > .25)) return false;
    if (p.role === 'child' && !(weights.town > .3 || weights.sand > .5)) return false;
    if (p.role === 'worshipper' && (weights.paddy || 0) > .35) return false;
    let near = 0;
    for (const q of occupied.at(p.x, p.z)) {
      const d = Math.hypot(p.x - q.x, p.z - q.z);
      if (d < PEOPLE.gap && !(p.group && p.group === q.group && p.role === 'chat' && q.role === 'chat')) return false;
      if (d < 60) near++;
    }
    return near < Math.ceil(9 * amount);
  }
  function store(p) {
    p.id ||= `person-${spots.length}`; spots.push(p); occupied.add(p, p.x - 60, p.z - 60, p.x + 60, p.z + 60);
  }
  const add = p => { if (allowed(p)) { store(p); return true; } return false; };
  // Reserve beach workers before density-dependent town placement. The append-only result lets
  // both cooperative consumers see the same identities without deleting already-consumed spots.
  const shoreJob = shorePeopleBatches(context, site); let shore;
  do { shore = shoreJob.next(); yield result; } while (!shore.done);
  for (const p of shore.value) store(p);
  const houses = context.houses?.boxes || [], houseIndex = spatial(40);
  for (const b of houses) houseIndex.add(b, b.x - 45, b.z - 45, b.x + 45, b.z + 45);
  function chatCentre(x, z) {
    if (!houses.length) return { x, z }; // Synthetic town habitat can have no building assets.
    let best = null, distance = Infinity;
    for (const b of houseIndex.at(x, z)) for (const sign of [-1, 1]) {
      // Put the group outside a long face, leaving room for its 1m ring and the building margin.
      const p = local(b, b.w >= b.d ? 0 : sign * (b.w / 2 + 3), b.w >= b.d ? sign * (b.d / 2 + 3) : 0);
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < distance && site.ground(p.x, p.z) && !site.onRoad(p.x, p.z)) { best = p; distance = d; }
    }
    return best;
  }
  function childRoute(p, salt) {
    const length = 8 + 12 * peopleHash(p.x, p.z, salt);
    for (let k = 0; k <= Math.ceil(length); k++) {
      const z = p.z + Math.min(k, length); habitat.at(p.x, z, weights);
      if (!site.ground(p.x, z) || site.onRoad(p.x, z) || (weights.forest || 0) > .35 || (weights.pass || 0) > .4) return false;
    }
    p.route = [{ x: p.x, z: p.z, d: 0 }, { x: p.x, z: p.z + length, d: length }]; p.length = length; return true;
  }
  // Reserve seats on the long face, before filling the open ground.
  for (const b of context.houses?.boxes || []) {
    if (peopleHash(b.x, b.z, 21) < .045 * amount) {
      const sign = peopleHash(b.x, b.z, 22) < .5 ? -1 : 1, gap = .6 + .6 * peopleHash(b.x, b.z, 23);
      const p = local(b, b.w >= b.d ? 0 : sign * (b.w / 2 + gap), b.w >= b.d ? sign * (b.d / 2 + gap) : 0);
      add(spot('sitter', p.x, p.z, face(p.x - b.x, p.z - b.z)));
    }
    yield result;
  }
  for (const r of site.records) {
    if (r.node.part !== 'hall') continue;
    const b = r.bounds; let gate = null, best = Infinity;
    for (const g of site.records) if (g.node.facility === r.node.facility && ['gate', 'romon', 'torii'].includes(g.node.part)) {
      const d = Math.hypot(g.bounds.x - b.x, g.bounds.z - b.z); if (d > 0 && d < best) { gate = g.bounds; best = d; }
    }
    const front = local(b, b.w >= b.d ? 0 : 1, b.w >= b.d ? 1 : 0);
    let dx = gate ? (gate.x - b.x) / best : front.x - b.x, dz = gate ? (gate.z - b.z) / best : front.z - b.z;
    const c = Math.cos(b.rotY || 0), s = Math.sin(b.rotY || 0);
    const edge = Math.abs(dx * c - dz * s) * b.w / 2 + Math.abs(dx * s + dz * c) * b.d / 2;
    for (let i = 0; i < Math.ceil(3 * amount); i++) {
      const d = edge + 4 + 5 * peopleHash(b.x, b.z, i + 30), side = (i - 1) * 2;
      const x = b.x + dx * d - dz * side, z = b.z + dz * d + dx * side;
      add(spot('worshipper', x, z, face(b.x - x, b.z - z)));
    }
    yield result;
  }
  // Walk windows follow the full polyline, including bends; no shortcuts between corners.
  for (const [id, path] of Object.entries(kamakuraPaths(context.data || {}) || {})) {
    if (path.kind === 'trail') continue;
    const points = path.xyz_m || [], lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    const total = lengths.at(-1);
    // Parent (real Chrome): eight of ten people in the town were standing in conversation. More of them walk the roads now.
    for (let start = 0; start + 40 <= total; start += 60 / amount) {
      const length = Math.min(40 + 80 * peopleHash(start, total, 40), total - start), route = [];
      let valid = true;
      for (let d = start; d <= start + length + 1e-6; d = Math.min(d + 1, start + length)) {
        let i = 1; while (i < lengths.length - 1 && lengths[i] < d) i++;
        const t = (d - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1), a = points[i - 1], b = points[i];
        const x = a[0] + (b[0] - a[0]) * t, z = -a[1] - (b[1] - a[1]) * t;
        route.push({ x, z, d: d - start });
        habitat.at(x, z, weights);
        if (!site.ground(x, z) || (weights.forest || 0) > .35 || (weights.pass || 0) > .4) valid = false;
        if (d >= start + length) break;
      }
      const mid = route[Math.floor(route.length / 2)]; habitat.at(mid.x, mid.z, weights);
      if (valid && peopleHash(mid.x, mid.z, 41) < .25 + .75 * (weights.town || 0)) {
        const p = spot('walker', mid.x, mid.z); p.route = route; p.length = length; p.group = id; add(p);
      }
      yield result;
    }
  }
  const b = terrain.bounds;
  if (b) for (let iz = Math.floor(b.minZ / PEOPLE.cell); iz <= Math.floor(b.maxZ / PEOPLE.cell); iz++) {
    for (let ix = Math.floor(b.minX / PEOPLE.cell); ix <= Math.floor(b.maxX / PEOPLE.cell); ix++) {
      // More slots per same world cell when density is increased; existing slots keep their seeds.
      for (let n = 0; n < Math.ceil(amount); n++) {
        const x = (ix + .2 + .6 * peopleHash(ix, iz, 50 + n * 5)) * PEOPLE.cell;
        const z = (iz + .2 + .6 * peopleHash(ix, iz, 51 + n * 5)) * PEOPLE.cell;
        habitat.at(x, z, weights); const town = weights.town || 0, roll = peopleHash(ix, iz, 52 + n * 5);
        if (town > .3 && roll < .5 * Math.min(1, amount - n)) {
          const child = roll < .08, role = child ? 'child' : 'chat', group = `${ix}/${iz}/${n}`, count = child ? 1 + Math.floor(roll * 25) : 2 + (roll > .6 ? 1 : 0);
          const centre = child ? { x, z } : chatCentre(x, z); if (!centre) continue;
          const members = [];
          for (let j = 0; j < count; j++) {
            const a = j * Math.PI * 2 / count, p = spot(role, centre.x + Math.cos(a), centre.z + Math.sin(a), face(-Math.cos(a), -Math.sin(a)), group);
            if (child && !childRoute(p, 54 + j)) continue;
            members.push(p);
          }
          if (members.length === count && members.every(allowed)) for (const p of members) store(p);
        } else if (town < .35 && roll < .4 * Math.min(1, amount - n)) add(spot('farmer', x, z, peopleHash(x, z, 53) * Math.PI * 2));
      }
      yield result;
    }
  }
  // Reuse the existing boat placement, rather than inventing a second interpretation of the beach.
  const boats = propPlacementBatches(context, { only: 'boat' }); let next, seen = 0;
  do {
    next = boats.next();
    while (seen < next.value.items.length) {
      const boat = next.value.items[seen++];
      const p = spot('shore', boat.x + Math.cos(boat.yaw) * 6, boat.z - Math.sin(boat.yaw) * 6, face(Math.sin(boat.yaw), Math.cos(boat.yaw)));
      p.who = 'villager_m'; add(p);
      if (peopleHash(p.x, p.z, 66) < .3 * amount) {
        const child = spot('child', p.x + 3, p.z + 3, p.yaw); if (childRoute(child, 67)) add(child);
      }
    }
    yield result;
  } while (!next.done);
  spots.push(...prepareFlight(context));
  return result;
}
export function preparePeople(context, amount = 1) {
  const job = peoplePlacementBatches(context, amount); let next; do { next = job.next(); } while (!next.done); return next.value;
}

export function createPersonState() {
  return { spot: null, x: 0, z: 0, yaw: 0, head: 0, clip: '', clipAge: 0, lastBow: -Infinity, reacting: 0, scared: false,
    travel: 0, direction: 1, wait: 0, anchorX: 0, anchorZ: 0, offsetX: 0, offsetZ: 0, ox: 0, oz: 0, elapsed: 0, poseDt: 0, bones: 0 };
}
export function resetPerson(s, p) {
  s.spot = p; s.x = p.x; s.z = p.z; s.yaw = p.yaw; s.head = 0; s.clip = ''; s.clipAge = p.phase;
  // Cooldown belongs to the world spot and survives pool eviction (view copies it back on release).
  s.lastBow = p.lastBow ?? -Infinity; s.reacting = 0; s.scared = false;
  s.anchorX = p.x; s.anchorZ = p.z; s.offsetX = s.offsetZ = 0;
  s.travel = p.role === 'walker' ? p.length / 2 : 0; s.direction = 1; s.wait = 0; s.ox = s.oz = s.elapsed = s.poseDt = s.bones = 0;
  return s;
}
function routeAt(s, site) {
  const route = s.spot.route; if (!route) return;
  let i = 1; while (i < route.length - 1 && route[i].d < s.travel) i++;
  const a = route[i - 1], b = route[i], u = (s.travel - a.d) / (b.d - a.d || 1);
  const x = a.x + (b.x - a.x) * u, z = a.z + (b.z - a.z) * u;
  if (!site.ground(x, z)) return false;
  s.x = x; s.z = z;
  s.yaw = face((b.x - a.x) * s.direction, (b.z - a.z) * s.direction); return true;
}
// All state and scratch space is owned by the caller. time is the layer's paused simulation clock.
export function stepPerson(s, hero, drawn, time, dt, site) {
  if (s.spot.flight) {
    sampleFlight(s.spot, time, site.terrain, s);
    s.anchorX = s.x; s.anchorZ = s.z; s.clip = 'Casual_Walk'; s.clipAge += dt;
    // The existing collision projection gives the hero priority without changing the shared route clock.
    avoidPerson(s, hero.x, hero.z, PEOPLE.heroGap, site); return;
  }
  const p = s.spot, role = p.role, dx = hero.x - s.x, dz = hero.z - s.z, distance = Math.hypot(dx, dz), seated = role === 'sitter' || role === 'farmer';
  s.clipAge += dt; s.reacting = Math.max(0, s.reacting - dt); s.head = 0;
  const near = distance < (role === 'child' ? PEOPLE.waveNear : PEOPLE.bowNear);
  s.scared = drawn && distance < 6;
  if (s.scared) {
    s.reacting = 0;
    if (distance > .001) { s.ox = -dx / distance * 1.3; s.oz = -dz / distance * 1.3; }
    s.yaw = face(dx, dz); s.clip = Math.hypot(s.ox - s.offsetX, s.oz - s.offsetZ) > .04 ? 'Casual_Walk' : 'Long_Breathe_and_Look_Around';
  } else if (near && !seated && time - s.lastBow >= PEOPLE.cooldown) {
    s.lastBow = time; s.reacting = role === 'child' ? 3 : 2.7; s.clipAge = 0;
    if (role === 'walker') { s.ox = Math.cos(s.yaw) * .6; s.oz = -Math.sin(s.yaw) * .6; }
  }
  if (!s.scared) {
    if (near && seated) s.head = Math.max(-.65, Math.min(.65, Math.atan2(Math.sin(face(dx, dz) - s.yaw), Math.cos(face(dx, dz) - s.yaw))));
    if (s.reacting > 0) { s.yaw = face(dx, dz); s.clip = role === 'child' ? 'Wave_One_Hand' : 'Formal_Bow'; }
    else {
      s.ox = 0; s.oz = 0;
      const cycle = (time + p.phase) % 18;
      if (p.route) {
        if (s.wait > 0) { s.wait -= dt; s.clip = role === 'child' ? 'Wave_One_Hand' : 'Long_Breathe_and_Look_Around'; }
        else {
          const previousTravel = s.travel;
          s.travel += s.direction * dt * (role === 'child' ? 2.8 : 1.2);
          if (s.travel >= p.length || s.travel <= 0) { s.travel = Math.max(0, Math.min(p.length, s.travel)); s.direction *= -1; s.wait = 2.5 + p.phase % 3; }
          if (!routeAt(s, site)) { s.travel = previousTravel; s.direction *= -1; s.wait = 2.5; }
          s.anchorX = s.x; s.anchorZ = s.z; s.clip = role === 'child' ? 'CMU_Run' : 'Casual_Walk';
        }
      } else if (role === 'chat') s.clip = cycle < 13 ? (p.variant ? 'Stand_and_Chat' : 'Talk_with_Hands_Open') : 'Long_Breathe_and_Look_Around';
      else if (role === 'sitter') s.clip = 'Sit_Cross_Legged_on_Floor';
      else if (role === 'farmer') s.clip = cycle < 14 ? (p.variant ? 'Pull_Radish' : 'Male_Bend_Over_Pick_Up') : 'Long_Breathe_and_Look_Around';
      else if (role === 'worshipper') s.clip = cycle < 3 ? 'Formal_Bow' : 'Long_Breathe_and_Look_Around';
      else s.clip = cycle < 14 ? (p.harborShore && p.variant ? 'Pull_Radish' : 'Long_Breathe_and_Look_Around') : 'Male_Bend_Over_Pick_Up';
    }
  }
  const offsetDistance = Math.hypot(s.ox - s.offsetX, s.oz - s.offsetZ), offsetStep = Math.min(1, dt * 1.2 / (offsetDistance || 1));
  s.offsetX += (s.ox - s.offsetX) * offsetStep; s.offsetZ += (s.oz - s.offsetZ) * offsetStep;
  const x = s.anchorX + s.offsetX, z = s.anchorZ + s.offsetZ;
  if (site.ground(x, z)) { s.x = x; s.z = z; }
}
// Move the person, never the hero. Also used for person/person separation by the view.
export function avoidPerson(s, x, z, gap, site) {
  let dx = s.x - x, dz = s.z - z, d = Math.hypot(dx, dz);
  if (d >= gap) return true;
  if (d < 1e-6) { dx = Math.cos(s.yaw); dz = -Math.sin(s.yaw); d = 1; }
  const a = face(-dx, -dz);
  for (let i = 0; i < 16; i++) {
    const angle = a + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI / 8;
    const nx = x + Math.sin(angle) * gap, nz = z + Math.cos(angle) * gap;
    if (site.ground(nx, nz)) { s.x = nx; s.z = nz; return true; }
  }
  return false;
}
