// scatter.js — 木・岩・草・稲の配置を地形関数から決定的に出す純関数（logic層。Three.js非依存）。
// 乱数は機能ごとに別の系列（seed をずらす）。後から機能を足しても既存の絵を組み替えない（design.md）。
import { smooth } from './terrain-height.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// 建物の足跡（回転した長方形）に点が入るか。margin はメートル。
export function insideFootprint(b, x, z, margin = 0) {
  const c = Math.cos(b.rotY), s = Math.sin(b.rotY), dx = x - b.x, dz = z - b.z;
  const u = dx * c - dz * s, v = dx * s + dz * c; // rotation.y=θ のモデルの局所座標
  return Math.abs(u) <= b.footprint.w / 2 + margin && Math.abs(v) <= b.footprint.d / 2 + margin;
}

function blockedByWorld(world, terrain, x, z, margin) {
  for (const b of world.buildings) if (insideFootprint(b, x, z, margin)) return true;
  for (const p of world.props) if (Math.hypot(x - p.x, z - p.z) < (p.r || 1) + margin) return true;
  const road = terrain.roadInfo(x, z);
  if (road && road.dist < margin + 1.5) return true;
  if (Math.hypot(x - world.start.x, z - world.start.z) < 14) return true;
  return false;
}

// 木。kind: 0=杉, 1=広葉(ケヤキ・栗), 2=松。戻りは配列の組（描画側が LOD ごとに振り分ける）。
// 近景（nearBox）は step の格子、その外の遠景は farStep の格子で、ゆらぎをつけて置く。
export function scatterTrees(world, terrain, { seed = 7, step = 6, farStep = 10, nearBox = [-210, 240, -210, 200], farHalf = 700 } = {}) {
  const rand = mulberry32(world.seed + seed * 101);
  const out = { x: [], y: [], z: [], s: [], rot: [], kind: [], tint: [] };
  const taken = new Map(), cell = 4;
  const inNearBox = (x, z) => x >= nearBox[0] && x <= nearBox[1] && z >= nearBox[2] && z <= nearBox[3];
  const free = (x, z, r) => {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const list = taken.get((Math.floor(x / cell) + i) * 7919 + Math.floor(z / cell) + j);
      if (list) for (const t of list) if ((x - t[0]) ** 2 + (z - t[1]) ** 2 < (r + t[2]) ** 2) return false;
    }
    return true;
  };
  const tryPlace = (x, z, inNear) => {
    const density = terrain.forestDensity(x, z) + (inNear ? 0 : 0.25);
    const p = Math.pow(Math.max(0, Math.min(1, (density - 0.22) / 0.55)), 1.15);
    if (rand() > p) return;
    if (terrain.waterAt(x, z) > 0.02) return;
    const ri = terrain.riverInfo(x, z);
    if (ri.d < 13) return;
    const slope = terrain.slopeAt(x, z, 1.5);
    if (slope > 52) return;
    if (inNear && blockedByWorld(world, terrain, x, z, 4.5)) return;
    const surf = inNear ? terrain.surfaceAt(x, z, slope) : null;
    const r = rand();
    let kind = 0;
    if (surf && surf.rock > 0.35 && r < 0.55) kind = 2;
    else if ((Math.hypot(x, z) < 110 && density < 0.75 && r < 0.5) || (ri.d < 40 && r < 0.35)) kind = 1;
    else if (r > 0.9) kind = 2;
    const scale = (kind === 1 ? 0.8 : 0.75) + rand() * 0.55 + (density > 0.7 ? 0.1 : 0);
    const radius = (kind === 1 ? 2.6 : 1.9) * scale;
    if (!free(x, z, radius)) return;
    const key = Math.floor(x / cell) * 7919 + Math.floor(z / cell);
    if (!taken.has(key)) taken.set(key, []);
    taken.get(key).push([x, z, radius]);
    out.x.push(x); out.z.push(z); out.y.push(terrain.heightAt(x, z)); out.s.push(scale); out.rot.push(rand() * Math.PI * 2); out.kind.push(kind); out.tint.push(rand());
  };
  for (let gz = nearBox[2]; gz <= nearBox[3]; gz += step) for (let gx = nearBox[0]; gx <= nearBox[1]; gx += step) {
    tryPlace(gx + (rand() - 0.5) * step * 0.9, gz + (rand() - 0.5) * step * 0.9, true);
  }
  for (let gz = -farHalf; gz <= farHalf; gz += farStep) for (let gx = -farHalf; gx <= farHalf; gx += farStep) {
    if (inNearBox(gx, gz)) continue;
    tryPlace(gx + (rand() - 0.5) * farStep * 0.9, gz + (rand() - 0.5) * farStep * 0.9, false);
  }
  return out;
}

// 岩（河原・斜面・路肩）。戻りは {x,y,z,s,rot,sx,sz,sink}
export function scatterRocks(world, terrain, { seed = 13, nearBox = [-150, 170, -150, 130] } = {}) {
  const rand = mulberry32(world.seed + seed * 211);
  const out = { x: [], y: [], z: [], s: [], rot: [], sx: [], sz: [], sink: [] };
  for (let gz = nearBox[2]; gz <= nearBox[3]; gz += 5) for (let gx = nearBox[0]; gx <= nearBox[1]; gx += 5) {
    const x = gx + rand() * 5, z = gz + rand() * 5;
    if (terrain.waterAt(x, z) > 0.1) continue;
    const slope = terrain.slopeAt(x, z, 1.5);
    const ri = terrain.riverInfo(x, z);
    const bank = ri.d < 24 ? 1 - smooth(10, 24, ri.d) : 0;
    const steep = smooth(14, 32, slope);
    const p = 0.04 + bank * 0.55 + steep * 0.35;
    if (rand() > p) continue;
    if (blockedByWorld(world, terrain, x, z, 1.5)) continue;
    const road = terrain.roadInfo(x, z);
    if (road && road.dist < 1.0) continue;
    const s = 0.35 + Math.pow(rand(), 2.2) * (bank > 0.2 ? 2.6 : 1.7) + steep * 0.5;
    out.x.push(x); out.z.push(z); out.y.push(terrain.heightAt(x, z)); out.s.push(s); out.rot.push(rand() * Math.PI * 2);
    out.sx.push(0.75 + rand() * 0.6); out.sz.push(0.75 + rand() * 0.6); out.sink.push(0.15 + rand() * 0.25);
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
    if (blockedByWorld(world, terrain, x, z, 0.4)) continue;
    const slope = terrain.slopeAt(x, z, 1.0);
    if (slope > 35) continue;
    if (rand() > (1 - forest * 0.9) * 0.95) continue;
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
