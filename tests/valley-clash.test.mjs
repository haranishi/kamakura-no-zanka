// 刃が当たった点・刃同士が打ち合う点・ひるみの押す向き（8.3a 第2周・clash.js）の純粋な幾何。
import test from 'node:test';
import assert from 'node:assert/strict';
import { STRIKE, closestSegments, strikePoint, clashPoint, pushDirection } from '../dist/valley/clash.js';

const near = (a, b, eps = 1e-9) => a.every((x, i) => Math.abs(x - b[i]) < eps);

test('線分どうしの最も近い2点：交わる・ねじれ・平行・端どうし・長さ0', () => {
  let c = closestSegments([-1, 1, 0], [1, 1, 0], [0, 0, 0], [0, 2, 0]);                 // 十字に交わる
  assert(c.d < 1e-12 && near(c.p, [0, 1, 0]) && near(c.q, [0, 1, 0]) && Math.abs(c.s - 0.5) < 1e-12 && Math.abs(c.t - 0.5) < 1e-12);
  c = closestSegments([-1, 1, 0.3], [1, 1, 0.3], [0, 0, 0], [0, 2, 0]);                  // ねじれ（0.3離れて直交）
  assert(Math.abs(c.d - 0.3) < 1e-12 && near(c.p, [0, 1, 0.3]) && near(c.q, [0, 1, 0]));
  c = closestSegments([0, 0, 0], [1, 0, 0], [0, 0.5, 0], [1, 0.5, 0]);                  // 平行：距離は0.5、点は線分の上
  assert(Math.abs(c.d - 0.5) < 1e-12 && c.s >= 0 && c.s <= 1 && c.t >= 0 && c.t <= 1);
  c = closestSegments([0, 0, 0], [1, 0, 0], [2, 1, 0], [3, 1, 0]);                      // 端どうし
  assert(near(c.p, [1, 0, 0]) && near(c.q, [2, 1, 0]) && Math.abs(c.d - Math.SQRT2) < 1e-12);
  c = closestSegments([0, 0, 0], [0, 0, 0], [1, -1, 0], [1, 1, 0]);                     // 長さ0（点と線分）
  assert(near(c.q, [1, 0, 0]) && Math.abs(c.d - 1) < 1e-12);
  for (const x of [c.s, c.t, c.d, ...c.p, ...c.q]) assert(Number.isFinite(x));
});

test('当たった点：刃が胴の半径の内を通れば刃の上、外なら胴の表面の刃の側（胸の中心にも、刃の無い側にも置かない）', () => {
  const low = [0, 0.9, 0], high = [0, 1.46, 0];
  let s = strikePoint([0.6, 1.2, -0.1], [-0.4, 1.2, 0.1], low, high);                   // 刃が胴を横切る
  assert(s.inside && s.gap <= STRIKE.torsoRadius && Math.abs(s.point[1] - 1.2) < 1e-9);
  s = strikePoint([1.2, 1.3, 0.8], [1.0, 1.25, 0.9], low, high);                        // 刃は右前の遠く：胴の表面の、刃の側
  assert(!s.inside && s.gap > STRIKE.torsoRadius);
  const r = Math.hypot(s.point[0], s.point[2]);
  assert(Math.abs(r - STRIKE.torsoRadius) < 1e-9 && s.point[0] > 0 && s.point[2] > 0, JSON.stringify(s));
  s = strikePoint([0.2, 2.4, 0], [0.4, 2.3, 0], low, high);                              // 刃が頭の上：胴の上の端から上へ
  assert(!s.inside && Math.abs(s.point[1] - (1.46 + STRIKE.torsoRadius * 0.98)) < 0.03 && s.point[1] <= 1.46 + STRIKE.torsoRadius + 1e-9);
});

test('弾きの打ち合う点：相手の刃の外側8割の上で、受けた人の右肩に最も近い点', () => {
  const root = [0, 1, 0], tip = [1, 1, 0];
  assert(near(clashPoint(root, tip, [0.5, 2, 0]), [0.5, 1, 0]));                         // 真上の肩：刃の中ほど
  assert(near(clashPoint(root, tip, [-3, 1, 0]), [0.2, 1, 0]));                          // 根元の側：手の中は避けて0.2
  assert(near(clashPoint(root, tip, [4, 1, 0]), [1, 1, 0]));                             // 先の側：切先まで
  assert(near(clashPoint(root, root, [4, 1, 0]), root));                                 // 長さ0でも有限
});

test('ひるみの押す向き：相手から自分への向きに、刃の進む向きの水平成分を混ぜる（長さ1）。無ければ相手から自分へ', () => {
  const plain = pushDirection(0, 0, 2, 0, null);
  assert(near([plain.x, plain.z], [1, 0]));
  const mixed = pushDirection(0, 0, 2, 0, [0, -9, 10]);                                   // 刃は下と +Z へ進む
  assert(Math.abs(Math.hypot(mixed.x, mixed.z) - 1) < 1e-12 && mixed.x > 0 && mixed.z > 0);
  assert(Math.abs(Math.atan2(mixed.z, mixed.x) - Math.atan2(STRIKE.push, 1 - STRIKE.push)) < 1e-9);
  const vertical = pushDirection(0, 0, 2, 0, [0, -12, 0]);                                // 刃が真下へ：水平成分なし
  assert(near([vertical.x, vertical.z], [1, 0]));
  assert.equal(pushDirection(1, 1, 1, 1, null), null);                                   // 同じ位置・刃の速度なし
  const only = pushDirection(1, 1, 1, 1, [0, 0, 3]);
  assert(near([only.x, only.z], [0, 1]));
});
