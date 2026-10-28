// config.js — 見た目と手触りの調整値（暫定の初期値）。?lk=キー:値,... で書き換えずに試せる。
// 規則の数値（技の時間・ダメージ）は combat.js の MOVES/STATS が正本。音の発見半径と音量は AUDIO_NOISE を共有する。

// 武器を骨へ付ける位置と向き（骨のローカル座標。回転は度）。ラボ（lab.html）で動作を見ながら合わせる。
export const GRIP = {
  // 右手→左手のベクトルは構えで骨ローカル +Z、斬る向きの手の速度は −X。刃は −Z、刃の向きは −X に合わせた（ラボで実測）。
  tachiDrawn: { bone: 'RightHand', pos: [0, 0, 0.05], axes: { y: [0, 0, -1], z: [-1, 0, 0] } },
  // 左腰に、切先を後ろ下へ、刃を下へ向けて吊る（太刀の佩き方）。
  tachiHip: { bone: 'Hips', pos: [0.19, 0.0, 0.12], axes: { y: [0.1, -0.36, -0.93], z: [0, -1, 0] } },
  naginata: { bone: 'RightHand', pos: [0, 0, 0], rot: [0, 0, 0] },
  yumi: { bone: 'LeftHand', pos: [0, 0, 0], rot: [0, 0, 0] },
  // 矢は構えの間だけ、両手の位置から bow.js が作る（骨には付けない）。矢筒は背中の上（Spine02）に斜めに背負う。
  quiver: { bone: 'Spine02', pos: [0.0, 0.06, -0.2], rot: [0, 0, 0] },
};

// 遊びの手触りの調整値（暫定の初期値）。規則の数値は combat.js、ここは演出・操作の値だけ。
export const FEEL = {
  hitStop: { hit: 0.07, heavy: 0.10, parry: 0.09 }, hitStopScale: 0.05,
  arrowSpeed: 34, arrowSpread: 0.012, pillageScale: 0.4,
  alertShareRadius: 14, rallyMorale: 20, deathMorale: -20, leaderFledMorale: -35, parriedMorale: -15,
  lockRange: 18, markerRange: 38,
};

export const LOOK = {};
export function applyLookOverrides(search = location.search) {
  const raw = new URLSearchParams(search).get('lk');
  if (!raw) return;
  for (const part of raw.split(',')) {
    const [key, value] = part.split(':');
    if (key.length > 2 && key.endsWith('c') && /^[0-9a-fA-F]{6}$/.test(value || '')) { LOOK[key] = '#' + value; continue; }   // 色は末尾 c のキー（例 sunc:ffb070）
    const n = Number(value);
    if (key && Number.isFinite(n)) LOOK[key] = n;
  }
}

// 発見距離(m)と合成用gainの共通表。gainは試聴前の初期値。
export const AUDIO_NOISE = Object.freeze(Object.fromEntries(Object.entries({
  run: { radius: 11, gain: 0.8 }, walk: { radius: 5, gain: 0.45 }, crouch: { radius: 1.5, gain: 0.18 },
  clash: { radius: 18, gain: 1 }, hit: { radius: 12, gain: 0.85 }, stealth: { radius: 3, gain: 0.3 },
}).map(([key, value]) => [key, Object.freeze(value)])));

// R14 placement only. Smaller tiles bound the circle's overhang without camera-dependent leaves.
export const GRASS = Object.freeze({
  box: [-135, 105, -135, 115], padding: 8, nearSize: 1, midSize: 2,
  nearRadius: 8, midRadius: 25, nearDensity: 100, midDensity: 20, cardLeaves: 14, midCardRate: 2.0, midMaxCards: 3,
  card: { size: 0.55, aspect: 0.25 },
  quality: { standard: { density: 1, distance: 1 }, light: { density: 0.4, distance: 0.6 } },
  minHeight: 0.15, maxHeight: 0.6, sink: 0.02, maxDensity: 1.24,
  clearingFraction: 0.10, clearingScale: 1 / 25,
  seed: 19391, midSeed: 29879, clumpSeed: 40961,
  patch: { largeScale: 0.18, smallScale: 0.7, largeWeight: 0.35, smallWeight: 0.15 },
  heightScale: 0.09, speciesScale: 0.055, tallThreshold: 0.30, fernThreshold: -0.10, susukiThreshold: -0.14,
  fernForest: 0.52, susukiForest: 0.3,
  species: [
    { h: [0.22, 0.40], w: [0.022, 0.032], lean: [0.12, 0.40] },
    { h: [0.38, 0.58], w: [0.025, 0.035], lean: [0.18, 0.50] },
    { h: [0.42, 0.6], w: [0.02, 0.03], lean: [0.08, 0.30] },
    { h: [0.28, 0.50], w: [0.030, 0.040], lean: [0.20, 0.55] },
    { h: [0.25, 0.48], w: [0.015, 0.023], lean: [0.04, 0.20] },
  ],
  susukiRate: 0.25, flowerRate: 0.8,
});

// Tree species are derived; legacy placement and collision keep using kind.
export const TREES = Object.freeze({
  palette: Object.freeze({
    cedar: Object.freeze(['#b1bca5']), pine: Object.freeze(['#7f9e91']),
    zelkova: Object.freeze(['#6a7f3a', '#a09a45', '#c2a040', '#96683a']),
    maple: Object.freeze(['#5d7a35', '#b88a30', '#c2652c', '#a2412c']),
    shrub: Object.freeze(['#4a6234', '#6f7a3c', '#85603a']),
  }),
  seeds: Object.freeze({ grove: 51001, detail: 51031, maple: 51061, stage: 51091, individual: 51131, sapling: 51169, shrub: 51203 }),
  fields: Object.freeze({ grove: 70, detail: 26, maple: 38, stage: 30, threshold: 0.755, mapleThreshold: 0.50 }),
  conversion: Object.freeze({ probability: 0.97, habitatWeight: 0.30, valleyRadius: 240 }),
  sapling: Object.freeze({ step: 3.2, probability: 0.15, maxCount: 1200, split: 18, distance: 45, lightDistance: 30 }),
  shrub: Object.freeze({ step: 2.2, probability: 0.20, maxCount: 4000, split: 13, distance: 32, lightDistance: 22 }),
  lod: Object.freeze({ standard: [48, 150], light: [32, 100], blend: { standard: 4, light: 3 } }),
  variants: Object.freeze({ cedar: 3, zelkova: 3, pine: 2, maple: 3 }),
  leafGain: 1.25,
  understoryLeafGain: 1.1,
  budget: Object.freeze({ cedar: [1500, 260, 40], zelkova: [1100, 260, 160], pine: [600, 140, 96], maple: [1100, 260, 160], sapling: [600, 160], shrub: [500, 140] }),
});
