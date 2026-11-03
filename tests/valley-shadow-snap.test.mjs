// なぜ失敗したか（2026-11-04・案A）: 影の範囲の中心を世界のXZで丸めていた。光の向きは世界の軸に対して斜めなので、
// 1回の丸めが光の画面では端数の画素になり、歩くと影の縁が揺れた。品質を切り替えると、丸め幅は起動時の解像度のままだった。
// 光の画面の軸での丸め（整数画素ずつしか動かない）と、解像度からの丸め幅を、ブラウザなしで確かめる。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shadowTexel, snapShadowCenter } from '../dist/valley/shadow-snap.js';
const SUN = [0.50, 0.17, 0.85];
// Three.js の lookAt と同じ光の軸（z＝太陽へ、x＝上×z、y＝z×x）。
function axes(dir) {
  const l = Math.hypot(...dir), z = dir.map(v => v / l), xl = Math.hypot(z[2], z[0]), x = [z[2] / xl, 0, -z[0] / xl];
  return { x, y: [z[1] * x[2], z[2] * x[0] - z[0] * x[2], -z[1] * x[0]], z };
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const onGrid = (v, t) => Math.abs(v / t - Math.round(v / t)) < 1e-6;

test('the centre lands on whole light-space texels and keeps its depth [snap]', () => {
  const A = axes(SUN), y = A.y;
  assert(Math.abs(dot(A.x, A.y)) < 1e-12 && Math.abs(dot(A.x, A.z)) < 1e-12 && Math.abs(dot(A.y, A.z)) < 1e-12, '[snap] axes not orthogonal');
  assert(Math.abs(Math.hypot(...y) - 1) < 1e-12, '[snap] y axis not unit');
  for (const size of [4096, 2048]) {
    const t = shadowTexel(92, size), out = [0, 0, 0];
    for (let k = 0; k < 400; k++) {
      const p = [-120 + k * 0.613, 3 + Math.sin(k) * 6, -90 + k * 0.377];
      assert.equal(snapShadowCenter(...p, SUN, t, out), out, '[snap] must write into the given array');
      assert(onGrid(dot(out, A.x), t) && onGrid(dot(out, A.y), t), `[snap] ${size}: not on whole light texels`);
      assert(Math.abs(dot(out, A.z) - dot(p, A.z)) < 1e-9, '[snap] depth along the sun moved');
      assert(Math.abs(dot(out, A.x) - dot(p, A.x)) <= t / 2 + 1e-9 && Math.abs(dot(out, A.y) - dot(p, A.y)) <= t / 2 + 1e-9, '[snap] moved more than half a texel');
      const again = snapShadowCenter(...out, SUN, t);
      assert(again.every((v, i) => Math.abs(v - out[i]) < 1e-9), '[snap] not idempotent');
    }
  }
});

test('walking moves the shadow image by whole texels only; the old world-XZ rounding did not [snap-walk]', () => {
  const A = axes(SUN), t = shadowTexel(92, 4096);
  let oldFraction = 0;
  for (let k = 0; k < 200; k++) {
    const p = [-40 + k * 0.05, 2 + k * 0.01, -40 - k * 0.09], s = snapShadowCenter(...p, SUN, t);
    assert(onGrid(dot(s, A.x), t) && onGrid(dot(s, A.y), t), '[snap-walk] a step left a fractional texel');
    // 旧来：XZだけを世界の格子へ丸め、Yはそのまま。光の画面での端数を数える（この差が影の縁の揺れになっていた）。
    const old = [Math.round(p[0] / t) * t, p[1], Math.round(p[2] / t) * t];
    if (!onGrid(dot(old, A.x), t) || !onGrid(dot(old, A.y), t)) oldFraction++;
  }
  assert(oldFraction > 150, `[snap-walk] the old rounding should be fractional almost always (${oldFraction}/200)`);
});

test('the texel follows the shadow resolution, also after a quality switch [snap-quality]', () => {
  assert.equal(shadowTexel(92, 4096), 92 / 4096);
  assert.equal(shadowTexel(92, 2048), 2 * shadowTexel(92, 4096), '[snap-quality] light quality must snap twice as coarse');
  for (const bad of [[0, 4096], [92, 0], [NaN, 2048], [-1, 2048]]) assert.throws(() => shadowTexel(...bad), RangeError);
  assert.throws(() => snapShadowCenter(0, 0, 0, [0, 1, 0], .02), RangeError, '[snap] sun straight up has no light x axis');
  assert.throws(() => snapShadowCenter(0, 0, 0, [0, 0, 0], .02), RangeError);
  assert.throws(() => snapShadowCenter(0, 0, 0, SUN, 0), RangeError);
  // atmosphere.js は毎回、今の影の解像度と範囲から丸め幅を出す（起動時の定数を持たない）。radius（PCF_SOFT では効かない）も書かない。
  const src = fs.readFileSync(new URL('../dist/valley/atmosphere.js', import.meta.url), 'utf8');
  const follow = src.slice(src.indexOf('follow(target) {'), src.indexOf('update(camera, dt) {'));
  assert(/shadowTexel\(sh\.camera\.right - sh\.camera\.left, sh\.mapSize\.x\)/.test(follow) && /snapShadowCenter\(/.test(follow), '[snap-quality] follow does not derive the texel from the live map size');
  assert(!/texel/.test(src.replace(follow, '')), '[snap-quality] a texel fixed outside follow (at start-up) returned');
  assert(!/\.radius\s*=/.test(src) && /PCFSoftShadowMap/.test(fs.readFileSync(new URL('../dist/valley/main.js', import.meta.url), 'utf8')), '[radius] a radius setting returned while PCF_SOFT ignores it');
});
