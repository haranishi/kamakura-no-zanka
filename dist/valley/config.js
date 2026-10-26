// config.js — 見た目と手触りの調整値（暫定の初期値）。?lk=キー:値,... で書き換えずに試せる。
// 規則の数値（技の時間・ダメージ）は combat.js の MOVES/STATS が正本。ここには見た目と操作の値だけを置く。

// 武器を骨へ付ける位置と向き（骨のローカル座標。回転は度）。ラボ（lab.html）で動作を見ながら合わせる。
export const GRIP = {
  // 右手→左手のベクトルは構えで骨ローカル +Z、斬る向きの手の速度は −X。刃は −Z、刃の向きは −X に合わせた（ラボで実測）。
  tachiDrawn: { bone: 'RightHand', pos: [0, 0, 0.05], axes: { y: [0, 0, -1], z: [-1, 0, 0] } },
  // 左腰に、切先を後ろ下へ、刃を下へ向けて吊る（太刀の佩き方）。
  tachiHip: { bone: 'Hips', pos: [0.19, 0.0, 0.12], axes: { y: [0.08, -0.55, -0.83], z: [0, -1, 0] } },
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
    const n = Number(value);
    if (key && Number.isFinite(n)) LOOK[key] = n;
  }
}
