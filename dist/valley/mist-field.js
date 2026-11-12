// mist-field.js — 地面にたまる霧の場。高さの焼き込み・量の式は描画器を持たない。
import { fbm, smooth } from './terrain-height.js';

export const MIST3 = Object.freeze({
  size: 1280, resolution: 256, threshold: 0.05, // m・格子数・面積を数える濃さの下限。
  sigma: 0.014, maxDistance: 650, maxOpacity: 0.62, epsilon: 0.000001, // 1/m・m・不透明度・水平視線の方向の許容差。
  steps: 28, reducedSteps: 20, lightSteps: 14, bottomSoft: 0.25, topSoft: 0.45, // 点数（標準／自動1／自動2以降・軽量）・上下のぼかし比。
  boundsPadding: 0.5, topGain: 1.12, bottomGain: 0.78, bottomBlue: 0.18, // m：HalfFloat誤差の余白・層の上／下の輝度・下の青白の混色率。
  jitterDot: [127.1, 311.7], jitterGain: 43758.5453, // 画素ハッシュと斑のハッシュの固定係数（時間で変えない）。
  near: 25, nearEnd: 55, // m：足元を消す距離と、霧が全量に戻る距離。
  largePeriod: 115, finePeriod: 40, fineWeight: 0.3, heightNoise: 0.08, // m・m・比率・高さを雑音座標へ混ぜる比率。
  speed: 0.7, thicknessMin: 0.6, thicknessMax: 1.2, // m/s（旧霧と同じ−X向き）・厚さの雑音倍率。
  coolLift: 0.70, warmMix: 0.48, backGain: 0.88, sunGain: 1.15, sunPower: 6, // 既存の霧色の持上げ・桃の混色・反日側／日側の輝度・前方散乱の指数。
  riverWidth: 2.8, riverLift: [0, 1], riverThick: [7, 10], riverGain: 0.65, riverFloor: 0.45, riverNorth: [-180, -120], riverSouth: [90, 150], // 川半幅の倍率・m・m・濃さ、上下流の濃さを戻すz帯(m)。
  bridgeRadius: 70, bridgeFade: 30, sightFade: 15, // m：橋と見通しの保護域、なだらかに戻す幅。
  ringRadii: [43, 65], ringSamples: 8, depression: [0.6, 6], basinGain: 0.85, // m・方向数・窪みの深さ(m)・濃さ。
  basinLift: [6, 18], basinThick: [18, 30], highFade: [80, 110], // m：谷筋の浮き・厚さ・谷底からの高さで薄める帯。
  basinPatch: [0.03, 0.32], basinFineWeight: 0.6, basinRim: [0.84, 1.5], // 雑音の島の境、谷の楕円半径に対する山腹の範囲。
  northFrom: 250, northFull: 400, northWidth: [70, 150], northLift: 3, northThick: [25, 40], // m：北の奥の始点・全量・半幅・浮き・厚さ。
  // 北の谷あいの霧は、上の面を水平にする（川面から northPool m。そこより高い斜面では northThin m の薄い層）。層を地形に沿わせたままだと、
  // 霧が谷の両側の斜面をはい上がり、2 本の白い筋（滝）に見えた（実際の画面で確かめた）。谷に、霧の池がたまる形にする。
  northPool: 42, northThin: 3,
  forestRim: [0.62, 1.0, 1.2], forestNorth: [25, 80], forestWest: [45, 100], forestNoise: 0.4, forestGain: 0.12, forestLift: [1, 3], forestThick: [6, 8], // 谷の半径比・北／西へ立ち上がる距離(m)・雑音率・濃さ・m・m。
  villageMargin: 25, exclusionFade: 12, templeMargin: 5, terraceMargin: 5, walkGain: 0.5, // m（格子補間のにじみも避ける余白）・歩行域の濃さ倍率。
  boundaryFade: 35, mapFade: 40, edgeWarp: 12, seed: 7171, // m：歩行境界の切替・地図端の消失・縁の歪み、位置ハッシュの種。
});
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const mix = (a, b, t) => a + (b - a) * t;
const range = (ab, t) => mix(ab[0], ab[1], t);
const noise = (x, z, period, seed) => fbm(x / period, z / period, seed, 1);
function rectDistance(f, x, z) {
  const c = Math.cos(f.rot || 0), s = Math.sin(f.rot || 0), dx = x - f.x, dz = z - f.z;
  return Math.max(Math.abs(c * dx + s * dz) - f.hx, Math.abs(-s * dx + c * dz) - f.hz);
}
function segmentDistance(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1));
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}
export function mistFieldAt(world, terrain, x, z) {
  const m = MIST3, v = world.valley, b = world.bounds, T = world.terraces;
  const outside = Math.max(b.minX - x, x - b.maxX, b.minZ - z, z - b.maxZ);
  const inside = outside <= 0, h = terrain.heightAt(x, z);
  const n = noise(x, z, m.largePeriod, m.seed), detail = noise(x, z, m.finePeriod, m.seed + 1);
  const warp = m.edgeWarp * (n + detail * m.fineWeight);
  const village = world.flats.find(f => f.id === 'village'), temple = world.flats.find(f => f.id === 'temple_terrace');
  let mask = village ? smooth(m.villageMargin, m.villageMargin + m.exclusionFade, rectDistance(village, x, z)) : 1;
  if (temple) mask *= smooth(m.templeMargin, m.templeMargin + m.exclusionFade, rectDistance(temple, x, z));
  const terraceD = Math.max(T.x0 - x, x - T.x1, T.z0 - z, z - T.z1);
  mask *= smooth(m.terraceMargin, m.terraceMargin + m.exclusionFade, terraceD);
  if (inside && terrain.roadInfo?.(x, z)) mask = 0;
  const r = terrain.riverInfo(x, z), width = world.river.halfWidth * m.riverWidth;
  let river = (1 - smooth(world.river.halfWidth, width + warp, r.d)) * m.riverGain;
  river *= m.riverFloor + (1 - m.riverFloor) * Math.max(1 - smooth(...m.riverNorth, z), smooth(...m.riverSouth, z));
  const bridge = world.distant?.find(o => o.kind === 'bridge');
  if (bridge) river *= smooth(m.bridgeRadius, m.bridgeRadius + m.bridgeFade, Math.hypot(x - bridge.x, z - bridge.z));
  for (const line of world.sightlines) river *= smooth(line.halfWidth, line.halfWidth + m.sightFade, segmentDistance(x, z, line.from, line.to));
  let average = 0;
  if (!inside) for (const radius of m.ringRadii) for (let i = 0; i < m.ringSamples; i++) {
    const a = i * Math.PI * 2 / m.ringSamples;
    average += terrain.heightAt(x + Math.cos(a) * radius, z + Math.sin(a) * radius);
  }
  average /= m.ringRadii.length * m.ringSamples;
  const relief = smooth(...m.depression, average - h);
  const rim = Math.hypot((x - v.cx) / v.rx, (z - v.cz) / v.rz);
  const mountain = smooth(...m.basinRim, rim) * (1 - smooth(...m.highFade, h - world.floor.y0));
  const outsideFade = smooth(0, m.boundaryFade, outside);
  const basin = inside ? 0 : relief * mountain * smooth(...m.basinPatch, n * (1 - m.basinFineWeight) + detail * m.basinFineWeight) * m.basinGain * outsideFade;
  const north = inside ? 0 : smooth(m.northFrom, m.northFull, village.z - z) *
    (1 - smooth(m.northWidth[0], m.northWidth[1] + warp, r.d)) * outsideFade;
  const forest = (1 - smooth(m.forestRim[1], m.forestRim[2], rim)) * smooth(m.forestRim[0], m.forestRim[1], rim) *
    Math.max(smooth(...m.forestNorth, village.z - z), smooth(...m.forestWest, village.x - x)) * (1 - m.forestNoise + m.forestNoise * n) * m.forestGain;
  const strengths = [river, basin, north, forest];
  let kind = 0;
  for (let k = 1; k < strengths.length; k++) if (strengths[k] > strengths[kind]) kind = k;
  const variation = clamp(0.5 + n * 0.5);
  const lifts = [range(m.riverLift, variation), range(m.basinLift, relief), m.northLift, range(m.forestLift, variation)];
  const thicks = [range(m.riverThick, variation), range(m.basinThick, relief), Math.max(m.northThin, Math.min(m.northThick[1] * 1.6, r.y + m.northPool - (h + m.northLift))), range(m.forestThick, variation)];
  const border = Math.max(Math.abs(x - v.cx), Math.abs(z - v.cz));
  mask *= 1 - smooth(m.size / 2 - m.mapFade, m.size / 2, border);
  const total = strengths.reduce((sum, value) => sum + value, 0);
  const blend = values => total > 0 ? values.reduce((sum, value, i) => sum + value * strengths[i], 0) / total : values[kind];
  const walkFade = mix(m.walkGain, 1, outsideFade);
  return { strength: clamp(strengths[kind] * mask * walkFade), lift: blend(lifts), thick: blend(thicks), kind: ['river', 'basin', 'north', 'forest'][kind] };
}
// 地図の各画素の中心を採る。地形の照会はここだけで、窪みはその格子を線形補間して読む。
export function bakeMistField(world, terrain) {
  const m = MIST3, n = m.resolution, step = m.size / n, x0 = world.valley.cx - m.size / 2, z0 = world.valley.cz - m.size / 2;
  const data = new Float32Array(n * n * 4), kinds = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[(j * n + i) * 4] = terrain.heightAt(x0 + (i + 0.5) * step, z0 + (j + 0.5) * step);
  const heightAt = (x, z) => {
    const u = clamp((x - x0) / step - 0.5, 0, n - 1), v = clamp((z - z0) / step - 0.5, 0, n - 1);
    const i = Math.floor(u), j = Math.floor(v), i1 = Math.min(i + 1, n - 1), j1 = Math.min(j + 1, n - 1);
    return mix(mix(data[(j * n + i) * 4], data[(j * n + i1) * 4], u - i), mix(data[(j1 * n + i) * 4], data[(j1 * n + i1) * 4], u - i), v - j);
  };
  const cached = { ...terrain, heightAt }, area = { river: 0, basin: 0, north: 0, forest: 0 };
  let occupied = 0, ringLookups = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, f = mistFieldAt(world, cached, x0 + (i + 0.5) * step, z0 + (j + 0.5) * step);
    data[k * 4 + 1] = f.strength; data[k * 4 + 2] = f.lift; data[k * 4 + 3] = f.thick;
    const x = x0 + (i + 0.5) * step, z = z0 + (j + 0.5) * step, b = world.bounds;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) ringLookups += m.ringSamples * m.ringRadii.length;
    kinds[k] = ['river', 'basin', 'north', 'forest'].indexOf(f.kind);
    if (f.strength > m.threshold) { occupied++; area[f.kind] += step * step; }
  }
  // 線形補間は隣の無霧セルも混ぜるため、その高さも含める。厚さ倍率は配線側で反映する。
  let minBottom = Infinity, maxBottom = -Infinity, maxThickness = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (data[(j * n + i) * 4 + 1] <= 0) continue;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const k = (clamp(j + dz, 0, n - 1) * n + clamp(i + dx, 0, n - 1)) * 4;
      const bottom = data[k] + data[k + 2];
      minBottom = Math.min(minBottom, bottom); maxBottom = Math.max(maxBottom, bottom);
      maxThickness = Math.max(maxThickness, data[k + 3]);
    }
  }
  const heightRange = { minBottom, maxBottom, maxThickness };
  return { data, kinds, heightAt, x0, z0, step, stats: { occupiedFraction: occupied / (n * n), area, heightRange, heightSamples: n * n, fieldSamples: n * n, ringLookups, textureBytes: n * n * 8 } };
}
// 視線上の等間隔積算のJS写し。GLSLと同じ断面・区間・消散式を試験する。
export const mistSteps = (quality = 'standard', tier = 0) => quality === 'light' || tier >= 2 ? MIST3.lightSteps : tier >= 1 ? MIST3.reducedSteps : MIST3.steps;
export function mistHeightBounds(range, thicknessScale = 1) {
  return [range.minBottom - MIST3.boundsPadding, range.maxBottom + range.maxThickness * MIST3.thicknessMax * thicknessScale + MIST3.boundsPadding];
}
export function mistInterval(y, dy, distance, low, high) {
  let begin = MIST3.near, end = Math.min(distance, MIST3.maxDistance);
  if (Math.abs(dy) < MIST3.epsilon) { if (y < low || y > high) return [0, 0]; }
  else {
    const a = (low - y) / dy, b = (high - y) / dy;
    begin = Math.max(begin, Math.min(a, b)); end = Math.min(end, Math.max(a, b));
  }
  return end > begin ? [begin, end] : [0, 0];
}
export function mistJitter(x, y) {
  const v = Math.sin(x * MIST3.jitterDot[0] + y * MIST3.jitterDot[1]) * MIST3.jitterGain;
  return v - Math.floor(v);
}
export function mistProfile(h, thick, n) {
  if (thick <= 0) return 0;
  const top = thick * n;
  return smooth(0, thick * MIST3.bottomSoft, h) * (1 - smooth(top * (1 - MIST3.topSoft), top, h));
}
export function mistStepAlpha(transmittance, density, dt) {
  return Math.min(1 - Math.exp(-density * dt), Math.max(0, 1 - (1 - MIST3.maxOpacity) / transmittance));
}
export function marchMist({ origin, direction, distance = MIST3.maxDistance, bounds, sample, noiseAt = () => 1,
  colourAt = () => [1, 1, 1], steps = MIST3.steps, pixel = [0, 0], sigma = MIST3.sigma, thicknessScale = 1 }) {
  const [begin, end] = mistInterval(origin[1], direction[1], distance, ...bounds);
  let transmittance = 1, reads = 0; const scattering = [0, 0, 0];
  if (end <= begin || sigma <= 0 || thicknessScale <= 0) return { amount: 0, transmittance, scattering, reads };
  const dt = (end - begin) / steps, jitter = mistJitter(...pixel);
  for (let i = 0; i < steps; i++) {
    const t = begin + (i + jitter) * dt, p = origin.map((v, k) => v + direction[k] * t);
    const f = sample(p); reads++;
    const noise = noiseAt(p), thick = f.thick * thicknessScale, h = p[1] - (f.g + f.lift);
    const n = mix(MIST3.thicknessMin, MIST3.thicknessMax, noise);
    const profile = mistProfile(h, thick, n);
    const density = sigma * f.strength * noise * profile * smooth(MIST3.near, MIST3.nearEnd, t);
    const a = mistStepAlpha(transmittance, density, dt), colour = colourAt(p, h / Math.max(thick, MIST3.epsilon));
    for (let k = 0; k < 3; k++) scattering[k] += transmittance * a * colour[k];
    transmittance *= 1 - a;
  }
  return { amount: 1 - transmittance, transmittance, scattering, reads };
}
const f = x => Number(x).toFixed(8);
export const MIST3_AMOUNT_GLSL = `
vec2 mistInterval(float y,float dy,float distance,float low,float high){
  float begin=${f(MIST3.near)},end=min(distance,${f(MIST3.maxDistance)});
  if(abs(dy)<${f(MIST3.epsilon)}){if(y<low||y>high)return vec2(0.0);}
  else {float a=(low-y)/dy,b=(high-y)/dy;begin=max(begin,min(a,b));end=min(end,max(a,b));}
  return end>begin?vec2(begin,end):vec2(0.0);
}
float mistProfile(float h,float thick,float n){
  if(thick<=0.0)return 0.0;
  float top=thick*n;
  return smoothstep(0.0,thick*${f(MIST3.bottomSoft)},h)*(1.0-smoothstep(top*(1.0-${f(MIST3.topSoft)}),top,h));
}
float mistStepAlpha(float transmittance,float density,float dt){
  return min(1.0-exp(-density*dt),max(0.0,1.0-(1.0-${f(MIST3.maxOpacity)})/transmittance));
}`;
