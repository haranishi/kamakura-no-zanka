// Derived species and non-colliding understory. Position keys survive insertion/reordering.
import { TREES } from './config.js';
import { cellRand, insideFootprint, insidePlot, inSightline, scatterRocks, ROCK_MODEL, fortTreeRemoved } from './scatter.js';
import { fbm, smooth, forestPatchAt } from './terrain-height.js';
import { propColliders } from './world-colliders.js';

export const SPECIES = Object.freeze({ cedar: 0, zelkova: 1, pine: 2, maple: 3, sapling: 4, shrub: 5 });
const clamp = v => Math.max(0, Math.min(1, v));
const field = (world, x, z, wavelength, seed) => clamp(0.5 + 0.5 * fbm(x / wavelength, z / wavelength, world.seed + seed, 2));
const positionRand = (world, x, z) => cellRand(world.seed + TREES.seeds.individual, Math.round(x * 1024), Math.round(z * 1024));
export function treeFieldsAt(world, x, z) {
  const f = TREES.fields, s = TREES.seeds;
  return {
    grove: 0.8 * field(world, x, z, f.grove, s.grove) + 0.2 * field(world, x, z, f.detail, s.detail),
    maple: field(world, x, z, f.maple, s.maple),
    stage: field(world, x, z, f.stage, s.stage),
  };
}
const stageAt = (f, species, jitter) => {
  const season = clamp(0.5 + 1.6 * (f.stage - 0.5));
  return Math.round(clamp((species === SPECIES.maple ? 0.45 + 0.55 * season : season) + jitter) * 255);
};
function legacyTreeSpecies(world, terrain, trees) {
  const species = new Uint8Array(trees.x.length), stage = new Uint8Array(trees.x.length);
  for (let i = 0; i < species.length; i++) {
    const x = trees.x[i], z = trees.z[i], f = treeFieldsAt(world, x, z), rng = positionRand(world, x, z);
    let kind = trees.kind[i];
    if (kind === SPECIES.cedar && f.grove + TREES.conversion.habitatWeight > TREES.fields.threshold) {
      const forest = terrain.forestDensity(x, z);
      const valley = 1 - smooth(80, TREES.conversion.valleyRadius, Math.hypot(x, z));
      // Bound the habitat term before costly river/slope queries.
      const habitatMax = (1 - smooth(0.75, 0.95, forest)) * (0.5 * (1 - forest) + 0.3 + 0.2 * valley);
      if (f.grove + TREES.conversion.habitatWeight * habitatMax > TREES.fields.threshold) {
        const bank = 1 - smooth(20, 90, terrain.riverInfo(x, z).d);
        const gentle = 1 - smooth(20, 55, terrain.slopeAt(x, z, 1.5));
        const habitat = (1 - smooth(0.75, 0.95, forest)) * (0.5 * (1 - forest) + 0.3 * bank + 0.2 * valley) * (0.4 + 0.6 * gentle);
        if (f.grove + TREES.conversion.habitatWeight * habitat > TREES.fields.threshold && rng() < TREES.conversion.probability) kind = f.maple > TREES.fields.mapleThreshold ? SPECIES.maple : SPECIES.zelkova;
      }
    } else if (kind === SPECIES.zelkova && f.maple > TREES.fields.mapleThreshold) kind = SPECIES.maple;
    species[i] = kind;
    // Conversion owns the first value of the position stream; the jitter always takes the second,
    // so converted and remaining cedars share one jitter distribution.
    const draws = positionRand(world, x, z); draws();
    stage[i] = stageAt(f, kind, (draws() - 0.5) * 40 / 255);
  }
  return { species, stage };
}

