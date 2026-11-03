// world-data.js — 隠れ谷の縦切りの世界を決める純データ（data層）。描画・当たり・配置・敵の初期配置が同じ値を読む。
// 座標: 原点は水穂の里の井戸。単位m。X東、Z南（北は -Z）。建物の rotY は Three.js の rotation.y（前面が +Z のモデルを回す）。
// 企画図（Drive 02_マップ・コンセプト/kakuredani_map）を約0.5倍に圧縮して縦切り向けに置き直した。design-world.md 参照。

export const WORLD = {
  seed: 1333,
  // 歩ける範囲（この外は崖・川・森で入れない）。見える範囲はこれより広い。
  bounds: { minX: -135, maxX: 102, minZ: -135, maxZ: 112 },

  // 谷の骨格。valley は山が立ち上がる楕円（rim=1）、floor は谷底の傾き、hill は西の斜面（廃寺の基壇が乗る）。
  valley: { cx: 22, cz: -8, rx: 215, rz: 200 },
  floor: { y0: 3.4, gx: -0.0245, gz: -0.011 },
  hill: { amp: 17, from: 8, to: 132, dirX: -0.748, dirZ: -0.669 },

  // 川（清瀬川）。中心線は北から南へ蛇行する。幅・深さは点ごと。水面は川底の少し上で、南へ緩く下る。
  river: {
    points: [[112, -420], [130, -280], [112, -170], [138, -95], [128, -42], [120, 8], [146, 72], [132, 150], [154, 250], [138, 420]],
    halfWidth: 10, bankWidth: 12, bedDepth: 3.2, surfaceBase: -2.6, surfaceSlope: -0.0085,
  },

  // 平場（廃寺の基壇・里・脱穀場など）。r0 までは目標の高さで平ら、r1 までに自然な地形へ戻る。
  flats: [
    { id: 'temple_terrace', x: -98, z: -86, hx: 24, hz: 18, rot: 0.70, y: 21.5, fall: 12 },
    { id: 'village', x: 0, z: 4, hx: 46, hz: 34, rot: 0.0, y: 3.0, fall: 30, tilt: [0.004, 0.012] },
    { id: 'viewpoint', x: -50, z: -34, hx: 6, hz: 5, rot: 0.3, y: 10.8, fall: 7 },
  ],

  // 棚田：段ごとに少しずつ下がる（南へ）。縁は石積み。
  terraces: { x0: -68, x1: 50, z0: 40, z1: 104, step: 10.7, drop: 0.55, riser: 1.1 },

  // 峰（対岸の烏峰・山砦の丘）
  peaks: [{ id: 'karasumine', x: 262, z: -140, r: 108, h: 96, flatR: 24 }],

  // 道。幅は踏み固めの半幅。tread=踏み面の高さを地形へ合わせる。
  roads: {
    forest: { halfWidth: 1.7, points: [[-74, -66], [-62, -60], [-48, -55], [-36, -48], [-38, -38], [-50, -34], [-60, -28], [-56, -20], [-44, -14], [-32, -8], [-22, -3], [-10, 1]] },
    lane: { halfWidth: 2.0, points: [[-22, -3], [-10, 1], [0, 3], [14, 4], [34, 6], [60, 6], [84, 0], [98, -10], [112, -26]] },
    north: { halfWidth: 1.0, points: [[-40, -18], [-30, -30], [-14, -38], [2, -42], [5, -30], [3, -18]] },
    south: { halfWidth: 0.9, points: [[-52, 30], [-40, 44], [-30, 52], [-18, 46], [-14, 36], [-10, 24]] },
    temple: { halfWidth: 2.2, points: [[-86, -72], [-76, -68], [-74, -66]] },
  },

  // 建物。kind は buildings.js が読む。footprint は当たり（回転した長方形）。
  buildings: [
    { id: 'temple_hall', kind: 'temple', x: -110, z: -100, rotY: 0.785, footprint: { w: 13, d: 11 } },
    { id: 'house1', kind: 'farmhouse', variant: 0, x: -18, z: -12, rotY: 0.30, footprint: { w: 9, d: 7 } },
    { id: 'house2', kind: 'farmhouse', variant: 1, x: 12, z: -18, rotY: -0.22, footprint: { w: 9, d: 7 } },
    { id: 'house3', kind: 'farmhouse', variant: 2, x: 34, z: -8, rotY: 0.10, footprint: { w: 9, d: 7 } },
    { id: 'house4', kind: 'farmhouse', variant: 0, x: 16, z: 16, rotY: 3.40, footprint: { w: 9, d: 7 } },
    { id: 'house5', kind: 'farmhouse', variant: 1, x: -14, z: 18, rotY: 2.95, footprint: { w: 9, d: 7 } },
    { id: 'granary', kind: 'granary', x: -34, z: 10, rotY: 1.57, footprint: { w: 7, d: 6 } },
    // 納屋（里の変化）。家のあいだを埋める。width は見た目の幅（m）。
    { id: 'naya1', kind: 'naya', x: -2, z: -26, rotY: 0.1, width: 6.4, footprint: { w: 6.4, d: 5.8 } },
    { id: 'naya2', kind: 'naya', x: 36, z: 16, rotY: -0.3, width: 6.4, footprint: { w: 6.4, d: 5.8 } },
    { id: 'naya3', kind: 'naya', x: 7, z: 28, rotY: 0.2, width: 6.4, footprint: { w: 6.4, d: 5.8 } },
  ],

  // 見通しの帯。木を置かない（歩ける東の端から、川・橋・関所が見えるように）。from→to の線分から halfWidth の内側は木が無い。
  sightlines: [
    { id: 'east_bridge', from: [90, -2], to: [150, -46], halfWidth: 10 },
  ],

  // 畑（家のそばの野菜畑）。hx,hz は半幅。rot は世界の y 回り。地面は耕した土（mud）になり、畝に沿って菜が植わる（scatter.js scatterCrops）。
  plots: [
    { id: 'plot_h5', x: -4, z: 25.5, hx: 5, hz: 3, rot: 0.15 },
    { id: 'plot_h4', x: 25, z: 25, hx: 6, hz: 3.4, rot: -0.1 },
    { id: 'plot_h2', x: 21, z: -29, hx: 5.5, hz: 3.2, rot: 0.2 },
    { id: 'plot_h1', x: -27, z: -23, hx: 5, hz: 3.2, rot: 0.3 },
    { id: 'plot_h3', x: 43, z: 3, hx: 5, hz: 3.4, rot: 0.05 },
  ],

  // 置き物（当たりは小さい）。kind は props.js が読む（井戸・荷車・灯籠・稲架・地蔵・焚き火は Meshy のモデル）。scale はモデルの大きさ合わせ。
  props: [
    { id: 'well', kind: 'well', x: 0, z: 0, r: 1.1, scale: 1.0 },
    { id: 'cart', kind: 'cart', x: -26, z: 4, rotY: 0.5, r: 1.4, scale: 1.3 },
    { id: 'lantern_temple', kind: 'stone_lantern', x: -84, z: -76, r: 0.5, scale: 0.8 },
    { id: 'lantern_steps', kind: 'stone_lantern', x: -72.5, z: -69.5, r: 0.5, scale: 0.8 },
    { id: 'bonfire', kind: 'bonfire', x: -88, z: -80, r: 0.8, scale: 1.0 },
    { id: 'drying1', kind: 'drying_rack', x: 24.5, z: 8.6, rotY: 0.4, r: 1.3, scale: 1.25 },
    { id: 'drying2', kind: 'drying_rack', x: -6, z: 30, rotY: -0.2, r: 1.3, scale: 1.25 },
    // 藁塚（わらづか）。納屋と畑のそば。
    { id: 'wara1', kind: 'haystack', x: 3, z: -23, r: 0.6, scale: 1.4 }, { id: 'wara2', kind: 'haystack', x: -8, z: -22, r: 0.6, scale: 1.3 },
    { id: 'wara3', kind: 'haystack', x: 31.5, z: 21, r: 0.6, scale: 1.4 }, { id: 'wara4', kind: 'haystack', x: 41, z: 10, r: 0.6, scale: 1.3 },
    { id: 'wara5', kind: 'haystack', x: 12, z: 31, r: 0.6, scale: 1.4 }, { id: 'wara6', kind: 'haystack', x: 30, z: -26, r: 0.6, scale: 1.3 },
    // 路傍の祠（里の入口と東の端）。
    // 入口の祠は、道の縁から1mほど外へ出した（S7-A。前に注連縄の杭を立てる場所を、道の外に取るため）。
    { id: 'hokora1', kind: 'shrine', x: -27.05, z: -8.4, rotY: 0.9, r: 0.55, scale: 0.55 }, { id: 'hokora2', kind: 'shrine', x: 53, z: 12.5, rotY: -0.8, r: 0.55, scale: 0.55 },
    // 案山子（畑のそば）。
    { id: 'kakashi1', kind: 'scarecrow', x: 0.6, z: 30.2, rotY: 0.6, r: 0.45, scale: 0.92 }, { id: 'kakashi2', kind: 'scarecrow', x: 32.2, z: 25.4, rotY: -0.4, r: 0.45, scale: 0.92 },
    { id: 'kakashi3', kind: 'scarecrow', x: 48.9, z: 4.2, rotY: 2.4, r: 0.45, scale: 0.92 },
    { id: 'jizo_view', kind: 'jizo', x: -47.5, z: -31.5, r: 0.35, scale: 0.47 },
    { id: 'jizo_road', kind: 'jizo', x: -66.5, z: -61, r: 0.35, scale: 0.47 },
    { id: 'viewpoint_rock', kind: 'boulder_big', x: -52, z: -37, r: 2.1, vr: 3.5 },
    { id: 'ambush_rock', kind: 'boulder_big', x: -66, z: -26, r: 1.6, vr: 2.5 },
  ],

  // 飾り（当たりは props.js の propColliders が作る）。柵は線の両端を結ぶ。幟は敵の陣の目印。
  dress: [
    { kind: 'banner', x: -29.5, z: 0.5, rotY: 0.4 }, { kind: 'banner', x: -29.5, z: 8.5, rotY: 0.5, color: '#1b2230' }, { kind: 'banner', x: -22.5, z: 7.5, rotY: 0.3 },
    { kind: 'banner', x: -33.0, z: 4.0, rotY: 0.6, color: '#1b2230' }, { kind: 'banner', x: -26.4, z: 12.4, rotY: 0.2 },          // S7-A：野営の外回りに2本（遠くから陣と読めるように）
    // 家1の柵は5区画のうち真ん中の2区画を life の表へ移した（倒れた1区画と、荒れ方3で傾く1区画。S7-A 入4）。
    { kind: 'fence_line', from: [-24, -19.5], to: [-19.2, -19.3] }, { kind: 'fence_line', from: [-14.4, -19.1], to: [-12, -19] }, { kind: 'fence_line', from: [-23, 24], to: [-23, 13] },
    { kind: 'fence_line', from: [26, 10], to: [26, 22] }, { kind: 'fence_line', from: [11, -26], to: [22, -27] }, { kind: 'fence_line', from: [-40, 17.5], to: [-30, 17.5] },
    { kind: 'firewood', x: -12.5, z: -9.5, rotY: 0.3 }, { kind: 'firewood', x: 18, z: -14.8, rotY: -0.2 }, { kind: 'firewood', x: 20.5, z: 12.5, rotY: 3.4 },
    { kind: 'firewood', x: -9.5, z: 15, rotY: 2.9 }, { kind: 'firewood', x: -30, z: 13, rotY: 1.57 },
    { kind: 'firewood', x: -91.5, z: -83, rotY: 0.6, scale: 1.3 }, { kind: 'firewood', x: -85.5, z: -84, rotY: -0.4, scale: 1.0 },
  ],

  // 暮らしの小物（S7-A：見晴らし岩 見1・見3〜見6、里の入口 入1〜入8。番号は design-valley-life-places.md）。描くのは life-view.js、型は life-kit.js。
  // items：kind は life-kit の型（'stone' は大岩の模型、'fence' は柵の模型、'hit' は当たりだけ）。tilt＝[x, z] の傾き、lift＝地面からの高さ（m）。
  //   show の無い物は、どの場面でも出す。show＝{ item, state?, min?, max? } は life-rules の物の状態と数で出し入れする。
  //   hit（当たり）は膝より高い物だけ、しかも show の無い物にだけ付ける（消えた物の当たりを残さない。tests/valley-life-places.test.mjs）。
  life: {
    items: [
      // 見1 立つ場所の平らな岩（斜面に半分埋める）。見6 板碑（北の道の入口の目印。飯田の板碑に倣う細長い薄い板石）
      { id: 'stand_rock', kind: 'stone', x: -46.4, z: -31.0, rotY: 0.6, scale: [0.8, 0.16, 0.65], lift: -0.22, align: 1, tint: '#d2d2c8' },   // 斜面に沿う薄い岩棚（align＝斜面の向き）。上面を足もとの高さにそろえる
      { id: 'itabi', kind: 'itabi', x: -41.2, z: -20.3, rotY: 0.48, tilt: [0.04, -0.03], hit: { r: 0.22, height: 1.0 } },
      // 見3 北の道：畑の縁の杭（道の東側）
      { id: 'north_stake_1', kind: 'stake', x: -36.9, z: -18.18, rotY: 0.2, tilt: [0.05, -0.04], hit: { r: 0.08, height: 0.9 } },
      { id: 'north_stake_2', kind: 'stake', x: -35.5, z: -19.88, rotY: 1.1, tilt: [-0.03, 0.06], scale: [1, 0.9, 1], hit: { r: 0.08, height: 0.9 } },
      { id: 'north_stake_3', kind: 'stake', x: -34.09, z: -21.57, rotY: 0.5, tilt: [0.07, 0.02], scale: [1, 1.08, 1], hit: { r: 0.08, height: 0.95 } },
      { id: 'north_stake_4', kind: 'stake', x: -32.68, z: -23.27, rotY: 2.0, tilt: [-0.06, -0.05], hit: { r: 0.08, height: 0.9 } },
      { id: 'north_stake_5', kind: 'stake', x: -31.89, z: -25.47, rotY: 0.9, tilt: [0.02, 0.08], scale: [1, 0.85, 1], hit: { r: 0.08, height: 0.8 } },
      // 入1 俵の列：蔵の戸口から荷車へ（2は破れて米がこぼれる）。荒れるほど積み増す（5は3・4の上、6は1の横。当たりは組ごとに1つ）
      { id: 'bale_1', kind: 'bale', x: -30.62, z: 9.5, rotY: 0.35, hit: { x: -30.54, z: 9.72, r: 0.55, height: 0.45 } },
      { id: 'bale_2', kind: 'bale_torn', x: -30.1, z: 7.7, rotY: 0.95, hit: { r: 0.4, height: 0.4 } },
      { id: 'rice_pile', kind: 'rice', x: -29.62, z: 7.22, rotY: 0.4 },
      { id: 'bale_3', kind: 'bale', x: -28.25, z: 5.79, rotY: 0.952, hit: { x: -28.45, z: 5.65, r: 0.55, height: 0.85 } },
      { id: 'bale_4', kind: 'bale', x: -28.65, z: 5.51, rotY: 0.952 },
      { id: 'bale_5', kind: 'bale', x: -28.45, z: 5.65, rotY: 0.98, lift: 0.37, show: { item: 'bale_row', min: 5 } },
      { id: 'bale_6', kind: 'bale', x: -30.46, z: 9.94, rotY: 0.35, show: { item: 'bale_row', min: 6 } },
      { id: 'bale_hand', kind: 'bale', x: -24.75, z: 2.02, rotY: 0.2, hit: { r: 0.32, height: 0.45 } },        // 兵1の「拾う」動作の手もと
      { id: 'door_board', kind: 'door', x: -30.9, z: 12.0, rotY: 1.5708, tilt: [-0.31, 0] },                     // 外した戸板（蔵の壁の当たりの内側）
      // 入2 空の鍋の炊き場（炎は出さない。燠と灰色の煙1本は襲撃中だけ）
      { id: 'hearth', kind: 'hearth', x: -25.6, z: 8.4, rotY: 0.3 },
      { id: 'embers', kind: 'embers', x: -25.6, z: 8.4, rotY: 1.1, show: { item: 'camp_kitchen', state: ['embers'] } },
      // 空の鍋は火から下ろして横に倒し、底まで空なのを口から見せる（煙は炉の燠から）。柄杓は地面に落ちている
      { id: 'pot', kind: 'pot', x: -24.95, z: 8.95, rotY: 0.39, tilt: [1.25, 0], lift: 0.155 },
      { id: 'ladle', kind: 'ladle', x: -24.55, z: 9.45, rotY: 2.4, lift: 0.0 },
      { id: 'mat_1', kind: 'mat', x: -27.0, z: 8.6, rotY: 0.15 },
      { id: 'mat_2', kind: 'mat', x: -25.4, z: 7.05, rotY: 1.6 },
      // 入3 祠の注連縄：杭2本（動かない）の間で、襲撃中は切れて垂れ、救ったあとは張り直す。縄の中心は2本の杭の中点
      { id: 'shrine_post_l', kind: 'post', x: -26.6, z: -7.5, rotY: -0.46, hit: { r: 0.08, height: 1.15 } },
      { id: 'shrine_post_r', kind: 'post', x: -28.04, z: -8.22, rotY: -0.46, hit: { r: 0.08, height: 1.15 } },
      { id: 'rope_cut', kind: 'rope_cut', x: -27.32, z: -7.86, rotY: -0.4636, show: { item: 'boundary_rope', state: ['cut'] } },
      { id: 'rope_tied', kind: 'rope_tied', x: -27.32, z: -7.86, rotY: -0.4636, show: { item: 'boundary_rope', state: ['retied'] } },
      // 入4 荒らされた跡：家1の柵の1区画が倒れ、荒れ方3でもう1区画が傾く（当たりは傾いても同じ箱）。畑に曲物の桶・倒れた籠・菜
      { id: 'fence_down', kind: 'fence', x: -18.0, z: -19.25, rotY: -0.0417, scale: [0.913, 0.9, 0.913], tilt: [-1.5, 0], lift: 0.14 },
      { id: 'fence_b_stand', kind: 'fence', x: -15.6, z: -19.15, rotY: -0.0417, scale: [0.913, 0.9, 0.913], lift: -0.05, show: { item: 'fallen_fence', max: 1 } },
      { id: 'fence_b_lean', kind: 'fence', x: -15.6, z: -19.15, rotY: -0.0417, scale: [0.913, 0.9, 0.913], tilt: [-0.62, 0.05], lift: -0.05, show: { item: 'fallen_fence', min: 2 } },
      { id: 'fence_b_hit', kind: 'hit', x: -15.6, z: -19.15, rotY: -0.0417, hit: { w: 2.4, d: 0.3, height: 1.2 } },
      { id: 'bucket_rolled', kind: 'bucket', x: -23.3, z: -20.9, rotY: 0.7, tilt: [1.5708, 0], lift: 0.17 },
      { id: 'basket_tipped', kind: 'basket', x: -25.4, z: -21.5, rotY: 2.2, tilt: [1.25, 0], lift: 0.16 },
      { id: 'veg_1', kind: 'veg', x: -24.7, z: -21.1, rotY: 0.4 }, { id: 'veg_2', kind: 'veg', x: -25.9, z: -22.0, rotY: 2.1 }, { id: 'veg_3', kind: 'veg', x: -26.4, z: -21.3, rotY: 4.0 },
      { id: 'veg_4', kind: 'veg', x: -27.6, z: -22.5, rotY: 1.0, show: { item: 'raid_marks', min: 2 } }, { id: 'veg_5', kind: 'veg', x: -24.0, z: -22.3, rotY: 5.0, show: { item: 'raid_marks', min: 2 } },
      { id: 'veg_6', kind: 'veg', x: -28.8, z: -21.9, rotY: 3.0, show: { item: 'raid_marks', min: 3 } }, { id: 'veg_7', kind: 'veg', x: -26.2, z: -23.9, rotY: 0.6, show: { item: 'raid_marks', min: 3 } },
      // 入5 逃げた人の落とし物：柴の束（背負子の枠は出さない）と足半の片方。入6 弥十郎の弓と矢筒を荷車の南の側へ立てかける
      { id: 'brush_bundle', kind: 'brush', x: -26.0, z: -9.35, rotY: 2.25 },
      { id: 'sandal', kind: 'sandal', x: -25.35, z: -8.55, rotY: 0.7 },
      { id: 'captive_bow', kind: 'bow', x: -25.17, z: 4.79, rotY: 0.5, tilt: [-0.3, 0.05], lift: 0.57, show: { item: 'captive_bow', state: ['on_cart'] } },
      { id: 'captive_quiver', kind: 'quiver', x: -24.86, z: 4.52, rotY: 0.5, tilt: [-0.25, 0], lift: 0.27, show: { item: 'captive_bow', state: ['on_cart'] } },
    ],
    // 地面の跡（入7 轍・踏み荒らした土・足跡・こぼれた米、入4 畑の踏み跡）。path は道なりの帯（width m。なめらかな曲線でたどる）、x/z/w/l は四角。
    marks: [
      { mark: 'rut', path: [[-31.2, 10.4], [-30.0, 8.3], [-28.6, 6.3], [-27.3, 4.9]], width: 1.8 },
      { mark: 'rut', path: [[-24.7, 3.3], [-21.0, 1.6], [-16.5, 0.7], [-12, 0.9], [-7, 1.9]], width: 1.8 },
      { mark: 'trample', x: -28.0, z: 7.2, w: 7.5, l: 6.0, rotY: 0.45 }, { mark: 'trample', x: -24.6, z: 4.3, w: 4.5, l: 3.6, rotY: -0.3 },
      { mark: 'steps', path: [[-30.4, 9.0], [-29.2, 7.0], [-27.6, 5.4], [-25.0, 3.4], [-24.2, 2.4]], width: 0.9 },
      { mark: 'steps', path: [[-27.4, 9.6], [-26.0, 8.9], [-23.4, 8.6], [-20.6, 9.6]], width: 0.8 },
      { mark: 'rice', path: [[-29.9, 7.5], [-29.2, 6.6], [-28.6, 5.95]], width: 0.6 },
      { mark: 'ash', x: -25.6, z: 8.4, w: 1.7, l: 1.7, rotY: 0 },
      { mark: 'steps', path: [[-22.4, -20.2], [-26, -22.5], [-30.5, -24.4]], width: 0.8, show: { item: 'raid_marks', min: 2 } },
      { mark: 'crush', x: -25.6, z: -21.9, w: 2.6, l: 1.8, rotY: 0.3, show: { item: 'raid_marks', min: 2 } },
      { mark: 'steps', path: [[-23.2, -24.4], [-27.4, -21.2], [-31.4, -20.8]], width: 0.8, show: { item: 'raid_marks', min: 3 } },
      { mark: 'trample', x: -26.8, z: -22.6, w: 3.6, l: 2.4, rotY: 0.3, show: { item: 'raid_marks', min: 3 } },
    ],
    // 入8 入口の道の両脇20mの小石と苔の石（大岩の模型を小さく。[x, z, 大きさ, 向き]、3つに1つは苔の色）と背の低い草むら。見3 南の道のススキの列。
    // 道の踏み面の外（中心から半幅＋0.3m以上）に、乱数（種811・823・829）で並べてから祠の周りを除いた。小石は大きさ0.1未満を除いた（遠目に穴や汚れに見えた。盲検の第1周）。
    stones: [[-39.81, -14.57, 0.2, 2.41], [-37.84, -14.53, 0.16, 1.68], [-40.07, -9.03, 0.17, 3.42], [-36.82, -13.95, 0.19, 0.08], [-38.73, -8.59, 0.19, 3.6], [-35.39, -12.99, 0.17, 3.55], [-35.21, -11.99, 0.1, 0.47], [-33.73, -12.29, 0.16, 5.66], [-32.26, -11.48, 0.11, 2.07],
      [-34.73, -5.93, 0.1, 4.65], [-31.54, -10.11, 0.15, 6.01], [-32.96, -5.3, 0.11, 6.11], [-31.99, -5.67, 0.14, 0.14], [-29.4, -9.98, 0.12, 3.84], [-30.98, -4.92, 0.14, 5.27], [-30.43, -4.65, 0.19, 5.64], [-29.69, -3.13, 0.13, 6.16], [-28.12, -3.67, 0.17, 3.76],
      [-25.71, -7.97, 0.14, 3.24], [-26.82, -1.56, 0.16, 5.24], [-23.67, -6.22, 0.17, 5.44]],
    tufts: [[-42.42, -9.19, 0.77, 1.1], [-39.23, -14.76, 0.89, 3.29], [-38.69, -14.91, 0.78, 1.53], [-41.69, -8.35, 1.08, 2.07], [-40.52, -9.61, 0.89, 4.09], [-37.87, -14.46, 0.73, 0.07], [-40.1, -8.67, 0.95, 0.29], [-37.38, -13.16, 0.93, 3.92], [-39.21, -9.03, 0.99, 4.27], [-36.52, -13.23, 0.97, 2.86], [-36.43, -12.6, 0.99, 1.95], [-35.38, -13.61, 0.77, 4.2],
      [-38.03, -7.99, 1.02, 4.54], [-34.54, -13.79, 1.19, 5.67], [-34.97, -11.88, 0.83, 0.23], [-36.59, -7.99, 0.91, 1.14], [-36.81, -6.71, 0.96, 1.65], [-33.33, -12.85, 1.18, 1.75], [-33.04, -12.27, 0.75, 1.86], [-35.55, -6.79, 1, 6.17], [-32.41, -11.86, 1.2, 6.05], [-34.89, -6.05, 1.02, 2.16], [-32.2, -10.8, 0.83, 3.49], [-34.39, -5.26, 1.07, 3.85],
      [-33.76, -5.67, 0.99, 5.88], [-31.01, -10.56, 1.02, 3.78], [-30.32, -10.87, 0.9, 2.38], [-32.67, -5.4, 1.17, 4.41], [-29.43, -11.2, 1.01, 2.27], [-32.8, -3.72, 1.08, 0.63], [-29.47, -9.51, 1.05, 4.7], [-28.25, -10.6, 1.06, 3.17], [-31.29, -3.79, 0.79, 4.08], [-30.56, -4.87, 0.72, 6.01], [-27.69, -9.8, 0.73, 1.01], [-26.97, -9.78, 1.06, 1.56],
      [-29.69, -4, 0.77, 1.31], [-29.26, -3.67, 1.09, 1.8], [-29.54, -2.2, 0.86, 0.42], [-28.71, -3.28, 1.13, 3.99], [-28.87, -2.36, 1.15, 3.9], [-24.77, -9, 0.87, 4.55], [-28.04, -1.79, 1.11, 1.99], [-27.55, -2.43, 1.05, 1.87], [-23.99, -8.12, 0.79, 1.31], [-24.28, -7.06, 0.91, 2.79], [-23.7, -7.4, 1.07, 6.08], [-25.97, -1.96, 0.74, 0.53]],
    susuki: [[-29.52, 49.91, 0.97, 5.62], [-26.57, 53.28, 0.98, 4.86], [-27.61, 48.36, 0.92, 1.53], [-25.18, 46.97, 0.96, 2.65], [-21.42, 50.3, 0.94, 4.32], [-19.56, 49.84, 1.18, 5.88], [-20.39, 44.32, 0.92, 4.03], [-15.99, 46.09, 1.11, 4.16], [-15.07, 45.53, 1.01, 0.14], [-14, 42.96, 1.04, 5.47],
      [-17.74, 40.01, 1.12, 3.72], [-17.51, 38.1, 0.9, 1.39], [-12.77, 37.81, 1.18, 3.61], [-16.49, 35.21, 0.91, 4.19], [-11.43, 34.8, 0.98, 1.82], [-13.93, 30.96, 0.94, 6.07], [-13.7, 29.65, 0.95, 0.92], [-9.04, 29.84, 1.09, 1.34], [-8.59, 28.17, 0.86, 3.28], [-7.71, 25.51, 1.11, 3.08]],
    // 踏み固めた土（野営の周り）。地面を土にし、草を生やさない（terrain-height.js・grass-field.js）。
    trodden: [{ x: -28.2, z: 7.0, r: 4.4 }, { x: -24.8, z: 4.0, r: 2.8 }],
    // 見5 烏の群れ：南の棚田の上を回り、結末で烏峰（peak）の方へ去る。y は地面からの高さ（m）。
    crows: { x: -8, z: 62, y: 20, r: 15, count: 24, peak: [262, -140] },
  },

  // 遠景の建物（入れない）。scale は Meshy のモデル（約1.9m）を実寸へ伸ばす倍率。橋は川を横切り、関所は橋の東、砦は峰の頂、馬防柵は谷の東の口の道をふさぐ。
  distant: [
    { id: 'bridge', kind: 'bridge', x: 128.4, z: -44.5, rotY: -0.17, scale: [3.7, 2.2, 2.0] },
    { id: 'gatehouse', kind: 'gatehouse', x: 158, z: -46, rotY: -1.45, scale: 6.4 },
    { id: 'fort', kind: 'fort', x: 262, z: -140, rotY: 3.6, scale: 26, lift: -0.6 },
    { id: 'barricade', kind: 'barricade', x: 99, z: -10, rotY: -0.72, scale: 4.4, collider: { w: 8.2, d: 1.1, height: 2.4 } },
  ],

  // 場面のきっかけの範囲（円）と到達点。quest.js の zone / place 名と一致させる。
  zones: {
    temple_yard: { x: -84, z: -72, r: 9 },
    viewpoint: { x: -50, z: -36, r: 7 },
    village_front: { x: -34, z: -4, r: 9 },
    village_north: { x: 3, z: -28, r: 10 },
    village_south: { x: -12, z: 36, r: 10 },
    // 未測定の設計値 (0,4), r=3m。倉(-34,10)の東、家1/5の間を抜けた lane 沿い。
    // 井戸(0,0)の南で建物・倉の間の広場へ着ける。三入口からの到達をNodeで検査。敵位置は使わない。
    village_center: { x: 0, z: 4, r: 3 },
    ambush_trigger: { x: -56, z: -22, r: 12 },
    temple_steps: { x: -74, z: -66, r: 6 },
  },

  // 区切りで戻る位置（やり直し・つづきから）。yaw は combat と同じ向き。
  checkpoints: {
    cp_leave_temple: { x: -80.5, z: -68.5, yaw: -2.2 },
    cp_viewpoint: { x: -49, z: -33, yaw: -2.3 },
    cp_archer_joined: { x: -14, z: 3, yaw: 1.2 },
    cp_result: { x: -76, z: -67, yaw: 2.4 },
  },
  // 敵が総崩れのとき逃げる先（谷の東の端。たどり着けないなら投降する）
  exit: { x: 92, z: -6 },

  // 開始点と、場面ごとの人・敵の初期配置（yaw は combat と同じ向き: 前方 (-sin,-cos)）。
  start: { x: -100.5, z: -89, yaw: -2.2 },
  spawns: {
    road_scout: [{ id: 'road_scout', kind: 'soldier', x: -48, z: -46, yaw: 2.2, patrol: [[-48, -46], [-42, -44], [-38, -42], [-44, -48]] }],
    village_enemies: [
      { id: 'village_soldier_1', kind: 'soldier', x: -24, z: 2, yaw: 1.6, idleClip: 'Male_Bend_Over_Pick_Up' },
      { id: 'village_soldier_2', kind: 'soldier', x: -20, z: 10, yaw: 2.4, idleClip: 'Stand_and_Chat' },
      { id: 'village_soldier_3', kind: 'soldier', x: 2, z: 8, yaw: 3.1, idleClip: 'Long_Breathe_and_Look_Around' },
      { id: 'village_archer', kind: 'archer', x: -16, z: 6, yaw: 2.0, idleClip: 'Long_Breathe_and_Look_Around' },
      { id: 'officer', kind: 'officer', x: -6, z: 4, yaw: 1.6, idleClip: 'Sword_Shout' },
    ],
    escort_ambush: [
      { id: 'ambush_soldier_1', kind: 'soldier', x: -66, z: -30, yaw: 4.5, idleClip: 'Long_Breathe_and_Look_Around' },
      { id: 'ambush_soldier_2', kind: 'soldier', x: -64, z: -34, yaw: 4.2, idleClip: 'Long_Breathe_and_Look_Around' },
      { id: 'ambush_archer', kind: 'archer', x: -70, z: -40, yaw: 4.4, idleClip: 'Long_Breathe_and_Look_Around' },
    ],
    villagers: [
      { id: 'boy', who: 'child', x: -88, z: -73, yaw: 2.3, role: 'boy' },
      { id: 'v_old', who: 'villager_m', x: -2, z: 6, yaw: 0.4, role: 'old' },
      { id: 'v_tsubaki', who: 'villager_f', x: 3, z: 10, yaw: 3.6, role: 'tsubaki' },
      { id: 'v_work1', who: 'villager_m', x: 8, z: 46, yaw: 0.5, role: 'rice' },
      { id: 'v_work2', who: 'villager_f', x: -22, z: 58, yaw: 5.0, role: 'rice' },
    ],
    captive: { id: 'archer', who: 'archer', x: -10, z: 6, yaw: 3.0 },
    // 里を取り戻したあと、家から出てくる人々（door から spot へ歩く）。route があれば里の道を往復する。
    revived: [
      { id: 'r_man', who: 'villager_m', door: [-13.1, 13.1], spot: [-3.4, 2.6], yaw: 0.6, role: 'chat', face: 'r_woman' },
      { id: 'r_woman', who: 'villager_f', door: [-16.5, -7.2], spot: [-1.6, 3.6], yaw: -2.4, role: 'talk', face: 'r_man' },
      { id: 'r_walker', who: 'villager_m', door: [14.7, 11.1], spot: [14.7, 11.1], yaw: 3.0, role: 'walker', route: [[14.7, 11.1], [4, 9.5], [-8, 11]] },
      { id: 'r_child', who: 'child', door: [10.9, -13.1], spot: [5.2, -5.4], yaw: 0.8, role: 'child' },
    ],
  },

  // 森の濃さ（0〜1）を決める中心と半径の足し合わせ。里・道・平場は scatter が別に避ける。
  forest: {
    base: 0.55,
    clearings: [
      { x: 0, z: 6, r: 56 }, { x: -98, z: -86, r: 36 }, { x: 4, z: 70, r: 62 }, { x: 60, z: 10, r: 44 }, { x: -78, z: -62, r: 22 }, { x: -56, z: -42, r: 20 }, { x: -30, z: -16, r: 26 },
    ],
    dense: [{ x: -70, z: -20, r: 60 }, { x: -20, z: -60, r: 50 }, { x: -120, z: 20, r: 60 }],
  },
};
