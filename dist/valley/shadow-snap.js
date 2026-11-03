// 影の範囲の中心を、光から見た画面の1画素（texel）の倍数へ丸める純粋な層（Three.js・DOM・乱数・時計に触れない）。
// 光のカメラは中心から sunDir の向きへ離れて中心を見る。その左右(x)・上下(y)の軸で丸めると、影の画像は
// 歩いても整数画素ずつしか動かず、木や家の影の縁がちらつかない。世界のXZで丸めると、光の軸に対して斜めなので
// 1回の丸めが光の画面では端数の画素になり、縁が揺れる（2026-11-04 案Aで直した）。奥行き(z)は丸めない（画素に関係しない）。
// 軸の作り方は Three.js の Matrix4.lookAt（z＝光の位置−中心、x＝上×z、y＝z×x）と同じ。上は +Y。
export function shadowTexel(extent, mapSize) {
  if (!(extent > 0) || !(mapSize > 0)) throw new RangeError('shadow texel');
  return extent / mapSize;
}
// out へ丸めた中心 [x, y, z] を書いて返す（毎コマ呼ぶので新しい配列を作らない）。sunDir は長さ1でなくてよい。
export function snapShadowCenter(x, y, z, sunDir, texel, out = [0, 0, 0]) {
  let zx = sunDir[0], zy = sunDir[1], zz = sunDir[2];
  const zl = Math.hypot(zx, zy, zz);
  if (!(zl > 0) || !(texel > 0)) throw new RangeError('shadow snap');
  zx /= zl; zy /= zl; zz /= zl;
  // x = (0,1,0) × z
  let xx = zz, xz = -zx; const xl = Math.hypot(xx, xz);
  if (!(xl > 1e-6)) throw new RangeError('shadow snap: sun straight up');
  xx /= xl; xz /= xl;
  // y = z × x （x の y 成分は 0）
  const yx = zy * xz, yy = zz * xx - zx * xz, yz = -zy * xx;
  const u = Math.round((x * xx + z * xz) / texel) * texel;
  const w = Math.round((x * yx + y * yy + z * yz) / texel) * texel;
  const d = x * zx + y * zy + z * zz;
  out[0] = xx * u + yx * w + zx * d;
  out[1] = yy * w + zy * d;
  out[2] = xz * u + yz * w + zz * d;
  return out;
}
