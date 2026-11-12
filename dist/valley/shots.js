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
  // 構想の絵（隠れ谷の夕景）と同じ向き：南西の高い所から北東。左に寺へ上る道、中央に里、手前に棚田、右に川と橋、右の奥に丘の砦。
  // 絵のカメラは里から 60〜70m だが、配置を変えない決まりなので、寺と橋が入る位置まで下がっている（里まで約 120m）。
  // 俯角は約 13.5 度・縦の画角 62 度：棚田が画面の下 3 割、里が中ほど、橋が右、砦の丘と空が上の端に入る。俯角 9 度・画角 50 度では、
  // 棚田が下の端にしか写らず、画面の上半分が森の斜面になった（実際の画面で見て直した）。
  concept:   { eye: 40, pos: [-50, 110], look: [-0.6, -42.2, 1.88], fov: 62, note: '絵と同じ向きの見渡し（南西の高い所から北東）' },
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
