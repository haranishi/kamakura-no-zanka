// spark-streaks.js — 線状の火花（短い筋）の純粋な部分（8.3a 第3周・R18.3）。Three.js・DOM・乱数・時計に触れない。
// 第2周の火花は丸い光の粒と大きな柔らかい光で、「白い煙の玉」「蛍」に見えた（別役の採点）。ここでは、粒を速度の向きへ伸びた
// 短い筋にする：先（新しい所）は明るい芯、尾は橙へ薄れる。筋は速いほど長く、寿命へ向かって短く細くなる。
// 配列はすべて作るときに確保し、毎コマは書き込むだけ（新規確保なし）。見た目の結線（fx.js の SparkStreaks）が、
// 1つのメッシュ（加算・描画呼出1つ）へ流す。カメラの位置は pool.camera（呼ぶ側が毎コマ書く）から読む。

export const STREAK = Object.freeze({
  max: 96,          // 同時に出す筋の上限（当たり1回で9〜14本、弾きで22本。超えた分は出さない）
  lenK: 0.024,      // 筋の長さ＝速さ×lenK（m）
  minLen: 0.05,     // 長さの下限・上限（m）
  maxLen: 0.3,
  width: 0.014,     // 根元（先）の幅（m）。尾は細る
});
export const STREAK_VERTS = STREAK.max * 4;
export const STREAK_INDICES = STREAK.max * 6;

export function createStreaks(max = STREAK.max) {
  return { max, count: 0, pos: new Float32Array(max * 3), vel: new Float32Array(max * 3), life: new Float32Array(max), age: new Float32Array(max),
    width: new Float32Array(max), grav: new Float32Array(max), drag: new Float32Array(max), head: new Float32Array(max * 3), tail: new Float32Array(max * 3),
    alpha: new Float32Array(max), camera: new Float64Array(3) };
}
// 添字（2つの三角形×筋）は変わらないので、作るときに1回だけ書く
export function streakIndex(index) {
  for (let i = 0; i < index.length / 6; i++) { const a = i * 4, k = i * 6; index[k] = a; index[k + 1] = a + 1; index[k + 2] = a + 2; index[k + 3] = a + 1; index[k + 4] = a + 3; index[k + 5] = a + 2; }
  return index;
}

// 筋を1本足す（当たり・弾きの瞬間だけ。毎コマではない）。p＝位置、v＝速度（m/秒）。head・tail は線形の色（先・尾）。上限なら足さずに false。
export function emitStreak(pool, p, v, { life, width = STREAK.width, head, tail, alpha = 1, gravity = -9, drag = 1.5 }) {
  if (pool.count >= pool.max) return false;
  const i = pool.count++, k = i * 3;
  for (let c = 0; c < 3; c++) { pool.pos[k + c] = p[c]; pool.vel[k + c] = v[c]; pool.head[k + c] = head[c]; pool.tail[k + c] = tail[c]; }
  pool.life[i] = life; pool.age[i] = 0; pool.width[i] = width; pool.alpha[i] = alpha; pool.grav[i] = gravity; pool.drag[i] = drag;
  return true;
}
export function clearStreaks(pool) { pool.count = 0; }

function moveStreak(pool, from, to) {
  const a = from * 3, b = to * 3;
  for (let c = 0; c < 3; c++) { pool.pos[b + c] = pool.pos[a + c]; pool.vel[b + c] = pool.vel[a + c]; pool.head[b + c] = pool.head[a + c]; pool.tail[b + c] = pool.tail[a + c]; }
  pool.life[to] = pool.life[from]; pool.age[to] = pool.age[from]; pool.width[to] = pool.width[from]; pool.alpha[to] = pool.alpha[from]; pool.grav[to] = pool.grav[from]; pool.drag[to] = pool.drag[from];
}
// 進める：寿命を過ぎた筋を除き（末尾と入れ替え）、速度に空気の抵抗と重力をかけて動かす。dt はゲームの秒（命中の停止中はごく遅い）
export function stepStreaks(pool, dt) {
  let i = 0;
  while (i < pool.count) {
    pool.age[i] += dt;
    if (pool.age[i] >= pool.life[i]) { const j = --pool.count; if (i !== j) moveStreak(pool, j, i); continue; }
    const k = i * 3, d = Math.exp(-pool.drag[i] * dt);
    pool.vel[k] *= d; pool.vel[k + 1] = pool.vel[k + 1] * d + pool.grav[i] * dt; pool.vel[k + 2] *= d;
    pool.pos[k] += pool.vel[k] * dt; pool.pos[k + 1] += pool.vel[k + 1] * dt; pool.pos[k + 2] += pool.vel[k + 2] * dt;
    i++;
  }
}

const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
// 頂点を並べる：筋ごとに4頂点（0,1＝先の両側／2,3＝尾の両側）。尾は先から速度の逆向きへ長さ L。面はカメラへ向ける。
// 色は先が head（寿命で薄れる）、尾が tail（透明へ）。uv の x は先0→尾1、y は幅の向き0〜1。使った添字の数を返す（新しい物を作らない）。
export function buildStreaks(pool, out) {
  const P = out.position, C = out.color, U = out.uv, cam = pool.camera;
  for (let i = 0; i < pool.count; i++) {
    const k = i * 3, px = pool.pos[k], py = pool.pos[k + 1], pz = pool.pos[k + 2], vx = pool.vel[k], vy = pool.vel[k + 1], vz = pool.vel[k + 2];
    const sp = len3(vx, vy, vz), t = Math.min(1, pool.age[i] / pool.life[i]), fade = 1 - t;
    const L = Math.min(STREAK.maxLen, Math.max(STREAK.minLen, sp * STREAK.lenK)) * (0.45 + 0.55 * fade);
    const dx = sp > 1e-6 ? vx / sp : 0, dy = sp > 1e-6 ? vy / sp : 1, dz = sp > 1e-6 ? vz / sp : 0;
    const cx = cam[0] - px, cy = cam[1] - py, cz = cam[2] - pz;
    const qx = dy * cz - dz * cy, qy = dz * cx - dx * cz, qz = dx * cy - dy * cx, ql = len3(qx, qy, qz) || 1;
    const w = pool.width[i] * (0.4 + 0.6 * fade), sx = qx / ql * w, sy = qy / ql * w, sz = qz / ql * w;
    const tx = px - dx * L, ty = py - dy * L, tz = pz - dz * L, v = i * 4;
    for (let e = 0; e < 4; e++) {
      const tailEnd = e >= 2, side = e % 2 ? 1 : -1, ww = tailEnd ? 0.35 : 1, q = (v + e) * 3, cc = (v + e) * 4;
      P[q] = (tailEnd ? tx : px) + sx * side * ww; P[q + 1] = (tailEnd ? ty : py) + sy * side * ww; P[q + 2] = (tailEnd ? tz : pz) + sz * side * ww;
      for (let c = 0; c < 3; c++) C[cc + c] = tailEnd ? pool.tail[k + c] : pool.head[k + c];
      C[cc + 3] = tailEnd ? 0 : pool.alpha[i] * Math.sqrt(fade);
      U[(v + e) * 2] = tailEnd ? 1 : 0; U[(v + e) * 2 + 1] = side > 0 ? 1 : 0;
    }
  }
  out.vertices = pool.count * 4; out.indices = pool.count * 6;
  return out.indices;
}
