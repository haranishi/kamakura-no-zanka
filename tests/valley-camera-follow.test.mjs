// 追従カメラの式（M4・dist/valley/camera-follow.js）と切替 ?smooth=camera（loco.js）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { CAM, spring, springAsym, trackVelocity, speedFov, clipTarget, softMax } from '../dist/valley/camera-follow.js';
import { parseLoco } from '../dist/valley/loco.js';

test('?smooth=camera turns only the follow camera off; ?smooth=off and ?loco=old turn it off too', () => {
  assert.equal(parseLoco('').smoothCamera, true);
  const c = parseLoco('?smooth=camera');
  assert.equal(c.smoothCamera, false); assert.equal(c.smoothArms, true); assert.equal(c.smoothIk, true); assert.equal(c.smoothAccel, true); assert.equal(c.name, 'a');
  for (const q of ['?smooth=off', '?loco=old', '?smooth=speed,camera']) assert.equal(parseLoco(q).smoothCamera, false, q);
  for (const q of ['?smooth=ik', '?smooth=arms', '?smooth=speed']) assert.equal(parseLoco(q).smoothCamera, true, q);
});

test('spring is exact (same curve at 30, 60 and 144 fps), never overshoots, and holds still when no time passes', () => {
  const run = hz => { const s = [0, 0], out = []; for (let i = 0; i < hz; i++) { spring(s, 1, 15, 1 / hz); if ((i + 1) % (hz / 6) === 0) out.push(s[0]); } return out; };
  const a = run(30), b = run(60), c = run(144);
  for (let k = 0; k < 6; k++) assert(Math.abs(a[k] - b[k]) < 1e-9 && Math.abs(b[k] - c[k]) < 1e-9, `${a[k]} ${b[k]} ${c[k]}`);
  const s = [0, 0]; let peak = 0; for (let i = 0; i < 120; i++) peak = Math.max(peak, spring(s, 1, 24, 1 / 60));
  assert(peak <= 1 + 1e-12 && peak > 0.999);
  assert.equal(spring([2, 1], 0, 10, 0), 2);
});

test('springAsym pulls in fast and lets go slowly, and the switch does not jump position or speed', () => {
  const toward = (target, frames) => { const s = [0.5, 0]; for (let i = 0; i < frames; i++) springAsym(s, target, CAM.clipOut, CAM.clipIn, 1 / 60); return s[0]; };
  assert(toward(0, 12) < 0.05);           // 寄せ：0.2秒で95%
  assert(toward(1, 12) < 0.85);           // 戻り：0.2秒ではまだ半分ほど
  assert(toward(1, 60) > 0.98);           // 1秒で戻りきる
  const s = [0.5, 0]; springAsym(s, 0, CAM.clipOut, CAM.clipIn, 1 / 60); const [x0, v0] = s;
  springAsym(s, 1, CAM.clipOut, CAM.clipIn, 1 / 60);   // 目標が反対へ移っても、位置は1コマぶんしか動かない
  assert(Math.abs(s[0] - x0) < Math.abs(v0) / 60 * 1.5 + 1e-3);
});

test('trackVelocity follows the hero speed and treats a teleport as a cut', () => {
  const vx = [0, 0], vz = [0, 0], prev = [0, 0];
  for (let i = 1; i <= 120; i++) trackVelocity(vx, vz, prev, 5 * i / 60, 0, 1 / 60);
  assert(Math.abs(vx[0] - 5) < 0.01 && Math.abs(vz[0]) < 1e-9);
  trackVelocity(vx, vz, prev, 50, 50, 1 / 60);
  assert.deepEqual([vx[0], vx[1], vz[0], vz[1]], [0, 0, 0, 0]);
  assert.deepEqual(prev, [50, 50]);
  trackVelocity(vx, vz, prev, 60, 60, 0);   // 時間が進まないコマは読まない
  assert.deepEqual(prev, [50, 50]);
});

test('speedFov: up to +3 degrees at sprint speed, none at walking speed, none with shake 0, reduced motion or a full lock', () => {
  assert.equal(speedFov(0), 0); assert.equal(speedFov(3.0), 0); assert.equal(speedFov(CAM.fovFrom), 0);
  assert(Math.abs(speedFov(5.0) - 3) < 1e-12); assert(Math.abs(speedFov(8) - 3) < 1e-12);
  const mid = speedFov((CAM.fovFrom + CAM.fovTo) / 2); assert(Math.abs(mid - 1.5) < 1e-12);
  assert.equal(speedFov(5, 0), 0); assert.equal(speedFov(5, 1, true), 0); assert.equal(speedFov(5, 1, false, 1), 0);
  assert(Math.abs(speedFov(5, 0.5) - 1.5) < 1e-12);
  for (let v = 0; v < 6; v += 0.01) assert(speedFov(v + 0.01) >= speedFov(v) - 1e-12);   // 速さに対して単調
});

test('clipTarget never asks for more room than the current ray allows, and never closer than the floor', () => {
  assert.equal(clipTarget(1, null, 0.3), 1);
  assert.equal(clipTarget(1, 0.5, 0.3), 0.5);
  assert.equal(clipTarget(0.6, 0.9, 0.3), 0.6);
  assert.equal(clipTarget(0.1, 0.2, 0.3), 0.3);
});

test('softMax keeps the floor (never below either value), matches max far from the crossing, and has no kink', () => {
  for (const [a, b] of [[0, 0], [1, 0], [0, 1], [-3, 2], [0.05, 0]]) assert(softMax(a, b, CAM.floorSoft) >= Math.max(a, b));
  assert(Math.abs(softMax(1, 0, CAM.floorSoft) - 1) < 1e-3);
  const d = 1e-4, slope = x => (softMax(x + d, 0, CAM.floorSoft) - softMax(x - d, 0, CAM.floorSoft)) / (2 * d);
  for (let x = -0.3; x < 0.3; x += 0.01) assert(Math.abs(slope(x + 0.01) - slope(x)) < 0.05, `kink near ${x}`);   // 傾きが1コマで折れない
});

