// shots.js — 固定画角（改善の前後比較に使う）。位置・向き・FOV・時刻・待機フレーム数を持つ。
// eye は地面からの目の高さ(m)。lookAt は {x,z,y?}（y省略なら地面+1.2m）。乱数と時刻は固定。
export const SHOTS = {
  veranda:   { eye: 2.6, pos: [-93, -77], look: [-10, 4, 6], fov: 52, note: '縁側の俯瞰（企画の三人称画）' },
  yard:      { eye: 2.2, pos: [-84, -68], look: [-100, -86, 5], fov: 54, note: '廃寺の庭' },
  hairpin:   { eye: 2.4, pos: [-56, -44], look: [-44, -30, 3], fov: 56, note: '林道の九十九折' },
  overlook:  { eye: 2.4, pos: [-46, -30], look: [20, 8, 2], fov: 56, note: '見晴らし岩から里（岩の東側。里・道・幟・敵が見える）' },
  village:   { eye: 2.2, pos: [-24, -6], look: [10, 5, 4], fov: 58, note: '里の脱穀場' },
  paddies:   { eye: 2.4, pos: [-12, 24], look: [18, 70, 2], fov: 56, note: '棚田と畦道' },
  river:     { eye: 3.2, pos: [78, -6], look: [130, -44, 2], fov: 50, note: '川と橋の遠景' },
  battle:    { eye: 2.0, pos: [-16, -2], look: [-4, 6, 1.4], fov: 52, note: '戦闘の寄り（里）' },
  hero:      { eye: 1.9, pos: [-92, -80], look: [-84, -72, 1.5], fov: 46, note: '主人公の肩越し' },
  backlight: { eye: 2.0, pos: [-30, 2], look: [-110, -60, 14], fov: 56, note: '夕日の逆光' },
  mountains: { eye: 5.0, pos: [20, 40], look: [260, -140, 60], fov: 40, note: '対岸の山砦' },
  title:     { eye: 1.35, pos: [-83.5, -73.5], look: [-104, -93, 4.2], fov: 46, note: 'タイトル：焚き火の向こうの廃寺' },
  // 構想の絵（隠れ谷の夕景）と同じ並び：南の高い所から北（やや東）を見る。左下に棚田、左の中ほどに里、左の奥に寺の山、中央に橋、
  // 右に川、右の上に丘の砦、右上の端に夕日。絵のカメラは里から 60〜70m だが、配置を変えない決まりなので、棚田・川・砦が 1 枚に
  // 入る位置まで下がっている（里まで約 180m）。
  // これまでに試して捨てた構図：南西の低い所から俯角 9 度・画角 50 度（棚田が下の端だけ・上半分が森の斜面）、俯角 13.5 度・画角 62 度
  // （講評で「空が無く、すり鉢の底を覗く画」）、棚田の南西の角の上・高さ 55m から北東（空と山並みは入ったが、川が木に隠れ、里と川と
  // 砦の並びが絵と違った）。棚田の南の端の先・高さ 70m から、北から東へ 16 度・俯角 約 10.5 度・縦の画角 64 度にすると、目印の
  // 画面の中の位置が絵に近くなる（実際の画面と、位置の計算の両方で確かめた）。夕日（方位 55 度・高さ 15.5 度）は、右上の端に入る。
  concept:   { eye: 70, pos: [30, 180], look: [82.4, -2.6, 36.3], fov: 64, note: '絵と同じ並びの見渡し（南の高い所から北やや東）' },
};
// 番地の旗 &cam=<名前> と撮影の道具が使う：固定カメラの位置・見る点・画角（世界の座標）。名前が無ければ null。
export function shotOverride(name, terrain) {
  const shot = Object.hasOwn(SHOTS, name) ? SHOTS[name] : null;
  if (!shot) return null;
  const [x, z] = shot.pos, [lx, lz, ly] = shot.look;
  return { pos: [x, terrain.heightAt(x, z) + shot.eye, z], look: [lx, terrain.heightAt(lx, lz) + (ly != null ? ly : 1.2), lz], fov: shot.fov };
}
export function applyShot(camera, shot, terrain) {
  const [x, z] = shot.pos, y = terrain.heightAt(x, z) + shot.eye;
  camera.position.set(x, y, z);
  const [lx, lz, ly] = shot.look;
  camera.lookAt(lx, ly != null ? terrain.heightAt(lx, lz) + ly : terrain.heightAt(lx, lz) + 1.2, lz);
  if (shot.fov) { camera.fov = shot.fov; camera.updateProjectionMatrix(); }
}
