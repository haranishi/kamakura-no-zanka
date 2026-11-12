// 棚田の見た目専用の配置。地形・道・当たりの値は変更しない。
import { cellRand } from './scatter.js';

export const PADDY = Object.freeze({
  standing: .60, harvested: .25, partial: .15, // 枚数比。端数は最も近い整数へ。
  bundWidth: .75, bundHeight: .15, // m：草の畦の幅と田面からの高さ。
  variation: .08, // 色・丈の区画差の最大比率。
  nearStart: 60, nearEnd: 95, farEnd: 300, // m：近遠混合帯と標準の最遠距離。
  farStep: 1.15, lightDensity: .15, lightEnd: 200, // m／比率：遠景株の格子・軽量密度・軽量距離。
  adaptDensity: .22, adaptDistance: 20, // 段階ごとの密度比の減少・距離短縮m。
  stoneMin: .25, stoneMax: .60, stonePitch: .52, stoneLayers: 2, // m／段：野面石の寸法・間隔・層数。
  contourSearch: 3, contourStep: .25, contourProbe: .30, contourMin: .18, // m：既存の段を探す幅・刻み・測高幅・最小落差。
  rackCount: 8, rackMinLength: 4, rackMaxLength: 7, rackHeight: 1.8, // 台／m：稲架の数・長さ・高さ。
  strawCount: 28, strawHeight: 1.2, propClearance: 3, // 個／m：藁束の数・高さ・道とゾーンからの余白。
  stubbleStep: 1.15, stubbleHeight: .18, // m：刈り株の列間隔と高さ。
});
export const PADDY_LOOK = Object.freeze({
  tintA: '#b8963c', tintB: '#d6b658', // 既存の稲のインスタンス色（sRGB）。
  tip: [.84, .64, .27], groundGain: 1.10, cutGain: .68, // 既存の穂の頂点色と、地面・刈田の明るさ倍率。
  grass: '#65803d', rock: '#d2d2c8', wood: '#bfae92', // 既存の高草・里の薄い岩・木材の色。
  rockGain: .76, // 岩の拡散色倍率。上げると見渡しの石の線が明るくなる。
  mapStep: .5, farWidth: 1.25, farHeight: .86, // m：地色格子、遠景の房の幅・丈。
  windSpaceX: .37, windSpaceZ: .21, windSlow: 1.15, windFast: 2.4, // 既存稲と同じ風の空間位相・角速度。
  windPhase: 1.7, windAmplitude: .045, windX: .5, windZ: .28, // 風の位相倍率・振幅・方向成分。
  flutter: .03, flutterX: 3.6, flutterZ: 3.1, flutterHeight: 1.9, flutterWidth: 1.7, // 既存稲の小揺れ。
  detailsLift: .025, rackRadius: .065, sheafRadius: .14, // m：接地の余白・丸太半径・干した稲束の半径。
});
export const PADDY_DEBUG = Object.freeze({ standing: '#ffff00', harvested: '#804020', partial: '#ff8000', bund: '#00ff00', stone: '#aaaaaa', rack: '#ff0000' });

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hash = (seed, x, z) => cellRand(seed + 2303, Math.round(x * 100), Math.round(z * 100))();
export function paddyOptions(search = '') {
  const q = new URLSearchParams(search);
  return { enabled: q.get('paddy') !== '0', debug: q.get('paddydebug') === '1' };
}
export function paddyQuality(quality = 'standard', level = 0) {
  const n = clamp(Math.floor(level), 0, 3), light = quality === 'light';
  return { density: (light ? PADDY.lightDensity : 1) * (1 - n * PADDY.adaptDensity),
    distance: (light ? PADDY.lightEnd : PADDY.farEnd) - n * PADDY.adaptDistance };
}
export function paddyWeights(distance, quality = 'standard', level = 0) {
  const far = smooth(PADDY.nearStart, PADDY.nearEnd, distance);
  const end = paddyQuality(quality, level).distance;
  return { near: 1 - far, far: far * (1 - smooth(end - PADDY.adaptDistance, end, distance)) };
}
export function createPaddyPlots(world) {
  const T = world.terraces, plots = [], rows = Math.ceil((T.z1 - T.z0) / T.step);
  for (let row = 0; row < rows; row++) {
    const count = 2 + Math.floor(hash(world.seed, T.x0, T.z0 + row * T.step) * 3);
    const weights = Array.from({ length: count }, (_, i) => .9 + .2 * hash(world.seed, i, row));
    const unit = (T.x1 - T.x0) / weights.reduce((a, b) => a + b, 0);
    let x = T.x0;
    for (let i = 0; i < count; i++) {
      const x1 = i === count - 1 ? T.x1 : x + unit * weights[i];
      plots.push({ id: plots.length, row, x0: x, x1, z0: T.z0 + row * T.step, z1: Math.min(T.z1, T.z0 + (row + 1) * T.step),
        tint: 1 + (hash(world.seed, x, row) * 2 - 1) * PADDY.variation,
        height: 1 + (hash(world.seed + 1, x, row) * 2 - 1) * PADDY.variation });
      x = x1;
    }
  }
  // 里に近い北側から刈る。行内の順は位置ハッシュで決まり、半刈りは一直線。
  const order = [...plots].sort((a, b) => a.row - b.row || hash(world.seed + 2, a.x0, a.z0) - hash(world.seed + 2, b.x0, b.z0));
  const totalShare = PADDY.standing + PADDY.harvested + PADDY.partial;
  const harvested = Math.round(plots.length * PADDY.harvested / totalShare), partial = Math.round(plots.length * PADDY.partial / totalShare);
  order.forEach((p, i) => { p.kind = i < harvested ? 'harvested' : i < harvested + partial ? 'partial' : 'standing'; });
  return plots;
}
export function paddyAt(plots, x, z) {
  for (const p of plots) if (x >= p.x0 && x < p.x1 && z >= p.z0 && z < p.z1) {
    const bund = Math.min(x - p.x0, p.x1 - x, z - p.z0, p.z1 - z) < PADDY.bundWidth / 2;
    return { plot: p, bund, cut: p.kind === 'harvested' || (p.kind === 'partial' && x < (p.x0 + p.x1) / 2) };
  }
  return null;
}
const clearRoad = (terrain, x, z, margin = 0) => { const road = terrain.roadInfo(x, z); return !road || road.dist > margin; };
export function paddyPropClear(world, terrain, x, z, radius) {
  return clearRoad(terrain, x, z, PADDY.propClearance + radius)
    && Object.values(world.zones).every(p => Math.hypot(x - p.x, z - p.z) >= p.r + PADDY.propClearance + radius)
    && Object.values(world.spawns).flat().filter(p => p.kind && (p.patrol || p.route)).every(p => (p.patrol || p.route).every(([px, pz], i, path) => {
      if (!i) return true;
      const [ax, az] = path[i - 1], dx = px - ax, dz = pz - az;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      return Math.hypot(x - ax - t * dx, z - az - t * dz) >= PADDY.propClearance + radius;
    }));
}
// 地形メッシュと同じ1m格子の三角形で高さを補間（被せる草畦・切り株の沈みを防ぐ）。
export function paddyGroundHeight(terrain, x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), u = x - ix, v = z - iz;
  const a = terrain.heightAt(ix, iz), b = terrain.heightAt(ix + 1, iz), c = terrain.heightAt(ix, iz + 1), d = terrain.heightAt(ix + 1, iz + 1);
  return u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d);
}
export function createPaddyLayout(world, terrain) {
  const T = world.terraces, plots = createPaddyPlots(world), stones = [], bunds = [], far = [], stubble = [], racks = [], straw = [];
  // 畦を小片にし、道の実際の曲線と幅を優先する。上端は石の列にも足す。
  const addBund = (x, z, sx, sz) => {
    if (clearRoad(terrain, x, z, Math.hypot(sx, sz) / 2)) bunds.push({ x, z, y: paddyGroundHeight(terrain, x, z), sx, sz });
  };
  for (const p of plots) {
    // 内側の畦は区画の境界に中心を合わせ、外縁は半幅を内側へ納める。
    const verticalWidth = p.x0 === T.x0 ? PADDY.bundWidth / 2 : PADDY.bundWidth;
    const horizontalWidth = p.z0 === T.z0 ? PADDY.bundWidth / 2 : PADDY.bundWidth;
    for (let z = p.z0; z < p.z1; z += 1) {
      const length = Math.min(1, p.z1 - z);
      addBund(p.x0 + (p.x0 === T.x0 ? verticalWidth / 2 : 0), z + length / 2, verticalWidth, length);
    }
    for (let x = p.x0; x < p.x1; x += 1) {
      const length = Math.min(1, p.x1 - x);
      addBund(x + length / 2, p.z0 + (p.z0 === T.z0 ? horizontalWidth / 2 : 0), length, horizontalWidth);
    }
  }
  for (let row = 0; row < Math.ceil((T.z1 - T.z0) / T.step); row++) {
    const nominal = Math.min(T.z1 - T.riser, T.z0 + (row + 1) * T.step - T.riser / 2);
    for (let x = T.x0 + PADDY.stoneMax; x < T.x1 - PADDY.stoneMax; x += PADDY.stonePitch) {
      let best = null;
      for (let z = Math.max(T.z0, nominal - PADDY.contourSearch); z <= Math.min(T.z1, nominal + PADDY.contourSearch); z += PADDY.contourStep) {
        const top = terrain.heightAt(x, z - PADDY.contourProbe), bottom = terrain.heightAt(x, z + PADDY.contourProbe), drop = top - bottom;
        const score = drop - Math.abs(z - nominal) * .005;
        if (!best || score > best.score) best = { z, top, bottom, drop, score };
      }
      // 南端は既存地形がなだらかに戻る。落差が無い部分は帯の上端を田面へ埋める。
      const followsContour = best.drop >= PADDY.contourMin;
      if (!followsContour) best = { z: nominal, top: paddyGroundHeight(terrain, x, nominal - PADDY.contourProbe) };
      if (!clearRoad(terrain, x, best.z, PADDY.stoneMax)) continue;
      const drop = T.drop;
      for (let layer = 0; layer < PADDY.stoneLayers; layer++) {
        const width = PADDY.stoneMin + hash(world.seed + layer, x, best.z) * (PADDY.stoneMax - PADDY.stoneMin);
        stones.push({ row, followsContour, nominal, sampleX: x, x: x + (layer ? .08 : 0), z: best.z, y: best.top + PADDY_LOOK.detailsLift - drop + (layer + .5) * drop / PADDY.stoneLayers,
          width, height: drop / PADDY.stoneLayers, depth: T.riser / 2, drop });
      }
      addBund(x, best.z - PADDY.contourProbe, PADDY.stonePitch, PADDY.bundWidth);
    }
  }
  for (let z = T.z0 + PADDY.farStep / 2; z < T.z1; z += PADDY.farStep) for (let x = T.x0 + PADDY.farStep / 2; x < T.x1; x += PADDY.farStep) {
    const s = paddyAt(plots, x, z);
    if (s.bund || !clearRoad(terrain, x, z, PADDY.bundWidth / 2)) continue;
    const item = { x, z, y: paddyGroundHeight(terrain, x, z), plot: s.plot.id, rank: hash(world.seed + 3, x, z), height: s.plot.height };
    if (!s.cut) far.push(item);
  }
  // 保守的な外接円で道・任務ゾーンを避ける。稲架・藁束に当たりは追加しない。
  for (let z = T.z0 + PADDY.stubbleStep / 2; z < T.z1; z += PADDY.stubbleStep) for (let x = T.x0 + PADDY.stubbleStep / 2; x < T.x1; x += PADDY.stubbleStep) {
    const s = paddyAt(plots, x, z);
    if (s.cut && !s.bund && clearRoad(terrain, x, z, PADDY.bundWidth / 2)) stubble.push({ x, z, y: paddyGroundHeight(terrain, x, z), plot: s.plot.id });
  }
  for (const p of plots.filter(p => p.kind === 'harvested')) {
    for (let z = p.z0 + 3.6; z < p.z1 - 3; z += 3) for (let x = p.x0 + 4; x < p.x1 - 4; x += 5) {
      const length = PADDY.rackMinLength + hash(world.seed + 4, x, z) * (PADDY.rackMaxLength - PADDY.rackMinLength), radius = Math.hypot(length / 2, .8);
      if (racks.length >= PADDY.rackCount || !paddyPropClear(world, terrain, x, z, radius) || racks.some(r => Math.hypot(x - r.x, z - r.z) < radius + r.radius + 1)) continue;
      racks.push({ x, z, y: paddyGroundHeight(terrain, x, z), length, height: PADDY.rackHeight, radius, plot: p.id });
    }
  }
  for (const p of plots.filter(p => p.kind === 'harvested')) {
    for (let z = p.z0 + 2; z < p.z1 - 2; z += 3) for (let x = p.x0 + 2; x < p.x1 - 2; x += 6) {
      if (straw.length + 4 > PADDY.strawCount) continue;
      const cluster = [];
      for (let k = 0; k < 4; k++) {
        const sx = x + (k % 2) * .8, sz = z + Math.floor(k / 2) * .8;
        if (!paddyPropClear(world, terrain, sx, sz, .5) || racks.some(r => Math.hypot(sx - r.x, sz - r.z) < r.radius + .7)) break;
        cluster.push({ x: sx, z: sz, y: paddyGroundHeight(terrain, sx, sz), height: PADDY.strawHeight * (.9 + .2 * hash(world.seed + 5, sx, sz)), plot: p.id });
      }
      if (cluster.length === 4) straw.push(...cluster);
    }
  }
  far.sort((a, b) => a.rank - b.rank);
  return { bounds: T, plots, stones, bunds, far, stubble, racks, straw, stoneLength: stones.length / PADDY.stoneLayers * PADDY.stonePitch };
}
export function paddyNearRice(data, plots) {
  const out = { x: [], y: [], z: [], s: [], rot: [], tint: [] }, plotKinds = [];
  for (let i = 0; i < data.x.length; i++) {
    const state = paddyAt(plots, data.x[i], data.z[i]);
    if (!state || state.bund || state.cut) continue;
    plotKinds.push(state.plot.kind);
    for (const key of Object.keys(out)) out[key].push(key === 's' ? data.s[i] * state.plot.height : key === 'tint' ? clamp(data.tint[i] + state.plot.tint - 1, 0, 1) : data[key][i]);
  }
  return { ...out, plotKinds };
}
