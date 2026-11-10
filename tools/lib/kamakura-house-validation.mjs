// Measurements remain in memory/stdout; never write private positions into reports or fixtures.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseGlb, readAccessor } from './glb.mjs';
import { decodeHouses, houseNodeName, houseBodyBounds, houseMatrix, houseFit, houseFootprintHeights, houseBox, houseChunks, houseChunkDistance, houseLOD, houseIntersects } from '../../dist/valley/kamakura-houses.js';
import { createKamakuraTerrain } from '../../dist/valley/kamakura-terrain.js';
import { buildColliders } from '../../dist/valley/collision.js';
export async function readPrivateHouses(dir, data) {
  if (!data.meta.houses) return null;
  const [catalog, bin, glb] = await Promise.all(['houses.json', 'houses_f32.bin', 'houses_kit.glb'].map(n => fs.readFile(path.join(dir, n))));
  const houses = decodeHouses(JSON.parse(catalog), bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  const doc = parseGlb(glb), bodies = new Map(), triangles = new Map();
  for (const kind of houses.kinds.values()) {
    if (!houses.catalog.count_by_kind[kind.node]) continue;
    const node = doc.json.nodes.find(n => houseNodeName(n.name) === kind.node);
    assert(node && node.mesh !== undefined, 'Private kit node missing');
    assert(!node.matrix && !node.rotation && !node.translation && !node.scale, 'Private template must be identity');
    const primitives = doc.json.meshes[node.mesh].primitives, positions = [];
    let count = 0;
    for (const p of primitives) {
      positions.push(...readAccessor(doc, p.attributes.POSITION).array);
      count += (p.indices === undefined ? readAccessor(doc, p.attributes.POSITION).count : readAccessor(doc, p.indices).count) / 3;
    }
    assert.equal(count, kind.triangles, 'Private triangle count mismatch');
    bodies.set(kind.index, houseBodyBounds(positions)); triangles.set(kind.index, count);
  }
  return { houses, bodies, triangles };
}
export function verifyHouses(data, privateHouses) {
  if (!privateHouses) return { skip: 'meta.houses が無いため家の検査を省略' };
  const { houses, bodies, triangles } = privateHouses, t = createKamakuraTerrain(data);
  // Contract counts are metadata, never a copy of private placement/elevation samples.
  assert.equal(houses.instances.length, houses.catalog.count, 'house count matches the catalogue'); assert(houses.instances.length >= 500, 'a town, not a hamlet');
  assert.equal(houses.kinds.size, 17, 'v0.4 kind count'); assert.equal(bodies.size, 14, 'v0.4 placed kind count');
  let insideA = 0;
  const overlaps = { spawn: [], paths: [] }, boxes = [];
  const spawn = { x: data.meta.spawn.x, z: -data.meta.spawn.y };
  // Slope fit, measured on a 0.2 m footprint grid that is finer than the 0.5 m grid used to place the house.
  // Hard rule: the skirt bottom never ends above the lowest ground (float). Burial is measured, not hidden.
  const slope = {};
  for (const scale of [1, 1.8]) {
    const terrain = createKamakuraTerrain(data, scale), s = { floating: 0, maxFloat: -Infinity, infeasible: 0, maxBury: -Infinity,
      buriedOver: { '0.5': 0, '1': 0, '1.5': 0, '3': 0 }, originFloating: 0, originBuriedOver1_5: 0, warnings: [] };
    for (const item of houses.instances) {
      const body = bodies.get(item.kind), m = houseMatrix(item, terrain, body), fit = houseFit(item.matrix, body, terrain);
      assert.equal(m[13], fit.y, 'houseMatrix must use the fitted height');
      const dense = houseFootprintHeights(m, body, terrain, .2), bottom = body.min[1] * m[5];
      const float = m[13] + bottom - dense.low, bury = dense.high - m[13];
      s.maxFloat = Math.max(s.maxFloat, float); s.maxBury = Math.max(s.maxBury, bury);
      if (float > 0) { s.floating++; s.warnings.push({ id: item.id, kind: item.kind, float }); }
      if (!fit.feasible) s.infeasible++;
      for (const k of Object.keys(s.buriedOver)) if (bury > +k) s.buriedOver[k]++;
      // Baseline for comparison: the old rule that puts the origin on the ground at the house point.
      const y0 = terrain.heightAt(item.matrix[12], item.matrix[14]);
      if (y0 + bottom - dense.low > 0) s.originFloating++;
      if (dense.high - y0 > 1.5) s.originBuriedOver1_5++;
    }
    slope[scale] = s;
  }
  for (const item of houses.instances) {
    const kind = houses.kinds.get(item.kind), body = bodies.get(item.kind), matrix = houseMatrix(item, t, body);
    const box = { ...houseBox(kind, matrix, body), id: `house-${item.id}` }; boxes.push(box);
    insideA += t.insideA(matrix[12], matrix[14]) ? 1 : 0;
    const location = { id: item.id, kind: item.kind, x: matrix[12], z: matrix[14] };
    if (houseIntersects(box, spawn, spawn, .3)) overlaps.spawn.push(location);
    for (const [route, p] of Object.entries(data.patches?.paths || {})) {
      for (let i = 1; i < p.xyz_m.length; i++) {
        const a = p.xyz_m[i - 1], b = p.xyz_m[i];
        if (houseIntersects(box, { x: a[0], z: -a[1] }, { x: b[0], z: -b[1] })) {
          overlaps.paths.push({ ...location, route }); break;
        }
      }
    }
  }
  const floating = Object.values(slope).reduce((n, s) => n + s.floating, 0);
  const started = performance.now(); const col = buildColliders({ bounds: t.bounds, extraBoxes: boxes });
  const colliderBuildMs = performance.now() - started;
  const draw = { near: 0, mid: 0, hidden: 0, triangles: 0, meshes: 0 };
  for (const ch of houseChunks(houses)) {
    const level = houseLOD(houseChunkDistance(ch, spawn)), kinds = new Set(ch.items.map(i => i.kind));
    draw[level === 0 ? 'near' : level === 1 ? 'mid' : 'hidden'] += ch.items.length;
    if (level !== 2) { draw.triangles += ch.items.reduce((n,i) => n + (level === 0 ? triangles.get(i.kind) : 16), 0); draw.meshes += kinds.size * (level === 0 ? 1 : 2); }
  }
  return { count: houses.instances.length, placedKinds: bodies.size, insideA,
    overlaps, foundationAccepted: floating === 0, accepted: !overlaps.spawn.length && !overlaps.paths.length,
    slopeFit: { rule: '裾の底が最も低い地面より上に出る（浮き）=0 を必須。埋まりは測って報告（許容0.5m超は持ち上げるが、浮かない規則が優先）',
      byVerticalScale: Object.fromEntries(Object.entries(slope).map(([k, s]) => [k, { floating: s.floating, maxFloat: s.maxFloat, infeasible: s.infeasible, maxBury: s.maxBury,
        buriedOver: s.buriedOver, baselineOriginRule: { floating: s.originFloating, buriedOver1_5: s.originBuriedOver1_5 }, floatingSamples: s.warnings.slice(0, 10) }])) },
    spawnDrawUpperBound: draw, colliders: { count: col.boxes.length, gridCells: col.grid.size, buildMs: colliderBuildMs } };
}