// The protected rectangle deliberately includes its corners: no gameplay tree can change.
export function forestProtected(world, x, z) {
  const b = world.bounds, m = TREES.forest2.margin;
  return !b || x >= b.minX - m && x <= b.maxX + m && z >= b.minZ - m && z <= b.maxZ + m;
}
const lerp = (a, b, t) => a + (b - a) * t;
// A jittered grove per cell. Warped, elliptical edges leave mixed cedar margins, not circular stamps.
export function forestGroveAt(world, x, z) {
  const c = TREES.forest2, ix = Math.floor(x / c.cell), iz = Math.floor(z / c.cell);
  const wx = c.warp * fbm(x / c.detail, z / c.detail, world.seed + c.seed + 1, 2);
  const wz = c.warp * fbm(x / c.detail, z / c.detail, world.seed + c.seed + 2, 2);
  let best = Infinity, grove = null;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const gx = ix + dx, gz = iz + dz, rng = cellRand(world.seed + c.seed, gx, gz);
    const cx = (gx + .5 + (rng() * 2 - 1) * c.jitter) * c.cell;
    const cz = (gz + .5 + (rng() * 2 - 1) * c.jitter) * c.cell;
    const radius = lerp(...c.radius, rng()), stretch = lerp(...c.stretch, rng()), angle = rng() * Math.PI;
    const px = x + wx - cx, pz = z + wz - cz, ca = Math.cos(angle), sa = Math.sin(angle);
    const distance = Math.hypot((px * ca - pz * sa) / radius, (px * sa + pz * ca) / (radius * stretch));
    // One of two neighbouring stages per grove. This choice never depends on the tree's order.
    const tone = Math.floor(rng() * 4), id = (gx + 32768) * 65536 + gz + 32768;
    if (distance < best) { best = distance; grove = { id, distance, tone, x: cx, z: cz }; }
  }
  return grove;
}
export function assignTreeSpecies(world, terrain, trees, { forest2 = true, forest3 = terrain.forest3 ?? false } = {}) {
  const legacy = legacyTreeSpecies(world, terrain, trees);
  if (!forest2) return legacy;
  const c = TREES.forest2, c3 = TREES.forest3, n = trees.x.length;
  const result = { species: legacy.species.slice(), stage: legacy.stage.slice(), legacy,
    outside: new Uint8Array(n), old: new Uint8Array(n), tone: new Uint8Array(n),
    cluster: new Float64Array(n).fill(-1), height: new Float32Array(n).fill(1), width: new Float32Array(n).fill(1),
    brightness: new Float32Array(n).fill(1), hue: new Float32Array(n), blue: new Float32Array(n) };
  if (forest3) result.patchZone = new Int8Array(n).fill(-1);
  const before = [0, 0, 0, 0], after = [0, 0, 0, 0], groves = new Set();
  let outside = 0, oldCount = 0;
  for (let i = 0; i < n; i++) {
    const x = trees.x[i], z = trees.z[i];
    if (forestProtected(world, x, z)) continue;
    result.outside[i] = 1; outside++; before[legacy.species[i]]++;
    const g = forestGroveAt(world, x, z), rng = positionRand(world, x, z);
    const slope = terrain.slopeAt(x, z, 1.5), bank = 1 - smooth(...c.bank, terrain.riverInfo(x, z).d);
    const gentle = 1 - smooth(...c.slope, slope), high = smooth(...c.ridgeHeight, trees.y[i]);
    // Positive curvature is a hollow / sheltered shoulder, negative is an exposed crest.
    const relief = (terrain.heightAt(x - c.detail, z) + terrain.heightAt(x + c.detail, z)
      + terrain.heightAt(x, z - c.detail) + terrain.heightAt(x, z + c.detail)) / 4 - trees.y[i];
    const hollow = smooth(...c.relief, relief), w = c.habitatWeights, habitat = w[0] * bank + w[1] * gentle + w[2] * hollow;
    const patch = forest3 ? forestPatchAt(world, x, z) : null;
    if (patch) result.patchZone[i] = patch.zone;
    const groveDistance = g.distance / (patch?.zone === 1 ? c3.groveSparse : 1);
    const edge = (1 - smooth(1 - c.edge, 1 + c.edge, groveDistance - c.habitatGain * (habitat - .5))) * (patch?.zone === 0 ? lerp(1, c3.groveDense, patch.core) : 1);
    let sp = rng() < edge * gentle * (1 - high) ? (g.tone >= 2 ? SPECIES.zelkova : SPECIES.maple) : SPECIES.cedar;
    // Pine replaces only conifer ground. A steep / exposed site has priority over a sheltered slope.
    const p = c.pineWeights, pineHabitat = clamp(p[0] + p[1] * smooth(c.pineSlope, c.slope[1], slope) + p[2] * (1 - hollow) + p[3] * high);
    if (sp === SPECIES.cedar && rng() < (patch?.zone === 1 ? c3.sparsePine : c.pineRate) * pineHabitat / c.pineNormal) sp = SPECIES.pine;
    const group = field(world, x, z, c.groupScale, c.seed + 3) * 2 - 1;
    result.species[i] = sp;
    if (sp === SPECIES.maple || sp === SPECIES.zelkova) {
      result.cluster[i] = g.id; groves.add(g.id);
      result.tone[i] = g.tone + (rng() < c.neighbourTone ? 1 : 0);
      // stage remains useful to old QA clients; colour uses the five named tones in the view.
      result.stage[i] = Math.round(result.tone[i] * 255 / 4);
      result.brightness[i] = 1 + (rng() * 2 - 1) * c.leafBrightness;
      result.hue[i] = (rng() * 2 - 1) * c.leafHue;
    } else {
      result.brightness[i] = (1 + (rng() * 2 - 1) * c.cedarBrightness) * (1 + group * (forest3 ? c3.groupBrightness : c.groupBrightness));
      if (forest3) result.hue[i] = group * c3.groupHue;
      const dx = terrain.heightAt(x + c.shadeStep, z) - terrain.heightAt(x - c.shadeStep, z);
      const dz = terrain.heightAt(x, z + c.shadeStep) - terrain.heightAt(x, z - c.shadeStep);
      result.blue[i] = clamp((dx - dz) / c.shadeGradient) * c.shadeBlue;
      if (sp === SPECIES.cedar) {
        const old = rng() < c.oldRate; result.old[i] = old ? 1 : 0; oldCount += old ? 1 : 0;
        result.height[i] = old ? lerp(...c.oldHeight, rng()) : lerp(...c.height, clamp(rng() + c.heightHabitat * (hollow + bank - c.heightBias) + c.heightGroup * group));
        result.width[i] = lerp(...c.width, rng()) * (old ? c.oldWidth : 1);
      }
    }
    if (patch) {
      const groupHeight = lerp(...c3.groupHeight, clamp(.5 + fbm(x / c3.groupWave, z / c3.groupWave, world.seed + c3.seed + 2, 2)));
      if (patch.zone === 1) {
        if (result.old[i]) result.width[i] /= c.oldWidth;
        oldCount -= result.old[i]; result.old[i] = 0;
        result.height[i] = lerp(...c3.sparseHeight, rng());
      } else if (sp === SPECIES.cedar && !result.old[i]) {
        result.height[i] = groupHeight * lerp(c3.edgeHeight, c3.centreHeight, patch.core) * (1 + (rng() * 2 - 1) * c3.heightJitter);
      }
    }
    after[sp]++;
  }
  if (forest3) assignProtectedTones(world, trees, result);
  result.summary = { outside, before, after, groves: groves.size, old: oldCount,
    work: { trees: n, groveCandidates: outside * 9, terrainQueriesUpperBound: outside * 10 } };
  return result;
}

