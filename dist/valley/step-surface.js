// Pure surface classification. New thresholds are provisional listening controls.
const unit = (v, name) => { if (!Number.isFinite(v) || v < 0 || v > 1) throw new TypeError(`Invalid surface ${name}`); };
export function classifySurface(weights, { water = 0, wood = false, stone = false } = {}) {
  if (!weights || typeof weights !== 'object') throw new TypeError('Invalid surface weights');
  for (const key of ['grass', 'dirt', 'rock', 'gravel', 'mud', 'litter']) unit(weights[key], key);
  if (!Number.isFinite(water) || water < 0 || typeof wood !== 'boolean' || typeof stone !== 'boolean') throw new TypeError('Invalid surface overlays');
  if (water >= 0.02 || weights.mud > 0.5) return 'water';
  if (wood) return 'wood';
  if (stone || weights.rock > 0.5) return 'stone';
  if (weights.gravel > 0.4) return 'gravel';
  if (weights.litter > 0.4) return 'leaves';
  if (weights.dirt > 0.45) return 'dirt';
  return 'grass';
}
export function stepSurfaceAt(x, z, { terrain, world }) {
  if (![x, z].every(Number.isFinite) || typeof terrain?.surfaceAt !== 'function' || typeof terrain?.waterAt !== 'function' || !Array.isArray(world?.buildings)) throw new TypeError('Invalid surface location/context');
  const wood = world.buildings.some(b => {
    if (!b.footprint) return false;
    const { w, d } = b.footprint, rot = b.rotY ?? 0;
    if (![b.x, b.z, w, d, rot].every(Number.isFinite) || w <= 0 || d <= 0) throw new TypeError('Invalid surface footprint');
    const dx = x - b.x, dz = z - b.z, c = Math.cos(rot), s = Math.sin(rot);
    // Inverse of Three.js rotation.y: world x=c*localX+s*localZ.
    return Math.abs(c * dx - s * dz) <= w / 2 + 1 && Math.abs(s * dx + c * dz) <= d / 2 + 1;
  });
  const zone = world.zones?.temple_steps;
  if (zone && (![zone.x, zone.z, zone.r].every(Number.isFinite) || zone.r < 0)) throw new TypeError('Invalid surface stone zone');
  const stone = !!zone && Math.hypot(x - zone.x, z - zone.z) <= zone.r;
  return classifySurface(terrain.surfaceAt(x, z), { water: terrain.waterAt(x, z), wood, stone });
}
const ROLES = { hero: 'hero', archer: 'ally', soldier: 'enemy_light', officer: 'enemy_heavy', villager_m: 'villager', villager_f: 'villager', child: 'villager' };
export function roleOf(who) {
  if (typeof who !== 'string' || !Object.hasOwn(ROLES, who)) throw new TypeError('Unknown surface actor role');
  return ROLES[who];
}
export function gaitOfClip(clip) {
  if (typeof clip !== 'string' || !clip) throw new TypeError('Invalid surface clip');
  return clip === 'CMU_Run' || clip === 'CMU_Jog' ? 'run' : clip === 'Cautious_Crouch_Walk_Forward' ? 'crouch' : 'walk';
}
