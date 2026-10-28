// なぜ失敗したか: 土の帯を埋める被覆の密度・禁止域・一回の平滑化を個別に守る。
// 原因の型: cover-shape / cover-source / cover-density / cover-blur / cover-edge / cover-pure。
import test from 'node:test';
import assert from 'node:assert/strict';
import { coverMap } from '../dist/valley/grass-field.js';
const field = (nx = 7, nz = 7) => ({ x0: -3, z0: 11, nx, nz, placeable: new Uint8Array(nx * nz), density: new Uint8Array(nx * nz) });

test('cover shape, range, determinism and input ownership', () => {
  const f = field(); f.placeable.fill(1); f.density.fill(100);
  const before = structuredClone(f), a = coverMap(f), b = coverMap(f);
  assert(a.data instanceof Uint8Array, '[cover-shape] expected byte map');
  assert.equal(a.data.length, f.nx * f.nz, '[cover-shape] wrong map length');
  for (const key of ['x0', 'z0', 'nx', 'nz']) assert.equal(a[key], f[key], '[cover-shape] lost bounds');
  assert(a.data.every(v => v >= 0 && v <= 255), '[cover-shape] invalid cover');
  assert.deepEqual(a, b, '[cover-pure] repeated calls differ');
  assert.notEqual(a.data, b.data, '[cover-pure] shared output buffer');
  assert.deepEqual(f, before, '[cover-pure] input mutated');
  assert.equal(a.data[24], 255, '[cover-density] full density must cover interior');
});

test('ineligible and zero-density cells supply no cover, including empty maps', () => {
  const f = field(); f.density.fill(255);
  assert(coverMap(f).data.every(v => v === 0), '[cover-source] ineligible density picked up');
  f.placeable.fill(1); f.density.fill(0);
  assert(coverMap(f).data.every(v => v === 0), '[cover-source] zero density picked up');
  f.density[24] = 100;
  assert.equal(coverMap(f).data[0], 0, '[cover-source] zero density picked up alongside live grass');
  assert.equal(coverMap(field(0, 0)).data.length, 0, '[cover-shape] empty map failed');
});

test('eligible maximum normalizes density and retains the 60 percent floor', () => {
  const f = field(9, 3); f.placeable.fill(1);
  for (let j = 0; j < 3; j++) for (let i = 0; i < 9; i++) f.density[j * 9 + i] = i < 3 ? 1 : i < 6 ? 50 : 100;
  const a = coverMap(f).data;
  assert.equal(a[10], 154, '[cover-density] low-density floor lost');
  assert.equal(a[13], 204, '[cover-density] half-density response lost');
  assert.equal(a[16], 255, '[cover-density] maximum not normalized');
  f.placeable[0] = 0; f.density[0] = 255;
  assert.equal(coverMap(f).data[16], 255, '[cover-source] forbidden density changed maximum');
});

test('one symmetric 3x3 pass spreads to neighbours and conserves interior mass within byte rounding', () => {
  const f = field(); f.placeable[24] = 1; f.density[24] = 100;
  const a = coverMap(f).data;
  for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) {
    const expected = Math.abs(i - 3) <= 1 && Math.abs(j - 3) <= 1 ? 28 : 0;
    assert.equal(a[j * 7 + i], expected, '[cover-blur] not exactly one zero-padded box pass');
  }
  assert(Math.abs(a.reduce((s, v) => s + v, 0) - 255) <= 9 * .5, '[cover-blur] interior mass changed beyond quantization');
  assert.equal(a[0], 0, '[cover-source] distant forbidden ground changed');
});

test('outside cells are zero, never wrapped or removed from the divisor', () => {
  const f = field(3, 3); f.placeable[0] = 1; f.density[0] = 100;
  assert.deepEqual([...coverMap(f).data], [28, 28, 0, 28, 28, 0, 0, 0, 0], '[cover-edge] border did not use zero padding');
  const one = field(1, 1); one.placeable[0] = 1; one.density[0] = 100;
  assert.equal(coverMap(one).data[0], 28, '[cover-edge] boundary mass should escape the map');
});
