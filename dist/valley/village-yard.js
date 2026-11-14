// village-yard.js — 里の物と働く人（W2c-23e・WW18.4）。見た目だけの層。座標・当たり・任務は変えない。
// 見渡し（concept）から、かまどの煙と働く人が数えられることを目標にする。

export const YARD = Object.freeze({
  // かまどの煙：見渡し約 180m からも細い柱として読める高さ・幅。
  smokeHeight: 14, smokeBase: 1.1, smokeGrowth: 2.8, smokeTopAspect: 0.35, // m／半径／半径倍率／上端の縦横比。
  smokeDensity: 0.55, smokeRise: 0.04, smokeNoise: 2.0, smokeEdge: 0.55, smokeEdgeSoft: 0.4, // 不透明度／周／周波数／縁。
  smokeWind: 0.45, smokeSway: 0.12, smokeSwayHz: 0.07, // 風下への傾き／揺れ／Hz。
  smokeDark: Object.freeze([0.22, 0.21, 0.19]), smokeMid: Object.freeze([0.42, 0.40, 0.36]), smokeLit: Object.freeze([0.55, 0.48, 0.38]), // 線形 RGB。
  smokePuffs: 18, lightSmokePuffs: 10, // 標準／軽量の煙の枚数。
  // 働く人の影絵：実物より大きく・明るく（kamakura-crowd と同じ理由。暗い小人が地面に溶ける）。
  workerHeight: 1.62, farScale: 1.55, farFrom: 70, farTo: 220, // m／倍率／距離。
  clothes: Object.freeze([0x6a8a9a, 0xa08968, 0xd4c9ad, 0xb0a88e]), // sRGB：藍・茶・生成り・灰。
  skin: 0xb8966e, hair: 0x2a2824, // sRGB。
  maxWorkers: 12, lightMaxWorkers: 8, // 見渡しから数えられる上限。
  range: 420, lightRange: 280, // m：描く距離。
  bend: 0.58, // 稲刈り姿勢の上体の縮み。
});

export const yardEnabled = search => new URLSearchParams(search).get('yard') !== '0';

// かまどの煙の吹き出し口。既存の炉と、茅葺きの家の棟（見た目だけ。新しい当たりは付けない）。
// lift は地面からの吹き出し高さ（m）。家は game.js の煙突と同じ屋根の高さ。
export function yardSmokeSpots(world = {}) {
  const spots = [];
  const hearth = (world.life?.items || []).find(d => d.id === 'hearth');
  if (hearth) spots.push({ id: 'hearth', x: hearth.x, z: hearth.z, strength: 1, lift: 0.4 });
  const houses = (world.buildings || []).filter(b => b.kind === 'farmhouse');
  for (let i = 0; i < houses.length; i++) {
    const b = houses[i], yaw = b.rotY || 0;
    spots.push({
      id: b.id,
      x: b.x + Math.sin(yaw) * 0.8,
      z: b.z + Math.cos(yaw) * 0.8,
      strength: 0.65 + (i % 3) * 0.1,
      lift: 5.6 * (0.98 + (b.variant || 0) * 0.04),
    });
  }
  return spots;
}

// 働く人の置き場。既存の村人・稲架・脱穀の平場のそば。任務の敵やゾーンは動かさない。
export function yardWorkerSpots(world = {}) {
  const out = [];
  const push = (id, x, z, yaw, role) => out.push({ id, x, z, yaw, role });
  // 棚田（既存の稲刈り村人の近くと、見渡しで空いて見える帯）。
  push('w_rice_1', 10, 48, 0.4, 'rice');
  push('w_rice_2', -18, 56, 5.1, 'rice');
  push('w_rice_3', 22, 42, 1.2, 'rice');
  push('w_rice_4', -8, 52, 2.8, 'carry');
  // 脱穀の平場と井戸のまわり。
  push('w_yard_1', 2, 2, 0.2, 'thresh');
  push('w_yard_2', -4, 8, 3.5, 'talk');
  push('w_yard_3', 6, -2, 1.8, 'carry');
  // 干し場・薪。
  push('w_dry_1', 24, 10, 0.5, 'dry');
  push('w_dry_2', -4, 28, 4.2, 'dry');
  push('w_wood_1', -11, -8, 2.1, 'wood');
  // 荷運び（荷馬は模型を足さず、背負いの姿勢の影絵）。
  push('w_path_1', -20, 0, 1.0, 'carry');
  push('w_path_2', 12, 18, 3.8, 'carry');
  // 既存の村人の座標と重ならないこと（1m 以上離す）を検査で見る。
  void world;
  return out;
}

export function yardWorkerCount(quality = 'standard') {
  return quality === 'light' ? YARD.lightMaxWorkers : YARD.maxWorkers;
}

export function yardSmokePuffCount(quality = 'standard') {
  return quality === 'light' ? YARD.lightSmokePuffs : YARD.smokePuffs;
}

// 見渡しの画角（shots.concept）から、働く人が何画素くらいに写るかの下界（幅）。合否の目安に使う。
export function yardWorkerPixels(distance, { fov = 62, height = 720, farScale = YARD.farScale } = {}) {
  const scale = farScaleAt(distance);
  const worldH = YARD.workerHeight * scale;
  const halfFov = (fov * Math.PI) / 180 / 2;
  return (worldH / (2 * distance * Math.tan(halfFov))) * height;
}

export function farScaleAt(distance, from = YARD.farFrom, to = YARD.farTo, gain = YARD.farScale) {
  if (distance <= from) return 1;
  if (distance >= to) return gain;
  const t = (distance - from) / (to - from);
  return 1 + (gain - 1) * t;
}

export function yardStats(world, quality = 'standard') {
  return {
    smoke: yardSmokeSpots(world).length,
    workers: Math.min(yardWorkerSpots(world).length, yardWorkerCount(quality)),
    puffs: yardSmokePuffCount(quality),
  };
}
