// W2c-18i: deterministic sites and motion, metres; x=east, z=south. No stored geography.
import { createPropSite, propPlacementBatches, propHash, propBoxDistance, PROP_KINDS } from './kamakura-props.js';
import { atmosphereOptions } from './kamakura-atmosphere.js';
import { createSurfaceCodeAt } from './kamakura-surface.js';
import { createDistanceJob, sampleDistance } from './kamakura-shore.js';

export const HARBOR = Object.freeze({
  scan: 24, // m: spacing of dry beach search samples
  batch: 128, // operations: placement yield interval
  budget: 2, // ms/frame: view-side preparation budget after the first display
  beachTarget: 74, beachCap: 96, townShare: .7, // boats: stop at a complete group; absolute ceiling
  groupMin: 3, groupMax: 6, // boats/group
  townReach: 250, townGap: 74, ruralGap: 132, groupMaxGap: 150, // m: house proximity and group intervals
  landMin: 8, landMax: 40, groupLand: 22, slope: 15, // m, m, degrees: entire dry footprint
  // A strand 16 m deep (a small designed bay) has no dry sand 22 m from the sea, and stood empty. Where no group could be laid
  // on the usual line, and none stands near, it is tried again nearer the water. Wide beaches keep every boat where it was.
  narrowLand: Object.freeze([13, 9]), narrowMin: 3.5, // m from the sea: nearer lines for a group, in order / nearest dry point of a hull there
  normalStep: 6, sandWeight: .4, // m, weight: coarse shore normal and legacy sand fallback
  lengthMin: 6.5, lengthMax: 9, widthMin: 1.5, widthMax: 2, depth: .6, // m: beach hull
  spacingMin: 3.4, spacingMax: 3.5, jitter: 2, rollMin: 4, rollMax: 10, // m and degrees: spacing, yaw, roll
  boxMargin: 2, riverMargin: 6, oldBoatMargin: 9, boatMargin: 1.2, footprintStep: 1, // m: clearances
  rackCap: 40, rackMinWidth: 5, rackMaxWidth: 8, rackHeight: 2.2, rackOffset: 10, // count and m: drying frames inland of a group
  sailCount: 2, sailLengthMin: 12, sailLengthMax: 15, sailWidth: 3, // count and m
  offshoreMin: 250, offshoreMax: 500, offshoreStep: 50, offshoreClear: 200, // m: origins and whole-route clearance
  routeSpan: 300, speed: .6, routeSample: 10, turnRoundness: .035, // m, m/s, m, ratio: sinusoidal shuttle, rounded heading reversal
  waterline: .25, waveHeight: .25, pitch: 2, roll: 3, periodMin: 4, periodMax: 7, harbourMotion: .3, // m, degrees, seconds, gain
  inverseCell: 16, inverseLimit: 600, inverseBatch: 2048, // m, m, operations: conservative sea-to-land field
  harbourCap: 6, harbourMin: 4, harbourGrid: 3, harbourGridMax: 40, // boats, boats, m, samples/axis
  enclosureRays: 8, enclosureHits: 6, harbourSearch: 90, // counts and m: water enclosed by terrain inside jetty bounds
  pierLength: 12, pierWidth: 1.6, pierHeight: .6, hutWidth: 3, hutDepth: 4, hutSetback: 5, // m
  lodBlend: 40, near: 900, nearLight: 600, far: 5000, farLight: 3000, farAdapt2: 2500, farAdapt3: 1500, // m: 3D camera distances
  keepLight: .72, keepAdapt1: .88, keepAdapt2: .65, keepAdapt3: .42, // fraction: deterministic whole-group thinning
  nearTriangles: 30000, farTriangles: 3000, draws: 10, // submitted triangles and main-pass draw ceilings
  minPixels: 1.5, viewportWidth: 1280, viewportHeight: 720, // pixels: far silhouette floor and fallback buffer size
  brightness: .1, // fraction: per-boat variation around the existing props timber colour
});
const RAD = Math.PI / 180, TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const harborEnabled = search => new URLSearchParams(search).get('harbor') !== '0';
export function harborRange(quality = 'standard', step = 0) {
  return step >= 3 ? HARBOR.farAdapt3 : Math.min(quality === 'light' ? HARBOR.farLight : HARBOR.far, step >= 2 ? HARBOR.farAdapt2 : Infinity);
}
export const harborNear = (quality = 'standard', step = 0) => (quality === 'light' ? HARBOR.nearLight : HARBOR.near) * (step >= 2 ? HARBOR.keepAdapt2 : 1);
export const harborKeep = (quality = 'standard', step = 0) => Math.min(quality === 'light' ? HARBOR.keepLight : 1, step >= 3 ? HARBOR.keepAdapt3 : step >= 2 ? HARBOR.keepAdapt2 : step >= 1 ? HARBOR.keepAdapt1 : 1);
export function harborLOD(distance, quality, step, rank = 0) {
  if (rank >= harborKeep(quality, step) || distance > harborRange(quality, step)) return 'hidden';
  return distance < harborNear(quality, step) ? 'near' : 'far';
}
export const harborPixelWidth = (width, depth, viewport, projectionY) => Math.max(width, HARBOR.minPixels * 2 * Math.max(0, depth) / (viewport * projectionY));

