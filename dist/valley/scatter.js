// scatter.js — 木・岩・草・稲の配置を地形関数から決定的に出す純関数（logic層。Three.js非依存）。
// 乱数は機能ごとに別の系列（seed をずらす）。後から機能を足しても既存の絵を組み替えない（design.md）。
import { smooth, fbm } from './terrain-height.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// 升ごとの乱数。升の番号と seed だけで決まるので、他の物（建物・畑・小道具）を足して隣の升の結果が変わっても、この升の木・岩は動かない
// （順に乱数を引く方式だと、一つの点の結果が変わるだけで以降の全部がずれ、里の入口に6mの大岩が現れた）。
export function cellRand(seed, i, j) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return mulberry32(h >>> 0);
}

// 峰（烏峰）の内側か。遠景でも急な斜面に木を立て、頂の平らな所（砦）の周りだけ木を抜く。
function nearPeak(world, x, z, scale = 1) { return (world.peaks || []).some(p => Math.hypot(x - p.x, z - p.z) < p.r * scale); }
function onPeakTop(world, x, z) { return (world.peaks || []).some(p => Math.hypot(x - p.x, z - p.z) < p.flatR * 1.9); }   // 砦は実寸で約50m。頂の周り約45mは木を抜く（低い所から砦の輪郭が見えるように）

// 建物の足跡（回転した長方形）に点が入るか。margin はメートル。
export function insideFootprint(b, x, z, margin = 0) {
  const c = Math.cos(b.rotY), s = Math.sin(b.rotY), dx = x - b.x, dz = z - b.z;
  const u = dx * c - dz * s, v = dx * s + dz * c; // rotation.y=θ のモデルの局所座標
  return Math.abs(u) <= b.footprint.w / 2 + margin && Math.abs(v) <= b.footprint.d / 2 + margin;
}

// 見通しの帯（world.sightlines）の内側か。木を置かない。
export function inSightline(world, x, z) {
  for (const l of world.sightlines || []) {
    const [x0, z0] = l.from, [x1, z1] = l.to, dx = x1 - x0, dz = z1 - z0, t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz)));
    if (Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t)) < l.halfWidth) return true;
  }
  return false;
}

// 畑の長方形（半幅 hx,hz・回転 rot）に点が入るか
export function insidePlot(f, x, z, margin = 0) {
  const c = Math.cos(-f.rot), sn = Math.sin(-f.rot), dx = x - f.x, dz = z - f.z;
  const u = dx * c - dz * sn, v = dx * sn + dz * c;
  return Math.abs(u) <= f.hx + margin && Math.abs(v) <= f.hz + margin;
}

function blockedByWorld(world, terrain, x, z, margin, startRadius = 14) {
  for (const f of world.plots || []) if (insidePlot(f, x, z, margin)) return true;
  for (const b of world.buildings) if (insideFootprint(b, x, z, margin)) return true;
  for (const p of world.props) if (Math.hypot(x - p.x, z - p.z) < (p.r || 1) + margin) return true;
  const road = terrain.roadInfo(x, z);
  if (road && road.dist < margin + 1.5) return true;
  if (Math.hypot(x - world.start.x, z - world.start.z) < startRadius) return true;
  return false;
}

