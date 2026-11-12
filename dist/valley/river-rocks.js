// 清瀬川と橋・山砦の装飾配置。高さは既存地形から読むだけで、地形と当たりは変えない。
import { cellRand } from './scatter.js';

export const RIVER_ART = Object.freeze({
  largeCount: 40, smallCount: 220, // 個：標準の大岩と小石。
  largeSize: [1.5, 4], smallSize: [0.4, 1.2], // m：水平の最大径。
  rockHeight: 0.65, wetSink: 0.18, drySink: 0.12, // 径に対する高さ・沈める割合。
  rockDepth: [0.65, 1], rockSpacing: 0.45, // 径の比：奥行と隣の岩からの余裕。
  reachInset: 40, channelFraction: 0.72, bankOffset: 2.8, // m（fractionのみ比率）：端と岸からの余裕。
  shoalCount: 5, shoalLength: 20, shoalWidth: 5, // 個・m：内側の曲がりに置く河原。
  rapidCount: 7, rapidLength: [8, 20], // 個・m：川幅を横切る瀬。
  wakeLength: [2, 8], wakeWidth: 1.35, // m・岩径に対する比：岩の下流の泡。
  foamSpeed: 1.6, foamPeriod: 6, foamOpacity: 0.78, foamFloor: 0.32, // m/s・m・濃度：遠景でも平均濃度を残す。
  bridgeModelLength: 6.06251, bridgeModelWidth: 2.37916, // m：同梱橋模型の水平寸法。
  bridgeClear: 3, roadClear: 2, // m：橋と道から岩・河原を離す余裕。
  gateHeight: 3.6, gateOpening: 3.5, gatePost: 0.42, gateBeam: 0.48, // m：冠木門の高さ・内幅・柱径・横木径。
  gateOffset: 4, fenceLength: 9, fenceHeight: 2, // m：橋端から門まで・片側柵・柵高。
  fenceStep: 0.48, fenceRadius: 0.20, fenceTip: 0.32, // m：丸太の間隔・半径・尖端。
  bridgeBanners: 4, bannerHeight: 4.2, bannerWidth: 0.65, bannerLength: 2.8, // 本・m：橋の流れ旗。
  bannerPole: 0.055, bannerWave: 0.22, bannerRate: 2.1, bannerRows: 12, // m・m・rad/s・分割数：竿と布。
  fortDiameter: 60, fortFenceHeight: 2.8, fortGateOpening: 4.5, // m：砦の輪と門の開口。
  fortModelScale: 0.56, // 倍：既存模型を主建物として外周内へ収める見た目だけの倍率。旗を切ると元へ戻る。
  towerHeight: 9, towerWidth: 4.6, towerOffset: [-23, -8], // m：屋根を含む高さ・幅・砦中心からの位置。
  fortBanners: 8, fortBannerHeight: 5.8, fortBannerWidth: 0.95, // 本・m：遠景で残す旗。
  hutCount: 3, hutWidth: 5, hutHeight: 3.5, hutSpacing: 12, hutSouth: 22, // 棟・m：砦内の小屋。
  peakClearScale: 1.9, // flatR比：scatter.jsの既存の頂上除外と同じ。既存の木をさらに消さない。
  pathWidth: 2.8, pathPoints: [[0, 30], [-25, 42], [24, 57], [-13, 75]], // m：砦中心からのつづら折り（色のみ）。
  groundStep: 2, groundLift: 0.09, // m：地表の色の分割幅と深度の余裕。
  rockDetail: 1, postSides: 6, patchSides: 32, // 分割数：岩・丸太・地表。
  smallDistance: [360, 300, 250, 210], detailFraction: [1, 0.72, 0.48, 0.3], // m・比率：自動調整段階0〜3。主な輪郭は残す。
  lightFraction: 0.6, lightDistance: 0.8, adaptScales: [1, 0.85, 0.7, 0.58], // 比率：軽量と既存の解像度調整。
  selectionMove: 6, // m：小物の選び直し間隔。歩行中の毎コマの詰め直しを避ける。
});
const A = RIVER_ART, TAU = Math.PI * 2;
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const random = (world, i, stream) => cellRand(world.seed + 2306, i, stream);

