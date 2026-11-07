import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { decodeData } from '../../dist/valley/kamakura-data.js';
import { createKamakuraTerrain } from '../../dist/valley/kamakura-terrain.js';
import { chunkGeometry, LODS } from '../../dist/valley/kamakura-chunks.js';
const buffer = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
export async function readPrivateData(dir) {
  const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'));
  const [height, walk, samples] = await Promise.all(['height_u16.bin', 'walk_u8.bin', 'check_samples.json'].map(n => fs.readFile(path.join(dir, n))));
  return { data: decodeData(meta, buffer(height), buffer(walk)), checks: JSON.parse(samples.toString()) };
}
export function verifySamples(data, checks) {
  const t = createKamakuraTerrain(data);
  for (const sample of checks.samples) {
    assert(Math.abs(t.heightAt(sample.x, -sample.y) - sample.z_float32) <= checks.step_m / 2 + 1e-6, 'Private height sample mismatch (values withheld)');
    assert(t.insideA(sample.x, -sample.y) === sample.inside_A, 'Private polygon mismatch (values withheld)');
  }
  return checks.samples.length;
}
function boundary(g, axis, value) {
  const map = new Map();
  for (let i = 0; i < g.positions.length; i += 3) if (Math.abs(g.positions[i + axis] - value) < 1e-7) {
    const key = g.positions[i + (axis === 0 ? 2 : 0)];
    map.set(key, [g.positions[i + 1], ...g.normals.slice(i, i + 3)]);
  }
  return map;
}
export function verifySeams(t, i = 0, j = 0, size = 64) {
  for (const a of LODS) for (const b of LODS) for (const axis of [0, 2]) {
    const left = chunkGeometry(t, i, j, i + size, j + size, a, axis === 0 ? { east: b } : { south: b });
    const right = axis === 0 ? chunkGeometry(t, i + size, j, i + 2 * size, j + size, b, { west: a }) : chunkGeometry(t, i, j + size, i + size, j + 2 * size, b, { north: a });
    const value = (axis === 0 ? t.x0 + (i + size) * t.cell : t.z0 + (j + size) * t.cell);
    const l = boundary(left, axis, value), r = boundary(right, axis, value);
    assert.equal(l.size, size + 1, 'Complete shared edge'); assert.equal(r.size, l.size);
    for (const [key, values] of l) {
      assert(r.has(key), 'Shared sample alignment');
      values.forEach((v, k) => assert(Math.abs(v - r.get(key)[k]) < 1e-8, 'Seam height/normal mismatch (values withheld)'));
    }
  }
  return LODS.length ** 2 * 2;
}
