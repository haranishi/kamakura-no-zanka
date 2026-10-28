// Derived species and non-colliding understory. Position keys survive insertion/reordering.
import { TREES } from './config.js';
import { cellRand, insideFootprint, insidePlot, inSightline, scatterRocks, ROCK_MODEL } from './scatter.js';
import { fbm, smooth } from './terrain-height.js';

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
export function assignTreeSpecies(world, terrain, trees) {
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
    // Independent draw count for stage, regardless of conversion.
    stage[i] = stageAt(f, kind, (positionRand(world, x, z)() - 0.5) * 24 / 255);
  }
  return { species, stage };
}

export function scatterUnderstory(world, terrain, trees, { box = [-210, 240, -210, 200] } = {}) {
  const out = { x: [], y: [], z: [], s: [], rot: [], species: [], stage: [], tint: [], variant: [] };
  const rocks = scatterRocks(world, terrain);
  const rockCircles = rocks.x.map((x, i) => ({ x, z: rocks.z[i], r: Math.hypot(ROCK_MODEL.width * rocks.s[i] * rocks.sx[i], ROCK_MODEL.depth * rocks.s[i] * rocks.sz[i]) / 2 }));
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
      if (world.props.some(p => Math.hypot(x - p.x, z - p.z) < (p.r || 1) + 0.5)) continue;
      if ((world.peaks || []).some(p => Math.hypot(x - p.x, z - p.z) < p.flatR * 1.9)) continue;
      if (species === SPECIES.sapling && inSightline(world, x, z)) continue;
      if (rockCircles.some(r => Math.hypot(x - r.x, z - r.z) < r.r + 0.5)) continue;
      if (nearTrunk(x, z)) continue;
      const variant = f.maple > TREES.fields.mapleThreshold ? 1 : 0;
      out.x.push(x); out.z.push(z); out.y.push(terrain.heightAt(x, z));
      out.s.push(name === 'sapling' ? 2 + 2 * rng() : 0.8 + 0.8 * rng());
      out.rot.push(rng() * Math.PI * 2); out.species.push(species); out.variant.push(variant);
      out.stage.push(stageAt(f, variant ? SPECIES.maple : SPECIES.zelkova, (rng() - 0.5) * 24 / 255)); out.tint.push(rng());
      count++;
    }
  }
  return out;
}
