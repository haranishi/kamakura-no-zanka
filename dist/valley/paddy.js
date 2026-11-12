// 棚田の見た目専用の配置。地形・道・当たりの値は変更しない。
import { cellRand } from './scatter.js';

export const PADDY = Object.freeze({
  standing: .60, harvested: .25, partial: .15, // 枚数比。端数は最も近い整数へ。
  bundWidth: .75, bundHeight: .19, // m：草の畦の幅と田面からの高さ。
  variation: .08, // 色・丈の区画差の最大比率。
  nearStart: 60, nearEnd: 95, farEnd: 300, // m：近遠混合帯と標準の最遠距離。
  farStep: 1.15, lightDensity: .15, lightEnd: 200, // m／比率：遠景株の格子・軽量密度・軽量距離。
  adaptDensity: .22, adaptDistance: 20, // 段階ごとの密度比の減少・距離短縮m。
  stoneMin: .3, stoneMax: .7, stonePitch: .52, stoneLayers: 2, // m／段：野面石の寸法・間隔・層数。
  contourSearch: 3, contourStep: .25, contourProbe: .30, contourMin: .18, // m：既存の段を探す幅・刻み・測高幅・最小落差。
  rackCount: 8, rackMinLength: 4, rackMaxLength: 7, rackHeight: 1.8, // 台／m：稲架の数・長さ・高さ。
  strawCount: 28, strawHeight: 1.2, propClearance: 3, // 個／m：藁束の数・高さ・道とゾーンからの余白。
  stoneDepthMin: .25, stoneDepthMax: .45, stoneNear: 40, stoneMid: 150, // m：石の厚みと12面／6面／帯の境界。
  stoneTilt: 12, stoneHeightMin: .18, shallowDrop: .25, // 度／m：最大傾斜・一段積みへ切り替える落差。
  bundSegments: 6, lightBundSegments: 4, bundSpaceX: .73, bundSpaceZ: .61, // 点数-1／mの逆数：畦の断面分割・起伏の空間位相。
  bundJitter: .10, bundHeightJitter: .02, bundGrassDensity: 4, grassMin: .15, grassMax: .4, // m／株毎m：畦の起伏・草密度・草丈。
  stubbleStep: .3, stubblePitch: .26, stubbleHeight: .11, stubbleDiameter: .10, stubbleStems: 5, // m／本：条間・株間・丈・径・茎数。
  grassRadius: .075, grassBladeWidth: .018, stubbleBladeWidth: .008, // m：草の房の開き・草葉と藁茎の幅。
  detailEnd: 40, lightDetailEnd: 18, detailAdapt: 5, // m：草・切り株の形の距離（品質段階で短縮）。
  detailFade: 2, // m：近景の草・切り株が消える直前に縮む帯。
  triangleBudget: 120000, lightTriangleBudget: 50000, updateStep: .5, // 三角形／m：品質上限と位置更新間隔。

});
export const PADDY_LOOK = Object.freeze({
  tintA: '#b8963c', tintB: '#d6b658', // 既存の稲のインスタンス色（sRGB）。
  tip: [.84, .64, .27], groundGain: 1.10, // 既存の穂の頂点色と、地面・刈田の明るさ倍率。
  grass: '#65803d', rock: '#d2d2c8', wood: '#bfae92', // 既存の高草・里の薄い岩・木材の色。
  soil: '#967850', soilGain: .42, cutRiceMix: .35, cutGain: 1, cutPatch: .15, patchGain: 1.25, // 土は既存地図の土色(150,120,80)。刈田は稲を35%混色、15%に落ち藁。
  riceGreen: .18, rootEnd: 40, rootStart: 22, rowDark: .12, waveShade: .14, // 緑の残る黄・根元の暗土から地色への距離m・条と風の明暗比。
  rockGain: .65, rockVariation: .12, rockSoil: .12, rockGrass: .10, // 既存岩色の明度・石ごとの差・上段の土と草色の混合。
  bundSoil: .25, strawWhite: .35, // 畦の土の最大混色率・立てた藁束の白木色混合率。
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
  const T = world.terraces, plots = createPaddyPlots(world), stones = [], bunds = [], far = [], stubble = [], grass = [], walls = [], racks = [], straw = [];
  // 畦を小片にし、道の実際の曲線と幅を優先する。上端は石の列にも足す。
  const addBund = (x, z, sx, sz, alongX) => {
    x = clamp(x, T.x0 + sx / 2, T.x1 - sx / 2); z = clamp(z, T.z0 + sz / 2, T.z1 - sz / 2);
    if (!clearRoad(terrain, x, z, Math.hypot(sx, sz) / 2)) return;
    const y0 = paddyGroundHeight(terrain, x - (alongX ? sx / 2 : 0), z - (alongX ? 0 : sz / 2));
    const y1 = paddyGroundHeight(terrain, x + (alongX ? sx / 2 : 0), z + (alongX ? 0 : sz / 2));
    bunds.push({ x, z, y: paddyGroundHeight(terrain, x, z), y0, y1, sx, sz, alongX, jitter: Math.min(PADDY.bundJitter, alongX ? Math.min(z-sz/2-T.z0,T.z1-z-sz/2) : Math.min(x-sx/2-T.x0,T.x1-x-sx/2)) });
  };
  for (const p of plots) {
    // 内側の畦は区画の境界に中心を合わせ、外縁は半幅を内側へ納める。
    const verticalWidth = p.x0 === T.x0 ? PADDY.bundWidth / 2 : PADDY.bundWidth;
    const horizontalWidth = p.z0 === T.z0 ? PADDY.bundWidth / 2 : PADDY.bundWidth;
    for (let z = p.z0; z < p.z1; z += 1) {
      const length = Math.min(1, p.z1 - z);
      addBund(p.x0 + (p.x0 === T.x0 ? verticalWidth / 2 : 0), z + length / 2, verticalWidth, length, false);
    }
    for (let x = p.x0; x < p.x1; x += 1) {
      const length = Math.min(1, p.x1 - x);
      addBund(x + length / 2, p.z0 + (p.z0 === T.z0 ? horizontalWidth / 2 : 0), length, horizontalWidth, true);
    }
  }
  for (let row = 0; row < Math.ceil((T.z1 - T.z0) / T.step); row++) {
    const nominal = Math.min(T.z1 - T.riser, T.z0 + (row + 1) * T.step - T.riser / 2);
    for (let x = T.x0 + PADDY.stoneMax; x < T.x1 - PADDY.stoneMax; x += PADDY.stonePitch) {
      let best = null;
      for (let z = Math.max(T.z0, nominal - PADDY.contourSearch); z <= Math.min(T.z1, nominal + PADDY.contourSearch); z += PADDY.contourStep) {
        const top = terrain.heightAt(x, z - PADDY.contourProbe), bottom = terrain.heightAt(x, z + PADDY.contourProbe), drop = Math.abs(top - bottom);
        const score = drop - Math.abs(z - nominal) * .005;
        if (!best || score > best.score) best = { z, top: Math.max(top, bottom), bottom: Math.min(top, bottom), drop, highSide: top >= bottom ? -1 : 1, score };
      }
      // 実地形が緩い南側も、仮想の0.55m壁は作らない。実測した低い側と高い側の間へ納める。
      const followsContour = best.drop >= PADDY.contourMin;
      const northY = paddyGroundHeight(terrain, x, best.z - PADDY.contourProbe), southY = paddyGroundHeight(terrain, x, best.z + PADDY.contourProbe);
      const drop = Math.min(T.drop, Math.abs(northY - southY));
      if (!clearRoad(terrain, x, best.z, PADDY.stoneMax)) continue;
      const layers = drop < PADDY.shallowDrop ? 1 : PADDY.stoneLayers;
      const top = Math.max(northY, southY), bottom = top - drop;
      walls.push({ row, drop, x, z: best.z, top: top + (drop === 0 ? PADDY.stoneHeightMin / 2 : 0), bottom: bottom - (drop === 0 ? PADDY.stoneHeightMin / 2 : 0), width: PADDY.stonePitch });
      for (let layer = 0; layer < layers; layer++) {
        const width = PADDY.stoneMin + hash(world.seed + layer, x, best.z) * (PADDY.stoneMax - PADDY.stoneMin);
        stones.push({ row, layer, layers, followsContour, nominal, sampleX: x,
          x: x + (layer ? PADDY.stonePitch / 2 : 0), z: best.z,
          y: bottom + (layer + .5) * drop / layers, top, bottom, width,
          height: Math.max(PADDY.stoneHeightMin, drop / layers), depth: PADDY.stoneDepthMin + hash(world.seed + 8, x, layer) * (PADDY.stoneDepthMax - PADDY.stoneDepthMin), drop,
          tilt: (hash(world.seed + 9, x, layer) * 2 - 1) * PADDY.stoneTilt,
          turn: hash(world.seed + 10, x, layer) * Math.PI * 2,
          shade: 1 + (hash(world.seed + 11, x, layer) * 2 - 1) * PADDY_LOOK.rockVariation });
      }
      addBund(x, best.z + best.highSide * PADDY.contourProbe, PADDY.stonePitch, PADDY.bundWidth, true);
    }
  }
  for (let z = T.z0 + PADDY.farStep / 2; z < T.z1; z += PADDY.farStep) for (let x = T.x0 + PADDY.farStep / 2; x < T.x1; x += PADDY.farStep) {
    const s = paddyAt(plots, x, z);
    if (s.bund || !clearRoad(terrain, x, z, PADDY.bundWidth / 2)) continue;
    const item = { x, z, y: paddyGroundHeight(terrain, x, z), plot: s.plot.id, rank: hash(world.seed + 3, x, z), height: s.plot.height };
    if (!s.cut) far.push(item);
  }
  // 各田の長辺に沿う条。格子の起点を田ごとに固定し、半刈りでも線を保つ。
  for (const p of plots) {
    const alongX = p.x1 - p.x0 >= p.z1 - p.z0;
    for (let across = (alongX ? p.z0 : p.x0) + PADDY.stubbleStep; across < (alongX ? p.z1 : p.x1); across += PADDY.stubbleStep)
      for (let along = (alongX ? p.x0 : p.z0) + PADDY.stubblePitch; along < (alongX ? p.x1 : p.z1); along += PADDY.stubblePitch) {
        const x = alongX ? along : across, z = alongX ? across : along, s = paddyAt(plots, x, z);
        if (s.cut && !s.bund && clearRoad(terrain, x, z, PADDY.bundWidth / 2)) stubble.push({ x, z, y: paddyGroundHeight(terrain, x, z), plot: p.id, alongX,
          height: PADDY.stubbleHeight * (.8 + .4 * hash(world.seed + 12, x, z)) });
      }
  }
  for (const b of bunds) for (let i = 0, count = Math.ceil((b.alongX ? b.sx : b.sz) * PADDY.bundGrassDensity); i < count; i++) {
    const t = (i + .5) / Math.ceil((b.alongX ? b.sx : b.sz) * PADDY.bundGrassDensity) - .5;
    const ripple = b.jitter * Math.sin(b.x * PADDY.bundSpaceX + b.z * PADDY.bundSpaceZ);
    const x = b.x + (b.alongX ? t * b.sx : ripple), z = b.z + (b.alongX ? ripple : t * b.sz);
    grass.push({ x, z, y: b.y0 + (t + .5) * (b.y1 - b.y0) + PADDY.bundHeight + paddyBundLift(x, z), height: PADDY.grassMin + (PADDY.grassMax - PADDY.grassMin) * hash(world.seed + 13, x, z) });
  }
  // 保守的な外接円で道・任務ゾーンを避ける。稲架・藁束に当たりは追加しない。
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
  return { bounds: T, plots, stones, walls, bunds, far, stubble, grass, racks, straw, stoneLength: walls.length * PADDY.stonePitch };
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

// 連続した位置関数なので1mの畦の継ぎ目でも高さが揃う。
export const paddyBundLift = (x, z) => PADDY.bundHeightJitter * Math.sin(x * PADDY.bundSpaceX + z * PADDY.bundSpaceZ);
export function paddyBundSection(t, x, z) {
  return Math.sin(Math.PI * t) * (PADDY.bundHeight + paddyBundLift(x, z));
}
