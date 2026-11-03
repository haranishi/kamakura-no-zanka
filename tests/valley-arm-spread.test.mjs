// 腕の開きの上限（8.3b・arm-spread.js）の純粋な部分。被弾・弾かれ・倒れの間だけ、腕が胴から開きすぎないように寄せる（見た目だけ）。
// 実ゲームの測り（焼き込んだ動作の開きの角・層の前後）は tools/scenarios/measure-arm-spread.mjs。
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPREAD, spreadCap, spreadWeight, spreadFix } from '../dist/valley/arm-spread.js';

const DEG = Math.PI / 180;
const out = new Float64Array(4);
// 腕を回したあとの、胴の下向きとのなす角（度）
const after = (a, d, o) => {
  const [x, y, z] = [o[0], o[1], o[2]], t = o[3], c = Math.cos(t), s = Math.sin(t), dot = x * a[0] + y * a[1] + z * a[2];
  const r = [0, 1, 2].map(i => a[i] * c + ([y * a[2] - z * a[1], z * a[0] - x * a[2], x * a[1] - y * a[0]][i]) * s + [x, y, z][i] * dot * (1 - c));
  const cos = (r[0] * d[0] + r[1] * d[1] + r[2] * d[2]) / (Math.hypot(...r) * Math.hypot(...d));
  return Math.acos(Math.max(-1, Math.min(1, cos))) / DEG;
};
const down = [0, -1, 0];

test('上限の選び方：倒れ・被弾・見た目の被弾・弾かれだけ。技・受け・待機・崩れには0', () => {
  assert.equal(spreadCap(true), SPREAD.dead);
  assert.equal(spreadCap(true, 'attack'), SPREAD.dead, '倒れが先');
  assert.equal(spreadCap(false, 'hit'), SPREAD.hit);
  assert.equal(spreadCap(false, 'idle', true), SPREAD.hit, '鎧でひるまない一・二発目の見た目の被弾');
  assert.equal(spreadCap(false, 'recoil'), SPREAD.recoil);
  for (const st of ['idle', 'attack', 'stagger', 'dodge', null]) assert.equal(spreadCap(false, st), 0, st);
  assert.equal(spreadCap(false), 0);
  assert(SPREAD.dead >= 30 && SPREAD.dead <= 60, '倒れの上限は体の横〜斜め下');
  for (const k of ['hit', 'recoil']) assert(SPREAD[k] >= 40 && SPREAD[k] <= 65, `${k} は手が肩の高さより下`);
});

test('寄せる角：上限を越えた分だけ、腕を胴の下向きへ近づける', () => {
  // 横へ水平（90度）・水平より上（110度）・前へ水平・斜め後ろ上
  for (const a of [[1, 0, 0], [Math.sin(110 * DEG), -Math.cos(110 * DEG), 0], [0, 0, 1], [-0.5, 0.6, -0.4]]) {
    spreadFix(...a, ...down, 55, 1, out);
    assert(out[3] > 0, `寄せる ${a}`);
    assert(Math.abs(after(a, down, out) - 55) < 1e-6, `回したあと55度 ${a}: ${after(a, down, out)}`);
    assert(Math.abs(Math.hypot(out[0], out[1], out[2]) - 1) < 1e-9, '軸は単位');
  }
  // 胴が傾いていても（倒れる途中）、胴の下向きを基準にする
  const tilted = [0.6, -0.2, -0.77];
  spreadFix(0, 1, 0, ...tilted, 55, 1, out);
  assert(Math.abs(after([0, 1, 0], tilted, out) - 55) < 1e-6);
});

test('上限の内・向きが決まらないときは回さない', () => {
  spreadFix(Math.sin(40 * DEG), -Math.cos(40 * DEG), 0, ...down, 55, 1, out);
  assert.equal(out[3], 0, '40度は上限の内');
  spreadFix(0, 1, 0, ...down, 55, 1, out);
  assert.equal(out[3], 0, '真上（胴の軸と平行）は向きが決まらない');
  spreadFix(1e-9, 1, 0, ...down, 55, 1, out);
  assert.equal(out[3], 0, 'ほぼ真上も、軸が数値の誤差で決まるので回さない');
  spreadFix(1, 0, 0, ...down, 0, 1, out);
  assert.equal(out[3], 0, '上限0は切る');
  spreadFix(0, 0, 0, ...down, 55, 1, out);
  assert.equal(out[3], 0, '長さ0の腕');
});

test('効き：上限の越えた分に掛かり、0〜1で頭打ち', () => {
  spreadFix(1, 0, 0, ...down, 55, 0.5, out);
  assert(Math.abs(out[3] - 35 * DEG * 0.5) < 1e-9, '半分の効きで半分だけ寄せる');
  spreadFix(1, 0, 0, ...down, 55, 3, out);
  assert(Math.abs(out[3] - 35 * DEG) < 1e-9, '1を越えない');
  spreadFix(1, 0, 0, ...down, 55, 0, out);
  assert.equal(out[3], 0);
});

test('効きの追い方：上限をかけたコマで1、外すと0へ刻み幅によらず滑らか。dt0・負では変えない', () => {
  assert.equal(spreadWeight(0, true, 1 / 60), 1, 'かけたコマで1（命中の停止の間も効く）');
  assert.equal(spreadWeight(0, true, 0), 1, '停止で dt が0でも効く');
  for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
    const n = Math.round(0.1 / dt); let u = 1;
    for (let i = 0; i < n; i++) u = spreadWeight(u, false, dt);
    assert(Math.abs(u - Math.exp(-SPREAD.rate * n * dt)) < 1e-9, `外すと戻る dt ${dt}`);
  }
  assert(spreadWeight(1, false, 1 / 60) > 0.6, '外して1コマで跳ばない');
  assert.equal(spreadWeight(0.3, false, 0), 0.3);
  assert.equal(spreadWeight(0.3, false, -1 / 60), 0.3, '負の刻みでは変えない');
  assert.equal(spreadWeight(0.3, false, NaN), 0.3);
});

test('毎コマの新規確保をしない（受け渡しの配列に書く）', () => {
  assert.equal(spreadFix(1, 0, 0, ...down, 55, 1, out), out);
  const before = process.memoryUsage().heapUsed;
  let s = 0;
  for (let i = 0; i < 200000; i++) { spreadFix(1, (i % 7) * 0.01, 0.2, 0, -1, 0.1, 55, 1, out); s += out[3] + spreadCap(i % 2 === 0, 'hit', false) + spreadWeight(0.5, false, 1 / 60); }
  assert(s > 0);
  assert(process.memoryUsage().heapUsed - before < 2_000_000, '20万回で2MB未満');
});
