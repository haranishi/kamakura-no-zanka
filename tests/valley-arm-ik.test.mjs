import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTwoBone, shortestArc } from '../dist/valley/arm-ik.js';

const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const close = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);
const vector = (a, b) => close(dist(a, b), 0);
const input = { root: [0, 0, 0], mid: [0, .208, 0], end: [.222, .208, 0], hint: [0, 1, 1] };
function bones(p, r) {
  close(dist(p.root, r.mid), dist(p.root, p.mid));
  close(dist(r.mid, r.end), dist(p.mid, p.end));
  assert.ok([...r.mid, ...r.end, r.error].every(Number.isFinite));
  close(r.error, dist(p.target, r.end));
}
function rotate(q, v) {
  const [x, y, z, w] = q, [a, b, c] = v;
  const uv = [y * c - z * b, z * a - x * c, x * b - y * a];
  const uuv = [y * uv[2] - z * uv[1], z * uv[0] - x * uv[2], x * uv[1] - y * uv[0]];
  return v.map((t, i) => t + 2 * (w * uv[i] + uuv[i]));
}

test('届く目標には1e-9以内で一致し、両骨長を保存する', () => {
  for (const target of [[.2, .1, .1], [-.15, .2, -.2], [0, .014000001, 0], [0, .42999999, 0]]) {
    const p = { ...input, target }, r = solveTwoBone(p);
    assert.equal(r.reached, true); vector(r.end, target); close(r.error, 0); bones(p, r);
  }
});
test('遠い目標では根元から目標へ伸ばしきり、残距離を返す', () => {
  const p = { ...input, target: [1, 2, 2] }, r = solveTwoBone(p);
  assert.equal(r.reached, false); close(dist(p.root, r.end), .43); close(r.error, 3 - .43);
  vector(r.end, p.target.map(x => x * .43 / 3)); bones(p, r);
});
test('近すぎる目標は最小の折りたたみで止まり、骨を縮めない', () => {
  const p = { ...input, target: [.001, 0, 0] }, r = solveTwoBone(p);
  assert.equal(r.reached, false); vector(r.end, [.014, 0, 0]); close(r.error, .013); bones(p, r);
});
test('hint側の符号と平面に肘が曲がる', () => {
  for (const sign of [-1, 1]) {
    const p = { ...input, target: [.3, 0, 0], hint: [.1, 0, sign] }, r = solveTwoBone(p);
    assert.ok(r.mid[2] * sign > .1); close(r.mid[1], 0); bones(p, r);
  }
});
test('hintが軸上なら現在の肘側へ、それも軸上なら決定的な方向へ曲がる', () => {
  for (const sign of [-1, 1]) {
    const p = { root: [0, 0, 0], mid: [0, sign * .2, 0], end: [.2, sign * .2, 0], target: [.25, 0, 0], hint: [1, 0, 0] };
    const r = solveTwoBone(p); assert.ok(r.mid[1] * sign > 0); close(r.mid[2], 0); bones(p, r);
  }
  const p = { root: [0, 0, 0], mid: [.2, 0, 0], end: [.4, 0, 0], target: [.2, 0, 0], hint: [1, 0, 0] };
  const r = solveTwoBone(p); assert.ok(Math.hypot(r.mid[1], r.mid[2]) > .1); bones(p, r);
  assert.deepEqual(r, solveTwoBone(p));
});
test('目標が根元と一致・ほぼ一致しても等長と不等長の腕でNaNを出さない', () => {
  for (const end of [[0, 0, 0], [.1, .2, 0]]) for (const target of [[0, 0, 0], [1e-14, -1e-14, 0]]) {
    const p = { root: [0, 0, 0], mid: [0, .2, 0], end, target, hint: [0, 0, 1] }, r = solveTwoBone(p);
    bones(p, r); if (r.reached) vector(r.end, target);
  }
});
test('固定格子2197点で到達判定・端点・骨長を検査し、平行移動にも一致する', () => {
  const offset = [.37, -.41, .23];
  for (let x = -6; x <= 6; x++) for (let y = -6; y <= 6; y++) for (let z = -6; z <= 6; z++) {
    const p = { ...input, target: [x / 10, y / 10, z / 10] }, r = solveTwoBone(p), d = Math.hypot(...p.target);
    const min = dist(p.root, p.mid), max = dist(p.mid, p.end);
    assert.equal(r.reached, d >= Math.abs(min - max) && d <= min + max);
    bones(p, r); if (r.reached) vector(r.end, p.target);
    close(dist(p.root, r.end), Math.max(Math.abs(min - max), Math.min(min + max, d)));
    const moved = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.map((t, i) => t + offset[i])]));
    const rr = solveTwoBone(moved); bones(moved, rr);
    vector(rr.end, r.end.map((v, i) => v + offset[i]));
    // 根元が目標のときは丸め誤差で折りたたみ平面を選び直し得る。通常点で肘も比較。
    if (d > 0) vector(rr.mid, r.mid.map((v, i) => v + offset[i]));
  }
});
test('入力を凍結しても動作し、同じ入力に同じ結果を返す', () => {
  const p = Object.freeze(Object.fromEntries(Object.entries({ ...input, target: [.2, .1, -.1] }).map(([k, v]) => [k, Object.freeze([...v])])));
  const before = structuredClone(p), r = solveTwoBone(p);
  assert.deepEqual(r, solveTwoBone(p)); assert.deepEqual(p, before);
  r.mid[0] = 999; r.end[0] = 999; assert.deepEqual(p, before);
});
test('長さ0の骨も根元・端点とも有限で骨長を保存する', () => {
  for (const mid of [[0, 0, 0], [0, .2, 0]]) for (const target of [[0, 0, 0], [1, 0, 0]]) {
    const p = { root: [0, 0, 0], mid, end: mid, target, hint: [0, 0, 0] }; bones(p, solveTwoBone(p));
  }
});
test('shortestArcは固定の方向格子を最短回転で結び、正規化を保つ', () => {
  const dirs = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
    const n = Math.hypot(x, y, z); if (n) dirs.push([x / n, y / n, z / n]);
  }
  for (const a of dirs) for (const b of dirs) {
    const q = shortestArc(a, b); close(Math.hypot(...q), 1); vector(rotate(q, a), b);
    // |a+b|/2 は同じ半角の余弦。反対向きで1+dotの桁落ちを避ける。
    close(Math.abs(q[3]), Math.hypot(...a.map((v, i) => v + b[i])) / 2);
    assert.deepEqual(q, shortestArc(a, b));
  }
});
test('shortestArcの反対向き・ほぼ反対向き・同じ向きと零ベクトルが有限', () => {
  for (const to of [[-1, 0, 0], [-1, 1e-8, 0], [1, 0, 0]]) {
    const q = shortestArc([1, 0, 0], to), n = Math.hypot(...to);
    vector(rotate(q, [1, 0, 0]), to.map(v => v / n)); close(Math.hypot(...q), 1);
  }
  assert.deepEqual(shortestArc([0, 0, 0], [1, 0, 0]), [0, 0, 0, 1]);
});