export function riverFlags(search = '') {
  const q = new URLSearchParams(search);
  return { river: q.get('river2') !== '0', gate: q.get('gate') !== '0', fort: q.get('fort2') !== '0', debug: q.get('riverdebug') === '1' };
}
export function riverBudget(quality = 'standard', adapt = 0, out = {}) {
  const level = clamp(Math.floor(adapt), 0, A.detailFraction.length - 1), light = quality === 'light';
  out.fraction = A.detailFraction[level] * (light ? A.lightFraction : 1);
  out.smallDistance = A.smallDistance[level] * (light ? A.lightDistance : 1);
  return out;
}
export function riverSamples(terrain) {
  let along = 0;
  return terrain.riverLine.map((p, i, line) => {
    if (i) along += Math.hypot(p.x - line[i - 1].x, p.z - line[i - 1].z);
    return { x: p.x, z: p.z, along };
  });
}
export function riverPoint(samples, along, offset = 0) {
  let i = 0;
  while (i < samples.length - 2 && samples[i + 1].along < along) i++;
  const a = samples[i], b = samples[i + 1], len = b.along - a.along;
  const t = clamp((along - a.along) / len, 0, 1), tx = (b.x - a.x) / len, tz = (b.z - a.z) / len;
  return { x: mix(a.x, b.x, t) - tz * offset, z: mix(a.z, b.z, t) + tx * offset, tx, tz, along, offset };
}
export function inBridge(world, x, z, margin = 0) {
  const b = world.distant.find(d => d.kind === 'bridge');
  const dx = x - b.x, dz = z - b.z, c = Math.cos(b.rotY), s = Math.sin(b.rotY);
  return Math.abs(dx * c - dz * s) < A.bridgeModelLength * b.scale[0] / 2 + margin &&
    Math.abs(dx * s + dz * c) < A.bridgeModelWidth * b.scale[2] / 2 + margin;
}
function free(world, terrain, x, z, radius) {
  const road = terrain.roadInfo(x, z);
  return !inBridge(world, x, z, radius + A.bridgeClear) && (!road || road.dist > radius + A.roadClear);
}
// 泡の模様は、下流を正とする距離から時間×速さを引く。同じ位相が下流へ進む。
export const foamPhase = (along, time) => (along - time * A.foamSpeed) / A.foamPeriod;
export const foamDistanceOpacity = () => A.foamOpacity; // 距離では薄めない。霧だけは既存の大気と共有。
export function fortClearing(world) {
  const fort = world.distant.find(d => d.kind === 'fort');
  const peak = world.peaks.find(p => Math.hypot(p.x - fort.x, p.z - fort.z) < p.flatR);
  return { x: peak.x, z: peak.z, radius: peak.flatR * A.peakClearScale };
}

