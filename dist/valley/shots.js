// shots.js — 固定画角（改善の前後比較に使う）。位置・向き・FOV・時刻・待機フレーム数を持つ。
// eye は地面からの目の高さ(m)。lookAt は {x,z,y?}（y省略なら地面+1.2m）。乱数と時刻は固定。
export const SHOTS = {
  veranda:   { eye: 2.6, pos: [-93, -77], look: [-10, 4, 6], fov: 52, note: '縁側の俯瞰（企画の三人称画）' },
  yard:      { eye: 2.2, pos: [-84, -68], look: [-100, -86, 5], fov: 54, note: '廃寺の庭' },
  hairpin:   { eye: 2.4, pos: [-56, -44], look: [-44, -30, 3], fov: 56, note: '林道の九十九折' },
  overlook:  { eye: 2.2, pos: [-59, -44], look: [4, 6, 5], fov: 54, note: '見晴らし岩から里' },
  village:   { eye: 2.2, pos: [-24, -6], look: [10, 5, 4], fov: 58, note: '里の脱穀場' },
  paddies:   { eye: 2.4, pos: [-12, 24], look: [18, 70, 2], fov: 56, note: '棚田と畦道' },
  river:     { eye: 3.2, pos: [78, -6], look: [130, -44, 2], fov: 50, note: '川と橋の遠景' },
  battle:    { eye: 2.0, pos: [-16, -2], look: [-4, 6, 1.4], fov: 52, note: '戦闘の寄り（里）' },
  hero:      { eye: 1.9, pos: [-92, -80], look: [-84, -72, 1.5], fov: 46, note: '主人公の肩越し' },
  backlight: { eye: 2.0, pos: [-30, 2], look: [-110, -60, 14], fov: 56, note: '夕日の逆光' },
  mountains: { eye: 5.0, pos: [20, 40], look: [260, -140, 60], fov: 40, note: '対岸の山砦' },
  title:     { eye: 1.35, pos: [-83.5, -73.5], look: [-104, -93, 4.2], fov: 46, note: 'タイトル：焚き火の向こうの廃寺' },
};
export function applyShot(camera, shot, terrain) {
  const [x, z] = shot.pos, y = terrain.heightAt(x, z) + shot.eye;
  camera.position.set(x, y, z);
  const [lx, lz, ly] = shot.look;
  camera.lookAt(lx, ly != null ? terrain.heightAt(lx, lz) + ly : terrain.heightAt(lx, lz) + 1.2, lz);
  if (shot.fov) { camera.fov = shot.fov; camera.updateProjectionMatrix(); }
}
