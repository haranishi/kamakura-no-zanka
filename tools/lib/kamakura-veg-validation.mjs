// Private data stays in memory. Only aggregate counts/timings reach stdout.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { TREES } from '../../dist/valley/config.js';
import { decodeVeg, prepareVeg, vegCircles, selectVeg, vegPolicy } from '../../dist/valley/kamakura-veg.js';
import { createKamakuraTerrain } from '../../dist/valley/kamakura-terrain.js';
import { houseBox, houseMatrix } from '../../dist/valley/kamakura-houses.js';
import { buildColliders } from '../../dist/valley/collision.js';
import { kamakuraSpawn } from '../../dist/valley/kamakura-spawn.js';
export async function verifyVeg(data, dir, privateHouses, facilityBoxes = []) {
  if (!data.meta.veg) return { skip: 'meta.veg が無いため木の検査を省略' };
  const meta = data.meta.veg;
  assert.equal(meta.file, 'veg_f32.bin'); assert.equal(meta.info, 'veg.json');
  const info = JSON.parse(await fs.readFile(path.join(dir, 'veg.json'), 'utf8')), b = await fs.readFile(path.join(dir, 'veg_f32.bin'));
  const items = decodeVeg(info, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), meta.count);
  assert.equal(items.length, 112890, 'v0.6 placement count contract');
  const terrain = createKamakuraTerrain(data), spawn = kamakuraSpawn(terrain, '');
  const boxes = privateHouses ? privateHouses.houses.instances.map(i => houseBox(privateHouses.houses.kinds.get(i.kind), houseMatrix(i, terrain, privateHouses.bodies.get(i.kind)), privateHouses.bodies.get(i.kind))) : [];
  const prepared = prepareVeg(items, terrain, { boxes: [...boxes, ...facilityBoxes], paths: data.patches?.paths || {}, spawn });
  const heights = [20, 12, 13, 8, 3, 1.2];
  const circles = vegCircles(prepared, sp => heights[sp]), start = performance.now();
  buildColliders({ bounds: terrain.bounds, extraBoxes: boxes, extraCircles: circles });
  const colliderBuildMs = performance.now() - start;
  const draw = {};
  for (const quality of ['standard', 'light']) {
    const policy = vegPolicy(quality), selected = selectVeg(prepared.grid, spawn, policy);
    const counts = selected.levels.map(v => v.length);
    counts.forEach((n, k) => assert(n <= policy.capacities[k]));
    const triangleUpperBound = selected.levels.reduce((sum, a, level) => sum + a.reduce((s, i) => s + (level === 2 ? 2 : TREES.budget[['cedar','zelkova','pine','maple','sapling','shrub'][i.species]][level]), 0), 0);
    draw[quality] = { counts, triangleUpperBoundWithBoards: triangleUpperBound, capacities: policy.capacities, dropped: selected.dropped, cells: selected.cells, scanned: selected.scanned };
  }
  assert.equal(prepared.records.length, prepared.active.length + Object.values(prepared.excluded).reduce((a,b) => a+b, 0));
  return { decoded: items.length, eligible: prepared.records.length, used: prepared.active.length, excluded: prepared.excluded,
    excludedTotal: prepared.records.length - prepared.active.length, insideA: prepared.insideA, circles: circles.length, colliderBuildMs, chunks: prepared.grid.size, spawn: draw };
}