// 木。kind: 0=杉, 1=広葉(ケヤキ・栗), 2=松。戻りは配列の組（描画側が LOD ごとに振り分ける）。
// 近景（nearBox）は step の格子、その外の遠景は farStep の格子で、ゆらぎをつけて置く。乱数は升ごと（cellRand）。
// 遠景は大きさ・縦横比・向きをばらつかせ、隣と重なる大きさにして地面をのぞかせない（同じ形が同じ間隔で並ぶと型押しの壁紙に見えた）。
export function scatterTrees(world, terrain, { seed = 7, step = 4.5, farStep = 11, nearBox = [-210, 240, -210, 200], farHalf = 700 } = {}) {
  const out = { x: [], y: [], z: [], s: [], rot: [], kind: [], tint: [] };
  const taken = new Map(), cell = 4, base = world.seed + seed * 101;
  const inNearBox = (x, z) => x >= nearBox[0] && x <= nearBox[1] && z >= nearBox[2] && z <= nearBox[3];
  const free = (x, z, r) => {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const list = taken.get((Math.floor(x / cell) + i) * 7919 + Math.floor(z / cell) + j);
      if (list) for (const t of list) if ((x - t[0]) ** 2 + (z - t[1]) ** 2 < (r + t[2]) ** 2) return false;
    }
    return true;
  };
  const tryPlace = (x, z, inNear, rand) => {
    const roll = rand(), r = rand(), sz = rand(), rot = rand(), tint = rand();            // 受け入れの可否によらず、毎回同じ数だけ引く
    const density = terrain.forestDensity(x, z) + (inNear ? 0 : 0.25);
    const p = Math.pow(Math.max(0, Math.min(1, (density - 0.22) / 0.55)), 1.15);
    if (roll > p) return;
    if (terrain.waterAt(x, z) > 0.02) return;
    if (inSightline(world, x, z)) return;
    if (onPeakTop(world, x, z)) return;                      // 山砦の頂は木を抜く（柵と櫓の輪郭が見えるように）
    const ri = terrain.riverInfo(x, z);
    if (ri.d < 13) return;
    const slope = terrain.slopeAt(x, z, 1.5);
    if (slope > (inNear && !nearPeak(world, x, z) ? 52 : 66)) return;      // 遠くの急な山（烏峰の裾も箱の中でも）にも木を立てる（はげ山に見えない）
    if (inNear && blockedByWorld(world, terrain, x, z, 4.5)) return;
    const surf = inNear ? terrain.surfaceAt(x, z, slope) : null;
    let kind = 0;
    if (surf && surf.rock > 0.35 && r < 0.55) kind = 2;
    else if ((Math.hypot(x, z) < 110 && density < 0.75 && r < 0.5) || (ri.d < 40 && r < 0.35)) kind = 1;
    else if (r > 0.9) kind = 2;
    const scale = (kind === 1 ? 0.8 : 0.75) + sz * 0.55 + (density > 0.7 ? 0.1 : 0);
    const radius = inNear ? (kind === 1 ? 2.6 : 1.9) * scale : 1.5 * scale;              // 遠景は隣と重ねて置く
    if (!free(x, z, radius)) return;
    const key = Math.floor(x / cell) * 7919 + Math.floor(z / cell);
    if (!taken.has(key)) taken.set(key, []);
    taken.get(key).push([x, z, radius]);
    out.x.push(x); out.z.push(z); out.y.push(terrain.heightAt(x, z)); out.s.push(scale); out.rot.push(rot * Math.PI * 2); out.kind.push(kind); out.tint.push(tint);
  };
  for (let iz = 0; nearBox[2] + iz * step <= nearBox[3]; iz++) for (let ix = 0; nearBox[0] + ix * step <= nearBox[1]; ix++) {
    const rand = cellRand(base, ix, iz), gx = nearBox[0] + ix * step, gz = nearBox[2] + iz * step;
    tryPlace(gx + (rand() - 0.5) * step * 0.9, gz + (rand() - 0.5) * step * 0.9, true, rand);
  }
  const n = Math.floor(farHalf * 2 / farStep);
  for (let iz = 0; iz <= n; iz++) for (let ix = 0; ix <= n; ix++) {
    const gx = -farHalf + ix * farStep, gz = -farHalf + iz * farStep;
    if (inNearBox(gx, gz)) continue;
    const rand = cellRand(base + 1, ix, iz);
    tryPlace(gx + (rand() - 0.5) * farStep * 1.5, gz + (rand() - 0.5) * farStep * 1.5, false, rand);
  }
  return out;
}

// 岩（河原・斜面・路肩）。戻りは {x,y,z,s,rot,sx,sz,sink}。乱数は升ごと（cellRand）で、物を足しても既存の岩は動かない。
// 里の平場と道の脇には、大きな岩（s>1.2）を置かない（里の入口を塞ぐ6mの岩が出た）。
export function scatterRocks(world, terrain, { seed = 13, nearBox = [-150, 170, -150, 130] } = {}) {
  const out = { x: [], y: [], z: [], s: [], rot: [], sx: [], sz: [], sink: [] };
  const base = world.seed + seed * 211, village = (world.flats || []).find(f => f.id === 'village');
  const inVillage = (x, z) => village && Math.abs(x - village.x) < village.hx + 4 && Math.abs(z - village.z) < village.hz + 4;
  for (let iz = 0; nearBox[2] + iz * 5 <= nearBox[3]; iz++) for (let ix = 0; nearBox[0] + ix * 5 <= nearBox[1]; ix++) {
    const rand = cellRand(base, ix, iz), gx = nearBox[0] + ix * 5, gz = nearBox[2] + iz * 5;
    const ux = rand(), uz = rand(), roll = rand(), sRoll = rand(), rot = rand(), sx = rand(), sz = rand(), sink = rand();     // 毎回同じ数だけ引く
    const x = gx + ux * 5, z = gz + uz * 5;
    if (terrain.waterAt(x, z) > 0.1) continue;
    const slope = terrain.slopeAt(x, z, 1.5);
    const ri = terrain.riverInfo(x, z);
    const bank = ri.d < 24 ? 1 - smooth(10, 24, ri.d) : 0;
    const steep = smooth(14, 32, slope);
    const p = 0.04 + bank * 0.55 + steep * 0.35;
    if (roll > p) continue;
    if (blockedByWorld(world, terrain, x, z, 1.5)) continue;
    const road = terrain.roadInfo(x, z);
    if (road && road.dist < 1.0) continue;
    let s = 0.35 + Math.pow(sRoll, 2.2) * (bank > 0.2 ? 2.6 : 1.7) + steep * 0.5;
    if (s > 1.2 && (inVillage(x, z) || (road && road.dist < 6))) s = 0.35 + (s - 0.35) * 0.3;          // 里と道の脇は小さな石だけ
    out.x.push(x); out.z.push(z); out.y.push(terrain.heightAt(x, z)); out.s.push(s); out.rot.push(rot * Math.PI * 2);
    out.sx.push(0.75 + sx * 0.6); out.sz.push(0.75 + sz * 0.6); out.sink.push(0.15 + sink * 0.25);
  }
  return out;
}

