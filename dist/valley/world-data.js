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
    north: { halfWidth: 1.0, points: [[-40, -18], [-30, -30], [-14, -38], [2, -42], [8, -30], [6, -18]] },
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
  ],

  // 置き物（当たりは小さい）。kind は props.js が読む（井戸・荷車・灯籠・稲架・地蔵・焚き火は Meshy のモデル）。scale はモデルの大きさ合わせ。
  props: [
    { id: 'well', kind: 'well', x: 0, z: 0, r: 1.1, scale: 1.0 },
    { id: 'cart', kind: 'cart', x: -26, z: 4, rotY: 0.5, r: 1.4, scale: 1.3 },
    { id: 'lantern_temple', kind: 'stone_lantern', x: -84, z: -76, r: 0.5, scale: 0.8 },
    { id: 'lantern_steps', kind: 'stone_lantern', x: -72.5, z: -69.5, r: 0.5, scale: 0.8 },
    { id: 'bonfire', kind: 'bonfire', x: -88, z: -80, r: 0.8, scale: 1.0 },
    { id: 'drying1', kind: 'drying_rack', x: 22, z: 4, rotY: 0.4, r: 1.3, scale: 1.25 },
    { id: 'drying2', kind: 'drying_rack', x: -6, z: 30, rotY: -0.2, r: 1.3, scale: 1.25 },
    { id: 'jizo_view', kind: 'jizo', x: -47.5, z: -31.5, r: 0.35, scale: 0.47 },
    { id: 'jizo_road', kind: 'jizo', x: -66.5, z: -61, r: 0.35, scale: 0.47 },
    { id: 'viewpoint_rock', kind: 'boulder_big', x: -52, z: -37, r: 2.1, vr: 3.5 },
    { id: 'ambush_rock', kind: 'boulder_big', x: -66, z: -26, r: 1.6, vr: 2.5 },
  ],

  // 飾り（当たりは props.js の propColliders が作る）。柵は線の両端を結ぶ。幟は敵の陣の目印。
  dress: [
    { kind: 'banner', x: -29.5, z: 0.5, rotY: 0.4 }, { kind: 'banner', x: -29.5, z: 8.5, rotY: 0.5, color: '#1b2230' }, { kind: 'banner', x: -22.5, z: 7.5, rotY: 0.3 },
    { kind: 'fence_line', from: [-24, -19.5], to: [-12, -19] }, { kind: 'fence_line', from: [-23, 24], to: [-23, 13] },
    { kind: 'fence_line', from: [26, 10], to: [26, 22] }, { kind: 'fence_line', from: [11, -26], to: [22, -27] }, { kind: 'fence_line', from: [-40, 17.5], to: [-30, 17.5] },
    { kind: 'firewood', x: -12.5, z: -9.5, rotY: 0.3 }, { kind: 'firewood', x: 18, z: -14.8, rotY: -0.2 }, { kind: 'firewood', x: 20.5, z: 12.5, rotY: 3.4 },
    { kind: 'firewood', x: -9.5, z: 15, rotY: 2.9 }, { kind: 'firewood', x: -30, z: 13, rotY: 1.57 },
    { kind: 'firewood', x: -91.5, z: -83, rotY: 0.6, scale: 1.3 }, { kind: 'firewood', x: -85.5, z: -84, rotY: -0.4, scale: 1.0 },
  ],

  // 遠景の建物（入れない）
  distant: [
    { id: 'bridge', kind: 'bridge', x: 128.4, z: -44.5, rotY: -0.17, scale: [3.7, 2.2, 2.0] },
    { id: 'gatehouse', kind: 'gatehouse', x: 156, z: -46, rotY: 1.35 },
    { id: 'fort', kind: 'fort', x: 262, z: -140, rotY: 3.6 },
    { id: 'barricade', kind: 'barricade', x: 100, z: -8, rotY: 1.2 },
  ],

  // 場面のきっかけの範囲（円）と到達点。quest.js の zone / place 名と一致させる。
  zones: {
    temple_yard: { x: -84, z: -72, r: 9 },
    viewpoint: { x: -50, z: -36, r: 7 },
    village_front: { x: -34, z: -4, r: 9 },
    village_north: { x: 3, z: -28, r: 10 },
    village_south: { x: -12, z: 36, r: 10 },
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
  },

  // 森の濃さ（0〜1）を決める中心と半径の足し合わせ。里・道・平場は scatter が別に避ける。
  forest: {
    base: 0.55,
    clearings: [
      { x: 0, z: 6, r: 56 }, { x: -98, z: -86, r: 36 }, { x: 4, z: 70, r: 62 }, { x: 60, z: 10, r: 44 }, { x: -78, z: -62, r: 22 }, { x: -56, z: -42, r: 20 },
    ],
    dense: [{ x: -70, z: -20, r: 60 }, { x: -20, z: -60, r: 50 }, { x: -120, z: 20, r: 60 }],
  },
};