// SAT on oriented footprints. margin is a total edge-to-edge separation, not a centre radius.
export function harborOverlap(a, b, margin = 0) {
  const ac = Math.cos(a.yaw || 0), as = Math.sin(a.yaw || 0), bc = Math.cos(b.yaw ?? b.rotY ?? 0), bs = Math.sin(b.yaw ?? b.rotY ?? 0);
  const dx = b.x - a.x, dz = b.z - a.z;
  for (let axis = 0; axis < 4; axis++) {
    const nx = axis === 0 ? ac : axis === 1 ? as : axis === 2 ? bc : bs;
    const nz = axis === 0 ? -as : axis === 1 ? ac : axis === 2 ? -bs : bc;
    const ra = Math.abs(nx * ac - nz * as) * a.w / 2 + Math.abs(nx * as + nz * ac) * a.d / 2;
    const rb = Math.abs(nx * bc - nz * bs) * b.w / 2 + Math.abs(nx * bs + nz * bc) * b.d / 2;
    if (Math.abs(dx * nx + dz * nz) >= ra + rb + margin) return false;
  }
  return true;
}
function segmentDistance(x, z, s) {
  const dx = s.bx - s.ax, dz = s.bz - s.az;
  const t = clamp(((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(x - s.ax - t * dx, z - s.az - t * dz);
}
function inside(terrain, x, z) {
  const b = terrain.bounds;
  return !b || x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
}
function wet(terrain, x, z) { return inside(terrain, x, z) && (terrain.isSea ? terrain.isSea(x, z) : terrain.waterAt(x, z) > 0); }
export function createHarborSite(context, oldBoats = []) {
  const { terrain, data = {}, habitat } = context, base = createPropSite(context);
  const codeAt = createSurfaceCodeAt(data.meta?.grid ? data.meta : { grid: { width: 0, height: 0, cell_m: 1 } }, data.surface), weights = {};
  function reason(p, placed = [], sand = true, landMin = HARBOR.landMin) {
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    for (const box of base.boxes) if (harborOverlap(p, box, HARBOR.boxMargin)) return 'box';
    for (const q of oldBoats) if (Math.hypot(p.x - q.x, p.z - q.z) < HARBOR.oldBoatMargin) return 'props';
    for (const q of placed) if (q.kind !== 'sail' && harborOverlap(p, q, HARBOR.boatMargin)) return 'near';
    const nx = Math.ceil(p.w / HARBOR.footprintStep), nz = Math.ceil(p.d / HARBOR.footprintStep);
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
      const u = (i / nx - .5) * p.w, v = (j / nz - .5) * p.d;
      const x = p.x + c * u + s * v, z = p.z - s * u + c * v;
      if (!inside(terrain, x, z) || !Number.isFinite(terrain.heightAt(x, z)) || !terrain.walkable(x, z)) return 'walk';
      if (terrain.waterAt(x, z) > 0) return 'water';
      if (terrain.slopeAt(x, z) > HARBOR.slope) return 'slope';
      const d = terrain.seaDistanceAt(x, z);
      if (!(d >= landMin && d <= HARBOR.landMax)) return 'shore';
      if (terrain.riverDistanceAt?.(x, z, HARBOR.riverMargin) <= HARBOR.riverMargin) return 'river';
      if (sand) {
        const code = codeAt(x, z);
        if (code === 255) { habitat?.at(x, z, weights); if (!(weights.sand > HARBOR.sandWeight)) return 'sand'; }
        else if (code !== 0 && code !== 1) return 'sand';
      }
      for (const path of base.paths) if (segmentDistance(x, z, path) < path.radius + HARBOR.footprintStep) return 'path';
    }
    return null;
  }
  return { ...base, reason };
}
function boat(kind, x, z, yaw, group, salt = 0) {
  const h = propHash(x, z, salt);
  return { kind, x, y: 0, z, yaw, w: HARBOR.widthMin + h * (HARBOR.widthMax - HARBOR.widthMin), d: HARBOR.lengthMin + propHash(x, z, salt + 1) * (HARBOR.lengthMax - HARBOR.lengthMin),
    tiltX: 0, tiltZ: (HARBOR.rollMin + propHash(x, z, salt + 2) * (HARBOR.rollMax - HARBOR.rollMin)) * RAD * (h < .5 ? -1 : 1),
    brightness: 1 + (h * 2 - 1) * HARBOR.brightness, bundle: propHash(x, z, salt + 3) < .4, group, rank: 0,
    phase: h * TAU, period: HARBOR.periodMin + h * (HARBOR.periodMax - HARBOR.periodMin), afloat: false, tx: 0, tz: 0 };
}
function groundBoat(p, terrain) {
  const span=HARBOR.footprintStep, dx=Math.sin(p.yaw)*span, dz=Math.cos(p.yaw)*span;
  p.y=terrain.heightAt(p.x,p.z);
  p.tiltX=Math.atan((terrain.heightAt(p.x-dx,p.z-dz)-terrain.heightAt(p.x+dx,p.z+dz))/(span*2));
  return p;
}
// Writes into a retained record. The sinusoidal mirror is closed, has zero speed at each end,
// max speed .6m/s and no cusp. Heading rounds through the reversal rather than snapping by pi.
export function harborMotion(p, time, out) {
  const theta = time * HARBOR.speed / (HARBOR.routeSpan / 2) + p.phase;
  const travel = p.kind === 'sail' ? Math.sin(theta) * HARBOR.routeSpan / 2 : 0;
  const phase = time * TAU / p.period + p.phase;
  const gain = p.kind === 'sail' ? 1 : HARBOR.harbourMotion;
  out.x = p.x + p.tx * travel; out.z = p.z + p.tz * travel;
  out.y = p.y + Math.sin(phase) * HARBOR.waveHeight * gain;
  out.tiltX = Math.sin(phase) * HARBOR.pitch * RAD * gain;
  out.tiltZ = Math.cos(phase) * HARBOR.roll * RAD * gain;
  out.yaw = p.kind === 'sail' ? Math.atan2(p.tx, p.tz) + Math.atan2(HARBOR.turnRoundness * Math.sin(theta), Math.cos(theta)) : p.yaw;
  return out;
}
// Eight rays must meet dry terrain in at least six directions, while remaining inside the jetty
// rectangle. An offshore solid island has no such wet pocket. The broad catalog rectangle itself
// is deliberately NOT considered solid; doing so would invent an inner harbour in every island.
export function* harborInteriorBatches(jetty, terrain) {
  const b = jetty.bounds, c = Math.cos(b.rotY || 0), s = Math.sin(b.rotY || 0);
  const cell = Math.max(HARBOR.harbourGrid, Math.max(b.w, b.d) / HARBOR.harbourGridMax);
  let best = null;
  for (let u = -b.w / 2 + cell; u < b.w / 2; u += cell) {
    for (let v = -b.d / 2 + cell; v < b.d / 2; v += cell) {
      const x = b.x + c * u + s * v, z = b.z - s * u + c * v;
      if (!wet(terrain, x, z)) continue;
      let hits = 0, clearance = Infinity, bankX = 0, bankZ = 0;
      for (let ray = 0; ray < HARBOR.enclosureRays; ray++) {
        const angle = ray * TAU / HARBOR.enclosureRays, dx = Math.cos(angle), dz = Math.sin(angle);
        for (let d = cell; d <= Math.hypot(b.w, b.d); d += cell) {
          const px = x + dx * d, pz = z + dz * d;
          if (propBoxDistance(px, pz, b) > 0) break;
          if (!wet(terrain, px, pz)) { hits++; if (d < clearance) { clearance = d; bankX = px; bankZ = pz; } break; }
        }
      }
      if (hits >= HARBOR.enclosureHits && (!best || clearance > best.clearance)) best = { x, z, bankX, bankZ, clearance, hits };
    }
    yield null;
  }
  return best;
}
function banksAt(x, z, jetty, terrain) {
  const b = jetty.bounds, banks = [];
  if (!wet(terrain,x,z)) return banks;
  for (let ray = 0; ray < HARBOR.enclosureRays; ray++) {
    const angle = ray*TAU/HARBOR.enclosureRays, dx = Math.cos(angle), dz = Math.sin(angle);
    for (let distance = HARBOR.footprintStep; distance <= Math.hypot(b.w,b.d); distance += HARBOR.footprintStep) {
      const px = x+dx*distance, pz = z+dz*distance;
      if (propBoxDistance(px,pz,b)>0) break;
      if (!wet(terrain,px,pz)) { banks.push({ x:px,z:pz,distance }); break; }
    }
  }
  banks.sort((a,c)=>a.distance-c.distance);
  return banks;
}
function pierAt(pocket, terrain) {
  let dx = pocket.x - pocket.bankX, dz = pocket.z - pocket.bankZ, len = Math.hypot(dx, dz);
  dx /= len; dz /= len;
  // Refine the wet/dry crossing; the root is one metre back on dry ground.
  let x = pocket.bankX, z = pocket.bankZ;
  for (let d = 0; d <= len; d += HARBOR.footprintStep) {
    if (wet(terrain, x + dx, z + dz)) break;
    x += dx; z += dz;
  }
  if (wet(terrain, x, z) || terrain.heightAt(x, z) > HARBOR.pierHeight) return null;
  for (let d = 2; d <= HARBOR.pierLength; d += HARBOR.footprintStep) for (const side of [-1, 1]) {
    if (!wet(terrain, x + dx * d - dz * side * HARBOR.pierWidth / 2, z + dz * d + dx * side * HARBOR.pierWidth / 2)) return null;
  }
  return { kind: 'pier', x, y: 0, z, yaw: Math.atan2(dx, dz), w: HARBOR.pierWidth, d: HARBOR.pierLength, dx, dz };
}
export function* harborPlacementBatches(context, { shoreOnly = false } = {}) {
  const { terrain, data = {} } = context;
  const result = { items: [], groups: [], oldBoats: [], infra: [], skipped: {}, work: { scans: 0, batches: 0, routeSamples: 0 }, site: null, ready: false };
  const skip = reason => { result.skipped[reason] = (result.skipped[reason] || 0) + 1; };
  // Reuse the existing deterministic boat generator, including its validity checks, rather than
  // approximating the named-place scatter. Earlier props also affect the boat occupancy checks.
  const time = atmosphereOptions(context.search || '').time, requested = new URLSearchParams(context.search || '').get('props');
  if (requested !== '0') {
    const oldJob = propPlacementBatches(context, { time, only: PROP_KINDS.includes(requested) ? requested : null }); let old;
    do { old = oldJob.next(); result.work.batches++; yield result; } while (!old.done);
    result.oldBoats = old.value.items.filter(p => p.kind === 'boat');
  }
  const site = result.site = createHarborSite(context, result.oldBoats), b = terrain.bounds;
  if (!b || typeof terrain.seaDistanceAt !== 'function') { skip('terrain'); result.ready = true; return result; }
  const candidates = [], houses = context.houses?.boxes || [], weights = {};
  for (let x = b.minX + HARBOR.scan / 2; x < b.maxX; x += HARBOR.scan) for (let z = b.minZ + HARBOR.scan / 2; z < b.maxZ; z += HARBOR.scan) {
    const d = terrain.seaDistanceAt(x, z);
    if (d >= HARBOR.landMin && d <= HARBOR.landMax && terrain.walkable(x, z) && terrain.slopeAt(x, z) <= HARBOR.slope) {
      context.habitat?.at(x, z, weights);
      if (weights.sand > HARBOR.sandWeight) {
        const gx = terrain.seaDistanceAt(x + HARBOR.normalStep, z) - terrain.seaDistanceAt(x - HARBOR.normalStep, z);
        const gz = terrain.seaDistanceAt(x, z + HARBOR.normalStep) - terrain.seaDistanceAt(x, z - HARBOR.normalStep), n = Math.hypot(gx, gz);
        if (n > 0) {
          const px = x + gx/n*(HARBOR.groupLand-d), pz = z + gz/n*(HARBOR.groupLand-d);
          let town = Infinity; for (const h of houses) town = Math.min(town, propBoxDistance(px, pz, h));
          candidates.push({ x: px, z: pz, nx: -gx / n, nz: -gz / n, town });
        }
      }
    }
    if (++result.work.scans % HARBOR.batch === 0) { result.work.batches++; yield result; }
  }
  // Town first, then the deterministic scan order. This spends the cap on inhabited beaches.
  candidates.sort((a, c) => +(a.town > HARBOR.townReach) - +(c.town > HARBOR.townReach) || a.x-c.x || a.z-c.z);
  const hasRural = candidates.some(p => p.town > HARBOR.townReach);
  let beach = 0, racks = 0, townBoats = 0;
  // The usual line first, for every candidate; then the nearer lines, only where the first pass left the beach empty.
  const passes = [[HARBOR.groupLand, HARBOR.landMin], ...HARBOR.narrowLand.map(land => [land, HARBOR.narrowMin])];
  for (const [land, landMin] of passes) for (const origin of candidates) {
    const shift = HARBOR.groupLand - land, at = shift ? { ...origin, x: origin.x + origin.nx * shift, z: origin.z + origin.nz * shift } : origin;
    if (beach >= HARBOR.beachTarget) break;
    if (hasRural && at.town <= HARBOR.townReach && townBoats >= HARBOR.beachTarget * HARBOR.townShare) continue;
    const gap = at.town <= HARBOR.townReach ? HARBOR.townGap : HARBOR.ruralGap;
    if (result.groups.some(g => Math.hypot(g.x - at.x, g.z - at.z) < Math.max(g.gap, gap))) continue;
    // Do not spend the last few boats on an isolated new stretch with no room for its neighbour.
    if (result.groups.length && beach >= HARBOR.beachTarget-HARBOR.groupMin*2 && result.groups.every(g => Math.hypot(g.x-at.x,g.z-at.z)>HARBOR.groupMaxGap)) continue;
    const id = result.groups.length, group = { ...at, gap, id, yaw: Math.atan2(at.nx, at.nz), boats: 0, racks: 0 };
    const h = propHash(at.x, at.z, 71), count = HARBOR.groupMin + Math.floor(h * (HARBOR.groupMax - HARBOR.groupMin + 1));
    const spacing = HARBOR.spacingMin + h * (HARBOR.spacingMax - HARBOR.spacingMin), pending = [];
    for (let n = 0; n < count && beach + pending.length < HARBOR.beachCap; n++) {
      const offset = (n - (count - 1) / 2) * spacing;
      const x = at.x + at.nz * offset, z = at.z - at.nx * offset;
      const p = boat('beach', x, z, group.yaw + (h < .5 ? 0 : Math.PI) + (propHash(x, z, 72) * 2 - 1) * HARBOR.jitter * RAD, id, 73);
      p.rank = propHash(at.x, at.z, 74); groundBoat(p,terrain);
      const why = site.reason(p, result.items, true, landMin) || site.reason(p, pending, true, landMin);
      if (why) skip(why); else pending.push(p);
    }
    if (pending.length >= HARBOR.groupMin) {
      result.items.push(...pending); group.boats = pending.length; beach += pending.length; if (at.town <= HARBOR.townReach) townBoats += pending.length; result.groups.push(group);
      const rackCount = 1 + +(h >= .5);
      for (let n = 0; n < rackCount && racks < HARBOR.rackCap; n++) {
        const p = { ...boat('rack', at.x - at.nx * HARBOR.rackOffset + at.nz * n * HARBOR.rackOffset, at.z - at.nz * HARBOR.rackOffset - at.nx * n * HARBOR.rackOffset, group.yaw, id, 78),
          w: HARBOR.rackMinWidth + h * (HARBOR.rackMaxWidth - HARBOR.rackMinWidth), d: 1, tiltZ: 0, rank: pending[0].rank };
        p.y = terrain.heightAt(p.x, p.z);
        const why = site.reason(p, result.items, true, landMin); if (why) skip('rack_' + why); else { result.items.push(p); racks++; group.racks++; }
      }
    } else skip('group');
    result.work.batches++; yield result;
  }
  if (shoreOnly) { result.ready = true; return result; }
  // Compute a land-distance field incrementally: seaDistanceAt is the opposite, zero at sea.
  const inverse = createDistanceJob(terrain, { cell: HARBOR.inverseCell, limit: HARBOR.inverseLimit });
  while (!inverse.step(HARBOR.inverseBatch)) { result.work.batches++; yield result; }
  result.landField = inverse.field;
  const shore = result.groups.slice();
  if (shore.length) {
    const midX = shore.reduce((sum, p) => sum + p.x, 0) / shore.length, midZ = shore.reduce((sum, p) => sum + p.z, 0) / shore.length;
    shore.sort((a, c) => Math.hypot(a.x - midX, a.z - midZ) - Math.hypot(c.x - midX, c.z - midZ));
  }
  let sails = 0;
  for (const at of shore) {
    if (sails >= HARBOR.sailCount) break;
    for (let offshore = HARBOR.offshoreMin; offshore <= HARBOR.offshoreMax; offshore += HARBOR.offshoreStep) {
      const p = boat('sail', at.x + at.nx * (terrain.seaDistanceAt(at.x, at.z) + offshore), at.z + at.nz * (terrain.seaDistanceAt(at.x, at.z) + offshore), 0, -1, 81);
      p.w = HARBOR.sailWidth; p.d = HARBOR.sailLengthMin + propHash(p.x, p.z, 82) * (HARBOR.sailLengthMax - HARBOR.sailLengthMin);
      p.y = -HARBOR.waterline; p.tx = at.nz; p.tz = -at.nx; p.tiltZ = 0; p.afloat = true; p.rank = sails === 0 ? 0 : HARBOR.keepLight;
      if (result.items.some(q => q.kind === 'sail' && Math.hypot(p.x - q.x, p.z - q.z) < HARBOR.routeSpan)) continue;
      let valid = true;
      for (let travel = -HARBOR.routeSpan / 2; travel <= HARBOR.routeSpan / 2; travel += HARBOR.routeSample) {
        const x = p.x + p.tx * travel, z = p.z + p.tz * travel;
        result.work.routeSamples++;
        // Account for interpolation error, hull extent, and the gap between route samples.
        const margin = HARBOR.inverseCell * Math.SQRT2 + p.d / 2 + HARBOR.routeSample;
        if (!wet(terrain, x, z) || sampleDistance(inverse.field, x, z) < HARBOR.offshoreClear + margin) { valid = false; break; }
      }
      if (valid) { result.items.push(p); sails++; break; } else skip('route');
      result.work.batches++; yield result;
    }
    result.work.batches++; yield result;
  }
  for (const jetty of site.records.filter(r => r.node.part === 'jetty').slice(0, 1)) {
    const search = harborInteriorBatches(jetty, terrain); let pocket;
    do { pocket = search.next(); result.work.batches++; yield result; } while (!pocket.done);
    const centre = pocket.value;
    if (centre) {
      const pier = pierAt(centre, terrain);
      if (pier) {
        result.infra.push(pier);
        const hx = pier.x - pier.dx * HARBOR.hutSetback, hz = pier.z - pier.dz * HARBOR.hutSetback;
        let dry = true;
        for (const u of [-HARBOR.hutWidth / 2, HARBOR.hutWidth / 2]) for (const v of [-HARBOR.hutDepth / 2, HARBOR.hutDepth / 2]) {
          const x = hx + Math.cos(pier.yaw) * u + Math.sin(pier.yaw) * v, z = hz - Math.sin(pier.yaw) * u + Math.cos(pier.yaw) * v;
          if (!inside(terrain, x, z) || wet(terrain, x, z) || terrain.slopeAt(x, z) > HARBOR.slope) dry = false;
        }
        if (dry) result.infra.push({ kind: 'hut', x: hx, y: terrain.heightAt(hx, hz), z: hz, yaw: pier.yaw, w: HARBOR.hutWidth, d: HARBOR.hutDepth }); else skip('hut');
      } else skip('pier');
      const b = jetty.bounds, cell = Math.max(HARBOR.harbourGrid,Math.max(b.w,b.d)/HARBOR.harbourGridMax);
      const c = Math.cos(b.rotY||0), s = Math.sin(b.rotY||0);
      let moored = 0;
      for (let u = -b.w/2; u < b.w/2 && moored < HARBOR.harbourCap; u += cell) {
        for (let v = -b.d/2; v < b.d/2 && moored < HARBOR.harbourCap; v += cell) {
          const x = b.x+c*u+s*v, z = b.z-s*u+c*v;
          // Test the whole enclosed basin, not just its largest inscribed circle. Long narrow
          // inlets can hold several boats along their banks even when the central circle cannot.
          const banks = banksAt(x,z,jetty,terrain);
          if (banks.length < HARBOR.enclosureHits) continue;
          for (const bank of banks) {
            const p = boat('harbour',x,z,Math.atan2(bank.x-x,bank.z-z),-2,87);
            p.y = -HARBOR.waterline; p.tiltZ = 0; p.afloat = true; p.rank = 0;
            let clear = true;
            const pc = Math.cos(p.yaw), ps = Math.sin(p.yaw);
            for (let a=-p.w/2; a<=p.w/2; a+=p.w/2) for (let d=-p.d/2; d<=p.d/2; d+=p.d/4) if (!wet(terrain,x+pc*a+ps*d,z-ps*a+pc*d)) clear = false;
            for (const q of result.items) if (q.kind==='harbour' && harborOverlap(p,q,HARBOR.boatMargin)) clear = false;
            if (pier && harborOverlap(p,{ ...pier,x:pier.x+pier.dx*pier.d/2,z:pier.z+pier.dz*pier.d/2 },HARBOR.boatMargin)) clear = false;
            if (clear) {
              result.items.push(p); moored++;
              result.infra.push({ kind:'rope',x:p.x+ps*p.d/2,y:p.y+HARBOR.depth,z:p.z+pc*p.d/2,
                endX:bank.x,endY:terrain.heightAt(bank.x,bank.z),endZ:bank.z,yaw:0 });
              break;
            }
          }
          result.work.batches++; yield result;
        }
        result.work.batches++; yield result;
      }
    }
    if (!centre || result.items.filter(p=>p.kind==='harbour').length < HARBOR.harbourMin) {
      // A wet pocket that cannot hold the minimum fleet is not a usable inner harbour.
      for (let i=result.items.length-1;i>=0;i--) if (result.items[i].kind==='harbour') result.items.splice(i,1);
      result.infra.length=0;
      // No usable enclosed wet pocket: seek the landward shore from the jetty, never invent a pier.
      const b = jetty.bounds;
      for (const at of candidates.slice().sort((a, c) => Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(c.x - b.x, c.z - b.z))) {
        if (Math.hypot(at.x - b.x, at.z - b.z) > Math.hypot(b.w, b.d) / 2 + HARBOR.harbourSearch) continue;
        for (let n = 0; n < HARBOR.harbourCap; n++) {
          const offset = (n - HARBOR.harbourCap / 2) * HARBOR.spacingMax;
          const p = boat('harbour', at.x + at.nz * offset, at.z - at.nx * offset, Math.atan2(at.nx, at.nz), -2, 91); groundBoat(p,terrain);
          if (!site.reason(p, result.items)) result.items.push(p);
        }
        if (result.items.some(p => p.kind === 'harbour')) break;
      }
      skip(centre ? 'harbour_capacity' : 'interior');
    }
    result.work.batches++; yield result;
  }
  result.ready = true;
  return result;
}
export function prepareHarbor(context) { const job = harborPlacementBatches(context); let next; do { next = job.next(); } while (!next.done); return next.value; }
