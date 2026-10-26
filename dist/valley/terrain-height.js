// terrain-height.js — 地形の高さ・傾斜・水・路面を world-data から出す純関数（logic層。Three.js非依存）。
// 描画（メッシュ・質感）・当たり・植生の配置・敵の経路が、すべてこの同じ関数を読む。
import { WORLD } from './world-data.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// 整数ハッシュと値ノイズ。機能ごとに seed をずらして系列を分ける。
function hash(ix, iz, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return lerp(lerp(hash(ix, iz, seed), hash(ix + 1, iz, seed), u), lerp(hash(ix, iz + 1, seed), hash(ix + 1, iz + 1, seed), u), v);
}
export function fbm(x, z, seed, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) { sum += amp * (vnoise(x * freq, z * freq, seed + i * 17) * 2 - 1); norm += amp; amp *= 0.5; freq *= 2.03; }
  return sum / norm;
}

// 折れ線を Catmull-Rom でなめらかにして、約 step m ごとの点列にする。
function smoothPolyline(points, step = 2.5) {
  const P = points.map(p => ({ x: p[0], z: p[1] }));
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    const n = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.z - p1.z) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  out.push(P[P.length - 1]);
  return out;
}

// 折れ線の線分を格子に入れて、近い線分だけを調べる（メッシュ生成で数十万回呼ばれるため）。
class SegmentIndex {
  constructor(line, cell = 40) {
    this.line = line; this.cell = cell; this.map = new Map(); this.stamp = new Int32Array(line.length); this.tick = 0;
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1];
      const x0 = Math.floor(Math.min(a.x, b.x) / cell), x1 = Math.floor(Math.max(a.x, b.x) / cell);
      const z0 = Math.floor(Math.min(a.z, b.z) / cell), z1 = Math.floor(Math.max(a.z, b.z) / cell);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const key = cx * 100003 + cz;
        let list = this.map.get(key); if (!list) this.map.set(key, list = []);
        list.push(i);
      }
    }
  }
  // 最短距離（線分へ射影）。maxR を超えるなら d=maxR+1 を返す。
  nearest(x, z, maxR = 170) {
    const { line, cell, map, stamp } = this;
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    let best = Infinity, bi = 0, bt = 0, bx = 0, bz = 0;
    this.tick++;
    const visit = key => {
      const list = map.get(key);
      if (!list) return;
      for (const i of list) {
        if (stamp[i] === this.tick) continue;
        stamp[i] = this.tick;
        const a = line[i], b = line[i + 1], dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz;
        const t = len2 > 0 ? clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1) : 0;
        const px = a.x + dx * t, pz = a.z + dz * t, d2 = (x - px) ** 2 + (z - pz) ** 2;
        if (d2 < best) { best = d2; bi = i; bt = t; bx = px; bz = pz; }
      }
    };
    const rMax = Math.ceil(maxR / cell) + 1;
    for (let r = 0; r <= rMax; r++) {
      if (r === 0) visit(cx * 100003 + cz);
      else {
        for (let k = -r; k <= r; k++) { visit((cx + k) * 100003 + (cz - r)); visit((cx + k) * 100003 + (cz + r)); }
        for (let k = -r + 1; k <= r - 1; k++) { visit((cx - r) * 100003 + (cz + k)); visit((cx + r) * 100003 + (cz + k)); }
      }
      if (best < Infinity && Math.sqrt(best) <= r * cell) break;
    }
    return best === Infinity ? { d: maxR + 1, i: 0, t: 0, px: x, pz: z } : { d: Math.sqrt(best), i: bi, t: bt, px: bx, pz: bz };
  }
}

function rectDistance(f, x, z) {
  const c = Math.cos(-f.rot), s = Math.sin(-f.rot), dx = x - f.x, dz = z - f.z;
  const u = dx * c - dz * s, v = dx * s + dz * c;
  const ex = Math.abs(u) - f.hx, ez = Math.abs(v) - f.hz;
  return ex > 0 || ez > 0 ? Math.hypot(Math.max(ex, 0), Math.max(ez, 0)) : Math.max(ex, ez);
}

