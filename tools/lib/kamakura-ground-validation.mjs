import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
export async function verifyGround(data, dir) {
  if (!data.meta.ground) return { skip: 'meta.ground のない旧版' };
  assert(data.ground, 'Private ground failed to decode (values withheld)');
  assert.equal(data.ground.length, data.meta.grid.width * data.meta.grid.height * 3);
  assert(data.ground.every(n => Number.isFinite(n) && n >= 0 && n <= 255));
  const report = JSON.parse(execFileSync('python3', [new URL('./kamakura-ground-weights.py', import.meta.url).pathname, dir], { encoding: 'utf8', maxBuffer: 1e6 }));
  assert(report.classes.every(c => c.cells === 0 || c.maxError255 <= 25), 'Private dominant-class mean exceeds tolerance (values withheld)');
  return { bytes: data.ground.byteLength, ...report };
}
export async function readPrivateGround(meta, dir) {
  if (!meta.ground) return undefined;
  assert.equal(meta.ground.file, 'ground_rgb.bin');
  const b = await fs.readFile(path.join(dir, meta.ground.file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