// A position-sorted nearest walk is independent of buffer order. Noise selects the colour;
// only a third equal stop is shifted to its neighbour to break the village's repeating red band.
export function protectedAutumnOrder(world, trees, species) {
  const pending = trees.x.flatMap((x, i) => forestProtected(world, x, trees.z[i]) && [1, 3].includes(species[i]) ? [i] : [])
    .sort((a, b) => trees.x[a] - trees.x[b] || trees.z[a] - trees.z[b]);
  const order = [];
  if (!pending.length) return order;
  order.push(pending.shift());
  while (pending.length) {
    const prev = order[order.length - 1]; let nearest = 0, distance = Infinity;
    for (let j = 0; j < pending.length; j++) {
      const i = pending[j], d = (trees.x[i] - trees.x[prev]) ** 2 + (trees.z[i] - trees.z[prev]) ** 2;
      if (d < distance) { nearest = j; distance = d; }
    }
    order.push(pending.splice(nearest, 1)[0]);
  }
  return order;
}
function assignProtectedTones(world, trees, result) {
  const c = TREES.forest3, order = protectedAutumnOrder(world, trees, result.species);
  result.protectedColor = new Uint8Array(trees.x.length);
  for (let j = 0; j < order.length; j++) {
    const i = order[j], x = trees.x[i], z = trees.z[i], rng = positionRand(world, x, z);
    let tone = Math.min(4, Math.floor(clamp(.5 + fbm(x / c.toneWave, z / c.toneWave, world.seed + c.seed + 3, 2)) * 5));
    if (j >= 2 && result.tone[order[j - 1]] === tone && result.tone[order[j - 2]] === tone) tone = tone === 4 ? 3 : tone + 1;
    result.tone[i] = tone; result.protectedColor[i] = 1;
    result.brightness[i] = 1 + (rng() * 2 - 1) * c.leafBrightness;
    result.hue[i] = (rng() * 2 - 1) * c.leafHue;
  }
}