export function createTerrain(world = WORLD) {
  const seed = world.seed;
  const { valley, floor, hill, river } = world;
  const riverLine = smoothPolyline(river.points, 3);
  const riverIndex = new SegmentIndex(riverLine);
  const surfaceY = z => river.surfaceBase + river.surfaceSlope * z;
  const T = world.terraces;

  function riverInfo(x, z) {
    const n = riverIndex.nearest(x, z, 170);
    return { d: n.d, y: surfaceY(n.pz) };
  }

  // 道や川を除いた自然な高さ
  function natural(x, z) {
    const e = Math.hypot((x - valley.cx) / valley.rx, (z - valley.cz) / valley.rz);
    const t = hill.dirX * x + hill.dirZ * z; // 里から廃寺方向（北西）へ進んだ距離
    let h = floor.y0 + floor.gx * x + floor.gz * z + hill.amp * smooth(hill.from, hill.to, t);

    // 山。川の近くでは谷になる
    const r = riverInfo(x, z);
    const corridor = smooth(28, 150, r.d);
    const ridge = 0.72 + 0.56 * (0.5 + 0.5 * fbm(x * 0.0055, z * 0.0055, seed + 3, 3));
    const mountain = 175 * Math.pow(smooth(0.8, 1.95, e), 1.3) * ridge * Math.pow(corridor, 0.8);
    h += mountain;
    h += fbm(x * 0.018, z * 0.018, seed + 5, 4) * 16 * smooth(0.85, 1.6, e) * corridor;

    // 平場
    let flatDamp = 0;
    for (const f of world.flats) {
      const d = rectDistance(f, x, z);
      const w = 1 - smooth(0, f.fall, d);
      if (w <= 0) continue;
      const tilt = f.tilt ? f.tilt[0] * (x - f.x) + f.tilt[1] * (z - f.z) : 0;
      h = lerp(h, f.y + tilt, w);
      if (f.id !== 'viewpoint') flatDamp = Math.max(flatDamp, w);
    }
    // 近景の起伏（平場では弱める）
    h += (fbm(x * 0.045, z * 0.045, seed + 11, 3) * 0.32 + fbm(x * 0.011, z * 0.011, seed + 13, 3) * 1.1 * (1 - 0.8 * flatDamp)) * (1 - 0.9 * flatDamp);

    // 棚田（南）：自然な傾きに沿う段にそろえる
    const inX = smooth(T.x0 - 6, T.x0 + 6, x) * (1 - smooth(T.x1 - 6, T.x1 + 6, x));
    const inZ = smooth(T.z0 - 4, T.z0 + 8, z) * (1 - smooth(T.z1 - 10, T.z1 + 2, z));
    const mask = inX * inZ;
    if (mask > 0) {
      const fall = 5.6 * smooth(T.z0 - 2, T.z1, z);
      const base = h - fall;
      const f = base / T.drop, fl = Math.floor(f), fr = f - fl;
      const stepped = (fl + smooth(1 - T.riser / (T.drop * 14), 1, fr)) * T.drop;
      h = lerp(h, stepped, mask);
    }

    // 峰（平らな頂から r までなめらかに下る。山と合成して高い方を採る）
    for (const p of world.peaks) {
      const d = Math.hypot(x - p.x, z - p.z);
      h = Math.max(h, p.h * Math.pow(1 - smooth(p.flatR, p.r, d), 1.15));
    }

    // 川の掘り込み
    if (r.d < river.halfWidth + river.bankWidth) {
      const bed = r.d < river.halfWidth ? r.y - river.bedDepth * (1 - (r.d / river.halfWidth) ** 2) : null;
      if (bed !== null) h = bed;
      else {
        const k = smooth(0, 1, (r.d - river.halfWidth) / river.bankWidth);
        h = lerp(Math.min(r.y + 0.1, h), h, k);
      }
    }
    return h;
  }

  // 道：自然な高さを道の点列に沿って平らにならした踏み面
  const roads = Object.entries(world.roads).map(([id, def]) => {
    const line = smoothPolyline(def.points, 2.5);
    const raw = line.map(p => natural(p.x, p.z));
    const tread = raw.map((_, i) => {
      let s = 0, c = 0;
      for (let k = -7; k <= 7; k++) { const j = i + k; if (j >= 0 && j < raw.length) { s += raw[j]; c++; } }
      return s / c;
    });
    return { id, line, tread, half: def.halfWidth, index: new SegmentIndex(line, 16) };
  });
  function roadInfo(x, z) {
    let best = null;
    for (const r of roads) {
      const n = r.index.nearest(x, z, r.half + 3);
      const w = 1 - smooth(r.half, r.half + 2.8, n.d);
      if (w > 0 && (!best || n.d - r.half < best.dist)) {
        const y = lerp(r.tread[n.i], r.tread[Math.min(n.i + 1, r.tread.length - 1)], n.t);
        best = { id: r.id, d: n.d, w, y, dist: n.d - r.half };
      }
    }
    return best;
  }

  function heightAt(x, z) {
    const h = natural(x, z);
    const road = roadInfo(x, z);
    return road ? lerp(h, road.y, road.w) : h;
  }
  function slopeAt(x, z, e = 0.7) {
    const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    return Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
  }
  function normalAt(x, z, e = 0.7) {
    const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    const l = Math.hypot(dx, 1, dz);
    return { x: -dx / l, y: 1 / l, z: -dz / l };
  }
  // 水深（m）。0以下は水に入っていない。
  function waterAt(x, z) {
    const r = riverInfo(x, z);
    if (r.d > river.halfWidth + 1) return 0;
    return Math.max(0, r.y - heightAt(x, z));
  }
  function waterLevelAt(x, z) { return riverInfo(x, z).y; }

  function forestDensity(x, z) {
    const f = world.forest;
    let v = f.base + 0.16 * fbm(x * 0.02, z * 0.02, seed + 21, 3);
    for (const c of f.dense) v += 0.5 * (1 - smooth(0, c.r, Math.hypot(x - c.x, z - c.z)));
    for (const c of f.clearings) v -= 1.1 * (1 - smooth(c.r * 0.55, c.r, Math.hypot(x - c.x, z - c.z)));
    return clamp(v, 0, 1);
  }

  // 路面の種類の重み。合計1。質感の重ね合わせと植生の配置に使う。
  function surfaceAt(x, z, slopeDeg) {
    const slope = slopeDeg ?? slopeAt(x, z);
    const road = roadInfo(x, z);
    const r = riverInfo(x, z);
    const water = r.d - river.halfWidth;
    let dirt = road ? road.w : 0;
    const yard = 1 - smooth(5, 11, Math.hypot(x - 4, z - 6));
    dirt = Math.max(dirt, yard * (0.55 + 0.4 * fbm(x * 0.3, z * 0.3, seed + 31, 2)));
    const forecourt = 1 - smooth(6, 13, Math.hypot(x + 88, z + 78));
    dirt = Math.max(dirt, forecourt * 0.7);
    let gravel = (1 - smooth(-1, 4.5, water)) * 0.95;
    if (water < -0.5) gravel = 1;
    const mud = T && x > T.x0 - 4 && x < T.x1 + 4 && z > T.z0 - 2 && z < T.z1 + 2 ? 0.5 * (0.5 + 0.5 * fbm(x * 0.2, z * 0.2, seed + 33, 2)) : 0;
    const forestCover = forestDensity(x, z);
    const rock = smooth(30, 46, slope + 6 * fbm(x * 0.09, z * 0.09, seed + 35, 2)) * (1 - 0.55 * forestCover);
    const forest = forestCover;
    let litter = forest * (1 - dirt) * 0.8 * (1 - gravel);
    let grass = Math.max(0, 1 - dirt - gravel - rock - mud - litter * 0.6);
    const m = { grass, dirt, rock, gravel, mud, litter };
    const sum = grass + dirt + rock + gravel + mud + litter || 1;
    for (const k in m) m[k] /= sum;
    return m;
  }

  const b = world.bounds;
  function walkable(x, z) {
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
    if (waterAt(x, z) > 0.45) return false;
    return slopeAt(x, z) < 40;
  }

  return { heightAt, slopeAt, normalAt, waterAt, waterLevelAt, surfaceAt, forestDensity, roadInfo, riverInfo, walkable, bounds: b, riverLine, roads, natural };
}
