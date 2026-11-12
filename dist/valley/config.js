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
  forest2: Object.freeze({
    margin: 12, // m: bounds の外側もこの幅までは従来の木を保護する。
    cell: 100, radius: Object.freeze([25, 35]), jitter: .24, edge: .14, // m・比率: 群れの間隔、半径、中心のずれ、縁のまだら。
    warp: 9, detail: 22, seed: 52301, // m・seed: 群れの輪郭を曲げる位置雑音。
    habitatGain: .22, slope: Object.freeze([38, 56]), ridgeHeight: Object.freeze([220, 280]), // 比率・度・m: 沢と肩を優先、急崖と高い頂を避ける。
    pineRate: .06, pineSlope: 32, // 比率・度: 杉候補の約8%を急斜面・尾根から選び、全体で約6%の松にする。
    height: Object.freeze([.7, 1.45]), width: Object.freeze([.8, 1.25]), // 倍率: 外側の杉の丈と独立した枝張り。
    oldRate: .045, oldHeight: Object.freeze([1.5, 1.9]), oldWidth: 1.45, oldCrown: .5, // 比率・倍率: 古杉の出現率、丈、幹の太さ、下半分の枝葉を減らす境。
    groupScale: 65, heightHabitat: .18, heightGroup: .15, // m・比率: 杉の群れの雑音、沢で丈を増す量。
    stretch: Object.freeze([.8, 1]), neighbourTone: .3, // 比率: 群れの短径／長径、隣の色段を混ぜる率。
    bank: Object.freeze([20, 90]), relief: Object.freeze([-3, 4]), // m: 沢からの距離、周囲より低い量を群れの適性へ変換する区間。
    habitatWeights: Object.freeze([.4, .35, .25]), heightBias: .8, // 比率: 沢・緩斜面・窪みの重み、背丈の補正の中心。
    pineWeights: Object.freeze([.30, .45, .25, .3]), pineNormal: .4, // 比率: 松の基礎・急斜面・尾根・高地の重みと正規化。
    shadeStep: 1, shadeGradient: 4, // m・m: 夕日に背を向ける斜面を測る間隔と青みが最大になる勾配差。
    adaptive: Object.freeze([1, .85, .7, .58]), farKeep: Object.freeze([1, .85, .7, .58]), lodScale: Object.freeze([1, .94, .88, .82]), // 自動解像度の段階・遠景を残す比率・LOD距離の倍率。
    leafBrightness: .10, leafHue: .06, cedarBrightness: .09, groupBrightness: .07, shadeBlue: .06, // ±比率: 個体の色、杉の群れ、北東の夕日に背を向ける斜面の青み。
    // 既存 maple/zelkova の色から作る5段（深紅・朱・橙・黄・黄緑）。値は元パレットの位置／混色の割合。
    tones: Object.freeze([3, 2.65, 2, 2, 0]), toneMix: Object.freeze([.18, 0, 0, 0, .24]),
    debug: Object.freeze(['#22b34a', '#e1c638', '#a342cc', '#ca352d', '#287cdb']), // 杉・欅・松・楓・古杉。
  }),
  palette: Object.freeze({
    cedar: Object.freeze(['#b1bca5']), pine: Object.freeze(['#7f9e91']),
    zelkova: Object.freeze(['#6a7f3a', '#a09a45', '#c2a040', '#96683a']),
    maple: Object.freeze(['#5d7a35', '#b88a30', '#c2652c', '#a2412c']),
    shrub: Object.freeze(['#4a6234', '#6f7a3c', '#85603a']),
  }),
  seeds: Object.freeze({ grove: 51001, detail: 51031, maple: 51061, stage: 51091, individual: 51131, sapling: 51169, shrub: 51203 }),
  fields: Object.freeze({ grove: 70, detail: 26, maple: 38, stage: 30, threshold: 0.755, mapleThreshold: 0.50 }),
  conversion: Object.freeze({ probability: 0.97, habitatWeight: 0.30, valleyRadius: 240 }),
  // crown: widest drawn shell radius per metre of height, at the largest instance scale and tilt.
  sapling: Object.freeze({ step: 3.2, probability: 0.15, maxCount: 1200, split: 18, distance: 45, lightDistance: 30, crown: 0.5 }),
  shrub: Object.freeze({ step: 2.2, probability: 0.20, maxCount: 4000, split: 13, distance: 32, lightDistance: 22, crown: 1.1 }),
  lod: Object.freeze({ standard: [48, 150], light: [32, 100], blend: { standard: 4, light: 3 } }),
  variants: Object.freeze({ cedar: 5, zelkova: 3, pine: 2, maple: 3 }),
  leafGain: 1.25,
  understoryLeafGain: 1.1,
  // R17.11（2026-10-30）：近景の杉は枝と房で作るので、L0の上限を上げた。第2周（10-31）：遠景を絵の板にして浮いた分で、中景の杉を近景の枝ごとの房に（L1 260→600）。
  budget: Object.freeze({ cedar: [2300, 600, 40], zelkova: [2600, 560, 160], pine: [600, 140, 96], maple: [2600, 560, 160], sapling: [1400, 200], shrub: [1200, 180] }),
  // 杉の段の傾き（m/m、段ごと・個体ごとに向きが変わる）。近景は影とのずれを小さく、中遠景で段の水平線を崩す。
  tierTilt: Object.freeze([0.05, 0.14, 0.16]),
  // 広葉の葉1枚ごとの向き（法線の強さ）と色の揺らぎ（±割合）。樹皮の凹凸と根元の暗さ（地面に接する所の明るさ）。
  // 第2周：group＝葉の群れ（約0.4m）で樹冠の房の縁を欠く強さ、gap＝房に開ける隙間の閾値、inner＝隙間から見える房の内側の明るさ。
  // 若木・灌木は葉の画像が1.7倍大きく、同じ強さでは2〜3mの寄りで虫食いに見えた（smallGroup・smallGap）。
  // 第3周：隙間の奥が黒い穴に見えた（裏面の法線が内向きに反転し、明るさ.5）。裏面も外向きの法線で照らし .72、隙間は .14→.09。
  leafDetail: Object.freeze({ normal: 0.85, hue: 0.09, rim: 0.7, group: 0.7, gap: 0.09, inner: 0.72, smallGroup: 0.45, smallGap: 0.04 }),
  // カメラの近くの葉と枝を、房・枝ごとに根元へ縮める距離（m）：カメラから「根元→頂点」の線分まで a 以内で消え、b 以遠は元の大きさ。
  // 第3周：画素ごとに薄める方式（第2周）は、カメラの直前で網点の膜に見えた（tree-lod.js nearShrink）。
  nearFade: Object.freeze([0.35, 1.7]),
  // 逆光の透け：針葉樹の強さ（1周目は .2）と、葉の縁（画像の不透明度が低い所）を足す割合。
  // 第3周で、透けを外側の葉だけに・上限 .35→.5・針葉樹 .5→.7 とし、陰の側を彩度45%減の青寄りにした。盲検で色がくすみ、
  // 杉が青灰色に見えて第2周に負けたので、2026-11-03 に第2周の値（ここと tree-materials.js の陰の式）へ戻した。
  backlight: Object.freeze({ conifer: 0.5, edge: 2.0, cap: 0.35 }),
  // 第3周：葉が受ける日の影の残る明るさ（0＝影で真っ暗）。房どうしの影が丸い黒いしみに見えた（Q04・Q09）。
  leafShadow: 0.4,
  // 第2周：凹凸を強く（.75→1.0）、根元の暗さを深く（.62→.52）、溝の苔（根元1.3mまで）。
  bark: Object.freeze({ relief: 1.0, contact: 0.52, crownShade: 0.6, moss: 0.75 }),
  // 夕景の空気（第2周）：葉の彩度を距離で落とす割合（near〜far m で0→amount）。明るさは変えない（山肌の陰の中で樹冠が白く浮かない）。
  leafAir: Object.freeze({ amount: 0.3, near: 25, far: 320 }),
  // 遠景の絵の板（8.1a第2周）：切り抜きの閾値と、遠く（ミップが粗い）ほど葉の不透明を足す割合（細って透けないように）。
  // 第3周：帯（150m）の先で、板を距離とともに広げ（widenRange の200〜460mで0→widen、第3周の計測で170mからは負荷が増えた）、木ごとに少し傾ける（±lean m/m）。斜面の地面が見え、尾根が櫛に見えた（Q01・Q12）。
  impostor: Object.freeze({ alphaTest: 0.4, mipBoost: 0.5, widen: 0.35, widenRange: Object.freeze([200, 460]), lean: 0.06 }),
});