// Same local axes as insideFootprint and the collider boxes.
const boxDistance = (b, x, z) => {
  const c = Math.cos(b.rotY ?? 0), s = Math.sin(b.rotY ?? 0), dx = x - b.x, dz = z - b.z;
  return Math.hypot(Math.max(0, Math.abs(dx * c - dz * s) - b.w / 2), Math.max(0, Math.abs(dx * s + dz * c) - b.d / 2));
};
export function scatterUnderstory(world, terrain, trees, { box = [-210, 240, -210, 200] } = {}) {
  const out = { x: [], y: [], z: [], s: [], rot: [], species: [], stage: [], tint: [], variant: [] };
  const rocks = scatterRocks(world, terrain);
  const rockCircles = rocks.x.map((x, i) => ({ x, z: rocks.z[i], r: Math.hypot(ROCK_MODEL.width * rocks.s[i] * rocks.sx[i], ROCK_MODEL.depth * rocks.s[i] * rocks.sz[i]) / 2 }));
  // Fences, firewood, banners and distant barriers, in the shapes the hero collides with.
  const dress = propColliders(world), T = world.terraces;
  // Spatial bins avoid scanning all 15,830 trunks per candidate. Radius is the legacy collision radius.
  const bins = new Map(), size = 4;
  for (let i = 0; i < trees.x.length; i++) {
    const key = `${Math.floor(trees.x[i] / size)},${Math.floor(trees.z[i] / size)}`;
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(i);
  }
  const nearTrunk = (x, z) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const list = bins.get(`${Math.floor(x / size) + dx},${Math.floor(z / size) + dz}`);
      if (list) for (const i of list) {
        const radius = (trees.kind[i] === 1 ? 0.42 : 0.32) * trees.s[i];
        if (Math.hypot(x - trees.x[i], z - trees.z[i]) < radius * 0.6 + 0.5) return true;
      }
    }
    return false;
  };
  for (const name of ['sapling', 'shrub']) {
    const cfg = TREES[name], species = SPECIES[name], step = cfg.step;
    let count = 0;
    for (let iz = Math.ceil(box[2] / step); iz * step <= box[3]; iz++) for (let ix = Math.ceil(box[0] / step); ix * step <= box[1]; ix++) {
      if (count >= cfg.maxCount) continue;
      const rng = cellRand(world.seed + TREES.seeds[name], ix, iz);
      const x = (ix + (rng() - 0.5) * 0.9) * step, z = (iz + (rng() - 0.5) * 0.9) * step;
      if (x < box[0] || x > box[1] || z < box[2] || z > box[3]) continue;
      const f = treeFieldsAt(world, x, z);
      const patch = smooth(0.38, 0.65, f.grove);
      if (rng() > cfg.probability * patch) continue;
      const road = terrain.roadInfo(x, z), river = terrain.riverInfo(x, z);
      // roadInfo is only defined on the tread/blend; its dist is from the edge.
      // Use the existing smoothed centreline index to query the wider 3–16m band.
      const roadDistance = terrain.roads ? Math.min(...terrain.roads.map(r => r.index.nearest(x, z, 32).d)) : (road?.d ?? road?.dist ?? Infinity);
      if (roadDistance < 2.2) continue;
      if (river.d < 6) continue;
      const forest = terrain.forestDensity(x, z);
      const roadEdge = smooth(2.2, 3, roadDistance) * (1 - smooth(10, 16, roadDistance));
      const bank = smooth(6, 12, river.d) * (1 - smooth(22, 28, river.d));
      const edge = smooth(0.15, 0.4, forest) * (1 - smooth(0.55, 0.8, forest));
      const village = (world.flats || []).some(v => v.id === 'village' && insidePlot(v, x, z, 8) && !insidePlot(v, x, z, -6)) ? 0.6 : 0;
      if (rng() > Math.max(roadEdge, bank, edge * 0.65, village, 0.025)) continue;
      if (terrain.waterAt(x, z) > 0.02) continue;
      if (terrain.slopeAt(x, z, 1.5) > 40) continue;
      if (world.buildings.some(b => insideFootprint(b, x, z, 2))) continue;
      if ((world.plots || []).some(p => insidePlot(p, x, z, 1.5))) continue;
      // Rice keeps 2.5m inside the terrace rectangle; keep the same band clear outside it.
      if (T && x >= T.x0 - 2.5 && x <= T.x1 + 2.5 && z >= T.z0 - 2.5 && z <= T.z1 + 2.5) continue;
      if (world.props.some(p => Math.hypot(x - p.x, z - p.z) < (p.r || 1) + 0.5)) continue;
      if ((world.peaks || []).some(p => Math.hypot(x - p.x, z - p.z) < p.flatR * 1.9) || terrain.fort2 !== false && fortTreeRemoved(world, x, z)) continue;
      if (species === SPECIES.sapling && inSightline(world, x, z)) continue;
      if (rockCircles.some(r => Math.hypot(x - r.x, z - r.z) < r.r + 0.5)) continue;
      if (nearTrunk(x, z)) continue;
      // Height keeps its place in the stream; the drawn crown (cfg.crown per metre) then stays
      // 0.3m clear of each road's own tread and of the dress.
      const s = name === 'sapling' ? 2 + 2 * rng() : 0.8 + 0.8 * rng(), clear = cfg.crown * s + 0.3;
      if (terrain.roads ? terrain.roads.some(r => r.index.nearest(x, z, 32).d < r.half + clear) : road && road.dist < clear) continue;
      if (dress.circles.some(c => Math.hypot(x - c.x, z - c.z) < c.r + clear)) continue;
      if (dress.boxes.some(b => boxDistance(b, x, z) < clear)) continue;
      const variant = f.maple > TREES.fields.mapleThreshold ? 1 : 0;
      out.x.push(x); out.z.push(z); out.y.push(terrain.heightAt(x, z));
      out.s.push(s);
      out.rot.push(rng() * Math.PI * 2); out.species.push(species); out.variant.push(variant);
      out.stage.push(stageAt(f, variant ? SPECIES.maple : SPECIES.zelkova, (rng() - 0.5) * 40 / 255)); out.tint.push(rng());
      count++;
    }
  }
  return out;
}
