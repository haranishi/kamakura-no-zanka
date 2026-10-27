// Pure selection data. All synthesis values are provisional listening controls.
import { AUDIO_NOISE } from './config.js';
const freeze = value => { for (const v of Object.values(value)) if (v && typeof v === 'object') freeze(v); return Object.freeze(value); };
export const STEP_TABLE = freeze({
  // impact: gain/Hz/decayMs; grains: count/bandHz/decayMs/spreadMs/jitter.
  surfaces: {
    dirt: { impact: [0.5, 180, 35], grains: [5, [900, 3500], 18, 70, 0.3] },
    grass: { impact: [0.2, 120, 30], grains: [7, [2000, 5000], 30, 90, 0.4] },
    gravel: { impact: [0.3, 220, 25], grains: [18, [3000, 8000], 35, 140, 0.6] },
    leaves: { impact: [0.25, 160, 30], grains: [9, [4000, 9000], 25, 120, 0.8] },
    wood: { impact: [0.85, 320, 90], grains: [1, [1200, 2600], 10, 40, 0.2] },
    stone: { impact: [0.8, 900, 15], grains: [3, [5000, 9500], 8, 40, 0.2] },
    water: { impact: [0.45, 110, 65], grains: [12, [400, 2400], 45, 130, 0.7] },
  },
  // cloth gain/cutoffHz; equipment gain/cutoffHz; weight gain/frequencyHz.
  roles: {
    hero: { cloth: [0.16, 850], equipment: [0.12, 3200], weight: [0.3, 100] },
    ally: { cloth: [0.2, 900], equipment: [0.08, 2800], weight: [0.25, 95] },
    enemy_light: { cloth: [0.15, 800], equipment: [0.22, 4200], weight: [0.32, 110] },
    enemy_heavy: { cloth: [0.12, 750], equipment: [0.4, 3500], weight: [0.5, 85] },
    villager: { cloth: [0.24, 1000], equipment: [0.02, 1800], weight: [0.18, 120] },
  },
  gaits: { walk: { noise: 'walk', density: 1 }, run: { noise: 'run', density: 1.4 }, crouch: { noise: 'crouch', density: 0.6 }, land: { noise: 'run', density: 1.8 }, roll: { noise: 'walk', density: 2 } },
  feet: { left: -0.01, right: 0.01 },
});
export const SURFACES = Object.freeze(Object.keys(STEP_TABLE.surfaces));
export const GAITS = Object.freeze(Object.keys(STEP_TABLE.gaits));
export const ROLES = Object.freeze(Object.keys(STEP_TABLE.roles));
export const FEET = Object.freeze(Object.keys(STEP_TABLE.feet));
export const VARIANTS = freeze({ blade: 3, hit: 3, block: 3, parry: 3, hurt: 3, fall: 3, bow: 3, arrow: 3 });
export const HIT_MATERIAL = freeze({ armor: { resonanceHz: 2800, decayMs: 220 }, flesh: { resonanceHz: 160, decayMs: 60 }, wood: { resonanceHz: 450, decayMs: 110 }, rock: { resonanceHz: 4200, decayMs: 35 } });
export const BUSES = freeze({ ambient: 0.7, steps: 0.8, combat: 0.9, ui: 0.65 });
export const KIND_LEVELS = freeze({
  canopy: ['ambient', 0.08], wind: ['ambient', 0.05], river: ['ambient', 0.16], insects: ['ambient', 0.06], crow: ['ambient', 0.12], fire: ['ambient', 0.07], village: ['ambient', 0.1],
  step: ['steps', 1], blade: ['combat', AUDIO_NOISE.clash.gain], hit: ['combat', AUDIO_NOISE.hit.gain], block: ['combat', AUDIO_NOISE.clash.gain], parry: ['combat', AUDIO_NOISE.clash.gain], hurt: ['combat', AUDIO_NOISE.hit.gain], fall: ['combat', AUDIO_NOISE.hit.gain], bow: ['combat', AUDIO_NOISE.walk.gain], arrow: ['combat', AUDIO_NOISE.hit.gain], ui: ['ui', 0.5], dialogue: ['ui', 0.35],
});
export const PEAK_LIMIT = 0.98;
function entry(table, key) { if (!Object.hasOwn(table, key)) throw new TypeError(`Unknown audio input: ${String(key)}`); return table[key]; }
function finite(v) { if (!Number.isFinite(v)) throw new TypeError('Non-finite audio input'); return v; }
function random(rng) { if (typeof rng !== 'function') throw new TypeError('Invalid audio rng'); const n = finite(rng()); if (n < 0 || n >= 1) throw new TypeError('Audio rng outside [0,1)'); return n; }
export function noiseRadius(gait) { return entry(AUDIO_NOISE, gait).radius; }
export function noiseGain(gait) { return entry(AUDIO_NOISE, gait).gain; }
export function pickStep({ surface, gait, role, foot }, rng, last) {
  const material = entry(STEP_TABLE.surfaces, surface), equipment = entry(STEP_TABLE.roles, role), movement = entry(STEP_TABLE.gaits, gait), offset = entry(STEP_TABLE.feet, foot);
  const pitch = 1 + offset + (random(rng) * 2 - 1) * 0.05;
  const gain = noiseGain(movement.noise) * 10 ** ((random(rng) * 4 - 2) / 20);
  let seed = Math.floor(random(rng) * 2147483648) * 2 + (foot === 'right' ? 1 : 0);
  // Bounded fallback also works with a constant injected rng; preserve foot parity.
  if (seed === last?.seed) seed = (seed + 2) >>> 0;
  return { recipe: { surface, gait, role, foot, material, equipment, density: movement.density }, pitch, gain, seed };
}
export function pickVariant(kind, rng, last) {
  const count = entry(VARIANTS, kind), n = Math.floor(random(rng) * count);
  return n === last ? (n + 1) % count : n;
}
export function distanceRule(distance) {
  finite(distance); if (distance < 0) throw new TypeError('Negative audio distance');
  return { audible: distance < 22, gain: distance >= 22 ? 0 : (1 - distance / 22) ** 2, lowpassHz: 20000 - Math.min(distance / 22, 1) * 18800 };
}
// Listener yaw uses forward (-sin(yaw), -cos(yaw)); positive pan is right.
export function panOf({ x, z }, { x: lx, z: lz, yaw }) {
  [x, z, lx, lz, yaw].forEach(finite);
  const dx = x - lx, dz = z - lz, d = Math.hypot(dx, dz);
  return d === 0 ? 0 : Math.max(-1, Math.min(1, (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / d));
}
export function duckAmbient({ combat = false, dialogue = false } = {}) { return dialogue ? 0.35 : combat ? 0.55 : 1; }
export function mixGain(kind, { effects = 1, ambient = 1, combat = false, dialogue = false } = {}) {
  const [bus, level] = entry(KIND_LEVELS, kind);
  [effects, ambient].forEach(v => { finite(v); if (v < 0 || v > 1) throw new TypeError('Invalid audio setting'); });
  return level * BUSES[bus] * (bus === 'ambient' ? ambient * duckAmbient({ combat, dialogue }) : effects);
}