export function riverLayout(world, terrain, flags = riverFlags()) {
  const samples = riverSamples(terrain), length = samples.at(-1).along;
  const out = { rocks: [], foam: [], shoals: [], gates: [], fences: [], banners: [], towers: [], huts: [], clearing: null, path: [] };
  if (flags.river) {
    // 曲がりの内側：曲率の符号から法線側を決め、曲がりの強い点を離して5つ選ぶ。
    const bends = samples.slice(2, -2).map((p, k) => {
      const a = samples[k], b = samples[k + 4], ux = p.x - a.x, uz = p.z - a.z, vx = b.x - p.x, vz = b.z - p.z;
      const turn = (ux * vz - uz * vx) / (Math.hypot(ux, uz) * Math.hypot(vx, vz));
      return { along: p.along, turn };
    }).sort((a, b) => Math.abs(b.turn) - Math.abs(a.turn) || a.along - b.along);
    for (const bend of bends) {
      if (out.shoals.length === A.shoalCount) break;
      if (out.shoals.some(s => Math.abs(s.along - bend.along) < A.shoalLength * 2)) continue;
      const p = riverPoint(samples, bend.along, Math.sign(bend.turn) * (world.river.halfWidth + A.bankOffset));
      if (!free(world, terrain, p.x, p.z, A.shoalLength / 2)) continue;
      out.shoals.push({ ...p, length: A.shoalLength, width: A.shoalWidth });
    }
    for (const [kind, count, sizes] of [['large', A.largeCount, A.largeSize], ['small', A.smallCount, A.smallSize]]) {
      let added = 0;
      for (let attempt = 0; added < count && attempt < count * 12; attempt++) {
        const rand = random(world, attempt, kind === 'large' ? 1 : 2);
        const along = A.reachInset + ((attempt + rand()) / count % 1) * (length - A.reachInset * 2);
        const size = mix(...sizes, rand()), bank = kind === 'small' && attempt % 3 !== 0;
        const shoal = out.shoals[attempt % out.shoals.length];
        const offset = bank ? shoal.offset + (rand() - 0.5) * (A.shoalWidth - size) : (rand() * 2 - 1) * (world.river.halfWidth * A.channelFraction - size / 2);
        const p = riverPoint(samples, bank ? shoal.along + (rand() - 0.5) * (shoal.length - size) : along, offset);
        if (!free(world, terrain, p.x, p.z, size / 2)) continue;
        if (out.rocks.some(r => Math.hypot(p.x - r.x, p.z - r.z) < (size + r.size) * A.rockSpacing)) continue;
        const wet = Math.abs(offset) < world.river.halfWidth;
        const height = size * A.rockHeight;
        const y = (wet ? terrain.waterLevelAt(p.x, p.z) : terrain.heightAt(p.x, p.z)) - height * (wet ? A.wetSink : A.drySink);
        out.rocks.push({ ...p, y, size, height, kind, wet, rot: rand() * TAU, depth: size * mix(...A.rockDepth, rand()) });
        added++;
      }
    }
    out.rocks.forEach((r, i) => {
      if (!r.wet) return;
      const rand = random(world, i, 3), len = mix(...A.wakeLength, rand());
      const along = r.along + r.size / 2;
      out.foam.push({ kind: 'wake', rock: i, along, offset: r.offset, length: len, width: r.size * A.wakeWidth });
    });
    for (let i = 0; i < A.rapidCount; i++) {
      const rand = random(world, i, 4), along = A.reachInset + (i + 0.5) / A.rapidCount * (length - 2 * A.reachInset);
      out.foam.push({ kind: 'rapid', along, offset: 0, length: mix(...A.rapidLength, rand()), width: world.river.halfWidth * 2 });
    }
  }
  const bridge = world.distant.find(d => d.kind === 'bridge'), axis = { x: Math.cos(bridge.rotY), z: -Math.sin(bridge.rotY) };
  const bridgeAt = (u, v) => ({ x: bridge.x + axis.x * u - axis.z * v, z: bridge.z + axis.z * u + axis.x * v });
  if (flags.gate) {
    for (const side of [-1, 1]) {
      const u = side * (A.bridgeModelLength * bridge.scale[0] / 2 + A.gateOffset), p = bridgeAt(u, 0);
      out.gates.push({ ...p, acrossX: -axis.z, acrossZ: axis.x, opening: A.gateOpening, height: A.gateHeight, group: 'gate' });
      for (const wing of [-1, 1]) {
        const v = wing * (A.gateOpening / 2 + A.gatePost), from = bridgeAt(u, v), to = bridgeAt(u, v + wing * A.fenceLength);
        out.fences.push({ from, to, height: A.fenceHeight, group: 'gate' });
      }
    }
    for (let i = 0; i < A.bridgeBanners; i++) {
      const side = i < Math.ceil(A.bridgeBanners / 2) ? -1 : 1, wing = i % 2 ? -1 : 1;
      const u = side * (A.bridgeModelLength * bridge.scale[0] / 2 + A.gateOffset + 1);
      out.banners.push({ ...bridgeAt(u, wing * (A.gateOpening / 2 + A.gatePost + 1)), height: A.bannerHeight, width: A.bannerWidth, group: 'gate' });
    }
  }
  if (flags.fort) {
    const f = world.distant.find(d => d.kind === 'fort'), r = A.fortDiameter / 2;
    out.clearing = fortClearing(world);
    // 門を南側(+Z)へ開ける。最初と最後の端点が門柱につながる、1本の閉じた外周。
    const gap = Math.asin((A.fortGateOpening / 2 + A.gatePost / 2) / r), segments = Math.ceil((TAU - 2 * gap) * r / A.fenceStep);
    const point = t => ({ x: f.x + Math.sin(t) * r, z: f.z + Math.cos(t) * r });
    for (let i = 0; i < segments; i++) out.fences.push({ from: point(gap + (TAU - 2 * gap) * i / segments), to: point(gap + (TAU - 2 * gap) * (i + 1) / segments), height: A.fortFenceHeight, group: 'fort' });
    out.gates.push({ x: f.x, z: f.z + Math.cos(gap) * r, acrossX: 1, acrossZ: 0, opening: A.fortGateOpening, height: A.gateHeight, group: 'fort' });
    out.towers.push({ x: f.x + A.towerOffset[0], z: f.z + A.towerOffset[1], height: A.towerHeight, width: A.towerWidth, group: 'fort' });
    for (let i = 0; i < A.fortBanners; i++) out.banners.push({ x: f.x + Math.sin(TAU * i / A.fortBanners) * (r - 2), z: f.z + Math.cos(TAU * i / A.fortBanners) * (r - 2), height: A.fortBannerHeight, width: A.fortBannerWidth, group: 'fort' });
    for (let i = 0; i < A.hutCount; i++) out.huts.push({ x: f.x + (i - (A.hutCount - 1) / 2) * A.hutSpacing, z: f.z + A.hutSouth, width: A.hutWidth, height: A.hutHeight, group: 'fort' });
    out.path = A.pathPoints.map(([x, z]) => ({ x: f.x + x, z: f.z + z }));
  }
  return out;
}