// 草の株（近景の草地）。surface の草の重みと森の薄さで決める。戻りは {x,y,z,s,rot,tint}
export function scatterGrass(world, terrain, { seed = 17, box = [-135, 105, -135, 115], step = 0.55 } = {}) {
  const rand = mulberry32(world.seed + seed * 307);
  const out = { x: [], y: [], z: [], s: [], rot: [], tint: [] };
  for (let gz = box[2]; gz <= box[3]; gz += step) for (let gx = box[0]; gx <= box[1]; gx += step) {
    const x = gx + (rand() - 0.5) * step, z = gz + (rand() - 0.5) * step;
    if (terrain.waterAt(x, z) > 0.05) continue;
    const forest = terrain.forestDensity(x, z);
    if (forest > 0.82) continue;
    const road = terrain.roadInfo(x, z);
    if (road && road.w > 0.35) continue;
    const ri = terrain.riverInfo(x, z);
    if (ri.d < 12) continue;
    const yard = Math.hypot(x - 4, z - 6);
    if (yard < 7) continue;
    if (x > world.terraces.x0 - 2 && x < world.terraces.x1 + 2 && z > world.terraces.z0 - 2 && z < world.terraces.z1 + 2) continue;
    if (blockedByWorld(world, terrain, x, z, 0.4, 3)) continue;
    const slope = terrain.slopeAt(x, z, 1.0);
    if (slope > 35) continue;
    // 群れにする：大きな斑（数m）と小さな斑でむらを付け、斑の外は疎らにする（一様な点々に見えない）
    const patch = 0.3 + 1.1 * fbm(x * 0.21, z * 0.21, world.seed + 41, 3) + 0.35 * (fbm(x * 0.9, z * 0.9, world.seed + 43, 2) - 0.5);
    if (rand() > (1 - forest * 0.9) * 0.95 * Math.max(0.12, Math.min(1, patch))) continue;
    out.x.push(x); out.z.push(z); out.y.push(terrain.heightAt(x, z)); out.s.push(0.8 + rand() * 0.55); out.rot.push(rand() * Math.PI); out.tint.push(rand());
  }
  return out;
}

// 稲（棚田）。平らな段にだけ置く。戻りは {x,y,z,s,rot,tint}
export function scatterRice(world, terrain, { seed = 19, step = 0.5 } = {}) {
  const rand = mulberry32(world.seed + seed * 401);
  const T = world.terraces, out = { x: [], y: [], z: [], s: [], rot: [], tint: [] };
  for (let gz = T.z0; gz <= T.z1; gz += step) for (let gx = T.x0; gx <= T.x1; gx += step) {
    const x = gx + (rand() - 0.5) * step, z = gz + (rand() - 0.5) * step;
    const slope = terrain.slopeAt(x, z, 0.5);
    if (slope > 7) continue;
    const edge = Math.min(x - T.x0, T.x1 - x, z - T.z0, T.z1 - z);
    if (edge < 2.5) continue;
    const road = terrain.roadInfo(x, z);
    if (road && road.dist < 0.6) continue;
    out.x.push(x); out.z.push(z); out.y.push(terrain.heightAt(x, z)); out.s.push(0.8 + rand() * 0.45); out.rot.push(rand() * Math.PI); out.tint.push(rand());
  }
  return out;
}

// 野菜畑の菜：畝（うね）に沿って並べる。戻りは {x,y,z,s,rot,tint}
export function scatterCrops(world, terrain, { seed = 23, rowStep = 0.85, plantStep = 0.52 } = {}) {
  const rand = mulberry32(world.seed + seed * 503);
  const out = { x: [], y: [], z: [], s: [], rot: [], tint: [] };
  for (const f of world.plots || []) {
    const c = Math.cos(f.rot), sn = Math.sin(f.rot);
    for (let v = -f.hz + 0.5; v <= f.hz - 0.4; v += rowStep) {
      const kind = rand();                                  // 畝ごとに育ちが違う（大きい菜・小さい菜）
      for (let u = -f.hx + 0.45; u <= f.hx - 0.4; u += plantStep) {
        if (rand() < 0.08) continue;                        // 抜けた株
        const uu = u + (rand() - 0.5) * 0.16, vv = v + (rand() - 0.5) * 0.12;
        const x = f.x + uu * c + vv * sn, z = f.z - uu * sn + vv * c;
        if (terrain.waterAt(x, z) > 0.05 || blockedBuilding(world, x, z)) continue;
        out.x.push(x); out.z.push(z); out.y.push(terrain.heightAt(x, z)); out.s.push((0.75 + kind * 0.45) * (0.85 + rand() * 0.3)); out.rot.push(rand() * Math.PI * 2); out.tint.push(rand());
      }
    }
  }
  return out;
}
const blockedBuilding = (world, x, z) => world.buildings.some(b => insideFootprint(b, x, z, 0.5)) || world.props.some(p => Math.hypot(x - p.x, z - p.z) < (p.r || 1) + 0.3);
